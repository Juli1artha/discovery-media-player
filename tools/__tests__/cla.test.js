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

const commit = (login, nom = "Quelqu'un") => ({ sha: "abc12345", author: login ? { login } : null, commit: { author: { name: nom } } });

describe("qui a écrit la PR", () => {
  it("part du login authentifié, pas de l'e-mail du commit", () => {
    // ⚠️ L'e-mail d'un commit est écrit par qui pousse : n'importe qui peut se dire n'importe qui.
    // Le login est ce que la forge a vérifié.
    expect(auteursDe([commit("alice"), commit("alice"), commit("bob")]).logins).toEqual(["alice", "bob"]);
  });

  it("SIGNALE un commit sans compte GitHub plutôt que de l'ignorer", () => {
    // Le silence est ce qui laisse passer : un auteur que la forge ne reconnaît pas ne peut pas
    // signer, donc il doit apparaître — pas disparaître.
    const { logins, sansCompte } = auteursDe([commit("alice"), commit(null, "Anonyme")]);
    expect(logins).toEqual(["alice"]);
    expect(sansCompte).toEqual(["Anonyme"]);
  });

  it("refuse un login qui n'a pas la forme d'un login GitHub", () => {
    expect(auteursDe([commit("pas un login !")]).logins).toEqual([]);
  });

  it("accepte les bots, qui ont des crochets", () => {
    expect(auteursDe([commit("dependabot[bot]")]).logins).toEqual(["dependabot[bot]"]);
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
    expect(verdict({ auteurs: ["alice"], sansCompte: [], registre: [{ name: "alice" }] }).ouvre).toBe(true);
  });

  it("ouvre pour une PR entièrement dispensée", () => {
    expect(verdict({ auteurs: ["Juli1artha", "claude"], sansCompte: [], registre: [] }).ouvre).toBe(true);
  });

  it("ferme et NOMME qui manque", () => {
    const v = verdict({ auteurs: ["alice", "bob"], sansCompte: [], registre: [{ name: "alice" }] });
    expect(v.ouvre).toBe(false);
    expect(v.manquants).toEqual(["bob"]);
  });

  it("⚠️ ferme aussi sur un commit sans compte, même si tous les autres ont signé", () => {
    // Un auteur que la forge ne reconnaît pas ne PEUT pas signer. Ouvrir quand même reviendrait
    // à fusionner du code que personne n'a concédé.
    const v = verdict({ auteurs: ["alice"], sansCompte: ["Anonyme"], registre: [{ name: "alice" }] });
    expect(v.ouvre).toBe(false);
    expect(v.sansCompte).toEqual(["Anonyme"]);
  });
});
