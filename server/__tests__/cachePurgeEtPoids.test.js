// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE CACHE NE GARDE NI CE QUI EST PÉRIMÉ, NI PLUS QUE SON POIDS — ET NE LÂCHE PAS UNE DEMANDE EN VOL.
//
// ⚠️ P1 d'audit externe. Le cache bornait le NOMBRE d'entrées (500) et jamais leur poids, et ne
// purgeait rien à l'expiration : une entrée périmée restait jusqu'à ce qu'une autre la pousse dehors.
// Or la clé porte `chatAfter`, un curseur que le visiteur fait varier à volonté, et une réponse de chat
// peut peser des centaines de kilo-octets — 500 × 600 Ko ≈ 286 Mo retenus par processus, à la demande.
//
// Trois propriétés, et la troisième est celle qu'on casse en corrigeant les deux premières.

const { creerCache } = require("../cache.js");

/** Horloge pilotée : le temps ne doit pas dépendre de la vitesse du banc. */
function horloge(depart = 1_000_000) {
  let t = depart;
  return { maintenant: () => t, avancer: (ms) => { t += ms; } };
}

describe("cache — purge, poids, et regroupement", () => {
  it("PURGE : 500 entrées périmées retombent à zéro au premier accès suivant", async () => {
    const h = horloge();
    const c = creerCache({ ttlMs: 400, max: 1000, maxOctets: 1e9, now: h.maintenant });
    for (let i = 0; i < 500; i += 1) await c.lire(`chat:s:a${i}`, async () => "x".repeat(600));
    expect(c.taille()).toBe(500);

    h.avancer(60_000);                       // bien au-delà du TTL
    await c.lire("une-autre", async () => "y");
    expect(c.taille(), "les périmées devaient partir, pas attendre d'être poussées").toBe(1);
    expect(c.poids()).toBe(1);
  });

  it("POIDS : le plafond d'octets borne l'attaque par curseur, même sous le plafond d'entrées", async () => {
    const h = horloge();
    const c = creerCache({ ttlMs: 60_000, max: 10_000, maxOctets: 100_000, now: h.maintenant });
    // 500 réponses de 600 caractères = 300 000 > 100 000 : le nombre ne borne rien, le poids si.
    for (let i = 0; i < 500; i += 1) await c.lire(`chat:s:a${i}`, async () => "x".repeat(600));
    expect(c.poids(), "le poids retenu doit rester sous le plafond").toBeLessThanOrEqual(100_000);
    expect(c.taille(), "et donc bien moins que 500 entrées").toBeLessThan(500);
  });

  it("ENTRÉES : le plafond de nombre s'applique aussi", async () => {
    const h = horloge();
    const c = creerCache({ ttlMs: 60_000, max: 50, maxOctets: 1e9, now: h.maintenant });
    for (let i = 0; i < 200; i += 1) await c.lire(`k${i}`, async () => "x");
    expect(c.taille()).toBeLessThanOrEqual(50);
  });

  // ⚠️ CELLE-CI EST LA PLUS FACILE À CASSER EN CORRIGEANT LES AUTRES : purger ou évincer une demande
  // EN VOL ne libère rien (elle est déjà lancée) et relance la production chez l'appelant suivant —
  // c'est-à-dire exactement ce que ce cache existe pour éviter.
  it("EN VOL : une production lente reste partagée, et n'est ni purgée ni évincée", async () => {
    const h = horloge();
    const c = creerCache({ ttlMs: 400, max: 2, maxOctets: 10, now: h.maintenant });
    let productions = 0;
    let debloquer;
    const lente = () => { productions += 1; return new Promise((r) => { debloquer = () => r("resultat"); }); };

    const a = c.lire("lente", lente);
    h.avancer(10_000);                        // le TTL serait dépassé si l'échéance partait de la DEMANDE
    for (let i = 0; i < 20; i += 1) await c.lire(`bruit${i}`, async () => "z");  // pression d'éviction
    const b = c.lire("lente", lente);

    debloquer();
    expect(await a).toBe("resultat");
    expect(await b, "le second appelant doit recevoir LA MÊME production").toBe("resultat");
    expect(productions, "une seule production, malgré le temps écoulé et l'éviction").toBe(1);
  });

  it("l'échéance part de la RÉSOLUTION : une production lente reste fraîche après coup", async () => {
    const h = horloge();
    const c = creerCache({ ttlMs: 1000, max: 10, maxOctets: 1e9, now: h.maintenant });
    let productions = 0;
    let debloquer;
    const p = c.lire("k", () => { productions += 1; return new Promise((r) => { debloquer = () => r("v"); }); });
    // ⚠️ `produire` est appelé dans une MICRO-TÂCHE : sans céder un tour, `debloquer` n'existe pas
    // encore. Le banc doit attendre que la production ait commencé avant de la débloquer.
    await Promise.resolve();
    h.avancer(5000);                          // production plus longue que le TTL
    debloquer(); await p;
    await c.lire("k", async () => { productions += 1; return "v2"; });
    expect(productions, "elle vient de résoudre : elle est fraîche, pas déjà périmée").toBe(1);
  });

  it("une promesse ROMPUE n'est pas gardée (le rétablissement n'attend pas la fenêtre)", async () => {
    const h = horloge();
    const c = creerCache({ ttlMs: 60_000, max: 10, maxOctets: 1e9, now: h.maintenant });
    await c.lire("k", async () => { throw new Error("hoquet"); }).catch(() => {});
    expect(c.taille()).toBe(0);
    expect(await c.lire("k", async () => "ok"), "l'appel suivant reproduit").toBe("ok");
  });
});
