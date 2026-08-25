// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA SENTINELLE QUI PRÉVIENT AVANT QUE LE ROUGE NE TOMBE SUR QUELQU'UN D'AUTRE.
//
// ⚠️ L'INCIDENT : le 21/08, deux PR ouvertes sont passées au rouge pendant que 0.1.127 puis
// 0.1.128 sortaient. Aucune des deux n'avait touché aux exemples. Le refus était juste — la garde
// compare au REGISTRE VIVANT, et fusionner ces branches aurait laissé `main` derrière — mais il
// tombait sur des gens qui n'y étaient pour rien.
//
// Ce qui manquait n'était pas une garde, c'était l'avertissement pendant le SURSIS : la fenêtre
// d'une publication entre « plus la dernière » et « plus dans les deux dernières ».

import { describe, it, expect } from "vitest";
import {
  A_JOUR, SURSIS, ROUGE, deuxDernieres, etatDe, diagnostic, message,
} from "../exemples-en-retard.mjs";
import { exemplesDuDepot } from "../exemples-epingles.mjs";

const PUBLIEES = ["0.1.126", "0.1.127", "0.1.128"];
const ex = (nom, version) => ({ fichier: `examples/${nom}/package.json`, version });

describe("⚠️ LES TROIS ÉTATS, ET SURTOUT CELUI DU MILIEU", () => {
  it("la dernière servie est à jour", () => {
    expect(etatDe("0.1.128", deuxDernieres(PUBLIEES))).toBe(A_JOUR);
  });

  it("⚠️ l'avant-dernière est EN SURSIS — verte aujourd'hui, rouge à la prochaine publication", () => {
    // C'est l'état que rien ne nommait. La garde le laisse passer, donc personne ne le voit ;
    // il devient rouge sans qu'un seul commit ait été poussé.
    expect(etatDe("0.1.127", deuxDernieres(PUBLIEES))).toBe(SURSIS);
  });

  it("au-delà, c'est déjà rouge", () => {
    expect(etatDe("0.1.126", deuxDernieres(PUBLIEES))).toBe(ROUGE);
  });

  it("une version que le registre ne sert pas encore est rouge, pas à jour", () => {
    // Le cas inverse, tout aussi cassant : le déploiement de la démo installe depuis npm.
    expect(etatDe("0.1.129", deuxDernieres(PUBLIEES))).toBe(ROUGE);
  });
});

describe("⚠️ LES PRÉVERSIONS NE DÉCALENT PAS LA FENÊTRE", () => {
  it("deux bêta publiées ne deviennent pas « les deux dernières »", () => {
    // Même raison que dans la garde voisine : un exemple est ce qu'un intégrateur RECOPIE.
    // Sans ce filtre, la sentinelle réclamerait une montée vers une version que personne
    // ne devrait épingler.
    expect(deuxDernieres([...PUBLIEES, "0.2.0-beta.1", "0.2.0-beta.2"])).toEqual(["0.1.128", "0.1.127"]);
  });

  it("trie numériquement — 0.1.9 est AVANT 0.1.10", () => {
    expect(deuxDernieres(["0.1.9", "0.1.10", "0.1.8"])).toEqual(["0.1.10", "0.1.9"]);
  });
});

describe("le diagnostic", () => {
  it("se tait quand tout est sur la dernière", () => {
    const d = diagnostic(PUBLIEES, [ex("demo", "0.1.128"), ex("minimal", "0.1.128")]);
    expect(d.aSignaler).toBe(false);
    expect(d.rouges).toEqual([]);
    expect(d.enSursis).toEqual([]);
  });

  it("⚠️ parle PENDANT le sursis — c'est le seul moment où prévenir sert encore", () => {
    const d = diagnostic(PUBLIEES, [ex("demo", "0.1.127")]);
    expect(d.aSignaler).toBe(true);
    expect(d.enSursis).toHaveLength(1);
    expect(d.rouges).toEqual([]);
  });

  it("distingue ce qui est déjà cassé de ce qui va l'être", () => {
    const d = diagnostic(PUBLIEES, [ex("demo", "0.1.127"), ex("vieux", "0.1.120")]);
    expect(d.enSursis.map((e) => e.version)).toEqual(["0.1.127"]);
    expect(d.rouges.map((e) => e.version)).toEqual(["0.1.120"]);
  });

  it("⚠️ ne conclut RIEN sans registre — une absence de réponse n'est pas un retard", () => {
    // Une alarme fondée sur une coupure réseau crie au loup à la première panne, et c'est
    // comme ça qu'on cesse de l'écouter. `publication.yml` tranche déjà pareil.
    expect(diagnostic(null, [ex("demo", "0.1.127")])).toBeNull();
    expect(diagnostic([], [ex("demo", "0.1.127")])).toBeNull();
    expect(diagnostic(["0.2.0-beta.1"], [ex("demo", "0.1.127")])).toBeNull();
  });
});

