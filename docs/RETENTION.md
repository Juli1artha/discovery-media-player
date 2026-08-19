# Rétention des données

Ce document est le **périmètre déclaré** de la rétention : chaque colonne du schéma dont la forme
peut porter une donnée personnelle y a une politique — *purgée après N* ou *conservée parce que*.
Une garde de forge énumère les colonnes du schéma **vivant** (`information_schema`, jamais notre
mémoire du fichier) et refuse toute colonne à forme personnelle absente d'ici : une donnée sans
politique écrite ne peut pas entrer dans le schéma sans rougir.

Le contrat de vérification a deux moitiés, volontairement **indépendantes** (aucun code partagé —
ni fonction de périmètre, ni filtre) :

1. la **purge** (`server/retention.js`) déclare ce qu'elle a effacé, compte par compte ;
2. le **recensement** (`supabase/recensement-retention.sql`, SQL nu) compte ce qui reste dans le
   périmètre revendiqué. Les deux nombres doivent se contredire si l'un ment.

> ⚠️ **Fenêtres proposées, à valider par l'exploitant.** Les durées ci-dessous sont des défauts
> raisonnés (journaux analytiques : 13 mois, comparaison année sur année ; archives de
> présentation : 12 mois après la fin). Un hôte les ajuste via `config.retention` — **entiers de
> mois dans [1, 120] uniquement**. Toute valeur négative, nulle, non entière, `NaN`, `Infinity`
> ou chaîne fait ÉCHOUER la purge avant le premier `DELETE`, en nommant la clé fautive : une
> faute de configuration ne supprime jamais rien. Les bornes sont calculées en UTC, rabattues au
> dernier jour du mois cible (« 31 mars − 1 mois » = 28 février, pas le 3 mars).
>
> ⚠️ **Le balayage automatique est OPT-IN STRICT** : il ne tourne que si l'hôte écrit
> `config.retention.balayage: true`. Un hôte qui consomme le contexte autonome tel quel hérite de
> toutes ses capacités par défaut — « rien à brancher parce que rien n'a été débranché » — et une
> suppression est une décision métier : elle n'agit que là où un exploitant l'a écrite. L'action
> `retention.run` (hôte de confiance ou admin) reste disponible sans opt-in : l'appeler EST la
> décision.

## Journaux de lecture (population externe)

Finalité : statistiques de lecture d'un document envoyé. **Purge : 13 mois** après l'événement.

| colonne | contenu | sort |
|---|---|---|
| `commercial_doc_views.recipient_email` | à qui la lecture est attribuée | purgée avec la ligne, 13 mois après `at` |
| `commercial_doc_views.session_id` | corrèle les vues d'une session | idem |
| `commercial_doc_views.ua` | navigateur (User-Agent brut) | idem |
| `commercial_doc_sessions.recipient_email` | attribution de la session | purgée avec la ligne, 13 mois après `last_at` |
| `commercial_doc_sessions.session_id` | identifiant de session | idem |
| `commercial_doc_sessions.ip` | **adresse IP en clair** | idem — c'est la donnée la plus sensible du schéma |
| `commercial_doc_sessions.ua` | User-Agent brut | idem |
| `commercial_doc_sessions.num_pages` / `commercial_doc_sessions.pages_time` | comportement de lecture page par page | idem |

## Journaux de lecture (équipe interne)

Même finalité, population interne. **Purge : 13 mois** après `last_at`.

| colonne | sort |
|---|---|
| `commercial_doc_internal_sessions.user_email` / `commercial_doc_internal_sessions.user_name` | purgées avec la ligne |
| `commercial_doc_internal_sessions.session_id` | idem |
| `commercial_doc_internal_sessions.num_pages` / `commercial_doc_internal_sessions.pages_time` | idem |

## Liens d'envoi (`commercial_doc_shares`)

Un lien **vivant** est un enregistrement métier : ses champs restent tant que l'URL distribuée
doit fonctionner. Un lien **révoqué** ne sert plus personne : **purge 13 mois après révocation**
(alignée sur les journaux, qui référencent son slug). La révocation est **datée** par
`commercial_doc_shares.revoked_at` (migration 0013) ; les révoqués d'avant la colonne ont reçu la
date de la migration — leur horloge démarre là, compter large plutôt qu'inventer. Sans la
colonne, cette purge-là se tait (sonde de schéma), les autres tournent.

| colonne | contenu | sort |
|---|---|---|
| `commercial_doc_shares.recipient_email` | qui peut expédier au repartage | conservée tant que le lien vit ; ligne purgée 13 mois après révocation |
| `commercial_doc_shares.attested_recipient_email` | à qui l'hôte atteste le lien | idem |
| `commercial_doc_shares.recipient_name` | nom du destinataire | idem |
| `commercial_doc_shares.created_by` | email du commercial créateur | idem |
| `commercial_doc_shares.file_name` | nom du fichier (peut porter un nom de personne) | métier, purgé avec la ligne |

