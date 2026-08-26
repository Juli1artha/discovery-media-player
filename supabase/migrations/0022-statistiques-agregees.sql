-- LES STATISTIQUES CHARGEAIENT VINGT-QUATRE MOIS D'ÉVÉNEMENTS EN MÉMOIRE POUR EN RENDRE DIX LIGNES.
--
-- ⚠️ LA FENÊTRE BORNE LE TEMPS, PAS LE NOMBRE DE LIGNES. `listSharesForDoc` et `overview` lisent
-- `commercial_doc_views` par `selectAll` — qui pagine, donc ne tronque pas — sur une fenêtre de
-- vingt-quatre mois. L'index sert le filtre, et c'est tout ce qu'il fait : il ne supprime ni le
-- transfert PostgREST → Node, ni la pagination complète, ni la mémoire des tableaux, ni le coût des
-- agrégations en JavaScript. Sur un document très actif, vingt-quatre mois peuvent représenter des
-- millions d'événements pour une réponse qui tient en quelques dizaines de lignes.
--
-- ⚠️ AUJOURD'HUI ÇA NE FAIT MAL À PERSONNE, ET C'EST ÉCRIT ICI POUR QUE ÇA RESTE VRAI. Le pire
-- document mesuré porte 662 lignes (cf. le commentaire d'`overview` dans server/shares.js). Ce
-- n'est donc pas un correctif d'incident : c'est le moment où la structure change AVANT que le
-- volume ne l'impose, pendant qu'on peut encore comparer les deux chemins ligne à ligne.
--
-- ⚠️ ET LE JAVASCRIPT RESTE — délibérément. Ces fonctions peuvent manquer : un hôte n'applique pas
-- forcément la dernière migration, et le player doit continuer de servir ses statistiques. Le
-- chemin en mémoire devient donc le REPLI, sur `PGRST202` uniquement (« aucune fonction de ce
-- nom »), jamais sur un hoquet réseau — même règle étroite que `signatureAbsente`. Le banc de base
-- confronte les deux chemins sur les mêmes lignes et exige un résultat IDENTIQUE : deux textes
-- écrits séparément qui ne peuvent pas être faux de la même manière, comme la purge et son
-- recensement.
--
-- ⚠️ LE BORNAGE DE LECTURE EST REPRODUIT ICI, ET CE N'EST PAS UN DOUBLON DÉCORATIF.
-- `pageLue(page, max_page)` du JS vaut `min(max(0, page, max_page), 10000)` : il reborne à la
-- LECTURE parce que les lignes posées avant la migration 0020 peuvent porter n'importe quelle
-- valeur, et c'est cette moitié-là qui déclenchait le DoS analytique. Une agrégation SQL qui
-- supposerait la base saine rendrait d'autres chiffres que le JavaScript sur exactement les bases
-- qui en ont le plus besoin.
--
-- ⚠️ Sans lui : rien ne casse et les chiffres sont les mêmes. Le player détecte l'absence des
-- fonctions et agrège en mémoire, exactement comme avant — ce qu'on perd est le bénéfice, pas la
-- réponse. Un hôte qui ne l'applique pas garde des statistiques justes et une lecture qui grandit
-- avec son historique.
--
-- ⚠️ IDEMPOTENTE : `create or replace` et des `do $$` qui testent l'existence des rôles.

-- ── Le même bornage que `pageLue`, écrit une fois ──────────────────────────────────────────────
create or replace function public.player_page_lue(p_page integer, p_max_page integer)
returns integer
language sql
immutable
set search_path = public
as $$
  select least(greatest(0, coalesce(p_page, 0), coalesce(p_max_page, 0)), 10000);
$$;

-- ── Vue d'ensemble : les liens tracés, agrégés par document ────────────────────────────────────
create or replace function public.player_stats_overview(p_depuis timestamptz)
returns table (doc_id text, opens bigint, readers bigint, max_page integer, last_at timestamptz)
language sql
stable
set search_path = public
as $$
  select v.doc_id,
         count(*) filter (where v.event = 'open')                                    as opens,
         count(distinct v.session_id) filter (where coalesce(v.session_id, '') <> '') as readers,
         coalesce(max(public.player_page_lue(v.page, v.max_page)), 0)                as max_page,
         max(v.at)                                                                   as last_at
    from public.commercial_doc_views v
   where v.at >= p_depuis
     and coalesce(v.doc_id, '') <> ''
   group by v.doc_id;
$$;

-- ── Vue d'ensemble : les consultations internes, jamais mélangées aux ouvertures client ────────
create or replace function public.player_stats_overview_internes(p_depuis timestamptz)
returns table (doc_id text, opens bigint, readers bigint, last_at timestamptz)
language sql
stable
set search_path = public
as $$
  select s.doc_id,
         count(*)                                                                            as opens,
         count(distinct lower(s.user_email)) filter (where coalesce(s.user_email, '') <> '') as readers,
         max(s.last_at)                                                                      as last_at
    from public.commercial_doc_internal_sessions s
   where s.last_at >= p_depuis
     and coalesce(s.doc_id, '') <> ''
   group by s.doc_id;
$$;

-- ── Un document : ses liens, agrégés par slug ─────────────────────────────────────────────────
create or replace function public.player_stats_doc(p_doc_id text, p_depuis timestamptz)
returns table (slug text, opens bigint, sessions bigint, max_page integer, seconds integer, last_at timestamptz)
language sql
stable
set search_path = public
as $$
  select v.slug,
         count(*) filter (where v.event = 'open')                                     as opens,
         count(distinct v.session_id) filter (where coalesce(v.session_id, '') <> '') as sessions,
         coalesce(max(public.player_page_lue(v.page, v.max_page)), 0)                 as max_page,
         -- ⚠️ `seconds` N'EST PAS BORNÉ EN HAUT À LA LECTURE, et le JS ne le borne pas non plus :
         -- reproduire fidèlement veut dire reproduire AUSSI ce qui n'est pas fait. Le plancher à
         -- zéro, lui, vient du `Math.max(0, …)` de l'accumulateur.
         greatest(0, coalesce(max(coalesce(v.seconds, 0)), 0))                        as seconds,
         max(v.at)                                                                    as last_at
    from public.commercial_doc_views v
   where v.doc_id = p_doc_id
     and v.at >= p_depuis
   group by v.slug;
$$;

-- ── L'entonnoir : page maximale PAR SESSION, rendue en histogramme ────────────────────────────
-- ⚠️ UN HISTOGRAMME, PAS UN CUMUL. Le cumul descendant (« combien ont atteint AU MOINS la page p »)
-- reste en JavaScript : c'est une passe sur le nombre de PAGES, pas sur le nombre de lignes, et la
-- garder d'un seul côté évite d'avoir la même définition d'entonnoir écrite à deux endroits. Ce que
-- cette fonction supprime, c'est le transfert d'une ligne par événement — pas le calcul.
create or replace function public.player_stats_doc_funnel(p_doc_id text, p_depuis timestamptz)
returns table (page integer, sessions bigint)
language sql
stable
set search_path = public
as $$
  with par_session as (
    -- La clé de session du JS est `session_id || slug` : une session absente retombe sur le lien.
    select coalesce(nullif(v.session_id, ''), v.slug)               as cle,
           max(public.player_page_lue(v.page, v.max_page))          as page_max
      from public.commercial_doc_views v
     where v.doc_id = p_doc_id
       and v.at >= p_depuis
     group by coalesce(nullif(v.session_id, ''), v.slug)
  )
  select page_max as page, count(*) as sessions
    from par_session
   where page_max > 0
   group by page_max;
$$;

-- ── Les droits : refusés à tous, accordés au seul rôle de service ─────────────────────────────
-- Même posture que `player_attendance_bump` : ces fonctions lisent des tables sous RLS, et rien ne
-- justifie qu'un rôle public puisse seulement les appeler.
do $$
declare
  f text;
  r text;
begin
  foreach f in array array[
    'public.player_page_lue(integer, integer)',
    'public.player_stats_overview(timestamptz)',
    'public.player_stats_overview_internes(timestamptz)',
    'public.player_stats_doc(text, timestamptz)',
    'public.player_stats_doc_funnel(text, timestamptz)'
  ] loop
    execute format('revoke all on function %s from public', f);
    foreach r in array array['anon', 'authenticated'] loop
      if exists (select 1 from pg_roles where rolname = r) then
        execute format('revoke all on function %s from %I', f, r);
      end if;
    end loop;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', f);
    end if;
  end loop;
end
$$;