describe("le message dit le geste, pas seulement le problème", () => {
  it("nomme la version cible et donne la commande pour chaque exemple en retard", () => {
    const d = diagnostic(PUBLIEES, [ex("demo", "0.1.127"), ex("minimal", "0.1.128")]);
    const m = message(d);
    expect(m).toMatch(/registre sert \*\*0\.1\.128\*\*/);
    expect(m).toContain("npm --prefix examples/demo pkg set dependencies.discovery-media-player=0.1.128");
    // L'exemple déjà à jour n'a pas de geste à proposer.
    expect(m).not.toContain("--prefix examples/minimal");
  });

  it("dit qu'il reste exactement une publication de marge", () => {
    expect(message(diagnostic(PUBLIEES, [ex("demo", "0.1.127")]))).toMatch(/une publication de marge/);
  });

  it("⚠️ dit que le rouge frappe les PR qui n'y sont pour rien", () => {
    // Sans cette phrase, l'issue décrit un symptôme sans nommer qui le subit — et c'est
    // précisément ce qui manquait pendant l'incident.
    expect(message(diagnostic(PUBLIEES, [ex("demo", "0.1.120")]))).toMatch(/qui n'ont pas touché aux exemples/);
  });

  it("se referme seule — une alarme qu'il faut éteindre à la main reste allumée", () => {
    expect(message(diagnostic(PUBLIEES, [ex("demo", "0.1.127")]))).toMatch(/se referme seule/);
  });
});

describe("⚠️ SUR LE VRAI DÉPÔT", () => {
  it("les exemples relevés sont ceux que la garde voisine surveille — une seule source", () => {
    // La règle « les deux dernières » ne doit exister qu'en un exemplaire. Si ce fichier
    // recopiait le relevé au lieu de l'importer, les deux se contrediraient un jour.
    const exemples = exemplesDuDepot();
    expect(exemples.length).toBeGreaterThan(0);
    for (const e of exemples) expect(e.fichier).toMatch(/^examples\/.+\/package\.json$/);
  });

  // ⚠️ LE CAS « LES EXEMPLES SONT-ILS À JOUR ? » A ÉTÉ RETIRÉ D'ICI, ET C'EST LE CORRECTIF.
  //
  // Il vivait en DEUX exemplaires — ce fichier et `exemplesEpingles.test.js` — réécrits chacun de
  // son côté, avec des commentaires presque identiques. Deux copies d'une même règle finissent par
  // se contredire ; celles-ci l'ont fait le 24/08, pendant la sortie de la 0.1.131, en refusant des
  // exemples que la garde en forge acceptait.
  //
  // La question « un exemple est-il périmé ? » a maintenant UN SEUL endroit qui y répond hors
  // ligne : le banc voisin, via `fenetreHorsLigne`. Ce fichier-ci garde ce qui lui est propre — la
  // SENTINELLE : ses états, son sursis, son escalade — éprouvés sur des relevés construits, où l'on
  // décide ce que le registre sert au lieu de le deviner.
  it("⚠️ et la sentinelle n'invente pas de rouge quand le registre est en avance sur les exemples", () => {
    // Le cas qui compte pour ELLE : main déclare N+1, le registre sert encore N, les exemples sont
    // sur N comme la règle l'exige. C'est un SURSIS — le dire est sa raison d'être — et jamais un
    // rouge. C'est ce que l'ancien cas confondait.
    const d = diagnostic(["0.1.130", "0.1.129"], [{ fichier: "examples/x/package.json", version: "0.1.129" }]);
    expect(d.rouges).toEqual([]);
    expect(d.aSignaler).toBe(true);
  });
});

describe("⚠️ QUAND LES DEUX GROUPES COEXISTENT", () => {
  it("chaque groupe porte son titre — sinon les puces s'enchaînent et disent l'inverse", () => {
    // Défaut relevé en relisant le corps rendu : la liste du sursis suivait celle du rouge sans
    // rien pour la distinguer. Un lecteur y voit une seule liste, dont la moitié est fausse.
    const m = message(diagnostic(PUBLIEES, [ex("demo", "0.1.127"), ex("vieux", "0.1.120")]));
    expect(m).toMatch(/sont DÉJÀ refusés/);
    expect(m).toMatch(/sont en sursis/);
    expect(m.indexOf("DÉJÀ refusés")).toBeLessThan(m.indexOf("en sursis"));
  });
});
