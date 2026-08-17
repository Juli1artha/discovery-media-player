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
| P1-2bis | ⚠️ `PLAYER_INTERNAL_STRICT` était infermable : aucun chemin pour fournir le jeton | ✅ **0.1.35** — prérequis de l'analytics strict par défaut |

### Une dépendance heureuse entre deux chantiers (16/08/2026, vue par ADV)

Le quota des sessions internes porte sur l'**adresse** — parce qu'une limite ne peut porter que sur
ce que l'appelant NE CHOISIT PAS, et que l'identifiant de session, lui, est choisi par le navigateur
(la leçon de `X-Forwarded-For`, 0.1.22). Mais une adresse identifie un **bâtiment**, pas une lecture :
c'est pour ça qu'il a fallu la dimensionner pour 25 lecteurs (0.1.36), et qu'elle punira toujours
une équipe pour la lecture d'une seule personne.

⚠️ **Le mode strict règle ça, et ce n'était pas son objet.** Dès que le jeton interne est
obligatoire, on tient mieux que l'adresse : **l'e-mail signé par l'hôte**. Il n'est pas choisi par
l'appelant, il identifie une personne et non un immeuble, et il est déjà présent au moment du
contrôle.

`PLAYER_INTERNAL_STRICT=1` ne ferme donc pas seulement une usurpation : il rend possible un quota
juste. À faire **avec** la bascule du défaut, pas avant — sans jeton obligatoire, une clé fondée sur
l'e-mail se contournerait en changeant l'e-mail, et on retomberait exactement dans le défaut qu'on
vient de corriger.

*Vu par la session ADV, en retirant sa propre proposition de clé.*
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

### ⚠️ La clé du quota change pour UNE limite, pas pour les douze (16/08/2026)

Écrit avant 0.1.42 parce que « on change la clé du quota » se lit vite comme « partout », et que
ce serait le défaut de 0.1.36 réintroduit à l'échelle du fichier.

Le player porte **douze limites de débit, toutes clés sur l'adresse**. Une seule concerne les
sessions internes :

| clé | population | preuve d'identité disponible |
|---|---|---|
| `intsess:` | interne | ✅ jeton signé par l'hôte (0.1.22/0.1.35) |
| `patt:` `pchat:` `pup:` `preact:` `pstart:` | audience d'une présentation | ❌ mixte — un prospect n'a aucun jeton |
| `reshare:` `docbot:` `doctts:` `vcode:` `hshare:` | lecteur anonyme d'un lien | ❌ aucune |

⚠️ **Une limite ne peut porter que sur ce que l'appelant ne choisit pas.** L'e-mail signé le
remplit ; un e-mail *déclaré* ne le remplit pas — on le changerait pour repartir à zéro, ce qui est
exactement ce que 0.1.36 vient de fermer sur l'autre bord.

Donc : `intsess:` passe à l'e-mail **quand un jeton valide est présent**, et retombe sur l'adresse
sinon. Une fois le mode strict par défaut, ce repli ne sert plus qu'aux instances en transition —
sans jeton, la requête est refusée avant d'atteindre le compteur.

Les onze autres gardent l'adresse. Elles identifient un bâtiment, c'est imparfait, et c'est tout ce
qu'on a pour une population qui ne prouve rien — par construction, puisque c'est ce qui la définit.

*Précision demandée par la session ADV, avant que la version ne parte.*

## Vérification CODEX du 16 août (sur `0.1.43`)

Relecture après la série de correctifs. ⚠️ **Trois de ses six P1 sont des conséquences des correctifs
du jour même** — elle ne relit pas un état, elle relit un mouvement.

| | Constat | État |
|---|---|---|
| V-1 | Une présentation terminée peut être réactivée | ✅ **0.1.44** |
| V-2 | Écritures de présentation pas toutes séquentielles (`toMap`, `hideMap`, `pushPage`) | à faire — file unique |
| V-3 | Une requête bloquée fige l'ordonnanceur (né de 0.1.41) | ✅ **0.1.44** |
| V-4 | Le canal public reste amplifiable — et la limite de 0.1.42 en fait un déni de service | ✅ **0.1.45** |
| V-5 | Clé anonyme rejouable, exposée dans la présence (née de 0.1.42) | à faire |
| V-6 | `present-stats` / `present-doc-list` : possession non vérifiée | recoupe P2-1 / C-8 |

