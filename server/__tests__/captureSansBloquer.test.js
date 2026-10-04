// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ « JAMAIS BLOQUANT » NE TENAIT QUE POUR UNE EXCEPTION SYNCHRONE. Trente-cinq appels à
// `errors.capture` vivaient sous un `try/catch` ; le contrat autorise `capture` à rendre une promesse,
// et une promesse REJETÉE échappe au `catch` : `unhandledRejection`, et Node arrête le processus.
// Reproduit par un audit externe sur le tag v0.1.166 — à `init`, avec une configuration hors plage
// et un `capture` qui rejette, sortie 1 avant le premier octet servi (sixième passe, 14/09).
// Ces bancs fixent la règle dans un VRAI sous-processus, parce que c'est la sortie du processus
// qui est la propriété, et qu'aucun `expect` dans le processus de vitest ne peut la mesurer.
//
// ⚠️ Et le contexte autonome disait « transmis tel quel » en convertissant encore : « abc » arrivait
// au cœur en NaN, et le diagnostic disait `relayStallMs=NaN`. Le chemin autonome COMPLET est éprouvé
// ici, pas seulement `entierBorne`.

const { execFileSync } = require("node:child_process");
const { join } = require("node:path");
const { capturerSansBloquer } = require("../capture.js");

const RACINE = join(__dirname, "..", "..");

describe("capturerSansBloquer : un journal qui échoue ne fait échouer personne", () => {
  it("transmet l'erreur et la métadonnée au journal", () => {
    const vus = [];
    capturerSansBloquer({ capture(e, m) { vus.push([e.message, m]); } }, new Error("x"), { route: "r" });
    expect(vus).toEqual([["x", { route: "r" }]]);
  });
  it("une exception SYNCHRONE est avalée", () => {
    expect(() => capturerSansBloquer({ capture() { throw new Error("boum"); } }, new Error("x"))).not.toThrow();
  });
  it("⚠️ une promesse REJETÉE est neutralisée — c'est le cas que le try/catch ne voyait pas", async () => {
    const rejets = [];
    const ecoute = (r) => rejets.push(String(r && r.message));
    process.on("unhandledRejection", ecoute);
    try {
      capturerSansBloquer({ capture() { return Promise.reject(new Error("capture-reject")); } }, new Error("x"));
      await new Promise((r) => setTimeout(r, 20));
      expect(rejets).toEqual([]);
    } finally { process.off("unhandledRejection", ecoute); }
  });
  it("sans journal du tout, rien ne se passe", () => {
    expect(() => capturerSansBloquer(undefined, new Error("x"))).not.toThrow();
    expect(() => capturerSansBloquer({}, new Error("x"))).not.toThrow();
  });
});

const CONTEXTE = `
  const captures = [];
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } }, mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { capture(e) { captures.push(e.message); return Promise.reject(new Error("capture-reject")); } },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], relayStallMs: "abc", maxConcurrentRelays: 1 },
  };
`;

/** Lance un script dans un vrai Node : on mesure le CODE DE SORTIE, pas une assertion interne. */
function sousProcessus(script) {
  try {
    const sortie = execFileSync(process.execPath, ["-e", script], { cwd: RACINE, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30_000 });
    return { code: 0, sortie };
  } catch (e) { return { code: e.status, sortie: String(e.stdout || "") + String(e.stderr || "") }; }
}

describe("⚠️ dans un vrai processus : capture() rejette, la configuration est invalide, et le processus finit en 0", () => {
  it("à init : le diagnostic de plage est confié au journal, le journal rejette, le témoin est atteint", () => {
    const r = sousProcessus(`${CONTEXTE}
      const player = require("./server/handler.js");
      player.init(ctx);
      setTimeout(() => { console.log("TEMOIN " + captures.length + " " + captures[0]); }, 50);
    `);
    expect(r.sortie, r.sortie).toMatch(/TEMOIN 1 réglages de relais hors plage/);
    expect(r.code, "sortie zéro : le rejet du journal n'a tué personne").toBe(0);
  });

  it("au refus d'un relais (plafond 1) : le journal rejette, la réponse 503 part quand même, sortie 0", () => {
    const r = sousProcessus(`${CONTEXTE}
      const player = require("./server/handler.js");
      player.init(ctx);
      const res = () => ({ statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end() {} });
      const url = "https://exemple.supabase.co/storage/v1/object/public/docs/p.pdf";
      ctx.storage.fetchFile = () => new Promise(() => {});     // un relais qui ne finit jamais : occupe la place
      player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url, stream: "1" } }, res());
      setImmediate(async () => {
        const r2 = res();
        await player.handler({ method: "GET", headers: {}, socket: {}, query: { preview: "1", url, stream: "1" } }, r2);
        setTimeout(() => { console.log("TEMOIN " + r2.statusCode + " " + captures.length); process.exit(0); }, 50);
      });
    `);
    expect(r.sortie, r.sortie).toMatch(/TEMOIN 503 2/);
    expect(r.code).toBe(0);
  });
});

