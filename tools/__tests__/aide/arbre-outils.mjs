// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// MONTER UN ARBRE QUI A LA FORME DU DÉPÔT, ET Y LANCER UN OUTIL.
//
// ⚠️ UNE SEULE ÉCRITURE POUR LES DEUX BANCS QUI EN ONT BESOIN. `planchersDesGardes` demande « que
// fait un outil sur un dépôt VIDE ? » et `environnementDepouille` demande « que fait-il quand
// l'ENVIRONNEMENT manque ? ». Les deux montent le même arbre. Deux exemplaires de « à quoi
// ressemble un dépôt de ce projet » divergeraient : le jour où un dossier s'ajoute ici, l'autre
// banc éprouverait un arbre qui n'est plus celui du dépôt, et son vert cesserait de dire ce qu'il
// prétend — sans que rien ne le signale. C'est la classe de défaut que ce dépôt retire partout.

import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

export const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Les dossiers qu'un dépôt de ce projet porte — la FORME, sans le contenu. */
export const SOUS_DOSSIERS = ["tools", "server", "docs", "examples", "charge", "base", ".github/workflows", "src"];

/**
 * Monte un arbre qui a la FORME du dépôt, et le rend au chemin où il vit.
 * `garnir` reçoit le chemin et peut y déposer ce que l'éprouvette demande.
 */
export function arbre(garnir) {
  const d = mkdtempSync(join(tmpdir(), "arbre-outils-"));
  for (const sous of SOUS_DOSSIERS) mkdirSync(join(d, sous), { recursive: true });
  cpSync(join(RACINE, "tools"), join(d, "tools"), { recursive: true });
  try { symlinkSync(join(RACINE, "node_modules"), join(d, "node_modules")); } catch { /* déjà là */ }
  if (garnir) garnir(d);
  return d;
}

/**
 * Lance un outil dans un arbre et rend son code de sortie avec ce qu'il a imprimé.
 * `env` permet de lui donner un environnement dépouillé.
 */
export function lancer(nom, ou, env) {
  try {
    const sortie = execFileSync(process.execPath, [join("tools", nom)], {
      cwd: ou, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...(env ? { env } : {}),
    });
    return { code: 0, sortie: String(sortie || "") };
  } catch (e) {
    return { code: e.status ?? 1, sortie: String(e.stdout || "") + String(e.stderr || "") };
  }
}
