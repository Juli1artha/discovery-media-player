-- LES MESURES D'UN VISITEUR SONT BORNÉES PAR LA BASE, PAS SEULEMENT PAR LE CODE QUI ÉCRIT.
--
-- ⚠️ CE QUI ÉTAIT OUVERT (audit CODEX 5.6, 25/08 — P1, reproduit avant d'être corrigé). Un visiteur
-- muni d'un lien valide postait `{"event":"page","page":2147483647,"maxPage":2147483647}`. Le
-- chemin public ne vérifiait que la finitude du nombre, `integer` acceptait la valeur, et le funnel
-- de la vue d'ensemble bouclait ensuite de 1 à 2 147 483 647 — environ quatre minutes de CPU et 17
-- à 40 Go, extrapolés linéairement sur cinq échelles mesurées. UNE ligne suffisait, et elle restait.
--
-- ⚠️ LE CODE EST DÉJÀ CORRIGÉ, ET CE N'EST PAS UNE RAISON DE S'EN PASSER. La borne applicative
-- protège ce que CE code écrit ; la contrainte protège la table de tout le reste — une reprise, un
-- script d'exploitation, une future route, un hôte qui écrit lui-même dans sa propre base. Les deux
-- bornes disent le même nombre à deux endroits : c'est un doublon assumé, parce que le second n'est
-- pas une copie du premier mais sa dernière ligne de défense.
--
-- ⚠️ EN QUATRE TEMPS, ET L'ORDRE COMPTE. `NOT VALID` d'abord : la contrainte s'applique aux
-- écritures NOUVELLES sans exiger un scan de toute la table ni échouer sur l'historique. On corrige
-- ensuite les lignes hors plage, puis on valide. Poser la contrainte validée d'emblée sur une base
-- déjà empoisonnée échouerait — et une migration qui échoue sur la donnée qu'elle vient réparer est
-- une migration qu'un exploitant n'ose plus lancer.
--
-- ⚠️ IDEMPOTENTE. Rejouée, elle ne change rien : `add constraint ... if not exists` n'existe pas en
-- PostgreSQL, donc le test d'existence est explicite ; `validate constraint` sur une contrainte déjà
-- valide est un no-op ; les `update` ne touchent plus aucune ligne au second passage.
--
-- ⚠️ Sans lui : rien ne casse, et c'est justement ce qu'il faut dire précisément. Le code de la
-- 0.1.138 borne déjà ce qu'il écrit et reborne ce qu'il lit — une base sans cette migration sert
-- donc des statistiques exactes et ne peut plus être empoisonnée PAR LE PLAYER. Ce qu'on perd est
-- la dernière ligne : la table continue d'accepter n'importe quelle valeur de n'importe quel autre
-- écrivain — une reprise, un script d'exploitation, un hôte qui écrit dans sa propre base — et les
-- lignes hors plage déjà posées y restent, corrigées à la lecture plutôt que dans la donnée. Un
-- hôte qui n'applique pas cette migration garde une instance saine et une table qui ne l'est pas.

-- Les bornes reprennent celles du code — `BORNES` dans `server/shares.js` : 10 000 pages,
-- 86 400 secondes. Elles ne prétendent pas rendre la mesure exacte, seulement l'empêcher d'être
-- ABSURDE : personne ne lit une page dix-mille-et-unième, personne ne lit plus de vingt-quatre
-- heures d'affilée.

-- ── 1. Contraintes posées sans scan ────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_views_page_borne') then
    alter table public.commercial_doc_views
      add constraint ck_views_page_borne
      check (page is null or (page >= 0 and page <= 10000)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_views_max_page_borne') then
    alter table public.commercial_doc_views
      add constraint ck_views_max_page_borne
      check (max_page is null or (max_page >= 0 and max_page <= 10000)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_views_seconds_borne') then
    alter table public.commercial_doc_views
      add constraint ck_views_seconds_borne
      check (seconds is null or (seconds >= 0 and seconds <= 86400)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_sessions_max_page_borne') then
    alter table public.commercial_doc_sessions
      add constraint ck_sessions_max_page_borne
      check (max_page is null or (max_page >= 0 and max_page <= 10000)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_sessions_num_pages_borne') then
    alter table public.commercial_doc_sessions
      add constraint ck_sessions_num_pages_borne
      check (num_pages is null or (num_pages >= 0 and num_pages <= 10000)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_sessions_total_seconds_borne') then
    alter table public.commercial_doc_sessions
      add constraint ck_sessions_total_seconds_borne
      check (total_seconds is null or (total_seconds >= 0 and total_seconds <= 86400)) not valid;
  end if;
end $$;

-- ── 2. L'historique ramené dans la plage ───────────────────────────────────────────────────────
-- `least`/`greatest` plutôt qu'une suppression : la ligne dit qu'une lecture a eu lieu, et ça reste
-- vrai. C'est son AMPLEUR qui était fausse. Effacer la mesure effacerait aussi l'événement.
update public.commercial_doc_views
   set page = least(greatest(page, 0), 10000)
 where page is not null and (page < 0 or page > 10000);
update public.commercial_doc_views
   set max_page = least(greatest(max_page, 0), 10000)
 where max_page is not null and (max_page < 0 or max_page > 10000);
update public.commercial_doc_views
   set seconds = least(greatest(seconds, 0), 86400)
 where seconds is not null and (seconds < 0 or seconds > 86400);
update public.commercial_doc_sessions
   set max_page = least(greatest(max_page, 0), 10000)
 where max_page is not null and (max_page < 0 or max_page > 10000);
update public.commercial_doc_sessions
   set num_pages = least(greatest(num_pages, 0), 10000)
 where num_pages is not null and (num_pages < 0 or num_pages > 10000);
update public.commercial_doc_sessions
   set total_seconds = least(greatest(total_seconds, 0), 86400)
 where total_seconds is not null and (total_seconds < 0 or total_seconds > 86400);

-- ── 3. Validation, maintenant que la table est propre ──────────────────────────────────────────
alter table public.commercial_doc_views       validate constraint ck_views_page_borne;
alter table public.commercial_doc_views       validate constraint ck_views_max_page_borne;
alter table public.commercial_doc_views       validate constraint ck_views_seconds_borne;
alter table public.commercial_doc_sessions    validate constraint ck_sessions_max_page_borne;
alter table public.commercial_doc_sessions    validate constraint ck_sessions_num_pages_borne;
alter table public.commercial_doc_sessions    validate constraint ck_sessions_total_seconds_borne;
