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

**Une cohorte est une campagne**, y compris à un seul fichier. Passés plusieurs fichiers (`--fichier=` répété), le validateur
exige une cohorte **complète** (positions exactement `1..sequence.length`, tous complets) ou
**interrompue** (préfixe continu `1..k`, le dernier `complete: false`, rien après) ; tout ce qui
doit être constant l'est nommément (`runId`, commit, version, empreinte du schéma, environnement
entier, nom et paramètres du scénario, modèle et forme d'arrivée, règles d'isolation) et ce qui
varie avec l'échelle est nommément exclu (`spectators`, `position`, `maxInFlight`, `egressIps`, `datasetId`) ;
un même `binSetId` porte les mêmes bornes.

⚠️ **Les règles de couverture s'appliquent dès UN fichier.** Elles n'ont besoin d'aucun second membre :
la séquence annonce *n* rangs, et la cohorte les tient tous ou s'arrête sur un échec. Le validateur
sortait autrefois avant elles quand il ne recevait qu'un fichier — deux rangs sur trois étaient
refusés, un seul passait sans un mot, et la garde était donc *plus faible sur moins de preuve*. Ce
qui exige réellement deux membres, ce sont les comparaisons entre membres ; elles bouclent sur les
suivants, ensemble vide pour un seul.

