// CE QUE LES EXEMPLES ONT LE DROIT D'ÉPINGLER — LES CINQ ÉTATS DE LA VIE DU DÉPÔT.
//
// ⚠️ L'ancienne règle (« la version de main OU la dernière publiée ») était ROUGE dans l'état
// NORMAL du dépôt : dès la sortie faite, les deux valent la même chose, et des exemples restés une
// version en arrière ne sont plus ni l'une ni l'autre. Rouge sur main, sur chaque PR ouverte, sur
// les suivantes. Ça a coûté #273 (21/08), morte vide parce que #276 portait le même correctif de
// trois lignes, découvert de son côté dans la même heure.
//
// Le commentaire de ci.yml affirmait pourtant que « leur retard d'une version est la propriété
// recherchée ». Le texte et le contrôle se contredisaient, et c'est le contrôle qui gagne.

import { describe, it, expect } from "vitest";
import { comparerVersions, estStable, acceptables, ecartsExemples, versionsPubliees, exemplesDuDepot, registreExploitable } from "../exemples-epingles.mjs";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const trois = (v) => [
  { fichier: "examples/demo/package.json", version: v },
  { fichier: "examples/express/package.json", version: v },
  { fichier: "examples/vercel/package.json", version: v },
];
const PUBLIEES = ["0.1.122", "0.1.123", "0.1.124", "0.1.125", "0.1.126"];

