# Discovery MCP

## Spécification technique de référence

**Statut :** Révision architecturale V2 — prête pour Gate 0, non prête pour implémentation métier avant gel des contrats  
**Date :** 20 août 2026  
**Révision :** V2, intégrant l'audit du dépôt `discovery-media-player` `0.1.84` et de MCP `2026-07-28`  
**Projet parent :** Discovery Media Player  
**Dépôt parent :** `Juli1artha/discovery-media-player`  
**Dépôt cible envisagé :** `Juli1artha/discovery-mcp`  
**Licence cible du Core MCP :** `AGPL-3.0-or-later`  
**Contrats d'intégration :** exception / package MIT à valider juridiquement avant publication  
**Spécification MCP cible :** `2026-07-28`  
**SDK cible :** MCP TypeScript SDK v2  
**Runtime cible :** Node.js >= 22  

> Ce document décrit le projet complet, ses frontières, ses contrats techniques, sa sécurité, ses capacités futures, sa roadmap et son organisation multi-agents. La pièce jointe originale du 19 août 2026 reste la source historique ; cette V2 la remplace comme base de décision.

## Note de révision

### Appréciation globale

La conception initiale est forte sur ses principes : capacités métier plutôt que base générique, refus par défaut, séparation AuthN/AuthZ, absence de shell ou de filesystem arbitraire, façade unique, adapters, idempotence et indépendance vis-à-vis du fournisseur de LLM.

Elle n'était cependant pas encore directement implémentable. La présente révision corrige les écarts les plus importants observés dans le dépôt réel :

1. la baseline Player passe de `0.1.72` à `0.1.84`, commit de référence `6b0c239` ;
2. les **decks persistants** sont séparés des **sessions live** déjà implémentées ;
3. les exports service-role actuels du Player ne sont plus considérés comme une frontière MCP sûre ;
4. une nouvelle surface Player actor-aware et liée à une instance devient un prérequis Runtime ;
5. V1 est explicitement **mono-tenant par instance** ;
6. le Runtime de référence initial est **embedded** ; le Runtime HTTP distant attend une API métier dédiée et une identité déléguée ;
7. `setup` est local/stdio par défaut et séparé du processus Runtime public ;
8. les exigences spécifiques à MCP `2026-07-28` sont rendues explicites ;
9. les contrats d'autorisation, d'idempotence, de concurrence, d'audit et de pagination sont précisés ;
10. la roadmap est réordonnée pour construire d'abord la frontière Player et les lectures sûres ;
11. une stratégie multi-agents avec propriété exclusive des fichiers est ajoutée.

### Verdict de lancement

Le projet reçoit un **GO conditionnel** :

```text
GO pour Gate 0 : ADRs, contrats, fixtures et spikes protocole
GO pour V0 après validation de Gate 0
NO-GO pour les Tools Runtime métier avant publication de la frontière Player actor-aware
NO-GO pour les écritures avant idempotence durable et contrôle de concurrence
NO-GO pour un Runtime HTTP public sans OAuth MCP conforme
```

---

# Sommaire

1. Résumé exécutif
2. Contexte et état actuel de Discovery Media Player
3. Vision produit
4. Objectifs
5. Non-objectifs
6. Principes non négociables
7. Terminologie
8. Positionnement Open Source / Enterprise
9. Architecture cible
10. Profils du serveur MCP
11. Discovery Facade
12. Contrats et adapters
13. Gestion des capacités
14. Catalogue des Tools Runtime
15. Catalogue des Tools Setup / Developer Experience
16. Resources MCP
17. Prompts MCP
18. Présentation live
19. Documents et recherche
20. Authentification
21. Autorisation et Policy Adapter
22. Sécurité
23. Modèle d'erreurs
24. Idempotence et concurrence
25. Observabilité et audit
26. Protocole MCP et transports
27. Configuration
28. Structure du repository
29. Intégration avec Discovery Media Player
30. Portabilité des backends
31. Déploiement
32. Versioning et compatibilité
33. Tests
34. Documentation publique
35. Extensibilité
36. Roadmap par versions
37. Périmètre Enterprise futur
38. Décisions à figer avant développement
39. Definition of Done globale
40. Références techniques
41. Organisation multi-agents et stratégie Git/worktrees
42. Journal des corrections V2

---

# 1. Résumé exécutif

Discovery Media Player est aujourd'hui un moteur self-hosted de consultation, partage tracké, analytics de lecture et présentation live. Son principe architectural principal est que le core ne connaît pas l'application qui l'héberge : stockage, base, identité, branding, limites et autres décisions lui sont injectés via un contexte.

**Discovery MCP doit devenir l'interface native de Discovery pour les agents IA.**

L'objectif n'est pas de créer un MCP PostgreSQL, Supabase ou PostgREST. L'objectif est d'exposer des **capacités métier Discovery** de manière standardisée :

```text
Humains                  Applications                 Agents IA
   │                          │                           │
   ▼                          ▼                           ▼
Media Player              API / Bridge                MCP Server
   │                          │                           │
   └──────────────────────────┴───────────────────────────┘
                              │
                              ▼
                       Discovery Core
                              │
                        Context / Adapters
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
             DB            Storage          Identity
              │
          PostgREST
              │
          PostgreSQL
```

Un agent IA doit voir :

```text
documents.search
decks.create
shares.create
analytics.share
setup.doctor
```

et **ne doit jamais voir** :

```text
execute_sql
postgrest_query
read_table
shell
filesystem.read_any
```

Le projet comporte deux missions majeures :

1. **Runtime MCP** — permettre aux agents IA d'utiliser Discovery en production.
2. **Developer / Setup MCP** — permettre aux agents de développement d'installer, comprendre, configurer et diagnostiquer Discovery sans transformer le MCP en shell distant.

Une troisième surface, **Docs / Resources**, donnera aux agents un accès structuré à la documentation officielle de Discovery.

Le Core MCP sera Open Source. La valeur commerciale future devra venir de la gouvernance Enterprise, de l'hébergement managé, d'un Gateway multi-MCP, de l'identité avancée, de l'audit centralisé, des connecteurs et de l'intelligence documentaire — pas du verrouillage du protocole MCP de base.

---

# 2. Contexte et état actuel de Discovery Media Player

## 2.1 Baseline utilisée par ce document

Cette spécification est écrite à partir de l'état local et public de `discovery-media-player` observé le **20 août 2026**.

Baseline technique utile :

- package `discovery-media-player` en version observée `0.1.84` ;
- commit de référence : `6b0c239` ;
- contrat Player public : `1` ;
- Node.js `>=22` ;
- licence Core `AGPL-3.0-or-later` ;
- bridge `src/bridge.ts` sous MIT ;
- core serveur indépendant de l'application hôte ;
- contexte injecté ;
- stockage local / storage public autorisé / route fichier hôte ;
- tracked links ;
- analytics de lecture ;
- présentations live ;
- access wall optionnel ;
- branding par client ;
- base actuellement **PostgREST-shaped** ;
- PostgreSQL/Supabase comme chemin réaliste actuel pour les fonctions nécessitant une base ;
- realtime de présentation actuellement Supabase-shaped côté navigateur.

État de validation observé sur cette baseline :

```text
npm test             954 tests passés / 99 fichiers
npm run test:e2e      19 tests navigateur passés
npm run typecheck     passé
npm run lint          passé
npm run test:base     14 tests sautés localement faute de PostgREST configuré
```

Le vert local de `test:base` ne constitue donc pas une preuve des contraintes PostgreSQL/PostgREST. Cette preuve doit rester obligatoire dans la CI équipée d'une vraie base.

Cette baseline doit être réévaluée au début de Gate 0 puis figée dans `docs/COMPATIBILITY.md`.

## 2.2 Invariant du projet parent à préserver

Le principe le plus important du Media Player est :

> **Le core ne connaît pas l'application qui l'héberge. Tout ce qu'il emprunte arrive par un objet injecté.**

Discovery MCP doit prolonger ce principe, pas le contourner.

## 2.3 Sécurité existante à ne jamais affaiblir

Discovery Media Player applique déjà plusieurs principes que MCP doit conserver :

- refus par défaut pour l'accès aux fichiers ;
- pas de proxy universel vers le réseau privé ;
- pas de secrets dans les URLs ;
- permissions métier décidées par l'hôte ;
- absence de permission = refus ;
- séparation des lecteurs externes et des lectures internes ;
- refus explicite plutôt que fallback silencieux lorsqu'un accès est interdit.

Le MCP ne doit jamais devenir un chemin secondaire permettant de contourner ces règles.

## 2.4 Limites actuelles déterminantes pour MCP

Le dépôt est une base solide, mais sa surface publique actuelle n'est pas encore une API Runtime sûre pour un MCP :

- `server/shares.js` et `server/presentations.js` utilisent chacun un contexte global mutable initialisé par `init(ctx)` ;
- leurs fonctions sont des primitives privilégiées qui n'appliquent généralement pas elles-mêmes AuthN/AuthZ ;
- les contrôles d'identité, de rôle et de scope vivent principalement dans les routes HTTP ;
- les formes retournées peuvent contenir des lignes internes, URLs de fichier, adresses ou secrets de pilotage ;
- le Player ne porte aucun `tenant_id` généralisé ;
- les sessions live existantes sont mono-document et ne constituent pas des decks persistants ;
- le package publié ne distribue pas encore toute la documentation nécessaire au profil `docs`.

Conséquence : aucun Tool Runtime ne doit appeler directement les exports actuels `discovery-media-player/shares` ou `discovery-media-player/presentations`.

---

# 3. Vision produit

## 3.1 Vision courte

> **Discovery MCP est l'interface IA native de Discovery.**

Discovery doit pouvoir être utilisé par trois catégories de consommateurs :

```text
Discovery
├── Humans       → Media Player
├── Applications → API / Bridge / intégration directe
└── AI Agents    → MCP
```

## 3.2 Vision long terme

À terme, un utilisateur pourra demander à un agent :

> Prépare mon rendez-vous avec Martin.

L'agent pourra combiner plusieurs systèmes :

```text
CRM MCP
   ↓
profil et projet du contact

Email MCP
   ↓
échanges récents

Calendar MCP
   ↓
contexte du rendez-vous

Discovery MCP
   ↓
documents déjà envoyés
   ↓
activité de lecture
   ↓
recherche de nouveaux documents
   ↓
création d'un deck de documents
   ↓
création d'un lien tracké
```

Discovery reste responsable de son domaine :

- documents connus de l'intégration Discovery ;
- decks persistants fournis par l'hôte ou un futur domaine Discovery ;
- partages ;
- lecture ;
- analytics ;
- présentation live.

Il ne doit pas devenir un CRM, un client mail ou un ERP.

---

# 4. Objectifs

Discovery MCP doit :

