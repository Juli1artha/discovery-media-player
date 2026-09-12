// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ON N'ENVOIE DE COURRIER QUE POUR UN LIEN QUI A UN DESTINATAIRE.
//
// Le lecteur d'un lien ANONYME est un visiteur quelconque. Lui laisser demander un envoi ferait
// des serveurs de l'hôte un relais de courrier non sollicité, avec SON domaine dans l'en-tête.
//
// ⚠️ Ce qui coûte cher n'est pas le message parti, c'est ce qu'il emporte : une réputation
// d'expéditeur perdue met des semaines à revenir, et pendant ce temps AUCUN email de l'hôte
// n'arrive — factures, relances, notifications d'équipe comprises. Une commodité sur une page
// publique mettrait en jeu tout son courrier transactionnel.
//
// ⚠️ ET LA GARDE EST ICI, SUR LE CHEMIN QUI AGIT. Le second hôte l'a réclamée CHEZ NOUS alors
// qu'il pouvait la poser chez lui, et son argument est le bon : un filtre à l'arrivée dépend
// d'une liste à jour ; un chemin qui ne sait pas formuler la demande ne la formulera jamais par
// accident. C'est la même logique que les trois verrous de `docshare.create` — et l'exact
// pendant du défaut de re-partage corrigé le même jour, où une restriction disparaissait parce
// qu'un chemin ne l'avait pas recopiée.

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
require.cache[ID] = { id: ID, filename: ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => null, listMessages: async () => [] } };

const PARENTS = {
  // Créé par un membre, pour quelqu'un : une responsabilité est engagée derrière.
  nominatif: { slug: "Nomi-_xYz9012", doc_id: "d1", doc_title: "Proposition", file_name: "p.pdf",
    file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/p.pdf",
    recipient_email: "premier@exemple.fr", recipient_name: "Premier",
    created_by: "commercial@exemple.fr", revoked: false },
  // Créé par l'hôte pour une carte publique : personne derrière.
  anonyme: { slug: "Anon-_xYz9012", doc_id: "d2", doc_title: "Plaquette", file_name: "p.pdf",
    file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/p.pdf",
    recipient_email: null, recipient_name: null, created_by: null, revoked: false },
};

const vraisShares = require("../shares.js");
let courriers = [];
require.cache[require.resolve("../shares.js")] = {
  id: require.resolve("../shares.js"), filename: require.resolve("../shares.js"), loaded: true,
  exports: {
    ...vraisShares,
    getShareBySlug: async (slug) => {
      const t = Object.values(PARENTS).find((x) => x.slug === slug);
      return t ? { ...t } : null;
    },
    createReshare: async () => ({ slug: "Enfant-_xY12", docTitle: "Doc" }),
    // ⚠️ PILOTABLE, parce que les trois issues d'un envoi ne se distinguent que par ce que l'hôte
    // fait : accepter, refuser, ou ne pas répondre à temps. Un envoyeur figé n'en montre qu'une.
    sendReshareEmail: async (m) => { courriers.push(m); return envoyeur(m); },
    logShareEvent: async () => {},
  },
};

let envoyeur = async () => ({ sent: true });

const player = require("../handler.js");

function contexte() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {}, async signUpload() { return null; } },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() { return { sent: true }; } },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { publicUrl: "https://doc.exemple.fr", sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "", trackingNoticeAnonymous: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], hostMail: true },
  };
}

async function repartager(slugParent, { send = true, envoi } = {}) {
  courriers = [];
  envoyeur = envoi || (async () => ({ sent: true }));
  player.init(contexte());
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  await player.handler(
    { method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {},
      body: { action: "reshare", slug: slugParent, email: "destinataire@exemple.fr", name: "Destinataire", send } },
    res,
  );
  return { statut: res.statusCode, corps: JSON.parse(res.body || "{}"), courriers };
}

describe("qui a le droit de faire partir un email", () => {
  it("un lien nominatif : oui — quelqu'un s'est authentifié pour le créer", async () => {
    const r = await repartager(PARENTS.nominatif.slug);
    expect(r.corps.ok).toBe(true);
    expect(r.corps.sent).toBe(true);
    expect(r.courriers).toHaveLength(1);
  });

  // ⚠️ LE CŒUR DU SUJET.
  it("un lien anonyme : non — et AUCUN appel ne part vers l'hôte", async () => {
    const r = await repartager(PARENTS.anonyme.slug);
    expect(r.corps.sent).toBe(false);
    expect(r.courriers, "l'appel ne doit pas être émis, pas seulement refusé à l'arrivée").toHaveLength(0);
  });

  // Le lien enfant existe quand même : on perd l'automatisme, pas la mesure. Un visiteur peut
  // toujours copier le lien et l'envoyer depuis sa propre messagerie — et il restera tracé.
  it("le lien est tout de même créé : on perd l'envoi, pas le suivi", async () => {
    const r = await repartager(PARENTS.anonyme.slug);
    expect(r.corps.ok).toBe(true);
    expect(r.corps.slug).toBeTruthy();
  });

  // « Rien n'est parti » et « l'envoi n'était pas permis » ne se ressemblent pas. Une interface
  // qui les confond laisse en place un bouton qui ne marchera jamais.
  it("le refus se dit, il ne se devine pas", async () => {
    const r = await repartager(PARENTS.anonyme.slug);
    expect(r.corps.sendRefused).toBe("no-recipient");
    const ok = await repartager(PARENTS.nominatif.slug);
    expect(ok.corps.sendRefused).toBeUndefined();
  });

  it("sans demande d'envoi, rien ne part et rien ne se plaint", async () => {
    const r = await repartager(PARENTS.nominatif.slug, { send: false });
    expect(r.courriers).toHaveLength(0);
    expect(r.corps.sendRefused).toBeUndefined();
  });
});

