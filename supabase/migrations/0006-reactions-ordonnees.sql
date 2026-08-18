-- DEUX RÉACTIONS SIMULTANÉES S'ÉCRASAIENT.
--
-- Le serveur lit le JSON des réactions, le modifie en mémoire, le réécrit en entier : deux
-- participants qui réagissent au même message dans la même seconde lisent le même état, et la
-- seconde écriture emporte la première — une réaction disparaît, sans erreur nulle part.
--
-- Même remède que pour les écritures de pilotage (0002) : un rang. L'écriture porte le rang
-- qu'elle a lu et n'est acceptée que s'il n'a pas bougé ; sinon le serveur relit et rejoue.
-- La comparaison et l'écriture deviennent le même geste — c'est la base qui arbitre, pas la
-- mémoire d'un processus.
alter table public.doc_presentation_messages
  add column if not exists reactions_seq bigint not null default 0;

comment on column public.doc_presentation_messages.reactions_seq is
  'Rang de la dernière écriture de réactions acceptée. Une écriture conditionnée à un rang déjà '
  'dépassé ne modifie aucune ligne : le serveur relit et rejoue. Sans lui : rien ne casse, mais '
  'deux réactions simultanées peuvent s''écraser (dernier écrivain gagne), comme avant la 0006.';
