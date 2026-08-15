# Suivi de l'audit externe du 14 août 2026

Audit reçu le 14/08/2026 sur la version `0.1.17`. Ce fichier suit ce qui est **fait**, ce qui est
**décidé mais pas fait**, et ce qui est **écarté avec sa raison** — pour qu'aucun constat ne se
perde entre une lecture et la suivante.

> **Règle de ce fichier** : une ligne ne passe à *fait* qu'après vérification sur l'artefact ou par
> mutation, jamais sur la foi d'un commit. C'est la leçon de l'incident 0.1.15, où une version a été
> publiée sans le correctif qu'elle annonçait.

## P0 — critique

| | Constat | État |
|---|---|---|
| P0-1 | Le relais suivait les redirections ; le secret de l'hôte suivait avec | ✅ **0.1.18** |
| P0-2 | Canal Realtime public : tout participant peut émettre un état autoritatif | ✅ relecture **0.1.19** · titre **0.1.28** (0.1.25 était une fausse preuve) · relecture non affamable **0.1.29** · `map` **0.1.30** · ordre écriture→signal **0.1.31** · reste : canal privé (voie trouvée, cf. ci-dessous) |

### P0-1 — redirections du relais ✅

Corrigé en `0.1.18`. Sauts suivis à la main, garde repassée à chaque saut, **secret recalculé par
saut**, chaîne bornée, `file:` refusé, `AbortSignal.timeout`.

Vérifié : 12 tests dédiés, mutation (8 tombent sans le correctif), et présence du correctif
constatée **dans le tarball npm publié**, pas dans l'arbre de travail.

### P0-2 — intégrité du canal Realtime 🔧

**Deux remèdes possibles, et le premier proposé par l'audit ne suffit pas.** Faire émettre le
serveur ne change rien sur un canal *public* : un attaquant peut toujours émettre, et le client ne
distingue pas les deux sources. Il faut soit empêcher l'émission, soit cesser de faire confiance à
ce qui arrive.

**B — la diffusion devient un signal, pas une vérité.** ✅ *0.1.19*
À réception, le client revérifie auprès du serveur : `state` → route `state=1` ; `msg` → relecture.
La défense cesse de dépendre du transport. Un attaquant peut toujours émettre — il n'obtient plus
rien. Coût : un aller-retour HTTP par événement.

**A — canal privé + RLS.** *(décidé, à faire rapidement — prochain chantier de sécurité)*
Seul le `service_role` écrit. C'est la solution propre, et elle reste souhaitable **après** B :
elle évite le trafic de revérification et ferme l'émission elle-même. Obstacle à traiter :
l'audience est **anonyme**, donc il faut fabriquer des jetons courts pour des visiteurs sans
compte, plus les politiques sur `realtime.messages`. C'est une infrastructure, pas un correctif —
d'où l'ordre B puis A.

### ⚠️ Le volet A n'est pas le chantier qu'on croyait (15/08/2026)

Le suivi annonçait « canal Realtime privé + politiques par ligne ». En le préparant, une phrase de
l'audit a tranché autrement : l'attaquant y est décrit comme **« tout participant connaissant le
slug »**.

Un canal privé exclut qui n'a pas le droit d'y être. **Cet attaquant-là a le droit d'y être** — il
détient le lien, et le slug est déjà la clé qui ouvre le chat et l'état par les routes HTTP. Le
rendre privé n'aurait donc rien fermé du scénario décrit, tout en demandant une authentification
Supabase pour une audience anonyme (jetons courts, renouvellement en cours de présentation, table
de droits, RLS sur `realtime.messages`).

Ce qui sépare réellement un participant du présentateur est le `control_token`. Trois endroits
accordaient un statut sans le vérifier — corrigés en **0.1.25** : `present-attend` (les deux
drapeaux venaient du corps), `present-chat` (`isMember` seul restait déclaratif), et le badge de la
liste des participants (tiré de la charge de présence, que chacun compose). ⚠️ Ce dernier ne se
corrige PAS au niveau du canal : un participant légitime a le droit d'écrire sa propre présence.

