// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE DÉFAUT DU 25/08 REJOUÉ, ET LES TROIS AVEUGLEMENTS DE LA SONDE QUI LE CHERCHE.
//
// La garde a été écrite trois fois à l'expression régulière avant de passer à un vrai analyseur.
// Chacun de ces trois échecs est éprouvé ici : ce sont eux qui expliquent pourquoi elle lit
// désormais le code avec `esbuild` plutôt qu'avec un motif.

import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import { methodesDuModuleSeul, sansCommentaires, sansChaines, lieCrypto, appelsDuModule, manquements, temoinsDeForme, auPerimetre } from "../liaison-de-crypto.mjs";

const METHODES = methodesDuModuleSeul();

describe("ce qui distingue le module du global", () => {
  it("se dérive de Node, il n'est pas écrit à la main", () => {
    expect(METHODES).toContain("createHash");
    expect(METHODES).toContain("randomBytes");
    expect(METHODES).toContain("timingSafeEqual");
  });

  it("⚠️ EXCLUT ce que le global expose AUSSI — `crypto.randomUUID()` nu est parfaitement valide", () => {
    expect(METHODES).not.toContain("randomUUID");
    expect(METHODES).not.toContain("getRandomValues");
  });

  it("rend une liste vide si le global expose tout — la question n'aurait alors plus de sens", () => {
    const faux = { createHash() {}, randomBytes() {} };
    expect(methodesDuModuleSeul(faux, faux)).toEqual([]);
  });
});

describe("lire le code sans le déformer", () => {
  it("⚠️ AVEUGLEMENT 1 : la liaison EST une chaîne, donc on ne la cherche pas dans un texte dépouillé", () => {
    const src = 'const crypto = require("node:crypto");\ncrypto.createHash("sha256");\n';
    expect(lieCrypto(sansCommentaires(src))).toBe(true);
    // La première version cherchait ici, dans le texte SANS chaînes : elle accusait cinq fichiers corrects.
    expect(lieCrypto(sansChaines(sansCommentaires(src)))).toBe(false);
  });

  it("⚠️ AVEUGLEMENT 2 : plusieurs lignes commentées de suite ne doivent pas se replier sur le code", () => {
    const src = "// une\n// deux\n// trois\nconst crypto = require(\"crypto\");\ncrypto.randomBytes(4);\n";
    expect(lieCrypto(sansCommentaires(src))).toBe(true);
  });

  it("⚠️ AVEUGLEMENT 3 : un motif de fichiers cité dans un commentaire de LIGNE n'ouvre pas un bloc", () => {
    // C'est l'en-tête réel de `routes-agent.js` qui a fait rougir la garde sur le fichier CORRIGÉ.
    const src = "// les gardes ciblent server/" + "*.js\nconst crypto = require(\"node:crypto\");\ncrypto.createHash(\"sha256\");\n";
    expect(lieCrypto(sansCommentaires(src))).toBe(true);
    expect(appelsDuModule(sansChaines(sansCommentaires(src)), METHODES)).toEqual(["createHash"]);
  });

  it("un appel cité dans un commentaire n'accuse personne", () => {
    const src = "// ⚠️ ne jamais écrire crypto.createHash sans lier le module\nconst x = 1;\n";
    expect(appelsDuModule(sansChaines(sansCommentaires(src)), METHODES)).toEqual([]);
  });

  it("⚠️ le code NAVIGATEUR des gabarits vit dans des littéraux — là, `crypto` DOIT être le global", () => {
    const src = "const page = `<script>crypto.createHash('x')</script>`;\n";
    expect(appelsDuModule(sansChaines(sansCommentaires(src)), METHODES)).toEqual([]);
  });

  it("lève sur un fichier qu'il ne sait pas analyser, au lieu de deviner", () => {
    expect(() => sansCommentaires("const = = ;;; (")).toThrow();
  });
});

describe("ce qui est fautif et ce qui ne l'est pas", () => {
  it("⚠️ REJOUE LE 25/08 : un appel sans liaison est nommé, avec sa méthode", () => {
    const soucis = manquements(["routes-agent.js"], () => 'crypto.createHash("sha256");', METHODES);
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain("routes-agent.js");
    expect(soucis[0]).toContain("createHash");
  });

  it("se tait dès que le module est lié — le correctif de la même journée", () => {
    expect(manquements(["a.js"], () => 'const crypto = require("node:crypto");\ncrypto.createHash("x");', METHODES)).toEqual([]);
  });

  it("accepte une liaison au POINT D'USAGE, qui va très bien", () => {
    expect(manquements(["a.js"], () => 'require("crypto").createHash("x");', METHODES)).toEqual([]);
  });

  it("nomme toutes les méthodes fautives d'un fichier, pas seulement la première", () => {
    const soucis = manquements(["a.js"], () => "crypto.createHash(1); crypto.randomBytes(2);", METHODES);
    expect(soucis[0]).toContain("createHash");
    expect(soucis[0]).toContain("randomBytes");
  });

  it("ne confond pas un autre objet portant le même nom de méthode", () => {
    expect(manquements(["a.js"], () => "monModule.createHash(1);", METHODES)).toEqual([]);
  });
});

describe("le dépôt tel qu'il est", () => {
  it("⚠️ aucun fichier sous Node n'appelle sur le global une méthode qui n'existe que sur le module", () => {
    const fichiers = ["server/routes-agent.js", "server/handler.js", "server/presentations.js",
      "server/shares.js", "server/routes-direct.js", "context/standalone.js"];
    expect(manquements(fichiers, (f) => readFileSync(f, "utf8"), METHODES)).toEqual([]);
  });
});


