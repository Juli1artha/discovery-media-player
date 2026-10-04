// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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

// ⚠️ LE STDERR DE `npm pack` ÉTAIT JETÉ (`stdio: [..., "ignore"]`). Sur une forge dont le cache npm
// n'est pas inscriptible, `npm pack` sort en 255 avec `EPERM` — et la seule pièce conservée par la
// garde d'ordre était « code 255 », sans la cause. Un audit externe a passé une passe à attribuer six
// rouges avant de trouver l'`EPERM` (neuvième passe, 14/09). Le code, le signal et la fin du stderr
// traversent désormais l'erreur, bornés ; la sonde d'ordre les recopie dans ses pièces.
/** Lance `npm pack --dry-run --json` (ou la commande donnée) ; en cas d'échec, lève en NOMMANT la cause. */
export function lancerPack(commande = "npm", args = ["pack", "--dry-run", "--json"]) {
  try {
    return execFileSync(commande, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 120000 });
  } catch (e) {
    const stderr = String((e && e.stderr) || "").trim().split("\n").slice(-6).join(" | ").slice(0, 600);
    const err = new Error(`${commande} ${args.join(" ")} a échoué : code ${e && e.status}, signal ${(e && e.signal) || "aucun"}${stderr ? ` — stderr (fin) : ${stderr}` : " — stderr vide"}`);
    err.cause = e;
    throw err;
  }
}
const PACK = () => lancerPack();

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
