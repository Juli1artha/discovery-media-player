-- LIRE LES SESSIONS D'UNE PERSONNE, TOUS DOCUMENTS CONFONDUS, SANS BALAYER LA TABLE.
--
-- ⚠️ CE QUI MANQUAIT. Les trois index de `commercial_doc_sessions` répondent à trois questions :
-- « les sessions de ce lien » (`cds_sess_slug_idx`), « les sessions de ce document, les plus
-- récentes d'abord » (`cds_sess_doc_idx`), et « les sessions récentes, tous documents confondus »
-- (`idx_cds_last_at`, posé par la 0014 pour la rétention). Aucun ne répond à « toutes les lectures
-- de cette personne » — la question que pose la fiche par destinataire.
--
-- Sans lui, `recipient_email=eq.…&order=last_at.desc` est un balayage complet suivi d'un tri : le
-- coût croît avec le JOURNAL, pas avec ce qu'on rend. C'est la forme de requête qui va bien tant
-- que la table est jeune et qui devient le point de rupture le jour où elle ne l'est plus — et ce
-- jour-là, elle ne casse pas, elle ralentit tout le reste avec elle.
--
-- ⚠️ POURQUOI `(recipient_email, last_at desc)` ET PAS DEUX INDEX SÉPARÉS. La question est toujours
-- posée dans cet ordre : une personne, puis ses lectures de la plus récente à la plus ancienne, par
-- pages. Un index composite sert le filtre ET le tri ET la pagination par curseur en une seule
-- descente ; deux index simples obligeraient le planificateur à choisir, et à trier après coup ce
-- qu'il aurait filtré. `desc` est écrit parce que la lecture est toujours descendante : c'est
-- l'ordre de la fiche, pas une préférence.
--
-- ⚠️ ON N'INDEXE PAS LES LIGNES SANS DESTINATAIRE. Un lien anonyme laisse `recipient_email` nul, et
-- ces lignes ne peuvent JAMAIS répondre à « les lectures de telle personne » — les porter dans
-- l'index le grossirait sans qu'aucune requête ne les y cherche. L'index partiel dit cette règle
-- plutôt que de la laisser deviner.
--
-- ⚠️ SANS LUI : RIEN NE CASSE. `docshare.sessionsByRecipient` répond de la même façon chez un hôte
-- non migré — plus lentement, et d'autant plus lentement que son journal est vieux. Aucune colonne
-- n'est ajoutée, aucune donnée n'est réécrite : c'est une aide au planificateur, pas un contrat.
--
-- ⚠️ `CONCURRENTLY` N'EST PAS EMPLOYÉ ICI, ET C'EST DÉLIBÉRÉ. Il ne peut pas tourner dans une
-- transaction, or ce dossier est joué comme un script transactionnel par les hôtes qui l'appliquent
-- d'un bloc. Sur une table de journal, la pose verrouille les écritures le temps de la
-- construction : quelques secondes sur des volumes ordinaires, et les sessions perdues pendant ce
-- temps sont des upserts qui repasseront au battement suivant. Un hôte dont le journal est
-- volumineux peut poser l'index à la main en `concurrently` AVANT d'appliquer ce fichier — le
-- `if not exists` le rend alors sans effet.
--
-- ⚠️ IDEMPOTENTE : `if not exists`, rejouable sans effet.

create index if not exists idx_cds_recipient_last_at
  on public.commercial_doc_sessions (recipient_email, last_at desc)
  where recipient_email is not null;

comment on index public.idx_cds_recipient_last_at is
  'Sert « toutes les lectures de cette personne, la plus récente d''abord », la question de la fiche '
  'par destinataire : filtre, tri et pagination par curseur en une seule descente. Partiel sur '
  'recipient_email non nul — un lien anonyme ne répond jamais à cette question.';