**Ce qu'un canal privé apporterait encore**, et qui reste ouvert : empêcher physiquement l'audience
d'émettre `map` (mouvements de carte appliqués tels quels par choix, cf. 0.1.19) et tout événement
autoritaire ajouté demain sans y penser. `realtime.messages` porte `topic`, `extension` ET `event`,
donc la règle est exprimable — audience en lecture plus sa propre présence, présentateur en
écriture. Ça reste souhaitable ; ce n'est plus un P0, et ça demande une authentification que le
projet n'a pas aujourd'hui (clés Supabase asymétriques : on ne peut pas signer soi-même un jeton).

### Le canal privé : la voie est trouvée (15/08/2026, proposée par Julien, précisée avec ADV)

Le blocage annoncé plus haut — « clés asymétriques, on ne peut pas signer soi-même » — était une
conclusion juste sur une question mal posée. Il ne faut pas signer, il faut **faire signer** :
`signInAnonymously()` émet un vrai jeton signé par le projet, avec un `sub` distinct par visiteur,
que Realtime vérifie nativement. Les politiques sur `realtime.messages` deviennent exprimables en
joignant le `sub` à une table de participants portant le slug — audience en lecture plus sa propre
présence, présentateur en écriture.

**Sur le projet du PLAYER, pas sur celui de l'hôte.** Y créer un utilisateur par spectateur ferait
grossir la table d'authentification de l'application avec des identités qui ne lui appartiennent
pas. C'est la frontière qui a fait séparer `PLAYER_AUTH_URL` de `SUPABASE_URL` en 0.1.8, appliquée
dans l'autre sens.

⚠️ **Prérequis chez nous** : le player du studio tourne sur `env.SUPABASE_URL`, donc sur le projet
du studio — nos tables de présentation et nos vrais utilisateurs partagent le même `auth.users`.
ADV a un projet dédié dont l'`auth.users` est vide et le restera : leur purge peut être
inconditionnelle, la nôtre devra impérativement porter `is_anonymous`, qui sera la seule chose
protégeant nos comptes. **Séparer le projet d'abord.**

Quatre points mesurés par ADV, à ne pas redécouvrir :

1. **Supabase ne purge rien tout seul** — « Automatic cleanup of anonymous users is currently not
   available ». La purge écrite est obligatoire, pas préférable.
2. **30 connexions anonymes par heure et par IP** par défaut. Une audience derrière le NAT d'une
   entreprise, c'est UNE adresse : le 31ᵉ spectateur échoue, pour lui seul, sans raison visible.
   À relever au tableau de bord **avant** la première grande présentation, pas après.
3. ⚠️ **`created_at` est le mauvais critère**, et c'est notre propre conseil qui le rend faux :
   persister la session pour qu'un visiteur qui recharge réutilise son identité donne à un visiteur
   fidèle une date de création ancienne et une session vivante. Purger dessus couperait un
   spectateur **pendant** une présentation — il perdrait présence et badge sans qu'aucune erreur ne
   le dise. Le critère est la dernière activité (`last_sign_in_at`, ou le `last_seen` de la table
   des participants).
4. **La purge appartient au player, exposée comme une action** ; l'exploitant branche son
   ordonnanceur. Une purge écrite chez l'hôte deviendrait fausse à chaque colonne ajoutée — le
   défaut exact du re-partage par liste (0.1.14). Ne pas imposer `pg_cron` : c'est une décision
   d'exploitation, pas une dépendance.

Ce que ça fermerait : l'audience ne pourrait plus **physiquement** émettre `map` ni aucun événement
autoritaire ajouté demain sans y penser. Ce que ça ne ferme pas, et il ne faut pas s'y attendre :
le participant qui détient le slug reste légitime — c'est ce que 0.1.25/0.1.26 corrigent autrement.
**Les deux sont complémentaires : l'un exclut le dehors, l'autre discipline le dedans.**

### L'identité du membre ne peut pas venir du `localStorage` (15/08/2026)

Corrigé à moitié en **0.1.27** : la clé est devenue un réglage (`PLAYER_HOST_AUTH_STORAGE_KEY`,
défaut vide) au lieu d'être `3dd-supabase-auth` en dur pour tous les hôtes.

⚠️ **Mais le mécanisme lui-même est faux.** Lire le `localStorage` d'une autre application ne peut
pas marcher quand les origines diffèrent : ADV sert le player sur `doc.adnfamily.com` et son
application sur `app.adnfamily.com` — deux `localStorage`, aucune valeur de configuration n'y
changera rien. Leurs membres ne sont donc reconnus par aucun réglage.

