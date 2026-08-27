// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN SCAN QUI NE S'EST PAS TERMINÉ N'EST PAS UNE ALERTE NON TRIÉE.
//
// ⚠️ LE FAIT QUI A ÉCRIT CE FICHIER (27/08, course 33102994676). L'étape ZAP a annoncé « alerte non
// triée sur http://localhost:3000/doc/zap-doc », et a envoyé le lecteur vers `.zap/rules.tsv` et
// vers un rapport de l'artefact. Les deux étaient vides de la réponse : `zap-baseline.py` s'était
// interrompu sans rendre de verdict — pas de ligne de synthèse, et DEUX rapports téléversés pour
// TROIS surfaces. Le message nommait la seule cause que le shell savait dire.
//
// Les cas ci-dessous sont les quatre croisements de « le scanner a-t-il rendu 0 ? » et « a-t-il
// écrit son rapport ? ». Deux d'entre eux n'existaient pas avant ce fichier : le vert sans preuve,
// et le rouge sans verdict — celui de la course.

import { describe, it, expect } from "vitest";

import {
  analyser,
  lireAnnonce,
  nomDuRapport,
  principal,
  verdictDeLaSurface,
} from "../verdict-zap.mjs";
import { CONFORME, VIOLATION, INCONCLUSIF } from "../resultat-garde.mjs";

const DOC = { nom: "doc", cible: "http://localhost:3000/doc/zap-doc", code: 0 };
const tous = () => true;

