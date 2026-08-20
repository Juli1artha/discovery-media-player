-- UN BOOTSTRAP NE PEUT PAS S'EMPARER D'UNE PRÉSENCE DÉJÀ RÉCLAMÉE PAR UN PORTEUR DE JETON.
--
-- ⚠️ Le résidu de l'étape 2, et le dernier verrou avant PLAYER_PRESENCE_STRICT. Un client moderne qui
-- n'a pas encore de jeton s'annonce par `wantToken` : c'est ce marqueur qui le distingue d'un client
-- legacy, et il est AUTO-DÉCLARÉ. Sous STRICT, un attaquant pouvait donc le déclarer à son tour, poser
-- la clé d'un participant déjà enregistré, et écraser sa ligne — exactement l'usurpation que l'étape 2
-- ferme pour les battements ordinaires. Le second hôte l'a EXÉCUTÉE sur sa prod (nom du titulaire
-- remplacé) : ce n'est pas une hypothèse.
--
-- La règle : une ligne qui a DÉJÀ battu avec un jeton valide (`last_token_at` renseigné) est RÉCLAMÉE.
-- Un bootstrap — par définition sans jeton — n'a rien à y écrire. Il reste libre de créer une ligne
-- neuve, et d'adopter une ligne legacy jamais réclamée (c'est le chemin de montée normal).
--
-- ⚠️ POURQUOI CE N'EST PAS UN REFUS DE RECHARGEMENT. Le client PERSISTE désormais son jeton à côté de
-- sa clé de participant (même durée de vie, même stockage) : un rechargement de page repart donc avec
-- son jeton, pas en bootstrap. Un bootstrap sur une ligne réclamée devient alors franchement anormal —
-- et le client, refusé, fait TOURNER sa clé pour repartir sur une ligne neuve plutôt que de perdre sa
-- présence en silence.
--
-- ⚠️ Sans lui : le player appelle la signature à 11 arguments (0017) ou 10 (0015) et le bootstrap n'est
--    pas contrôlé — c'est l'état d'aujourd'hui, tenable tant que PLAYER_PRESENCE_STRICT est absent.
--    N'ARMEZ PAS STRICT sans cette migration : elle est ce qui rend la fermeture utile.
--    Le player réessaie automatiquement le contrat plus ancien, donc appliquer dans n'importe quel
--    ordre est inoffensif.

drop function if exists public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer, boolean);

create or replace function public.player_attendance_bump(
  p_slug         text,
  p_key          text,
  p_ip_hash      text,
  p_page         integer,
  p_name         text,
  p_avatar       text,
  p_is_member    boolean,
  p_is_presenter boolean,
  p_max_gap_ms   integer,
  p_anon_cap     integer,
  p_has_token    boolean default null,
  p_only_if_unclaimed boolean default null
)
returns table (ok boolean, created boolean, capped boolean, usurpe boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_claimed boolean;
  v_count  integer;
  v_page   integer := greatest(1, coalesce(p_page, 1));
begin
  -- On lit l'existence ET l'état « réclamée » en un seul geste : un bootstrap n'a rien à écrire sur
  -- une ligne dont un porteur de jeton s'est déjà servi.
  select true, (last_token_at is not null) into v_exists, v_claimed
    from public.doc_presentation_attendees
    where slug = p_slug and attendee_key = p_key;

  if p_only_if_unclaimed is true and coalesce(v_exists, false) and coalesce(v_claimed, false) then
    return query select false, false, false, true;   -- usurpation : on n'écrit RIEN
    return;
  end if;

  if not coalesce(v_exists, false) and not p_is_member and not p_is_presenter then
    perform pg_advisory_xact_lock(hashtextextended(p_slug || '|' || coalesce(p_ip_hash, ''), 0));
    -- Re-lire sous le verrou : la ligne a pu naître entre-temps — et si elle est née RÉCLAMÉE, un
    -- bootstrap concurrent ne doit pas davantage l'écraser ici qu'au premier contrôle.
    select true, (last_token_at is not null) into v_exists, v_claimed
      from public.doc_presentation_attendees
      where slug = p_slug and attendee_key = p_key;
    if p_only_if_unclaimed is true and coalesce(v_exists, false) and coalesce(v_claimed, false) then
      return query select false, false, false, true;
      return;
    end if;
    if not coalesce(v_exists, false) then
      select count(*) into v_count
        from public.doc_presentation_attendees
        where slug = p_slug
          and creator_ip_hash is not distinct from p_ip_hash
          and is_member = false and is_presenter = false;
      if v_count >= p_anon_cap then
        return query select false, false, true, false;
        return;
      end if;
    end if;
  end if;

  insert into public.doc_presentation_attendees as l
    (slug, attendee_key, name, email, avatar, is_member, is_presenter,
     first_seen, last_seen, total_ms, pages, creator_ip_hash, last_token_at, last_no_token_at)
  values
    (p_slug, p_key, nullif(p_name, ''), null, nullif(p_avatar, ''), p_is_member, p_is_presenter,
     now(), now(), 0, jsonb_build_array(v_page), p_ip_hash,
     case when p_has_token is true then now() end,
     case when p_has_token is false then now() end)
  on conflict (slug, attendee_key) do update
    set last_seen    = greatest(now(), l.last_seen + interval '1 millisecond'),
        total_ms     = l.total_ms + (
                         case
                           when (extract(epoch from (greatest(now(), l.last_seen + interval '1 millisecond') - l.last_seen)) * 1000) <= p_max_gap_ms
                           then (extract(epoch from (greatest(now(), l.last_seen + interval '1 millisecond') - l.last_seen)) * 1000)::bigint
                           else 0
                         end),
        pages        = case when l.pages @> to_jsonb(v_page) then l.pages else l.pages || to_jsonb(v_page) end,
        name         = coalesce(nullif(p_name, ''), l.name),
        avatar       = coalesce(nullif(p_avatar, ''), l.avatar),
        is_member    = p_is_member,
        is_presenter = p_is_presenter,
        last_token_at    = case when p_has_token is true  then now() else l.last_token_at    end,
        last_no_token_at = case when p_has_token is false then now() else l.last_no_token_at end;

  return query select true, not coalesce(v_exists, false), false, false;
end;
$$;
revoke all on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer, boolean, boolean) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer, boolean, boolean) from %I', r);
    end if;
  end loop;
end
$$;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer, boolean, boolean) to service_role;
  end if;
end
$$;
