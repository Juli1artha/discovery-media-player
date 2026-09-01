// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES DOCUMENTS QUE LE PAQUET PROMET, ÉPROUVÉS SUR LA RÈGLE PUIS SUR LE PAQUET RÉEL.
//
// ⚠️ Le défaut d'origine n'était pas « le CHANGELOG manque » : c'était que RIEN NE DISTINGUAIT
// son absence d'une décision. Son MIROIR a été trouvé en corrigeant le premier : `docs/README.md`
// voyageait sans que personne l'ait décidé, parce qu'une entrée nue de `files` est un motif que
// npm fait correspondre à toute profondeur. Les deux sens sont donc éprouvés ici.

import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { PROMIS, promessesRompues, voyageursNonDecides, documentsDe, promisNonReconnus } from "../documents-publies.mjs";
import { fichiersDuTarball } from "../inventaire-tarball.mjs";

const pack = (chemins) => JSON.stringify([{ files: chemins.map((path) => ({ path })) }]);
const TOUT = Object.keys(PROMIS);

describe("une promesse rompue", () => {
  it("se tait quand toutes sont tenues", () => {
    expect(promessesRompues(TOUT)).toEqual([]);
  });

  it("⚠️ désigne EXACTEMENT le document retiré, et dit ce qu'on perd", () => {
    const soucis = promessesRompues(TOUT.filter((f) => f !== "docs/RETENTION.md"));
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain("docs/RETENTION.md");
    expect(soucis[0]).toMatch(/le périmètre déclaré de la rétention/);
  });

  it("nomme chaque promesse rompue, pas seulement la première", () => {
    const soucis = promessesRompues(["README.md"]);
    expect(soucis).toHaveLength(TOUT.length - 1);
    for (const chemin of TOUT.filter((f) => f !== "README.md")) {
      expect(soucis.join("\n")).toContain(chemin);
    }
  });
});