1. exposer les capacités métier de Discovery à des agents compatibles MCP ;
2. rester indépendant d'un fournisseur de LLM ;
3. rester indépendant de l'application hôte ;
4. réutiliser la logique métier existante du Media Player ;
5. préserver la sécurité et les permissions de l'hôte ;
6. fonctionner en local via `stdio` ;
7. fonctionner à distance via Streamable HTTP une fois l'authentification et la délégation d'identité conformes ;
8. pouvoir être lancé comme service standalone ;
9. permettre une intégration embarquée dans une application Node ;
10. fournir une expérience développeur facilitant installation et diagnostic ;
11. être Open Source et self-hostable ;
12. être extensible via des adapters sans fork du core ;
13. rester compatible avec une future offre Discovery Enterprise ;
14. avoir une surface métier stable et versionnée ;
15. être testable sans dépendre d'une vraie instance de production.

---

# 5. Non-objectifs

Discovery MCP **ne doit pas** :

- exposer une base SQL générique ;
- exposer PostgREST directement ;
- fournir un terminal générique ;
- exécuter des commandes shell arbitraires ;
- parcourir arbitrairement le filesystem ;
- devenir un moteur RAG propriétaire obligatoire ;
- embarquer un LLM ;
- imposer OpenAI, Anthropic, Google, Mistral ou autre ;
- remplacer Supabase Realtime ;
- remplacer le Media Player ;
- dupliquer la logique de `shares`, `decks` ou `live` ;
- connaître les rôles métier particuliers d'une application hôte ;
- devenir un orchestrateur universel de CRM/email/calendar ;
- rendre Discovery Enterprise nécessaire au fonctionnement du Core Open Source.

---

# 6. Principes non négociables

## 6.1 Business capabilities, pas database capabilities

Autorisé :

```text
documents.search
shares.create
decks.create
analytics.share
```

Interdit :

```text
sql.execute
postgrest.request
database.table
schema.dump
```

## 6.2 Une seule logique métier

Architecture correcte :

```text
       MCP validation / policy / projection
                          │
                          ▼
              Player actor-aware services
                          │
                          ▼
               Discovery Business Logic
```

Architecture interdite :

```text
Media Player Logic

+

MCP Logic copiée et réécrite
```

## 6.3 Fail closed pour les droits

```text
permission inconnue → DENY
policy absente       → DENY
acteur non vérifié   → DENY
capability absente   → ne pas enregistrer le Tool ou retourner CAPABILITY_UNAVAILABLE
```

## 6.4 MCP n'est pas l'agent

Le serveur MCP fournit :

- Tools ;
- Resources ;
- éventuellement Prompts ;
- schémas ;
- données structurées.

Le raisonnement appartient au MCP Host / LLM.

## 6.5 Open Source autonome

Le Core Open Source doit être réellement utilisable sans :

- compte Discovery Cloud ;
- licence Enterprise ;
- API propriétaire Discovery ;
- télémétrie imposée ;
- service central obligatoire.

---

# 7. Terminologie

| Terme | Définition |
|---|---|
| Discovery Media Player | Projet actuel de lecture, tracking et présentation |
| Discovery MCP | Nouveau serveur MCP |
| MCP Host | Application IA qui héberge le client MCP, par exemple un assistant ou IDE agentique |
| MCP Client | Connecteur MCP du Host |
| MCP Server | Discovery MCP |
| Tool | Action ou requête callable par l'agent |
| Resource | Contexte lisible via URI MCP |
| Prompt | Template exposé au Host, optionnel |
| Runtime | Mode qui agit sur une instance Discovery opérationnelle |
| Setup | Mode d'aide à l'installation/configuration/diagnostic |
| Deck | Composition persistante et ordonnée de documents ; domaine distinct d'une session live |
| LiveSession | Session de diffusion temps réel déjà portée par le Media Player |
| DiscoveryFacade | Couche d'application MCP appelée par les Tools ; elle orchestre sans réimplémenter le métier Player |
| Adapter | Contrat injecté reliant le MCP à l'hôte ou à Discovery |
| Principal | Identité canonique vérifiée, définie par issuer + subject et liée au tenant serveur |
| Capability | Fonction structurellement supportée et configurée dans une instance donnée |
| Policy | Décision d'autorisation structurée portant action, ressource et contraintes |

---

# 8. Positionnement Open Source / Enterprise

## 8.1 Décision de produit

Le projet cible est un modèle **open-core** :

```text
OPEN SOURCE
────────────────────────────────────────
Discovery Media Player
Discovery MCP Runtime
Discovery MCP Setup / Doctor
Discovery Docs / Resources
Adapters publics
Tests
Docker
Documentation

COMMERCIAL / ENTERPRISE À TERME
────────────────────────────────────────
Discovery AI Gateway
SSO / SAML / SCIM
RBAC centralisé avancé
Audit centralisé
Policies d'organisation
Multi-tenancy managé
MCP Gateway multi-serveurs
Observabilité hébergée
Connecteurs premium éventuels
Intelligence documentaire avancée
Content Intelligence
Sales Intelligence
SLA / Cloud / support entreprise
```

## 8.2 Licence

Cible proposée :

- `discovery-mcp` Core : `AGPL-3.0-or-later` ;
- contrats d'intégration minimaux : MIT, sur le même principe que le bridge du Media Player ;
- marque et assets Discovery : hors licence logiciel, politique de marque distincte ;
- CLA avant contributions significatives externes afin de préserver les possibilités de licence commerciale future.

**Cette structure doit être validée juridiquement avant la première release publique.**

## 8.3 Frontière Enterprise

Règle absolue :

```text
Enterprise → peut dépendre de Open Source
Open Source → ne dépend jamais de Enterprise
```

---

# 9. Architecture cible

## 9.1 Vue logique globale

```text
MCP Host
   │ MCP
   ▼
Transport stdio / Streamable HTTP
   │
   ▼
RequestContextFactory
principal vérifié + tenant serveur + requestId + deadline
   │
   ▼
Tool / Resource Pipeline
validation → policy → service → projection → validation output → audit
   │
   ▼
DiscoveryFacade
   ├── DocumentCatalogPort ──► catalogue hôte / GED / API
   ├── DiscoveryRuntimePort
   │       ├── EmbeddedPlayerAdapter ──► Player actor-aware services
   │       └── RemotePlayerAdapter futur ──► API Runtime dédiée
   ├── DocsPort
   └── AuditPort
              │
              ▼
       Player Context / Adapters
       DB · Storage · Identity · Realtime

Processus local séparé :
Coding Agent ──stdio──► Discovery Setup MCP ──► workspace read-only/config/docs
```

## 9.2 Principe de façade

Aucun Tool ne doit appeler directement :

- `fetch()` vers PostgREST ;
- les tables Discovery ;
- le filesystem ;
- les modules internes profonds du Media Player.

Tout Tool passe par `DiscoveryFacade`, puis par un port public actor-aware.

`DiscoveryFacade` ne doit pas réimplémenter les invariants de shares, live, analytics ou decks. Sa responsabilité est limitée à :

- validation et normalisation MCP ;
- orchestration de ports ;
- application de la policy ;
- projection et validation des sorties ;
- mapping d'erreurs ;
- audit et observabilité.

Les transactions, l'idempotence durable, les règles de propriété et les protections de concurrence appartiennent au service métier qui réalise la mutation.

## 9.3 Topologie de référence V1

La topologie de référence initiale est :

```text
embedded + une instance Player par processus + un tenant par instance
```

Un repository séparé n'impose pas un processus séparé : le package MCP peut être créé dans le même processus Node que le contexte Player.

Le mode Runtime distant n'est disponible qu'après définition d'une API métier dédiée. Le token OAuth présenté au MCP ne doit jamais être relayé au Player. L'identité distante utilise soit :

- un échange de token / mécanisme on-behalf-of ;
- une identité service-to-service et une assertion d'acteur signée et bornée ;
- une intégration équivalente validée par le threat model.

La route historique `/api/doc` n'est pas cette API Runtime.

---

# 10. Profils du serveur MCP

Le même codebase doit pouvoir activer différentes familles de capacités.

## 10.1 Profil `runtime`

Destiné à une instance Discovery opérationnelle.

Exemples :

```text
documents.search
decks.get
shares.create
analytics.share
live.go_to_page
```

Requiert les adapters correspondants.

## 10.2 Profil `setup`

Destiné aux agents de développement avant ou pendant l'intégration.

Exemples :

```text
setup.requirements
setup.inspect
setup.validate_config
setup.doctor
setup.integration_guide
```

Le mode Setup doit pouvoir démarrer **sans instance Discovery opérationnelle**.

Il ne doit pas avoir besoin de PostgreSQL.

Règles de déploiement :

- `setup` utilise `stdio` par défaut ;
- il s'exécute dans un processus distinct du Runtime public ;
- le workspace est monté en lecture seule lorsque possible ;
- le réseau est désactivé par défaut ;
- son activation HTTP distante est hors V0/V1.

## 10.3 Profil `docs`

Destiné à la découverte de la documentation et des contrats.

Exemples de Resources :

```text
discovery-docs://architecture
discovery-docs://host-contract
discovery-docs://configuration
discovery-docs://mcp/tools
```

## 10.4 Profil `all`

Pour développement local uniquement : active toutes les capacités réellement configurées.

Le serveur doit refuser de démarrer avec `profile=all` lorsque le mode de déploiement est déclaré `production` ou lorsque le transport HTTP n'est pas limité à loopback.

## 10.5 Activation conditionnelle

Un Tool ne doit pas apparaître dans `tools/list` si sa capability **structurelle** est absente : profil désactivé, adapter non fourni, contrat incompatible ou configuration obligatoire absente.

Exemple : si aucune recherche documentaire n'est configurée :

```text
documents.search → non enregistré
```

plutôt qu'un Tool visible qui échoue systématiquement.

Une panne transitoire d'une dépendance ne doit pas faire apparaître et disparaître le Tool. Le Tool reste enregistré et retourne `DISCOVERY_DEPENDENCY_UNAVAILABLE` avec `retryable: true` lorsque c'est exact.

Le filtrage éventuel de `tools/list` par scope OAuth ne remplace jamais l'autorisation lors de `tools/call`.

---

# 11. Discovery Facade

## 11.1 Rôle

`DiscoveryFacade` constitue la frontière d'application interne du MCP.

Elle :

- normalise les appels ;
- cache PostgREST ;
- cache les détails des tables ;
- contrôle les capabilities ;
- applique la policy et orchestre les ports sans recopier le métier Player ;
- normalise les erreurs ;
- rend les Tools simples et testables.

## 11.2 Contrat conceptuel

```ts
export interface DiscoveryFacade {
  system: SystemService;
  documents?: DocumentsService;
  decks?: DecksService;
  shares?: SharesService;
  analytics?: AnalyticsService;
  live?: LiveService;
  setup?: SetupService;
}
```

### SystemService

```ts
export interface SystemService {
  info(context: OperationContext): Promise<SystemInfo>;
  capabilities(context: OperationContext): Promise<DiscoveryCapability[]>;
}
```

