-- L'ADRESSE IP D'UN LECTEUR EST EFFACÉE — ARBITRAGE DE L'ADV, RENDU LE 01/09/2026.
--
-- La 0.1.146 a cessé de la SERVIR : ni `docshare.sessions` ni `docshare.sessionsByRecipient` ne la
-- rendent, et ce qui sort d'une session est depuis une liste de ce qui est PERMIS. Restait la
-- moitié qui ne se règle pas dans le code : treize mois de journal la portaient encore en clair.
-- Ne plus servir une donnée et ne plus la garder sont deux décisions ; voici la seconde.
--
-- ⚠️ SANS LUI : rien ne casse, et c'est bien le problème. Les adresses déjà écrites restent en
-- base, en clair. Aucun chemin du lecteur ne les relit depuis la 0.1.146 et plus rien ne les écrit
-- depuis la 0.1.147 — un hôte non migré cesse donc d'en accumuler dès qu'il déploie le code, mais
-- il CONSERVE tout l'historique. La dégradation n'est pas une panne : c'est une rétention qui
-- continue en silence, jusqu'à la purge des treize mois, ligne par ligne.
--
-- ⚠️ POURQUOI CE FICHIER NE SUPPRIME PAS LA COLONNE, alors que la demande le préférait. La règle
-- de ce dossier — `docs/MIGRATIONS.md`, éprouvée par un banc — est qu'une migration doit être sûre
-- à appliquer PENDANT QUE LA VERSION PRÉCÉDENTE DU CODE TOURNE. La 0.1.146 écrit encore `ip`, et
-- PostgREST rejette une écriture portant une colonne inconnue : supprimer la colonne aujourd'hui
-- ferait échouer TOUTES les écritures de session d'un hôte qui applique les migrations avant de
-- déployer — pas seulement celles qui touchent l'adresse. Et le message parlerait d'une colonne,
-- pas d'une version : il n'aurait aucun moyen de le deviner. La suppression est donc le geste
-- d'une livraison ULTÉRIEURE, quand plus aucune version supportée ne l'écrit.
--
-- ⚠️ ET CE REPORT NE COÛTE RIEN À L'EFFACEMENT — c'est la mesure qui le dit, pas une commodité.
-- Mesuré le 01/09 sur PostgreSQL 16.13 avec `pageinspect`, sur des lignes portant une adresse :
--
--     après ALTER TABLE … DROP COLUMN           toutes encore dans les pages
--     après VACUUM ordinaire                    toutes encore là — les lignes sont VIVANTES
--     après VACUUM FULL                          aucune — mais il RÉÉCRIT la table, sous verrou
--
--     après UPDATE … SET ip = NULL              anciennes versions de ligne, désormais MORTES
--     après VACUUM ordinaire                     aucune — celui qui passe TOUT SEUL, sans verrou
--
-- Autrement dit : `DROP COLUMN` n'efface RIEN. Il marque l'attribut supprimé et laisse les octets
-- dans les pages jusqu'à une réécriture complète de la table — indéfiniment chez un hôte qui ne
-- fait rien de particulier, et invisibles à toute requête, donc plus jamais vérifiés par personne.
-- C'est l'UPDATE qui efface : il écrit de nouvelles versions de ligne sans l'adresse et rend les
-- anciennes mortes, que l'autovacuum de routine récupère de lui-même. Ce fichier fait donc
-- AUJOURD'HUI tout ce qui relève de l'effacement ; ce qui est reporté est la forme du schéma, pas
-- la donnée.
--
-- ⚠️ CE QU'IL NE PEUT PAS ATTEINDRE, ET QUI DOIT ÊTRE DIT PLUTÔT QUE SIMULÉ. Les WAL déjà écrits,
-- les sauvegardes, les exports et les dumps portent encore les adresses ; ils suivent la politique
-- de rétention de l'hôte, pas ce fichier. `docs/RETENTION.md` posait déjà la règle générale — une
-- colonne de données personnelles qu'on retire est elle-même un acte de rétention, et les copies
-- antérieures suivent la politique de sauvegarde de l'hôte. Ce fichier en est le premier cas
-- concret. Un hôte qui doit attester une purge COMPLÈTE fait expirer ou réécrit ses sauvegardes.
--
-- ⚠️ CE QUI RESTE, ET POURQUOI. `ua` reste : elle n'était pas demandée, et elle est la SOURCE de
-- `device`, `os` et `browser` — la seule à permettre de les recalculer sur les lignes déjà écrites
-- si l'analyse s'améliore. Elle n'est plus servie depuis la 0.1.146. La supprimer se défend et se
-- décidera séparément : une destruction irréversible se demande, elle ne se déduit pas.
-- `player_rate_limits.key` peut porter une adresse en clair : elle expire d'elle-même.
-- `doc_presentation_attendees.creator_ip_hash` est un HMAC salé, pas une adresse — l'asymétrie que
-- `docs/RETENTION.md` signalait entre les deux tables cesse ici, par le haut.
--
-- ⚠️ LE SIGNE QU'UN HÔTE PEUT SONDER est le COMMENTAIRE de la colonne, `col_description()`. Une
-- migration qui n'efface que des données ne laisse aucune trace dans `information_schema` : elle
-- serait inattestable, et une purge est justement la migration qu'un DPO demandera de prouver.
--
-- ⚠️ ADDITIVE au sens de `docs/MIGRATIONS.md` : aucune colonne, table ou contrainte n'est retirée,
-- rien n'est renommé, rien ne devient obligatoire. Sûre pendant que la 0.1.146 tourne — elle
-- continue d'écrire dans une colonne qui existe toujours.
--
-- ⚠️ IDEMPOTENTE : rejouable sans effet ; le second passage ne trouve plus rien à vider.

update public.commercial_doc_sessions
   set ip = null
 where ip is not null;

comment on column public.commercial_doc_sessions.ip is
  'VIDE ET PLUS JAMAIS ECRITE depuis la 0026. A porte l''adresse IP du lecteur en clair. '
  'Conservee le temps qu''aucune version supportee du lecteur ne l''ecrive : la supprimer '
  'aujourd''hui casserait les ecritures d''un hote pas encore deploye. Voir docs/RETENTION.md.';
