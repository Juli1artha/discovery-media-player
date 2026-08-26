// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE RELEVÉ D'EXÉCUTION — ET SURTOUT CE QU'IL REFUSE DE PRÉTENDRE.
//
// ⚠️ IL N'Y AVAIT QU'UN CHIFFRE, ET IL NE RÉPONDAIT QU'À UNE QUESTION. `lectureSaturee` compte les
// refus du plafond d'admission ; « quelle route est lente ? », « la base ou nous ? », « combien de
// 5xx ? », « la boucle décroche-t-elle ? » n'avaient AUCUNE réponse observable, et les deux hôtes
// intégrateurs ont confirmé ne pas pouvoir les produire depuis chez eux (audit CODEX 5.6, §2).
//
// ⚠️ CE QUE CES BANCS GARDENT N'EST PAS « LA MESURE EST JUSTE » — un histogramme à seaux ne PEUT
// pas être juste, c'est le prix d'une mémoire bornée. Ce qu'ils gardent, c'est qu'il ne MENT pas :
// une borne se lit comme une borne, une absence de mesure ne se lit pas comme un zéro, et une
// enveloppe de mesure ne change pas ce qu'elle mesure.

const mesures = require("../mesures.js");

beforeEach(() => { mesures.vider(); });

describe("un centile sur seaux est une BORNE, et le dit", () => {
  it("⚠️ `p95sousMs` rend la borne HAUTE du seau, jamais une durée observée", () => {
    // Cent appels : 99 instantanés, un lent. Le 95e rang tombe dans le premier seau.
    for (let i = 0; i < 99; i += 1) mesures.chrono("document")(200);
    const lent = mesures.chrono("document");
    const t = Date.now(); while (Date.now() - t < 30) { /* trente millisecondes bien réelles */ }
    lent(200);

    const r = mesures.relever().routes.document;
    expect(r.n).toBe(100);
    expect(mesures.SEAUX_MS, "la borne rendue doit APPARTENIR à l'échelle publiée").toContain(r.p95sousMs);
    expect(r.p95sousMs, "95 % des appels sont instantanés : la borne doit être basse").toBeLessThanOrEqual(5);
    expect(r.maxMs, "le maximum, lui, est une vraie valeur observée").toBeGreaterThanOrEqual(25);
  });

  it("l'échelle est publiée AVEC les chiffres — sinon nul ne peut juger de leur précision", () => {
    mesures.chrono("carte")(200);
    const r = mesures.relever();
    expect(r.seauxMs).toEqual(mesures.SEAUX_MS);
    expect(r.seauxMs.length, "une échelle vide rendrait tout centile ininterprétable").toBeGreaterThan(5);
  });

  it("la mémoire du relevé ne grandit PAS avec le trafic — c'est la raison d'être des seaux", () => {
    // ⚠️ ON COMPARE UN APPEL À CINQ MILLE, PAS ZÉRO À UN. Passer de « aucune famille » à « une
    // famille » ajoute forcément une entrée : ce n'est pas la croissance qu'on redoute. Celle
    // qu'on redoute est celle du TRAFIC — une table d'échantillons que l'appelant fait grandir,
    // c'est-à-dire la fuite mémoire commandée du dehors que `server/cache.js` documente déjà.
    mesures.chrono("action")(200);
    const unSeul = JSON.stringify(mesures.relever().routes).length;
    for (let i = 0; i < 4999; i += 1) mesures.chrono("action")(200);
    const cinqMille = JSON.stringify(mesures.relever().routes).length;

    expect(mesures.relever().routes.action.n).toBe(5000);
    expect(cinqMille - unSeul,
      "seuls les CHIFFRES s'allongent ; la structure est de taille fixe").toBeLessThanOrEqual(10);
  });
});

describe("« pas mesuré » n'est pas « zéro »", () => {
  it("⚠️ une famille jamais exercée est ABSENTE — un `0 ms` se lirait « instantané »", () => {
    mesures.chrono("document")(200);
    const routes = mesures.relever().routes;
    expect(Object.keys(routes)).toEqual(["document"]);
    expect(routes.presentation, "aucune présentation servie : rien à en dire").toBeUndefined();
  });

  it("la base non sollicitée rend `{ n: 0 }` et rien d'autre", () => {
    const base = mesures.relever().base;
    expect(base.n).toBe(0);
    expect(base.p95sousMs, "une latence de base inventée orienterait une décision d'optimisation").toBeUndefined();
  });

  it("⚠️ `boucleMs` sans échantillon rend `null`, pas `0`", () => {
    const b = mesures.relever().boucleMs;
    expect(b.resolutionMs, "la résolution est publiée : le retard s'en déduit").toBeGreaterThan(0);
    if (b.n === 0) { expect(b.moyen).toBeNull(); expect(b.p99).toBeNull(); }
    else { expect(b.moyen).toBeGreaterThanOrEqual(0); }
  });

  it("le retard est le RETARD, pas l'intervalle du minuteur", async () => {
    await new Promise((r) => setTimeout(r, 120));
    const b = mesures.relever().boucleMs;
    expect(b.n, "l'histogramme doit avoir tourné").toBeGreaterThan(0);
    // Sans soustraction de la résolution, une instance parfaitement oisive annoncerait ~20 ms de
    // retard en permanence — et ferait chercher une panne qui n'existe pas.
    expect(b.moyen, "au repos, le retard est proche de zéro").toBeLessThan(b.resolutionMs / 2);
  });
});

