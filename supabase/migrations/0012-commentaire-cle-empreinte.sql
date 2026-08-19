-- LE COMMENTAIRE DE COLONNE DÉCRIVAIT UN FORMAT MORT.
--
-- La 0011 documentait la clé sous sa forme concaténée « hote:<doc>|<destinataire attesté> » ;
-- depuis, la clé est une EMPREINTE — genre:sha256(JSON.stringify(composants)) — parce que la
-- concaténation portait trois défauts (troncature à l'écriture mais relecture entière, collision
-- de préfixe, frontière « | » déplaçable — septième audit). Un commentaire de colonne se lit dans
-- la base, longtemps après les fichiers : celui-ci aurait envoyé un exploitant chercher des clés
-- lisibles qui n'existent plus.
--
-- Sans lui : rien ne casse — seule la documentation EN BASE reste fausse.
comment on column public.commercial_doc_shares.idem_key is
  'Clé d''idempotence des liens SYSTÈME (hôte, répétition) : empreinte « genre:sha256(JSON des '
  'composants) » — genre = hote | repetition. Les clés historiques au format concaténé '
  '« hote:<doc>|<email> » se remplacent d''elles-mêmes au réemploi (backfill). Nulle sur les '
  'liens ordinaires. Unique quand renseignée : deux demandes simultanées ne créent qu''un lien, '
  'la seconde relit le gagnant.';
