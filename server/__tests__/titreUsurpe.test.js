// LE TITRE DE PRÉSENTATEUR SE RÉCLAMAIT.
//
// L'audit décrit l'attaquant : « tout participant connaissant le slug ». ⚠️ C'est important, parce
// que ça DISQUALIFIE la correction qui semblait évidente — rendre le canal Realtime privé. Un canal
// privé exclut qui n'a pas le droit d'y être ; or cet attaquant-là a le droit d'y être, il détient
// le lien. Ce qui le sépare du présentateur n'est pas l'accès au canal, c'est le `control_token`.
//
// Trois endroits accordaient un statut sans le vérifier :
//
//   1. `present-attend` prenait `isPresenter` ET `isMember` dans le CORPS de la requête. Un prospect
//      pouvait se compter comme collègue — c'est-à-dire polluer la séparation des populations que
//      ce produit vend — et se donner le titre de présentateur dans la table d'assistance.
//   2. `present-chat` vérifiait bien `isPresenter` par le control_token, mais laissait `isMember`
//      à l'affirmation du client. Deux poids sur la même ligne.
//   3. La liste des participants affichait « présentateur » d'après la charge de PRÉSENCE, que
//      chacun compose : `track({role:'presenter'})` suffisait à apparaître comme le présentateur
//      devant toute l'audience, avec le nom et l'avatar de son choix.
//
// ⚠️ Le point 3 ne se corrige PAS au niveau du canal : un participant légitime a le droit d'écrire
// sa présence. Le titre vient donc du serveur, qui seul sait qui a prouvé le control_token.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const CONTROL = "jeton-de-controle-du-presentateur";
const HASH = crypto.createHash("sha256").update(CONTROL).digest("hex");

let recu = null;
let messageRecu = null;
const vraies = require("../presentations.js");
require.cache[require.resolve("../presentations.js")] = {
  id: require.resolve("../presentations.js"), filename: require.resolve("../presentations.js"), loaded: true,
  exports: {
    ...vraies,
    getPresentation: async () => ({ slug: "s1", control_hash: HASH, current_page: 1, chat_locked: false, active: true }),
    recordAttendance: async (_slug, p) => { recu = p; return { ok: true }; },
    addMessage: async (_slug, p) => { messageRecu = p; return { ok: true, message: { id: 1 } }; },
    listMessages: async () => [],
    presenterKey: async () => "cle-du-vrai-presentateur",
  },
};
require.cache[require.resolve("../shares.js")] = {
  id: require.resolve("../shares.js"), filename: require.resolve("../shares.js"), loaded: true,
  exports: { ...require("../shares.js"), getShareBySlug: async () => null, logShareEvent: async () => {} },
};

const player = require("../handler.js");

const MEMBRES = { "jeton-de-session-valide": { email: "collegue@3d-discovery.fr" } };

function contexte() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {}, async signUpload() { return null; } },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() { return null; } },
    identity: {
      // ⚠️ L'hôte vérifie, le player ne devine pas. Un jeton inconnu n'est pas un membre.
      async verifyToken(autorisation) {
        const brut = String(autorisation || "").replace(/^Bearer\s+/i, "");
        return MEMBRES[brut] || null;
      },
      roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; },
    },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "", trackingNoticeAnonymous: "", publicUrl: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
}

async function poster(corps, autorisation) {
  recu = null; messageRecu = null;
  player.init(contexte());
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b || ""); } };
  const headers = { "content-type": "application/json" };
  if (autorisation) headers.authorization = "Bearer " + autorisation;
  await player.handler(
    { method: "POST", headers, socket: { remoteAddress: "1.2.3.4" }, query: {}, body: corps },
    res,
  );
  return res;
}

const assister = (extra, jeton) => poster({ action: "present-attend", slug: "s1", key: "k1", name: "Mallory", ...extra }, jeton);

describe("qui décide qu'un participant est le présentateur", () => {
  it("l'affirmer ne suffit plus", async () => {
    await assister({ isPresenter: true });
    expect(recu.isPresenter, "le corps de la requête ne décide plus du titre").toBe(false);
  });

  it("le prouver suffit", async () => {
    await assister({ control: CONTROL });
    expect(recu.isPresenter).toBe(true);
  });

  it("un mauvais jeton de contrôle ne donne rien", async () => {
    await assister({ control: "pas-le-bon", isPresenter: true });
    expect(recu.isPresenter).toBe(false);
  });
});

describe("qui décide qu'un participant est un membre", () => {
  it("l'affirmer ne suffit plus — c'est la séparation des populations qui en dépend", async () => {
    await assister({ isMember: true });
    expect(recu.isMember).toBe(false);
  });

  it("une session vérifiée par l'hôte suffit", async () => {
    await assister({}, "jeton-de-session-valide");
    expect(recu.isMember).toBe(true);
  });

  it("un jeton que l'hôte ne reconnaît pas ne vaut rien", async () => {
    await assister({ isMember: true }, "jeton-forge");
    expect(recu.isMember, "pas de repli sur l'affirmation, sinon la vérification ne sert qu'aux honnêtes")
      .toBe(false);
  });

  // La même règle sur le chat : `isPresenter` y était vérifié, `isMember` non.
  it("le chat applique la même règle aux deux", async () => {
    await poster({ action: "present-chat", slug: "s1", name: "Mallory", body: "coucou", isMember: true, isPresenter: true });
    expect(messageRecu.isMember).toBe(false);
    expect(messageRecu.isPresenter).toBe(false);
    await poster({ action: "present-chat", slug: "s1", name: "Vrai", body: "ok", control: CONTROL }, "jeton-de-session-valide");
    expect(messageRecu.isMember).toBe(true);
    expect(messageRecu.isPresenter).toBe(true);
  });
});

describe("la liste des participants ne croit plus la présence", () => {
  const SRC = fs.readFileSync(path.join(__dirname, "..", "handler.js"), "utf8");

  it("le badge se compare à la clé du serveur, il ne lit plus le rôle annoncé", () => {
    const ligne = SRC.split("\n").find((l) => l.includes("présentateur</span>"));
    expect(ligne, "la ligne du badge existe").toBeTruthy();
    expect(ligne, "un rôle annoncé par le participant ne doit plus décider")
      .not.toMatch(/role\s*===\s*'presenter'/);
    expect(ligne).toMatch(/PRESKEY/);
  });

  it("la clé est servie par la route d'état", async () => {
    player.init(contexte());
    const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b || ""); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { present: "s1", state: "1" } }, res);
    const d = JSON.parse(res.body);
    expect(d.state.presenter_key).toBe("cle-du-vrai-presentateur");
  });

  // ⚠️ Ce que la route d'état ne doit toujours PAS dire : elle est lue par l'audience entière.
  it("et rien d'autre ne fuit avec elle", async () => {
    player.init(contexte());
    const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b || ""); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { present: "s1", state: "1" } }, res);
    const cles = Object.keys(JSON.parse(res.body).state);
    expect(cles).not.toContain("control_hash");
    expect(cles).not.toContain("owner_email");
  });
});
