-- DEUX ENVOIS DU MÊME MESSAGE NE DOIVENT PAS FAIRE DEUX MESSAGES.
--
-- Un renvoi réseau, un double-clic, une reprise après délai : la requête part deux fois et la base
-- enregistre deux lignes. Le participant voit son message en double, et rien ne le lui explique —
-- il n'y a eu aucune erreur, seulement un succès de trop.
--
-- ⚠️ LA CLÉ EST FABRIQUÉE PAR LE CLIENT, UNE FOIS, AVANT LE PREMIER ENVOI — et c'est toute la
-- subtilité. Une clé tirée à chaque tentative ne servirait à rien : les deux envois porteraient des
-- clés différentes et passeraient tous les deux. C'est la RÉUTILISATION de la clé au renvoi qui
-- rend l'opération idempotente, pas la clé elle-même.
--
-- ⚠️ INDEX PARTIEL, et il faut comprendre pourquoi. Les lignes déjà en base n'ont pas de clé ; un
-- index unique ordinaire les traiterait comme des doublons entre elles (plusieurs NULL sont
-- distincts en SQL, donc en réalité ça passerait — mais la condition rend l'intention explicite et
-- protège d'un futur `not null default ''`, où toutes les anciennes lignes deviendraient soudain
-- identiques). L'index ne contraint que ce que le nouveau client écrit.
--
-- ⚠️ CE QUE LA BASE FAIT, ET CE QUE LE CODE DOIT FAIRE. La contrainte REFUSE le second envoi ;
-- PostgREST répond alors 409. Ce refus n'est pas une erreur à remonter au participant : c'est la
-- preuve que son message est déjà là. Le serveur doit donc relire la ligne existante et la rendre,
-- comme si l'envoi avait réussi — sinon on remplace « deux messages » par « une erreur », ce qui
-- n'est pas mieux. Cette partie-là est du code, elle n'est pas dans ce fichier.
--
-- Sans lui : rien ne change, deux envois du même message créent toujours deux lignes. Le client
-- peut envoyer la clé, la colonne l'ignore poliment — aucune écriture ne casse, et le player ne
-- signale rien puisque l'ancien comportement EST le comportement d'aujourd'hui.
--
-- Applicable pendant que la version précédente tourne : tant que personne n'écrit la colonne, elle
-- reste vide et l'index ne contraint rien.

alter table public.doc_presentation_messages
  add column if not exists client_key text;

comment on column public.doc_presentation_messages.client_key is
  'Clé d''idempotence fabriquée par le client AVANT le premier envoi et réutilisée au renvoi. '
  'Unique par présentation (index partiel dpm_client_key_uniq). Nulle sur les lignes antérieures '
  'à la migration 0005, et sur celles écrites par un client qui ne la fournit pas.';

-- ⚠️ Portée sur (slug, client_key) et pas sur la clé seule : deux présentations différentes n'ont
-- aucune raison de partager un espace de clés, et un client qui réutiliserait par accident la même
-- valeur d'une session à l'autre verrait son message refusé sans comprendre.
create unique index if not exists dpm_client_key_uniq
  on public.doc_presentation_messages (slug, client_key)
  where client_key is not null;
