# Contrat du player — v1

> **Le point de passage entre les projets.** Ce fichier est la seule source de vérité sur ce qu'un
> projet hôte peut appeler. Toute session (studio ou ADV) le lit avant de toucher à l'intégration.
>
> **Une seule SOURCE, deux formes de consommation** (décidé le 13/08/2026) :
> - **3D Discovery** installe le player comme **dépendance**. Son URL et sa base ne bougent pas —
>   des liens `/doc/:slug` sont déjà chez des prospects, on ne les casse pas.
> - **Le second hôte** en fait tourner un **déploiement autonome**, sur son domaine et sa base.
>   Aucune donnée ADV ne transite ni ne se stocke chez 3D Discovery. Données sensibles.
>
> Une amélioration du cœur profite aux deux au déploiement suivant, sans rien reprendre. Ce fichier
> ne décrit donc **que la frontière**, pas l'intérieur.

## Les cinq règles

1. **Un seul dépôt de vérité.** Le player se corrige **dans le dépôt du player**, jamais dans un
   hôte — pas même dans celui qui l'a écrit à l'origine, qui l'installe aujourd'hui depuis npm
   comme tous les autres. Un correctif écrit côté hôte est une copie qui divergera : le précédent
   est documenté — un runtime copié dans 4 dépôts, 3 sur 4 servaient une version périmée sans que
   personne ne le voie.
2. **Additif par défaut.** Ajouter une action, un paramètre ou un champ ne casse aucun hôte : c'est
   libre, ça se note au journal. **Retirer ou renommer est une rupture** → nouvelle version, les
   deux servies pendant la migration.
3. **⚠️ Ordre de déploiement : le player part AVANT les hôtes.** L'inverse fait disparaître la
   fonctionnalité partout, d'un coup, sans erreur visible.
4. **L'hôte épingle la version qu'il vise** et un test le vérifie. Une dérive doit être bruyante,
   pas silencieuse. Le player expose sa carte d'identité sur **`GET /api/doc?contract=1`** — sans
   session, sans base, et sans cache : c'est un point de diagnostic, il doit répondre même quand le
   reste ne va pas.

   ```json
   { "product": "discovery-media-player", "contract": 1, "version": "0.1.0",
     "capabilities": ["docshare", "presentations", "embed-denied", "host-fetch", "brand-reference"],
     "plugins": { "bot": true, "visitors": true, "brandIntro": true, "botBrowser": true, "providerQuotas": true } }
   ```

   **`contract` est LE champ à épingler** : il ne bouge que sur une rupture (règle 2) — ajouter une
   action, un paramètre ou un motif de refus ne le change pas. `capabilities` se teste par
   PRÉSENCE, jamais par ordre. `plugins` permet à un hôte de refuser de démarrer si le mur d'accès
   manque alors qu'il compte dessus. Aucune URL, aucun secret, aucun nom d'hôte n'y figure — un
   point de diagnostic qui divulgue sa configuration est un cadeau à qui le sonde.

   **Qui prévient qui.** Une PR d'hôte qui exige une version plus récente l'écrit **dans son titre**
   (« requiert player ≥ v2 »). Elle ne peut pas être mergée avant que l'instance correspondante soit
   déployée. C'est la seule règle nécessaire : il n'y a qu'une personne qui déploie les deux.
5. **Qui corrige le module générique.** Cette règle disait « un besoin d'hôte se demande, il ne
   se code pas sur place ». Elle datait d'avant la publication, quand le player vivait dans un
   hôte et qu'aucun autre ne pouvait y toucher. Maintenant qu'il a son dépôt, elle est trop
   étroite : un hôte **peut** coder — dans le bon dépôt.

   **N'importe quel hôte propose. Le mainteneur arbitre et publie.**

   | | |
   |---|---|
   | Un hôte trouve un défaut du player | il ouvre une **issue ou une PR sur le dépôt du player** — il a le contexte, souvent déjà le code |
   | Le mainteneur | tranche, fusionne, **publie la version** |
   | Les hôtes | épinglent la nouvelle version quand ils décident de la prendre |

   ⚠️ **La publication reste au mainteneur, et ce n'est pas une question de hiérarchie.** Publier
   une version décide de l'ordre de déploiement (règle 3). Si chacun publie, plus personne ne sait
   quelle instance tourne sur quoi.

   ⚠️ **Et l'arbitrage n'est pas une formalité : un hôte optimise pour son cas, c'est normal.**
   Exemple vécu — un hôte a corrigé chez lui, en trois lignes, le fait que le gestionnaire lise
   `req.query` sur une plateforme qui ne le remplit pas. Son correctif était juste. Le bon
   correctif était **dans le cœur**, parce que le défaut touchait tous les hôtes, présents et à
   venir. Seul quelqu'un qui tient les contraintes des deux côtés voit ça.

   **Le contournement local est autorisé quand il débloque**, à deux conditions : le signalement
   est ouvert **le jour même**, et le contournement est **retiré quand la version arrive**. Sinon
   il devient permanent, et on a deux implémentations qui divergent — c'est-à-dire le problème que
   ce contrat existe pour empêcher.

---

## Surface v1

### Pages servies

| URL | Public | Rôle |
|---|---|---|
| `/doc/:slug` | prospect anonyme | lien tracé par destinataire (suivi complet) |
| `/present/:slug` | audience anonyme | page spectateur d'une présentation en direct |
| `/api/doc?preview=1&url=…` | membre de l'hôte | aperçu interne (pas de lien tracé, suivi interne séparé) |

**Paramètres de l'aperçu interne** : `url` (obligatoire, doit passer l'allowlist de Storage),
`name`, `title`, `docId`, `by` (nom du présentateur), `av` (avatar), `uemail` (membre — c'est lui
qui déclenche le suivi interne), `autopresent=1`, `resume=<slug>`, `embed=1`.

### Pont `postMessage` (iframe ↔ hôte)

