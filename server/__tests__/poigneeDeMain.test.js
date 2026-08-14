// LE SILENCE N'EST PAS UNE INFORMATION.
//
// `embed-ready` dit à l'hôte « je suis là ». Sans lui, un hôte prudent ne peut pas distinguer un
// player ABSENT d'un player VIVANT — et son repli au bout de quelques secondes remplace le second
// par la visionneuse du navigateur, sous les yeux du lecteur.
//
// ⚠️ Il n'était jamais émis EN APERÇU, parce qu'une seule variable répondait à deux questions :
// « faut-il afficher la croix d'intégration ? » (non en aperçu : il a déjà la sienne) et « cette
// page est-elle servie dans un cadre ? ». La seconde commande la poignée de main.
//
// Et l'aperçu est précisément le mode qu'un hôte utilise pour SES documents — pas de lien tracé,
// pas de destinataire. La page était encadrable, elle parlait déjà (`share`, `close`) : il ne lui
// manquait que de dire qu'elle était là. Signalé par le second hôte, qui avait retiré son guetteur
// de démarrage en attendant que le silence redevienne une information.

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
require.cache[ID] = { id: ID, filename: ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => null, listMessages: async () => [] } };

const SHARE = {
  slug: "Ab3-_xYz9012", doc_id: "d1", doc_title: "Démo", file_name: "demo.pdf",
  file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/demo.pdf",
  recipient_email: "a@b.fr", created_by: "c@d.fr", revoked: false,
};

const vraisShares = require("../shares.js");
require.cache[require.resolve("../shares.js")] = {
  id: require.resolve("../shares.js"), filename: require.resolve("../shares.js"), loaded: true,
  exports: { ...vraisShares, getShareBySlug: async () => ({ ...SHARE }), logView: async () => {}, logShareEvent: async () => {} },
};

const player = require("../handler.js");

const URL_OK = "https://exemple.supabase.co/storage/v1/object/public/resources/demo.pdf";

function contexte() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: (u) => String(u || "").startsWith("https://exemple.supabase.co/"), async fetchFile() { return null; }, async put() {}, async signUpload() { return null; } },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() { return null; } },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "", trackingNoticeAnonymous: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: ["https://app.exemple.fr"] },
  };
}

async function page(query) {
  process.env.DOC_FRAME_ANCESTORS = "https://app.exemple.fr";
  player.init(contexte());
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  await player.handler({ method: "GET", headers: {}, socket: {}, query }, res);
  return { html: res.body, csp: res.headers["content-security-policy"] || "" };
}

const APERCU = { preview: "1", url: URL_OK, name: "demo.pdf", embed: "1" };

describe("une page encadrée dit qu'elle est là", () => {
  // ⚠️ ON N'AFFIRME PAS SUR LA PRÉSENCE DE LA CHAÎNE `embed-ready` : elle est TOUJOURS dans la
  // page, à l'intérieur du bloc conditionnel. Seule la CONDITION change. Une première version de
  // ces tests le faisait, et la mutation qui remet la panne d'origine passait au vert — un test
  // qui ne peut pas échouer ne protège rien. On affirme donc sur la valeur servie au navigateur.
  const drapeau = (html) => JSON.parse((html.match(/"embedded":(true|false)/) || [])[1] || "null");

  it("⚠️ l'aperçu intégré demande la poignée de main", async () => {
    expect(drapeau(await page(APERCU).then((r) => r.html))).toBe(true);
  });

  it("le lien tracé intégré aussi", async () => {
    expect(drapeau((await page({ slug: SHARE.slug, embed: "1" })).html)).toBe(true);
  });

  // Hors cadre, la poignée de main n'a pas de destinataire : rien ne doit partir.
  it("hors intégration, aucune poignée de main", async () => {
    expect(drapeau((await page({ preview: "1", url: URL_OK, name: "demo.pdf" })).html)).toBe(false);
    expect(drapeau((await page({ slug: SHARE.slug })).html)).toBe(false);
  });
});

// ⚠️ LA RAISON POUR LAQUELLE LA CONJONCTION EXISTAIT — ET QU'IL NE FALLAIT PAS CASSER.
//
// L'aperçu porte DÉJÀ sa croix (`closeBtn`, à droite de la barre). Lever simplement le `!preview`
// aurait ajouté `embedCloseBtn` par-dessus : deux croix, dont une qui ferme et l'autre aussi.
// L'habillage et la poignée de main répondent à deux questions différentes.
describe("l'habillage ne bouge pas", () => {
  it("l'aperçu intégré ne gagne pas une seconde croix", async () => {
    const { html } = await page(APERCU);
    expect(html).toContain("id=closeBtn");
    expect(html, "embedCloseBtn est la croix du mode intégré : l'aperçu a déjà la sienne").not.toContain("id=embedCloseBtn");
  });

  it("un lien tracé intégré garde la sienne", async () => {
    const { html } = await page({ slug: SHARE.slug, embed: "1" });
    expect(html).toContain("id=embedCloseBtn");
  });
});

// Le serveur savait déjà que la page était encadrée — il en tirait les `frame-ancestors`. C'est
// le navigateur qui l'ignorait. Les deux doivent maintenant s'accorder.
describe("le serveur et le navigateur s'accordent sur « je suis encadré »", () => {
  it("l'aperçu intégré est encadrable ET se signale", async () => {
    const { html, csp } = await page(APERCU);
    expect(csp, "le serveur autorise le cadre…").toContain("https://app.exemple.fr");
    expect(JSON.parse((html.match(/"embedded":(true|false)/) || [])[1]), "…et le navigateur le sait").toBe(true);
  });
});
