// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE REPLI VERS L'ANCIEN CONTRAT NE SE DÉCLENCHE QUE SUR LA PREUVE, JAMAIS SUR UNE PANNE.
//
// ⚠️ P1 d'audit externe, et c'était MON défaut. `appelerBump` attrapait TOUTE exception et en concluait
// « migration 0018 absente » : un ECONNRESET, un 500 ou un délai dépassé retiraient donc le contrôle
// anti-usurpation — et la dégradation était MÉMORISÉE pour tout le processus. Une panne réseau d'une
// seconde désarmait une garde de sécurité sur une base pourtant entièrement migrée.
//
// C'est la règle du jour appliquée au code de production : un mécanisme qui ne peut pas mesurer doit
// REFUSER DE CONCLURE, pas conclure par défaut. Ne pas savoir distinguer PGRST202 d'un timeout ne
// rendait pas le repli prudent — il le rendait automatique.

const presentations = require("../presentations.js");
const schema = require("../schema.js");

const PRES = { slug: "s", active: true, control_hash: "h", current_page: 1 };

/** `panne` est jetée au PREMIER appel du RPC ; les suivants réussissent. */
function joueur(panne) {
  const appels = [];
  const ctx = {
    errors: { capture() {} },
    db: {
      async request(chemin, o) {
        if (/select=[a-z_]+&limit=0/.test(chemin)) return [];               // sondes de schéma
        if (chemin.startsWith("rpc/player_attendance_bump")) {
          appels.push(o.body);
          if (appels.length === 1 && panne) throw panne();
          return [{ ok: true, created: true, capped: false, usurpe: false }];
        }
        return [];   // la boucle de repli lit/écrit ici
      },
    },
  };
  schema.oublier(); schema.init(ctx); presentations.init(ctx);
  return { appels };
}

const bootstrap = () => presentations.recordAttendance(
  "s", { key: "anon-k", name: "V" },
  { presentation: PRES, ipHash: "h", anonCap: 325, hasToken: true, onlyIfUnclaimed: true },
);

// Les formes réelles : le studio attache statusCode/details, le standalone met tout dans le message.
const pgrst202Details = () => Object.assign(new Error("Supabase request failed"), { statusCode: 404, details: { code: "PGRST202" } });
const pgrst202Message = () => new Error("Supabase POST rpc/player_attendance_bump → 404 — {\"code\":\"PGRST202\",\"message\":\"Could not find the function\"}");

describe("repli RPC — seule une signature absente le déclenche", () => {
  it("MIGRATION ABSENTE (details.code) : repli, l'appel suivant n'a plus p_only_if_unclaimed", async () => {
    const j = joueur(pgrst202Details);
    const r = await bootstrap();
    expect(r.ok, "le repli aboutit à une écriture").toBe(true);
    expect(j.appels.length).toBe(2);
    expect(Object.prototype.hasOwnProperty.call(j.appels[1], "p_only_if_unclaimed")).toBe(false);
  });

  it("MIGRATION ABSENTE (message seul, contexte standalone) : repli aussi", async () => {
    const j = joueur(pgrst202Message);
    expect((await bootstrap()).ok).toBe(true);
    expect(j.appels.length).toBe(2);
  });

  // ⚠️ LE CŒUR : ces quatre-là ne doivent JAMAIS déclencher le repli.
  const pannes = {
    "panne réseau": () => Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }),
    "erreur 500": () => Object.assign(new Error("Supabase request failed with status 500"), { statusCode: 500, details: { code: "PGRST100" } }),
    "délai dépassé": () => Object.assign(new Error("delai"), { name: "TimeoutError" }),
    "404 SANS PGRST202": () => Object.assign(new Error("Supabase POST → 404 — not found"), { statusCode: 404 }),
  };
  for (const [nom, panne] of Object.entries(pannes)) {
    it(`${nom} : AUCUN repli, et le battement est refusé en 503 (jamais écrit sans le contrôle)`, async () => {
      const j = joueur(panne);
      const r = await bootstrap();
      expect(j.appels.length, "un seul essai : on ne réessaie pas sans le durcissement").toBe(1);
      expect(r.ok).toBe(false);
      expect(r.status, "« je n'ai pas pu vérifier » — pas « écrit », pas « refusé »").toBe(503);
    });
  }

  it("une panne NE CONTAMINE PAS le processus : le bootstrap suivant redemande le durcissement", async () => {
    const j = joueur(pannes["panne réseau"]);
    await bootstrap();                       // échoue en 503
    const r = await bootstrap();             // le RPC répond, cette fois
    expect(r.ok).toBe(true);
    expect(j.appels[1].p_only_if_unclaimed, "la dégradation n'a PAS été mémorisée").toBe(true);
  });

  it("réponse mal formée : pas un repli, la boucle prend le relais (battement ordinaire)", async () => {
    const ctx = { errors: { capture() {} }, db: { async request(chemin) { if (/select=[a-z_]+&limit=0/.test(chemin)) return []; if (chemin.startsWith("rpc/")) return [{ inattendu: true }]; return []; } } };
    schema.oublier(); schema.init(ctx); presentations.init(ctx);
    const r = await presentations.recordAttendance("s", { key: "anon-k" }, { presentation: PRES, ipHash: "h", hasToken: false });
    expect(r.ok, "forme inconnue : on n'invente pas de verdict, la boucle écrit").toBe(true);
  });
});

