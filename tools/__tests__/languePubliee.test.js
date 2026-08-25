// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA LANGUE DES DOCUMENTS QUI VOYAGENT, ÉPROUVÉE.
//
// ⚠️ `docs/RETENTION.md` partait en français dans le tarball publié (P1, audit externe du 21/08) :
// le document qu'un DPO consulte, exposé en plus comme sous-chemin `discovery-media-player/retention`,
// tandis que tout le reste de ce qu'un intégrateur lit est en anglais. La règle existait — dehors
// en anglais, traces internes en français — mais seulement dans les têtes.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { compte, prose, ecartLangue, markdownsDuTarball } from "../langue-publiee.mjs";


describe("⚠️ LE PÉRIMÈTRE SE DEMANDE À npm, PAS À package.json#files", () => {
  // `files` n'est pas la liste de ce qui part : npm ajoute des fichiers et développe les dossiers.
  // Constaté sur la 0.1.127 — le tarball contenait `docs/README.md`, que `files` ne nomme pas.
  // Il voyageait sans être contrôlé, et la garde annonçait « 3 documents » en en regardant 3 sur 4.
  const pack = (chemins) => JSON.stringify([{ files: chemins.map((path) => ({ path })) }]);

  it("prend les Markdown du TARBALL, pas ceux du manifeste", () => {
    const vus = markdownsDuTarball(() => pack(["README.md", "docs/README.md", "bin/serve.js"]));
    expect(vus).toEqual(["README.md", "docs/README.md"]);
  });

  it("⚠️ voit le fichier que `files` ne nomme pas — le trou d'origine", () => {
    expect(markdownsDuTarball(() => pack(["README.md", "docs/README.md"]))).toContain("docs/README.md");
  });

  it("refuse un inventaire vide plutôt que de conclure dessus", () => {
    expect(() => markdownsDuTarball(() => pack([]))).toThrow(/aucun fichier/);
  });

  it("accepte la forme objet comme la forme tableau", () => {
    expect(markdownsDuTarball(() => JSON.stringify({ files: [{ path: "a.md" }] }))).toEqual(["a.md"]);
  });

  it("le tarball réel contient bien les documents attendus", () => {
    const vus = markdownsDuTarball();
    expect(vus).toContain("README.md");
    expect(vus).toContain("docs/RETENTION.md");
    expect(vus).toContain("docs/HOST-CONTRACT.md");
  });

  it("⚠️ ce banc EXIGEAIT docs/README.md — il avait figé un accident en attente", () => {
    // Ce document ne partait pas par décision : `"README.md"` dans `files` est un MOTIF que npm
    // fait correspondre à toute profondeur, et il ramenait `docs/README.md` avec lui — un sommaire
    // de dix-sept documents absents du paquet. La ligne a été retirée de `files` ; ce qui avait été
    // observé une fois était devenu ici la preuve que c'était voulu.
    expect(markdownsDuTarball()).not.toContain("docs/README.md");
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
  for (const f of markdownsDuTarball()) {
    it(`${f} n'est pas majoritairement français`, () => {
      expect(ecartLangue(f, readFileSync(f, "utf8"))).toBeNull();
    });
  }

  it("⚠️ la garde rougissait sur RETENTION.md tel qu'il était publié", () => {
    const avant = "# Rétention des données\n\nCe document est le périmètre déclaré de la rétention : chaque colonne du schéma dont la forme peut porter une donnée personnelle y a une politique. Une garde de forge énumère les colonnes du schéma vivant et refuse toute colonne qui n'est pas dans cette page.";
    expect(ecartLangue("docs/RETENTION.md", avant)).toMatch(/pas en anglais|français/);
    expect(compte(avant).en).toBe(0);
  });
});
