-- LE USER-AGENT BRUT EST EFFACÉ, SUR LES DEUX TABLES — DEMANDE EXPLICITE DE L'ADV, 01/09/2026.
--
-- La 0.1.146 avait cessé de le SERVIR. La 0026 a effacé l'adresse IP par la même mécanique et l'a
-- laissé de côté : il n'était pas demandé, et nous avions plaidé pour le garder — seule source d'où
-- `device`, `os` et `browser` pourraient être recalculés sur les lignes déjà écrites. L'ADV a
-- tranché, et l'argument qui emporte est le nôtre retourné contre nous : les trois champs dérivés
-- sont extraits À L'ÉCRITURE et servis, la chaîne brute n'a plus de lecteur, et « pouvoir
-- recalculer un jour » ne justifie pas treize mois d'empreinte conservée pour personne. Une donnée
-- sans lecteur n'a pas de raison d'exister.
--
-- ⚠️ SANS LUI : rien ne casse, et c'est le même piège que pour l'adresse. Les chaînes déjà écrites
-- restent en base. Aucune requête de ce dépôt ne les relit — vérifié en énumérant les six requêtes
-- qui touchent ces deux tables : `ua` n'apparaît dans aucun `select=`. La 0.1.147 cesse en plus de
-- les ÉCRIRE. La dégradation n'est donc pas une panne : c'est une rétention qui continue en
-- silence jusqu'à la purge des treize mois, ligne par ligne.
--
-- ⚠️ LE CAS DE `commercial_doc_views` EST PLUS NET ENCORE. Cette table n'a ni `device`, ni `os`, ni
-- `browser` : elle ne dérivait RIEN de cette chaîne. Elle l'écrivait, et personne ne l'a jamais
-- relue. Là où les sessions gardaient au moins une justification discutable, les consultations n'en
-- avaient aucune — et personne ne l'avait remarqué, parce que la question n'avait jamais été posée
-- table par table.
--
-- ⚠️ MÊME FORME QUE LA 0026, POUR LA MÊME RAISON MESURÉE. On VIDE, on ne supprime pas la colonne.
-- `DROP COLUMN` marque l'attribut supprimé sans réécrire une seule ligne : les octets restent dans
-- les pages jusqu'à une réécriture complète de la table, qu'un hôte ne déclenche pas de lui-même —
-- indéfiniment, et désormais invisibles à toute requête, donc plus jamais vérifiés par personne.
-- C'est l'UPDATE qui efface : il écrit de nouvelles versions de ligne sans la chaîne et rend les
-- anciennes mortes, que l'autovacuum de routine récupère seul, sans verrou. La mesure complète est
-- dans la 0026 et dans `docs/RETENTION.md`.
--
-- ⚠️ ET LA SUPPRESSION DES COLONNES RESTE DIFFÉRÉE, pour la raison qui vaut déjà pour `ip` :
-- `docs/MIGRATIONS.md` exige qu'une migration soit sûre à appliquer PENDANT QUE LA VERSION
-- PRÉCÉDENTE DU CODE TOURNE. La 0.1.146 écrit encore ces colonnes, et PostgREST rejette une
-- écriture portant une colonne inconnue : les supprimer aujourd'hui ferait échouer TOUTES les
-- écritures de consultation et de session d'un hôte qui migre avant de déployer. Les trois
-- colonnes — `commercial_doc_sessions.ip`, `commercial_doc_sessions.ua`,
-- `commercial_doc_views.ua` — partiront ensemble, dans une livraison ultérieure, quand plus aucune
-- version supportée ne les écrira. L'effacement, lui, est complet aujourd'hui.
--
-- ⚠️ CE QU'IL NE PEUT PAS ATTEINDRE : les WAL déjà écrits, les sauvegardes, les exports et les
-- dumps. Ils suivent la politique de l'hébergeur, pas ce fichier. `docs/RETENTION.md` le dit, avec
-- ce que la rétention de ce lecteur fait expirer et ce qu'elle ne touche pas.
--
-- ⚠️ LE SIGNE SONDABLE est le COMMENTAIRE des colonnes, `col_description()` — une migration qui
-- n'efface que des données ne laisse aucune trace dans `information_schema`, et c'est justement la
-- migration qu'un hôte devra prouver.
--
-- ⚠️ ADDITIVE : aucune colonne, table ou contrainte retirée, rien renommé, rien rendu obligatoire.
-- ⚠️ IDEMPOTENTE : rejouable sans effet ; le second passage ne trouve plus rien à vider.

update public.commercial_doc_sessions
   set ua = null
 where ua is not null;

update public.commercial_doc_views
   set ua = null
 where ua is not null;

comment on column public.commercial_doc_sessions.ua is
  'VIDE ET PLUS JAMAIS ECRITE depuis la 0027. A porte le User-Agent brut du lecteur. Les champs '
  'device, os et browser en sont derives A L''ECRITURE et sont, eux, servis. Conservee le temps '
  'qu''aucune version supportee du lecteur ne l''ecrive. Voir docs/RETENTION.md.';

comment on column public.commercial_doc_views.ua is
  'VIDE ET PLUS JAMAIS ECRITE depuis la 0027. A porte le User-Agent brut du lecteur. Cette table '
  'n''en derivait rien et aucune requete ne l''a jamais relue. Conservee le temps qu''aucune '
  'version supportee du lecteur ne l''ecrive. Voir docs/RETENTION.md.';
