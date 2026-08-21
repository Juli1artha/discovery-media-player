# The live demo

The smallest possible host: **one function, one dependency, no decisions.**

```
package.json     depends on the player
vercel.json      two rewrites, and the line that ships the folder with the function
api/doc.js       ~20 lines — sets the document folder, initialises, delegates
documents/       one sample PDF
```

No database, no secret, no wiring file. Everything that needs a decision — who may send a
document, what a client's brand is — belongs to tracked links, and there are none here.

## Deploying your own

Import this repository into Vercel with **Root Directory** set to `examples/demo`. Nothing else:
no environment variable is required.

⚠️ **`includeFiles` is not optional.** Serverless platforms ship the code, not the folder. Without
that line the PDF simply does not exist at runtime, and the page says there is nothing to display —
which is true, and unhelpful.

⚠️ **`PLAYER_LOCAL_ROOT` is computed in the code**, not set as an environment variable. The
platform decides where it runs the function; an absolute path written by hand is correct on one
platform and wrong on the next.

## Pourquoi cette démo installe le player depuis le dépôt

`package.json` épingle la version **publiée** — c'est ce qu'un copieur doit voir, la ligne qu'il
taperait lui-même. Mais le déploiement, lui, doit installer le **tarball du commit**. Deux raisons,
et la seconde compte davantage :

1. **Sur une PR de montée de version, la version épinglée n'existe pas encore sur npm.** Le
   déploiement échoue alors — `No matching version found`. Un contrôle qui échoue par construction
   cesse d'être lu, et le rouge de déploiement sert aussi à autre chose.
2. **Sans cela, la préversion déploie le player publié, jamais le code de la PR.** Elle ressemble à
   une vérification sans en être une : verte quoi que la PR change au player.

### ⚠️ Le réglage vit dans le tableau de bord Vercel, PAS dans `vercel.json`

Project Settings → Build and Deployment → Framework Settings → **Install Command** :

```
cd ../.. && npm pack --silent && cd examples/demo && npm install --silent --ignore-scripts ../../discovery-media-player-*.tgz
```

**Et ce n'est pas un choix de goût.** Poser `installCommand` dans `examples/demo/vercel.json` donne
le pire des deux mondes, mesuré :

- Vercel **le lit** (il apparaît dans « Production Overrides ») ;
- sa présence **verrouille** le champ du tableau de bord — Vercel désactive les réglages qu'un
  `vercel.json` définit ;
- mais il **ne s'exécute pas sur les préversions**. Éprouvé en épinglant une version qui n'existera
  jamais (`0.1.999`) : la préversion échoue en `ETARGET`, ce qu'aucune disponibilité npm ne peut
  expliquer. C'est le seul essai qui départage — trois « verts » et deux « rouges » précédents
  s'expliquaient tous par la présence ou l'absence du paquet sur le registre, pas par la commande.

Un réglage de **projet**, lui, s'applique aux préversions comme à la production.

⚠️ **Un tarball, pas un chemin.** `npm install ../..` crée un lien symbolique, et Node résout alors
les dépendances du player depuis le dépôt — qui n'a pas de `node_modules` sur la plateforme :
`Cannot find module 'pdfjs-dist/package.json'`. Le tarball est déballé comme un paquet ordinaire.

⚠️ **`../..` n'existe pendant le build que si « Include files outside the root directory » est
activé** (Root Directory = `examples/demo`). Il l'est.

La CI fait déjà ce choix pour l'exemple `express` (installé depuis le tarball du commit).
