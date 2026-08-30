// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA VERSION QUE LA FORGE INSTALLE CONTRE CELLE QU'ON AUTORISE — ÉPROUVÉ SUR LE JOUR QUI VIENDRA.
//
// ⚠️ CETTE GARDE EST VERTE AUJOURD'HUI ET LE RESTERA LONGTEMPS, ce qui est exactement l'état où un
// banc devient une décoration. La règle qu'elle porte n'est PAS satisfaite par le dépôt du jour :
// elle le sera jusqu'au commit qui relèvera `engines` au-delà de 22. Un banc qui se contenterait
// de constater le vert d'aujourd'hui prouverait que la CI passe, jamais que la garde voit.
//
// On l'éprouve donc sur le futur : `engines` monté à `>=24`, face aux `node-version: "22"` RÉELS
// du dépôt. C'est le scénario nommé dans l'en-tête de `plancher-de-node` le 25/08, cinq jours
// avant que cette garde existe — et le seul qui dise si elle sert à quelque chose.
//
// ⚠️ ET SUR LE VRAI DOSSIER, PAS SEULEMENT SUR DES FIXTURES. Un banc qui ne lit que ses propres
// chaînes prouve que la fonction sait comparer, jamais que `.github/workflows` est conforme.

import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import {
  versionsDe,
  versionsDuDepot,
  verdict,
  estUnPlancherSansPlafond,
  PLANCHER_DECLARATIONS,
  PLANCHER_FICHIERS,
} from "../node-des-workflows.mjs";
import { CONFORME, VIOLATION, INCONCLUSIF } from "../resultat-garde.mjs";

const ENGINES = JSON.parse(readFileSync("package.json", "utf8")).engines?.node;

/** Ce que le dossier de workflows dit réellement — relu une fois, partagé par les blocs. */
const reel = versionsDuDepot();

/** Un relevé fabriqué, pour éprouver le verdict sans écrire de fichier. */
const decl = (portee, fichier = "a.yml") => ({ fichier, ligne: 1, job: "j", portee, via: null });

/** Assez de déclarations et de fichiers pour passer les deux planchers. */
const assezDe = (portee) =>
  Array.from({ length: Math.max(PLANCHER_DECLARATIONS, PLANCHER_FICHIERS) }, (_, i) =>
    decl(portee, `w${i}.yml`));

describe("ce que la sonde lit dans un workflow", () => {
  it("lit un `node-version` littéral, et nomme le job et la ligne", () => {
    const { declarations, illisibles } = versionsDe(
      'jobs:\n  bancs:\n    steps:\n      - with:\n          node-version: "24"\n', "f.yml");
    expect(illisibles).toEqual([]);
    expect(declarations).toEqual([{ fichier: "f.yml", ligne: 5, job: "bancs", portee: "24", via: null }]);
  });

  // ⚠️ LES TROIS FORMES QUI ONT AVEUGLÉ LES LEXEURS PRÉCÉDENTS DE CE DÉPÔT. Elles sont ici parce
  // qu'elles ont coûté trois lecteurs écrits à la main (`env-lues`, `actions-epinglees`, deux
  // fois). Cette garde lit par la bibliothèque `yaml`, donc elle les tient — et ce banc est ce qui
  // empêchera quelqu'un de la « simplifier » en expression régulière un jour de fatigue.
  it("⚠️ tient la clé citée et le mapping en flow, qui ont aveuglé trois lecteurs écrits à la main", () => {
    const { declarations } = versionsDe(
      'jobs:\n  a:\n    steps:\n      - { "with": { "node-version": "24" } }\n', "f.yml");
    expect(declarations.map((d) => d.portee)).toEqual(["24"]);
  });

  it("résout `${{ matrix.node }}` en chaque entrée de la matrice du job", () => {
    const { declarations } = versionsDe(
      'jobs:\n  a:\n    strategy:\n      matrix:\n        node: ["22", "24"]\n'
      + "    steps:\n      - with:\n          node-version: ${{ matrix.node }}\n", "f.yml");
    expect(declarations.map((d) => d.portee)).toEqual(["22", "24"]);
    expect(declarations.every((d) => d.via === "matrix.node")).toBe(true);
  });

  // ⚠️ UNE VERSION AJOUTÉE PAR `include` S'EXÉCUTE COMME LES AUTRES. Ne lire que la liste
  // principale ferait une garde exhaustive dans un périmètre qu'elle ne dirait pas — la classe
  // exacte que ce dépôt a payée deux fois en une journée.
  it("⚠️ lit aussi les versions ajoutées par `include`, qui tournent pour de vrai", () => {
    const { declarations } = versionsDe(
      'jobs:\n  a:\n    strategy:\n      matrix:\n        node: ["24"]\n'
      + '        include:\n          - node: "18"\n'
      + "    steps:\n      - with:\n          node-version: ${{ matrix.node }}\n", "f.yml");
    expect(declarations.map((d) => d.portee).sort()).toEqual(["18", "24"]);
  });
});

