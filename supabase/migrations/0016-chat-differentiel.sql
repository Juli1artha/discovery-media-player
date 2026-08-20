-- LE CHAT NE SE RELIT PLUS EN ENTIER À CHAQUE SIGNAL — SEULEMENT CE QUI A CHANGÉ DEPUIS.
--
-- ⚠️ P « architecture scalable » (audit CODEX 5.6). À chaque resynchronisation, l'audience relisait
-- les 300 messages les plus récents — pour une salle de N spectateurs qui se resynchronisent, c'est N
-- fois 300 lignes, alors que presque rien n'a bougé entre deux signaux. Le client sait déjà fusionner
-- par id (addMsg/updateMsg) ; il lui manque de quoi demander « donne-moi ce qui a changé depuis X ».
--
-- Un chat est MUTABLE : un message ancien reçoit une réaction, est édité, est supprimé. Un curseur sur
-- `id` (croissant à l'insertion) raterait ces mutations. D'où `mod_seq` — un rang bumpé à CHAQUE
-- écriture, insertion ET mise à jour — par un TRIGGER, depuis une séquence (atomique, aucune course).
-- Le nom suit la convention IMAP CONDSTORE (MODSEQ), qui résout exactement ce problème : un compteur
-- monotone par collection, avancé à chaque changement, pour une synchro différentielle. Le client
-- garde le plus grand `mod_seq` vu et demande `mod_seq > curseur` : il récupère les nouveaux messages
-- ET les anciens qui ont changé, et rien d'autre.
--
-- ⚠️ POURQUOI UN TRIGGER, alors que reactions_seq est bumpé par le CODE : reactions_seq est LOCAL à un
-- message (le rang de SA dernière écriture de réactions). `mod_seq` est GLOBAL et doit croître à chaque
-- écriture de N'IMPORTE quel chemin (envoi, édition, suppression, réaction) sans les toucher tous —
-- un before-insert-or-update le fait en un endroit, et `nextval` est atomique là où un
-- lire-max-puis-écrire ne l'est pas. Même famille que le trigger de scellé d'archive (0007).
--
-- ⚠️ Sans lui : le player sonde la colonne `mod_seq` (server/schema.js) ; absente, il sert les 300 plus
--    récents comme avant, et le client retombe sur la relecture complète. Rien ne casse, la charge
--    n'est simplement pas encore allégée. Additive et rejouable ; applicable pendant que le code tourne.

alter table public.doc_presentation_messages
  add column if not exists mod_seq bigint;

-- La séquence qui rend `mod_seq` globalement monotone, quel que soit le chemin d'écriture.
create sequence if not exists public.doc_presentation_messages_modseq;

create or replace function public.player_bump_message_seq()
returns trigger
language plpgsql
as $$
begin
  new.mod_seq := nextval('public.doc_presentation_messages_modseq');
  return new;
end;
$$;

-- ⚠️ AVANT insert OU update : toute écriture acceptée avance le curseur. Un spectateur en retard
-- récupère ainsi une réaction posée sur un vieux message, pas seulement les messages neufs.
drop trigger if exists dpm_bump_modseq on public.doc_presentation_messages;
create trigger dpm_bump_modseq
  before insert or update on public.doc_presentation_messages
  for each row execute function public.player_bump_message_seq();

-- Rattrapage des lignes déjà présentes : sans `mod_seq`, elles seraient invisibles au différentiel.
-- Une seule fois, dans l'ordre d'insertion, pour donner à chacune un rang cohérent.
update public.doc_presentation_messages
  set mod_seq = nextval('public.doc_presentation_messages_modseq')
  where mod_seq is null;

-- La lecture différentielle `slug=eq.X&mod_seq=gt.N&order=mod_seq.asc` doit rester rapide.
create index if not exists idx_dpm_slug_modseq
  on public.doc_presentation_messages (slug, mod_seq);
