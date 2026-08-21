> ⚠️ **Document HISTORIQUE — premier audit externe, état au 14/08/2026 (version `0.1.17`).**
> Rien ici ne décrit l'état courant. Chaque constat a été suivi un à un dans
> [`AUDIT-2026-08-14-SUIVI.md`](AUDIT-2026-08-14-SUIVI.md), une seconde passe a eu lieu le
> lendemain ([`AUDIT-2026-08-15-SECONDE-PASSE.md`](AUDIT-2026-08-15-SECONDE-PASSE.md)), et les
> passes suivantes sont tracées version par version dans le [CHANGELOG](../CHANGELOG.md).
> Le rapport reste tel qu'il a été reçu : un audit qu'on réécrit après coup n'est plus une trace.

# Audit technique complet — Discovery Media Player

Date : 14 août 2026  
Version auditée : `0.1.17` (`e737d62`, tag `v0.1.17`)  
Périmètre : dépôt applicatif, cœur navigateur, serveur, contexte autonome, schéma Supabase, packaging, CI/CD, conteneur, documentation et dépendances.

## Synthèse exécutive

Le projet possède une base d’ingénierie nettement supérieure à la moyenne d’un jeune projet open source : architecture par contexte injecté, refus par défaut sur plusieurs frontières, très bonne documentation des décisions, 236 tests rapides, CI sur Node 22 et 24, CodeQL, image non-root, build reproductible et paquet npm minimal sans dépendance de production.

Il ne devrait toutefois pas être considéré comme suffisamment durci pour une exposition Internet non supervisée avant correction de deux vulnérabilités critiques :

1. le proxy de fichiers suit les redirections après n’avoir validé que l’URL initiale ; une redirection peut atteindre le réseau interne et transmet actuellement le secret `x-player-fetch-secret` à la nouvelle destination ;
2. le canal Supabase Realtime est public et traite des événements émis par les clients comme des états autoritatifs ; tout participant connaissant le slug peut perturber une présentation, falsifier le chat ou se faire passer pour le présentateur sans `control_token`.

Appréciation globale : **fondations solides, risque de sécurité actuel élevé**. La priorité n’est pas une refonte générale : elle consiste à fermer les deux chemins P0, puis à fiabiliser les écritures publiques, le relais de fichiers et la chaîne de dépendances navigateur.

| Domaine | Appréciation | Commentaire |
|---|---:|---|
| Architecture | 8/10 | Frontière hôte/cœur claire et testée ; route principale beaucoup trop concentrée. |
| Qualité et maintenabilité | 7/10 | Code intentionnel et documenté ; serveur critique non typé, grand template monolithique. |
| Tests et CI | 8/10 | 236 tests, lint/typecheck/build propres ; pas d’E2E navigateur, de couverture ni de test Realtime réel. |
| Sécurité | 4/10 | Bons mécanismes locaux, mais deux contournements critiques des invariants annoncés. |
| Performance et résilience | 6/10 | Chargement progressif prévu ; fichiers entièrement tamponnés et appels réseau sans délai maximal. |
| Accessibilité | 5/10 | Bases correctes, mais dialogues/formulaires et annonces dynamiques non conformes. |
| Exploitation et livraison | 8/10 | CI, CodeQL, Docker non-root, SBOM/provenance ; migrations et rétention à compléter. |

## Résultats des vérifications

| Vérification | Résultat |
|---|---|
| `npm test` | ✅ 21 fichiers, 236 tests réussis en 616 ms |
| `npm run lint` | ✅ aucune erreur ni alerte affichée |
| `npm run typecheck` | ✅ réussi |
| `npm run build` dans une copie temporaire | ✅ réussi ; les trois artefacts générés sont identiques aux fichiers committés |
| `npm audit --json` (registre consulté le 14/08/2026) | ✅ 0 vulnérabilité sur 239 dépendances de développement ; aucune dépendance npm de production |
| `npm pack --dry-run --ignore-scripts` | ✅ 18 fichiers, 147 932 octets compressés, aucun test ni TypeScript brut publié |
| Taille d’une page d’aperçu générée sans greffon | 120 896 octets HTML, 37 656 octets gzip |
| État Git avant/après audit | ✅ aucun fichier applicatif modifié par les validations |