### V-1 — terminer révoque le jeton, la péremption ne le révoque pas

⚠️ **La règle proposée par l'audit — « refuser toute écriture si `active=false` » — aurait cassé une
reprise réelle.** `active:false` recouvre deux situations sans rapport :

1. une fin **décidée** — plus rien ne doit piloter ;
2. une péremption **constatée** (3 min sans battement) — le portable du présentateur a dormi, et sa
   page suivante doit le remettre en ligne. La « résurrection » **est** la reprise.

Refuser les deux condamnerait un présentateur **anonyme** à ne jamais revenir : `present-reclaim`
exige la propriété, et `present-start` n'exige aucune session. On distingue donc les deux cas par ce
qui les sépare vraiment — la décision — plutôt que par l'état qu'ils partagent : **terminer révoque
le jeton de contrôle**, la péremption le laisse intact. Les chemins propriétaire, qui n'ont pas
besoin de jeton, sont fermés séparément sur `active=false` (le propriétaire a `reclaim`).

Une mutation qui fait révoquer la péremption — c'est-à-dire qui applique la règle générale — est
refusée par le banc.

### V-3 — le délai né du correctif

Avant 0.1.41, l'ordonnanceur appelait `fini()` immédiatement : les écritures partaient dans le
désordre, mais rien ne pouvait se bloquer. En les rendant séquentielles, **on a échangé un défaut de
correction contre un risque de disponibilité** — une requête suspendue ne règle jamais sa promesse,
la file ne repart pas, et le présentateur pilote dans le vide, en silence.

`fetchBorne` vit à côté de `createScheduler` parce qu'elle en est la contrepartie.

> ⚠️ **Ce que le délai restaure, et ce qu'il ne restaure pas.** La **vivacité** : la file repart. Pas
> l'**ordre** — une requête abandonnée peut être arrivée au serveur et y atterrir après celle qui l'a
> remplacée. L'ordre malgré un abandon demande un numéro de version porté par l'écriture : c'est le
> chantier de la file unique (V-2), pas celui-ci.

### V-4 — ce que l'audit sous-estime

Il parle de charge base. En réalité **la limite de 0.1.42 transforme l'amplification en déni de
service sur l'audience** : le quota est de 21 600/h par adresse, un spectateur peut relire ~9 000/h
(ordonnanceur à 400 ms), donc trois spectateurs derrière une sortie unique dépassent le quota. Un
participant hostile n'a qu'à diffuser vite pour que toute une salle prenne des 429 et que ses pages
cessent de tourner.

J'ai calibré le quota sur ce qu'un usage légitime consomme, sans voir que **la cadence de relecture
n'est pas choisie par le spectateur** mais par qui diffuse. La leçon de `X-Forwarded-For` retournée :
la limite ne repose pas sur ce que l'appelant choisit, mais elle est **payée par quelqu'un qui ne
choisit pas non plus**.

Correctif propre : canal privé. Intermédiaire, meilleur que baisser le quota : découpler la cadence
de relecture du rythme des diffusions (rafale courte, puis repli sur le filet).

### V-4 — le budget de relecture, et le plancher qu'il ne doit pas toucher

On borne la **cause**, pas l'effet : baisser le quota aurait puni davantage la victime. Le spectateur
se donne son propre budget et ne relit jamais plus que ce que les actions d'un présentateur
justifient. Sous martèlement, sa cadence passe de ~9 000/h à 720/h.

⚠️ **Le budget ne gate que ce qui vient du canal.** `signaler()` est déclenché par une diffusion,
donc par n'importe quel participant : c'est la porte à rationner. `maintenant()` est le filet
périodique, déclenché par nous toutes les 25 s : le rationner rendrait une audience à budget épuisé
**définitivement muette** — on aurait fermé une porte en en ouvrant une plus petite et plus sûre.