**Le producteur refuse avant de mesurer.** Séquence non vide (une séquence vide n'est pas une course
réussie : elle ne produit aucun artefact, et le validateur appelé sans fichier jugerait le corpus
d'exemples), effectifs et lectures par spectateur entiers sûrs et strictement positifs, durée bornée,
produit total sous plafond. Rien n'est raboté en silence — `100,bad,1000` est refusé, pas réduit à
`[100, 1000]`. Un refus sort en **code 2** : ni un succès, ni une campagne qui a échoué en produisant
son artefact, mais une configuration qu'on n'a pas voulu jouer.

**Et il ne peut plus se suspendre sans le dire.** Chaque requête porte une échéance et un
`AbortSignal` ; chaque position porte un budget global ; les instruments — échantillonneur mémoire,
moniteur de boucle, sonde sur `db.request` — se retirent dans un `finally`, sans quoi une position
suivante mesurerait à travers l'instrument de la précédente. Une requête expirée **invalide la
position** plutôt que de se ranger dans les statuts : à ces latences, une échéance qui tire ne dit
pas « c'est lent », elle dit « quelque chose ne répond plus ».

**L'ancre, et elle existe depuis le 15/09.** Chaque artefact porte `identity.schemaSha256`,
l'empreinte canonique du schéma sous lequel il a été produit ; le validateur exige que ce soit celle
du schéma qu'il applique. Et `ancres.json` nomme, pour chaque numéro, le tag qui a publié le premier
artefact : la garde relit le schéma **à ce tag** (`git show`) et le confronte, empreinte contre
empreinte — l'immuabilité se prouve hors de la copie courante, jamais contre un littéral modifiable
dans le même commit.

⚠️ **Le schéma 1 est ancré à `v0.1.169`, et il est donc FIGÉ.** Cette sortie a publié trois artefacts
conformes, repris de la course CI de son propre commit, provenance contrôlée et cohorte rejugée. Les
trois empreintes coïncident : celle du schéma **au tag**, celle de la copie courante, et celle que
portent les artefacts publiés — `ae81dab76fa9d946…`. À partir d'ici, toute clé nouvelle et tout
changement de sémantique font un **schéma 2**, avec son corpus de compatibilité ; modifier le
schéma 1 en place fait rougir la garde, qui nomme les deux empreintes et le remède.

L'ancre n'a pas pu être écrite plus tôt, et ce n'est pas un retard : elle nomme un tag, et un tag
n'existe qu'après la fusion. Un audit externe (CODEX) a d'ailleurs maintenu un veto sur ce gel
jusqu'à ce que l'instrument soit réparé — veto qui a rendu possibles les amendements du 15/09, tous
faits pendant que le schéma était encore amendable.

`exemples/` ne contient **pas de mesures** : ce sont des formes, et le `runId` le dit. L'exemple
complet porte des nombres cohérents entre eux parce que le validateur l'exige — le même validateur
jugera les vrais rapports, et une forme vide qui passerait dirait qu'un rapport vide passerait.
Les exemples sont aussi le corpus de compatibilité de leur schéma.

**La topologie est une condition de la mesure.** `topology` est obligatoire, et il dit le trajet
réellement exercé : le générateur appelle `player.handler()` **dans le processus** — ni socket, ni
parseur HTTP, ni `bin/serve.js` — contre un PostgREST **réel** en loopback, la réponse étant un vrai
flux inscriptible dont les octets sont comptés. Sans ce bloc, des latences de quelques microsecondes
se lisent comme des latences réseau. Deux artefacts de topologies différentes ne se comparent pas,
et c'est pour cela que `topology` est une constante de cohorte *en entier*.

**Et l'artefact dit les conditions de lecture de ses propres chiffres.** `environment` porte le
modèle de processeur, le fournisseur et l'image du runner, la **période d'échantillonnage mémoire**
— `process.memoryMiB.peak` n'est pas « le maximum » mais « le maximum vu à cette cadence », et un pic
plus court passe entre deux relevés — et la résolution du moniteur de boucle, sous laquelle un p99
ne descend jamais. `workload` porte la durée **cible** (celle obtenue est dans `measurementWindow`),
l'algorithme d'ordonnancement **et** sa graine : une graine seule ne rejoue rien si l'algorithme qui
la consomme a changé. `identity` porte dépôt, évènement, référence, numéro et tentative de course, et
`prHeadSha` — sur une PR, `GITHUB_SHA` désigne un commit de fusion éphémère qui n'existera plus.

⚠️ **`measurementWindow` désigne UNE période.** Ses trois bornes sont prises deux à deux, à
l'ouverture et à la fermeture, sans rien entre elles : elles englobaient autrefois la création de la
présentation et le préchauffage d'un côté, les sondes et le GC final de l'autre. `afterGc` reste
explicitement hors fenêtre.

⚠️ **Les compteurs ne s'observent pas eux-mêmes.** Ils se lisent par une couture interne qui ne
traverse pas le handler ; la lecture passait autrefois par une requête, qui incrémentait le compteur
qu'elle mesurait (1 001 pour 1 000 requêtes). Ce que la fenêtre contient d'autre que la charge se
**dit**, dans `counters.observerOverheadRequests`, et jamais ne se soustrait en silence : un
instrument qui se retranche discrètement est plus difficile à auditer qu'un instrument faux.

⚠️ **`cache.peakInFlight` est le pic de LA FENÊTRE**, relevé par un observateur parallèle qui ne
modifie ni ne ralentit le cache ; le maximum depuis le démarrage vit à part, sous
`processLifetimePeakInFlight`. Les recopier l'un pour l'autre faisait hériter une position calme du
pic d'une position chargée.

**Un échec est public.** `failure.reason` est assaini et borné — caractères de contrôle, URL,
adresses, jetons et en-têtes remplacés par une marque *visible*, parce qu'un lecteur doit voir qu'il
manque quelque chose — et `failure.code` porte la cause sous une forme stable et énumérée, qui
s'agrège là où un message ne s'agrège pas. Le détail brut reste dans le journal privé de la course.

**Le résumé.** `node tools/resume-de-charge.mjs --fichier=… [--run-url=…]` engendre le tableau
Markdown **depuis les octets** : provenance en tête (course, version, commit, dépôt, évènement,
référence), topologie, positions dans l'ordre, cadence rapportée à la cadence nominale du contrat
hôte, et le **sha256 de chaque fichier** pour que le lecteur confronte au lieu de nous croire. Il
refuse quand la cohorte est refusée : une présentation soignée fait passer ses chiffres pour
vérifiés. La Release l'inclut dans ses notes. Ce qui a rendu cet outil nécessaire : un tableau
recopié à la main, sans course ni version ni commit, donc impossible à contredire.

**Le producteur.** `node --expose-gc charge/rapport.js --sortie=<dossier>` joue la séquence
(`--sequence=100,1000,100` par défaut, `--par-spectateur=10` lectures d'état par spectateur) dans un
seul processus contre le PostgREST de `PLAYER_TEST_POSTGREST_URL` — le scénario `state-hot`, une
présentation par position, un préchauffage hors mesure, un générateur en boucle ouverte avec gigue
dont le retard est mesuré — et écrit un artefact par position, puis les juge en cohorte. Une
position qui échoue laisse son artefact `complete: false` et arrête la course. La forge le lance
après la campagne de charge, sur le même runner, et attache la sortie à son run.

Les vrais artefacts ne vivent pas dans ce dépôt : ils sont attachés aux runs de la forge, puis aux
releases. La rétention des artefacts de la forge est temporaire ; une release ne l'est pas.

**Comment ils arrivent sur une release — et pourquoi ils n'y sont pas refaits.** Le job `attester`
retrouve la course CI **verte du commit taggué** (`gh run list --commit $(git rev-parse HEAD)
--workflow CI`), en télécharge l'artefact `artefacts-de-charge`, **rejuge la cohorte entière** avec
`tools/artefact-de-charge.mjs`, et ne recopie les fichiers dans le paquet qu'ensuite, sous
`discovery-media-player-<version>-charge-<position>-<spectateurs>.json`. Rejouer la mesure dans le
workflow de sortie aurait été plus simple et aurait été **faux** : autre runner, autre instant,
autre base de données — deux séries pour un même point, et rien pour départager. Un banc l'interdit
(`tools/__tests__/releaseFichiersAttaches.test.js`), et un mutant le tient.

**La mesure est *dite*, pas *exigée*, et c'est le seul actif de la release dans ce cas.** Les quatre
autres — l'archive, son condensat, sa signature, son SBOM — arrêtent la sortie s'ils manquent. La
mesure, non : elle n'existe que pour les commits dont la CI l'a produite, et un rejeu par
`workflow_dispatch` sur un tag antérieur au producteur — c'est-à-dire exactement la sortie que le
dispatch existe pour rattraper — n'en a aucune. L'exiger bloquerait ces rattrapages. Mais son
absence n'est **jamais silencieuse** : un avertissement dans la course, et un paragraphe dans le
corps de la Release qui dit laquelle des deux raisons s'applique — tag antérieur au producteur, ou
artefact de course expiré. Le silence était le défaut du 22/08, pas l'absence.

⚠️ **Un artefact récupéré mais non jugeable arrête la sortie.** Si la course a bien livré des
artefacts et que le tag ne porte pas leur validateur, le job échoue : on n'attache pas une mesure
qu'on ne peut pas juger. C'est le cas où l'absence serait *moins* grave que la présence.
