// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'ADMISSION DU CACHE EST BORNÉE — LE PLAFOND DES RÉSULTATS N'EN BORNAIT AUCUNE.
//
// ⚠️ P1 d'audit externe, MESURÉ avant d'être corrigé : avec `max: 100`, dix mille clés distinctes
// dont la production ne répond pas donnaient dix mille entrées ET dix mille producteurs — donc
// autant de requêtes, sockets et promesses ouvertes. La cause est que l'éviction ne touche jamais
// une entrée EN VOL (l'évincer casserait le regroupement, qui est la raison d'être du cache) : le
// plafond ne s'appliquait donc qu'à ce qui était déjà RÉSOLU.
//
// C'est la classe « une garde qui protège un état protège mal la TRANSITION vers cet état ». Borner
// les résultats ne borne pas les demandes ; seule l'admission borne une base lente.

const { creerCache, CODE_SATURATION } = require("../cache.js");

/** Une production qui ne répond jamais — le cas exact du P1 (base lente, socket ouverte). */
const pendante = (compteur) => () => { compteur.n += 1; return new Promise(() => {}); };
const tick = () => new Promise((r) => setImmediate(r));

describe("admission bornée sous demandes pendantes", () => {
  it("10 000 clés pendantes : taille ET producteurs restent sous le plafond d'admission", async () => {
    const c = creerCache({ ttlMs: 400, max: 100, maxEnVol: 128 });
    const compteur = { n: 0 };
    let refus = 0;
    for (let i = 0; i < 10000; i++) {
      c.lire("k" + i, pendante(compteur)).catch((e) => { if (e && e.code === CODE_SATURATION) refus += 1; });
    }
    await tick();
    expect(c.enVol(), "le plafond d'admission est DUR").toBe(128);
    expect(compteur.n, "une demande refusée ne doit PAS avoir appelé la production").toBe(128);
    expect(c.taille(), "aucune entrée fantôme au-delà du plafond").toBe(128);
    expect(refus, "tout le reste est refusé, explicitement").toBe(10000 - 128);
  });

  it("saturation : la production n'est jamais appelée pour une clé refusée", async () => {
    const c = creerCache({ ttlMs: 400, maxEnVol: 2 });
    const compteur = { n: 0 };
    c.lire("a", pendante(compteur)).catch(() => {}); c.lire("b", pendante(compteur)).catch(() => {});
    await tick();
    let vue = null;
    await c.lire("c", pendante(compteur)).catch((e) => { vue = e; });
    expect(compteur.n, "aucune requête base de plus").toBe(2);
    expect(vue && vue.code).toBe(CODE_SATURATION);
    expect(vue && vue.statusCode, "typée pour que la route rende 503, pas 500").toBe(503);
  });

  // ⚠️ L'ORDRE DES DEUX TESTS DE `lire` EST LE CŒUR : refuser AVANT de partager punirait la rafale
  // légitime — vingt-cinq spectateurs sur une même présentation — que ce cache existe pour absorber.
  it("une clé DÉJÀ en vol se partage même au plafond : la saturation ne casse pas le regroupement", async () => {
    const c = creerCache({ ttlMs: 400, maxEnVol: 1 });
    const compteur = { n: 0 };
    c.lire("meme", pendante(compteur)).catch(() => {});
    await tick();
    expect(c.enVol(), "le plafond de 1 est ATTEINT — sans quoi ce test ne prouverait rien").toBe(1);

    // Le second appel sur la MÊME clé, plafond plein : il doit être servi, pas refusé.
    let refuse = null;
    c.lire("meme", pendante(compteur)).catch((e) => { refuse = e; });
    await tick();
    expect(refuse, "un appelant que le regroupement pouvait servir gratuitement a été refusé").toBeNull();
    expect(compteur.n, "et sans production supplémentaire").toBe(1);

    // Contrôle : une clé DIFFÉRENTE, elle, est bien refusée — sinon le plafond ne tient rien.
    let refuseAutre = null;
    c.lire("autre", pendante(compteur)).catch((e) => { refuseAutre = e; });
    await tick();
    expect(refuseAutre && refuseAutre.code, "le plafond doit continuer de refuser le reste").toBe(CODE_SATURATION);
  });

  it("même clé demandée 1 000 fois : un seul producteur", async () => {
    const c = creerCache({ ttlMs: 400, maxEnVol: 128 });
    const compteur = { n: 0 };
    for (let i = 0; i < 1000; i++) c.lire("meme", pendante(compteur)).catch(() => {});
    await tick();
    expect(compteur.n).toBe(1);
    expect(c.enVol()).toBe(1);
  });

  it("la place est rendue APRÈS résolution comme après REJET — sinon le plafond se remplit à vie", async () => {
    const c = creerCache({ ttlMs: 50, maxEnVol: 2 });
    await c.lire("ok", async () => "v");
    await c.lire("ko", async () => { throw new Error("base"); }).catch(() => {});
    await tick();
    expect(c.enVol(), "un incident de base ne doit pas consommer une place définitivement").toBe(0);
    // et le cache admet de nouveau
    const compteur = { n: 0 };
    c.lire("neuve", pendante(compteur)).catch(() => {});
    await tick();
    expect(compteur.n).toBe(1);
  });
});

