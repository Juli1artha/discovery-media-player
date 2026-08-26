// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES RÈGLES DU CLA, ÉPROUVÉES AVANT DE TENIR LA PORTE.
//
// ⚠️ CE BANC EST LA CONDITION POUR REMPLACER UNE ACTION TIERCE. `contributor-assistant/
// github-action` est archivée depuis mars 2026 ; tant que le CLA n'était que signalé, en
// dépendre était supportable. Depuis qu'il est BLOQUANT, ce code décide si une contribution
// entre ou non — et un bug ici ne se traduit pas par un test rouge mais par une porte ouverte
// (une licence jamais concédée) ou une porte murée (plus aucune PR ne passe).
//
// Les deux sens sont donc éprouvés : ce qui doit passer passe, ce qui doit être refusé l'est.

import { describe, it, expect } from "vitest";
import {
  PHRASE_DE_SIGNATURE, DISPENSES, auteursDe, lireRegistre, nonSignes,
  signatureDans, avecSignature, ecrireRegistre, verdict,
} from "../cla/regles.mjs";

const commit = (login, nom = "Quelqu'un", message = "un commit") =>
  ({ sha: "abc12345", author: login ? { login } : null, commit: { author: { name: nom }, message } });

/** L'appel courant : une PR ouverte par `auteurPR`, dont les commits sont attribués comme dit. */
const pr = (auteurPR, ...commits) => auteursDe({ auteurPR, commits });