Anomalie locale : `node_modules` contient `jsdom@25.0.1` alors que `package.json` et `package-lock.json` demandent `30.0.1`. Les tests passent malgré cet arbre obsolète, mais un `npm ci` est requis pour retrouver exactement l’environnement de CI.

## Constats prioritaires

### P0 — Le proxy suit les redirections et divulgue le secret de l’hôte

Références : `context/storage.js:221-229`, `README.md:157-162`.

`isAllowedStorageUrl` valide uniquement l’URL fournie au départ. `fetchAllowedFile` appelle ensuite `fetch(url, { headers })` sans `redirect: "manual"`. Or `fetch` suit les redirections par défaut. La destination finale n’est donc soumise ni à la liste d’origines, ni au préfixe de route, ni au contrôle `https:`.

Pour une URL de `PLAYER_HOST_FETCH_BASE`, le même appel ajoute `x-player-fetch-secret`. Un test local avec Node 24 a confirmé le comportement inter-origines : la réponse indiquait `redirected: true` et le second serveur recevait le secret synthétique transmis au premier.

Impact :

- SSRF vers `localhost`, une adresse privée, link-local ou une API de métadonnées cloud ;
- exfiltration de `PLAYER_HOST_FETCH_SECRET` vers une destination contrôlée ;
- contradiction directe avec l’invariant documenté « no redirect following into your private network ».

Correction recommandée :

1. mettre `redirect: "manual"` et refuser toute réponse `3xx` par défaut ;
2. si les redirections deviennent réellement nécessaires, les suivre manuellement avec revalidation complète de chaque saut et suppression du secret dès que l’origine ou le préfixe diffère ;
3. ajouter `AbortSignal.timeout`, une limite de sauts et des tests couvrant redirection même origine, autre origine, adresse privée et fuite d’en-tête ;
4. envisager aussi une résolution DNS suivie d’un refus des plages privées/link-local pour les sources réseau extensibles.

### P0 — Un participant peut prendre le contrôle visuel d’une présentation Realtime

Références : `server/handler.js:220-244`, `server/handler.js:397-408`, `src/presentation-state.ts:44-80`, `supabase/init.sql:225-254`.

Le navigateur reçoit la clé Supabase publiable, rejoint `plive-<slug>` sans `{ private: true }`, puis accepte directement les broadcasts `state`, `map`, `lock`, `msg` et `msg-upd`. Le même objet `channel` est exposé à tous les participants et permet aussi d’émettre. La validation de forme de `presentationTransition` ne prouve pas l’identité de l’émetteur : un faux événement valide reste un faux événement.

Un participant peut notamment diffuser :

- `{ active: false }` pour faire croire que la présentation est terminée ;
- une autre page ou une carte valide pour détourner l’audience ;
- un verrou de chat, un faux message ou une fausse mise à jour ;
- une présence portant `role: "presenter"`.