Décrit une seule fois dans `player/src/bridge.ts`, importé des deux côtés. Validation **par type**,
pas par origine (un contrôle d'origine strict bloquait la réception en production).

- **player → hôte** : `close`, `share`, `embed-ready`, `embed-denied {reason}`, `present-left`,
  `present-denied`, `present-invite {slug}`, `present-handover {slug}`, `present-switch {slug}`
- **hôte → player** : `handover-done`

Le `slug` traversant la frontière est borné (`[A-Za-z0-9_-]{1,64}`), le `reason` aussi
(`[a-z-]{1,40}`, ramené à `unknown` sinon).

**`bridge.ts` est importable, et c'est le but** — il est publié sous MIT précisément pour qu'un hôte
n'ait pas à recopier des constantes. Un `3dd-doc-embed-ready` recopié à la main est un contrat qui
existe en deux exemplaires : le jour où le préfixe change, un seul des deux le sait. Un hôte qui ne
peut pas l'importer (autre langage, autre chaîne de build) copie le fichier *tel quel* et note d'où
il vient, plutôt que d'en extraire trois chaînes de caractères.

### Actions `POST /api/doc`

- **Suivi** (public, sans authentification) : événements `open` / `page` / `heartbeat` / `session`.
  Les sessions **internes** portent `internal:true` — deux populations, jamais fusionnées.
- **Présentation** : `present-start|page|end|touch` (démarrage public, pilotage par jeton),
  `present-attend` (présence), `present-chat`, `present-react`, `present-msg-edit|delete`,
  `present-chatlock`, `present-upload-url`.
- **Présentation, membre authentifié (JWT)** : `present-list|reclaim|handover|owner-end|stats|
  doc-list|switch|content`.
- **Re-partage** : `reshare`.
- **Liens tracés, membre authentifié (JWT)** : `docshare.create|list|revoke|setauth|overview|sessions|test`.
  ⚠️ **QUI a le droit est une règle de l'HÔTE**, pas du player : elle passe par le contexte,
  `identity.canManageShares(user, action)`. Le player vérifie le jeton ; il ne connaît pas les
  rôles métier d'une application qu'il ne connaît pas. Sans réponse de l'hôte, ou en cas de panne
  de sa règle : **refus**. Un droit qu'on ne sait pas accorder ne s'accorde pas.

  ⚠️ **L'ACTION est transmise** (`create`, `list`, `list.all`, `revoke`, `setauth`, `overview`,
  `sessions`, `test`). Un droit unique pour les sept confondrait deux choses : **envoyer un
  document à SON prospect** est un acte commercial ordinaire ; **révoquer le lien d'un autre** ou
  **lire l'aperçu global** est un acte d'administration. Avec un seul droit, ou bien les commerciaux
  ne peuvent rien envoyer, ou bien chacun révoque les liens de tout le monde. Un hôte sans cette
  distinction ignore simplement le paramètre.

  `list.all` est une question SUPPLÉMENTAIRE posée lors d'une liste : répondre non restreint la
  réponse aux liens créés par le demandeur. Sans elle, un commercial verrait à qui d'autre le
  document a été envoyé — les prospects de ses collègues.

  **Limite connue — deux portées, pas trois.** Le player ne connaît que « tous » et « les miens ».
  Un hôte dont le modèle a une portée intermédiaire (l'équipe, l'agence, le périmètre) ne peut pas
  l'exprimer : soit il accorde tout, soit il restreint au demandeur. Signalé par ADV, dont les
  chefs d'équipe ont une portée `all` maison — la mapper telle quelle leur donnerait les
  destinataires de leurs collègues, c'est-à-dire la fuite que `list.all` vient de fermer. Ils s'en
  tiennent donc à la règle du player.

  **Le jour où ça deviendra nécessaire**, la forme est déjà claire : `canManageShares` répondrait
  `true` (tout), `false` (rien), ou **une liste d'emails** dont le demandeur a le droit de voir les
  liens. Le player filtrerait sur `created_by`, sans jamais rien savoir de l'organisation de
  l'hôte. Non fait aujourd'hui : aucun hôte n'a la population pour l'utiliser, et un chemin de code
  sans usage réel est un chemin non éprouvé.

  ⚠️ **La règle de l'hôte doit être évaluée EN DIRECT, jamais recopiée dans le jeton.** Un rôle
  miroité dans `app_metadata` à la connexion ne peut, par construction, pas refléter une
  **désactivation** : il reste périmé jusqu'à expiration du jeton, c'est-à-dire précisément dans le
  seul cas qui compte. Quelqu'un ayant quitté l'entreprise continuerait à créer des liens vers des
  prospects.
- **Mur d'accès visiteur** (greffon) : `visitor-request|verify|google`.

### D'où le player tire un fichier — « l'hôte sert le fichier »

Le player **ne stocke jamais** un document : il le relaie, et seulement depuis une **origine
déclarée** (garde anti-SSRF). Un hôte dont les documents ne vivent pas dans un Storage joignable
directement — cas d'ADV, dont **99 % des documents sont sur le serveur de fichiers de l'appli
un serveur de fichiers tiers**, derrière une clé d'API — expose **une route à lui** et n'autorise qu'elle.

```
                                                          ┌─▶ Serveur tiers
prospect ──▶ player /doc/:slug?file=1 ──▶ route de l'hôte ─┼─▶ Partage
                                          authentifie      ├─▶ Storage de l'hôte
                                                           └─▶ Dropbox, Drive…
```

**Le player ne voit qu'UNE porte, quel que soit le nombre de sources derrière.** C'est la
propriété qui compte : un hôte peut brancher un nouveau service de fichiers sans que le player
change d'une ligne, et sans qu'aucun lien déjà envoyé cesse de fonctionner. Les connecteurs sont
l'affaire de l'hôte — le player n'a ni à les connaître, ni à porter leurs identifiants.

⚠️ **Conséquence pour l'hôte : prévoir la multi-source DÈS la première.** La référence signée que
la route reçoit doit dire de QUELLE source vient le fichier (`{source, ref}`), même s'il n'y en a
qu'une au début. La coder à la forme d'un seul fournisseur oblige à reprendre la route et tous ses
appelants au deuxième. Et le garde-fou anti-SSRF de l'hôte devient une allowlist par source, pas
une origine unique.

⚠️ **Le player ne porte JAMAIS les identifiants d'un tiers.** Ils appartiennent à l'hôte, comme la
relation avec ce tiers. Autoriser directement l'origine du tiers donnerait au player le droit d'y
lire n'importe quoi, avec des identifiants : c'est précisément ce que la garde interdit.

**Trois exigences sur la route de l'hôte, faute de quoi l'expérience se dégrade sans erreur :**

1. **Elle doit relayer les requêtes `Range`** (répondre `206` + `Accept-Ranges: bytes`). C'est de
   là que vient le chargement progressif : les premières pages s'affichent sans télécharger tout le
   PDF. Sans Range, un document lourd reste blanc plusieurs secondes. Si la source ne sait pas
   faire de Range, c'est à la route de l'hôte de le simuler.
2. **Elle doit accepter un appel SERVEUR À SERVEUR.** Un lien tracé `/doc/:slug` est ouvert par un
   prospect **sans session chez l'hôte** : c'est l'instance du player qui va chercher le fichier,
   pas le navigateur. La route reconnaît donc l'instance par un **secret partagé**
   (`PLAYER_HOST_FETCH_SECRET`, en-tête serveur), et le player ne l'appelle que pour un partage
   existant et non révoqué.
