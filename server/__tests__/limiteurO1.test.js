// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE COMPTEUR DE DÉBIT LOCAL EST O(1) PAR DÉCISION — pas un balayage de tout l'historique.
//
// ⚠️ P1 PERFORMANCE : l'ancien compteur gardait un TABLEAU de timestamps par clé et le RE-FILTRAIT
// à chaque appel — quadratique quand une clé accumule (une clé à 88 400 entrées scannait 88 400
// valeurs même pour un REFUS). Et le plafond de 5 000 clés n'évinçait que les expirées, donc
// 5 001 clés actives restaient. Fenêtre fixe { debut, compte } + LRU à plafond DUR.
const { creerLimites } = require("../../context/standalone.js");

function limiteur() {
  // db qui refuse la table partagée → repli local pur ; journal muet.
  return creerLimites({ async request() { throw new Error("no table"); } }, { capture() {} });
}

describe("compteur de débit O(1)", () => {
  it("100 000 décisions sur la même clé en moins de 200 ms (pas de balayage quadratique)", async () => {
    const L = limiteur();
    const t0 = Date.now();
    for (let i = 0; i < 100000; i++) await L.allow("pread:meme", 1_000_000, 3600);
    const ms = Date.now() - t0;
    expect(ms, `100k décisions ont pris ${ms} ms`).toBeLessThan(200);
  });

  it("la fenêtre compte juste : max atteint → refus, fenêtre écoulée → de nouveau permis", async () => {
    const L = limiteur();
    for (let i = 0; i < 3; i++) expect(await L.allow("pread:k", 3, 1)).toBe(true);
    expect(await L.allow("pread:k", 3, 1), "4e dans la fenêtre → refus").toBe(false);
    await new Promise((r) => setTimeout(r, 1100));
    expect(await L.allow("pread:k", 3, 1), "fenêtre écoulée → permis").toBe(true);
  });

  it("le plafond de clés est DUR : 20 000 clés distinctes n'en laissent pas 20 000 en mémoire", async () => {
    const L = limiteur();
    for (let i = 0; i < 20000; i++) await L.allow(`pread:cle-${i}`, 5, 3600);
    // La clé la PLUS ANCIENNE doit avoir été évincée : elle repart à zéro (permise 5 fois de suite).
    let permises = 0;
    for (let i = 0; i < 6; i++) if (await L.allow("pread:cle-0", 5, 3600)) permises += 1;
    expect(permises, "cle-0 évincée → compteur reparti à zéro (5 permises)").toBe(5);
  });
});
