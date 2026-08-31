// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN `grep` SUR DU CODE SAUTE UN FICHIER BINAIRE EN SILENCE — ET UN FICHIER SOURCE PEUT L'ÊTRE.
//
// ⚠️ LE FAIT (27/08). Un hôte a relu les occurrences restantes d'une forme corrigée dans `server/`
// et a conclu « quatre sites, zéro manqué ». Il y en avait CINQ : la cinquième vit dans un banc qui
// contient un octet NUL — délibérément, puisqu'il éprouve les caractères de contrôle. GNU grep
// classe alors le fichier comme binaire et n'imprime AUCUNE ligne. Le relevé rend un nombre plus
// petit, d'apparence normale, sur lequel on conclut.
//
//     grep -rn  "…" server/ | wc -l   →  4
//     grep -arn "…" server/ | wc -l   →  5

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

import { angesMorts, appelsGrep, porteLeDrapeau, sansCitations, temoinsDeForme, verifier, viseDuSource } from "../greps-sans-angle-mort.mjs";
import { blocsDe } from "../shell-des-workflows.mjs";
import { CONFORME, VIOLATION, INCONCLUSIF } from "../resultat-garde.mjs";

const bloc = (run) => ({ fichier: "ci.yml", job: "check", nom: "étape", run });

describe("reconnaître un grep qui lit du source", () => {
  it("un appel nu sur un glob de source, sans -a", () => {
    expect(appelsGrep("grep -rn motif server/*.js")).toEqual([{ chemins: ["server/*.js"], arme: false }]);
  });

  // ⚠️ LE CAS QUI A RENDU CETTE GARDE VERTE SUR SES PROPRES VIOLATIONS. Première écriture : elle
  // cherchait le jeton `grep`, et le jeton réel dans `ci.yml` est `sans_commentaires=$(grep`. Elle
  // annonçait « aucun angle mort » sur un dépôt qui en portait trois. Verte, et fausse.
  it("⚠️ un appel dans une substitution affectée à une variable — le cas réel de ci.yml", () => {
    const l = "sans_commentaires=$(grep -vE '^[[:space:]]*//' server/*.js --with-filename || true)";
    expect(appelsGrep(l), "le jeton n'est pas « grep » mais « sans_commentaires=$(grep »")
      .toEqual([{ chemins: ["server/*.js"], arme: false }]);
  });

  it("le drapeau compte, seul, groupé, ou en forme longue", () => {
    for (const cmd of ["grep -a motif server/x.js", "grep -arn motif server/x.js", "grep --text motif server/x.js"]) {
      expect(appelsGrep(cmd)[0].arme, cmd).toBe(true);
    }
  });

  // ⚠️ `-A` N'EST PAS `-a`. Le contexte-après n'a rien à voir avec la lecture des binaires ; les
  // confondre rendrait la garde satisfaite par un drapeau qui ne protège de rien.
  it("⚠️ -A (contexte) ne vaut pas -a (texte forcé)", () => {
    expect(porteLeDrapeau("-A")).toBe(false);
    expect(porteLeDrapeau("-a")).toBe(true);
  });

  // ⚠️ UN MOTIF QUI RESSEMBLE À UN CHEMIN N'EST PAS UN CHEMIN. `grep -v '^server/schema.js:'` filtre
  // une sortie ; il ne lit pas `server/`. L'accuser inventerait un coupable — la classe de défaut
  // que ce dépôt a déjà payée trois fois.
  it("⚠️ un motif cité qui ressemble à un chemin n'accuse personne", () => {
    expect(appelsGrep("grep -v '^server/schema.js:'")).toEqual([{ chemins: [], arme: false }]);
  });

  // ⚠️ ET LE CAS QUI REND `sansCitations` LOAD-BEARING — LE PREMIER BANC PASSAIT POUR LA MAUVAISE
  // RAISON. Sur `'^server/schema.js:'`, le jeton garde son apostrophe ouvrante et ne ressemble donc
  // déjà plus à un chemin : le banc était vert avec ou sans le retrait des citations. Il faut un
  // motif cité qui contienne une ESPACE pour que le découpage fabrique un jeton nu — mesuré par une
  // mutation qui a survécu.
  it("⚠️ un motif cité CONTENANT UNE ESPACE ne fabrique pas de faux chemin", () => {
    expect(appelsGrep("grep -v 'motif server/x.js suite' /tmp/f.txt"))
      .toEqual([{ chemins: [], arme: false }]);
  });

  // Dans un tube, seul le premier grep lit des fichiers ; le second lit l'entrée standard.
  it("un tube : le second grep n'a aucun fichier à lire", () => {
    const appels = appelsGrep("grep -arn 'x(' server/*.js | grep -v '^server/schema.js:'");
    expect(appels).toHaveLength(2);
    expect(appels[0]).toEqual({ chemins: ["server/*.js"], arme: true });
    expect(appels[1].chemins).toEqual([]);
  });

  it("un chemin hors des racines de source ne concerne pas cette règle", () => {
    expect(viseDuSource("docs/API.md")).toBe(false);
    expect(viseDuSource("/tmp/files.txt")).toBe(false);
    expect(viseDuSource("server/schema.js")).toBe(true);
    expect(viseDuSource("server")).toBe(true);
  });

  it("les citations partent avant qu'on cherche des chemins", () => {
    expect(sansCitations("grep -v 'server/x' \"src/y\" server/z.js")).toMatch(/server\/z\.js/);
    expect(sansCitations("grep -v 'server/x' \"src/y\" server/z.js")).not.toMatch(/src\/y/);
  });
});

