// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// « CONTACTER L'EXPÉDITEUR » (#608) : l'action pleine d'un lien tracé ouvert seul, un `mailto:` vers `created_by`.
//
// ⚠️ LE RISQUE PROPRE À CE LOT : donner une adresse à la mauvaise personne. Sur un re-partage, `created_by` est
// celui qui a TRANSFÉRÉ (un destinataire) : « Contacter » lui écrirait, et livrerait son adresse au suivant. D'où
// les essais qui rendent la vraie page, lien d'origine contre lien transféré, et cherchent l'adresse dans le HTML.
//
// Dimensions VARIÉES : re-partage ou non, aperçu, cadre, adresse présente / absente / douteuse, gabarit ou non.
// Dimensions TENUES FIXES : aucun assistant, aucun mur d'accès (la page est rendue directement par `viewerHtml`).

const vm = require("node:vm");
const player = require("../handler.js");
const { viewerHtml } = require("../page-visionneuse.js");
const { reglagesLecture, contactDuLien, mailtoContact, actionsDeLecture } = require("../gabarit-lecture.js");

function contexteMinimal() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "cle", mapsKey: "", extraFrameAncestors: [] },
  };
}

const EXPEDITEUR = "conseiller@exemple.fr";
const lien = (extra) => ({
  slug: "abc123", doc_id: "d1", doc_title: "Plan du lot A14", file_name: "plan.pdf",
  file_url: "https://exemple.supabase.co/storage/v1/object/public/r/plan.pdf",
  created_by: EXPEDITEUR, recipient_email: "client@exemple.fr", parent_slug: null, allow_download: true,
  lecture: reglagesLecture({ gabarit: "lecture", primary: "contact", primaryLabel: "Contacter mon conseiller" }),
  ...extra,
});
function rendre(share) {
  player.init(contexteMinimal());
  return viewerHtml(share, "n0nce", "", null);
}

describe("contactDuLien — à qui « Contacter » écrirait", () => {
  it("un lien d'origine, ouvert seul : son expéditeur", () => {
    expect(contactDuLien(lien(), { preview: false, embedded: false })).toBe(EXPEDITEUR);
  });
  it("⚠️ un re-partage : personne (created_by y est celui qui a transféré)", () => {
    expect(contactDuLien(lien({ parent_slug: "parent1", created_by: "client@exemple.fr" }), { preview: false, embedded: false })).toBeNull();
  });
  it("ni en aperçu, ni dans un cadre", () => {
    expect(contactDuLien(lien(), { preview: true, embedded: false })).toBeNull();
    expect(contactDuLien(lien(), { preview: false, embedded: true })).toBeNull();
  });
  it("ni sans adresse, ni avec une adresse qui ouvrirait d'autres paramètres du mailto", () => {
    expect(contactDuLien(lien({ created_by: null }), { preview: false, embedded: false })).toBeNull();
    for (const douteuse of ["a@b.fr?cc=x@y.fr", "a b@c.fr", "a@b.fr&body=x", "\"a\"@b.fr", "pas-une-adresse"]) {
      expect(contactDuLien(lien({ created_by: douteuse }), { preview: false, embedded: false }), douteuse).toBeNull();
    }
  });
});

describe("mailtoContact", () => {
  it("l'adresse, le titre en objet, encodé", () => {
    expect(mailtoContact(EXPEDITEUR, "Plan  du lot A14 & co")).toBe("mailto:conseiller@exemple.fr?subject=Plan%20du%20lot%20A14%20%26%20co");
  });
  it("sans titre, pas d'objet", () => {
    expect(mailtoContact(EXPEDITEUR, "")).toBe("mailto:conseiller@exemple.fr");
  });
});

describe("reglagesLecture et actionsDeLecture", () => {
  it("`primary=contact` est accepté, et renommable", () => {
    expect(reglagesLecture({ gabarit: "lecture", primary: "contact", primaryLabel: "Contacter mon conseiller" })).toMatchObject({ primary: "contact", primaryLabel: "Contacter mon conseiller" });
  });
  it("sans adresse, l'action n'existe pas — où qu'on la place", () => {
    const r = reglagesLecture({ gabarit: "lecture", primary: "contact" });
    expect(actionsDeLecture(r, { preview: false, allowDownload: true }).map((a) => a.id)).not.toContain("contact");
    expect(actionsDeLecture(r, { preview: false, allowDownload: true, contact: "mailto:x@y.fr" })[0]).toEqual({ id: "contact", label: "Contacter l'expéditeur", place: "primary" });
  });
});

describe("la vraie page", () => {
  it("lien d'origine : « Contacter mon conseiller » en plein, vers l'expéditeur, le titre en objet", () => {
    const html = rendre(lien());
    expect(html).toContain(`<a class="gbtn gprim" id=contactBtn href="mailto:conseiller@exemple.fr?subject=Plan%20du%20lot%20A14">Contacter mon conseiller</a>`);
  });
  it("⚠️ re-partage : ni le bouton, ni l'adresse de celui qui a transféré, nulle part dans la page", () => {
    const html = rendre(lien({ parent_slug: "parent1", created_by: "transfert@exemple.fr" }));
    expect(html).not.toContain("id=contactBtn");
    expect(html).not.toContain("transfert@exemple.fr");
  });
  it("dans un cadre : pas de bouton (l'hôte a le sien)", () => {
    const html = rendre(lien({ embed: true }));
    expect(html).not.toContain("id=contactBtn");
    expect(html).not.toContain(EXPEDITEUR);
  });
  it("sans gabarit : rien ne change", () => {
    const html = rendre(lien({ lecture: null }));
    expect(html).not.toContain("id=contactBtn");
    expect(html).not.toContain(`mailto:${EXPEDITEUR}`);
  });
  it("le script de la page compile, et connaît l'élément de l'action (pour `chrome` et le menu)", () => {
    const html = rendre(lien());
    const blocs = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]).filter((c) => c.trim());
    for (const c of blocs) expect(() => new vm.Script(c)).not.toThrow();
    expect(html).toContain("contact:'contactBtn'");
  });
});

describe("la capacité", () => {
  it("`?contract=1` annonce `reading-contact`", async () => {
    player.init(contexteMinimal());
    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, res);
    expect(JSON.parse(res.body).capabilities).toContain("reading-contact");
  });
});