// ⚠️ LE CONTEXTE AUTONOME AVAIT LA MÊME PANNE SUR CINQ CHEMINS. `ctx.errors` et le journal capturé
// par ses capacités sont LE MÊME objet : un hôte qui pose un `capture` qui rejette tuait le processus
// à `mail.send` sans secret, avant tout réseau (audit, septième passe). Reproduction de l'audit.
describe("⚠️ dans un vrai processus, le contexte autonome : le journal rejette, mail.send sans secret, sortie 0", () => {
  it("le témoin est atteint après mail.send", () => {
    const r = sousProcessus(`
      const { createStandaloneContext } = require("./context/standalone.js");
      const c = createStandaloneContext({ PLAYER_HOST_MAIL_URL: "https://hote.test/mail", PLAYER_HOST_MAIL_SECRET: "" });
      let appels = 0;
      c.errors.capture = () => { appels += 1; return Promise.reject(new Error("capture-reject")); };
      c.mail.send({}).then((res) => setTimeout(() => console.log("TEMOIN " + appels + " " + JSON.stringify(res)), 30));
    `);
    expect(r.sortie, r.sortie).toMatch(/TEMOIN 1 /);
    expect(r.code, "sortie zéro : le rejet du journal n'a tué personne").toBe(0);
  });
});

// ⚠️ UNE SEULE FORME, TENUE PAR UNE SONDE. Ajouter un appel direct « jamais bloquant » de plus est le
// geste le plus naturel du monde ; cette sonde le refuse : hors des deux helpers, un appel au journal
// est soit attendu (`await`, sous un try qui le couvre), soit passé par le helper.
describe("⚠️ aucun appel direct non attendu au journal hors des deux helpers", () => {
  const { readdirSync, readFileSync } = require("node:fs");
  it("server/*.js et context/standalone.js", () => {
    const fichiers = [
      ...readdirSync(join(RACINE, "server")).filter((f) => f.endsWith(".js")).map((f) => join("server", f)),
      "context/standalone.js",
    ];
    const nus = [], helpers = [];
    let attendus = 0;
    for (const f of fichiers) {
      readFileSync(join(RACINE, f), "utf8").split("\n").forEach((ligne, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;
        if (!/\.capture\s*\(/.test(ligne)) return;
        if (/\.capture\(erreur, meta\)/.test(ligne)) { helpers.push(f); return; }      // le corps d'un helper
        if (/await\s+[\w.]+\.capture\s*\(/.test(ligne)) { attendus += 1; return; }
        nus.push(`${f}:${i + 1}  ${ligne.trim().slice(0, 90)}`);
      });
    }
    expect(helpers.sort(), "les deux helpers existent — sinon la sonde ne garde rien").toEqual(["context/standalone.js", "server/capture.js"]);
    expect(attendus, "contrôle positif : la sonde voit les appels attendus").toBeGreaterThanOrEqual(5);
    expect(nus, "appel(s) direct(s) non attendu(s) au journal :\n" + nus.join("\n")).toEqual([]);
  });
});

describe("⚠️ le chemin autonome COMPLET : la chaîne d'environnement arrive intacte au cœur", () => {
  it("« abc » est transmis « abc », pas NaN — et le diagnostic cite ce que l'exploitant a saisi", async () => {
    const { createStandaloneContext } = require("../../context/standalone.js");
    const ctx = createStandaloneContext({ SUPABASE_URL: "https://base.exemple.test", SUPABASE_SERVICE_ROLE_KEY: "cle", PLAYER_RELAY_STALL_MS: "abc", PLAYER_MAX_RELAYS: "1024", PLAYER_RELAY_MAX_MS: "" });
    expect(ctx.config.relayStallMs).toBe("abc");
    expect(ctx.config.maxConcurrentRelays).toBe("1024");
    expect(ctx.config.relayMaxMs, "vide : non posé").toBe("");
    const captures = [];
    const vu = Object.create(ctx); vu.errors = { async capture(e) { captures.push(e.message); } };
    require("../handler.js").init(vu);
    expect(captures).toHaveLength(1);
    expect(captures[0]).toMatch(/relayStallMs=abc \(entier de 1 à 86400000 ms, défaut 30000\)/);
    expect(captures[0], "NaN ne doit apparaître nulle part").not.toMatch(/NaN/);
    expect(captures[0], "« 1024 » est un entier de la plage : accepté, pas cité").not.toMatch(/maxConcurrentRelays/);
    expect(captures[0], "vide = non posé, pas un défaut").not.toMatch(/relayMaxMs/);
  });
});
