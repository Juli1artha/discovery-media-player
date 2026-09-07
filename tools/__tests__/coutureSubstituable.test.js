// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ UNE GARDE VERTE LE JOUR DE SA NAISSANCE NE PROUVE RIEN. Celle-ci l'est — nos 144 appels au
// contexte injecté sont déjà relus au point d'usage — donc son seul contenu observable est ce
// qu'elle REFUSE. Ces bancs sont des contrôles positifs : ils réintroduisent la capture et exigent
// le rouge.
//
// ⚠️ ET LE DÉFAUT SURVEILLÉ EST INVISIBLE CHEZ NOUS. Une capture ne casse aucun de nos bancs, parce
// que nos bancs injectent le contexte AVANT d'appeler. Elle casse le double de l'hôte, chez l'hôte.
// C'est précisément pourquoi elle a besoin d'une garde : rien d'autre ici ne la verrait.

const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

let garde;
beforeAll(async () => { garde = await import("../couture-substituable.mjs"); });

const arbre = (fichiers) => {
  const racine = mkdtempSync(join(tmpdir(), "couture-"));
  for (const zone of ["server", "context"]) mkdirSync(join(racine, zone));
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    writeFileSync(join(racine, chemin), contenu);
  }
  return racine;
};

// Un appel sain, pour que les arbres de test aient toujours un dénominateur : sans lui la garde
// rendrait « non concluant » et les contrôles positifs ci-dessous mesureraient la mauvaise chose.
const SAIN = 'await PLAYER.db.request("t?id=eq.1", { method: "GET" });\n';

describe("ce qui est une capture, et ce qui n'en est pas une", () => {
  it.each([
    ["une liaison directe d'un service", "const db = PLAYER.db;\n", 1],
    ["une déstructuration du contexte", "const { db, storage } = PLAYER;\n", 1],
    ["l'objet entier photographié", "const ctx = PLAYER;\n", 1],
    ["⚠️ la lecture d'une VALEUR de configuration — personne ne double un scalaire",
      "const strict = PLAYER.config.presenceStrict;\n", 0],
    ["⚠️ l'appel traversant, qui est la forme SAINE", SAIN, 0],
  ])("%s → %i capture(s)", (_, source, attendu) => {
    expect(garde.capturesDansSource(source)).toHaveLength(attendu);
  });
});

describe("ce que la garde refuse", () => {
  it("⚠️ une capture est refusée, et le constat nomme le fichier, la ligne et le membre", () => {
    const racine = arbre({ "server/vue.js": SAIN + "const db = PLAYER.db;\n" });
    try {
      const r = garde.auditer(racine);
      expect(r.code).toBe(1);
      expect(r.constats).toHaveLength(1);
      expect(r.constats[0]).toContain("server/vue.js:2");
      expect(r.constats[0]).toContain("PLAYER.db");
      // Le constat doit dire POURQUOI, pas seulement quoi : c'est ce qui distingue un rouge qu'on
      // corrige d'un rouge qu'on contourne.
      expect(r.constats[0]).toContain("double d'un hôte");
    } finally { rmSync(racine, { recursive: true, force: true }); }
  });

  it("⚠️ une déstructuration est refusée aussi — c'est la même photographie, écrite autrement", () => {
    const racine = arbre({ "context/pont.js": SAIN + "const { storage } = PLAYER;\n" });
    try {
      const r = garde.auditer(racine);
      expect(r.code).toBe(1);
      expect(r.constats[0]).toContain("context/pont.js");
      expect(r.constats[0]).toContain("storage");
    } finally { rmSync(racine, { recursive: true, force: true }); }
  });

  it("⚠️ une capture ÉCRITE DANS UN COMMENTAIRE n'accuse personne", () => {
    const racine = arbre({
      "server/vue.js": SAIN + "// Ne faites jamais `const db = PLAYER.db;` ici.\n"
        + " * ni `const { storage } = PLAYER;` dans un bloc.\n",
    });
    try {
      expect(garde.auditer(racine).code).toBe(0);
    } finally { rmSync(racine, { recursive: true, force: true }); }
  });
});

describe("ce que la garde refuse d'affirmer", () => {
  it("⚠️ zéro appel reconnu rend NON CONCLUANT, jamais conforme", () => {
    // La sonde vise à côté : rien à lire n'est pas la même chose que rien à redire. C'est la règle
    // qui autorise une suppression — si zéro pouvait valoir vert, la garde s'éteindrait en silence
    // le jour où `PLAYER` serait renommé.
    const racine = arbre({ "server/vide.js": "module.exports = {};\n" });
    try {
      const r = garde.auditer(racine);
      expect(r.code).toBe(2);
      expect(r.raisons.join(" ")).toContain("rien n'a été vérifié");
    } finally { rmSync(racine, { recursive: true, force: true }); }
  });

  it("le dénominateur compte les appels traversants, pas les fichiers", () => {
    expect(garde.appelsTraversants(SAIN + SAIN)).toBe(2);
    expect(garde.appelsTraversants("const s = PLAYER.config.presenceStrict;\n")).toBe(1);
  });
});

describe("le dépôt lui-même", () => {
  it("⚠️ la couture promise aux hôtes tient aujourd'hui — et c'est CE banc qui le mesure", () => {
    const r = garde.auditer();
    expect(r.code).toBe(0);
    expect(r.resume).toContain("le double d'un hôte est donc utilisé");
  });
});
