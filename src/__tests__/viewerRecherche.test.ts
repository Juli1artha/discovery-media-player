// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// RECHERCHER DANS LE DOCUMENT (#612, L6a) — la logique pure : ce qu'on compare, où l'on trouve, ce qu'on dit.
//
// Dimensions VARIÉES : casse, accents, ligatures, mot coupé entre deux éléments, deux lignes, pages sans texte,
// plafond d'occurrences. Dimension TENUE FIXE : les éléments sont ceux que pdf.js rend (chaîne + fin de ligne) —
// l'accord avec les `span` de sa couche texte est éprouvé côté page.
import { describe, it, expect } from "vitest";
import {
  chercherDansPages, normaliserRecherche, pageSansTexte, plagesDePages, premiereOccurrenceDepuis, type ElementTexte,
} from "../viewer";

const page = (...lignes: string[]): ElementTexte[] => lignes.map((str) => ({ str, eol: true }));

describe("normaliserRecherche", () => {
  it("minuscules, sans accents, ligatures dépliées, blancs repliés", () => {
    expect(normaliserRecherche("  Équipement  ﬁnal ").texte).toBe(" equipement final ");
  });
  it("chaque caractère de sortie sait d'où il vient", () => {
    const { texte, origine } = normaliserRecherche("Éte ﬁ");
    expect(texte).toBe("ete fi");
    expect(origine).toEqual([0, 1, 2, 3, 4, 4]);
  });
});

describe("chercherDansPages", () => {
  const notice = [
    page("Notice descriptive", "Résidence Exemple"),
    page("Le CHAUFFAGE est collectif.", "Chauffage au sol dans les pièces de vie."),
    page("Parkings en sous-sol"),
  ];

  it("« chauffage » trouve « CHAUFFAGE » et « Chauffage », sur la bonne page, aux bonnes positions", () => {
    const r = chercherDansPages(notice, "chauffage");
    expect(r.occurrences).toEqual([
      { page: 2, debut: { element: 0, decalage: 3 }, fin: { element: 0, decalage: 12 } },
      { page: 2, debut: { element: 1, decalage: 0 }, fin: { element: 1, decalage: 9 } },
    ]);
  });
  it("sans accents dans la requête comme dans le texte : « residence » trouve « Résidence »", () => {
    expect(chercherDansPages(notice, "residence").occurrences).toHaveLength(1);
    expect(chercherDansPages(notice, "pièces").occurrences[0].page).toBe(2);
  });
  it("un mot coupé entre deux éléments de la même ligne est trouvé, de l'un à l'autre", () => {
    const coupe: ElementTexte[][] = [[{ str: "le chauf" }, { str: "fage central", eol: true }]];
    expect(chercherDansPages(coupe, "chauffage").occurrences).toEqual([
      { page: 1, debut: { element: 0, decalage: 3 }, fin: { element: 1, decalage: 4 } },
    ]);
  });
  it("deux lignes ne se collent pas : la fin de l'une et le début de l'autre ne forment pas un mot", () => {
    const deux = [page("fin de ligne par", "king")];
    expect(chercherDansPages(deux, "parking").occurrences).toHaveLength(0);
    expect(chercherDansPages(deux, "par king").occurrences).toHaveLength(1);
  });
  it("moins de deux caractères : rien n'est cherché", () => {
    expect(chercherDansPages(notice, " a ").occurrences).toEqual([]);
  });
  it("les pages sans texte sont dites, qu'on trouve ou non", () => {
    const mixte = [page("Plan"), [], [{ str: "   " }], page("Annexe")];
    expect(chercherDansPages(mixte, "zz").pagesSansTexte).toEqual([2, 3]);
  });
  it("au-delà du plafond, on s'arrête et on le dit", () => {
    const r = chercherDansPages([page("aa aa aa aa")], "aa", 3);
    expect(r.occurrences).toHaveLength(3);
    expect(r.tronque).toBe(true);
  });
});

describe("pageSansTexte", () => {
  it("vide ou que des blancs : sans texte ; un caractère : avec", () => {
    expect(pageSansTexte([])).toBe(true);
    expect(pageSansTexte([{ str: " \n" }])).toBe(true);
    expect(pageSansTexte([{ str: "." }])).toBe(false);
  });
});

describe("premiereOccurrenceDepuis", () => {
  const occ = [2, 2, 5, 9].map((p) => ({ page: p, debut: { element: 0, decalage: 0 }, fin: { element: 0, decalage: 1 } }));
  it("la première à la page courante ou après", () => {
    expect(premiereOccurrenceDepuis(occ, 3)).toBe(2);
    expect(premiereOccurrenceDepuis(occ, 2)).toBe(0);
  });
  it("après la dernière : on repart du début ; aucune : -1", () => {
    expect(premiereOccurrenceDepuis(occ, 10)).toBe(0);
    expect(premiereOccurrenceDepuis([], 1)).toBe(-1);
  });
});

describe("plagesDePages", () => {
  it("des plages, triées, sans doublon", () => {
    expect(plagesDePages([9, 3, 4, 5, 12, 4])).toBe("3 à 5, 9, 12");
    expect(plagesDePages([])).toBe("");
  });
});
