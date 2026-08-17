-- 0002 — le rang d'écriture, pour que l'ordre survive à un abandon
--
-- Pour : garantir qu'une écriture PÉRIMÉE n'écrase pas une plus récente. La file unique du
--        navigateur supprime le désordre qu'on CAUSE (une seule écriture en vol) ; elle ne peut
--        rien contre celui qu'on SUBIT — une requête abandonnée par le délai maximal peut être
--        arrivée au serveur et y atterrir après celle qui l'a remplacée.
--
-- Sans lui : rien ne change. Le player détecte l'absence de la colonne, cesse de contrôler l'ordre,
--            et le signale une fois en nommant ce fichier. On revient exactement au comportement
--            d'avant : dernier arrivé gagne.
--
-- Sûre pendant que la version précédente tourne : oui — additive, avec une valeur par défaut, donc
-- aucune ligne existante n'est réécrite et aucun code plus ancien ne la lit.
--
-- ⚠️ POURQUOI UN RANG PLUTÔT QU'UN HORODATAGE. Une heure vient d'une horloge, et deux onglets d'un
-- même présentateur n'ont pas la même. Un rang vient d'un compteur : il ne dit pas QUAND, il dit
-- APRÈS QUOI — ce qui est exactement la question posée.

alter table public.doc_presentations
  add column if not exists write_seq bigint not null default 0;

comment on column public.doc_presentations.write_seq is
  'Rang de la dernière écriture de pilotage acceptée. Une écriture de rang inférieur ou égal est '
  'refusée : elle a été doublée en vol. Remis à zéro par toute émission d''un jeton de contrôle '
  '(démarrage, reprise), qui ouvre un nouveau domaine d''ordre.';
