#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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
const fs = require("node:fs/promises");
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

// ⚠️ DÉRIVÉE, PAS RECOPIÉE. Cette liste disait encore `.svg` après son retrait de la table des
// types en 0.1.7 : la page de premier contact proposait un format que la visionneuse ne sait plus
// ouvrir. Un clic, un téléchargement, et l'impression que le projet ne marche pas — sur l'écran
// qui ne se rejoue pas.
const AFFICHABLES = new Set(require("../context/storage").EXTENSIONS_AFFICHABLES);

/**
 * Page d'accueil du mode dossier : ce qu'il y a à lire, et où le prendre.
 *
 * ⚠️ Écrite après avoir regardé quelqu'un essayer le projet pour la première fois. Il a suivi le
 * README, ouvert `/preview/<nom>` avec le nom d'exemple, et reçu « Impossible d'afficher ce
 * document » — le même message qu'un dossier vide, qu'un fichier absent et qu'un format non géré.
 * Trois causes, une phrase, aucune piste. Le premier contact avec un projet ne se rejoue pas.
 *
 * N'existe qu'en mode dossier : c'est la racine que l'exploitant a lui-même désignée, il n'y a
 * rien à divulguer qu'il ne connaisse déjà.
 */
async function pageAccueil(racine) {
  let fichiers = [];
  try {
    fichiers = (await fs.readdir(racine, { withFileTypes: true }))
      .filter((e) => e.isFile() && !e.name.startsWith(".") && AFFICHABLES.has(path.extname(e.name).toLowerCase()))
      .map((e) => e.name).sort();
  } catch { /* racine illisible : traitée comme vide, le message le dira */ }

  const echapper = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const liste = fichiers.length
    ? `<ul>${fichiers.map((n) => `<li><a href="/preview/${encodeURIComponent(n)}">${echapper(n)}</a></li>`).join("")}</ul>`
    : `<p class=vide>Aucun document affichable dans <code>${echapper(racine)}</code>.<br>
       Déposez-y un PDF ou une image, puis rechargez cette page.</p>`;

  return `<!doctype html><html lang=fr><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1"><title>Discovery Media Player</title>
<style>
  body{font:15px/1.6 -apple-system,system-ui,Segoe UI,Roboto,sans-serif;color:#1c1a17;background:#f5f3ef;
    margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
  .c{width:100%;max-width:560px;background:#fff;border-radius:16px;padding:32px;box-shadow:0 18px 50px rgba(30,22,12,.10)}
  h1{font-size:19px;margin:0 0 4px;letter-spacing:-.01em}
  .s{color:#7c7266;font-size:13.5px;margin:0 0 22px}
  ul{list-style:none;margin:0;padding:0}
  li+li{border-top:1px solid #eee9e0}
  a{display:block;padding:11px 12px;color:#1c1a17;text-decoration:none;border-radius:9px}
  a:hover{background:#f5f2ec}
  .vide{color:#7c7266;font-size:14px;background:#faf8f4;border:1px dashed #ddd4c6;border-radius:12px;padding:18px;margin:0}
  code{font:12.5px ui-monospace,SFMono-Regular,Menlo,monospace;background:#f0ece4;padding:1px 5px;border-radius:5px}
  .f{margin:22px 0 0;padding-top:16px;border-top:1px solid #eee9e0;color:#9a9184;font-size:12.5px}
  .f a{display:inline;padding:0;color:#9a9184;text-decoration:underline}
</style></head><body><div class=c>
  <h1>Discovery Media Player</h1>
  <p class=s>Mode dossier — les documents servis viennent de <code>${echapper(racine)}</code>.</p>
  ${liste}
  <p class=f>Liens tracés, statistiques et présentation en direct demandent une base :
    voir <a href="https://github.com/Juli1artha/discovery-media-player#going-further">la documentation</a>.</p>
</div></body></html>`;
}

const serveur = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  // Point de santé : un orchestrateur doit pouvoir savoir si le processus répond sans ouvrir un
  // document ni toucher la base.
  if (url.pathname === "/healthz") {
    player.repondreJson(res, 200, { ok: true });
    return;
  }

  // Mode dossier : la racine du serveur montre ce qu'il y a à lire.
  if ((url.pathname === "/" || url.pathname === "/preview" || url.pathname === "/preview/") && process.env.PLAYER_LOCAL_ROOT) {
    res.writeHead(200, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      // ⚠️ Les MÊMES protections que la visionneuse, écrites pour la page qui n'y passait pas.
      // C'était la seule page HTML servie sans CSP ni `nosniff`, encadrable par n'importe qui —
      // relevé par le premier scan ZAP baseline (24/08). Elle n'a ni script, ni image, ni
      // formulaire : tout est refusé, sauf son unique bloc <style>.
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      // La définition vit dans le player (une seule copie du fait) — voir son commentaire.
      "Permissions-Policy": player.POLITIQUE_PERMISSIONS,
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    });
    res.end(await pageAccueil(path.resolve(process.env.PLAYER_LOCAL_ROOT)));
    return;
  }

  const q = versParametres(url);
  const routeConnue =
    url.pathname === "/api/doc" || url.pathname === "/doc" || url.pathname === "/present" ||
    q.slug || q.present || q.preview || q.contract;
  if (!routeConnue) {
    // ⚠️ LA MÊME FONCTION QUE LE PLAYER, PAS LA MÊME RECETTE ÉCRITE DEUX FOIS. Ces deux réponses
    // posaient leur `Content-Type` mais PAS `nosniff` — la moitié de la règle, appliquée à la
    // main, dans le seul fichier où le player ne pouvait pas la poser lui-même. Même raison que
    // POLITIQUE_PERMISSIONS quelques lignes plus haut : deux exemplaires d'un fait divergent.
    player.refuserEnTexte(res, 404, "Not found");
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
    // `refuserEnTexte` porte elle-même la garde `headersSent` : une erreur survenue APRÈS le début
    // de l'écriture ne peut plus rien poser, et tenter de le faire jetterait dans le rattrapage.
    player.refuserEnTexte(res, 500, "Erreur");
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

module.exports = { serveur, versParametres, pageAccueil };