// ⚠️ LA CARTE DOIT DIRE CE QU'ELLE A CONSTATÉ, PAS CE QUI EST CONFIGURÉ. Le second hôte l'a nommé :
// `presenceStrict` pouvait annoncer une porte qui refuse alors que le contrôle anti-usurpation était
// désarmé. Et « pas dégradé » n'est pas « vérifié » — un processus qui n'a rien tenté ne sait rien.
describe("état OBSERVÉ du durcissement", () => {
  it("inconnu tant qu'aucun bootstrap n'a été servi — l'absence d'observation n'est pas un feu vert", () => {
    joueur(null);
    expect(presentations.etatDurcissementBootstrap()).toBe("inconnu");
  });

  it("actif après un bootstrap qui a abouti", async () => {
    joueur(null);
    await bootstrap();
    expect(presentations.etatDurcissementBootstrap()).toBe("actif");
  });

  it("degrade quand la signature est absente — et le rapport le dit, pas seulement le journal", async () => {
    joueur(pgrst202Details);
    await bootstrap();
    expect(presentations.etatDurcissementBootstrap()).toBe("degrade");
  });

  it("une PANNE ne fait pas passer en degrade — et ne prouve rien non plus : inconnu", async () => {
    joueur(() => Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }));
    await bootstrap();
    const etat = presentations.etatDurcissementBootstrap();
    expect(etat, "un hoquet réseau ne prouve pas l'absence de 0018").not.toBe("degrade");
    // ⚠️ CETTE ASSERTION DISAIT « actif », ET C'ÉTAIT LE MÊME DÉFAUT QU'ELLE SURVEILLAIT. Une panne ne
    // prouve pas davantage la PRÉSENCE de 0018 que son absence : l'appel n'est jamais revenu. Le test
    // consacrait la promotion d'un échec au plus fort des trois états.
    expect(etat, "l'appel n'est pas revenu : rien n'a été constaté, dans aucun sens").toBe("inconnu");
  });

  // ⚠️ LE DÉFAUT RELEVÉ PAR LE SECOND HÔTE, ET C'EST LE PIRE SENS POSSIBLE. Le drapeau était posé
  // AVANT l'appel : il enregistrait une TENTATIVE. Sur un hôte sans 0018, le mémo rendait « degrade »
  // 60 s, puis expirait — et l'état ne redescendait pas vers l'ignorance, il MONTAIT vers « actif ».
  // Un hôte dont tous les bootstraps ont échoué finissait par annoncer la garde vérifiée.
  it("0018 absente, mémo EXPIRÉ : retombe en inconnu, JAMAIS en actif", async () => {
    vi.useFakeTimers();
    try {
      joueur(pgrst202Details);
      await bootstrap();
      expect(presentations.etatDurcissementBootstrap()).toBe("degrade");
      vi.advanceTimersByTime(61_000);                       // le mémo de 60 s a expiré
      expect(presentations.etatDurcissementBootstrap(),
        "le repli d'une preuve périmée est l'IGNORANCE, jamais la confiance")
        .toBe("inconnu");
    } finally { vi.useRealTimers(); }
  });

  it("un succès CONSTATÉ après l'échec, lui, fait bien passer en actif", async () => {
    vi.useFakeTimers();
    try {
      joueur(pgrst202Details);                              // 1er appel : signature absente
      await bootstrap();
      vi.advanceTimersByTime(61_000);
      await bootstrap();                                    // 2e appel : revenu normalement
      expect(presentations.etatDurcissementBootstrap(),
        "un succès plus RÉCENT que le dernier échec est une observation, pas une expiration")
        .toBe("actif");
    } finally { vi.useRealTimers(); }
  });
});

