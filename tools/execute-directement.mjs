// « CE MODULE EST-IL LANCÉ DIRECTEMENT ? » — UNE SEULE RÉPONSE, ET ELLE COMPARE DES CHEMINS RÉELS.
//
// ⚠️ QUATORZE OUTILS POSAIENT CETTE QUESTION, EN TROIS ORTHOGRAPHES, ET TOUTES ÉTAIENT FAUSSES SUR
// macOS. La forme courante était :
//
//     import.meta.url === pathToFileURL(process.argv[1]).href
//
// Or Node résout les liens symboliques pour l'URL du module, mais PAS pour `process.argv[1]`. Sur
// macOS, `mkdtempSync(tmpdir())` rend un chemin sous `/var/folders/…`, qui est un lien vers
// `/private/var/folders/…` : les deux côtés de l'égalité décrivent le même fichier et ne se
// ressemblent pas. Le bloc n'est jamais exécuté — l'outil démarre, ne fait rien, et sort en 0.
//
// ⚠️ « IL TOURNE ET NE FAIT RIEN » EST LE PIRE SYMPTÔME POSSIBLE : pas d'erreur, pas de message, un
// code de sortie qui dit « tout va bien ». C'est ainsi que quatre essais des crochets git ont échoué
// sur macOS en restant verts en forge — `/tmp` sous Linux n'étant pas un lien. Un défaut que seule
// une plateforme révèle, dans une garde ajoutée pour un défaut que seul un import révélait.
//
// ⚠️ ET UNE ORTHOGRAPHE ÉTAIT PIRE QUE LES AUTRES : `import.meta.url === \`file://${argv}\`` n'encode
// pas les caractères spéciaux — un chemin contenant une espace ou un accent ne correspondait jamais,
// sur AUCUNE plateforme. Trois écritures de la même idée, trois comportements.
//
// La comparaison passe donc par `realpathSync` des deux côtés, une fois, ici. Diagnostiqué et
// corrigé par le second hôte, qui l'a reproduit, mesuré, et n'a rien poussé — c'était notre dépôt.

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Vrai si le module dont l'URL est passée est celui que Node a lancé.
 *
 * ⚠️ Rend FAUX plutôt que de lever quand un chemin n'existe pas — `realpathSync` lève sur un fichier
 * absent, et un module importé n'a aucune raison de faire tomber le processus pour ça. Le repli
 * « non, je ne suis pas le programme principal » est le seul sûr : au pire l'outil ne s'exécute pas,
 * jamais il ne s'exécute par erreur dans le processus de quelqu'un d'autre.
 */
export function estExecuteDirectement(urlModule) {
  const lance = process.argv[1];
  if (!lance) return false;
  try {
    return realpathSync(fileURLToPath(urlModule)) === realpathSync(lance);
  } catch {
    return false;
  }
}
