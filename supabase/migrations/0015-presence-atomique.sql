-- LA PRÉSENCE EN UN SEUL GESTE, ET UN PLAFOND DE CRÉATION QUI TIENT SOUS LA CONCURRENCE.
--
-- Deux choses, une fonction (P1c audit CODEX 5.6).
--
-- 1. UPSERT ATOMIQUE. `recordAttendance` faisait lire-modifier-réécrire avec un verrou optimiste sur
--    `last_seen` et quatre tours de reprise. Correct, mais jusqu'à quatre allers-retours par
--    battement. Un `insert … on conflict do update` fait le même travail en UN geste : cumul du temps
--    plafonné au trou (ATTEND_MAX_GAP), union de la page vue, `last_seen` strictement croissant (la
--    même défense que la boucle JS, portée en SQL), rafraîchissement des drapeaux à chaque battement.
--
-- 2. PLAFOND DE CRÉATION ANONYME, ATOMIQUE. La clé `anon-*` est choisie par le navigateur : un même
--    visiteur peut fabriquer des milliers de clés distinctes et gonfler la liste des participants.
--    On borne le nombre de NOUVELLES lignes anonymes par (présentation, IP fiable) — jamais les
--    battements d'une clé DÉJÀ enregistrée, qui doivent toujours pouvoir s'actualiser. Les membres
--    authentifiés et le présentateur ne consomment pas ce quota. Le contrôle et l'insertion sont
--    sérialisés par un verrou d'avis par (slug, ip) : deux créations concurrentes ne peuvent pas
--    franchir le plafond ensemble.
--
-- ⚠️ POURQUOI UNE FONCTION SQL, alors que le reste du player tient en PostgREST simple : ni l'upsert
--    conditionnel (`count = count + 1` nomme la colonne des deux côtés) ni le « compter-puis-insérer
--    atomique » ne sont exprimables en REST. C'est le même motif que `player_rate_limit_bump` (0004),
--    et la garde de portabilité reste vraie : un `rpc/` n'ajoute ni jointure ni arbre booléen au REST.
--
-- ⚠️ Sans lui : le player retombe sur la boucle lire-modifier-réécrire (toujours correcte, sans le
--    plafond de création) et le dit une fois en nommant ce fichier. Rien ne casse, rien ne se ferme.
--    Applicable pendant que la version précédente tourne : tant que le code ne l'appelle pas, elle ne
--    fait rien ; dès qu'il l'appelle, elle compte juste.
--
-- ⚠️ L'IP N'EST JAMAIS STOCKÉE EN CLAIR. La colonne porte un HASH tronqué (le player le calcule), qui
--    suffit à compter la pression d'un même appelant sans conserver de donnée personnelle.

alter table public.doc_presentation_attendees
  add column if not exists creator_ip_hash text;

-- Compter les créations anonymes par (slug, ip) reste rapide même sur une grande table.
create index if not exists idx_attendees_slug_creator
  on public.doc_presentation_attendees (slug, creator_ip_hash)
  where is_member = false and is_presenter = false;

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
  p_anon_cap     integer
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
  -- Chemin rapide : la ligne existe déjà → c'est une ACTUALISATION, jamais soumise au plafond.
  select true into v_exists
    from public.doc_presentation_attendees
    where slug = p_slug and attendee_key = p_key;

  -- Création d'une ligne ANONYME : on sérialise par (slug, ip) et on compte sous le verrou, pour que
  -- deux créations concurrentes ne franchissent pas le plafond ensemble. Membres et présentateur en
  -- sont exemptés (leur identité est prouvée, ils ne gonflent pas de faux participants).
  if not coalesce(v_exists, false) and not p_is_member and not p_is_presenter then
    perform pg_advisory_xact_lock(hashtextextended(p_slug || '|' || coalesce(p_ip_hash, ''), 0));
    -- Re-lire sous le verrou : la ligne a pu naître entre la première lecture et ici (même clé,
    -- deux onglets). Si elle existe désormais, ce n'est plus une création → pas de plafond.
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
        return query select false, false, true;   -- plafond atteint : on ne crée pas
        return;
      end if;
    end if;
  end if;

  -- L'écriture, en UN geste, pour la création comme pour l'actualisation. `last_seen` strictement
  -- croissant ; le temps ajouté est le trou depuis le dernier battement, ignoré au-delà de MAX_GAP
  -- (un onglet resté ouvert ne gonfle pas la présence) ; la page vue rejoint l'ensemble sans doublon.
  insert into public.doc_presentation_attendees as l
    (slug, attendee_key, name, email, avatar, is_member, is_presenter,
     first_seen, last_seen, total_ms, pages, creator_ip_hash)
  values
    (p_slug, p_key, nullif(p_name, ''), null, nullif(p_avatar, ''), p_is_member, p_is_presenter,
     now(), now(), 0, jsonb_build_array(v_page), p_ip_hash)
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
        is_presenter = p_is_presenter;

  return query select true, not coalesce(v_exists, false), false;
end;
$$;

-- Même posture d'accès que player_rate_limit_bump : le player parle avec la clé de service ; personne
-- d'autre n'a à appeler ceci. `anon`/`authenticated` sont des rôles Supabase, pas Postgres — on ne les
-- révoque que s'ils existent, pour que le fichier passe aussi sur un Postgres nu (public auto-hébergé).
revoke all on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer) from %I', r);
    end if;
  end loop;
end
$$;

-- Sur un Postgres nu, `revoke … from public` emporterait aussi le compte de service : on accorde donc
-- explicitement, et seulement si le rôle existe (sinon l'exploitant accorde à son propre rôle).
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer) to service_role;
  end if;
end
$$;
