-- LA RÉVOCATION N'AVAIT PAS DE DATE — « 13 MOIS APRÈS RÉVOCATION » ÉTAIT INCALCULABLE.
--
-- docs/RETENTION.md promet la purge des liens révoqués 13 mois après leur révocation ; or le
-- schéma ne portait que `revoked boolean` et `created_at`. Sans date, la politique serait restée
-- une phrase — ou aurait pris l'âge du lien comme borne, purgeant un lien révoqué d'hier parce
-- qu'il est né il y a deux ans. La colonne date l'acte ; le backfill démarre l'horloge des
-- révoqués existants À MAINTENANT (leur date réelle est perdue — compter large plutôt qu'inventer).
--
-- Sans lui : rien ne casse — la purge des liens révoqués reste simplement inactive (sonde de
-- schéma négative), les autres purges tournent.
alter table public.commercial_doc_shares
  add column if not exists revoked_at timestamptz;

comment on column public.commercial_doc_shares.revoked_at is
  'Date de révocation du lien — borne la rétention (purge N mois après, cf. docs/RETENTION.md). '
  'Nulle tant que le lien vit. Les révoqués d''avant cette colonne ont reçu la date de la '
  'migration : leur horloge démarre là.';

update public.commercial_doc_shares
  set revoked_at = now()
  where revoked = true and revoked_at is null;
