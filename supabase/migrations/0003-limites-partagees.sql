-- 0003 — un compteur de débit partagé entre les instances
--
-- Pour : que les limites du player comptent pour l'INSTANCE et non pour le processus. En
--        serverless, plusieurs exécutions servent en parallèle et démarrent à froid : un compteur
--        en mémoire est divisé par le nombre d'instances, sans que rien ne le dise.
--
-- Sans lui : le player retombe sur le compteur en mémoire — le comportement d'avant — et le signale
--            une fois en nommant ce fichier. Aucune limite ne disparaît ; elles comptent seulement
--            par processus, ce qui les rend plus lâches qu'annoncé.
--
-- Sûre pendant que la version précédente tourne : oui — nouvelle table, que personne ne lit encore.
--
-- ⚠️ ACCÈS RÉSERVÉ AU SERVICE. Un compteur de débit lisible par le public dirait à un attaquant
-- exactement où il en est ; modifiable, il ne limiterait rien. Aucune politique n'est ouverte : seule
-- la clé de service y accède, comme pour toutes les tables que le navigateur ne touche jamais.

create table if not exists public.player_rate_limits (
  key         text primary key,
  count       integer not null default 0,
  expires_at  timestamptz not null
);

create index if not exists player_rate_limits_expires_idx
  on public.player_rate_limits (expires_at);

alter table public.player_rate_limits enable row level security;

comment on table public.player_rate_limits is
  'Compteurs de débit partagés entre instances. Une ligne par clé et par fenêtre ; les lignes '
  'périmées sont écrasées à la première demande suivante, il n''y a rien à purger.';
