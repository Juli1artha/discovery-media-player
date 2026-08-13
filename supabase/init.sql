-- ══════════════════════════════════════════════════════════════════════════════════════════════
--  DISCOVERY MEDIA PLAYER — schéma d'installation
--
--  Amène une base VIERGE à l'état attendu par le player. Un seul fichier, rejouable
--  (tout est `if not exists` / `create or replace`), sans rien à lire ailleurs.
--
--  ⚠️ POURQUOI UN INIT PLUTÔT QUE LA SUITE DES MIGRATIONS. Les tables du player sont nées
--  entrelacées dans les 145 migrations de son premier hôte. Reconstituer leur état en rejouant
--  cette suite obligerait chaque nouvel hôte à décider, fichier par fichier, lesquelles le
--  concernent — depuis un dépôt qu'il ne connaît pas, en devinant. Cette question a une bonne
--  réponse une seule fois : ici. (Demandée par le second hôte avant sa propre installation.)
--
--  ⚠️ CE FICHIER INSTALLE DÉJÀ DURCI. L'hôte historique a connu un état transitoire où les
--  présentations étaient lisibles anonymement (le suivi en direct passait par la lecture de
--  table, or Supabase Realtime `postgres_changes` exige un SELECT au niveau de la TABLE — donc
--  ouvert à quiconque a la clé publiable). Le player suit maintenant l'état par BROADCAST : une
--  base neuve n'a aucune raison de passer par là, et **ne doit pas**. Il n'y a rien à durcir
--  après coup, et donc aucune fenêtre pendant laquelle un document sensible serait exposé.
--
--  Une base EXISTANTE, elle, doit d'abord déployer le code broadcast et le vérifier avant de
--  retirer ces politiques : les retirer trop tôt fige les audiences en cours, sans erreur
--  visible. Cet avertissement ne concerne pas une installation neuve.
--
--  ACCÈS. Aucune politique RLS permissive n'est créée : RLS est activé et **rien ne passe** hors
--  `service_role`. C'est voulu — le player n'est jamais appelé depuis le navigateur avec la clé
--  publiable, il est appelé côté serveur. Toute lecture passe par sa route, qui décide.
-- ══════════════════════════════════════════════════════════════════════════════════════════════

-- ── Liens de partage tracés ────────────────────────────────────────────────────────────────────
-- Un lien par destinataire : c'est ce qui permet de dire QUI a lu, pas seulement COMBIEN de fois.
create table if not exists public.commercial_doc_shares (
  slug            text primary key,          -- randomBytes(9).toString("base64url")
  doc_id          text not null,             -- identifiant du document CHEZ L'HÔTE (opaque ici)
  doc_title       text,
  file_url        text not null,             -- doit passer la garde anti-SSRF du player
  file_name       text,                      -- ⚠️ dit la NATURE du document (pdf vs image)
  recipient_email text,
  recipient_name  text,
  created_by      text,
  created_at      timestamptz not null default now(),
  revoked         boolean not null default false,
  parent_slug     text,                      -- re-partage : le lien d'où celui-ci est issu
  bot_enabled     boolean not null default false,
  bot_script      text,
  bot_guided      boolean not null default true,
  bot_profile_id  text,
  allow_download  boolean not null default true,
  is_test         boolean default false,     -- répétition générale : exclue des statistiques
  video_layout    text,
  brand_logo      text,                      -- logo RECOPIÉ (flux historiques, toujours accepté)
  brand_dark      boolean not null default false,
  require_auth    boolean not null default false,
  brand_key       text                       -- ⚠️ RÉFÉRENCE résolue à l'affichage (branding.forKey)
);
create index if not exists cds_doc_id_idx on public.commercial_doc_shares (doc_id);
create index if not exists cds_parent_idx on public.commercial_doc_shares (parent_slug);
create index if not exists idx_doc_shares_brand_key
  on public.commercial_doc_shares (brand_key) where brand_key is not null;

-- ── Journal des ouvertures (population EXTERNE) ────────────────────────────────────────────────
create table if not exists public.commercial_doc_views (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null,
  doc_id          text,
  recipient_email text,
  event           text not null,             -- open | page | heartbeat
  page            integer,
  max_page        integer,
  seconds         integer,
  session_id      text,
  at              timestamptz not null default now(),
  ua              text
);
create index if not exists cdv_slug_idx on public.commercial_doc_views (slug);
create index if not exists cdv_doc_idx  on public.commercial_doc_views (doc_id, at desc);
create index if not exists commercial_doc_views_at_idx on public.commercial_doc_views (at);

-- ── Sessions de lecture : le résumé riche (temps par page, appareil) ───────────────────────────
-- ⚠️ DEUX POPULATIONS, JAMAIS FUSIONNÉES. Un destinataire externe et un membre de l'hôte qui
-- relit son propre document ne racontent pas la même chose : mélangés, le second gonfle les
-- statistiques du premier et « ce prospect a lu 12 minutes » devient faux.
create table if not exists public.commercial_doc_sessions (
  session_id      text primary key,
  slug            text not null,
  doc_id          text,
  recipient_email text,
  num_pages       integer,
  max_page        integer,
  total_seconds   integer default 0,
  pages_time      jsonb   default '{}'::jsonb,
  ua              text,
  ip              text,
  device          text,
  os              text,
  browser         text,
  started_at      timestamptz not null default now(),
  last_at         timestamptz not null default now()
);
create index if not exists cds_sess_slug_idx on public.commercial_doc_sessions (slug);
create index if not exists cds_sess_doc_idx  on public.commercial_doc_sessions (doc_id, last_at desc);

