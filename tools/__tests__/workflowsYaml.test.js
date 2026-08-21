// LES WORKFLOWS LUS COMME DU YAML — ET LES FORMES QUI ONT EU RAISON DE DEUX LEXERS.
//
// ⚠️ Deux gardes de ce dépôt ont lu leurs fichiers avec des expressions régulières, et les deux
// ont été aveugles. Le `grep` d'origine ratait `uses: "action@v4"` entre guillemets. Le lexer
// écrit pour le remplacer corrigeait ça et échouait autrement (revue externe, 21/08) : clé citée,
// mapping en flow, et l'indicateur `|2-` — valide, ordre inverse de `|-2` — qui lui faisait
// prendre le contenu d'un `run:` pour une action flottante.
//
// Chaque cas ci-dessous est l'une de ces cécités, ou ce qui les rendait possibles.

import { describe, it, expect } from "vitest";
import { usesDe, usesDuDepot, ligneDe, workflows } from "../workflows-yaml.mjs";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";
const refs = (txt) => usesDe(txt, "w.yml").map((u) => u.reference);

describe("⚠️ LES FORMES QUI ONT EU RAISON DES DEUX LECTEURS PRÉCÉDENTS", () => {
  it("guillemets autour de la VALEUR — l'angle mort du grep d'origine", () => {
    expect(refs('steps:\n  - uses: "actions/checkout@v4"\n')).toEqual(["actions/checkout@v4"]);
    expect(refs("steps:\n  - uses: 'actions/cache@main'\n")).toEqual(["actions/cache@main"]);
  });

  it("deux espaces après le deux-points — autre angle mort du grep", () => {
    expect(refs("steps:\n  - uses:  actions/setup-node@v3\n")).toEqual(["actions/setup-node@v3"]);
  });

  it("guillemets autour de la CLÉ — l'angle mort du lexer", () => {
    expect(refs('steps:\n  - "uses": actions/checkout@v4\n')).toEqual(["actions/checkout@v4"]);
  });

  it("mapping en flow — l'autre angle mort du lexer", () => {
    expect(refs("steps:\n  - { uses: actions/checkout@v4, with: { x: 1 } }\n")).toEqual(["actions/checkout@v4"]);
  });

  it("⚠️ `|2-` : l'indicateur d'indentation AVANT le chomping, que le lexer prenait pour une action", () => {
    // Le lexer reconnaissait `|-2` et pas `|2-`. Les deux sont valides. Il lisait donc ce SCRIPT
    // comme du YAML, et rendait « pas/une-action@v1 » comme une action flottante.
    expect(refs("steps:\n  - run: |2-\n      uses: pas/une-action@v1\n")).toEqual([]);
  });

  it("les autres formes de bloc scalaire aussi", () => {
    for (const ouverture of ["|", "|-", "|+", ">", ">-", "|2", "|-2", ">2-"]) {
      expect(refs(`steps:\n  - run: ${ouverture}\n      uses: pas/une-action@v1\n`), ouverture).toEqual([]);
    }
  });
});

describe("ce qui n'est pas une action ne doit pas en devenir une", () => {
  it("un commentaire n'est pas du code", () => {
    expect(refs("steps:\n  # le contrôle refuse `uses: machin@v3`\n  - run: 'true'\n")).toEqual([]);
  });

  it("un `uses` en position de VALEUR n'est pas une clé", () => {
    expect(refs("steps:\n  - run: echo uses\n  - name: uses\n    run: 'true'\n")).toEqual([]);
  });
});

describe("ce qu'une action peut être", () => {
  it("voit un workflow réutilisable au niveau du job", () => {
    expect(refs(`jobs:\n  a:\n    uses: o/r/.github/workflows/x.yml@${SHA}\n`))
      .toEqual([`o/r/.github/workflows/x.yml@${SHA}`]);
  });

  it("voit les actions locales et les images docker", () => {
    expect(refs("steps:\n  - uses: ./.github/actions/maison\n  - uses: docker://alpine:3.20\n"))
      .toEqual(["./.github/actions/maison", "docker://alpine:3.20"]);
  });

  it("rend l'étiquette de fin de ligne, que la garde des versions confronte au SHA", () => {
    const u = usesDe(`steps:\n  - uses: a/b@${SHA} # v4.37.7\n`, "w.yml")[0];
    expect(u.annonce).toBe("v4.37.7");
    expect(u.ligne).toBe(2);
  });

  it("ne fabrique pas une annonce quand il n'y a pas de commentaire", () => {
    expect(usesDe(`steps:\n  - uses: a/b@${SHA}\n`)[0].annonce).toBeNull();
  });

  it("ne garde que le premier mot d'un commentaire bavard", () => {
    expect(usesDe(`steps:\n  - uses: a/b@${SHA} # v4 (dernière LTS)\n`)[0].annonce).toBe("v4");
  });
});

describe("⚠️ IL ÉCHOUE SUR CE QU'IL NE SAIT PAS LIRE, il ne saute pas en silence", () => {
  // Sauter en silence est exactement ce qui a laissé passer les formes ci-dessus.
  it("refuse un document YAML mal formé, en nommant la ligne", () => {
    expect(() => usesDe("jobs:\n  a:\n   - x\n  b: [1,\n", "w.yml")).toThrow(/YAML illisible/);
  });

  it("refuse un `uses` qui vaut un alias plutôt qu'une chaîne", () => {
    const txt = "x: &ancre\n  - a\njobs:\n  a:\n    steps:\n      - uses: *ancre\n";
    expect(() => usesDe(txt, "w.yml")).toThrow(/alias YAML/);
  });

  it("refuse un `uses` qui vaut un mapping", () => {
    expect(() => usesDe("steps:\n  - uses:\n      nom: a/b\n", "w.yml")).toThrow(/ne vaut pas une chaîne/);
  });

  it("refuse un dossier de workflows vide — la sonde viserait à côté", () => {
    expect(() => workflows("tools")).toThrow(/aucun workflow/);
  });
});

describe("le dépôt réel", () => {
  it("se lit sans erreur, et rend des références plausibles", () => {
    const toutes = usesDuDepot();
    expect(toutes.length).toBeGreaterThanOrEqual(28);
    for (const u of toutes) {
      expect(u.reference, u.fichier).toBeTruthy();
      expect(u.ligne, u.reference).toBeGreaterThan(0);
    }
  });

  it("situe une référence à sa ligne", () => {
    expect(ligneDe("a\nb\nc", 4)).toBe(3);
  });
});
