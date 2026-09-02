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

  // ⚠️ ET L'OMISSION EST JUSTE — CE QUI MANQUAIT, C'EST DE QUOI LA LIRE. Le banc ci-dessus prouve
  // qu'une famille sans échantillon est absente, à raison. Mais depuis la carte, un lecteur ne
  // voyait alors pas la différence entre « aucun trafic » et « la mesure ne tourne pas » : les
  // deux rendent `routes: {}`. Un hôte chargé ne rencontre jamais la question, ses entrées étant
  // toujours là ; un hôte à 99 sessions n'a aucun témoin. Le dénominateur les sépare.
  it("⚠️ `familles` dit ce qui EST mesuré, sans quoi `routes: {}` est indiscernable d'une panne", () => {
    const vierge = mesures.relever();
    expect(vierge.routes, "instance neuve : aucune famille exercée").toEqual({});
    expect(vierge.familles, "mais on sait lesquelles auraient pu l'être")
      .toEqual(["document", "presentation", "action", "fichier", "carte", "autre"]);

    mesures.chrono("document")(200);
    const apres = mesures.relever();
    expect(Object.keys(apres.routes)).toEqual(["document"]);
    expect(apres.familles, "le dénominateur ne bouge pas avec le trafic — c'est ce qui en fait un")
      .toEqual(vierge.familles);
  });

  // ⚠️ LES DEUX CHAMPS VOISINS PORTAIENT DÉJÀ LEUR DÉNOMINATEUR, et c'est ce qui rend l'omission
  // de `routes` mesurable plutôt qu'opinable : sur une instance neuve, `statuts` publie ses cinq
  // clés à zéro et `boucleMs` publie `n: 0` avec des `null` explicites. Trois champs frères, deux
  // qui savaient et un qui avait oublié.
  it("⚠️ ses deux voisins le portaient déjà — l'incohérence était interne, pas théorique", () => {
    const r = mesures.relever();
    expect(Object.keys(r.statuts).length, "statuts : les cinq clés, à zéro").toBe(5);
    expect(r.boucleMs.n, "boucleMs : un compte explicite").toBe(0);
    expect(r.boucleMs.moyen, "et `null` plutôt qu'un zéro qui se lirait « saine »").toBeNull();
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

  // ⚠️ CE BANC A CHANGÉ DE NATURE LE 26/08, ET LE POURQUOI VAUT PLUS QUE LE COMMENT. Il exigeait
  // « au repos, le retard est sous 10 ms » après avoir laissé tourner la boucle 120 ms. C'est une
  // GRANDEUR, et elle dépend de la charge de la machine : sur un conteneur occupé il a rendu 13
  // puis 10,6 le même jour, sur un code parfaitement correct. Le seuil ne gardait pas la
  // soustraction de la résolution — il gardait le calme de l'ordonnanceur.
  //
  // La propriété, elle, est arithmétique : le retard publié est la mesure MOINS la résolution,
  // plancher à zéro. Elle s'éprouve sans chronomètre, donc sans hasard.
  it("le retard est le RETARD, pas l'intervalle du minuteur", () => {
    const r = mesures.__retardMs;
    const res = mesures.relever().boucleMs.resolutionMs;
    // Au repos, l'échantillonneur rapporte SA RÉSOLUTION : le retard publié doit être zéro.
    expect(r(res * 1e6), "une instance oisive annoncerait 20 ms de retard permanent sans ça").toBe(0);
    // Un retard réel est ce qui DÉPASSE la résolution.
    expect(r((res + 5) * 1e6)).toBe(5);
    expect(r((res + 100.5) * 1e6)).toBe(100.5);
    // ⚠️ PLANCHER À ZÉRO : sous la résolution, la soustraction rendrait un retard NÉGATIF, qu'un
    // lecteur ne saurait pas interpréter — et qui traverserait `JSON.stringify` sans rien signaler.
    expect(r(1e6), "un retard négatif n'existe pas").toBe(0);
    expect(r(0)).toBe(0);
  });

  it("et le relevé réel passe bien par cette conversion", async () => {
    // Le lien entre la fonction éprouvée ci-dessus et ce que la carte publie : sans ce banc, la
    // conversion pourrait être juste et n'être appelée par personne.
    await new Promise((r) => setTimeout(r, 60));
    const b = mesures.relever().boucleMs;
    expect(b.n, "l'histogramme doit avoir tourné").toBeGreaterThan(0);
    expect(b.moyen, "jamais négatif, quelle que soit la charge").toBeGreaterThanOrEqual(0);
    expect(b.p99).toBeGreaterThanOrEqual(0);
    expect(b.resolutionMs).toBeGreaterThan(0);
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

  it("⚠️ une méthode REMPLACÉE APRÈS l'enveloppement est bien celle qui s'exécute", async () => {
    // C'est la forge qui l'a trouvé : un banc pose sa sonde APRÈS `init`, et un hôte a exactement
    // le même droit (enveloppe de réessai, client câblé paresseusement, instrumentation). La
    // première version photographiait `db.request` : tout ce qui la remplaçait ensuite cessait
    // d'être appelé, EN SILENCE. Une mesure qui change ce qui s'exécute n'est plus une mesure.
    const vraie = { request: async () => "originale" };
    const vu = mesures.observerBase(vraie);
    vraie.request = async () => "posée après";
    expect(await vu.request("x")).toBe("posée après");
  });

  it("un champ qui n'est pas une méthode reste VIVANT, lui aussi", async () => {
    const vraie = { request: async () => [], configuree: false };
    const vu = mesures.observerBase(vraie);
    vraie.configuree = true;
    expect(vu.configuree, "une copie l'aurait figé à `false` au moment de l'enveloppement").toBe(true);
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
    // ⚠️ UNE SEULE EXCEPTION, ET ELLE EST NOMMÉE PAR SON CHEMIN AUTANT QUE PAR SA VALEUR. Le
    // dénominateur `familles` est la seule chaîne publiée, et un vocabulaire CLOS : une valeur
    // hors `FAMILLES`, ou une chaîne apparaissant ailleurs qu'à cet endroit, reste refusée. Écrire
    // « les chaînes sont tolérées » aurait rendu la garde muette au premier slug ; ici le slug
    // échoue deux fois, sur son chemin et sur son vocabulaire.
    const tolerees = nonNumeriques.filter(([chemin, v]) =>
      /^mesures\.familles\[\d+\]$/.test(chemin) && mesures.FAMILLES.includes(v));
    const interdites = nonNumeriques.filter((f) => !tolerees.includes(f));
    expect(interdites,
      "c'est ce qui permet de publier ce relevé sur une carte qu'un hôte lit sans cérémonie :\n"
      + JSON.stringify(interdites)).toEqual([]);
    expect(tolerees.length, "le dénominateur est publié en entier, sinon il n'en est pas un")
      .toBe(mesures.FAMILLES.length);
    // Et les CLÉS de `routes` ne peuvent être que des familles déclarées, jamais un slug.
    for (const cle of Object.keys(r.routes)) expect(mesures.FAMILLES).toContain(cle);
  });
});

// ⚠️ CE BANC EXISTE PARCE QUE LA FORGE A ROUGI, ET QU'ELLE AVAIT RAISON. `handler.init` enveloppe
// la capacité `db` pour en mesurer la latence. La première version en faisait une COPIE : tout ce
// qu'un hôte posait ou remplaçait APRÈS `init` cessait d'être utilisé — en silence. Le banc de base
// `presenceFusionnee` pose sa sonde après `init` et a compté zéro appel sortant ; un hôte a
// exactement le même droit (enveloppe de réessai, client câblé paresseusement, instrumentation).
//
// Une mesure qui change ce qui s'exécute n'est plus une mesure : c'est une panne avec un graphique.
describe("mesurer la base ne doit RIEN changer à ce qui s'exécute", () => {
  const player = require("../handler.js");

  function contexteNu() {
    return {
      db: { request: async () => [], selectAll: async () => [] },
      limits: { allow: async () => true },
      errors: { capture() {} },
      config: {}, plugins: {}, branding: {}, storage: {},
    };
  }

  it("⚠️ une sonde posée APRÈS `init` voit bien passer les appels", async () => {
    const contexte = contexteNu();
    player.init(contexte);

    const journal = [];
    const vraie = contexte.db.request.bind(contexte.db);
    contexte.db.request = async (chemin, o) => { journal.push(chemin); return vraie(chemin, o); };

    const res = {
      statusCode: 0, entetes: {}, corps: "",
      setHeader(k, v) { this.entetes[k] = v; },
      writeHead(c) { this.statusCode = c; },
      end(b) { this.corps = String(b || ""); },
    };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { slug: "inexistant-xyz" } }, res);

    expect(journal.length, "zéro appel vu = l'enveloppe a photographié la méthode").toBeGreaterThan(0);
    expect(journal[0]).toContain("commercial_doc_shares");
  });

  it("un champ posé après `init` est visible du player", () => {
    const contexte = contexteNu();
    player.init(contexte);
    contexte.config = { supabaseUrl: "https://pose-apres.example" };
    // La carte lit `PLAYER.config` : si `init` en avait pris une copie, elle lirait l'ancienne.
    expect(player.__contexte().config.supabaseUrl).toBe("https://pose-apres.example");
  });
});
