-- COMPTER SANS SE FAIRE DOUBLER.
--
-- Le compteur partagé faisait trois gestes : lire, calculer, écrire. Sous charge — c'est-à-dire
-- exactement quand une limite sert à quelque chose — plusieurs requêtes lisent le même compte et
-- écrivent chacune « ce compte + 1 ». Vingt requêtes simultanées sur une limite de dix passent
-- toutes. Une limite qui ne tient que lorsque personne ne pousse ne limite rien.
--
-- ⚠️ POURQUOI UNE FONCTION SQL ICI, alors que tout le reste du player tient en PostgREST simple.
-- L'incrément atomique n'est PAS exprimable en REST : `on conflict do update set count = count + 1`
-- a besoin de nommer la colonne des deux côtés, ce que le protocole ne permet pas. C'est la seule
-- opération du produit qui exige de dire quelque chose que REST ne sait pas dire — et la garde de
-- portabilité de la forge reste vraie, parce qu'un `rpc/` n'ajoute ni jointure ni arbre booléen.
--
-- ⚠️ LA FENÊTRE EST REMISE À NEUF, PAS PROLONGÉE. `expires_at` n'est réécrit que lorsque la
-- précédente est expirée : sans ça, chaque appel repousserait l'échéance et la fenêtre glisserait
-- indéfiniment — un visiteur régulier ne verrait jamais son compteur repartir de zéro.
--
-- Sans lui : le player laisse passer, et le dit une fois dans son journal en nommant ce fichier.
-- Les limites restent celles d'avant — comptées par instance et non atomiques — donc plusieurs
-- requêtes simultanées peuvent dépasser le plafond ensemble. Rien ne casse, rien ne se ferme : un
-- 429 raté coûte moins cher qu'une visionneuse morte, et une garde qui s'ouvre doit le dire.
--
-- Applicable pendant que la version précédente tourne : tant que le code ne l'appelle pas, elle
-- ne fait rien ; dès qu'il l'appelle, elle compte juste.

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

-- Le player parle à la base avec la clé de service ; personne d'autre n'a à appeler ceci.
revoke all on function public.player_rate_limit_bump(text, integer, integer) from public, anon, authenticated;
