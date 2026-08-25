// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'ACCORD TITRES ↔ RÉFÉRENCES, ÉPROUVÉ SUR LES DEUX DÉFAUTS QUI L'ONT RENDU NÉCESSAIRE.
//
// Les références se sont arrêtées à la 0.1.41 pendant 77 versions : 76 titres pointaient dans le
// vide, et rien ne le disait. Puis un contre-audit a montré qu'une référence PRÉSENTE pouvait être
// fausse — `compare/v0.1.40...v0.1.42` passait, alors que la 0.1.41 précède la 0.1.42.
//
// ⚠️ ET LA DISCONTINUITÉ EST UN CAS RÉEL, PAS UNE CURIOSITÉ : la 0.1.85 suit la 0.1.83 dans ce
// fichier. Une garde qui calculerait « patch − 1 » accuserait une référence parfaitement juste, et
// la seule issue serait de réécrire l'histoire pour la satisfaire.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { ecarts, sections, references, urlAttendue, blocReferences, sectionDe, DEPOT } from "../changelog.mjs";

const CHL = (corps) => corps.trim() + "\n";
const accorde = CHL(`
## [0.1.3] — 2026-01-03
### Fixed
- trois

## [0.1.1] — 2026-01-01
### Added
- un

[Unreleased]: ${DEPOT}/compare/v0.1.3...HEAD
[0.1.3]: ${DEPOT}/compare/v0.1.1...v0.1.3
[0.1.1]: ${DEPOT}/releases/tag/v0.1.1
`);

describe("un fichier accordé", () => {
  it("ne signale rien", () => {
    expect(ecarts(accorde)).toEqual([]);
  });

  it("lit les sections dans l'ordre du fichier, plus récente d'abord", () => {
    expect(sections(accorde)).toEqual(["0.1.3", "0.1.1"]);
  });

  it("la plus ancienne pointe sa release, pas une comparaison", () => {
    expect(urlAttendue(["0.1.3", "0.1.1"], 1)).toBe(`${DEPOT}/releases/tag/v0.1.1`);
  });

  it("une discontinuité se dérive de l'ORDRE, jamais de patch − 1", () => {
    // Le cas 0.1.85 → 0.1.83, en miniature : 0.1.3 précédée par 0.1.1, et c'est correct.
    expect(urlAttendue(["0.1.3", "0.1.1"], 0)).toBe(`${DEPOT}/compare/v0.1.1...v0.1.3`);
  });
});

describe("les quatre désaccords que la garde doit voir", () => {
  it("une section sans référence", () => {
    const txt = accorde.replace(`[0.1.3]: ${DEPOT}/compare/v0.1.1...v0.1.3\n`, "");
    expect(ecarts(txt).join(" ")).toMatch(/section 0\.1\.3 sans référence/);
  });

  it("une référence orpheline", () => {
    const txt = accorde + `[9.9.9]: ${DEPOT}/compare/v9.9.8...v9.9.9\n`;
    expect(ecarts(txt).join(" ")).toMatch(/référence 9\.9\.9 sans section/);
  });

  it("un [Unreleased] périmé", () => {
    const txt = accorde.replace("compare/v0.1.3...HEAD", "compare/v0.1.1...HEAD");
    expect(ecarts(txt).join(" ")).toMatch(/\[Unreleased\]/);
  });

  it("une URL présente mais aux bornes fausses — le défaut du contre-audit", () => {
    const txt = accorde.replace("compare/v0.1.1...v0.1.3", "compare/v0.1.0...v0.1.3");
    expect(ecarts(txt).join(" ")).toMatch(/référence 0\.1\.3 .*au lieu de/);
  });
});

describe("le bloc régénéré", () => {
  it("reproduit exactement ce qu'un fichier accordé contient déjà", () => {
    const bloc = blocReferences(accorde);
    for (const ligne of bloc.split("\n")) expect(accorde).toContain(ligne);
  });

  it("répare un fichier désaccordé — appliqué, les écarts disparaissent", () => {
    const casse = accorde.replace("compare/v0.1.1...v0.1.3", "compare/v0.1.0...v0.1.3");
    const repare = casse.split("\n").filter((l) => !/^\[(Unreleased|\d+\.\d+\.\d+)\]: /.test(l)).join("\n")
      + "\n" + blocReferences(casse) + "\n";
    expect(ecarts(repare)).toEqual([]);
  });
});

describe("sectionDe — ce que la Release publie comme notes", () => {
  it("rend le corps de la version, sans son titre", () => {
    const corps = sectionDe(accorde, "0.1.3");
    expect(corps).toContain("- trois");
    expect(corps).not.toContain("## [0.1.3]");
    expect(corps).not.toContain("- un");
  });

  it("rend vide pour une version absente — pas de notes, pas de sortie", () => {
    expect(sectionDe(accorde, "9.9.9")).toBe("");
  });

  it("la dernière section du fichier n'emporte pas le bloc de références", () => {
    expect(sectionDe(accorde, "0.1.1")).not.toContain("[Unreleased]:");
  });
});

describe("le CHANGELOG réel du dépôt", () => {
  // ⚠️ La garde de la garde : les cas synthétiques ci-dessus prouvent la logique, celui-ci prouve
  // qu'elle s'applique au fichier qu'on publie vraiment — 124 sections et une discontinuité.
  const reel = readFileSync("CHANGELOG.md", "utf8");

  it("est accordé", () => {
    expect(ecarts(reel)).toEqual([]);
  });

  it("contient bien la discontinuité qui interdit le calcul naïf", () => {
    const v = sections(reel);
    expect(v[v.indexOf("0.1.85") + 1]).toBe("0.1.83");
    expect(references(reel).get("0.1.85")).toBe(`${DEPOT}/compare/v0.1.83...v0.1.85`);
  });
});