describe("le poids est mesuré en OCTETS, pas en unités UTF-16", () => {
  it("« 界 » ×10 pèse 30 octets, pas 10", async () => {
    const c = creerCache({ ttlMs: 5000 });
    await c.lire("u", async () => "界".repeat(10));
    await tick();
    expect(c.poids(), "`.length` sous-estimait d'un facteur 3 sur du contenu non latin").toBe(30);
  });

  it("le plafond de poids s'applique donc sur la taille RÉELLE", async () => {
    const c = creerCache({ ttlMs: 5000, max: 1000, maxOctets: 60 });
    for (const k of ["a", "b", "c"]) { await c.lire(k, async () => "界".repeat(10)); await tick(); }
    expect(c.poids(), "3 × 30 octets dépasse 60 : le plus ancien est évincé").toBeLessThanOrEqual(60);
  });
});

// ⚠️ ET LA PLACE DOIT POUVOIR ÊTRE RENDUE PAR LE TEMPS, PAS SEULEMENT PAR UNE RÉPONSE. Sans abandon
// réel côté base, les 128 places se remplissent sous un ralentissement et ne sont jamais libérées :
// le plafond transforme alors un ralentissement en refus GÉNÉRAL et permanent. C'est le mode de
// panne que le plafond seul introduirait — une garde qui, mal accompagnée, devient la panne.
describe("le contexte autonome abandonne réellement une requête base qui ne répond pas", () => {
  // ⚠️ ON SCANNE DU CODE, PAS DES COMMENTAIRES. Première version de cette garde : elle cherchait
  // « AbortSignal.timeout » dans la source brute — et le COMMENTAIRE au-dessus du code contenait ces
  // mots. Retirer l'appel réel la laissait VERTE. Une garde qu'une phrase suffit à satisfaire mesure
  // la prose, pas le programme ; vérifié par mutation cette fois, dans les deux sens.
  const brut = require("node:fs").readFileSync(
    require("node:path").join(__dirname, "..", "..", "context", "standalone.js"), "utf8");
  const src = brut.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  it("la requête PostgREST porte un signal d'abandon", () => {
    const i = src.indexOf("/rest/v1/");
    expect(i, "la requête PostgREST doit exister").toBeGreaterThan(0);
    const bloc = src.slice(Math.max(0, i - 900), i + 400);
    expect(bloc, "sans signal, la socket et la place d'admission restent prises jusqu'à la mort de la fonction")
      .toMatch(/signal/);
    expect(bloc, "un abandon se fait par AbortSignal — une course de promesses n'annule rien")
      .toMatch(/AbortSignal\.timeout\(/);
  });

  it("et l'hôte peut fournir le sien (opérations longues : purges, transferts)", () => {
    expect(src).toMatch(/options\.signal/);
  });
});