3. **Elle ne doit JAMAIS relayer le `Content-Length` reçu de sa source.** La plus chère des trois,
   et la seule qui ne se voit pas. `fetch()` **décompresse le corps pour vous et garde les en-têtes
   reçus** : si la source (CDN, S3, proxy) a répondu en `gzip`, renvoyer fidèlement son
   `Content-Length` annonce la taille du COMPRESSÉ alors que vous servez du décompressé. Le lecteur
   coupe à l'octet annoncé → **PDF tronqué**, sans erreur nulle part. Ce n'est plus « le chargement
   progressif ne marche pas », c'est « le document est faux ».

   La règle tient en une phrase : **annoncez la taille des octets que vous envoyez, jamais celle que
   vous avez reçue.** Demandez `Accept-Encoding: identity` en amont, et **refusez un `206` porteur
   d'un `Content-Encoding`** : les bornes d'un fragment portent sur les octets compressés, et un
   morceau de gzip ne se décompresse pas seul — mieux vaut un `502` bruyant qu'un document faux.

   *(Le player applique lui-même cette règle depuis le 13/08 — `relayerFichier()`, un seul chemin
   pour ses trois routes de streaming. Le piège nous concernait aussi.)*

⚠️ **ET UNE QUATRIÈME, D'UNE AUTRE NATURE — celle-ci n'abîme pas l'expérience, elle ouvre les
données.**

Les trois précédentes portent sur le TRANSPORT. Celle-ci porte sur ce qu'on transporte :

> **Ce que votre route accepte de signer est ce que n'importe quel appelant peut lire.
> Ne signez jamais un chemin fourni par le client.**

Le raisonnement tient en trois phrases. Le player va chercher le fichier **serveur à serveur** —
il n'a, par construction, aucune session à faire valoir : c'est tout l'objet du secret partagé.
Votre route le sert donc avec **ses propres droits**, souvent une clé de service qui contourne
vos politiques de ligne. Une action qui signe un chemin reçu du navigateur devient alors un
oracle : un utilisateur fait signer un chemin que ses droits lui refusent, ouvre l'aperçu, et le
player le lui lit avec les vôtres.

**La garde anti-SSRF ne voit rien** — l'origine est parfaitement légitime, c'est la vôtre.

La forme qui tient : **l'appelant fournit une SOURCE d'un ensemble fermé et un IDENTIFIANT de
ligne, jamais un chemin.** Le chemin est relu en base avec la session de l'appelant, et vos
politiques tranchent comme partout ailleurs. C'est la même règle que `brandKey` (une référence,
pas une copie) et que `PLAYER_HOST_FETCH_BASE` (un préfixe, pas une origine) : **on transmet de
quoi retrouver, jamais de quoi désigner.**

⚠️ **Le piège est qu'elle est souvent théorique le jour où on l'écrit.** Si vos politiques
laissent aujourd'hui tout membre connecté lire, l'élévation n'existe pas encore — elle apparaîtra
au premier resserrement, des mois plus tard, et personne ne fera le lien entre « on a restreint un
accès » et « une route signe encore n'importe quoi ».

*(Signalée par le second hôte après l'avoir rencontrée en basculant ses premières surfaces.
Vérifiée chez l'hôte historique le jour même : une route y signait un chemin reçu du client,
derrière une liste NOIRE de rôles — un compte d'espace client passait, et tout rôle créé plus tard
serait passé aussi.)*


### Un refus se dit — `embed-denied`

Un hôte qui intègre la visionneuse (`?embed=1`) attend `embed-ready`. Il est tentant d'en faire un
délai d'attente : « rien reçu en 5 s ⇒ le player est absent ⇒ j'ouvre le document avec le lecteur du
navigateur ». **C'est un trou de sécurité**, parce que le silence recouvre deux cas opposés :

| Ce que l'hôte observe | Ce que ça peut vouloir dire | Ce que le repli produit |
|---|---|---|
| pas d'`embed-ready` | instance absente, en panne, en déploiement | ✅ repli légitime |
| pas d'`embed-ready` | le player **refuse** : lien révoqué, mur d'accès, greffon manquant | ❌ **ouvre le document que le player venait de fermer** |

Le player émet donc `embed-denied` avec un `reason`. **Tous** ses chemins de refus l'émettent —
lien tracé, aperçu interne, page d'audience — et leurs pages restent volontairement encadrables en
mode intégré : sinon le navigateur bloque le rendu et le message ne partirait pas.

| `reason` | Ce qui s'est passé | **Conduite de l'hôte** | Où ça se soigne |
|---|---|---|---|
| `revoked` | lien inconnu ou révoqué | **ne pas ouvrir** | chez l'hôte : le lien n'a plus lieu d'être |
| `auth-required` | document réservé, visiteur non connecté | **ne pas ouvrir** | nulle part : le mur reste affiché, on peut s'y connecter |
| `auth-unavailable` | document réservé, mur d'accès absent de l'instance | **ne pas ouvrir** | configuration du player (greffon `visitors` coupé) |
| `ended` | présentation terminée ou inconnue | ne pas ouvrir | nulle part : elle est finie |
| `url-not-allowed` | l'URL du fichier n'est pas couverte par la garde | **OUVRIR** — et signaler la configuration | configuration du player (`PLAYER_STORAGE_ORIGINS`, `PLAYER_HOST_FETCH_BASE`) |

⚠️ **`url-not-allowed` est la seule exception à « on ne replie pas », et il faut la lire avec soin.**
Les deux motifs de *configuration* demandent des conduites **opposées**, ce que la seule colonne
« où ça se soigne » ne disait pas :

- avec `url-not-allowed`, **aucune décision d'accès n'a été prise** — le player n'a pas pu atteindre
  le fichier. Le traiter comme un refus affiche « Document indisponible » à un membre qui a
  parfaitement le droit de lire, et l'envoie chercher un document disparu là où c'est une variable
  d'environnement qui est en cause ;
- avec `auth-unavailable` au contraire, le document **était** censé être protégé et c'est le mur qui
  manque : ouvrir contournerait la protection.

Et ce qui rend l'exception sûre plutôt que commode : **`url-not-allowed` n'est émis que par l'aperçu
interne**, jamais sur un lien tracé public. Le lecteur qui le reçoit est un membre de l'hôte, déjà
authentifié chez lui, qui a le droit de lire ce document — l'hôte n'ouvre donc rien qu'il n'aurait
pas ouvert de toute façon. Si un jour ce motif apparaissait sur un chemin public, cette ligne du
tableau devrait changer AVANT.

