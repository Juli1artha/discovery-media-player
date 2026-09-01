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
import { compte, prose, ecartLangue, markdownsDuTarball, PLANCHER_PARLANTS } from "../langue-publiee.mjs";


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

describe("⚠️ le témoin de la forme — « rien trouvé » n'est pas « rien regardé »", () => {
  // ⚠️ CE QUI ÉTAIT MESURÉ LE 31/08. En forçant `compte` à ne trouver aucun mot — un compteur
  // aveugle — l'outil imprimait « 3 document(s) DU TARBALL, aucun majoritairement français » et
  // sortait 0. Le plancher comptait les DOCUMENTS DU TARBALL, pas la PROSE RECONNUE.
  //
  // ⚠️ ET LA PORTE EST DANS `ecartLangue` ELLE-MÊME, écrite pour une bonne raison : elle rend
  // `null` quand fr et en sont nuls, parce qu'une table nue ne conclut rien. C'est exactement par
  // là que la garde sort verte quand le compteur ne lit plus. Une règle prudente et une cécité
  // sont ici la même ligne — seul un compte de la prose RECONNUE les sépare.
  it("⚠️ un texte sans aucun mot-outil ne conclut rien — la porte par où sort le vert", () => {
    expect(ecartLangue("t.md", "| 1 | 2 |\n| 3 | 4 |\n")).toBe(null);
    expect(compte("| 1 | 2 |\n")).toEqual({ fr: 0, en: 0 });
  });

  it("le compteur reconnaît de la prose anglaise, et le témoin compte ce document", () => {
    const { fr, en } = compte("The host owns the transport and the storage of the documents.");
    expect(en).toBeGreaterThan(0);
    expect(fr + en).toBeGreaterThan(0);
  });
});

describe("⚠️ sur le tarball réel, le compteur lit encore de la prose", () => {
  it(`au moins ${PLANCHER_PARLANTS} documents où un mot-outil est reconnu`, () => {
    const fichiers = markdownsDuTarball();
    const parlants = fichiers.filter((f) => {
      const { fr, en } = compte(readFileSync(f, "utf8"));
      return fr + en > 0;
    }).length;
    expect(parlants, `3 sur 3 le 31/08 — ${fichiers.join(", ")}`).toBeGreaterThanOrEqual(PLANCHER_PARLANTS);
  });
});

// ⚠️ LE RETRAIT DES BARRIÈRES N'ÉTAIT VU PAR PERSONNE, ET LA RAISON N'EST PAS CELLE QU'ON CROIT.
// Mesuré le 01/09 : aveuglé, ni la garde ni ce banc ne bougent. Le premier banc écrit pour l'exercer
// ne les voyait pas davantage, et c'est instructif — un bloc clôturé porte SIX accents graves, un
// nombre PAIR, et `/`[^`]*`/g` les apparie deux à deux jusqu'à tout avoir mangé. Le second
// dépouillage efface le bloc à lui seul. Les deux sondes se recouvrent sur presque tout.
//
// ⚠️ CE QUI LES SÉPARE : un contenu qui porte un nombre IMPAIR d'accents graves. L'appariement deux
// à deux se décale alors d'un cran et rend au texte des morceaux du bloc. Mesuré sur les 31
// markdown du dépôt le 01/09 : `compte()` donne le MÊME résultat avec et sans le retrait des
// barrières — aucun document d'aujourd'hui ne porte cette forme. La sonde ne sert donc rien
// aujourd'hui ; elle sert le jour où un document montre un accent grave dans un bloc, et ce jour-là
// elle décide seule. C'est ce jour-là qu'on éprouve ici, faute de pouvoir l'éprouver sur le dépôt.
describe("⚠️ la prose s'arrête aux blocs de code — les identifiants ne sont pas de la langue", () => {
  const BARRIERE = "`".repeat(3);
  const enLigneSeul = (txt) => txt.replace(/`[^`]*`/g, " ");

  it("un bloc clôturé est retiré, pas seulement les accents graves d'une ligne", () => {
    const md = `Une phrase.\n\n${BARRIERE}js\nconst fichiersCandidats = leur.pour(une);\n${BARRIERE}\n\nUne autre.\n`;
    expect(prose(md), "le contenu du bloc ne doit plus être là").not.toContain("fichiersCandidats");
    expect(prose(md)).toContain("Une phrase.");
    expect(prose(md)).toContain("Une autre.");
  });

  // ⚠️ CE CAS NE PROUVE RIEN SUR LA BARRIÈRE, et il est écrit pour qu'on cesse de le croire. Il
  // passe à l'identique quand le retrait des barrières est aveuglé : c'est le dépouillage EN LIGNE
  // qui fait tout le travail. Le pin ici pour que le prochain banc ne se contente pas de cette
  // forme-là en pensant avoir couvert la première sonde.
  it("⚠️ et sur un bloc à nombre PAIR d'accents graves, le retrait en ligne y suffisait seul", () => {
    const md = `A\n${BARRIERE}\nle la les des qui pour dans\n${BARRIERE}\nB`;
    expect(enLigneSeul(md), "l'appariement deux à deux a déjà tout mangé").not.toContain("les des");
    expect(compte(enLigneSeul(md))).toEqual(compte(md));
  });

  it("⚠️ mais sur un nombre IMPAIR, la barrière décide seule — et le verdict bascule", () => {
    const md = `This document is written in English.\n\n${BARRIERE}sh\nsed "s/\`/x/" les des qui pour dans une par sur\n${BARRIERE}\n\nAnd it ends in English.\n`;
    expect(compte(md), "le bloc est du shell, pas de la prose").toEqual({ fr: 0, en: 2 });
    expect(compte(enLigneSeul(md)).fr, "sans la barrière, six identifiants deviennent du français")
      .toBe(6);
    expect(ecartLangue("docs/X.md", md), "français < anglais : rien à dire").toBe(null);
    expect(ecartLangue("docs/X.md", enLigneSeul(md)), "aveuglée, la garde accuserait un document anglais")
      .toMatch(/n'est pas en anglais/);
  });

  it("⚠️ et c'est ce qui empêche du code d'être compté comme du français", () => {
    // `pour`, `une`, `leur` sont des mots-outils français ; ici ce sont des identifiants.
    const md = `The document is written in English.\n\n${BARRIERE}js\nconst pour = une(leur, dans, avec);\n${BARRIERE}\n`;
    expect(compte(md).fr, "aucun mot français : tout le « français » était du code").toBe(0);
    expect(compte(md).en, "l'anglais de la prose est bien compté").toBeGreaterThan(0);
  });

  it("les portions entre accents graves simples sont retirées aussi", () => {
    expect(prose("Voir `pour une leur` ici.")).not.toContain("pour une leur");
  });

  it("un bloc non fermé ne mange pas le reste — la garde ne doit pas devenir aveugle sur une faute de frappe", () => {
    const md = `Une phrase.\n\n${BARRIERE}js\nconst x = 1;\n`;
    expect(prose(md), "sans fermeture, le retrait ne s'applique pas et la prose reste lisible")
      .toContain("Une phrase.");
  });
});