describe("le verdict d'une surface croise le code ET la preuve", () => {
  it("code 0 avec rapport : le scan a conclu et n'a rien à signaler", () => {
    expect(verdictDeLaSurface(DOC, true).etat).toBe("conforme");
  });

  // ⚠️ LE TROU QUE PERSONNE NE VOYAIT. Avant ce fichier, rien ne vérifiait qu'un scan sorti en 0
  // avait produit quoi que ce soit : un scanner muet qui rend 0 passait pour une surface saine.
  it("⚠️ code 0 SANS rapport : un vert sans preuve ne dit rien de la surface", () => {
    const v = verdictDeLaSurface(DOC, false);
    expect(v.etat).toBe("aveugle");
    expect(v.dit).toMatch(/AUCUN rapport-doc\.html/);
  });

  it("code non nul AVEC rapport : le scan a conclu, son verdict est une alerte non triée", () => {
    const v = verdictDeLaSurface({ ...DOC, code: 2 }, true);
    expect(v.etat).toBe("violation");
    expect(v.dit).toMatch(/alerte non triée/);
    expect(v.dit, "le tri est une décision écrite par règle : le message doit y mener").toMatch(/rules\.tsv/);
  });

  // ⚠️ LE CAS DE LA COURSE. C'est ici que l'ancienne écriture mentait.
  it("⚠️ code non nul SANS rapport : le scan ne s'est pas terminé, rien n'a été trié", () => {
    const v = verdictDeLaSurface({ ...DOC, code: 3 }, false);
    expect(v.etat).toBe("aveugle");
    expect(v.dit).toMatch(/NE S'EST PAS TERMINÉ/);
    // La consigne qui a coûté vingt minutes : ne renvoyez PAS le lecteur trier ce qui n'existe pas.
    expect(v.dit).toMatch(/ne cherchez pas dans \.zap\/rules\.tsv/);
    expect(v.dit, "le correctif n'est pas dans la branche de l'auteur").toMatch(/pas dans la branche/);
  });
});

describe("le verdict de la passe entière", () => {
  const trois = [
    { nom: "accueil", cible: "http://localhost:3000/", code: 0 },
    DOC,
    { nom: "present", cible: "http://localhost:3000/present/zap-direct", code: 0 },
  ];

  it("les trois surfaces concluent et écrivent : conforme", () => {
    const r = analyser(trois, tous);
    expect(r.code).toBe(CONFORME);
    expect(r.resume).toMatch(/3 surface/);
  });

  // ⚠️ LA COURSE REJOUÉE, DANS SA FORME EXACTE : deux surfaces vertes avec leur rapport, une
  // interrompue sans le sien. L'ancienne écriture rendait « alerte non triée ». Celle-ci rend un
  // NON CONCLUANT, qui dit à l'auteur que sa branche n'est pas en cause.
  it("⚠️ la course 33102994676 : deux surfaces conclues, une interrompue", () => {
    const passe = trois.map((s) => (s.nom === "doc" ? { ...s, code: 3 } : s));
    const r = analyser(passe, (nom) => nom !== "doc");
    expect(r.code, "un scan interrompu n'accuse pas la branche").toBe(INCONCLUSIF);
    expect(r.raisons).toHaveLength(1);
    expect(r.raisons[0]).toMatch(/zap-doc/);
    expect(r.raisons[0]).toMatch(/NE S'EST PAS TERMINÉ/);
  });

  it("une alerte non triée sur une surface qui a conclu accuse bien la branche", () => {
    const r = analyser([{ ...DOC, code: 2 }], tous);
    expect(r.code).toBe(VIOLATION);
    expect(r.constats).toHaveLength(1);
  });

  // ⚠️ LA COMPOSITION DES DEUX, ET LE SENS DU CODE RENDU. Sortir 2 ici dirait « le correctif n'est
  // pas dans ta branche » alors qu'une alerte réelle y attend. C'est 1 — et la surface aveugle ne
  // disparaît pas pour autant : elle voyage en avertissement.
  it("⚠️ violation ET cécité : la violation donne le code, la cécité reste dite", () => {
    const passe = [
      { nom: "accueil", cible: "http://localhost:3000/", code: 2 },
      { ...DOC, code: 3 },
    ];
    const r = analyser(passe, (nom) => nom === "accueil");
    expect(r.code, "une alerte réelle attend dans la branche : 2 dirait le contraire").toBe(VIOLATION);
    expect(r.constats).toHaveLength(1);
    expect(r.avertissements.join("\n"), "la surface aveugle ne disparaît pas derrière la violation")
      .toMatch(/zap-doc/);
  });

  // ⚠️ LE PLANCHER. Sans lui, une boucle qui n'aurait rien lancé rendrait « tout va bien » — la
  // vacuité que `zap.yml` refuse deux étapes plus haut pour les surfaces elles-mêmes.
  it("⚠️ aucune surface annoncée : la sonde vise à côté, elle ne conclut pas au vert", () => {
    const r = analyser([], tous);
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/vise à côté/);
  });

  // Un témoin qui ne vient pas de l'appelant : le disque.
  it("un rapport présent pour une surface non annoncée est dit, sans faire échouer", () => {
    const r = analyser([DOC], tous, [nomDuRapport("doc"), nomDuRapport("fantome")]);
    expect(r.code).toBe(CONFORME);
    expect(r.avertissements.join("\n")).toMatch(/rapport-fantome\.html/);
  });

  it("aucun avertissement quand le disque et l'appelant s'accordent", () => {
    expect(analyser([DOC], tous, [nomDuRapport("doc")]).avertissements).toEqual([]);
  });
});

describe("lire ce que l'appelant annonce", () => {
  it("rend le nom, la cible et le code", () => {
    expect(lireAnnonce("doc=http://localhost:3000/doc/zap-doc=3"))
      .toEqual({ nom: "doc", cible: "http://localhost:3000/doc/zap-doc", code: 3 });
  });

  // ⚠️ UNE URL PEUT PORTER UN `=`. Découper sur le premier séparateur rendrait une cible tronquée —
  // donc un message qui nomme une adresse qui n'a jamais été scannée.
  it("⚠️ une cible qui contient un `=` reste entière", () => {
    const lue = lireAnnonce("api=http://localhost:3000/api/doc?name=x.pdf=1");
    expect(lue.cible).toBe("http://localhost:3000/api/doc?name=x.pdf");
    expect(lue.code).toBe(1);
  });

  it("refuse ce qui n'a pas la forme attendue", () => {
    for (const brut of ["", "doc", "doc=", "=http://x=1", "doc=http://x=", "doc=http://x=oui"]) {
      expect(lireAnnonce(brut), `« ${brut} » n'est pas une annonce lisible`).toBeNull();
    }
  });
});

describe("le point d'entrée refuse plutôt que de deviner", () => {
  it("⚠️ une annonce illisible ne devient pas un vert sur une surface jamais jugée", () => {
    const r = principal(["/tmp/absent", "doc=http://x=1", "n-importe-quoi"]);
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/annonce illisible/);
  });

  it("sans aucune annonce, il refuse — c'est ce que le dépôt vide éprouve", () => {
    expect(principal([]).code).toBe(INCONCLUSIF);
  });

  // Un dossier qui n'existe pas ne peut pas porter de rapport : la surface est aveugle, pas saine.
  it("un dossier de rapports absent rend toutes les surfaces aveugles", () => {
    const r = principal(["/tmp/dossier-qui-n-existe-pas-verdict-zap", "doc=http://x=0"]);
    expect(r.code, "aucun rapport lisible : rien n'est prouvé").toBe(INCONCLUSIF);
  });
});
