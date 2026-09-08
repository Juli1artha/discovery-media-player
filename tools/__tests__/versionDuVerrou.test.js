// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ CETTE GARDE NAÎT SUR UN DÉFAUT RÉEL, PAS SUR UNE CRAINTE — et c'est ce qui la distingue des
// autres gardes vertes du dossier. Le 05/09, `package.json` déclarait `0.1.156` et le verrou
// `0.1.145` : onze trains d'écart. Ces bancs fixent les deux bouts — que l'écart mesuré rougisse, et
// que le correctif régénéré passe.

const { mkdtempSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

let garde;
beforeAll(async () => { garde = await import("../version-du-verrou.mjs"); });

const arbre = (paquet, verrou) => {
  const racine = mkdtempSync(join(tmpdir(), "verrou-"));
  writeFileSync(join(racine, "package.json"), JSON.stringify(paquet));
  writeFileSync(join(racine, "package-lock.json"), JSON.stringify(verrou));
  return racine;
};

const verrouDe = (version, extra = {}) => ({
  name: "discovery-media-player",
  version,
  lockfileVersion: 3,
  packages: { "": { name: "discovery-media-player", version } },
  ...extra,
});

describe("les emplacements du verrou qui décrivent ce paquet", () => {
  it("les deux sont lus — la racine ET `packages[\"\"]`", () => {
    expect(garde.versionsDuVerrou(verrouDe("0.1.156"))).toEqual([
      { ou: "racine", valeur: "0.1.156" },
      { ou: 'packages[""]', valeur: "0.1.156" },
    ]);
  });

  it("⚠️ les versions des DÉPENDANCES ne comptent pas — seul ce paquet est en cause", () => {
    const verrou = { lockfileVersion: 3, packages: { "node_modules/pdfjs-dist": { version: "6.2.108" } } };
    expect(garde.versionsDuVerrou(verrou)).toEqual([]);
  });
});

describe("ce que la garde refuse", () => {
  it("⚠️ l'écart réel du 05/09 : le paquet à 0.1.156, le verrou à 0.1.145", () => {
    const racine = arbre({ version: "0.1.156" }, verrouDe("0.1.145"));
    try {
      const r = garde.auditer(racine);
      expect(r.code).toBe(1);
      // Les DEUX emplacements sont nommés : un constat qui n'en signale qu'un laisserait l'autre.
      expect(r.constats).toHaveLength(2);
      expect(r.constats[0]).toContain("0.1.145");
      expect(r.constats[0]).toContain("0.1.156");
      // Le constat doit dire COMMENT corriger, sinon le prochain le fera à la main.
      expect(r.constats[0]).toContain("npm install --package-lock-only");
    } finally { rmSync(racine, { recursive: true, force: true }); }
  });

  it("⚠️ un seul des deux emplacements en retard est refusé aussi", () => {
    const verrou = verrouDe("0.1.156");
    verrou.packages[""].version = "0.1.155";
    const racine = arbre({ version: "0.1.156" }, verrou);
    try {
      const r = garde.auditer(racine);
      expect(r.code).toBe(1);
      expect(r.constats).toHaveLength(1);
      expect(r.constats[0]).toContain('packages[""]');
    } finally { rmSync(racine, { recursive: true, force: true }); }
  });

  it("l'accord est conforme, et le résumé nomme la version accordée", () => {
    const racine = arbre({ version: "0.1.156" }, verrouDe("0.1.156"));
    try {
      const r = garde.auditer(racine);
      expect(r.code).toBe(0);
      expect(r.resume).toContain("0.1.156");
    } finally { rmSync(racine, { recursive: true, force: true }); }
  });
});

describe("ce que la garde refuse d'affirmer", () => {
  it("⚠️ un verrou dont la forme a changé rend NON CONCLUANT, jamais conforme", () => {
    // Sans cela, un `lockfileVersion` futur ferait TAIRE la garde au lieu de la faire parler — et
    // l'écart repartirait invisible, comme il l'a été onze trains durant.
    const racine = arbre({ version: "0.1.156" }, { lockfileVersion: 9, paquets: {} });
    try {
      const r = garde.auditer(racine);
      expect(r.code).toBe(2);
      expect(r.raisons.join(" ")).toContain("rien n'a été vérifié");
    } finally { rmSync(racine, { recursive: true, force: true }); }
  });

  it("un package.json sans version rend NON CONCLUANT", () => {
    const racine = arbre({ name: "x" }, verrouDe("0.1.156"));
    try {
      expect(garde.auditer(racine).code).toBe(2);
    } finally { rmSync(racine, { recursive: true, force: true }); }
  });
});

describe("le dépôt lui-même", () => {
  it("⚠️ l'écart est refermé — et c'est CE banc qui le mesure, pas la prose du commit", () => {
    const r = garde.auditer();
    expect(r.code).toBe(0);
  });
});
