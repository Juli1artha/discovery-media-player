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
| P0-2 | Canal Realtime public : tout participant peut émettre un état autoritatif | ✅ **B en 0.1.19** · A à faire |

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

## P1 — important

| | Constat | Décision |
|---|---|---|
| P1-1 | Les emails de re-partage font confiance à l'en-tête `Host` | ✅ **0.1.21** — `PLAYER_PUBLIC_URL` |
| P1-2 | Écritures d'analytics : le client choisit `internal`, `isMember`, `isPresenter` | 🟡 **interne fermé en 0.1.22** · présence à faire |
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

**Écriture indexée par une donnée du client** (`toggleReaction`, ✅ 0.1.22). La garde de 0.1.2
couvrait les LECTURES seulement : `Object.hasOwn` empêche de lire `constructor`, rien n'empêchait
de l'écrire. Le plafond de 8 caractères bloquait `__proto__` et `constructor` par accident —
`toString` et `valueOf` passaient. Deux barrières posées, et le balayage statique couvre désormais
les écritures. Trouvé par l'analyse statique, ni par l'audit ni par nous.

## Anomalie relevée hors constats

Le `node_modules` local portait `jsdom@25` alors que le lock demande `30`. Les tests passaient sur
un arbre différent de celui de la CI. `npm ci` requis avant toute conclusion sur une suite verte.

## Ce que l'audit valide, et qu'il ne faut pas casser

Frontière hôte/cœur avec test d'étanchéité, garde de traversée de chemin, slugs et jetons en
`crypto.randomBytes`, hachages comparés en temps constant, CSP à nonce avec `default-src 'none'`,
types actifs rendus inertes au relais, `service_role` côté serveur uniquement, échec fermé quand un
greffon manque, séparation des populations interne et externe, build déterministe et artefacts
vérifiés en CI.