**Les deux nombres sont un seul contrat** : budget signalé + filet = la part d'un spectateur, et le
quota serveur = cette part × `READERS_PER_EGRESS`. Un test a d'ailleurs exigé de corriger la
dérivation : elle ne comptait que la part soutenue, et une salle pleine dépassait le quota de
475 relectures — exactement la rafale de chacun. **Le serveur doit couvrir ce que le client
s'autorise, pas sa moyenne.**

> ⚠️ **Le test de cette propriété n'a pas mordu du premier coup, et c'est instructif.** Il martelait
> puis observait une accalmie : un filet rationné y passait quand même, le budget se rechargeant
> (1 jeton / 5 s) plus vite que le filet ne tourne (25 s). La condition qui sépare les deux mondes
> est le martèlement **continu**. Le seuil a ensuite été **mesuré** — 884 relectures avec le filet
> libre, 740 s'il est rationné — et l'assertion se compare au budget signalé, frontière réelle entre
> les deux, plutôt qu'à un nombre écrit à la main.

Deux traces de méthode, toutes deux de mon fait :

- une **copie morte de `fetchBorne`** est partie en 0.1.44 : mon déplacement de l'aide vers le paquet
  n'avait rien retiré, et l'audience utilisait la copie locale — donc un chemin non couvert par les
  tests écrits pour l'autre. Deux implémentations d'un même contrat, exactement ce que ce dépôt
  répète. Retirée ici, un seul point d'entrée pour les quatre chemins ;
- `git checkout src/cadence.ts` pour annuler une mutation a effacé **tout** le travail non commité de
  ce fichier. Deuxième fois dans la même semaine ; à ne plus jamais employer sur un fichier en cours.

### V-4 (suite) — le cache par slug, proposé par le second hôte

Après 0.1.45, le second hôte a vu plus loin que notre budget : **un quota sur le chemin de lecture
est une arme retournée par construction**, et découpler la cadence déplace le seuil sans retirer
l'arme. `state=1` lit une ligne **identique pour tous les spectateurs** d'une même présentation ;
la mettre en cache par slug fait s'effondrer n'importe quelle cadence — légitime ou hostile — à un
accès base par fenêtre. Ce n'est plus une limite : il n'y a plus de ressource à saturer, donc plus de
victime.

⚠️ **Deux réserves ont modifié leur proposition.**

1. **La fenêtre.** Ils proposaient une seconde, en citant notre doctrine de 0.1.19 (« une diffusion
   est un signal, pas une vérité »). Cette doctrine porte sur l'**autorité**, pas sur la latence — et
   depuis qu'on a vidé les charges de diffusion, précisément à cause d'elle, **la relecture n'est
   plus un filet : c'est le seul chemin par lequel le numéro de page arrive**. Une seconde de cache
   retarderait donc *chaque* page tournée d'autant. La fenêtre est calée sur le regroupement de
   l'ordonnanceur (400 ms) : même effondrement, zéro latence ajoutée. La constante du gabarit a été
   branchée sur la constante partagée — sinon les deux divergeraient en silence.

2. **Le cache retire le coût BASE, pas le coût d'INVOCATION.** Sur serverless, les invocations sont
   elles-mêmes mesurées et saturables. Le quota ne disparaît donc pas : il **remonte** au-dessus de
   ce qu'un trafic piloté par diffusion peut atteindre. Il cesse d'être une arme (plus de victime) et
   redevient un garde-fou contre l'inondation brute.

   ⚠️ **Ce changement de rôle a changé la borne du test.** Il disait « un plafond qu'aucun usage réel
   n'atteint ne protège plus de rien » et fixait 50 000 — motif valable quand le quota gardait la
   base. Les deux côtés se déduisent désormais : **au-dessus** de ce qu'une salle pleine émet
   légitimement (sinon c'est une arme), **au-dessous** de ce qu'un martèlement produit (sinon la
   limite ne peut jamais dire non).

`chat=1` reçoit le même traitement — ils ne parlaient que de `state`, et ce chemin coûte même plus
cher (deux interrogations au lieu d'une).

**Ce que le cache ne fait pas**, écrit à côté de lui plutôt que découvert plus tard : il vit dans la
mémoire du **processus**. L'effondrement est « une lecture par fenêtre **et par instance** ». C'est
la même limite que celle d'un compteur de débit en mémoire — celle-là même que le second hôte venait
de nous signaler pour `limits.allow`.

> ⚠️ **Trois pièges, et le banc les couvre un par un.** La *rafale froide* (mémoriser le résultat au
> lieu de la promesse laisse passer 25 lectures — le cas exact que le cache existe pour couvrir) ;
> la *clé choisie par l'appelant* (le slug est dans l'URL : une table sans borne serait une fuite
> mémoire commandée du dehors) ; l'*échec mémorisé* (servir une erreur pendant toute la fenêtre
> transforme un hoquet en panne).

