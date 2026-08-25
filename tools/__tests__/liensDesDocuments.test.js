// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES LIENS DES DOCUMENTS PUBLIÉS, ÉPROUVÉS SUR LA RÈGLE PUIS SUR LE PAQUET RÉEL.
//
// ⚠️ Neuf des douze liens relatifs du README menaient dans le vide une fois le paquet installé —
// et c'était précisément le lecteur hors ligne au nom duquel on argumentait ailleurs.

import { describe, it, expect } from "vitest";

import { liensRelatifs, cibleResolue, liensMorts } from "../liens-des-documents.mjs";
import { fichiersDuTarball } from "../inventaire-tarball.mjs";

describe("relever les liens", () => {
  it("ignore l'externe, l'ancre et le courriel — ils ne se résolvent pas dans le paquet", () => {
    const vus = liensRelatifs("[a](https://x.test) [b](#ancre) [c](mailto:x@y.test) [d](docs/A.md)");
    expect(vus.map((l) => l.cible)).toEqual(["docs/A.md"]);
  });

  it("⚠️ NEUTRALISE les blocs de code sans les supprimer — sinon la ligne annoncée est fausse", () => {
    const texte = ["intro", "```", "[faux](piege.md)", "```", "", "[vrai](cible.md)"].join("\n");
    const vus = liensRelatifs(texte);
    expect(vus.map((l) => l.cible)).toEqual(["cible.md"]);
    expect(vus[0].ligne).toBe(6);
  });

  it("porte la ligne, pas seulement le fichier", () => {
    expect(liensRelatifs("a\nb\n[x](y.md)")[0].ligne).toBe(3);
  });

  it("résout depuis le document qui porte le lien", () => {
    expect(cibleResolue("docs/HOST-CONTRACT.md", "API.md")).toBe("docs/API.md");
    expect(cibleResolue("docs/HOST-CONTRACT.md", "../src/bridge.ts")).toBe("src/bridge.ts");
    expect(cibleResolue("README.md", "examples/")).toBe("examples");
    expect(cibleResolue("README.md", "docs/A.md#section")).toBe("docs/A.md");
  });
});

describe("le verdict", () => {
  const lire = (f) => ({
    "README.md": "[absent](docs/API.md)\n[présent](LICENSE)\n[externe](https://x.test/a.md)",
    "LICENSE": "",
  })[f];

  it("⚠️ accuse le lien mort en donnant fichier:ligne", () => {
    const soucis = liensMorts(["README.md", "LICENSE"], lire);
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toMatch(/^README\.md:1 —/);
    expect(soucis[0]).toContain("docs/API.md");
  });

  it("⚠️ NE REFUSE PAS un lien relatif dont la cible voyage — c'est le bon outil", () => {
    expect(liensMorts(["README.md", "LICENSE"], lire).join("")).not.toContain("LICENSE");
  });

  it("ne lit que les Markdown — un « .js » n'est pas un document", () => {
    expect(liensMorts(["server/x.js"], () => { throw new Error("ne devrait pas être lu"); })).toEqual([]);
  });
});

describe("le paquet réel", () => {
  it("aucun lien relatif ne mène hors du paquet", () => {
    const soucis = liensMorts(fichiersDuTarball());
    expect(soucis, `lien(s) mort(s) :\n${soucis.join("\n")}`).toEqual([]);
  });
});