## Présentations en direct

Une présentation **inactive** (terminée ou abandonnée) est une archive : **purge 12 mois après
`updated_at`** — la présentation, ses messages, ses présences, et ses pièces jointes du bucket
`present-attachments` (si l'hôte fournit `storage.remove`, sinon la limite est dite ci-dessous).

| colonne | contenu | sort |
|---|---|---|
| `doc_presentations.presenter_name` / `doc_presentations.owner_name` | identité du présentateur | purgées avec la ligne, 12 mois après la fin |
| `doc_presentations.owner_email` / `doc_presentations.owner_user_id` | propriétaire | idem |
| `doc_presentations.owner_avatar` | URL d'avatar | idem |
| `doc_presentations.control_hash` | empreinte du jeton de contrôle (pas le jeton) | idem |
| `doc_presentations.content` | contenu partagé (cartes, médias) | idem |
| `doc_presentations.file_name` | nom du fichier présenté | idem |
| `doc_presentation_messages.author_name` / `doc_presentation_messages.author_email` / `doc_presentation_messages.author_avatar` | identité de l'auteur | purgées avec la présentation |
| `doc_presentation_messages.author_hash` | empreinte du jeton d'auteur | idem |
| `doc_presentation_messages.body` | corps du message | idem |
| `doc_presentation_messages.reply_name` / `doc_presentation_messages.reply_text` | citation d'un autre message | idem |
| `doc_presentation_messages.attachment` | URL de pièce jointe | idem — fichier du bucket inclus quand `storage.remove` existe |
| `doc_presentation_messages.client_key` | clé d'idempotence d'envoi | idem |
| `doc_presentation_attendees.name` / `doc_presentation_attendees.email` / `doc_presentation_attendees.avatar` | identité du participant | purgées avec la présentation |
| `doc_presentation_attendees.attendee_key` | identifiant de présence | idem |
| `doc_presentation_attendees.pages` | pages vues par le participant | idem |

## Sessions d'agent (`doc_bot_sessions`)

Parcours guidé par l'agent : **purge 13 mois** après `last_at`.

| colonne | sort |
|---|---|
| `doc_bot_sessions.rating` / `doc_bot_sessions.rating_comment` | avis du visiteur — purgés avec la ligne |
| `doc_bot_sessions.in_tokens` / `doc_bot_sessions.out_tokens` / `doc_bot_sessions.cache_tokens` | volumétrie IA (pas personnelle, mais portée par la ligne) — purgés avec elle |

## Limites de débit (`player_rate_limits`)

| colonne | contenu | sort |
|---|---|---|
| `player_rate_limits.key` | peut contenir une **IP en clair** (`hshare:<ip>`) ou un email | ligne purgée dès `expires_at` dépassé (opportuniste, à chaque passage) |

## Limites dites plutôt que tues

- **Pièces jointes orphelines** : la purge des lignes n'efface le fichier du bucket que si le
  contexte hôte fournit `storage.remove` (capacité optionnelle). Sans elle, l'URL devient
  introuvable depuis le produit mais l'objet survit dans le bucket — c'est dit ici plutôt que
  simulé.
- **La purge avance par LOTS bornés** (200 lignes, plafond 5000 par table et 500 présentations
  par exécution) : elle sélectionne un lot d'identifiants, les supprime par `id=in.(…)`, et
  recommence. Le rapport (`r.rapport`) porte, par table : `examinees`, `supprimees`, `tronque`
  (il reste à faire au prochain passage). `retention.run` accepte `{ dryRun: true }` : elle
  compte sans rien effacer — à lancer avant la première vraie purge d'un gros historique.
- **Index** (migration 0014) : `commercial_doc_sessions(last_at)`, `doc_bot_sessions(last_at)`,
  `commercial_doc_shares(revoked_at) where revoked`. Sur une installation VOLUMINEUSE déjà en
  production, créez-les à la main en `CREATE INDEX CONCURRENTLY` hors migration (la migration les
  pose en index ordinaire, ce qui verrouille brièvement l'écriture — négligeable sur une base
  jeune, à éviter sur une grosse table active).
- **Le recensement ne tourne pas tout seul en production** : c'est un SQL qu'un exploitant lance
  (et que la forge exécute à chaque course sur une base réelle vieillie artificiellement).
- **« Ce qui existe » a une profondeur temporelle qu'`information_schema` n'a pas** (question du
  second hôte, sans réponse mécanique) : une colonne supprimée du schéma sort du périmètre des
  deux textes, mais sa donnée peut survivre dans un dump, une sauvegarde ou une table d'archive.
  Ce contrat couvre la BASE VIVANTE ; les copies (sauvegardes, exports, dumps de migration) sont
  le périmètre de l'exploitant, nommé ici plutôt que simulé. Corollaire opératoire : supprimer
  une colonne à donnée personnelle est un acte de rétention — sa ligne quitte ce document dans
  le même commit, et les copies antérieures suivent la politique de sauvegarde de l'hôte.
