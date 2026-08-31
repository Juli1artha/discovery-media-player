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
  PLANCHER_INSTALLATIONS,
} from "../node-des-workflows.mjs";
import { CONFORME, VIOLATION, INCONCLUSIF } from "../resultat-garde.mjs";
import { outilsLances } from "../outils-servis.mjs";
import { workflows } from "../workflows-yaml.mjs";

const ENGINES = JSON.parse(readFileSync("package.json", "utf8")).engines?.node;

/** Ce que le dossier de workflows dit réellement — relu une fois, partagé par les blocs. */
const reel = versionsDuDepot();

/** Un relevé fabriqué, pour éprouver le verdict sans écrire de fichier. */
const decl = (portee, fichier = "a.yml") => ({ fichier, ligne: 1, job: "j", portee, via: null });

/**
 * ⚠️ LE VERDICT A PLUSIEURS SONDES, ET CHACUNE PORTE SON PLANCHER. Un relevé fabriqué qui ne parle
 * que de déclarations serait refusé sur le plancher des INSTALLATIONS avant d'atteindre la règle
 * qu'il veut éprouver — et le banc rougirait pour une raison qui n'est pas la sienne, ce que ce
 * fichier a déjà payé une fois. Chaque éprouvette fournit donc un relevé COMPLET ; les bancs qui
 * visent le plancher des installations, eux, le donnent explicitement.
 */