// ⚠️ LE TÉMOIN DE LA FORME, DISTINCT DE CELUI QUI EXISTAIT DÉJÀ.
//
// `methodesDuModuleSeul()` refuse quand plus aucune méthode ne sépare le module du global : il
// prouve que LA QUESTION a encore un sens sur ce Node. Celui-ci prouve que LA SONDE sait encore
// lire la réponse. Deux cécités différentes — les confondre laisserait la seconde ouverte.
describe("le témoin de la forme : la sonde reconnaît-elle encore un appel ?", () => {
  const lire = (f) => ({
    "avec.js": 'const crypto = require("crypto");\ncrypto.createHash("sha256");\n',
    "sans.js": "const x = 1;\n",
  })[f];

  it("compte les fichiers qui portent la forme", () => {
    expect(temoinsDeForme(["avec.js", "sans.js"], lire, ["createHash"])).toBe(1);
  });

  it("n'en compte aucun quand la forme est absente", () => {
    expect(temoinsDeForme(["sans.js"], lire, ["createHash"])).toBe(0);
  });

  // ⚠️ UNE MÉTHODE QUE LA SONDE NE CHERCHE PAS NE FAIT PAS TÉMOIN. Sinon le témoin serait vrai pour
  // n'importe quelle liste de méthodes, y compris une liste vide de sens.
  it("⚠️ ne témoigne que des méthodes effectivement cherchées", () => {
    expect(temoinsDeForme(["avec.js"], lire, ["randomUUID"])).toBe(0);
  });
});

// ⚠️ LE PÉRIMÈTRE ÉCARTE LES BANCS, et personne ne l'éprouvait. Mesuré le 01/09 en aveuglant
// l'exclusion : 31 fichiers deviennent 168, 5 appelants deviennent 21 — la garde reste verte, mais
// elle relit alors du code de test dont les cas FABRIQUENT exprès des appels fautifs.
describe("⚠️ le périmètre écarte les bancs, et il le dit", () => {
  it("un chemin de banc n'est pas sous le périmètre, un chemin de runtime l'est", () => {
    expect(["server/handler.js", "context/standalone.js", "bin/serve.js"].map(auPerimetre))
      .toEqual([true, true, true]);
    expect(auPerimetre("tools/x.mjs"), "les outils ne sont pas du runtime d'hôte").toBe(false);
    expect(auPerimetre("docs/API.md")).toBe(false);
  });

  it("⚠️ et un banc est écarté — ses cas fabriquent exprès les appels que cette garde cherche", () => {
    expect(auPerimetre("server/__tests__/x.test.js")).toBe(false);
    expect(auPerimetre("context/__tests__/y.js")).toBe(false);
  });
});

// ⚠️ LE DÉPOUILLAGE DES APOSTROPHES N'ÉTAIT VU PAR PERSONNE — mesuré le 01/09. Les trois formes de
// chaîne sont retirées avant de chercher les APPELS, parce que les gabarits portent du code
// NAVIGATEUR dans des littéraux et que `crypto` y est le global, légitimement. Deux des trois
// formes étaient éprouvées ; l'apostrophe ne l'était pas, et rien ne l'aurait dit.
describe("⚠️ les TROIS formes de chaîne sont dépouillées, pas deux", () => {
  const METHODES = ["createHash", "randomUUID", "createHmac"];
  // ⚠️ L'APPEL N'EST PAS COLLÉ AU GUILLEMET, et ce n'est pas un détail de mise en forme.
  // `appelsDuModule` exige que le caractère précédant `crypto` ne soit ni un point, ni un mot, ni un
  // guillemet — un `crypto.` collé à l'ouvrant n'est DÉJÀ pas relevé, dépouillage ou pas. Le témoin
  // serait alors vert des deux côtés et ne prouverait rien. Un gabarit réel porte de toute façon une
  // ligne de code, pas un appel nu. L'appel n'emploie pas de guillemets pour que la forme à
  // apostrophes ne soit pas coupée en deux par les siens.
  const appelDans = (ouvre, ferme) => `const gabarit = ${ouvre}let h = crypto.createHash(algo);${ferme};\n`;

  it.each([
    ["accents graves", "`", "`"],
    ["guillemets", '"', '"'],
    ["apostrophes", "'", "'"],
  ])("un appel écrit dans une chaîne à %s n'est pas pris pour un appel réel", (_quoi, ouvre, ferme) => {
    const code = appelDans(ouvre, ferme);
    expect(appelsDuModule(code, METHODES), "sans dépouillage, cet appel serait relevé").not.toEqual([]);
    expect(appelsDuModule(sansChaines(code), METHODES), "dépouillé, il disparaît").toEqual([]);
  });

  it("⚠️ et un appel RÉEL, hors de toute chaîne, survit au dépouillage", () => {
    const code = 'const h = crypto.createHash("sha256");\n';
    expect(appelsDuModule(sansChaines(code), METHODES)).toEqual(["createHash"]);
  });

  it("le dépouillage ne détruit pas la LIAISON, qui est elle-même une chaîne", () => {
    // `lieCrypto` lit le code AVEC ses chaînes, justement pour ça — le rappeler ici garde les deux
    // décisions côte à côte plutôt qu'à quarante lignes d'écart.
    const code = 'const crypto = require("crypto");\nconst h = crypto.createHash("sha256");\n';
    expect(lieCrypto(code), "la liaison se lit sur le code brut").toBe(true);
    expect(appelsDuModule(sansChaines(code), METHODES)).toEqual(["createHash"]);
  });
});