La documentation Supabase confirme que, sur un canal public, tout utilisateur peut envoyer et recevoir ; l’autorisation émission/réception exige un canal privé et des politiques RLS sur `realtime.messages` : [Realtime Authorization](https://supabase.com/docs/guides/realtime/authorization), [Broadcast](https://supabase.com/docs/guides/realtime/broadcast).

Correction recommandée :

1. ne plus diffuser l’état autoritatif depuis un client anonyme ;
2. faire produire le broadcast par le serveur, seulement après validation du `control_token`, ou utiliser un canal privé avec JWT courts et politiques distinctes : audience en lecture, présentateur en écriture ;
3. conserver la route `state=1` comme source de vérité/reconnexion ;
4. n’afficher un message ou une mutation reçue qu’après écriture serveur réussie, avec un événement émis côté serveur ;
5. ajouter un test d’intégration où deux clients rejoignent le même canal et où l’audience tente chaque événement privilégié.

### P1 — Les emails de re-partage font confiance au header `Host`

Références : `server/handler.js:2676-2704`, `server/shares.js:243-278`.

Le lien inséré dans un email est construit avec ``https://${req.headers.host}``. Sur le serveur autonome, et sur tout proxy qui ne réécrit pas strictement `Host`, ce champ est contrôlé par le client. Le lecteur d’un lien nominatif peut donc demander un email légitime, signé par l’hôte, dont le bouton pointe vers un domaine malveillant.

Correction : ajouter `PLAYER_PUBLIC_URL` (URL absolue HTTPS normalisée) et ne jamais construire une URL externe depuis un header non approuvé. À défaut, valider `Host` contre une liste fermée et ne faire confiance aux headers `Forwarded`/`X-Forwarded-*` que derrière un proxy déclaré.

### P1 — Les écritures d’analytics font confiance aux affirmations du client

Références : `server/handler.js:2451-2462`, `server/handler.js:2486-2501`, `server/handler.js:2712-2728`, `server/presentations.js:268-286`.

Plusieurs données présentées ensuite comme fiables sont entièrement choisies par le navigateur :

- une requête publique `{ internal: true, event: "session" }` peut écrire n’importe quels `docId`, email et nom, sans JWT ni rate-limit ;
- `present-attend` accepte `isMember` et `isPresenter` sans vérifier jeton ou contrôle ;
- `present-chat` recalcule correctement `isPresenter`, mais conserve `isMember` fourni par le client ;
- les événements `open/page/heartbeat/session` n’ont pas de liste blanche stricte, de bornes métier robustes ni de limite de débit dédiée.

Impact : pollution des statistiques internes et commerciales, usurpation de statut, croissance de base et perte de confiance dans la fonctionnalité centrale du produit.

Correction : dériver l’identité interne du JWT vérifié ; émettre un jeton de session signé pour les visiteurs ; dériver le statut présentateur du `control_token` ; valider les événements par schéma fermé ; borner pages, temps et objets JSON ; appliquer des limites de débit non contournables.

### P1 — PDF.js 3.11.174 est une version affectée par CVE-2024-4367

Références : `server/handler.js:52`, `server/handler.js:1663`, `server/handler.js:1886`, `server/handler.js:2081-2113`.

La version chargée depuis cdnjs est dans la plage vulnérable `<= 4.1.392`. L’avis officiel décrit une exécution JavaScript lors de l’ouverture d’un PDF malveillant quand `isEvalSupported` reste à sa valeur par défaut, et recommande `4.2.67` ou `isEvalSupported: false` : [avis Mozilla/GitHub GHSA-wgrm-67xf-hhpq](https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq).

La CSP actuelle n’autorise pas explicitement `unsafe-eval`, ce qui réduit probablement l’exploitabilité sur les pages servies aujourd’hui. Cette mitigation reste implicite et fragile : aucun appel à `getDocument` ne force `isEvalSupported: false`, et une modification future de CSP peut réactiver le chemin.

Correction : mettre à niveau PDF.js vers une version corrigée et maintenue, forcer `isEvalSupported: false` en défense en profondeur, puis ajouter un PDF de non-régression. Idéalement, embarquer PDF.js dans le paquet au lieu de l’exécuter depuis un CDN.

### P1 — Les fichiers sont entièrement tamponnés en mémoire, sans délai maximal

Références : `context/storage.js:144-173`, `context/storage.js:221-229`, `server/handler.js:1119-1145`, `context/standalone.js:46-68`.

Le relais appelle `await r.arrayBuffer()` puis crée un `Buffer` complet avant d’écrire la réponse. Le lecteur local alloue lui aussi tout le segment, avec une copie supplémentaire au relais. Une requête sans `Range` sur un document volumineux consomme donc la taille complète du fichier par requête, potentiellement multipliée par deux et par le nombre de lecteurs concurrents.

Les téléchargements de fichiers et les appels PostgREST n’ont par ailleurs aucun `AbortSignal.timeout`. Un amont lent peut immobiliser une requête et des ressources serveur indéfiniment.

Correction : relayer en flux avec backpressure (`Readable.fromWeb`/`pipeline`), imposer une taille maximale configurable, conserver les en-têtes de plage validés et ajouter des timeouts distincts pour stockage et base. Tester un fichier volumineux, une réponse lente et une déconnexion client.

### P1 — L’idempotence des liens hôte et de test n’est pas atomique

Références : `server/handler.js:2585-2608`, `server/handler.js:2640-2651`, `supabase/init.sql:35-58`.

Le chemin serveur à serveur annonce « un lien par `docId` », mais réalise un `SELECT` suivi d’un `INSERT` sans contrainte unique. Deux appels simultanés peuvent tous deux ne rien trouver puis créer deux liens. Le même défaut existe pour `is_test=true`.

Correction : créer des index uniques partiels correspondant aux deux invariants, puis utiliser un upsert atomique. Ajouter un test concurrent, pas seulement séquentiel.

### P1 — Les limites de débit sont contournables par `X-Forwarded-For`

Références : `server/handler.js:2274`, `server/handler.js:2302`, `server/handler.js:2457`, `server/handler.js:2493`, `server/handler.js:2510`, `server/handler.js:2532`, `server/handler.js:2668`, `context/standalone.js:117-137`.

Le code prend toujours la première valeur de `x-forwarded-for`. Un client qui atteint directement le serveur autonome peut fournir une nouvelle valeur à chaque requête et contourner toutes les limites. Le caractère « par processus » est documenté ; la confiance dans un header non authentifié ne l’est pas.

Correction : déplacer la résolution d’IP dans le contexte hôte avec une configuration explicite des proxies de confiance ; sans proxy déclaré, utiliser uniquement `socket.remoteAddress`. Pour la production multi-instance, brancher un compteur partagé.

### P1 — Aucune politique de rétention ou d’effacement des données personnelles

Références : `supabase/init.sql:61-210`, `server/shares.js:158-200`, `server/shares.js:229-239`.

Emails, noms, IP, User-Agent, temps de lecture, messages et présences sont stockés sans expiration, suppression en cascade ou API d’effacement. La fenêtre de 24 mois de `overview()` limite une lecture, pas la conservation. La CNIL rappelle qu’une durée doit être définie selon la finalité et qu’au-delà les données doivent être supprimées, anonymisées ou archivées : [durées de conservation](https://www.cnil.fr/fr/passer-laction/les-durees-de-conservation-des-donnees).

Correction : faire valider les durées par le responsable de traitement/DPO, les documenter, ajouter un job de purge/anonymisation, des suppressions en cascade ou procédures explicites, et une voie d’export/effacement. Ce constat est technique et ne constitue pas un avis juridique.

## Constats importants mais non bloquants

### P2 — Autorisation des statistiques de présentation trop large

Références : `server/handler.js:2464-2484`, `server/presentations.js:289-315`, `server/presentations.js:347-362`.

`present-stats` et `present-doc-list` exigent un JWT valide, mais ne vérifient ni propriétaire, ni administrateur, ni permission déléguée à l’hôte. `present-stats` retourne notamment les emails des participants. Si tous les membres d’un même tenant sont volontairement égaux, ce choix doit être explicite ; sinon il s’agit d’une fuite latérale.

Recommandation : introduire `identity.canManagePresentations(user, action, resource)` ou réutiliser une politique hôte capable de renvoyer un périmètre, puis tester propriétaire, collègue et administrateur.

### P2 — Le cœur serveur critique n’est ni typé ni suffisamment découpé

Références : `server/handler.js` (2 988 lignes, environ 279 Ko), `tsconfig.json:16-17`.

`tsconfig` ne couvre que `src/`. La route principale mélange dispatch HTTP, HTML, CSS et JavaScript navigateur dans de grands templates. Cela rend les revues de sécurité difficiles, explique les commentaires contradictoires et laisse la majorité du comportement navigateur hors de la couverture TypeScript.

Recommandation progressive :

1. extraire le routeur et un handler par domaine (`files`, `tracking`, `presentations`, `shares`) ;
2. déplacer `LIVE_JS`, `MAP_JS` et les vues dans des modules construits ;
3. migrer le serveur vers TypeScript ou activer `checkJs` avec des types de contexte ;
4. conserver la surface `(req, res)` et l’injection actuelle, qui sont de bons contrats.

### P2 — Les tests ne couvrent pas les frontières réelles les plus risquées

La suite est excellente pour les régressions unitaires et les décisions métier, mais il manque :

- un navigateur réel ouvrant PDF, image, iframe et présentation ;
- un Supabase de test pour Realtime public/privé et RLS ;
- des tests d’adversaire sur redirections, headers, concurrence et écritures anonymes ;
- une mesure de couverture avec seuil ;
- des tests d’accessibilité automatisés.

Les deux P0 traversent précisément des frontières que les mocks actuels ne simulent pas. Ajouter peu de tests d’intégration ciblés apportera davantage qu’une hausse artificielle du nombre de tests unitaires.

### P2 — Dépendances navigateur hors du lockfile et sans intégrité

Références : `server/handler.js:52-53`, `server/handler.js:452-457`, `server/handler.js:1663-1665`, `server/handler.js:2081-2082`.

PDF.js et Leaflet sont versionnés dans l’URL mais sans SRI ; Supabase JS est demandé avec le tag mouvant `@2`; Google Maps utilise `v=weekly`. Ces composants ne sont ni vus par `npm audit`, ni figés par `package-lock.json`. Ils ajoutent aussi une dépendance de disponibilité et des connexions tierces à un produit présenté comme auto-hébergé.

Recommandation : empaqueter les bibliothèques indispensables, figer les versions exactes et documenter clairement les appels tiers optionnels. À défaut, ajouter SRI + `crossorigin` aux ressources statiques qui le permettent.

### P2 — Actions GitHub privilégiées référencées par tags mutables

Références : `.github/workflows/cla.yml:21-44`, `.github/workflows/release.yml:115-145`, `.github/workflows/ci.yml:23-24`.

Le workflow CLA utilise une action tierce avec droits `contents: write`, `pull-requests: write` et `actions: write` sous `pull_request_target`. Il évite correctement le checkout du code de PR, mais l’action est épinglée sur `v2.6.1`, pas sur un SHA immuable. Les actions de release et officielles sont également référencées par tags.

Recommandation : épingler chaque action sur un SHA complet, avec commentaire de version, et laisser Dependabot mettre à jour ces SHA. Priorité au workflow CLA et aux actions de publication.

### P2 — Pas de stratégie de migration de schéma pour une instance existante

Référence : `supabase/init.sql`.

Le fichier est adapté à une base neuve, mais `CREATE TABLE IF NOT EXISTS` ne transforme pas une table existante quand une colonne ou une contrainte est ajoutée. Aucune table de version ni suite de migrations n’est fournie. Une instance installée tôt ne dispose donc pas d’un chemin public et vérifiable pour rejoindre le schéma actuel.

Recommandation : conserver `init.sql` pour les nouvelles installations et ajouter des migrations versionnées, idempotentes, testées depuis chaque version supportée.

### P2 — Accessibilité des dialogues et formulaires insuffisante

Références : `server/handler.js:216`, `server/handler.js:1633-1645`, `server/handler.js:2213-2219`.

Les overlays de confirmation, de partage et de participation n’ont pas `role="dialog"`, `aria-modal`, gestion complète du focus ni restauration du focus. Plusieurs champs n’ont qu’un placeholder, sans `<label>`. Les mises à jour de chat, chargement et erreurs ne disposent pas systématiquement de région `aria-live`. Certaines animations respectent `prefers-reduced-motion`, mais pas toutes.

Recommandation : ajouter les sémantiques, un piège de focus, fermeture Échap cohérente, labels visibles/masqués et annonces dynamiques, puis intégrer axe-core/Playwright sur les trois vues principales.

### P2 — Le schéma manque de contraintes d’intégrité

Référence : `supabase/init.sql`.

Les tables d’événements, sessions, messages et participants n’ont pas de clés étrangères vers le partage ou la présentation. Les valeurs structurantes (`event`, pages, durées, longueurs) ont peu de contraintes SQL. Cela facilite les orphelins et rend la base dépendante de chaque chemin applicatif pour rester cohérente.

Recommandation : ajouter progressivement FK/cascades compatibles avec la rétention, `CHECK` sur les domaines fermés et limites, et retirer l’index `doc_presentation_attendees_slug_idx` si l’analyse PostgreSQL confirme qu’il duplique inutilement le préfixe de la clé primaire `(slug, attendee_key)`.

## Constats mineurs et risques résiduels

### P3 — Jeton d’auteur de chat généré avec `Math.random`

Référence : `src/live.ts:158-170`.

Ce jeton autorise l’édition et la suppression d’un message ; il devrait être généré avec `crypto.getRandomValues()` ou `crypto.randomUUID()`. Les identifiants purement analytiques peuvent rester non cryptographiques, pas un jeton d’autorisation.

### P3 — `postMessage` vérifie le type mais pas la fenêtre source

Référence : `src/bridge.ts:119-140`.

Le rejet d’un contrôle d’origine trop strict est compréhensible, mais `event.source` peut être comparé à `iframe.contentWindow` ou `window.parent` sans connaître l’origine. Cela empêche un autre onglet/frame possédant une référence d’envoyer `close`, `share` ou `handover-done`.

### P3 — `allow_download=false` est une préférence d’interface, pas un contrôle

Références : `server/handler.js:1614-1621`, `server/handler.js:2896-2903`.

Le bouton disparaît, mais le navigateur reçoit nécessairement le fichier via la même route et peut l’enregistrer. La documentation et l’API doivent présenter ce champ comme une préférence UX, jamais comme une protection contre la copie.

### P3 — Commentaires de schéma en retard sur le code

`supabase/init.sql` affirme encore que le chat n’est pas porté par Broadcast, alors que `handler.js` dit et implémente l’inverse. `src/presentation-state.ts` mentionne également une voie `postgres_changes` qui n’est plus branchée. Cette dérive a une conséquence opérationnelle : elle brouille précisément le modèle de sécurité Realtime qui doit être corrigé en P0.

## Points forts à préserver

- Séparation nette du cœur et de l’hôte par contexte injecté, avec test d’étanchéité.
- Garde locale contre traversée de chemin et liens symboliques, préfixe hôte normalisé avec barre finale.
- Slugs et contrôles sensibles générés côté serveur avec `crypto.randomBytes`; hashes de contrôle comparés en temps constant dans le domaine présentation.
- CSP à nonce, `default-src 'none'`, `base-uri 'none'`, `form-action 'self'`, `nosniff` et framing explicite.
- Types actifs HTML/SVG/XML rendus inertes lors du relais.
- Accès `service_role` gardé côté serveur et RLS activé sans politique de lecture anonyme sur les tables métier.
- Accès restreint qui échoue fermé quand le greffon visiteurs est absent.
- Séparation explicite des statistiques internes et externes.
- Build déterministe, artefacts générés vérifiés en CI, paquet npm petit et propre.
- CI Node 22/24, CodeQL hebdomadaire, Docker non-root, healthcheck, SBOM et provenance d’image.
- Documentation exceptionnelle des raisons derrière les décisions et bonne discipline de tests de régression.

## Plan de remédiation conseillé

### Sous 24–48 heures

1. Refuser les redirections du proxy et ajouter un timeout.
2. Désactiver les broadcasts autoritatifs émis par les clients ; replier temporairement l’audience sur `state=1` si nécessaire.
3. Remplacer l’origine issue de `Host` par une URL publique configurée.
4. Forcer `isEvalSupported: false` en attendant la mise à niveau PDF.js.
5. Ajouter un test rouge pour chacun de ces quatre points avant correction.

### Sous une semaine

1. Concevoir le canal Realtime privé ou l’émission serveur avec droits lecture/écriture distincts.
2. Authentifier les sessions internes et dériver tous les rôles côté serveur.
3. Centraliser l’IP client et rendre les limites non contournables.
4. Rendre les créations idempotentes par contraintes uniques et upserts.
5. Diffuser les fichiers en streaming avec bornes de taille et délais.
6. Mettre à niveau et embarquer PDF.js/Supabase JS.

### Sous un mois

1. Ajouter E2E navigateur + Supabase de test + tests d’accessibilité.
2. Définir rétention, purge, export et effacement des données.
3. Introduire les migrations versionnées et contraintes SQL.
4. Découper `handler.js` sans modifier le contrat public.
5. Épingler actions GitHub et images de base par digest/SHA.

## Limites de l’audit

Cet audit combine lecture statique complète du dépôt, exécution locale des contrôles, vérification en ligne des dépendances npm et reproduction ciblée du comportement de redirection de Node. Il n’inclut pas :

- le code des greffons optionnels fournis par les hôtes (`visitors`, `bot`, etc.) ;
- un projet Supabase réel ni ses réglages Dashboard, buckets et politiques externes à `init.sql` ;
- les protections de branche, règles GitHub ou secrets configurés hors dépôt ;
- un pentest black-box d’une instance déployée ;
- une validation juridique de la conformité RGPD.

Les constats P0 reposent néanmoins sur le code publié et sur des comportements confirmés, sans dépendre d’une hypothèse de déploiement particulière.