Le bon mécanisme : l'hôte **injecte** son membre au rendu de la page, comme il injecte déjà sa
marque et son jeton interne signé (0.1.22). À faire.

## P1 — important

| | Constat | Décision |
|---|---|---|
| P1-1 | Les emails de re-partage font confiance à l'en-tête `Host` | ✅ **0.1.21** puis **0.1.33** — l'envoi est REFUSÉ sans URL publique (une alerte ne bloque rien) |
| P1-2 | Écritures d'analytics : le client choisit `internal`, `isMember`, `isPresenter` | ✅ **interne 0.1.22** · **présence 0.1.25/0.1.28** · **dictionnaires à prototype 0.1.32** |
| P1-3 | PDF.js 3.11.174 concerné par CVE-2024-4367 | 🟡 **atténué en 0.1.21** — migration ESM à part |
| P1-4 | Fichiers entièrement tamponnés, pas de délai maximal | partiellement fait |
| P1-5 | Idempotence des liens hôte non atomique (`SELECT` puis `INSERT`) | à faire — index unique partiel |
| P1-6 | Limites de débit contournables par `X-Forwarded-For` | ✅ **0.1.22** — `PLAYER_TRUSTED_PROXY_HOPS` |
| P1-7 | Aucune politique de rétention des données personnelles | à décider — hors technique seul |

**P1-3** — `isEvalSupported: false` est forcé sur les trois appels depuis `0.1.21` : la protection
ne dépend plus d'un en-tête CSP écrit ailleurs. **Ce qui reste** : cdnjs ne publie plus que des
modules ES à partir de 4.0, alors qu'on charge un script classique et qu'on configure le worker à
la main. La montée est donc une migration, à faire avec l'embarquement de la bibliothèque — qui
règle aussi P2-4. Tant qu'elle n'est pas faite, la version reste dans la plage de la CVE, avec deux
barrières indépendantes devant.

**P1-4** — le délai maximal est arrivé avec P0-1. Le tampon intégral reste : à remplacer par un
flux avec backpressure et une taille maximale configurable.

**P1-7** — technique et juridique mêlés. Les durées se décident avec le responsable de traitement,
pas dans un dépôt. Ce qui nous revient : le job de purge, les suppressions en cascade, la voie
d'export/effacement.

### Reste du P1-6 : l'identifiant d'auteur opaque (15/08/2026)

L'identité d'un membre vient du jeton depuis **0.1.34**. Ce qui reste du constat : `author_email`
part à toute l'audience alors que l'interface ne l'affiche jamais.

⚠️ Il n'est pas décoratif — `isMine()` s'en sert pour décider si les commandes « modifier » et
« supprimer » apparaissent. Le remplacer par un identifiant opaque demande une colonne, une
migration pour les messages existants, et un repli pour les hôtes qui ne l'ont pas encore. À faire
avec le lot des migrations (P1-5), pas avant.

## P2 — à traiter, sans urgence

| | Constat | Décision |
|---|---|---|
| P2-1 | Autorisation des statistiques de présentation trop large | à trancher : égalité entre membres, ou périmètre |
| P2-2 | `handler.js` : 2 988 lignes, non typé | découpage progressif, contrat public inchangé |
| P2-3 | Pas d'E2E navigateur, pas de Supabase de test, pas de couverture | oui — c'est là que vivent les deux P0 |
| P2-4 | Dépendances navigateur hors lockfile, sans SRI (`@2` mouvant) | embarquer, ou SRI + versions exactes |
| P2-5 | Actions GitHub épinglées sur des tags, pas des SHA | oui — priorité au workflow CLA |
| P2-6 | Pas de migrations de schéma pour une instance existante | oui — `init.sql` reste pour le neuf |
| P2-7 | Accessibilité : dialogues, labels, `aria-live` | oui |
| P2-8 | Schéma sans clés étrangères ni contraintes de domaine | oui, progressivement |

## P3 — mineur

| | Constat | Décision |
|---|---|---|
| P3-1 | Jeton d'auteur de chat généré avec `Math.random` | ✅ **0.1.23** |
| P3-2 | `postMessage` ne compare pas `event.source` | ✅ **0.1.23** |
| P3-3 | `allow_download` présenté comme une protection | ✅ **0.1.24** — dit comme préférence d'affichage |
| P3-4 | Commentaires de `init.sql` en retard sur le code | à corriger avec A |

