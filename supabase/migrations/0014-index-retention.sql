-- LES FILTRES DE RÉTENTION MÉRITENT LEURS INDEX.
--
-- La purge sélectionne par date : `last_at`, `revoked_at`, `expires_at`. Sans index, chaque lot
-- est un balayage séquentiel — acceptable sur une petite base, coûteux sur un gros historique
-- (P2 du huitième audit). Trois index, idempotents.
--
-- ⚠️ `CREATE INDEX CONCURRENTLY` NE PEUT PAS tourner dans une transaction (et le MCP applique en
-- transaction) : on pose donc des index ordinaires ici. Sur une installation VOLUMINEUSE déjà en
-- production, un exploitant préférera les créer à la main en `CONCURRENTLY` hors migration pour
-- ne pas verrouiller la table en écriture — c'est écrit dans docs/RETENTION.md.
--
-- Sans lui : rien ne casse — la purge tourne, plus lentement sur les grosses tables.
create index if not exists idx_cds_last_at on public.commercial_doc_sessions (last_at);
create index if not exists idx_bot_last_at on public.doc_bot_sessions (last_at);
create index if not exists idx_shares_revoked_at on public.commercial_doc_shares (revoked_at) where revoked = true;
