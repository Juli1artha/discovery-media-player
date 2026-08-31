# Changelog

Notable changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/),
versioning follows [Semantic Versioning](https://semver.org/) — newest first.

The **host contract** has its own version, independent of the package version: it appears as
`contract` in `GET /api/doc?contract=1` and changes only on a break. See
[`docs/HOST-CONTRACT.md`](docs/HOST-CONTRACT.md).

Each released version below is also a [GitHub Release](https://github.com/Juli1artha/discovery-media-player/releases);
the notes there are this file's section for that version.

## [Unreleased]

## [0.1.145] — 2026-08-31

⚠️ **Rien à faire pour un hôte, et c'est le seul message de ce train.** Il ne porte que de
l'outillage : dix gardes de CI et leurs bancs, pas une ligne du code servi. Aucune migration, aucun
changement de contrat, aucun changement de comportement. Monter est sans effet visible ; ne pas
monter l'est tout autant.

Il est publié parce que `main` ne doit pas rester loin de ce que le registre sert, pas parce qu'il
apporte quelque chose à qui l'installe.

⚠️ **Ce que ces dix entrées ont en commun, et qui vaut mieux que leur liste.** Une seule ajoute une
règle qui manquait. Les neuf autres corrigent la **façon de prouver** une règle déjà écrite — un
analyseur absent du chemin du rouge, un plancher aveugle aux disparitions, une discrimination qui
tenait au tri alphabétique, cinq gardes qui affirmaient une absence sans pouvoir distinguer « rien
trouvé » de « rien regardé ». Aucune n'était visible depuis la précédente.

Et cinq fois sur ces quatre jours, le remède existait déjà dans ce dépôt — écrit, commenté, et non
appliqué à l'endroit d'à côté. Une garde bien écrite explique son mécanisme, et cette explication
est ce qui rend le fichier crédible : on ne rouvre pas la phrase qui justifie l'outil.

### Changed

- ⚠️ **Les trois dernières gardes d'absence portent un témoin — et la mesure a imposé un mécanisme
  différent de celui des deux précédentes.** `secrets-en-clair`, `renvois-par-position` et
  `portes-de-reponse` affirment chacune une absence sur un large périmètre. Aveuglées, mesuré : les
  trois imprimaient leur résumé complet et sortaient **0**.

  ⚠️ **La recette des deux gardes précédentes ne marche pas ici, et c'est la garde qui l'a dit.** Un
  témoin **dérivé** — « au moins un corps écrit sur place » — **refuse sur un dépôt sain** : zéro
  corps reconnu pour onze `.end(` bruts, parce que tout passe par le module des portes. Il aurait
  exigé la chose même que la garde décourage.

  **Un témoin dérivé n'est possible que si la forme correcte est une chose que le dépôt est censé
  CONTENIR.** Un bloc `permissions:` et un appel au module crypto le sont ; un secret, un renvoi par
  numéro de ligne et un corps sans type ne le sont pas. Pour ceux-là il faut **fabriquer** le cas :
  poser un exemplaire fautif, vérifier que la sonde le VOIT, le jeter.

  ⚠️ **Ce mécanisme n'était pas neuf ici.** L'étape RLS de `ci.yml` le pratique depuis des semaines
  sur les politiques Postgres — « on pose une politique dont on sait qu'elle existe, on vérifie que
  la sonde la VOIT, et on l'enlève. Sans ce détour, le zéro qui suit ne prouverait rien. » Il
  n'avait jamais été porté jusqu'aux outils. Cinquième fois que le remède existe ici, inutilisé.

  ⚠️ **Et le témoin des secrets est assemblé à l'exécution, jamais écrit.** Cette garde balaie 104
  fichiers de `tools/`, le sien compris : un faux identifiant en clair y serait signalé par elle-même,
  on l'exempterait, et l'exemption deviendrait le trou que son propre en-tête décrit. Un banc vérifie
  qu'aucun fichier suivi ne porte ce littéral.

  Pour `portes-de-reponse`, le témoin distingue **voir** de **juger** : une sonde qui reconnaît la
  forme mais ne la juge plus fautive laisse passer exactement ce que la garde attrape, et un témoin
  qui ne vérifierait que « vu » ne le dirait pas.

- ⚠️ **Deux gardes qui affirment une ABSENCE portent désormais le témoin de leur RÈGLE, pas seulement
  celui de leur périmètre.** L'idée vient de la session STUDIO, qui a trouvé la même chose chez elle
  sur 97 fichiers : notre témoin d'exception prouve qu'une **exception** a encore un sujet, celui-ci
  prouve que la **règle** en a encore un. Deux moitiés de la même précaution.

  `permissions-workflows` affirme « aucune écriture à la racine » sur neuf fichiers ;
  `liaison-de-crypto` affirme « aucun appel sur le global » sur trente et un. **Leur panne la plus
  probable — une sonde qui ne reconnaît plus la forme — produit elle aussi une absence.** Le plancher
  qui existait compte les FICHIERS LUS, jamais la FORME RECONNUE, et ne peut donc pas les distinguer.

  Mesuré en aveuglant chaque sonde :

  ```
  avant : permissions : 9 workflows, aucune écriture à la racine          code 0
  après : GARDE NON CONCLUANTE — aucun bloc « permissions: » reconnu…     code 2
  ```

  ⚠️ **Et la nuance, qui change la sévérité et qu'il serait malhonnête de taire : leurs bancs, eux,
  attrapaient déjà la sonde aveugle.** Ce n'était donc pas une garde morte — la RÈGLE était protégée.
  C'est le **verdict imprimé** qui ne l'était pas, et c'est lui qui va dans le journal de la forge et
  sous les yeux de quiconque lance l'outil à la main. La ligne comptait le périmètre et se lisait
  comme une mesure.

  Les deux résumés disent maintenant ce qu'ils ont **reconnu** : « 9 bloc(s) lu(s) dans 9
  workflow(s) », « 5 fichier(s) appellent le module parmi 31 ». Plancher à **un** dans les deux cas —
  le compte du jour serait collé au relevé du jour.

  Pour `liaison-de-crypto`, ce témoin est **distinct de celui qui existait déjà** :
  `methodesDuModuleSeul()` refuse quand plus aucune méthode ne sépare le module du global, donc il
  prouve que **la question** a encore un sens sur ce Node ; le neuf prouve que **la sonde** sait
  encore lire la réponse. Deux cécités différentes, deux refus différents.

- ⚠️ **Deux bancs choisissaient leur cible par l'ORDRE DE TRI d'un dossier — la dette la plus vieille
  de la série, soldée par construction plutôt que par mesure.** Elle était signalée depuis trois
  messages sans jamais avoir été cherchée.

  **Le balayage n'a trouvé aucune nouvelle instance du défaut**, et c'est la mesure qui le dit :
  chaque candidat a été essayé, un par un. Dépouiller **n'importe laquelle** des deux images node
  rougit ; abaisser **n'importe laquelle** des dix déclarations littérales rougit. Le vert n'était
  pas un accident.

  Mais « mesuré aujourd'hui » et « ne peut pas dépendre du tri » ne sont pas la même affirmation :
  **la première a une date, la seconde n'en a pas.** Les deux bancs bouclent donc désormais sur tous
  les candidats. Personne ne relit un banc quand il ajoute un fichier.

  ⚠️ **Et le balayage a trouvé autre chose : un banc portait DEUX propriétés dans un seul test**, ce
  qui les affaiblissait toutes les deux. « Une étape dépouillée est refusée » vaut pour n'importe
  laquelle — il ne faut donc pas en choisir une. « La mutation discrimine PAR ÉTAPE de PAR FICHIER »
  n'a de sens que sur une cible dont le fichier garde d'**autres** déclarations — il faut donc en
  choisir une, et délibérément. Fondues, la première héritait d'un choix dont elle n'avait pas
  besoin, et la seconde d'un choix qu'elle ne faisait pas.

  Mesuré : **trois de nos dix déclarations littérales vivent seules dans leur fichier**, et sur
  celles-là la discrimination ne tient pas. Le tri décidait donc si le banc prouvait sa seconde
  propriété. Les deux sont maintenant séparées, et la seconde choisit sa cible pour ce qu'elle est.

- ⚠️ **Chaque exception écrite doit prouver qu'elle a encore un sujet — une entrée morte est une
  porte ouverte d'avance.** La distinction vient de la session STUDIO : *une liste de ce qu'il faut
  REGARDER cesse de couvrir dès qu'un fichier apparaît ; une liste de ce qui est PERMIS fait rougir
  tout fichier qui n'y est pas.* Nos deux listes de ce qui est permis étaient donc de la bonne forme
  — mais tenues dans un seul sens.

  `FICHIERS_MIT` déclare `src/bridge.ts` hors de l'AGPL. Le banc affirmait que **le nom est dans
  l'ensemble**, jamais que **le fichier existe**. Le jour où il est renommé, l'entrée survit — et un
  futur fichier à ce chemin exact serait relicencié MIT **sans décision**, alors que l'en-tête de la
  liste dit qu'ajouter un fichier ici « se discute dans une PR, pas dans un correctif de garde ». Le
  relicenciement se ferait par omission, sur une frontière de licence, garde verte.

  `INTERNES_TOLERES` dit « tout nouveau venu doit être décidé plutôt que découvert ». Cela n'était
  tenu que contre les **arrivants** : un symbole qui cesse d'être exporté laissait son entrée
  derrière lui, et son retour aurait été *toléré* au lieu d'être *décidé*.

  ⚠️ **Le remède existait déjà chez nous, inutilisé.** La garde qui vérifie qu'aucune autre ne
  déclare victoire sur zéro porte exactement ce patron depuis des semaines : chaque exemption a sa
  raison **et** une fonction qui rougit quand le motif disparaît. Mécanisme inventé, commentaire
  écrit, et non appliqué aux deux endroits où il manquait.

  ⚠️ **Et les éprouvettes ont corrigé la conception.** Le contrôle des licences était d'abord dans
  l'outil ; deux bancs ont rougi aussitôt, à juste titre — `garde(racine)` s'applique à une racine
  QUELCONQUE et les éprouvettes lui passent des dépôts temporaires, tandis que `FICHIERS_MIT` est
  une constante du VRAI dépôt. Il accusait chaque éprouvette de ne pas contenir `src/bridge.ts`. Un
  contrôle d'exception appartient là où le SUJET est connu : dans le banc pour les licences, dans
  l'outil pour la surface publique, dont le sujet est toujours le module réel.

- ⚠️ **Le périmètre d'`images-epinglees` vient du disque — c'était une liste écrite, dans la garde où
  ça coûtait le plus cher.** `ci.yml` lui passait `Dockerfile .zap/Dockerfile` en dur. Cette garde
  **est** la règle qui empêche une image de changer sous nos pieds : le jour où quelqu'un ajoutait un
  troisième Dockerfile, elle aurait rendu « toutes épinglées » en n'ayant regardé que deux fichiers
  sur trois. Son refus « zéro image » ne l'aurait pas dit — **il compte ce qu'il a LU, il ne sait pas
  ce qu'il n'a pas OUVERT**.

  Le périmètre est désormais `git ls-files`, partagé avec `node-de-l-image` plutôt que dupliqué :
  deux exemplaires de « quels Dockerfiles existe-t-il ? » divergeraient. Un banc interdit à un
  workflow de le remplacer par des arguments — dériver un périmètre ne sert à rien si un appel
  l'écrase.

  ⚠️ **Et ce lot a réintroduit, en le déplaçant, le défaut que `resultat-garde` existe pour
  interdire.** Le calcul du périmètre vivait AU-DESSUS de `tenter`, ce qui était sans conséquence
  tant qu'il valait `["Dockerfile"]`, une constante. Devenu une **lecture du disque**, son exception
  a cessé d'être rattrapée : hors d'un dépôt git, l'outil mourait sur une trace de pile et sortait
  **1** — « corrige ta branche » pour un environnement sans git, exactement le rouge que la taxonomie
  sépare. Les quatre mutants de ce lot et ses cinquante-trois bancs étaient verts ; **seule
  `planchers-des-gardes` l'a dit**, en lançant l'outil dans un dépôt vide. Le calcul est passé
  dedans, et la frontière est maintenant commentée à l'endroit où on la franchit.

### Added

- ⚠️ **La seconde moitié de la paire : ce que l'IMAGE embarque, confronté à `engines`.** La première
  garde le confronte à ce que la **forge installe** ; rien ne le confrontait à ce qu'un
  **auto-hébergeur exécute**. Des deux exemplaires non mesurés, celui-ci était le plus proche de la
  production.

  ⚠️ **Trois gardes touchent déjà ce fichier, et aucune ne pose cette question** — relevé plutôt que
  supposé : `images-epinglees` demande « l'image vient-elle d'un condensat ? » ; `ecartMajeur`
  demande « l'étiquette dit-elle vrai sur le condensat ? » ; le job `docker` construit l'image et
  lui demande sa version. Le jour où `engines` passera au-delà de 24, **les trois resteront
  vertes** : l'image serait épinglée, son étiquette dirait vrai, et elle embarquerait un moteur que
  notre propre paquet déclare non supporté. Deux exemplaires cohérents entre eux ne disent rien du
  troisième fait qu'ils ignorent.

  `tools/node-de-l-image.mjs` prend son périmètre sur le disque (`git ls-files`, jamais une liste
  écrite), **importe** le lecteur de Dockerfile existant plutôt que d'en écrire un quatrième — celui
  de ce dépôt a déjà été aveugle une fois — et porte la même relation que sa jumelle : toute image
  qui **fournit** node doit dire laquelle. `FROM node@sha256:…` sans étiquette est valide, épinglé,
  et sa version est indéterminable ; un comptage y verrait une image de plus, la relation y voit une
  dette. Deux absences restent distinctes : rien de déclaré est une **violation**, une étiquette que
  semver ne lit pas est **non concluant**.

  ⚠️ **Et ce que le resserrement écarte est RENDU.** `Dockerfile.prod` en est un, `Dockerfile.md` est
  une page qui en parle, et aucune lecture du nom ne les sépare sans convention. La convention est
  donc écrite — les extensions de document sont écartées — et les fichiers écartés sont **dits en
  avertissement**, parce qu'un resserrement muet est ce qui a coûté trois lecteurs à ce dépôt.

- ⚠️ **La relation est PAR ÉTAPE, et le banc cesse d'en avoir la preuve par accident.** La session
  STUDIO est tombée le 31/08 dans un trou que son dépôt lui cachait : sa garde comptait des
  **fichiers** là où il faut compter des **étapes**, et comme aucun de ses fichiers ne portait deux
  `setup-node`, les deux formulations y étaient **observationnellement identiques**. Aucune mutation
  ne pouvait les distinguer — ses quatre mutants mouraient tous correctement, en éprouvant la règle
  écrite plutôt que la règle voulue.

  Vérifié chez nous plutôt que supposé : notre règle **est** par étape (deux étapes dont une muette
  → 2 installations, 1 refus). Le trou n'est pas dans la règle. **Il est dans le banc.**

  Notre mutation sur fichier réel vise `declarations.find(…)`, c'est-à-dire l'**ordre de tri du
  dossier** : elle ne séparait « par étape » de « par fichier » que parce que cette cible tombe dans
  `ci.yml`, qui porte quatre étapes. Si elle avait trié dans `cla.yml` — une seule étape — les deux
  règles auraient rendu exactement le même vert. Une discrimination qui dépend du nom des fichiers
  est un vert juste pour une mauvaise raison.

  Le cas est donc **fabriqué** : deux étapes, une seule déclaration, et le banc affirme qu'une règle
  par fichier serait verte là où la nôtre refuse. La mutation réelle, elle, **dit** désormais ce
  qu'elle discrimine au lieu de le supposer. S'y ajoute le défaut inverse, que le STUDIO a écrit pour
  nous faute d'avoir des matrices : une étape qui tient sa version de `${{ matrix.node }}` **déclare**
  — la compter muette accuserait le dépôt sain, et une garde qui crie faux finit desserrée.

- ⚠️ **La garde de node porte une RELATION, plus seulement des planchers — et c'est le correctif d'un
  autre dépôt qui a désigné le trou chez nous.** La session STUDIO a trouvé, dans sa propre garde, des
  planchers collés au relevé du jour, et les a remplacés par un périmètre **dérivé du disque**. Passée
  sur nos fichiers, l'idée a mesuré ceci : 11 étapes `actions/setup-node`, 11 déclarant une version,
  **et rien qui garde ce rapport**.

  Un plancher compte ce qu'il **voit** ; il ne sait pas ce qui aurait dû être là. Retirer l'entrée
  `node-version` d'une étape faisait passer le relevé de 12 à 11 déclarations — au-dessus du plancher
  de 8 — et la garde restait **verte** pendant que la forge installait le défaut de l'action, que rien
  n'épingle et que rien ne confronte à `engines`. La lecture sautait d'ailleurs toute étape sans bloc
  `with:`, donc la forme la plus dépouillée était aussi la plus invisible.

  La règle est donc : **toute étape qui installe node déclare laquelle**, périmètre pris sur le disque.
  Elle ne remplace pas les planchers, elle les complète — un plancher garde la SONDE (« ai-je lu le
  dossier ? »), la relation garde le SUJET (« chaque site d'installation est-il déclaré ? ») — et elle
  porte le sien, parce qu'une relation peut être satisfaite **à vide** : zéro installation relevée,
  aucune manquante, règle vraie pour n'avoir rien regardé.

  ⚠️ **Ce plancher-là s'est justifié le jour même, chez son auteur** : `garde()` déstructurait encore
  deux champs et ne transmettait pas le relevé neuf au verdict. Rien d'autre ne l'aurait dit.

  ⚠️ **Et l'ordre des contrôles est une décision, pas une mise en page.** La relation est évaluée
  APRÈS les planchers de déclarations : si la lecture des `node-version` cassait, les onze
  installations paraîtraient toutes muettes et la garde rendrait **onze violations** — « corrige ta
  branche » pour une panne qui n'y est pas. Un banc éprouve cet ordre, et le mutant qui l'inverse ne
  fait rougir que lui.

- ⚠️ **La garde de node est éprouvée dans les DEUX sens — et le second attrape ce qu'aucun des vingt-trois
  autres bancs ne voyait.** L'idée vient de la session STUDIO, qui a retiré une exception de sa propre
  garde le 31/08 et a nommé ce qui manque à une mutation unique : « sans cette seconde mutation,
  j'aurais eu une suite verte parfaitement compatible avec *j'ai supprimé un test gênant* ».

  Ce qui manquait ici était plus précis que « un sens sur deux ». Toutes nos violations étaient
  éprouvées sur des déclarations **fabriquées**, passées directement au verdict : l'analyseur n'était
  jamais dans le chemin du rouge, seulement dans celui du vert. Le sens neuf part donc du **texte
  d'un vrai workflow** — une version littérale du dépôt abaissée à node 18, relue par le vrai
  analyseur, refusée en nommant le vrai fichier.

  Mesuré : un analyseur muté pour **ignorer le texte qu'on lui passe** et relire le disque fait
  rougir ces deux bancs neufs et **eux seuls** — les vingt-trois autres restent verts. C'est la
  preuve que le trou existait.

  S'ajoutent la **partition énoncée d'un seul tenant** — vert au milieu, rouge des deux bords, donc
  aucun vert atteignable par accident — et un banc qui vérifie qu'un workflow **lance vraiment** cette
  garde. Ce dernier ne protège pas la règle : le banc lit `.github/workflows` pour de vrai, donc
  retirer l'étape de `ci.yml` la ferait rougir quand même — vérifié, contre une première rédaction qui
  affirmait le contraire. Il protège la **seconde jambe** : la règle est tenue à deux endroits, c'est
  délibéré, et une redondance non énoncée est précisément ce qui a fait survivre un mutant dans ce
  même fichier.

- ⚠️ **La CI mesure enfin la version de node qu'elle installe — la garde voisine avait écrit ce
  diagnostic le 25/08 sans se l'appliquer.** L'en-tête de `tools/plancher-de-node.mjs` dit :
  « `node-version: "22"` résout au DERNIER 22.x : la CI atterrit toujours au-dessus du plancher,
  quel qu'il soit. Une règle que l'environnement de vérification satisfait par construction n'est
  pas vérifiée — elle est supposée. » Cette phrase nomme **deux** paires ; l'outil n'en mesurait
  qu'une, `engines` contre les dépendances de production. L'autre — `engines` contre ce que les
  workflows demandent d'installer — restait sur la prose qui venait de la diagnostiquer. Vérifié
  plutôt que supposé : dans tout `tools/`, la chaîne `node-version` n'apparaissait qu'**une fois**,
  et c'était dans ce commentaire.

  `tools/node-des-workflows.mjs` énumère les workflows **depuis le disque** — une liste écrite
  cesse de couvrir dès qu'on ajoute un fichier — lit chaque `node-version:`, résout
  `${{ matrix.node }}` et les entrées d'`include`, et refuse toute version qu'`engines` n'admet
  pas. Relevé du jour : 12 déclarations dans 5 fichiers, toutes admises. Le rouge qu'elle attend
  n'existe pas encore : il arrivera le jour où le plancher passera au-delà de 22, et ce jour-là
  `check (22)` validerait en vert sur un moteur que notre propre paquet déclare non supporté.

  La comparaison est `intersects`, pas `subset`, et la différence est le cœur de la garde :
  `subset("22", ">=22.13.0")` est **faux** — 22.0.0 est dans « 22 » sans être dans `engines` — donc
  une garde bâtie dessus refuserait la CI d'aujourd'hui, qui est saine. `intersects` est exact ici
  sous une condition que la garde **vérifie** au lieu de la supposer : un `engines` sans plafond.
  Sous un `engines` borné en haut, elle refuse de conclure plutôt que de rendre un vert dont elle
  ne sait plus ce qu'il vaut. Deux planchers anti-vacuité — sur le nombre de déclarations **et**
  sur le nombre de fichiers, parce qu'un plancher unique laisse passer un balayage qui garde le
  compte en perdant la moitié du dossier. Ce qu'elle ne sait pas lire (`node-version-file`,
  `lts/*`, une expression non résolue) est **dit**, jamais sauté.

## [0.1.144] — 2026-08-30

⚠️ **Second train du même jour, et la raison est écrite plutôt que tue.** `0.1.143` est partie à
15:10. La règle de cadence de `docs/RELEASING.md` dit « un train par jour au plus » avec trois
exceptions — sécurité, paquet cassé sur le registre, réparation de la chaîne de publication — et
celui-ci n'en est aucune. C'est une décision du mainteneur, dont le document dit qu'elle lui revient
(« ce qui est dans ce train, et s'il en vaut un »). Elle est consignée ici parce que le contraire a
déjà coûté : le 25/08, la règle annonçait deux exceptions, la pratique en utilisait une troisième, et
un audit externe a demandé laquelle des deux mentait. Un écart énoncé vaut mieux qu'un écart tu.

### Changed

- ⚠️ **La carte publie un NOM de migration, plus un chemin — parce qu'une garde de sécurité d'hôte
  tirait dessus, et que la doctrine de ce dépôt dit que c'est à l'émetteur de céder.** Une garde de
  la session STUDIO refuse toute carte d'identité contenant `supabase|secret|key|token` : un
  balayage de texte volontairement grossier, qui protège une réponse **publique** contre la fuite
  d'une URL de projet, d'une clé ou d'un jeton. Nos valeurs étaient préfixées
  `supabase/migrations/…` — faux positif sans ambiguïté, mais le refus était bien fondé.
  ⚠️ **Le préfixe part, la garde reste.** `presenceJetons` porte ce nom (et non `presenceTokens`)
  parce que cette même garde avait déjà tiré une fois, et le commentaire qui l'accompagne posait
  déjà la règle : *le bon geste face à son refus est de changer ce qu'on émet, jamais de desserrer
  la garde*. Nous avions donc la doctrine, et nous l'avons ratée à la première occasion où l'émetteur
  c'était nous sur une **valeur** plutôt que sur un nom de champ. Le répertoire ne se perd pas : il
  est dit une fois dans `HOST-CONTRACT.md`, et le journal de l'exploitant continue d'imprimer le
  chemin complet — ce message s'adresse à quelqu'un qui le lit, pas à un balayage.
  ⚠️ **Le cas est instructif par la façon dont il s'est réveillé** : `manquant` publiait ces chemins
  depuis toujours, mais restait `[]` chez cet hôte — la garde était donc **verte depuis des mois dans
  une configuration où son sujet ne pouvait pas apparaître**. Il a fallu `connues`, qui les liste
  *sans condition*, pour la faire tirer. Même motif que la carte qui disait « complet » sans couvrir
  une migration, sur une garde de sécurité cette fois.
  ⚠️ **Et retirer le préfixe ne règle que la collision du jour, pas la classe** — remarque du même
  hôte, et elle est juste : le nom de fichier reste une valeur que nous choisissons, donc
  `0031-refresh-token-rotation.sql` rouvrirait le même refus des mois plus tard, chez tous les hôtes
  à la fois. Deux bancs ferment ça, et convertissent une habitude de nommage en règle mesurée :
  l'un balaie `supabase/migrations/` et refuse un nom fautif **au moment où on l'écrit** ; l'autre
  rend la carte réelle et passe le **JSON sérialisé**, clés comprises, au motif de l'hôte. Chacun a
  ses contrôles positifs : sans eux, ils passeraient aussi bien sur une carte vide ou un motif mort.

## [0.1.143] — 2026-08-30

### Changed

- **La rotation du présentateur suit désormais son audience en direct.** Jusqu'ici elle restait
  locale : le présentateur redressait un document couché et l'audience continuait de voir le document
  couché pendant qu'il commentait un document droit. Migration **0024** — `doc_presentations` gagne
  `view_rotation`.
  ⚠️ **`view_rotation` et non `rotation`, pour deux raisons.** Le nom dit *rotation de la vue*, par
  opposition au `/Rotate` que porte le fichier — deux choses que le player **compose** au lieu de les
  confondre. Et le nom court serait entré en collision avec l'option `rotation` de pdf.js, présente
  partout dans le code de la visionneuse : la garde qui vérifie qu'une colonne migrée n'est jamais
  écrite sans condition aurait alors crié en permanence sur des lignes qui ne touchent pas la base.
  Une alerte qui sonne quand tout va bien apprend à cliquer à côté.
  ⚠️ **Sans la migration, rien ne casse — et c'est ce qui a demandé le plus de soin.** PostgREST
  rejette le **PATCH entier** sur une colonne inconnue : nommer `view_rotation` chez un hôte non
  migré ne ferait pas perdre la rotation, ça ferait perdre **aussi le changement de page**, donc le
  pilotage en direct tout entier. Le champ n'est donc écrit que derrière la sonde de schéma, et un
  banc le prouve avec une doublure qui **lève** sur une colonne inconnue, comme PostgREST.
  ⚠️ **La rotation voyage avec la page, par le même message.** Lui donner son action propre lui aurait
  donné son propre rang d'écriture, et deux écritures concurrentes auraient pu s'inverser — l'audience
  recevant une rotation postérieure à la page qu'elle précède. Un message, un ordre.
  ⚠️ **Elle est normalisée à la réception, des deux côtés.** Sur la voie `broadcast`, cette valeur
  vient du **navigateur du présentateur** : un viewport oblique casserait la couche de texte de toute
  l'audience, pas seulement de celui qui l'envoie. Le serveur applique une **liste blanche** ; le
  module de décision ramène au quart de tour. ⚠️ **Et les deux portes ne disaient pas la même
  chose** — `Number("90")` vaut 90, donc le serveur acceptait une chaîne que le navigateur rejetait.
  Relevé par un banc, pas par une relecture : deux validateurs du même geste qui divergent, c'est
  l'un des deux qui ment et on ne sait pas lequel.

- **Panneau de vignettes, à gauche du document** — bouton dans la barre et entrée de menu, replié par
  défaut, tiroir plutôt que colonne sous 860 px. Cliquer une vignette navigue ; la vignette courante
  est marquée. Masqué sur un document image ou d'une seule page, où il n'aurait rien à montrer.
  ⚠️ **Le moteur vient du chat, sauf la partie qui compte.** Le générateur de vignettes de
  `gabarit-live.js` apporte le cache borné, la file de concurrence et le chargement paresseux. Ce qui
  ne se transpose **pas** est son `getDocument` suivi d'un `destroy` : ce panneau montre les pages du
  document **déjà ouvert**. Le reprendre tel quel téléchargerait le fichier une seconde fois et ferait
  tourner deux workers sur le même PDF. Un banc compte les requêtes vers le fichier et exige zéro.
  ⚠️ **Le suivi automatique se désarme dès que le lecteur touche le panneau** — sinon chaque
  changement de page ramène le panneau sur la page en cours et le lecteur se bat contre son outil. On
  écoute les gestes, pas l'événement de défilement : un défilement que nous provoquons n'est pas une
  intention du lecteur.
  ⚠️ **Deux défauts trouvés en mesurant, tous deux miens.** Un rendu de vignette en échec restait
  marqué « faite » et n'était **jamais retenté** — précisément ce que le chemin principal des pages
  documente et évite. Et le correctif naïf en introduisait un pire : ré-observer un élément déjà
  visible rappelle l'observateur **immédiatement**, donc une **boucle infinie** sur un moteur où les
  rendus échouent en série. La reprise est bornée à deux tentatives ; mesuré : la file s'arrête à 2
  rejets au lieu de tourner sans fin.
  ⚠️ **Et deux de mes sondes annonçaient « borné ✓ » et « libéré ✓ » sur zéro vignette rendue.** Un
  zéro qui vient de ce qui n'a jamais eu lieu satisfait « au plus 48 » aussi bien qu'un moteur qui
  marche. Les quatre bancs portent désormais un plancher qui **refuse** un panneau vide.
  ⚠️ **Et une course, trouvée par la forge et impossible à voir ailleurs.** Ouvrir le panneau
  reconstruit le document et **reporte de 30 ms** la restauration de la page courante — la géométrie
  n'est pas stable avant. Ce report survivait à une navigation faite dans l'intervalle et la
  **défaisait** : ouvrir le panneau puis cliquer aussitôt une vignette ramenait le lecteur à sa page
  de départ. Invisible dans l'environnement de développement, où les vignettes ne se rendaient pas et
  où le banc attendait donc bien au-delà des 30 ms. **Toute navigation explicite périme désormais un
  report en attente**, et un banc ouvre le panneau et clique dans le même instant.

- **Rotation du document à 90°, à gauche ou à droite** — dans la barre et dans le menu « ⋯ », comme
  le zoom, et repliée dans le menu sous 860 px par la même règle. Un quart de tour par clic ; quatre
  clics ramènent à l'identique. Rotation du **document**, pas de la page : une rotation par page est
  un autre modèle de données et une autre interface.
  ⚠️ **La rotation du fichier est COMPOSÉE, jamais écrasée.** `getViewport({rotation})` de pdf.js dit
  *« si omise, elle vaut la rotation de la page »* : passer une valeur absolue écrase le `/Rotate` que
  portent très couramment les documents numérisés en paysage. Un « remettre à zéro » naïf ne
  redresserait pas un document de travers — il **coucherait** un document qui était droit. Un banc
  ouvre un document portant `/Rotate 90` sans rien tourner et exige qu'il s'affiche couché.
  ⚠️ **La proportion tournée protège le SUIVI DE LECTURE, pas seulement l'affichage.** Elle fixe la
  hauteur des gabarits posés avant rendu, qui fixe la longueur du document, qui décide de la page que
  l'observateur d'intersection appelle « courante » — et c'est celle-là que le suivi enregistre.
  Mesuré : la hauteur totale change bien avec la rotation, et la page courante survit au quart de tour.
  ⚠️ **Les documents image pivotent aussi, par un second chemin.** Sans pdf.js il n'y a pas de
  viewport : la rotation est une transformation CSS, et un élément transformé occupe toujours sa boîte
  d'origine — sans échanger les dimensions du cadre, la page suivante viendrait se poser par-dessus.
  ⚠️ **Et le banc de ce cas passait à vide au premier jet** : l'image du harnais est carrée, donc
  échanger sa largeur et sa hauteur y est invisible. Le harnais porte désormais une image franchement
  rectangulaire, et le banc refuse de tourner sur une image carrée.
  Mesuré aussi : tourner pendant que le document est zoomé conserve le zoom, inverse la proportion, et
  le pire canvas reste sous le budget de pixels annoncé.

- ⚠️ **Le pincement au trackpad zoomait l'écran entier — parce que personne n'écoutait.** Sur
  trackpad, un pincement n'est pas un événement tactile : le navigateur l'envoie comme un `wheel`
  portant `ctrlKey`. Rien dans la visionneuse ne le lisait, donc le navigateur appliquait son défaut.
  ⚠️ **Et le défaut était plus large qu'un confort manquant** : sous 860 px la barre replie les
  boutons de zoom, donc **sur mobile le pincement était le seul zoom qu'un lecteur pouvait tenter** —
  et il déformait toute l'interface. Le geste est désormais réclamé sur la surface du document
  (trackpad, Ctrl+molette, événements de geste de Safari, deux doigts), et **le zoom du navigateur
  reste disponible sur le reste de l'interface** : le retirer partout serait une régression
  d'accessibilité pour qui grossit le chrome plutôt que le document.
  ⚠️ **En deux temps, parce qu'un seul ne tient pas.** Une reconstruction vide le conteneur, annule
  les rendus en vol et recrée toutes les pages : juste pour un clic, ruineux pour un geste continu.
  Pendant le pincement, une simple transformation ; la reconstruction arrive **une** fois, à l'arrêt.
  Mesuré dans Chromium : **25 événements de pincement → 1 reconstruction**.
  ⚠️ **Le point visé ne fuit plus, et la mesure a corrigé le modèle.** Première écriture : **14,1 px**
  de fuite mesurés dans un vrai navigateur. La cause n'était pas le geste mais l'arithmétique — les
  22 px de marge en haut du conteneur arrivent **avant** la première page et ne s'étirent pas, alors
  que les espaces entre pages sont proportionnels au nombre de pages au-dessus du point visé.
  Épargner cette tête ramène la fuite à **0,9 px**. Les deux valeurs sont figées dans les bancs.
  ⚠️ **Et les boutons héritent de l'ancrage** : leur dérive — les pages changent de largeur, le
  défilement reste en pixels — existait déjà et disparaît.
  ⚠️ **Défaut trouvé en chemin : le zoom ne faisait rien sur un document image.** Le garde
  `if (pdfDoc)` est faux pour une image, alors que le commentaire du rendu d'image annonce que « tout
  le chrome — loader, zoom, plein écran… — fonctionne tel quel ». Inaperçu tant que le zoom tenait à
  deux boutons ; intercepter le pincement sans le corriger aurait **avalé** le geste sur ces
  documents, donc fait pire qu'avant.

- **Socle du chantier « trois gestes » : l'arithmétique du zoom au geste et de la rotation entre dans
  `src/viewer.ts`, sans aucun changement visible.** Trois fonctions pures et une extension, couvertes
  par vingt-deux bancs de plus — le module sans DOM est le seul endroit où ces calculs sont
  éprouvables, le reste vivant dans un littéral de gabarit qu'aucun banc n'exécute.
  ⚠️ **`rotationEffective` COMPOSE la rotation du fichier avec celle demandée, au lieu de l'écraser.**
  `getViewport({rotation})` de pdf.js dit : *« si omise, elle vaut la rotation de la page »* — donner
  une valeur absolue écrase donc le `/Rotate` que portent très couramment les documents numérisés en
  paysage. Un « remettre à zéro » naïf ne redresserait pas un document de travers : il **coucherait**
  un document qui était droit.
  ⚠️ **`aspectApresRotation` gouverne le suivi de lecture, pas seulement l'affichage.** La proportion
  fixe la hauteur des gabarits, qui fixe la longueur du document, qui décide de la page que
  l'observateur d'intersection appelle « courante » — et c'est celle-là que le suivi enregistre. Une
  proportion non tournée à 90° fausserait les statistiques d'un partage sans rien casser à l'écran.
  ⚠️ **`ancrageApresZoom` traite la marge de centrage**, sans quoi il ancre correctement un document
  zoomé et fait sauter un document vu en entier — au moment exact où le lecteur commence à zoomer. Il
  distingue aussi la part du contenu qui NE grandit pas avec le zoom : cent pages séparées de 16 px
  portent plus de 1500 px d'espacements fixes.
  ⚠️ **Et une mutation survivante a révélé du code mort, retiré plutôt que couvert** : la symétrie
  appelait une marge de centrage « après » ; elle n'est non nulle que si le contenu reste plus étroit
  que le cadre, cas où la butée haute vaut zéro et la sortie vaut zéro quoi qu'on ajoute. Les deux
  conditions s'excluent. Un balayage de 195 840 combinaisons a confirmé zéro cas observable avant de
  la supprimer. Les onze autres mutations rougissent.

- ⚠️ **Deux règles de revue tirées de l'épisode de la requête de diagnostic, l'une de nous, l'autre
  d'un hôte.** La première : *une sonde qui demande « est-ce que ça échoue ? » à une question qui est
  « qu'est-ce que ça rend ? » rend compte d'elle-même, pas de son sujet.* Deux de nos vérifications
  n'ont regardé que le code de sortie et ont déclaré sûre une requête qui rendait deux lignes
  fausses ; un hôte, qui dit avoir fait la même erreur trois fois dans la semaine, en a donné la
  version la plus nette — *« j'ai annoncé "0 échec" alors que zéro test avait tourné »*.
  La seconde, entièrement de lui : *énumérer les valeurs d'une variable n'est pas un argument de
  couverture.* Notre banc couvre les quatre valeurs que `pg_policies.roles` peut porter, et les deux
  défauts qui ont réellement mordu venaient d'ailleurs — l'écart entre les rôles du geste et ceux de
  la politique, puis l'inventaire de rôles du CLUSTER, qui n'est la propriété d'aucune politique.
  ⚠️ **Et le défaut est qu'un axe exhaustif SE LIT comme une couverture**, d'autant plus que
  l'énumération est complète. Un banc dit donc désormais quelles dimensions il fait varier **et
  lesquelles il tient fixes** : ce sont les fixes qui produiront le prochain signalement.
  ⚠️ **Et « on a regardé et conclu que non » n'est pas « ce banc ne l'exerce pas »** : les deux
  tombent dans le même paragraphe « non mesuré », et seule la seconde survit à celui qui la lit dans
  six mois. Une dimension écartée par raisonnement est donc inscrite en FIXE quand même, le
  raisonnement à côté d'elle et jamais à sa place.
  ⚠️ **Et la règle sur le code de sortie porte désormais le déplacement dont elle est un cas**,
  généralisé par le même hôte : *« chaque fois qu'un instrument échoue, ce qu'il rend décrit
  l'instrument »*. Ce dépôt en avait catalogué trois autres sans voir que c'était le même geste — le
  sha256 du vide, un 403 lu comme une absence, un `grep` sur un fichier qu'il ne sait pas lire.

- ⚠️ **Il y avait un QUATRIÈME profil de politique, et c'est la forme par défaut : `{public}`.**
  Trouvé par un hôte le 29/08 pendant que le banc à trois profils tournait déjà. Une politique écrite
  **sans clause `TO`** s'applique à `PUBLIC`, donc à tous les rôles y compris `anon` — et
  `pg_policies` l'affiche `{public}`, jamais `{anon}`. Le filtre `in ('anon','authenticated')` la
  sautait intégralement. Ce n'est pas un cas rare : c'est ce que produit l'interface Supabase pour un
  bucket public, et l'hôte en a relevé cinq chez lui dont les trois qui servent ses buckets publics.
  Un hôte qui posait le `revoke` puis lançait la requête obtenait **zéro ligne pendant que ses
  buckets étaient morts** — le tableau exact que la requête existe pour éviter, sur le profil que
  personne n'avait construit.
  ⚠️ **Et la piste proposée avec le signalement portait l'angle mort que son auteur annonçait** :
  tester `anon` comme *représentant* de `public` se tait là où seul `authenticated` est privé, et
  nomme `public` comme rôle — ce qui laisse l'hôte sans savoir quel droit rendre. La forme retenue
  déplie `public` en ses rôles concrets, et nomme celui qui a perdu le droit.
  ⚠️ **Et `to_regrole` n'est pas une coquetterie** : sur une installation sans `anon` ni
  `authenticated` — tout ce qui n'est pas Supabase — `has_table_privilege('anon', …)` ne rend pas
  faux, il **lève**, et la requête entière échoue. Filtrer sur `pg_roles` ne suffit pas, mesuré : le
  planificateur évalue la fonction dans le même filtre de jointure. La forge contrôle désormais ce
  cas **avant** de créer les rôles, seul moment où sa base est dans cet état.
  Le banc passe à **quatre profils et cinq scénarios**, et garde les **trois** écritures écartées :
  l'écriture d'origine ne voit pas `{authenticated}`, la deuxième manque `{anon,authenticated}`, la
  troisième manque `{public}` quand seul `authenticated` est privé.

- ⚠️ **Un brouillon écrit avant une découverte n'est pas un brouillon neutre — il est faux, et il
  attend d'être envoyé.** Le 28/08, six messages aux hôtes étaient rédigés ; le défaut de la requête
  de diagnostic qu'ils portaient a été trouvé entre la rédaction et l'envoi ; **trois sont partis en
  l'affirmant quand même**, dont un vers l'hôte qui venait précisément de la démonter, lui reposant
  sa propre question invalidée. Cet hôte a nommé ce que ça coûte du côté du destinataire — *« un
  message qui croise n'est pas neutre : il se lit comme une réponse »* — et le second a reçu la
  correction accompagnée de deux messages plus anciens qui la contredisaient, tous deux affirmant que
  le dépôt avait adopté la requête étroite, ce qui était vrai à l'heure où ils avaient été écrits.
  Deux contre un, le dépôt paraissant du mauvais côté : la correction pouvait raisonnablement passer
  pour l'erreur. `AGENTS.md` porte désormais la règle et son remède — relire tout message non envoyé
  à la lumière de ce qu'on a appris depuis, signaler explicitement un message qui en croise un autre,
  et nommer dans un erratum les messages qu'il périme ainsi que les phrases qu'il retire.

- ⚠️ **La requête de diagnostic donnée aux hôtes est désormais EXÉCUTÉE par la forge, contre trois
  profils de politique construits pour l'occasion — elle était jusqu'ici affirmée.** Le job `schema`
  monte un vrai Postgres, y pose trois politiques — l'une nommant `{authenticated}`, l'une
  `{anon, authenticated}`, l'une `{anon}` —, retire le droit dans chacune à son tour, et exige que la
  requête **nomme la table morte et le rôle mort** à chaque fois. Les deux écritures écartées sont
  dans le banc en toutes lettres : le banc ne vaut pas parce que la bonne passe, il vaut parce qu'il
  **distingue** — la première ne voit pas le profil `{authenticated}`, la seconde manque la politique
  qui nomme les deux rôles.
  ⚠️ **Et c'est la requête DOCUMENTÉE qui est exécutée, pas une copie** : elle est extraite du bloc
  « Accès » d'`init.sql` entre deux marques (`tools/requete-diagnostic.mjs`). Une copie diverge, et
  le jour où elle diverge le banc resterait vert sur un texte que personne n'applique pendant que les
  hôtes appliqueraient celui du fichier — le défaut « un compte d'un instrument, un verdict d'un
  autre », transposé à une requête. L'extraction refuse plutôt que de rendre un SQL vide : marque
  absente, marques doublées ou croisées, bloc vide, sans `select` ou non terminé par `;` sont **non
  concluants**, jamais conformes — un SQL vide ne rend jamais de ligne, donc ne signale jamais rien,
  et virerait le banc au vert pour la raison exacte qu'il existe pour interdire.
  ⚠️ **Ce qui a motivé un banc plutôt qu'une relecture de plus** : des trois écritures de cette
  requête, **aucune n'a été trouvée fautive par son auteur**. Et l'hôte qui a rejoué la forme retenue
  chez lui a nommé la raison pour laquelle sa propre base ne pouvait pas trancher — **26 politiques,
  zéro nommant les deux rôles**, donc son écriture y aurait rendu le bon résultat *« pour une raison
  qui n'a rien à voir avec sa justesse »*. Valider une sonde sur la base qu'on a sous la main, c'est
  la valider sur un profil parmi trois. On construit les trois.

- ⚠️ **La requête de diagnostic que ce dépôt donnait aux hôtes rendait un zéro rassurant sur une base
  au maximum exposée.** Elle filtrait `roles::text like '%anon%'` — alors que le geste qu'elle
  vérifie retire le droit à `anon` **et** à `authenticated`. Une base dont toutes les politiques
  nomment `authenticated` obtient donc **zéro ligne**, c'est-à-dire un feu vert, pendant que chacune
  de ses politiques mourrait au premier `revoke`. Relevé par un hôte le 28/08, chez qui **28
  politiques sur 28 nomment `authenticated` et aucune `anon`** — le profil exact que la sonde ne
  voyait pas. Une sonde dont le filtre est plus étroit que le geste qu'elle vérifie rend un zéro qui
  veut dire « je n'ai pas regardé », pas « il n'y a rien ».
  ⚠️ **Et la deuxième écriture portait le même défaut d'un cran plus bas** : elle choisissait UN rôle
  par politique. Sur une politique nommant les deux rôles où seul `authenticated` a perdu le droit,
  elle inspecte `anon`, le trouve intact, et se tait. Mesuré contre un vrai Postgres monté pour
  l'occasion, sur trois profils de politique : la première écriture voit 0 des cas
  `{authenticated}`, la deuxième 1 des 2 tables cassées, la troisième les voit toutes.
  La forme retenue déplie **chaque rôle nommé** et mesure l'**état résultant**
  (`has_table_privilege`) au lieu de demander si le `revoke` a été posé — c'est la seule chose qui
  compte pour l'hôte, et elle répond avant comme après. **Rien à faire côté hôte, sauf si vous aviez
  lancé la version étroite : relancez celle-ci.**


- ⚠️ **La règle « un nombre au présent rouille » se lisait plus étroite qu'elle n'est — elle ne
  nommait que des comptes et des dates.** Ses quatre cas travaillés sont des décomptes de tests et
  des dates de mesure ; aucun n'est une POSITION. C'est pourquoi deux renvois par numéro de ligne
  ont survécu, dans le fichier même qui porte la règle, à la matinée qui a produit ces quatre cas.
  Un hôte a fait le même constat chez lui le 28/08 et l'a mieux formulé que nous : *« je cherchais
  des COMPTES, pas des POSITIONS. La règle était juste, ma lecture de son périmètre était trop
  étroite. »* Il en a trouvé deux, dont un écrit la veille contre une version d'il y a quatre
  publications, déjà faux. La règle nomme désormais la position comme cas, avec ce qui la rend le
  plus périssable des nombres au présent : **un compte survit à une édition qui n'ajoute rien à
  compter ; une position ne survit à aucune insertion au-dessus d'elle, dans un fichier qu'on
  n'édite même pas.** **Rien à faire côté hôte.**


- ⚠️ **Le conseil du `revoke` que ce dépôt donne aux hôtes était incomplet — sa précondition
  manquait, et sans elle il casse.** Les en-têtes de `0021` et d'`init.sql` invitaient un hôte à
  poser `revoke select … from anon, authenticated` comme seconde couche sous la RLS. Vrai sur les
  tables du player — zéro politique, rien d'ouvert à refermer. **Faux dès qu'une politique permissive
  nomme `anon`** : la RLS dit oui, le droit dit non, et la surface publique tombe sans qu'aucune
  configuration paraisse fautive. Un hôte l'a mesuré le 28/08 en généralisant le geste : posé sur les
  dix tables du player, **pas** posé sur ses 221 tables applicatives, dont trois portent une telle
  politique. Sa formulation est reprise — *« un `revoke` global n'est sûr que là où aucune politique
  n'accorde »* — avec la requête d'une ligne qui vérifie la condition.
- **Le contrat dit désormais que `&schema=1` rend les verdicts paresseux inobservables.** Cette
  requête sonde toutes les attentes AVANT de répondre, puis retient pour la vie du processus : son
  verdict vaut `complet`, ou `indetermine` si le témoin ne répond pas — jamais `non-sonde`. Un hôte
  qui interroge la carte ainsi ne peut donc pas rencontrer la dégradation contre laquelle la page le
  met en garde. **Les lecteurs qui ont besoin de l'avertissement et ceux qui le rencontrent sont
  disjoints**, et la page le dit maintenant plutôt que de laisser chacun vérifier un avertissement
  qui ne parle pas de son instance. Relevé par un hôte qui lisait `complet` depuis une semaine et
  l'attribuait à la chance. **Rien à faire côté hôte.**


- ⚠️ **`AGENTS.md` renvoyait deux fois à `docs/HOST-CONTRACT.md` par numéro de ligne, et les deux
  renvois étaient faux.** Pas « devenus faux un jour » : faux dès le commit suivant qui a touché la
  page visée, quelques heures après avoir été écrits. Le premier menait à un séparateur de tableau,
  le second à un tout autre sujet — l'explication qu'il annonçait avait glissé d'une trentaine de
  positions. Le fichier qui porte la section *« A number in the present tense rots »* le violait
  deux cents lignes plus haut : un numéro de ligne EST un nombre au présent, et le plus fragile qui
  soit — il ne survit à aucune insertion au-dessus de lui, dans un fichier qu'on n'édite même pas.
  ⚠️ **Et il rouille du côté du lecteur, en silence.** Relevé par un hôte qui vérifiait nos renvois,
  et qui en a nommé le coût : un lecteur qui suit un renvoi périmé lit un autre contenu, plausible,
  ne trouve pas ce qu'il cherche, et **peut conclure à une absence**. C'est le champ que personne ne
  relit parce qu'il est presque toujours juste. Les deux renvois désignent désormais leur objet — la
  ligne du tableau, la phrase d'ouverture du paragraphe — et `tools/renvois-par-position.mjs` tient
  la classe sur les documents de navigation (`AGENTS.md`, `README.md`, `docs/`). Le CHANGELOG en est
  exclu comme classe et non comme exception : ses sections sont datées et figées, et personne n'y
  cherche son chemin.
  ⚠️ **La première écriture de la garde ne voyait qu'un des deux défauts** — elle exigeait qu'un nom
  de fichier suive le numéro, et le renvoi nu est pourtant le pire : le lecteur ne sait même pas
  quelle page ouvrir. Mesuré en rejouant la sonde sur la version d'avant correction : 1 sur 2, puis
  2 sur 2. Cinq mutations, cinq rouges. **Rien à faire côté hôte.**


- ⚠️ **Le contrat d'hôte demandait implicitement de signaler les écarts — une consigne que personne
  ne peut appliquer.** Une sixième règle la remplace : **décrire ce qu'on fait, y compris ce qu'on
  croit trivial.** Un hôte ne peut pas savoir ce qui est un écart sans connaître cette page mieux
  que nous — or la phrase sur-spécifiée de la section `tts-cache` y a vécu des semaines. Il a fallu
  qu'un hôte cite son propre nommage **comme une curiosité** pour que quiconque regarde. Dans ses
  mots (27/08) : *« je ne l'ai décrite que parce que je citais `preview-fr-v2` comme une curiosité,
  sans savoir que c'était un écart. Si j'avais su que votre page l'interdisait, je me serais
  probablement conformé. »* S'y conformer aurait orphelinné **908 objets, définitivement**. Une
  règle qui demande de repérer l'écart ne peut pas marcher ; une règle qui demande de décrire son
  intégration n'exige rien que l'hôte n'ait déjà. **Rien à faire côté hôte** — c'est une invitation,
  pas une obligation.
- ⚠️ **Une correction qui retire une forme nommera désormais les occurrences qui RESTENT, pas celles
  qu'elle a retirées.** Le chiffre que la note de la 0.1.142 donnait — *« écrit dix fois à
  l'identique dans trois fichiers »* — était inutilisable pour un hôte : il compte ce qui a
  disparu. La sonde d'un hôte en a trouvé **quatre** ; les deux nombres ne se rencontrent jamais.
  Un décompte de ce qui reste se rejoue sur le tarball publié, et transforme une absence silencieuse
  en **incohérence entre deux sources** — le seul signal qui n'exige aucune vigilance. Les pièges
  sont nommés avec : une occurrence dans un fichier à octet de contrôle est invisible à un `grep`
  nu. ⚠️ Rangée dans les conventions que **les personnes** imposent, pas les gardes : aucune ne peut
  savoir qu'une note aurait dû porter un décompte. Un décompte absent n'est donc pas un décompte
  faux, et son absence ne doit pas se lire « rien à signaler ».
- **`AGENTS.md` gagne la règle des deux instruments**, formulée par un hôte et plus nette que la
  nôtre : *« une sonde qui compte avec `grep` et classe avec du code hérite des angles morts du
  premier sans hériter de sa visibilité »*. Quand un outil décide *combien* et un autre *quoi*, le
  chiffre porte la portée du premier et l'autorité du second. Écrite à côté de la règle voisine sur
  les deux entrées d'un contrôle, avec le cas mesuré la veille — quatre sites rendus là où cinq
  existaient.

### Security

- ⚠️ **Dix tables déclaraient la RLS, et rien ne demandait jamais à la base si elle en avait tenu
  compte.** `enable row level security` est écrit dix fois dans `supabase/` — et zéro banc, zéro
  étape ne le confrontait au moteur. Une posture de sécurité affirmée en commentaire et jamais
  vérifiée est une affirmation, pas une propriété ; elle serait tombée sans bruit le jour où une
  migration aurait créé une table en oubliant la ligne. Le job `schema` relève désormais ce que les
  sources **déclarent** et le confronte à ce que la base a **retenu** (`pg_class.relrowsecurity`),
  puis vérifie qu'**aucune politique** n'ouvre ces tables.
  ⚠️ **Avec son contrôle positif, et c'est lui qui fait la valeur de l'étape.** « Aucune politique »
  est un constat d'absence, donc indiscernable d'une sonde qui vise à côté : l'étape pose une
  politique témoin, vérifie que la sonde la **voit**, puis l'enlève. Sans ce détour, le zéro qui
  suit ne prouverait rien. Mesuré contre un vrai Postgres : quatre mutations, quatre rouges — RLS
  désactivée en base, politique permissive ajoutée, contrôle positif débranché, relevé des sources
  vide. **Rien à faire côté hôte** : la propriété tient déjà, personne ne la mesurait.
- ⚠️ **Un `grep` sans `-a` saute un fichier contenant un octet de contrôle sans dire un mot.** Un
  hôte a relu le 27/08 les occurrences restantes d'une forme corrigée dans `server/` et a conclu
  « quatre sites, zéro manqué ». Il y en avait **cinq** : la cinquième vit dans un banc qui contient
  un octet NUL — délibérément, puisqu'il éprouve les caractères de contrôle. GNU grep classe alors
  le fichier comme binaire et n'imprime aucune ligne.
  ⚠️ **Ce n'est pas un faux négatif ordinaire, c'est un saut muet** : la sonde ne dit pas « je n'ai
  pas pu lire ce fichier », elle rend un nombre plus petit, d'apparence normale, sur lequel on
  conclut. Aucune de nos étapes n'était aveugle — leurs globs ne descendaient pas dans `__tests__/`
  — mais la propriété tenait par la forme d'un glob, pas par une décision. `tools/greps-sans-angle-mort.mjs`
  garde désormais la classe : tout `grep` d'un workflow qui lit du source porte `-a`.
  ⚠️ **Et cette garde était VERTE sur ses trois propres violations à sa première exécution** : elle
  cherchait le jeton `grep` alors que le jeton réel est `sans_commentaires=$(grep`. Verte, et
  fausse — la question 2 de `AGENTS.md` retournée contre la garde qui venait l'écrire. Le banc porte
  ce cas nommément. Six mutations, six rouges, dont une qui a d'abord survécu : le banc du « motif
  cité » passait pour la mauvaise raison, et il a fallu un motif contenant une espace pour le rendre
  probant. **Rien à faire côté hôte.**
- ⚠️ **« Personne, sauf le rôle de service » était vrai en effet, pas en droit — et la nuance est
  toute la protection.** Un hôte l'a relevé le 27/08 en appliquant la 0021 : sur une installation
  de type Supabase, `anon` possède le droit SELECT sur ces tables, hérité des privilèges par défaut
  du schéma `public`. Ce n'est donc pas l'absence de `grant` qui les ferme, c'est **uniquement** la
  RLS, et il n'y a rien en dessous. Une politique permissive ajoutée « pour débloquer un cas » ne
  retire pas une protection sur deux : elle retire la seule. Les en-têtes de `0021` et de `init.sql`
  le disent maintenant, et nomment le `revoke` que l'hôte peut poser chez lui — ce dépôt ne le pose
  pas à sa place, ces rôles étant ceux de son installation et non de Postgres.

### Fixed

- ⚠️ **La carte de schéma rendait un « complet » qui ne pouvait pas rougir — et l'hôte qui suit
  l'ordre sûr est précisément celui qu'elle ne renseignait pas.** La session STUDIO l'a mesuré des
  deux côtés le 30/08 : sur `0.1.142` elle applique la migration 0024, relit
  `GET /api/doc?contract=1&schema=1`, et obtient `attendues: 9 · sondees: 9 · complet · manquant: []`
  — mot pour mot ce qu'elle lisait **avant** de l'appliquer. Elle ne pouvait pas voir la 0024 quitter
  une liste où elle n'était jamais entrée : la liste des attentes est celle du **code qui tourne**, et
  `view_rotation` n'y entre qu'avec la version qui apporte la fonction.
  ⚠️ **`complet` a donc toujours voulu dire « complet pour le code que je suis »**, jamais « complet
  pour le dépôt » — et rien, ni dans la réponse ni dans `HOST-CONTRACT.md`, ne disait la différence.
  Un hôte qui applique le schéma **avant** le code (l'ordre sûr, celui qu'on recommande) est
  exactement celui que ce vert laisse sans réponse.
  ⚠️ **Aucune version ne peut connaître une migration postérieure à elle** — ce défaut-là est
  structurel et ne se corrige pas. Ce qui se corrige, c'est de **dire ce qu'on connaît** : la carte
  publie `connues`, la liste des migrations que ce code sait attendre. « 0024 n'est pas dedans »
  devient une lecture directe, au lieu d'une déduction qui exige de connaître notre historique de
  publication. `manquant` nomme ses fichiers dans les mêmes chaînes, pour que l'appartenance soit une
  comparaison et non une interprétation — un banc l'exige, parce que deux listes publiées pour être
  comparées et qui divergeraient de vocabulaire resteraient « justes » séparément et inutilisables
  ensemble.
  ⚠️ **Et pour une migration que ce player ne connaît pas, `HOST-CONTRACT.md` renvoie désormais à la
  base plutôt qu'à la carte** — une requête `information_schema` ne dépend pas de la version qui la
  lance, ce qui est le seul cas où on a besoin d'une réponse. C'est la même faute qu'un paragraphe
  voisin de ce document décrit déjà un cran plus bas (« les lecteurs qui ont besoin de
  l'avertissement et ceux qui le rencontrent sont disjoints »), d'un niveau au-dessus.

- ⚠️ **Reprendre une présentation rendait la page, pas l'orientation — et le présentateur et son
  audience voyaient alors deux documents différents sans que rien ne le dise.** Un rechargement remet
  la vue du présentateur à son état d'origine (zoom 1, rotation 0) : c'est une décision, pas un
  oubli, et c'est ce que font tous les lecteurs de documents. Mais l'audience, elle, continuait
  d'afficher la `view_rotation` de la base. Le présentateur voyait donc son document **droit**
  pendant que son audience le voyait **couché**, et il n'avait aucune raison de toucher le bouton de
  rotation : de son côté tout allait bien.
  ⚠️ **La règle valait déjà pour la page, il lui manquait l'orientation.** À la **reprise**, la
  présentation l'emporte sur l'état local — la reprise sautait déjà à la page en cours de la base.
  Au **démarrage** c'est l'inverse, et les deux sont cohérents : `startPresent` pousse la rotation
  courante du présentateur, parce qu'il n'y a encore rien à reprendre.
  ⚠️ **On adopte, on ne pousse pas.** La base porte déjà la valeur : la renvoyer serait une écriture
  pour rien, et le message de pilotage emporte **aussi** la page — or la page courante vaut 1 tant
  que le document se charge, donc pousser à la reprise ramènerait toute l'audience à la page 1. C'est
  la raison pour laquelle la reprise ne pousse rien, et elle vaut encore.
  ⚠️ **Aucun piège de migration ici, et le banc le prouve au lieu de le supposer** : on **lit**, et
  la lecture se fait en `select=*`, donc chez un hôte non migré la colonne est simplement absente
  (`undefined` → 0). Le rejet du PATCH entier sur colonne inconnue ne concerne que l'écriture.
  ⚠️ **La liste blanche des quatre orientations n'est plus écrite qu'une fois.** Elle était en dur
  dans l'écriture ; la lecture en aurait fait une seconde copie, et deux copies d'une liste blanche
  sont une divergence en attente — c'est exactement ce qui venait d'arriver entre le serveur et le
  navigateur sur le **type** accepté.

- ⚠️ **Le scan ZAP annonçait « alerte non triée » quand il ne s'était pas terminé du tout, et
  envoyait son lecteur trier ce qui n'existait pas.** Le 27/08 (course 33102994676),
  `zap-baseline.py` s'est interrompu sur la surface `doc` après trente secondes : aucune ligne
  `PASS:`, aucune ligne de synthèse `FAIL-NEW: … PASS: …` là où les deux autres surfaces en
  impriment soixante-trois et une. Un témoin indépendant le confirme deux étapes plus bas — « there
  will be 2 files uploaded », **deux** rapports pour **trois** surfaces. Il n'y avait pas d'alerte
  non triée : il n'y avait pas eu de tri. Le message renvoyait pourtant vers `.zap/rules.tsv`, où
  il n'y avait rien à trier, et vers un rapport jamais écrit.
  ⚠️ **La cause tenait en deux caractères** : `|| echec="$echec $cible"` écrasait tous les codes non
  nuls en un seul fait, puis la ligne suivante nommait celui qu'elle savait dire. C'est la classe de
  défaut que ce dépôt retire partout ailleurs depuis le 21/08 — deux rouges différents sous un seul
  code — et l'étape ZAP était le dernier endroit où elle vivait, dans du shell plutôt que dans du
  JavaScript. La décision vit maintenant dans `tools/verdict-zap.mjs`, avec `resultat-garde` :
  **violation** (le scan a conclu, l'alerte attend dans la branche) ou **non concluant** (le scan
  n'a pas conclu, le correctif n'est pas dans la branche).
  ⚠️ **Et le vert était aussi vulnérable que le rouge** : rien ne vérifiait qu'un scan sorti en 0
  avait écrit son rapport. Un scanner muet rendant 0 passait pour une surface saine — la vacuité que
  l'en-tête du même fichier condamne deux étapes plus haut (*« un scan d'un 404 est vert et vide »*).
  Le rapport HTML est désormais la **preuve** exigée de chaque surface, et c'est son croisement avec
  le code de sortie qui donne le verdict — jamais le code seul, dont la table n'est pas mesurable
  hors CI. Six mutations, six rouges. **Rien à faire côté hôte.**

## [0.1.142] — 2026-08-27

⚠️ **La 0.1.141 n'existe pas, et voici pourquoi.** Son tag a été poussé sur le commit de `main`
*précédent* la fusion du train — un commit où `package.json` déclare encore `0.1.140` et où cette
section n'existait pas. Le job `verifier` a refusé (`tag v0.1.141 != package.json version`) et
**rien n'a été publié** : ni npm, ni Release, ni attestation. La garde a fait exactement son
travail, sur la sortie même du dépôt.

Le tag ne peut pas être retiré — le ruleset des tags interdit leur suppression, ce que
`docs/RELEASING.md` annonçait déjà (*« tag protection then makes awkward to withdraw »*). Plutôt
que de désarmer cette protection pour contourner sa propre garde, ce train sort en **0.1.142** : le
tag mort cesse alors d'être le plus haut, et `image-reconcile` — qui exige que le plus haut tag ait
une image servie — redevient sain sans qu'on touche à rien. Le numéro sauté est le prix, et il est
écrit ici pour qu'aucun lecteur n'ait à deviner.

### Security

- ⚠️ **Dix étiquettes d'erreur que l'appelant choisissait, et rien ne les bornait.**
  `route: String(body.action || "(sans action)")`, écrit dix fois à l'identique dans trois fichiers
  de routes. `body.action` vient du corps de la requête, donc de n'importe qui muni d'un lien : un
  mégaoctet de texte, des retours à la ligne, des guillemets, des octets de contrôle. Ça partait
  ensuite dans le puits d'erreurs de **l'hôte** — Sentry, un journal ligne-par-ligne, un fichier —
  dont ce paquet ne connaît ni le format ni les échappements.
  ⚠️ **Ce qui est empêché n'est pas « une grosse chaîne », c'est la forgerie de structure** : un
  saut de ligne ouvre une entrée de journal qui n'a jamais eu lieu, un guillemet ouvre un champ dans
  un puits qui concatène du JSON. Seuls les caractères dont une action est faite traversent
  désormais, et la troncature **se dit** (`…`) plutôt que de se lire comme un nom véritable.
  `(sans action)` et `(action illisible)` restent deux constats distincts. Aucune action légitime
  n'est affectée. **Rien à faire côté hôte.**

### Fixed

- ⚠️ **`docs/HOST-CONTRACT.md` demandait aux hôtes plus que ce dont la purge a besoin, et le geste
  « évident » pour s'y conformer aurait été destructeur.** La page disait *« write it with the same
  fingerprint the player computes, and nothing else »* ; la seule propriété nécessaire est que le
  `hash` de la ligne soit le nom de base de l'objet. Un hôte a rapporté le 27/08 un troisième
  écrivain utilisant `preview-fr-v2` là où le lecteur utilise `v2` : parfaitement sain, non conforme
  sur le papier, et réaligner sa formule aurait orphelinné définitivement 908 objets — les fichiers
  portent l'ANCIENNE empreinte dans leur nom. La page distingue désormais l'exigence (le balayage)
  de l'option (partager un clip avec la route du lecteur), et nomme le banc qui tient la propriété.
- **Le tableau des verdicts de `schema` avait perdu sa cinquième valeur.** `indetermine` vivait
  depuis la 0.1.64 (18/08) en ligne de tableau avalée par le paragraphe précédent, faute d'une ligne
  vide — donc rendue en prose, au milieu d'un avertissement sur un autre sujet. Un hôte qui parse ce
  tableau y trouvait quatre valeurs pour cinq possibles.
- **`non-sonde` et `partiel` portent maintenant leur piège dans leur cellule**, comme le fait déjà
  `presenceDurcissement` trois lignes plus haut : la sonde est PARESSEUSE et locale au processus,
  donc ces deux verdicts disent *ce que ce processus a demandé jusqu'ici*, jamais l'état du schéma.
  Un hôte a relevé trois valeurs différentes en une journée sur une base inchangée et a failli
  signaler une régression inexistante.
- ⚠️ **La sentinelle des exemples se réannonçait à chaque tour.** L'issue #412 a reçu son corps puis
  quatre commentaires identiques au caractère près en dix heures, pour zéro information nouvelle —
  le mécanisme de fatigue d'alarme que l'en-tête de `publication.yml` condamne chez les autres.
  Elle ne parle désormais que sur changement de FAIT (version servie ou état d'un exemple), via une
  empreinte portée dans le corps de l'issue. Un aller-retour sur la même version reste un fait neuf.
  ⚠️ Et ce marqueur ne peut plus sortir de son commentaire : l'empreinte est bâtie sur des chemins
  lus sur le disque, et un `>` les fermait en avance — auquel cas la forge aurait comparé à un
  marqueur différent de celui publié, donc alarme répétée sans fin ou muette pour toujours. Relevé
  par CodeQL sur le banc qui vérifiait la forme ; le défaut était sous l'assertion, pas dedans.

### Added

- **`ctx.has(name)` est documentée**, après avoir été mesurée : implémentée dans le contexte
  autonome, appelée par aucune ligne de `server/`, absente du contrat, et recopiée dans 57 fixtures
  sur 45 fichiers. Un hôte l'implémentait correctement sans le savoir, parce que le type la
  déclarait. Rien n'est câblé — la page dit ce qu'elle est, pour qu'une couture qui fonctionne
  cesse d'être un accident à un renommage près de la suppression.

## [0.1.140] — 2026-08-27

**Deux routes qui pouvaient coûter — l'une la disponibilité du serveur, l'autre de l'argent — une
migration qui échouait sur la donnée qu'elle venait réparer, et un assistant qui promettait une voix
que ce paquet ne câble pas.**

⚠️ **CE TRAIN SORT SOUS L'EXCEPTION « CORRECTIF DE SÉCURITÉ », ET DEUX FOIS PLUTÔT QU'UNE.**
`docs/RELEASING.md` autorise un train par jour ; celui-ci part le lendemain de la 0.1.139, donc la
cadence n'est même pas en cause. Ce qui l'est : `bin/serve.js` s'arrêtait sur un en-tête `Host`
malformé — une requête anonyme, sans configuration ni compte — et `bot-tts` acceptait n'importe
quel texte d'un porteur de lien public, à la facture de l'hôte. Les deux partent dès qu'ils sont
verts, ce que cette page appelle par son nom.

⚠️ **ET UNE MIGRATION DÉJÀ PUBLIÉE EST CORRIGÉE SUR PLACE**, ce que ce dépôt interdit par écrit.
La 0020 (sortie en 0.1.135) s'arrêtait à mi-chemin sur toute base portant deux colonnes hors plage
dans une même ligne, laissant les contraintes posées et jamais validées. Un fichier 0024 aurait été
plus orthodoxe et **inopérant** : une base ancienne rejouant la chaîne s'arrête à la 0020 et ne
l'atteint jamais. Pour un hôte où elle est passée, le fichier corrigé est un no-op strict, vérifié
contre un vrai PostgreSQL 16. `zones-du-tarball` lèvera son alarme « a migration already applied
elsewhere must be immutable » sur cette livraison : c'est le traitement que ce changement mérite,
et il est attendu.

⚠️ **LA FRONTIÈRE HÔTE A BOUGÉ TROIS FOIS**, toutes additives. `wiresVoice` conditionne l'affichage
des contrôles de voix ; `bot-tts` exige un `sessionId` ; `doc_tts_objects` devient un point
d'écriture pour l'hôte. Un hôte qui ne touche à rien n'est affecté par aucune : la voix n'était
câblée nulle part, `bot-tts` n'était appelée par personne, et ne rien écrire dans `tts-cache` reste
sans conséquence. `docs/HOST-CONTRACT.md` porte les trois.

Signalé par l'audit CODEX du 26/08, puis par deux hôtes intégrateurs dont l'un a trouvé ce que ni la
forge ni l'audit n'avaient vu.

### Security
- **The voice route could be used as a public, paid API — and the bill was ours.** `bot-tts` accepts
  `body.text` as given: a valid public slug is enough, no session is required, and nothing ties the
  text to an answer the bot actually produced. The per-IP rate limit (400/h) bounds a single
  address's *cadence*; it bounds neither the cost per call, nor the number of concurrent outbound
  calls, nor the size of what we accept back. Three bounds now exist, none of which changes the
  protocol. Reported by the CODEX audit of 26 August.
  - ⚠️ **A hundred concurrent requests for the same text produced a hundred syntheses.** The cache
    check is a `HEAD`, and a `HEAD` cannot see what has not been written yet — so a burst missed the
    cache together and paid for the same clip a hundred times. Requests are now grouped by
    fingerprint: one synthesis, one stored object, one bill, all hundred served.
  - ⚠️ **And the same primitive supplies the ceiling on concurrent paid calls.** `creerCache`'s
    admission limit refuses the request past the ceiling with a retryable `503` instead of admitting
    it. `503` tells the caller to wait a second; `500` would tell it to give up.
  - ⚠️ **The three outbound `fetch` calls had no deadline at all.** A provider that answers slowly —
    or stops answering — held the request, its socket and its admission slot until the platform
    killed the function. `appelHote` and the file relay already carry this lesson; this was the
    route it had not reached. A real abort (`AbortSignal`), not a promise race: a race returns
    without cancelling, so it frees nothing.
  - ⚠️ **The response body is bounded before allocation.** `gen.json()` read whatever arrived,
    base64 audio and alignment array included; the body is a third party's, so its size was not
    ours to assume. It is now read against a ceiling and refused at the first byte past it, without
    reaching storage.
  - What is memoised is what is *shareable*, and nothing more: `spoken` is composed per caller.
    Two different texts can share one pronunciation — that is what `pronFix` is for — hence one
    fingerprint, while `spoken !== text` holds for only one of them. Memoising the whole reply would
    have handed the second caller the first one's spelling, and the karaoke would have aligned on
    the wrong string.
  - ⚠️ **AND THE BINDING ITSELF IS NOW CLOSED — this bullet said "still open" for a few hours.** A
    call must carry a `sessionId`, that session must belong to the requested `slug`, and the text
    must match something the assistant said **in that session**. Refused with `session` (absent, or
    opened on another document) or `texte` (never said). No signed ticket was needed: the truth
    comes from the database that produced the message, not from a token the client holds — so there
    is no new secret to rotate, and a secret you never rotate is the one you forget to rotate.
  - **The comparison is on the *spoken* form, not the written one, and that is stronger.** `pronFix`
    can map two spellings onto the same pronunciation, and the pronunciation is what makes the cache
    fingerprint. So an accepted text is either a real message, or one whose clip is already paid
    for. Comparing spellings would refuse legitimate cases *and* admit billable ones. The idea came
    from an integrating host and was better than ours.
  - **It refuses by default.** A message's shape comes from the host's plugin, which no contract
    described. An unrecognised `role` is not treated as the assistant's, so an unreadable set yields
    an empty one and everything is refused. On a route that spends money, *"I could not verify"*
    must read as **no**. A read that *fails* answers `503 indisponible` and is recorded — an
    operator does not look in the same place for a broken read and a rejected text.
  - ⚠️ **The order of the guards is itself a property.** Placed before the rate limit, the binding
    offered a database read per request to a caller with no session at all — unbounded work
    triggered under the limiter, which is what the limiter exists to prevent. Found by the existing
    ceiling bench, which required `429` *"before any call"* and got `500`. It was already guarding
    the property; we were not seeing it.

- **A host's messages carry their text in `body`, and the reader would have refused all of them.**
  `bot-tts` read the text from `text` or `content`. An integrating host reported — **before hitting
  it** — that its messages use `body` and nothing else, with a correct `role: "bot"`. The reader
  would have returned an empty string for every message, yielding an empty set, so every request
  refused with `400 texte`: refuse-by-default doing exactly what it must, against a perfectly correct
  integration. The list is now `text`, `content`, `body`, first **non-empty** wins — a present but
  empty field no longer masks the next one.
  - The host offered to project `body` into `text` in its own plugin instead. We widened the reader:
    `listMessages` is the host's, and asking every host to rename columns for an undocumented
    preference moves the transformation into all of them, forever, where forgetting it means a total
    silent refusal. The field name carries no security — the **role** filter does, and it is unchanged.
- **`doc_tts_objects` is documented as a host write point, not an internal table.** The sweep removes
  an object only when its fingerprint has a row, and only the player's route wrote one — so anything a
  host puts in the `tts-cache` bucket itself was invisible to retention **permanently**, not just for
  what was already there. The same host measured **908 objects it had written**, under the player's
  *exact* naming (same digest, same two files, same root) — a parity its own code says was deliberate,
  so that one clip serves both surfaces. Nothing but the missing row distinguished them.
  `docs/HOST-CONTRACT.md` now carries the fingerprint recipe and the idempotent insert. No schema
  change, no grant: RLS is on with no policy, and the `service_role` key the `db` capability already
  uses bypasses it.
- **The sweep's report says why `fichiersErreur` can be high without anything having failed.** The
  code claimed the missing alignment `.json` came from pre-`v2` extracts. True, and not the main
  cause: the provider does not always return an alignment. Measured on that host's bucket, **552
  `.mp3` for 356 `.json`** — 196 audio files with no companion to remove, a live case rather than a
  relic. The count stays unmasked; an operator finding two hundred "errors" on a first sweep would
  otherwise hunt a failure that does not exist.

- **Setting `ELEVENLABS_API_KEY` made voice controls appear that nothing in this package wires.**
  The key proves the *server* can synthesise; it says nothing about what happens on click — and this
  package wires **none** of the sixty-four controls in the assistant, which is markup it ships and
  behaviour the host ships. Three voice buttons and the audio-consent step were the only ones whose
  appearance was driven by a server secret, so the key read as *"the feature is on"* and a visitor
  who clicked got silence. Your `bot` plugin must now declare `wiresVoice: true`; absent — or merely
  truthy rather than exactly `true` — the four controls are not rendered. Reported on 26 August by
  an integrating host who went looking for the caller of `bot-tts` and found none.
  - ⚠️ **This file's own bench already carried the rule and looked at the wrong side.** It says, word
    for word, *"a door that leads to silence is a broken promise"* — and checked it **without** the
    key, the one case where the door could not exist.
  - ⚠️ **And `docs/CONFIGURATION.md` claimed the opposite**, twice: *"the browser asks this
    instance"*. A host reading it set a **paid** API key and concluded voice worked. It has never
    been wired, in the whole history of the repository — the route and the buttons both shipped from
    the first commit, the handler never did. `bot-tts` is documented as what it is: an **integration
    point**, not a feature.

### Fixed
- **A malformed `Host` header could stop the standalone server. One anonymous request, no
  configuration, no account.** `bin/serve.js` built the request URL as
  `new URL(req.url, "http://" + req.headers.host)`. `Host: [` yields the base `http://[`, which
  `new URL` rejects — and the throw happened in an `async` listener whose promise `http` never
  awaits, so it became an unhandled rejection and Node exited the process with code 1. Reproduced
  on v0.1.139 before the fix: the connection is cut, the port closes, every later request is
  refused. Reported by the CODEX audit of 26 August; the defect predates 0.1.139.
  - ⚠️ **Nothing here ever read the host.** Only `pathname` and `searchParams` are used, so the
    header contributed its failure and nothing else. The URL is now parsed against a fixed internal
    base, and a malformed request-target answers `400` instead of raising.
  - ⚠️ **The correct form was already written one file away, and this was the diverging copy.**
    `server/handler.js` parses against a fixed base, and the re-share email link left
    `req.headers.host` for `PLAYER_PUBLIC_URL` some versions ago. Twice the same lesson: a public
    origin is *declared*, never guessed from a header.
  - ⚠️ **The catch now wraps the whole request, not just `player.handler`.** The old `try` covered
    the handler only; URL parsing, the folder-mode home page and the JSON body read sat outside it.
    Whatever is added above the handler next is covered by construction.
  - Benched in a **real child process**, because the defect does not exist anywhere else: called
    directly the function merely rejects and the caller learns of it — what kills is that nobody
    awaits the promise. Restoring the old line turns the bench red.

### Added
- **The bounds of an internal reading session, in one place — and a guard for the class, not the
  case.** `upsertInternalSession` redefined `num`, `borne` and the whole `pages_time` loop at the
  top of its body, while `bornerNombre` and `bornerPagesTime` sat forty lines above doing
  character-for-character the same thing. The behaviour was identical — which is exactly what makes
  such a duplicate dangerous: nothing flagged it, and nothing would have flagged the day one of the
  two copies moved. Reported by the CODEX audit of 26 August, P3.
  - **Migration 0023** gives `commercial_doc_internal_sessions` the constraints migration 0020 gave
    the other two tables. It carries exactly the same columns, written by the same bounded code, and
    had received nothing — nobody noticed for a day, because **an absence writes itself nowhere**.
  - ⚠️ **So CI now guards the rule rather than the table.** A probe requires every visitor-reported
    measurement column — in *any* table — to carry a **validated** constraint. A fourth table added
    tomorrow with a `max_page` goes red until it is bounded, and nobody has to remember. It checks
    `convalidated`, not mere existence: a constraint left `not valid` protects new writes and lets
    history through — a legitimate state *during* a migration, never an arrival state.
  - What the probe does **not** watch is written down rather than implied: `current_page`, written
    by the presenter and read by no aggregation, is not bounded in the database today. A recorded
    decision, not an oversight — the day an aggregation reads it, it joins the list.
  - ⚠️ **And closing that duplicate opened a bigger one, so it is guarded too.** `10000` and `86400`
    — the values of `BORNES` in `server/shares.js` — are now copied into the SQL constraints: 18
    times in migration 0020, 9 in 0023, 16 in `init.sql`. Raising `BORNES` without the database
    makes it **refuse** writes the code believes valid; lowering it makes the database laxer than
    the code, and the "last line of defence" the migrations claim stops being one. Neither goes red.
    A bench now reads `BORNES` at its source and requires every **ceiling** in those three files to
    be one of its values — ceilings, not occurrences: only a `check … <=` comparison and the
    `least(greatest(col, 0), N)` repair express one.
- **Analytics aggregation moved into the database — and the JavaScript stays, on purpose.**
  `listSharesForDoc` and `overview` read `commercial_doc_views` over a rolling 24-month window. The
  window bounds **time, not the number of rows**: the index serves the filter and does nothing else
  — it removes neither the PostgREST → Node transfer, nor the full pagination, nor the arrays in
  memory, nor the cost of aggregating in JavaScript. On a very active document, 24 months can be
  millions of events for a reply of a few dozen lines. Migration 0022 adds five aggregating
  functions; the reply is unchanged. Reported by the CODEX audit of 26 August, §3.
  - ⚠️ **Today this hurts nobody, and that is written down so it stays true.** The worst measured
    document carries 662 rows. This is not an incident fix — it is changing the structure *before*
    the volume forces it, while both paths can still be compared line by line.
  - ⚠️ **The in-memory path is not dead code, it is the reference definition.** A host does not
    necessarily apply the latest migration, so it is also the real fallback. A bench against a real
    PostgreSQL runs both on the same rows and requires an **exactly identical** result — two texts
    written separately that cannot be wrong the same way, like the retention purge and its census.
    It does not assert that the numbers are *right*: it requires them to be *the same*, which is
    stronger — an error has to be made twice, separately, in SQL and in JavaScript.
  - ⚠️ **The fallback is narrow, and that is all that makes it safe.** Only `PGRST202` ("no function
    of that name") falls back. An unreachable database, a missing grant or a timeout **propagate** —
    falling back on those would produce numbers computed over whatever answered, and *"wrong
    statistics"* reads exactly like *"statistics"*. Four benches hold that, mutation-checked; a
    fifth holds that an **empty** result is not an absent function.
  - The read-time clamp is reproduced in SQL, including what the JavaScript does *not* do —
    `seconds` is not capped on read. Reproducing faithfully means reproducing the silences too.
    Since migration 0020 the database refuses an out-of-range page, so the legacy row that used to
    trigger the analytics DoS can no longer be seeded: the SQL function is confronted with the
    JavaScript **directly**, on the values a pre-0020 base can still hold.
  - `signatureAbsente` moves from `presentations.js` to `erreurs-base.js` — "this function does not
    exist here" belongs with "this conflict is a conflict". Three modules need it now; copying it
    would have created two definitions of one fact, which is what that file exists to prevent.
    `presentations.js` re-exports it: its public surface does not move.
- **An endurance bench: what a burst cannot show — duration.** Every load bench in this repository
  is *instantaneous*: N calls fired together, one reading, done. `chargeReelle` already covers
  concurrent heartbeats, twenty simultaneous presentations, the file relay, a slowed database, a
  dying database and cost linearity; `coutParGeste` counts round trips; `multiProcessus` holds the
  advisory lock against real system parallelism. None of them can answer *"and if it lasts?"* — a
  slowly rising memory, a cache that only saturates after minutes, an event loop that slips when
  gestures are **mixed**. Three failures invisible in three seconds, and exactly the ones an
  operator meets in production. Asked for by the CODEX audit of 26 August, §3.
  - **It runs short by default, on purpose.** A bench that only runs by hand is a dead bench — this
    repository left a publication guard dead for nineteen hours without anyone noticing. Twenty-five
    seconds on every CI run prove the scenario stands up; the real campaign is
    `PLAYER_ENDURANCE_SECONDES=1800 npm run test:endurance`.
  - **A mixed scenario, not one gesture repeated** — weighted heartbeats, state reads, chat reads,
    card reads and refusals. The mix is what puts the paths in contention for the same database.
  - ⚠️ **The instrument is confronted with reality.** The `mesures` reading was born hours before
    this bench, and a counter that is wrong is worse than no counter: it grants a confidence no
    measurement carries. The bench keeps its own independent tally and requires the two to agree
    exactly.
  - ⚠️ **The saturation ceiling is finally measured** — the one thing both integrating hosts said
    they could not produce. Two hundred distinct keys against a ceiling of 128, under a database at
    +400 ms: the margin is structural, not chronometric. The bench requires that saturation
    *happened* — otherwise a ceiling that became unreachable would leave it green having observed
    nothing, claiming refusals are clean without ever having seen one.
  - Thresholds are drift detectors, wide on purpose, same doctrine as `coutParGeste`. What is
    absolute is **no 5xx** — a server error under nominal load is a defect, not a tolerance.
- **`mesures` on the contract card: what this instance has actually lived through.** `lectureSaturee`
  (0.1.139) answers exactly one question. *Is a route slow? which ones? us or the database? how many
  5xx? is the event loop slipping?* had **no observable answer at all** — and deciding to optimise
  without them is guessing. Both integrating hosts confirmed independently that they cannot produce
  these numbers from their side. Per family of work: `n`, `p50/p95/p99`, `maxMs`; plus response
  classes (`ok`, `refus4xx`, `debit429`, `occupe503`, `erreur5xx`), `rss`/`heap`/`arrayBuffers`,
  event-loop delay, and the latency of the `db` capability. Asked for by the CODEX audit of
  26 August, §2.
  - ⚠️ **Buckets, not samples.** Keeping durations to compute a true percentile would mean a table
    that grows with traffic — a memory leak driven from outside, the trap `server/cache.js` already
    documents. The ladder is fixed, so this module's memory is bounded by construction. There is a
    bench: one call versus five thousand differ by the length of the digits.
  - ⚠️ **A percentile over buckets is a bound, not a value.** `p95sousMs: 250` reads *"95% of calls
    under 250 ms"*, never *"the 95th is 250 ms"* — hence the key name, and hence `seauxMs` shipping
    beside the numbers: without the ladder you cannot judge how precise what you are reading is.
  - ⚠️ **"Not measured" is never rendered as zero.** A family never exercised is absent; an
    event-loop histogram with no samples reports `moyen: null`. A `0` there would read as *healthy*.
    And the loop delay has its sampler resolution subtracted — otherwise a perfectly idle instance
    would report a permanent 20 ms and send someone hunting a fault that does not exist.
  - ⚠️ **The database is measured at the seam, not at 67 call sites.** The capability is supplied by
    the host; remembering to time each call would mean never forgetting once, and the first lapse
    would go unnoticed. Wrapped at `init`, it covers calls nobody has written yet. Benched to return
    the same values and the same rejections: a decorator that changes the contract measures
    something other than production.
  - ⚠️ **No slug, no address, no text** — counters and durations only, checked structurally by a
    bench that walks every leaf. That is what makes it publishable on a card a host reads without
    ceremony. Process-local and reset by every deployment, like `lectureSaturee`.
  - ⚠️ **The wrapper delegates to the live object; it does not photograph its methods.** The first
    version captured `db.request` at wrap time, so anything replacing it *after* `init` stopped
    being called — silently. Not a hypothetical: CI went red on it. A bench installs its probe after
    `init`, and a host has exactly the same right (a retry wrapper, a lazily wired client,
    instrumentation). The context itself is inherited rather than copied, for the same reason.
    **A measurement that changes what runs is not a measurement.**
  - The event-loop sampler is enabled at import, and **the graceful-shutdown bench is what guards
    it**: `bin/serve.js` loads this module, so if the histogram held the loop open, `SIGTERM` would
    stop exiting 0 and that bench would go red.
- **The voice cache was unpurgeable by construction — not for want of a policy.** Every synthesis
  writes two objects to the **public** `tts-cache` bucket, `<fingerprint>.mp3` and
  `<fingerprint>.json`. The fingerprint is a digest of voice + model + spoken text, and it tied back
  to **no row anywhere**. The retention sweep erases rows, and for files it erases the ones a row
  points at — the host `storage` capability exposes `put` and `remove`, never `list`. There was
  literally nothing to walk: no window, no setting and no policy could reach that bucket. The CODEX
  audit of 26 August costed this at "half a day of policy"; what was missing was not a policy, it
  was the trace.
  - **Migration 0021** adds `doc_tts_objects`: a fingerprint and a date, and **never the text** —
    writing the text there would recreate, inside the database, whatever personal data the bucket
    may already hold, and make it queryable, which is strictly worse than not having it. RLS on with
    no policy: under RLS an absent policy refuses everyone, service role aside.
  - The sweep now purges the voice cache **13 months** after `created_at`, through the same single
    destruction door the whole engine uses — `retirerFichier` takes its bucket as an argument rather
    than gaining a twin, which is exactly what `retentionUnePorte.test.js` exists to prevent.
  - ⚠️ **The row leaves after the objects, never before.** Erasing the trace first would leave both
    objects permanently unreachable — we would have purged the only means of purging them.
  - ⚠️ **The trace is never blocking, and never silent.** A failed write must not leave a
    presentation mute, so the voice wins; but a silent rejection is indistinguishable from an empty
    cache — the lesson of the internal session dropped without a word, which cost a host weeks. Said
    once an hour, with what it costs: those objects will sit outside every window.
  - Stated rather than simulated, in `docs/RETENTION.md`: **objects written before migration 0021
    have no trace and never will.** The sweep only reaches what a row points at. The census counts
    rows, so it can say "no trace past the window survives" — never "the bucket is clean".
- **`AGENTS.md` records the one thing no guard in this repository can check: who the work was for.**
  Eleven rules were added to `tools/` between 23 and 26 August; every one of them compares a file to
  a property, and none can say that correct work was addressed to nobody.
  - ⚠️ **The incident is the 0.1.139 headline itself.** Removing `dumb-init` was the better call and
    remains one; the graceful shutdown that made it possible was right and benched against real
    signals. **Both integrating hosts run serverless** and consume no image. Nothing was wrong with
    the work — the question *"who runs this?"* was never asked, and **a defect that was hiding and a
    question that was not asked are not found by the same means**. The first yields to a probe.
  - ⚠️ **And the topology turns out not to be derivable — measured, not assumed.** An integrating
    session tried to remove the need rather than remember it: `lectureSaturee.fenetreS` is
    `process.uptime()`, so a function process should stay young while a container ages. Five
    readings 25 s apart on their production: `224 249 274 300 325` — **+25 for 25, five times**. The
    same warm lambda answers every call and ages exactly like a container. The remedy is therefore
    not discipline but necessity: an integrator has to *declare* their topology.
  - The dead idea is recorded with its numbers, on purpose: three paragraphs now against half a day
    for whoever re-derives it in three months without knowing it was tried.

## [0.1.139] — 2026-08-26

**A graceful stop, an image with nothing left to fetch, and a guard that had died in silence.**

⚠️ **This train leaves out of cadence, and none of the three exceptions applies.**
[`docs/RELEASING.md`](docs/RELEASING.md) allows one train per day; 0.1.138 shipped this morning.
This is not a security fix, not a broken package on the registry, and not a repair of the release
pipeline — 0.1.138 published all five of its artefacts. It ships today because the maintainer
decided it does, which is what that page says the decision is. Nothing here forced it.

**Nothing an operator runs changes shape.** Measured on the two tarballs rather than claimed:
**64 files → 64**, none added, none removed, **five changed** — `package.json`, `docs/HOST-CONTRACT.md`,
`server/cache.js`, `server/handler.js`, `bin/serve.js`. `context`, `types`, `database` and `browser`
are untouched, and the bundle a visitor's page executes is **byte-identical** to 0.1.138
(`server/browser.generated.js`, `sha256 ad3af9dc56479147…`, 16 809 bytes; `shared.generated.js` and
`dist/bridge.js` likewise).

⚠️ **Two changes are worth reading before you deploy**, both about how the container stops and what
it contains:

- `docker stop` now **drains** instead of cutting. In-flight requests get up to
  `PLAYER_SHUTDOWN_GRACE_MS` (default 8 s) to finish. **Keep it below your orchestrator's kill
  delay** — `docker stop` waits 10 s by default.
- The image **no longer carries `dumb-init`**. Node runs as PID 1 and handles the signal itself. If
  you extend the image with something that spawns child processes, add an init back or start it
  with `docker run --init`.


### Fixed
- ⚠️ **The `.env.example` check read prose as data.** It lived inline in `ci.yml` and pulled *every*
  backtick-quoted uppercase token out of `docs/CONFIGURATION.md`. The day that page mentioned
  `SIGTERM`, `SIGINT` and `SIGKILL` — **signal names, in a sentence** — it demanded them in
  `.env.example`. A check that asks you to bend your prose to please it teaches its readers to write
  for the machine.
  - ⚠️ **The obvious remedy was worse, and measuring said so before it was written.** *"Read only
    the `### \`NAME\`` headings"* looked clean: the page carries **two**, while documenting
    thirty-nine variables elsewhere in tables and inline mentions. The guard would have gone green
    by looking at almost nothing — the too-tight pattern, fourth time this week.
  - What actually tells a variable from a word is that it **exists elsewhere**: the code reads it,
    or the example file carries it. The rule now lives in `tools/env-exemple.mjs`, which asks
    `env-lues.mjs` for its AST inventory instead of keeping a second one — and **counts and names
    what it sets aside**, because a guard that hides what it did not look at claims coverage it does
    not have.
  - The set-aside is not an escape hatch: a variable the code *reads* is kept, even when both files
    forget it. Otherwise the exception would swallow the rule.
- **The startup line printed the port it was asked for, not the one it got.** With `PORT=0` — where
  the OS picks a free one — it announced `localhost:0`, an address that leads nowhere, at exactly
  the moment you need to know where to knock. Found by the shutdown bench, which could not reach
  the server it had just started.
- **`Dockerfile`: `dumb-init`'s stated justification no longer held.** It said Node had no default
  signal handler, which was true and is not any more. What remains is zombie reaping — real in
  general, **empty here**: this runtime spawns no subprocess (checked: no `spawn`, `execFile` or
  `fork` in `server/`, `bin/` or `context/`). It is kept out of caution rather than demonstrated
  need, and the comment now says so instead of asserting a reason that has been fixed elsewhere.
  It also records that `dumb-init` is **the one unpinned input** of that image, and why the version
  could not be resolved from where this was prepared.
- ⚠️ **The hourly publication guard had been dead for nineteen hours, and nobody could have seen
  it.** `publication.yml` only does a `checkout` — no `npm ci` — because none of the tools it ran
  had ever needed `node_modules`. Then `exemples-epingles.mjs` gained a dependency on `semver` in
  0.1.137, to compare version *intervals* instead of demanding a literal string. That was the right
  change; the workflow did not move with it. From that publication on, the step threw
  `ERR_MODULE_NOT_FOUND` before measuring anything.
  - **It is the worst place to break.** The job goes red — on the *scheduled runs* page, which
    nobody opens. Meanwhile the issue that step maintains stayed **frozen on its last true state**:
    it still announced `0.1.128` while the registry served `0.1.138`. A stale alert that looks alive
    is worse than an absent one — it is `AGENTS.md`'s third storey, an action that resembles a
    success.
  - The breakage was **contained**: the earlier steps of the same job kept working, which is why
    the version-gap alert for 0.1.138 opened and closed itself correctly. Found by reading that
    job's log after noticing it was red on three consecutive runs — not by an alert.
- ⚠️ **The changelog carried two `### Fixed` sections under one version.** Same shape as the doubled
  `## [Unreleased]` closed a day earlier, one level down: two branches each opened their own
  subsection, git merged both without a conflict. The guard added for the first case reads only
  `##` titles, so it stayed green — **a rule fixed at one level does not protect the level below**.
  It now refuses a repeated `###` inside a version too. Found the same way as the first: by a merge,
  not by the guard.
- **`docs/RELEASING.md` gave a command that returns `404`.** Its post-release checklist said
  `docker manifest inspect ghcr.io/…:<version>`, but `image.yml` pushes the git tag verbatim, so the
  image is `:v0.1.138`. The `gh release view v<version>` two lines above already carried the `v` —
  the inconsistency lived four lines apart. Found by following the page during the 0.1.138 release
  and getting the 404, which is the only way it could have been found: a registry answers `404` for
  *does not exist* and for *you asked for the wrong name* with the same three digits. The page's own
  closing rule applies to it — *a procedure that cannot be carried out is worse than no procedure*.

### Removed
- ⚠️ **`dumb-init` is gone from the container image, and the image now fetches nothing at build
  time.** Its written justification — *"Node is PID 1 and has no default signal handler, so
  `docker stop` would wait ten seconds before killing"* — was correct, and died when `bin/serve.js`
  gained a `SIGTERM` handler: the kernel discards a signal on PID 1 **only** when no handler exists.
  What remained was zombie reaping, a real job **that is empty here** — this runtime spawns no
  subprocess.
  - **It was the one unpinned input of the image.** `apk add` fetched the package over the network
    with no version: same Dockerfile, same base digest, two different `dumb-init` three months
    apart. Pinning it by checksum **was written, then discarded**: four moving parts — a build-time
    network dependency, two digests to maintain, an architecture branch, and a hand-rolled
    downloader because the alpine image carries no certificate store — for a component whose job is
    empty. Removing it deletes the problem instead of checking it, and makes the build reproducible
    **unconditionally**.
  - ⚠️ **The assumption is guarded, not left in a comment.** `bin/__tests__/sansSousProcessus.test.js`
    refuses the first `child_process` added to `server/`, `bin/` or `context/` — and its message
    says the gesture: put an init back, or document `docker run --init`, then update the bench. The
    decision is re-asked at the exact moment it becomes true again, instead of sleeping.
  - ⚠️ **The `CMD` stays in exec form, and that now matters.** `CMD node bin/serve.js` would put
    `/bin/sh` at PID 1, and a shell **does not relay signals to its child**: the handler would never
    run and the graceful shutdown would be worthless. The bench holds that too.
  - Operators who need reaping are not stuck: `docker run --init` injects one without touching the
    image, and `docs/CONFIGURATION.md` says so.

### Changed
- **`claude[bot]` joins the CLA exemption list, on the maintainer's explicit decision.** It is the
  *same agent* as `claude`, under the identity GitHub assigns depending on how the contribution
  arrives: a pull request opened through the API comes out authored by `claude[bot]`, the same one
  opened otherwise comes out as `claude`. Measured on 25/08 — PR #392 was refused by this check for
  that reason alone, on content identical to what had passed the day before.
  - ⚠️ **This is not a technical fix, and it waited on purpose.** Widening a CLA exemption list
    decides *who contributes without signing* — governance, not tooling. On the day the refusal
    landed, the tempting move was to loosen the guard to unblock a pull request; that is precisely
    what one does not do. The PR was closed and reopened through the normal path, the gap was
    reported, and the list moved only once the maintainer decided (26/08) — by the same reasoning as
    its two neighbours, which are already there in their `[bot]` form.
  - **The widening stops at named identities.** A bench holds that `claude-fork[bot]`,
    `notclaude[bot]` and `claudebot` still have to sign: the exemption covers accounts, never a
    shape. Without it the list could drift toward *anything ending in `[bot]`*, which would let
    through any third-party app installed on the repository.

### Added
- ⚠️ **The standalone server shuts down gracefully — nothing listened for `SIGTERM` before.** The
  choice was between *slow* and *abrupt*, and the third way had never been put. Without a handler,
  Node as PID 1 **ignores** `SIGTERM` (the kernel discards a signal on PID 1 only when no handler
  exists), so `docker stop` waited ten seconds and killed. `dumb-init` fixed that by being PID 1
  itself, making Node a child — where the relayed signal triggers the default action: **immediate
  termination**. Fast, but a document being relayed, a presentation read, a heartbeat were cut
  mid-flight at *every deployment*.
  - It now stops accepting, closes idle keep-alive connections, lets in-flight requests finish, and
    exits — **with or without `dumb-init`**.
  - ⚠️ **`close()` alone never completes**: it waits for every connection, and keep-alive holds idle
    sockets open for seconds after their last request. A shutdown that waits for those overruns the
    orchestrator's deadline and gets killed anyway — an abrupt shutdown, only *slower*.
    `closeIdleConnections()` closes what is no longer serving, without touching what is.
  - ⚠️ **The grace period is bounded**, and deliberately under `docker stop`'s ten-second default: a
    deadline that falls after the axe is no deadline. `PLAYER_SHUTDOWN_GRACE_MS` (default **8000**)
    is documented, along with the rule that raising it means raising the orchestrator's too.
  - A second signal exits at once — pressing Ctrl-C twice asks for a stop, not an explanation. The
    handlers are installed **only** on direct execution, like `listen`: installed on import they
    would hijack the Ctrl-C of whatever imported the module.
  - Benched against a **real child process and real signals** — a simulated signal proves nothing.
- **The identity card reports what the read cache actually refused.** `lectureSaturee` gives
  `{ total, fenetreS, derniereIlYaS }` on `GET /api/doc?contract=1`. The admission ceiling has
  answered `503 Retry-After: 1` for a long time — a refusal, deliberately distinguishable from a
  `500` — but **nothing counted how often it was reached**, so *"do we actually saturate?"* had no
  observable answer. That is the one question §2 of the CODEX 5.6 audit turns on, and the audit
  itself said to wait for a measurement before merging anything on the hot path. This is that
  measurement; no behaviour changes.
  - ⚠️ **`total` never travels without `fenetreS`.** `total: 0` does not mean *we do not saturate*
    — on a process that started four seconds ago it means *nobody has looked yet*. That is the same
    trap as `presenceFusion: "inconnu"`, and it is why the three keys are one object rather than
    three fields a host could read apart.
  - `derniereIlYaS` is `null` when there has been no refusal, not `0` — which would read as
    *just now*.
  - **Process-local**, like the `presence*` fields: behind a load balancer this is the count of the
    instance that answered. Aggregating is the host's job, and implying otherwise would be worse
    than returning nothing.
  - Additive, so the `contract` number does not move (rule 2).
- **A guard that refuses a workflow step running a tool the job cannot serve.** If a job runs
  `node tools/…` and that tool needs an installed package, the job must carry `npm ci`.
  - ⚠️ **It follows the dependency *through* the imports**, because that is where the defect lived:
    `exemples-en-retard.mjs` does not import `semver` — it imports `exemples-epingles.mjs`, which
    does. A probe reading only the file named on the command line would have gone green on the exact
    fault it was written for.
  - It is **not** an oversight rule, it is a distance rule. Whoever adds an `import` to a tool does
    not re-read nine workflows to see which ones run it, and is right not to: that is not work done
    from memory. Three tools legitimately run with no installation, need nothing, and the guard says
    so in its green line rather than staying silent about them.
- **A guard that refuses a documented image reference the registry would not serve.** Outside the
  workflows, every `ghcr.io/…` reference must be untagged, `latest`, or `v`-prefixed — the form
  `image.yml` actually publishes. It does not hold a second copy of that fact: it **confronts**
  `image.yml`, and if the workflow stops requiring `^v[0-9]+\.[0-9]+\.[0-9]+$` the guard reports
  *inconclusive* rather than keep enforcing a rule the forge no longer applies.
  - ⚠️ **Its first version missed the very defect it was written for.** `<` was not in the tag's
    character class, so `:<version>` — a documentation *placeholder*, not a real tag — read as
    "no tag at all" and passed. Green on the exact line that had prompted it. The bench caught it;
    this is the third pattern written too tight this week.
  - The rule is deliberately permissive: a tag without the `v` is the fault, an unexpected tag is
    not. Demanding an exact version shape would accuse `latest`, an example, or a shell variable.
    Registry API URLs (`https://ghcr.io/v2/…`) are excluded by the `://` before them, and the
    changelog's own quotation of the bad form excludes itself — `…` is not an OCI character, so no
    filename exception has to be remembered.

## [0.1.138] — 2026-08-26

**A security fix, and two doors that did not exist.** A visitor holding a valid link could store a
value that made the statistics page exhaust the heap — one row was enough, it persisted, and it
fired when somebody else opened the overview. If you run an instance with tracked links, this is
the release to take.

**⚠️ Operators: apply migration `0020` before or with this upgrade.** It adds bounds to
`commercial_doc_views` and `commercial_doc_sessions`, repairs any out-of-range history, and only
then validates — in that order, because a validated constraint on an already-poisoned table fails.
`supabase/init.sql` carries the same constraints for a fresh install, and a catch-up block for a
base created before them.

Measured on the two tarballs rather than claimed: **62 files → 64**, exactly **two added**
(`server/reponses.js`, `supabase/migrations/0020-mesures-bornees.sql`), **none removed**, nine
changed. All of the change is in `server`, `cli`, `database` and the manifest; `documents`,
`context`, `types` and `browser` are untouched — **the bundle a visitor's page executes is
byte-identical across the two releases** (`server/browser.generated.js`, `sha256 ad3af9dc56479147…`,
16 809 bytes; `shared.generated.js` and `dist/bridge.js` likewise).


### Fixed
- ⚠️ **Twenty JSON responses declared their type and none forbade sniffing.** The JSON reply helper
  was defined **thirteen times**, identically, under four names (`jp`, `jd`, `j`, `jv`) across four
  route files — plus seven bodies written out by hand and five inline replies elsewhere. Found by
  measuring the text fix below, not by looking for it.
  - **This is not twenty oversights.** It is what a recipe becomes once it is copied: the first
    copy was correct, and it is the *correction* that does not propagate. `nosniff` was added
    repository-wide in 0.1.7; the API routes were the one place the rule stopped, because no scan
    visits them.
  - There is now **one** module holding the doors — `server/reponses.js`, depending on nothing, so
    the route families can require it without closing a cycle with `handler.js`. The short local
    names stay, as a **single line that delegates**: the convenience was legitimate, the recipe
    inside it was not. **The 95 call sites do not move** — a fix that rewrites 95 lines to correct
    13 reads badly and verifies worse.
  - **The bodies are unchanged, byte for byte** — measured, because a body that changes shape would
    change the contract hosts depend on. `{"ok":false,"error":"unknown-action"}` still goes out
    exactly as it did.
- ⚠️ **Three text responses left this server without the rule the repository had already written.**
  The `500` at the end of `/doc` posted a status and a body and **nothing else** — no
  `Content-Type` at all, the one body a browser was allowed to guess. The `400` "no document
  requested" posted the type but not `nosniff`. And both text responses of `bin/serve.js` rewrote
  the recipe by hand, in the one file where the player could not post it itself. Found by the CODEX
  5.6 audit, 25/08.
  - The rule was not new: `refuserEnTexte()` exists precisely for this, added a month earlier when
    the first ZAP baseline scan (rule 10019) found the relay's refusals bare. **A rule reapplied by
    hand is reapplied badly** — the same lesson as the funnel bounds written in two places out of
    three. So there is now **one** function through which a text body leaves this server, and
    `bin/serve.js` calls it rather than keeping a second copy, exactly as it already does for
    `POLITIQUE_PERMISSIONS`.
  - ⚠️ **It now survives headers that have already gone out.** Its first caller is the `catch` of
    `/doc`, and an error can arrive there *after* `sendHtml` has begun writing: `setHeader` then
    throws `ERR_HTTP_HEADERS_SENT` **inside the recovery itself**, turning a reported error into an
    unhandled rejection. A naive fix would have introduced that. Nothing can be posted at that
    point, so it closes the stream and stays quiet — the error has already gone to
    `errors.capture`.
  - ⚠️ **ZAP could not have seen any of this.** The scan visits three served surfaces; an exception
    `500` and a missing-parameter `400` are on none of them. What a scanner reaches depends on what
    it is given to visit — which is exactly why the guard below reads files instead.
- ⚠️ **The `[Unreleased]` section had been written twice.** Two branches each opened their own,
  git merged both without a conflict — the file then carried two identical titles, and
  `sectionDe()` (which the release preflight uses to extract a version's notes) stops at the first.
  Half the notes would have shipped missing, silently. The two sections are merged here, and
  **the guard now refuses any repeated section title**: this was invisible to it because it only
  ever read version numbers and the footer link, never the headings themselves.
- ⚠️ **A stored denial of service in the analytics funnel.** A visitor holding a valid link could
  post `{"event":"page","page":2147483647,"maxPage":2147483647}`. `logView()` checked only that the
  number was finite, the `integer` column accepted it, and the overview's funnel then looped from 1
  to that value — **measured: `FATAL ERROR: JavaScript heap out of memory` in eight seconds**, on a
  single stored row, with the process capped at 512 MB. One row was enough, it persisted, and the
  trigger was **someone else opening the statistics**, later. Found by the CODEX 5.6 audit on
  v0.1.137, reproduced here before being believed.
  - The bounds already existed **275 lines below**, added against exactly this class of defect on
    the two *session* paths. `logView` was the third path, missed when the other two were closed.
    So the fix is not "bound here too": there is now **one** function through which a measurement
    enters the database, and one through which a page is read back. There is no second place left
    to forget. (`AGENTS.md`, the rule written while fixing this: you do not check the crossing, you
    remove it.)
  - **The database is no longer assumed clean.** Bounding writes protects future rows; the ones
    already stored remain. Every read of a page value is clamped, including the ones that are only
    *displayed* — "this reader reached page 2 147 483 647" is a false number served to a human who
    decides.
  - **The funnel is now O(pages + sessions)** — histogram plus descending cumulative — instead of
    rescanning every session per page. Equivalence with the previous implementation checked on
    3 000 random draws and six edge cases. On legitimate values it also matters: 10 000 pages ×
    400 sessions was four million comparisons for a result two passes give exactly.
  - **Migration `0020`** adds `CHECK` constraints on both tables, `NOT VALID` first, then repairs
    out-of-range history, then validates — in that order, because a validated constraint on an
    already-poisoned table fails, and a migration that fails on the data it came to repair is one
    an operator stops running. Mirrored into `supabase/init.sql`.
- ⚠️ **Nine route failures returned 500 without reporting anything.** The body of `bot-tts` — and
  eight sibling routes across `routes-agent`, `routes-direct` and `routes-liens` — was wrapped in a
  bare `catch` that returned `{ ok: false }`: no stack, no message, no call to `errors.capture`.
  That is why the `crypto` defect fixed in 0.1.137 lived through two releases: **a host's
  monitoring could not have seen it even correctly wired** — the route was silent, not their
  instrument. It was found by reading the code, not by watching it.
  - It was a repeated omission, not a doctrine: `handler.js`, `presentations.js` and `retention.js`
    have captured for a long time, and exactly one of the ten route catches did. All nine now
    report the error and name the request's **actual action** before returning 500 — each catch
    covers a *block* of actions (the one in `routes-agent` covers eight), so a fixed label would
    have lied on eight calls out of nine.
  - All nine paths are covered by a bench, not just the one that broke. The first version covered
    `bot-tts` alone and said so; CI refused it on coverage, and was right — nine silent failures
    replaced by nine untested reporting paths is the same fault, smaller. Statement coverage goes
    from 90.31% to **90.81%**.

### Added
- **A guard that refuses a hand-written text body sent without its type and `nosniff`.** It reads an
  **AST**, not a pattern: this repository has paid three times for regex guards — `uses:`, `FROM`,
  and `crypto`, where the last one accused the very file it had just had fixed.
  - **A second rule closes the JSON door rather than counting oversights.** The thirteen copies all
    sent a *computed* body (`res.end(JSON.stringify(obj))`), which the first rule does not look at
    and should not. What they had in common was **declaring the type** — each deciding, on its own,
    what accompanies that declaration. So outside `server/reponses.js`, no file may declare
    `application/json`. A fourteenth copy is refused. Other types (`text/html`, `text/javascript`,
    `application/pdf`) are deliberately outside this rule and the guard's header says so: they have
    their own senders, which already set `nosniff`.
  - ⚠️ **Its first version was wrong, and measuring said so.** It flagged every string literal and
    accused seven `res.end('{"ok":…}')` in `routes-liens.js` — seven JSON bodies that post their
    type, line by line. Seven false accusations out of seven findings, the same failure as the
    `docker run` pattern the day before. Corrected in the guard, not in the correct code: the rule
    is the one written by hand three times — *a body in **text** (type absent, or `text/…`) must
    forbid sniffing*. A JSON body declaring `application/json` is not that fault.
- **The registry images CI pulls are pinned by digest.** `postgres:16-alpine` (the real-database
  benches) and `postgrest/postgrest:v12.2.3` ran on moving tags: two runs of the *same* commit
  could prove different things, and a version tag is a publisher's convention, not a property of
  the registry. Both now carry an `@sha256:` digest with the tag kept beside it, exactly as the
  `Dockerfile` rule has required for weeks (CODEX 5.6 audit, 25/08).
  - ⚠️ **A registry image is now *declared*, never written inside a command** — in
    `services.<name>.image`, `container:`, or an `env:` variable named `IMAGE_…`. The first version
    of the guard read `run:` blocks with a pattern and accused three places: `host` (taken out of
    `--network host`) and two images *built locally*, which have no registry and nothing to pin —
    three false accusations out of three findings. A `run:` block is shell; telling an image from
    an argument there means re-implementing `docker run`'s grammar. So the boundary was removed
    rather than checked, and `tools/images-des-workflows.mjs` reads YAML only. It also refuses a
    `$IMAGE_…` used without a declaration, so the convention does not rest on remembering it.
  - **`dumb-init` in the `Dockerfile` is still unpinned** and is named here rather than quietly
    left out: the Alpine package index is unreachable from the environment this was prepared in
    (the egress proxy answers 403), so the version could not be resolved — and inventing one would
    be worse than the gap.
- **The schema parity check now compares constraints.** CI proved that `init.sql` carries every
  column, index, function, trigger, publication and replica identity the migrations bring — but not
  their constraints, so `0020`'s could have drifted between the two files unnoticed. Same blind spot
  already closed twice, for nullability and for triggers.
- **The migration guard reads `DO` blocks**, which it used to strip as function bodies. A `DO`
  block is not a body someone calls later — it is code the migration *executes*, so what it
  declares, the migration declares. `0020` puts its six constraints in one (there is no
  `add constraint if not exists` in PostgreSQL) and was accused of leaving no probeable sign. And
  `add constraint <name>` is now itself a sign: `pg_constraint` answers for it.
- **A guard that refuses a Node-only `crypto` method called on the global.** `crypto` has been a
  global since Node 18, so `no-undef` cannot help: the variable *exists*, it just means something
  else — WebCrypto, which has no `createHash`. The list of module-only methods is **derived from
  the running Node** (63 of 65 on Node 22; only `getRandomValues` and `randomUUID` live on both
  sides), never typed by hand.
  - ⚠️ It reads the code with a **real lexer**. Three regex versions were written first, and all
    three were blind — the last one was defeated by a file-glob quoted inside a *line* comment,
    whose slash-star opened a block the pattern closed twenty-four lines later, swallowing the very
    `require` whose absence it was hunting. It accused the fixed file. This repository has paid for
    that lesson twice before, on `uses:` and on `FROM`.

## [0.1.137] — 2026-08-25

**One host-visible fix, one tightened declaration, one new field on the identity card.** Measured on
the two tarballs rather than claimed: **0 files added, 0 removed, 35 changed** — and **30 of those
35 differ only by their two SPDX licence lines**. The five that carry real changes are
`server/routes-agent.js`, `server/handler.js`, `docs/HOST-CONTRACT.md`, `package.json`, and
`server/browser.generated.js` — the last of which changed only in its embedded source digest: the
browser bundle a visitor actually executes is **byte-identical across the two releases**
(`sha256 c399acaed0caf66e…`, 15 863 bytes).

### Fixed
- ⚠️ **`bot-tts` returned 500 on *every* call, on any runtime whose global `crypto` has no
  `createHash`.** The lot-3 extraction moved the route out of `handler.js` without bringing
  `require("node:crypto")` with it, so it leaned on `globalThis.crypto` — whose shape varies by
  runtime. Where only WebCrypto is exposed, the route threw. The import is now explicit, and the
  bench fails without it.
  - ⚠️ **This entry first said "on the first synthesis". That was wrong, and wrong in the direction
    that matters** — it suggested cached calls still worked. They did not: `keyFor()` builds the
    cache key, so it runs *before* the cache is read. The throw always precedes the lookup, and no
    cache hit is ever reached. Corrected on 25/08 after an integrating host measured the ordering
    in the version they were running. If you have `plugins.bot` set, the bot's voice was **entirely
    out of service** from 0.1.135 until this release, not degraded.

### Changed
- ⚠️ **`engines.node` is now `>=22.13.0`, up from `>=22`.** This is a correction, not a new
  requirement: `pdfjs-dist@6.2.108` — the player's only production dependency, the one that renders
  documents — has always declared `>=22.13.0 || >=24`. Between Node 22.0 and 22.12 the package
  said it was supported and ran its rendering engine on a version that engine calls unsupported.
  npm never stopped it: `engine-strict` is `false` by default, so it prints an `EBADENGINE` line in
  the noise of an install and installs anyway.
  - If you self-host on Node 22.0–22.12, **nothing about the player changed** — but you were
    already outside `pdfjs-dist`'s support, and `npm install` will now say so. Move to 22.13 or
    later.
  - The number is derived from the lockfile, not chosen. `node tools/plancher-de-node.mjs`
    recomputes it.

### Added
- **A guard confronting the declared Node floor with the real one.** CI could not have caught the
  above by simply running: `node-version: "22"` resolves to the latest 22.x, so the runner always
  lands above the floor, whatever it is. A rule the verifying environment satisfies by construction
  is assumed, not verified — so the guard reads the version ranges instead of testing them by its
  own presence. It works from `package-lock.json` alone: no `node_modules`, no network, and it
  measures what will actually be installed rather than what happens to sit in a folder.
- **The development floor is now written where a contributor reads it**, and kept honest. It is
  higher than the package's and unrelated to it (`jsdom` requires `^22.22.2 || ^24.15.0 ||
  >=26.0.0`); below it `vitest` does not start, and what it prints instead is a `Startup Error`
  about an npm bug advising you to delete `package-lock.json` — advice that edits a tracked file
  for a problem that is a Node version. Measured on a host running 20.18.1. `CONTRIBUTING.md`
  carries the number and the guard refuses if it drifts from the lockfile.
- **The identity card now reports the runtime.** `GET /api/doc?contract=1` gains
  `runtime: { node, nodeRequired }` — what the process is executing on, and the floor the package
  declares. Additive, so the `contract` number does not move (rule 2).
  - ⚠️ **A configured runtime is an intention, and reading it back does not tell you what ran.**
    Measured on 25/08 at an integrating host: the project setting said `24.x` while the deployment
    serving production ran `nodejs 22`. They could not tell from the outside, and they were right
    that nothing let them — no route anywhere rendered `process.version`, ours included.
  - **Two numbers, no verdict.** The card does not say "supported": that would put a semver range
    evaluator in the server, and this repository has twice paid for parsing a structured format by
    hand. Compare them with your own semver.
  - The patch level is given, not just major.minor — the floor is patch-level (`>=22.13.0`), so a
    truncated version would not answer the one question the field exists for.
- **The three example wirings declare the real floor**, and the rule that checks them derives it.
  It used to demand the literal string `">=22"`, in `examples/demo` alone — so the moment the floor
  moved it refused the *correct* value and named only one of three files. It now compares
  **intervals** against `package.json#engines`: stricter than us is fine, more permissive is not.
  An example is copied verbatim into an integrator's project; the floor it announces has to be the
  package's, not the one true on the day the rule was written.
- **The production floor is written in the document a host actually receives.** `engines` is
  machine-readable and npm only *warns* below it; the only human-readable statement was a
  shields.io badge in the README — a remote image, invisible offline and inside `node_modules`,
  which is exactly where a self-hoster reads. `docs/HOST-CONTRACT.md` — the page hosts pin — did
  not contain the word "node". It now carries the floor, and the same guard refuses if that number
  drifts from the lockfile.

## [0.1.136] — 2026-08-25

**Nothing in this release changes what a host runs.** Measured on the shipped paths rather than
claimed: between `v0.1.135` and this commit, the only file inside the package that differs is
`package.json` — the version, and one development-only tool. `server/`, `context/`, `dist/`,
`bin/`, `types/`, `supabase/` and every published document are untouched.

The Release notes below carry that same fact, computed independently by the release workflow from
the two published tarballs. If the two disagree, believe the tarballs and open an issue.

### Fixed
- **A real signature was scoring zero.** OpenSSF Scorecard rated `Signed-Releases` **0/10** on a
  project that has signed every release since 0.1.130. Not a signature defect — a **naming** one:
  Scorecard v5.5.0 recognises a release signature only by its suffix, from a closed list
  (`.asc`, `.minisig`, `.sig`, `.sign`, `.sigstore`, `.sigstore.json`), read in the source of tag
  v5.5.0 rather than taken on trust. Our Sigstore bundle — with certificate, Rekor entry, DSSE
  envelope and SLSA provenance — was called `attestation.json`, the temporary name the action gives
  it, and counted for nothing.
  - ⚠️ **Release assets are renamed**: the bundle is now
    `discovery-media-player-<version>.sigstore.json`, versioned like the tarball and the SBOM. If
    you script a verification against the asset name, this is the release that changes it. The
    workflow verifies the Sigstore mediaType **before** applying that name — a name asserts a
    format, so the format is checked first.

### Added
- **Release notes now say what changed in the package, by zone.** Computed by the workflow on the
  two published tarballs, never typed: `server`, `context`, `browser`, `browser-types`, `cli`,
  `types`, `database`, `documents`, `manifest` — each with how many files were added, removed and
  changed. A path no zone claims is **named**, not swallowed.
  - The cut inside `dist/` is on the suffix, because the two artefacts have different consumers:
    `dist/*.js` is what the visitors' page executes, `dist/*.d.ts` is what your `tsc` reads. One
    breaks at runtime, the other at build time.
- **A changed migration now stops the reader instead of being counted.** In `database`, *added* is
  an action and *changed* is an alarm — a migration already applied elsewhere must be immutable.
  The block leaves the table, names the files, and carries the unified diff plus the objects the
  migration touches, so you can probe your own database instead of guessing which object to look
  for.
  - ⚠️ It sends you to the **objects**, not to a migration registry. Measured on a production
    database: its registry recorded 9 of the 17 migrations it had actually applied. A registry only
    records what went through one particular path.
- **CI refuses a migration that leaves no sign of its own** — one that cannot be told apart from
  its neighbour by probing a database. See [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md).

### Changed
- **[`docs/VERIFYING-RELEASES.md`](docs/VERIFYING-RELEASES.md) says what a reader cannot establish
  alone.** Two attestations exist per version and neither speaks for the other; the workflow
  already refuses to attach an archive whose digest differs from the registry's, so the gap is not
  in the pipeline but in what someone downloading can prove for themselves. The page adds the step
  that ties a verified archive to the copy you actually install — your own lockfile's `integrity` —
  and records what was checked, when, and by whom.
- **The roadmap states its refusals**, and coverage is published rather than asserted.

## [0.1.135] — 2026-08-24

A train about **what the package actually hands you**. Nothing here changes what the player does;
all of it changes what an integrator finds on disk after `npm install`, and what CI now refuses.

### Removed
- **`docs/README.md` no longer travels in the package.** It was never meant to: a **bare entry in
  `files` is a pattern, not a path**, and npm matches it at any depth — `"README.md"` meant
  `**/README.md` and dragged the one in `docs/` along with it. Measured in four runs:

  ```
  files: ["docs/HOST-CONTRACT.md"]                    → docs/README.md absent
  files: ["README.md", "docs/HOST-CONTRACT.md"]       → docs/README.md SHIPS
  files: ["./README.md", …] or ["/README.md", …]      → docs/README.md absent
  ```

  What shipped was **an index of seventeen documents the package does not contain** — a table of
  contents pointing into the void on the integrator's disk. The line is gone from `files`; npm
  always includes the root README, which a guard now verifies on every run instead of assuming.

### Fixed
- **Nine of the README's twelve relative links led nowhere once the package was installed.**
  `docs/API.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/ARCHITECTURE.md`, the CLA — none of them
  ship. On npmjs.com the page renders and links are rewritten to the repository; inside
  `node_modules` there is nothing to resolve them against. Twelve links are now absolute, in the
  README and in the host contract.
  - ⚠️ The rule is **not** "no relative links". A relative link to a file that *does* ship works in
    the repository, on npmjs.com and offline; it is the link to an absent file that lies. The guard
    derives its perimeter from the tarball inventory, so publishing a document makes links to it
    legitimate with nothing to edit.

### Added
- **CI refuses a document that ships without being decided, and one that was decided and does not
  ship.** The confrontation runs both ways on purpose: the first defect found was an absence that
  looked like a decision, and its mirror — a presence nobody chose — turned out to exist in the
  same package. The symmetry covers documents only; demanding the exact list of shipped code would
  be a second copy of `files` that nothing confronts.
- **CI refuses a relative link in a published document whose target does not ship**, naming
  `file:line`.
- **[`AGENTS.md`](AGENTS.md) records why a self-accusation goes unchecked.** One session wrote that
  a verification our pipeline performs did not exist; the other built on it rather than re-reading
  the workflow, because a claim that costs its author reads as already verified. The rule: state
  **where** a property is held rather than that it is missing — the first can be checked against a
  file, the second against nothing.

### Changed
- **[`docs/VERIFYING-RELEASES.md`](docs/VERIFYING-RELEASES.md) gains what a reader could not
  conclude alone.** Two attestations exist per version — npm attests
  `pkg:npm/discovery-media-player@…` in `sha512`, the GitHub Release attests the `.tgz` in `sha256`
  — and each verifies without saying anything about the other. The release workflow already
  refuses to attach an archive whose digest differs from what the registry serves, so this is not a
  gap in the pipeline; it is a gap in what someone downloading can establish for themselves. The
  page now says which is which, and adds the step that ties a verified archive to the copy you
  actually install: your own lockfile's `integrity`.
  - A table records what was checked from the outside, with the date and the digest, and separates
    **what was measured here from what was reported to us**. An empty row means nobody looked from
    the outside — not that nothing was wrong.

### Decided
- **The package does not ship its CHANGELOG, and that is now written down rather than silent.** It
  was added, then removed within the day. The test that settled it: *remove the document — does an
  **obligation** become unverifiable?* Removing the host contract or the retention policy, yes;
  removing a history, no. What settled it in practice was not the reasoning but a measurement — an
  integrating host upgraded four versions and opened the CHANGELOG zero times. Price avoided:
  **+29 %** on the compressed tarball, growing by one section per release. The shipped README
  carries the address of the history instead.

Package: **62 entries and 319 190 compressed bytes**, against 63 and 320 659 for 0.1.134.

## [0.1.134] — 2026-08-24

An ordinary train. Two behaviour fixes, three expectations written down for hosts, and the badge —
none of them meeting the two exceptions [`docs/RELEASING.md`](docs/RELEASING.md) allows for leaving
outside a train, which is what keeps those two exceptions worth something.

### Fixed
- **A database conflict was recognised by finding `409` anywhere in the error message.** Six call
  sites read `message.includes("409")`. But the message carries the **path**, so it carries the
  slug, the id, the page number. Measured on the shapes the shipped context actually composes:

  ```
  POST  /doc_presentation_attendees                  → 409   conflict  ✅
  POST  /doc_presentation_attendees?slug=eq.demo409  → 500   conflict  ❌
  PATCH /doc_bot_sessions?id=eq.sess-409abc          → 500   conflict  ❌
  GET   /doc_pages?page=eq.409                       → 503   conflict  ❌
  ```

  Three in four. And every site reads `if (!conflict) throw`, so **a genuine 500 was swallowed** and
  the code carried on as though the row already existed. One document whose slug contains `409` —
  a reference number, a date — was enough.
  - ⚠️ **The fact already existed.** `erreur.statusCode` has been set since the PGRST202 fix, and
    that comment says both shipped contexts converge on it. The six sites read the text beside it:
    not for want of a fact, out of habit. `server/erreurs-base.js` now holds the only copy — status
    first, text only in its absence, and the fallback accepts `409` **after the arrow** alone, where
    a status lives and a slug cannot.
- **Three guards knew where the defect was and did not say.** Made to fail one by one to read what
  they render — a test none of them was under, since they were only ever exercised as *green or
  red*. `actions-versions` and `images-epinglees` printed the file without the line they already
  held; the environment guard named the forgotten variable and left you to find it across three
  directories. All three now answer `file:line`.
  - ⚠️ `dockerfile-ast` counts lines from **zero**. Without the `+1` the position would be off by
    one — and a position wrong by one line reads as a correct position, which is worse than no
    position at all. A bench asserts the positions are **distinct**, not merely present.

### Changed
- **Three expectations for host plugins are now written in
  [`docs/HOST-CONTRACT.md`](docs/HOST-CONTRACT.md)**, each earned by a measurement rather than by
  reasoning:
  - **a row written on behalf of a session also carries the document.** On one production host the
    leads table recorded it and the messages table did not: 46 leads verdictable and none crossed,
    1 693 messages **not measurable**. Same incident, same instance, two answers — decided months
    earlier by one column.
  - **the expectation is answerability, not a column name.** That same host then swept eight tables:
    seven already recorded the document, under four different names. Their first sweep looked for
    the two names this page happens to use and would have accused three correct tables.
  - **a database error carries its status as a number**, not inside its message.
- **The session-binding count now names the gap** instead of returning two truncated lists. It
  refused without saying what to fix — the defect a neighbouring guard has a dedicated case to
  forbid, three files away.
- **[`MAINTAINERS.md`](MAINTAINERS.md) records the review that cannot happen here.** A change cannot
  be reviewed by someone who is not its author, and no setting fixes that; it is answered *Unmet* on
  the OpenSSF form rather than dressed up. What stands in for review is named **without claiming to
  equal it**: a guard catches what someone thought to encode, a reviewer catches what nobody thought
  of.

### Added
- **The [OpenSSF Best Practices](https://www.bestpractices.dev/projects/14197) badge** — the only
  one in that row that does not attest to an automatic measurement.

## [0.1.133] — 2026-08-24

⚠️ **`0.1.132` was tagged but never published.** Its CI was red, and the release job refused —
*"we do not publish on red"*. The cause was a bench, not the code the version carried: everything
listed under `0.1.132` below ships here, unchanged. Removing an erroneous tag is an administrative
act, not a command line, so the version number moves on instead.

### Fixed
- **A slug beginning with a dash made `node` refuse to start.** The multi-process bench passed the
  slug as an **argument** to `node -e`; slugs are randomly generated, and one began with `-`, which
  node read as an **option** (`bad option: -aeLmx1Xd3hI`). The bench had been green for days.
  - ⚠️ **The defect was not waiting for a platform, it was waiting for a value.** Three platforms
    would never have found it; one draw did. It is the lesson a second host gave us two days ago — *a
    CI matrix multiplies systems and never data* — landing on the very bench written to illustrate it.
  - Values now travel through the **environment**, which has no syntax: nothing there changes meaning.
    A `--` would have covered the option case only, not the next character the parser cares about.

## [0.1.132] — 2026-08-24

### Security
- **Four more assistant actions took a `sessionId` without tying it to the document.** 0.1.131 closed
  `bot-history`; counting the *actions* rather than the implementations showed three bound out of
  seven, not six. `bot-say`, `bot-nudge`, `bot-book` and `bot-contact` were still open.
  - ⚠️ **What remained open was worse than what had been closed.** `bot-history` *read* another
    document's conversation. `bot-say` **writes** into it and gets an answer; `bot-contact` attaches
    a name, an e-mail and a phone number to another client's session; `bot-book` books a meeting
    there. A door left open on writing is not the same defect as one left open on reading.
  - The pattern to look for was named by an operator running the player: *a check that several
    actions each perform for themselves — count the actions, not the implementations.*

### Fixed
- **A missing purge target no longer aborts the retention sweep, and the contract allows it.**
  `docs/HOST-CONTRACT.md` states that the rate-limit migrations are deliberately outside the card's
  scope because *"a host may provide its own `limits` capability, and on such a host their absence is
  normal, not a defect"*. The sweep purged `player_rate_limits` unconditionally, **fifth of eight**:
  on such a host it threw there, and revoked links and presentations were **never reached**.
  - ⚠️ The trigger wraps the sweep in a `catch` that files the failure as *benign*. Armed, it would
    have stayed **silent and partly inoperative** — which reads like a working sweep and behaves like
    a disarmed one, on half the tables. Worse than either honest state.
  - The skipped target is **reported**, not omitted: a report without the line reads as "nothing to
    delete", which is a different claim — and the only one of the two that is false.
  - The detector is as narrow as `signatureAbsente`: the PostgREST code for an unknown table, or its
    message, and nothing else. A bare 404 is not enough, and a **failure** on the same table still
    aborts — a bench asserts it.
  - Found in **pre-flight**, before arming the sweep on an instance: measure what a purge would
    delete before authorising it to delete.

## [0.1.131] — 2026-08-24

Published on its own, outside the train, because of the first entry — the rule
[`docs/RELEASING.md`](docs/RELEASING.md) sets for a security fix.

### Security
- **`bot-history` returned the transcript of a conversation held on *another* document.** Two of the
  assistant's three session-bearing actions bind the session to the document they act on
  (`sess.share_slug !== share.slug`, a refusal `bot-rate` and `bot-script` each perform themselves).
  The third took a `sessionId` and returned the conversation, without ever tying it to the requested
  document. A slug whose assistant is enabled, plus a session id picked up elsewhere — and the id
  travels client-side — were enough to read the questions asked by someone else's prospect. That is
  commercial data about a client, not a usage counter.
  - ⚠️ **This filtering cannot be delegated to the host.** `docbot` is `ctx.plugins.bot`, supplied by
    whoever embeds the player: assuming it cross-checks session against document would make a player
    security property depend on code the player does not contain. It is exactly why the two
    neighbouring actions check it themselves rather than trusting the plugin.
  - The bench for that binding existed and covered **two actions out of three**. A guard written
    three times and tested twice is the shape this repository keeps finding: the missing one is
    never the one you look at.

### Fixed
- **The dependency gate blamed the branch for an unreachable registry.** Its own comment promised the
  opposite — *"it is the guard that could not look, not the branch. We say so"* — but the step read
  `npm audit`'s **exit status**, which is non-zero for two unrelated causes: vulnerabilities found,
  or no answer from the registry. The second was reported as a *known vulnerability* against a
  branch that had none.
  - `tools/failles-connues.mjs` reads the **report** (`metadata.vulnerabilities`) instead of an
    integer that conflates two causes, and answers `2` — *GARDE NON CONCLUANTE* — when there is no
    report. That tri-state has been in `tools/resultat-garde.mjs` for a while; this step simply was
    not using it. Both thresholds and their documented reasons are unchanged.
- **The secrets guard refused a standard dotenv idiom.** `PLAYER_IP_HASH_SECRET=   # openssl rand
  -base64 48` — an **empty** value plus a note on how to generate it — was reported as a plaintext
  credential, blocking both `pre-push` and CI. A guard that fires when nothing is wrong teaches
  people to click past it, and the day it is right nobody reads it.
- **And the same guard missed the names it exists for.** Its name rule was anchored at the end
  (`…_SECRET$`), so `SECRET_KEY_BASE`, `API_TOKEN_VALUE`, `PRIVATE_KEY_PATH` and `SIGNING_KEYS`
  went through — precisely the class of secret that has no recognisable shape, which is why the name
  is all there is to go on. Now matched on word boundaries, with the counterpart that `KEYCLOAK_URL`
  and `TOKENIZER_MODE` are still ignored, and a deliberate exemption for `PUBLIC` / `PUBLISHABLE` /
  `ANON`: a publishable key carries its value, that being its entire purpose.
- **`CONTRIBUTING.md` promised a safety net that does not exist.** Its table said the four benches run
  on *"every push and pull request"*, while CI triggers on `pull_request` and `push: branches:
  [main]` — **a push to a working branch runs nothing**. It also quoted a test count that had drifted
  by 150; the number is removed rather than corrected, so the second copy is not put back.

### Changed
- **Private vulnerability reporting is now a path, not just an address.** [`SECURITY.md`](SECURITY.md)
  offers two private channels instead of one, each with what it actually gives rather than a
  preference order with no reason: the GitHub form provides a thread attached to the repository, a
  timestamp of what was said and when — which protects the reporter as much as us — and a direct
  route to a CVE. **Email remains, and is not a second-class channel**: not everyone has a GitHub
  account, and a researcher who must create one to warn us is a researcher who gives up. The
  response-time commitment now covers both.

## [0.1.130] — 2026-08-22

### Fixed
- **A malformed rating was recorded as one star instead of being refused.** The guard read
  `const note = Math.max(1, Math.min(5, Number(body.rating) || 0)); if (!note) …` — the `Math.max(1, …)`
  put a **floor** at 1, so `note` was never falsy and the refusal on the next line could never run. A
  rating with no rating — field absent, `null`, `"abc"`, a double send from the client — was not
  rejected: it was stored as **1 star, the worst of the scale**. Measured satisfaction therefore fell
  on its own with every malformed call, and nothing in the number made that visible.
  - ⚠️ The refusal was **unreachable**, not wrong. Code that cannot execute is not dead weight when
    it is the only thing standing between bad input and a recorded number.

### Added
- **A secrets guard, six written policies and three benches.** A secret is not a regression like any
  other: it is not fixed by a commit, because the value has already left. The guard therefore refuses
  *before* the push rather than reporting afterwards — seven species recognised by their shape, plus
  the rule that a variable whose **name** announces a secret carries no value in a tracked file.
  - ⚠️ The bench builds its fake secrets **at run time** rather than embedding them, so the guard's
    own test corpus is not itself a file full of credential-shaped strings.
- **Declared storage origins are now covered by a bench** — an opaque origin (whose `origin` is the
  string `"null"`) is refused, an unreadable entry is ignored rather than invalidating the whole
  configuration, and an origin declared twice is counted once.

## [0.1.129] — 2026-08-22

### Changed
- **A document's analytics read is bounded, and says what it covers.** `listSharesForDoc` pulled the
  *entire* view history of a document; its neighbour `overview()`, forty lines below in the same
  file, had bounded itself to a rolling 24-month window months ago, with the reason written above
  it. Two reads of the same event tables, two rules — and the second was written nowhere: **an
  absence of a bound does not write itself.** One definition now, shared by both.
  - The response carries `fenetreMois` (the window, in months). A bounded analytic that does not
    announce it is indistinguishable from a complete one — the reader sees definitive figures. The
    field is present even when the window cuts nothing, so a caller never has to infer coverage from
    the *absence* of a flag.
  - ⚠️ **The bound is temporal, not a row limit, and the measurement is what decided it.** PostgREST
    caps at 1 000 rows on this deployment — recorded by a past incident whose comment survives in
    `overview()`: ascending order plus a silent cut means *the recent* rows vanish, and the dashboard
    showed "0 opens" on documents read the day before. A `limit` under 1 000 would already bite on
    the worst real document (662 rows); a `limit` above it is silently reduced to 1 000, so a
    `truncated` flag computed from the length would **lie**. `selectAll` paginates by `Range` and is
    immune to the cap; the window bounds the volume.

### Fixed
- **"Last activity" no longer depends on the query's `ORDER BY`** — in both aggregating functions.
  `lastAt = row.at` ("the last row wins") was correct only *while* the query sorted `at.asc`: a
  hidden coupling between the aggregation and an `ORDER BY` thirty lines above it. Reversing the sort
  — to keep recent rows in case of a cut, which was the obvious next move — would have turned "last
  activity" into "first activity" **without a single test moving**. It is computed now, and the
  property is proven by *permutation*: whatever order the rows arrive in, the result is identical.

## [0.1.128] — 2026-08-21

### Added
- **The card now says whether the fused heartbeat is active.** `0.1.127` made a heartbeat cost two
  database round trips instead of three — but a host missing migration `0019` fell back **silently**
  to three: correct, twice as expensive on the hottest path of the product, and nothing said so. A
  degradation you cannot observe is one you find on the invoice, or never.
  - `presenceFusion` (identity card) is what **this process** observed while serving heartbeats:
    `actif`, `degrade`, `inconnu`. Same three states, same reading rule as `presenceDurcissement` —
    at rest it says `inconnu`, meaning *nobody looked*, so it must **not** be used as a pre-flight
    check. An expired negative proof falls back to ignorance, never to confidence.
  - `schema.fusionBase` asks the **database**, so it answers at rest — that is the field to read
    before a deployment. Values mirror `durcissementBase`.
  - ⚠️ **One call in the normal case.** `0019` succeeds `0018` and its argument set *contains* it, so
    a call the long contract accepts proves both at once. The short contract is asked again only
    when the long one is missing — i.e. exactly on the host that is behind. A failure proves nothing
    about either and triggers **no** second call: hitting a struggling database teaches nothing.
  - ⚠️ **The probe writes nothing, for two independent reasons**: `p_page = null` on a slug that does
    not exist leaves through the *introuvable* branch, and `p_anon_cap = 0` already left through
    *capped*. Two reasons rather than one, because a diagnostic probe is the worst place to discover
    a regression. Asserted against a real Postgres.
  - A host missing `0019` is logged once an hour with the exact figures — nothing breaks, a
    heartbeat simply costs 3 round trips instead of 2.

### Fixed
- **The silent-write guard followed no indirection.** It rejected a `catch` that calls a logging
  helper — not out of zeal: it only reads *direct* forms, so it accused the code that factors out.
  Adding the helper's **name** to its list of speaking forms would have emptied the guard at the
  first silent helper — satisfied by an identifier. It now follows **one hop** and reads the *body*
  of the called function. Proven by mutation: a helper that keeps its name while ceasing to speak
  still goes red.

## [0.1.127] — 2026-08-21

### Changed
- **A presence heartbeat costs two database round trips instead of three** (last quantified item of
  the external audit — and the only one that demanded to be *measured* before being committed to).
  At 250 attendees a heartbeat cost three round trips — rate limit, presentation read, write — about
  **30 ops/s**. The read is gone: **20 ops/s**. Both figures come from the same cost bench, taken on
  both branches.
  - The route read the presentation for **three** things and three only: does it exist, is it
    closed, does the caller hold the control token. All three now happen inside the write
    transaction (migration `0019-presence-lit-la-presentation.sql`).
  - ⚠️ **Moving a decision is where a guard gets lost on the way.** The first draft of `0019` gated
    both refusals on *"does the caller carry a control token"*. An **anonymous** attendee carries
    none — that is the vast majority of heartbeats — so they would have silently lost the 404 and
    the archive refusal. The right signal is *"did the caller read the presentation"*, i.e.
    `p_page is null`. Fixed before the migration served a single call, and measured on both sides.
  - ⚠️ **In fused mode `p_control_hash` is always sent — even `null`.** PostgREST resolves an RPC by
    its set of *named* arguments: omitting it would resolve to the short contract, which reads a
    null `p_page` as "page 1". Page 1 would then be recorded for everyone, with no refusals and
    nothing to say so. The explicit argument is exactly what makes the call **fail** where `0019` is
    missing — so what triggers the fallback instead of a false success.
  - The proof of "who is the presenter" is now **split in two**: `titreUsurpe.test.js` proves the
    route forwards the token's *fingerprint* without granting anything itself (and that the token
    never travels), while `base/presenceFusionnee.test.js` proves against a **real Postgres** that
    the fingerprint grants — or does not — the title, and that both refusals write **no row**. The
    two files name each other: without that, each half stays green while the property has stopped
    holding.
  - Backward compatible **in both directions, measured**: a caller that does not pass
    `p_control_hash` keeps exactly its previous behaviour, including on an absent slug. Hosts
    without the migration keep the three round trips and lose nothing.

### Fixed
- **The cost bench carried a dated reading that had drifted on four lines out of five** — and always
  *downwards*. It announced a 2-round-trip heartbeat while printing 3, page turn 2 for 1, state
  resync 1 for 0. Nobody lied: the bench gained a counter and the prose stayed. The reading is now a
  **witness the bench confronts**, in both directions — a number that moves goes red, and so does a
  gesture that *disappears* from the reading.
- **`docs/API.md` guard only compared half of its own line.** Call sites were guarded; the **file
  count** on the same line was not, and said *five* where the code had **seven** — the very drift
  this step was written to prevent, back through the clause left outside its scope. Both halves are
  compared now, and the guard refuses when the comparable *form* disappears rather than concluding
  green.

## [0.1.126] — 2026-08-21

### Fixed
- **The viewer's memory bound missed three paths** (P1 completion, external audit). 0.1.123 bounded
  scrolling mode only.
  - **Single-page mode evicted nothing.** The comment said why — *"only one page is displayed, so
    there is nothing to evict"* — and it was wrong: one page is *displayed*, but `showPage()` renders
    the current page **and the next** on every move, and all previous ones stay in the DOM. A guided
    100-page presentation still ended with close to 100 canvases. ⚠️ A false claim written
    confidently made the defect look like a decision.
  - **The pixel budget did not hold at maximum zoom.** The render factor was never allowed below 1,
    yet at 300 % the CSS size alone exceeds the budget: a 4110×5319 CSS page came to **21.9 M pixels
    — about 83 MB of buffer for a single page**, ×5.5 the announced ceiling. The factor is now
    derived from the CSS size and bounded by three things at once (density cap, the screen's *real*
    density, and the pixel budget), so it can go below 1. Verified by computation over five
    configurations before being written.
  - **In-flight work was never evicted.** Eviction walked `rendered` only, ignoring pending
    `getPage()` calls and text layers under construction: a released page could receive its text
    layer later and reappear as selectable text floating on an empty frame. Eviction now walks the
    union of the three registries, and a **per-page generation** invalidates late callbacks.

### Tests
- Three real-Chromium cases the previous bench could not produce: 40 pages in **single-page** mode,
  zoom driven to **300 %** through the actual button, and an orphan text layer after very fast
  navigation. Each is mutation-verified against its own defect. ⚠️ They drive the viewer through
  `PlayerBot.init(VIEWER)` — a seam that already existed — so no production line changed for them.

## [0.1.125] — 2026-08-21

### Fixed
- **A zero-byte local file raised instead of answering** — a regression introduced by the switch to
  streaming in 0.1.122. With `total === 0` the upper bound is `-1`, so `createReadStream({ start: 0,
  end: -1 })` dies with `TypeError: Cannot read properties of undefined (reading 'Symbol(kState)')`
  when the descriptor closes. The buffered version tolerated `Buffer.alloc(0)` silently, so the
  defect did not exist before the fix — it was born with it. An empty PDF is obviously invalid, but
  it must produce a **response**: it is the reader's job to say there is nothing to show, and a `500`
  would say "our fault" instead of "this file is empty". The `Range` case was already correct (416).
- ⚠️ **The bench could not have seen it**: it only ever built an 8 MiB file, so its data could not
  produce the phenomenon — the same class as testing a PDF viewer on a one-page document. Size zero
  is a case, not a detail.
- **The bench itself leaked a file descriptor** (`DEP0137` on every run). The leak was inside the
  anti-vacuity assertion added to stop the test passing on nothing — the fix carried its own defect.
  ⚠️ The instance is closed, the class is not: the warning fires at garbage-collection time, so a
  deterministic guard is out of reach, and saying so is better than shipping a flaky one.

## [0.1.124] — 2026-08-21

### Fixed
- **Chat PDF thumbnails were unbounded, unshared, eager, and never released** (performance, external
  audit) — four defects in a single line. The cache had **no limit** and held `toDataURL` strings
  (base64 kept in the JS heap, about 1.33× the binary); two messages carrying the **same** PDF each
  triggered their own load; the `PDFDocumentProxy` was **never destroyed**, so its worker retained
  the whole document to show a 208 px thumbnail; and loading happened at **render** time, so opening
  a thread with two hundred attachments loaded two hundred documents.
  Now: lazy via `IntersectionObserver` (200 px margin), one shared promise per URL, a concurrency
  queue of 2, `toBlob` + object URL instead of base64, `pdf.destroy()` once the thumbnail is made,
  and an LRU of 24 whose evicted object URLs are revoked.
- ⚠️ **Revoking an object URL that is still displayed would blank the image.** Eviction therefore
  puts the affected thumbnails back to placeholder and re-observes them, so they reload when they
  return into view — a case the naive "evict and revoke" would have shipped as white gaps in the
  thread.

## [0.1.123] — 2026-08-21

### Fixed
- **The main viewer kept every page it had ever rendered** (P1, external audit). `rendered[n]` was
  never evicted, canvases stayed in the DOM, a re-fit `build()` did not cancel the render tasks it
  was replacing, and `rendered[n]` was set **before** the render succeeded — so a failure left the
  page permanently marked as rendered and never retried. Measured in a real Chromium on a 40-page
  document: **40 simultaneous canvases**, now at most 12 (current page ± 2 plus what is in flight).
- **A canvas is now bounded by a pixel budget, not only by a page count.** The device pixel ratio was
  not capped: on a ×3 display one page reached **9.7 M pixels — about 37 MB of buffer for a single
  page**. Two bounds now apply (effective DPR capped at 2, then a 4 M pixel ceiling per canvas);
  measured worst case is ~16 MB. ⚠️ In practice the pixel budget is what binds, and the DPR cap is
  redundant with it except on a small page with a very dense screen — written down in the test rather
  than left to be rediscovered.
- **Render generations and cancellation**, mirroring the audience page: a new `build()` invalidates
  callbacks from the previous one (they were painting into detached elements and the work was done
  twice) and cancels the tasks it replaces. A page is marked rendered only on success, and the mark
  is removed on failure or cancellation so it can be retried.

## [0.1.122] — 2026-08-21

### Fixed
- **Local files are now streamed instead of being allocated whole** (P1, external audit).
  `readLocal` did `Buffer.alloc(end - start + 1)`: up to 60 MiB per request, *under* the relay
  ceiling and therefore perfectly "allowed". Twenty concurrent range-less requests for a 50 MiB file
  reserved about 1 GiB at once. **The ceiling bounded one read; nothing bounded its product with
  concurrency — and the product is what memory experiences.** The local path now returns a readable
  `body`, so it goes through the *same* streaming code as the remote relay and inherits its
  backpressure and its byte counter. Measured: 152 MiB reserved before, under the threshold after.
- The file descriptor now belongs to the stream (`autoClose`), so a client hanging up destroys the
  source and releases it. It is closed explicitly on the paths that read nothing (416, 413, error).
  `206`, `Content-Range`, `Content-Length`, `413` and the stat/read race protection are unchanged.

## [0.1.121] — 2026-08-21

### Security
- **The strict door reopened on the second bootstrap** (P1, external audit). 0.1.119 refused the
  unprotected fallback under `PLAYER_PRESENCE_STRICT` — but only in the `catch`, the path where the
  RPC has just failed. There is a **second path to the same write**: once the 60 s memo is armed,
  `appelerBump` returns early without calling the RPC at all, strips `p_only_if_unclaimed` and
  writes. So the first bootstrap was refused with `503` and the next ones, for the following minute,
  wrote **without the anti-takeover check**. The property we advertised — *strict means no
  unprotected fallback* — was false. Both paths now share a single refusal constructor: two messages
  written separately would drift, and drift is what produced the defect. Only reachable on a host
  that armed the strict door without migration 0018.
- ⚠️ **Our bench could not see it: it called once.** A guard that only exercises the first pass says
  nothing about the regime — and here the regime took the other door. The regression tests repeat the
  bootstrap 100 times and assert that no request body ever lacks `p_only_if_unclaimed`.

### Fixed
- **`schema.durcissementBase` disappeared when the database was entirely mute** (P2, external audit).
  The early return — taken when even the witness query fails — dropped the field, while the contract
  says it always holds one of three values. A host testing `durcissementBase !== "applique"` before
  deploying then read `undefined !== "applique"`: true by accident. **An absent field is more
  dangerous than a cautious one** — it is indistinguishable from an older player that never had it.
  The field and its scope description are now returned on that path too, from a single shared
  constant.

## [0.1.120] — 2026-08-21

### Added
- **`schema.durcissementBase` — whether migration 0018 is in the database, asked *to the database*.**
  `presenceDurcissement` is a **report of execution**: on an instance where nothing is running it says
  `inconnu`, meaning *nobody looked*. We had nevertheless written a pre-flight instruction built on it
  ("check `presenceDurcissement` before upgrading; if it says `degrade`, apply 0018") — which passes
  silently on every idle host, so the missing migration would be discovered at the first presentation,
  at the worst possible moment. We had built a field that refuses to answer without an observation,
  then placed it at the centre of a procedure that requires an answer. Reported by the second host.
  `durcissementBase` answers `applique` / `absente` / `indetermine` and is a **global** fact.
  0018 replaces a *function*, so no column probe can see it — the question has to be asked by calling.
  **The probe writes nothing**: with `p_anon_cap = 0` a non-existent row exits through the *capped*
  branch and the function returns before its `insert`. Measured against a real Postgres, not deduced —
  `ok=f created=f capped=t usurpe=f`, zero rows before and after — and pinned by a `base/` test.
  Costs one extra round-trip, opt-in via `?schema=1` and shared for 30 s.
- **A host missing 0018 is now logged once an hour**, so an idle instance finds out without waiting
  for its first presentation — which is the same gap, seen from the operator's side.

### Documentation
- `docs/HOST-CONTRACT.md` says explicitly **not** to use `presenceDurcissement` as a pre-flight check,
  and documents `durcissementBase` with the three values.

## [0.1.119] — 2026-08-21

### Changed
- **The hardening state is now an explicit value instead of two compared timestamps** (P3, external
  audit). Comparing "last success" to "last failure" was correct in principle, but two concurrent
  responses settling in the *same millisecond* made both instants equal, and equality fell on the
  `inconnu` side: never a false `actif` — the safe direction — but a lasting false negative. The last
  observed outcome is now written down rather than inferred from a clock whose resolution is not
  guaranteed. An expired *negative* proof still falls back to ignorance, never to confidence.

### Fixed
- **With the strict door closed and migration 0018 missing, a bootstrap is now refused (503) instead
  of falling back to an unprotected write** (P2, external audit). The fallback drops the anti-takeover
  check and writes anyway — the right trade during the transition, wrong once `PLAYER_PRESENCE_STRICT`
  is set: it would be a closure that reassures without protecting. The refusal is **limited to
  bootstraps**; ordinary proven heartbeats still fall back normally, so a missing migration never
  stops a presentation in progress. The message naming the migration is still emitted first.
- **The identity-card guard no longer enumerates field names.** It listed four, so it could not see
  what it did not name: `presenceStrict`, `presenceJetons` and `presenceDurcissement` had been
  published for days without appearing in the host contract, with nothing going red. A real card is
  now rendered and **all** of its top-level keys are compared against the contract example, in both
  directions — a field added tomorrow goes red on its own.

### Documentation
- **`docs/HOST-CONTRACT.md`** documents the three `presence*` fields and shows them in the card.
- **`docs/CONFIGURATION.md`** corrects the cost of rotating the presence secret: it is **two** refused
  heartbeats, not one, and — the part that actually matters — the participant gets a **new attendance
  row**, so their accumulated time restarts and the operator sees one person as two. Discarding the
  key at the first refusal would save a beat and is deliberately not done: the attendee key is shared
  across presentations, so rotating it on one refusal would change the viewer's identity everywhere
  else too.

## [0.1.118] — 2026-08-21

### Fixed
- **Switching documents mid-presentation broke the image/PDF decision** (P1, external audit).
  `switchDoc()` updated the file URL but **not** `fileName` — and `fileName` is what decides between
  an image and a PDF. After a PDF → PNG switch the new PNG was handed to pdf.js; after PNG → PDF the
  new PDF was loaded with `new Image()`. Both showed the viewer "Document indisponible" on a
  perfectly valid document. Everything describing the document — URL, name, title, generation — now
  changes together: there is no moment where the config may describe one document by its URL and
  another by its name.
- **Stale callbacks could overwrite the current document or page.** Two independent generations are
  now tracked. `docGen`: a document abandoned mid-load could finish after the new one and take its
  place. `renderGen`: pdf.js guarantees no ordering between two `getPage()` calls, so a fast page
  change left the **slower** one winning, and the audience stayed on a page the presenter had left.
- **The render task was discarded and the canvas published before the render finished.** The task is
  now kept and `cancel()`ed when a new render replaces it, and the canvas is appended only once the
  render for the still-current generation has completed.
- **Abandoned PDF documents are destroyed** (loading task and document proxy). Chaining switches
  without destroying grew memory without bound — the failure mode of a long presentation, not of a
  tested one.

## [0.1.117] — 2026-08-21

### Fixed
- **The cache admitted an unbounded number of pending requests** (P1, external audit). Entries in
  flight are never evicted — evicting one would break the request coalescing that is the cache's
  whole purpose — so the `max` ceiling only ever applied to *resolved* results. Measured, not
  assumed: 10 000 distinct keys against a database that never answers produced **10 000 entries and
  10 000 producers** with `max: 100`, i.e. that many open requests, sockets and promises. A separate
  hard ceiling now bounds **admission** (`maxEnVol`, default 128): a key already in flight is still
  always shared — even at the ceiling, so a legitimate burst is never punished — while a new distinct
  key is refused **without calling the producer**, through a typed error the route turns into
  `503` + `Retry-After`, never a `500`.
- **Cache weight was measured in UTF-16 units, not bytes.** `"界"` counted as 1 and weighs 3, so
  non-Latin content under-reported its weight threefold: an "8 MB" ceiling let 24 MB through. Now
  `Buffer.byteLength(value, "utf8")`.
- **The slug contract is now enforced server-side, before the cache and before the database.** It
  existed only in the browser (`bridge.ts`), so a reader could vary the cache key at will — the very
  lever that made cache admission reachable from outside. The pattern moves to `shared.ts`; the copy
  in `bridge.ts` stays on purpose (it is the only MIT file in an AGPL package, so importing the core
  would dissolve that boundary) and a guard now compares the two.
- **PostgREST requests in the standalone context abort for real** (`AbortSignal.timeout`, 15 s by
  default, overridable per call). Without it a slow database held its admission slot until the
  platform killed the function — which would have turned the new ceiling into a permanent refusal.

## [0.1.116] — 2026-08-21

### Fixed
- **`presenceDurcissement` promoted a failure to `actif` instead of falling back to ignorance.**
  Reported by the second host while verifying a claim of ours. The flag was set *before* the RPC
  call, so it recorded an **attempt**, not a success; and when the 60 s "no-0018" memo expired, the
  state did not fall back to `inconnu` — it rose to `actif`. A host missing migration 0018 therefore
  reported `degrade` for 60 seconds and then announced the guard as **verified**, on the strength of
  an attempt whose only proven outcome was failure. The state is now derived from two ordered
  instants (last observed success vs last observed absence): `actif` requires a success **more
  recent** than the last failure, so an expired proof falls back to ignorance, never to confidence.
  A network failure now yields `inconnu` rather than `actif` — it proves nothing in either
  direction. Both regressions are mutation-verified.

## [0.1.115] — 2026-08-20

### Added (the card said the door was configured to refuse, not that it refuses)

- **`presenceDurcissement` reports the *observed* state of the bootstrap anti-takeover check.**
  `presenceStrict` says the door refuses unproven heartbeats — true, and measured. But the check that
  stops a bootstrap from seizing a claimed row could be disarmed with nothing saying so: migration 0018
  missing, or — before 0.1.111 — any transient network error. We closed exactly this gap on
  `presenceJetons` by *measuring* rather than declaring, and left it open on the neighbouring field. The
  card now carries what the process actually observed while using the check: `actif`, `degrade`, or
  `inconnu`.
- **Three states, because "not degraded" is not "verified".** A process that has not yet served a
  bootstrap has observed nothing, and announcing an active guard on an absence of observation is what
  this card refuses elsewhere — the same rule as `verdict: non-sonde` for the schema. The check cannot
  be probed without calling the function, which writes; and a network failure does not move it to
  `degrade`, since it proves nothing about 0018. Named by the second host.

## [0.1.114] — 2026-08-20

### Privacy (the IP fingerprint was not anonymous, and the comment said it was)

- **The attendance IP fingerprint is now a salted HMAC bound to the presentation.** The code wrote
  `sha256("att:" + ip)` under a comment claiming it avoided keeping personal data. That was false: the
  whole IPv4 space recomputes in minutes, so the fingerprint leads back to the address, and the CNIL is
  explicit that a hashed IP is **pseudonymised** data, still covered by the GDPR — a description
  stronger than the implementation, the very class tracked elsewhere in this repo. It is now
  `HMAC-SHA-256(secret, "attendance-ip\0" + slug + "\0" + ip)`: the salt makes a stolen table
  non-recomputable, and the `slug` prevents correlating one address across presentations (the cap
  already counted per `(slug, fingerprint)`, so nothing changes for it). The salt is
  `PLAYER_IP_HASH_SECRET`, falling back to `PLAYER_PRESENCE_SECRET` with domain separation — no new
  mandatory variable — and, absent both, the old unsalted fingerprint remains: the feature works, the
  protection is weaker, and that is written down rather than discovered later. `RETENTION.md` corrected.

### Note

- The salted branch was **not exercised by any test double**, none of which configured a secret — and a
  declaration-order fault slipped through it: green on the bench, `ReferenceError` on every heartbeat in
  production, where the secret *is* set. Caught before shipping, and the new bench now fails on it. A
  double that never configures an option never exercises the code that option turns on — the mirror of
  the P1 blind spot, whose doubles always had a working signer.

## [0.1.113] — 2026-08-20

### Fixed (without a secret, a participant was refused by their own presence — and refused forever)

- **The token is now signed BEFORE the write, so a bootstrap is only declared when one can actually be
  issued.** It used to be minted *after*: the row was marked claimed while no token could be produced
  (no `PLAYER_PRESENCE_SECRET`), so the next heartbeat bootstrapped again, hit its own claimed row
  (`409`), and the client rotated its key — one extra participant per beat, up to the cap of 325. A
  protection producing exactly what it forbids. Neither bench saw it: the client test always simulated
  `{ok:true}`, the server test always had a working signer — and the state they missed is the most
  ordinary one, a modern client deployed *before* the host sets the secret.
- **`p_has_token` now has three states, not two.** Proven (member or valid token) → claims the row;
  no proof → counts as legacy; **bootstrap → neither**. A bootstrap proves nothing, so it must not
  claim the row (or a client that loses its token refuses itself) nor count as legacy (or `sansJeton`
  never reaches zero, each new visitor producing one). The row is created free and claimed by the next
  beat — the one carrying the token. On a host with no secret, beats count as *without* token, which is
  honest and is what stops `sansJeton` from ever reaching zero there.
- **`PLAYER_PRESENCE_STRICT` is inert without the ability to issue tokens, and the card says so.**
  Enforcing it with no secret would refuse every anonymous participant. `presenceStrict` is now the
  **effective** value, not the declared one — announcing a closed door that is wide open is the worse
  of the two failures — and it is logged once an hour.
- **A refused token is discarded by the client instead of being resent forever.** Expired, or signed
  with a rotated secret, it produced `403 presence-token` on every beat while the client kept it in
  storage: presence silently stopped being recorded with no path back. The client now drops the *token*
  (keeping its key, which is still its own) and asks for a new one. Heartbeats are also single-flight,
  so an older response cannot reinstate a stale token over a fresh one.
- Guards mutation-tested against the previous code: four of the five no-secret tests fail on it,
  reproducing the loop exactly ("beat 2: 409"). Reported by an external audit (P1).

## [0.1.112] — 2026-08-20

### Security / performance (the read cache kept what it no longer served, without limit)

- **Expired entries are now purged on access, and a weight cap bounds the cache in bytes.** The cache
  capped the NUMBER of entries (500) and never their size, and evicted only under pressure: an expired
  entry stayed resident until another pushed it out. Since the key carries `chatAfter` — a cursor the
  visitor varies at will — and a chat response can weigh hundreds of kilobytes, ~500 × 600 KB ≈ 286 MB
  could be held per process, on demand. A count cap bounds nothing when the caller chooses the size of
  an entry, so the cap is now also on **weight**, and the weight is *measured* rather than estimated:
  the cached values are JSON strings. Default caps lowered to 100 entries / 8 MB.
- **The TTL now starts at resolution, not at request — which is what makes coalescing work at all.**
  Set at request time, the deadline expired *before the production answered* as soon as it took longer
  than the TTL, so concurrent callers each started their own: the grouping stopped working for exactly
  the slow producers it exists for. An in-flight entry never expires and is never evicted — dropping it
  frees nothing (it is already running) and re-launches the work the cache exists to share.
- **`chatAfter` is validated as a safe decimal integer.** It enters a cache key, so anything that
  widens the value space widens the key space of a shared resource.
- Guards were mutation-tested against the previous cache: four of the six fail on it, including the
  lost coalescing, which the audit had not named. Reported by an external audit (P1).

## [0.1.111] — 2026-08-20

### Security (a transient network error silently disarmed the anti-takeover control)

- **The RPC fallback now requires proof, not merely failure.** `appelerBump` caught *any* exception and
  concluded "migration 0018 is missing", retried without `p_only_if_unclaimed`, and **memoised the
  degradation for the life of the process**. A one-second `ECONNRESET`, a 500 or a timeout therefore
  removed the anti-takeover control on a fully migrated database, until restart. It now falls back only
  on the exact signature-not-found evidence (`PGRST202`, in either of the shapes our two contexts
  produce), and rethrows everything else. This is the day's own rule applied to production code: *a
  mechanism that cannot measure must refuse to conclude, not conclude by default* — not knowing how to
  tell `PGRST202` from a timeout did not make the fallback cautious, it made it automatic.
- **A hardened bootstrap that could not run its check is refused (`503`), never written through the
  loop.** The read-modify-write fallback writes *without* the anti-takeover check; taking it here would
  have done by the back door what the main path had just refused. Ordinary heartbeats still degrade to
  the loop as before — fail-closed on the control, never on availability.
- **The "0018 missing" memo now expires (60 s) and resets with the context.** It was permanent, so an
  operator applying 0018 to a running instance would have seen no effect until restart — a migration
  silently ignored. Same doctrine `schema.js` already applies to its probes: a "no" does not have the
  lifetime of a "yes".
- **Errors from the standalone DB client now carry `statusCode` and the parsed PostgREST body**, so
  deciding no longer means matching on a sentence. The message is unchanged (callers match `409` on it);
  the studio context already exposed both. Reported by an external audit (P1).

## [0.1.110] — 2026-08-20

### Fixed (`presentationsActives` counted flagged-active, not live — a phantom-anomaly generator)

- **The denominator now counts LIVE presentations.** A presenter who closes their tab without ending
  the session leaves `active = true` behind, so the card would report *"N active and 0 avecJeton =
  ANOMALY"* with nobody having gone anywhere. The reliability of the number would then rest on closure
  discipline — and the second host, whose closure was outright impossible for three days, is well
  placed to say what that is worth: their seven presentations are inactive yet all still carry their
  `control_hash`, so none was ever closed cleanly. A denominator that depends on human discipline
  manufactures phantom anomalies. The count now reuses **the** staleness threshold the rest of the code
  already uses to decide "live" (the presenter beats every 30 s via `present-touch`) rather than
  inventing a second number that would drift from it. The test double now *requires* the liveness
  filter, so removing it turns the test red. Reported by the second host.

## [0.1.109] — 2026-08-20

### Fixed (the reading rule contradicted itself in the case that was actually live)

- **`presence.couvre` branches on the real state instead of interpolating a number into a generic
  sentence.** 0.1.108 stuffed `presentationsActives` into a phrase written for N > 0, so at N = 0 the
  card read: *"0 active and 0 avecJeton = ANOMALY; 0 active and 0 avecJeton = normal rest"* — a
  contradiction inside one line. Formally constructed, false in the case that was on screen: exactly
  the defect this field exists to prevent, produced while adding the field. The text now branches — at
  rest it says rest and announces what a null will mean once something runs; with presentations live it
  states whether presences are being recorded or not, using the figures at hand. A guard now forbids
  the text from ever asserting an anomaly and a rest at once, across four regimes; it was mutation-
  tested against the exact broken sentence.

## [0.1.108] — 2026-08-20

### Added (`presentationsActives`, so the sign of life can be read on its own)

- **`presence` now carries `presentationsActives`.** Once the door is closed, `avecJeton` becomes the
  sign of life — but it is legitimately zero outside a presentation, which is the resting state of any
  instance, and the card did not carry the one number that tells the two apart. The caveat was written
  ("zero *during* a live presentation means something is broken"), and "during" is exactly the word a
  hurried reader skips — that reader being us, in six months, with `{avecJeton: 0}` on screen. So the
  disambiguating number now travels with it, the way `dontScellees` does for `sansRang`: *N active and
  0 `avecJeton` is an anomaly; 0 active and 0 `avecJeton` is rest.* The `couvre` text states the rule
  with the current figure in it, in both regimes. Reported by the second host, who pointed out that a
  relay you cannot read alone is a relay that gets read wrong.

## [0.1.107] — 2026-08-20

### Changed (`presence.couvre` now follows the state of the door — because the counter expires)

- **`sansJeton` is an instrument of transition, and it has an expiry date.** The audience page is
  served `no-store` and the client code is interpolated into the HTML, so no stale bundle can exist:
  every new visitor is modern by construction, and the only old population is tabs opened before the
  client shipped. Once those are gone, `sansJeton` can never be non-zero again — it will read 0 whether
  the mechanism works or is entirely broken. **A counter that can no longer vary has stopped measuring,
  even while it still shows the right value**, and here it is *time* that does it, not a defect: no
  commit to blame, no mutation to catch, no guilty refactor. It simply becomes true for the wrong
  reason. So the card's `couvre` text now follows the door: before closing it names `sansJeton` as the
  gauge that says when to close (and warns it will expire); after closing it says the gauge is spent
  and names what takes over — `avecJeton` as the sign of life, zero *during a live presentation*
  meaning something is broken. The card knows which regime it is in; making the reader derive it is
  what produces the misreading. Reported by the second host.

## [0.1.106] — 2026-08-20

### Fixed (the new card field tripped a host guard — renamed, guard untouched)

- **`presenceTokens` → `presenceJetons`.** A host-side guard refuses any identity card containing
  `supabase|secret|key|token`: a diagnostic endpoint that leaks a URL, a hostname or a secret is a gift
  to whoever probes it. The boolean leaks nothing, but that guard is a deliberately blunt text scan —
  and the right response to its refusal is to change the **name**, never to loosen the guard.
  Loosening is exactly what empties a guard, and this one protects something real. The reason is now
  written next to the field, so the next person to reach for an English name hits the explanation
  instead of the wall.

## [0.1.105] — 2026-08-20

### Added (you can now see whether presence tokens are actually being issued)

- **The card carries `presenceJetons`, measured rather than declared.** After setting
  `PLAYER_PRESENCE_SECRET` there was no way to confirm the setting had taken: the card shows
  `presence: {0, 0}` identically whether tokens are being issued, the variable is mistyped, it was set
  on the wrong environment, or the deploy never happened. Confirming it required standing up a
  throwaway presentation against production — which is not a procedure an operator should need.
  A setting you cannot observe is a setting you believe you made. The boolean now answers, and it
  **measures**: the card signs a throwaway token and reports whether one came out, rather than asking
  the host to declare a `config.presenceJetons` — a fact in two copies is a fact that eventually
  diverges, and it is the declared one you would trust. No host has anything to add to benefit from it;
  an older host, or a signer that throws, reads `false` rather than absent, and the card still answers.

## [0.1.104] — 2026-08-20

### Fixed (the one exact floor was justified by another guard — now that condition is checked, not assumed)

- **The exact floor on migration `add column` counts now verifies its own justification.** It is exact
  because no legitimate housekeeping can lower it — migrations are never deleted and `drop column` is
  forbidden. But that monotonicity is not a property of the world: it holds **because another guard
  enforces it**, and a mechanism can empty out, which is this whole family's subject. If that guard ever
  shrank, the exact threshold would silently become an arbitrary one. The test now asserts that the
  `drop column` interdiction still exists, and says what to do if it does not (widen this floor, or
  restore the interdiction). Mutation-tested: removing the interdiction turns this red. A stated
  condition of validity beats an assumed one; a **checked** one beats a stated one — and unlike
  `tronque`'s condition (which would need response headers, out of reach), this one is checkable in
  three lines. Reported by the second host, applying our own doctrine to our exception.

### Note

- The refined rule, worth keeping: **a threshold should be as tight as legitimate housekeeping allows —
  and sometimes legitimate housekeeping is nil.** Neither "always exact" nor "always wide": the question
  is what churn the measured quantity really admits.

## [0.1.103] — 2026-08-20

### Changed (`presence` now states what it measures, next to the numbers)

- **`presence` carries a `couvre` field: it is a migration gauge, not a security metric.** `avecJeton`
  counts self-declared `wantToken` bootstraps too — a bootstrap sets `last_token_at` without any token
  having been verified. That is correct for what the counter answers ("are there still old clients?")
  and even necessary for `sansJeton` to be able to reach zero. But the NAME promises something else:
  someone reading `{avecJeton: 40, sansJeton: 0}` in six months, in a cockpit, without this file in
  front of them, will read "40 proven participants" — and all 40 may have proven nothing. The caveat
  now travels WITH the numbers, the way `couvre` already travels with the schema verdict, rather than
  living only in a source comment that the person at risk never reads. Same remedy as the documented
  overlap of the two sets. Reported by the second host, who saw such a row in their own database.

## [0.1.102] — 2026-08-20

### Fixed (the coverage floors were set to fail on normal housekeeping — which is how a guard dies)

- **Floors are now collapse detectors with a dated witness, not coverage measurements.** 0.1.100 pinned
  each floor to the day's exact reading, which detects the smallest erosion — and also reddens on the
  first legitimate removal. At the third false positive someone lowers it, with no principled place to
  stop, because nothing in the file says what the number protects. That is the exact gesture that
  empties a guard: **a guard that cries wolf gets loosened, and nobody then checks that it still guards
  anything** — this repo has the proof, since the same scan produced seven false positives and the
  correct reflex (tightening it) could just as easily have disarmed it. Thresholds are now wide enough
  that no normal housekeeping reaches them and a collapse crosses them at once, with the dated reading
  written beside them as a witness. Reported and designed by the second host, after applying the same
  remedy to their own guard.
- **Each floor is now reasoned per guard rather than by blanket rule.** The migrations `add column`
  count is **strictly monotonic** — a migration is never deleted, and another guard forbids `drop
  column` — so no legitimate housekeeping can lower it: there the exact value has no false-positive
  cost and maximum sensitivity, and it stays exact, with the reason written down.
- **A per-file floor now backs the global one.** A file that grows must not mask a file that empties.
  This is not theoretical: mutation-testing showed a broken write-pattern draining `routes-liens.js` to
  zero **while the global total stayed above its threshold** — that mutation passes without the
  per-file assertion. Both floors were seen to refuse before committing.

## [0.1.101] — 2026-08-20

### Security (P1c step 2 — a bootstrap can no longer seize a claimed presence; STRICT is now safe to arm)

- **Migration 0018: a `wantToken` bootstrap is refused on a row already claimed by a token holder.**
  `wantToken` is SELF-DECLARED — it is what distinguishes a modern client from a legacy one — so under
  STRICT an attacker could declare it, post a registered participant's key, and overwrite their row:
  exactly the takeover step 2 closes for ordinary heartbeats. The second host EXECUTED it on his own
  production (a participant's name replaced) — this was not hypothetical. A row that has already beaten
  with a valid token (`last_token_at` set) is CLAIMED; a bootstrap, by definition tokenless, has nothing
  to write there. It stays free to create a new row, and to adopt a never-claimed legacy row (the normal
  upgrade path). The check is re-done under the advisory lock, so concurrent bootstraps cannot slip past.
- **The client now persists its token, which is what makes the refusal possible.** Held in memory only,
  the token was lost on every page reload, so the client re-bootstrapped with its usual (persisted) key
  — making "bootstrap on an existing key" routine, and therefore impossible to refuse without breaking
  every reload. Stored beside the attendee key, it has the same lifetime: a reload resumes with its
  token. Token TTL raised to 7 days accordingly (replay stays bounded by the archive seal, which covers
  the attendees table too). **Refused, the client rotates its key** and resumes on a fresh row rather
  than losing its presence in silence.
- **The RPC now RETRIES the older contract instead of inferring it.** 0018 adds no column, so there is
  nothing to probe — the code asks for the hardening and, if the signature does not exist, retries
  without it (the winning contract is memoised per process, so an un-migrated host pays one round trip,
  not two per heartbeat). This is the form the second host preferred: it cannot be wrong, because it
  asks exactly what it depends on. When the hardening is unavailable it is **said**, naming 0018 and the
  consequence: do not arm `PLAYER_PRESENCE_STRICT` without it.

### Note

- The coverage floor added in 0.1.100 **fired on this very release**, the day it was installed: moving
  the RPC body behind a helper dropped the scan from 71 to 61 columns — the identical silent erosion of
  the day before, this time a red test. It also makes the explicit enumeration that fixes it *safe*: a
  list is acceptable when a floor fails the day it goes stale.

## [0.1.100] — 2026-08-20

### Fixed (three scan guards could empty themselves without ever failing)

- **Coverage floors are now asserted at their real level.** Three source-scanning guards declared
  floors of `> 10`, `> 3` and `> 10` while actually covering 71, 10 and 34 items — so coverage could
  fall by two thirds without a single red. That is not hypothetical: one of them silently dropped from
  71 to 61 columns when a request body moved into a variable, and it was caught by a reading habit
  (diffing two test counts while working on that code), not by a mechanism. A month later, on an
  unrelated refactor, nobody compares — and **a guard with zero coverage passes all its tests**: it
  does not lie, it stops saying anything, and silence reads as success. The floors are now the
  measured values, so a refactor that moves the write site fails the guard instead of shrinking it,
  and lowering a floor becomes a deliberate act visible in a diff. This also makes *loosening* visible
  — the very move that empties a guard, and the one we reached for when this scan produced seven false
  positives. Mutation-tested: raising a floor above the real count does turn it red. Reported by the
  second host, who refused to let the episode be treated as an anecdote.

## [0.1.99] — 2026-08-20

### Fixed (code-new-on-old-base lost 0015's cap — and the warning named the wrong file)

- **The RPC call no longer sends `p_has_token` when migration 0017 is absent.** PostgREST resolves an
  RPC by its NAMED ARGUMENT SET: an extra argument does not "take its default", it matches no function
  at all — 404. The `DEFAULT null` in 0017 makes a NEW base compatible with OLD code; it can do nothing
  for the reverse — new code, old base — which is exactly the order a real deployment happens in (code
  ships before the migration). So between 0.1.97 and applying 0017, an up-to-date host fell through to
  the read-modify-write fallback and **lost the anonymous-creation cap that 0015 introduced**: not "the
  presence keeps working", but a guard vanishing silently between two migrations. The code now probes
  the `last_token_at` column (the answer already existed) and calls with 10 arguments when it is
  missing — the old contract, valid on both bases. Degradation is now what we claim: no transition
  counter, nothing else.
- **The fallback warning names the migration actually attempted.** It hard-coded 0015, so an operator
  hitting the 0017 failure verified 0015, found it applied, and concluded false positive. A wrong name
  is worse than no name because it is actionable: "name the file, not the error" only holds while ONE
  file can cause the failure. Both reported by the second host, who measured the intermediate state on
  his base instead of assuming it.
- **The schema guard sees named request bodies again.** Moving the RPC body into a variable made nine
  columns vanish from the guard's enumeration with no red — caught by diffing the test counts (994 →
  985), not by a failure. The scan now follows identifiers passed as `body:` to `PLAYER.db.request`,
  so a guard's coverage no longer shrinks when the code it guards improves.

## [0.1.98] — 2026-08-20

### Added (P1c step 2, increment 3 — the client carries the token; the loop is closed)

- **The audience heartbeat now carries its presence token.** `sendAttend` sends `wantToken: "1"` on the
  first beat (marking a modern BOOTSTRAP, which is what lets `sansJeton` fall to zero rather than
  conflating it with a legacy client), reads the response, stores the issued token, and sends it as `pt`
  on every following beat — so the server derives the row's key from something proven, not from the
  body. A host with no `PLAYER_PRESENCE_SECRET` returns no token and everything continues as before.
  With this, the protocol is complete end to end: a host can set the secret, watch
  `presence: { avecJeton, sansJeton }` on the card until `sansJeton` reaches zero, and only then set
  `PLAYER_PRESENCE_STRICT`. The client half is tested by executing the real template source (not a
  copy): bootstrap, storage-and-resend, no-secret host, and an unreadable response.

## [0.1.97] — 2026-08-20

### Added (P1c step 2, increment 2 — presence-token protocol, migration, transition counter)

- **An anonymous participant's key now comes from a proven token, and a transition counter shows when
  to close the door.** Migration 0017 adds `last_token_at` / `last_no_token_at` to
  `doc_presentation_attendees` and extends the `player_attendance_bump` RPC with an 11th parameter
  `p_has_token boolean DEFAULT null` — a 10-argument call from older code still resolves via the
  default, so the contract is not broken. On `present-attend`: a valid presence token (bound to the
  slug) provides the row's key, so a third party can no longer post someone else's key to overwrite
  their presence; the server re-issues a short-lived token in the response (no anti-replay table — the
  archive seal on attendees and `exp` already bound replay). `PLAYER_PRESENCE_STRICT`, off by default,
  rejects a legacy heartbeat (anonymous, no token, no `wantToken`) once the transition is done. The
  card's `?schema=1` now carries `presence: { avecJeton, sansJeton, tronque }` over 24h (bounded-
  ordered-flagged, like `sansRang`): `sansJeton === 0` means no legacy client is still beating. **The
  two sets deliberately overlap** — a participant who beat both ways counts in both; the measure is in
  max, the decision in *any*, which is why there are two fields, not one. No behaviour change until a
  host sets the secret and clients send tokens (the client is the next increment). A known residual:
  a `wantToken` bootstrap carrying an existing anon key could overwrite it under strict — low
  exploitability (a random, unexposed uid), to be hardened next.

## [0.1.96] — 2026-08-20

### Added (P1c step 2, increment 1 — signed presence-token foundation)

- **Signed presence tokens: `signPresenceToken` / `verifyPresenceToken`, plus `PLAYER_PRESENCE_STRICT`
  and a `presenceStrict` capability.** First rails for P1c step 2: a token binding `slug + key + exp`,
  HMAC-signed with `PLAYER_PRESENCE_SECRET` (per-INSTANCE — shared across a multi-brand instance's
  domains; the real scope is the `slug`, which is inside the signed payload). It proves the host issued
  a `(slug, key)` pair — enough to stop a third party from overwriting an already-registered presence —
  and does NOT prove a real person (the step-1 anonymous-creation cap stays). Same constant-time compare
  and mandatory `exp` as the internal token. `presenceStrict` is exposed in the capabilities so a cockpit
  can see both hosts' transition state alongside the upcoming `presence: { avecJeton, sansJeton }` counter.
  Nothing calls the helpers yet and `PLAYER_PRESENCE_STRICT` is off by default — no behaviour change; the
  protocol, counter, and client follow in the next increments.

## [0.1.95] — 2026-08-20

### Documented (tronque's validity condition)

- **`sansRang.tronque` is only reliable while `PLAFOND_SANS_RANG <= db-max-rows`.** An explicit `limit`
  does not beat the server's implicit cap: PostgREST returns `min(limit, db-max-rows)`. If an operator
  lowers `db-max-rows` below the ceiling, a genuinely-cut list returns fewer rows, `>= PLAFOND` is false,
  and `tronque` silently becomes a false negative again — the mirror of "an absent limit is not all".
  Clean detection needs the Content-Range header, out of reach of `db.request` (body only). Documented
  as a stated validity condition rather than a guard believed unconditional. Reported by the second host.

## [0.1.94] — 2026-08-20

### Fixed (sansRang: the fix removed the bound and lost the order — a lie traded for a crash)

- **`sansRang` is now bounded, ordered, and flags its bound.** 0.1.93 replaced the silent cap with
  `selectAll` — but the worst case a rank-counter exists to diagnose is "the backfill never ran": every
  message null, which passes the presence gate and then paginates the ENTIRE messages table on the card
  route, exhausting maxDuration — and a function timeout kills the whole invocation, not the promise, so
  the try/catch can't degrade. The bound was never the defect; its silence was. And the two `selectAll`
  calls had no `order=` (the three existing ones in the codebase all do): Range pagination without an
  ORDER BY has no stable order, so two pages can double or skip rows on a live base — and a presentation
  in use is a live base. Now each side is one request, `order=slug.asc`, `limit=1000`, and if the bound
  is reached `sansRang` carries `tronque: true` so equality is no longer readable as "all clear". A
  bounded counter must say it's bounded — reported by the second host across three passes.

## [0.1.93] — 2026-08-20

### Fixed (sansRang could lie through its own bounds — one of them backwards)

- **`sansRang` now uses `selectAll` (complete, paginated) instead of bounded lists.** 0.1.92 fetched
  two lists and crossed them in JS, and both were silently bounded — in OPPOSITE directions. The
  null-message list was capped at 1000 with no truncation flag: PostgREST without `order=` returns
  physical order (grouped by presentation), so the first 1000 nulls could all be sealed → total =
  dontScellees → a false "all clear" on a base where non-sealed rows were missed — the exact false
  negative the counter existed to remove. The sealed-slug list had no `limit` at all, which does NOT
  mean "all": PostgREST's implicit `db-max-rows` cap (often 1000) truncates it silently → an
  incomplete sealed set → dontScellees under-counted → a permanent false ALARM on a healthy host with
  >1000 archived presentations. Both fixed by paginating to the end with `selectAll`; transport stays
  bounded to the real problem size (zero on a healthy host), and the counter can no longer lie by
  truncation. Reported by the second host on 0.1.92 — removing an ambiguity of meaning had introduced
  an ambiguity of completeness, which is harder to see because a truncated list has the shape of a
  complete one.

## [0.1.92] — 2026-08-20

### Added (schema card makes the `mod_seq` null-count interpretable)

- **`?contract=1&schema=1` now reports `sansRang: { total, dontScellees }`.** 0.1.91's fix leaves
  `mod_seq` null on the messages of sealed presentations *by decision* — but a null rank is
  indistinguishable from "the backfill never ran", and the column-presence probe cannot tell them
  apart. So the on-demand card now counts the messages without a rank, and how many of those belong to
  a sealed presentation. Equal ⇒ every null is a legitimately-frozen sealed message; divergent ⇒ the
  backfill left non-sealed rows behind, an anomaly to fix. A counter nobody can interpret measures
  nothing; this turns it into a verdict. Two cheap queries on the probe path only, best-effort (a
  missing count never breaks the card). Reported by the second host on 0.1.91.

## [0.1.91] — 2026-08-20

### Fixed (migration 0016 backfill vs the archive seal — cross-migration hazard)

- **0016's one-time backfill now skips messages of sealed presentations.** The backfill runs an
  `UPDATE` on every message row; the archive-seal trigger (0007/0010) raises on any write to a sealed
  presentation (`active = false AND control_hash IS NULL`). A single message in a sealed presentation
  would have made the standalone migration fail entirely. The backfill now excludes those rows — a
  sealed presentation is frozen, including its rank; its messages keep a null `mod_seq` (historical,
  never live-resynced). Two individually-correct guards — the seal and the backfill — whose
  composition would block, which neither file could foresee alone. Reported by the second host, who
  measured it before applying. `init.sql` is unaffected in practice (its backfill runs before the seal
  trigger is created) but carries the same exclusion for consistency. No schema change; hosts that
  already applied 0016 need nothing.

## [0.1.90] — 2026-08-20

### Changed (performance — differential chat, audit CODEX 5.6 "scalable architecture")

- **The chat no longer re-reads its last 300 messages on every resync — only what changed since.**
  Each audience resync re-fetched the 300 most recent messages; for a room of N viewers that is N×300
  rows moved while almost nothing changed between two signals. A chat is mutable (an old message gets
  a reaction, is edited, is deleted), so an `id` cursor would miss those. Migration 0016 adds `mod_seq`
  — a global rank bumped on EVERY write (insert and update) by a trigger from a sequence (the IMAP
  CONDSTORE pattern). The client keeps the highest `mod_seq` it has seen and asks `mod_seq > cursor`:
  it gets new messages AND older ones that changed, nothing else. The client's existing merge
  (`addMsg`/`updateMsg`, by id) already handles both. The 400 ms shared read-cache keys on the cursor,
  so a whole room caught up to the same message still shares one DB read. **Degrades if the migration
  is absent**: the server probes the `mod_seq` column and, when missing, serves the last 300 as before
  (the client stays on full refresh) — no `mod_seq` in the select, so PostgREST never rejects the
  query. Trigger behaviour proven under real Postgres in `base/`.

## [0.1.89] — 2026-08-20

### Fixed (schema health card no longer over-reports "complete")

- **The schema health card now covers migration 0015, and a guard keeps it honest.** `ATTENDUES` in
  `server/schema.js` is a hand-maintained list, and nothing linked it to the migrations folder — so
  0015's conditional column (`creator_ip_hash`) was never added, and `?contract=1&schema=1` reported
  `verdict: complet` to a host that had NOT applied 0015 while its presence ran without the atomic
  path or the anonymous-creation cap. This is the second-source-of-truth class we removed three times
  this cycle. Fixed two ways: (1) 0015 is now in `ATTENDUES` (a report-only entry — presence degrades
  on the RPC being absent, not on probing the column, but column and function ship together in 0015,
  so the probeable column is the witness that 0015 is applied); (2) a new guard
  (`carteSchemaMigrations.test.js`) asserts every `add column if not exists` in a migration is either
  probed (`ATTENDUES`) or explicitly exempted — so the list reddens on a future omission instead of
  being completed from memory. Reported by the second host on 0.1.88.

## [0.1.88] — 2026-08-20

### Changed (presence — atomic upsert + anonymous creation cap, audit CODEX 5.6 P1c step 1)

- **Presence is now written in one atomic gesture, and fake anonymous participants are capped.**
  `recordAttendance` did a read-modify-write with an optimistic lock and up to four retries per
  heartbeat. A new `player_attendance_bump` RPC (migration 0015, same pattern as
  `player_rate_limit_bump`) does the same in ONE gesture — capped time accumulation, page union,
  strictly-increasing `last_seen` — and, in the same atomic statement, enforces a cap on NEW
  anonymous participant rows per `(presentation, IP fingerprint)`. Because an `anon-*` key is chosen
  by the browser, one visitor could otherwise fabricate thousands of fake participants. The cap
  (default `ATTENDEES_PER_EGRESS × 1.3` = 325, host-configurable via `presenceAnonCap`) never blocks
  a heartbeat of an already-registered key, and never counts authenticated members or the presenter.
  Creation and count are serialized by a per-`(slug, IP)` advisory lock so concurrent creations
  cannot overshoot together (proven under real Postgres concurrency in `base/`). The IP is stored
  only as a truncated hash, never in clear. **Degrades if the migration is absent**: the code falls
  back to the read-modify-write loop (still correct, without the creation cap) and says so once,
  naming the file — same doctrine as the rate-limit RPC.

## [0.1.87] — 2026-08-20

### Changed (performance — telemetry quota, audit CODEX 5.6 P1b)

- **External telemetry quota is split into two buckets, and checked before the link is read.** The
  single `sess:${ip}` bucket metered every external event (open, page, session) while its quota was
  derived from SESSION writes alone — so 25 readers behind one IP drained the session budget with
  their open/page events before writing a single session, and the rest was silently dropped. Now the
  session (a rich `upsert`) keeps `SESSION_QUOTA_PER_HOUR` on `sess:`, while the light open/page/
  heartbeat events (a cheap `logView`) get their own `view:` bucket with `VIEW_QUOTA_PER_HOUR`
  (derived from a per-reader budget, generous because `logView` is cheap). And the quota is now
  checked BEFORE `getShareBySlug`: an over-quota request no longer costs a DB read. Over-quota drops
  still return 200 (a measurement must not break a read) and now name the dropped class once per hour
  (`abandon: true`) so an operator can tie a stalled table to a quota. Test-link reads stay exempt
  from writing, not from the quota.

## [0.1.86] — 2026-08-20

### Fixed (reliability — two regressions from this cycle)

- **`recordAttendance(slug, participant)` is callable again at two arguments.** 0.1.84 slipped the
  "presentation already loaded" optimization into the SECOND positional slot, displacing the real
  parameter — an external host calling the published `./presentations` export with the old two-arg
  contract got `TypeError: Cannot destructure property 'key' of 'undefined'`. The optimization now
  lives in an options bag: `recordAttendance(slug, participant, { presentation })`. Two args = the
  old contract (presentation is re-read); the internal route passes `{ presentation }` and still
  avoids the extra read. New test exercises the public two-arg call.
- **Adaptive session net no longer locks a measurement behind a failed send.** 0.1.85 recorded the
  "already sent" signature BEFORE calling the transport, and `post()` swallows exceptions while
  `sendBeacon` can return `false` without throwing. A failed send therefore made the next tick — at
  an identical measurement — skip, losing the last measurement if the reader went idle or closed
  right after. The signature is now retained ONLY when the send actually left (transport returns
  `boolean | void`; an explicit `false` or a thrown error counts as "not sent" and the next tick
  retries). Tests for transport-throws, `sendBeacon === false`, and successful-still-skipped.

## [0.1.85] — 2026-08-20

### Changed (performance — réduction de charge)

- **Local rate limiter is now O(1) per decision.** The in-memory counter kept an ARRAY of
  timestamps per key and re-filtered it on every call — quadratic once a key accumulated (measured
  18.7 s for 100k decisions on one key; now a few ms). And the 5,000-key cap only evicted EXPIRED
  keys, so 5,001 active keys stayed resident. Replaced by a fixed-window `{ start, count }` counter
  with a hard LRU cap (oldest key evicted past the ceiling). A fixed window admits at most 2×max at
  the seam of two windows — acceptable for an anti-flood ceiling.
- **Session persistence is adaptive: 30 s cadence + dirty flag.** The browser net re-emitted an
  identical session on every 12 s tick — a hidden tab, an idle reader, a document left open kept
  writing the same row, one DB write per tick for zero new information. The base cadence is now 30 s
  (2.5× fewer writes even for a fully active reader; the hourly quota still derives from it), and a
  tick now writes ONLY when the signature (`totalSeconds`, `maxPage`, `numPages`) changed since the
  last send. A hidden tab writes once, not every tick. The dirty flag can only fall BELOW the quota
  ceiling — it never raises it, so the quota calculation is unaffected.


### Fixed

- **Chat beyond 300 messages: new messages now reach everyone.** `order=created_at.asc&limit=300`
  returned the 300 OLDEST — past the 301st, a participant re-reading never saw new messages (only
  the author saw them, via the POST response). Now the 300 MOST RECENT (desc), rendered
  chronologically. Test at 301 messages.
- **External telemetry is bounded and rate-limited.** `upsertSession` stored `pages_time` raw
  (unlike the already-bounded internal path): a single call could write an unbounded JSON. Bounding
  is now a shared helper applied to both paths (entry cap, numeric keys/values, capped totals). And
  the external analytics path wrote with NO quota — a public slug allowed unlimited writes; it now
  has a per-IP flood cap (writes are skipped over quota, the reader still gets 200).
- **Presence quota sized for a real audience.** 1,000 beats/h/IP covered only ~6 participants (one
  emits ~144/h); the 7th behind a shared IP got 429s. The quota is now derived from the cadence
  constants targeting 250 participants/IP; `recordAttendance` reuses the presentation the route
  already loaded (one fewer DB round-trip per beat); and the heartbeat is jittered ±15% to avoid
  synchronized bursts.

## [0.1.83] — 2026-08-19

### Fixed

- **The 500-presentation off-by-one is actually applied now** — and guarded by a test that fails
  without it. 0.1.82's changelog and commit claimed this fix, but the edit had been silently lost
  (a script aborted before writing the file) and no test guarded it: the doc promised more than the
  code. The purge now queries `cap + 1` presentations and truncates on `length > cap`, so exactly
  500 expired presentations with no 501st report `tronque: false` instead of a false positive.
  Two dedicated tests: exactly 500 → false, 501 → 500 processed + true.

### Changed

- **Container image builds run in parallel; only the `latest` promotion is serialized.** Workflow-
  level concurrency kept just one queued run, so three tags in quick succession would cancel the
  middle one and its versioned image would never be built. Versioned builds (distinct tags, no
  conflict) now run freely; a separate serialized `promote-latest` job recomputes the highest tag
  and retags `latest` atomically — no versioned image can be lost.

## [0.1.82] — 2026-08-19

### Fixed

- **The retention report's `tronque` now tells the truth for presentations.** It came only from the
  presentation-list length and budget exhaustion, never from the child purges' truncation — a
  presentation kept because its messages or attendees were truncated still reported `tronque:
  false`. Data stayed safe (the parent is not deleted), but supervision was wrong. Now
  `presRapport.tronque ||= msgs.tronque || pres.tronque`, and an off-by-one is fixed (query
  cap+1, truncate when `length > cap`, so exactly-500 presentations with none after no longer
  false-positives).

### Changed

- **Container image publishing is fixed and hardened** (delivery P1): a literal `\n` in the tags
  expression had made a single invalid tag, so the `v0.1.81` image was never published. The build
  now pushes only the immutable versioned tag; `latest` is promoted afterward by an atomic retag
  (`imagetools create`) with the highest git tag recomputed just before promotion; `concurrency`
  serializes publishes; the manifest and both architectures are verified, and `latest` is checked
  to share the versioned tag's digest. The hourly job opens an issue if npm serves a version whose
  image is missing. The `v0.1.81` image was backfilled.
- The accessibility E2E measures the stable overlay state (`reducedMotion`, waits for animations)
  instead of a mid-transition — no more contrast flake.

## [0.1.81] — 2026-08-19

### Fixed

- **The presentation purge cap is now GLOBAL, not per-presentation.** It was applied per
  presentation — 500 × 5,000 = 2.5 M messages possible in one run (serverless timeout, chat
  contention). Messages and attendees each get one shared budget spread across presentations; the
  loop stops when they are exhausted, without deleting the remaining presentations. `plafond: 1`
  over 3 presentations now deletes one message total, not three.
- **The dry-run report is complete for presentations**: `messagesExaminees`, `presencesExaminees`
  and `fichiersCandidats` report what a real purge would do (same selection path, no-op deletes,
  `efface.* = 0`) — an operator no longer under-estimates the real purge.
- **`in.(…)` values are URL-encoded.** A reserved character in an id (`&`, `#`, `"`, `,`) broke the
  filter — quoting handles PostgREST's delimiters, but the URL's (`&`, `#`) need percent-encoding.
  Found by a new **volumetric real-Postgres bench** (multi-batch, exact cap, a >5,000-message
  presentation over two passes, reserved-char ids).

### Changed

- **The container image release is hardened** (after moving it off the npm critical path): `latest`
  is promoted only when the tag is the highest git tag (no more slow old build overwriting it), and
  a deferred check verifies the tag's GHCR manifest is actually served.

## [0.1.80] — 2026-08-19

### Added

- **A single destruction gate, guarded by form AND by execution.** The three recent P1s were the
  same class — an option defined and validated but not honored on every write path. Following the
  second host's refinement (*defined / transmitted / honored* — the last is proven by enumerating
  paths, not by reading one point, and a reading-window guard would fall into the very perimeter
  trap it guards against), retention.js now routes every delete through one `effacerParIds` and
  every file removal through one `retirerFichier`, each short-circuiting `dryRun` on its first
  line. Two guards: a **form** guard (exactly one `method: "DELETE"` and one `.remove(`, each
  dominated by `dryRun` — it grows with the file, so a third write path must pass through the gate)
  and an **execution** guard (a dry-run emits zero destructive calls on any path).
- **`retentionSweep` in the identity card** — whether the automatic purge is *armed*
  (`config.retention.balayage === true`), beside `internalStrict`. The `retention` capability says
  the instance *can* purge; this says whether it *does*. A cockpit can now read if an instance is
  subject to automatic deletion instead of inferring it from a log.

## [0.1.79] — 2026-08-19

### Security / Safety

- **P1: `retention.run` now passes its options through — `dryRun:true` no longer deletes.** The
  route received `dryRun:true` but called `purgerRetention(Date.now())` without the second
  argument, so the purge fell back to `dryRun:false` and deleted for real — the worst case, since
  `dryRun` is what an operator runs first. Options are now validated before any DELETE (`dryRun`
  strict boolean, `taille` 1–500, `plafond` 1–5000, unknown key rejected — never a `Number()` or
  `!!`); an invalid option returns `400`. HTTP-level test plus a mutation (removing the 2nd
  argument) that must fail.

### Fixed

- **The purge never exceeds its cap, counts the dry-run exactly, and leaves no orphans.** Batches
  are clamped to the remaining cap (`min(taille, plafond − examinees)`); dry-run paginates by a
  keyset cursor (`col=gt.…`, portable — no `offset`) so it no longer re-reads the first batch
  (120 rows counted 120, not 300); a one-row probe distinguishes "exactly at the cap, nothing
  left" from "more to do". A presentation is deleted only if its messages AND attendees are fully
  purged — otherwise it is kept inactive for the next pass (no 1,000 orphaned messages). Attachment
  reads are folded into the bounded message batch; DELETE counts the rows it actually returned
  (concurrency-safe); `storage.remove` returning `false` counts as an error.
- The `storage.remove` barrier gets a direct test; the census SQL takes psql window variables
  (custom retention windows now check the same policy); the stale "unknown action → ok:true"
  comment is corrected.

## [0.1.78] — 2026-08-19

### Security

- **P1: an attachment can only name its own presentation's folder — at write AND at delete.**
  `addMessage` accepted the client's `attachment.url` on a bare `startsWith` check; a
  `…/present-attachments/../autre-bucket/secret.pdf` passed. The chain lay inert while the URL was
  only ever read; the retention feature gave it teeth — `storage.remove` concatenated the path
  into a service-role DELETE and `fetch` normalized the `..` out of the bucket. A single canonical
  path validator now guards both barriers (path must start with `<slug>/`, signed-path alphabet,
  rejects `.`/`..`/`%2e`/`%2f`/`%5c`/backslash/null); writes store the validated path and
  reconstruct the URL server-side; deletion re-validates against the purged slug; `storage.remove`
  is whitelisted to its bucket. No live exposure — retention is off everywhere by decision.

### Fixed

- **Retention windows are validated before any DELETE.** Non-integer, out-of-range `[1,120]`,
  negative, zero, `NaN`, `Infinity` or string windows now fail the purge (a negative window
  computed a *future* cutoff — mass deletion). Cutoffs are computed in UTC and clamped to the
  month's last day (`31 Mar − 1 month` = 28 Feb, not 3 Mar).
- **The purge runs in bounded batches** (select a capped id batch, delete by `id=in.(…)`, repeat)
  instead of one `return=representation` delete of the whole history; a per-table report
  (`examinees`/`supprimees`/`tronque`) and a `{ dryRun: true }` mode replace the id list.
  Migration `0014` adds the three retention-filter indexes.
- **An unknown POST `action` is rejected** (`400 unknown-action`) instead of falling through the
  analytics fallback and returning `{"ok":true}` — a typo like `present-pgae` no longer looks
  like a success. `retention` joins the `?contract=1` capabilities; `retention.run` is documented.

## [0.1.77] — 2026-08-19

### Added

- **The package exposes its contract and retention policy as exports** —
  `require.resolve("discovery-media-player/contrat")` and `…/retention`. Two consumers were
  reading our files by hand-written `node_modules` paths, and both broke during one day of
  refactoring — with no way for us to know who else does. An exposed path is a promise that
  survives reorganizations; a found path is a guess about our tree. `docs/RETENTION.md` ships in
  the tarball, and CI holds the promise from a real consumer install.

## [0.1.76] — 2026-08-19

### Changed

- **Refactor lot 3, no behavior change: the POST route families leave `handler.js`** (1,761 →
  908 lines — 4,362 at the start of the day). Soft-wall, live-presentation, sales-agent and
  share-link actions each live in their own `server/routes-*.js` module, plus `appelant.js` for
  caller identity. The dispatch tests each family's RETURN value (false = not mine, anything
  else = responded) — no duplicated action lists, and no reliance on `res.writableEnded`, which
  test doubles and some hosts' response objects do not carry (58 unit tests said so before CI
  did). The source-text surface covers all sixteen server files. Byte-identical blocks;
  858 + 19 tests green.

## [0.1.75] — 2026-08-19

### Changed

- **Refactor lot 2, no behavior change: the page builders leave `handler.js` too** (3,029 →
  1,761 lines — 4,362 this morning). Viewer, audience, soft wall, legal footer, session keys,
  `jsonPourScript` and the pdf.js asset URLs each live in their own flat `server/` module; every
  module's requires were detected from its own text, not listed from memory, and host plugins
  resolve from the context in each module. The source-text test surface (`sourceDesPages.cjs`)
  covers all eleven files, with the completeness test's shape widened to `page-*`. Byte-identical
  templates; 858 + 19 tests green.

## [0.1.74] — 2026-08-19

### Changed

- **Internal refactor, no behavior change: the page templates leave `handler.js`** (4,362 →
  3,029 lines). Live layer, map overlay, sales-agent assets, pinned third parties and text
  helpers now live in their own flat `server/` modules — flat on purpose: several CI guards
  target `server/*.js`, and a subdirectory would have silently emptied them. The source-text
  tests read the concatenation of handler + templates (a completeness test enumerates
  `gabarit-*.js` from disk), so a moved template never leaves their sight. 856 + 19 tests green,
  byte-identical templates.

## [0.1.73] — 2026-08-19

### Fixed

- **The confirm button failed WCAG contrast for real** (`#e5484d` under white = 3.9:1 → `#d13b40`
  = 4.75:1) — found by the "provoked states" accessibility pass: rating, quiz, goodbye, resume
  overlays (agent viewer) and the ended screen + OPEN dialog (audience) are all `display:none`
  at rest, invisible to any post-load audit. The bench now shows each state with the production
  gestures and runs axe on it. Also instructive: measuring DURING the dialog's entry animation
  (opacity < 1) blends the box into the dark backdrop and fabricates false contrast failures —
  the arbiter now waits for the stable state, the one users actually read. Stated limit: dynamic
  overlay content (rating stars, quiz cards) is injected by the HOST's PlayerBot — this bench
  measures what this package ships.

## [0.1.72] — 2026-08-19

### Fixed

- **The retention sweep is strictly opt-in** (`config.retention.balayage: true`). The second host
  consumes the standalone context as-is — "nothing to plug because nothing was unplugged" — and
  its first share action after upgrading would have swept with OUR default windows, decided by
  nobody; only its five-day-old data made that harmless. Retention windows are business
  decisions: deletion only acts where an operator wrote it. `retention.run` stays available
  without the opt-in — calling it IS the decision. `docs/RETENTION.md` also names the temporal
  depth `information_schema` cannot see: dropped columns, dumps and backups are the operator's
  perimeter, stated rather than simulated.

## [0.1.71] — 2026-08-19

### Added

- **Data retention, as a two-sided contract.** `docs/RETENTION.md` declares a policy for every
  personal-data-shaped column — and a CI guard enumerates the LIVE schema (`information_schema`,
  classified by forms: email, ip, ua, name, body, session…) and refuses any column without a
  written policy, deny-by-default. `server/retention.js` purges by windows (13 months for reading
  journals — including the clear-text IP —, 12 months for dead presentations with their messages,
  attendees and bucket attachments, 13 months for revoked links; host-adjustable via
  `config.retention`) and declares its counts from the rows each `DELETE` returned. The other
  half, `supabase/recensement-retention.sql`, recounts in raw SQL what remains in the claimed
  perimeter — sharing no function, filter or transport with the purge: two texts that cannot be
  wrong the same way. CI runs both against a real Postgres: seeded old rows must be declared
  exactly, fresh twins must survive (over-deleting is as wrong as forgetting), and the census
  must find nothing.
- Migration `0013`: `revoked_at` dates a link's revocation — "13 months after revocation" was
  uncomputable without it. Existing revoked links start their clock at the migration. Trigger:
  `retention.run` (trusted host or admin) plus an opportunistic sweep at most once per 24 h.
- First `DELETE` in the product's database surface — every call bounded by an age filter.
  `storage.remove` joins the standalone context as an optional capability (attachments of purged
  presentations); without it the rows still go and the limit is written, not simulated.

## [0.1.70] — 2026-08-19

### Fixed

- **The release chain publishes nothing before its gates.** Three releases in a row (0.1.67 →
  0.1.69) published npm then failed on notes extraction, silently skipping the GitHub Release,
  the GHCR image, SBOM and provenance — and 0.1.68 was published while its CI was red. The
  workflow now requires the exact commit's CI to be entirely green and the changelog section to
  exist BEFORE `npm publish`, and a `workflow_dispatch` replays the release of an existing tag
  (npm skipped, everything else redone). The three missing GitHub Releases and the 0.1.69 GHCR
  image were recovered.
- **Legacy-link backfill catches the 409 like the creation path does.** Two pre-0011 duplicates
  racing: one gets the canonical key, the loser now re-reads the winner instead of surfacing a
  500 — the fix had not applied to itself. The test double learned PATCH uniqueness first
  (the partial index does not distinguish INSERT from UPDATE).
- Migration `0012`: the `idem_key` column comment in the database described the dead concatenated
  format; it now describes the digest. Nominatim coordinates are bounded to [-90,90]/[-180,180].

### Added

- **The confirmation dialog traps and returns focus, keyboard-driven in the bench:** Tab loops
  between the two buttons, Shift+Tab loops backwards, Escape closes and gives focus back to the
  element that had it — a `role=dialog` without a focus trap is a declaration with no effect.
- `build`, `lint` and `typecheck` refuse by name outside a clone, like the three benches.

## [0.1.69] — 2026-08-19

### Fixed

- **The light-theme loader failed WCAG contrast (`#lpct`) — found by measuring what only exists
  while loading.** Both loader themes are now frozen on screen (the file request is stalled) and
  passed under axe: a transient state that no post-load audit ever saw. The dark loader — the one
  both external brands use — was already compliant; our light one was not.

### Changed

- **The three bench scripts (`test`, `test:e2e`, `test:base`) refuse by name outside a clone.**
  A published `package.json` describes what the maintainer can do, not what the consumer receives:
  the `scripts` field is not filtered by `files`. From a consumer install these scripts now exit 1
  with the reason and the repository address, instead of a config-not-found error that looks like
  a broken installation. CI installs the real tarball as a consumer and requires the named refusal.

## [0.1.68] — 2026-08-19

### Added

- **Accessibility, measured rather than declared.** axe-core arbitrates inside the real-Chromium
  bench (injected over the inspection protocol — the production CSP stays intact): zero
  serious/critical WCAG 2.1 A/AA violations required on the traced viewer and the audience page,
  and the arbiter is proven against a deliberately broken page (its zeros must mean something).
  First measurement found five real violations (legal strip at 0.42 contrast, keyboard-inaccessible
  scroll region, the presented document image with no name, join card at 4.48:1, loader subtitle) —
  all fixed.
- **What axe cannot demand, the bench asserts one by one in the final DOM:** a live region
  announces page changes and the end of a presentation; the chat feed is a `role=log`; inputs and
  buttons carry names; every rendered canvas is `role=img` + "Page N" (viewer AND audience — the
  audience canvas path required adding a real-PDF presentation to the bench); dialogs declare
  `role=dialog`/`aria-modal`.

## [0.1.67] — 2026-08-19

### Fixed

- **`init.sql` is replayable from an old base again.** The unique index on `idem_key` (line 62)
  ran before the catch-up `ALTER` that adds the column (line 410): a base born from the 0.1.64
  init crashed before reaching what would have saved it. Conditional columns are now ensured
  right before their index, and CI installs the historical init from the `v0.1.64` tag, replays
  the current file, and requires the exact shape of a fresh install.
- **The link idempotency key is a digest — one function writes and re-reads it.** The historical
  `hote:<docId>|<email>` form was truncated to 300 chars at insert but re-read in full after a 409:
  a legitimate loser on a long docId ended as a 500. Keys are now
  `genre:sha256(JSON.stringify(parts))` — fixed length, fixed boundaries, no truncation. Legacy
  keys self-heal: reuse goes through `doc_id` and re-writes the canonical key.

### Changed

- pdf.js assets are read once per process (no more per-request disk read of 1.7 MB); Nominatim
  coordinates are numerically validated before entering attributes; `PLAYER_INTERNAL_STRICT` is
  documented in `.env.example`.

## [0.1.66] — 2026-08-19

### Changed

- **pdf.js is bundled, served from our own origin, and current: 3.11.174-from-CDN → 6.2.108 local
  ESM.** What disappears in one move: the cdnjs third party in two CSPs (plus `blob:` in
  worker-src, plus the preconnects); the worker no `integrity` attribute could ever cover (it does
  not enter through a tag) and the whole fingerprint dance built around it; a pin that hung on
  what cdnjs chose to keep publishing; and the 2026 vulnerability affecting 5.6.83+ (fixed in
  6.2.108 — `isEvalSupported: false` kept on every call). Assets are served by `?asset=pdf` /
  `?asset=pdfworker` — version in the URL, immutable cache, byte-for-byte identical to the pinned
  `pdfjs-dist` package, `nosniff`. ⚠️ **No `enableScripting:false` placebo**: that option belongs
  to Mozilla's viewer, not to `getDocument` — adding it would be a description stronger than the
  implementation. The real guarantee is structural: the scripting sandbox
  (`pdf.sandbox.min.mjs`) is neither served nor loaded anywhere.

- **The bench finally renders a real PDF.** Three years of CDN made the PDF path untestable — the
  e2e fixture was an image, on purpose. The bench now renders a **real PDF** (hand-built with
  computed xref offsets) through the **real 6.2.108 worker** in a **real Chromium**, and asserts
  the claim that matters: **zero requests leave our origin**. The bench drops from 98 s to 4 s —
  nothing left to download.

### Fixed

- ⚠️ **Two sentinels from the tag era nearly sank the whole page** — zero requests, zero errors,
  zero document. Not the import: `if (!window.pdfjsLib) return` at the top of the viewer, and the
  audience boot listening on `script[src*="pdf.min.js"]` — a tag that no longer exists. Both made
  the entire viewer exit **without a word**. Found with an instrumented-Chromium probe, not by
  re-reading — which also caught a real CSP bug of this migration: `'none'` alongside `'self'`
  invalidates the whole directive. The browser-side silent-success class, same family as the
  close-path fixes of 0.1.61.

## [0.1.65] — 2026-08-18

The remaining P2s of the fifth audit.

### Fixed

- **One purpose, one link.** The host link (one per document and attested recipient) and the
  rehearsal link (one per document) read "does it exist?" then inserted: two requests in the same
  second both passed the read — **two links for the same purpose, statistics fragmented between
  them**, discovered reading them six months later. Same remedy as message idempotency (0005):
  migration `0011` adds a **nullable** `idem_key` with a **partial** unique index — ordinary links
  stay unlimited, only system links carry a key (`hote:<doc>|<attested>`, `repetition:<doc>`). The
  constraint's 409 is a **confirmation**: re-read the winner, `reused: true` — and a 409 with
  **no winner raises**, we do not invent a link. Historical duplicates are kept (their URLs are in
  inboxes): the first one reused receives the key on the way, the others die out unused.
  ⚠️ The test harness had to **replay the window, not the sequence** — the route's awaits
  serialized two `Promise.all` requests and the second *found* the row at SELECT time: the harness
  validated the old code. ⚠️ The key is only written where the column exists — the surviving
  mutation showed that on an unmigrated host it is not uniqueness that breaks, it is **link
  creation**. Audit 5, P2.

- **The Maps pin no longer pinned.** Google serves a sliding window of versions (~4 quarters);
  `v=3.58` fell out of it, so the parameter was **ignored** and the weekly channel loaded — the
  pin lied with no error anywhere. Pinned to 3.65, and the comment now carries the **date of the
  last check** — the only possible guard for a window only Google knows. Audit 5, P2.

- **Five texts described a vanished world** — each rewritten first, cited after: the README's
  "visible and focused" (focus is not required — visible and recently active); `tracking.ts`'s
  "60 s" idle default (the constant beside it said 180,000 ms); `MIGRATIONS.md`'s bare "never
  remove" (additive is about the **shape of the data** — the three permitted non-additive gestures
  are named, four shipped migrations already used them); `init.sql`'s "the publication remains
  useful" (contradicting the very next section, and 0009 removes it); `presentation-state.ts`
  describing table reads in the present tense. The 2026-08-14 audit tracker now carries a
  **historical** banner. Audit 5, P2.

## [0.1.64] — 2026-08-18

Every P1 of the fifth audit pass, closed. One of them was a defect in the very migration that
claimed to make the archive atomic — proven on a real database before being fixed.

### Fixed

- **The archive seal now actually locks.** Closing a presentation modifies `active` and
  `control_hash` — **non-key columns** — so its UPDATE takes `FOR NO KEY UPDATE`, which the
  trigger's `FOR KEY SHARE` (0007) does **not** block: the trigger checked "open", the close
  committed underneath it, and the message entered the archive. The window 0007 claimed to shut
  was open, and its comment asserted an atomicity it did not provide. ⚠️ **Seen refusing on a real
  database first**: the forge's two-transaction bench went red — *"the message ENTERED the
  archive"* — then green with measured waits (the write **waited 1444 ms** for the uncommitted
  close, then was refused; the close waited for the in-flight write). Migration `0010`
  (`FOR SHARE`); 0007's comments rewritten, not cited. The CI shape now includes **function and
  trigger bodies** (`pg_get_functiondef`/`pg_get_triggerdef` md5) — it caught two init/migration
  body divergences before even serving its purpose. Audit 5, P1-1.

- **The owner travels in the condition — switch and content too.** `switchPresentationDoc` and
  `setPresentationContent` (owner path) verified the owner at read time, then wrote on
  `slug+active` alone: a transfer between read and write handed the presentation to Bob, and
  Alice's **delayed** request still changed Bob's document, or showed **her** map to Bob's
  audience. Two survivors of the class closed in 0.1.60; `owner_email` in the filter, admin
  unconditional (moderation), pilot path unchanged, zero rows = 409. Audit 5, P1-2.

- **Deletion always wins over content.** Editing and reacting checked "not deleted" at read time,
  then wrote by `id` alone: a deletion in between emptied the message — and the delayed write
  **resurrected** the text or reactions inside a row marked deleted. Erased on screen, alive in
  the JSON. Edits require `author_hash+deleted=false` (zero rows = 409); reactions carry
  `deleted=false` on every attempt and stop with 404 if the message vanishes mid-loop — a replay
  would revive it; author-deletion is **idempotent** and now clears the quote too
  (`reply_text`/`reply_name`). ⚠️ **Belt in the projection**: a deleted row leaves empty whatever
  the database still holds — the only place that also covers the past. ⚠️ Presenter path: the
  token lives in **another table**, no PostgREST filter can carry it — the residual window (an
  ex-presenter moderating in the second his control is reclaimed) is documented and accepted: it
  only grants a right he legitimately held an instant before. No RPC. Audit 5, P1-3.

### Added

- **`internalStrict` on the identity card.** In transitional mode the internal-analytics route
  accepts `docId`/`email`/`name` as the client declares them — a caller can fabricate "this
  colleague read this document". The route already logs unsigned writes, but a log only lets you
  reconstruct; the boolean makes the state **refusable by monitoring**. `false` is never absent —
  a missing field cannot be refused. The strict default will come with an announced breaking
  change. Audit 5, P1-4.

## [0.1.63] — 2026-08-18

### Fixed

- **The last read-modify-rewrite in the repository is closed — without a migration.** Two tabs of
  the same participant heartbeating in the same second: both read the same row, the second rewrite
  swallowed the first — a viewed page vanished from the statistics, no error anywhere. And two
  *first* heartbeats at once: the primary key refused the second with a 409 nobody caught — a 500
  for a heartbeat, benign but wrong (now caught, re-read, and **logged as benign**: the
  silent-write guard refused the quiet first draft, as it did for P10). The lock is free:
  `last_seen` changes on every accepted beat, so the write is conditioned on the value read — zero
  rows means re-read and replay, bounded to four rounds. ⚠️ **The lock was blind within the
  millisecond**: two beats in the same ms write the same `last_seen`, the next condition still
  matches, and the overwrite comes back through the very window just closed — seen at the bench
  (three writes, three true conditions) before being seen anywhere else. An accepted `last_seen`
  is now **strictly increasing** (`max(now, read + 1 ms)`); the mutation removing the `+1`
  **survived** the first round because the test clock was not frozen — frozen, replayed, red.

- **The chat broadcast payload is empty — the strong property became true instead of the
  description becoming weaker.** The second host confronted "a signal, never content" with the
  code: the payload *carried* the projected row — dead weight no receiver consumed (they re-read
  over HTTP), kept alive by a stale comment describing a vanished world. A content nobody consumes
  is not neutral: the day a new receiver reads it "since it is there", the projection becomes
  optional in silence. `payload:{}`, like `sendState` and `sendMap` already did; full
  compatibility (every published receiver already ignores it); the mutation putting content back
  is named by the rule guard.

### Changed

- **The column guard no longer erodes as the code improves.** Its sweep only read `body: {…}`
  literals: every adoption of the conditional-write helper silently removed a site from its
  enumeration — six columns vanished the day attendance took the pattern, seen in a **count diff**
  (813 → 807 tests), never in a red. A guard whose coverage shrinks when the code gets better
  punishes the very gesture it should encourage. It now reads all three write forms: **31 → 71
  columns checked** against `init.sql` and the migrations.

## [0.1.62] — 2026-08-18

Fourth external audit pass, both lots. Surface reduction on the database side, one serialization
rule on the template side — and the afternoon's flaky test, caught and fixed.

### Fixed

- **The database stops offering the channel nothing listens to.** Chat travels as broadcast — an
  invalidation signal, never content — followed by a bounded HTTP re-read serving the **public
  projection**. Yet `init.sql` still published `doc_presentation_messages` into `supabase_realtime`
  with `REPLICA IDENTITY FULL` (0.1.58 had fixed the *comment*, not the install). An unused surface
  is not a neutral surface: the day someone adds a public `SELECT` policy "so live works" — the
  exact mistake the historical host had to climb out of — the publication becomes a channel again,
  delivering the **whole row**, `author_hash` included, bypassing the projection. ⚠️ And
  `REPLICA IDENTITY FULL` costs on every write: each reaction wrote the full row image to WAL —
  measured `relreplident='f'` in our production before applying. Migration `0009` (idempotent;
  refuses **loudly** on a `FOR ALL TABLES` publication instead of pretending success); the CI shape
  now includes **publications and replica identity** — the third blind spot of the same kind, after
  nullability and triggers — and two scenarios run against real databases: an old base cleaned
  twice, a fresh one where the table never enters.

- **One serialization for everything entering a `<script>`.** The HTML parser reads the page before
  JavaScript: a `</script>` inside a JSON string closes the element for it — the nonce CSP blocks
  the injected script's execution, not the page breakage. Protection lived scattered: a `.replace`
  at the interpolation site for `CFG` (the rich data — the only surface carrying user input), and
  **six naked interpolations** beside it (server/operator values: hardening, not an exploitable
  hole). `jsonPourScript` applies the rule **at serialization**, where it cannot be forgotten field
  by field; `undefined` throws instead of silently becoming text. The guard checks the **rule**,
  not a list — a variable added tomorrow goes through the function or the test names it — and
  strips comments before searching, because a probe that reads comments invents culprits. Proven on
  the **rendered page**, not just the function: the audience page rendered with a hostile title
  carries no raw string, the neutralized form, no open executable fragment.

- **The quadratic-cost demonstration no longer depends on machine load.** The test proving the old
  address pattern's O(n²) cost went red three times in one afternoon, never twice in a row — seven
  takes on 16,000 characters graze the 5 s ceiling under load. Its first stabilization pass (min of
  takes) had fixed the *ratio*; the *total time* was failing. Same square, one-sixteenth the cost
  (2,000 → 8,000), explicit ceiling. *An unstable test has a danger of its own, worse than failure:
  you learn to ignore it, then ignore it the day it is right.*

## [0.1.61] — 2026-08-18

The second host had **four presentations stuck "active" for three days** — and nobody saw it.
*A failed close deprives you of nothing you look at*: its success produces nothing, so neither
does its failure. This release closes that class, four times over — and ships the contract fix
that 0.1.60's release notes were already pointing hosts to.

### Fixed

- **The close route's catch swallowed everything without a trace.** Every "End" failed with 23502
  (0.1.60's archive-marker defect) and that silent 500 left **nothing** — not even a line in the
  error journal. A journal nobody reads is worth little; no journal is worth nothing. The catch
  now captures, with the route named.

- **The stale-presentation purge only ran if somebody opened the panel.** It lived solely in
  `listActivePresentations`: no panel, no purge, eternal orphan. It now also hooks a gesture that
  happens on its own — **starting a presentation purges the orphans before it** (presenters create
  them; the next one cleans). Conditioned (`active=eq.true&last_seen=lte.threshold` — a session
  that just heartbeat is untouched), and **never a prerequisite**: a failing purge does not prevent
  presenting, or we would have traded an invisible orphan for a visible outage.

- **The on-click failure was a tooltip.** "The end was not recorded" lived in a `title` nobody
  hovers. It is a visible banner now — "the presentation is STILL ACTIVE" — cleared on retry. The
  existing test pinned the tooltip; it demands the visible element.

### Added

- **Re-read, don't reuse: a second round-trip after the server's ok.** Reserve raised by the second
  host before merge, and it was right: re-reading the PATCH response would do exactly what the
  negative cache did — the measurement would confirm what the write *believes* it did. After the
  ok, the client re-reads the public state independently; if the database still says *active*, the
  interface **does not close** — closing would convert a failure into visual confirmation, the
  exact interface optimism that lied to the second host's presenter. ⚠️ An **unavailable** re-read
  is not "still active": the server confirmed, verification is a bonus, its absence is neutral —
  a 429 on the read must not trap the presenter in an interface that refuses to close. This is the
  only way to make the whole silent-success class observable, including against a future server
  answering ok without having written.

- **The identity-card contract now states the exact shape of `manquant`** (`{migration, fonction}`),
  with the second host's rule: a card without a `schema` field is an **alert**, not a success — it
  signals a pre-0.1.58 instance, a version that cannot answer the question. They had typed the
  shape from memory (their bench built the card the same wrong way, so no mutation could catch it);
  our share of that defect was a shape written nowhere. Merged in #136, and **published here** —
  0.1.60's notes pointed hosts to a contract the package did not yet carry.

## [0.1.60] — 2026-08-18

Closes every P1 of the third audit pass, plus one defect no report had seen.

### Fixed

- **The reaction intent finally travels the HTTP route.** `toggleReaction` could set a state since
  0.1.56, the browser sent it since 0.1.56 — and the route called the function **without the fifth
  argument**. Three releases long, the real path kept toggling: the double click switched the
  reaction off, the very defect P10 believed closed. ⚠️ The tests exercised the function, never the
  route: the mutation went red, the property was true — **on a path production does not take**. The
  new test plays the same property through `player.handler`. Audit 3, its first finding.

- **A reactor's identity is derived, no longer declared.** The client sent `reactor: MOIREF` — and
  MOIREF is **public**: every participant receives everyone's refs inside the reactions array. Anyone
  could copy another's ref and set or remove **their** reactions. The client now sends its author
  token — the secret that never leaves its browser — and the server derives the ref with the same
  chain as the client (`sha("ref:" + sha(token))`, 16 chars); a test **confronts both engines**
  (Node crypto vs WebCrypto). ⚠️ A "compatibility" fallback to `body.reactor` survived the first
  mutation round: the forgery test sent token *and* forged ref, so the fallback never played — yet
  it is exactly the attacker's path (no token, someone else's ref). Test added, mutation replayed, red.

- **Two simultaneous reactions both survive.** Read-modify-rewrite lost one of them silently. Same
  remedy as steering writes: a **rank** (`reactions_seq`, migration `0006`) — the write carries the
  rank it read, a passed rank touches zero rows, the server re-reads and replays, bounded to four
  rounds (each round, at least one writer wins). On an unmigrated host reactions keep working —
  last writer wins, as before.

- **Six presentation writes carried their check, not their condition.** Reclaim, heartbeat,
  owner-close, handover, chat lock, auto-purge: all read the row, verified, then **PATCHed by slug
  alone**. A stale reclaim stole the session a handover had just granted; a stale heartbeat kept an
  orphan alive forever; a delayed close shut the **new** owner's session; two concurrent handovers
  moved the document twice; the purge switched off a session that had come back to life. Owner or
  token now sits **in the PostgREST filter**, zero rows = 409 — the form `setPage` already had.
  ⚠️ The chat-lock mutation survived the first round: the test mutated too early, and the 403 of
  the *check* played instead of the 409 of the *condition* — red for one reason, silent on the
  property. Harness hook added, replayed, red by the condition, and the test requires it.

- **The archive is sealed by the database, not only by the code.** Seven write paths check
  `estArchive()` then write — into a **different table** than the one holding the state, so no
  PostgREST filter can close the gap. The arbiter can only be the database: a trigger (migration
  `0007`), with **`FOR KEY SHARE`** locking out a concurrent close until the write commits — the
  lock is what makes the refusal atomic, not the test. The code checks remain as the *friendly*
  refusal; unmigrated hosts keep exactly the window they had. Proven at the real-database bench, by
  a POST that bypasses every code check on purpose.

- **Closing a presentation was impossible on a fresh install.** Closing sets `control_hash = null`
  — *the* archive marker — and `init.sql` declared the column **NOT NULL**: violation 23502 on
  every close, presentations never ended, the read-only archive did not exist. ⚠️ **793 tests
  passed**: the in-memory double has no constraints (its header says so), and historical databases
  are nullable — neither the suite nor production could show it. The real-database bench caught it
  on its **first prey**, while refusing the archive seal for an upstream reason. Migration `0008`;
  the CI shape now includes **nullability** and **triggers**, without which init/migrations parity
  covered neither.

- **A schema "no" no longer outlives the outage that caused it** *(shipped in this cycle's
  branches, see 0.1.59 notes for the probe itself)*: a transient database failure during normal use
  cached "absent" for the life of the process — the feature stayed off after recovery, and
  `sonderTout()` re-served the incident dated today. ⚠️ Our recovery test called `init()` between
  failure and recovery — **which empties precisely that cache**: it proved a healing that did not
  exist. A "yes" is stable and kept; a "no" expires (60 s); the on-demand probe drops cached "no"s
  once the control column answers.

- **The local-file relay allocated before checking.** The cap lived in the handler, on
  `Content-Length` — **after** `readLocal` had already `Buffer.alloc`'d the whole range: a local
  file above the cap cost its full allocation on every request before being refused. The cap now
  sits before the allocation; a **range** below the cap of an over-cap file still passes (206) —
  that is what ranges are for. 413/416 are relayed as such instead of melting into 502.

- **Two comments described vanished behaviour** — and a stale comment in an install file is a
  defect: it pushes a maintainer to "repair" toward the exact hole. `init.sql` claimed the chat was
  not live (it rides broadcast + re-read); `viewer.ts` described a main-thread worker fallback (the
  doubt is **fail-closed**). Both confronted with the code before rewriting.

### Added

- **`?contract=1&schema=1` is bounded.** Concurrent calls share **one** probe, the result serves
  for 30 s — a public route was a small database amplifier, and the shared resource paid, never the
  caller. The cache is not eternal: an applied migration must show.

- **`schema.couvre: "colonnes-conditionnelles"`.** "complet" without a scope overpromises: the
  rate-limit migrations (0003/0004) are deliberately not in the card — a host may provide its own
  `limits` capability, where their absence is normal. The field prevents reading "complet" as
  "everything under supabase/ is applied".

- **PostgREST errors carry the response body.** A bare "400" cost a full forge round-trip to learn
  what the database had been saying from the start.

## [0.1.59] — 2026-08-18

### Added

- **`?contract=1&schema=1` — ask, and the instance actually looks.** The card was reporting only
  what the current process happened to have asked, and two hosts measured the same thing from
  opposite traffic profiles: one where presentations are the traffic, one where documents are.
  **Neither has ever read a non-zero value.** It was not *often empty*, it was *never yet observed
  to be otherwise* — so the branch that fills it was code nothing had exercised. The bare card
  keeps its property of answering when the database does not; this parameter is the one part that
  needs it, and only when asked for.

- **A `verdict`, because `manquant: []` has four meanings.** `non-sonde` / `partiel` / `complet` /
  `incomplet` / `indetermine`. Making the reader reconstruct the state by crossing two fields
  leaves them the mistake — and would have recreated, inside the parameter meant to remove the
  ambiguity, the exact ambiguity `sondees` had just killed. ⚠️ `incomplet` **wins over** `partiel`:
  a missing column is a positive fact and settles the verdict alone, even when the rest was not
  checked — the ordinary path only ever probes one expectation at a time, so without that rule a
  column known to be missing would have displayed as *partial*, which reads as reassuring.

- **A control column separates *missing* from *unreachable*.** The probe deliberately does not
  distinguish the two — for *deciding*, both mean the same thing. For *reporting*, conflating them
  is wrong in both directions: an unreachable database makes all three probes fail, so the card
  would have announced **three missing migrations that exist**, sending the operator to apply what
  they already have. The control is the primary key of the oldest table: if *it* stays silent,
  nothing is missing — the database is. Differential measurement, no dependence on a third party's
  error text, which was the very reason the probe refused to distinguish.

### Fixed

- **A diagnostic call could have switched the product off.** The probe caches its answer for the
  life of the process. Called during a database hiccup, `&schema=1` would have cached *absent* for
  all three expectations — disabling write ordering and message idempotency until the next start.
  A control route that breaks production. Silent control ⇒ nothing is probed and **nothing is
  remembered**.

## [0.1.58] — 2026-08-18

### Added

- **The identity card now says which migrations the instance is still waiting for.** A missing
  column was reported by a `console.warn`, **once per process**: on a serverless function, a line
  lost in an output nobody opens while everything *looks* fine — and *everything looks fine* is
  exactly the state of a host whose write ordering and message idempotency are both asleep. The
  trace existed at precisely the place no one looks. `GET /api/doc?contract=1` — the card hosts
  already query to pin their version — now carries a `schema` field naming the file to apply and
  the feature that is waiting. ⚠️ It **reports, it does not probe**: that route must answer when
  the database does not, so probing from it would make a diagnostic that falls together with what
  it diagnoses. ⚠️ Hence **three states, not two**: a process that has asked nothing knows nothing,
  and `manquant: []` would read as *all clear*; `sondees` is there so the two cannot be confused —
  an absence of result looks like a result. ⚠️ The file is **named**, on a public route, for the
  same reason `frameAncestors` names origins ten lines above it: the operator has no other way to
  learn which one is missing, and what it reveals — that a reliability feature is waiting, in a
  repository whose migrations are public — grants no access. Found by the second host, reading our
  probe.

### Changed

- **Schema expectations are declared once, and that declaration is the source.** The
  *(table, column, migration)* triples lived copied across four call sites. Deriving a list from
  them *for display* would have rebuilt, in miniature, the defect that had emptied `init.sql` of
  its five migrations: two copies of the same fact and no one to confront them. Callers now go
  through `attendue(name)` and no longer name a column; a CI step refuses any call that bypasses
  the table, and every file named there must exist.

## [0.1.57] — 2026-08-18

### Fixed

- **A resent message no longer creates a second one.** A network retry, a double click, a resume
  after timeout: the request left **twice** and the database stored two rows. The participant saw
  their message duplicated with nothing to explain it — no error, just one success too many. The
  client now makes an idempotency key **once, before the first send**, and reuses it on retry; a
  key drawn per attempt would prove nothing, since two sends would carry two keys and both would
  pass. ⚠️ A uniqueness refusal is a **confirmation, not an error**: the constraint says *this
  message is already here*, so the row is re-read and returned as a success — but if the re-read
  finds nothing, it is raised, because that 409 came from something else and hiding it would
  report a send that never happened. ⚠️ The column is written **only where it exists**: PostgREST
  rejects the **whole** POST on an unknown column, so on an unmigrated host it would not be
  idempotency that breaks, it would be **sending messages**. Requires migration
  `0005-envoi-unique.sql`. Audit finding **P10**, now closed.

- **The file relay streams instead of loading everything.** The ceiling added in 0.1.56 read
  `Content-Length` and took the upstream at its word — a store that announces nothing, or announces
  1 KB and sends 500, went through unchallenged. The relay now flows, with a counter that breaks.
  ⚠️ That second bound can no longer answer **413**: the headers left with the first byte, and one
  does not take back a header already sent. It cuts — the client sees an interrupted transfer,
  unpleasant and honest, where memory exhaustion took down the **whole** function, and with it
  everyone else's requests. ⚠️ The point is not to stop writing but to stop **reading**: without
  cancelling the upstream it keeps sending the file and memory goes anyway. Same reason on the 413:
  a body never pulled leaves the connection **open**, and the socket pool drains — the very
  resource being protected. ⚠️ And `fetch` **decompresses on its own**: on a gzip upstream,
  `Content-Length` counts compressed bytes while we relay expanded ones, so it is no longer
  announced. A host whose `storage.fetchFile` returns no readable body — the standalone local-file
  path — keeps a buffered path, named and tested: treating that absence as *nothing to send* served
  **empty files** in silence, a worse defect than the one being closed. Audit finding **P8**, now
  closed.

- **A fresh host was installing a truncated database, and nothing said so.** `supabase/init.sql`
  announces *one file, replayable, with nothing to read elsewhere*. **None of the five migrations
  were in it**: no write ordering, no shared rate limits, no idempotency key. ⚠️ And the host never
  found out — the schema probes degrade **silently** by design, so as not to break a host
  mid-migration; on a fresh database that same silence means four protections switched off, for
  good, without a word. A CI job now installs a **virgin Postgres** from `init.sql`, records the
  shape the database itself reports, replays every migration on top, and requires that nothing
  moved. It also tests the word *replayable*, which had never been checked.

- **Migration 0004 required Supabase roles.** `revoke all … from public, anon, authenticated`:
  `anon` and `authenticated` do not exist outside Supabase, so the migration stopped on a bare
  Postgres — every self-hosted host, the very audience this repository opens itself to. The `grant`
  six lines below was already guarded by an `if exists`, with ten lines explaining why: **caution
  had stopped halfway, in the same file**. Found by the schema guard on its first run.

### Added

- **The three properties the in-memory PostgREST double cannot simulate are now tested against a
  real one.** The double says so itself: *no constraints, no transactions… not a substitute for
  checking what belongs to the DBMS*. Yet message idempotency rests on a **unique constraint**,
  steering-write ordering on the **atomicity** of a conditional PATCH, and the whole schema probe
  on PostgREST rejecting the **entire** POST for an unknown column — three properties inferred from
  documentation and never observed. A CI job runs a real Postgres behind a real PostgREST and the
  player connects to it **the same way it connects to the double**: one URL and one key in the
  environment. ⚠️ The bench **refuses to skip** under `CI`: a bench that quietly skips goes green
  having exercised nothing. `npm run test:base`. Audit finding **P12**, now closed.

## [0.1.56] — 2026-08-18

### Fixed

- **A network retry no longer cancels the reaction you just added.** Toggling only makes sense
  once: a double click, a retried request, a resend after timeout — and the emoji the participant
  had just lit goes out. They see **no error**; they see it blink, so they click again, which
  toggles again. The caller now sends what it **wants**, not what to invert: replaying the same
  intent twice gives the same result as once. An older client keeps the toggle rather than losing
  the feature, and a test pins that inherited behaviour. Audit finding **P10** — message
  idempotency, which needs a key and a unique index, is still open.

- **Disconnecting now stops everything connecting started.** The state and chat schedulers and the
  safety-net interval were declared *inside* `connect()`; `disconnect()`, one level up, could not
  reach them. After connect → disconnect → connect, the old session's re-reads kept running: a
  viewer who reopened the page **doubled the traffic**. No amount of good will in the stop path
  would have helped — it was a matter of **scope**. The global re-read hook, which kept the whole
  closure alive, is removed too. Audit finding **P9**.

- **The file relay refuses before allocating.** It loaded the entire file into memory with no
  upper bound: an 80 MB PDF plus three concurrent range requests takes down a serverless function
  — not for one document, for the sum. The refusal happens **before the body is read**, and the
  test checks exactly that. ⚠️ An upstream that announces no size still passes: one cannot refuse
  what one cannot measure. **This bounds the large, not the unknown** — streaming will close the
  unknown, so P8 is not closed. Configurable via `PLAYER_MAX_RELAY_BYTES` (default 60 MB).

### ⚠️ The forge was broken for twelve hours, by us

Every CI run since the previous evening failed with **zero jobs**, and I blamed an ongoing GitHub
incident — real, visible on their status page, and **not the cause**. The Actions page had been
naming the file and the line the whole time.

The cause: a guard added in 0.1.51 contains a shell fragment ending in a dollar sign followed by a
quote. Passed as a replacement **string** to a text substitution, that pair means *everything after
the match* — so it re-inserted the entire tail of the workflow file, declaring three jobs twice.

⚠️ **I reproduced it twice while repairing it** — once in the workflow file, once in this very
entry, whose first draft duplicated the whole changelog. The fix is a replacement **function**.

It stayed invisible because every PR opened after 0.1.51 branched from a `main` predating it, and
so carried the old, valid file. Two true causes at the same moment, and I attributed ours to
theirs — the costliest variant of a diagnosis dressed as an observation, because the context
supplied a plausible culprit for free.

### Evidence, by strength

| | this release |
|---|---|
| **Seen refusing** | the mutation ignoring the reaction intent (two tests); the net removed from disconnect, and the handles made local again (one each); the relay ceiling removed (the 413 test) |
| **Seen falling** | nothing |
| **Never failed in front of anyone** | 752 unit tests, 8 browser tests, lint, typecheck, build |

## [0.1.55] — 2026-08-17

### Fixed

- **When the URL says nothing, the file name decides.** The audience view decided whether a document
  was an image from the URL alone. A storage URL carrying no extension therefore answered "not an
  image", and the audience got "Document unavailable" again — the defect 0.1.54 had just closed,
  coming back through the side door.

  ⚠️ **0.1.54 had kept the derived field and thrown away the authoritative one.** Two fixes had been
  written for one symptom; since either sufficed, **no mutation could turn the bench red**. Removing
  one left the other working — so I removed the one that decides, and kept the one the bench already
  knew how to see. **The bench chose the fix instead of verifying it.**

  The rule "a fix made of two changes cannot be proven" does not say *which* one to keep — and the
  answer is never "the one the bench can see". Keep the field that decides, then make the bench able
  to tell them apart.

  Measured by the second host on their own instance: **4,287** presentable documents, **23** whose
  URL carries no extension, **none of them images**. Reachable, unpopulated. The bench now populates
  the case.

### ⚠️ Evidence, by strength — and a correction to 0.1.54

Counting "734 tests" reads as if all 734 weighed the same. They do not, and the difference is the one
a hurried reader makes on our behalf, in whichever direction suits them. Three groups, borrowed from
the second host:

| | this release |
|---|---|
| **Seen refusing** — a guard replayed inverted, red observed | the mutation deciding on the URL alone: the new bench test falls, and it alone |
| **Seen falling** — a behaviour replayed, red observed | the audience page displaying an image whose URL has no extension |
| **Never failed in front of anyone** — typing, build, tests that already passed | everything else: 734 unit tests, 8 browser tests, lint, typecheck, build |

The third group is not worthless — it attests that **nothing was broken**, never that something was
repaired.

⚠️ **Which makes one line of 0.1.54 false.** It announced the image fix as "verified by mutation".
The mutation did *not* turn red — I found that out afterwards, and it was the second host who
explained why. That claim belonged to the third group, dressed as the first.

## [0.1.54] — 2026-08-17

### Fixed

- **A presentation carrying an image now displays for the audience.** The *Present* button appears
  with no condition on the document type: a presenter looking at a PNG could present it, and the
  audience got "Document unavailable" — pdf.js called on an image.

  ⚠️ **This path had always been silent.** Not a regression from the worker refusal: nobody had seen
  it because images are rarely presented. Found by the **second host, by asking** where we would have
  asserted — their own view serves images, so they asked whether ours could receive one.

  ⚠️ The first attempt at the fix **did not work, and nothing said so**: it decided on `CFG.fileUrl`,
  which is `/api/doc?present=…&file=1` — no extension, so "not an image", always. A `try/catch`
  added out of caution swallowed the cause; reading the loader's subtitle was what exposed it. A
  defensive guard that returns false on error does not protect, it **hides**.

  ⚠️ And there had been **two fixes for one symptom** — the file name added to the config as well.
  Either one sufficed, so **no mutation could turn the bench red**: removing one left the other
  working. A test never seen refusing guards nothing. One remains, and putting the proxy URL back
  does make the bench fail.

## [0.1.53] — 2026-08-17

### Fixed

- **An unverifiable pdf.js worker no longer stops an image from being displayed.** 0.1.52 gated
  `start()` — the whole reader's boot — on the worker's fingerprint. But `start()` also serves the
  **image** path, which never calls pdf.js: a worker that could not be verified therefore refused to
  show a PNG. A door closed on a room the rejected code could not reach.

  The refusal stays **whole for a PDF**, where the worker actually runs. Only the image path stops
  being gated on something it never used.

  ⚠️ Found by the **host's test harness**, not ours: its assistant stopped booting, and the first
  diagnosis was "a jsdom artefact". Fixing the harness would have hidden the defect — the harness was
  right and the diagnosis was incomplete.

## [0.1.52] — 2026-08-17

### ⚠️ One migration to apply — the player degrades without it, it does not break

`0004-limites-atomiques.sql` makes the shared rate limit count in **one atomic step**. Until it is
applied, counting stays as before — read, compute, write — so several simultaneous requests can
cross the cap together, and the player says so once, naming the file. Nothing closes: a missed 429
costs less than a dead viewer.

The atomic increment is **not expressible in REST** (`on conflict do update set count = count + 1`
has to name the column on both sides). This is the one operation in the product that needs a
database function; the portability guard still holds, an `rpc/` adding neither join nor boolean tree.

### Security

- **No email leaves the presentation any more — and four paths carried one, not two.** The audit
  reported `author_email` in the chat's public fields and `email` in the presence payload. Two more
  carried the same data: the **reactions map**, stored in the database with `email || name` as the
  reactor's identity, and the **presence channel key** itself, readable by every participant
  regardless of what `track()` sends. Our audiences are anonymous external visitors: opening the
  chat history was enough to walk away with the team's addresses.

  ⚠️ What replaces it is not a random pseudonym but the fingerprint of the **author token** — the one
  that already authorises editing and deleting. No instance secret is needed (hashing an address
  without salt protects nothing: the domain is known, first names are guessable), and **"this is my
  message" now says the same thing as "I am allowed to touch it"**: `isMine` compared addresses while
  editing has only ever checked the token, so a member on a second browser was offered an *Edit*
  button that answered 403.

- **A delayed write can no longer reopen a presentation that was ended.** Steering did: read the row,
  check the token, PATCH. Between the check and the PATCH the presentation may have been **ended** —
  and since steering writes `active: true`, the late request **reopened it for the whole audience**.
  The presenter had clicked *End*, seen the closing screen, and viewers kept following the pages.

  ⚠️ The condition is **not** `active = true`: a presentation goes inactive after three minutes
  without a heartbeat, and the next page must bring it back — an anonymous presenter has no other way
  to return. What separates a *decided* end from an *observed* expiry already exists: ending revokes
  the control token. So the token travels in the write's own condition, and each path carries the
  criterion it was already checking. Zero rows touched means refused.

- **An ended presentation becomes a read-only archive.** Seven routes still wrote after closing —
  messages, reactions, chat lock, attendance, and even a **signed upload URL** into the bucket of a
  closed session. The thread was no longer watched by anyone, which is exactly when something gets
  dropped into it. Reading stays open: what was said during a presentation has value afterwards.

- **An unverified pdf.js worker is never executed — the reader stops instead.** The previous
  behaviour fell back to the remote URL when the fingerprint refused, and **pdf.js wraps that URL in
  a same-origin blob itself**, so the unverified code ran: the worker's fingerprint bought nothing.
  Leaving the value empty does not close it either — pdf.js then derives a default address from its
  own position on the CDN. Both cancelled the check **in silence**; measuring the workers actually
  created was the only way to see it. A document that is not rendered is visible; a document rendered
  by unverified code is not.

- **Third-party supply chain, pinned where it decided for us.** 18 GitHub actions referenced by
  **tag** — which the author, or whoever takes their account, can move to another tree — are now
  pinned to a commit, with the tag kept as a comment. Leaflet's **stylesheet** had never been
  counted: third-party CSS moves, resizes and hides any element, so the button you think you are
  clicking may not be the one you click. Google Maps moves from `v=weekly` — a *channel* — to a
  version. A CI guard fails on any unpinned action.

## [0.1.51] — 2026-08-17

### Security

- **Third-party scripts are pinned to an exact version and carry an integrity fingerprint.** The
  serious part was not the missing fingerprint, it was `@2`: that jsdelivr tag follows the latest
  2.x, so the page served visitors whatever Supabase had published that morning — no deployment, no
  review, no way back. On the day of the fix it resolved to `2.112.3`, now pinned.

  The two go together: a fingerprint on a moving URL would break the page at the third party's next
  release. **Pinning makes the fingerprint possible; the fingerprint makes the pinning useful** — an
  exact version says which file you *ask for*, never which one you *receive*.

  | | before | after |
  |---|---|---|
  | `pdf.min.js` | exact version, no fingerprint | fingerprint |
  | `pdf.worker.min.js` (1 MB) | exact version, **out of reach of `integrity`** | verified in code |
  | `supabase-js` | **moving `@2`**, no fingerprint | `2.112.3` + fingerprint |
  | `leaflet` | exact version, no fingerprint | fingerprint on the injected tag |

  ⚠️ **The worker has no tag** — pdf.js loads it, so no `integrity` attribute can apply. It weighs
  three times the main script and sees every page of the document: protecting the tag and letting
  the worker through would be locking the door and leaving the window open. Its bytes already passed
  through our code (a cross-origin worker is refused by the browser, so it is fetched as text and
  turned into a same-origin blob), and that detour is now the checkpoint. Any doubt refuses, and
  refusing falls back on pdf.js's own backup worker — the path a broken network already took.

  ⚠️ A CI guard now refuses a third-party script that is unpinned, unfingerprinted, or absent from
  the inventory. It found a fourth dependency on its first run — the Google identity loader on the
  access wall, which a hand-written inventory had missed. Loaders that cannot carry a fingerprint
  are named **with their reason**, so adding one tomorrow is a visible choice.

  Audit finding **P2-4**.

### Internal

- **A test database, so the pages that matter are finally exercised.** The browser bench only
  covered the local preview: the tracked viewer and the audience page need a database, answered 404,
  and **their policies were exercised by nothing** — yet those are the pages a client and a viewer
  actually open. `tools/postgrest-en-memoire.cjs` unlocks them in ~150 lines, with no dependency and
  no account to create.

  What makes the double honest is a discipline taken elsewhere: the CI portability guard has long
  banned exotic query syntax, keeping the whole surface at `table?column=eq.value`. A constraint
  taken to make *porting* possible ended up making a *test database* possible.

  ⚠️ It refuses rather than invents: an unknown filter returns a 400 that names it, and an undeclared
  relation returns 404 like real PostgREST. A double answering "no rows" to a query it misunderstood
  would turn every test into fiction. It is **not** a database — no transactions, constraints, types
  or RLS; what belongs to the DBMS is verified on a real DBMS.

  The bench now covers three pages of four (the visitor access wall needs a plugin the standalone
  context does not have) and, on the tracked page, **asserts the read is recorded in the database**:
  the browser → server → database loop was closed nowhere.

  Audit finding **P2-3**.

## [0.1.50] — 2026-08-17

### Fixed

- **A participant could make their neighbours vanish from the attendee list.** The presence
  de-duplication table was a plain object indexed by identities **each participant composes
  themselves**, `uid` included.

  Measured before the fix: a participant whose identity is `constructor` **disappears** — the object
  answered "already seen" before anything had been written. And writing to `__proto__` does not
  create an entry, it **changes the prototype of the table**: an intruder announcing
  `uid: "__proto__"`, the presenter role, and their neighbours' addresses as extra keys made those
  neighbours disappear **from everyone's list**. Four participants, two erased.

  `Object.prototype` was never reached — the pollution stayed inside that table. But *local* does not
  mean *harmless*: the table **is** the attendee list.

  ⚠️ Why it lasted: `toString`, `valueOf` and `hasOwnProperty` were never a problem, because the
  identity is lowercased and `tostring` is inherited from nobody. **Two keys only** got through —
  `constructor` and `__proto__`. A defect that fires only there is never met by accident.

  A `Map` inherits no key, and it preserves insertion order even when an existing key is rewritten —
  exactly the "the presenter wins, at its position" rule, so the order array kept alongside became
  unnecessary. Audit finding **C-6**, the last one open.

### Internal

- **The viewer is now exercised in a real browser.** `jsdom` does not enforce CSP, and the server
  tests use a fake `res` that only records headers: a policy forbidding our own scripts passed every
  test and still gave the visitor a blank page. `npm run test:e2e` opens the local preview in the
  Chrome **already installed** (`playwright-core`, no browser download) and requires both that the
  page starts *and* that the policy **refuses** — an unnonced script, a foreign origin. Separate
  command and separate CI step: `npm test` must stay runnable in a bare container. Audit finding
  **C-10**.

## [0.1.49] — 2026-08-17

### ⚠️ Three migrations to apply — the player degrades without them, it does not break

| file | what it unlocks | until applied |
|---|---|---|
| `0001-destinataire-atteste.sql` | counting the reads of a visitor **you** vouch for | attested creation is refused, by name |
| `0002-ordre-des-ecritures.sql` | a stale write can no longer overwrite a fresher one | no order control — last arrival wins, as before |
| `0003-limites-partagees.sql` | rate limits count for the **instance**, not the process | counting falls back to memory, as before |

None is required for the version to run. Each is **additive** and safe to apply while the previous
code is running, so the deployment order never matters: migrate first and nobody writes the column
yet; deploy first and the player detects its absence, degrades, and names the file to apply.

The player will never apply them itself — it speaks to the database through PostgREST, which does not
execute DDL. See `docs/MIGRATIONS.md`.

### Added

- **A host can now vouch for a visitor it identified itself.** Pass `recipientEmail` on the
  server-to-server `docshare.create`: reads are counted, attributed and revocable, without an
  anonymous link or a member's token. What makes it safe is **who supplies the address** — the host's
  database after verification, never a form.

  ⚠️ It is stored **apart from `recipient_email`**, because that field carried two facts. At re-share
  time the parent's recipient becomes the **sender** (`from`, `replyTo`) of a message to an address
  chosen by whoever holds the link. Filing a vouched visitor there would have made our servers a
  relay signed by them — the second host's own objection, one step further along, which they had not
  seen. Left empty, the send guard *and* the re-share inheritance both refuse **without knowing why**.

  ⚠️ **An attested link is named, not closed.** It remains forwardable; a host whose documents are
  confidential must not rely on it.

- **Write order now survives an abandoned request.** The browser queue guarantees one write in
  flight — it removes the disorder we *cause*. But a request abandoned by the timeout may have
  reached the server and land after the one that replaced it: that disorder we *suffer*. Each write
  now carries a rank, and the server refuses a rank it has already passed.

  A rank, not a timestamp: a clock says *when*, and two tabs disagree; a counter says *after what*.

### Changed

- ⚠️ **`limits.allow` promises something different, and it is written in the contract.** It used to
  count per **process** — so on serverless a limit of 120/hour allowed 120 *per instance*. It
  existed, it reassured, and it bounded a fraction of what it claimed. The standalone context now
  counts in a shared table.

  The local counter stays in front as a **fast refusal**: it only ever under-counts, so if *it* is
  over the ceiling the shared one is too. Abuse is refused for free. The public read path stays local
  — its answers already come from a per-slug cache, and backing that guard with a shared counter
  would make the guard pay the price we had just spared the thing it guards.

  ⚠️ The shared count is **not atomic** (PostgREST cannot express "increment"): it under-estimates
  under heavy concurrency — letting a little more through, never refusing wrongly.

### Testing

- **A column belonging to a migration can no longer be written unconditionally.** `docs/MIGRATIONS.md`
  says PostgREST rejects the *whole* PATCH on an unknown column; two hours after writing that, I put
  `write_seq: 0` in the reclaim path without a condition — which would have broken **reclaiming**, not
  the new guarantee, on every un-migrated host. The probe existed; I had not called it there.

  ⚠️ What was missing was not the knowledge, it was the guard. A rule you remember is a rule you will
  forget.

## [0.1.48] — 2026-08-17

### Fixed

- ⚠️ **0.1.47 carried the brand key but not its consequence: the loader was blocked.** The key was
  fed, `brandForShare` resolved it, the right `src` was written into the page — and the logo's origin
  was **not** added to `img-src` on the preview route. The browser asked for the image and refused
  it. The file answered 200.

  The tracked-link path derived its three origins and had done so from the start. Two policies, on
  the same instance, at the same minute.

  ⚠️ **No server-side probe can see this.** The rendered HTML is perfect, the script compiles, the
  package is conform. Neither the post-publish smoke step, nor the artifact guard, nor a test that
  executes the page bites — **only a browser shows it**, and only to the eye. The second host found
  it at one of their clients.

  This is the fourth field of the same family and the first of a different nature: `internal_token`,
  the brand and the action names were all missing **from** the page. This one is *in* the page —
  what was missing is what the page is allowed to do next. The "no field by accident" guard therefore
  could not catch it: the field was provided.

  **The form, as they put it:** *any value that produces a URL destined for the browser must, by
  construction, add its origin to the policy.* One list, every route, and a guard that recognises
  image-bearing fields **by their nature** rather than from an inventory.

- **Two more cases the new guard found on its first run.** `bot_vphoto` worked **by accident** — the
  presenter's photo and the assistant's avatar usually come from the same storage, hence the same
  origin; the day a host files one elsewhere it disappears with nothing having changed on their side.
  And `presenter_avatar`, which does not travel in the HTML but in the configuration: the live layer
  turns it into an image at runtime, in the participants list.

### Known limit, written next to the code

The **audience** page shows participants' avatars, which arrive through presence — from as many
origins as the host has members. No list set at render time can anticipate them. Pre-authorising them
would mean widening the policy to an entire host origin: **a decision to take, not an oversight to
fix in passing.**

## [0.1.47] — 2026-08-17

### Fixed

- ⚠️ **A multi-brand host served one client's loader on another client's domain.** In preview mode —
  the mode a host uses for its *own* documents, with no tracked link — nothing carried the brand key,
  and `brandForShare` was never called on that path. A visitor opening a document therefore saw the
  name of a company they had never heard of, on the domain of the one they were dealing with.

  The machinery was already complete: the host answers `PLAYER_HOST_BRAND_URL`, `branding.forKey`
  resolves, tracked links display correctly. **What was missing was a transport, on one route.**
  `&brand=<key>` now feeds `brand_key`, and the same resolution runs.

  Reported by the second host, on a document opened at one of their clients.

### Testing

- ⚠️ **The family the bug belonged to is now closed — but not the way it was proposed.** Preview mode
  was built as *"a share without a share"*, so every field has to be rewired one at a time:
  `internal_token` was missing, `brand_key` was missing, **a third one would be**. The second host
  suggested letting preview accept the same fields as a share.

  Measured, that would open too far. The page reads **34** fields; **20** are absent from the preview
  object and **17 of those are deliberate** — the whole assistant plugin (which does not run in
  preview, and whose 116 KB a test already checks are not even embedded), `is_test`,
  `recipient_email`, `created_by`. Importing them wholesale would switch on features preview does not
  have.

  The closure is therefore *no field by accident*: everything the page reads must be **provided**, or
  **declared absent with its reason**. Adding a line to that table is a decision; forgetting one fails
  the build. The table is itself guarded against **relics** — a reason left for a field the page no
  longer reads would make it look current while describing a world that is gone.

## [0.1.46] — 2026-08-17

One thread runs through all of it: **what used to be protected by discipline is now protected by
construction.** Every fix here replaces a rule someone had to remember with a mechanism nobody can
bypass.

### ⚠️ Host action required before upgrading

Two new authorization action names are asked of `identity.canManageShares`:

| action | what it grants |
|---|---|
| `presentations.list.all` | list presentations one does **not** own — slugs, presenter names, counts |
| `presentations.stats` | read the **attendees** of a presentation one does not own — names, addresses, dwell time, pages |

If your authorization table is a **closed list**, add them before upgrading: an unknown action means
refusal, so every member — administrators included — loses access, and the refusal reads exactly like
a role problem. The second host saw this coming from the release note rather than from us writing it;
`docs/HOST-CONTRACT.md` now carries the full table, says the list grows, and a guard fails the build
if the code ever asks for a name the contract does not document.

Neither right is needed to read one's **own** presentations: an owner, and an administrator, are
always served without the player asking the host anything.

### Fixed

- ⚠️ **A hostile broadcaster could silence a whole meeting room.** The public-channel quota is keyed
  on the address, but the re-read cadence is chosen by **whoever broadcasts** — three spectators
  behind one office egress could be pushed past the quota, collect 429s, and **their pages stopped
  turning**. Before the limit such a participant was expensive; after it, they could silence. The
  cause is now bounded rather than the effect: a spectator gives itself a budget and never re-reads
  more than a presenter's actions justify. **The resynchronisation net is never rationed** — doing so
  would have replaced an outside denial of service with a home-made one.

- **Ending a presentation could be undone by a tab left open.** The control token survived the
  closure, and it is persisted in localStorage — so a second tab put the presentation back online for
  the audience. Ending now **revokes** the token. ⚠️ Staleness (three minutes without a heartbeat)
  deliberately does **not** revoke: there, "resurrection" is how a presenter whose laptop slept comes
  back, and an anonymous presenter has no other way in.

- **Attendance rows could be overwritten by any participant.** The presence channel broadcast the
  *measurement key* — so anyone could read a neighbour's and repost it. Presence now carries its own
  public identifier; the measurement key never leaves the browser except toward the server.

- **A member who knew a slug read the attendees of someone else's presentation** — names, addresses,
  dwell time, pages. The player now grants what is obvious (owner, administrator) and asks the host
  for the rest.

### Changed

- **Public reads are cached per slug** (`state=1`, `chat=1`), collapsing any cadence — legitimate or
  hostile — to one database read per window per instance. The window is derived from the audience
  scheduler's existing coalescing, so **no latency is added beyond what a spectator already accepts**.
  ⚠️ The idea came from the second host; the window did not: they proposed one second, citing our
  0.1.19 doctrine — which is about *authority*, not latency. Since that same doctrine emptied
  broadcast payloads, the re-read is now **the only path the page number travels**, so a one-second
  cache would delay every page turn.

  The rule is structural, not a list: *any response identical for all spectators of one slug is
  cached*, served by a single path. A guard rejects any branch that answers without it.

- **All presentation writes go through one queue.** Six paths wrote, two were guarded — 0.1.41's
  "map writes are sequential" was true of one path in three. The **write functions themselves** now
  queue: there is no direct path left, so nothing to forget. ⚠️ What it does not close, and it is
  written next to the code: a request **abandoned** by the timeout may have reached the server and
  land after the one that replaced it. The queue removes the disorder we cause, not the disorder we
  suffer.

## [0.1.45] — 2026-08-16

⚠️ **The limit shipped in 0.1.42 turned an amplification into a denial of service against the
audience — and we opened that door ourselves.**

### Fixed

- ⚠️ **A hostile broadcaster could silence a whole meeting room.** The public-channel quota is keyed
  on the **address**, and it was sized on what legitimate use consumes. But the re-read cadence is
  not chosen by the spectator — **it is chosen by whoever broadcasts.** The scheduler coalesces at
  400 ms, so a spectator can be made to re-read ~9 000 times an hour; three spectators behind one
  office egress therefore blow past the 21 600/h quota, collect 429s, and **their pages stop
  turning**.

  Before the limit, such a participant was expensive. After it, they could **silence**. That is the
  `X-Forwarded-For` lesson inverted: the limit does not rest on what the *caller* chooses — but it
  was *paid for* by someone who does not choose either.

  **The cause is bounded, not the effect** — lowering the quota would have punished the victim
  further. A spectator now gives itself a budget and never re-reads more than a presenter's actions
  justify: under hammering, ~9 000/h drops to 720/h.

  ⚠️ **The budget gates the signal, never the net.** `signaler()` is triggered by a broadcast, so by
  any participant — that is the door to ration. `maintenant()` is our own 25 s resynchronisation net:
  rationing it would leave an audience with an empty budget **permanently mute**, which would have
  closed one door by opening a smaller, more reliable one. The net is the floor.

  **The two numbers are one contract**: signal budget + net = a spectator's share, and the server
  quota = that share × `READERS_PER_EGRESS`. ⚠️ A test forced the quota derivation to be corrected: it
  counted only the *sustained* share, so a full room exceeded the quota by 475 re-reads — exactly
  everyone's burst. **The server must cover what the client allows itself, not its average.**

- **A dead copy of `fetchBorne` shipped in 0.1.44.** Moving the helper into the bundle removed
  nothing: a second implementation still lived in the template, and it was *that one* the audience
  used — a path covered by none of the tests written for the other. Two implementations of one
  contract, exactly what this repository keeps warning about. Removed; one entry point for all four
  paths.

### Testing

- ⚠️ **The test for the central property did not bite on the first try.** It hammered, then watched a
  lull — and a rationed net passed anyway, because the budget refills a token every 5 s while the net
  only runs every 25 s, so it always finds one after a pause. The condition that separates the two
  worlds is **continuous** hammering. The threshold was then **measured, not guessed**: 884 re-reads
  with the net free (720 budget + 20 burst + 144 net), exactly 740 when it is rationed. The assertion
  compares against the signal budget — the real boundary — rather than a hand-written number.

- **First end-to-end on the audience side**: the test renders the audience page, runs it, connects the
  live layer, and drives broadcasts through it.

## [0.1.44] — 2026-08-16

Two findings from the audit re-review that followed 0.1.43. ⚠️ **One of them was created by our own
0.1.41 fix** — the review is reading a movement, not a state.

### Fixed

- ⚠️ **"End" did not end anything final.** Piloting functions write `active: true`, and the control
  token **survived the closure**. A second tab left open therefore put the presentation back online
  for the audience while the presenter believed it closed. The token is persisted in localStorage:
  this was not a narrow race, it was a door left open at will.

  ⚠️ **The rule the audit proposed — "refuse every write when `active=false`" — would have broken a
  real recovery.** `active:false` covers two unrelated situations: a **decided** end, and an
  **observed** staleness (3 minutes without a heartbeat), where "resurrection" *is* how a presenter
  whose laptop slept comes back. Refusing both would strand an **anonymous** presenter forever —
  `present-reclaim` requires ownership, and `present-start` requires no session at all.

  The two are therefore separated by what actually distinguishes them — the decision. **Ending
  revokes the control token**; staleness leaves it intact. Owner paths, which need no token, are
  closed separately on `active=false`. No schema change. A mutation that makes the staleness sweep
  revoke — i.e. that applies the general rule — is rejected by the bench.

- ⚠️ **A hung request froze the write queue, and that risk came from our own fix.** Before 0.1.41 the
  scheduler called `fini()` immediately: writes could land out of order, but nothing could block. By
  making them sequential we traded a correctness defect for an **availability** risk — a suspended
  request never settles its promise, the queue never resumes, and the presenter drives into the void,
  silently. A browser guarantees no timeout of its own.

  `fetchBorne` lives next to `createScheduler` because it is its counterpart. It bounds the four
  paths that can wedge: audience re-reads, `pushPage`, `presentContent`, `endPresent`. The `pagehide`
  beacon stays deliberately unbounded — it is never awaited.

  ⚠️ **What the timeout restores, and what it does not.** **Liveness**: the queue resumes. Not
  **order** — an abandoned request may well have reached the server and land after the one that
  replaced it. Order despite abandonment needs a version number carried by the write; that belongs to
  the single-queue work, not here. Better said than left implied.

### Testing

- ⚠️ **A textual probe fell over, and the property had not moved.** A test looked literally for
  `fetch('/api/doc'` and failed once the call went through the bounded wrapper — while what it
  asserts (write *before* broadcasting) was unchanged. It now recognises the **act**, not the name of
  the call. Same lesson as the tag-filter patterns two versions earlier.

## [0.1.43] — 2026-08-16

### Fixed

- ⚠️ **A case detail is an attendance row.** 0.1.42 moved the member attendance key from the client
  to the verified token — but the client key was lowercased (`me.email.toLowerCase()`) and the
  derived one was not. Rows are found by `attendee_key=eq.` — an **exact** match. On a host whose
  identity returns the address as typed, the same member would therefore get a **second row**:
  accumulated time back to zero, and the colleague listed twice among participants.

  No effect where addresses are already normalised — which is the case for both current hosts, and
  exactly why nothing would have reported it. *An open contract does not rest on what its first two
  hosts happen to do.* Found while re-reading 0.1.42 before announcing it.

## [0.1.42] — 2026-08-16

Four findings from a third external audit (CODEX 5.6), and the first browser end-to-end test.

⚠️ **All four defects were already half-fixed.** In each case the right rule was written next to the
place where it was missing — a comment three lines above, a sibling action, twelve guarded writes
beside two unguarded reads. That is the pattern worth keeping from this release: *a rule stated in
one branch does not travel to the branch beside it.*

### Fixed

- ⚠️ **Ending a presentation announced the end before obtaining it.** `endPresent()` sent
  `sendBeacon` — which returns **no response at all**, neither "recorded" nor "refused" — then
  cleared the UI, erased the control token and closed the channel. If the call failed, the
  presentation stayed **live for the audience** while the presenter believed it closed; and with
  `clearCtl` having already discarded the token, they no longer had the means to close it. Only the
  3-minute staleness sweep remained.

  ⚠️ **The beacon bought nothing here.** It exists to get a request out while the page is *dying* —
  and the only caller was a **button**, which can afford to wait. It now lives on `pagehide`, and
  only there. The button waits for a 2xx before broadcasting, disconnecting, or erasing anything;
  on failure the presenter keeps everything needed to retry, and the button says so.

- ⚠️ **The anonymous presenter could turn pages but not move the map.** `present-start` requires no
  session — deliberately — and `present-page` therefore accepts the `control_token`. But
  `present-content`, which drives what the presentation *displays*, had been filed with the
  session-only actions. The call returned 401, swallowed by a browser-side `catch`, and the map
  simply did not follow. The two are the same act of piloting; they had been grouped by **proximity
  in the route, not by authority**. What stays owner-only is `present-switch`: changing the
  *document* shown is not driving the display.

- ⚠️ **A participant could overwrite a colleague's attendance row — using their email address.**
  `present-attend` identifies its row by a client-chosen `key`, and for a member `attendeeKey()`
  returned their **email**. Any anonymous visitor to the public link could post
  `key: "colleague@company.com"` and rewrite that row: the name and avatar shown in the participant
  list, and the accumulated reading time.

  ⚠️ Three lines above, the same route already said *"a proven identity **replaces** a claimed one"*.
  Name, email and avatar had indeed been replaced by the token's. The **key** slipped through —
  though it is the one value that decides *which row is written*. A member's key is now derived from
  the verified token; an anonymous keeps theirs, confined to an `anon-…` namespace it cannot leave.
  It is also drawn with `valeurImprevisible` instead of `Math.random()`: acceptable for an analytics
  id, not for the only thing separating two anonymous participants — the same fix made in 0.1.23 for
  the chat author token, twenty lines below in the same file, never carried up.

- ⚠️ **The public channel was an unbounded amplifier.** `state=1` and `chat=1` are served without a
  session, on a public link, and each call costs a database query. Twelve write actions passed
  through a limit; these two **reads** did not. And the **shared** resource pays — the database is
  the same for every document on the instance — so the cost of abuse does not fall on whoever causes
  it.

  ⚠️ **Where the guard sits *is* the fix.** `getPresentation()` ran *before* the `state`/`chat`
  branches: a limit written where the refusal is phrased would have refused correctly, with the
  right status code, **after spending exactly what it protects**. The tests therefore count database
  queries, not response codes. The quota is *derived* from the audience's cadence (25 s resync net
  + one presenter action every 5 s, times `READERS_PER_EGRESS` — the sessions constant reused, not
  reinvented), and a refusal is logged hourly: otherwise a whole meeting room would drop off with no
  named cause.

### Testing

- **First real browser end-to-end.** `finDePresentation.test.js` renders the presenter page, installs
  it in jsdom, runs its scripts, clicks *Present*, then clicks *End* with a server response held open
  by hand.

  ⚠️ This is what separates it from a textual probe. *"After the response"* and *"in the failure
  branch"* both place the broadcast after the call — only a provoked failure tells them apart. Four
  mutations restoring the defect are refused.

- ⚠️ **Two benches were fixed rather than worked around.** Static analysis was right three times
  about a hand-rolled `<script>` filter (it missed `<SCRIPT>`, then `</script >`, then
  `</script\t\n bar>`): the regex was **removed** — the benches run in jsdom, and `DOMParser` sees
  what the browser sees by construction. And a test that passed on Node 22 while failing on Node 24
  was not flaky: benches share one window, therefore share its timers, and a previous bench's
  500 ms-deferred write landed on the current bench's spy.

- ⚠️ **An artifact guard that read instead of running.** Its first version scanned the minified
  bundle for `.email`; a mutation reintroducing the defect under another name walked straight past.
  It now **executes** the shipped bundle and offers it identity five ways, old signature included.

## [0.1.41] — 2026-08-16

### Fixed
- ⚠️ **0.1.39 removed `hasFocus()` from the reading condition — and left `on(win,"blur",pause)` 170
  lines below.** The project therefore said two things at once: *"a visible document counts"* and
  *"a window without focus does not"*. Clicking the other screen's window fired `blur`, which
  paused counting.

  ⚠️ **Measured rather than assumed, and the audit's framing was too dark**: the periodic flush
  (12 s) calls `commit()`, which ends with `activeSince = viewable() ? now() : null` — so counting
  restarted by itself at the next flush. The leftover handler cost **at most one interval**, not the
  session: 58 s counted for 65 s elapsed in the bench. Real, bounded, and silent — every trip
  between screens shaved a few seconds.

  The contract is settled: losing focus means *another window is in front*, not *this document is
  no longer read*. Only `visibilitychange` carries that authority. The old test that demanded the
  opposite has been flipped, and a second one pins what must **not** change — a hidden tab still
  does not count.

  ⚠️ **Our bench never fired `blur`.** Third time in a day that a bench failed to exercise the
  property its test described, and the assertion was loose enough (`> 50` on 65 s) to pass with the
  defect anyway. *A test that tolerates twelve seconds of loss cannot see twelve seconds of loss.*

- **Map writes were not actually sequential.** The scheduler called `fini()` immediately while
  `presentContent()` was fire-and-forget, so its "one in flight, last one wins" guarantee applied to
  the order of *calls*, never to the order of *writes*. Several `PATCH` could fly together and an
  older position land after a newer one. `presentContent()` now returns its promise, and both
  schedulers wait for it.

  *Both reported by an external audit pass on 0.1.40.*

## [0.1.40] — 2026-08-16

### Fixed
- ⚠️ **Turning a page did not count as reading.** Idleness was measured from *input* events — mouse,
  keyboard, wheel, touch. But someone following a live presentation touches nothing: the pages turn
  in front of them, pushed by the presenter. They went idle after a minute, while **the one thing
  that proves they are watching was happening**.

  A page turn now counts as activity. It also puts the threshold back in its place: it arbitrates
  **silences** only. A real reader turns pages; a forgotten tab turns none.

  *Seen by the second host: "what really separates a reading from a forgotten tab is not duration,
  it is turning a page."*

### Changed
- **The idle threshold goes from 60 s to 3 minutes**, and the number comes from an asymmetry rather
  than a preference. A dense page — a spec sheet, a contract — takes one to three minutes to read
  without a single mouse movement, so 60 s counted an attentive reader as absent.

  The two errors do not cost the same:

  - *under-counting a real reading* → you call back a client who had read. Unpleasant, no consequence.
  - *over-counting an abandoned tab* → you tell a salesperson "they read their contract for twenty
    minutes", and they use it to push on price. **A decision taken on a fiction.**

  Hence the low end of the range the second host proposed (3–5 minutes).

  ⚠️ **The two measures stay separate**, and that is the point: `last_at − started_at` is *presence*,
  `total_seconds` is *activity*. A contract skimmed for thirty seconds and a contract left open for
  twenty minutes on a second screen are two different facts; collapsing them into one number loses
  one. Whoever reads the statistics chooses.

### Note
- ⚠️ **Three of our own tests pinned `70` instead of the threshold**, so they broke when the value
  moved although the property had not. They now derive from `SESSION_IDLE_MS`, which joins the
  shared contract: *a test that fixes a number forbids changing the number; a test that fixes the
  relation lets the number live.*
- ⚠️ **And the bench neutralised the very mechanism under test.** It returned `setInterval: () => 0`,
  so the idle loop never ran, `idle` stayed false forever, and removing the page-turn rule left the
  tests **green**. The mutation revealed it, not a re-reading. *A bench that disables what it tests
  is a test that cannot say no.*

## [0.1.39] — 2026-08-16

### Fixed
- ⚠️ **A document displayed on a second screen was counted as an absence.** `viewable()` required
  `doc.hasFocus()` — and `hasFocus()` answers *"the user is typing here"*, not *"the user is
  looking"*. A reader with the document visible for forty seconds while working on the other screen
  was credited **two seconds**.

  ⚠️ This never was an internal-population problem. A prospect keeping a brochure open while it is
  discussed over the phone is the **central** use of a shared link, and it measured as absence. The
  function promised *reading time* and returned *typing time*.

  `visibilityState` read `visible` throughout: the right signal was available, overridden by a
  stricter condition answering a different question.

  ⚠️ **What remains is deliberate.** The idle threshold is now the *sole* thing separating a reader
  from a forgotten tab, so a document read with no interaction at all counts at most `idleMs` — 60 s
  by default. Better than zero, less than a real ten-minute reading. Raising it would measure
  passive reading better *and* credit an abandoned tab for longer: that is a decision about what
  "reading" means, and it is written next to the option rather than taken alone.

  *Found by the second host on a real reading — 26 s of presence, 2 s counted — after a first
  diagnosis ("the frame had no focus") that the reader themselves corrected.*

- **`start()` began counting without checking visibility.** A document opened in a background tab —
  a link clicked with Cmd, a session restore — started counting before ever being seen, and the
  idle cap still credited it `idleMs`. One minute of reading for a tab nobody looked at. `commit()`
  already made that check; `start()` did not.

  *Found by the test written for the second-screen case, which was looking for something else.*

### Note
- ⚠️ **`main` had been failing CI since 0.1.36**, and three versions shipped on top of it: a test
  in the browser suite read files through `node:fs`, which vitest runs happily and `tsc` refuses.

  I did not see it because **I was counting passes instead of looking for failures** — `gh pr checks
  | grep -c pass` returns 6 whether or not something else failed beside it. A count of successes
  says nothing about failures. It is the same mistake this repository has been documenting in its
  own guards for two days, made on the tool meant to watch them.

  Disk-reading assertions now live in the server suite, where they belong. I put one back in the
  browser suite ten minutes after fixing the first — the rule is simple, and writing it down did not
  stop me breaking it twice.

## [0.1.38] — 2026-08-16

### Fixed
- ⚠️ **The guard written in 0.1.37 missed a case, and it missed it the same way the guard it
  replaced did.** It filtered on a **list of names** of write helpers; `recordUnlock` writes
  straight through `PLAYER.db.request`, so it went unseen — a silent catch swallowing a visitor
  unlock journal entry. That is exactly what the audit held against the prototype guard (*"it
  filtered on variable names"*), reproduced the same day in a guard written to prevent this class
  of thing.

  Found by checking the **published tarball** of 0.1.37, not by the guard.

  The rule now targets the **form** — any database write caught in silence — rather than names. A
  list only sees what was put in it; a form also sees the next one.

  ⚠️ **Writes only.** A lost write is lost forever; a failed read is retried on the next call. A
  catch that drops a display counter to zero is a legitimate choice; a catch that loses a
  measurement never is. The first version of the form accused both — too broad in one direction
  after being too narrow in the other.

### Note
- **This probe was wrong three times before it bit**, and every error was found by running it, never
  by re-reading it: bounded by characters (a long comment pushed `capture(` out of view, and it
  accused the corrected code); by a fixed number of lines (it spilled into the *next* block and
  found a `capture(` that was not its own); and without a function boundary (a write that is
  correctly *not* wrapped had the following function's catch attributed to it).

  A guard is worth exactly what its reading is worth. That is the whole lesson of this version, and
  it applies to the guard as much as to the code it watches.

## [0.1.37] — 2026-08-16

### Fixed
- ⚠️ **Internal reading tracking had never written a single row — on either instance.** The row
  carried `ua` and `ip`; the internal-sessions table has neither. PostgREST refused
  (`column "ua" ... does not exist`), the caller's `catch { /* best-effort */ }` swallowed the
  refusal, and the route answered `{"ok":true}`. **Our own production table held zero rows.**

  ⚠️ **The schema was right and the code was lying.** An *internal* reading is a colleague:
  `device`, `os` and `browser` — derived — describe it well enough, and one does not keep the full
  user-agent or the address of one's own team. The *external* sessions table carries them, because
  that is neither the same population nor the same promise.

  Fixing it by **adding the columns** would have done the opposite: raising the schema to the level
  of the code instead of the code to the level of the intent. What you keep about your own teams is
  not decided by a PostgREST error message.

- ⚠️ **A rule written in a comment does not protect the code that follows it.** In 0.1.35 we wrote,
  inside `upsertInternalSession`: *"the guard was not the problem; its muteness was."* Three lines
  below, in the calling function, `catch { /* best-effort */ }` swallowed the failure of the write
  itself.

  "Best-effort" is a sound intention — a measurement must never stop someone reading a document.
  But best-effort does not mean **mute**: what is caught there is the right to *continue*, never the
  right to *say nothing*. Both catches now report, once an hour, naming the cause.

  The rule became a **test** rather than a comment: `ecritureMuette.test.js` refuses any silent
  catch around a measurement write. It immediately found the twin on the external path — harmless
  so far, since that table does have the columns, but it would have swallowed the next mismatch the
  same way. **What makes the class dangerous is not the instance.**

  *Found by the second host, reproduced by replaying the insert.*

### Note
- The guard's own probe was wrong twice before it bit: it bounded the catch body by characters
  (a long comment pushed the `capture(` out of view, and it accused the corrected code), then by a
  fixed number of lines (it spilled into the *next* block and found a `capture(` that was not its
  own). A guard that reads beside the point guards nothing — established by mutation, not by
  reading.

## [0.1.36] — 2026-08-16

### Fixed
- ⚠️ **The internal-session quota could not hold a single reader.** The browser writes one session
  every 12 s — **300 per hour for one person** — and the server allowed **120 per hour per address**.
  The limit therefore sat *below* what one legitimate reader consumes: after 24 minutes of
  continuous reading, everything was refused. And since the key is the address, a team behind a
  single internet egress — the *ordinary* case for a company, not the edge case — shared a quota
  that one person alone exceeds.

  ⚠️ **The guard was right in its shape and wrong in its number**, which is exactly why nobody
  re-read it: we re-read what looks doubtful, not what looks reasonable.

  ⚠️ **And the refusal was silent.** The 429 appears only in the reader's console; the hourly log
  named the missing field, never the quota. An operator saw a table that would not fill, with no
  cause attached — the very symptom we had just fixed elsewhere. It is now reported once an hour,
  naming the quota, **before** the `return` rather than after it (the linter caught that one:
  `Unreachable code`).

  The cadence and the quota were two halves of one contract written in two places. They now live in
  `src/cadence.ts`, inside the **shared** module whose own generated header already said why: *"two
  implementations of one contract always end up diverging in silence."* The quota is **derived**
  from the cadence — changing one moves the other.

  ⚠️ **The key stays the address**, and that is not an oversight. A session id is chosen by the
  browser; a quota keyed on it is bypassed by rotating it — the `X-Forwarded-For` lesson of 0.1.22,
  where the limit existed and limited nothing. **A limit can only rest on what the caller does not
  choose.** It was the number that was wrong, not the key.

  *Found by the second host, on their instance, while looking for why their table stayed empty.*

### Changed
- The shared bundle takes an explicit entry point. `SHARED_SOURCES` and the esbuild entry were the
  same list, so adding a file made it count toward the cache-busting hash **without being bundled**:
  the file would exist, the hash would change, and the import would fail only at runtime.

## [0.1.35] — 2026-08-15

### Fixed
- ⚠️ **The lock had no keyhole.** 0.1.22 added `verifyInternalToken`, which reads `body.it`, and
  announced that `PLAYER_INTERNAL_STRICT=1` "closes the door entirely". That was true of the
  **check** and false of the **system**: no path allowed a host to *supply* that token. The preview
  route read `uemail`, `docId`, `name`, `title`, `by`, `av`, `resume`, `autopresent` — no token —
  and `CFG.internal` carried only `{email, name, docId}`.

  Setting the variable would therefore have refused **100% of internal sessions on every
  instance**, ours included. And that is why "strict analytics by default" — the next item on the
  audit's list — could not be shipped: it would not have hardened hosts, it would have cut them off.
  A lock nobody can close is not a transition, it is an announcement.

  A host can now pass `it` on the preview route; it travels through `CFG.internal` and comes back
  in the body, where the check has been waiting since 0.1.22.

  *Found by the second host, while preparing the very token we had asked them to sign.*
- **A silent rejection cost a host weeks.** An internal session without a `docId` is dropped — the
  guard is right, a session with no document measures nothing — but it said nothing. That host
  brought up their internal tracking, believed it live, and found out much later that the table was
  empty: their `docId` never left, and every heartbeat was discarded in silence.

  ⚠️ The guard was not the problem; its muteness was. **A measurement that reports nothing is
  indistinguishable from a measurement with nothing to report** — nobody goes looking for a failure
  no signal announces. It is now reported once an hour, naming the missing field, exactly like the
  unsigned-session gap of 0.1.22. An abnormal state left unsaid becomes the normal state.

## [0.1.34] — 2026-08-15

### Security
- **A proven identity now replaces the claimed one instead of sitting beside it.** `isPresenter` and
  `isMember` have been verified since 0.1.25/0.1.28, but `name`, `email` and `avatar` still came
  from the request body — **even when a valid token accompanied the call**. An authenticated member
  could therefore post under a colleague's name and address, *with the member badge*: the visible
  attribution said someone else.

  ⚠️ It granted no rights — editing and deleting are authorised by `author_hash`, not by the email
  (`editMessage`), so a spoofed address never took control of anyone's message. The damage is
  attribution, not takeover. That is enough: in a conversation, a message signed with someone
  else's name **is** the problem.

  A host can supply `identity.profileOf(user)` to say how to read *its* user; without it the core
  reads the usual shapes, and the email — which is universal — is always taken from the token.

  A visitor with no token keeps the name they typed. That is the intended mode: they are announcing
  themselves, not proving anything, and the badges stay off.

  *Reported by the second audit pass (P1-6).*

### Note
- The opaque author id the report also suggests — so that author emails stop being broadcast to the
  whole audience when the interface never displays them — needs a column and a migration path for
  existing messages. Tracked, not done here: `author_email` currently carries `isMine()`, which
  decides whether the edit and delete controls appear.

## [0.1.33] — 2026-08-15

### Security
- ⚠️ **An alert is not a prohibition.** 0.1.21 introduced `PLAYER_PUBLIC_URL`, fell back to the
  `Host` header when it was missing, and *logged* the fallback. That was the right compatibility
  reflex and the wrong conclusion: a log entry does not stop a phishing email. A misconfigured
  instance kept sending — signed with its brand, with a button pointing wherever the reader chose —
  and the operator found out from an abuse report.

  The send is now **refused**: `sent: false`, `sendRefused: "public-url-unconfigured"`.

  ⚠️ **What is refused is the send, not the link.** The child link is still created, tracked and
  returned, so the caller can forward it themselves. What is withheld is the only part that cannot
  be taken back — mail leaving our servers with our domain in the header and our sender reputation
  behind it. The compatibility argument from 0.1.21 therefore did not hold: refusing the send does
  not break link creation, which is this route's main function.

  *Reported by the second audit pass (P1-1).*

### Fixed
- **The test had encoded the fallback**, and so protected the hole: it required "no public URL:
  falls back to Host, but logged" — that is, it required the email to go out anyway. It is the
  fourth test today found pinning a defect while believing it described a property.

## [0.1.32] — 2026-08-15

### Security
- ⚠️ **One table row could poison a whole process.** The aggregators were plain objects indexed by
  data from outside — document ids, emails, session ids — and the shape `X[k] = X[k] || {…}` is
  enough:

  `byDoc["__proto__"]` does not return `undefined`, it returns `Object.prototype`, which is
  **truthy**. The `|| {…}` therefore never fires, `a` *becomes* the prototype, `a.opens++` writes
  `Object.prototype.opens = NaN`, and `a.readers.add(…)` throws on `undefined`.

  The `TypeError` is visible. **The property left on the prototype is not**, and it survives the
  request: on a warm serverless instance every object in the process then carries an `opens`, and
  any `if (x.opens)` elsewhere silently changes meaning.

  ⚠️ `user_email` is reachable **without authentication** as long as `PLAYER_INTERNAL_STRICT` is
  unset (0.1.22), and `session_id` is written by the reader. Not theoretical.

  Every aggregator is now a `Map` — keys are data, not property names — and every browser-side
  dictionary is built with `Object.create(null)`, including `typers`, which is fed by `typing`, the
  one event that still trusts its sender. Uniformly, including the sites that were not reachable:
  an aggregator that has to justify itself case by case eventually gets a case wrong.

  *Reproduced and reported by the second audit pass (P1-2).*

### Fixed
- **The static guard that missed it.** It filtered on a **list of variable names** — `body`, `q`,
  `emoji`, `name` — and `id`, `k`, `sid` were not in it, so all of `shares.js` went through. It now
  excludes only what is certainly internal (loop counters) rather than listing what comes from
  outside, and it looks for the object's **declaration** instead of scanning 25 lines back: a window
  approximates scope, a name is exact. It found nine further sites, all fixed here.

  ⚠️ It remains an alarm. The barrier is `clefsHeritees.test.js`, which exercises the five inherited
  keys against running code — as the report put it, a regular expression over variable names can
  only ever be a complementary alarm.

## [0.1.31] — 2026-08-15

### Fixed
- ⚠️ **The signal went out before the write, and the comment claimed the opposite.** `pushPage`,
  `presentContent` and `endPresent` broadcast first, then started the write. Since 0.1.19 that
  signal says only one thing — "re-read" — so the audience re-read while the database still held
  the old state, and **no second signal was guaranteed**: the page turn was lost until the 25 s
  resynchronisation.

  `endPresent` was the worst of the three: it signalled, then **cut the channel**, then sent the
  end notice. The signal left on a stale state and the disconnect preceded the send — an audience
  could simply never learn the presentation had ended. `sendBeacon` cannot be awaited, but it
  returns once the request is *queued*; signalling right after it, then disconnecting, respects the
  order as far as that transport allows.

  Delaying the signal by one round-trip costs nothing, since it only ever meant "re-read". Sending
  it too early cost both a pointless re-read **and** the change itself.

  *Reported by the second audit pass (P0-3).*

### Changed
- **The state signal no longer carries a state.** The audience ignored it already (it re-reads), but
  a payload that travels without serving gives the impression that it serves, and invites the next
  person to use it. Same reasoning as `map` in 0.1.30: cut the path, not just the use.

### Note
- The tests here compare **positions** — where the write sits relative to the signal in each
  function — rather than searching for a string. Three tests today had pinned a defect while
  believing they described a property; this one fails when the original order is restored, which is
  the only thing that makes it worth writing.

## [0.1.30] — 2026-08-15

### Security
- ⚠️ **The map position no longer travels in the broadcast.** It did, and the audience applied it
  as-is. The channel being public, **any participant could move everyone's map**, with coordinates
  of their choosing. 0.1.19 granted that exception on the grounds that the signal is "ephemeral,
  with no server truth to check against". The argument does not hold: **during map mode, that
  signal is the image the audience sees.** `typing` can stay cosmetic; `map` cannot.

  The presenter now persists its position through the JWT-gated route and emits an **empty**
  signal. The audience re-reads the state and applies what the server gives it. A hostile
  participant can still emit: they trigger a bounded re-read and obtain nothing.

  ⚠️ **The obstacle was that persistence was a debounce**, not the broadcast. `schedPersist` pushed
  the write back 700 ms on every movement, so during *continuous* panning it never fired — which is
  precisely why the position had to travel in the broadcast. It now uses the same bounded scheduler
  as the re-read: at most one write per 500 ms, and **always the last position**, so the audience
  follows during the movement and not only once it stops.

  **Live map following becomes stepped rather than continuous** — about twice a second. That is the
  price of nobody but the presenter driving the audience's screen, and it is the right price.

  The payload path is removed rather than merely ignored: leaving it would be defence by accident,
  and the day someone reconnects a parameter the public payload would be trusted again with nothing
  to say so.

  *Reported by the second audit pass (P0-1).*

### Fixed
- **A test had endorsed the exception.** It asserted that `map` "still applies the payload —
  ephemeral, no server truth", and it would have stayed green after the fix: it read the Live
  layer's handler, which forwarded `p.payload` regardless. The sweep now names the events that
  trust their sender, and `typing` is the only one left — it will have to justify itself on every
  reading of that file.

## [0.1.29] — 2026-08-15

### Security
- ⚠️ **The re-read could be starved indefinitely.** Since 0.1.19 the whole defence of the public
  Realtime channel rests on one move: stop believing the transport, re-read the source of truth.
  That re-read was a debounce — `clearTimeout` then `setTimeout(…, 120)` — so **every signal pushed
  the deadline back**. A participant broadcasting every 100 ms postponed it forever.

  Starving the re-read falsifies nothing; it simply stops the audience learning anything. Pages
  stop turning, the chat freezes, and **no error says so** — the hardest kind of failure, because
  everything looks like it is working. The comment above it read "grouped: ten broadcasts in a row
  must not produce ten requests". The intent was right; the shape inverted it.

  The opposite direction was open too: signals spaced slightly wider than the delay produced one
  HTTP request each, **per connected viewer**. The public channel became an amplifier aimed at the
  API.

  It is now a bounded scheduler with four properties, each exercised on running code: a pending
  deadline is never pushed back, one request in flight at a time, never more than one run per
  interval, and **the last signal is always served** — bounding without that would drop the signal
  that mattered.

  ⚠️ The fix is in how the delay is computed, not in removing `clearTimeout`: the wait is measured
  from the last *run*, not from the incoming signal, so the deadline is **absolute** and
  rescheduling cannot postpone it. Established by mutation — reintroducing the original shape fails
  five tests.

  A slow resynchronisation (25 s) now catches a lost signal. Bounding the rate makes losing one
  possible; the safety net is the price of the bound, not an optimisation.

  *Reported by the second audit pass (P0-2).*

### Fixed
- **A test was pinning the defect as a feature.** It asserted that `clearTimeout(_relEtat)` appeared
  in the source — the exact line that allowed the starvation — believing it checked "re-reads are
  grouped". It checked a *shape* and would have rejected the fix. The properties are now exercised
  on executed code; the source-level test only confirms the page uses that scheduler.

## [0.1.28] — 2026-08-15

### Security
- ⚠️ **The state route published the presenter's email address.** 0.1.25 added `presenter_key` to
  `GET ?state=1` — a public route, read by every anonymous viewer of a share link. That key comes
  from `attendeeKey()`, which returns **the email address** whenever the participant has one. The
  field had a technical name and nobody, myself included, went to look at what it contained — on
  the very route whose comment promises "only what the audience must know".

  ⚠️ **And it was not a proof either.** The badge compared that key to the `uid` in the *presence*
  payload, which the client composes. Read the public key, announce yourself with it, wear the
  title. 0.1.25 had replaced "the client declares its role" with "the client declares a value the
  server handed it" — more laborious to exploit, no more true.

  The participant list now carries **no badge at all**. The presenter is displayed separately, from
  `presenter_name` — set by the host, compared to nothing.

  *The false proof was reported by the second audit pass (P0-4). The leak was not in it: it was
  found by following the value rather than the name.*

### Note
- The methodological line this version pays for, in the auditor's words: **a value coming from the
  server is not automatically a proof if the client can choose what it will be compared against.**
- The `vm.Script` guard added in 0.1.26 caught the removal itself — deleting the badge expression
  left a `++` in the template. Second catch in a day, on the day it was written.

## [0.1.27] — 2026-08-15

### Security
- **One host's `localStorage` key was hard-coded for every other host.** `3dd-supabase-auth` — the
  3D Discovery studio's session key — appeared in five places in this package. On any other host,
  `detectMember()` and `accessToken()` therefore found nothing: **none of its members were
  recognised as members**, and the separation of internal from external populations that this
  product sells worked only on ours.

  ⚠️ Since 0.1.25 that key also carries a **security** property — it is how membership is proven.
  One host's constant had become load-bearing for all of them.

  It is now `config.hostAuthStorageKey` (`PLAYER_HOST_AUTH_STORAGE_KEY`), and the default is
  **empty**: no key declared, no member detected, therefore nothing to impersonate. Defaulting to
  `3dd-supabase-auth` would have kept *our* instance running while leaving the design flaw intact,
  and the next host would have discovered it the way the second one did — by noticing that its
  statistics separate nothing.

  ⚠️ **This is a transition, not a solution.** Reading another application's `localStorage` cannot
  work across origins: the second instance lives on `doc.…` and its application on `app.…` — two
  storages, and no configuration value will bridge them. The right mechanism is for the host to
  *inject* its member when the page is rendered, the way it already injects its brand. Tracked in
  [`docs/AUDIT-2026-08-14-SUIVI.md`](docs/AUDIT-2026-08-14-SUIVI.md).

  *Found by the second host, from its own instance.*

### Changed
- **The player's Realtime client now declares its own `storageKey`** (`dmp-live-auth`) instead of
  taking the default. That client will one day hold an anonymous session (private channel); if it
  wrote under the default key and the host's application used it too on the same origin, the
  anonymous session would **overwrite the signed-in member's**. The two already differ on our
  instance — by happy accident. Declaring it makes intentional what was only a consequence, and a
  topology can change.
- The guest identity moves from `3dd-present-me` to `dmp-present-me`. It belongs to the player, so
  it now carries the player's name rather than someone else's. A guest who had entered their name
  will be asked once more.

## [0.1.26] — 2026-08-15

### Fixed
- ⚠️ **0.1.25 shipped an inline script that does not parse.** An edit produced `return var h2={…}`,
  and the whole block stopped compiling — no chat, no presence, no state re-read. The live layer was
  dead in that version. **Upgrade past it.**

  This repository already had a test that *executes* the rendered page, and it swallowed the error:
  its `catch` exists for scripts whose dependencies (pdf.js) are missing outside a browser, and a
  `SyntaxError` came through the same door. Parsing and executing are now separate questions —
  **compiling must never throw**, executing is allowed to. `new vm.Script` answers "is this valid
  JavaScript" without needing a single dependency.
- **A missing presenter key no longer costs the whole state.** `presenterKey` added a query to a
  route the audience depends on to know which page is displayed. One more query is one more reason
  to answer 500 — and losing the entire state because we could not say who wears a badge is a bad
  trade. No answer now means no key, therefore no title, and everything else still goes through.

  *Both found by the **host's** tests, rendering the page from the installed package — not by this
  repository. The same imbalance as 0.1.20. Both guards have been brought back here, at the source.*

## [0.1.25] — 2026-08-15

> ⚠️ **Ne pas utiliser cette version.** Elle publie aussi l'e-mail du présentateur sur une route
> publique (corrigé en 0.1.28). Son script en ligne ne se parse pas : la couche live
> (chat, présence, relecture d'état) est morte. Corrigé en 0.1.26.

### Security
- **The presenter title was claimed, not proven.** The audit names the attacker precisely: *any
  participant who knows the slug*. ⚠️ That wording disqualifies the fix that looked obvious —
  making the Realtime channel private. A private channel excludes whoever has no right to be
  there; this attacker **has** the right, they hold the link. What separates them from the
  presenter is not channel access, it is the `control_token`.

  Three places granted status without checking it:

  - **`present-attend` took `isPresenter` *and* `isMember` straight from the request body.** A
    prospect could count themselves as a colleague — polluting the very separation of populations
    this product sells — and take the presenter title in the attendance table.
  - **`present-chat` verified `isPresenter` against the control token but left `isMember` to the
    caller.** Two weights on one line: the presenter badge had to be earned, the colleague badge
    could be asked for.
  - **The participant list rendered "presenter" from the *presence* payload**, which each
    participant composes: `track({role:'presenter'})` was enough to appear as the presenter to the
    whole audience, with the name and avatar of one's choosing.

  ⚠️ That third one cannot be fixed at the channel level — a legitimate participant is entitled to
  write *their own* presence. The title now comes from the server, which alone knows who proved the
  control token, and the audience compares a key rather than believing a claim. **No key, no
  title**: better none than a stolen one.

  Membership is now proven by the session's access token. This route is a `fetch`, so it can carry
  a header — unlike reading analytics, which leave through `sendBeacon` and therefore sign in the
  body (0.1.22). No fallback to what the caller asserts: a check that yields to the claim it was
  meant to replace only ever protects the honest.

  The two attendance flags also stop being frozen at the first heartbeat. Frozen, they described
  the moment someone arrived rather than the truth — a handover changed who held the title and the
  record did not follow, and the first to arrive was right forever.

  *Closes the remaining half of P1-2 (presence) and the part of P0-2 that a private channel would
  not have closed.*

### Note
- A page open from before this version keeps sending the old body: it will simply lose the badge
  until it reloads. Degrading toward "no title" is the intended direction.

## [0.1.24] — 2026-08-14

### Security
- **One long address froze the whole instance.** Re-sharing validated the recipient with
  `/.+@.+\..+/`. That pattern restarts at every position, so its cost grows with the *square* of
  the length — measured before fixing: 49 ms at 10 000 characters, **3 900 ms at 100 000**. Node has
  one event loop and a regular expression does not yield: one request, four seconds of frozen
  instance, for every reader — not only the caller.

  ⚠️ The rate limit did not help: 8/h per IP is checked **after** the pattern, two lines below. A
  guard placed behind what it is meant to guard guards nothing. The length is now checked first, at
  254 — the maximum length of an address (RFC 5321), past which it is not "long", it is invalid.

### Fixed
- **A local read could describe one file while sending another.** `readLocal` did `stat(path)` and
  then, further down, `open(path)` — two resolutions of the same *name* at two moments. Between
  them the file can be replaced (a sync, a deployment `mv`, a client rewriting their document), and
  we would then send the bytes of the **new** file with the size of the **old** one. Not a crash —
  worse: a `Content-Range` that does not describe what it carries, so the viewer assembles a wrong
  document and nothing reports it. A descriptor designates an object, not a name: `fh.stat()` now
  speaks about the same file `fh.read()` does.

### Documentation
- `allow_download` is stated for what it is: a **display preference**, not a protection. A reader
  looking at the document already has its bytes; hiding the button removes a convenience, not an
  access. A document that must not leave should not be shared, or should be shared behind
  `require_auth` — that one decides who gets the bytes. (P3-3)
- The Express example says why there is **no rate limiter** in front of the player routes, rather
  than leaving the absence to be read as an oversight: the player already limits per action, and
  limiting a shared link by IP shuts the document to nineteen people out of twenty behind one
  office NAT. What must be limited is what the host adds around it.

  *The first two reported by static analysis; neither appeared in the external audit.*

## [0.1.23] — 2026-08-14

### Security
- **The postMessage bridge accepted messages from any window.** An origin check is impossible here
  — the player is framed by hosts on arbitrary domains and does not know its host's origin when it
  starts listening, which is why the check had been dropped. But comparing the **source window**
  needs no origin: either it is the window you expect, or it is not. Without it, any tab or frame
  holding a reference could send `close`, `share` or `handover-done`, and the page treated them as
  coming from its host.

  Player side, it is closed **by default** — the only legitimate sender is `window.parent`, and no
  host has code to change. Host side the parameter is optional: forcing it would silence messages
  for every host that has not passed it yet, and a message that stops arriving is the worst way to
  announce hardening.
- **The chat author token came from `Math.random()`.** That token *authorises* — it proves "this
  message is mine" for editing and deleting. `Math.random` is deterministic from the engine's
  internal state, so guessing another participant's token means rewriting their messages. Now from
  `crypto`, with a fallback that **warns** rather than degrading in silence. The analytics session
  id follows the same rule: it is the upsert key, so guessing one overwrites someone else's
  measurement.

### Changed
- The user-agent string is bounded before parsing. Static analysis flagged `Android.*Mobile` as
  backtracking-prone; measured first, V8 handles it linearly even at 200 000 characters, so this
  was not a real slowdown. Bounded anyway — the stored column was already truncated to 300, only
  the parsing saw the whole string, and feeding an unbounded length into a regular expression is a
  habit that eventually costs.

  *All three reported by static analysis; the first two also by the external audit (P3-1, P3-2).*

## [0.1.22] — 2026-08-14

### Security
- **The internal reading population was open to anyone.** It is the population this product
  promises never to mix with prospects — "this client read for twelve minutes" is worth something
  only if a colleague re-reading the document does not land in the same count. Yet the route
  accepted any email, any document, any duration, with no token and no limit: "this colleague read
  this document for three hours" could be manufactured with one request.

  ⚠️ **A JWT was not an option.** Reading analytics leave through `sendBeacon`, the only transport
  that survives a closing tab, and it cannot carry a header — requiring one would lose the
  measurement at the exact moment it matters most. The proof therefore travels in the **body** and
  comes from the host, who alone knows who its member is: an HMAC over `{email, name, docId, exp}`
  signed with the secret the host already holds. When it is present, its claims win and the
  caller's are ignored. `exp` is required — a signature without expiry would outlive the member.

  `PLAYER_INTERNAL_STRICT=1` closes the door entirely. It is **not** the default, because that
  would break every instance already running, including ours; without it the write is still
  accepted, but bounded, rate-limited, and **reported once an hour** so the gap is visible in the
  logs. An open door nobody mentions is a defect; an open door stated, with the lock supplied, is
  a transition.

  Client-asserted numbers are now bounded regardless: page counts, durations, and the free-form
  per-page object — which had no ceiling at all, so a single call could write a JSON of any size,
  as often as it liked.

  *Reported by an external audit (P1-2). The presence claims `isMember` / `isPresenter` remain and
  are tracked separately.*
- **A property name written from client input** (`toggleReaction`). In 0.1.2 a whitelist indexed by
  outside data let `constructor` through, because an object literal answers for its prototype; the
  fix put `Object.hasOwn` everywhere and a static test refused any unguarded **read**. It covered
  half the shape: `Object.hasOwn` stops you *reading* `constructor`, and nothing stopped you
  *writing* it.

  What saved us from the worst was an accident — the 8-character cap truncates `__proto__` (9) and
  `constructor` (11) into harmless keys. But `toString` (8) and `valueOf` (7) got through and
  became own properties of the stored object, shadowing the prototype's for every consumer,
  browser included. ⚠️ That accidental protection is fragile: composed emoji (family, ZWJ
  sequences) exceed 8 characters, so raising the cap to accept them — an innocuous cosmetic change
  — would let the real keys in.

  Two barriers now: identifier-shaped keys are refused outright, and the object is built with no
  prototype at all, so there is nothing left to shadow or reach whatever the cap becomes. **And the
  static guard now sweeps writes, not only reads** — without it, the next `obj[outsideValue] = …`
  passes exactly as this one did.

  *Found by static analysis. Neither the external audit nor we had seen it.*
- **Rate limits keyed on a header the caller writes.** Eleven places took the first value of
  `X-Forwarded-For` to identify the caller. A client reaching the server directly — the standalone
  case, and any instance whose proxy does not rewrite that header — changed it per request and was
  never limited. **The limit existed; it limited nothing**, which is worse than no limit because it
  gives assurance.

  The caller's address is now a host decision (`identity.clientIp`), since only the host knows
  whether a proxy sits in front. Unset, the header is ignored entirely and the socket address is
  used — **an instance without a proxy is protected without doing anything**.
  `PLAYER_TRUSTED_PROXY_HOPS=1` reads from the **end** of the chain, not the beginning: the
  beginning is what the client wrote, the end is what the proxies observed. Reading the first
  element is the classic mistake with this header, and it is the one the code made.

  *This also makes the new limit above real: without it, the internal-session throttle would have
  been bypassable by the same trick it was meant to stop.* (P1-6)

## [0.1.21] — 2026-08-14

### Security
- **Email links no longer come from the `Host` header** (`PLAYER_PUBLIC_URL`). The client chooses
  that header: on the standalone server, or behind a proxy that does not rewrite it strictly, a
  reader could request a perfectly legitimate send — signed by the host, carrying its brand and its
  sender reputation — **whose button points at their own domain**. Phishing supplied turn-key, to a
  recipient the attacker picks, and the victim has no reason to suspect it. Unset, the player falls
  back to `Host` so no running instance breaks, and **says so**: an instance sending mail without a
  public URL should learn it before a phishing report teaches it.
- **`isEvalSupported: false` forced on every PDF render.** The pinned pdf.js is within the range of
  CVE-2024-4367 (script execution when opening a crafted PDF). Our CSP does not allow
  `unsafe-eval`, which blocks the path today — but that mitigation was **implicit**, and one CSP
  edit would have reopened it without a word. The protection no longer depends on a header written
  somewhere else.

  *Upgrading pdf.js is not a version bump: cdnjs ships only ES modules from 4.0, while we load a
  classic script and configure the worker by hand. That migration is tracked separately, together
  with bundling the library — which also settles the CDN-without-integrity finding.*

  *Both reported by an external audit (P1-1, P1-3).*

## [0.1.20] — 2026-08-14

### Fixed
- **The unread badge stopped counting.** 0.1.19 routed chat broadcasts through a re-read, and the
  re-read added the messages without ever notifying — so a new message arrived silently. The
  condition matters as much as the call: a re-read returns the whole history, so notifying without
  checking what was *actually* added would recount every message on every re-read, which is the
  "badge goes up by 2" defect fixed back in 0.1.2 returning through another door.

  *Nobody here saw it. **A host's test caught it**, by reading this package's source once installed
  — across the boundary of two repositories. That guard was written for a different reason and
  still did its job.*

## [0.1.19] — 2026-08-14

### Security
- **A presentation broadcast is now a signal, not a truth.** The Realtime channel is **public**:
  the publishable key and the slug are both in the page, so any participant can emit on it. The
  audience applied the received payload directly, which let any viewer announce the end of the
  presentation, change the page or document shown to everyone, lock the chat, or post a message
  signed with someone else's name.

  ⚠️ **Moving emission to the server would not have fixed this** — that was the audit's first
  suggestion. On a public channel an attacker still emits, and the client cannot tell the two
  sources apart. The only defence that holds is to stop believing the transport: authoritative
  events now trigger a **re-read from the server**, which was already the source of truth
  (`state=1`, `chat=1` — both routes already existed). An attacker can still emit; they trigger a
  re-read and obtain nothing. That property also survives a future flaw in the transport itself.

  `map` and `typing` still apply their payload, deliberately: ephemeral signals (live map
  movement, "someone is typing") with no server state to check against and a high rate.
  Re-verifying them would cost a round-trip per mouse move to protect a mouse move. Everything
  authoritative goes through `state`, which is re-read. A test enforces that **no other event**
  may trust its sender.

  *Reported by an external audit. A private channel with row-level policies remains the cleaner
  end state and is tracked in [`docs/AUDIT-2026-08-14-SUIVI.md`](docs/AUDIT-2026-08-14-SUIVI.md);
  it needs short-lived tokens for an anonymous audience, which is infrastructure rather than a
  fix — hence this first.*

## [0.1.18] — 2026-08-14

### Security
- **The file proxy followed redirects, and the host secret followed with it.** `isAllowedStorageUrl`
  validated only the *initial* URL; `fetch` then followed redirects by default, so the final
  destination faced no origin list, no route prefix and no `https:` check. An allowed upstream —
  the host's own file route, or any listed storage origin — answering `302` took the call wherever
  it wanted: `localhost`, a private address, a cloud metadata endpoint. The invariant this project
  documents ("no redirect following into your private network") was false.

  ⚠️ **And `x-player-fetch-secret` travelled.** `fetch` strips only `Authorization`, `Cookie` and
  `Proxy-Authorization` across a cross-origin redirect; a custom header is forwarded as-is.
  Measured with two local servers before fixing: the destination received the host's shared secret
  in clear. That is not only an SSRF — it is exfiltration of the key that authorises reading
  **every** document the host serves.

  Redirects are now followed by hand, with three properties: every hop re-passes the full guard, so
  a redirect opens nothing the starting URL could not; **the secret is recomputed per hop**, so it
  travels only where *that* hop is under the host's route; and the chain is bounded, with protocol
  changes refused — a redirect to `file:` would have turned a remote upstream into a local disk
  read. `AbortSignal.timeout` added: an upstream that never answers used to hold the request
  forever.

  *Reported by an external audit, confirmed by measurement rather than by reading.*

## [0.1.17] — 2026-08-14

### Security
- **`form-action 'self'` added to every page.** `form-action` is one of the few CSP directives
  that does **not** fall back to `default-src`: a page served with `default-src 'none'` could still
  post a form to any domain. No page here contains a `<form>` — submissions go through `fetch`, so
  `connect-src` governs them — but an injected script could build one to exfiltrate, and nothing
  stopped it. `'self'` rather than `'none'`: the access wall and visitor sign-in may need a
  same-origin post, and breaking authentication to close a door nobody walked through would be a
  poor trade. `'self'` closes exfiltration, which is the real risk.

  *Found while checking an external review that recommended `object-src 'none'` — that one **is**
  covered by `default-src 'none'`, so the recommendation was redundant. The directive that was
  genuinely missing was not on its list.*

## [0.1.16] — 2026-08-14

### Fixed
- **An embedded preview never said it was there** — *announced in 0.1.15 and not actually in it;
  see below.* `embed-ready` tells a host "I am alive". A host waiting for it and hearing nothing
  cannot tell an **absent** player from a **living** one, and a prudent startup watchdog replaces
  the second with the browser's own viewer a few seconds in, in front of the reader.

  One variable answered two questions: *should the embedded close button be drawn?* (no in
  preview — it already has its own, and drawing both would show two crosses) and *is this page
  served inside a frame?*. Only the second governs the handshake. The server already knew — it
  derives the response's `frame-ancestors` from it — and the page already spoke to its host
  (`share`, `close`); it simply never announced itself. Preview is precisely the mode a host uses
  for its **own** documents. The chrome is unchanged.

### Fixed (release process)
- ⚠️ **0.1.15 was published without the fix above, and announced as containing it.** The commit
  landed on a branch whose pull request had already been merged, so it never reached `main`. Every
  check passed, because every check looks at the working tree or the branch — never at the
  artifact. **The host found it**, by diffing the two npm tarballs.

  Two guards now exist, and the second is the one that generalises:
  - a `pre-push` hook refuses to push to a branch whose pull request is already merged (the
    neighbouring repository has had one since a similar incident on 5 August; this one did not);
  - the release summary lists **what actually changed inside the published package** since the
    previous version. Release notes promising a fix in a file that is absent from that list are
    visibly wrong, at the moment of publishing rather than days later.

  *A mutation test cannot catch this: it runs on the working tree, not on the tarball. The lesson
  is the host's, and it is exact — verify the published artifact, not the sources.*

## [0.1.15] — 2026-08-14

### Fixed
- **An embedded preview never said it was there.** `embed-ready` tells a host "I am alive". A host
  waiting for it and hearing nothing cannot tell an **absent** player from a **living** one — and
  a prudent startup watchdog replaces the second with the browser's own viewer a few seconds in,
  in front of the reader. That is what happened: the second host removed their watchdog until
  silence became information again.

  One variable was answering two questions: *should the embedded close button be drawn?* (no in
  preview — it already has its own, and drawing both would show two crosses) and *is this page
  served inside a frame?*. Only the second governs the handshake. The server already knew — it
  derives the response's `frame-ancestors` from it — and the page already spoke to its host
  (`share`, `close`); it simply never announced itself.

  Preview is precisely the mode a host uses for **its own** documents: no tracked link, no
  recipient. The chrome is unchanged.
- **The folder-mode home page offered a format the viewer no longer opens.** It kept its own list
  of displayable extensions, and that list still contained `.svg` after it was dropped from the
  type table in 0.1.7. The file appeared, the click produced a download, and a first-time visitor
  concluded the project does not work — on the one screen that never gets a second run. The list
  is now **derived** from the type table rather than copied.

  *Found while checking an external review about MIME sniffing. Its recommendation — `nosniff`, a
  generic type, forced download — has been in place since 0.1.7, and measurement confirms it: a
  `.png` containing HTML is served `image/png` with `nosniff`, so the browser will not sniff it
  into a script. The defect was next door: a list promising a format that had been removed.*

## [0.1.14] — 2026-08-14

### Security
- **Re-sharing a document stripped its restrictions.** `createReshare` enumerated the columns to
  copy, so every column added since was silently left out — and because these columns are
  `not null default`, the omission did not leave a hole, it wrote the **most permissive value**:

  - **`require_auth`** (default `false`) — a document behind the access wall, once forwarded,
    opened **without the wall**. A recipient could therefore lift the protection by forwarding the
    document to themselves. This was the worst of the three, and it was not in the report that led
    here.
  - **`allow_download`** (default `true`) — the Download button came back on a document where it
    had been refused.
  - **`brand_key`** — the brand was lost exactly where the document starts to travel.

  Inheritance is now the rule and the exceptions are enumerated: a column added tomorrow is
  inherited without anyone thinking about it. If it is a restriction, it propagates. A test covers
  the *mechanism* — an unknown column must survive a re-share — rather than a list that would go
  stale the same way the code did.

  *Reported by the second host, who saw the brand — the one that **shows** — and assumed the rest
  followed. The rest followed.*

### Added
- **Sending the re-share email can be delegated to the host** (`PLAYER_HOST_MAIL_URL` +
  `PLAYER_HOST_MAIL_SECRET`), which is what a host with its own provider and templates wants.

  ⚠️ **The player calls it only for a link that has a recipient.** The reader of an anonymous link
  is any passing visitor; letting them request a send would turn the host's servers into a relay
  for unsolicited mail, with the host's domain in the header. What that costs is not the message —
  it is a sender reputation that takes weeks to recover, during which *none* of their mail arrives.
  The guard sits on the path that acts, not in the host's route on arrival: a filter on arrival
  depends on a list staying current, a path that cannot phrase the request never phrases it by
  accident. *Requested by the host in our code rather than kept in theirs.*

  The payload carries structured fields (`kind`, `doc`, `from`) next to the HTML, and isolates
  caller-supplied text under `untrusted` — a host composing its own message can ignore it in one
  gesture instead of remembering which field is doubtful.

  A third secret, deliberately: the file secret travels on every document opened and lives in the
  host's logs; adding "send mail in your name" to what a log leak permits is a different power.

## [0.1.13] — 2026-08-14

### Fixed
- **The tracking notice invented a sender.** "…passed on to its sender" is right for a named link
  and false for a public brochure opened from a map by someone who received no message. This is
  the one sentence in the product whose whole job is to be exact. The player now picks by the link
  itself — no recipient and no creator means nobody sent it — which needed no new data: that is
  already the idempotency key for host-owned links. `PLAYER_TRACKING_NOTICE_ANON` overrides it; a
  context that provides no second text falls back to the first rather than showing none.
- **The tab title showed the operator instead of the brand the visitor clicked.** Someone arriving
  on a client's brand read the name of the company that runs the tool. The link's brand was
  *already* resolved for the loader and sitting on the share — the title simply did not consult it.
  No new configuration. "Powered by" stays the instance's, deliberately: saying who operates the
  tool is honest disclosure, not a brand leak.

  *Both reported by the second host looking at their own screen — which no test does. Both were
  true while an instance served one audience, and false the moment it served two.*

## [0.1.12] — 2026-08-14

### Fixed
- **A sleeping machine reported hours of reading.** The tab stays `visible`, the window keeps
  focus, no `visibilitychange` or `blur` fires — and the timers do not run either, so the idle
  loop cannot do its job. On wake, a raw timestamp delta poured the entire sleep into the current
  page: **eight hours of a closed laptop measured as 28 805 seconds read.**

  Accumulated time is now capped at "up to the last activity, plus the idle grace" — the same rule
  the idle loop applies, extended to the case where it could not run. An active reader produces
  events, so a real reading session is untouched; a sleeping machine produces none.

  *This is not an exotic case: it is how a laptop closes in the evening. And it is the number the
  whole product rests on — "this client read for twelve minutes" is only worth something if the
  number is honest when it is large as well as when it is small.*

  *Found while checking an external review that pointed at the right place with the wrong
  diagnosis: it recommended cutting on `visibilitychange`, which has been done since day one,
  alongside `blur`/`focus` and a 60-second idle timeout. The hole was where no event fires at all.*

## [0.1.11] — 2026-08-14

### Added
- **The host can create a tracked link in its own name** (`PLAYER_HOST_SHARE_SECRET`). Some links
  have no sender: the public brochure of a listing, opened by a prospect who has no account and
  should not need one. No member is present, so there is no token to require — and requiring one
  forces the host to invent an identity that does not exist. Same nature as `/authz` and
  `/branding`, which the host already answers server to server.

  ⚠️ **A different secret from `PLAYER_HOST_FETCH_SECRET`, deliberately.** That one only ever
  travels *outward* — the player sends it on every file fetch, so it sits in the host's access
  logs, proxies and error tracker. Whoever holds it can impersonate the player *to the host*;
  accepting it inbound would additionally grant write access *here*. One more variable against a
  blast radius that does not grow. The core never sees the secret: it asks the context a question,
  the adapter answers yes or no.

  **Three locks:** `docshare.create` only (revoking, listing and analytics stay member actions — a
  server secret must not reveal who read what); no recipient (a named link belongs to a member);
  idempotent by `docId`, which needed no new column — "the host's link for this document" is the
  row with no creator *and* no recipient, so an instance already in service migrates nothing.
  Without idempotence, a redeploy or a double click yields three links for one brochure, and
  analytics split three ways that nobody notices until they read them six months later.

  The link carries no creator, so it appears in no member's "my links" and stays visible under
  `list.all` — the existing filter already did the right thing. *Requested by the second host,
  who had ruled out all three workarounds themselves before writing, including the one that would
  have filed a prospect among internal readers.*
- `host-share` in `capabilities`, and `hostShare` alongside `separateIssuer`: what the instance
  *can* do, and what is *configured*.

## [0.1.10] — 2026-08-14

### Changed
- **The core no longer opens the environment; it goes through the injected context.** Eleven direct
  `process.env` reads were bypassing the very boundary this project documents everywhere else —
  six for the database, two for the maps key, one for frame ancestors, and one for the **service
  role key**, which opens the whole database. A host wiring its own storage or database was
  silently short-circuited. Nothing changes for a host whose context mirrors its environment,
  which is both hosts today; what changes is that a host that does not is now actually obeyed.
- **Signing an upload URL is a host capability** (`storage.signUpload`). The core asked the
  environment for a service-role key to sign chat-attachment uploads; it now asks the host, which
  is where the key lives. A host that does not provide it gets a clean refusal that says so,
  rather than an attachment that never leaves. *Honest about what remains: the returned page still
  calls supabase-js `uploadToSignedUrl`, so the feature is not portable yet — only the secret has
  moved out of the core.*
- **One source of truth for frame ancestors.** `embedFrameAncestors()` read the environment while
  `?contract=1` announced `PLAYER.config.extraFrameAncestors`. They agree only as long as a host
  fills its config from that same variable. A host computing it otherwise would have the card
  announce one list and the CSP header serve another — configured and served diverging *inside*
  the mechanism built to detect exactly that.

  *Raised by an external review as "you are coupled to Supabase, add an abstraction layer". The
  abstraction already existed — it was leaking. A static test now refuses any new leak, and it
  found two the manual inventory had missed.*

## [0.1.9] — 2026-08-14

### Added
- **`separateIssuer` in `GET /api/doc?contract=1`.** `host-auth` says an instance *can* verify
  tokens against an issuer separate from its database; this says one *is configured*. Without the
  second signal, a host that upgrades and forgets the variable sees exactly the failure 0.1.8
  removed — members come back unauthenticated, which reads like a missing permission — and
  concludes the upgrade changed nothing. A boolean, never the issuer: the host already knows which
  one is theirs, and naming it would only inform whoever probes.

### Changed
- **The container image moves to Node 24 (active LTS).** It stays on the **active LTS**, never on
  Current: Current ships every six weeks and carries breaking changes, and self-hosters should not
  inherit that. Node 26 exists since August 2026 but is not supported long-term until October.
  `engines` stays `>=22` — what the *package* accepts and what the *image* embeds are different
  questions, and 22 is maintained until April 2027.
- Dependabot no longer proposes Node **major** bumps for the image. It cannot know that a release
  is Current, and proposed 26 the day it appeared. A green PR that puts production on an
  unsupported base is still a green PR — review catches that, not CI, so the proposal stops.

## [0.1.8] — 2026-08-14

### Fixed
- **A third-party instance could not authenticate its own members.** `SUPABASE_URL` served two
  roles at once: the player's database, and the issuer of the tokens it accepts. True — and
  necessary — while the player and its application share a deployment; false by construction once
  an instance is separate, because the database belongs to the player and identity belongs to the
  host. Members were issued tokens by one project and verified against another, which put the
  entire *member* half of the surface out of reach: sending, revoking, analytics, authenticated
  presentations. `PLAYER_AUTH_URL` (+ `PLAYER_AUTH_KEY`) now names the issuer; unset, it falls back
  to `SUPABASE_URL`, so an instance where both coincide changes by not one character.

  *Reported by the second host, who had checked both sides before writing. It is the third
  assumption of this shape in two days — after `'self'` for framing and "same origin" for the
  internal preview. They only become visible by exercising the separation.*

### Security
- **The key sent to the issuer no longer falls back to the service role.** That fallback was
  harmless while the issuer was the player's own project; toward a third-party issuer it would
  hand over the master key to the player's database on a single configuration mistake. A distinct
  issuer requires its own publishable key, and its absence is reported instead of improvised —
  a silent refusal here reads like a missing permission, which is the failure this release exists
  to remove.

### Added
- `host-auth` in `GET /api/doc?contract=1` capabilities: a host can tell whether an instance
  supports a separate issuer without opening a document.

## [0.1.7] — 2026-08-13

### Security
- **A relayed file could execute on the player's own origin.** The relay copied the upstream
  `Content-Type` verbatim, so a file announced as `image/svg+xml` or `text/html` — from a public
  bucket, or from a host's own file route — opened *inline* on the domain that serves the
  documents, next to its sessions, its presentation tokens and its analytics. A streaming response
  carries no CSP: it is a file, not a page. Anything a browser would render rather than download is
  now served inert (generic type, forced download, `nosniff`); it stays retrievable and cannot
  execute. The displayable formats are untouched.

  *Found while writing the README's format matrix — a documentation question. Dropping `.svg` from
  the local type table had closed only the half we control; the remote upstream announces whatever
  it likes.*

### Changed
- **Node.js 22 or newer** is now required. 20 reached end of life; the image, the CI matrix and the
  declared `engines` say the same thing, which was not the case before.
- **The published package ships compiled JavaScript and type declarations**, not TypeScript source.
  `discovery-media-player/bridge` was published as `.ts`, so a host without a build step could not
  import the very thing meant to spare it from copying constants by hand. The package is also 4×
  smaller. A CI check refuses a package containing `src/`.
- **The host contract is documented in English, in the open** ([`docs/HOST-CONTRACT.md`](docs/HOST-CONTRACT.md)).
  It used to be a working document written for two known teams, in French, mixing the contract with
  internal deploy history. The rules are unchanged; what left is the part that was true only for us.

### Removed
- **`.svg` is no longer served.** An SVG is a document that executes script: served inline it runs
  in the instance's origin, and the viewer's own type detection did not treat it as an image
  anyway — so it was never displayed as one. Nothing regresses that worked.

### Added
- Multi-architecture image (`linux/amd64`, `linux/arm64`) with SBOM and build provenance.
- Automated GitHub Releases on `vX.Y.Z` tags, with this file's section as the notes.
- CodeQL analysis and grouped monthly Dependabot updates.

## [0.1.6] — 2026-08-13

### Fixed
- **A separate instance could not be framed by its own host — on the success path only.** The
  internal preview branch had `frame-ancestors 'self'` written as a literal, so
  `DOC_FRAME_ANCESTORS` was never consulted there. True while the application and the player share
  a deployment; false the moment an instance is separate — which is the entire point of a separate
  instance. Nothing signalled it.

  The absurd consequence, spotted by the host: the **refusal** page was framable (fixed the day
  before, on their report) while the **success** page was not. The error path was more portable
  than the nominal one.
- **The audience page passed no ancestors at all**, so `frame-ancestors 'none'` — framable by
  nobody, not even by its own origin. Found while checking the first.

### Added
- **`frameAncestors` in `GET /api/doc?contract=1`.** A boolean would not have been enough: a host
  needs to see that *its own domain* is missing, not merely that embedding is possible. This is
  the one failure a host cannot diagnose — the browser blocks before any script runs, so nothing
  can be emitted to it. Now it can see the mismatch without opening a single document.

## [0.1.5] — 2026-08-13

### Added
- **A warning when embedding is requested with no host allowed to frame it.** With
  `DOC_FRAME_ANCESTORS` empty, only a same-origin page and `*.vercel.app` may frame the viewer;
  any other parent is blocked **by the browser, before the page loads** — so no `embed-denied` can
  be sent, and the host sees a silence indistinguishable from an unreachable instance. This is the
  one failure the player cannot signal to the host, so it now signals it to the operator, at the
  only moment it can know: when serving an embedded page.
- **A live demo** (`examples/demo`): one function, one dependency, no database and no secret.

### Changed
- Contract: the fourth requirement of *"the host serves the file"* gains its corollary — **when
  the reference itself carries a capability, signing is not enough; it must be encrypted.**
  *Signed* means nobody can forge it. It has never meant nobody can read it.
- Contract: the search criteria you use to inventory your document-opening doors decides what you
  find. Search by what the user **obtains**, not by the technique you expect.

  *(All three come from the first host's real switchover.)*

## [0.1.4] — 2026-08-13

### Fixed
- **A wiring mistake looked like a refusal.** The handler reads `req.query` — the serverless and
  Express convention — which a bare `http.createServer` does not fill. With no parameters, a
  request went looking for a share named *nothing*, found none, and rendered *"this link is no
  longer valid or has been revoked"*. An integrator saw a **refusal** where they had simply not
  wired the platform. It now falls back to parsing `req.url`, so the handler is platform-agnostic
  in fact and not only in the README.
- **A request asking for nothing now says so** (`400`, naming the missing parameters) instead of
  returning the revocation page. A refusal and a missing parameter must not look alike.

### Changed
- **Documentation: most hosts need no wiring file at all.** `context/standalone` already delegates
  both host decisions to `PLAYER_HOST_AUTHZ_URL` and `PLAYER_HOST_BRAND_URL`; an instance whose
  application exposes those routes is four files, one of them ten lines. The custom-context example
  is now presented as the exception — for decisions that cannot travel over HTTP.

  *Both changes come from the first third-party integration. The extraction had gone further than
  its own instructions said.*

## [0.1.3] — 2026-08-13

### Fixed
- **The audience stopped following the presenter.** The page's state handler was registered from a
  script block that could not see the function it named — a silent `ReferenceError` at wiring time,
  after which slide changes simply never arrived. Covered by a test that *executes* the generated
  page rather than reading its source, which is the only way this class of fault shows up.

## [0.1.2] — 2026-08-13

### Security
- **Attachment type whitelist could be bypassed.** `ATT_KINDS["constructor"]` returns a *function* —
  a truthy value — so a public `present-upload-url` call with `type: "constructor"` passed the
  whitelist and got a signed upload URL for a type that was never allowed. The storage bucket
  remained a second barrier, but the first one was open. Every lookup of that shape now goes
  through `Object.hasOwn`, and a static test refuses any that does not.
  *Found after a third-party host reported the same pattern three times in their own code.*

### Added
- **Live chat now travels by broadcast.** It was delivered through table-level realtime, which
  requires a public SELECT on the table — meaning anyone holding the publishable key could read
  the conversations of *every* presentation. This was the last thing requiring that policy;
  `supabase/init.sql` no longer needs one, and instances that had it can drop it.
- **Host-route call formats are documented** (`PLAYER_HOST_AUTHZ_URL`, `PLAYER_HOST_BRAND_URL`).
  They were missing, and a host implemented them from prose: right intention, wrong shape, and
  two of the three mismatches were silent — a wrongly-shaped response reads as a refusal.
- **A broken host route no longer looks like a refusal.** Unreachable, timed out, non-JSON, or a
  wrongly-typed `allowed` are logged with their cause. The player stays fail-closed.

### Fixed
- Unread badge counted each chat message twice while both delivery paths were active.

## [0.1.1] — 2026-08-13

### Added
- The standalone server's root page lists what there is to read, instead of answering `404` to
  someone who just started the container and has no slug yet.

### Changed
- Published from CI by OIDC, with provenance — no long-lived token stored anywhere.
- Dependency tree cleaned: no vulnerability reported at install.

## [0.1.0] — 2026-08-13

First public release: the viewer extracted from the 3D Discovery studio into a project that runs on
its own.

### Added
- Framework-agnostic `(req, res)` handler — serverless, Express, or the bundled standalone server.
- Standalone server (`bin/serve.js`) and Docker image — the player runs without a platform.
- Local folder as a document source (`PLAYER_LOCAL_ROOT`), with `Range` support, symlink
  containment and traversal tests. Makes the project usable with no database at all.
- `GET /api/doc?contract=1` — version, contract number, capabilities and plugin state. No
  session, no database, no cache: it must answer when nothing else does.
- `embed-denied` on the postMessage bridge, with a reason (`revoked`, `auth-required`,
  `auth-unavailable`, `url-not-allowed`, `ended`). An embedded host can now tell a refusal from
  an outage instead of falling back to its own viewer on a document the player just closed.
- `supabase/init.sql` — brings a fresh database to the expected state in one replayable file,
  already hardened.

### Fixed
- **Truncated documents.** `fetch()` decompresses a body while keeping the upstream headers;
  relaying `Content-Length` announced the compressed size for decompressed bytes. All three
  streaming paths now announce the size of what they actually send, request `identity` encoding,
  and refuse a compressed `206` rather than serve something false.
- **Silent refusals.** Refusal pages were served with `frame-ancestors 'none'`, so an embedded
  host saw a blank frame and no message. They are now framable in embed mode.
- **A widening guard.** `PLAYER_HOST_FETCH_BASE` without a trailing slash matched sibling routes
  (`/api/documents` also allowed `/api/documents-prives/`). Normalised rather than documented.
- `branding.forKey` dropped the `name` it promised — the fallback shown when a logo fails to
  load. It now reaches the page as the image's alternative text.

[Unreleased]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.145...HEAD
[0.1.145]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.144...v0.1.145
[0.1.144]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.143...v0.1.144
[0.1.143]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.142...v0.1.143
[0.1.142]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.140...v0.1.142
[0.1.140]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.139...v0.1.140
[0.1.139]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.138...v0.1.139
[0.1.138]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.137...v0.1.138
[0.1.137]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.136...v0.1.137
[0.1.136]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.135...v0.1.136
[0.1.135]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.134...v0.1.135
[0.1.134]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.133...v0.1.134
[0.1.133]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.132...v0.1.133
[0.1.132]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.131...v0.1.132
[0.1.131]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.130...v0.1.131
[0.1.130]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.129...v0.1.130
[0.1.129]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.128...v0.1.129
[0.1.128]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.127...v0.1.128
[0.1.127]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.126...v0.1.127
[0.1.126]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.125...v0.1.126
[0.1.125]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.124...v0.1.125
[0.1.124]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.123...v0.1.124
[0.1.123]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.122...v0.1.123
[0.1.122]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.121...v0.1.122
[0.1.121]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.120...v0.1.121
[0.1.120]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.119...v0.1.120
[0.1.119]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.118...v0.1.119
[0.1.118]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.117...v0.1.118
[0.1.117]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.116...v0.1.117
[0.1.116]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.115...v0.1.116
[0.1.115]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.114...v0.1.115
[0.1.114]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.113...v0.1.114
[0.1.113]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.112...v0.1.113
[0.1.112]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.111...v0.1.112
[0.1.111]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.110...v0.1.111
[0.1.110]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.109...v0.1.110
[0.1.109]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.108...v0.1.109
[0.1.108]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.107...v0.1.108
[0.1.107]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.106...v0.1.107
[0.1.106]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.105...v0.1.106
[0.1.105]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.104...v0.1.105
[0.1.104]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.103...v0.1.104
[0.1.103]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.102...v0.1.103
[0.1.102]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.101...v0.1.102
[0.1.101]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.100...v0.1.101
[0.1.100]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.99...v0.1.100
[0.1.99]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.98...v0.1.99
[0.1.98]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.97...v0.1.98
[0.1.97]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.96...v0.1.97
[0.1.96]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.95...v0.1.96
[0.1.95]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.94...v0.1.95
[0.1.94]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.93...v0.1.94
[0.1.93]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.92...v0.1.93
[0.1.92]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.91...v0.1.92
[0.1.91]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.90...v0.1.91
[0.1.90]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.89...v0.1.90
[0.1.89]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.88...v0.1.89
[0.1.88]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.87...v0.1.88
[0.1.87]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.86...v0.1.87
[0.1.86]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.85...v0.1.86
[0.1.85]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.83...v0.1.85
[0.1.83]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.82...v0.1.83
[0.1.82]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.81...v0.1.82
[0.1.81]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.80...v0.1.81
[0.1.80]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.79...v0.1.80
[0.1.79]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.78...v0.1.79
[0.1.78]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.77...v0.1.78
[0.1.77]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.76...v0.1.77
[0.1.76]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.75...v0.1.76
[0.1.75]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.74...v0.1.75
[0.1.74]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.73...v0.1.74
[0.1.73]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.72...v0.1.73
[0.1.72]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.71...v0.1.72
[0.1.71]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.70...v0.1.71
[0.1.70]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.69...v0.1.70
[0.1.69]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.68...v0.1.69
[0.1.68]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.67...v0.1.68
[0.1.67]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.66...v0.1.67
[0.1.66]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.65...v0.1.66
[0.1.65]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.64...v0.1.65
[0.1.64]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.63...v0.1.64
[0.1.63]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.62...v0.1.63
[0.1.62]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.61...v0.1.62
[0.1.61]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.60...v0.1.61
[0.1.60]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.59...v0.1.60
[0.1.59]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.58...v0.1.59
[0.1.58]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.57...v0.1.58
[0.1.57]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.56...v0.1.57
[0.1.56]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.55...v0.1.56
[0.1.55]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.54...v0.1.55
[0.1.54]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.53...v0.1.54
[0.1.53]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.52...v0.1.53
[0.1.52]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.51...v0.1.52
[0.1.51]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.50...v0.1.51
[0.1.50]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.49...v0.1.50
[0.1.49]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.48...v0.1.49
[0.1.48]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.47...v0.1.48
[0.1.47]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.46...v0.1.47
[0.1.46]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.45...v0.1.46
[0.1.45]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.44...v0.1.45
[0.1.44]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.43...v0.1.44
[0.1.43]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.42...v0.1.43
[0.1.42]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.41...v0.1.42
[0.1.41]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.40...v0.1.41
[0.1.40]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.39...v0.1.40
[0.1.39]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.38...v0.1.39
[0.1.38]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.37...v0.1.38
[0.1.37]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.36...v0.1.37
[0.1.36]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.35...v0.1.36
[0.1.35]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.34...v0.1.35
[0.1.34]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.33...v0.1.34
[0.1.33]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.32...v0.1.33
[0.1.32]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.31...v0.1.32
[0.1.31]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.30...v0.1.31
[0.1.30]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.29...v0.1.30
[0.1.29]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.28...v0.1.29
[0.1.28]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.27...v0.1.28
[0.1.27]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.26...v0.1.27
[0.1.26]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.25...v0.1.26
[0.1.25]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.24...v0.1.25
[0.1.24]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.23...v0.1.24
[0.1.23]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.22...v0.1.23
[0.1.22]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.21...v0.1.22
[0.1.21]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.10...v0.1.11
[0.1.10]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Juli1artha/discovery-media-player/releases/tag/v0.1.0
