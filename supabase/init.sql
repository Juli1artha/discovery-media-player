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
  revoked_at      timestamptz,               -- date de l'acte : borne la rétention (RETENTION.md)
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
  brand_key       text,                      -- ⚠️ RÉFÉRENCE résolue à l'affichage (branding.forKey)
  -- Clé d'idempotence des liens SYSTÈME (hôte, répétition) — nulle sur les liens ordinaires.
  -- Unique quand renseignée : deux demandes simultanées ne créent qu'un lien.
  idem_key        text,
  -- Destinataire attesté par l'hôte : sert à ATTRIBUER une lecture, jamais à expédier en son nom.
  -- `recipient_email`, elle, dit qui peut expédier — vide quand personne ne le peut.
  attested_recipient_email text
);
create index if not exists cds_doc_id_idx on public.commercial_doc_shares (doc_id);
-- ⚠️ RÈGLE (sixième audit) : tout index sur une colonne apparue APRÈS un init déjà publié est
-- précédé de son ALTER, ICI MÊME. Le rattrapage de fin de fichier ne suffit pas : sur une base
-- d'hier, `create table if not exists` saute le corps de table, et l'index s'exécutait AVANT le
-- rattrapage — le rejeu cassait sur cette ligne. Garde : scénario CI « init v0.1.64 → rejeu ».
alter table public.commercial_doc_shares
  add column if not exists idem_key text;
create unique index if not exists cds_idem_key_uniq
  on public.commercial_doc_shares (idem_key)
  where idem_key is not null;
comment on column public.commercial_doc_shares.idem_key is
  'Clé d''idempotence des liens SYSTÈME (hôte, répétition) : empreinte « genre:sha256(JSON des '
  'composants) » — genre = hote | repetition. Les clés historiques au format concaténé '
  '« hote:<doc>|<email> » se remplacent d''elles-mêmes au réemploi (backfill). Nulle sur les '
  'liens ordinaires. Unique quand renseignée : deux demandes simultanées ne créent qu''un lien, '
  'la seconde relit le gagnant.';
create index if not exists cds_parent_idx on public.commercial_doc_shares (parent_slug);
create index if not exists idx_doc_shares_brand_key
  on public.commercial_doc_shares (brand_key) where brand_key is not null;
-- Filtres de rétention (migration 0014) : mêmes index sur une base vierge.
-- ⚠️ RÈGLE (sixième audit) : un index sur une colonne apparue APRÈS un init publié est précédé
-- de son ALTER, ICI MÊME — sur une base d'hier, `create table if not exists` saute le corps de
-- table et `revoked_at` n'existe qu'au rattrapage de fin de fichier, trop tard pour cet index.
alter table public.commercial_doc_shares
  add column if not exists revoked_at timestamptz;
create index if not exists idx_shares_revoked_at on public.commercial_doc_shares (revoked_at) where revoked = true;

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
create index if not exists idx_cds_last_at on public.commercial_doc_sessions (last_at);

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
  -- ⚠️ NULLABLE, ET C'EST LE CŒUR DU MODÈLE : null = archivée (plus de pilote). Déclarée NOT NULL
  -- jusqu'à la 0008, ce qui rendait la CLÔTURE impossible sur une base neuve — trouvé par le banc
  -- vraie base, seul endroit où une contrainte peut refuser quelque chose.
  control_hash   text,
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
  content        jsonb,                      -- carte / Street View (revalidé à la réception)
  -- Rang de la dernière écriture de pilotage acceptée. Une écriture de rang inférieur ou égal est
  -- refusée : elle a été doublée en vol. Remis à zéro par toute émission d'un jeton de contrôle
  -- (démarrage, reprise), qui ouvre un nouveau domaine d'ordre.
  write_seq      bigint not null default 0
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
  attachment    jsonb,
  -- Clé d'idempotence fabriquée par le client AVANT le premier envoi et réutilisée au renvoi :
  -- un renvoi réseau ne crée pas un second message. Nulle si le client ne la fournit pas.
  client_key    text,
  -- Rang de la dernière écriture de réactions acceptée : deux réactions simultanées ne
  -- s'écrasent plus — l'écriture conditionnée à un rang dépassé ne modifie rien, le serveur rejoue.
  reactions_seq bigint not null default 0,
  -- Rang GLOBAL bumpé à chaque écriture (insert/update) par le trigger dpm_bump_modseq : le client
  -- relit `mod_seq > curseur` au lieu des 300 derniers à chaque signal. Cf. migration 0016.
  mod_seq       bigint
);
create index if not exists dpm_slug_idx on public.doc_presentation_messages (slug, created_at);
-- ⚠️ Portée sur (slug, client_key), pas sur la clé seule : deux présentations n'ont aucune raison
-- de partager un espace de clés. Partiel, pour que les lignes sans clé ne se gênent pas entre elles.
-- Même règle que cds_idem_key_uniq : la colonne est assurée avant son index.
alter table public.doc_presentation_messages
  add column if not exists client_key text;
