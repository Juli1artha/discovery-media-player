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
taperait lui-même. Mais `vercel.json` porte un `installCommand` qui installe le **tarball du
commit** (`npm pack` à la racine, puis installation du `.tgz`). Deux raisons, et la seconde compte
davantage :

1. **Sur une PR de montée de version, la version épinglée n'existe pas encore sur npm.** Le
   déploiement échouait alors à chaque fois — `No matching version found`. Un contrôle qui échoue
   par construction cesse d'être lu, et le rouge de déploiement sert aussi à autre chose.
2. **Sans cela, la préversion déploie le player publié, jamais le code de la PR.** Elle ressemble à
   une vérification sans en être une : verte quoi que la PR change au player.

⚠️ **Un tarball, pas un chemin.** `npm install ../..` crée un lien symbolique, et Node résout alors
les dépendances du player depuis le dépôt — qui n'a pas de `node_modules` sur la plateforme :
`Cannot find module 'pdfjs-dist/package.json'`. Le tarball, lui, est déballé dans `node_modules`
comme un paquet ordinaire.

⚠️ **Et `vercel.json` n'accepte aucun commentaire** — son schéma est strict, une clé `"//"` fait
échouer le déploiement avant le build. C'est pourquoi cette explication vit ici et non à côté du
réglage qu'elle explique. La CI fait déjà ce choix pour l'exemple `express` (installé depuis le
tarball du commit) ; la démo ne le faisait pas.
