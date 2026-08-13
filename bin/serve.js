#!/usr/bin/env node
// SERVEUR AUTONOME — le player sans plateforme.
//
// Le cœur est un gestionnaire `(req, res)` sans framework : c'est ce qui lui permet de tourner
// sur Vercel, dans Next.js, derrière Express… ou ici, sur le serveur HTTP de Node, sans rien
// d'autre. Ce fichier est la preuve la moins coûteuse de cette portabilité — et le point d'entrée
// de l'image Docker.
//
//   node bin/serve.js                    # PLAYER_LOCAL_ROOT=./documents suffit à afficher
//   PORT=8080 node bin/serve.js
//
// Il ne fait que trois choses : traduire des chemins jolis en paramètres, servir un point de
// santé, et déléguer. Toute la logique est dans le player.

const http = require("node:http");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const player = require("../server/handler");
const { createStandaloneContext } = require("../context/standalone");

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || "0.0.0.0";

player.init(createStandaloneContext(process.env));


/**
 * Chemins publics → paramètres du player.
 *
 * ⚠️ `/doc/:slug` et `/present/:slug` sont des URL qui vivent dans des courriels envoyés à des
 * tiers. Elles ne changent pas, jamais : un lien tracé cassé, c'est une relation commerciale qui
 * tombe sur une page d'erreur.
 */
function versParametres(url) {
  const q = Object.fromEntries(url.searchParams);
  // Confort du mode dossier : `/preview/rapport.pdf` ouvre le document de ce nom dans la racine
  // locale. Purement cosmétique — la garde reste seule juge, et un nom qui remonte d'un cran
  // (`..`) ne la franchira pas. C'est ce qui rend l'essai possible sans construire une URL `file:`.
  const local = /^\/preview\/(.+)$/.exec(url.pathname);
  if (local && process.env.PLAYER_LOCAL_ROOT) {
    const nom = decodeURIComponent(local[1]);
    const chemin = path.resolve(process.env.PLAYER_LOCAL_ROOT, nom);
    return { ...q, preview: "1", url: pathToFileURL(chemin).href, name: path.basename(nom), title: q.title || path.basename(nom) };
  }
  const doc = /^\/doc\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
  if (doc) return { ...q, slug: doc[1] };
  const present = /^\/present\/([A-Za-z0-9_-]{1,64})$/.exec(url.pathname);
  if (present) return { ...q, present: present[1] };
  return q;
}

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Point de santé : un orchestrateur doit pouvoir savoir si le processus répond sans ouvrir un
  // document ni toucher la base.
  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true }));
    return;
  }

  const q = versParametres(url);
  const routeConnue =
    url.pathname === "/api/doc" || url.pathname === "/doc" || url.pathname === "/present" ||
    q.slug || q.present || q.preview || q.contract;
  if (!routeConnue) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  // Le player lit `req.query` (convention des plateformes serverless) et `req.body` déjà analysé.
  req.query = q;
  if (req.method === "POST") {
    req.body = await lireCorpsJson(req);
  }

  try {
    await player.handler(req, res);
  } catch (error) {
    console.error("[player] erreur non rattrapée", error);
    if (!res.headersSent) res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Erreur");
  }
});

/** Corps JSON, borné. Un corps sans fin est une façon peu coûteuse de faire tomber un serveur. */
function lireCorpsJson(req, maxOctets = 1_000_000) {
  return new Promise((resolve) => {
    let taille = 0;
    const morceaux = [];
    req.on("data", (c) => {
      taille += c.length;
      if (taille > maxOctets) { req.destroy(); resolve({}); return; }
      morceaux.push(c);
    });
    req.on("end", () => {
      try { resolve(JSON.parse(Buffer.concat(morceaux).toString("utf8") || "{}")); }
      catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

// N'écoute QUE lorsqu'on lance ce fichier. Sans cette garde, un test qui l'importe ouvrirait un
// port — et deux tests en parallèle s'attraperaient sur le même.
if (require.main === module) serveur.listen(PORT, HOST, () => {
  const racine = process.env.PLAYER_LOCAL_ROOT;
  console.log(`Discovery Media Player — http://localhost:${PORT}`);
  console.log(racine ? `  documents : ${racine}` : "  documents : aucun dossier local (PLAYER_LOCAL_ROOT)");
  console.log(`  état      : http://localhost:${PORT}/api/doc?contract=1`);
});

module.exports = { serveur, versParametres };
