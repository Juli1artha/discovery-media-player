// LE CORRECTIF EXISTAIT, LA ROUTE NE L'APPELAIT PAS.
//
// `toggleReaction` sait poser un état depuis 0.1.56, le navigateur envoie `etat` depuis 0.1.56 —
// et la route `present-react` appelait la fonction SANS le cinquième argument. Trois versions
// durant, le chemin réel a continué de basculer : le double-clic éteignait la réaction, le défaut
// que P10 croyait fermé. Trouvé par le troisième audit.
//
// ⚠️ LES ESSAIS ÉPROUVAIENT LA FONCTION, JAMAIS LA ROUTE. La mutation rougissait, la propriété
// était vraie — sur un chemin que la production n'emprunte pas. C'est la forme la plus propre du
// piège « le banc vert qui ne mesure pas la propriété » : rien n'était faux, tout était à côté.
// D'où ce fichier : la MÊME propriété, éprouvée à travers `player.handler`, c'est-à-dire par le
// chemin que le navigateur emprunte vraiment.

const MOI = "0123456789abcdef";
const PRES = { slug: "Ab3-_xYz9012", active: true, control_hash: "h", chat_locked: false };

const etatBase = { reactions: {} };
const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: { ...vraies } };
const player = require("../handler.js");

function contexte() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: {
      async request(chemin, o) {
        if (String(chemin).startsWith("doc_presentations?")) return [{ ...PRES }];
        if (!o || !o.method) return [{ id: 1, reactions: etatBase.reactions }];
        if (o.method === "PATCH") { etatBase.reactions = o.body.reactions; return [{ id: 1, reactions: etatBase.reactions, author_hash: "x" }]; }
        return [];
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
}

async function reagir(etat) {
  player.init(contexte());
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  await player.handler(
    { method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {},
      body: { action: "present-react", slug: PRES.slug, msgId: 1, emoji: "👍", reactor: MOI, etat } },
    res,
  );
  return { statut: res.statusCode, corps: JSON.parse(res.body || "{}") };
}

describe("l'intention traverse la route HTTP, pas seulement la fonction", () => {
  it("rejouer « j'ajoute » deux fois PAR LA ROUTE laisse une réaction", async () => {
    etatBase.reactions = {};
    expect((await reagir(true)).statut).toBe(200);
    expect((await reagir(true)).statut).toBe(200);   // le renvoi réseau
    expect(etatBase.reactions["👍"], "le second envoi a éteint la réaction : la route a rebasculé").toEqual([MOI]);
  });

  it("rejouer « je retire » deux fois n'en remet pas une", async () => {
    etatBase.reactions = { "👍": [MOI] };
    await reagir(false);
    await reagir(false);
    expect(etatBase.reactions["👍"]).toBeUndefined();
  });
});
