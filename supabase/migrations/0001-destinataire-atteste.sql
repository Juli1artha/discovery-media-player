-- 0001 — le destinataire ATTESTÉ par l'hôte, séparé de qui peut expédier en son nom
--
-- Pour : un hôte qui identifie lui-même son visiteur (code à usage unique, espace projet) et veut
--        que ses lectures soient comptées, attribuées et révocables — sans lui donner de lien
--        anonyme, et sans exiger le jeton d'un membre qu'il n'a pas.
--
-- Sans lui : rien ne change. Les liens attestés ne peuvent pas être créés, et le player refuse la
--            demande en le disant. Aucune fonction existante n'est affectée.
--
-- Sûre pendant que la version précédente tourne : oui — additive, et personne ne lit ni n'écrit
-- cette colonne tant que le code qui la connaît n'est pas déployé.
--
-- ⚠️ POURQUOI UNE COLONNE PLUTÔT QU'UN DRAPEAU. `recipient_email` porte aujourd'hui DEUX faits :
-- « à qui ce lien est destiné » et « qui a le droit d'expédier en son nom au repartage ». Un lien
-- attesté par l'hôte doit avoir le premier sans le second — son visiteur n'a jamais engagé sa
-- responsabilité chez nous.
--
-- Un drapeau `atteste_par_hote` dirait « ne fais pas la chose » : il décrirait le correctif au lieu
-- du fait, et quelqu'un l'ignorerait dans six mois pour un cas qui semblerait différent. Avec deux
-- colonnes, la garde d'envoi (qui exige `recipient_email`) et l'héritage du repartage refusent tous
-- deux SANS SAVOIR POURQUOI on les protège. La règle devient une conséquence de la donnée.
--
-- Formulé par le second hôte, dont la demande a produit la séparation.

alter table public.commercial_doc_shares
  add column if not exists attested_recipient_email text;

comment on column public.commercial_doc_shares.attested_recipient_email is
  'Destinataire attesté par l''hôte : sert à ATTRIBUER une lecture, jamais à expédier en son nom. '
  'La colonne recipient_email, elle, dit qui peut expédier — vide quand personne ne le peut.';