// ⚠️ L'ÉGALITÉ À LA MILLISECONDE — relevée par l'audit externe sur la version « deux instants ».
//
// Comparer `dernierSuccès > dernierÉchec` est correct sur le fond, mais deux réponses concurrentes
// qui se terminent dans la MÊME milliseconde rendaient les deux instants égaux, et l'égalité tombait
// du côté « inconnu ». Jamais un faux « actif » — le sens sûr — mais un faux NÉGATIF durable : un
// hôte dont la migration est bien appliquée s'annonçait « je ne sais pas » jusqu'au bootstrap
// suivant. Un état explicite n'a pas d'égalité possible : le dernier mot s'écrit, il ne se déduit
// pas d'une horloge dont la résolution n'est pas garantie.
describe("deux réponses concurrentes dans la même milliseconde", () => {
  /** Un joueur dont on choisit l'ordre de règlement des DEUX appels RPC. */
  function joueurConcurrent() {
    const differes = [];
    const ctx = {
      errors: { capture() {} },
      db: {
        async request(chemin) {
          if (/select=[a-z_]+&limit=0/.test(chemin)) return [];
          if (chemin.startsWith("rpc/player_attendance_bump")) {
            return new Promise((resoudre, rejeter) => { differes.push({ resoudre, rejeter }); });
          }
          return [];
        },
      },
    };
    schema.oublier(); schema.init(ctx); presentations.init(ctx);
    return differes;
  }

  const OK = [{ ok: true, created: true, capped: false, usurpe: false }];
  /** Laisse les microtâches avancer, puis règle tout appel encore en vol (dont le REPLI). */
  async function drainer(differes, deja) {
    for (let i = 0; i < 6; i++) {
      await Promise.resolve();
      for (let j = deja; j < differes.length; j++) differes[j].resoudre(OK);
      deja = differes.length;
    }
  }

  it("un ÉCHEC puis un SUCCÈS au même instant : l'état retenu est « actif », pas « inconnu »", async () => {
    vi.useFakeTimers();
    try {
      const differes = joueurConcurrent();
      // Deux bootstraps partent ENSEMBLE : tous deux passent le contrôle du mémo, qui n'est pas armé.
      const a = bootstrap(); const b = bootstrap();
      await Promise.resolve(); await Promise.resolve();
      expect(differes.length, "les deux appels doivent être en vol pour que le cas existe").toBe(2);

      // Le premier échoue (signature absente), le second réussit — au même instant d'horloge.
      differes[0].rejeter(pgrst202Details());
      differes[1].resoudre(OK);
      await drainer(differes, 2);          // le repli du premier repart : on le règle aussi
      await Promise.allSettled([a, b]);

      vi.advanceTimersByTime(61_000);            // la preuve NÉGATIVE périme
      expect(presentations.etatDurcissementBootstrap(),
        "un succès a bien été constaté : le rapport ne doit pas dire « je ne sais pas »")
        .toBe("actif");
    } finally { vi.useRealTimers(); }
  });

  it("et l'ordre inverse reste prudent : un ÉCHEC en dernier mot ne rend jamais « actif »", async () => {
    vi.useFakeTimers();
    try {
      const differes = joueurConcurrent();
      const a = bootstrap(); const b = bootstrap();
      await Promise.resolve(); await Promise.resolve();
      differes[0].resoudre(OK);
      differes[1].rejeter(pgrst202Details());
      await drainer(differes, 2);
      await Promise.allSettled([a, b]);
      expect(presentations.etatDurcissementBootstrap(), "tant que le mémo court, c'est « degrade »").toBe("degrade");
      vi.advanceTimersByTime(61_000);
      expect(presentations.etatDurcissementBootstrap(),
        "la preuve négative périmée retombe sur l'ignorance, jamais sur la confiance")
        .toBe("inconnu");
    } finally { vi.useRealTimers(); }
  });
});

