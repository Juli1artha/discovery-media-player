// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// DEUX DEMANDES SIMULTANÉES CRÉAIENT DEUX LIENS POUR LE MÊME USAGE.
//
// Le lien de l'hôte (un par document et destinataire attesté) et le lien de répétition (un par
// document) lisaient « existe-t-il déjà ? » puis inséraient : deux requêtes dans la même seconde
// passaient toutes deux la lecture, et les statistiques du document se fragmentaient entre deux
// liens. La contrainte (0011) promet ce que la lecture ne peut pas promettre ; le 409 qu'elle rend
// est une CONFIRMATION — on relit le gagnant et on le rend `reused`. Cinquième audit, P2.

const crypto = require("node:crypto");
const schema = require("../schema.js");
const { cleIdempotence } = require("../shares.js");

function harnais({ aveuglesDejaLa = 0, conflitSansGagnant = false, colonne = true } = {}) {
  // `aveuglesDejaLa` rejoue la FENÊTRE réelle : les N premières lectures « existe-t-il déjà ? »
  // rendent vide même si la ligne existe — c'est l'état que voient deux demandes simultanées.
  // Sans ça, les awaits de la route sérialisent les deux appels et la seconde trouve la ligne au
  // SELECT : le harnais validerait l'ancien code aussi.
  const etat = { lignes: [], captures: [], aveugles: aveuglesDejaLa };
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: {
      async request(chemin, o) {
        if (chemin.includes("select=idem_key&limit=0")) {
          if (!colonne) throw new Error("400 column idem_key does not exist");
          return [];
        }
        if (!o || !o.method) {
          const filtre = Object.fromEntries(chemin.split("?")[1].split("&").map((p) => p.split("=", 2)));
          if (!filtre.idem_key && etat.aveugles > 0) { etat.aveugles -= 1; return []; }
          let res = etat.lignes;
          if (filtre.idem_key) res = res.filter((l) => l.idem_key === decodeURIComponent(filtre.idem_key.slice(3)));
          if (filtre.doc_id) res = res.filter((l) => l.doc_id === decodeURIComponent(filtre.doc_id.slice(3)));
          if (filtre.is_test) res = res.filter((l) => String(!!l.is_test) === filtre.is_test.slice(3));
          if (filtre.created_by === "is.null") res = res.filter((l) => l.created_by == null);
          if (filtre.recipient_email === "is.null") res = res.filter((l) => l.recipient_email == null);
          if (filtre.attested_recipient_email === "is.null") res = res.filter((l) => l.attested_recipient_email == null);
          else if (filtre.attested_recipient_email) res = res.filter((l) => l.attested_recipient_email === decodeURIComponent(filtre.attested_recipient_email.slice(3)));
          return res.map((l) => ({ ...l }));
        }
        if (o.method === "POST") {
          const ligne = Array.isArray(o.body) ? o.body[0] : o.body;
          // ⚠️ Comme PostgREST : une colonne inconnue fait échouer le POST ENTIER.
          if (!colonne && "idem_key" in ligne) throw new Error("Supabase POST → 400 column idem_key does not exist");
          // ⚠️ LA CONTRAINTE, PAS UNE POLITESSE : même clé = 409, comme l'index partiel le ferait.
          if (ligne.idem_key && (conflitSansGagnant || etat.lignes.some((l) => l.idem_key === ligne.idem_key))) {
            throw new Error("Supabase POST commercial_doc_shares → 409 duplicate key cds_idem_key_uniq");
          }
          etat.lignes.push({ ...ligne });
          return [];
        }
        if (o.method === "PATCH") {
          const m = /slug=eq\.([^&]+)/.exec(chemin);
          const l = etat.lignes.find((x) => x.slug === decodeURIComponent(m[1]));
          // ⚠️ L'index partiel ne distingue pas INSERT et UPDATE : poser en PATCH une clé qu'une
          // AUTRE ligne porte déjà rend le même 409 que le POST — fidélité sans laquelle le
          // chemin de backfill semble sûr alors qu'il ne rattrape rien (septième audit).
          if (l && o.body && o.body.idem_key && etat.lignes.some((x) => x !== l && x.idem_key === o.body.idem_key)) {
            throw new Error("Supabase PATCH commercial_doc_shares → 409 duplicate key cds_idem_key_uniq");
          }
          if (l) Object.assign(l, o.body);
          return [];
        }
        return [];
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: { async verifyToken() { return { email: "membre@exemple.fr" }; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return true; }, isTrustedHostCall: (h) => h["x-player-host-secret"] === "hote-s3cret" },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { capture(e, c) { etat.captures.push({ m: String(e.message), benin: !!(c && c.benin) }); } },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], hostShare: true, hostFetchSecret: "s3cret" },
  };
  delete require.cache[require.resolve("../handler.js")];
  const player = require("../handler.js");
  player.init(ctx);
  schema.init(ctx);
  return { etat, player };
}

