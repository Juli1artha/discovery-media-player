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

**Le schéma est compilé en entier avant tout artefact**, par `ajv` (2020-12, mode strict) : un
mot-clé inconnu, une référence non résolue, un motif incompilable, un `required` qui n'est pas une
liste rendent la garde non concluante, même dans une branche qu'aucun exemple ne matérialise. Un
parcours préalable maison ne subsiste que pour donner le chemin des trois défauts qu'`ajv` nomme
sans chemin.

**Deux couches de validation.** Le schéma dit les formes ; le validateur tient les **invariants
entre nombres** que JSON Schema ne sait pas dire : `complete: true` sans raison d'échec, avec une
durée positive et au moins 1 000 observations ; `sequence[position − 1] === spectators` ;
`scheduled ≥ started ≥ completed` et `completed === latencyMs.n` ; quantiles ordonnés,
`min ≤ mean ≤ max` ; `timeouts ≤ calls` ; pic mémoire ≥ départ et ≥ fin pour chaque grandeur ;
classes d'histogramme fixes (`edges[0] = 0`, strictement croissantes, `[a, b)`), une de plus que
les comptes, `counts + overflow` sommant à `n`, `binSetId` **dérivé** des bornes et recalculé ;
`delta = after − before` clé par clé ; plafond mémoire `null` si et seulement si sa source est
`unknown` ; statuts **disjoints** (`429` hors `other4xx`, `503` hors `other5xx`, `other` pour 1xx
et 3xx) dont la somme vaut `completedRequests` ; chaque 2xx jugée (`correctResponses +
emptyResponses + wrongPresentation = 2xx`) ; pour un relais, `admitted + refused =
completedRequests`, `refused ≤ 503`, `bytesTransferred ≤ admitted × fileBytes`. Les grandeurs
dérivables (débit, appels par requête) ne sont **pas stockées** : elles se recalculent, sans
divergence possible.

**Une cohorte est une campagne.** Passés plusieurs fichiers (`--fichier=` répété), le validateur
exige une cohorte **complète** (positions exactement `1..sequence.length`, tous complets) ou
**interrompue** (préfixe continu `1..k`, le dernier `complete: false`, rien après) ; tout ce qui
doit être constant l'est nommément (`runId`, commit, version, empreinte du schéma, environnement
entier, nom et paramètres du scénario, modèle et forme d'arrivée, règles d'isolation) et ce qui
varie avec l'échelle est nommément exclu (`spectators`, `position`, `maxInFlight`, `egressIps`, `datasetId`) ;
un même `binSetId` porte les mêmes bornes.

**L'ancre.** Chaque artefact porte `identity.schemaSha256`, l'empreinte canonique du schéma sous
lequel il a été produit ; le validateur exige que ce soit celle du schéma qu'il applique. Et
`ancres.json` nommera, pour chaque numéro, le tag qui a publié le premier artefact : la garde relit
le schéma à ce tag et le confronte, empreinte contre empreinte — l'immuabilité se prouve hors de la
copie courante, jamais contre un littéral modifiable dans le même commit.

`exemples/` ne contient **pas de mesures** : ce sont des formes, et le `runId` le dit. L'exemple
complet porte des nombres cohérents entre eux parce que le validateur l'exige — le même validateur
jugera les vrais rapports, et une forme vide qui passerait dirait qu'un rapport vide passerait.
Les exemples sont aussi le corpus de compatibilité de leur schéma.

**Le producteur.** `node --expose-gc charge/rapport.js --sortie=<dossier>` joue la séquence
(`--sequence=100,1000,100` par défaut, `--par-spectateur=10` lectures d'état par spectateur) dans un
seul processus contre le PostgREST de `PLAYER_TEST_POSTGREST_URL` — le scénario `state-hot`, une
présentation par position, un préchauffage hors mesure, un générateur en boucle ouverte avec gigue
dont le retard est mesuré — et écrit un artefact par position, puis les juge en cohorte. Une
position qui échoue laisse son artefact `complete: false` et arrête la course. La forge le lance
après la campagne de charge, sur le même runner, et attache la sortie à son run.

Les vrais artefacts ne vivent pas dans ce dépôt : ils sont attachés aux runs de la forge, puis aux
releases. La rétention des artefacts de la forge est temporaire ; une release ne l'est pas.
