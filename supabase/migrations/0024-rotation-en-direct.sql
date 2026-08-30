-- LA ROTATION DU PRÉSENTATEUR NE SUIVAIT PAS SON AUDIENCE — ELLE N'AVAIT NULLE PART OÙ VOYAGER.
--
-- ⚠️ CE QUI MANQUAIT. Depuis la 0.1.143, un présentateur peut redresser un document à 90° dans sa
-- visionneuse. Sa rotation restait LOCALE : l'audience continuait de voir le document couché
-- pendant qu'il commentait un document droit. Le pilotage en direct transporte la page courante, le
-- document et la vue carte — pas l'orientation.
--
-- ⚠️ POURQUOI `view_rotation` ET NON `rotation`. Le nom dit ROTATION DE LA VUE, par opposition au
-- `/Rotate` que porte le fichier PDF lui-même : ce sont deux choses différentes, et le player les
-- COMPOSE au lieu de les confondre. Le nom court aurait aussi collisionné avec l'option `rotation`
-- de pdf.js, présente partout dans le code de la visionneuse — la garde qui vérifie qu'une colonne
-- migrée n'est jamais écrite sans condition aurait alors crié en permanence sur des lignes qui ne
-- touchent pas la base. Une alerte qui sonne quand tout va bien apprend à cliquer à côté.
--
-- ⚠️ POURQUOI UNE COLONNE ET PAS LA COLONNE `content`. `content` porte un type VALIDÉ (carte ou
-- Street View) et il est ré-assaini à la réception. Y glisser une orientation reviendrait à faire
-- porter deux sens au même champ, et à affaiblir le validateur qui protège toute l'audience d'une
-- vue imposée par un participant. Une orientation n'est pas un contenu.
--
-- ⚠️ Sans lui : RIEN NE CASSE, ET LA ROTATION NE SE PROPAGE SIMPLEMENT PAS. Le player interroge la
-- présence de cette colonne avant d'écrire (`GET /api/doc?schema=1` la nomme). Chez un hôte non
-- migré, le présentateur tourne son document pour lui seul, exactement comme avant — mais PostgREST
-- rejetterait le PATCH ENTIER si on la nommait sans qu'elle existe, ce qui ferait perdre AUSSI le
-- changement de page. C'est pourquoi le champ est conditionnel côté serveur et non systématique.
--
-- ⚠️ IDEMPOTENTE : `if not exists`, rejouable sans effet.

alter table public.doc_presentations
  add column if not exists view_rotation integer not null default 0;

comment on column public.doc_presentations.view_rotation is
  'Orientation du document imposée par le présentateur, en degrés (0, 90, 180, 270). Normalisée au '
  'quart de tour à la RÉCEPTION : sur la voie broadcast, cette valeur vient du navigateur du '
  'présentateur, et un viewport oblique casserait la couche de texte de toute l''audience.';