create table if not exists public.commercial_doc_internal_sessions (
  session_id    text primary key,
  doc_id        text,
  user_email    text,
  user_name     text,
  num_pages     integer,
  max_page      integer,
  total_seconds integer default 0,
  pages_time    jsonb   default '{}'::jsonb,
  device        text,
  os            text,
  browser       text,
  started_at    timestamptz not null default now(),
  last_at       timestamptz not null default now()
);
create index if not exists cdis_doc_idx on public.commercial_doc_internal_sessions (doc_id, last_at desc);
create index if not exists commercial_doc_internal_sessions_last_at_idx
  on public.commercial_doc_internal_sessions (last_at);

-- ── Présentation en direct ─────────────────────────────────────────────────────────────────────
-- `control_hash` : c'est LUI qui distingue le présentateur de l'audience. Le slug seul ne donne
-- que le droit de suivre.
create table if not exists public.doc_presentations (
  slug           text primary key,
  control_hash   text not null,
  doc_id         text,
  file_url       text not null,
  file_name      text,
  doc_title      text,
  presenter_name text,
  current_page   integer not null default 1,
  active         boolean not null default true,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  chat_locked    boolean not null default false,
  owner_user_id  text,
  owner_name     text,
  owner_avatar   text,
  owner_email    text,
  last_seen      timestamptz not null default now(),
  content        jsonb                       -- carte / Street View (revalidé à la réception)
);
create index if not exists doc_presentations_active_idx      on public.doc_presentations (active, updated_at);
create index if not exists doc_presentations_last_seen_idx   on public.doc_presentations (active, last_seen);
create index if not exists doc_presentations_owner_active_idx      on public.doc_presentations (owner_user_id, active);
create index if not exists doc_presentations_owner_email_active_idx on public.doc_presentations (owner_email, active);

create table if not exists public.doc_presentation_messages (
  id            bigint generated by default as identity primary key,
  slug          text not null,
  author_name   text,
  author_email  text,
  author_avatar text,
  author_hash   text,                        -- ⚠️ jeton d'auteur : autorise l'édition/suppression
  is_presenter  boolean not null default false,
  is_member     boolean not null default false,
  body          text not null,
  created_at    timestamptz not null default now(),
  reactions     jsonb not null default '{}'::jsonb,
  reply_to      bigint,
  reply_name    text,
  reply_text    text,
  deleted       boolean not null default false,
  edited        boolean not null default false,
  attachment    jsonb
);
create index if not exists dpm_slug_idx on public.doc_presentation_messages (slug, created_at);

create table if not exists public.doc_presentation_attendees (
  slug         text not null,
  attendee_key text not null,
  name         text,
  email        text,
  avatar       text,
  is_member    boolean not null default false,
  is_presenter boolean not null default false,
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  total_ms     bigint not null default 0,
  pages        jsonb not null default '[]'::jsonb,
  primary key (slug, attendee_key)
);
create index if not exists doc_presentation_attendees_slug_idx on public.doc_presentation_attendees (slug);

-- ── Assistant IA (greffon `bot`) ───────────────────────────────────────────────────────────────
-- Facultatif : le player fonctionne sans (PLAYER_PLUGINS_OFF=bot). La table peut rester vide.
create table if not exists public.doc_bot_sessions (
  id             text primary key,
  share_slug     text not null,
  doc_id         text,
  current_page   integer not null default 1,
  phase          text not null default 'intro',
  created_at     timestamptz not null default now(),
  last_at        timestamptz not null default now(),
  in_tokens      bigint  not null default 0,
  cache_tokens   bigint  not null default 0,
  out_tokens     bigint  not null default 0,
  ai_calls       integer not null default 0,
  ai_cost        numeric not null default 0,
  bot_profile_id text,
  mobile         boolean,
  is_test        boolean default false,
  rating         smallint,
  rating_comment text,
  agent_id       text,
  journey_step   text,
  etat           jsonb
);
create index if not exists doc_bot_sessions_share_idx on public.doc_bot_sessions (share_slug);

-- ── Accès ──────────────────────────────────────────────────────────────────────────────────────
-- RLS activé SANS politique permissive : seul `service_role` (donc la route du player) passe.
-- ⚠️ N'ajoutez pas de politique de lecture publique « pour que le direct fonctionne ». C'est
-- précisément l'état dont l'hôte historique a dû sortir : le suivi passe par broadcast.
alter table public.commercial_doc_shares             enable row level security;
alter table public.commercial_doc_views              enable row level security;
alter table public.commercial_doc_sessions           enable row level security;
alter table public.commercial_doc_internal_sessions  enable row level security;
alter table public.doc_presentations                 enable row level security;
alter table public.doc_presentation_messages         enable row level security;
alter table public.doc_presentation_attendees        enable row level security;
alter table public.doc_bot_sessions                  enable row level security;

-- ── Temps réel ─────────────────────────────────────────────────────────────────────────────────
-- Le chat en direct reste en `postgres_changes` : ses messages sont écrits POUR être vus de
-- l'audience. L'état de la présentation, lui, voyage en broadcast — d'où l'absence de
-- `doc_presentations` ici, et l'absence de politique de lecture au-dessus.
-- ⚠️ Ne mettez jamais de donnée confidentielle dans un message de chat ni dans un nom d'auteur.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public'
        and tablename = 'doc_presentation_messages'
    ) then
      execute 'alter publication supabase_realtime add table public.doc_presentation_messages';
    end if;
  end if;
end $$;
alter table public.doc_presentation_messages replica identity full;
