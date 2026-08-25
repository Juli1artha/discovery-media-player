// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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
import { usesDe, usesDuDepot, ligneDe, workflows, usesHorsPosition, horsPositionDuDepot } from "../workflows-yaml.mjs";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

/**
 * ⚠️ LES FRAGMENTS SONT PLACÉS DANS UN JOB, ET CE N'EST PAS COSMÉTIQUE.
 *
 * Ces cas portent sur la FORME YAML — clé citée, mapping en flow, scalaires de bloc. Ils vivaient
 * jusqu'ici à la racine du document (`steps:` tout seul), une position où GitHub n'exécute rien.
 * Depuis que la lecture est resserrée aux deux seules positions d'exécution (P2, audit du 22/08),
 * un fragment racine rend `[]` — ce qui est correct, mais viderait ce banc de sa substance.
 * L'enveloppe rend chaque cas conforme à ce qu'est vraiment un fichier de workflow.
 */
const dansUnJob = (fragment) =>
  "jobs:\n  a:\n" + fragment.split("\n").map((l) => (l ? "    " + l : l)).join("\n");

const refs = (fragment) => usesDe(dansUnJob(fragment), "w.yml").map((u) => u.reference);
/** Pour les cas qui écrivent DÉJÀ un document complet. */
const refsBrut = (txt) => usesDe(txt, "w.yml").map((u) => u.reference);
const uses1 = (fragment) => usesDe(dansUnJob(fragment), "w.yml")[0];

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
    expect(refsBrut(`jobs:\n  a:\n    uses: o/r/.github/workflows/x.yml@${SHA}\n`))
      .toEqual([`o/r/.github/workflows/x.yml@${SHA}`]);
  });

  it("voit les actions locales et les images docker", () => {
    expect(refs("steps:\n  - uses: ./.github/actions/maison\n  - uses: docker://alpine:3.20\n"))
      .toEqual(["./.github/actions/maison", "docker://alpine:3.20"]);
  });

  it("rend l'étiquette de fin de ligne, que la garde des versions confronte au SHA", () => {
    const u = uses1(`steps:\n  - uses: a/b@${SHA} # v4.37.7\n`);
    expect(u.annonce).toBe("v4.37.7");
    expect(u.ligne).toBe(4);
  });

  it("ne fabrique pas une annonce quand il n'y a pas de commentaire", () => {
    expect(uses1(`steps:\n  - uses: a/b@${SHA}\n`).annonce).toBeNull();
  });

  it("ne garde que le premier mot d'un commentaire bavard", () => {
    expect(uses1(`steps:\n  - uses: a/b@${SHA} # v4 (dernière LTS)\n`).annonce).toBe("v4");
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
    expect(() => usesDe(dansUnJob("steps:\n  - uses:\n      nom: a/b\n"), "w.yml")).toThrow(/ne vaut pas une chaîne/);
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

describe("⚠️ LA PORTÉE : UN `uses:` N'EST PAS UNE ACTION PARTOUT", () => {
  // L'audit du 22/08 : la lecture prenait TOUTE paire nommée `uses`, à n'importe quelle
  // profondeur. Un faux positif sur cette garde-ci n'est pas anodin — c'est elle qui refuse les
  // actions non épinglées, et une garde qui crie faux finit desserrée par celui qu'elle a
  // dérangé pour rien.
  const AVEC_FAUX = `jobs:
  a:
    steps:
      - env:
          uses: pas-une-action
        uses: actions/checkout@v4
`;

  it("ne retient que ce que GitHub exécute vraiment", () => {
    expect(usesDe(AVEC_FAUX, "f.yml").map((u) => u.reference)).toEqual(["actions/checkout@v4"]);
  });

  it("⚠️ mais RESTITUE ce qu'elle a écarté — rétrécir en silence est ce qui a coûté trois lecteurs", () => {
    const ecartes = usesHorsPosition(AVEC_FAUX, "f.yml");
    expect(ecartes).toHaveLength(1);
    expect(ecartes[0].valeur).toBe("pas-une-action");
    expect(ecartes[0].fichier).toBe("f.yml");
  });

  it("voit l'appel d'un workflow réutilisable — jobs.<id>.uses", () => {
    // Il s'exécute avec nos droits, exactement comme une action.
    const txt = "jobs:\n  a:\n    uses: org/depot/.github/workflows/w.yml@v1\n";
    expect(usesDe(txt, "f.yml").map((u) => u.reference)).toEqual(["org/depot/.github/workflows/w.yml@v1"]);
    expect(usesHorsPosition(txt, "f.yml")).toEqual([]);
  });

  it("ne compte pas un `uses` posé à la racine ou hors de jobs", () => {
    expect(usesDe("uses: x\non:\n  push:\n", "f.yml")).toEqual([]);
    expect(usesHorsPosition("uses: x\non:\n  push:\n", "f.yml")).toHaveLength(1);
  });

  it("⚠️ SUR LE VRAI DÉPÔT, LE RESSERREMENT NE PERD RIEN", () => {
    // La propriété qui compte : voir moins qu'avant est acceptable, voir moins d'ACTIONS ne l'est
    // pas. Si ce compte tombe un jour, c'est que le resserrement a mordu sur du réel.
    expect(usesDuDepot().length).toBeGreaterThanOrEqual(30);
    expect(horsPositionDuDepot()).toEqual([]);
  });
});
