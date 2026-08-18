-- LE SCELLÉ DE L'ARCHIVE PRÉTENDAIT UNE ATOMICITÉ QUE SON VERROU NE FOURNISSAIT PAS.
--
-- La 0007 verrouillait la présentation en FOR KEY SHARE — et son commentaire affirmait que c'était
-- « ce qui rend le refus atomique ». Faux : la clôture modifie `active` et `control_hash`, des
-- colonnes NON-CLÉS, donc son UPDATE prend FOR NO KEY UPDATE — que KEY SHARE ne bloque PAS
-- (matrice des verrous PostgreSQL : KEY SHARE ne conflit qu'avec FOR UPDATE). Le trigger vérifiait
-- « ouverte », la clôture se committait sous lui, le message entrait dans l'archive : la fenêtre
-- que 0007 prétendait fermer était ouverte. Constat P1-1 du cinquième audit — VU au banc de la
-- forge : deux transactions psql, l'écriture n'attendait pas la clôture.
--
-- FOR SHARE, lui, conflit avec FOR NO KEY UPDATE : une clôture non committée fait ATTENDRE
-- l'écriture (qui voit ensuite l'archive et est refusée) ; une écriture en cours fait attendre la
-- clôture. Le coût est nul en pratique : plusieurs écritures partagent le verrou entre elles,
-- seule la clôture entre en conflit — précisément l'objectif.
--
-- Sans lui : le scellé garde sa valeur de refus (une écriture APRÈS la clôture committée est
-- toujours refusée) — seule la fenêtre concurrente reste ouverte, comme entre 0007 et 0010.
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
  if not found then return new; end if;
  if v_active = false and v_control is null then
    raise exception 'presentation archivee : ecriture refusee'
      using errcode = 'P0001', hint = 'l''archive est en lecture seule';
  end if;
  return new;
end
$$;
