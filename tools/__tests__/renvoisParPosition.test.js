// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN RENVOI PAR NUMÉRO DE LIGNE EST UN NOMBRE AU PRÉSENT — IL ROUILLE À LA PREMIÈRE ÉDITION.
//
// ⚠️ LE FAIT (28/08). `AGENTS.md` porte une section « A number in the present tense rots ». Deux
// cents lignes plus haut, il renvoyait DEUX FOIS à `docs/HOST-CONTRACT.md` par numéro de ligne, et
// les deux étaient faux dès le commit suivant qui a touché la page visée :
//
//     « line 243 of docs/HOST-CONTRACT.md was a table row swallowed… »  → y trouvait « |---|---| »
//     « …while line 268 explains the fifth at length »                  → un autre sujet
//
// Relevé par un hôte qui vérifiait nos renvois, et qui a nommé le vrai coût : « un lecteur qui ouvre
// 84 en cherchant les deux instruments lit le décompte, ne trouve pas ce qu'il cherche, et peut
// conclure à une ABSENCE ». Le renvoi périmé ne rend pas une erreur — il rend un autre contenu,
// plausible, et fabrique un constat de manque.

import { describe, it, expect } from "vitest";

import { estUnGuide, renvois, verifier } from "../renvois-par-position.mjs";
import { CONFORME, VIOLATION, INCONCLUSIF } from "../resultat-garde.mjs";

// ⚠️ LE TEXTE HISTORIQUE LUI-MÊME, PAS LE MOYEN D'ALLER LE CHERCHER. La première écriture de ce banc
// lisait l'ancien fichier avec `git show 3ebb504:AGENTS.md`. Vert ici, ROUGE en forge :
// `fatal: invalid object name '3ebb504'` — le `checkout` de la CI est SUPERFICIEL, l'historique n'y
// est pas. Un contrôle positif qui ne tient que sur le poste de son auteur ne contrôle rien là où
// ça compte, et ce dépôt refuse un banc qui s'esquive dans la forge.
//
// Les deux lignes ci-dessous sont donc recopiées AU CARACTÈRE PRÈS depuis `AGENTS.md` tel qu'il
// était au commit 3ebb504 (lignes 521 et 578), avant la correction. Elles ne sont pas un exemple
// inventé : ce sont les deux défauts réels, et c'est ce qui rend ce banc probant.
const AVANT_CORRECTION = [
  "what the reader *knows about the domain*. Meanwhile line 243 of `docs/HOST-CONTRACT.md` was a",
  'values, the code returns five"* — while line 268 explains the fifth at length. Fifth occurrence in',
].join("\n");

describe("reconnaître un renvoi par position", () => {
  it("un renvoi qui nomme le fichier", () => {
    expect(renvois("Meanwhile line 243 of `docs/HOST-CONTRACT.md` was a table row"))
      .toEqual([{ ligne: 1, extrait: "line 243" }]);
  });

  // ⚠️ LE CAS QUE LA PREMIÈRE ÉCRITURE LAISSAIT PASSER, ET C'EST LE PIRE DES DEUX : sans nom de
  // fichier, le lecteur ne sait même pas quelle page ouvrir. Le motif exigeait un fichier ; il
  // voyait 1 des 2 renvois réels d'AGENTS.md.
  it("⚠️ un renvoi NU, sans fichier nommé, est attrapé lui aussi", () => {
    expect(renvois("…while line 268 explains the fifth at length"))
      .toEqual([{ ligne: 1, extrait: "line 268" }]);
  });

  it("le français comme l'anglais, singulier comme pluriel", () => {
    expect(renvois("voir ligne 62 et lignes 410 plus bas").map((r) => r.extrait))
      .toEqual(["ligne 62", "lignes 410"]);
  });

  it("il rend le numéro de ligne du renvoi lui-même, pour qu'on le trouve", () => {
    expect(renvois("a\nb\nvoir ligne 9")).toEqual([{ ligne: 3, extrait: "ligne 9" }]);
  });

  // Une ligne sans chiffre est de la prose ordinaire : l'accuser inventerait un coupable.
  it("« une ligne de code », « the line above » ne sont pas des renvois", () => {
    expect(renvois("une ligne de code, the line above, en ligne")).toEqual([]);
  });
});