describe("les classes de statut", () => {
  it("chaque classe est comptée là où elle doit l'être", () => {
    mesures.chrono("action")(200);
    mesures.chrono("action")(404);
    mesures.chrono("action")(429);
    mesures.chrono("action")(503);
    mesures.chrono("action")(500);
    expect(mesures.relever().statuts).toEqual({ ok: 1, refus4xx: 1, debit429: 1, occupe503: 1, erreur5xx: 1 });
  });

  it("⚠️ 429 et 503 NE SONT PAS des 4xx/5xx quelconques — les confondre efface la question posée", () => {
    // « Nous refusons une demande de plus » (503) et « la base a échoué » (500) sont deux
    // situations opposées ; les additionner rendrait le compte inutile exactement quand il sert.
    mesures.chrono("document")(503);
    const s = mesures.relever().statuts;
    expect(s.occupe503).toBe(1);
    expect(s.erreur5xx).toBe(0);
  });

  it("deux fins pour un appel ne comptent qu'une fois", () => {
    const fin = mesures.chrono("document");
    fin(200); fin(500);
    expect(mesures.relever().routes.document.n).toBe(1);
    expect(mesures.relever().statuts).toMatchObject({ ok: 1, erreur5xx: 0 });
  });

  it("une mesure ne casse jamais la requête qu'elle mesure", () => {
    expect(() => mesures.chrono("famille-qui-n-existe-pas")(undefined)).not.toThrow();
    expect(mesures.relever().routes.autre.n, "elle atterrit dans `autre` plutôt que nulle part").toBe(1);
  });
});

describe("l'enveloppe de la base mesure sans rien changer", () => {
  it("⚠️ mêmes valeurs, mêmes rejets — un décorateur qui change le contrat mesure autre chose", async () => {
    const vraie = {
      request: async (chemin) => { if (chemin === "boum") throw new Error("échec de base"); return [{ chemin }]; },
      selectAll: async () => [1, 2, 3],
      configuree: true,
    };
    const vu = mesures.observerBase(vraie);

    expect(await vu.request("table?select=x")).toEqual([{ chemin: "table?select=x" }]);
    expect(await vu.selectAll("table")).toEqual([1, 2, 3]);
    expect(vu.configuree, "les champs qui ne sont pas des méthodes traversent").toBe(true);
    await expect(vu.request("boum")).rejects.toThrow("échec de base");
  });

  it("un échec est mesuré AUSSI — une base qui rejette lentement est le cas intéressant", async () => {
    const vu = mesures.observerBase({ request: async () => { throw new Error("non"); } });
    const avant = mesures.__histoBase.compte();
    await vu.request("x").catch(() => {});
    expect(mesures.__histoBase.compte()).toBe(avant + 1);
  });

  it("envelopper deux fois ne double pas la mesure", async () => {
    const vu = mesures.observerBase({ request: async () => [] });
    const revu = mesures.observerBase(vu);
    const avant = mesures.__histoBase.compte();
    await revu.request("x");
    expect(mesures.__histoBase.compte(), "un contexte réinjecté ne doit pas fausser la latence").toBe(avant + 1);
  });

  it("une capacité absente traverse sans exploser", () => {
    expect(mesures.observerBase(null)).toBeNull();
    expect(mesures.observerBase({})).toEqual({});
  });
});

describe("ce que le relevé ne contient pas", () => {
  it("⚠️ aucun slug, aucune adresse, aucun texte : que des nombres, des `null` et des noms de famille", () => {
    mesures.chrono("document")(200);
    mesures.chrono("action")(429);
    const r = mesures.relever();

    const feuilles = [];
    const parcourir = (v, chemin) => {
      if (v === null || typeof v === "number") { feuilles.push([chemin, v]); return; }
      if (Array.isArray(v)) { v.forEach((x, i) => parcourir(x, `${chemin}[${i}]`)); return; }
      if (typeof v === "object") { for (const k of Object.keys(v)) parcourir(v[k], `${chemin}.${k}`); return; }
      feuilles.push([chemin, v]);
    };
    parcourir(r, "mesures");

    const nonNumeriques = feuilles.filter(([, v]) => v !== null && typeof v !== "number");
    expect(nonNumeriques,
      "c'est ce qui permet de publier ce relevé sur une carte qu'un hôte lit sans cérémonie :\n"
      + JSON.stringify(nonNumeriques)).toEqual([]);
    // Et les CLÉS de `routes` ne peuvent être que des familles déclarées, jamais un slug.
    for (const cle of Object.keys(r.routes)) expect(mesures.FAMILLES).toContain(cle);
  });
});