### DocumentsService

```ts
export interface DocumentsService {
  search(input: DocumentSearchInput, context: OperationContext): Promise<DocumentSearchResult>;
  get(input: DocumentGetInput, context: OperationContext): Promise<DocumentDescriptor | null>;
}
```

### DecksService

```ts
export interface DecksService {
  list(input: DeckListInput, context: OperationContext): Promise<DeckListResult>;
  get(input: DeckGetInput, context: OperationContext): Promise<Deck | null>;
  create(input: DeckCreateInput, context: OperationContext): Promise<Deck>;
  update(input: DeckUpdateInput, context: OperationContext): Promise<Deck>;
  addDocuments(input: DeckAddDocumentsInput, context: OperationContext): Promise<Deck>;
  removeDocument(input: DeckRemoveDocumentInput, context: OperationContext): Promise<Deck>;
  reorder(input: DeckReorderInput, context: OperationContext): Promise<Deck>;
}
```

### SharesService

```ts
export interface SharesService {
  get(input: ShareGetInput, context: OperationContext): Promise<Share | null>;
  list(input: ShareListInput, context: OperationContext): Promise<ShareListResult>;
  create(input: ShareCreateInput, context: OperationContext): Promise<Share>;
  revoke(input: ShareRevokeInput, context: OperationContext): Promise<Share>;
  setAccess(input: ShareSetAccessInput, context: OperationContext): Promise<Share>;
}
```

### AnalyticsService

```ts
export interface AnalyticsService {
  document(input: DocumentAnalyticsInput, context: OperationContext): Promise<DocumentAnalytics>;
  share(input: ShareAnalyticsInput, context: OperationContext): Promise<ShareAnalytics>;
  recipient(input: RecipientAnalyticsInput, context: OperationContext): Promise<RecipientAnalytics>;
  overview(input: AnalyticsOverviewInput, context: OperationContext): Promise<AnalyticsOverview>;
}
```

### LiveService

```ts
export interface LiveService {
  start(input: LiveStartInput, context: OperationContext): Promise<LiveSession>;
  status(input: LiveStatusInput, context: OperationContext): Promise<LiveStatus>;
  showDocument(input: LiveShowDocumentInput, context: OperationContext): Promise<LiveStatus>;
  goToPage(input: LiveGoToPageInput, context: OperationContext): Promise<LiveStatus>;
  nextPage(input: LiveNavigationInput, context: OperationContext): Promise<LiveStatus>;
  previousPage(input: LiveNavigationInput, context: OperationContext): Promise<LiveStatus>;
  end(input: LiveEndInput, context: OperationContext): Promise<LiveStatus>;
}
```

---

# 12. Contrats et adapters

## 12.1 Principal et contexte d'opération

Le tenant n'est jamais fourni dans les arguments d'un Tool. Il provient de la configuration de l'instance et de l'identité vérifiée.

```ts
export interface Principal {
  issuer: string;
  subject: string;
  tenantId: string;
  email?: string;
  displayName?: string;
  clientId?: string;
}

export interface OperationContext {
  principal: Principal;
  requestId: string;
  traceId?: string;
  deadline?: Date;
  signal?: AbortSignal;
}
```

`issuer + subject` est l'identité canonique. L'email est une propriété métier vérifiée, jamais la clé d'identité universelle. Les claims bruts restent privés à l'Auth Adapter et ne doivent ni être retournés, ni traverser le métier, ni être loggés.

## 12.2 DiscoveryMcpContext

```ts
export interface DiscoveryMcpContext {
  runtime?: DiscoveryRuntimeAdapter;
  documents?: DocumentsAdapter;
  auth: AuthAdapter;
  policy: PolicyAdapter;
  links?: LinkBuilder;
  setup?: SetupAdapter;
  docs?: DocsAdapter;
  audit?: AuditSink;
  idempotency?: IdempotencyStore;
  logger: Logger;
  clock?: Clock;
  requestIds?: RequestIdFactory;
}
```

Tous les adapters optionnels déterminent les capabilities structurelles réellement disponibles. La création du contexte doit être liée à une instance ; aucun adapter Core ne doit dépendre d'un singleton global réinitialisable.

## 12.3 DiscoveryRuntimeAdapter

Cette interface évite que le MCP dépende directement des fichiers internes du Media Player. Elle est actor-aware, typée et ne retourne que des DTO projetés.

```ts
export interface DiscoveryRuntimeAdapter<TRuntimeDocumentRef = never> {
  getInstanceInfo(context: OperationContext): Promise<PlayerInstanceInfo>;
  shares?: RuntimeSharesPort<TRuntimeDocumentRef>;
  analytics?: RuntimeAnalyticsPort;
  live?: RuntimeLivePort<TRuntimeDocumentRef>;
  decks?: RuntimeDecksPort<TRuntimeDocumentRef>;
}

export interface RuntimeSharesPort<TRuntimeDocumentRef> {
  get(input: ShareGetInput, context: OperationContext): Promise<Share | null>;
  list(input: ShareListInput, context: OperationContext): Promise<ShareListResult>;
  create(
    input: ShareCreateCommand<TRuntimeDocumentRef>,
    context: OperationContext
  ): Promise<Share>;
  revoke(input: ShareRevokeInput, context: OperationContext): Promise<Share>;
  setAccess(input: ShareSetAccessInput, context: OperationContext): Promise<Share>;
}

export interface RuntimeAnalyticsPort {
  document(input: DocumentAnalyticsInput, context: OperationContext): Promise<DocumentAnalytics>;
  share(input: ShareAnalyticsInput, context: OperationContext): Promise<ShareAnalytics>;
}

export interface RuntimeLivePort<TRuntimeDocumentRef> {
  start(input: LiveStartCommand<TRuntimeDocumentRef>, context: OperationContext): Promise<LiveSession>;
  status(input: LiveStatusInput, context: OperationContext): Promise<LiveStatus>;
  showDocument(input: LiveShowDocumentCommand<TRuntimeDocumentRef>, context: OperationContext): Promise<LiveStatus>;
  goToPage(input: LiveGoToPageInput, context: OperationContext): Promise<LiveStatus>;
  nextPage(input: LiveNavigationInput, context: OperationContext): Promise<LiveStatus>;
  previousPage(input: LiveNavigationInput, context: OperationContext): Promise<LiveStatus>;
  end(input: LiveEndInput, context: OperationContext): Promise<LiveStatus>;
}
```

`RuntimeDecksPort` est un contrat futur : il ne doit être enregistré que lorsqu'un vrai domaine deck existe. Le Player `0.1.84` ne l'implémente pas.

La première implémentation officielle doit être construite au-dessus d'une nouvelle surface Player :

```ts
createDiscoveryRuntime(context): DiscoveryRuntimePort
```

Les exports actuels `./shares` et `./presentations` restent des détails d'implémentation derrière cette surface. Ils ne sont jamais appelés directement par un Tool MCP.

## 12.4 DocumentsAdapter et résolution interne

Discovery Media Player n'est pas obligatoirement le catalogue documentaire de l'application hôte. Le MCP doit donc prévoir un adapter de catalogue.

```ts
export interface ResolvedDocument<TRuntimeDocumentRef> {
  descriptor: DocumentDescriptor;
  runtimeRef: TRuntimeDocumentRef;
}

export interface DocumentsAdapter<TRuntimeDocumentRef = never> {
  search(input: DocumentSearchInput, context: OperationContext): Promise<DocumentSearchResult>;
  get(input: DocumentGetInput, context: OperationContext): Promise<DocumentDescriptor | null>;
  resolve(
    documentId: string,
    context: OperationContext
  ): Promise<ResolvedDocument<TRuntimeDocumentRef> | null>;
}
```

`runtimeRef` est interne au processus d'adaptation. Il peut contenir la référence nécessaire au Player, mais il ne doit jamais être sérialisé, journalisé ou retourné au modèle. Cette séparation permet à `shares.create` et `live.start` d'accepter uniquement un `documentId` public.

Implémentations possibles :

- catalogue PostgreSQL de l'hôte ;
- API interne ;
- Elasticsearch ;
- MongoDB ;
- GED ;
- SharePoint ;
- Google Drive ;
- catalogue local ;
- adapter custom.

Discovery MCP ne doit pas savoir lequel est utilisé.

## 12.5 AuthAdapter

```ts
export interface AuthAdapter {
  authenticate(input: AuthenticationInput): Promise<AuthenticatedPrincipal | null>;
}
```

`AuthenticationInput` est construit par le transport. Il ne vient jamais des arguments d'un Tool. `AuthenticatedPrincipal` contient le `Principal` canonique et, dans une zone privée à l'adapter, les matériaux éventuellement nécessaires à la vérification ou à un échange de token.

Le Core MCP ne doit pas interpréter arbitrairement des claims comme des droits.

## 12.6 PolicyAdapter

```ts
export interface PolicyResource {
  type: "system" | "document" | "deck" | "share" | "analytics" | "live" | "setup";
  id?: string;
  tenantId: string;
}

export interface PolicyDecision {
  allowed: boolean;
  reasonCode?: string;
  decisionId?: string;
  scope?: "mine" | "all";
  constraints?: {
    ownerIds?: string[];
    resourceIds?: string[];
    allowedFields?: string[];
  };
}

export interface PolicyAdapter {
  decide(
    principal: Principal,
    action: DiscoveryAction,
    resource: PolicyResource
  ): Promise<PolicyDecision>;
}
```

La ressource est obligatoire, y compris pour une collection (`type` + `tenantId`, sans `id`). Valeur par défaut en cas d'erreur, timeout, réponse mal formée ou adapter absent : **refus**.

Les contraintes de liste et d'agrégat doivent être appliquées dans la requête backend ou dans le service métier. Il est interdit de lire toutes les lignes puis de filtrer dans le MCP.

## 12.7 LinkBuilder

```ts
export interface LinkBuilder {
  share(slug: string): string;
  deck(deckId: string): string;
  liveAudience(slug: string): string;
}
```

Le MCP ne doit pas reconstruire des URLs publiques par concaténation dispersée dans les Tools.

## 12.8 SetupAdapter

Le Setup Adapter est volontairement plus contraint qu'un terminal.

```ts
export interface SetupAdapter {
  inspectEnvironment(input: SetupInspectInput): Promise<SetupEnvironment>;
  validateConfig(input: SetupValidateConfigInput): Promise<SetupValidation>;
  doctor(input: SetupDoctorInput): Promise<DoctorReport>;
  requirements(): Promise<SetupRequirements>;
  integrationGuide(input: IntegrationGuideInput): Promise<IntegrationGuide>;
}
```

Il doit être limité à un `workspaceRoot` configuré.

Le chemin racine est résolu une fois, puis chaque fichier lu est revalidé contre sa forme réelle. L'adapter refuse les symlinks sortants, `.git`, les fichiers non allowlistés, les fichiers trop grands, une profondeur excessive et toute URL proposée dynamiquement par le modèle.