describe("le verdict sur des blocs", () => {
  it("un grep sur du source sans -a est une violation nommée", () => {
    const soucis = angesMorts([bloc("hors=$(grep -rn 'x' server/*.js || true)")]);
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toMatch(/server\/\*\.js/);
    expect(soucis[0]).toMatch(/SANS un mot/);
  });

  it("le même, armé, ne dit rien", () => {
    expect(angesMorts([bloc("hors=$(grep -arn 'x' server/*.js || true)")])).toEqual([]);
  });

  // Une ligne de commentaire shell n'est pas exécutée : l'accuser inventerait un coupable — et ce
  // dépôt a déjà payé trois fois « une sonde qui lit du commentaire ».
  it("⚠️ un grep cité dans un commentaire shell n'est pas un appel", () => {
    expect(angesMorts([bloc("# on pourrait écrire grep -rn x server/*.js, mais non\necho ok")])).toEqual([]);
  });

  it("un grep qui ne lit aucun source ne concerne pas la règle", () => {
    expect(angesMorts([bloc("grep -q 'package/src/' /tmp/files.txt")])).toEqual([]);
  });
});

describe("la garde sur le dépôt", () => {
  it("le dépôt réel est conforme, et la sonde a bien lu des blocs", () => {
    const r = verifier();
    expect(r.code).toBe(CONFORME);
    expect(r.resume).toMatch(/bloc\(s\) « run: » relus/);
  });

  // ⚠️ LE PLANCHER. Un dossier renommé, un lecteur qui rend du vide, et la garde dirait « aucun
  // angle mort » sur zéro bloc — la vacuité qu'elle est écrite pour interdire.
  it("⚠️ aucun bloc relevé : elle refuse au lieu de conclure au vert", () => {
    const r = verifier(".github/workflows", () => "", () => []);
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/vise à côté/);
  });

  it("un workflow fautif la fait rougir", () => {
    const faux = "name: T\non: push\njobs:\n  j:\n    steps:\n      - run: grep -rn x server/*.js\n";
    const r = verifier("peu-importe", () => faux, () => ["t.yml"]);
    expect(r.code).toBe(VIOLATION);
    expect(r.constats[0]).toMatch(/sans « -a »/);
  });

  // Un document illisible est une cécité de la garde, pas une violation du dépôt.
  it("un YAML illisible rend NON CONCLUANT, jamais VIOLATION", () => {
    const r = verifier("peu-importe", () => "{ ceci: n'est pas: du yaml", () => ["t.yml"]);
    expect(r.code).toBe(INCONCLUSIF);
  });
});

describe("⚠️ le témoin de la forme — « rien trouvé » n'est pas « rien regardé »", () => {
  // ⚠️ CE QUI ÉTAIT MESURÉ LE 31/08. En forçant `findIndex` à rendre -1 — une sonde d'appel
  // aveugle — l'outil imprimait « 112 bloc(s) « run: » relus, aucun « grep » ne lit du source
  // sans « -a » » et sortait 0. Le plancher qui existait comptait les BLOCS OUVERTS ; il est
  // placé un maillon trop tôt dans la chaîne. Le message vert AFFIRMAIT avoir regardé des `grep`.
  it("⚠️ des blocs sans le moindre grep : elle refuse au lieu de conclure au vert", () => {
    const sansGrep = "name: T\non: push\njobs:\n  j:\n    steps:\n      - run: npm test\n";
    const r = verifier("peu-importe", () => sansGrep, () => ["t.yml"]);
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/aucun appel à « grep » reconnu/);
  });

  // ⚠️ DEUX SONDES SE SUCCÈDENT, DONC DEUX CÉCITÉS. `appelsGrep` reconnaît l'appel ;
  // `viseDuSource` reconnaît qu'il lit du code d'ici. Aveugler la SECONDE blanchit tout sans
  // toucher à la première — un seul compte laisserait cette cécité-là ouverte.
  it("⚠️ des greps reconnus mais aucun ne visant du source : elle refuse aussi", () => {
    const horsSource = "name: T\non: push\njobs:\n  j:\n    steps:\n      - run: grep -rn x docs/API.md\n";
    const r = verifier("peu-importe", () => horsSource, () => ["t.yml"]);
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/ne vise une racine de source/);
  });

  it("le témoin passe par la traversée du juge, pas par une copie", () => {
    const blocs = [bloc("grep -arn x server/*.js"), bloc("# grep -rn x server/y.js"), bloc("npm test")];
    // La ligne commentée est SAUTÉE par le juge : le témoin doit la sauter aussi, sinon il
    // compterait un sujet que personne ne juge.
    expect(temoinsDeForme(blocs)).toEqual({ greps: 1, surSource: 1 });
  });
});

// ⚠️ LA POPULATION DE CE DÉPÔT VIT ICI, PAS DANS LA GARDE. `verifier` prend une racine
// arbitraire : un plancher calibré sur ce dépôt y accuserait toute fixture plus petite que lui —
// mesuré en une course, le banc ci-dessus est parti rouge. Le fait « ce dépôt porte une vraie
// population de greps » est un fait sur LE DÉPÔT, donc il s'affirme là où le dépôt est le sujet.
// C'est le même partage que `licence-par-fichier`.
describe("⚠️ sur les workflows réels, la sonde reconnaît une population, pas un cas isolé", () => {
  it("au moins huit appels à grep, dont au moins un lisant du source", () => {
    const dossier = ".github/workflows";
    const blocs = readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f))
      .flatMap((f) => blocsDe(f, readFileSync(join(dossier, f), "utf8")));
    const { greps, surSource } = temoinsDeForme(blocs);
    expect(greps, "25 le 31/08 — si ce nombre s'effondre, la sonde a cessé de lire une forme").toBeGreaterThanOrEqual(8);
    expect(surSource, "3 le 31/08 — sans un seul, la règle n'a plus de sujet ici").toBeGreaterThanOrEqual(1);
  });
});
