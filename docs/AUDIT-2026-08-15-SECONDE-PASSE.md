> ⚠️ **Document HISTORIQUE — état au 15/08/2026 (version `0.1.26`).** Rien ici ne décrit l'état
> courant : les constats de cette passe ont été traités dans les versions qui ont suivi, et les
> passes d'audit ultérieures sont tracées version par version dans le
> [CHANGELOG](../CHANGELOG.md). Le rapport reste tel qu'il a été reçu.

# Audit technique complet — seconde passe

Date : 15 août 2026  
Version auditée : `0.1.26`  
Commit de référence : `98b76e1dfd91e5a2c59c9b4802a216b4190200e4` (`main`, tag `v0.1.26`)  
État npm au gel de l'audit : `0.1.26` publiée et intégrité identique au paquet local ; `0.1.25` est à éviter  
Rapport précédent : [`AUDIT-2026-08-14-RAPPORT.md`](AUDIT-2026-08-14-RAPPORT.md), version `0.1.17`  
Suivi examiné : `docs/AUDIT-2026-08-14-SUIVI.md`

## Synthèse exécutive

Le projet a réellement progressé. Le SSRF avec fuite de secret est correctement fermé, le pont
`postMessage` est plus sûr côté player, les limites de débit ne croient plus aveuglément
`X-Forwarded-For`, PDF.js est protégé par `isEvalSupported: false`, la lecture locale a été durcie et
la suite est passée de **236 à 329 tests**. La chaîne propre (`npm ci`, lint, types, tests, build,
paquet) est verte.

Une régression de livraison majeure a été découverte pendant cet audit : `v0.1.25` contient
`return var h2=…` dans un script inline et la couche live ne se parse plus. La version
`0.1.26` corrige la syntaxe et ajoute une compilation de chaque bloc avec `vm.Script`. Les notes et
tests ci-dessous portent donc sur `main/v0.1.26`. La version npm `0.1.25`, qui restera évidemment
disponible dans l'historique du registre, doit être marquée et documentée comme **à ne pas utiliser**.

La conclusion de cette seconde passe n'est cependant pas « tous les P0 sont clos » : plusieurs
statuts du fichier de suivi sont trop optimistes. Le correctif Realtime réduit fortement l'injection
d'état, mais il reste contournable ou perturbable par trois voies indépendantes :

1. `map` continue d'appliquer directement la charge utile d'un canal public ;
2. le debounce de relecture peut être affamé indéfiniment par des broadcasts continus, et peut aussi
   servir d'amplificateur de requêtes HTTP ;
3. le nouveau `presenter_key` de `0.1.25` est public et comparé à un `uid` choisi par le client : il
   ne prouve donc pas l'identité du présentateur. Le même identifiant public permet de rétrograder
   sa ligne d'assistance par un appel `present-attend` sans `control_token` valide.

Deux autres corrections annoncées comme faites restent des modes de transition : le lien d'email
retombe encore sur le header `Host` quand `PLAYER_PUBLIC_URL` manque, et les sessions internes
restent acceptées sans jeton sauf si `PLAYER_INTERNAL_STRICT=1`.

Enfin, cette passe a trouvé un nouveau défaut reproductible : plusieurs agrégateurs utilisent des
objets JavaScript ordinaires comme dictionnaires avec des clés issues des données. Une ligne portant
`doc_id="__proto__"` fait planter `overview()` ; un `user_email="__proto__"` écrit une propriété
`opens` sur `Object.prototype` dans le processus. La garde statique ajoutée en `0.1.22` ne voit pas
ces cas.

### Note actuelle

**Note globale de 0.1.26 : 7,0/10** — contre environ **6,6/10** lors de la première
passe. La version `0.1.25`, dont le direct est cassé, ne mérite qu'environ **6,2/10** et doit
être remplacée sans attendre.

La hausse est réelle, mais volontairement contenue par le P0 Realtime encore ouvert. Le projet est
nettement mieux construit que sa seule note de sécurité ne le laisse penser : sa **qualité
d'ingénierie vaut environ 8/10**, tandis que son **durcissement pour une exposition Internet avec
des documents sensibles vaut encore environ 5,2/10**.

