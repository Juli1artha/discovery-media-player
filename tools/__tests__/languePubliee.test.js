// LA LANGUE DES DOCUMENTS QUI VOYAGENT, ÉPROUVÉE.
//
// ⚠️ `docs/RETENTION.md` partait en français dans le tarball publié (P1, audit externe du 21/08) :
// le document qu'un DPO consulte, exposé en plus comme sous-chemin `discovery-media-player/retention`,
// tandis que tout le reste de ce qu'un intégrateur lit est en anglais. La règle existait — dehors
// en anglais, traces internes en français — mais seulement dans les têtes.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { compte, prose, ecartLangue, markdownsPublies } from "../langue-publiee.mjs";

const paquet = JSON.parse(readFileSync("package.json", "utf8"));

describe("le périmètre se DÉRIVE de package.json#files", () => {
  it("ne retient que les Markdown qui voyagent", () => {
    const m = markdownsPublies(paquet);
    expect(m).toContain("README.md");
    expect(m).toContain("docs/RETENTION.md");
    expect(m.every((f) => f.endsWith(".md"))).toBe(true);
  });

  it("⚠️ ne liste rien en dur — un document ajouté au tarball entre dans le périmètre tout seul", () => {
    expect(markdownsPublies({ files: ["bin", "docs/NOUVEAU.md"] })).toEqual(["docs/NOUVEAU.md"]);
  });

  it("ne regarde pas ce qui ne voyage pas", () => {
    // Les audits et les migrations sont des traces internes : elles restent dans la langue où
    // elles ont été pensées, et elles ne partent pas dans le paquet.
    expect(markdownsPublies(paquet)).not.toContain("docs/AUDIT-2026-08-14-RAPPORT.md");
    expect(markdownsPublies(paquet)).not.toContain("docs/MIGRATIONS.md");
  });
});

describe("on compte la PROSE, pas le code", () => {
  it("⚠️ les identifiants du produit sont français et ne prouvent rien", () => {
    // `plafond`, `supprimees`, `fichiersCandidats` sont des clés de l'API, pas de la prose.
    expect(prose("The report carries `plafond`, `supprimees` and `tronque`.")).not.toContain("plafond");
  });

  it("ignore les blocs de code entiers", () => {
    expect(prose("Before\n```\nle la les des qui pour dans\n```\nAfter")).not.toContain("les");
  });

  it("un exemple de code français ne fait pas basculer un document anglais", () => {
    const doc = "The host writes this in its configuration:\n\n```js\nconst plafond = { le: 1, la: 2, les: 3, des: 4, qui: 5, pour: 6, dans: 7, est: 8 };\n```\n";
    expect(ecartLangue("x.md", doc)).toBeNull();
  });
});

describe("le verdict", () => {
  it("rougit sur de la prose française", () => {
    const doc = "Ce document est le périmètre déclaré de la rétention : chaque colonne du schéma qui peut porter une donnée personnelle a une politique dans cette page.";
    expect(ecartLangue("docs/X.md", doc)).toMatch(/n'est pas en anglais/);
  });

  it("nomme le fichier et donne les deux comptes", () => {
    const souci = ecartLangue("docs/X.md", "Le document est dans la langue des mots qui suivent pour nous.");
    expect(souci).toContain("docs/X.md");
    expect(souci).toMatch(/\d+ mots-outils français contre \d+ anglais/);
  });

  it("accepte de la prose anglaise", () => {
    expect(ecartLangue("x.md", "This is the document that describes what the data are and which of them are not kept.")).toBeNull();
  });

  it("⚠️ ne tranche pas un document sans mots-outils — refuser là-dessus serait inventer un fait", () => {
    expect(ecartLangue("x.md", "# Title\n\n| a | b |\n|---|---|\n| 1 | 2 |\n")).toBeNull();
  });

  it("⚠️ ne rougit pas sur un document anglais qui CITE du français", () => {
    const doc = "The comment reads " + '"le fichier est dans la corbeille"' + " and that is the whole of it; the rest of this page is written in English, which is what the check is for, and the words that follow are not French.";
    expect(ecartLangue("x.md", doc)).toBeNull();
  });
});

describe("les documents réellement publiés", () => {
  for (const f of markdownsPublies(paquet)) {
    it(`${f} est en anglais`, () => {
      expect(ecartLangue(f, readFileSync(f, "utf8"))).toBeNull();
    });
  }

  it("⚠️ la garde rougissait sur RETENTION.md tel qu'il était publié — c'est ce qu'elle existe pour dire", () => {
    // 220 mots-outils français contre 0 anglais : deux ordres de grandeur de marge, l'heuristique
    // n'a jamais eu à trancher un cas serré.
    const avant = "# Rétention des données\n\nCe document est le périmètre déclaré de la rétention : chaque colonne du schéma dont la forme peut porter une donnée personnelle y a une politique. Une garde de forge énumère les colonnes du schéma vivant et refuse toute colonne qui n'est pas dans cette page.";
    expect(ecartLangue("docs/RETENTION.md", avant)).toMatch(/pas en anglais/);
    expect(compte(avant).en).toBe(0);
  });
});
