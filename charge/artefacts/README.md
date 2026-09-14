# Artefacts de charge

Une course de charge laisse derrière elle **un JSON**, produit même en échec (`complete: false`,
avec sa raison), validé contre `charge/artefact.schema-<N>.json` et attaché à la release qui l'a
produite.

**Doctrine de version.** Un schéma est **immuable** dès le premier artefact publié sous son numéro.
Ses objets sont fermés : une clé émise en plus serait refusée par un ancien validateur, donc toute
clé nouvelle fait un schéma suivant ; tout changement de sémantique aussi, même sans changement
de forme. Le validateur (`tools/artefact-de-charge.mjs`) choisit le schéma par
`artefact.schemaVersion` ; les anciens schémas et leurs corpus restent dans le dépôt. Un banc fige
**toutes** les clés du schéma 1, pas seulement la racine.

**Deux couches de validation.** Le schéma dit les formes ; le validateur tient les **invariants
entre nombres** que JSON Schema ne sait pas dire : `complete: true` sans raison d'échec, avec une
durée positive et au moins 1 000 observations ; `sequence[position − 1] === spectators` ;
`scheduled ≥ started ≥ completed` et `completed === latencyMs.n` ; percentiles ordonnés,
`min ≤ mean ≤ max` ; classes d'histogramme strictement croissantes, une de plus que les comptes,
somme des comptes égale à `n` ; `delta = after − before` clé par clé ; plafond mémoire `null` si
et seulement si sa source est `unknown` ; statuts **disjoints** (`429` hors `other4xx`, `503` hors
`other5xx`, `other` pour 1xx et 3xx) dont la somme vaut `completedRequests`. Passés plusieurs
fichiers (`--fichier=` répété), il confronte la **cohorte** : même `runId`, même séquence, même
commit, positions uniques, jeux de données distincts.

`exemples/` ne contient **pas de mesures** : ce sont des formes, et le `runId` le dit. L'exemple
complet porte des nombres cohérents entre eux parce que le validateur l'exige — le même validateur
jugera les vrais rapports, et une forme vide qui passerait dirait qu'un rapport vide passerait.
Les exemples sont aussi le corpus de compatibilité de leur schéma.

Les vrais artefacts ne vivent pas dans ce dépôt : ils sont attachés aux releases. La rétention des
artefacts de la forge est temporaire ; une release ne l'est pas.