| Domaine | 0.1.17 | 0.1.26 | Commentaire |
|---|---:|---:|---|
| Architecture | 8,0 | **8,0** | Frontière hôte/cœur solide ; le cœur conserve des accès directs à l'environnement pour le greffon bot. |
| Qualité et maintenabilité | 7,0 | **7,3** | Beaucoup d'invariants documentés et testés ; `handler.js` atteint maintenant 3 208 lignes. |
| Tests et CI | 8,0 | **8,7** | 329 tests, Node 22/24, build reproductible, CodeQL ; toujours aucun vrai E2E navigateur/Supabase. |
| Sécurité | 4,0 | **5,2** | Le SSRF critique est fermé ; Realtime, `Host`, analytics et dictionnaires non sûrs empêchent une note supérieure. |
| Performance et résilience | 6,0 | **6,3** | Timeout du relais ajouté ; tampon intégral et appels réseau sans délai maximal subsistent. |
| Accessibilité | 5,0 | **5,0** | Peu de progrès mesurable : dialogues, noms accessibles et annonces dynamiques restent à reprendre. |
| Exploitation et livraison | 8,0 | **8,3** | OIDC, provenance, SBOM et image non-root ; actions non immuables, migrations et rétention manquantes. |

### Décision de mise en production

- **Lecture simple et serveur autonome contrôlé** : niveau satisfaisant avec supervision.
- **Présentations publiques de documents sensibles** : ne pas considérer le chemin comme durci tant
  que le P0 Realtime ci-dessous n'est pas fermé.
- **Déploiement existant** : corriger d'abord les cinq éléments du lot « barrière de sécurité » ;
  une refonte générale n'est pas requise avant eux.

## Vérifications exécutées

Les validations finales ont été rejouées sur une copie propre de `main/v0.1.26`, après `npm ci`, et non
sur le `node_modules` obsolète du répertoire de travail.

| Vérification | Résultat |
|---|---|
| `npm ci` sur le lockfile | ✅ 164 paquets installés ; `jsdom@30.0.1` attendu |
| Audit npm | ✅ 0 vulnérabilité sur 165 paquets ; aucune dépendance npm de production |
| `npm test` | ✅ 30 fichiers, **329 tests réussis** en 632 ms |
| `npm run lint` | ✅ aucune erreur |
| `npm run typecheck` | ✅ réussi |
| `npm run build` | ✅ réussi |
| Comparaison des artefacts reconstruits | ✅ `browser.generated.js`, `shared.generated.js`, `bridge.js` et types identiques |
| `npm pack --dry-run --ignore-scripts` | ✅ 18 fichiers, 159 886 octets compressés, 496 873 décompressés |
| Artefact npm `0.1.26` | ✅ publié ; `dist.integrity` identique au paquet construit pendant l'audit |
| Smoke test du serveur autonome | ✅ `/healthz`, `?contract=1` (`0.1.26`) et `/preview/sample.pdf` répondent ; aperçu HTML de 127 304 octets |
| Recherche de secrets par motifs usuels | ✅ aucun secret manifeste trouvé dans les fichiers suivis |
| Reproduction `doc_id="__proto__"` | ❌ `TypeError` dans `server/shares.js:185` |
| Reproduction `user_email="__proto__"` | ❌ `Object.prototype.opens` créé avec la valeur `NaN` |
| Docker local | ⚪ non exécuté : binaire Docker absent de l'environnement d'audit |
| Supabase/Realtime réel et navigateur multi-clients | ⚪ non exécutés : aucune instance de test ni suite E2E fournie |

Anomalie locale toujours présente : le `node_modules` du dépôt contient `jsdom@25.0.1` alors que le
lockfile demande `30.0.1`. Les résultats de référence ci-dessus viennent donc de la copie propre.

## P0 — Intégrité et disponibilité du temps réel toujours ouvertes

