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

  it("une PANNE ne fait pas passer en degrade : elle n'a rien constaté sur la signature", async () => {
    joueur(() => Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" }));
    await bootstrap();
    expect(presentations.etatDurcissementBootstrap(), "un hoquet réseau ne prouve rien sur 0018").toBe("actif");
  });
});