// ⚠️ PORTE FERMÉE + MIGRATION ABSENTE : ON REFUSE, ON NE SE REPLIE PAS (P2 audit externe).
//
// Le repli retire le contrôle anti-usurpation et écrit quand même. C'est le bon arbitrage pendant la
// TRANSITION — mieux vaut une présence enregistrée sans contrôle qu'une présentation cassée. Ce n'en
// est plus un une fois `PLAYER_PRESENCE_STRICT` posé : l'exploitant a déclaré que seule une identité
// prouvée entre, et laisser un bootstrap auto-déclaré s'emparer d'une ligne réclamée serait une
// fermeture qui rassure sans protéger.
//
// ⚠️ ET LE REFUS EST BORNÉ AUX BOOTSTRAPS. Refuser tout ferait d'une migration manquante une panne
// totale des présences : le remède serait pire que le défaut.
describe("strict + 0018 absente", () => {
  function joueurStrict(strict) {
    const appels = [];
    const ctx = {
      errors: { capture() {} },
      config: { presenceStrict: strict },
      db: {
        async request(chemin, o) {
          if (/select=[a-z_]+&limit=0/.test(chemin)) return [];
          if (chemin.startsWith("rpc/player_attendance_bump")) {
            appels.push(o.body);
            if (o.body.p_only_if_unclaimed !== undefined) throw pgrst202Details();
            return [{ ok: true, created: true, capped: false, usurpe: false }];
          }
          return [];
        },
        async selectAll() { return []; },
      },
    };
    schema.oublier(); schema.init(ctx); presentations.init(ctx);
    return { appels };
  }

  it("strict ON : le bootstrap rend 503 et AUCUNE écriture non protégée n'est faite", async () => {
    const j = joueurStrict(true);
    const r = await bootstrap();
    expect(r).toMatchObject({ ok: false, status: 503 });
    const sansControle = j.appels.filter((b) => b.p_only_if_unclaimed === undefined);
    expect(sansControle.length,
      "un repli a écrit sans le contrôle que la porte fermée prétend imposer").toBe(0);
  });

  it("strict OFF : le repli reste autorisé — c'est le régime de transition", async () => {
    const j = joueurStrict(false);
    const r = await bootstrap();
    expect(r.ok, "pendant la transition, mieux vaut enregistrer sans contrôle que casser").toBe(true);
    expect(j.appels.filter((b) => b.p_only_if_unclaimed === undefined).length).toBe(1);
  });

  it("strict ON : un battement ORDINAIRE passe toujours — le refus ne vise que les bootstraps", async () => {
    joueurStrict(true);
    const r = await presentations.recordAttendance(
      "s", { key: "anon-k", name: "V" },
      { presentation: PRES, ipHash: "h", anonCap: 325, hasToken: true, onlyIfUnclaimed: false },
    );
    expect(r.ok, "une migration manquante ne doit pas arrêter une présentation en cours").toBe(true);
  });
});

