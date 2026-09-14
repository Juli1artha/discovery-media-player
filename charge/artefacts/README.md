# Artefacts de charge

Une course de charge laisse derrière elle **un JSON**, produit même en échec (`complete: false`,
avec sa raison), validé contre `charge/artefact.schema.json` et attaché à la release qui l'a
produite. Le schéma porte un numéro (`schemaVersion`) qui change quand la **sémantique** change ;
une clé optionnelle s'ajoute sans changer de version, une clé obligatoire jamais.

`exemples/` ne contient **pas de mesures** : ce sont des formes. Chaque nombre y vaut zéro et le
`runId` le dit. Ils servent à deux choses : le validateur (`node tools/artefact-de-charge.mjs`)
les éprouve à chaque course de la forge, et ils sont le **corpus de compatibilité** du schéma 1 —
un schéma qui les refuserait demain aurait cassé la série sans changer de numéro.

Les vrais artefacts ne vivent pas dans ce dépôt : ils sont attachés aux releases. La rétention des
artefacts de la forge est temporaire ; une release ne l'est pas.

Structure spécifiée par un audit externe (sixième et septième passes, 14/09/2026) ; aucune clé
n'a été ajoutée avant le premier prototype, à trois exceptions près, dites dans le CHANGELOG :
`scenario.position` et `scenario.sequence` (l'ordre d'exécution, que le protocole demande
d'enregistrer) et `environment.memoryLimitSource` (les deux emplacements proposés pour le plafond
mémoire sont réunis en un).
