// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE SOMMAIRE DU DOCUMENT (#612, L6b) — la logique pure : l'arbre mis à plat, les pages, l'entrée courante.
import { describe, it, expect } from "vitest";
import { aplatirSommaire, entreeCourante, pageValide } from "../viewer";

const arbre = [
  { title: "1. Généralités", dest: "g", items: [
    { title: "1.1 Le terrain", dest: [{ num: 4, gen: 0 }, { name: "Fit" }] },
    { title: "  1.2   Les\nréseaux ", dest: "r", items: [{ title: "1.2.1 Eau", dest: "e", items: [{ title: "trop profond", dest: "x" }] }] },
  ] },
  { title: "", dest: null },
  { title: "2. Chauffage", dest: "c" },
];

describe("aplatirSommaire", () => {
  it("parent avant enfants, niveaux, titres nettoyés, sans titre nommé", () => {
    expect(aplatirSommaire(arbre).map((e) => [e.niveau, e.titre])).toEqual([
      [0, "1. Généralités"], [1, "1.1 Le terrain"], [1, "1.2 Les réseaux"], [2, "1.2.1 Eau"], [3, "trop profond"],
      [0, "(sans titre)"], [0, "2. Chauffage"],
    ]);
  });
  it("la destination est gardée telle quelle, pour être résolue par la page", () => {
    expect(aplatirSommaire(arbre)[1].dest).toEqual([{ num: 4, gen: 0 }, { name: "Fit" }]);
  });
  it("au-delà du niveau maximum, on ne descend plus", () => {
    expect(aplatirSommaire(arbre, 1).map((e) => e.titre)).toEqual(["1. Généralités", "1.1 Le terrain", "1.2 Les réseaux", "(sans titre)", "2. Chauffage"]);
  });
  it("au-delà du plafond d'entrées, on s'arrête", () => {
    expect(aplatirSommaire(arbre, 3, 2)).toHaveLength(2);
  });
  it("pas de signets, ou n'importe quoi : un sommaire vide", () => {
    for (const rien of [null, undefined, {}, "x", [null, 3]]) expect(aplatirSommaire(rien)).toEqual([]);
  });
  it("un titre démesuré est borné", () => {
    const e = aplatirSommaire([{ title: "x".repeat(400), dest: "d" }])[0];
    expect(e.titre.length).toBe(160);
    expect(e.titre.endsWith("…")).toBe(true);
  });
});

describe("pageValide", () => {
  it("un entier dans le document, sinon null", () => {
    expect(pageValide(3, 5)).toBe(3);
    for (const faux of [0, 6, 2.5, "a", null, undefined, -1]) expect(pageValide(faux, 5)).toBeNull();
  });
});

describe("entreeCourante", () => {
  it("le dernier titre dont la page est au plus la page courante", () => {
    expect(entreeCourante([1, 2, 2, 5, null, 9], 4)).toBe(2);
    expect(entreeCourante([1, 2, 2, 5, null, 9], 9)).toBe(5);
  });
  it("avant le premier titre résolu : aucun", () => {
    expect(entreeCourante([3, 5], 2)).toBe(-1);
    expect(entreeCourante([null, null], 4)).toBe(-1);
  });
});
