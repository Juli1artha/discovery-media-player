// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ « TOUT NOMBRE FINI POSITIF » N'EST PAS UN DÉLAI. `setTimeout` plafonne à 2 147 483 647 ms et
// ramène tout dépassement à 1 ms : un `relayStallMs` de 2 147 483 648 abandonnait un transfert en
// 6 ms, avec 65 TimeoutOverflowWarning (audit externe, cinquième passe, 13/09). Ces bancs fixent la
// borne : un entier sûr dans une plage écrite, le défaut sinon, et le refus nommé.

const B = require("../bornes.js");

describe("⚠️ entierBorne : un entier sûr dans la plage, sinon le défaut — et il le dit", () => {
  const plage = { defaut: 30_000, min: B.RELAIS_MS_MIN, max: B.RELAIS_MS_MAX };
  it("la borne haute passe, la borne haute + 1 tombe", () => {
    expect(B.entierBorne(B.RELAIS_MS_MAX, plage)).toEqual({ valeur: B.RELAIS_MS_MAX, valide: true, posee: true });
    expect(B.entierBorne(B.RELAIS_MS_MAX + 1, plage)).toEqual({ valeur: 30_000, valide: false, posee: true });
  });
  it("⚠️ la borne haute est SOUS la limite native de setTimeout — sinon elle ne bornerait rien", () => {
    expect(B.RELAIS_MS_MAX).toBeLessThan(2_147_483_647);
  });
  it.each([
    ["Infinity", Infinity], ["négatif", -1], ["zéro", 0], ["chaîne illisible", "trente secondes"],
    ["décimale", 30.5], ["au-delà de setTimeout", 2_147_483_648], ["NaN", NaN], ["booléen", true],
  ])("%s → défaut, refusé", (_n, v) => {
    const r = B.entierBorne(v, plage);
    expect(r.valeur).toBe(30_000);
    expect(r.valide).toBe(false);
  });
  it("une chaîne numérique entière passe (l'environnement ne connaît que des chaînes)", () => {
    expect(B.entierBorne("45000", plage)).toEqual({ valeur: 45_000, valide: true, posee: true });
  });
  it("non posé (undefined, null, chaîne vide) → défaut, et ce n'est PAS un refus", () => {
    for (const v of [undefined, null, ""]) expect(B.entierBorne(v, plage)).toEqual({ valeur: 30_000, valide: true, posee: false });
  });
});

describe("bornesRelais : les trois réglages, et la liste de ce qui a été refusé", () => {
  it("sans configuration : les défauts, rien de refusé", () => {
    expect(B.bornesRelais(undefined)).toEqual({ plafond: 64, stallMs: 30_000, maxMs: 900_000, invalides: [] });
  });
  it("chaque refus nomme la clé, la valeur reçue, la plage et le défaut", () => {
    const r = B.bornesRelais({ maxConcurrentRelays: 4096, relayStallMs: "abc", relayMaxMs: 1.5 });
    expect(r).toMatchObject({ plafond: 64, stallMs: 30_000, maxMs: 900_000 });
    expect(r.invalides).toEqual([
      "maxConcurrentRelays=4096 (entier de 1 à 1024, défaut 64)",
      "relayStallMs=abc (entier de 1 à 86400000 ms, défaut 30000)",
      "relayMaxMs=1.5 (entier de 1 à 86400000 ms, défaut 900000)",
    ]);
  });
  it("⚠️ le plafond de relais a une borne HAUTE de configuration : 1024 — 64 × 8 Mio ont fait monter la RSS de 130 à 194 Mio", () => {
    expect(B.bornesRelais({ maxConcurrentRelays: 1024 }).plafond).toBe(1024);
    expect(B.bornesRelais({ maxConcurrentRelays: 1025 }).plafond).toBe(64);
    expect(B.bornesRelais({ maxConcurrentRelays: 0 }).plafond).toBe(64);
  });
});