> ⚠️ **Et une mémoire posée derrière une dépense ne l'épargne pas.** La première version gardait la
> lecture de la ligne **avant** les branches : les deux chemins mis en cache la relisaient donc quand
> même, et le cache ajoutait une seconde interrogation au lieu d'en retirer une. Vu au banc — 26
> lectures pour 25 appels — pas à la relecture.

### Inexactitudes relevées

- `goSV()` passe bien par l'ordonnanceur (`svOrd`) — l'audit le cite parmi les écritures directes.
  `toMap()`, `hideMap()` et `pushPage()`, eux, sont bien directs.
- « J'ai reproduit le comportement » pour V-1 décrit une reproduction au niveau de la **fonction**.
  La course de bout en bout est étroite (`PRES=null` filtre les nouveaux appels) ; la vraie porte est
  le **jeton persisté en localStorage**, pas la requête en vol.
- Les limites de débit en mémoire concernent le **contexte autonome** (`Map` par processus). Chez les
  deux hôtes actuels elles sont adossées à une table. La nuance change qui est protégé.

## Audit CODEX 5.6 (16 août 2026, sur `0.1.40`)

Troisième regard externe, reçu après la série de correctifs ci-dessus. Deux de ses constats visaient
du code écrit **le jour même** — c'est le signe qu'il fallait entendre.

| | Constat | État |
|---|---|---|
| C-1 | `endPresent()` annonce la fin sans attendre de confirmation HTTP | ✅ **0.1.42** |
| C-2 | `on(win,"blur",pause)` annulait le correctif du double écran | ✅ **0.1.41** |
| C-3 | `presentContent()` ne rendait pas sa promesse : l'ordonnanceur n'attendait rien | ✅ **0.1.41** |
| C-4 | Comportement du présentateur anonyme ambigu (carte refusée, page acceptée) | ✅ **0.1.42** |
| C-5 | Canal public : amplificateur de trafic, pas de limite sur `state=1` / `chat=1` | ✅ **0.1.42** |
| C-6 | `flattenPresence()` indexe un `{}` par des identités réseau | à faire (pollution de prototype) |
| C-7 | `present-attend` accepte une `key` choisie par le client | ✅ **0.1.42** |
| C-8 | `present-stats` / `present-doc-list` : session exigée, propriété non vérifiée | recoupe P2-1 |
| C-9 | Pas de délai maximal sur PostgREST / signUpload / verifyToken | recoupe P1-4 |
| C-10 | E2E navigateur absent | 🔧 **entamé en 0.1.42** — cf. ci-dessous |

### C-1 et C-4 — corrigés en `0.1.42`

**C-1.** `endPresent` partait en `sendBeacon`, qui ne rend **aucune** réponse, puis nettoyait
l'interface, effaçait le jeton de contrôle et coupait le canal. Un échec laissait donc la
présentation **vivante pour l'audience** pendant que le présentateur la croyait close — sans même de
quoi la refermer, son jeton ayant déjà été jeté. Et le beacon n'achetait rien : son seul appelant
était un **bouton**. Il est désormais sur `pagehide`, et là seulement ; le bouton attend un 2xx
avant de diffuser, de couper et d'effacer quoi que ce soit.