Références principales : `server/handler.js:414-500`, `server/handler.js:1881-1885`,
`server/handler.js:1915-1917`, `server/handler.js:2299-2303`,
`server/handler.js:3025-3052`, `server/presentations.js:295-333`.

### 1. `map` reste une commande publique appliquée directement

Le gestionnaire `map` lit toujours `p.payload`, puis l'audience appelle `Map3DD.apply(p)` sans
relecture serveur. Un participant connaissant le slug peut donc déplacer la carte ou Street View de
toute l'audience, avec des coordonnées et états qu'il choisit. Le fait que le mouvement soit
éphémère ne retire pas son impact : pendant un mode carte, **ce signal est précisément l'image que
voit l'audience**.

`typing` peut raisonnablement rester cosmétique après validation et limitation. `map` ne doit pas
partager cette exception.

### 2. Le debounce peut figer la présentation ou amplifier les requêtes

`relireEtat()` et `relireChat()` font `clearTimeout` puis repoussent la lecture de 120 ms. Un client
qui diffuse plus vite que 120 ms empêche donc indéfiniment le callback de s'exécuter. Un seul
participant peut figer les changements de page et le chat sans injecter de fausse charge utile.

À l'inverse, des événements espacés d'un peu plus de 120 ms déclenchent plusieurs lectures HTTP par
seconde **pour chaque spectateur connecté**. Le correctif transforme alors le canal public en
amplificateur de trafic vers l'API.

Il faut un ordonnanceur borné : une requête au maximum en vol, une fréquence minimale, un drapeau
`dirty` et une lecture terminale obligatoire. Une resynchronisation périodique lente doit rattraper
un signal perdu.

### 3. La diffusion précède encore la persistance

`pushPage`, `endPresent` et `presentContent` diffusent avant que l'écriture HTTP ait réussi. Le
commentaire affirme l'inverse. L'audience attend 120 ms puis peut relire l'ancien état si la base
n'est pas encore à jour ; aucun second signal n'est garanti. `endPresent` coupe en plus le canal
avant d'envoyer le beacon de fin.

L'ordre attendu est : écriture autorisée réussie, puis invalidation. Une émission serveur seule ne
rend pas un canal public authentique, mais elle règle bien cette causalité quand le client relit la
source de vérité.

### 4. Le `presenter_key` de 0.1.25 ne prouve pas le présentateur

`state=1` renvoie publiquement `presenter_key`. La présence contient `uid: attKey(me)`, mais `uid` est
composé par le client. Un attaquant peut donc :

1. lire `presenter_key` ;
2. rejoindre le canal public avec sa propre connexion ;
3. publier une présence portant ce même `uid` et le nom/avatar de son choix ;
4. satisfaire la comparaison `m.uid === PRESKEY` utilisée pour afficher le badge.

Il existe aussi une attaque sans WebSocket : envoyer `present-attend` avec le `key` public du
présentateur et sans contrôle valide. `recordAttendance()` retrouve la ligne puis la met à jour avec
`is_presenter: false`. Le badge disparaît jusqu'au prochain heartbeat légitime.

Comparer deux valeurs choisies ou connues du client n'est pas une preuve. Solutions possibles :

- à très court terme, ne pas attribuer le badge dans la liste de présence et afficher séparément
  l'identité du présentateur issue de l'état serveur ;
- mieux, émettre un ticket de participant signé, non réutilisable pour un autre rôle, et lier chaque
  écriture d'assistance à ce ticket ;
- cible robuste : canal privé avec JWT courts contenant des droits distincts audience/présentateur,
  plus RLS sur `realtime.messages`.