## 12.9 DocsAdapter

```ts
export interface DocsAdapter {
  list(): Promise<DocResourceDescriptor[]>;
  read(uri: string): Promise<DocResource>;
  search?(query: string): Promise<DocSearchResult>;
}
```

## 12.10 IdempotencyStore

```ts
export interface IdempotencyStore {
  execute<T>(
    request: {
      tenantId: string;
      actorSubject: string;
      tool: string;
      key: string;
      requestHash: string;
      expiresAt: Date;
    },
    operation: () => Promise<T>
  ): Promise<T>;
}
```

Une implémentation mémoire n'est autorisée que pour les tests et le développement mono-processus. Les Tools HTTP d'écriture exigent une garantie atomique et partagée.

---

# 13. Gestion des capacités

## 13.1 Trois axes distincts

Une capability n'est pas une permission et n'est pas un healthcheck.

```text
Exposition d'un Tool = profil activé
                     ∩ adapter présent
                     ∩ configuration structurelle valide
                     ∩ contrat compatible

Exécution d'un Tool  = Tool exposé
                     ∩ identité valide
                     ∩ policy autorisée pour cette ressource
                     ∩ dépendance opérationnelle
```

Une dépendance momentanément indisponible ne modifie pas le registre. Une modification structurelle de configuration exige un redémarrage ou un mécanisme explicite de `listChanged`.

## 13.2 Capabilities Discovery

Exemples :

```text
system.info
runtime.connected
runtime.shares.read
runtime.shares.write
runtime.decks.read
runtime.decks.write
runtime.analytics.read
runtime.live.control
documents.search
documents.read
setup.inspect
setup.doctor
docs.read
```

## 13.3 `system.info`

Tool local minimal et sans secret. En HTTP distant, il suit la politique d'authentification du serveur ; il n'est pas public par défaut.

Input schema :

```json
{ "type": "object", "additionalProperties": false }
```

Sortie indicative :

```json
{
  "product": "discovery-mcp",
  "version": "0.1.0",
  "protocolTarget": "2026-07-28",
  "profiles": ["runtime"],
  "discovery": {
    "availability": "ready",
    "version": "0.1.84",
    "contract": 1,
    "tenantMode": "single-instance"
  },
  "capabilities": [
    "documents.search",
    "runtime.shares.read",
    "setup.doctor"
  ]
}
```

Valeurs d'availability :

```text
ready        configuré et prêt au moment de la mesure
degraded     utilisable avec capacités réduites
unavailable configuré mais dépendance momentanément indisponible
```

L'output schema est obligatoire. L'ordre des capabilities est déterministe.

Ne jamais exposer :

- token ;
- service role key ;
- mot de passe ;
- hostname interne inutile ;
- URL de base privée ;
- secret de fetch ;
- contenu des variables d'environnement.

---

# 14. Catalogue des Tools Runtime

Cette section décrit la **surface cible complète**. Toutes les Tools ne seront pas disponibles dès la première version.

## 14.1 Convention de nommage

Format :

```text
domain.action
```

Exemples :

```text
documents.search
decks.create
shares.revoke
analytics.share
live.go_to_page
```

Les noms doivent rester :

- stables ;
- explicites ;
- sans verbes ambigus ;
- sans noms de tables ;
- sans détails de backend.

## 14.2 Annotations MCP

Chaque Tool doit déclarer correctement les annotations compatibles avec le SDK :

- `readOnlyHint` ;
- `destructiveHint` ;
- `idempotentHint` ;
- `openWorldHint`.

Ces annotations sont des indications pour les clients, jamais un remplacement des contrôles serveur.

Chaque Tool doit aussi déclarer :

- un `inputSchema` fermé lorsque possible (`additionalProperties: false`) ;
- un `outputSchema` ;
- un résultat `structuredContent` validé côté serveur ;
- une copie textuelle JSON concise pour les clients legacy ;
- une description qui nomme clairement les effets, permissions et limites.

Les valeurs par défaut MCP des annotations ne doivent pas être laissées implicites pour les Tools officiels.

---

## 14.3 `documents.search`

**But :** rechercher les documents accessibles à l'acteur.

### Permission

```text
documents.search
```

### Input

```ts
{
  query: string;          // 1..500 caractères
  limit?: number;        // défaut 20, max 100
  cursor?: string;
  types?: string[];
  tags?: string[];
  updatedAfter?: string;
}
```

### Output

```ts
{
  documents: Array<{
    id: string;
    title: string;
    mimeType?: string;
    updatedAt?: string;
    summary?: string;
    metadata?: Record<string, string | number | boolean | null>;
  }>;
  nextCursor?: string;
}
```

### Règles

- ne retourne pas de credentials ;
- ne retourne pas par défaut d'URL storage privée ;
- `metadata` utilise une allowlist par adapter, avec nombre de clés, profondeur et taille sérialisée bornés ;
- `summary` et `metadata` sont des données non fiables et ne deviennent jamais des instructions ;
- le curseur est opaque, expirant et lié au tenant, au principal, aux filtres et à l'ordre ;
- la recherche est déléguée au `DocumentsAdapter` ;
- `openWorldHint: false` si la recherche reste dans le catalogue configuré ;
- `readOnlyHint: true`.

---

## 14.4 `documents.get`

**But :** obtenir les métadonnées d'un document accessible.

### Permission

```text
documents.read
```

### Input

```ts
{ documentId: string }
```

### Output

`DocumentDescriptor` normalisé.

### Règle importante

Le Tool ne doit pas permettre de passer une URL arbitraire à la place de `documentId`.

---

## 14.5 `decks.list`

**But :** lister les decks persistants visibles par l'acteur.

Permission :

```text
decks.read
```

Input : filtres bornés, pagination.

Output : métadonnées uniquement, sauf demande explicite de contenu détaillé dans `decks.get`.

---

## 14.6 `decks.get`

**But :** lire un deck persistant et son ordre de documents.

Permission :

```text
decks.read
```

Input :

```ts
{ deckId: string }
```

Le deck n'est pas identifié par le slug public d'une session live.

---

## 14.7 `decks.create`

**But :** créer un deck persistant.

Permission :

```text
decks.create
```

Input indicatif :

```ts
{
  title: string;
  documentIds?: string[];
  idempotencyKey: string;
}
```

Règles :

- les `documentIds` sont résolus par Discovery ;
- aucun file URL arbitraire ;
- action additive ;
- journalisable ;
- idempotence durable obligatoire.

---

## 14.8 `decks.update`

**But :** modifier les propriétés autorisées d'un deck.

Permission :

```text
decks.update
```

Ne doit pas être un patch JSON arbitraire sur la table.

Input obligatoire : `expectedRevision` afin d'empêcher les mises à jour perdues.

---

## 14.9 `decks.add_documents`

Input :

```ts
{
  deckId: string;
  documentIds: string[];
  position?: number;
  expectedRevision: number;
  idempotencyKey: string;
}
```

Règles :

- nombre maximum de documents par appel ;
- résolution de chaque document ;
- droits vérifiés ;
- ordre déterministe.

---

## 14.10 `decks.remove_document`

Action potentiellement destructive sur la composition d'un deck.

Annotations :

```text
readOnlyHint: false
destructiveHint: true
```

Le document source n'est jamais supprimé ; seule son association à la présentation est retirée.

---

## 14.11 `decks.reorder`

Ne doit accepter qu'un ordre explicite et validé des items connus du deck, avec `expectedRevision`.

Les Tools `decks.*` ne sont pas disponibles tant qu'un vrai domaine persistant et son adapter n'ont pas été publiés. Ils ne sont pas implémentés par les sessions live du Player `0.1.84`.

---

## 14.12 `shares.get`

But : lire un partage tracké.

Permission :

```text
shares.read
```

Input :

```ts
{ shareId: string }
```

Doit respecter les scopes existants du Media Player et ne pas inventer de visibilité supplémentaire.

---

## 14.13 `shares.list`

But : lister les partages accessibles.

Le scope exact (`mine`, `all`, futur scope hôte) doit être fourni par la couche d'autorisation réelle et retourné explicitement.

---

## 14.14 `shares.create`

But : créer un lien tracké à partir d'un document résolu par Discovery.

Input cible :

```ts
{
  target: {
    type: "document";
    id: string;
  };
  recipient?: {
    name?: string;
    email?: string;
  };
  requireAuth?: boolean;
  brandKey?: string;
  idempotencyKey: string;
}
```

Le Tool ne doit pas accepter directement :

```text
fileUrl
storageKey
supabaseKey
```

Le MCP résout la cible via les adapters.

Le partage d'un deck est différé jusqu'à l'existence d'un modèle deck et d'un contrat de rendu/partage explicite.

---

## 14.15 `shares.revoke`

But : révoquer un partage existant.

Permission :

```text
shares.revoke
```

Action destructive et auditée.

Input minimal :

```ts
{ shareId: string }
```

Le slug public et l'URL trackée ne servent jamais de preuve d'autorisation. Ils ne sont retournés que par une opération explicitement autorisée et ne doivent pas être utilisés comme URI de Resource par défaut.

---

## 14.16 `shares.set_access`

But : modifier les paramètres d'accès exposés officiellement par Discovery.

Ne doit pas fournir un objet de policy libre.

---

## 14.17 `analytics.document`

But : retourner des **faits de lecture** concernant un document.

Exemples de données :

- sessions ;
- ouvertures ;
- temps total ;
- temps par page si disponible ;
- dernière activité ;
- page la plus avancée ;
- distinction interne/externe si autorisée.

Le Tool ne doit pas conclure :

```text
"prospect chaud"
```

Il retourne les faits. L'interprétation appartient au LLM ou à une couche Intelligence future.

---

## 14.18 `analytics.share`

Input :

```ts
{ shareId: string }
```

Output indicatif :

```json
{
  "asOf": "2026-08-20T09:42:00Z",
  "scope": "mine",
  "complete": true,
  "opened": true,
  "opens": 3,
  "sessions": 2,
  "totalSeconds": 842,
  "maxPage": 12,
  "lastActivityAt": "2026-08-19T09:42:00Z"
}
```

Toutes les sorties analytics déclarent : instant de mesure, fenêtre temporelle, timezone, scope appliqué, complétude et warnings éventuels. Les populations internes et externes restent séparées.

---

## 14.19 `analytics.recipient`

Permet de synthétiser les faits Discovery relatifs à un destinataire **si l'application hôte autorise cette vision**.

Ce Tool ne doit pas rechercher un email globalement. Il accepte un `recipientId` opaque résolu par l'hôte et reste hors V1.

---

## 14.20 `analytics.overview`

Destiné aux vues agrégées autorisées :

- partages jamais ouverts ;
- documents les plus consultés ;
- sessions récentes ;
- agrégats sur une période.

Les limites et fenêtres de temps doivent être bornées.

