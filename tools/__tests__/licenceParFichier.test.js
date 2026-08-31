// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA FRONTIÈRE DE LICENCE MORD DANS LES DEUX SENS, ET SUR L'IDENTIFIANT EXACT.
//
// Ce banc éprouve tools/licence-par-fichier.mjs par mutation : chaque `it` retire ou déforme UNE
// propriété de l'arbre et affirme le verdict exact (0 / 1 / 2, au sens de resultat-garde.mjs).
// Deux cas méritent leur nom :
//   - « AGPL-3.0 » tronqué : une vérification par INCLUSION l'accepterait (« AGPL-3.0-or-later »
//     contient « AGPL-3.0 ») alors qu'il désigne une AUTRE licence. Seule l'égalité stricte refuse.
//   - bridge.ts repassé AGPL : la frontière ne protège pas que le cœur contre le MIT — elle
//     protège aussi le contrat hôte contre un relicenciement silencieux vers l'AGPL.

import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { garde, FICHIERS_MIT } from "../licence-par-fichier.mjs";
import { CONFORME, VIOLATION, INCONCLUSIF, tenter } from "../resultat-garde.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTETE = "// SPDX-License-Identifier: AGPL-3.0-or-later\n// Copyright © 2026 3D Discovery\n";
const crees = [];

/** Un dépôt git minimal mais VRAI : la garde énumère par `git ls-files`, pas par le disque. */
function depot(garnir) {
  const d = mkdtempSync(join(tmpdir(), "licences-"));
  crees.push(d);
  execFileSync("git", ["init", "-q"], { cwd: d });
  writeFileSync(join(d, "package.json"), JSON.stringify({ name: "x", license: "AGPL-3.0-or-later", author: "3D Discovery" }));
  mkdirSync(join(d, "server"), { recursive: true });
  mkdirSync(join(d, "src"), { recursive: true });
  garnir(d);
  execFileSync("git", ["add", "-A"], { cwd: d });
  return d;
}

afterAll(() => {
  for (const d of crees) { try { rmSync(d, { recursive: true, force: true }); } catch { /* rien */ } }
});

