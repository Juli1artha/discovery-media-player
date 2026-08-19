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
> présentation : 12 mois après la fin). Un hôte les ajuste via `retentionMois` dans son contexte.

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
- **Le recensement ne tourne pas tout seul en production** : c'est un SQL qu'un exploitant lance
  (et que la forge exécute à chaque course sur une base réelle vieillie artificiellement).