Le Player `0.1.84` réalise encore un agrégat large en mémoire. Ce Tool reste désactivé tant qu'un agrégat backend borné, paginé et tenant-aware n'est pas disponible.

---

# 15. Catalogue des Tools Setup / Developer Experience

Le Setup MCP est une capacité officielle du projet, pas un terminal masqué.

## 15.1 Objectif

Permettre à un coding agent de demander :

> Installe Discovery dans ce projet.

ou :

> Pourquoi Discovery ne fonctionne pas ici ?

et recevoir des informations officielles et déterministes sur Discovery.

## 15.2 Règle de sécurité principale

Le Setup MCP doit **informer, inspecter dans un périmètre borné, valider et diagnostiquer**.

Il ne doit pas fournir :

```text
shell(command)
run_anything
write_any_file
read_any_file
fetch_any_url
execute_sql
```

Le coding agent dispose généralement déjà de ses propres outils fichiers/terminal. Discovery MCP lui donne la **connaissance spécifique à Discovery**.

---

## 15.3 `setup.requirements`

Retourne les prérequis officiels de la version installée :

```json
{
  "node": ">=22",
  "database": {
    "requiredForViewer": false,
    "requiredForTrackedLinks": true,
    "currentSupportedPath": ["PostgreSQL + PostgREST", "Supabase"]
  },
  "optionalCapabilities": [
    "realtime",
    "mail",
    "host-authz",
    "branding"
  ]
}
```

Ne sonde rien. Pure information.

---

## 15.4 `setup.inspect`

Inspecte uniquement le `workspaceRoot` configuré.

Peut détecter :

- version Node active ;
- présence de `package.json` ;
- lockfile ;
- présence de dépendance Discovery ;
- fichiers de configuration connus ;
- Dockerfile / compose ;
- structure projet pertinente ;
- variables présentes par **nom**, sans exposer leurs valeurs ;
- version du Media Player si installée.

Ne doit jamais lire un chemin hors workspace.

---

## 15.5 `setup.validate_config`

Valide une configuration Discovery sans révéler les secrets.

Sortie :

```ts
{
  valid: boolean;
  errors: SetupIssue[];
  warnings: SetupIssue[];
  capabilities: string[];
}
```

Exemple :

```text
SUPABASE_URL             present    ✅
SUPABASE_SERVICE_ROLE_KEY present   ✅ (value hidden)
PLAYER_SOURCE_URL        missing    ⚠️
PLAYER_HOST_FETCH_BASE   malformed  ❌
```

---

## 15.6 `setup.doctor`

Tool majeur de Developer Experience.

### But

Produire un diagnostic officiel de l'installation Discovery.

### Vérifications cibles

```text
Runtime
├── Node version
├── package version
└── compatibility

Configuration
├── mandatory settings
├── malformed URLs
└── secret presence without disclosure

Media Player
├── instance reachable
├── contract/version
└── capabilities

Database
├── configured / not configured
├── reachable / unreachable
└── expected schema status

Storage
├── adapter configured
└── allowed route / local root status

Identity
├── verifier configured
└── authorization capability available

Realtime
├── configured
└── capability status

MCP
├── protocol target
├── active profile
└── registered tools
```

### Sortie

```json
{
  "status": "warning",
  "checks": [
    {
      "id": "runtime.node",
      "status": "pass",
      "message": "Node.js 22+"
    },
    {
      "id": "realtime.config",
      "status": "fail",
      "message": "Realtime is required for live presentation but is not configured",
      "remediation": "Configure the Supabase realtime settings documented for this version."
    }
  ]
}
```

### Sécurité réseau

`setup.doctor` ne doit pas tester des URLs fournies arbitrairement par le LLM.

Il peut tester uniquement :

- les endpoints déjà configurés dans l'instance ;
- localhost dans un mode dev explicite ;
- une allowlist fournie par l'hôte.

---

## 15.7 `setup.integration_guide`

Retourne un guide adapté au contexte détecté.

Exemples :

```text
Node standalone
Express
Next.js
Vercel/serverless
Docker
Supabase
custom host route
```

Ce Tool retourne des instructions et snippets ; il n'écrit pas les fichiers lui-même.

---

## 15.8 `setup.generate_config`

Option future.

Retourne un **template** ou un **patch proposé**, jamais une écriture automatique par défaut.

Exemple :

```ts
{
  format: "env",
  content: "PLAYER_LOCAL_ROOT=...\n...",
  warnings: [...]
}
```

Les secrets sont représentés par placeholders.

---

## 15.9 `setup.compatibility`

Retourne la compatibilité entre :

- Discovery MCP ;
- Media Player ;
- contract version ;
- protocol MCP.

Permet à un agent de savoir si une mise à jour est nécessaire avant de modifier le code.

---

# 16. Resources MCP

Les Resources de documentation minimales accompagnent le profil Setup/Docs. Les Resources Runtime dynamiques arrivent après stabilisation des Tools read-only.

## 16.1 Runtime resources

Exemples :

```text
discovery://documents/{id}
discovery://decks/{id}
discovery://shares/{shareId}
discovery://analytics/shares/{shareId}
```

Elles sont majoritairement read-only.

Règles :

- préférer des Resource Templates aux listes exhaustives ;
- utiliser des identifiants internes, pas un slug public bearer ;
- appliquer AuthN/AuthZ à chaque `resources/read` ;
- utiliser `cacheScope: private` pour toute donnée liée à un principal ou tenant ;
- retourner des `resource_link` depuis les Tools lorsqu'une Resource apporte une suite utile.

## 16.2 Documentation resources

Exemples :

```text
discovery-docs://player/{version}/host-contract
discovery-docs://player/{version}/configuration
discovery-docs://player/{version}/security
discovery-docs://mcp/{version}/architecture
discovery-docs://mcp/{version}/tools
discovery-docs://mcp/{version}/setup
```

## 16.3 Règle de source de vérité

La documentation MCP ne doit pas recopier de longues sections du Media Player qui risqueraient de dériver.

Elle doit :

- pointer vers les contrats officiels ;
- lire la version installée ;
- servir les fichiers correspondant à cette version lorsque possible.

Le package Player `0.1.84` ne distribue actuellement que `HOST-CONTRACT.md` et `RETENTION.md` parmi les documents nécessaires. Avant le profil Docs complet, il faut soit publier les autres fichiers requis dans le package Player, soit construire un artefact documentaire versionné. Un alias `latest` ne doit jamais servir de base aux tests de compatibilité.

---

# 17. Prompts MCP

Les Prompts ne sont pas prioritaires et ne doivent contenir aucune logique critique.

Prompts futurs possibles :

```text
prepare-client-deck
analyze-reader-activity
prepare-document-followup
troubleshoot-discovery-installation
```

Ils doivent rester supprimables sans casser le produit.

---

# 18. Présentation live

## 18.1 Rôle de MCP

MCP peut commander l'état métier d'une session live.

Il ne remplace pas le canal realtime vers l'audience.

```text
Agent
  │
  ▼
MCP Tool
  │
  ▼
Discovery Live Service
  │
  ▼
Realtime
  │
  ▼
Audience
```

## 18.2 Tools cibles

```text
live.start
live.status
live.show_document
live.go_to_page
live.next_page
live.previous_page
live.end
```

## 18.3 Contraintes

- l'acteur doit être autorisé à contrôler la présentation ;
- navigation bornée au document actif ;
- pas d'URL arbitraire ;
- pas d'action sur une présentation inconnue ;
- chaque changement important est audité ;
- les retries doivent être sûrs.

Contraintes supplémentaires imposées par le Player réel :

- le `control_token` et son hash ne sont jamais retournés au modèle ;
- le service Player expose des opérations owner-scoped à partir du `Principal` ;
- le nombre de pages du document actif est connu et contrôlé ;
- `next_page` et `previous_page` sont atomiques ou protégés par `expectedRevision` / command ID ;
- `go_to_page(n)` ne porte `idempotentHint: true` que si le backend le garantit ;
- une mutation réussie publie l'invalidation Realtime côté service, pas uniquement depuis le navigateur ;
- un `liveSessionId` est un nom de ressource, jamais une preuve d'autorisation.

Ces prérequis rendent le contrôle live indisponible avant la milestone dédiée.

---

# 19. Documents et recherche

## 19.1 Le MCP n'est pas un moteur de recherche imposé

`documents.search` est un **contrat**, pas une implémentation obligatoire.

Cela permet :

```text
Discovery MCP
    │
DocumentsAdapter
    ├── API hôte
    ├── PostgreSQL
    ├── Elasticsearch
    ├── MongoDB
    ├── SharePoint
    └── autre
```

## 19.2 Contenu textuel des documents

Le Media Player actuel est d'abord un lecteur/trackeur, pas une plateforme universelle d'extraction de texte.

Par conséquent, V1 ne doit pas promettre :

```text
documents.ask
documents.extract_text
documents.semantic_search
```

sans adapter officiel ou implémentation dédiée.

## 19.3 Future DocumentContentAdapter

Prévoir sans implémenter immédiatement :

```ts
export interface DocumentContentAdapter {
  getText(documentId: string, context: OperationContext): Promise<DocumentText | null>;
  searchSemantic?(input: SemanticSearchInput, context: OperationContext): Promise<SemanticSearchResult>;
}
```

Cette extension pourra alimenter une offre d'intelligence documentaire, Open Source ou Enterprise selon la stratégie future.

---

# 20. Authentification

## 20.1 Séparer AuthN et AuthZ

```text
Authentication = Qui es-tu ?
Authorization  = As-tu le droit ?
```

Le MCP ne doit jamais déduire l'autorisation uniquement parce qu'un token est valide.

## 20.2 Stdio

Cas local :

- peut utiliser une identité configurée par le host local ;
- doit rester explicite ;
- ne doit pas automatiquement considérer tout processus local comme administrateur.

Modes possibles :

```text
anonymous read-only setup
developer identity statique explicite
host-provided identity
```

## 20.3 HTTP distant

Pour un serveur protégé, suivre le modèle d'autorisation MCP/OAuth compatible avec la spécification cible.

Le MCP agit comme Resource Server.

Le projet doit pouvoir déléguer l'IdP à l'hôte et éviter d'inventer un système d'identité Discovery propriétaire obligatoire.

Le profil HTTP production exige :

- OAuth Protected Resource Metadata ;
- découverte de l'Authorization Server ;
- Bearer token sur chaque requête ;
- validation de l'audience/resource propre au MCP ;
- challenges `WWW-Authenticate` et scopes cohérents ;
- aucune acceptation d'un token destiné à une autre ressource.

`auth=none` et `auth=static` sont limités au développement sur loopback. Le serveur refuse de démarrer en écoute publique avec ces modes.

## 20.4 Tokens

Le serveur doit vérifier au minimum selon le mode configuré :

- signature ;
- issuer ;
- audience/resource ;
- expiration ;
- scopes/claims nécessaires ;
- révocation si fournie par l'hôte.

