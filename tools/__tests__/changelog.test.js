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
import { ecarts, sections, titres, titresRepetes, sousSectionsRepetees, references, urlAttendue, blocReferences, sectionDe, DEPOT } from "../changelog.mjs";

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

describe("un titre écrit deux fois", () => {
  // ⚠️ CE N'EST PAS UN CAS D'ÉCOLE : deux branches ont chacune ouvert leur `## [Unreleased]`, git
  // les a fusionnées SANS CONFLIT (lignes différentes), et la garde n'a rien dit parce qu'elle ne
  // relevait que des numéros de version. `sectionDe()` s'arrête au titre suivant : la sortie
  // aurait publié la première moitié des notes, l'autre restant dans le fichier.
  const double = "## [Unreleased]\n### Fixed\n- ici\n\n"
    + accorde.replace("## [0.1.1]", "## [Unreleased]\n### Added\n- ailleurs\n\n## [0.1.1]");

  it("relève TOUS les titres, `[Unreleased]` compris — ce que `sections` ne fait pas", () => {
    expect(titres(double)).toEqual(["Unreleased", "0.1.3", "Unreleased", "0.1.1"]);
    expect(sections(double)).toEqual(["0.1.3", "0.1.1"]);
  });

  it("⚠️ est refusé, en disant ce qui se perdrait", () => {
    expect(titresRepetes(double)).toHaveLength(1);
    expect(ecarts(double).join(" ")).toMatch(/« Unreleased » écrite 2 fois/);
    expect(ecarts(double).join(" ")).toMatch(/les notes de sortie s'arrêtent à la première/);
  });

  it("⚠️ et la conséquence est mesurée, pas supposée : la moitié des notes disparaît", () => {
    expect(sectionDe(double, "Unreleased")).not.toContain("ailleurs");
  });

  it("une version écrite deux fois est refusée par la même règle", () => {
    expect(titresRepetes(accorde.replace("## [0.1.1]", "## [0.1.3]"))).toHaveLength(1);
  });

  it("se tait sur un fichier dont chaque titre est unique", () => {
    expect(titresRepetes(accorde)).toEqual([]);
  });
});

describe("une sous-section écrite deux fois dans la même version", () => {
  // ⚠️ UNE RÈGLE CORRIGÉE À UN NIVEAU NE PROTÈGE PAS CELUI DU DESSOUS, et ce dépôt l'a payé deux
  // jours de suite. `titresRepetes` est né d'un `## [Unreleased]` doublé ; le lendemain, un merge a
  // produit deux `### Fixed` sous une même version — même cause exactement (deux branches ouvrent
  // chacune la leur, git fusionne sans conflit) — et la garde est restée VERTE, parce qu'elle ne
  // relevait que les titres `##`.
  const double = CHL(`
## [Unreleased]
### Fixed
- ici

### Fixed
- ailleurs

## [0.1.1] — 2026-01-01
### Added
- un

[Unreleased]: ${DEPOT}/compare/v0.1.1...HEAD
[0.1.1]: ${DEPOT}/releases/tag/v0.1.1
`);

  it("⚠️ est refusée, en nommant la version ET la sous-section", () => {
    const [souci] = sousSectionsRepetees(double);
    expect(souci).toContain("Unreleased");
    expect(souci).toContain("Fixed");
    expect(souci, "le message doit dire ce que ça coûte au lecteur").toContain("en trouvera la moitié");
  });

  it("`ecarts` la remonte — sinon la règle existerait sans être appliquée", () => {
    expect(ecarts(double).join(" ")).toMatch(/sous-section « Fixed » est écrite 2 fois/);
  });

  it("⚠️ la garde du niveau au-dessus ne la voyait PAS — c'est tout le sujet", () => {
    expect(titresRepetes(double), "les titres `##` sont uniques ici, et pourtant le fichier est fautif").toEqual([]);
  });

  it("⚠️ mais deux versions ayant CHACUNE sa `### Fixed` sont parfaitement normales", () => {
    // Le faux positif à ne pas commettre : c'est la répétition DANS une version qui est fautive,
    // pas la présence du même intitulé d'une version à l'autre — ce qui est le cas de tout le
    // fichier réel, sur 138 sections.
    expect(sousSectionsRepetees(accorde.replace("### Fixed", "### Fixed").replace("### Added", "### Fixed"))).toEqual([]);
  });

  it("se tait sur le CHANGELOG réel du dépôt", () => {
    expect(sousSectionsRepetees(readFileSync("CHANGELOG.md", "utf8"))).toEqual([]);
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

  it("⚠️ ne porte PAS deux `[Unreleased]` — il en a porté deux, et personne ne l'a vu", () => {
    // ⚠️ « AU PLUS UN », PAS « EXACTEMENT UN », et c'est une sortie qui l'a appris à ce banc.
    // Publier une version REMPLACE le titre `[Unreleased]` par celui de la version : entre la
    // sortie et le premier changement suivant, le fichier n'en porte AUCUN — état parfaitement
    // normal, que la première rédaction de ce test appelait une faute. Ce qu'on refuse est le
    // doublon, pas l'absence. (Le lien de bas de page `[Unreleased]:`, lui, reste exigé à un
    // exemplaire par `ecarts` : c'est lui qui pointe la comparaison vers HEAD.)
    expect(titres(reel).filter((t) => t === "Unreleased").length).toBeLessThanOrEqual(1);
  });

  it("contient bien la discontinuité qui interdit le calcul naïf", () => {
    const v = sections(reel);
    expect(v[v.indexOf("0.1.85") + 1]).toBe("0.1.83");
    expect(references(reel).get("0.1.85")).toBe(`${DEPOT}/compare/v0.1.83...v0.1.85`);
  });
});