create unique index if not exists dpm_client_key_uniq
  on public.doc_presentation_messages (slug, client_key)
  where client_key is not null;

-- Chat différentiel (migration 0016) : rang global monotone bumpé à chaque écriture par un trigger.
-- ⚠️ RÈGLE (sixième audit) : la colonne est assurée par un ALTER AVANT son index — sur une base d'hier,
-- `create table if not exists` saute le corps et `mod_seq` n'existerait qu'ici.
alter table public.doc_presentation_messages
  add column if not exists mod_seq bigint;
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
drop trigger if exists dpm_bump_modseq on public.doc_presentation_messages;
create trigger dpm_bump_modseq
  before insert or update on public.doc_presentation_messages
  for each row execute function public.player_bump_message_seq();
-- ⚠️ Le rattrapage EXCLUT les présentations scellées (0007/0010) : le trigger dpm_archive_scellee lève
-- sur toute écriture dans une présentation gelée, et une seule de ses lignes ferait échouer l'install.
update public.doc_presentation_messages m
  set mod_seq = nextval('public.doc_presentation_messages_modseq')
  where m.mod_seq is null
    and not exists (
      select 1 from public.doc_presentations p
      where p.slug = m.slug and p.active = false and p.control_hash is null
    );
create index if not exists idx_dpm_slug_modseq
  on public.doc_presentation_messages (slug, mod_seq);

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
  -- Empreinte (jamais l'IP en clair) de l'appelant qui a CRÉÉ la ligne — plafond de création anonyme
  -- par (slug, empreinte). Cf. migration 0015. Nullable : les lignes d'avant ne la portent pas.
  creator_ip_hash text,
  primary key (slug, attendee_key)
);
create index if not exists doc_presentation_attendees_slug_idx on public.doc_presentation_attendees (slug);
-- ⚠️ RÈGLE (sixième audit) : un index sur une colonne apparue APRÈS un init publié est précédé de son
-- ALTER, ICI MÊME — sur une base d'hier, `create table if not exists` saute le corps de table et
-- `creator_ip_hash` n'existerait qu'au rattrapage de fin de fichier, trop tard pour cet index.
alter table public.doc_presentation_attendees
  add column if not exists creator_ip_hash text;
-- Compter les créations anonymes par (slug, empreinte) sans scanner toute la table. Cf. migration 0015.
create index if not exists idx_attendees_slug_creator
  on public.doc_presentation_attendees (slug, creator_ip_hash)
  where is_member = false and is_presenter = false;

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
create index if not exists idx_bot_last_at on public.doc_bot_sessions (last_at);
create index if not exists doc_bot_sessions_share_idx on public.doc_bot_sessions (share_slug);

-- ── Limites de débit partagées ─────────────────────────────────────────────────────────────────
-- ⚠️ EN MÉMOIRE, UNE LIMITE NE LIMITE RIEN. Chaque instance serverless a la sienne : N instances
-- accordent N fois le quota, et l'hôte croit être protégé. Le compteur vit donc en base.
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

