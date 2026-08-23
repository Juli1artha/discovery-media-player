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

const CONTROL = "jeton-de-controle-du-presentateur";
const HASH = crypto.createHash("sha256").update(CONTROL).digest("hex");

let recu = null;
let recuOptions = null;
let messageRecu = null;
const vraies = require("../presentations.js");
require.cache[require.resolve("../presentations.js")] = {
  id: require.resolve("../presentations.js"), filename: require.resolve("../presentations.js"), loaded: true,
  exports: {
    ...vraies,
    getPresentation: async () => ({ slug: "s1", control_hash: HASH, current_page: 1, chat_locked: false, active: true, presenter_name: "Camille" }),
    recordAttendance: async (_slug, p, o) => { recu = p; recuOptions = o || {}; return { ok: true }; },
    addMessage: async (_slug, p) => { messageRecu = p; return { ok: true, message: { id: 1 } }; },
    listMessages: async () => [],
  },
};
require.cache[require.resolve("../shares.js")] = {
  id: require.resolve("../shares.js"), filename: require.resolve("../shares.js"), loaded: true,
  exports: { ...require("../shares.js"), getShareBySlug: async () => null, logShareEvent: async () => {} },
};

const player = require("../handler.js");

const MEMBRES = {
  "jeton-de-session-valide": {
    email: "collegue@3d-discovery.fr",
    user_metadata: { name: "Camille Réelle", avatarUrl: "https://exemple.fr/camille.png" },
  },
};

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
  recu = null; recuOptions = null; messageRecu = null;
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

  // ⚠️ LA DÉCISION A CHANGÉ DE CAMP — CE TEST NE PEUT PLUS PROUVER LA MOITIÉ QUI EST PARTIE.
  //
  // Depuis 0019, la route ne lit plus la présentation : elle transmet l'EMPREINTE du jeton et c'est
  // la base qui compare, dans la transaction d'écriture. Ce fichier garde donc la moitié qu'il peut
  // encore observer — la route transmet une preuve et n'accorde plus rien elle-même — et la seconde
  // moitié, « l'empreinte juste accorde le titre, la fausse ne l'accorde pas », est mesurée contre un
  // vrai Postgres dans base/presenceFusionnee.test.js.
  //
  // ⚠️ ÉCRIT ICI PARCE QU'UNE PREUVE COUPÉE EN DEUX SE PERD : chaque moitié reste verte toute seule
  // pendant que la propriété, elle, ne tient plus. Les deux fichiers se nomment l'un l'autre.
  it("le prouver, c'est transmettre la preuve — pas se déclarer", async () => {
    await assister({ control: CONTROL });
    expect(recuOptions.controlHash, "l'empreinte du jeton monte jusqu'à la base").toBe(HASH);
    expect(recu.isPresenter, "la route n'accorde plus le titre elle-même").toBe(false);
  });

  // ⚠️ LE JETON LUI-MÊME NE DOIT PAS DESCENDRE. C'est ce qui distingue « transmettre une preuve » de
  // « faire circuler un secret » : la base reçoit de quoi comparer, jamais de quoi se faire passer
  // pour le présentateur ailleurs. Le jeton de contrôle pilote la présentation — il vaut le mot de
  // passe de la session.
  it("le jeton de contrôle ne descend jamais, seulement son empreinte", async () => {
    await assister({ control: CONTROL });
    expect(JSON.stringify(recuOptions).includes(CONTROL)).toBe(false);
  });

  it("un mauvais jeton de contrôle ne donne rien", async () => {
    await assister({ control: "pas-le-bon", isPresenter: true });
    expect(recuOptions.controlHash, "une empreinte fausse reste fausse").not.toBe(HASH);
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

  // ⚠️ ET L'IDENTITÉ AVEC. `isPresenter` et `isMember` étaient vérifiés depuis 0.1.25/0.1.28, mais
  // `name`, `email` et `avatar` venaient toujours du CORPS — même quand un jeton valide accompagnait
  // l'appel. Un membre authentifié pouvait donc publier sous le nom et l'adresse d'un collègue, AVEC
  // le badge membre. Ça ne donnait aucun droit (modifier/supprimer s'autorisent par `author_hash`),
  // mais dans une discussion, un message signé du nom d'un autre EST le problème. (audit P1-6)
  it("une identité prouvée remplace celle qu'on affirme, elle ne s'y ajoute pas", async () => {
    await poster({
      action: "present-chat", slug: "s1", body: "coucou",
      name: "Quelqu'un d'autre", email: "victime@3d-discovery.fr", avatar: "https://exemple.fr/faux.png",
    }, "jeton-de-session-valide");
    expect(messageRecu.email, "l'adresse vient du jeton").toBe("collegue@3d-discovery.fr");
    expect(messageRecu.name, "le nom aussi").toBe("Camille Réelle");
    expect(messageRecu.avatar).toBe("https://exemple.fr/camille.png");
  });

  it("sans jeton, l'invité garde le nom qu'il s'est donné — c'est le mode prévu", async () => {
    await poster({ action: "present-chat", slug: "s1", body: "salut", name: "Invitée", email: "" });
    expect(messageRecu.name).toBe("Invitée");
    expect(messageRecu.isMember).toBe(false);
  });

  it("la ligne d'assistance suit la même règle", async () => {
    await assister({ name: "Quelqu'un d'autre", email: "victime@3d-discovery.fr" }, "jeton-de-session-valide");
    expect(recu.email).toBe("collegue@3d-discovery.fr");
    expect(recu.name).toBe("Camille Réelle");
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

// ⚠️ COMPARER DEUX VALEURS QUE LE CLIENT CHOISIT OU CONNAÎT N'EST PAS UNE PREUVE.
//
// 0.1.25 avait remplacé « le participant déclare `role:"presenter"` » par « le participant déclare
// un `uid` égal à la clé que le serveur publie ». Plus laborieux à exploiter, pas plus vrai : la
// clé sortait sur `state=1`, route publique, et l'`uid` de la charge de présence est COMPOSÉ par
// le client. Lire, puis s'annoncer avec.
//
// ⚠️ Et la clé était pire qu'inutile : `attendeeKey()` renvoie l'ADRESSE E-MAIL quand le
// participant en a une. La route publiait donc l'e-mail du présentateur à tout visiteur anonyme —
// sur la route même dont le commentaire promet « rien que ce que l'audience doit savoir ». Un nom
// de champ technique, et personne n'est allé voir ce qu'il contenait.
//
// Le titre ne se compare plus : il vient de l'hôte (`presenter_name`), et il s'affiche À PART de
// la liste des participants, qui ne porte plus aucun badge.
describe("le titre ne se compare plus à rien", () => {
  const SRC = require("./sourceDesPages.cjs").SOURCE_PAGES;

  it("la liste des participants ne porte plus de badge", () => {
    expect(SRC, "un badge dans la liste se fonde forcément sur la présence, donc sur le client")
      .not.toContain("présentateur</span>");
  });

  it("aucune comparaison à une valeur venue de la présence", () => {
    expect(SRC).not.toMatch(/m\.uid\s*===/);
    expect(SRC).not.toContain("PRESKEY");
  });

  // ⚠️ LA FUITE. Ce que la route d'état ne doit pas dire, elle est lue par toute l'audience.
  it("la route d'état ne publie plus de clé de participant", async () => {
    player.init(contexte());
    const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b || ""); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { present: "s1", state: "1" } }, res);
    const st = JSON.parse(res.body).state;
    expect(Object.keys(st)).not.toContain("presenter_key");
    expect(JSON.stringify(st), "aucune adresse e-mail dans une réponse publique").not.toMatch(/@/);
  });

  it("elle publie le nom, qui vient de l'hôte et ne se compare à rien", async () => {
    player.init(contexte());
    const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b || ""); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { present: "s1", state: "1" } }, res);
    expect(JSON.parse(res.body).state.presenter_name).toBe("Camille");
  });

  // ⚠️ Ce que la route ne doit toujours pas dire.
  it("et rien d'autre ne fuit avec lui", async () => {
    player.init(contexte());
    const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b || ""); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { present: "s1", state: "1" } }, res);
    const cles = Object.keys(JSON.parse(res.body).state);
    expect(cles).not.toContain("control_hash");
    expect(cles).not.toContain("owner_email");
  });
});
