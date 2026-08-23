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
//
// ⚠️ ET LA GARDE NE NOMMAIT QU'UN SEUL HÔTE (alerte de scan #82, relevé du 23/08). Elle disait
// « pas cdnjs » là où la règle du dépôt est « je déclare ce que j'autorise ». Un pdf.js servi
// demain depuis `unpkg.com` ou n'importe quel autre CDN passait sans un mot : la liste noire ne
// connaît que ce qui a déjà mal tourné, et le prochain défaut n'est jamais celui-là.
//
// ⚠️ MON PROPRE BALAYAGE AVAIT LE MÊME DÉFAUT, ce qui vaut d'être écrit ici. En relevant les
// origines présentes, ma première expression régulière excluait `*` de la classe de caractères :
// SIX origines joker — `*.googleapis.com`, `*.gstatic.com`, `*.ggpht.com`, `*.googleusercontent.com`,
// `*.tile.openstreetmap.org`, `*.vercel.app` — ne correspondaient à rien et ne s'affichaient donc
// pas. Un lecteur qui ne voit pas une forme ne dit pas qu'il ne la voit pas ; il rend une liste
// courte, qui a l'air complète.
const ORIGINES_DECLAREES = {
  "cdn.jsdelivr.net": "supabase-js — épinglé en version exacte et empreinté dans TIERS",
  "unpkg.com": "leaflet (js + css) — épinglés en version exacte et empreintés dans TIERS",
  "accounts.google.com": "Google Sign-In, chargé par la page quand un client GSI est configuré",
  "api.elevenlabs.io": "synthèse vocale, appelée depuis le serveur",
  "maps.googleapis.com": "cartes Google, autorisées en CSP",
  "maps.gstatic.com": "actifs des cartes Google, autorisés en CSP",
  "*.googleapis.com": "joker CSP couvrant les sous-domaines Google appelés par les cartes",
  "*.gstatic.com": "joker CSP, même raison",
  "*.ggpht.com": "photos Street View / Places, autorisées en img-src",
  "*.googleusercontent.com": "photos de profil et de lieux, autorisées en img-src",
  "fonts.googleapis.com": "feuille de police, autorisée en CSP",
  "fonts.gstatic.com": "fichiers de police, autorisés en CSP",
  "nominatim.openstreetmap.org": "géocodage OpenStreetMap, autorisé en CSP",
  "*.tile.openstreetmap.org": "tuiles OSM (joker CSP)",
  "{s}.tile.openstreetmap.org": "tuiles OSM — `{s}` est le gabarit de sous-domaine de Leaflet, pas un hôte",
  "*.vercel.app": "encadrement par défaut : la démo hébergée peut encadrer le player",
  "interne": "base FACTICE de `new URL(req.url, \"http://interne\")` — aucun appel réseau ne part là",
};

describe("pdf.js ne sort plus de notre origine", () => {
  const src = require("./sourceDesPages.cjs").SOURCE_PAGES
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

  const originesDuSource = () => {
    const trouvees = src.match(/https?:\/\/[A-Za-z0-9.*${}_-]+/g) || [];
    return [...new Set(trouvees.map((u) => u.replace(/^https?:\/\//, "")))].sort();
  };

  it("zéro cdnjs hors commentaires, et les CSP portent 'self'", () => {
    // ⚠️ ON INTERROGE LA LISTE DES ORIGINES, PAS LE TEXTE. `src.includes("cdnjs.cloudflare.com")`
    // disait la même chose et le disait bien — mais chercher un nom d'hôte dans une chaîne est le
    // motif que CodeQL classe en « Incomplete URL substring sanitization » (#82), parce que c'est
    // celui qui, DANS UN CONTRÔLE D'ACCÈS, laisse passer `cdnjs.cloudflare.com.evil.tld`. Ici ce
    // n'était pas un contrôle d'accès mais une affirmation d'absence : l'alerte visait à côté.
    //
    // ⚠️ ET JE L'AVAIS LAISSÉE OUVERTE EN CROYANT L'AVOIR RÉGLÉE. La PR précédente ajoutait la
    // liste blanche À CÔTÉ de cette ligne sans la retirer — le corps de la PR annonçait donc plus
    // que le diff ne faisait. Une alerte qui vise à côté et qu'on laisse ouverte use la liste
    // exactement autant qu'une vraie. La question posée à `originesDuSource()` est strictement la
    // même, et elle se lit mieux : l'hôte y est ou il n'y est pas, sans sous-chaîne.
    expect(originesDuSource(), "un CDN est revenu dans le code exécutable").not.toContain("cdnjs.cloudflare.com");
    expect(src).toContain('${scriptSrc ? scriptSrc + " \'self\'" : "\'self\'"}');
  });

  it("⚠️ et TOUTE origine externe du code exécutable est déclarée, avec sa raison", () => {
    // C'est la garde qui aurait attrapé un pdf.js servi depuis un CDN que personne n'a pensé à
    // interdire. Ajouter une origine sans écrire pourquoi elle est là fait échouer ce banc — et
    // c'est le seul moment où quelqu'un se posera la question.
    const inconnues = originesDuSource().filter((h) => !(h in ORIGINES_DECLAREES));
    expect(inconnues, `origine(s) non déclarée(s) : ${inconnues.join(", ")}`).toEqual([]);
  });

  it("⚠️ et la liste ne contient rien qui ait DISPARU du code", () => {
    // La contrepartie, sans laquelle la liste devient un cimetière : on pourrait satisfaire la
    // garde précédente en y ajoutant tout, pour toujours. Une déclaration qui ne correspond plus
    // à rien est une autorisation que personne ne relit.
    const presentes = new Set(originesDuSource());
    const mortes = Object.keys(ORIGINES_DECLAREES).filter((h) => !presentes.has(h));
    expect(mortes, `déclarée(s) mais absente(s) du code : ${mortes.join(", ")}`).toEqual([]);
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
