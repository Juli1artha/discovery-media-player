// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE CACHE DIT CE QU'IL A FAIT, PAS SEULEMENT CE QU'IL A REFUSÉ. `satures()` existait ; « servie de la
// mémoire », « regroupée sur une production en vol » et « produite » n'étaient comptées nulle part,
// et l'artefact de charge les demande (audit, 14/09) : sans elles, « le cache tient » est une phrase.

const { creerCache } = require("../cache.js");

describe("les compteurs du cache de lecture : servies, regroupées, produites, pic en vol", () => {
  it("une production, deux regroupées pendant qu'elle vole, puis deux servies de la mémoire", async () => {
    let t = 1000;
    const cache = creerCache({ ttlMs: 10_000, now: () => t });
    let liberer;
    const production = new Promise((r) => { liberer = r; });
    const p1 = cache.lire("k", () => production);
    const p2 = cache.lire("k", () => { throw new Error("ne doit pas produire"); });
    const p3 = cache.lire("k", () => { throw new Error("ne doit pas produire"); });
    expect(cache.compteurs()).toEqual({ hits: 0, coalesced: 2, misses: 1, peakInFlight: 1 });
    liberer("v");
    expect(await Promise.all([p1, p2, p3])).toEqual(["v", "v", "v"]);
    t += 1;
    expect(await cache.lire("k", () => { throw new Error("ne doit pas produire"); })).toBe("v");
    expect(await cache.lire("k", () => { throw new Error("ne doit pas produire"); })).toBe("v");
    expect(cache.compteurs()).toEqual({ hits: 2, coalesced: 2, misses: 1, peakInFlight: 1 });
  });
  it("⚠️ le pic en vol est le plus grand nombre de productions SIMULTANÉES, pas le nombre de productions", async () => {
    const cache = creerCache({ ttlMs: 10_000 });
    const liberations = [];
    const promesses = ["a", "b", "c"].map((k) => cache.lire(k, () => new Promise((r) => liberations.push(r))));
    expect(cache.compteurs().peakInFlight).toBe(3);
    // La production part sur une micro-tâche : les trois résolveurs ne sont poussés qu'après un tour.
    await new Promise((r) => setImmediate(r));
    expect(liberations).toHaveLength(3);
    liberations.forEach((r) => r("x"));
    await Promise.all(promesses);
    await cache.lire("d", async () => "y");
    expect(cache.compteurs()).toMatchObject({ misses: 4, peakInFlight: 3 });
    expect(cache.enVol()).toBe(0);
  });
  it("une production ROMPUE compte comme produite, et la lecture suivante reproduit (miss), jamais servie", async () => {
    const cache = creerCache({ ttlMs: 10_000 });
    await cache.lire("k", async () => { throw new Error("hoquet"); }).catch(() => {});
    await cache.lire("k", async () => "v");
    expect(cache.compteurs()).toMatchObject({ hits: 0, misses: 2, coalesced: 0 });
  });
});