// ⚠️ LE MÉMO CONTOURNAIT LA PORTE FERMÉE AU DEUXIÈME APPEL (P1 audit externe, v0.1.120).
//
// Mon correctif de 0.1.119 refusait bien le repli sous `PLAYER_PRESENCE_STRICT`… dans le `catch`,
// c'est-à-dire sur le chemin où la RPC vient d'échouer. Mais il existe un SECOND chemin vers la même
// écriture : une fois le mémo de 60 s armé, `appelerBump` sort par le haut, retire
// `p_only_if_unclaimed` et écrit — sans jamais consulter le mode strict.
//
// Donc : premier bootstrap refusé en 503, deuxième ACCEPTÉ et écrit sans contrôle. La propriété
// annoncée « strict ⇒ aucun repli non protégé » était fausse pendant 60 secondes sur chaque hôte
// qui aurait armé la porte sans la migration.
//
// ⚠️ ET MON BANC NE POUVAIT PAS LE VOIR : il n'appelait qu'une fois. Une garde qui n'éprouve que le
// premier passage ne dit rien du régime — et c'est justement le second qui empruntait l'autre porte.
describe("porte fermée : le MÉMO ne doit pas rouvrir ce que le refus vient de fermer", () => {
  function joueurStrictMemo(strict) {
    const appels = [];
    const ctx = {
      errors: { capture() {} },
      config: { presenceStrict: strict },
      db: {
        async request(chemin, o) {
          if (/select=[a-z_]+&limit=0/.test(chemin)) return [];
          if (chemin.startsWith("rpc/player_attendance_bump")) {
            appels.push({ protege: o.body.p_only_if_unclaimed !== undefined });
            if (o.body.p_only_if_unclaimed !== undefined) throw pgrst202Details();
            return [{ ok: true, created: true, capped: false, usurpe: false }];
          }
          return [];
        },
        async selectAll() { return []; },
      },
    };
    schema.oublier(); schema.init(ctx); presentations.init(ctx);
    return { appels };
  }

  it("strict ON : le DEUXIÈME bootstrap, pendant le mémo, est refusé lui aussi", async () => {
    const j = joueurStrictMemo(true);
    const premier = await bootstrap();
    const deuxieme = await bootstrap();
    expect(premier, "le premier était déjà couvert").toMatchObject({ ok: false, status: 503 });
    expect(deuxieme,
      "le mémo a rouvert la porte : ce bootstrap a écrit SANS le contrôle anti-usurpation")
      .toMatchObject({ ok: false, status: 503 });
    expect(j.appels.filter((a) => !a.protege).length,
      "aucune écriture non protégée ne doit avoir lieu sous porte fermée").toBe(0);
  });

  it("strict ON : cent bootstraps de suite, aucun corps sans p_only_if_unclaimed", async () => {
    const j = joueurStrictMemo(true);
    for (let i = 0; i < 100; i++) await bootstrap();
    expect(j.appels.filter((a) => !a.protege).length,
      "le régime doit tenir, pas seulement le premier passage").toBe(0);
  });

  it("strict OFF : le repli reste autorisé pendant le mémo — c'est le régime de transition", async () => {
    const j = joueurStrictMemo(false);
    await bootstrap();
    const deuxieme = await bootstrap();
    expect(deuxieme.ok, "hors porte fermée, mieux vaut enregistrer sans contrôle que casser").toBe(true);
    expect(j.appels.filter((a) => !a.protege).length,
      "et le mémo fait bien son travail : le second appel part SANS durcissement").toBeGreaterThan(0);
  });
});

