-- LE RECENSEMENT INDÉPENDANT — L'AUTRE MOITIÉ DU CONTRAT DE RÉTENTION.
--
-- Ce fichier recompte, en SQL nu, ce qui RESTE dans le périmètre que docs/RETENTION.md revendique.
-- Il ne partage RIEN avec `server/retention.js` : ni fonction, ni filtre, ni transport — deux
-- textes écrits séparément, qui ne peuvent pas être faux de la même manière (l'erreur partagée
-- rend un compte juste ; l'indépendance est la propriété, pas un style). Les fenêtres (13/12/13
-- mois) sont le CONTRAT commun : elles viennent du document, pas du code.
--
-- Usage : psql -f supabase/recensement-retention.sql — chaque ligne rend « table|restantes ».
-- Après une purge, tout doit être à zéro ; un reste est un mensonge de la purge OU un trou de
-- son périmètre. La forge l'exécute à chaque course, après le banc base.
select 'commercial_doc_views' as perimetre, count(*) as restantes
  from public.commercial_doc_views
  where at < now() - interval '13 months'
union all
select 'commercial_doc_sessions', count(*)
  from public.commercial_doc_sessions
  where last_at < now() - interval '13 months'
union all
select 'commercial_doc_internal_sessions', count(*)
  from public.commercial_doc_internal_sessions
  where last_at < now() - interval '13 months'
union all
select 'doc_bot_sessions', count(*)
  from public.doc_bot_sessions
  where last_at < now() - interval '13 months'
union all
select 'player_rate_limits', count(*)
  from public.player_rate_limits
  where expires_at < now()
union all
select 'commercial_doc_shares_revoques', count(*)
  from public.commercial_doc_shares
  where revoked and revoked_at < now() - interval '13 months'
union all
select 'doc_presentations_mortes', count(*)
  from public.doc_presentations
  where not active and updated_at < now() - interval '12 months'
union all
-- Messages et présences : orphelins d'une présentation morte-ancienne OU d'aucune présentation —
-- formulé par NOT EXISTS, pas par la liste de slugs que la purge a construite.
select 'doc_presentation_messages_orphelins', count(*)
  from public.doc_presentation_messages m
  where not exists (
    select 1 from public.doc_presentations p
    where p.slug = m.slug
      and (p.active or p.updated_at >= now() - interval '12 months'))
union all
select 'doc_presentation_attendees_orphelins', count(*)
  from public.doc_presentation_attendees a
  where not exists (
    select 1 from public.doc_presentations p
    where p.slug = a.slug
      and (p.active or p.updated_at >= now() - interval '12 months'));
