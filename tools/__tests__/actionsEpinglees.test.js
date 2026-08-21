// LA GARDE D'ÉPINGLAGE DES ACTIONS, ÉPROUVÉE SUR CE QU'ELLE RATAIT.
//
// ⚠️ Elle existait depuis longtemps, en `grep`, et elle était aveugle DANS LES DEUX SENS. Elle
// voyait des commentaires (documenter la règle rendait la CI rouge — c'est ainsi qu'on l'a
// trouvée), et surtout elle ne voyait pas des actions : `uses: "actions/checkout@v4"` entre
// guillemets passait sans un mot. C'est la garde la plus sensible du dépôt — une action s'exécute
// avec les droits d'une forge qui PUBLIE sur npm.
//
// Même défaut que le lexer de `tools/env-lues.mjs`, corrigé pour la même raison : on ne lit pas un
// format structuré avec une expression régulière.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { sansCommentaire, lignesDeCle, references, ecartEpinglage, ecarts, workflows } from "../actions-epinglees.mjs";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

describe("⚠️ LES TROIS FORMES QUE L'ANCIENNE GARDE LAISSAIT PASSER", () => {
  // Constaté, pas supposé : ces trois lignes posées dans un workflow de sonde, le `grep` d'origine
  // (`uses: [a-zA-Z0-9_./-]+@…`) rendait « rien à signaler ». Chacune est une action flottante.
  const cas = [
    ['guillemets doubles', '      - uses: "actions/checkout@v4"', "actions/checkout@v4"],
    ["guillemets simples", "      - uses: 'actions/cache@main'", "actions/cache@main"],
    ["deux espaces", "      - uses:  actions/setup-node@v3", "actions/setup-node@v3"],
  ];
  for (const [nom, ligne, attendue] of cas) {
    it(`la voit et la refuse — ${nom}`, () => {
      expect(references(ligne + "\n")).toEqual([attendue]);
      expect(ecarts(ligne + "\n", "w.yml")[0]).toMatch(/pas sur un commit/);
    });
  }
});

describe("un commentaire n'est pas du code", () => {
  it("⚠️ documenter la règle ne doit pas la déclencher — le défaut qui a révélé les autres", () => {
    const txt = "      # le contrôle refuse `uses: machin@v3` depuis longtemps\n";
    expect(references(txt)).toEqual([]);
    expect(ecarts(txt, "w.yml")).toEqual([]);
  });

  it("ne coupe pas sur un # collé à du texte ni dans une chaîne", () => {
    expect(sansCommentaire('uses: "a#b"')).toBe('uses: "a#b"');
    expect(sansCommentaire("valeur: rouge#vif")).toBe("valeur: rouge#vif");
    expect(sansCommentaire("uses: x@" + SHA + " # v7").trim()).toBe("uses: x@" + SHA);
  });

  it("mais elle voit toujours une action réelle suivie d'un commentaire", () => {
    expect(references(`      - uses: actions/checkout@${SHA} # v7\n`)).toEqual([`actions/checkout@${SHA}`]);
  });
});

describe("⚠️ un bloc `run: |` est du texte, pas du YAML", () => {
  it("ne prend pas pour une action ce qu'un script ÉCRIT", () => {
    const txt = [
      "      - name: garde",
      "        run: |",
      "          echo \"::error::action non épinglée\"",
      "          uses: machin@v1",
      "      - uses: actions/checkout@" + SHA,
    ].join("\n") + "\n";
    expect(references(txt)).toEqual([`actions/checkout@${SHA}`]);
  });

  it("sort du bloc quand l'indentation redescend, et pas avant", () => {
    const txt = "  a:\n    run: |\n      texte\n\n      encore\n    uses: x@v1\n";
    expect(references(txt)).toEqual(["x@v1"]);
  });

  it("reconnaît les variantes d'ouverture de bloc", () => {
    for (const ouverture of ["|", "|-", "|+", ">", ">-", "|2"]) {
      expect(lignesDeCle(`    run: ${ouverture}\n      uses: x@v1\n`), ouverture).toEqual([]);
    }
  });
});

describe("ce qui doit être épinglé, et ce qui n'a pas à l'être", () => {
  it("un SHA de 40 caractères passe", () => {
    expect(ecartEpinglage(`actions/checkout@${SHA}`)).toBeNull();
  });

  it("une étiquette ne passe pas, quelle qu'elle soit", () => {
    for (const ref of ["v4", "main", "v4.1.1", "latest"]) {
      expect(ecartEpinglage(`o/r@${ref}`), ref).toMatch(/pas sur un commit/);
    }
  });

  it("⚠️ une référence SANS `@` est le pire cas — elle suit la branche par défaut", () => {
    expect(ecartEpinglage("actions/checkout")).toMatch(/branche par défaut/);
  });

  it("une action LOCALE n'a rien à épingler — l'exiger serait impossible à satisfaire", () => {
    expect(ecartEpinglage("./.github/actions/maison")).toBeNull();
    expect(ecartEpinglage("../ailleurs")).toBeNull();
  });

  it("un workflow réutilisable suit la même règle", () => {
    expect(ecartEpinglage("o/r/.github/workflows/x.yml@v1")).toMatch(/pas sur un commit/);
    expect(ecartEpinglage(`o/r/.github/workflows/x.yml@${SHA}`)).toBeNull();
  });

  it("une image docker s'épingle par condensat, pour la raison du Dockerfile", () => {
    expect(ecartEpinglage("docker://alpine:3.20")).toMatch(/condensat/);
    expect(ecartEpinglage("docker://alpine@sha256:" + "b".repeat(64))).toBeNull();
  });

  it("un SHA tronqué n'est pas un SHA", () => {
    expect(ecartEpinglage("o/r@3d3c42e5")).toMatch(/pas sur un commit/);
  });
});

describe("les workflows réellement présents", () => {
  const fichiers = workflows(".github/workflows");

  it("il y en a, et la sonde ne vise pas à côté", () => {
    expect(fichiers.length).toBeGreaterThan(0);
  });

  it("toutes leurs actions sont épinglées sur un commit", () => {
    expect(fichiers.flatMap((f) => ecarts(readFileSync(f, "utf8"), f))).toEqual([]);
  });

  it("⚠️ et on en voit au moins autant que l'ancien grep — remplacer ne doit rien perdre", () => {
    // L'ancienne garde comptait 28 références épinglées ; la nouvelle en voit 28 aussi, plus les
    // formes qu'elle ratait. Le seuil est délibérément un plancher : ajouter une action ne doit
    // pas casser ce banc, en retirer douze si.
    const vues = fichiers.flatMap((f) => references(readFileSync(f, "utf8")));
    expect(vues.length).toBeGreaterThanOrEqual(28);
  });
});
