-- DEUX DEMANDES SIMULTANÉES CRÉAIENT DEUX LIENS POUR LE MÊME USAGE.
--
-- Le lien « de l'hôte » (un par document et destinataire attesté) et le lien de répétition (un par
-- document) sont censés être UNIQUES : le code lisait « existe-t-il déjà ? » puis insérait — deux
-- requêtes dans la même seconde passaient toutes deux la lecture, et deux liens naissaient. Les
-- statistiques du document se fragmentent entre eux, sans que rien ne le dise. Constat P2 du
-- cinquième audit, même famille que l'idempotence des messages (0005) : la lecture-puis-écriture
-- ne promet rien, seule une contrainte promet.
--
-- ⚠️ La clé est NULLE sur les liens ordinaires (un membre peut envoyer le même document à autant
-- de destinataires qu'il veut) — l'index partiel ne contraint que les liens SYSTÈME, qui la
-- portent. Les doublons historiques restent en base, clé nulle : leurs URL sont distribuées, on
-- ne retire rien — le premier trouvé est réutilisé et reçoit la clé, les autres s'éteignent
-- d'eux-mêmes faute d'être resservis.
--
-- Sans lui : rien ne casse — la lecture-puis-écriture continue, avec sa course, comme avant.
alter table public.commercial_doc_shares
  add column if not exists idem_key text;

comment on column public.commercial_doc_shares.idem_key is
  'Clé d''idempotence des liens SYSTÈME (hôte, répétition) : « hote:<doc>|<destinataire attesté> » '
  'ou « repetition:<doc> ». Nulle sur les liens ordinaires. Unique quand renseignée : deux '
  'demandes simultanées ne créent qu''un lien, la seconde relit le gagnant.';

create unique index if not exists cds_idem_key_uniq
  on public.commercial_doc_shares (idem_key)
  where idem_key is not null;
