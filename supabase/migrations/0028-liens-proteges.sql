-- LES LIENS PROTÉGÉS : UNE ÉCHÉANCE ET UN MOT DE PASSE SUR UN LIEN TRACÉ.
--
-- Demandé par le premier hôte (01/10/2026) : sa fenêtre de partage disait « sans expiration », et un
-- document envoyé à un prospect restait ouvrable des années plus tard. Deux colonnes, toutes deux
-- NULLES par défaut — un lien existant ne change pas de comportement : sans date, il n'expire pas ;
-- sans empreinte, il n'a pas de mot de passe.
--
--   expires_at     au-delà, le lien ne se résout plus (page, fichier, assistant, mesure, re-partage) ;
--   password_hash  « sel:hash », scrypt, hexadécimal — JAMAIS servi : la carte, la liste des liens et
--                  la page n'en disent qu'un booléen. Le cookie de déverrouillage en est signé.
--
-- Sans lui : rien ne casse, et rien ne s'ouvre par erreur — les liens existants se lisent comme avant,
-- mais le player REFUSE de créer ou de modifier un lien protégé (503, qui nomme ce fichier) plutôt que
-- de créer un lien ouvert qui se dirait protégé.
-- Règle et pièges : server/lien-protege.js.
alter table public.commercial_doc_shares
  add column if not exists expires_at timestamptz;
alter table public.commercial_doc_shares
  add column if not exists password_hash text;

comment on column public.commercial_doc_shares.expires_at is
  'Echeance du lien : au-dela, il ne se resout plus. Nulle = sans expiration.';
comment on column public.commercial_doc_shares.password_hash is
  'Empreinte du mot de passe du lien (sel:hash, scrypt, hex). Nulle = sans mot de passe. '
  'Jamais servie : un hote n''en voit qu''un booleen.';