Le token entrant n'est jamais transféré au Player, à un adapter documentaire ou à un tiers. Une intégration Runtime distante utilise un échange de token ou une identité service-to-service distincte.

## 20.5 Tenancy V1

La V1 est explicitement mono-tenant par instance. Le `tenantId` est fixé par la composition du serveur et doit correspondre au principal authentifié.

Une offre multi-tenant est hors périmètre tant que le Player ne porte pas une isolation tenant vérifiable dans les tables, index, requêtes, policies et tests.

---

# 21. Autorisation et Policy Adapter

## 21.1 Actions normalisées

Exemples :

```text
documents.search
documents.read
decks.read
decks.create
decks.update
decks.delete
shares.read
shares.create
shares.revoke
shares.set_access
analytics.read
analytics.read_all
live.control
setup.inspect
setup.doctor
```

## 21.2 Aucun rôle métier dans le Core

Le Core ne connaît pas :

```text
commercial
manager
agency_admin
CEO
```

L'hôte peut mapper ces rôles vers des actions.

## 21.3 Cohérence avec le Media Player

Le Media Player possède déjà une décision hôte sur la gestion des shares, avec notamment des notions actuelles de scope `mine` / `all`.

Discovery MCP doit **réutiliser ou respecter cette décision**. Il ne doit pas inventer un troisième scope sans évolution coordonnée du contrat parent.

Un mapping versionné traduit les actions MCP (`shares.create`, `analytics.read`, etc.) vers les décisions historiques du Player (`create`, `overview`, `sessions`, etc.). Envoyer directement de nouveaux noms d'action à un host existant provoquerait un refus fail-closed difficile à diagnostiquer.

## 21.4 Cache de policy

Pas de cache implicite longue durée.

Un éventuel cache :

- doit être configurable ;
- TTL court ;
- clé incluant acteur/action/ressource/tenant ;
- désactivable ;
- jamais utilisé pour prolonger un droit après révocation critique si l'hôte exige de l'instantané.

---

# 22. Sécurité

## 22.1 Threat model principal

Le serveur reçoit des appels générés ou influencés par des modèles. Les entrées doivent être considérées comme non fiables.

Menaces à traiter :

- accès non autorisé à des documents ;
- fuite de secrets ;
- SSRF ;
- path traversal ;
- injection SQL indirecte ;
- escalade de permissions ;
- confusion de tenant ;
- confused deputy entre MCP et Player ;
- token passthrough ou token destiné à une mauvaise audience ;
- utilisation d'un slug/handle comme preuve d'autorisation ;
- replay / double action ;
- prompt injection provenant d'un document ;
- exfiltration via Tools externes ;
- abus de pagination / volumétrie ;
- log de données sensibles ;
- requêtes HTTP malformées ;
- abus du Setup MCP pour lire la machine.
- empoisonnement des sorties via metadata non bornées ;
- spoofing de proxy via `X-Forwarded-*` ;
- fuite de PII dans les headers MCP, logs ou métriques.

## 22.2 Interdictions absolues du Core

Ne jamais publier :

```text
execute_sql
execute_shell
run_command
read_file(path arbitraire)
write_file(path arbitraire)
fetch_url(url arbitraire)
postgrest_query
raw_database_request
raw_storage_request
```

## 22.3 Validation des inputs

Tous les Tools :

- schémas explicites ;
- longueurs maximales ;
- listes bornées ;
- enums ;
- IDs bornés ;
- pagination bornée ;
- dates validées ;
- propriétés inconnues refusées ou traitées selon une règle uniforme documentée.

Utiliser un validateur compatible Standard Schema, avec Zod v4 comme choix initial recommandé.

## 22.4 HTTP Origin / Host

Le transport HTTP doit appliquer les protections recommandées par le SDK et la spécification :

- validation Origin ;
- validation Host selon l'intégration ;
- HTTPS hors localhost ;
- méthodes HTTP strictement nécessaires ;
- Content-Type strict ;
- body size limit.

## 22.5 SSRF

Aucun Tool ne peut transformer Discovery MCP en fetcher général.

`setup.doctor` et autres sondes ne testent que des endpoints déjà configurés et autorisés.

## 22.6 Fichiers

Le MCP doit déléguer l'accès fichier au système sécurisé existant ou à un adapter dédié.

Il ne doit pas contourner `storage.isAllowedUrl` ou l'équivalent métier.

## 22.7 Secrets

Ne jamais retourner les valeurs de :

- variables sensibles ;
- tokens ;
- clés Supabase ;
- cookies ;
- API keys ;
- secrets de route hôte.

Les Tools Setup peuvent dire :

```text
present / missing / malformed
```

mais pas :

```text
value = eyJhbGci...
```

## 22.8 Prompt injection

Les données provenant de documents ou métadonnées doivent être retournées comme **données**, pas incorporées dans des instructions système du MCP.

Le MCP ne doit pas suivre les instructions trouvées dans un document.

## 22.9 Confirmation des actions destructives

Le MCP serveur applique les permissions indépendamment de toute UI de confirmation du client.

Les annotations MCP peuvent aider le Host mais ne sont pas un mécanisme de sécurité.

---

# 23. Modèle d'erreurs

## 23.1 But

Les erreurs externes doivent être stables, métier et indépendantes du backend.

## 23.2 Codes cibles

```text
DISCOVERY_NOT_FOUND
DISCOVERY_UNAUTHENTICATED
DISCOVERY_FORBIDDEN
DISCOVERY_INVALID_INPUT
DISCOVERY_CONFLICT
DISCOVERY_RATE_LIMITED
DISCOVERY_CAPABILITY_UNAVAILABLE
DISCOVERY_DEPENDENCY_UNAVAILABLE
DISCOVERY_COMPATIBILITY_ERROR
DISCOVERY_TIMEOUT
DISCOVERY_INTERNAL_ERROR
```

## 23.3 Ne jamais exposer directement

```text
SQLSTATE
PostgREST raw response
nom de table interne
stack trace production
secret
filesystem path sensible
```

## 23.4 Structure interne

```ts
interface DiscoveryError {
  code: DiscoveryErrorCode;
  message: string;
  retryable?: boolean;
  details?: Record<string, unknown>; // sanitised
  cause?: unknown;                  // internal only
}
```

---

# 24. Idempotence et concurrence

Les agents peuvent répéter un Tool parce que :

- la réponse s'est perdue ;
- le Host retry ;
- le modèle hésite ;
- un timeout a eu lieu.

## 24.1 `idempotencyKey`

À prévoir pour les actions créatrices :

```text
decks.create
shares.create
decks.add_documents
```

## 24.2 Actions intrinsèquement idempotentes

Exemples possibles :

```text
live.go_to_page(5)
shares.set_access(requireAuth=true)
```

Les implémentations doivent être testées comme telles avant de déclarer `idempotentHint: true`.

## 24.3 Concurrence

Prévoir les cas :

- deux agents modifient la même présentation ;
- un share est révoqué pendant lecture ;
- deux reorder simultanés ;
- double création avec même idempotency key.

Si le Core parent n'offre pas de version/ETag, le MCP ne doit pas simuler une garantie qu'il ne peut pas tenir.

---

# 25. Observabilité et audit

## 25.1 Événement Tool

Chaque appel doit pouvoir produire :

```ts
{
  requestId: string;
  traceId?: string;
  actorId?: string;
  tenantId?: string;
  tool: string;
  resourceType?: string;
  resourceId?: string;
  success: boolean;
  errorCode?: string;
  durationMs: number;
  timestamp: string;
}
```

## 25.2 Pas de payload sensible par défaut

Ne pas logger :

- document complet ;
- email complet si inutile ;
- token ;
- contenu de secret ;
- texte intégral d'un document.

## 25.3 Adapter d'audit

```ts
export interface AuditSink {
  emit(event: AuditEvent): Promise<void> | void;
}
```

Open Source peut fournir :

- console JSON ;
- no-op ;
- fichier local optionnel.

Enterprise pourra fournir :

- audit centralisé ;
- conservation ;
- recherche ;
- conformité.

## 25.4 OpenTelemetry

Prévoir une intégration optionnelle sans dépendance obligatoire du Core.

---

# 26. Protocole MCP et transports

## 26.1 Version cible

Cible initiale :

```text
MCP 2026-07-28
```

Cette version est stateless au niveau du protocole : le design Discovery MCP ne doit pas dépendre d'une session MCP persistante.

## 26.2 SDK

Utiliser la ligne stable v2 du SDK TypeScript officiel :

```text
@modelcontextprotocol/server
@modelcontextprotocol/client   // tests / exemples uniquement si nécessaire
```

Middleware Node/Express/Fastify/Hono seulement si réellement utile.

## 26.3 Stdio

Usage :

- Claude Code / coding agents locaux ;
- tests ;
- développement ;
- installation Setup MCP.

Commande cible :

```bash
discovery-mcp --stdio --profile setup
```

## 26.4 Streamable HTTP

Usage : serveur distant / production.

Endpoint :

```text
POST /mcp
```

Le serveur doit être conçu stateless et horizontalement scalable.

## 26.5 État métier

Si une opération nécessite un état entre plusieurs appels, cet état doit être représenté par un handle métier explicite :

```text
presentationId
shareId
slug
```

et non par une session MCP cachée.

## 26.6 Compatibilité legacy

V0/V1 ne doit pas s'encombrer de clients MCP historiques sauf besoin réel identifié.

Politique recommandée :

- supporter la version cible actuelle ;
- documenter les versions compatibles ;
- ajouter une compatibilité legacy uniquement avec tests dédiés.

---

# 27. Configuration

## 27.1 Philosophie

- Embedded : privilégier l'injection de contexte.
- Standalone : variables d'environnement.

## 27.2 Variables cibles

Noms provisoires :

```text
DISCOVERY_MCP_PROFILE=runtime|setup|docs|all
DISCOVERY_MCP_TRANSPORT=stdio|http
DISCOVERY_MCP_HOST=127.0.0.1
DISCOVERY_MCP_PORT=3100
DISCOVERY_MCP_PUBLIC_URL=https://...
DISCOVERY_MCP_AUTH_MODE=none|static|oauth|host
DISCOVERY_MCP_WORKSPACE_ROOT=/path
DISCOVERY_MCP_LOG_LEVEL=info
```

Éventuellement :

```text
DISCOVERY_PLAYER_BASE_URL
```

si le Runtime Adapter fonctionne en remote.

## 27.3 Aucun secret dans `system.info`

`system.info` peut indiquer :

```text
auth configured: yes
```

mais pas révéler la configuration secrète.

---

# 28. Structure du repository

Structure cible proposée :