La règle sous-jacente, plus sûre que la liste : **on ne replie jamais sur un refus d'ACCÈS ; on peut
replier sur une incapacité à ATTEINDRE.** *(Distinction relevée par ADV en rangeant les motifs — la
version précédente de ce tableau laissait un hôte se tromper dans un sens ou dans l'autre.)*

Ces deux motifs ressemblent pourtant tous les deux à une instance injoignable, et un hôte qui
branche sa première visionneuse (`?preview=1&embed=1`) les rencontrera avant tout le reste. Le
diagnostic tient en trois mots ; sans le motif, il coûte une demi-journée.

**Un hôte ne replie jamais après un refus d'accès** (les quatre premiers motifs) — la décision est
prise, il ne reste qu'à afficher son propre message. **Et « ne pas replier » vaut pour ce qu'il
PROPOSE, pas seulement pour ce qu'il fait automatiquement** : un lien « Ouvrir ↗ » laissé dans l'en-tête ferait du refus une
gêne contournable d'un clic. Ne pas replier tout seul mais offrir le bouton revient au même une
seconde plus tard. *(Généralisation proposée par ADV, retenue.)*

*(Le `reason` est indicatif et borné — il ne porte aucune donnée du document.)*

**L'aperçu interne porte toujours la marque de l'INSTANCE**, jamais celle d'un client : il n'accepte
pas de `brandKey`. C'est délibéré — l'aperçu est la surface des équipes, et un membre qui ouvre un
document depuis sa bibliothèque doit voir son propre outil. La marque du client sert à un lecteur
EXTERNE, qui ne doit pas voir le nom de l'outil qui la lui sert. Conséquence assumée : un document
d'un client A consulté en interne s'ouvre sous la marque de l'hôte. Ce n'est pas un défaut de
résolution.

### Installer une instance

**Le schéma vit avec le player** : `player/supabase/init.sql` amène une base vierge à l'état
attendu, en un fichier rejouable, sans rien à lire ailleurs. Ce n'est pas la suite des migrations
de l'hôte historique — elles sont entrelacées avec les siennes, et trier 145 fichiers est une
question qui n'a de bonne réponse qu'une seule fois.

⚠️ **Une base neuve s'installe DÉJÀ DURCIE.** L'avertissement sur `v12420` (ne pas retirer la
lecture anonyme avant d'avoir vérifié le broadcast, sous peine de figer les audiences en cours) ne
concerne QUE l'instance historique, qui doit sortir d'un état existant. `init.sql` ne crée aucune
politique de lecture publique : une instance neuve ne passe jamais par cet état, même
transitoirement. **Le point qui interdisait d'y mettre un dossier sensible n'y est donc jamais
vrai.** *(Relevé par ADV — confirmé.)*

**La dépendance** : le player est publié en **dépôt public sous AGPL-3.0**. Rien à
configurer chez l'hôte : ni jeton de lecture, ni clé de déploiement dans ses variables Vercel.

**`PLAYER_SOURCE_URL` pointe sur ce dépôt.** C'est ce qui rend l'obligation tenable : un lecteur
qui suit le lien « code source » depuis une page servie trouve exactement le code qui la sert.

Sur le **câblage** de l'hôte : il *appelle* le player, il ne le modifie pas — mais il vit dans le
même processus, et la position prudente est de le considérer couvert. C'est sans conséquence si on
le conçoit pour : **aucun secret ne doit s'y trouver en clair** (ils sont dans les variables
d'environnement), et ce qui reste est du branchement. Un câblage qu'on ne pourrait pas publier est
un câblage qui contient quelque chose qui n'a rien à y faire. *(Ce n'est pas un avis juridique :
c'est la posture retenue, et elle est sûre dans les deux cas.)*

### Les deux routes que le player appelle chez l'hôte

⚠️ **Ces formats sont le contrat, pas une suggestion.** Ils manquaient à ce document : un hôte a
écrit ses deux routes sur la *description* de `canManageShares`, ce qui donnait une intention juste
et une forme fausse. Et le pire : **deux des trois écarts étaient silencieux** — une réponse d'une
autre forme est lue comme un refus. Personne n'aurait pu diffuser un document, sans erreur nulle
part, indiscernable d'un droit correctement refusé. On aurait cherché dans les rôles.

Les deux routes sont appelées en **POST JSON, serveur à serveur**, avec le secret partagé dans
l'en-tête `x-player-fetch-secret` (jamais en query). Délai : **4 secondes** — une décision qui tarde
est une décision absente.

**`PLAYER_HOST_AUTHZ_URL` — qui a le droit de diffuser**

```
→  { "email": "…", "role": "…", "action": "create|list|list.all|revoke|setauth|overview|sessions|test" }
←  { "allowed": true }            // booléen STRICT ; tout le reste vaut refus
```

- **`email` est l'identité qui fait foi.** `role` est celui lu dans le jeton de session
  (`app_metadata.role`) : un hôte dont les rôles vivent en base l'ignore et interroge la sienne à
  partir de l'email. C'est un cas prévu, pas une entorse.
- **Le jeton est déjà vérifié** par le player avant l'appel. La route n'a pas à le revalider — elle
  ne le reçoit d'ailleurs pas.
- **Seul `allowed` est lu**, et il doit être un booléen. `{ "canManageShares": true }` ou
  `{ "allowed": "yes" }` valent refus. Le player le signale désormais dans son journal.

**`PLAYER_HOST_BRAND_URL` — la marque d'un client**

```
→  { "key": "…" }                                  // la référence portée par le lien
←  { "logo": "https://…", "name": "…", "dark": false }   ou   {} / null si inconnue
```

Une clé inconnue n'est pas une erreur : le lien retombe sur la marque de l'instance.

**Une panne n'est plus muette.** Hôte injoignable, délai dépassé, réponse non-JSON, `allowed`
d'un autre type : le player reste **fail-closed** (personne ne diffuse) mais l'écrit dans son
journal, avec la cause. Sans ça, « ma route répond mal » et « le droit est refusé » se
ressemblaient exactement.

### Le câblage d'une instance — à qui il appartient

Une instance autonome, c'est **un petit dépôt qui appartient à l'hôte**, pas un dépôt généré par le
player. Il contient quatre choses et rien d'autre :

| | Ce que c'est |
|---|---|
| `package.json` | dépend du player |
| la route | une ligne : `module.exports = require("discovery-media-player").handler` |
| **le câblage de contexte** | l'unique fichier à écrire : `storage`, `db`, `identity`, `branding`, `limits`, `mail`, `errors` |
| `vercel.json` + variables | domaine, `/doc/:slug`, secrets |

**Il appartient à l'hôte parce qu'il ne contient que des décisions de l'hôte** : ses secrets, sa
base, qui a le droit de diffuser, quelle clé désigne quel client. Un dépôt généré par le player
devrait les deviner, et l'hôte n'aurait plus d'endroit où les changer. Le player fournit le moteur
et ce contrat ; le câblage est le seul code que l'hôte écrit — quelques centaines de lignes, une
fois.

`api/_player-context.js` du studio en est l'exemple de référence, et il est lisible comme tel.

### Les portes se rouvrent toutes seules

Une application a plus d'un endroit qui ouvre un document, et il en réapparaît. ADV a trouvé sur sa
carte publique une visionneuse de 395 lignes que personne n'avait recensée : elle affichait des
documents **sans passer par le player**, donc sans être comptée. Ce n'est pas un oubli ponctuel,
c'est la pente naturelle d'un produit vivant — un `<iframe src="....pdf">` s'écrit en dix secondes.

**Chaque hôte doit tenir la liste de ses portes et la rechasser périodiquement.** Une recherche
suffit : `.pdf`, `window.open`, `<embed`, `<iframe` sur un fichier, `application/pdf`. Le tableau
des portes recensées vit chez chaque hôte, pas ici. La règle, elle, est commune : **une porte non
recensée est une lecture non comptée**, et l'écart ne se voit dans aucune statistique — il se voit
seulement quand quelqu'un le cherche.

### Configuration côté player

| Variable | Rôle |
|---|---|
| `PLAYER_STORAGE_ORIGINS` | origines de Storage autorisées **en plus** de celle de la base du player. ⚠️ **Reste nécessaire même avec des instances séparées** : les fichiers d'un hôte vivent dans le Storage de SON appli, pas dans la base du player. |
| `PLAYER_PLUGINS_OFF` | greffons coupés (`bot`, `botBrowser`, `avatarClips`, `brandIntro`, `visitors`, `providerQuotas`) |
| `DOC_FRAME_ANCESTORS` | domaines autorisés à encadrer la visionneuse |
| `GOOGLE_MAPS_API_KEY` | carte et Street View de la présentation (restreinte par référent) |
| `PLAYER_HOST_FETCH_BASE` | **préfixe d'URL complet** de la route de fichiers de l'hôte (ex. `https://app.exemple.fr/api/documents/`). ⚠️ Un préfixe, pas une origine : autoriser un domaine entier rendrait le player capable d'appeler n'importe quelle route de l'hôte. |
| `PLAYER_HOST_FETCH_SECRET` | secret partagé, envoyé en en-tête **`x-player-fetch-secret`**. ⚠️ **En-tête uniquement, jamais en query** (les journaux gardent l'URL, il fuiterait en clair des deux côtés). ⚠️ **Uniquement vers la route de l'hôte** — jamais vers un Storage public, où il n'a rien à faire. Absent côté hôte ⇒ personne ne passe ; comparaison à temps constant, ≥ 32 caractères. |

### Mentions affichées aux lecteurs

| Variable | Effet |
|---|---|
| `PLAYER_SOURCE_URL` | lien « Code source » — **obligation AGPL** |
| `PLAYER_LEGAL_URL` | lien « Mentions légales » de l'hôte |
| `PLAYER_PRIVACY_URL` | lien « Confidentialité » de l'hôte |
| `PLAYER_TRACKING_NOTICE` | remplace le texte de la mention de mesure |

⚠️ **L'AGPL crée une obligation que la plupart des licences n'ont pas** : quiconque **utilise** le
logiciel à travers un réseau doit pouvoir en obtenir le source — pas seulement celui qui le
distribue, celui qui l'**expose**. Un lecteur de `/doc/:slug` est un utilisateur à ce titre. Chaque
instance doit donc offrir cet accès, et une instance **modifiée** doit offrir **sa** version.

⚠️ **La mention de mesure s'affiche PAR DÉFAUT** sur les pages qui tracent — lien tracé et page
audience — et seulement sur elles. Un lien tracé enregistre qui a ouvert, quelles pages, combien de
temps et depuis quel appareil : c'est un traitement de données personnelles, la personne doit
pouvoir le savoir. **L'absence des trois liens est un choix de l'hôte ; l'absence de celle-ci est
un risque.** L'aperçu interne ne l'affiche pas : personne d'extérieur ne le lit.

> Le texte par défaut et la base légale retenue méritent une relecture juridique. Le player fournit
> l'emplacement et un texte factuel, pas un avis.

### Formats affichés

Le player n'est **pas** limité au PDF. Une **image** (`png`, `jpg`, `jpeg`, `webp`, `gif`, `avif`,
reconnue par le NOM du fichier — le type MIME n'est pas toujours renvoyé par la source) s'affiche
comme une page unique, avec tout le chrome générique : loader, zoom, plein écran, partager,
télécharger, **et le suivi de consultation**. Une image ouverte dans le player est donc tracée
exactement comme un PDF.

⚠️ **Le format se déduit du NOM du fichier, pas du type MIME** (une source de stockage ne le
renvoie pas toujours). Concrètement :

- pour un **lien tracé**, le nom vient de `fileName` fourni à `docshare.create` — **toujours le
  renseigner** ;
- pour l'**aperçu interne**, du paramètre `&name=` ;
- à défaut, le player retombe sur l'URL, et l'extension doit y être **en fin de chaîne ou juste
  avant le `?`**. Une route d'hôte à URL opaque (`/raw?d=…`) ne dit rien du format : une image y
  serait envoyée à pdf.js et n'afficherait **rien** — écran vide, pas d'erreur. Faire porter le nom
  par le chemin (`/raw/plan.png?d=…`) est le repli sûr.

**Autres formats** (`.docx`, `.xlsx`, …) : le player **ne les affiche pas** et n'a pas de repli —
il affiche « Impossible d'afficher ce document ». Ce n'est donc ni le player ni un choix de
l'hôte : **ces formats ne doivent pas lui être envoyés**, l'hôte les sert en téléchargement.

### Marque

Par document : `brand_logo` (URL) et `brand_dark` (loader sur fond sombre) sur le lien de partage.
Le loader et le mur d'accès s'y conforment déjà.

**Marque de l'ÉDITEUR** (l'entreprise qui exploite l'instance — à distinguer du logo du client,
qui est par document) :

| Variable | Effet |
|---|---|
| `PLAYER_BRAND_NAME` | nom affiché : suffixe de titre d'onglet, mot-marque du loader, nom par défaut de l'assistant, objet du courriel de re-partage |
| `PLAYER_BRAND_POWERED_BY` | mention « Propulsé par … » en pied de page et « Powered by … » sous le logo d'un client |
| `PLAYER_LOADER_NAME` | marque affichée **par le loader** — repli sur `PLAYER_BRAND_NAME` |

⚠️ **TROIS identités se croisent sur une page de document, et les confondre se voit.**

| | Ce que c'est | Où |
|---|---|---|
| **Le produit** | le logiciel qui sert la page | titre d'onglet, « Propulsé par » |
| **L'exploitant** | l'entreprise qui fait tourner l'instance | **le loader** — la première chose que voit le lecteur |
| **Le client** | celui dont on montre le document (`brand_logo` sur le lien) | le loader, **à la place** de l'exploitant |

L'erreur a été commise une fois : le nom du produit s'est retrouvé sur le loader, à la place de
la marque attendue. D'où `PLAYER_LOADER_NAME`, distinct.

**Marque PAR CLIENT — résolue par l'hôte.** Une instance sert plusieurs clients : le loader doit
porter la marque de celui dont on montre le document. Le lien porte une **référence** (`brandKey`,
posée à la création), pas une copie du logo — et le player ne sait pas ce qu'est un client. Il
appelle l'hôte :

```
ctx.branding.forKey(brandKey) → { logo, name, dark } | null
```

| Champ | Rôle | ⚠️ |
|---|---|---|
| `logo` | URL affichée par le loader et le mur d'accès | doit être joignable depuis le navigateur du lecteur |
| `name` | **le repli quand le logo ne charge pas** — et il ne charge pas toujours | **le plus oublié.** Sans lui, un logo cassé laisse un vide au lieu d'un nom |
| `dark` | loader sur fond sombre | `false` par défaut |

`null` (clé inconnue, client supprimé) ⇒ le lien retombe sur la marque de l'instance. Ce n'est pas
une erreur : c'est le comportement attendu.

⚠️ **`name` n'est pas décoratif.** C'est précisément la valeur qui sert quand le reste échoue, donc
celle qu'on découvre manquante le jour où on en a besoin. Le premier hôte à câbler `forKey` l'a
omise en lisant ce contrat — d'où ce tableau.

**Où vit `forKey` quand l'instance est séparée.** Une instance autonome ne peut pas importer le
code de l'application hôte — deux projets, deux déploiements. `forKey` **appelle donc une route de
l'hôte**, comme l'autorisation le fait déjà. Recopier la correspondance clé → logo dans le câblage
serait une copie de plus : bénigne au début (les URL sont absolues, c'est le fichier servi qui
change quand la charte bouge), mais elle réclame une modification et un déploiement du câblage
chaque fois qu'un client apparaît — et surtout **elle a l'air officielle**. Une source unique qui
coûte un aller-retour au premier affichage vaut mieux qu'une copie qui ne coûte rien jusqu'au jour
où elle ment.

⚠️ **Cet appel ne doit jamais empêcher de lire.** Hôte injoignable, clé inconnue, délai dépassé ⇒
`null` ⇒ marque de l'instance. Le loader dégrade ; le document s'ouvre. C'est déjà le comportement
du player (`brandForShare` ne lève jamais), mais la route de l'hôte doit tenir la même promesse :
répondre vite, ou répondre rien.

Il n'y a **aucun registre de marques dans le player**, et ce n'est pas un manque : l'hôte a déjà ses
clients quelque part (une fiche CRM, une organisation). Un second registre à tenir à jour serait une
copie de plus à faire diverger. *(Un registre `brand.list|upsert|delete` a existé une demi-journée
avant d'être retiré pour cette raison.)*

⚠️ **Pourquoi une référence et pas une copie.** Un lien tracé vit des semaines dans une boîte mail.
Un logo recopié dans le lien ne bouge plus : rectifier la charte d'un client ne changerait rien à
ce qui est déjà parti. Résolue à l'affichage, la référence se propage à tout l'existant.

**Ordre de résolution** : référence du lien → logo recopié (flux historiques, toujours accepté) →
marque de l'instance. Le player ne sait pas ce qu'est un client : il ne connaît que des clés, et
c'est l'hôte qui décide quelle clé pour quel document.

⚠️ **NEUTRE PAR DÉFAUT, et c'est voulu.** Sans configuration, le player n'affiche la marque de
personne : ni titre suffixé, ni mention de pied, ni mot-marque. Envoyer à un client un document
portant la marque d'une autre société est une faute, pas un détail — le défaut le rend impossible.
Les deux variables sont indépendantes : un hôte peut vouloir son nom sans mention de pied.

⚠️ **Le studio doit poser ces deux variables avant de déployer**, faute de quoi ses pages perdent
« Propulsé par 3D Discovery » et le suffixe de leur titre. Rien ne casse — c'est visible, pas
fonctionnel — mais ça se voit tout de suite.

---

## Journal du contrat

Toute évolution de la frontière se note ici, datée, avec sa nature.

| Date | Nature | Changement |
|---|---|---|
| 2026-08-13 | — | Ouverture du contrat en v1, sur l'existant. Aucun hôte tiers branché à ce jour. |
| 2026-08-13 | décision | **Isolation** : ADV aura son propre déploiement, sa propre base, son propre domaine. Le studio ne bouge pas. Une seule source de code. |
| 2026-08-13 | précision | En-tête du secret figé : **`x-player-fetch-secret`** (nom proposé par la session ADV, retenu pour son explicité). |
| 2026-08-13 | précision | Le player affiche **aussi les images**, tracées comme un PDF. Ce n'était écrit nulle part. |
| 2026-08-13 | additif | **Mentions aux lecteurs** : lien code source (AGPL), mentions légales, confidentialité, et une mention de mesure affichée PAR DÉFAUT sur les pages qui tracent. |
| 2026-08-13 | additif | **Marque du client résolue par l'hôte** (`brandKey` sur le lien → `branding.forKey`) : un logo rectifié se propage aux liens déjà envoyés, sans registre à synchroniser. Migration `v12421`. |
| 2026-08-13 | retiré | ~~Registre des marques~~ (`brand.list|upsert|delete`, `brandKey` à la création d'un lien) : le loader porte la marque du client, par référence — un logo rectifié se propage aux liens déjà envoyés. Migration `v12421`. Rétrocompatible. |
| 2026-08-13 | additif | **Portée de la liste** : `list.all` décide si `docshare.list` renvoie tous les liens d'un document ou seulement ceux du demandeur. La réponse porte `scope: "all"｜"mine"`. |
| 2026-08-13 | additif | **`canManageShares` reçoit l'ACTION** — demandé par ADV, dont le modèle sépare l'envoi (tout conseiller) de l'administration des liens. Aucune rupture : un hôte qui ne distingue pas ignore le paramètre. |
| 2026-08-13 | additif | **Liens tracés dans le player** : `docshare.*` quitte la route de synchro du studio pour `/api/doc`. Nouveau point de contexte `identity.canManageShares` — l'hôte décide qui a le droit de diffuser. |
| 2026-08-13 | additif | **Marque de l'éditeur configurable**, neutre par défaut. Aucune mention en dur ne subsiste dans les pages servies (3 tests de non-régression, un par page). ⚠️ Le studio doit poser ses variables avant de déployer. |
| 2026-08-13 | additif | **Suivi par DIFFUSION** : l'audience suit l'état par broadcast sur le canal `plive-<slug>` + relecture `?present=<slug>&state=1`, en parallèle de la lecture de table. Une fois vérifié en production, la migration `v12420` retire la lecture anonyme — **et l'énumération de toutes les présentations avec la clé publiable disparaît**. ⚠️ Ordre obligatoire : déployer, vérifier, PUIS migrer. |
| 2026-08-13 | additif | **« L'hôte sert le fichier »** : la garde de streaming accepte une route de l'hôte comme origine, appelée serveur à serveur via `PLAYER_HOST_FETCH_SECRET`. Rendu nécessaire par ADV, dont les documents vivent sur un serveur de fichiers tiers derrière une clé d'API. Le studio n'est pas concerné (Storage direct) — **additif, aucune rupture**. |
| 2026-08-13 | additif | **`embed-denied`** ajouté au pont : un refus d'afficher se dit, au lieu de se confondre avec une panne. Les pages de refus deviennent encadrables en mode intégré (sinon le message ne partirait pas). **Additif** — un hôte qui l'ignore garde le comportement d'avant. |
| 2026-08-13 | correctif | **Taille annoncée** : les trois routes de streaming passent par `relayerFichier()`, qui envoie la taille des octets servis et jamais celle reçue de l'amont, demande `Accept-Encoding: identity` et refuse un `206` compressé. Corrige un PDF tronqué silencieux. |
| 2026-08-13 | précision | **Le format d'appel des deux routes de l'hôte** (`PLAYER_HOST_AUTHZ_URL`, `PLAYER_HOST_BRAND_URL`) est enfin écrit. Il manquait : un hôte a écrit ses routes sur la description de `canManageShares` — intention juste, forme fausse, et **deux écarts sur trois étaient silencieux** (réponse lue comme un refus). |
| 2026-08-13 | additif | **Une panne de route d'hôte se distingue d'un refus** : injoignable, délai dépassé, réponse non-JSON ou `allowed` d'un autre type sont journalisés avec leur cause. Le player reste fail-closed. |
| 2026-08-13 | correctif | **Objet littéral utilisé comme table de correspondance** : `ATT_KINDS["constructor"]` rendait une fonction, donc une valeur vraie — la liste blanche des types de pièce jointe était contournable depuis une action publique. Même forme cinq fois dans le greffon de langue. Tout passe par `Object.hasOwn`, un test statique interdit le retour en arrière. Trouvé chez nous après signalement d'un hôte qui l'avait chez lui. |
| 2026-08-13 | correctif | **Le chat passe en diffusion** : ses messages arrivaient par lecture de table en temps réel, ce qui exposait les conversations de TOUTES les présentations à qui détient la clé publiable. Dernier usage qui l'exigeait — `v12420` devient applicable. Les mutations renvoient la ligne écrite, **projetée sur une liste blanche** : `author_hash` (le jeton qui autorise à éditer et supprimer) ne sort jamais. |
| 2026-08-13 | correctif | **Tous les chemins de refus** émettent `embed-denied`, pas seulement celui du lien tracé : l'aperçu interne (`url-not-allowed`) et la page d'audience (`ended`) se taisaient — or l'aperçu intégré est le premier mode qu'un nouvel hôte exerce. Deux motifs ajoutés, une garde de test empêche le prochain refus muet. |
| 2026-08-13 | précision | **`branding.forKey` renvoie `{ logo, name, dark }`** — la forme de retour manquait au contrat, et `name` (le repli quand le logo ne charge pas) a été omis par le premier hôte qui l'a lu. Le registre `brand.*`, retiré, disparaît aussi de la section Marque. |
| 2026-08-13 | précision | **« On ne replie pas » vaut pour ce qu'un hôte PROPOSE**, pas seulement pour ce qu'il fait tout seul : un bouton « Ouvrir ↗ » laissé après un refus revient à replier une seconde plus tard. Généralisation proposée par ADV. |
| 2026-08-13 | précision | **L'aperçu interne porte la marque de l'INSTANCE**, jamais celle d'un client (pas de `brandKey`) : c'est la surface des équipes. Tranché, pas subi. |
| 2026-08-13 | correctif | **Barre finale de `PLAYER_HOST_FETCH_BASE` normalisée** : la comparaison est un préfixe de chaîne, donc `…/api/documents` saisi sans barre ouvrait aussi `/api/documents-prives/`. Élargissement silencieux de la garde, par une variable tapée à la main. |
| 2026-08-13 | précision | **Colonne « conduite de l'hôte »** sur les motifs de refus : les deux motifs de *configuration* demandaient des conduites OPPOSÉES. Règle sous-jacente — on ne replie jamais sur un refus d'ACCÈS, on peut replier sur une incapacité à ATTEINDRE. |
| 2026-08-13 | correctif | **`name` traverse enfin** : promis par le contrat, jeté par la garde du contexte, absent des pages. Il devient le texte de remplacement de l'image du loader et du mur d'accès — le seul repli utilisable sous une CSP à nonce. Le premier hôte qui a câblé `forKey` l'avait omis, et rien ne le contredisait. |
| 2026-08-13 | précision | **Le câblage d'une instance appartient à l'HÔTE** (4 fichiers, un seul à écrire) : il ne contient que des décisions de l'hôte. `forKey` d'une instance séparée **appelle une route de l'hôte** plutôt que de recopier la correspondance clé → logo. |
| 2026-08-13 | additif | **`GET /api/doc?contract=1`** existe enfin : la règle 4 reposait sur un point qui n'avait jamais été écrit. Carte d'identité sans session, sans base, sans cache, sans URL ni secret. |
| 2026-08-13 | additif | **Le schéma part avec le player** (`player/supabase/init.sql`) : un fichier rejouable qui amène une base vierge à l'état attendu, **déjà durci** — une instance neuve ne connaît jamais l'état « lecture anonyme ouverte ». |
| 2026-08-13 | précision | **Règle 5 réécrite : qui corrige le module générique.** Elle interdisait à un hôte de coder — c'était vrai quand le player vivait dans un hôte. N'importe quel hôte **propose** désormais (issue ou PR sur le dépôt du player) ; **le mainteneur arbitre et publie**, parce que publier décide de l'ordre de déploiement. Contournement local autorisé s'il débloque, à condition d'ouvrir le signalement le jour même et de le retirer à l'arrivée de la version. |
| 2026-08-13 | précision | **Règle 1 recadrée** : « le player se corrige dans le studio » devient « dans le dépôt du player » — l'hôte historique l'installe depuis npm comme les autres. |
| 2026-08-13 | décision | **Dépôt public dès la création, AGPL-3.0** : `PLAYER_SOURCE_URL` pointe dessus, aucun jeton ni clé de déploiement chez les hôtes. Le câblage d'un hôte est considéré couvert — il ne doit donc contenir aucun secret en clair, ce qui est de toute façon la bonne façon de l'écrire. |
| 2026-08-13 | décision | **Aucun nom de tiers dans le dépôt publié** : les hôtes sont désignés par leur RÔLE (« l'hôte historique », « le second hôte »), jamais par leur raison sociale, et les exemples d'URL sont fictifs. Le rôle porte toute l'information technique ; le nom ne dit qu'une chose — quelles entreprises travaillent ensemble et où leurs documents vivent. |

---

## Demandes des hôtes

Un hôte qui a besoin d'une évolution de la frontière l'écrit ici. Il ne la code pas chez lui.

| Date | Hôte | Demande | État |
|---|---|---|---|
| 2026-08-13 | ADV | ~~Multi-locataire : colonne `tenant`~~ | **annulée** — instances séparées, chaque base n'a qu'un hôte |
| 2026-08-13 | ADV | ~~JWT multi-émetteurs~~ | **annulée** — chaque instance ne connaît qu'un émetteur |
| 2026-08-13 | ADV | **Extraire le player en dépôt déployable** (le studio le consomme en dépendance, `api/doc.js` devient un adaptateur mince) | à faire — **prérequis de tout le reste** |
| 2026-08-13 | ADV | **Gestion des liens tracés accessible hors studio** : `docshare.create/list/revoke` vit dans la route de synchro derrière le modèle de droits du studio (`clients_registry`) — inappelable par un autre hôte. **Point d'intégration le plus sous-estimé.** | à faire |
| 2026-08-13 | ADV | **Marque de l'hôte** : retirer les mentions « 3D Discovery » en dur | ✅ **livré** — `PLAYER_BRAND_NAME` / `PLAYER_BRAND_POWERED_BY`, neutre par défaut |
| 2026-08-13 | ADV | **Mur d'accès Microsoft** en plus d'email+code et Google One-Tap (ADV est en SSO M365) | à faire |
| 2026-08-13 | ADV | **Confidentialité Realtime** : la lecture anon large interdit d'y mettre des documents sensibles | 🟡 **code complet** — l'état ET le chat passent en diffusion ; migration `v12420` en attente d'une vérification en production |
| 2026-08-13 | ADV | **Streaming via une route de l'hôte** (Range relayé + secret serveur à serveur) — cf. section dédiée | ✅ **livré côté player** — reste à ADV d'exposer sa route |
| 2026-08-13 | ADV | **Le piège de la compression** : `fetch()` décompresse et garde les en-têtes → un `Content-Length` relayé sert un PDF tronqué, sans erreur | ✅ **livré** — 3e exigence de la section, et corrigé dans le player lui-même (le piège nous concernait) |
| 2026-08-13 | ADV | **Distinguer « player absent » de « player refuse »** : le silence pousse l'hôte à replier sur son lecteur, ce qui ouvrirait un document refusé | ✅ **livré** — `embed-denied {reason}` + pages de refus encadrables |
| 2026-08-13 | ADV | **Les portes se rouvrent** : visionneuse de 395 lignes trouvée sur la carte publique, hors player donc hors comptage | ✅ **inscrit au contrat** — chaque hôte tient et rechasse la liste de ses portes |
| 2026-08-13 | ADV | **L'aperçu interne refusait en silence** (`?preview=1&embed=1`, le premier mode qu'un hôte exerce) | ✅ **livré** — `url-not-allowed`, plus `ended` pour l'audience ; garde de test contre le prochain refus muet |
| 2026-08-13 | ADV | **Forme de retour de `branding.forKey` absente du contrat** — `name` omis, or c'est le repli quand le logo ne charge pas | ✅ **livré** — section Marque réécrite (et le registre `brand.*` retiré y traînait encore) |
| 2026-08-13 | ADV | **Généraliser « on ne replie pas » à ce qu'on PROPOSE** (retirer aussi le bouton « Ouvrir ↗ ») | ✅ **retenu au contrat** |
| 2026-08-13 | ADV | **La marque de l'aperçu interne** : instance ou client ? | ✅ **tranché** — toujours l'instance, l'aperçu est la surface des équipes |
| 2026-08-13 | ADV | **`PLAYER_HOST_FETCH_BASE` sans barre finale élargit la garde en silence** | ✅ **livré** — normalisée dans `hostFetchBase()`, 2 tests (dont la route sœur) |
| 2026-08-13 | ADV | **« Où ça se soigne » ne dit pas quelle conduite tenir** — les deux motifs de configuration s'opposent | ✅ **livré** — colonne « conduite », et la règle qui la sous-tend |
| 2026-08-13 | ADV | **Copie du contrat en retard côté ADV** | ✅ **resynchronisée** — `docs/player-contrat-v1.md`, cartouche local conservé, déposée non commitée |
| 2026-08-13 | ADV | **Où vit `forKey` pour une instance séparée** — copie dans le câblage, ou route de l'hôte ? | ✅ **tranché** — route de l'hôte (b). Une copie a l'air officielle, et réclame un déploiement par client |
| 2026-08-13 | ADV | **`name` promis mais jamais transporté** — la garde du contexte le supprimait | ✅ **corrigé** — il atteint la page comme texte de remplacement de l'image |
| 2026-08-13 | ADV | **Le dépôt extrait doit emporter son schéma** (145 migrations entrelacées, base ADV vierge) | ✅ **livré** — `player/supabase/init.sql` |
| 2026-08-13 | ADV | **Une base neuve doit s'installer déjà durcie**, sans passer par l'état « lecture anonyme » | ✅ **confirmé** — `init.sql` ne crée aucune politique publique ; l'avertissement `v12420` ne vise que l'instance historique |
| 2026-08-13 | ADV | **Comment on installe** : npm public, npm privé ou git ? | ✅ **tranché** — dépôt public + npm public, rien à configurer chez l'hôte |
| 2026-08-13 | ADV | **Cible de `PLAYER_SOURCE_URL`** avant le premier lecteur | ✅ **tranché** — le dépôt public lui-même |
| 2026-08-13 | ADV | **`?contract=1` n'existait pas** alors que la règle 4 repose dessus | ✅ **livré** — forme documentée, 3 tests |
| 2026-08-13 | ADV | **Format des routes de l'hôte absent du contrat** — route d'autorisation réécrite après lecture du paquet publié | ✅ **livré** — les deux formats sont au contrat et dans `docs/CONFIGURATION.md` |
| 2026-08-13 | ADV | **Un objet littéral comme table de correspondance répond à `constructor`** (trois occurrences chez eux) | ✅ **vérifié chez nous : deux sites, dont un atteignable depuis une action publique** — corrigés, plus un test statique |