// Deux identités d'appel, jamais mélangées : l'HÔTE (secret serveur, docshare.create seulement)
// et le MEMBRE (jeton). L'en-tête d'hôte sur un appel membre est REJETÉ par la route — à raison.
async function appeler(player, body, { hote = false } = {}) {
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  const entetes = hote
    ? { "content-type": "application/json", "x-player-host-secret": "hote-s3cret" }
    : { "content-type": "application/json", authorization: "Bearer x" };
  await player.handler({ method: "POST", headers: entetes, socket: {}, query: {}, body }, res);
  return { statut: res.statusCode, corps: JSON.parse(res.body || "{}") };
}

describe("un usage, un lien — la contrainte tranche, le perdant relit", () => {
  it("deux demandes SIMULTANÉES de lien hôte rendent le MÊME slug, une seule ligne", async () => {
    const { etat, player } = harnais({ aveuglesDejaLa: 2 });
    const demande = () => appeler(player, { action: "docshare.create", docId: "doc-1", fileUrl: "https://exemple.supabase.co/storage/v1/object/public/resources/d.pdf" }, { hote: true });
    const [a, b] = await Promise.all([demande(), demande()]);

    expect(a.corps.ok && b.corps.ok).toBe(true);
    expect(a.corps.slug, "deux liens pour le même usage : les statistiques se fragmentent").toBe(b.corps.slug);
    expect(etat.lignes.filter((l) => l.doc_id === "doc-1").length).toBe(1);
    expect([a.corps.reused, b.corps.reused].sort()).toEqual([false, true]);
    expect(etat.captures.filter((c) => c.benin).length, "le conflit rattrapé doit parler").toBe(1);
  });

  it("le réemploi d'une ligne HISTORIQUE (sans clé) lui pose la clé au passage", async () => {
    const { etat, player } = harnais();
    etat.lignes.push({ slug: "ancien-lien", doc_id: "doc-2", created_by: null, recipient_email: null, attested_recipient_email: null, idem_key: null });
    const r = await appeler(player, { action: "docshare.create", docId: "doc-2", fileUrl: "https://exemple.supabase.co/storage/v1/object/public/resources/d.pdf" }, { hote: true });
    expect(r.corps.reused).toBe(true);
    expect(r.corps.slug).toBe("ancien-lien");
    expect(etat.lignes[0].idem_key, "sans backfill, les doublons historiques ne s'éteignent jamais").toBe(cleIdempotence("hote", ["doc-2", ""]));
  });

  // ⚠️ SIXIÈME AUDIT : la clé était TRONQUÉE à 300 caractères à l'écriture mais relue ENTIÈRE
  // après un 409 — sur un docId long, le perdant LÉGITIME ne trouvait pas de gagnant et notre
  // propre garde « un 409 sans gagnant remonte » le finissait en 500. Deux exemplaires du même
  // fait (la clé écrite, la clé relue), jamais confrontés sur leur longueur.
  // ⚠️ SEPTIÈME AUDIT : le chemin de CRÉATION rattrapait le 409 en relisant le gagnant ; le
  // chemin de BACKFILL (réemploi d'une ligne historique) posait la même clé SANS rattrapage —
  // le correctif ne s'était pas appliqué à lui-même. Deux doublons d'avant 0011 en concurrence :
  // l'un reçoit la clé, l'autre doit relire le gagnant, pas finir en 500.
  it("le backfill d'une ligne historique rattrape le 409 et relit le gagnant", async () => {
    const { etat, player } = harnais();
    etat.lignes.push({ slug: "gagnant", doc_id: "doc-vieux", created_by: "x@y.fr", recipient_email: "z@y.fr", attested_recipient_email: null, idem_key: cleIdempotence("hote", ["doc-vieux", ""]) });
    etat.lignes.push({ slug: "doublon-legacy", doc_id: "doc-vieux", created_by: null, recipient_email: null, attested_recipient_email: null, idem_key: null });
    const r = await appeler(player, { action: "docshare.create", docId: "doc-vieux", fileUrl: "https://exemple.supabase.co/storage/v1/object/public/resources/d.pdf" }, { hote: true });
    expect(r.corps.ok, "le perdant du backfill doit relire le gagnant, pas finir en 500").toBe(true);
    expect(r.corps.slug).toBe("gagnant");
    expect(r.corps.reused).toBe(true);
  });

  it("l'empreinte fixe les frontières : un | dans une composante ne déplace rien", () => {
    expect(cleIdempotence("hote", ["doc|a", "b"])).not.toBe(cleIdempotence("hote", ["doc", "a|b"]));
    expect(cleIdempotence("hote", ["doc-1", ""])).toBe(cleIdempotence("hote", ["doc-1", ""]));
    expect(cleIdempotence("hote", ["doc-1", ""]).length).toBeLessThan(80);
  });

  it("un docId de 320 caractères : deux demandes simultanées rendent le MÊME slug, pas un 500", async () => {
    const { etat, player } = harnais({ aveuglesDejaLa: 2 });
    const docLong = "d".repeat(320);
    const demande = () => appeler(player, { action: "docshare.create", docId: docLong, fileUrl: "https://exemple.supabase.co/storage/v1/object/public/resources/d.pdf" }, { hote: true });
    const [a, b] = await Promise.all([demande(), demande()]);
    expect(a.corps.ok && b.corps.ok, "le perdant légitime d'un docId long doit relire le gagnant, pas finir en 500").toBe(true);
    expect(a.corps.slug).toBe(b.corps.slug);
    expect(etat.lignes.filter((l) => l.doc_id === docLong).length).toBe(1);
  });

  it("deux docId partageant 300 caractères de préfixe font DEUX liens, pas une collision", async () => {
    const { etat, player } = harnais();
    const prefixe = "p".repeat(310);
    const url = "https://exemple.supabase.co/storage/v1/object/public/resources/d.pdf";
    const a = await appeler(player, { action: "docshare.create", docId: prefixe + "-alpha", fileUrl: url }, { hote: true });
    const b = await appeler(player, { action: "docshare.create", docId: prefixe + "-beta", fileUrl: url }, { hote: true });
    expect(a.corps.ok && b.corps.ok, "un préfixe partagé ne doit voler le lien de personne").toBe(true);
    expect(a.corps.slug).not.toBe(b.corps.slug);
    expect(etat.lignes.length).toBe(2);
  });

  it("deux ouvertures simultanées de la répétition : un seul lien de test", async () => {
    const { etat, player } = harnais({ aveuglesDejaLa: 2 });
    const demande = () => appeler(player, { action: "docshare.test", docId: "doc-3", fileUrl: "https://exemple.supabase.co/storage/v1/object/public/resources/d.pdf" });
    const [a, b] = await Promise.all([demande(), demande()]);
    expect(a.corps.slug).toBe(b.corps.slug);
    expect(etat.lignes.filter((l) => l.is_test).length).toBe(1);
  });

  it("un 409 qui ne vient PAS de la clé remonte — on n'invente pas un gagnant", async () => {
    // Le POST rend 409 mais AUCUNE ligne ne porte la clé : le conflit venait d'autre chose, et le
    // transformer en `reused` ferait croire à un lien qui n'existe pas.
    const { player } = harnais({ conflitSansGagnant: true });
    const r = await appeler(player, { action: "docshare.create", docId: "doc-4", fileUrl: "https://exemple.supabase.co/storage/v1/object/public/resources/d.pdf" }, { hote: true });
    expect(r.statut, "un 409 inexpliqué transformé en reused ferait croire à un lien qui n'existe pas").toBeGreaterThanOrEqual(500);
  });

  // ⚠️ LA MUTATION QUI A SURVÉCU : la clé écrite SANS sonde. Chez un hôte non migré, PostgREST
  // rejette le POST entier — ce n'est pas l'unicité qu'on perdrait, c'est la CRÉATION de liens.
  it("chez un hôte non migré : le lien se crée quand même, sans clé", async () => {
    const { etat, player } = harnais({ colonne: false });
    const r = await appeler(player, { action: "docshare.create", docId: "doc-6", fileUrl: "https://exemple.supabase.co/storage/v1/object/public/resources/d.pdf" }, { hote: true });
    expect(r.corps.ok, "écrire la clé sans sonde casse la création chez l'hôte en retard").toBe(true);
    expect(etat.lignes.filter((l) => l.doc_id === "doc-6").length).toBe(1);
    expect(etat.lignes.find((l) => l.doc_id === "doc-6").idem_key).toBeUndefined();
  });

  it("les liens ORDINAIRES restent illimités — la clé ne les touche pas", async () => {
    const crypto2 = crypto; void crypto2;
    const { etat } = harnais();
    const shares = require("../shares.js");
    await shares.createShare({ docId: "doc-5", fileUrl: "https://x/d.pdf", recipientEmail: "a@x.fr" });
    await shares.createShare({ docId: "doc-5", fileUrl: "https://x/d.pdf", recipientEmail: "b@x.fr" });
    expect(etat.lignes.filter((l) => l.doc_id === "doc-5").length, "un membre doit pouvoir envoyer le même document à plusieurs destinataires").toBe(2);
    expect(etat.lignes.filter((l) => l.doc_id === "doc-5" && l.idem_key).length).toBe(0);
  });
});
