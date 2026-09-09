// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ CETTE GARDE NAÎT SUR DEUX DÉFAUTS RÉELS, PAS SUR UNE CRAINTE. Le 09/09 : `0.1.159` a une
// section et aucun tag (numéro sauté), et `v0.1.84` est PUBLIÉE au registre sans aucune section —
// celui-là avait soixante-seize versions et personne ne l'avait vu. Ces bancs fixent les deux bouts.

const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

let garde;
beforeAll(async () => { garde = await import("../sections-et-tags.mjs"); });

const CHANGELOG = (versions) => "# Changelog\n\n"
  + versions.map((v) => `## [${v}] — 2026-01-01\n\n### Changed\n\n- rien\n`).join("\n");

const arbre = (versions, versionDuPaquet) => {
  const d = mkdtempSync(join(tmpdir(), "sections-tags-"));
  writeFileSync(join(d, "CHANGELOG.md"), CHANGELOG(versions));
  if (versionDuPaquet) writeFileSync(join(d, "package.json"), JSON.stringify({ version: versionDuPaquet }));
  return d;
};
const tags = (liste) => () => liste.join("\n") + "\n";

describe("la confrontation elle-même", () => {
  it("apparie section et tag par le préfixe « v »", () => {
    expect(garde.confronter(["0.1.2", "0.1.1"], ["v0.1.2", "v0.1.1"]))
      .toEqual({ sectionsSansTag: [], tagsSansSection: [] });
  });

  it("⚠️ un tag qui n'est pas une version est ignoré — un `v999-test` ne fait pas un écart", () => {
    expect(garde.tagsDeVersion("v0.1.2\nv999-test\nlatest\nv0.1.1\n")).toEqual(["v0.1.2", "v0.1.1"]);
  });
});

describe("ce que la garde refuse", () => {
  it("⚠️ une section sans tag : le lien publié ne résoudra pas", () => {
    const d = arbre(["0.1.3", "0.1.2"]);
    try {
      const r = garde.auditer(d, { lireTags: tags(["v0.1.2"]) });
      expect(r.code).toBe(1);
      expect(r.constats.join(" ")).toContain("[0.1.3]");
      expect(r.constats.join(" ")).toContain("ne résout pas");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("⚠️ un tag sans section : la Release publie des notes vides", () => {
    const d = arbre(["0.1.2"]);
    try {
      const r = garde.auditer(d, { lireTags: tags(["v0.1.2", "v0.1.9"]) });
      expect(r.code).toBe(1);
      expect(r.constats.join(" ")).toContain("v0.1.9");
      expect(r.constats.join(" ")).toContain("notes vides");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("⚠️ un TAG MORT dont le registre sert la version : l'exemption a survécu à son motif", () => {
    // C'est ce qui distingue une exemption vérifiée d'une liste blanche : la raison écrite est
    // « jamais publié », donc elle cesse d'être vraie le jour où la version paraît.
    const d = arbre(["0.1.2"]);
    try {
      const r = garde.auditer(d, {
        lireTags: tags(["v0.1.2", "v0.1.141"]),
        estPubliee: (v) => v === "0.1.141",
      });
      expect(r.code).toBe(1);
      expect(r.constats.join(" ")).toContain("a survécu à son motif");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("un tag mort NON publié reste toléré — c'est la reprise documentée", () => {
    const d = arbre(["0.1.2"]);
    try {
      const r = garde.auditer(d, {
        lireTags: tags(["v0.1.2", "v0.1.141"]),
        estPubliee: () => false,
      });
      expect(r.code).toBe(0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe("dettes datées : elles passent, et elles PARLENT", () => {
  it("⚠️ une dette déclarée ne bloque pas, mais elle est imprimée à chaque exécution", () => {
    // La différence entre une dette et une exemption : les deux laissent passer, une seule le dit.
    // Un silence ici ferait de la garde un complice plutôt qu'un témoin.
    const d = arbre(["0.1.159", "0.1.158"]);
    try {
      const r = garde.auditer(d, { lireTags: tags(["v0.1.158"]) });
      expect(r.code).toBe(0);
      expect(r.avertissements.join(" ")).toContain("0.1.159");
      expect(r.avertissements.join(" ")).toContain("numéro sauté");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("⚠️ chaque dette porte une raison substantielle, pas une étiquette", () => {
    for (const raison of [...Object.values(garde.SANS_TAG), ...Object.values(garde.SANS_NOTES),
      ...Object.values(garde.TAGS_MORTS)]) {
      expect(raison.length).toBeGreaterThan(60);
    }
  });
});

describe("la version en préparation", () => {
  it("⚠️ la version que `package.json` DÉCLARE n'a pas encore son tag, et c'est normal", () => {
    // Le tag est posé APRÈS la fusion. Sans cette exception, la garde rougirait à chaque train —
    // et c'est le banc « le dépôt lui-même » qui l'a trouvé, sur la première version préparée
    // après son écriture.
    const d = arbre(["0.1.3", "0.1.2"], "0.1.3");
    try {
      expect(garde.auditer(d, { lireTags: tags(["v0.1.2"]) }).code).toBe(0);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("⚠️ l'exception ne dispense QUE celle-là — une autre section sans tag reste refusée", () => {
    // Ancrée sur `package.json` et non sur « la plus haute » : un numéro sauté en tête serait
    // dispensé par erreur, ce qui est exactement le défaut que cette garde existe pour voir.
    const d = arbre(["0.1.4", "0.1.3", "0.1.2"], "0.1.4");
    try {
      const r = garde.auditer(d, { lireTags: tags(["v0.1.2"]) });
      expect(r.code).toBe(1);
      expect(r.constats.join(" ")).toContain("[0.1.3]");
      expect(r.constats.join(" ")).not.toContain("[0.1.4]");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("sans package.json lisible, aucune section n'est dispensée", () => {
    const d = arbre(["0.1.3", "0.1.2"]);
    try {
      expect(garde.auditer(d, { lireTags: tags(["v0.1.2"]) }).code).toBe(1);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe("ce que la garde refuse d'affirmer", () => {
  it("⚠️ un dépôt cloné SANS TAGS rend NON CONCLUANT — sinon tout paraîtrait sans tag", () => {
    const d = arbre(["0.1.2"]);
    try {
      const r = garde.auditer(d, { lireTags: () => "\n" });
      expect(r.code).toBe(2);
      expect(r.raisons.join(" ")).toContain("rien n'a été vérifié");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("⚠️ un CHANGELOG dont le format a changé rend NON CONCLUANT, jamais conforme", () => {
    const d = mkdtempSync(join(tmpdir(), "sections-tags-"));
    writeFileSync(join(d, "CHANGELOG.md"), "# Changelog\n\nrien de reconnaissable\n");
    try {
      const r = garde.auditer(d, { lireTags: tags(["v0.1.2"]) });
      expect(r.code).toBe(2);
      expect(r.raisons.join(" ")).toContain("la sonde vise à côté");
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe("le dépôt lui-même", () => {
  it("⚠️ la confrontation tient sur CE dépôt — et c'est CE banc qui le mesure", () => {
    const r = garde.auditer();
    expect(r.code).toBe(0);
  });

  it("⚠️ les deux dettes réelles sont NOMMÉES, pas seulement tolérées", () => {
    const dit = garde.auditer().avertissements.join(" ");
    expect(dit).toContain("0.1.159");
    expect(dit).toContain("v0.1.84");
  });
});