**C-4.** `present-start` n'exige aucune session — c'est voulu. `present-page` se contente donc du
`control_token`. Mais `present-content` — ce que la présentation **affiche** — avait été rangé avec
les actions à session : une présentation anonyme tournait ses pages sans pouvoir déplacer sa carte,
l'appel repartant en 401 avalé côté navigateur. Les deux actions sont le même acte de pilotage ;
elles avaient été groupées par **voisinage dans la route, pas par autorité**. Ce qui reste réservé
au propriétaire est `present-switch` : changer le document montré n'est pas piloter l'affichage.

### C-7 — la clé de participant

`present-attend` identifie sa ligne par une `key` **choisie par le client**, et pour un membre
`attendeeKey()` renvoyait son **adresse e-mail**. N'importe quel participant anonyme du lien public
n'avait donc qu'à poster `key: "collegue@entreprise.fr"` pour écraser la ligne de ce collègue :
changer le nom et l'avatar affichés, gonfler son temps de présence.

⚠️ **Le correctif était déjà à moitié écrit.** Trois lignes plus haut, la même route dit :

> « Une identité prouvée REMPLACE celle qu'on affirme — elle ne s'y ajoute pas. »

Le nom, l'e-mail et l'avatar avaient bien été remplacés par ceux du jeton. La **clé** était passée
entre les mailles — alors que c'est elle qui décide quelle ligne on écrit. On avait sécurisé le
contenu du registre en laissant ouvert le choix de la page.

La clé d'un membre se dérive désormais du jeton vérifié ; un anonyme garde la sienne, enfermée dans
un espace de noms (`anon-…`) dont elle ne peut pas sortir. Et elle est tirée par
`valeurImprevisible` : c'était `Math.random()`, acceptable pour un identifiant d'analyse, plus du
tout quand la valeur est la seule chose qui sépare deux participants — la correction faite en
0.1.23 pour le jeton d'auteur du chat, jamais rapportée vingt lignes plus haut dans le même fichier.

> ⚠️ **La garde d'artefact a dû être réécrite.** Sa première version *lisait* le paquet minifié à la
> recherche de `.email` ; une mutation remettant le défaut sous un autre nom passait au travers. Elle
> **exécute** maintenant le paquet livré et lui tend l'identité de cinq façons — ancienne signature
> comprise. Avec la fonction d'origine restaurée, elle échoue sur les deux moitiés.

### C-5 — le canal public borné

`state=1` et `chat=1` sont servis **sans session**, sur un lien public, et chaque appel coûte une
interrogation de base. Douze actions d'écriture passaient par une limite ; ces deux **lectures**,
non. Une boucle sur une URL connue faisait donc d'un lien de présentation un amplificateur : une
requête HTTP triviale contre une requête base, autant de fois qu'on veut. Et c'est la ressource
**partagée** qui paie — la base est la même pour tous les documents de l'instance — donc le coût
d'un abus ne retombe pas sur celui qui le commet.

⚠️ **La place de la garde est le correctif.** `getPresentation()` s'exécutait AVANT les branches
`state`/`chat` : une limite écrite là où le refus se formule aurait refusé correctement, avec le bon
code HTTP, **après avoir dépensé exactement ce qu'elle protège**. Les tests comptent donc les
interrogations de base, pas les codes de retour.

Le quota se **déduit** de la cadence de l'audience (`src/cadence.ts`) : filet de resynchronisation à
25 s + une action de présentateur toutes les 5 s, le tout multiplié par `READERS_PER_EGRESS` — la
même constante que pour les sessions, réutilisée plutôt que réinventée. Refus journalisé une fois
par heure : sans cela, une salle entière décrocherait sans cause nommée.

> ⚠️ Un test de cette série a échoué en affirmant mal. Je vérifiais la clé en posant un
> `X-Forwarded-For` et en l'attendant dans la clé : la garde de 0.1.22 a répondu `pread:anon`. Un
> en-tête que l'appelant écrit lui-même ne fonde aucune limite. Le test dit maintenant la propriété —
> la clé vient de la connexion, et l'en-tête ne la déplace pas.

### C-10 — le premier vrai bout-en-bout

`server/__tests__/finDePresentation.test.js` **exécute la page du présentateur** dans jsdom : il rend
le HTML, l'installe, joue les scripts, clique « Présenter », puis clique « Terminer » avec une
réponse serveur qu'on dénoue à la main.