const VU = { installations: Array.from({ length: PLANCHER_INSTALLATIONS }, (_, i) => ({ fichier: `w${i}.yml`, ligne: 1, job: "j" })), sansVersion: [] };

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
    expect(verdict({ engines: ">=22.13.0", declarations: assezDe("22"), illisibles: [], ...VU }).code)
      .toBe(CONFORME);
  });

  // ⚠️ LE CAS POUR LEQUEL CETTE GARDE EXISTE, et le seul qui prouve qu'elle sert.
  it("⚠️ refuse `22` le jour où le plancher passe à `>=24` — le scénario annoncé le 25/08", () => {
    const r = verdict({ engines: ">=24", declarations: assezDe("22"), illisibles: [], ...VU });
    expect(r.code).toBe(VIOLATION);
    expect(r.constats[0]).toMatch(/la forge installera node 22, qu'engines\.node « >=24 » n'admet pas/);
  });

  it("refuse un majeur sous le plancher, d'où qu'il vienne", () => {
    expect(verdict({ engines: ">=22.13.0", declarations: assezDe("18"), illisibles: [], ...VU }).code)
      .toBe(VIOLATION);
  });

  // ⚠️ LA CONDITION DU RAISONNEMENT, VÉRIFIÉE PLUTÔT QUE SUPPOSÉE. Sous un `engines` borné en
  // haut, « la portée rencontre engines » n'implique plus « la version installée satisfait
  // engines » : la garde serait verte sur une violation réelle. Elle refuse donc de conclure — une
  // garde qui applique son raisonnement hors de ses conditions est l'objet de sa propre doctrine.
  it("⚠️ refuse de CONCLURE sous un `engines` borné en haut, au lieu de rendre un vert sans valeur", () => {
    const r = verdict({ engines: ">=22.13.0 <23", declarations: assezDe("22"), illisibles: [], ...VU });
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
    const r = verdict({ engines: ">=22.13.0", declarations: [...assezDe("24"), decl("lts/*", "z.yml")], illisibles: [], ...VU });
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/n'est pas une portée que semver sait lire/);
  });

  it("un illisible remonté par la sonde rend la garde non concluante", () => {
    expect(verdict({ engines: ">=22.13.0", declarations: assezDe("24"), illisibles: ["f.yml:1 : bidule"], ...VU }).code)
      .toBe(INCONCLUSIF);
  });

  it("refuse un `engines` absent ou que semver ne lit pas", () => {
    expect(verdict({ engines: undefined, declarations: assezDe("24"), illisibles: [], ...VU }).code).toBe(INCONCLUSIF);
    expect(verdict({ engines: "récent", declarations: assezDe("24"), illisibles: [], ...VU }).code).toBe(INCONCLUSIF);
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
    const r = verdict({ engines: ">=22.13.0", declarations: maigre, illisibles: [], ...VU });
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/déclaration\(s\) de « node-version » \(plancher/);
  });

  it("⚠️ refuse un relevé qui garde le COMPTE mais perd les FICHIERS", () => {
    // Le compte passe (un seul fichier, beaucoup de déclarations) : c'est exactement l'angle mort
    // qu'un plancher unique laisserait ouvert.
    const nombreux = Array.from({ length: PLANCHER_DECLARATIONS + 4 }, () => decl("24", "seul.yml"));
    const r = verdict({ engines: ">=22.13.0", declarations: nombreux, illisibles: [], ...VU });
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


// ⚠️ LES DEUX SENS DE LA MUTATION — ET LE SECOND VIENT D'UNE SESSION VOISINE.
//
// Le bloc ci-dessus mute `engines` et regarde le vrai dossier rougir. C'est UN sens, et il ne prouve
// qu'une moitié : que la comparaison mord. La session STUDIO, en retirant une exception de sa propre
// garde le 31/08, a nommé ce qui manque à cette moitié :
//
//     « Sans cette seconde mutation, j'aurais eu une suite verte parfaitement compatible avec
//       "j'ai supprimé un test gênant". »
//
// Sa paire mutait le SUJET dans les deux directions, et faisait rougir DEUX bancs différents. C'est
// ce qui interdit à un vert d'être atteint par accident : il n'existe aucun état où tout est vert
// parce que deux mécanismes se sont annulés.
//
// ⚠️ CE QUI MANQUAIT ICI EST PLUS PRÉCIS QUE « UN SENS SUR DEUX ». Toutes les violations éprouvées
// plus haut passent des déclarations FABRIQUÉES (`decl`, `assezDe`) directement au verdict :
// l'analyseur n'est jamais dans le chemin du rouge. Il n'est exercé que du côté CONFORME. Si
// `versionsDe` perdait une déclaration sur une forme YAML particulière, la mutation d'`engines` ne
// le verrait pas — les onze restantes rougiraient et le banc serait content.
//
// Le sens qui manque part donc du TEXTE d'un vrai workflow, pas d'un objet à nous.
describe("la mutation dans les deux sens, sur les fichiers réels", () => {
  /** Une déclaration littérale du dépôt — pas une entrée de matrice, dont la ligne porte la liste. */
  const cible = reel.declarations.find((d) => d.via === null);

  /** Le texte d'un vrai workflow, avec cette seule version abaissée sous le plancher. */
  const abaisse = () => {
    const lignes = readFileSync(cible.fichier, "utf8").split("\n");
    const avant = lignes[cible.ligne - 1];
    lignes[cible.ligne - 1] = avant.replace(/(node-version:\s*)["']?[^"'\s]+["']?/, '$1"18"');
    expect(lignes[cible.ligne - 1], `la mutation n'a rien changé à ${cible.fichier}:${cible.ligne} — elle ne prouverait rien`)
      .not.toBe(avant);
    return lignes.join("\n");
  };

  it("la sonde a bien une déclaration littérale à muter", () => {
    // ⚠️ Le plancher de ce bloc-ci : sans cible, tout ce qui suit passerait en n'éprouvant rien.
    expect(cible, "aucune déclaration littérale dans le dépôt : ce bloc vise à côté").toBeTruthy();
  });

  // ⚠️ LE SENS NEUF, ET LE SEUL QUI METTE L'ANALYSEUR DANS LE CHEMIN DU ROUGE.
  it("⚠️ un vrai workflow abaissé à node 18 est refusé — texte réel, analyseur réel", () => {
    const lu = versionsDe(abaisse(), cible.fichier);
    expect(lu.illisibles, "la mutation a cassé le YAML : on n'éprouve plus la règle").toEqual([]);

    const r = verdict({ engines: ENGINES, declarations: [...reel.declarations.filter((d) => d.fichier !== cible.fichier), ...lu.declarations], illisibles: [], ...VU });
    expect(r.code).toBe(VIOLATION);
    expect(r.constats.join("\n")).toMatch(new RegExp(`${cible.fichier.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}.*node 18`));
  });

  // ⚠️ LA PARTITION, ÉNONCÉE D'UN SEUL TENANT. Chaque état pris isolément se lit comme un banc de
  // plus ; les trois ensemble disent la propriété qui compte — le vert du milieu n'est pas
  // atteignable depuis l'un ou l'autre bord, donc il est MÉRITÉ.
  it("⚠️ vert au milieu, rouge des deux côtés : aucun vert par accident", () => {
    const lu = versionsDe(abaisse(), cible.fichier);
    const avecCible = (decls) => [...reel.declarations.filter((d) => d.fichier !== cible.fichier), ...decls];

    expect(verdict({ engines: ENGINES, ...reel }).code, "l'état réel").toBe(CONFORME);
    expect(verdict({ engines: ">=24", ...reel }).code, "engines relevé au-dessus des pins").toBe(VIOLATION);
    expect(verdict({ engines: ENGINES, declarations: avecCible(lu.declarations), illisibles: [], ...VU }).code, "un pin abaissé sous engines").toBe(VIOLATION);
  });

  // ⚠️ ET LA SECONDE JAMBE, PARCE QU'UNE SUPPRESSION NE DOIT PAS ÊTRE SILENCIEUSE.
  //
  // Ce banc ne protège PAS la règle : le bloc ci-dessus lit `.github/workflows` pour de vrai, donc
  // retirer l'étape de `ci.yml` laisserait `npm test` la faire rougir quand même. Vérifié plutôt que
  // supposé — la première rédaction de ce commentaire affirmait le contraire, et elle avait tort.
  //
  // Il protège la SECONDE JAMBE. La règle est tenue à deux endroits — le banc et l'étape de CI — et
  // c'est délibéré : chacun couvre la disparition de l'autre. Mais une redondance non énoncée est
  // exactement ce qui a fait survivre un mutant dans ce même fichier : un banc vert grâce à son
  // voisin, sans que personne puisse le savoir. Alors on l'énonce, et retirer l'étape devient un
  // choix visible au lieu d'un silence.
  it("⚠️ un workflow lance vraiment cette garde — la redondance est voulue, donc elle est dite", () => {
    const lances = workflows().flatMap((f) => outilsLances(f, readFileSync(f, "utf8")));
    expect(lances.length, "la sonde ne lit aucun lancement : elle vise à côté").toBeGreaterThan(20);
    expect(
      lances.map((l) => l.outil),
      "aucun workflow ne lance node-des-workflows : la garde ne tournerait plus que dans npm test",
    ).toContain("tools/node-des-workflows.mjs");
  });
});


// ⚠️ LA RELATION : TOUTE ÉTAPE QUI INSTALLE NODE DÉCLARE LAQUELLE.
//
// Elle vient d'une correction que la session STUDIO a apportée à sa propre garde le 31/08 : ses
// planchers valaient exactement le relevé du jour, et elle les a remplacés par un périmètre DÉRIVÉ
// DU DISQUE. Passée sur notre dépôt, l'idée y a désigné un trou que nos planchers ne pouvaient pas
// voir — 11 étapes `setup-node`, 11 déclarant une version, et RIEN qui garde ce rapport.
//
// Un plancher compte ce qu'il VOIT ; il ne sait pas ce qui aurait dû être là. Retirer l'entrée
// `node-version` d'une étape faisait passer le relevé de 12 à 11 déclarations — au-dessus du
// plancher de 8 — et la garde restait verte pendant que la forge installait le défaut de l'action.
describe("toute étape qui installe node déclare laquelle", () => {
  const etape = (corps) => versionsDe(`jobs:\n  a:\n    steps:\n      - uses: actions/setup-node@abc123\n${corps}`, "f.yml");

  it("une `setup-node` SANS bloc `with:` est refusée — c'est la forme exacte qui passait", () => {
    const r = etape("");
    expect(r.installations).toHaveLength(1);
    expect(r.sansVersion.join("")).toMatch(/installe node sans déclarer laquelle/);
  });

  it("une `setup-node` avec un `with:` qui ne porte pas de version est refusée aussi", () => {
    const r = etape("        with:\n          cache: npm\n");
    expect(r.sansVersion).toHaveLength(1);
  });

  it("une `setup-node` qui déclare sa version ne dit rien", () => {
    const r = etape('        with:\n          node-version: "24"\n');
    expect(r.installations).toHaveLength(1);
    expect(r.sansVersion).toEqual([]);
  });

  // ⚠️ `node-version-file` DÉCLARE, même si cette garde ne suit pas le fichier. La compter comme
  // manquante accuserait un dépôt sain — et une garde qui crie faux finit desserrée.
  it("⚠️ `node-version-file` DÉCLARE : la relation est tenue, seul le suivi manque", () => {
    const r = etape('        with:\n          node-version-file: ".nvmrc"\n');
    expect(r.sansVersion, "elle déclare sa version, elle l'écrit juste ailleurs").toEqual([]);
    expect(r.illisibles.join(""), "et la garde dit qu'elle ne la suit pas").toMatch(/node-version-file/);
  });

  // ⚠️ LE CAS QUE LE DÉPÔT NE PRODUIT PAS TOUT SEUL, ET QUI SÉPARE DEUX RÈGLES INDISCERNABLES.
  //
  // « Par étape » et « par fichier » rendent EXACTEMENT le même verdict tant qu'aucun fichier ne
  // porte deux étapes dont une seule déclare. La session STUDIO est tombée dans ce trou le 31/08 :
  // son dépôt n'avait qu'une étape par fichier, donc les deux formulations y étaient
  // observationnellement identiques et aucune mutation ne pouvait les distinguer — ses quatre
  // mutants mouraient tous correctement, en éprouvant la règle écrite plutôt que la règle voulue.
  //
  // Notre règle EST par étape. Mais notre banc ne le prouvait que par accident : la mutation sur
  // fichier réel vise `declarations.find(…)`, donc l'ORDRE DE TRI DU DOSSIER, et elle ne
  // discriminait que parce que cette cible tombe dans `ci.yml`, qui porte quatre étapes. Si elle
  // avait trié dans `cla.yml` — une seule étape — les deux règles auraient rendu le même vert.
  //
  // Une discrimination qui dépend du nom des fichiers est un vert juste pour une mauvaise raison.
  // On fabrique donc le cas.
  it("⚠️ deux étapes, une seule déclaration : PAR ÉTAPE et pas par fichier", () => {
    const r = versionsDe(
      "jobs:\n  a:\n    steps:\n"
      + '      - uses: actions/setup-node@abc\n        with:\n          node-version: "24"\n'
      + "      - uses: actions/setup-node@abc\n", "f.yml");

    expect(r.installations, "les deux étapes doivent entrer dans le périmètre").toHaveLength(2);
    expect(r.declarations, "le fichier déclare bien quelque chose — c'est tout le piège").toHaveLength(1);
    expect(r.sansVersion, "une règle PAR FICHIER serait verte ici : le fichier déclare").toHaveLength(1);
    expect(r.sansVersion[0]).toMatch(/f\.yml:7/);
  });

  // ⚠️ ET LE DÉFAUT INVERSE, PARCE QU'UN FAUX POSITIF DESSERRE UNE GARDE AUSSI SÛREMENT QU'UN TROU.
  // Une étape qui tient sa version de la matrice DÉCLARE. La compter muette accuserait `ci.yml`,
  // c'est-à-dire le dépôt sain, et une garde qui crie faux finit desserrée par celui qu'elle a
  // dérangé pour rien — le même arbitrage que `subset` contre `intersects`.
  it("⚠️ une étape qui tient sa version de la matrice DÉCLARE — jamais muette", () => {
    const r = versionsDe(
      "jobs:\n  a:\n    strategy:\n      matrix:\n        node: [\"22\", \"24\"]\n"
      + "    steps:\n      - uses: actions/setup-node@abc\n        with:\n          node-version: ${{ matrix.node }}\n", "f.yml");
    expect(r.installations).toHaveLength(1);
    expect(r.sansVersion, "elle déclare, la valeur vient juste de la matrice").toEqual([]);
    expect(r.declarations.map((d) => d.portee)).toEqual(["22", "24"]);
  });

  it("une étape qui n'installe pas node n'entre pas dans le périmètre", () => {
    const r = versionsDe('jobs:\n  a:\n    steps:\n      - uses: actions/checkout@abc\n', "f.yml");
    expect(r.installations).toEqual([]);
    expect(r.sansVersion).toEqual([]);
  });

  it("le verdict transforme une installation muette en VIOLATION", () => {
    const r = verdict({ engines: ENGINES, declarations: assezDe("24"), illisibles: [], ...VU, sansVersion: ["f.yml:4 : muette"] });
    expect(r.code).toBe(VIOLATION);
    expect(r.constats).toEqual(["f.yml:4 : muette"]);
  });

  // ⚠️ LA RELATION PEUT ÊTRE SATISFAITE À VIDE, donc elle porte son propre plancher. Si la lecture
  // des `uses:` cassait, zéro installation serait relevée, aucune ne manquerait de version, et la
  // règle passerait sans avoir rien regardé — pendant que les planchers de déclarations, eux,
  // tiendraient toujours. Ce banc a une dette : le plancher a attrapé cette panne-là chez son
  // auteur, le jour même, sur un `garde()` qui oubliait de transmettre le relevé au verdict.
  it("⚠️ refuse un relevé sans aucune installation — la relation serait vraie pour n'avoir rien lu", () => {
    const r = verdict({ engines: ENGINES, declarations: assezDe("24"), illisibles: [], installations: [], sansVersion: [] });
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/satisfaite À VIDE/);
  });

  // ⚠️ L'ORDRE, QUI EST UNE DÉCISION ET NON UNE MISE EN PAGE. Si la lecture des `node-version`
  // cassait, les onze installations paraîtraient toutes muettes et la garde rendrait onze
  // VIOLATIONS — « corrige ta branche » pour une panne qui n'y est pas. Le plancher des
  // déclarations doit tirer AVANT, en non concluant.
  it("⚠️ une panne du lecteur de versions rend NON CONCLUANT, jamais onze accusations", () => {
    const muettes = VU.installations.map((i) => `${i.fichier}:1 : muette`);
    const r = verdict({ engines: ENGINES, declarations: [], illisibles: [], installations: VU.installations, sansVersion: muettes });
    expect(r.code, "accuser l'auteur d'une panne de la garde est le défaut que la taxonomie sépare").toBe(INCONCLUSIF);
  });
});

describe("la relation, sur le dossier réel", () => {
  it("chaque étape qui installe node y déclare sa version", () => {
    expect(reel.installations.length, "aucune installation relevée : la sonde vise à côté")
      .toBeGreaterThanOrEqual(PLANCHER_INSTALLATIONS);
    expect(reel.sansVersion, "une étape installe node sans dire laquelle").toEqual([]);
  });

  // ⚠️ LES DEUX SENS, SUR LA RÈGLE NEUVE AUSSI. La règle est verte aujourd'hui ; sans cette
  // mutation, ce vert ne prouverait que l'absence du défaut, jamais la présence de la garde.
  //
  // ⚠️ ET CE BANC PORTAIT DEUX PROPRIÉTÉS DANS UN SEUL TEST, CE QUI LES AFFAIBLISSAIT TOUTES LES
  // DEUX. « Une étape dépouillée est refusée » vaut pour n'importe laquelle — donc il ne faut pas
  // en choisir une. « La mutation discrimine PAR ÉTAPE de PAR FICHIER » n'a de sens que sur une
  // cible dont le fichier garde d'AUTRES déclarations — donc il faut en choisir une, et
  // délibérément. Fondues, la première héritait d'un choix dont elle n'avait pas besoin, et la
  // seconde d'un choix qu'elle ne faisait pas : `find(…)` prenait ce que l'ORDRE DE TRI donnait.
  // Mesuré le 31/08 : trois de nos dix déclarations littérales vivent seules dans leur fichier, et
  // sur celles-là la discrimination ne tient pas. Le tri décidait donc si le banc prouvait la
  // seconde propriété.
  it("⚠️ CHAQUE vraie étape dépouillée de sa version est refusée — texte réel, analyseur réel", () => {
    const litterales = reel.declarations.filter((d) => d.via === null);
    expect(litterales.length, "aucune déclaration littérale à dépouiller : ce banc vise à côté").toBeGreaterThan(0);

    for (const cible of litterales) {
      const ou = `${cible.fichier}:${cible.ligne}`;
      const lignes = readFileSync(cible.fichier, "utf8").split("\n");
      lignes.splice(cible.ligne - 1, 1);
      const lu = versionsDe(lignes.join("\n"), cible.fichier);

      expect(lu.illisibles, `${ou} : la mutation a cassé le YAML, on n'éprouve plus la règle`).toEqual([]);
      expect(lu.sansVersion.join("\n"), `retirer la version de ${ou} n'a rien déclenché`)
        .toMatch(/installe node sans déclarer laquelle/);
    }
  });

  // ⚠️ ET LA DISCRIMINATION, SUR UNE CIBLE CHOISIE POUR CE QU'ELLE EST. Une règle PAR FICHIER
  // resterait verte ici, puisque le fichier déclare encore ; seule une règle PAR ÉTAPE refuse. Le
  // banc fabriqué du bloc précédent tient la même propriété sans dépendre d'aucun fichier réel —
  // celui-ci la tient sur le dépôt tel qu'il est, et les deux ensemble disent qu'elle ne vient ni
  // d'un accident de nommage ni d'une éprouvette complaisante.
  it("⚠️ et sur un fichier MULTI-ÉTAPES, elle discrimine « par étape » de « par fichier »", () => {
    const litterales = reel.declarations.filter((d) => d.via === null);
    const parFichier = new Map();
    for (const d of litterales) parFichier.set(d.fichier, (parFichier.get(d.fichier) || 0) + 1);

    const cible = litterales.find((d) => parFichier.get(d.fichier) > 1);
    expect(cible, "aucun fichier ne porte deux déclarations littérales : cette propriété n'est plus éprouvable sur le dépôt réel, et seul le banc fabriqué la tient").toBeTruthy();

    const lignes = readFileSync(cible.fichier, "utf8").split("\n");
    lignes.splice(cible.ligne - 1, 1);
    const lu = versionsDe(lignes.join("\n"), cible.fichier);

    expect(lu.declarations.filter((d) => d.fichier === cible.fichier).length,
      `${cible.fichier} ne déclare plus rien après la mutation : une règle par fichier rougirait aussi, le banc ne discrimine plus`)
      .toBeGreaterThan(0);
    expect(lu.sansVersion.join("\n")).toMatch(/installe node sans déclarer laquelle/);
  });
});
