-- LA RPC DE PRÉSENCE LIT LA PRÉSENTATION — UN BATTEMENT PASSE DE 3 À 2 ALLERS-RETOURS.
--
-- ⚠️ Dernier poste chiffré d'un audit externe, et il exigeait d'être MESURÉ avant d'être engagé.
-- La mesure existe : à 250 participants, le battement coûte 3 allers-retours (débit par IP, lecture
-- de présentation, écriture) — soit ~30 op/s. La lecture disparaît ici : ~20 op/s.
--
-- ⚠️ CE QUI CHANGE DE CAMP, ET IL FAUT LE LIRE COMME TEL : « qui est présentateur » se décidait en
-- JavaScript (sha256 du jeton de contrôle comparé au control_hash de la ligne). Cette décision passe
-- dans le SQL, sur la MÊME donnée et dans la MÊME transaction que l'écriture. Un déplacement de
-- décision est l'endroit où une garde se perd en chemin : les deux refus que le code JS opposait —
-- présentation introuvable, présentation close ET archivée — sont donc reproduits ici, et rendus
-- explicitement (`introuvable`, `archivee`) plutôt que confondus avec un simple `ok = false`.
--
-- ⚠️ RÉTROCOMPATIBLE DANS LES DEUX SENS. `p_control_hash` a un DEFAULT : une base NEUVE sert un code
-- ANCIEN sans rien changer (il passe p_page, décide lui-même du présentateur, et ne demande pas les
-- nouveaux refus). Le sens inverse — code neuf, base ancienne — reste impossible par construction
-- (PostgREST résout par jeu d'arguments nommés) : le player réessaie donc le contrat plus court, et
-- retombe sur sa lecture préalable. Dégrader, jamais casser, jamais en silence.
--
-- ⚠️ Sans lui : rien ne casse — le player redemande le contrat court, relit la présentation comme
-- avant, et le battement garde ses 3 allers-retours. Le titre de présentateur, les deux refus et la
-- page restent exacts : c'est le CHEMIN qui change, jamais le résultat.

drop function if exists public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer, boolean, boolean);

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
  p_only_if_unclaimed boolean default null,
  p_control_hash text default null
)
returns table (ok boolean, created boolean, capped boolean, usurpe boolean,
               introuvable boolean, archivee boolean, page integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_claimed boolean;
  v_count  integer;
  v_pres_active boolean;
  v_pres_page   integer;
  v_pres_hash   text;
  v_pres_vue    boolean := false;
  v_presentateur boolean;
  v_page   integer;
begin
  -- ⚠️ LA PRÉSENTATION EST LUE ICI, ET C'EST TOUT L'OBJET DE 0019. L'appelant la lisait avant
  -- d'appeler : un battement coûtait donc DEUX allers-retours là où un seul suffit. La lecture
  -- servait à trois choses — l'existence, l'identification du présentateur, la page courante — et
  -- les trois se font mieux ici, dans la même transaction que l'écriture.
  select active, current_page, control_hash
    into v_pres_active, v_pres_page, v_pres_hash
    from public.doc_presentations where slug = p_slug;
  v_pres_vue := found;

  -- ⚠️ LE SIGNAL EST « L'APPELANT A-T-IL LU », PAS « PORTE-T-IL UN JETON ». Première écriture de
  -- cette migration : les deux refus ci-dessous étaient conditionnés à `p_control_hash is not null`.
  -- Or un participant ANONYME n'envoie aucun jeton de contrôle — c'est-à-dire l'immense majorité des
  -- battements — et il aurait donc perdu le 404 et le refus d'archive que la route lui oppose
  -- aujourd'hui. Une garde perdue en chemin, à l'endroit exact que l'en-tête désigne comme risqué.
  --
  -- Ce qui décide, c'est si l'appelant a DÉJÀ lu la présentation, et ça se lit à `p_page` : un
  -- appelant ANCIEN en fournit toujours une (les deux seuls appelants du dépôt envoient page >= 1,
  -- et 1 pour la sonde de schéma) ; un appelant NEUF n'en a pas, puisqu'il n'a rien lu. `p_page is
  -- null` dit donc exactement « c'est à toi de trancher » — pour un anonyme comme pour un
  -- présentateur, alors que le jeton de contrôle ne parlait que du second.
  if p_page is null and not v_pres_vue then
    return query select false, false, false, false, true, false, 0;   -- introuvable, rien écrit
    return;
  end if;

  -- ⚠️ MÊME REFUS QUE LE CODE QU'ON REMPLACE : une présentation close ET archivée (control_hash
  -- effacé) n'a plus rien à mettre à jour. Le dire ici évite que la fusion perde une garde en
  -- chemin — c'est le risque propre à tout déplacement de décision.
  if p_page is null and v_pres_active is false and v_pres_hash is null then
    return query select false, false, false, false, false, true, 0;   -- archivée, rien écrit
    return;
  end if;

  -- ⚠️ LA DÉCISION QUI CHANGE DE CAMP : « qui est présentateur » se décidait en JavaScript, par
  -- comparaison du sha256 du jeton de contrôle au control_hash de la ligne. Elle se décide ici
  -- désormais — sur la MÊME donnée, dans la même transaction. On garde le OU avec l'argument de
  -- l'appelant : un appelant ancien continue de décider lui-même, et ne perd rien.
  v_presentateur := coalesce(p_is_presenter, false)
                    or (p_control_hash is not null and v_pres_hash is not null and p_control_hash = v_pres_hash);

  -- La page vient de la BASE quand l'appelant ne la fournit pas — il n'a plus à la lire pour nous.
  v_page := greatest(1, coalesce(p_page, v_pres_page, 1));

  -- On lit l'existence ET l'état « réclamée » en un seul geste : un bootstrap n'a rien à écrire sur
  -- une ligne dont un porteur de jeton s'est déjà servi.
  select true, (last_token_at is not null) into v_exists, v_claimed
    from public.doc_presentation_attendees
    where slug = p_slug and attendee_key = p_key;

  if p_only_if_unclaimed is true and coalesce(v_exists, false) and coalesce(v_claimed, false) then
    return query select false, false, false, true, false, false, v_page;   -- usurpation : on n'écrit RIEN
    return;
  end if;

  if not coalesce(v_exists, false) and not p_is_member and not v_presentateur then
    perform pg_advisory_xact_lock(hashtextextended(p_slug || '|' || coalesce(p_ip_hash, ''), 0));
    -- Re-lire sous le verrou : la ligne a pu naître entre-temps — et si elle est née RÉCLAMÉE, un
    -- bootstrap concurrent ne doit pas davantage l'écraser ici qu'au premier contrôle.
    select true, (last_token_at is not null) into v_exists, v_claimed
      from public.doc_presentation_attendees
      where slug = p_slug and attendee_key = p_key;
    if p_only_if_unclaimed is true and coalesce(v_exists, false) and coalesce(v_claimed, false) then
      return query select false, false, false, true, false, false, v_page;
      return;
    end if;
    if not coalesce(v_exists, false) then
      select count(*) into v_count
        from public.doc_presentation_attendees
        where slug = p_slug
          and creator_ip_hash is not distinct from p_ip_hash
          and is_member = false and is_presenter = false;
      if v_count >= p_anon_cap then
        return query select false, false, true, false, false, false, v_page;
        return;
      end if;
    end if;
  end if;

  insert into public.doc_presentation_attendees as l
    (slug, attendee_key, name, email, avatar, is_member, is_presenter,
     first_seen, last_seen, total_ms, pages, creator_ip_hash, last_token_at, last_no_token_at)
  values
    (p_slug, p_key, nullif(p_name, ''), null, nullif(p_avatar, ''), p_is_member, v_presentateur,
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
        is_presenter = v_presentateur,
        last_token_at    = case when p_has_token is true  then now() else l.last_token_at    end,
        last_no_token_at = case when p_has_token is false then now() else l.last_no_token_at end;

  return query select true, not coalesce(v_exists, false), false, false, false, false, v_page;
end;
$$;
revoke all on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer, boolean, boolean, text) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer, boolean, boolean, text) from %I', r);
    end if;
  end loop;
end
$$;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer, boolean, boolean, text) to service_role;
  end if;
end
$$;