describe("ce que la sonde REFUSE de lire, plutôt que de le sauter", () => {
  const refuse = (yaml, motif) => {
    const { declarations, illisibles } = versionsDe(yaml, "f.yml");
    expect(declarations, "une version non résolue ne doit pas entrer dans le relevé").toEqual([]);
    expect(illisibles.join("\n")).toMatch(motif);
  };

  // ⚠️ LA VERSION EXISTE, ELLE EST JUSTE ÉCRITE AILLEURS. Sauter cette forme rendrait la version
  // invisible à la garde et bien vivante dans la forge : la garde rétrécirait sans laisser de
  // trace, ce qui est le mécanisme même qu'elle surveille.
  it("⚠️ `node-version-file` : la garde le DIT au lieu de rétrécir en silence", () => {
    refuse('jobs:\n  a:\n    steps:\n      - with:\n          node-version-file: ".nvmrc"\n',
      /node-version-file.*que cette garde ne suit pas/);
  });

  it("une expression `${{ matrix.X }}` sans X dans la matrice du job", () => {
    refuse("jobs:\n  a:\n    steps:\n      - with:\n          node-version: ${{ matrix.absente }}\n",
      /matrix\.absente, que la matrice de ce job ne déclare pas/);
  });

  it("une expression qui n'est pas une lecture de matrice", () => {
    refuse("jobs:\n  a:\n    steps:\n      - with:\n          node-version: ${{ env.NODE }}\n",
      /ne sait pas résoudre/);
  });

  it("un YAML illisible lève — on ne devine pas un document cassé", () => {
    expect(() => versionsDe("jobs:\n  a:\n   - : :\n", "f.yml")).toThrow(/YAML illisible/);
  });
});

describe("le verdict", () => {
  it("accepte `22` sous un plancher `>=22.13.0` — setup-node installe la plus haute 22.x", () => {
    // ⚠️ LE FAUX POSITIF QU'IL FALLAIT NE PAS ÉCRIRE. `subset("22", ">=22.13.0")` est FAUX, et une
    // garde bâtie dessus refuserait la CI d'aujourd'hui, qui est saine. Une garde qui crie faux
    // finit desserrée par celui qu'elle a dérangé pour rien.
    expect(verdict({ engines: ">=22.13.0", declarations: assezDe("22"), illisibles: [] }).code)
      .toBe(CONFORME);
  });

  // ⚠️ LE CAS POUR LEQUEL CETTE GARDE EXISTE, et le seul qui prouve qu'elle sert.
  it("⚠️ refuse `22` le jour où le plancher passe à `>=24` — le scénario annoncé le 25/08", () => {
    const r = verdict({ engines: ">=24", declarations: assezDe("22"), illisibles: [] });
    expect(r.code).toBe(VIOLATION);
    expect(r.constats[0]).toMatch(/la forge installera node 22, qu'engines\.node « >=24 » n'admet pas/);
  });

  it("refuse un majeur sous le plancher, d'où qu'il vienne", () => {
    expect(verdict({ engines: ">=22.13.0", declarations: assezDe("18"), illisibles: [] }).code)
      .toBe(VIOLATION);
  });

  // ⚠️ LA CONDITION DU RAISONNEMENT, VÉRIFIÉE PLUTÔT QUE SUPPOSÉE. Sous un `engines` borné en
  // haut, « la portée rencontre engines » n'implique plus « la version installée satisfait
  // engines » : la garde serait verte sur une violation réelle. Elle refuse donc de conclure — une
  // garde qui applique son raisonnement hors de ses conditions est l'objet de sa propre doctrine.
  it("⚠️ refuse de CONCLURE sous un `engines` borné en haut, au lieu de rendre un vert sans valeur", () => {
    const r = verdict({ engines: ">=22.13.0 <23", declarations: assezDe("22"), illisibles: [] });
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/porte un PLAFOND/);
  });

  it("estUnPlancherSansPlafond sépare les deux régimes", () => {
    expect(estUnPlancherSansPlafond(">=22.13.0")).toBe(true);
    expect(estUnPlancherSansPlafond(">=22.13.0 <23")).toBe(false);
    expect(estUnPlancherSansPlafond("^22")).toBe(false);
  });

  // ⚠️ `lts/*`, `latest`, `node` : setup-node les accepte, semver non. Les sauter rendrait la
  // garde verte pour n'avoir pas regardé — la vacuité qu'elle existe pour interdire.
  it("⚠️ refuse une portée que semver ne sait pas lire, au lieu de la sauter", () => {
    const r = verdict({ engines: ">=22.13.0", declarations: [...assezDe("24"), decl("lts/*", "z.yml")], illisibles: [] });
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/n'est pas une portée que semver sait lire/);
  });

  it("un illisible remonté par la sonde rend la garde non concluante", () => {
    expect(verdict({ engines: ">=22.13.0", declarations: assezDe("24"), illisibles: ["f.yml:1 : bidule"] }).code)
      .toBe(INCONCLUSIF);
  });

  it("refuse un `engines` absent ou que semver ne lit pas", () => {
    expect(verdict({ engines: undefined, declarations: assezDe("24"), illisibles: [] }).code).toBe(INCONCLUSIF);
    expect(verdict({ engines: "récent", declarations: assezDe("24"), illisibles: [] }).code).toBe(INCONCLUSIF);
  });
});

