-- LES MESURES D'UNE LECTURE INTERNE SONT BORNÉES PAR LA BASE, COMME CELLES D'UN VISITEUR.
--
-- ⚠️ LA 0020 A BORNÉ DEUX TABLES SUR TROIS, ET PERSONNE NE L'AVAIT REMARQUÉ.
-- `commercial_doc_views` et `commercial_doc_sessions` ont reçu leurs contraintes le 25/08 — après
-- qu'un visiteur muni d'un lien valide eut posté `page: 2147483647` et fait boucler le funnel sur
-- quatre minutes de CPU. `commercial_doc_internal_sessions` porte EXACTEMENT les mêmes colonnes
-- (`num_pages`, `max_page`, `total_seconds`), écrites par le même code borné, et n'a rien reçu.
--
-- ⚠️ LE CODE BORNE DÉJÀ, ET CE N'EST PAS UNE RAISON DE S'EN PASSER — même argument que la 0020, et
-- il vaut d'autant plus ici que le chemin d'écriture vient d'être RÉUNI avec celui des sessions
-- publiques : `upsertInternalSession` redéfinissait ses propres bornes, identiques caractère pour
-- caractère à `bornerNombre`. Le comportement n'a pas changé, mais deux exemplaires d'un même fait
-- divergent tant que personne ne les confronte. La contrainte, elle, ne dépend d'aucune des deux :
-- elle protège la table de TOUT écrivain — une reprise, un script d'exploitation, un hôte qui écrit
-- lui-même dans sa propre base.
--
-- ⚠️ EN TROIS TEMPS, ET L'ORDRE COMPTE — repris de la 0020. `NOT VALID` d'abord : la contrainte
-- s'applique aux écritures NOUVELLES sans exiger un scan de toute la table ni échouer sur
-- l'historique. On rabat ensuite les lignes hors plage, puis on valide. Poser la contrainte validée
-- d'emblée sur une base déjà empoisonnée échouerait — et une migration qui échoue sur la donnée
-- qu'elle vient réparer est une migration qu'un exploitant n'ose plus lancer.
--
-- ⚠️ IDEMPOTENTE. `add constraint … if not exists` n'existe pas en PostgreSQL : le test d'existence
-- est explicite ; `validate constraint` sur une contrainte déjà valide est un no-op ; les `update`
-- ne touchent plus aucune ligne au second passage.
--
-- ⚠️ Sans lui : rien ne casse. Le code de la 0.1.140 borne ce qu'il écrit dans cette table comme
-- dans les deux autres, donc une base sans cette migration sert des mesures internes exactes et ne
-- peut pas être empoisonnée PAR LE PLAYER. Ce qu'on perd est la dernière ligne : la table continue
-- d'accepter n'importe quelle valeur de n'importe quel autre écrivain, et les lignes hors plage
-- déjà posées y restent. Un hôte qui ne l'applique pas garde une instance saine et une table qui
-- ne l'est pas — exactement la situation que la 0020 a corrigée pour les deux autres tables.

-- Les bornes reprennent celles du code — `BORNES` dans `server/shares.js` : 10 000 pages,
-- 86 400 secondes. Elles ne prétendent pas rendre la mesure exacte, seulement l'empêcher d'être
-- ABSURDE : personne ne lit une page dix-mille-et-unième, personne ne lit plus de vingt-quatre
-- heures d'affilée.

-- ── 1. Contraintes posées sans scan ────────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'ck_internes_num_pages_borne') then
    alter table public.commercial_doc_internal_sessions
      add constraint ck_internes_num_pages_borne
      check (num_pages is null or (num_pages >= 0 and num_pages <= 10000)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_internes_max_page_borne') then
    alter table public.commercial_doc_internal_sessions
      add constraint ck_internes_max_page_borne
      check (max_page is null or (max_page >= 0 and max_page <= 10000)) not valid;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'ck_internes_total_seconds_borne') then
    alter table public.commercial_doc_internal_sessions
      add constraint ck_internes_total_seconds_borne
      check (total_seconds is null or (total_seconds >= 0 and total_seconds <= 86400)) not valid;
  end if;
end $$;

-- ── 2. L'historique ramené dans la plage ───────────────────────────────────────────────────────
-- `least`/`greatest` plutôt qu'une suppression : la ligne dit qu'une lecture a eu lieu, et ça reste
-- vrai. C'est son AMPLEUR qui était fausse. Effacer la mesure effacerait aussi l'événement.
update public.commercial_doc_internal_sessions
   set num_pages = least(greatest(num_pages, 0), 10000)
 where num_pages is not null and (num_pages < 0 or num_pages > 10000);
update public.commercial_doc_internal_sessions
   set max_page = least(greatest(max_page, 0), 10000)
 where max_page is not null and (max_page < 0 or max_page > 10000);
update public.commercial_doc_internal_sessions
   set total_seconds = least(greatest(total_seconds, 0), 86400)
 where total_seconds is not null and (total_seconds < 0 or total_seconds > 86400);

-- ── 3. Validation, maintenant que la table est propre ──────────────────────────────────────────
alter table public.commercial_doc_internal_sessions validate constraint ck_internes_num_pages_borne;
alter table public.commercial_doc_internal_sessions validate constraint ck_internes_max_page_borne;
alter table public.commercial_doc_internal_sessions validate constraint ck_internes_total_seconds_borne;
