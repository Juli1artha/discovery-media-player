// PDF.JS EST EMBARQUÉ ET SERVI DEPUIS NOTRE ORIGINE.
//
// Trois ans de CDN ont coûté : un tiers dans la CSP, un worker impossible à couvrir par SRI (il
// n'entre pas par une balise), un ballet d'empreintes pour le contourner — et un épinglage qui
// dépendait de ce que cdnjs voulait bien continuer de publier. Un actif de même origine EST nos
// octets : tout ce dispositif disparaît. Cinquième audit (pdf.js local, ≥ 6.2.108).

const fs = require("node:fs");
const player = require("../handler.js");

function contexte() {
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
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
}

async function servir(asset) {
  player.init(contexte());
  const res = { statusCode: 0, entetes: {}, corps: null, setHeader(k, v) { this.entetes[k] = v; }, end(c) { this.corps = c; } };
  await player.handler({ method: "GET", headers: {}, socket: {}, query: { asset } }, res);
  return res;
}

describe("les actifs pdf.js sortent de notre origine, octet pour octet", () => {
  it.each([["pdf", "pdfjs-dist/build/pdf.min.mjs"], ["pdfworker", "pdfjs-dist/build/pdf.worker.min.mjs"]])(
    "?asset=%s sert exactement le fichier du paquet épinglé", async (asset, fichier) => {
      const res = await servir(asset);
      expect(res.statusCode).toBe(200);
      // ⚠️ OCTET POUR OCTET contre le paquet installé — pas « une réponse 200 » : un actif tronqué
      // ou substitué serait un 200 aussi.
      const attendu = fs.readFileSync(require.resolve(fichier));
      expect(Buffer.compare(Buffer.from(res.corps), attendu), "les octets servis ne sont pas ceux du paquet").toBe(0);
      expect(res.entetes["Content-Type"]).toContain("text/javascript");
      expect(res.entetes["X-Content-Type-Options"], "sans nosniff, un navigateur peut requalifier").toBe("nosniff");
      expect(res.entetes["Cache-Control"]).toContain("immutable");
    });

  it("un actif inconnu : 404, jamais un repli", async () => {
    const res = await servir("autre-chose");
    expect(res.statusCode, "servir autre chose que les deux actifs nommés ouvrirait la lecture du disque").not.toBe(200);
  });

  it("la version épinglée est EXACTE dans package.json — un ^ referait du CDN flottant en local", () => {
    const version = require("pdfjs-dist/package.json").version;
    const declaree = require("../../package.json").dependencies["pdfjs-dist"];
    expect(declaree, "épingler une version exacte, pas une plage").toBe(version);
    expect(version >= "6.2.108", "en dessous de 6.2.108, la vulnérabilité de juillet 2026 est ouverte (avis Mozilla)").toBe(true);
  });
});

// ⚠️ LE GABARIT NE DOIT PLUS JAMAIS POINTER UN CDN POUR PDF.JS — garde sur la règle, comme pour
// jsonPourScript : une URL cdnjs réintroduite demain serait nommée ici avant d'être servie.
describe("pdf.js ne sort plus de notre origine", () => {
  const src = require("node:fs").readFileSync(require.resolve("../handler.js"), "utf8")
    .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");

  it("zéro cdnjs hors commentaires, et les CSP portent 'self'", () => {
    expect(src.includes("cdnjs.cloudflare.com"), "un CDN est revenu dans le code exécutable").toBe(false);
    expect(src).toContain('${scriptSrc ? scriptSrc + " \'self\'" : "\'self\'"}');
  });

  it("les deux pages donnent au navigateur l'URL de NOS actifs", () => {
    expect(src).toContain('PDFJS = "/api/doc?asset=pdf&v=" + PDFJS_VERSION');
    expect(src).toContain('PDFJS_WORKER = "/api/doc?asset=pdfworker&v=" + PDFJS_VERSION');
    // les deux cfg les transportent
    expect((src.match(/pdfjsWorker: PDFJS_WORKER/g) || []).length).toBe(2);
    // et les deux boots importent depuis CFG — plus aucune balise, plus aucun ballet d'empreintes
    expect((src.match(/import\(CFG\.pdfjs\)/g) || []).length).toBe(2);
    expect(src.includes("workerBlobUrl"), "le ballet d'empreintes est censé avoir disparu avec le CDN").toBe(false);
  });
});