```text
discovery-mcp/
│
├── src/
│   ├── server/
│   │   ├── create-server.ts
│   │   ├── capabilities.ts
│   │   └── registry.ts
│   │
│   ├── transports/
│   │   ├── stdio.ts
│   │   └── http.ts
│   │
│   ├── tools/
│   │   ├── system/
│   │   ├── documents/
│   │   ├── presentations/
│   │   ├── shares/
│   │   ├── analytics/
│   │   ├── live/
│   │   └── setup/
│   │
│   ├── resources/
│   │   ├── runtime/
│   │   └── docs/
│   │
│   ├── prompts/
│   │
│   ├── discovery/
│   │   ├── facade.ts
│   │   ├── services/
│   │   ├── types.ts
│   │   └── capabilities.ts
│   │
│   ├── adapters/
│   │   ├── runtime.ts
│   │   ├── documents.ts
│   │   ├── auth.ts
│   │   ├── policy.ts
│   │   ├── setup.ts
│   │   ├── docs.ts
│   │   ├── audit.ts
│   │   └── logger.ts
│   │
│   ├── context/
│   │   ├── create-context.ts
│   │   ├── standalone.ts
│   │   └── types.ts
│   │
│   ├── auth/
│   ├── policy/
│   ├── validation/
│   ├── errors/
│   ├── observability/
│   └── cli/
│
├── contracts/               # candidat MIT, à valider
│   ├── types.ts
│   ├── adapters.ts
│   └── LICENSE-MIT
│
├── tests/
│   ├── unit/
│   ├── contract/
│   ├── integration/
│   ├── security/
│   └── e2e/
│
├── examples/
│   ├── setup-stdio/
│   ├── runtime-stdio/
│   ├── runtime-http/
│   ├── embedded/
│   └── custom-documents-adapter/
│
├── docs/
│   ├── ARCHITECTURE.md
│   ├── TOOLS.md
│   ├── SETUP.md
│   ├── AUTH.md
│   ├── SECURITY.md
│   ├── HOST-CONTRACT.md
│   ├── COMPATIBILITY.md
│   └── ROADMAP.md
│
├── AGENTS.md
├── README.md
├── LICENSE
├── CLA.md
├── CONTRIBUTING.md
├── SECURITY.md
├── CHANGELOG.md
├── Dockerfile
├── docker-compose.yml
├── package.json
├── tsconfig.json
├── eslint.config.mjs
└── vitest.config.mjs
```

---

# 29. Intégration avec Discovery Media Player

## 29.1 Repository séparé

Décision recommandée : **repository distinct**.

Raisons :

- le Media Player ne dépend pas du SDK MCP ;
- cycle de release indépendant ;
- déploiement séparé possible ;
- surface sécurité distincte ;
- poids du Player inchangé ;
- Open Source / Enterprise plus lisible ;
- agents IA optionnels.

## 29.2 Pas de deep import

Interdit :

```ts
import something from "discovery-media-player/server/private/internal/file.js";
```

Le MCP doit utiliser :

- exports publics existants ;
- ou une nouvelle petite surface publique ajoutée proprement au Media Player.

## 29.3 Extraction de logique si nécessaire

Si une capacité existe uniquement dans un handler HTTP :

```text
handler HTTP
   │
   └── logique métier enfouie
```

il faut préférer :

```text
Business Service
   ▲       ▲
   │       │
Player    MCP
```

plutôt que copier le handler.

## 29.4 Ordre de déploiement

Respecter le principe actuel du Media Player : lorsqu'une version MCP dépend d'une nouvelle surface Player, la surface Player doit être publiée/déployée avant le MCP qui l'exige.

## 29.5 Compatibility Probe

Le Runtime Adapter doit pouvoir lire l'identité de l'instance Player :

```text
product
contract
version
capabilities
```

et refuser clairement de démarrer ou désactiver les Tools incompatibles.

---

# 30. Portabilité des backends

## 30.1 État actuel

Le Media Player a actuellement une surface DB syntaxiquement PostgREST-shaped. La logique utilisée est volontairement simple, mais le contrat n'est pas encore un adapter SQL générique.

Discovery MCP doit éviter d'amplifier ce couplage.

## 30.2 Règle MCP

Un Tool ne connaît jamais :

```text
commercial_doc_shares?slug=eq...
Prefer: return=representation
Range: ...
```

Il appelle :

```text
shares.get(...)
```

## 30.3 Future évolution

Si le Media Player introduit un jour un `DatabaseAdapter` réellement portable :

```text
PostgREST
SQL Server adapter
Mongo adapter
etc.
```

le MCP doit en bénéficier sans changer sa surface Tools.

---

# 31. Déploiement

## 31.1 Local Setup

```text
Coding Agent
    │ stdio
    ▼
Discovery MCP --profile setup
```

Aucune écoute réseau nécessaire.

## 31.2 Runtime standalone HTTP

```text
MCP Host
   │ HTTPS
   ▼
/mcp
   │
Discovery MCP
   │
Discovery Runtime Adapter
   │
Media Player / Host
```

## 31.3 Embedded Node

Une application peut créer le serveur MCP avec son propre contexte :

```ts
const mcp = createDiscoveryMcpServer({ context });
```

Le package ne doit pas imposer Express.

## 31.4 Docker

Image officielle cible :

```text
ghcr.io/.../discovery-mcp
```

Le container :

- utilisateur non-root si possible ;
- filesystem read-only lorsque compatible ;
- healthcheck ;
- aucune persistance locale requise en runtime stateless ;
- secrets via mécanisme de runtime, pas baked dans l'image.

## 31.5 Health endpoint

En HTTP :

```text
GET /health
```

Réponse minimale :

```json
{ "status": "ok" }
```

Pas de secrets ni dump de configuration.

Un endpoint readiness séparé pourra vérifier les dépendances configurées :

```text
GET /ready
```

---

# 32. Versioning et compatibilité

## 32.1 Deux notions de version

Ne pas confondre :

1. version du package `discovery-mcp` ;
2. étapes de roadmap `V0`, `V1`, `V2` utilisées dans ce document.

Les étapes V0/V1 ne sont **pas** des promesses de semver.

## 32.2 SemVer

Package :

```text
0.x → surface encore évolutive
1.0 → contrats publics stabilisés
```

## 32.3 Matrice de compatibilité

Maintenir `docs/COMPATIBILITY.md` :

| Discovery MCP | MCP Protocol | Media Player min | Contract | Notes |
|---|---|---|---|---|
| 0.x | 2026-07-28 | à définir | 1+ | draft |
| 1.0 | à définir | à définir | à définir | stable |

## 32.4 Capabilities plutôt que version quand possible

Une Tool doit privilégier la présence d'une capability à une comparaison fragile de version.

Version minimum uniquement lorsqu'une rupture de contrat l'impose.

---

# 33. Tests

## 33.1 Philosophie

Une fonctionnalité n'est pas terminée sans test qui échoue lorsque son comportement est cassé.

## 33.2 Tests par Tool

Chaque Tool doit avoir au minimum :

```text
schema success
schema invalid input
unauthenticated
forbidden
not found
capability unavailable
success
backend/dependency error
error sanitisation
```

Tool d'écriture :

```text
idempotency
retry
concurrency applicable
side effect exact
permission recheck
```

## 33.3 Tests contractuels

Tester les adapters indépendamment :

```text
DocumentsAdapter contract
AuthAdapter contract
PolicyAdapter contract
RuntimeAdapter contract
SetupAdapter contract
```

## 33.4 E2E MCP réel

Ne pas tester uniquement les fonctions TypeScript.

### Stdio

```text
MCP Client
   ↓ stdio
Discovery MCP
   ↓
Mock Facade
```

### HTTP

```text
MCP Client
   ↓ POST /mcp
Discovery MCP
   ↓
Mock Facade
```

Vérifier :

- server/discover (si utilise) et tools/list selon SDK ;
- tools/call ;
- structured output ;
- erreurs ;
- auth HTTP ;
- protocol headers ;
- absence d'état caché entre requests.

## 33.5 Tests sécurité obligatoires

```text
SQL injection impossible
PostgREST injection impossible
SSRF impossible
path traversal impossible
workspace escape impossible
permission bypass impossible
cross-tenant leak impossible
secret leakage impossible
private URL leakage impossible
oversized input rejected
unknown destructive action impossible
HTTP origin validation
Host validation
logs sanitised
```

## 33.6 Fuzzing

Ajouter plus tard un fuzz léger sur :

- slugs ;
- IDs ;
- URLs configurées ;
- query search ;
- metadata ;
- input schemas.

## 33.7 CI

Minimum :

```text
npm ci
npm run lint
npm run typecheck
npm test
npm run test:e2e
npm run build
```

---

# 34. Documentation publique

Le repository doit permettre à un développeur de comprendre le projet sans lire le code.

## 34.1 README

Doit expliquer en moins de 5 minutes :

- ce qu'est Discovery MCP ;
- différence Runtime / Setup ;
- comment lancer en stdio ;
- comment lancer en HTTP ;
- comment connecter un client ;
- quels Tools existent ;
- sécurité de base ;
- lien vers le Media Player.

## 34.2 Docs minimales

```text
ARCHITECTURE.md
TOOLS.md
SETUP.md
AUTH.md
SECURITY.md
HOST-CONTRACT.md
COMPATIBILITY.md
ROADMAP.md
```

## 34.3 AGENTS.md

Créer un fichier destiné aux coding agents.

Il doit commencer par une règle équivalente à :

> Discovery MCP exposes Discovery business capabilities to AI agents. It is not a database gateway and not a general-purpose shell.

Invariants :

1. Never expose arbitrary SQL.
2. Never expose raw PostgREST.
3. Never expose arbitrary shell or filesystem access.
4. Never duplicate Discovery business logic.
5. Never import host-specific business logic into the Core.
6. Every Tool requires schema validation, permission and tests.
7. Missing permission means deny.
8. Keep the MCP provider-agnostic.
9. Open Source must remain usable without Enterprise.
10. Enterprise must never become a dependency of the Open Source Core.
11. Setup tools inspect only the configured workspace and endpoints.
12. Implement only the requested roadmap milestone unless the architecture contract itself requires otherwise.

---

# 35. Extensibilité

## 35.1 But

Permettre à la communauté et aux intégrateurs d'ajouter des capacités sans forker le Core.

## 35.2 Extension points

```text
DocumentsAdapter
DocumentContentAdapter
AuthAdapter
PolicyAdapter
AuditSink
DocsAdapter
SetupAdapter
RuntimeAdapter
custom Tools
custom Resources
```

## 35.3 Custom Tools

Une extension peut enregistrer ses Tools via une API contrôlée.

Mais le Core doit distinguer :

```text
Official Discovery Tool
Third-party Tool
```

et éviter qu'une extension se fasse passer silencieusement pour une Tool officielle.

## 35.4 Namespaces tiers

Recommandation :

```text
x.<vendor>.<tool>
```

ou mécanisme équivalent à figer avant l'Extension API.

## 35.5 Security boundary

Le système d'extension ne garantit pas la sécurité d'une extension non fiable exécutée dans le même process.

Documentation explicite : installer une extension = exécuter du code avec les droits du serveur.

---

# 36. Roadmap par versions

