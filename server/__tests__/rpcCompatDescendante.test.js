// CODE NEUF SUR BASE ANCIENNE : ON N'ENVOIE PAS L'ARGUMENT QUI N'EXISTE PAS ENCORE.
//
// ⚠️ Relevé du second hôte, MESURÉ sur sa base. PostgREST résout une RPC par JEU D'ARGUMENTS NOMMÉS :
// un argument en trop ne prend pas son défaut, il ne correspond à AUCUNE fonction → 404. Le
// `DEFAULT null` de 0017 rend la base NEUVE compatible avec du CODE ANCIEN ; il ne peut rien pour le
// sens INVERSE — code neuf, base ancienne — qui est l'ordre d'un déploiement réel (le code part avant
// la migration).
//
// Conséquence du défaut : entre l'incrément 2 et l'application de 0017, tout hôte à jour tombait dans
// le repli lire-modifier-réécrire et PERDAIT LE PLAFOND anti-faux-participants de 0015. Ce n'est pas
// « la présence continue de fonctionner » : c'est une GARDE qui disparaît en silence entre deux
// migrations. La compatibilité descendante s'obtient en N'ENVOYANT PAS l'argument, jamais en ajoutant
// un défaut côté base.

const presentations = require("../presentations.js");
const schema = require("../schema.js");

const PRES = { slug: "s", active: true, control_hash: "h", current_page: 1 };

/** `avec0017` pilote la sonde de colonne `last_token_at` (donc la présence de la migration). */
function joueur({ avec0017 }) {
  const appels = [];
  const ctx = {
    errors: { capture() {} },
    db: {
      async request(chemin, o) {
        appels.push({ chemin, body: o && o.body });
        // Sonde de schéma : `last_token_at` présente seulement si 0017 est appliquée.
        if (/doc_presentation_attendees\?select=last_token_at&limit=0/.test(chemin)) {
          if (!avec0017) throw new Error('column "last_token_at" does not exist');
          return [];
        }
        if (/select=[a-z_]+&limit=0/.test(chemin)) return [];              // témoin + autres sondes
        if (chemin.startsWith("rpc/player_attendance_bump")) {
          // La base ANCIENNE ne connaît que la 10-args : un `p_has_token` en trop ne résout pas.
          if (!avec0017 && o.body && Object.prototype.hasOwnProperty.call(o.body, "p_has_token")) {
            throw new Error("404 : function public.player_attendance_bump(… p_has_token => boolean) does not exist");
          }
          return [{ ok: true, created: true, capped: false }];
        }
        return [];
      },
    },
  };
  schema.oublier();
  schema.init(ctx);
  presentations.init(ctx);
  return { appels, rpc: () => appels.filter((a) => a.chemin.startsWith("rpc/player_attendance_bump")) };
}

const battre = (opts = {}) => presentations.recordAttendance(
  "s", { key: "anon-k", name: "V" },
  { presentation: PRES, ipHash: "h", anonCap: 325, hasToken: opts.hasToken },
);

describe("compatibilité descendante de la RPC de présence", () => {
  it("BASE ANCIENNE (sans 0017) : l'appel ne porte PAS p_has_token, et le plafond survit", async () => {
    const j = joueur({ avec0017: false });
    const r = await battre({ hasToken: true });
    const appels = j.rpc();
    expect(appels.length, "un seul appel : pas de 404 puis repli").toBe(1);
    expect(Object.prototype.hasOwnProperty.call(appels[0].body, "p_has_token"),
      "envoyer l'argument ferait 404 → repli SANS le plafond de 0015").toBe(false);
    expect(appels[0].body.p_anon_cap, "le plafond est toujours transmis").toBe(325);
    expect(r.ok, "le chemin atomique — donc le plafond — reste actif").toBe(true);
  });

  it("BASE NEUVE (avec 0017) : l'appel porte p_has_token", async () => {
    const j = joueur({ avec0017: true });
    await battre({ hasToken: true });
    expect(j.rpc()[0].body.p_has_token, "la transition est mesurée quand la base sait la porter").toBe(true);
  });

  it("BASE NEUVE, battement legacy : p_has_token vaut false (last_no_token_at)", async () => {
    const j = joueur({ avec0017: true });
    await battre({ hasToken: false });
    expect(j.rpc()[0].body.p_has_token).toBe(false);
  });
});