describe("comparer des versions", () => {
  it("⚠️ 0.1.9 est AVANT 0.1.10 — le tri lexical dirait le contraire", () => {
    expect(comparerVersions("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(["0.1.10", "0.1.9"].sort(comparerVersions)).toEqual(["0.1.9", "0.1.10"]);
  });

  it("ordonne les majeures et mineures", () => {
    expect(comparerVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(comparerVersions("0.2.0", "0.1.99")).toBeGreaterThan(0);
    expect(comparerVersions("0.1.126", "0.1.126")).toBe(0);
  });
});

describe("⚠️ LES PRÉVERSIONS NE SONT PAS « LES DEUX DERNIÈRES »", () => {
  // `"0.2.0-beta.1".split(".")` rend `["0","2","0-beta","1"]`, et `Number("0-beta")` vaut NaN :
  // le comparateur maison devenait faux et le tri indéfini. Deux bêta publiées à la suite
  // seraient devenues les deux versions recommandées (revue externe, 21/08).
  it("reconnaît une version stable", () => {
    expect(estStable("0.1.128")).toBe(true);
    expect(estStable("0.2.0-beta.1")).toBe(false);
    expect(estStable("0.1")).toBe(false);
  });

  it("les écarte du calcul, même quand elles sont les plus récentes", () => {
    expect(acceptables("x", ["0.1.126", "0.1.127", "0.2.0-beta.1", "0.2.0-beta.2"]))
      .toEqual(["0.1.127", "0.1.126"]);
  });

  it("un exemple épinglé sur une préversion est refusé", () => {
    const ex = [{ fichier: "examples/demo/package.json", version: "0.2.0-beta.2" }];
    expect(ecartsExemples("x", ["0.1.127", "0.2.0-beta.2"], ex)).toHaveLength(1);
  });

  it("⚠️ REFUSE de nommer une version quand le registre ne sert QUE des préversions", () => {
    // Le repli rendait `["0.1.0"]` — la version de `main`, dont personne n'a dit qu'elle était
    // servie. Un registre qui ne sert que des bêta ne sert AUCUNE version épinglable : il n'y a
    // rien à nommer, et fabriquer une réponse est ce qui a produit le faux vert du 22/08.
    expect(() => acceptables("0.1.0", ["0.1.0-rc.1"])).toThrow(/aucune version stable/);
    expect(registreExploitable(["0.1.0-rc.1"])).toBe(false);
    expect(registreExploitable(["0.1.0-rc.1", "0.1.0"])).toBe(true);
  });
});

describe("les deux dernières publiées, et rien d'autre", () => {
  it("les prend dans le registre, pas dans le dépôt", () => {
    expect(acceptables("0.1.127", PUBLIEES)).toEqual(["0.1.126", "0.1.125"]);
  });

  it("ne se fie pas à l'ordre du registre", () => {
    expect(acceptables("x", ["0.1.126", "0.1.122", "0.1.125"])).toEqual(["0.1.126", "0.1.125"]);
  });

  it("survit à un registre qui n'a qu'une version", () => {
    expect(acceptables("0.1.1", ["0.1.1"])).toEqual(["0.1.1"]);
  });
});

describe("LES CINQ ÉTATS DE LA VIE DU DÉPÔT", () => {
  it("1. PR de sortie, exemples laissés à la publiée → vert", () => {
    // main dit 0.1.127, npm sert 0.1.126, les exemples sont restés à 0.1.126.
    expect(ecartsExemples("0.1.127", PUBLIEES, trois("0.1.126"))).toEqual([]);
  });

  it("2. PR de sortie, exemples montés à la version pas encore servie → ROUGE (le piège de #269)", () => {
    const soucis = ecartsExemples("0.1.127", PUBLIEES, trois("0.1.127"));
    expect(soucis).toHaveLength(3);
    expect(soucis[0]).toMatch(/n'est pas encore SERVIE.*démo installe depuis npm/);
  });

  it("3. état stable après publication → vert", () => {
    expect(ecartsExemples("0.1.126", PUBLIEES, trois("0.1.126"))).toEqual([]);
  });

  it("⭐ 4. APRÈS PUBLICATION, EXEMPLES ENCORE UNE VERSION EN ARRIÈRE → vert", () => {
    // ⚠️ LE CAS QUI A COÛTÉ #273. C'est l'état normal du dépôt entre une sortie et le geste humain
    // qui monte les exemples — et l'ancienne règle le rendait rouge. Une alerte qui se déclenche
    // quand tout va bien apprend à passer outre.
    expect(ecartsExemples("0.1.126", PUBLIEES, trois("0.1.125"))).toEqual([]);
  });

  it("5. exemple oublié loin derrière → ROUGE", () => {
    // Le défaut d'origine : la démo épinglait 0.1.20 et les autres 0.1.7, cent onze versions en
    // arrière. Deux versions de retard suffisent à rougir — la protection est intacte.
    const soucis = ecartsExemples("0.1.126", PUBLIEES, trois("0.1.124"));
    expect(soucis).toHaveLength(3);
    expect(soucis[0]).toMatch(/Un copieur recevrait un player périmé/);
  });
});

describe("les messages", () => {
  it("nomment celui qui diverge, pas « un exemple »", () => {
    const melange = trois("0.1.126");
    melange[1] = { fichier: "examples/express/package.json", version: "0.1.7" };
    const soucis = ecartsExemples("0.1.126", PUBLIEES, melange);
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain("examples/express/package.json");
  });

  it("disent les deux versions permises", () => {
    expect(ecartsExemples("0.1.126", PUBLIEES, trois("0.1.7"))[0])
      .toMatch(/dernière publiée \(0\.1\.126\).*celle d'avant \(0\.1\.125\)/);
  });

  it("distinguent « trop neuve » de « périmée » — ce ne sont pas les mêmes gestes", () => {
    expect(ecartsExemples("x", PUBLIEES, trois("0.1.200"))[0]).toMatch(/pas encore SERVIE/);
    expect(ecartsExemples("x", PUBLIEES, trois("0.1.7"))[0]).toMatch(/périmé/);
  });

  it("refuse une plage par construction — elle n'est jamais une version publiée", () => {
    expect(ecartsExemples("0.1.126", PUBLIEES, trois("^0.1.0"))).toHaveLength(3);
    expect(ecartsExemples("0.1.126", PUBLIEES, trois("~0.1.126"))).toHaveLength(3);
  });
});

describe("⚠️ REGISTRE INJOIGNABLE : ON NE CONCLUT PAS — ET CE BANC DISAIT L'INVERSE", () => {
  // Ce bloc s'appelait « on RESSERRE, on n'élargit pas » et FIGEAIT le défaut : sans registre, la
  // garde exigeait la version de `main` et rendait `[]` quand les exemples l'épinglaient — donc un
  // vert, donc la phrase « servies par le registre, donc installables » sur un fait que personne
  // n'avait vérifié (P1, audit externe du 22/08, reproduit avec main=9.9.9).
  //
  // ⚠️ Le repli répondait à une AUTRE question. La propriété visée est « npm SERT cette version » ;
  // « les exemples valent la version de main » n'en est pas une version dégradée, c'en est une
  // différente — et `main` déclare régulièrement une version pas encore publiée, ce que
  // `publication.yml` surveille toutes les heures.
  //
  // ⚠️ ET LA BONNE RÉPONSE ÉTAIT DÉJÀ ÉCRITE À CÔTÉ : `release-preflight.mjs` refusait de conclure
  // sans registre depuis le premier jour, en nommant ce repli-ci « le pire des choix ». Deux
  // exemplaires du même raisonnement, dont un seul avait raison.
  it("lève plutôt que de rendre un tableau vide, qui se lirait « aucun écart »", () => {
    expect(() => ecartsExemples("0.1.126", null, trois("0.1.126"))).toThrow(/ne peut pas être établi/);
    expect(() => ecartsExemples("0.1.126", [], trois("0.1.125"))).toThrow(/aucune version stable/);
  });

  it("⚠️ le cas exact de l'audit : main sur une version que npm ne sert pas", () => {
    // Avec 9.9.9 dans main, le registre muet et les exemples sur 9.9.9, l'ancienne garde rendait
    // zéro écart et sortait 0. 9.9.9 n'a jamais existé sur npm.
    expect(() => ecartsExemples("9.9.9", null, trois("9.9.9"))).toThrow();
  });

  it("un registre qui ne sert que des préversions est traité comme muet", () => {
    expect(() => ecartsExemples("0.1.126", ["0.2.0-beta.1"], trois("0.1.126"))).toThrow();
  });

  it("rend null quand npm ne répond pas, sans lever", () => {
    expect(versionsPubliees(() => { throw new Error("réseau"); })).toBeNull();
    expect(versionsPubliees(() => "pas du json")).toBeNull();
  });

  it("accepte la réponse d'un paquet à version unique, que npm rend en scalaire", () => {
    expect(versionsPubliees(() => '"0.1.1"')).toEqual(["0.1.1"]);
  });
});

describe("le dépôt réel", () => {
  it("a bien trois exemples, et ils épinglent une version exacte", () => {
    const exemples = exemplesDuDepot();
    expect(exemples.length).toBeGreaterThanOrEqual(3);
    for (const e of exemples) expect(e.version, e.fichier).toMatch(/^\d+\.\d+\.\d+$/);
  });

  // ⚠️ CE TEST DISAIT « contre les versions réellement publiées ce jour-là », ET C'ÉTAIT FAUX. Il
  // comparait à une LISTE FIGÉE, écrite le jour de sa naissance. Deux sorties plus tard elle
  // décrivait le passé : le test a rougi sur un dépôt parfaitement correct — et, plus grave, il
  // aurait pu VERDIR sur un dépôt en retard, puisque la liste ne bouge plus. C'est la même classe
  // que le relevé daté du banc de coût, trouvé le même jour : un fait figé à côté d'un fait vivant.
  //
  // ⚠️ UN TEST HORS LIGNE NE PEUT PAS SAVOIR CE QUE NPM SERT — et il ne doit pas essayer. Ce qu'il
  // peut vérifier, c'est l'invariant qui ne dépend que du dépôt : un exemple épingle l'une des DEUX
  // dernières versions que le CHANGELOG déclare. C'est la même fenêtre que la règle en forge, avec
  // une source qui VIEILLIT AVEC LE DÉPÔT au lieu d'être recopiée. La vérification contre le
  // registre, elle, reste en forge — c'est là que le réseau est légitime.
  it("les exemples épinglent l'une des deux dernières versions du CHANGELOG", () => {
    const changelog = readFileSync(join(RACINE, "CHANGELOG.md"), "utf8");
    const versions = [...changelog.matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);
    // ⚠️ ANTI-VACUITÉ : sans versions lues, la comparaison ci-dessous serait vraie pour tout le
    // monde. Un test qui ne peut pas mesurer doit refuser de conclure, pas conclure au vert.
    expect(versions.length, "aucune version lue dans le CHANGELOG : la sonde vise à côté")
      .toBeGreaterThanOrEqual(2);
    const fenetre = versions.slice(0, 2);
    const retard = exemplesDuDepot()
      .filter((e) => !fenetre.includes(e.version))
      .map((e) => `${e.fichier} épingle ${e.version}, hors des deux dernières (${fenetre.join(", ")})`);
    expect(retard, "un intégrateur qui copie recevrait un player périmé").toEqual([]);
  });
});
