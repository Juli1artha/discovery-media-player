-- LE CHAT NE PASSE PLUS PAR POSTGRES CHANGES — LA BASE DOIT CESSER DE LE PROPOSER.
--
-- Les messages voyagent en broadcast (signal d'invalidation) suivi d'une relecture HTTP bornée,
-- qui sert la PROJECTION publique — jamais la ligne brute. Publier la table dans
-- `supabase_realtime` n'alimentait donc plus personne : RLS sans politique de lecture, rien ne
-- sortait. Mais une surface qui ne sert plus n'est pas une surface neutre : le jour où quelqu'un
-- ajoute une politique SELECT « pour que le direct fonctionne » (l'erreur exacte dont l'hôte
-- historique a dû sortir), la publication redevient un canal — qui livre la ligne ENTIÈRE,
-- author_hash compris, en contournant la projection.
--
-- ⚠️ ET `REPLICA IDENTITY FULL` COÛTE À CHAQUE ÉCRITURE, PAS SEULEMENT EN THÉORIE : chaque
-- réaction, chaque édition écrit l'image complète de la ligne dans le WAL. On revient à DEFAULT.
--
-- ⚠️ LE CAS `FOR ALL TABLES` REFUSE BRUYAMMENT. PostgreSQL ne sait pas exclure UNE table d'une
-- publication totale, et reconstruire la publication toucherait des tables qui appartiennent à
-- l'exploitant. On échoue avec la marche à suivre — un échec net vaut mieux qu'un « réussi » qui
-- n'a rien retiré.
--
-- Sans lui : rien ne casse — le chat fonctionne déjà sans ce canal. La surface reste simplement
-- ouverte, et le WAL continue de payer le plein tarif sur chaque réaction.
do $$
declare
  v_toutes boolean;
begin
  select puballtables into v_toutes from pg_publication where pubname = 'supabase_realtime';
  if v_toutes is null then
    return;   -- pas de publication : rien à retirer (Postgres nu, ou realtime jamais activé)
  end if;
  if v_toutes then
    raise exception 'supabase_realtime est FOR ALL TABLES : impossible d''en exclure doc_presentation_messages seule. Recréez la publication en liste explicite (opération de l''exploitant), puis rejouez cette migration.';
  end if;
  if exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public'
      and tablename = 'doc_presentation_messages'
  ) then
    execute 'alter publication supabase_realtime drop table public.doc_presentation_messages';
  end if;
end
$$;

alter table public.doc_presentation_messages replica identity default;
