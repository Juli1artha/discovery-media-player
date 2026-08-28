-- LE CACHE DE VOIX ÉTAIT IMPURGEABLE PAR CONSTRUCTION — PAS PAR OUBLI DE CONFIGURATION.
--
-- ⚠️ CE QUI MANQUAIT, ET POURQUOI AUCUN RÉGLAGE NE POUVAIT LE COMBLER. Chaque synthèse écrit deux
-- objets dans le bucket public `tts-cache` : `<empreinte>.mp3` et `<empreinte>.json`. L'empreinte
-- est un condensat de la voix, du modèle et du texte PRONONCÉ — elle ne se rattache à aucune ligne,
-- et RIEN, nulle part, ne notait qu'un objet avait été écrit ni quand. Le moteur de rétention
-- efface des LIGNES et, pour les fichiers, il efface ceux dont une ligne porte le chemin. Sans
-- ligne, il n'a rien à parcourir : la capacité `storage` du contrat expose `put` et `remove`, pas
-- `list`. Le bucket ne pouvait donc pas être purgé — ni entièrement, ni partiellement, ni en
-- déclarant une fenêtre. L'audit CODEX du 26/08 l'a rangé en « ajouter une politique de rétention,
-- 0,5 jour » ; ce n'était pas une politique qui manquait, c'était la trace.
--
-- ⚠️ ET UN VISITEUR CHOISIT CE QUI Y ENTRE. `bot-tts` accepte le texte de l'appelant : un texte
-- unique laisse un MP3 et un JSON durablement stockés, dans un bucket PUBLIC, hors de toute
-- fenêtre. Le regroupement et les plafonds de la 0.1.140 bornent le coût par heure ; ils ne
-- bornent pas la DURÉE. Ce qui est écrit une fois restait écrit pour toujours.
--
-- Cette table est la trace manquante, et rien de plus : une empreinte, une date. Pas le texte —
-- l'écrire ici recréerait, dans la base, la donnée personnelle éventuelle que le bucket contient
-- déjà, en la rendant cette fois interrogeable. L'empreinte suffit à retrouver les deux objets.
--
-- ⚠️ Sans lui : rien ne casse et la voix fonctionne à l'identique — l'écriture de la trace est
-- non bloquante, par construction. Ce qu'on perd est exactement ce que la migration apporte : le
-- balayage n'a rien à parcourir, le bucket continue de croître sans fenêtre, et `docs/RETENTION.md`
-- le dit alors comme une limite plutôt que comme un périmètre. Un hôte qui ne l'applique pas garde
-- une instance saine et un cache de voix éternel.
--
-- ⚠️ IDEMPOTENTE : `if not exists` partout, rejouable sans effet.

create table if not exists public.doc_tts_objects (
  -- L'empreinte NUE : `<hash>.mp3` et `<hash>.json` s'en déduisent, le bucket est constant.
  hash        text primary key,
  created_at  timestamptz not null default now()
);

-- Le balayage lit par date croissante et par lots : l'index est ce qui rend la purge bornée.
create index if not exists doc_tts_objects_created_idx
  on public.doc_tts_objects (created_at);

-- ⚠️ RLS ACTIVÉE ET AUCUNE POLITIQUE — donc personne, sauf le rôle de service. Une table sans
-- politique n'est pas « ouverte par défaut » : sous RLS, l'absence de politique REFUSE tout. C'est
-- la même posture que `player_rate_limits`, et elle est délibérée : cette table n'a aucune raison
-- d'être lue par un visiteur, ni par l'équipe.
--
-- ⚠️ ET « PERSONNE » EST VRAI EN EFFET, PAS EN DROIT — LA NUANCE EST TOUT CE QUI VOUS PROTÈGE.
-- Un hôte l'a relevé le 27/08 en appliquant cette migration : sur une installation de type
-- Supabase, `anon` possède le droit SELECT sur cette table, hérité des privilèges par défaut du
-- schéma `public`. Ce n'est donc PAS l'absence de `grant` qui ferme la table — c'est UNIQUEMENT la
-- RLS, et il n'y a rien en dessous. Le jour où quelqu'un ajoute une politique permissive « pour
-- débloquer un cas », il ne retire pas une protection sur deux : il retire la seule. Si vous
-- voulez la seconde couche, elle s'écrit chez vous (`revoke select on public.doc_tts_objects from
-- anon, authenticated;`) — ce dépôt ne la pose pas à votre place, parce que ces rôles sont ceux de
-- votre installation, pas de Postgres.
--
-- Ce que la forge vérifie désormais à chaque course, contre une vraie base : que la RLS déclarée
-- ici est bien RETENUE par le moteur, et qu'AUCUNE politique n'ouvre cette table.
alter table public.doc_tts_objects enable row level security;

comment on table public.doc_tts_objects is
  'Trace des objets écrits dans le bucket public tts-cache : une empreinte, une date, jamais le '
  'texte. Sans elle le bucket serait impurgeable — la capacité storage du contrat n''expose pas '
  'de listage. Voir docs/RETENTION.md.';