// L'hôte qui compose lui-même doit pouvoir n'emprunter AUCUN texte venu de l'appelant.
describe("ce que la charge utile permet à l'hôte", () => {
  const shares = require("../shares.js");

  it("porte les éléments séparés, et marque ce qui vient du dehors", async () => {
    const envoyes = [];
    shares.init({
      branding: { async logo() { return ""; } },
      mail: { async send(m) { envoyes.push(m); return { sent: true }; } },
    });
    await vraisShares.sendReshareEmail({
      parent: { ...PARENTS.nominatif }, childSlug: "Enfant-_xY12",
      origin: "https://doc.exemple.fr", toEmail: "b@exemple.fr", toName: "<script>Bob",
    });
    const m = envoyes[0];
    expect(m.kind).toBe("reshare");
    expect(m.doc.title).toBe("Proposition");
    expect(m.doc.url).toContain("Enfant-_xY12");
    expect(m.from.email).toBe("premier@exemple.fr");
    // ⚠️ Le nom fourni par l'appelant est isolé sous `untrusted` : un hôte qui compose peut
    // l'ignorer d'un seul geste, au lieu d'avoir à se souvenir lequel des champs est douteux.
    expect(m.untrusted.toName).toBe("<script>Bob");
    expect(m.doc.title).not.toContain("script");
  });
});

// ⚠️ « SENT: FALSE » MENTAIT QUAND LA VÉRITÉ ÉTAIT « JE NE SAIS PAS », ET C'EST CE MENSONGE QUI
// DUPLIQUE LES COURRIERS.
//
// Trois issues tenaient dans un booléen : l'hôte a refusé, NOUS avons refusé, ou l'appel a échoué
// sans que nous sachions ce que l'hôte a fait. Le dernier cas est le seul dangereux — si l'hôte a
// réellement envoyé puis répondu trop tard, un client qui lit « false » réessaie, et crée un SECOND
// lien enfant en envoyant un SECOND courrier. Relevé par un audit externe le 12/09.
//
// ⚠️ C'EST LA DOCTRINE DE `bot-tts` RETOURNÉE. Là-bas, « je n'ai pas pu vérifier » doit se lire NON,
// parce que le doute empêche une dépense. Ici, le doute lu comme « non » PROVOQUE la dépense. La
// règle constante n'est donc pas « dans le doute, non » — c'est « dans le doute, DIS-LE ».
describe("⚠️ les trois issues d'un envoi ne tiennent pas dans un booléen", () => {
  const NOMINATIF = Object.values(PARENTS).find((p) => p.recipient_email).slug;

  it("l'hôte envoie : delivery « sent »", async () => {
    const r = await repartager(NOMINATIF);
    expect(r.corps.sent).toBe(true);
    expect(r.corps.delivery).toBe("sent");
  });

  it("⚠️ l'appel ÉCHOUE sans réponse : « unknown », jamais « refused » ni un simple false", async () => {
    const r = await repartager(NOMINATIF, { envoi: async () => { throw new Error("délai dépassé"); } });
    expect(r.corps.sent, "le booléen historique ne change pas — les intégrations le lisent").toBe(false);
    expect(r.corps.delivery,
      "« refused » ferait croire à une décision ; un réessai sur « unknown » peut DOUBLER le courrier")
      .toBe("unknown");
    expect(r.corps.sendRefused, "aucun refus n'a été prononcé").toBeUndefined();
    expect(r.corps.slug, "le lien enfant existe quand même : on perd l'envoi, pas le suivi").toBeTruthy();
  });

  it("l'hôte répond « non » : « refused », et la cause est nommée", async () => {
    const r = await repartager(NOMINATIF, { envoi: async () => ({ sent: false }) });
    expect(r.corps.delivery).toBe("refused");
    expect(r.corps.sendRefused).toBe("host-declined");
  });

  it("notre propre refus reste « refused », avec sa cause d'origine", async () => {
    const anonyme = Object.values(PARENTS).find((p) => !p.recipient_email).slug;
    const r = await repartager(anonyme);
    expect(r.corps.delivery).toBe("refused");
    expect(r.corps.sendRefused).toBe("no-recipient");
  });

  it("rien n'a été demandé : « not-requested » — ne pas confondre avec un échec", async () => {
    const r = await repartager(NOMINATIF, { send: false });
    expect(r.corps.delivery).toBe("not-requested");
    expect(r.corps.sent).toBe(false);
  });
});