describe("un document qui voyage sans être promis", () => {
  it("⚠️ est accusé — le défaut miroir, et il a existé pour de vrai", () => {
    // `docs/README.md` partait en portant un sommaire de dix-sept documents absents du paquet.
    const soucis = voyageursNonDecides([...TOUT, "docs/README.md"]);
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain("docs/README.md");
    expect(soucis[0]).toMatch(/personne ne l'a décidé/);
  });

  it("se tait sur ce qui est promis", () => {
    expect(voyageursNonDecides(TOUT)).toEqual([]);
  });

  it("⚠️ NE PORTE QUE SUR LES DOCUMENTS — exiger la liste du code serait un second « files »", () => {
    expect(voyageursNonDecides([...TOUT, "server/handler.js", "dist/bridge.js", "bin/serve.js"])).toEqual([]);
  });

  it("le périmètre « document » retient les Markdown et les licences", () => {
    const vus = documentsDe(["a.md", "docs/b.MD", "LICENSE", "LICENSE-MIT", "server/x.js", "types/i.d.ts"]);
    expect(vus).toEqual(["a.md", "docs/b.MD", "LICENSE", "LICENSE-MIT"]);
  });
});

describe("la sonde ne conclut pas sur une ignorance", () => {
  it("⚠️ lève sur un inventaire vide au lieu de rendre une liste vide", () => {
    expect(() => fichiersDuTarball(() => pack([]))).toThrow(/aucun fichier/);
  });

  it("lit la forme objet comme la forme tableau rendue par npm", () => {
    expect(fichiersDuTarball(() => JSON.stringify({ files: [{ path: "a" }] }))).toEqual(["a"]);
  });
});

describe("le paquet réel", () => {
  const inventaire = fichiersDuTarball();

  it("tient toutes ses promesses, et rien ne voyage sans décision", () => {
    // ⚠️ Le message est passé à `expect` : sans lui, vitest refuse sur « expected [ Array(1) ] to
    // deeply equal [] » et il faut relancer la garde à la main pour savoir ce qui manque.
    const soucis = [...promessesRompues(inventaire), ...voyageursNonDecides(inventaire)];
    expect(soucis, `écart(s) :\n${soucis.join("\n")}`).toEqual([]);
  });

  it("⚠️ le README voyage SANS être nommé dans « files »", () => {
    // La ligne a été retirée : elle valait `**/README.md` et ramenait `docs/README.md`. npm inclut
    // toujours le README racine — vérifié ici à chaque exécution plutôt que supposé.
    expect(inventaire).toContain("README.md");
    expect(JSON.parse(readFileSync("package.json", "utf8")).files).not.toContain("README.md");
  });

  it("⚠️ le CHANGELOG ne voyage PAS, et c'est la décision écrite", () => {
    expect(inventaire).not.toContain("CHANGELOG.md");
    expect(PROMIS).not.toHaveProperty("CHANGELOG.md");
  });

  it("⚠️ le sommaire de docs/ ne voyage plus — il indexait dix-sept absents", () => {
    expect(inventaire).not.toContain("docs/README.md");
  });
});

// ⚠️ LE TÉMOIN EST DÉRIVÉ, ET SON ÉTAT SAIN EST « RIEN À DIRE » — donc il s'éprouve là où il a
// quelque chose à dire. Aveugler l'une des deux formes que `documentsDe` reconnaît laissait la
// garde verte avec une liste plus courte : la règle qui compte (`voyageursNonDecides`) ne peut
// rien voir voyager qu'elle ne reconnaisse pas d'abord.
describe("⚠️ tout document promis ET présent doit rester RECONNU comme document", () => {
  it("ne dit rien sur un inventaire où les deux formes sont vues", () => {
    expect(promisNonReconnus(Object.keys(PROMIS))).toEqual([]);
  });

  it("⚠️ NOMME chaque Markdown promis quand la sonde ne reconnaît plus que les licences", () => {
    const borgne = (inv) => inv.filter((f) => /(^|\/)LICEN[CS]E/i.test(f));
    const dits = promisNonReconnus(Object.keys(PROMIS), PROMIS, borgne);
    expect(dits.length, "trois Markdown promis le 01/09").toBe(3);
    expect(dits.join(" ")).toMatch(/README\.md/);
  });

  it("⚠️ NOMME chaque licence promise quand la sonde ne reconnaît plus que les Markdown", () => {
    const borgne = (inv) => inv.filter((f) => /\.md$/i.test(f));
    const dits = promisNonReconnus(Object.keys(PROMIS), PROMIS, borgne);
    expect(dits.length, "deux licences promises le 01/09").toBe(2);
    expect(dits.join(" ")).toMatch(/LICENSE-MIT/);
  });

  it("⚠️ les deux formes ont chacune un sujet vivant dans PROMIS — sinon aveugler l'une ne prouverait rien", () => {
    const md = Object.keys(PROMIS).filter((c) => /\.md$/i.test(c));
    const lic = Object.keys(PROMIS).filter((c) => /(^|\/)LICEN[CS]E/i.test(c));
    expect(md.length, "aucun Markdown promis : le motif « .md » n'aurait aucun sujet").toBeGreaterThan(0);
    expect(lic.length, "aucune licence promise : le motif « LICEN[CS]E » n'aurait aucun sujet").toBeGreaterThan(0);
    expect(documentsDe(Object.keys(PROMIS)).sort()).toEqual(Object.keys(PROMIS).sort());
  });

  it("⚠️ et un fichier promis, présent, mais invisible à la sonde est NOMMÉ", () => {
    // On ne peut pas aveugler `documentsDe` depuis ici : on donne à la place un `promis` qui
    // déclare un fichier qu'aucune des deux formes ne reconnaît — l'effet est le même.
    expect(promisNonReconnus(["index.js"], { "index.js": "x" }))
      .toEqual([expect.stringMatching(/index\.js part bien dans le tarball mais n'est plus RECONNU/)]);
  });
});
