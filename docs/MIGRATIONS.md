# Faire évoluer le schéma d'une instance déjà en service

`supabase/init.sql` amène une base **vierge** à l'état attendu, en un fichier rejouable. Ce
document traite l'autre moitié : ce qui arrive à une base **déjà en service** quand le player a
besoin d'une colonne de plus.

## ⚠️ Le player n'applique pas les migrations, et ne le pourra jamais

Il parle à la base uniquement par **PostgREST** (`/rest/v1/…`), qui n'exécute pas de DDL. Aucun
mécanisme d'auto-migration n'est envisageable : il faudrait exposer une fonction capable d'exécuter
du SQL arbitraire, c'est-à-dire donner au player un pouvoir qu'il n'a aucune raison d'avoir et que
personne ne veut voir dans un service qui sert des liens publics.

**C'est l'hôte qui applique. Le player, lui, doit savoir ce que le schéma porte** — et le dire quand
il manque quelque chose, au lieu de casser.

## La règle, et pourquoi elle n'est pas négociable

> **Une migration est ADDITIVE, et sûre à appliquer pendant que la version PRÉCÉDENTE du code
> tourne.**

Ajouter une colonne, une table, un index. Jamais renommer, jamais supprimer, jamais rendre
obligatoire ce qui ne l'était pas.

⚠️ **Sans cette règle, l'ordre de déploiement devient un piège.** PostgREST rejette un `PATCH`
portant une colonne inconnue : un hôte qui déploie le code avant la migration voit **toutes** ses
écritures échouer sur ce chemin — pas seulement la fonction nouvelle. Et il n'a aucun moyen de le
deviner : le message parle d'une colonne, pas d'une version.

Avec la règle, l'ordre ne compte plus. Migration avant code : la colonne existe et personne ne
l'écrit encore. Code avant migration : le player détecte l'absence et **dégrade en la nommant**.

## Écrire une migration

Un fichier par changement, dans `supabase/migrations/`, numéroté et jamais réécrit :

```
supabase/migrations/0001-nom-parlant.sql
```

Il commence par ce qu'il ajoute, pour qui, et ce qui se passe tant qu'il n'est pas appliqué :

```sql
-- 0001 — <ce que ça ajoute>
--
-- Pour : <la fonction qui en a besoin>
-- Sans lui : <la dégradation exacte, pas « ça ne marche pas »>
-- Sûre pendant que <version précédente> tourne : oui — additive.

alter table public.<table> add column if not exists <colonne> <type>;
```

`if not exists` partout : une migration doit être rejouable sans dommage, parce qu'un hôte qui ne
sait plus où il en est la rejouera.

## Le player détecte, il ne suppose pas

Il n'existe **aucune table de suivi des migrations**, et c'est délibéré : elle devrait elle-même
être créée par une migration, donc le premier pas retomberait sur le problème qu'elle résout. Et un
registre dit ce qu'on *croit* avoir appliqué ; une sonde dit ce qui *est*.

`server/schema.js` demande donc à la base ce qu'elle porte, une fois par processus, et le retient.
Quand une colonne manque, la fonction concernée dégrade et le journal nomme **le fichier à
appliquer** — pas « erreur de base ».

⚠️ **En cas de doute, le player considère la colonne ABSENTE.** Supposer présent ferait échouer
l'écriture entière ; supposer absent fait attendre une fonction. Une fonction qui attend vaut mieux
qu'une écriture perdue.
