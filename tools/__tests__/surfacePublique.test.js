// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA SURFACE PUBLIQUE, CONFRONTÉE À CE QUE LE PAQUET EXPOSE VRAIMENT.
//
// ⚠️ `package.json#exports` portait dix sous-chemins, dont cinq que docs/API.md ne mentionnait
// nulle part (troisième audit externe, 21/08). Une donnée exposée est une promesse ; une promesse
// que personne ne peut lire n'engage que celui qui la découvre — et il la découvre en production.
// Ce banc éprouve la logique de confrontation, puis l'applique au paquet réel : les cas
// synthétiques prouvent la règle, le dernier prouve qu'elle porte sur ce qu'on publie.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { SURFACE, publics, ecartsExports, ecartsDoc, ecartsTypes, ecartsInternes, tolerancesSansSujet, formeImportee, INTERNES_TOLERES, PLANCHER_PUBLICS, PLANCHER_CHARGES, PLANCHER_SYMBOLES } from "../surface-publique.mjs";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

describe("le manifeste et package.json se confrontent", () => {
  const paquet = JSON.parse(readFileSync("package.json", "utf8"));

  it("s'accordent sur le paquet réel", () => {
    expect(ecartsExports(paquet.exports)).toEqual([]);
  });

  it("refuse un export ajouté sans être classé — le trou d'origine", () => {
    const soucis = ecartsExports({ ...paquet.exports, "./nouveau": "./server/nouveau.js" });
    expect(soucis.join(" ")).toMatch(/« \.\/nouveau ».*sans le classer/);
  });

  it("refuse un classement qui ne correspond à aucun export", () => {
    const ampute = { ...paquet.exports };
    delete ampute["./brands"];
    expect(ecartsExports(ampute).join(" ")).toMatch(/classe « \.\/brands ».*n'expose pas/);
  });

  it("chaque entrée porte un statut connu et une description", () => {
    for (const [sousChemin, d] of Object.entries(SURFACE)) {
      expect(["stable", "experimental", "document", "manifeste"], sousChemin).toContain(d.statut);
      expect(d.quoi, sousChemin).toBeTruthy();
    }
  });
});

describe("la documentation doit nommer ce qui est exposé", () => {
  it("docs/API.md les nomme tous", () => {
    expect(ecartsDoc(readFileSync("docs/API.md", "utf8"))).toEqual([]);
  });

  it("rougit si un export public disparaît de la doc", () => {
    const ampute = readFileSync("docs/API.md", "utf8").replaceAll("`discovery-media-player/shares`", "(retiré)");
    expect(ecartsDoc(ampute).join(" ")).toMatch(/« \.\/shares »/);
  });

  it("cherche la forme qu'un intégrateur écrit, pas la notation de package.json", () => {
    // « ./shares » est la notation d'exports ; personne n'écrit require("...././shares").
    expect(formeImportee("./shares")).toBe("discovery-media-player/shares");
    expect(formeImportee(".")).toBe("discovery-media-player");
  });

  it("ne réclame rien pour les documents et le manifeste", () => {
    expect(publics()).not.toContain("./contrat");
    expect(publics()).not.toContain("./package.json");
  });
});

describe("les symboles internes exposés — le préfixe dit, il n'empêche pas", () => {
  it("tolère ceux qui sont déclarés", () => {
    expect(ecartsInternes(".", ["handler", "init", ...INTERNES_TOLERES["."]])).toEqual([]);
  });

  it("refuse un nouveau symbole interne non décidé", () => {
    expect(ecartsInternes(".", ["handler", "__nouvelInterne"]).join(" ")).toMatch(/__nouvelInterne.*décidez-le/);
  });

  it("ne dit rien des symboles publics ordinaires", () => {
    expect(ecartsInternes("./shares", ["createShare", "getShareBySlug"])).toEqual([]);
  });

  it("le point d'entrée réel n'expose que les internes tolérés", () => {
    // ⚠️ La garde de la garde : si quelqu'un ajoute un `__quelqueChose` au handler, ce test le
    // dit ici, avant que la CI ne le dise sur la forge.
    const mod = require("../../server/handler.js");
    expect(ecartsInternes(".", Object.keys(mod))).toEqual([]);
  });

  // ⚠️ L'AUTRE SENS DE LA MÊME LISTE, ET IL MANQUAIT. « Tout nouveau venu doit être décidé plutôt
  // que découvert » n'était tenu que contre les ARRIVANTS : un symbole qui cesse d'être exporté
  // laissait son entrée derrière lui, et son retour aurait été « toléré » au lieu d'être décidé —
  // ce que cette liste existe précisément pour empêcher.
  it("⚠️ chaque tolérance a encore un sujet — une entrée morte est une porte ouverte d'avance", () => {
    const mod = require("../../server/handler.js");
    expect(tolerancesSansSujet(".", Object.keys(mod)), "une tolérance sans sujet : retirez l'entrée").toEqual([]);
  });

  it("⚠️ et elle le DIT quand le symbole a disparu", () => {
    const restants = INTERNES_TOLERES["."].slice(1);
    const r = tolerancesSansSujet(".", ["handler", "init", ...restants]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(new RegExp(`${INTERNES_TOLERES["."][0]}.*RETIREZ`));
  });
});

describe("un export stable doit annoncer ses types", () => {
  // ⚠️ « Stable » engage la FORME de la surface. Sans déclaration, cette forme n'est écrite nulle
  // part qu'une machine puisse lire : un consommateur TypeScript strict reçoit un `any` implicite
  // — donc une erreur de compilation, ou pire, un silence qui laisse passer n'importe quel appel.
  const paquet = JSON.parse(readFileSync("package.json", "utf8"));

  it("le paquet réel tient la promesse", () => {
    expect(ecartsTypes(paquet.exports)).toEqual([]);
  });

  it("rougit si un stable perd ses types", () => {
    const mute = { ...paquet.exports, ".": "./server/handler.js" };
    expect(ecartsTypes(mute).join(" ")).toMatch(/« \. » est stable et n'annonce aucun type/);
  });

  it("ne réclame rien des expérimentaux — leur forme n'est pas figée, le dire serait se contredire", () => {
    expect(SURFACE["./shares"].statut).toBe("experimental");
    expect(ecartsTypes(paquet.exports).some((e) => e.includes("shares"))).toBe(false);
  });

  it("les fichiers de types voyagent dans le tarball", () => {
    // Un `.d.ts` absent de `files` est parfait chez nous et introuvable chez qui installe.
    expect(paquet.files).toContain("types");
  });
});

describe("⚠️ le plancher portait sur une CONSTANTE, donc sur rien", () => {
  // ⚠️ CE QUI ÉTAIT MESURÉ LE 31/08. Le résumé vert annonçait « 3 stable, 4 experimental,
  // 2 document, 1 manifeste » — compté sur `SURFACE`, un objet écrit dans le fichier de la garde.
  // TROIS cécités distinctes sortaient 0 avec CE MÊME message, mot pour mot :
  //   `publics()` rendu vide, le chargement des modules muet, la boucle des internes vidée.
  //
  // C'est la forme la plus dure du défaut : un plancher placé un maillon trop tôt compte au moins
  // quelque chose de réel et peut tomber ; un plancher posé sur un littéral du fichier ne peut
  // PAS tomber. Il a l'apparence d'une mesure et la nature d'une signature.
  it("⚠️ le compte par statut ne bouge pas quand la sonde s'éteint — il ne mesurait rien", () => {
    const parStatut = Object.values(SURFACE).reduce((a, d) => ({ ...a, [d.statut]: (a[d.statut] || 0) + 1 }), {});
    expect(parStatut.stable, "cette valeur vient d'un littéral, pas d'une lecture").toBeGreaterThan(0);
    // Le point du test : ce nombre est une propriété du SOURCE, jamais du travail accompli.
    // Ce que la garde imprime désormais, ce sont les trois comptes ci-dessous.
  });

  it("les planchers portent sur ce qui est vraiment parcouru", () => {
    expect(PLANCHER_PUBLICS).toBeGreaterThan(0);
    expect(PLANCHER_CHARGES).toBeGreaterThan(0);
    expect(PLANCHER_SYMBOLES).toBeGreaterThan(0);
  });
});

describe("⚠️ sur le paquet réel, les trois comptes tiennent", () => {
  const paquetReel = JSON.parse(readFileSync("package.json", "utf8"));

  it(`au moins ${PLANCHER_PUBLICS} sous-chemins publics, et le juge lit la MÊME liste`, () => {
    const chemins = publics();
    expect(chemins.length, "7 le 31/08").toBeGreaterThanOrEqual(PLANCHER_PUBLICS);
    // ⚠️ La boucle du verdict parcourt `publics()`, elle ne refait pas le filtre pour son compte :
    // une seconde écriture laisserait juge et témoin regarder deux listes qui peuvent diverger.
    const refait = Object.entries(SURFACE)
      .filter(([, d]) => ["stable", "experimental"].includes(d.statut)).map(([k]) => k);
    expect(chemins).toEqual(refait);
  });

  it(`au moins ${PLANCHER_CHARGES} modules chargés et ${PLANCHER_SYMBOLES} symboles relevés`, () => {
    let charges = 0;
    let symboles = 0;
    for (const sousChemin of publics()) {
      const chemin = paquetReel.exports[sousChemin];
      const fichier = typeof chemin === "string" ? chemin : chemin?.default;
      if (!fichier || !fichier.endsWith(".js")) continue;
      try {
        const mod = createRequire(pathToFileURL("./package.json"))(fichier);
        charges += 1;
        symboles += Object.keys(mod).length;
      } catch { /* l'unité est tolérée ici comme dans la garde ; c'est le total qui compte */ }
    }
    expect(charges, "7 le 31/08 — si ce compte s'effondre, « aucun interne ne fuit » ne dit rien")
      .toBeGreaterThanOrEqual(PLANCHER_CHARGES);
    expect(symboles, "75 le 31/08").toBeGreaterThanOrEqual(PLANCHER_SYMBOLES);
  });
});

// ⚠️ « UN EXPORT STABLE DÉCLARÉ EN CHAÎNE NUE N'ANNONCE AUCUN TYPE » n'était éprouvé nulle part :
// tous les stables du manifeste s'écrivent aujourd'hui en objet de conditions. Mesuré le 01/09,
// aveugler ce `typeof cible === "string"` ne faisait bouger ni la garde ni ce banc.
describe("⚠️ la forme sous laquelle un export est déclaré compte autant que sa présence", () => {
  // `ecartsTypes` parcourt TOUT le manifeste : un cas qui n'en passe qu'une entrée accuse les
  // autres pour absence. On part donc d'un manifeste complet et bien formé, et on ne change QUE
  // la déclaration du sous-chemin éprouvé.
  const complet = Object.fromEntries(Object.keys(SURFACE)
    .map((e) => [e, { types: "./types/x.d.ts", default: "./server/x.js" }]));
  const stable = Object.entries(SURFACE).find(([, d]) => d.statut === "stable")[0];

  it("aucun écart quand chaque stable annonce ses types", () => {
    expect(ecartsTypes(complet)).toEqual([]);
  });

  it("⚠️ un stable déclaré en CHAÎNE NUE est accusé — une chaîne n'annonce pas de types", () => {
    expect(ecartsTypes({ ...complet, [stable]: "./server/x.js" }))
      .toEqual([expect.stringMatching(new RegExp(`« ${stable.replace(".", "\\.")} » est stable et n'annonce aucun type`))]);
  });

  it("un EXPÉRIMENTAL déclaré en chaîne nue ne l'est pas — sa forme n'est pas figée", () => {
    const exp = Object.entries(SURFACE).find(([, d]) => d.statut !== "stable");
    if (!exp) return;
    expect(ecartsTypes({ ...complet, [exp[0]]: "./server/x.js" })).toEqual([]);
  });
});