// ⚠️ L'ÉTAT OBSERVÉ DU CHEMIN FUSIONNÉ (0019) — MÊME DISCIPLINE, MÊME PIÈGE.
//
// Sans ce champ, un hôte à qui 0019 manque retombe en silence à trois allers-retours par battement :
// correct, deux fois plus cher sur le chemin le plus chaud du produit, et rien ne le dirait. Une
// dégradation qu'on ne peut pas observer se découvre à la facture — ou jamais.
//
// ⚠️ Et « inconnu » n'est pas « actif ». Un processus qui n'a servi aucun battement n'a rien
// constaté ; le promouvoir serait exactement le défaut qu'il a fallu trois versions pour retirer du
// champ voisin. La question d'avant-déploiement se pose à la BASE (schema.fusionBase), pas ici.
describe("état OBSERVÉ du chemin fusionné", () => {
  /** Un faux qui SERT la présentation en lecture : sans ça, le repli rendrait 404 et ne dirait rien. */
  function joueurFusion(panne) {
    const appels = [];
    const ctx = {
      errors: { capture() {} },
      db: {
        async request(chemin, o) {
          if (/select=[a-z_]+&limit=0/.test(chemin)) return [];
          if (chemin.startsWith("rpc/player_attendance_bump")) {
            appels.push(o.body);
            if (appels.length === 1 && panne) throw panne();
            return [{ ok: true, created: true, capped: false, usurpe: false, introuvable: false, archivee: false, page: 1 }];
          }
          if (chemin.startsWith("doc_presentations?")) return [PRES];
          return [];
        },
      },
    };
    schema.oublier(); schema.init(ctx); presentations.init(ctx);
    return { appels };
  }

  // Un battement ORDINAIRE : aucune présentation fournie, donc le chemin fusionné est tenté.
  const battre = (p = presentations) => p.recordAttendance(
    "s", { key: "anon-k", name: "V" },
    { ipHash: "h", anonCap: 325, hasToken: true, controlHash: "h" },
  );

  beforeEach(() => {
    vi.useFakeTimers();
    vi.advanceTimersByTime(61_000);   // tout mémo hérité d'un essai précédent a expiré
  });
  afterEach(() => { vi.useRealTimers(); });

  // ⚠️ MODULE NEUF, ET C'EST NÉCESSAIRE : l'état vit dans le module. Le lire après d'autres essais
  // mesurerait leur héritage, pas la valeur initiale — un essai qui dépend de son rang dans le
  // fichier ne prouve pas ce qu'il annonce.
  it("inconnu sur un processus qui n'a servi aucun battement — l'absence d'observation n'est pas un feu vert", async () => {
    vi.resetModules();
    const neuf = require("../presentations.js");
    expect(neuf.etatFusionBattement()).toBe("inconnu");
  });

  it("actif après un battement fusionné qui a abouti", async () => {
    const { appels } = joueurFusion(null);
    await battre();
    expect(appels[0].p_page, "c'est bien le contrat fusionné qui est parti").toBe(null);
    expect(presentations.etatFusionBattement()).toBe("actif");
  });

  it("degrade quand la signature à 13 arguments manque — et le battement reste EXACT", async () => {
    const { appels } = joueurFusion(pgrst202Details);
    const r = await battre();
    expect(presentations.etatFusionBattement()).toBe("degrade");
    // ⚠️ LA DÉGRADATION EST UN COÛT, PAS UNE PANNE. Le battement passe quand même, par le chemin
    // d'avant : deux appels au lieu d'un, et la page vient de la présentation relue.
    expect(r.ok, "0019 absente ne casse rien — c'est tout l'objet du repli").toBe(true);
    expect(appels[1].p_page, "le second appel a lu la présentation, donc il fournit la page").toBe(1);
  });

  it("mémo EXPIRÉ : retombe en inconnu, JAMAIS en actif", async () => {
    joueurFusion(pgrst202Details);
    await battre();
    expect(presentations.etatFusionBattement()).toBe("degrade");
    vi.advanceTimersByTime(61_000);
    expect(presentations.etatFusionBattement(),
      "le repli d'une preuve périmée est l'IGNORANCE, jamais la confiance")
      .toBe("inconnu");
  });

  it("un succès CONSTATÉ après l'échec fait bien passer en actif", async () => {
    joueurFusion(pgrst202Details);
    await battre();
    vi.advanceTimersByTime(61_000);
    await battre();
    expect(presentations.etatFusionBattement()).toBe("actif");
  });
});
