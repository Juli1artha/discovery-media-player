-- CLÔTURER ÉTAIT IMPOSSIBLE SUR UNE BASE NEUVE.
--
-- La clôture d'une présentation pose `control_hash = null` : c'est LE marqueur d'archive — le slug
-- seul donne le droit de suivre, le hash celui de piloter, et une archive n'a plus de pilote.
-- Or init.sql déclarait la colonne NOT NULL : chaque clôture violait la contrainte (23502) et
-- toute présentation restait « active » pour toujours chez un hôte installé depuis ce fichier.
--
-- ⚠️ TROUVÉ PAR LE BANC « VRAIE BASE », PAS PAR UN LECTEUR : 793 essais passaient — le double en
-- mémoire n'a pas de contraintes, c'est écrit dans son en-tête. Les bases HISTORIQUES, nées de
-- migrations plus anciennes, sont nullables : la production ne pouvait pas le montrer non plus.
--
-- Sans lui : sur une base née d'un init.sql d'avant cette correction, `endPresentation` échoue en
-- erreur serveur et l'archive en lecture seule n'existe pas — les présentations ne se ferment pas.
alter table public.doc_presentations
  alter column control_hash drop not null;

comment on column public.doc_presentations.control_hash is
  'Hash du jeton de pilotage. NULL = présentation archivée : plus personne ne pilote, et le '
  'scellé (0007) refuse toute écriture. Le slug seul ne donne que le droit de suivre.';