-- ⚠️ ET LIRE PUIS ÉCRIRE N'EST PAS ATOMIQUE. Deux appels simultanés lisent le même compte et
-- écrivent la même valeur : la limite laisse passer le double. L'incrément se fait donc en UNE
-- instruction, côté serveur.
create or replace function public.player_rate_limit_bump(
  p_key text,
  p_max integer,
  p_window_seconds integer
)
returns table (autorise boolean, compte integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  insert into public.player_rate_limits as l (key, count, expires_at)
  values (p_key, 1, now() + make_interval(secs => p_window_seconds))
  on conflict (key) do update
    set count = case when l.expires_at <= now() then 1 else l.count + 1 end,
        expires_at = case when l.expires_at <= now()
                          then now() + make_interval(secs => p_window_seconds)
                          else l.expires_at end
  returning l.count into v_count;

  -- Le refus est décidé ICI, sur la valeur qu'on vient d'écrire : le client n'a rien à recalculer,
  -- donc rien à recalculer sur une valeur déjà périmée.
  return query select (v_count <= p_max), v_count;
end;
$$;
-- ⚠️ `anon` ET `authenticated` SONT DES RÔLES SUPABASE, PAS DES RÔLES POSTGRES. Les nommer en dur
-- faisait ÉCHOUER ce fichier sur un Postgres nu — donc chez tout hôte auto-hébergé, c'est-à-dire le
-- public que ce dépôt vise en s'ouvrant. Le `grant` ci-dessous était déjà gardé par un `if exists` ;
-- ce `revoke` ne l'était pas : la prudence s'arrêtait à mi-chemin. Trouvé par la garde de schéma.
--
-- `public` n'est pas un rôle mais un mot-clé : celui-là passe partout, et c'est le seul qui compte.
revoke all on function public.player_rate_limit_bump(text, integer, integer) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.player_rate_limit_bump(text, integer, integer) from %I', r);
    end if;
  end loop;
end
$$;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.player_rate_limit_bump(text, integer, integer) to service_role;
  end if;
end
$$;

-- Présence en un seul geste + plafond de création anonyme atomique. Cf. migration 0015 (mêmes règles).
create or replace function public.player_attendance_bump(
  p_slug         text,
  p_key          text,
  p_ip_hash      text,
  p_page         integer,
  p_name         text,
  p_avatar       text,
  p_is_member    boolean,
  p_is_presenter boolean,
  p_max_gap_ms   integer,
  p_anon_cap     integer
)
returns table (ok boolean, created boolean, capped boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_count  integer;
  v_page   integer := greatest(1, coalesce(p_page, 1));
begin
  -- Chemin rapide : la ligne existe déjà → c'est une ACTUALISATION, jamais soumise au plafond.
  select true into v_exists
    from public.doc_presentation_attendees
    where slug = p_slug and attendee_key = p_key;

  -- Création d'une ligne ANONYME : on sérialise par (slug, ip) et on compte sous le verrou, pour que
  -- deux créations concurrentes ne franchissent pas le plafond ensemble. Membres et présentateur en
  -- sont exemptés (leur identité est prouvée, ils ne gonflent pas de faux participants).
  if not coalesce(v_exists, false) and not p_is_member and not p_is_presenter then
    perform pg_advisory_xact_lock(hashtextextended(p_slug || '|' || coalesce(p_ip_hash, ''), 0));
    -- Re-lire sous le verrou : la ligne a pu naître entre la première lecture et ici (même clé,
    -- deux onglets). Si elle existe désormais, ce n'est plus une création → pas de plafond.
    select true into v_exists
      from public.doc_presentation_attendees
      where slug = p_slug and attendee_key = p_key;
    if not coalesce(v_exists, false) then
      select count(*) into v_count
        from public.doc_presentation_attendees
        where slug = p_slug
          and creator_ip_hash is not distinct from p_ip_hash
          and is_member = false and is_presenter = false;
      if v_count >= p_anon_cap then
        return query select false, false, true;   -- plafond atteint : on ne crée pas
        return;
      end if;
    end if;
  end if;

  -- L'écriture, en UN geste, pour la création comme pour l'actualisation. `last_seen` strictement
  -- croissant ; le temps ajouté est le trou depuis le dernier battement, ignoré au-delà de MAX_GAP
  -- (un onglet resté ouvert ne gonfle pas la présence) ; la page vue rejoint l'ensemble sans doublon.
  insert into public.doc_presentation_attendees as l
    (slug, attendee_key, name, email, avatar, is_member, is_presenter,
     first_seen, last_seen, total_ms, pages, creator_ip_hash)
  values
    (p_slug, p_key, nullif(p_name, ''), null, nullif(p_avatar, ''), p_is_member, p_is_presenter,
     now(), now(), 0, jsonb_build_array(v_page), p_ip_hash)
  on conflict (slug, attendee_key) do update
    set last_seen    = greatest(now(), l.last_seen + interval '1 millisecond'),
        total_ms     = l.total_ms + (
                         case
                           when (extract(epoch from (greatest(now(), l.last_seen + interval '1 millisecond') - l.last_seen)) * 1000) <= p_max_gap_ms
                           then (extract(epoch from (greatest(now(), l.last_seen + interval '1 millisecond') - l.last_seen)) * 1000)::bigint
                           else 0
                         end),
        pages        = case when l.pages @> to_jsonb(v_page) then l.pages else l.pages || to_jsonb(v_page) end,
        name         = coalesce(nullif(p_name, ''), l.name),
        avatar       = coalesce(nullif(p_avatar, ''), l.avatar),
        is_member    = p_is_member,
        is_presenter = p_is_presenter;

  return query select true, not coalesce(v_exists, false), false;
end;
$$;
revoke all on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer) from public;
do $$
declare
  r text;
begin
  foreach r in array array['anon', 'authenticated'] loop
    if exists (select 1 from pg_roles where rolname = r) then
      execute format('revoke all on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer) from %I', r);
    end if;
  end loop;
end
$$;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.player_attendance_bump(text, text, text, integer, text, text, boolean, boolean, integer, integer) to service_role;
  end if;
end
$$;

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
-- L'état de la présentation (page courante, carte, verrou) voyage en BROADCAST : l'audience suit
-- le présentateur sans qu'aucune table ne soit lisible publiquement. C'est ce qui permet de ne
-- créer aucune politique de lecture au-dessus.
--
-- ⚠️ LE CHAT AUSSI EST SUR CE CHEMIN, DÉSORMAIS. Un message émet un signal broadcast (`msg`,
-- `msg-upd`) et chaque participant RELIT l'historique par la route du player — le signal dit
-- « quelque chose a changé », jamais le contenu. Aucune politique de lecture n'est donc
-- nécessaire, et le chat est en direct sur une installation neuve.
--
-- (Ce commentaire a affirmé le contraire pendant plusieurs versions après le portage du chat en
-- broadcast — le troisième audit l'a relevé. Un commentaire périmé dans un fichier d'installation
-- n'est pas un détail : il pousse un mainteneur à « réparer » un différé qui n'existe plus, en
-- ajoutant précisément la politique de lecture que ce fichier refuse.)
--
-- ⚠️ Ne mettez de toute façon jamais de donnée confidentielle dans un message de chat ni dans un
-- nom d'auteur.
-- ⚠️ AUCUNE TABLE DU PLAYER N'EST PUBLIÉE DANS `supabase_realtime`, ET C'EST UN CHOIX. Le direct
-- passe par BROADCAST (un signal d'invalidation, jamais un contenu) suivi d'une relecture HTTP qui
-- sert la PROJECTION publique. Publier la table n'alimenterait personne tant que RLS reste sans
-- politique — mais laisserait armée la combinaison « quelqu'un ajoute un SELECT public un jour »
-- → la ligne ENTIÈRE part au navigateur, author_hash compris, en contournant la projection.
-- N'ajoutez pas non plus de politique SELECT publique « pour que le direct fonctionne » : c'est
-- l'erreur exacte dont l'hôte historique a dû sortir. (Jusqu'à la 0009, ce fichier ajoutait la
-- table à la publication avec REPLICA IDENTITY FULL — chaque réaction payait l'image complète de
-- la ligne dans le WAL, pour un canal que plus rien n'écoutait.)

-- ── Le scellé de l'archive ─────────────────────────────────────────────────────────────────────
-- Sept chemins d'écriture vérifient l'archive PUIS écrivent — dans une AUTRE table que celle qui
-- porte l'état. Aucun filtre PostgREST ne peut fermer cette fenêtre : l'arbitre est la base.
-- ⚠️ `FOR SHARE`, PAS `FOR KEY SHARE` — la clôture modifie des colonnes NON-CLÉS, son UPDATE prend
-- FOR NO KEY UPDATE, que KEY SHARE ne bloque pas. La 0007 a porté ce verrou trop faible pendant
-- une version, avec un commentaire qui affirmait l'atomicité (corrigé par la 0010, constat du
-- cinquième audit — VU au banc à deux transactions de la forge : le message entrait dans
-- l'archive). C'est FOR SHARE qui rend le refus atomique.
create or replace function public.player_archive_scellee()
returns trigger
language plpgsql
as $$
declare
  v_active boolean;
  v_control text;
begin
  select p.active, p.control_hash into v_active, v_control
    from public.doc_presentations p
    where p.slug = new.slug
    for share;
  -- Pas de présentation : rien à sceller (chat d'un lien sans session live, données historiques).
  if not found then return new; end if;
  if v_active = false and v_control is null then
    raise exception 'presentation archivee : ecriture refusee'
      using errcode = 'P0001', hint = 'l''archive est en lecture seule';
  end if;
  return new;
end
$$;

drop trigger if exists dpm_archive_scellee on public.doc_presentation_messages;
create trigger dpm_archive_scellee
  before insert or update on public.doc_presentation_messages
  for each row execute function public.player_archive_scellee();

drop trigger if exists dpa_archive_scellee on public.doc_presentation_attendees;
create trigger dpa_archive_scellee
  before insert or update on public.doc_presentation_attendees
  for each row execute function public.player_archive_scellee();

-- ── Rattrapage : bases installées depuis un init.sql plus ancien ───────────────────────────────
--
-- ⚠️ CE FICHIER A ÉTÉ INCOMPLET, ET RIEN NE LE DISAIT. Il annonçait « un seul fichier, sans rien à
-- lire ailleurs » alors qu'aucune des cinq migrations de `supabase/migrations/` n'y figurait : un
-- hôte neuf installait une base sans rang d'écriture, sans limites partagées et sans clé
-- d'idempotence. Les sondes de schéma dégradent en silence — par conception, pour ne pas casser un
-- hôte en cours de migration — donc cet hôte-là ne l'apprenait JAMAIS. Un état anormal que rien ne
-- dit devient l'état normal.
--
-- Les colonnes sont désormais dans le corps des tables ci-dessus, ce qui règle le cas d'une base
-- VIERGE. Mais `create table if not exists` ne touche pas une table déjà là : une base créée
-- depuis l'ancien init.sql resterait incomplète en rejouant celui-ci. D'où ce rattrapage, qui ne
-- coûte rien sur une base neuve et rend le fichier vrai dans les deux cas.
alter table public.commercial_doc_shares
  add column if not exists attested_recipient_email text;
alter table public.doc_presentations
  add column if not exists write_seq bigint not null default 0;
alter table public.doc_presentation_messages
  add column if not exists client_key text;
alter table public.commercial_doc_shares
  add column if not exists idem_key text;
alter table public.commercial_doc_shares
  add column if not exists revoked_at timestamptz;
update public.commercial_doc_shares set revoked_at = now() where revoked = true and revoked_at is null;
-- Une base née d'un init.sql d'avant la 0008 porte un NOT NULL qui rend la clôture impossible.
alter table public.doc_presentations
  alter column control_hash drop not null;
alter table public.doc_presentation_messages
  add column if not exists reactions_seq bigint not null default 0;
