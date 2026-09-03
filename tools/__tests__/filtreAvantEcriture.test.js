// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ UNE GARDE VERTE LE JOUR DE SA NAISSANCE NE PROUVE RIEN. Celle-ci l'est — tous nos sites
// d'écriture portent déjà un filtre — donc son seul contenu observable est ce qu'elle REFUSE. Ces
// bancs sont des contrôles positifs : ils réintroduisent le défaut et exigent le rouge.

const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");

let garde;
beforeAll(async () => { garde = await import("../filtre-avant-ecriture.mjs"); });

const arbre = (fichiers) => {
  const racine = mkdtempSync(join(tmpdir(), "filtre-"));
  for (const zone of ["server", "context"]) mkdirSync(join(racine, zone));
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    writeFileSync(join(racine, chemin), contenu);
  }
  return racine;
};

describe("un prédicat, pas un point d'interrogation", () => {
  it.each([
    ["une restriction d'égalité", "t?id=eq.7", true],
    ["une restriction d'appartenance", "t?id=in.(1,2)", true],
    ["une colonne interpolée par l'appelant", "t?${colId}=in.(${ids})", true],
    ["un filtre APRÈS une projection", "t?select=id&slug=eq.x", true],
    ["⚠️ une projection seule — le piège que cette garde porte", "t?select=id", false],
    ["⚠️ un tri et une borne, qui ne restreignent rien", "t?order=id.asc&limit=50", false],
    ["aucune chaîne de requête du tout", "commercial_doc_shares", false],
  ])("%s → %s", (_, chemin, attendu) => {
    expect(garde.porteUnFiltre(chemin)).toBe(attendu);
  });
});

describe("ce que la garde refuse", () => {
  it("⚠️ un DELETE sans prédicat est refusé, et le constat nomme le fichier et la ligne", () => {
    const racine = arbre({
      "server/purge.js": 'await PLAYER.db.request("commercial_doc_views", { method: "DELETE" });\n',
    });
    const r = garde.auditer(racine);
    rmSync(racine, { recursive: true, force: true });
    expect(r.code).toBe(1);
    expect(r.constats[0]).toContain("server/purge.js:1");
    expect(r.constats[0]).toContain("TABLE ENTIÈRE");
  });

  it("⚠️ un PATCH qui n'a QU'UNE PROJECTION est refusé — c'est le cas qui trompe une relecture", () => {
    const racine = arbre({
      "server/maj.js": 'await PLAYER.db.request(`doc_presentations?select=slug`, { method: "PATCH", body: { active: false } });\n',
    });
    const r = garde.auditer(racine);
    rmSync(racine, { recursive: true, force: true });
    expect(r.code).toBe(1);
    expect(r.constats[0]).toContain("PATCH sans prédicat");
  });

  it("un DELETE filtré passe — la garde ne refuse pas l'écriture, elle refuse l'absence de portée", () => {
    const racine = arbre({
      "server/purge.js": 'await PLAYER.db.request(`${table}?${colId}=in.(${ids})&select=${colId}`, { method: "DELETE", headers: { Prefer: "return=representation" } });\n',
    });
    const r = garde.auditer(racine);
    rmSync(racine, { recursive: true, force: true });
    expect(r.code).toBe(0);
    expect(r.resume).toContain("1 écriture");
  });

  it("une lecture n'est pas concernée : seuls DELETE, PATCH et PUT écrivent", () => {
    const racine = arbre({
      "server/lire.js": 'await PLAYER.db.request("commercial_doc_views?select=id", { timeoutMs: 8000 });\n',
    });
    const r = garde.auditer(racine);
    rmSync(racine, { recursive: true, force: true });
    // Aucun site d'écriture reconnu ⇒ non concluant, pas conforme. C'est voulu, voir ci-dessous.
    expect(r.code).toBe(2);
  });
});

// ⚠️ LA LEÇON QUI A COÛTÉ TROIS GARDES EN UNE JOURNÉE : un motif qui cherche une forme dans du texte
// non classé accuse la prose qui documente la règle. Ce banc l'éprouve sur celle-ci.
describe("elle lit du code, jamais du commentaire", () => {
  it("⚠️ un DELETE sans filtre CITÉ DANS UN COMMENTAIRE n'accuse personne", () => {
    const racine = arbre({
      "server/doc.js": [
        '// Ne jamais écrire ceci :',
        '//   await PLAYER.db.request("commercial_doc_views", { method: "DELETE" });',
        '/* ni ceci : request("t", { method: "PATCH" }) */',
        'await PLAYER.db.request(`t?id=eq.${id}`, { method: "DELETE" });',
      ].join("\n"),
    });
    const r = garde.auditer(racine);
    rmSync(racine, { recursive: true, force: true });
    expect(r.code, "la prose a été comptée comme du code").toBe(0);
    expect(r.resume).toContain("1 écriture");
  });
});

// ⚠️ ZÉRO N'EST PAS UNE CONFORMITÉ. Une sonde qui ne reconnaît plus rien deviendrait verte en ne
// regardant plus rien — et c'est la forme de défaut que ce dépôt traque le plus.
describe("anti-vacuité", () => {
  it("⚠️ aucun site reconnu rend NON CONCLUANT, jamais conforme", () => {
    const racine = arbre({ "server/vide.js": "module.exports = {};\n" });
    const r = garde.auditer(racine);
    rmSync(racine, { recursive: true, force: true });
    expect(r.code).toBe(2);
    expect(r.raisons[0]).toContain("la sonde vise à côté");
  });
});