**P3-3** est le seul de la liste qui puisse tromper un utilisateur sur ce qu'il achète : le
navigateur reçoit forcément le fichier. Le champ doit être décrit comme une préférence, jamais
comme un contrôle de copie.

## Trouvé pendant les correctifs, hors audit

L'audit externe et l'analyse statique n'ont pas vu les mêmes choses. Ce qui suit vient de la
seconde, et n'était dans aucun constat CODEX.

| Constat | État |
|---|---|
| Écriture indexée par une donnée du client (`toggleReaction`) | ✅ **0.1.22** |
| Le pont `postMessage` acceptait n'importe quelle fenêtre émettrice | ✅ **0.1.23** |
| Jeton d'auteur du chat et identifiant de session issus de `Math.random` | ✅ **0.1.23** |
| Une adresse longue figeait la boucle d'événements (motif quadratique) | ✅ **0.1.24** |
| Une lecture locale pouvait décrire un fichier et en envoyer un autre | ✅ **0.1.24** |

**Écriture indexée par une donnée du client** (`toggleReaction`, 0.1.22). La garde de 0.1.2
couvrait les LECTURES seulement : `Object.hasOwn` empêche de lire `constructor`, rien n'empêchait
de l'écrire. Le plafond de 8 caractères bloquait `__proto__` et `constructor` par accident —
`toString` et `valueOf` passaient. Deux barrières posées, et le balayage statique couvre désormais
les écritures.

**L'adresse longue** (0.1.24) est la seule de la liste à avoir été *mesurée avant* d'être corrigée,
et c'est ce qui la sépare du cas voisin : sur la chaîne d'UA, la même famille d'alerte a été
mesurée et s'est révélée sans effet réel (V8 reste linéaire), donc bornée sans être présentée comme
une faille. Sur l'adresse, 3 900 ms sur 100 000 caractères — une requête, l'instance entière figée.
⚠️ Et la limite de débit censée protéger la route était vérifiée APRÈS le motif : une garde placée
derrière ce qu'elle doit garder ne garde rien.

### État de l'analyse statique

Au 14/08/2026, sur `main` : **0 alerte ouverte** — 12 corrigées, 45 écartées avec motif. Vérifié sur
l'analyse du commit publié, pas sur le compteur de l'onglet.

⚠️ **Deux leçons de méthode, payées ce jour-là :**

1. **`js/user-controlled-bypass` a été retirée de la configuration**, pas ignorée : elle produisait
   33 alertes sur la même forme (un aiguillage `body.action`, dont l'autorisation vit dans chaque
   branche). Les 33 ont été relues une par une avant le retrait — l'une portait un résidu réel
   (`body.internal`), corrigé et non écarté. Trente-trois alertes de bruit n'aident pas : elles
   apprennent à parcourir la liste sans la lire.

2. **Les commentaires `// codeql[js/...]` ne suppriment rien.** Posés dans la forme documentée,
   puis mesurés sur le commit fusionné : les alertes remontent identiques. C'est un mécanisme du
   CLI (`AlertSuppression.ql`), pas du service GitHub. Ils ont été retirés — un marqueur qui
   ressemble à une mécanique sans en être une est pire que rien.
   ⚠️ Et l'erreur d'avant : le compteur était passé de 5 à 2, ce que j'ai lu comme une réussite
   partielle. Les 3 « disparues » l'étaient par des écartements manuels antérieurs. **Une baisse
   n'est pas une preuve de cause.**

   `paths-ignore: examples/**` réglait tout en une ligne et a été refusé : un exemple est le code
   que les gens recopient en production. Reste l'écartement à la main, à refaire quand les routes
   bougent.

## Anomalie relevée hors constats

Le `node_modules` local portait `jsdom@25` alors que le lock demande `30`. Les tests passaient sur
un arbre différent de celui de la CI. `npm ci` requis avant toute conclusion sur une suite verte.

## Ce que l'audit valide, et qu'il ne faut pas casser

Frontière hôte/cœur avec test d'étanchéité, garde de traversée de chemin, slugs et jetons en
`crypto.randomBytes`, hachages comparés en temps constant, CSP à nonce avec `default-src 'none'`,
types actifs rendus inertes au relais, `service_role` côté serveur uniquement, échec fermé quand un
greffon manque, séparation des populations interne et externe, build déterministe et artefacts
vérifiés en CI.
