// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE RÈGLE CODEOWNERS QUI NE DÉSIGNE RIEN EST UNE PROTECTION QU'ON CROIT AVOIR.
//
// GitHub n'avertit jamais qu'un motif ne matche aucun fichier : la ligne est acceptée, la revue
// obligatoire ne se déclenche jamais, et le dépôt paraît protégé (P2, audit externe du 21/08).
// Un chemin renommé — `/docs/RETENTION.md` déplacé, `/server/` découpé — vide silencieusement la
// règle qui le nommait.
//
// ⚠️ C'EST UN DÉTECTEUR D'ABSENCE, DONC SA PANNE RESSEMBLE À SON SUCCÈS. Si l'analyse cesse de
// reconnaître une ligne, elle ne trouve plus de règle vide : verte, et aveugle. D'où le plancher —
// zéro règle lue n'est pas un succès, c'est un aveu.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** Les règles : motif + propriétaires. Commentaires et lignes vides écartés. */
export function regles(texte) {
  return texte
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const parts = l.split(/\s+/);
      return { motif: parts[0], proprietaires: parts.slice(1) };
    });
}

/** Un motif CODEOWNERS désigne-t-il au moins un des fichiers suivis ? */
export function designeQuelqueChose(motif, fichiers) {
  if (motif === "*") return fichiers.length > 0;
  const nu = motif.replace(/^\//, "");
  if (motif.endsWith("/")) return fichiers.some((f) => f.startsWith(nu));
  if (motif.includes("*")) {
    const re = new RegExp("^" + nu.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, "[^/]*") + "$");
    return fichiers.some((f) => re.test(f) || re.test(f.split("/").pop()));
  }
  return fichiers.some((f) => f === nu || f.startsWith(nu + "/"));
}

export function ecarts(texte, fichiers) {
  const soucis = [];
  for (const { motif, proprietaires } of regles(texte)) {
    if (!proprietaires.length) {
      soucis.push(`\`${motif}\` n'a aucun propriétaire : la ligne ne protège rien`);
      continue;
    }
    if (!designeQuelqueChose(motif, fichiers)) {
      soucis.push(`\`${motif}\` ne désigne aucun fichier suivi — la revue obligatoire ne se déclenchera jamais pour cette zone`);
    }
  }
  return soucis;
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const texte = readFileSync("CODEOWNERS", "utf8");
    const lues = regles(texte);

    // ⚠️ ZÉRO RÈGLE LUE N'EST PAS UN SUCCÈS : c'est le signe que l'analyse ne reconnaît plus une
    // ligne, pas que le fichier est sain. Une garde d'absence doit distinguer « rien à redire »
    // de « rien vu ».
    if (!lues.length) {
      return inconclusif("aucune règle lue dans CODEOWNERS — le fichier est vide, ou l'analyse ne reconnaît plus ses lignes");
    }

    const fichiers = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
    if (!fichiers.length) {
      return inconclusif("`git ls-files` n'a rien rendu — impossible de dire si un motif désigne quelque chose");
    }

    const soucis = ecarts(texte, fichiers);
    if (soucis.length) return violation(soucis);
    return conforme(`CODEOWNERS : ${lues.length} règle(s), toutes avec un propriétaire et désignant au moins un fichier suivi (sur ${fichiers.length} suivis)`);
  }));
}
