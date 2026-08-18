// UNE CHAÎNE JSON PEUT FERMER LA BALISE QUI LA CONTIENT.
//
// Le parseur HTML lit la page AVANT JavaScript : un `</script>` dans une chaîne JSON ferme
// l'élément pour lui, et la suite du document devient du balisage. La CSP à nonce bloque
// l'exécution du script injecté — pas la casse de la page. La protection vivait éparpillée
// (un `.replace` à l'interpolation pour CFG, six interpolations NUES à côté) : appliquée à la
// sérialisation, elle ne peut plus être oubliée champ par champ. Lot B du quatrième audit.

const { __jsonPourScript: jsonPourScript } = require("../handler.js");

const HOSTILES = [
  "</script><script>globalThis.__xss = true</script>",
  "<!--",
  "\u2028",
  "\u2029",
  "guillemets \" apostrophe ' antislash \\ retour\n",
];

describe("la sérialisation vers un <script> neutralise ce que le parseur HTML lit", () => {
  it.each(HOSTILES)("aller-retour exact, sans un seul « < » littéral : %j", (valeur) => {
    const out = jsonPourScript(valeur);
    expect(out.includes("<"), "un < littéral suffit au parseur HTML pour fermer la balise").toBe(false);
    expect(out.includes("\u2028")).toBe(false);
    expect(out.includes("\u2029")).toBe(false);
    expect(JSON.parse(out), "neutraliser ne doit RIEN changer à la valeur restituée").toBe(valeur);
  });

  it("un objet complet fait l'aller-retour — c'est la forme que CFG et LIVECFG empruntent", () => {
    const objet = { titre: "</script>fin", cle: 'a"b\\c', page: 3, actif: true, rien: null, u: "\u2028" };
    const out = jsonPourScript(objet);
    expect(out.includes("<")).toBe(false);
    expect(JSON.parse(out)).toEqual(objet);
  });

  // ⚠️ `undefined` LÈVE : c'est une erreur de programmation, pas une valeur — la convertir en
  // douce (`null`, ou le mot « undefined » dans la page) la masquerait.
  it("undefined lève au lieu de devenir du texte dans la page", () => {
    expect(() => jsonPourScript(undefined)).toThrow(TypeError);
  });
});

// ⚠️ LA GARDE SUR LA RÈGLE, PAS SUR UNE LISTE. Une nouvelle variable interpolée demain devra
// passer par la fonction — sinon ce test la nomme. C'est ce qui empêche le retour du défaut
// champ par champ, la forme sous laquelle il était né.
describe("aucune interpolation nue ne subsiste ni ne revient", () => {
  it("zéro ${JSON.stringify dans les gabarits du handler", () => {
    const src = require("node:fs").readFileSync(require.resolve("../handler.js"), "utf8");
    const nues = src.match(/\$\{JSON\.stringify/g) || [];
    expect(nues, "une donnée serveur entre dans un <script> sans passer par jsonPourScript").toEqual([]);
  });

  it("et plus aucun rattrapage à l'interpolation — la sécurité vit à la sérialisation", () => {
    // ⚠️ COMMENTAIRES RETIRÉS AVANT DE CHERCHER — la première version de cet essai accusait le
    // commentaire de `jsonPourScript` qui DÉCRIT l'ancien défaut. Une sonde qui lit du commentaire
    // invente des coupables, et la seule issue serait de dégrader l'explication pour la satisfaire.
    // Même correction que la garde de portabilité de la forge, pour la même raison.
    const src = require("node:fs").readFileSync(require.resolve("../handler.js"), "utf8")
      .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    expect(src.includes('cfg.replace(/</g'), "un .replace à l'interpolation est un correctif qu'on oublie d'appliquer au champ suivant").toBe(false);
  });
});

// ⚠️ LA PAGE RENDUE, PAS SEULEMENT LA FONCTION — le cinquième argument des réactions a appris que
// prouver la fonction ne prouve pas le chemin. On rend la page d'audience avec un titre hostile.
describe("une page rendue avec un titre hostile reste une page", () => {
  it("le HTML ne contient jamais la chaîne brute, et la valeur revient intacte", async () => {
    const HOSTILE = "</script><script>globalThis.__xss = true</script>";
    const ID = require.resolve("../presentations.js");
    const vraies = require("../presentations.js");
    require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: {
      ...vraies,
      getPresentation: async () => ({ slug: "Ab3-_xYz9012", active: true, control_hash: "h", current_page: 1,
        file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/d.pdf",
        file_name: "d.pdf", doc_title: HOSTILE, chat_locked: false }),
      listMessages: async () => [],
    } };
    delete require.cache[require.resolve("../handler.js")];
    const player = require("../handler.js");
    player.init({
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
    });
    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { present: "Ab3-_xYz9012" } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body.includes(HOSTILE), "la chaîne brute ferme la balise pour le parseur HTML").toBe(false);
    expect(res.body, "la version neutralisée doit y être — sinon le titre a juste disparu").toContain("\\u003c/script");
    expect(res.body.includes("__xss = true</script>"), "le fragment exécutable ne doit exister sous aucune forme ouverte").toBe(false);

    // remettre les vrais modules
    require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: vraies };
    delete require.cache[require.resolve("../handler.js")];
  });
});
