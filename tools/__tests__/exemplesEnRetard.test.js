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
import { readFileSync } from "node:fs";

import {
  A_JOUR, SURSIS, ROUGE, deuxDernieres, etatDe, diagnostic, message, empreinte, marqueur, dejaDit,
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

// ⚠️ LA SENTINELLE SE TAISAIT SUR LE FOND ET PARLAIT SUR L'HORLOGE — LE CORRECTIF DU 27/08.
//
// Mesuré sur l'issue #412 : son corps le 26/08 à 13:18, puis QUATRE commentaires à 15:53, 17:27,
// 19:19 et 23:36, identiques au caractère près. Dix heures, cinq énoncés, zéro information
// nouvelle — et personne n'a lu. Le nombre n'est pas la cause du silence, mais il est le
// mécanisme que l'en-tête de ce fichier condamne chez les autres : « une alarme qui se déclenche
// à chaque fusion serait ignorée en une semaine ». La sentinelle se l'appliquait à elle-même.
describe("⚠️ UN FAIT DÉJÀ ANNONCÉ NE SE RÉANNONCE PAS", () => {
  const dEtat = (versions, publiees = PUBLIEES) =>
    diagnostic(publiees, versions.map(([n, v]) => ex(n, v)));

  it("l'empreinte ne bouge pas quand seule l'horloge tourne", () => {
    // Deux tours de la sentinelle sur le même dépôt et le même registre : même fait, même
    // empreinte. C'est la propriété qui rend le silence possible.
    const a = dEtat([["demo", "0.1.127"], ["vercel", "0.1.127"]]);
    const b = dEtat([["demo", "0.1.127"], ["vercel", "0.1.127"]]);
    expect(empreinte(a)).toBe(empreinte(b));
  });

  it("⚠️ mais elle bouge dès qu'un FAIT change — sinon le silence couvrirait une aggravation", () => {
    const sursis = dEtat([["demo", "0.1.127"]]);
    const rouge = dEtat([["demo", "0.1.126"]]);
    expect(empreinte(sursis)).not.toBe(empreinte(rouge));

    // Une publication de plus, le même exemple : passé de sursis à rouge sans qu'on y touche.
    const apresPublication = dEtat([["demo", "0.1.127"]], [...PUBLIEES, "0.1.129"]);
    expect(empreinte(sursis)).not.toBe(empreinte(apresPublication));

    // Un SECOND exemple qui décroche, alors que le premier n'a pas bougé.
    const unSeul = dEtat([["demo", "0.1.127"], ["vercel", "0.1.128"]]);
    const lesDeux = dEtat([["demo", "0.1.127"], ["vercel", "0.1.127"]]);
    expect(empreinte(unSeul)).not.toBe(empreinte(lesDeux));
  });

  it("⚠️ et l'ÉTAT compte, même quand la version et la dernière servie ne bougent pas", () => {
    // ⚠️ CE BANC EXISTE PARCE QUE SA MUTATION AVAIT SURVÉCU. Retirer `:${e.etat}` de l'empreinte
    // laissait les cinq autres au vert : l'état se DÉDUIT de la version et de la dernière servie…
    // sauf ici. Une version dépubliée fait glisser l'avant-dernière SANS toucher à la dernière :
    //
    //     servies [126, 127, 128], exemple sur 127  →  fenêtre [128, 127]  →  SURSIS
    //     127 dépubliée   [126, 128], exemple sur 127  →  fenêtre [128, 126]  →  ROUGE
    //
    // Même version épinglée, même `derniere`, état renversé — et c'est le tour où il faut parler.
    const avant = dEtat([["demo", "0.1.127"]], ["0.1.126", "0.1.127", "0.1.128"]);
    const apres = dEtat([["demo", "0.1.127"]], ["0.1.126", "0.1.128"]);
    expect(avant.etats[0].etat).toBe(SURSIS);
    expect(apres.etats[0].etat).toBe(ROUGE);
    expect(avant.derniere, "la dernière servie ne bouge pas — c'est tout l'intérêt du cas").toBe(apres.derniere);
    expect(empreinte(avant), "un renversement d'état passerait en silence").not.toBe(empreinte(apres));
  });

  it("l'ordre des exemples ne fabrique pas un fait neuf", () => {
    // Sans le tri, l'ordre de lecture du disque suffirait à re-notifier — une alarme qui dépend
    // de `readdir` est une alarme qui sonne au hasard.
    const a = dEtat([["demo", "0.1.127"], ["vercel", "0.1.126"]]);
    const b = dEtat([["vercel", "0.1.126"], ["demo", "0.1.127"]]);
    expect(empreinte(a)).toBe(empreinte(b));
  });

  it("le marqueur voyage DANS le corps — c'est ce que la forge relit", () => {
    const d = dEtat([["demo", "0.1.127"]]);
    expect(message(d)).toContain(marqueur(d));
    // Et il est invisible au lecteur : un commentaire HTML, pas une ligne de plus à lire.
    expect(marqueur(d)).toMatch(/^<!--.*-->$/);
  });

  it("⚠️ `dejaDit` reconnaît son propre message, et REFUSE celui d'un autre fait", () => {
    const sursis = dEtat([["demo", "0.1.127"]]);
    const rouge = dEtat([["demo", "0.1.126"]]);
    expect(dejaDit(message(sursis), sursis)).toBe(true);
    expect(dejaDit(message(rouge), sursis)).toBe(false);
    expect(dejaDit(message(sursis), rouge)).toBe(false);
  });

  it("⚠️ un fil VIDE de tout marqueur n'est jamais « déjà dit »", () => {
    // Le cas du premier tour après le correctif : l'issue #412 existe, son corps est ANTÉRIEUR au
    // marqueur. Se taire là-dessus laisserait l'alarme muette sur un fait jamais annoncé.
    const d = dEtat([["demo", "0.1.127"]]);
    expect(dejaDit("**3 exemple(s) sont en sursis** :\n- `examples/demo/package.json` …", d)).toBe(false);
    expect(dejaDit("", d)).toBe(false);
    expect(dejaDit(null, d)).toBe(false);
    expect(dejaDit(undefined, d)).toBe(false);
  });
});

// ⚠️ LA FORGE DOIT VRAIMENT S'EN SERVIR — sinon les cinq bancs ci-dessus prouvent une propriété
// que personne n'exerce, ce qui est exactement le défaut qu'on vient de corriger ailleurs.
describe("⚠️ ET L'ÉTAPE DE PUBLICATION LIT CE MARQUEUR", () => {
  const yml = readFileSync(new URL("../../.github/workflows/publication.yml", import.meta.url), "utf8");

  it("l'étape pose `marqueur` en sortie et le confronte au dernier énoncé", () => {
    expect(yml, "publication.yml ne lit plus la sortie `marqueur`").toContain("MARQUEUR: ${{ steps.retard.outputs.marqueur }}");
    expect(yml, "rien ne relit ce que l'issue dit déjà").toMatch(/gh issue view .*--json body,comments/);
    expect(yml, "le dernier énoncé doit être le DERNIER commentaire, ou le corps s'il n'y en a aucun")
      .toContain(".comments[-1].body else .body end");
  });

  it("⚠️ le commentaire est CONDITIONNÉ, pas inconditionnel", () => {
    // La forme d'avant — `gh issue comment` posé à la suite du `if`, sans garde — est exactement
    // ce qui a produit quatre commentaires identiques. On exige que l'appel vive dans la branche
    // qui ne reconnaît pas le marqueur.
    const bloc = yml.slice(yml.indexOf('case "$dernier" in'));
    expect(bloc, "le `case` sur le dernier énoncé a disparu").toContain('*"$MARQUEUR"*)');
    expect(bloc.indexOf("gh issue comment"), "le commentaire ne dépend plus du marqueur").toBeGreaterThan(0);
  });
});