describe("la portée, qui est ce qui empêche la garde d'accuser sa propre prose", () => {
  it("les documents de navigation sont couverts", () => {
    for (const f of ["AGENTS.md", "README.md", "docs/HOST-CONTRACT.md", "docs/RELEASING.md"]) {
      expect(estUnGuide(f), f).toBe(true);
    }
  });

  // ⚠️ LE CHANGELOG EST EXCLU COMME CLASSE, PAS COMME EXCEPTION. Ses sections sont datées et figées :
  // « l'index unique (ligne 62) tournait avant l'ALTER (ligne 410) » décrit `init.sql` tel qu'il
  // était en 0.1.64, au passé, et personne n'y va pour s'orienter.
  it("⚠️ le CHANGELOG est hors de portée : un récit daté n'oriente personne", () => {
    expect(estUnGuide("CHANGELOG.md")).toBe(false);
  });
});

describe("la garde sur le dépôt", () => {
  it("le dépôt réel est conforme, et la sonde a bien lu des documents", () => {
    const r = verifier();
    expect(r.code).toBe(CONFORME);
    expect(r.resume).toMatch(/document\(s\) de navigation relus/);
  });

  // ⚠️ LE CONTRÔLE POSITIF SUR LE TEXTE RÉEL. Sans lui, « zéro renvoi » sur le dépôt d'aujourd'hui
  // serait indiscernable d'une sonde qui ne sait rien voir. Les deux lignes sont celles d'avant la
  // correction, recopiées au caractère près — voir l'en-tête de ce fichier pour ce qui a rendu la
  // première écriture rouge en forge et verte ici.
  it("⚠️ sur le texte d'avant correction, elle voit les DEUX renvois périmés", () => {
    const vus = renvois(AVANT_CORRECTION);
    expect(vus.map((v) => v.extrait), "les deux défauts réels du 28/08").toEqual(["line 243", "line 268"]);
  });

  // ⚠️ ET LE BANC NE DÉPEND DE RIEN D'AUTRE QUE DU DÉPÔT SUR DISQUE. C'est la propriété qui manquait
  // à sa première écriture : elle exigeait l'historique git, absent d'un `checkout` superficiel.
  // ⚠️ LES NOMS INTERDITS SONT CONSTRUITS, PAS ÉCRITS — sinon ce banc s'accuse lui-même, et c'est
  // arrivé à sa première écriture : le motif contenait le mot qu'il cherchait, donc il échouait
  // toujours. Même remède que `idiomeUneSeuleOrthographe` : le fichier n'en contient aucun en clair.
  it("⚠️ aucune dépendance à l'historique git : le banc tient dans un clone superficiel", async () => {
    const interdits = [["child", "_process"], ["exec", "FileSync"], ["exec", "Sync"]].map((p) => p.join(""));
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync(new URL("./renvoisParPosition.test.js", import.meta.url), "utf8"));
    const code = source.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
    for (const nom of interdits) {
      expect(code.includes(nom), `un banc qui appelle « ${nom} » s'esquive là où la forge est superficielle`)
        .toBe(false);
    }
  });

  it("un document de navigation fautif la fait rougir, en nommant l'extrait", () => {
    const r = verifier(".", () => "voir line 243 of `docs/X.md`", () => ["AGENTS.md"], () => ({ isDirectory: () => false }));
    expect(r.code).toBe(VIOLATION);
    expect(r.constats[0]).toMatch(/line 243/);
    expect(r.constats[0]).toMatch(/Désignez par l'objet/);
  });

  // ⚠️ LE PLANCHER. Zéro document relevé et la garde dirait « aucun renvoi fautif » sur un dépôt
  // dont elle n'a rien lu.
  it("⚠️ aucun document de navigation : elle refuse au lieu de conclure au vert", () => {
    const r = verifier(".", () => "", () => ["CHANGELOG.md"], () => ({ isDirectory: () => false }));
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/vise à côté/);
  });

  it("un dossier illisible rend NON CONCLUANT, jamais VIOLATION", () => {
    const r = verifier(".", () => "", () => { throw new Error("illisible"); }, () => ({ isDirectory: () => false }));
    expect(r.code).toBe(INCONCLUSIF);
  });
});
