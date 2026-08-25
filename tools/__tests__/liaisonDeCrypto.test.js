// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE DÉFAUT DU 25/08 REJOUÉ, ET LES TROIS AVEUGLEMENTS DE LA SONDE QUI LE CHERCHE.
//
// La garde a été écrite trois fois à l'expression régulière avant de passer à un vrai analyseur.
// Chacun de ces trois échecs est éprouvé ici : ce sont eux qui expliquent pourquoi elle lit
// désormais le code avec `esbuild` plutôt qu'avec un motif.

import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import {
  methodesDuModuleSeul, sansCommentaires, sansChaines, lieCrypto, appelsDuModule, manquements,
} from "../liaison-de-crypto.mjs";

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
