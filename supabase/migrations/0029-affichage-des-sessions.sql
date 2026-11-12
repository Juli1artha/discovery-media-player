-- 0029 — comment le document était affiché, dans chaque session de lecture (#617)
--
-- Pour : mesurer si le gabarit « lecture » (#595) fait lire davantage. Le relevé L0 du 11/11/2026
--   (#593) a mesuré la lecture d'avant ; sans le mode d'affichage, on ne saura jamais le comparer à
--   celle d'après — et le diaporama, qui fait baisser les « pages vues » sans que la lecture recule,
--   se lirait comme un recul.
-- Contenu : un objet borné par le serveur (`server/affichage.js`) — gabarit, ajustement, format de la
--   première page, mode une page, et des COMPTEURS de gestes (clavier, flèches, vignettes, zoom,
--   rotation, ajustement, recherche, résultats, sommaire). Aucune donnée personnelle : on compte
--   qu'on a cherché, pas ce qu'on a cherché.
-- Sans lui : la session s'écrit exactement comme avant, sans ce champ ; le player sonde la colonne
--   (`schema.js`, attente `affichageSessions`) et nomme ce fichier dans son journal, une fois.
-- Sûre pendant que 0.1.181 tourne : oui — additive, nullable, sans défaut ; l'ancien code ne
--   l'écrit pas.
-- Signe propre : la colonne `affichage`, sur les deux tables (et le texte de son commentaire).

alter table public.commercial_doc_sessions
  add column if not exists affichage jsonb;
alter table public.commercial_doc_internal_sessions
  add column if not exists affichage jsonb;

comment on column public.commercial_doc_sessions.affichage is
  'Mode d''affichage de la session (0029) : gabarit, ajustement, format, une_page, compteurs de gestes. '
  'Borne par le serveur ; aucune donnee personnelle. Nul = ecrite avant la 0029, ou par un player anterieur.';
comment on column public.commercial_doc_internal_sessions.affichage is
  'Mode d''affichage de la session (0029) : gabarit, ajustement, format, une_page, compteurs de gestes. '
  'Borne par le serveur ; aucune donnee personnelle. Nul = ecrite avant la 0029, ou par un player anterieur.';
