// CE QUE LE REGISTRE SERVIRA — UNE SEULE SONDE, POUR TOUTES LES QUESTIONS QU'ON LUI POSE.
//
// ⚠️ LE PÉRIMÈTRE SE DEMANDE À npm, PAS À `package.json#files` (revue externe, 21/08).
//
// `files` n'est pas la liste de ce qui part : npm AJOUTE des fichiers de lui-même et DÉVELOPPE les
// dossiers et les motifs. Constaté sur la 0.1.127 : le tarball contenait QUATRE Markdown —
// README.md, docs/HOST-CONTRACT.md, docs/RETENTION.md, et `docs/README.md` que `files` ne nomme
// pas. Ce quatrième voyageait sans être contrôlé.
//
// Il se trouve qu'il était en anglais, donc il n'y avait pas de violation. LE DÉFAUT ÉTAIT
// AILLEURS : la garde annonçait « 3 documents publiés, tous en anglais » alors qu'elle en
// regardait trois sur quatre. Une couverture affirmée plus large qu'elle n'est vaut moins que pas
// de couverture du tout — on cesse de vérifier ce qu'on croit déjà tenu.
//
// `npm pack --dry-run --json` dit exactement ce que le registre servira. C'est la source de
// vérité, et npm le recommande comme telle.
//
// ⚠️ ET LA SONDE VIT ICI, PAS DANS LA GARDE QUI L'A FAIT NAÎTRE. Deux propriétés s'appuient
// dessus — la langue des documents publiés, et les documents que le paquet PROMET de porter. Une
// sonde recopiée serait un second exemplaire, et ce dépôt sait ce que deviennent les exemplaires
// que rien ne confronte : les deux gardes finiraient par répondre sur deux inventaires différents.

import { execFileSync } from "node:child_process";

const PACK = () =>
  execFileSync("npm", ["pack", "--dry-run", "--json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 120000,
  });

/**
 * Tous les chemins que le tarball portera, tels que npm les annonce.
 *
 * ⚠️ LÈVE sur un inventaire vide plutôt que de rendre `[]`. Une liste vide et « npm n'a pas
 * répondu » se ressemblent, et l'une est un fait pendant que l'autre est une ignorance : rendre
 * `[]` ferait conclure « aucun document n'est en français » et « aucune promesse n'est rompue » à
 * une garde qui n'a rien pu lire.
 */
export function fichiersDuTarball(executer = PACK) {
  const brut = JSON.parse(executer());
  const entree = Array.isArray(brut) ? brut[0] : brut;
  const fichiers = (entree?.files || []).map((f) => f.path).filter((p) => typeof p === "string");
  if (!fichiers.length) throw new Error("npm pack n'a rendu aucun fichier — on ne conclut pas sur un inventaire vide");
  return fichiers.sort();
}

/** Les seuls Markdown de cet inventaire — la matière de la garde de langue. */
export const markdownsDuTarball = (executer = PACK) =>
  fichiersDuTarball(executer).filter((f) => f.toLowerCase().endsWith(".md"));
