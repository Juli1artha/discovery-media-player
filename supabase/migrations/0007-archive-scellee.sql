-- L'ARCHIVE ÉTAIT VÉRIFIÉE, PUIS L'ÉCRITURE PARTAIT SANS ELLE.
--
-- Sept chemins d'écriture (message, édition, suppression, réaction, présence, verrou, pièce
-- jointe) demandent d'abord si la présentation est archivée, puis écrivent. Entre les deux, une
-- clôture peut passer : un message atterrit dans une archive « en lecture seule ». La fenêtre est
-- étroite, mais la promesse — une archive ne bouge plus — était tenue par du code, pas par la base.
--
-- ⚠️ AUCUN FILTRE POSTGREST NE PEUT FERMER ÇA : les écritures visent doc_presentation_messages et
-- doc_presentation_attendees, la condition vit dans doc_presentations — une AUTRE table. Sans
-- transaction ni RPC côté player, l'arbitre ne peut être que la base elle-même. D'où ce trigger.
--
-- ⚠️ `FOR KEY SHARE` EST CE QUI REND LE REFUS ATOMIQUE, pas le simple test. Sans lui, une clôture
-- peut se COMMITTER entre la vérification du trigger et le commit de l'écriture — la fenêtre
-- rétrécit mais survit. Le verrou de ligne bloque la clôture concurrente jusqu'au commit de
-- l'écriture : l'ordre devient réel, plus probable.
--
-- Sans lui : rien ne casse — les sept chemins gardent leur vérification préalable, et la fenêtre
-- de course reste ce qu'elle était avant cette migration. Le trigger est le scellé, pas la porte.
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
    for key share;
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
