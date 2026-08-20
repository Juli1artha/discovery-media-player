-- LA PRÉSENCE GARDE LA TRACE DE CE QUI EST PROUVÉ — POUR SAVOIR QUAND FERMER LA PORTE.
--
-- ⚠️ P1c étape 2 (jeton participant signé), incrément 2. Deux colonnes de transition sur la ligne de
-- présence : `last_token_at` (dernier battement AVEC un jeton valide) et `last_no_token_at` (dernier
-- battement SANS). Le compteur de la carte lira `presence: { avecJeton, sansJeton }` sur 24 h : quand
-- `sansJeton` retombe à zéro, plus aucun client legacy ne bat, et on peut poser PLAYER_PRESENCE_STRICT.
--
-- ⚠️ DEUX CHAMPS, PAS UN — c'est le cœur du correctif (relevé 2e hôte). `last_token_at` seul est un
-- champ de MAXIMUM : un seul battement moderne l'écrase et efface la trace des battements legacy du
-- MÊME participant → `sansJeton` tomberait à zéro pendant que le legacy passe encore. La MESURE est en
-- max, la DÉCISION est en ANY : il faut le second champ pour que « a-t-il battu sans jeton dans la
-- fenêtre ? » reste vrai quoi qu'aient fait ses autres battements. Les deux ensembles se recouvrent
-- volontairement (un participant qui a fait les deux compte dans les deux).
--
-- ⚠️ LA RPC CHANGE DE SIGNATURE SANS CASSER LE CONTRAT DE 0015. On DROP l'ancienne (10 args) et on crée
-- la nouvelle avec un 11e paramètre `p_has_token boolean DEFAULT null` : un appel à 10 arguments de
-- l'ANCIEN code se résout alors sur la nouvelle (le défaut remplit le 11e), sans surcharge ambiguë ni
-- corps dupliqué. `p_has_token` : true → écrit `last_token_at` ; false → `last_no_token_at` ; null
-- (ancien code) → ni l'un ni l'autre. Le reste du corps est IDENTIQUE à 0015.
--
-- ⚠️ Sans lui : le player sonde `last_token_at` (server/schema.js) ; absente, il n'écrit pas les
--    colonnes de transition et le compteur `presence` n'apparaît pas — la présence continue de
--    fonctionner. Additive ; le DROP+CREATE de la fonction est atomique dans la migration.

alter table public.doc_presentation_attendees
  add column if not exists last_token_at    timestamptz;
alter table public.doc_presentation_attendees
  add column if not exists last_no_token_at timestamptz;

drop function if exists public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer);

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
  p_has_token    boolean default null
)
returns table (ok boolean, created boolean, capped boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_count  integer;
  v_page   integer := greatest(1, coalesce(p_page, 1));
begin
  select true into v_exists
    from public.doc_presentation_attendees
    where slug = p_slug and attendee_key = p_key;

  if not coalesce(v_exists, false) and not p_is_member and not p_is_presenter then
    perform pg_advisory_xact_lock(hashtextextended(p_slug || '|' || coalesce(p_ip_hash, ''), 0));
    select true into v_exists
      from public.doc_presentation_attendees
      where slug = p_slug and attendee_key = p_key;
    if not coalesce(v_exists, false) then
      select count(*) into v_count
        from public.doc_presentation_attendees
        where slug = p_slug
          and creator_ip_hash is not distinct from p_ip_hash
          and is_member = false and is_presenter = false;
      if v_count >= p_anon_cap then
        return query select false, false, true;
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

  return query select true, not coalesce(v_exists, false), false;
end;
$$;
revoke all on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer, boolean) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer, boolean) from %I', r);
    end if;
  end loop;
end
$$;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer, boolean) to service_role;
  end if;
end
$$;
