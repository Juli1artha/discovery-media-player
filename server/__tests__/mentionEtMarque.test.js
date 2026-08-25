// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUE VOIT QUELQU'UN QUI N'A REÇU AUCUN MESSAGE.
//
// Deux défauts de la même famille, signalés par le second hôte en regardant son propre écran —
// ce qu'aucun test ne fait. Les deux étaient vrais tant qu'une instance servait UN public.
//
// 1. LA MENTION INVENTAIT UN EXPÉDITEUR. « transmise à son expéditeur » est juste pour un lien
//    nominatif et faux pour une plaquette publique ouverte depuis une carte : personne ne l'a
//    envoyée. C'est la seule phrase du produit dont l'objet est d'être exacte.
//
// 2. LE TITRE D'ONGLET AFFICHAIT L'EXPLOITANT. Un visiteur venu sur la marque d'un client lisait
//    le nom de la société qui opère l'outil — qui ne le concerne pas.
//
// ⚠️ Aucune configuration nouvelle n'a été nécessaire : la distinction « sans expéditeur » est la
// clé d'idempotence des liens de l'hôte, et la marque du lien est déjà résolue pour le loader.
// Les deux signaux existaient ; le code ne les consultait pas.

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
require.cache[ID] = { id: ID, filename: ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => null, listMessages: async () => [] } };

const SHARES = {
  // Lien de l'hôte : ni destinataire, ni créateur. Marque cliente attachée.
  anonyme: { slug: "Anon-_xYz9012", doc_id: "d1", doc_title: "Plaquette", file_name: "p.pdf",
    file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/p.pdf",
    recipient_email: null, created_by: null, brand_key: "valoneuf", revoked: false },
  // Lien nominatif : un membre l'a envoyé à quelqu'un.
  nominatif: { slug: "Nomi-_xYz9012", doc_id: "d2", doc_title: "Proposition", file_name: "p.pdf",
    file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/p.pdf",
    recipient_email: "prospect@exemple.fr", created_by: "commercial@exemple.fr", revoked: false },
};

const vraisShares = require("../shares.js");
require.cache[require.resolve("../shares.js")] = {
  id: require.resolve("../shares.js"), filename: require.resolve("../shares.js"), loaded: true,
  exports: {
    ...vraisShares,
    getShareBySlug: async (slug) => {
      const t = Object.values(SHARES).find((x) => x.slug === slug);
      return t ? { ...t } : null;
    },
    logShareEvent: async () => {},
  },
};

const player = require("../handler.js");

function contexte({ marqueClient = { logo: "https://cdn/valoneuf.png", name: "VALONEUF", dark: false } } = {}) {
  return {
    plugins: {}, has: () => false,
    storage: {
      isAllowedUrl: (u) => String(u || "").startsWith("https://exemple.supabase.co/"),
      async fetchFile() { return null; }, async put() {}, async signUpload() { return null; },
    },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: {
      async logo() { return ""; },
      name: "ADN FAMILY", poweredBy: "ADN FAMILY", loaderName: "ADN FAMILY",
      async forKey(k) { return k === "valoneuf" ? marqueClient : null; },
      title: (base, q) => [base, q, "ADN FAMILY"].filter(Boolean).join(" — "),
    },
    errors: { async capture() {} },
    legal: {
      sourceUrl: "", legalUrl: "", privacyUrl: "",
      trackingNotice: "La consultation de ce document est mesurée (pages vues, temps de lecture) et transmise à son expéditeur.",
      trackingNoticeAnonymous: "La consultation de ce document est mesurée (pages vues, temps de lecture).",
    },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
}

async function ouvrir(slug, opts) {
  player.init(contexte(opts));
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  await player.handler({ method: "GET", headers: {}, socket: {}, query: { slug } }, res);
  return res.body;
}

describe("la mention de mesure dit la vérité sur CE lien", () => {
  it("un lien sans expéditeur n'en invente pas un", async () => {
    const html = await ouvrir(SHARES.anonyme.slug);
    expect(html).toContain("La consultation de ce document est mesurée");
    expect(html, "aucun expéditeur ne doit être évoqué").not.toContain("transmise à son expéditeur");
  });

  it("un lien nominatif garde la mention complète — quelqu'un l'a bien envoyé", async () => {
    const html = await ouvrir(SHARES.nominatif.slug);
    expect(html).toContain("transmise à son expéditeur");
  });

  // ⚠️ Un hôte qui n'a pas encore de liens sans expéditeur ne doit rien voir changer : sans le
  // second texte, on retombe sur le premier plutôt que d'afficher une mention vide — une mention
  // absente serait un problème d'une tout autre gravité que d'être imprécise.
  it("sans second texte fourni, on retombe sur le premier au lieu de ne rien dire", async () => {
    const ctx = contexte();
    delete ctx.legal.trackingNoticeAnonymous;
    player.init(ctx);
    const res = { statusCode: 0, headers: {}, body: "", setHeader() {}, end(b) { this.body = String(b || ""); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { slug: SHARES.anonyme.slug } }, res);
    expect(res.body).toContain("transmise à son expéditeur");
  });
});

describe("le titre d'onglet porte la marque sous laquelle on a cliqué", () => {
  it("celle du lien quand il en a une", async () => {
    const html = await ouvrir(SHARES.anonyme.slug);
    const titre = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    expect(titre).toContain("VALONEUF");
    expect(titre, "le nom de l'exploitant ne concerne pas ce visiteur").not.toContain("ADN FAMILY");
  });

  it("celle de l'instance quand le lien n'en porte aucune", async () => {
    const html = await ouvrir(SHARES.nominatif.slug);
    const titre = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    expect(titre).toContain("ADN FAMILY");
  });

  // Une marque introuvable ne doit pas produire un titre amputé : on retombe sur l'instance.
  it("une marque qui ne résout pas ne casse pas le titre", async () => {
    const html = await ouvrir(SHARES.anonyme.slug, { marqueClient: null });
    const titre = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || "";
    expect(titre).toContain("Plaquette");
    expect(titre).toContain("ADN FAMILY");
  });
});