describe("⚠️ QUI DOIT SIGNER — attribution et authentification ne sont pas la même chose", () => {
  // Ce module confondait les deux, et c'était CONTOURNABLE (P0, revue externe du 21/08). Il ne
  // partait que de `commit.author.login` en affirmant que « le login est ce que la forge a
  // authentifié ». C'est faux : GitHub RATTACHE un commit à un compte par l'adresse de l'en-tête
  // Git, écrite localement par qui fabrique le commit. C'est de l'attribution, pas de la preuve.

  it("⚠️ LE CONTOURNEMENT : usurper l'adresse d'un dispensé n'efface plus sa propre obligation", () => {
    // `mallory` ouvre la PR ; ses commits portent l'adresse du mainteneur, donc GitHub les
    // attribue à `Juli1artha`, qui est dispensé. L'ancien code rendait « ouvre: true, manquants: [] »
    // et `mallory` n'apparaissait nulle part.
    const a = pr("mallory", commit("Juli1artha", "mallory"));
    expect(a.authentifie).toBe("mallory");
    expect(a.attribues).toEqual(["Juli1artha"]);
    const v = verdict({ ...a, registre: [] });
    expect(v.ouvre).toBe(false);
    expect(v.manquants).toEqual(["mallory"]);
  });

  it("l'attribution AJOUTE des obligations, elle n'en retire jamais", () => {
    const a = pr("alice", commit("bob"), commit("carol"));
    expect(a.authentifie).toBe("alice");
    expect(a.attribues).toEqual(["bob", "carol"]);
    expect(verdict({ ...a, registre: [] }).manquants).toEqual(["alice", "bob", "carol"]);
  });

  it("l'auteur authentifié n'est pas compté deux fois quand il est aussi attribué", () => {
    const a = pr("alice", commit("alice"), commit("alice"));
    expect(a.attribues).toEqual([]);
    expect(a.logins).toEqual(["alice"]);
  });

  it("⚠️ sans auteur authentifié, on REFUSE — il n'y a plus d'ancre", () => {
    const a = pr(null, commit("alice"));
    expect(a.authentifie).toBeNull();
    const v = verdict({ ...a, registre: [{ name: "alice" }] });
    expect(v.ouvre).toBe(false);
    expect(v.sansCompte.join(" ")).toMatch(/auteur de la pull request n'a pas pu être identifié/);
  });

  it("refuse un login qui n'a pas la forme d'un login GitHub", () => {
    expect(pr("alice", commit("pas un login !")).attribues).toEqual([]);
    expect(pr("pas un login !", commit("alice")).authentifie).toBeNull();
  });

  it("accepte les bots, qui ont des crochets", () => {
    expect(pr("alice", commit("dependabot[bot]")).attribues).toEqual(["dependabot[bot]"]);
  });

  it("SIGNALE un commit sans compte GitHub plutôt que de l'ignorer", () => {
    const a = pr("alice", commit("alice"), commit(null, "Anonyme"));
    expect(a.sansCompte).toEqual(["Anonyme"]);
  });
});

describe("les co-auteurs — la contribution que le diff ne montre pas", () => {
  const avecCo = (ligne) => pr("alice", commit("alice", "alice", `un commit\n\n${ligne}`));

  it("résout une adresse noreply GitHub en login, et l'ajoute aux signataires attendus", () => {
    expect(avecCo("Co-authored-by: Bob <12345+bob@users.noreply.github.com>").attribues).toEqual(["bob"]);
    expect(avecCo("Co-authored-by: Bob <bob@users.noreply.github.com>").attribues).toEqual(["bob"]);
  });

  it("est insensible à la casse du trailer, comme git", () => {
    expect(avecCo("co-authored-by: Bob <bob@users.noreply.github.com>").attribues).toEqual(["bob"]);
  });

  it("⚠️ BLOQUE sur un co-auteur qu'aucun compte ne porte, en le nommant", () => {
    // On ne peut pas demander sa signature à quelqu'un qu'on ne sait pas joindre. L'ignorer
    // serait le laisser passer — c'est exactement le silence que ce fichier refuse.
    const a = avecCo("Co-authored-by: Carol <carol@exemple.test>");
    expect(a.sansCompte).toEqual(["Carol <carol@exemple.test> (co-auteur)"]);
    expect(verdict({ ...a, registre: [{ name: "alice" }] }).ouvre).toBe(false);
  });

  it("ne réclame rien pour une adresse dispensée — même doctrine que les bots", () => {
    const a = avecCo("Co-Authored-By: Claude <noreply@anthropic.com>");
    expect(a.attribues).toEqual([]);
    expect(a.sansCompte).toEqual([]);
    expect(verdict({ ...a, registre: [{ name: "alice" }] }).ouvre).toBe(true);
  });

  it("ne prend pas pour un trailer une ligne qui lui ressemble sans en être un", () => {
    expect(avecCo("on parle de Co-authored-by dans cette phrase").sansCompte).toEqual([]);
  });
});

describe("le registre des signatures", () => {
  it("lit une liste normale", () => {
    expect(lireRegistre('{"signedContributors":[{"name":"alice"}]}')).toEqual([{ name: "alice" }]);
  });

  it("traite un registre vide comme vide, pas comme une erreur", () => {
    expect(lireRegistre('{"signedContributors":[]}')).toEqual([]);
    expect(lireRegistre("")).toEqual([]);
  });

  it("REFUSE un registre illisible au lieu de supposer que personne n'a signé", () => {
    // ⚠️ Un JSON cassé traité comme « liste vide » redemanderait leur signature à tous ceux qui
    // ont déjà signé — et, pire, la réécrirait par-dessus. On échoue bruyamment.
    expect(() => lireRegistre("{ pas du json")).toThrow(/ne se parse pas/);
  });

  it("ignore une entrée sans nom plutôt que de la compter", () => {
    expect(lireRegistre('{"signedContributors":[{"id":1},{"name":"bob"}]}')).toEqual([{ name: "bob" }]);
  });
});

describe("qui doit encore signer", () => {
  it("celui qui n'a pas signé", () => {
    expect(nonSignes(["alice"], [])).toEqual(["alice"]);
  });

  it("plus personne quand la signature est là", () => {
    expect(nonSignes(["alice"], [{ name: "alice" }])).toEqual([]);
  });

  it("la casse du login ne fait pas resigner", () => {
    expect(nonSignes(["Alice"], [{ name: "alice" }])).toEqual([]);
  });

  it("le mainteneur ne signe pas — il est le concédant", () => {
    expect(nonSignes(["Juli1artha"], [])).toEqual([]);
  });

  it("les bots non plus : rien à concéder", () => {
    expect(nonSignes(["dependabot[bot]", "github-actions[bot]", "claude"], [])).toEqual([]);
    expect(DISPENSES).toContain("claude");
  });

  it("⚠️ `claude[bot]` est le MÊME agent que `claude`, sous l'identité que GitHub donne à l'API", () => {
    // Le cas réel : la PR #392, ouverte par l'API, est sortie signée `claude[bot]` et ce contrôle
    // l'a refusée — sur un contenu identique à celui qui passait la veille sous `claude`. Deux
    // identités pour une même main, selon le CHEMIN par lequel la contribution arrive.
    expect(nonSignes(["claude[bot]"], [])).toEqual([]);
    expect(DISPENSES).toContain("claude[bot]");
  });

  it("⚠️ et l'élargissement s'arrête là : un login qui ressemble à un bot dispensé signe quand même", () => {
    // La dispense couvre des identités NOMMÉES, jamais une forme. Sans ce banc, la liste pourrait
    // dériver vers « tout ce qui finit par [bot] », ce qui laisserait passer n'importe quelle
    // application tierce installée sur le dépôt.
    expect(nonSignes(["claude-fork[bot]", "notclaude[bot]", "claudebot"], []))
      .toEqual(["claude-fork[bot]", "notclaude[bot]", "claudebot"]);
  });

  it("une dispense ne couvre pas un inconnu qui lui ressemble", () => {
    expect(nonSignes(["Juli1artha-bis"], [])).toEqual(["Juli1artha-bis"]);
  });
});

describe("ce qui vaut signature", () => {
  it("la phrase exacte, par un auteur de la PR", () => {
    expect(signatureDans(PHRASE_DE_SIGNATURE, "alice", ["alice"])).toBe("alice");
  });

  it("tolère les espaces autour et un point final — un client de messagerie en ajoute", () => {
    expect(signatureDans(`  ${PHRASE_DE_SIGNATURE}.  `, "alice", ["alice"])).toBe("alice");
  });

  it("REFUSE une reformulation : ce qui se concède ici est une licence", () => {
    expect(signatureDans("je signe le CLA", "alice", ["alice"])).toBeNull();
    expect(signatureDans("I hereby sign the CLA", "alice", ["alice"])).toBeNull();
  });

  it("REFUSE la phrase noyée dans un autre message", () => {
    expect(signatureDans(`Bonjour ! ${PHRASE_DE_SIGNATURE} merci`, "alice", ["alice"])).toBeNull();
  });

  it("⚠️ REFUSE qu'un tiers signe à la place d'un auteur", () => {
    // Le point le plus important de ce fichier : une signature n'engage que celui qui la donne.
    expect(signatureDans(PHRASE_DE_SIGNATURE, "carol", ["alice", "bob"])).toBeNull();
  });

  it("retrouve l'auteur quelle que soit la casse", () => {
    expect(signatureDans(PHRASE_DE_SIGNATURE, "ALICE", ["alice"])).toBe("alice");
  });
});

describe("ajouter une signature", () => {
  const meta = { id: 42, pullRequestNo: 7, horodatage: "2026-08-21T12:00:00Z" };

  it("l'inscrit avec sa trace", () => {
    expect(avecSignature([], "alice", meta)).toEqual([
      { name: "alice", id: 42, pullRequestNo: 7, created_at: "2026-08-21T12:00:00Z" },
    ]);
  });

  it("signer deux fois ne duplique pas — une relance ne doit rien casser", () => {
    const une = avecSignature([], "alice", meta);
    expect(avecSignature(une, "alice", meta)).toHaveLength(1);
  });

  it("n'efface jamais une signature existante", () => {
    const avant = [{ name: "bob", id: 1 }];
    expect(avecSignature(avant, "alice", meta)).toContainEqual({ name: "bob", id: 1 });
  });

  it("s'écrit trié et lisible — un registre est fait pour être relu par un humain", () => {
    const texte = ecrireRegistre([{ name: "bob" }, { name: "alice" }]);
    expect(texte.indexOf('"alice"')).toBeLessThan(texte.indexOf('"bob"'));
    expect(texte.endsWith("\n")).toBe(true);
    expect(lireRegistre(texte)).toHaveLength(2);
  });
});

describe("le verdict — la porte s'ouvre, ou elle nomme ce qui manque", () => {
  it("ouvre quand tout le monde a signé", () => {
    expect(verdict({ authentifie: "alice", attribues: [], sansCompte: [], registre: [{ name: "alice" }] }).ouvre).toBe(true);
  });

  it("ouvre pour une PR entièrement dispensée", () => {
    expect(verdict({ authentifie: "Juli1artha", attribues: ["claude"], sansCompte: [], registre: [] }).ouvre).toBe(true);
  });

  it("ferme et NOMME qui manque", () => {
    const v = verdict({ authentifie: "alice", attribues: ["bob"], sansCompte: [], registre: [{ name: "alice" }] });
    expect(v.ouvre).toBe(false);
    expect(v.manquants).toEqual(["bob"]);
  });

  it("⚠️ ferme aussi sur un commit sans compte, même si tous les autres ont signé", () => {
    // Un auteur que la forge ne reconnaît pas ne PEUT pas signer. Ouvrir quand même reviendrait
    // à fusionner du code que personne n'a concédé.
    const v = verdict({ authentifie: "alice", attribues: [], sansCompte: ["Anonyme"], registre: [{ name: "alice" }] });
    expect(v.ouvre).toBe(false);
    expect(v.sansCompte).toEqual(["Anonyme"]);
  });
});