describe("licence-par-fichier : la frontière est un fait par fichier", () => {
  it("un arbre où chaque fichier porte ses deux lignes est conforme", () => {
    const d = depot((r) => {
      writeFileSync(join(r, "server/a.js"), ENTETE + "module.exports = 1;\n");
      writeFileSync(join(r, "src/bridge.ts"), "// SPDX-License-Identifier: MIT\n// Copyright © 2026 3D Discovery\nexport {};\n");
    });
    expect(garde(d).code).toBe(CONFORME);
  });

  it("un shebang a le droit de précéder l'en-tête", () => {
    const d = depot((r) => {
      writeFileSync(join(r, "server/cli.js"), "#!/usr/bin/env node\n" + ENTETE + "process.exit(0);\n");
    });
    expect(garde(d).code).toBe(CONFORME);
  });

  it("un fichier sans SPDX est une violation qui le nomme", () => {
    const d = depot((r) => { writeFileSync(join(r, "server/nu.js"), "module.exports = 1;\n"); });
    const res = garde(d);
    expect(res.code).toBe(VIOLATION);
    expect(res.constats.join("\n")).toContain("server/nu.js");
  });

  it("un identifiant TRONQUÉ est refusé — l'inclusion l'aurait accepté", () => {
    const d = depot((r) => {
      writeFileSync(join(r, "server/tronque.js"), "// SPDX-License-Identifier: AGPL-3.0\n// Copyright © 2026 3D Discovery\n");
    });
    expect(garde(d).code, "« AGPL-3.0 » n'est pas « AGPL-3.0-or-later » : autre licence").toBe(VIOLATION);
  });

  it("du MIT dans le cœur est une violation", () => {
    const d = depot((r) => {
      writeFileSync(join(r, "server/fuite.js"), "// SPDX-License-Identifier: MIT\n// Copyright © 2026 3D Discovery\n");
    });
    expect(garde(d).code).toBe(VIOLATION);
  });

  it("bridge.ts repassé AGPL est une violation — la frontière mord dans les deux sens", () => {
    const d = depot((r) => {
      writeFileSync(join(r, "src/bridge.ts"), ENTETE + "export {};\n");
    });
    const res = garde(d);
    expect(res.code).toBe(VIOLATION);
    expect(res.constats.join("\n")).toContain("MIT");
  });

  it("un copyright absent, ou qui ne nomme pas le titulaire de package.json, est une violation", () => {
    const sans = depot((r) => { writeFileSync(join(r, "server/s.js"), "// SPDX-License-Identifier: AGPL-3.0-or-later\nmodule.exports = 1;\n"); });
    expect(garde(sans).code).toBe(VIOLATION);
    const autre = depot((r) => { writeFileSync(join(r, "server/t.js"), "// SPDX-License-Identifier: AGPL-3.0-or-later\n// Copyright © 2026 Quelqu'un d'Autre\n"); });
    expect(garde(autre).code, "le titulaire est un fait de package.json, pas une décoration").toBe(VIOLATION);
  });

  it("sans package.json — ou sans `license`/`author` — la garde ne conclut pas (2, pas 1)", () => {
    const d = mkdtempSync(join(tmpdir(), "licences-"));
    crees.push(d);
    execFileSync("git", ["init", "-q"], { cwd: d });
    expect(garde(d).code, "pas de source de vérité : personne n'a rien violé").toBe(INCONCLUSIF);
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "x" }));
    expect(garde(d).code).toBe(INCONCLUSIF);
  });

  it("zéro fichier source suivi : la sonde vise à côté (2)", () => {
    const d = depot(() => { /* rien que package.json */ });
    expect(garde(d).code).toBe(INCONCLUSIF);
  });

  it("hors d'un dépôt git, `tenter` classe l'exception en non concluant", () => {
    const d = mkdtempSync(join(tmpdir(), "licences-"));
    crees.push(d);
    writeFileSync(join(d, "package.json"), JSON.stringify({ name: "x", license: "AGPL-3.0-or-later", author: "3D Discovery" }));
    expect(tenter(() => garde(d)).code).toBe(INCONCLUSIF);
  });

  // ⚠️ LE TEST QUI ÉCHOUE SANS CE CHANGEMENT : avant lui, 257 fichiers du dépôt n'avaient aucun
  // en-tête et la frontière MIT/AGPL n'existait qu'en prose. Il échoue aussi le jour où un fichier
  // arrive sans ses deux lignes — c'est son travail permanent.
  it("le dépôt lui-même est conforme, exception MIT comprise", () => {
    const res = garde(RACINE);
    expect(res.constats ?? [], "des fichiers du dépôt ont perdu leur en-tête").toEqual([]);
    expect(res.code).toBe(CONFORME);
    expect(FICHIERS_MIT.has("src/bridge.ts"), "l'exception déclarée doit rester le contrat hôte").toBe(true);
  });

  // ⚠️ CE BANC-CI AFFIRMAIT QUE LE NOM EST DANS L'ENSEMBLE, JAMAIS QUE LE FICHIER EXISTE.
  //
  // La nuance est toute la garde. `FICHIERS_MIT` est une liste de ce qui est PERMIS — forme juste,
  // et elle a le droit d'être écrite. Mais elle n'était tenue que dans un sens : le jour où
  // `src/bridge.ts` est renommé, l'entrée SURVIT, et un futur fichier à ce chemin exact serait
  // relicencié MIT sans que personne le décide. L'en-tête de la liste dit pourtant qu'ajouter un
  // fichier ici « se discute dans une PR, pas dans un correctif de garde » : le relicenciement se
  // ferait par omission, sur une frontière de licence, garde verte.
  // ⚠️ ET CE CONTRÔLE VIT DANS LE BANC, PAS DANS L'OUTIL — LES ÉPROUVETTES L'ONT DIT.
  //
  // Première écriture : la vérification était dans `garde()`. Deux bancs ont rougi aussitôt, et ils
  // avaient raison. `garde(racine)` s'applique à une RACINE QUELCONQUE — les éprouvettes lui
  // passent des dépôts temporaires — tandis que `FICHIERS_MIT` est une constante du VRAI dépôt.
  // Dans l'outil, la règle accusait chaque éprouvette de ne pas contenir `src/bridge.ts`.
  //
  // Un contrôle d'exception appartient là où le SUJET est connu. C'est déjà ce que fait la garde
  // des planchers avec ses exemptions : la raison et sa vérification vivent dans le banc.
  it("⚠️ chaque exception MIT a encore un sujet — sinon c'est une porte ouverte d'avance", () => {
    const suivis = new Set(execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean));
    expect(suivis.size, "`git ls-files` n'a rien rendu : ce banc vise à côté").toBeGreaterThan(100);

    const mortes = [...FICHIERS_MIT].filter((f) => !suivis.has(f));
    expect(
      mortes,
      "une exception MIT déclarée pour un fichier que le dépôt ne suit plus : RETIREZ l'entrée, sinon un futur fichier à ce chemin sera relicencié MIT sans décision",
    ).toEqual([]);
  });
});
