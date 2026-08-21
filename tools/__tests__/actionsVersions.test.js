// L'ÉTIQUETTE CONFRONTÉE AU SHA — ÉPROUVÉE SUR LE CAS QUI L'A FAIT NAÎTRE.
//
// ⚠️ #253 (21/08) a remplacé trois SHA de `github/codeql-action` en laissant `# v3` intact. Le SHA
// posé porte `v4.37.7` : le fichier annonçait un correctif là où il posait une MAJEURE sur l'outil
// d'analyse de sécurité du dépôt. La CI était verte — elle vérifiait que le SHA EST un SHA, jamais
// que l'étiquette DIT vrai. C'est la confrontation bâtie pour le Dockerfile (#274), qui n'avait pas
// été portée du côté des actions : le raisonnement était écrit, le contrôle manquait.
//
// Le relevé réseau n'est pas simulé au hasard : il est INJECTÉ, avec les sorties `git ls-remote`
// réelles relevées ce jour-là.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { depotDe, annonceDe, entrees, ecartVersion, tagsDuDepot, verdict } from "../actions-versions.mjs";

const V4 = "ff2f1c621b7f889edc0d3c761ac2e6a3f8cdb0dd"; // github/codeql-action v4.37.7
const V3 = "f3712979fa5f215279b101dd0a2e3bdfb4353324"; // github/codeql-action v3.37.7

describe("le dépôt qui porte l'action", () => {
  it("⚠️ le troisième segment est un chemin DANS le dépôt, pas un dépôt", () => {
    expect(depotDe("github/codeql-action/init@" + V4)).toBe("github/codeql-action");
    expect(depotDe("github/codeql-action/upload-sarif@" + V4)).toBe("github/codeql-action");
  });

  it("lit une action à la racine", () => {
    expect(depotDe("actions/checkout@" + V4)).toBe("actions/checkout");
  });

  it("ne fabrique pas un dépôt à partir de rien", () => {
    expect(depotDe("./locale")).toBeNull();
  });
});

describe("ce que la ligne annonce", () => {
  it("prend le premier mot du commentaire", () => {
    expect(annonceDe("      - uses: a/b@" + V4 + " # v3")).toBe("v3");
    expect(annonceDe("      - uses: a/b@" + V4 + " # v7  (dernière LTS)")).toBe("v7");
  });

  it("rend null quand il n'y a pas de commentaire", () => {
    expect(annonceDe("      - uses: a/b@" + V4)).toBeNull();
  });
});

describe("le relevé des couples action/annonce", () => {
  it("attrape la ligne exacte de l'incident", () => {
    const txt = `      - uses: github/codeql-action/init@${V4} # v3\n`;
    expect(entrees(txt, "codeql.yml")).toEqual([{
      fichier: "codeql.yml", reference: `github/codeql-action/init@${V4}`,
      depot: "github/codeql-action", sha: V4, annonce: "v3",
    }]);
  });

  it("⚠️ ne reproche rien à une ligne SANS commentaire — il n'y a rien à confronter", () => {
    expect(entrees(`      - uses: a/b@${V4}\n`)).toEqual([]);
  });

  it("ignore ce qui n'est pas épinglé sur un SHA — c'est l'autre garde qui s'en occupe", () => {
    expect(entrees("      - uses: a/b@v3 # v3\n")).toEqual([]);
    expect(entrees("      - uses: ./locale # maison\n")).toEqual([]);
  });

  it("hérite du découpage YAML de la garde voisine : ni commentaires, ni blocs `run: |`", () => {
    const txt = [
      "      # exemple dans un commentaire : uses: a/b@" + V4 + " # v9",
      "      - name: garde",
      "        run: |",
      "          uses: c/d@" + V4 + " # v9",
      "      - uses: e/f@" + V4 + " # v1",
    ].join("\n") + "\n";
    expect(entrees(txt).map((e) => e.depot)).toEqual(["e/f"]);
  });
});

describe("⚠️ LE CAS #253 — une majeure déguisée en correctif", () => {
  const entree = { reference: `github/codeql-action/init@${V4}`, annonce: "v3" };

  it("refuse « v3 » en face d'un commit tagué v4.37.7", () => {
    const souci = ecartVersion(entree, ["v4.37.7"]);
    expect(souci).toMatch(/annonce v3.*v4\.37\.7.*ne désignent pas la même version/);
  });

  it("accepterait la même ligne avant la montée", () => {
    expect(ecartVersion({ ...entree, reference: `x@${V3}` }, ["v3.37.7"])).toBeNull();
  });

  it("accepte la correction posée", () => {
    expect(ecartVersion({ ...entree, annonce: "v4.37.7" }, ["v4.37.7"])).toBeNull();
  });
});