> ⚠️ C'est ce qui distingue ce test d'une sonde textuelle. On aurait pu vérifier que le signal est
> écrit **après** l'appel dans le texte du gabarit — c'est ce que fait `ecrirePuisSignaler`. Mais
> « après la réponse » et « dans la branche d'échec » ont tous deux le signal après l'appel. Seul un
> échec provoqué les sépare. Les trois mutations qui remettent le défaut sont refusées, dont celle
> qui diffuse dès le départ de la requête.

Reste à étendre : audience normale, audience hostile.

## ⚠️ La règle à garder de toute la semaine

Formulée par ADV, le 16/08/2026, après trois occurrences chez chacun :

> **Un indicateur qui ne peut pas dire non ne dit rien.**
> Pour chaque contrôle, demander sous quelles conditions il crie. Sans réponse, il n'existe pas.

Trois formes du même défaut, une par instance et une partagée :

| forme | pourquoi c'est toujours vrai |
|---|---|
| leur badge « suivi indisponible » | il couvrait cinq causes et restait éteint dans celle qui comptait |
| leur test de clé stable | `f(x) === f(x)` est vrai de n'importe quelle fonction |
| notre lecture de la CI | un compte de réussites est toujours positif, quels que soient les échecs |
| notre banc de mesure (0.1.40) | `setInterval: () => 0` neutralisait le mécanisme testé |

⚠️ La dernière est la plus instructive : le test décrivait la bonne propriété, et le banc l'empêchait
d'être exercée. Une mutation l'a montré ; aucune relecture ne l'aurait fait.

## ⚠️ Un motif qui revient : énumérer au lieu de reconnaître une forme

Relevé par la session ADV le 16/08/2026, après le troisième cas de la semaine. Chaque fois, ce qui
manque n'est pas **dans** la liste : c'est **la liste elle-même**.

| où | ce qui était énuméré | ce qui a manqué |
|---|---|---|
| Re-partage (0.1.14) | les colonnes à hériter, une par une | `require_auth`, `allow_download`, `brand_key` — un lien enfant plus permissif que son parent |
| Garde des écritures indexées (audit P1-2) | des **noms de variables** (`body`, `q`, `emoji`…) | `id`, `k`, `sid` — donc tous les agrégateurs de `shares.js` |
| Garde de publication (0.1.36) | le fichier `package.json` | la ligne `version` : une montée de dépendance remettait le compteur à zéro |
| Garde des écritures muettes (0.1.37) | des **noms de fonctions** d'écriture | `recordUnlock`, qui écrit directement par `db.request` |

⚠️ Les deux derniers ont été écrits **le même jour**, l'un pour corriger la classe dont l'autre est
un membre. Écrire la règle n'immunise pas contre elle.

**Le remède, chaque fois le même** : décrire ce qu'on refuse par sa FORME, et faire de la liste
l'exception documentée plutôt que la règle. Le re-partage hérite désormais par défaut et n'exclut
que nommément ; la garde des écritures indexées exclut ce qui est *certainement interne* au lieu de
lister ce qui vient du dehors ; la garde de publication date la ligne et non le fichier ; celle des
écritures muettes vise `db.request` avec un verbe d'écriture.

⚠️ **Et une forme trop large est le défaut symétrique** : la même garde a d'abord accusé les
*lectures*, où un `catch` qui ramène un compteur à zéro est légitime. Une écriture perdue l'est pour
toujours ; une lecture ratée sera refaite. La distinction est le contenu de la règle, pas un détail
de mise au point.

## Ce que l'audit valide, et qu'il ne faut pas casser

Frontière hôte/cœur avec test d'étanchéité, garde de traversée de chemin, slugs et jetons en
`crypto.randomBytes`, hachages comparés en temps constant, CSP à nonce avec `default-src 'none'`,
types actifs rendus inertes au relais, `service_role` côté serveur uniquement, échec fermé quand un
greffon manque, séparation des populations interne et externe, build déterministe et artefacts
vérifiés en CI.
