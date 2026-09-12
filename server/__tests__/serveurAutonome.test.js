// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ LE SERVEUR AUTONOME CONFONDAIT TROIS ISSUES DANS UN CORPS VIDE, ET GARDAIT LES DÉLAIS DE NODE.
// Un corps trop gros, un JSON illisible et une connexion partie rendaient tous `{}` ; les délais
// (300 s par requête, 60 s d'en-têtes) sont ceux d'un serveur derrière un proxy. Relevé et mesuré par
// un audit externe le 13/09. Ces bancs fixent les trois issues, les codes 413/400, et les bornes.

const { EventEmitter } = require("node:events");
const os = require("node:os");
const fs = require("node:fs");
const path = require("node:path");

let serve;
beforeAll(() => {
  process.env.PLAYER_LOCAL_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "serve-"));
  process.env.SUPABASE_URL = process.env.SUPABASE_URL || "http://127.0.0.1:9";
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "cle-d-essai";
  serve = require("../../bin/serve.js");
});

/** Une requête postiche : on lui pousse des morceaux, puis une fin — ou une coupure. */
function requete() {
  const r = new EventEmitter();
  r.pause = () => { r.enPause = true; };
  r.destroy = () => { r.detruite = true; };
  return r;
}

describe("⚠️ lireCorpsJson distingue ses trois issues", () => {
  it("un corps valide rend `ok` et l'objet ; un corps vide rend `ok` et {}", async () => {
    const r = requete(); const p = serve.lireCorpsJson(r);
    r.emit("data", Buffer.from('{"action":"x"}')); r.emit("end");
    expect(await p).toEqual({ etat: "ok", corps: { action: "x" } });
    const v = requete(); const pv = serve.lireCorpsJson(v); v.emit("end");
    expect(await pv).toEqual({ etat: "ok", corps: {} });
  });

  it("⚠️ trop gros : `too-large` au premier octet au-delà, lecture mise en pause — jamais un `{}` silencieux", async () => {
    const r = requete(); const p = serve.lireCorpsJson(r, 10);
    r.emit("data", Buffer.from("123456"));
    r.emit("data", Buffer.from("7890AB"));           // 12 > 10
    expect(await p).toEqual({ etat: "too-large", corps: null });
    expect(r.enPause, "on ne draine pas la suite").toBe(true);
    r.emit("data", Buffer.from("encore")); r.emit("end");   // ce qui arrive après ne change plus rien
  });

  it("JSON illisible : `invalid-json`", async () => {
    const r = requete(); const p = serve.lireCorpsJson(r);
    r.emit("data", Buffer.from("{pas du json")); r.emit("end");
    expect(await p).toEqual({ etat: "invalid-json", corps: null });
  });

  it("connexion partie : `aborted`, par `error` comme par `aborted`", async () => {
    const a = requete(); const pa = serve.lireCorpsJson(a); a.emit("data", Buffer.from("{")); a.emit("error", new Error("reset"));
    expect(await pa).toEqual({ etat: "aborted", corps: null });
    const b = requete(); const pb = serve.lireCorpsJson(b); b.emit("aborted");
    expect(await pb).toEqual({ etat: "aborted", corps: null });
  });
});

describe("⚠️ le serveur répond 413 et 400, et ses délais sont ceux d'un serveur exposé", () => {
  /** Une réponse postiche qui sait dire `finish`. */
  function reponse() {
    const res = new EventEmitter();
    Object.assign(res, { statusCode: 0, headers: {}, body: "", headersSent: false,
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(b) { this.body = String(b == null ? "" : b); this.headersSent = true; this.emit("finish"); } });
    return res;
  }
  const requetePost = (donnees) => {
    const r = requete();
    Object.assign(r, { method: "POST", url: "/api/doc", headers: { host: "localhost" }, socket: { remoteAddress: "127.0.0.1" } });
    setImmediate(() => { for (const d of donnees) r.emit("data", Buffer.from(d)); r.emit("end"); });
    return r;
  };

  it("un corps de plus d'un mégaoctet rend 413 avec `Connection: close`, puis la connexion est fermée", async () => {
    const r = requetePost(["x".repeat(600_000), "x".repeat(600_000)]);
    const res = reponse();
    await serve.servir(r, res);
    expect(res.statusCode).toBe(413);
    expect(res.headers["connection"]).toBe("close");
    expect(r.detruite, "après la réponse, pas avant : le client la voit").toBe(true);
  });

  it("un JSON illisible rend 400 — pas un « bad-event » sur un corps vide", async () => {
    const r = requetePost(["{pas du json"]);
    const res = reponse();
    await serve.servir(r, res);
    expect(res.statusCode).toBe(400);
    expect(res.body).toMatch(/illisible/);
  });

  it("⚠️ requestTimeout 30 s, headersTimeout 15 s, keep-alive 5 s — pas les 300/60 de Node", () => {
    expect(serve.serveur.requestTimeout).toBe(30_000);
    expect(serve.serveur.headersTimeout).toBe(15_000);
    expect(serve.serveur.keepAliveTimeout).toBe(5_000);
    expect(serve.serveur.headersTimeout, "Node exige headersTimeout < requestTimeout").toBeLessThan(serve.serveur.requestTimeout);
  });
});