describe("« v4 » est une annonce honnête pour un v4.37.7", () => {
  // ⚠️ Exiger l'égalité stricte rendrait rouge la moitié du dépôt, qui écrit `# v7` en face d'un
  // `v7.0.2`. Une garde qui crie faux contamine le canal — c'est la leçon de la garde des exemples.
  it("accepte la famille comme préfixe", () => {
    expect(ecartVersion({ reference: "a/b@x", annonce: "v4" }, ["v4.37.7"])).toBeNull();
  });

  it("accepte un tag mouvant posé sur le même commit", () => {
    // docker/setup-buildx-action porte `v4` ET `v4.3.0` sur le même SHA.
    expect(ecartVersion({ reference: "a/b@x", annonce: "v4" }, ["v4", "v4.3.0"])).toBeNull();
  });

  it("⚠️ mais « v3 » n'est pas un préfixe de « v4.37.7 » — le piège du découpage naïf", () => {
    expect(ecartVersion({ reference: "a/b@x", annonce: "v3" }, ["v4.37.7"])).toBeTruthy();
  });

  it("ne se laisse pas avoir par un préfixe qui n'est pas une famille", () => {
    // « v4.3 » ne doit pas valider « v4.37.7 » : ce sont deux versions différentes.
    expect(ecartVersion({ reference: "a/b@x", annonce: "v4.3" }, ["v4.37.7"])).toBeTruthy();
    expect(ecartVersion({ reference: "a/b@x", annonce: "v4.3" }, ["v4.3.0"])).toBeNull();
  });
});

describe("un commit sans aucun tag", () => {
  it("⚠️ refuse — l'annonce n'est adossée à rien de vérifiable", () => {
    expect(ecartVersion({ reference: "a/b@x", annonce: "v3" }, [])).toMatch(/AUCUN tag/);
    expect(ecartVersion({ reference: "a/b@x", annonce: "v3" }, undefined)).toMatch(/AUCUN tag/);
  });
});

describe("le relevé distant, sans réseau", () => {
  const SORTIE = [
    `${V3}\trefs/tags/v3.37.7^{}`,
    `0000000000000000000000000000000000000000\trefs/tags/v3.37.7`,
    `${V4}\trefs/tags/v4.37.7^{}`,
    `${V4}\trefs/tags/v4`,
  ].join("\n");

  it("range les tags par commit, et déréférence les tags annotés", () => {
    const parSha = tagsDuDepot("github/codeql-action", () => SORTIE);
    expect(parSha.get(V4)).toEqual(["v4.37.7", "v4"]);
    expect(parSha.get(V3)).toEqual(["v3.37.7"]);
  });

  it("interroge bien le dépôt demandé", () => {
    let vue = null;
    tagsDuDepot("github/codeql-action", (url) => { vue = url; return ""; });
    expect(vue).toBe("https://github.com/github/codeql-action");
  });

  it("rend null quand le dépôt ne répond pas — sans lever", () => {
    expect(tagsDuDepot("a/b", () => { throw new Error("réseau"); })).toBeNull();
  });
});

describe("⚠️ un « non vérifié » ne se confond jamais avec un vert", () => {
  // La règle des gardes muettes (0.1.35) : une panne de réseau et un mensonge ne se disent pas de
  // la même façon, et surtout pas avec le même silence.
  const entree = { fichier: "w.yml", reference: `a/b@${V4}`, depot: "a/b", sha: V4, annonce: "v3" };

  it("sépare ce qui est FAUX de ce qu'on n'a pas pu voir", () => {
    const injoignable = verdict([entree], new Map([["a/b", null]]));
    expect(injoignable.ecarts).toEqual([]);
    expect(injoignable.nonVus[0]).toMatch(/n'a pas répondu/);
  });

  it("rougit quand le dépôt a répondu et que l'annonce est fausse", () => {
    const vu = verdict([entree], new Map([["a/b", new Map([[V4, ["v4.37.7"]]])]]));
    expect(vu.nonVus).toEqual([]);
    expect(vu.ecarts[0]).toContain("w.yml");
  });

  it("nomme le fichier fautif", () => {
    const vu = verdict([{ ...entree, fichier: ".github/workflows/codeql.yml" }],
      new Map([["a/b", new Map([[V4, ["v4.37.7"]]])]]));
    expect(vu.ecarts[0]).toMatch(/^\.github\/workflows\/codeql\.yml :/);
  });
});

describe("les workflows réellement présents", () => {
  const fichiers = ["codeql.yml", "ci.yml", "image.yml", "scorecard.yml", "release.yml", "cla.yml"]
    .map((f) => ".github/workflows/" + f);

  it("chaque action épinglée y annonce une étiquette lisible", () => {
    const toutes = fichiers.flatMap((f) => entrees(readFileSync(f, "utf8"), f));
    expect(toutes.length).toBeGreaterThan(0);
    for (const e of toutes) {
      expect(e.depot, e.reference).toBeTruthy();
      expect(e.sha, e.reference).toMatch(/^[0-9a-f]{40}$/);
      expect(e.annonce, e.reference).toBeTruthy();
    }
  });

  it("⚠️ codeql-action n'annonce plus v3 — la ligne qui a motivé cette garde", () => {
    const codeql = entrees(readFileSync(".github/workflows/codeql.yml", "utf8"))
      .filter((e) => e.depot === "github/codeql-action");
    expect(codeql.length).toBeGreaterThan(0);
    for (const e of codeql) expect(e.annonce).not.toBe("v3");
  });
});
