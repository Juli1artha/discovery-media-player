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

const crypto = require("node:crypto");
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

// Le jeton reste dans le navigateur ; le ref qui en découle est ce que la base stocke.
const JETON = "jeton-d-auteur-secret";
const MOI = sha("ref:" + sha(JETON)).slice(0, 16);
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

async function reagir(etat, extra = {}) {
  player.init(contexte());
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  await player.handler(
    { method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {},
      body: { action: "present-react", slug: PRES.slug, msgId: 1, emoji: "👍", authorToken: JETON, etat, ...extra } },
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

// ⚠️ LES REFS SONT PUBLICS — chaque participant reçoit ceux de tous les autres dans le tableau des
// réactions. Un champ `reactor` fourni par le client permettait donc de retirer la réaction de
// n'importe qui. L'identité se dérive du JETON, le secret qui ne quitte pas son navigateur.
describe("l'identité d'un réacteur ne se déclare pas", () => {
  const VICTIME = sha("ref:" + sha("jeton-de-la-victime")).slice(0, 16);

  it("un `reactor` forgé est ignoré : seule l'identité dérivée du jeton est touchée", async () => {
    etatBase.reactions = { "👍": [VICTIME] };
    const r = await reagir(false, { reactor: VICTIME });   // « retire la réaction de la victime »
    expect(r.statut).toBe(200);
    expect(etatBase.reactions["👍"], "la réaction de la victime a été retirée par un tiers").toEqual([VICTIME]);
  });

  // ⚠️ L'ATTAQUE QUI RESTAIT OUVERTE SOUS UN REPLI « DE COMPATIBILITÉ ». Une mutation qui
  // retombait sur `body.reactor` quand le jeton manque a SURVÉCU à la première série : l'essai
  // d'usurpation envoyait jeton ET ref forgé, donc le repli ne jouait jamais. Or c'est précisément
  // le chemin de l'attaquant : ne PAS envoyer de jeton, et déclarer le ref d'un autre.
  it("un ref forgé SANS jeton : 400, et la victime n'est pas touchée", async () => {
    etatBase.reactions = { "👍": [VICTIME] };
    const r = await reagir(false, { authorToken: undefined, reactor: VICTIME });
    expect(r.statut, "le repli sur body.reactor rouvre l'usurpation").toBe(400);
    expect(etatBase.reactions["👍"]).toEqual([VICTIME]);
  });

  it("sans jeton, pas d'identité : 400", async () => {
    etatBase.reactions = {};
    const r = await reagir(true, { authorToken: undefined });
    expect(r.statut).toBe(400);
    expect(etatBase.reactions["👍"]).toBeUndefined();
  });

  // La dérivation serveur doit rendre EXACTEMENT le ref que le client calcule : sinon « mes »
  // réactions cessent de s'afficher comme miennes. Confrontée au moteur du cœur navigateur.
  it("la dérivation serveur et celle du client rendent le même ref", async () => {
    const { referenceAuteur } = await import("../../src/live.ts");
    const duClient = await referenceAuteur(JETON, crypto.webcrypto.subtle);
    expect(duClient).toBe(MOI);
  });
});