// ⚠️ LES DEUX PLANCHERS, ET LA RAISON D'EN AVOIR DEUX. Un balayage qui perd la moitié du dossier
// rendrait encore « aucune violation » avec un plancher unique sur le nombre de déclarations.
describe("les planchers anti-vacuité", () => {
  // ⚠️ CE BANC A SURVÉCU À SA PREMIÈRE MUTATION, ET C'EST POURQUOI IL EST ÉCRIT AINSI. Il passait
  // d'abord `[decl("24")]` — UNE déclaration dans UN fichier — en attendant `/plancher/`. Les deux
  // planchers refusaient ce relevé, et le message des deux contient le mot : retirer le plancher
  // des DÉCLARATIONS laissait le banc vert, l'autre plancher répondant à sa place. Un banc vert
  // pour une raison autre que celle qu'il nomme est exactement la classe qu'on traque ici.
  //
  // Il faut donc un relevé qui passe le plancher des FICHIERS et échoue sur celui des
  // DÉCLARATIONS : assez de fichiers, une seule déclaration dans chacun.
  it("⚠️ refuse un relevé trop maigre, et sur SON plancher — pas sur celui du voisin", () => {
    const maigre = Array.from({ length: PLANCHER_FICHIERS }, (_, i) => decl("24", `w${i}.yml`));
    expect(maigre.length, "l'éprouvette doit passer le plancher des fichiers pour isoler l'autre")
      .toBeLessThan(PLANCHER_DECLARATIONS);
    const r = verdict({ engines: ">=22.13.0", declarations: maigre, illisibles: [] });
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/déclaration\(s\) de « node-version » \(plancher/);
  });

  it("⚠️ refuse un relevé qui garde le COMPTE mais perd les FICHIERS", () => {
    // Le compte passe (un seul fichier, beaucoup de déclarations) : c'est exactement l'angle mort
    // qu'un plancher unique laisserait ouvert.
    const nombreux = Array.from({ length: PLANCHER_DECLARATIONS + 4 }, () => decl("24", "seul.yml"));
    const r = verdict({ engines: ">=22.13.0", declarations: nombreux, illisibles: [] });
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/fichier\(s\) \(plancher/);
  });
});

// ⚠️ LE VRAI DOSSIER. Sans ce bloc, tout ce qui précède prouve que la fonction sait comparer des
// chaînes, et rien du dépôt.
describe("le dossier .github/workflows tel qu'il est", () => {
  it("la sonde voit des déclarations, dans plusieurs fichiers", () => {
    expect(reel.illisibles, "une version du dépôt n'est pas confrontée à engines").toEqual([]);
    expect(reel.declarations.length).toBeGreaterThanOrEqual(PLANCHER_DECLARATIONS);
    expect(new Set(reel.declarations.map((d) => d.fichier)).size).toBeGreaterThanOrEqual(PLANCHER_FICHIERS);
  });

  it("toutes les versions que la forge installe sont admises par engines", () => {
    const r = verdict({ engines: ENGINES, ...reel });
    expect(r.constats || r.raisons || [], r.resume).toEqual([]);
    expect(r.code).toBe(CONFORME);
  });

  // ⚠️ LA MUTATION, SUR LE VRAI DOSSIER. C'est la seule preuve qui vaille : la garde AURAIT
  // attrapé le défaut le jour où il arrivera, sur les fichiers qui existent, pas sur les miens.
  it("⚠️ et elles rougiraient toutes le jour où `engines` passerait à `>=24`", () => {
    const r = verdict({ engines: ">=24", ...reel });
    expect(r.code).toBe(VIOLATION);
    const touches = new Set(r.constats.map((c) => c.split(":")[0]));
    expect(touches.size, "la mutation ne réveille qu'un fichier : le balayage ne couvre pas le dossier")
      .toBeGreaterThan(1);
  });
});