Le fichier de suivi affirme qu'un canal privé ne changerait rien parce que le participant possède le
lien. C'est vrai **si tous les participants reçoivent les mêmes droits**, mais incomplet : Supabase
permet justement aux politiques RLS de contrôler séparément la réception, l'émission Broadcast et
la présence. Un visiteur peut recevoir sans avoir le droit d'émettre `map`; seul un JWT prouvant le
présentateur obtient l'écriture. Voir la documentation officielle
[Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization) et
[Realtime Concepts](https://supabase.com/docs/guides/realtime/concepts).

### Correction P0 recommandée

1. supprimer l'application directe de `map` ; persister/coalescer la position autorisée, puis
   diffuser une invalidation ;
2. remplacer le debounce par un ordonnanceur borné et ajouter un polling de sécurité ;
3. diffuser seulement après écriture réussie ;
4. retirer immédiatement le badge fondé sur un `uid` client, puis introduire un ticket signé ou les
   JWT/RLS privés ;
5. tester avec deux vrais clients Supabase : présentateur, audience légitime et audience hostile.

## P1 — Corrections annoncées mais incomplètes

### P1-1 — Le header `Host` reste utilisé par défaut

Références : `server/handler.js:2859-2874`, `context/standalone.js:425-432`,
`server/__tests__/originePublique.test.js`.

`PLAYER_PUBLIC_URL` gagne bien quand il est configuré. En revanche, s'il manque, le serveur journalise
une alerte puis construit quand même le lien avec ``https://${req.headers.host}`` et envoie l'email.
Le test encode explicitement ce repli.

Une alerte ne bloque pas un email d'hameçonnage. La fermeture correcte est un refus d'envoi
(`sendRefused: "public-url-unconfigured"`) tout en conservant le lien créé. Si la compatibilité exige
un repli, il faut au minimum une allowlist d'hôtes configurée ; le header brut ne doit jamais choisir
une URL envoyée hors de l'application.

État réel : **partiel**, pas « fait ».

### P1-2 — Dictionnaires à prototype avec clés issues des données

Références : `server/shares.js:126-202`, `server/shares.js:245-247`,
`server/shares.js:346-360`, `server/presentations.js:347-352`, `src/live.ts:106-119`,
`server/__tests__/proprieteEcrite.test.js:66-103`.

Les agrégateurs `byDoc`, `intByDoc`, `byUser`, `sessMax`, `nameBySlug`, `msgByKey` et plusieurs
dictionnaires navigateur sont créés avec `{}` puis indexés par des identifiants, emails, noms ou
sessions. Les clés héritées (`__proto__`, `constructor`, `toString`…) ont alors une sémantique
spéciale.

Reproductions isolées :

- une vue ayant `doc_id="__proto__"` fait planter `overview()` avec
  `Cannot read properties of undefined (reading 'add')` ;
- une session interne ayant `user_email="__proto__"` modifie `Object.prototype.opens` dans le
  processus et produit des statistiques incohérentes.

Le second cas est atteignable durablement parce que les sessions internes non signées sont encore
acceptées par défaut. La garde statique de `proprieteEcrite.test.js` manque le défaut : elle ne
considère qu'une petite liste de noms de variables et exclut notamment `k`, `id` et `sid`.

Correction : utiliser `Map` ou `Object.create(null)` pour **tous** les dictionnaires, puis ajouter des
tests comportementaux avec les cinq clés héritées. Une expression régulière sur les noms de
variables ne peut servir que d'alarme complémentaire.

### P1-3 — L'authenticité des analytics reste optionnelle

Références : `server/handler.js:2884-2945`, `server/shares.js:218-241`,
`server/shares.js:300-344`, `context/standalone.js:333-364`.

`PLAYER_INTERNAL_STRICT=1` et le jeton HMAC sont une bonne transition. Le comportement par défaut
reste cependant l'acceptation d'une identité interne, d'un email et d'un `docId` fournis par le
navigateur. La route renvoie 200 après avoir seulement limité l'IP à 120 écritures/heure.

Le chemin externe n'a pas de limite dédiée, accepte des noms d'événements libres et ne borne pas
les nombres ni `pagesTime` comme le chemin interne. Les statistiques restent donc falsifiables et
peuvent faire croître la base.

Correction : rendre le mode strict par défaut dans la prochaine version, prévoir une fenêtre de
migration explicite, dédier un secret de signature aux analytics, fermer le schéma des événements,
borner tous les nombres/objets et limiter aussi le chemin externe.

### P1-4 — Les identités du chat restent auto-déclarées

Références : `server/handler.js:2634-2653`, `server/presentations.js:185-208`,
`server/presentations.js:211-213`.

`isPresenter` est maintenant dérivé du contrôle et `isMember` du JWT : c'est un vrai progrès. Mais
`name`, `email` et `avatar` viennent toujours du corps, même quand un JWT valide existe. Un détenteur
du slug peut publier un message visuellement attribué à une autre personne ; un membre authentifié
peut recevoir le badge membre tout en choisissant l'email d'un collègue.

Les emails des auteurs sont ensuite renvoyés à toute l'audience alors que l'interface du message ne
les affiche pas. Un identifiant d'auteur opaque suffirait pour la propriété/réaction et réduirait la
collecte de données personnelles.

Correction : pour un membre, dériver nom/email/avatar du JWT ou de l'hôte ; pour un visiteur,
émettre un ticket de participation signé et un identifiant opaque. Ne publier l'email que si la
fonctionnalité l'exige et que l'utilisateur en est informé.

### P1-5 — Upload et assistance publics restent des surfaces d'abus

Références : `server/handler.js:2585-2610`, `server/handler.js:2655-2666`,
`server/presentations.js:128-155`, `server/presentations.js:301-328`.

Avec un slug existant, un client peut demander 30 URLs d'upload signées par heure/IP, y compris pour
une présentation terminée, et créer/mettre à jour jusqu'à 1 000 lignes d'assistance par heure/IP.
La limite en mémoire est par processus et le bucket doit être configuré hors du schéma fourni pour
imposer réellement type et taille.

Le ticket de participant proposé ci-dessus doit aussi autoriser ces deux opérations. Vérifier que la
présentation est active, réduire les plafonds, limiter globalement côté stockage et documenter les
politiques du bucket.

### P1-6 — Relais de fichier et appels réseau

Références : `server/handler.js:1253-1279`, `context/storage.js:250-279`,
`context/standalone.js:46-68`, `context/standalone.js:181-199`,
`context/standalone.js:261-282`, `server/handler.js:2492-2512`.

Le timeout du téléchargement est bien présent et les redirections sont correctement revalidées.
Mais `relayerFichier` transforme encore tout le corps en `ArrayBuffer`, puis en `Buffer`, avant de
répondre. Plusieurs gros lecteurs simultanés peuvent épuiser la mémoire.

Les appels PostgREST, `signUpload`, `verifyToken` et les appels ElevenLabs n'ont pas tous de délai
maximal. Un amont lent peut conserver une requête serveur ouverte indéfiniment.

Correction : streaming avec backpressure et annulation lors de la déconnexion, taille maximale
configurable, timeouts distincts base/auth/stockage/IA, et tests de fichier volumineux/amont lent.

### P1-7 — Idempotence non atomique et intégrité SQL

Références : `server/handler.js:2736-2759`, `server/handler.js:2791-2802`,
`supabase/init.sql:29-209`.

Les liens de l'hôte et de répétition restent créés par `SELECT`, puis `INSERT`, sans index unique
correspondant. Deux appels concurrents peuvent créer deux lignes. Le schéma ne porte aucune clé
étrangère vers les slugs parents/présentations, peu de contraintes de domaine, et aucune cascade.

Correction : index uniques partiels, upsert atomique, clés étrangères/cascades progressives,
`CHECK` sur événements, pages, durées et types, avec une vraie migration pour les bases existantes.

### P1-8 — Rétention et droits sur les données

Les emails, IP, User-Agent, temps par page, présences et messages n'ont ni politique de rétention,
ni purge, ni voie d'export/effacement. La fenêtre de 24 mois de `overview()` réduit un scan ; elle ne
supprime aucune donnée.

Il faut une décision produit/juridique sur les durées, puis un job technique idempotent, des
cascades, une exportation et une suppression par personne/document/présentation. Cette partie ne
peut pas être déclarée faite uniquement dans le code.

## P2 — Qualité, chaîne de livraison et maintenabilité

### Autorisations trop larges

`present-stats` et `present-doc-list` exigent un JWT, mais pas la propriété de la présentation ni un
rôle administratif. Ils exposent notamment des emails d'assistance. La règle doit être alignée sur
`switchPresentationDoc` et `setPresentationContent` : propriétaire ou administrateur, sauf décision
produit explicite contraire.

### Tests encore trop proches du source

La suite unitaire est rapide et utile, mais plusieurs garde-fous cherchent des chaînes dans
`handler.js`. Ils peuvent confirmer un commentaire ou une forme et manquer la propriété réelle — la
garde des écritures indexées en est un exemple concret.

`v0.1.25` fournit une seconde preuve : lint, types, build et tests étaient verts, mais une insertion
avait produit `return var h2=…` dans le script inline de la page audience. Le test qui exécutait la
page avalait la `SyntaxError` dans un `catch` prévu pour les dépendances navigateur absentes.
`0.1.26` sépare maintenant compilation et exécution avec `new vm.Script`, ce qui ferme cette
régression précise. Un vrai navigateur reste nécessaire pour les erreurs de câblage, de DOM,
de CSP et de transport que la simple analyse syntaxique ne voit pas.

Manquent toujours :

- E2E Playwright/Chromium avec deux ou trois pages ;
- projet Supabase de test avec RLS, Broadcast et Presence réels ;
- tests de charge du relais et des routes publiques ;
- seuils de couverture et mutations automatisées sur les invariants critiques ;
- contrôle automatique d'accessibilité.

### Dépendances navigateur hors lockfile

PDF.js `3.11.174`, Supabase `@2`, Leaflet `1.9.4` et Google Maps `v=weekly` sont chargés par CDN. Le
tag `@2` et `weekly` ne sont pas des versions immuables, aucun SRI n'est posé, et le lockfile npm ne
décrit pas ce qui s'exécute réellement dans le navigateur.

PDF.js `3.11.174` reste dans la plage de CVE-2024-4367 ; `isEvalSupported: false` est un workaround
officiel et il est bien présent sur les trois appels, mais la dépendance reste obsolète. L'avis
Mozilla indique `4.2.67` comme version corrigée :
[GHSA-wgrm-67xf-hhpq](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq).

Le fait que PDF.js 4+ soit ESM sur cdnjs n'est pas un blocage de sécurité : c'est une migration de
build. La documentation officielle recommande aussi `pdfjs-dist` via npm et un worker bundlé :
[Setup PDF.js](https://github.com/mozilla/pdf.js/wiki/Setup-pdf.js-in-a-website).

### GitHub Actions non immuables

Tous les workflows utilisent des tags (`@v7`, `@v3`, etc.). Le risque est maximal dans le workflow
CLA, déclenché en `pull_request_target` avec `contents: write`, et dans la publication. GitHub indique
qu'un SHA complet est la seule référence d'action immuable :
[Secure use reference](https://docs.github.com/en/actions/reference/security/secure-use).

Épingler les SHA vérifiés, activer la politique de dépôt correspondante et laisser Dependabot
proposer les mises à jour.

### Monolithe et types

`server/handler.js` est passé de 2 988 à **3 208 lignes**. Il mélange routage, autorisation, HTML,
CSS, JavaScript navigateur, appels IA et logique de présentation ; le serveur critique reste hors du
contrôle TypeScript. Les nombreux commentaires sont précieux, mais ils ne compensent pas la taille
de l'unité de changement.

Découpage progressif recommandé : routes/actions, templates, transport Realtime, relais de fichiers,
bot, puis contrats de validation. Ne pas lancer cette refonte avant le lot P0/P1.

### Accessibilité

Les modales sont surtout des `div` sans `role="dialog"`, `aria-modal`, piège/restauration du focus ni
fermeture clavier cohérente. Plusieurs boutons à icône n'ont qu'un `title`, des champs ont un label
visuel non lié par `for`, et les changements de page, chargement, chat et fin de présentation ne sont
pas annoncés par une région `aria-live`. La préférence de mouvement réduit couvre une partie des
animations, pas toutes les interactions.

Prévoir un audit clavier + lecteur d'écran, puis automatiser axe sur les parcours principaux.

### Documentation et schéma en dérive

`supabase/init.sql:230-241` affirme encore que le chat n'est pas sur Broadcast et qu'il passe par
`postgres_changes`, alors que le code dit l'inverse. Le fichier publie toujours la table messages
malgré l'absence d'abonnement correspondant. Le suivi annonce également `Host`, analytics internes
et titre du présentateur comme clos alors que les chemins décrits plus haut subsistent.

La règle du suivi (« vérifier l'artefact ou muter ») est excellente ; elle doit être appliquée aux
propriétés de sécurité, pas seulement à la présence d'une chaîne ou d'un commit.

## État des constats de la première passe

| Constat initial | État vérifié en 0.1.26 |
|---|---|
| P0 SSRF/redirections + fuite du secret | ✅ fermé et bien testé |
| P0 Realtime public autoritatif | 🟠 payload `state/chat` neutralisé, mais `map`, famine/amplification, ordre et badge restent ouverts |
| P1 lien d'email fondé sur `Host` | 🟠 configuré correctement, vulnérable par défaut |
| P1 analytics et statuts déclaratifs | 🟠 membres/présentateur améliorés ; analytics strict encore optionnel et identités libres |
| P1 PDF.js vulnérable | 🟠 workaround correct, version toujours affectée/obsolète |
| P1 fichiers tamponnés et sans timeout | 🟠 timeout du stockage fait, tampon et autres appels restent |
| P1 idempotence non atomique | ❌ ouvert |
| P1 rate-limit/X-Forwarded-For | ✅ fermé par proxy explicitement déclaré |
| P1 rétention des données | ❌ ouvert |
| P2 portée des statistiques | ❌ ouvert |
| P2 monolithe non typé | ❌ ouvert, taille accrue |
| P2 absence d'E2E/Supabase/coverage | 🟠 davantage d'unitaires, lacune structurante intacte |
| P2 dépendances navigateur/CDN | ❌ ouvert |
| P2 Actions sur tags | ❌ ouvert |
| P2 migrations | ❌ ouvert |
| P2 accessibilité | ❌ ouvert |
| P2 contraintes SQL | ❌ ouvert |
| P3 jetons issus de `Math.random` | 🟠 crypto utilisé normalement ; repli faible encore présent sans Web Crypto |
| P3 `postMessage` sans vérification de source | 🟠 fermé côté player ; vérification côté hôte toujours optionnelle pour compatibilité |
| P3 `allow_download` présenté comme protection | ✅ documentation clarifiée |
| P3 commentaires SQL obsolètes | ❌ ouvert |

## Ce qui est solidement acquis

Il ne faut pas perdre les progrès suivants lors des prochains correctifs :

- redirections revalidées saut par saut, secret recalculé, protocole et nombre de sauts bornés ;
- lecture locale par descripteur après contrôle de chemin ;
- CSP à nonce, `nosniff`, types exécutables forcés en téléchargement ;
- RLS fermé par défaut sur les tables métier ;
- projection publique des messages excluant `author_hash` ;
- validation du `control_token` pour les actions de pilotage et de modération ;
- IP issue de la socket par défaut, proxy explicitement déclaré ;
- OIDC npm, provenance, SBOM, image non-root, healthcheck ;
- paquet minimal, build reproductible, tests rapides sur Node 22 et 24 ;
- documentation technique exceptionnellement riche sur les intentions et incidents.

## Plan priorisé et estimation

Hypothèses : un développeur connaissant déjà le projet, un jour-homme de 7 heures, estimation
incluant code, tests et revue mais excluant les délais de décision juridique, de validation métier et
de déploiement progressif chez les hôtes.

### Lot 1 — Barrière de sécurité avant nouvelle exposition sensible

| Travail | Estimation |
|---|---:|
| Realtime borné : supprimer `map` direct, ordonnanceur anti-famine, ordre écriture→signal, polling de sécurité | 2,5–4 j |
| Identité de participant/présentateur : retirer la comparaison de clé publique, ticket signé ou JWT/RLS | 2–3,5 j |
| Refus d'email sans URL publique + tests de non-envoi | 0,25–0,5 j |
| Remplacer tous les dictionnaires risqués + tests comportementaux/mutation | 0,75–1,5 j |
| Analytics strict par défaut, bornes, allowlist d'événements et rate-limit externe | 1,5–2,5 j |
| E2E hostile minimal à deux/trois clients | 1–2 j |
| **Total lot 1** | **8–13 j** |

Résultat attendu : **7,8 à 8,2/10**, avec disparition du blocage P0.

### Lot 2 — Résilience et intégrité des données

| Travail | Estimation |
|---|---:|
| Streaming/backpressure, limites de taille et timeouts réseau complets | 2–4 j |
| Index uniques partiels, upserts, contraintes et première vraie migration | 2–4 j |
| Portée propriétaire/admin des statistiques et identité du chat liée au ticket/JWT | 1,5–3 j |
| PDF.js + dépendances navigateur embarquées et versionnées | 2–4 j |
| Projet Supabase de test et scénarios RLS/Realtime en CI | 3–5 j |
| Actions GitHub sur SHA + nettoyage des commentaires/surface Realtime SQL | 0,5–1 j |
| **Total lot 2** | **11–21 j** |

Résultat cumulé attendu : **8,4 à 8,7/10** après **19–34 jours-homme**.

### Lot 3 — Maturité produit

| Travail | Estimation |
|---|---:|
| Rétention, purge, export/effacement et cascades | 2–5 j après décision métier/juridique |
| Audit accessibilité + corrections des parcours principaux | 3–6 j |
| Tests de charge, observabilité et budgets de performance | 2–4 j |
| Découpage progressif du monolithe et typage des routes critiques | 5–10 j |
| Pentest externe et correction de ses écarts | 3–6 j |

Résultat cumulé réaliste : **8,8 à 9,1/10** après environ **30–50 jours-homme**. Une note supérieure
à 9 ne doit pas venir d'une nouvelle lecture statique seule : elle demande au moins une instance
Supabase réelle, des navigateurs concurrents, de la charge, un audit accessibilité et un regard
indépendant.

## Priorité immédiate

Si une seule semaine est disponible, faire dans cet ordre :

1. retirer `map` de la liste des charges utiles crues et retirer le badge fondé sur
   `presenter_key` ;
2. rendre les relectures non affamables et diffuser après persistance ;
3. refuser l'envoi d'email sans `PLAYER_PUBLIC_URL` ;
4. remplacer les dictionnaires à prototype et ajouter les tests `__proto__`/`constructor` ;
5. activer l'analytics signé par défaut et limiter le chemin externe.

Ce lot apporte plus de sécurité que la migration PDF.js, le découpage du monolithe ou l'ajout de
tests unitaires supplémentaires. Ces trois chantiers restent utiles, mais ne ferment pas les chemins
exploitables aujourd'hui.

## Conclusion

La trajectoire est bonne : la première passe n'a pas seulement produit des correctifs, elle a aussi
amélioré la discipline de preuve, la chaîne de livraison et la quantité de tests. Le projet mérite
**7,0/10 sur 0.1.26** et peut raisonnablement viser **8,2/10 à la prochaine passe** si celle-ci se
concentre sur les propriétés de sécurité observables plutôt que sur les statuts du suivi.

Le point le plus important de cette seconde passe est méthodologique : une valeur venant du serveur
n'est pas automatiquement une preuve si le client peut choisir la valeur à laquelle elle sera
comparée ; un signal relu n'est pas robuste si l'attaquant peut empêcher la relecture d'arriver ; et
une alerte n'est pas une interdiction. Les prochains tests doivent exercer ces propriétés de bout en
bout.
