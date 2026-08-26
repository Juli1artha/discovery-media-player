// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QU'UN EXPLOITANT COPIE DOIT CONTENIR CE QU'ON LUI DOCUMENTE.
//
// ⚠️ `PLAYER_AUTH_URL` a vécu une demi-journée dans ce trou, le jour même de sa sortie : la doc
// l'annonçait, `.env.example` l'ignorait. Un exploitant ne découvre ce genre d'absence qu'en
// cherchant pourquoi quelque chose ne marche pas.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { ecarts, citesDans, posesDans, DOC, EXEMPLE } from "../env-exemple.mjs";
import { inventaire } from "../env-lues.mjs";

const S = (...n) => new Set(n);

describe("relever les candidats et les variables posées", () => {
  it("un jeton majuscule entre accents graves est un CANDIDAT", () => {
    expect([...citesDans("règle `PLAYER_X` et `SIGTERM`")]).toEqual(["PLAYER_X", "SIGTERM"]);
  });

  it("une affectation dans le fichier d'exemple est une variable posée", () => {
    expect([...posesDans("# note\nPLAYER_X=\nPLAYER_Y=3\n")]).toEqual(["PLAYER_X", "PLAYER_Y"]);
  });
});

describe("les deux désaccords que la garde existe pour voir", () => {
  it("⚠️ documentée mais absente de l'exemple — le trou `PLAYER_AUTH_URL`", () => {
    const { soucis } = ecarts({ cites: S("PLAYER_X"), poses: S(), lues: S("PLAYER_X") });
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain(EXEMPLE);
    expect(soucis[0], "le message doit dire ce que ça coûte à l'exploitant").toContain("ne la découvrira qu'en cherchant");
  });

  it("posée dans l'exemple mais nulle part documentée", () => {
    const { soucis } = ecarts({ cites: S(), poses: S("PLAYER_X"), lues: S("PLAYER_X") });
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain(DOC);
  });

  it("se tait quand les deux s'accordent", () => {
    expect(ecarts({ cites: S("PLAYER_X"), poses: S("PLAYER_X"), lues: S("PLAYER_X") }).soucis).toEqual([]);
  });
});

describe("la prose n'est pas de la donnée", () => {
  // ⚠️ LE DÉFAUT RÉEL. La version en shell de cette règle relevait tout jeton majuscule entre
  // accents graves. Le jour où la page a mentionné `SIGTERM`, `SIGINT` et `SIGKILL` — des noms de
  // signaux, dans une phrase — elle les a exigés dans `.env.example`. Un contrôle qui demande de
  // tordre la prose pour lui plaire apprend à ses lecteurs à écrire pour la machine.
  const prose = { cites: S("PLAYER_X", "SIGTERM", "SIGKILL"), poses: S("PLAYER_X"), lues: S("PLAYER_X") };

  it("⚠️ un mot que ni le code ne lit ni l'exemple ne porte n'est pas une variable", () => {
    expect(ecarts(prose).soucis).toEqual([]);
  });

  it("⚠️ mais il est COMPTÉ et NOMMÉ — une garde qui tait ce qu'elle écarte ment sur sa couverture", () => {
    expect(ecarts(prose).ecartes.sort()).toEqual(["SIGKILL", "SIGTERM"]);
  });

  it("⚠️ et l'écart ne sert PAS d'échappatoire : une variable que le code LIT est retenue", () => {
    // Sinon il suffirait d'oublier une variable dans les deux fichiers pour la faire disparaître
    // du contrôle — l'exception avalerait la règle.
    const { soucis, ecartes } = ecarts({ cites: S("PLAYER_Y"), poses: S(), lues: S("PLAYER_Y") });
    expect(ecartes).toEqual([]);
    expect(soucis).toHaveLength(1);
  });
});

describe("les fichiers réels du dépôt", () => {
  const cites = citesDans(readFileSync(DOC, "utf8"));
  const poses = posesDans(readFileSync(EXEMPLE, "utf8"));

  it("les deux sources sont peuplées — sinon la confrontation serait vide et toujours verte", () => {
    expect(cites.size).toBeGreaterThan(30);
    expect(poses.size).toBeGreaterThan(30);
  });

  it("⚠️ la page ne DÉCLARE que deux variables par un titre — lire les titres seuls viderait la garde", () => {
    // Le remède évident, mesuré puis écarté : trente-neuf variables sont documentées ailleurs
    // (tableaux, mentions en ligne). C'est le motif trop serré, celui qui rend vert sur du vide.
    const parTitre = [...readFileSync(DOC, "utf8").matchAll(/^### `([A-Z][A-Z0-9_]+)`/gm)];
    expect(parTitre.length).toBeLessThan(cites.size / 5);
  });

  it("⚠️ le dépôt est d'accord avec lui-même", () => {
    // ⚠️ ON DEMANDE LE VRAI INVENTAIRE, PAS UN FABRIQUÉ. La première rédaction de ce banc passait
    // `lues: [...cites, ...poses]` — ce qui faisait de CHAQUE jeton cité une variable lue, `SIGTERM`
    // compris, et rendait rouge sur un dépôt sain. Un banc qui invente son entrée n'éprouve que
    // lui-même.
    const { soucis, ecartes } = ecarts({ cites, poses, lues: inventaire().lues });
    expect(soucis, soucis.join("\n")).toEqual([]);
    expect(ecartes, "et les seuls écartés sont les noms de signaux de la prose").toEqual(["SIGINT", "SIGKILL", "SIGTERM"]);
  });
});