> Les versions V0, V1, V2… sont des **milestones de livraison**, pas les numéros SemVer du package.

---

## V0 — Foundation

### Objectif

Poser le squelette et les contrats sans fonctionnalités métier ambitieuses.

### Livrables

- nouveau repository ;
- TypeScript ;
- Node >=22 ;
- MCP TypeScript SDK v2 ;
- Zod v4 ou Standard Schema compatible ;
- Vitest ;
- ESLint ;
- `DiscoveryMcpContext` ;
- `DiscoveryFacade` ;
- contracts adapters ;
- capability registry ;
- error model ;
- policy deny-by-default ;
- stdio ;
- Streamable HTTP ;
- `system.info` ;
- `/health` ;
- Dockerfile ;
- tests E2E stdio ;
- tests E2E HTTP ;
- `ARCHITECTURE.md` ;
- `HOST-CONTRACT.md` ;
- `AGENTS.md`.

### Explicitement hors V0

```text
documents.search
shares.create
decks.create
analytics
live
```

### Acceptation

```text
npm ci             ✅
npm run build      ✅
npm run lint       ✅
npm run typecheck  ✅
npm test           ✅
npm run test:e2e   ✅
```

Un client MCP peut appeler `system.info` via stdio et HTTP.

---

## V1 — Runtime Read Only

### Objectif

Donner une première valeur produit sans aucune mutation métier.

### Tools

```text
documents.search
documents.get
decks.list
decks.get
shares.get
shares.list
analytics.document
analytics.share
```

### Caractéristiques

- read-only ;
- permissions réelles ;
- aucune écriture ;
- outputs structurés ;
- pagination ;
- capability detection ;
- error sanitisation.

### Cas utilisateurs

> Trouve la brochure OceanSide.

> Quelles présentations existent ?

> Est-ce que ce lien a été ouvert ?

### Acceptation

Aucune Tool visible ne doit permettre de modifier une donnée.

---

## V1.5 — Developer Experience / Setup MCP

### Objectif

Permettre à un coding agent d'installer et diagnostiquer Discovery plus fiablement.

### Tools

```text
setup.requirements
setup.inspect
setup.validate_config
setup.doctor
setup.integration_guide
setup.compatibility
```

### Caractéristiques

- read-only sur le workspace ;
- aucune commande shell arbitraire ;
- aucune écriture automatique ;
- secrets masqués ;
- diagnostics déterministes ;
- fonctionne sans DB.

### Cas utilisateurs

> Vérifie si mon projet est prêt pour Discovery.

> Pourquoi le realtime ne marche pas ?

> Donne-moi l'intégration correcte pour ce projet Next.js.

---

## V2 — Presentations Write

### Objectif

Permettre aux agents de construire des présentations.

### Tools

```text
decks.create
decks.update
decks.add_documents
decks.remove_document
decks.reorder
```

### Exigences

- idempotency ;
- audit ;
- permissions ;
- aucune URL fichier arbitraire ;
- logique du Core parent réutilisée.

---

## V3 — Shares Write

### Objectif

Créer et administrer des liens trackés par agent.

### Tools

```text
shares.create
shares.revoke
shares.set_access
```

### Cas utilisateur

> Crée un lien tracké pour Martin.

### Exigences

- cible résolue par ID ;
- scope strict ;
- idempotence de création ;
- révocation auditée ;
- URLs publiques produites par `LinkBuilder`.

---

## V4 — Analytics avancés

### Objectif

Faire de Discovery une source d'activité exploitable par les agents.

### Tools

```text
analytics.overview
analytics.recipient
activity.search
```

### Règle

Retourner des faits. Ne pas imposer de score IA propriétaire dans le Core.

---

## V5 — Resources + Docs MCP

### Objectif

Exposer le contexte Discovery via Resources et fournir une documentation agent-native.

### Livrables

```text
discovery://...
discovery-docs://...
```

Plus recherche documentaire de la doc si utile.

---

## V6 — Live Control

### Tools

```text
live.start
live.status
live.show_document
live.go_to_page
live.next_page
live.previous_page
live.end
```

### Règle

MCP commande ; Realtime diffuse.

---

## V7 — Extension SDK

### Objectif

Permettre des adapters et extensions tierces stables.

### Livrables

- API extension documentée ;
- contracts versionnés ;
- exemple custom document adapter ;
- exemple custom auth ;
- custom Tools namespace ;
- tests contractuels publiés.

---

## V8 — 1.0 Hardening

### Objectif

Passer d'un projet évolutif à une surface publique stable.

### Travail

- audit sécurité ;
- tests de charge ;
- multi-tenant review ;
- compatibilité clients MCP ;
- documentation exhaustive ;
- observabilité ;
- auth HTTP production ;
- rate-limit hooks ;
- backward compatibility policy ;
- migration guide ;
- package NPM ;
- image GHCR ;
- release process ;
- CHANGELOG propre ;
- security policy.

### Résultat

```text
discovery-mcp 1.0.0
```

---

# 37. Périmètre Enterprise futur

Cette partie décrit la frontière produit future, mais **ne doit pas être développée avant que le Core le justifie**.

## 37.1 Discovery AI Gateway

```text
                    AI Hosts
             ┌────────┼────────┐
             ▼        ▼        ▼
          ChatGPT   Claude   Copilot
             └────────┼────────┘
                      ▼
             Discovery AI Gateway
                 ENTERPRISE
                      │
        ┌─────────────┼─────────────┐
        ▼             ▼             ▼
 Discovery MCP     CRM MCP       Email MCP
     OPEN
```

## 37.2 Capacités Enterprise potentielles

### Identity / Governance

```text
SSO
OIDC
SAML
SCIM
central RBAC
organisation policies
agent allowlists
```

### Audit

```text
central audit
retention
search
compliance exports
alerts
```

### Gateway

```text
multi-MCP routing
policy enforcement
tool allow/deny
quotas
rate limiting
agent identity
```

### Managed Cloud

```text
hosting
updates
monitoring
backups
SLA
support
managed auth
```

### Intelligence documentaire

```text
OCR
text extraction
embeddings
semantic search
classification
summaries
version intelligence
duplicate detection
```

### Content Intelligence

```text
content performance
page performance
obsolete content detection
presentation comparison
```

### Sales Intelligence

```text
engagement signals
interest score
follow-up recommendation
reader intent
```

Ces scores doivent être construits au-dessus des faits Core, jamais modifier les mesures brutes.

---

# 38. Décisions à figer avant développement

Les éléments suivants doivent être relus et explicitement validés avant d'ouvrir V0.

## 38.1 Nom et repository

Proposition :

```text
Discovery MCP
discovery-mcp
```

## 38.2 Licence

Proposition :

```text
Core AGPL-3.0-or-later
contracts MIT
CLA
```

Validation juridique nécessaire.

## 38.3 SDK

Proposition :

```text
MCP TypeScript SDK v2
MCP spec 2026-07-28
Node >=22
```

## 38.4 Profils

À confirmer :

```text
runtime
setup
docs
all
```

## 38.5 Surface publique côté Media Player

Audit à faire avant V1 :

- quelles fonctions `shares` sont déjà réutilisables proprement ?
- quelles fonctions `presentations` sont déjà réutilisables ?
- quels analytics doivent être extraits du handler ?
- faut-il publier un `DiscoveryRuntimeAdapter` officiel dans le Media Player ?

## 38.6 DocumentsAdapter

Confirmer que `documents.search` est un contrat hôte et non un accès direct à une table Discovery.

## 38.7 Auth remote

Choisir l'implémentation de référence OAuth/host pour le premier serveur HTTP protégé.

## 38.8 Setup MCP

Confirmer la règle : **lecture/diagnostic/génération de snippets uniquement**, pas d'écriture ou shell générique dans la première génération.

---

# 39. Definition of Done globale

Une version n'est terminée que si :

## Code

```text
build        ✅
typecheck    ✅
lint         ✅
unit tests   ✅
E2E          ✅
```

## Architecture

```text
no raw SQL exposed             ✅
no raw PostgREST exposed       ✅
no host business coupling      ✅
no duplicated player logic     ✅
capabilities explicit          ✅
```

## Security

```text
permission on every protected Tool   ✅
validation on every Tool             ✅
secret leakage tests                 ✅
SSRF/path traversal tests            ✅
error sanitisation                   ✅
```

## Documentation

```text
Tool documented        ✅
permissions documented ✅
examples updated       ✅
CHANGELOG updated      ✅
compatibility updated  ✅
```

## Open Source boundary

```text
Core works without Enterprise ✅
no commercial dependency      ✅
```

---

# 40. Références techniques

Sources de référence à relire avant implémentation :

## Discovery Media Player

- Repository : `https://github.com/Juli1artha/discovery-media-player`
- Architecture : `https://github.com/Juli1artha/discovery-media-player/blob/main/docs/ARCHITECTURE.md`
- API : `https://github.com/Juli1artha/discovery-media-player/blob/main/docs/API.md`
- Configuration : `https://github.com/Juli1artha/discovery-media-player/blob/main/docs/CONFIGURATION.md`
- Package : `https://github.com/Juli1artha/discovery-media-player/blob/main/package.json`
- Licence : `https://github.com/Juli1artha/discovery-media-player/blob/main/LICENSE`

## Model Context Protocol

- Specification 2026-07-28 : `https://modelcontextprotocol.io/specification/2026-07-28`
- Streamable HTTP : `https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http`
- TypeScript SDK v2 : `https://github.com/modelcontextprotocol/typescript-sdk`
- TypeScript SDK docs v2 : `https://ts.sdk.modelcontextprotocol.io/v2/`

---

# Conclusion

Discovery MCP doit être construit comme **une nouvelle interface de Discovery**, au même titre que le Media Player est une interface humaine.

La règle directrice du projet est :

> **Expose Discovery, pas son infrastructure.**

Le bon chemin est :

```text
Agent IA
   │
   ▼
Discovery MCP
   │
   ▼
DiscoveryFacade
   │
   ▼
Business capabilities / adapters
   │
   ▼
Discovery Media Player / host / storage / DB
```

Le mauvais chemin est :

```text
Agent IA
   │
   ▼
MCP
   │
   ▼
SQL / PostgREST / filesystem brut
```

Le projet doit également reconnaître que l'IA intervient **avant** le runtime : les coding agents deviennent une nouvelle population d'utilisateurs du projet Open Source. C'est la raison du profil `setup`, qui doit rendre Discovery plus simple à installer et diagnostiquer tout en restant strictement borné et sûr.

Enfin, le Core MCP doit rester suffisamment ouvert et autonome pour devenir un moteur d'adoption du projet. La valeur Enterprise future sera construite **au-dessus** de ce Core — gouvernance, hébergement, sécurité organisationnelle, Gateway, intelligence — et non par la suppression de capacités essentielles de l'édition Open Source.

---

**Fin de la spécification — Draft à relire avant passage à la stratégie de développement et à l'organisation des agents.**
