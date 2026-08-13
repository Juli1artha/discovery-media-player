// Le player dans une application Node existante — et les deux routes par lesquelles il vous
// rappelle. Exécutable tel quel : `node server.js`.

const path = require("node:path");
const fs = require("node:fs");
const express = require("express");
const player = require("discovery-media-player");
const { createStandaloneContext } = require("discovery-media-player/context/standalone");

const app = express();
const DOCUMENTS = path.join(__dirname, "documents");
const SECRET = process.env.PLAYER_HOST_FETCH_SECRET || "";

player.init(createStandaloneContext(process.env));

// ── 1. Vous montez le player ───────────────────────────────────────────────────────────────────
// C'est un gestionnaire `(req, res)` : rien à adapter. Express fournit déjà `req.query` et, avec
// `express.json()`, `req.body` — les deux seules choses qu'il attend d'une requête.
app.use("/api/doc", express.json({ limit: "1mb" }), (req, res) => player.handler(req, res));

// ⚠️ Ces deux URL vivent dans des courriels envoyés à des tiers. Une fois l'instance en service
// elles ne changent plus : un lien tracé cassé, c'est une relation commerciale qui tombe sur une
// page d'erreur.
app.get("/doc/:slug", (req, res) => { req.query.slug = req.params.slug; player.handler(req, res); });
app.get("/present/:slug", (req, res) => { req.query.present = req.params.slug; player.handler(req, res); });

// ── 2. Le player vous rappelle ─────────────────────────────────────────────────────────────────

/** Comparaison à temps constant : un `===` sur un secret se sonde caractère par caractère. */
function secretValide(req) {
  const recu = String(req.get("x-player-fetch-secret") || "");
  if (!SECRET || recu.length !== SECRET.length) return false;
  return require("node:crypto").timingSafeEqual(Buffer.from(recu), Buffer.from(SECRET));
}

/** Qui a le droit de diffuser. Votre modèle de droits, pas celui du player. */
app.post("/player/authz", express.json(), (req, res) => {
  if (!secretValide(req)) return res.status(403).json({ allowed: false });
  const { role, action } = req.body || {};
  const administration = ["revoke", "overview", "setauth"];
  const autorise = role === "admin" || (role === "sales" && !administration.includes(String(action)));
  res.json({ allowed: autorise });
});

/** La marque d'un client, résolue à l'affichage. `name` sert quand le logo ne charge pas. */
app.post("/player/brand", express.json(), (req, res) => {
  if (!secretValide(req)) return res.status(403).json({});
  const clients = { "acme": { logo: "https://exemple.fr/acme.svg", name: "ACME", dark: false } };
  res.json(clients[String((req.body || {}).key)] || {});
});

// ── 3. Vous servez le fichier ──────────────────────────────────────────────────────────────────
/**
 * La route que le player est autorisé à appeler (`PLAYER_HOST_FETCH_BASE`). Elle existe pour que
 * le player n'ait JAMAIS à porter vos identifiants : c'est vous qui allez chercher le document.
 *
 * Trois exigences, dans l'ordre de ce qu'elles coûtent quand on les rate :
 *   1. ne jamais relayer le `Content-Length` reçu de la source (PDF tronqué, sans erreur) ;
 *   2. relayer les `Range` (sinon un document lourd reste blanc plusieurs secondes) ;
 *   3. accepter un appel serveur à serveur (le lecteur n'a pas de session chez vous).
 */
app.get("/player/files/:nom", async (req, res) => {
  if (!secretValide(req)) return res.status(403).end();

  // Contenance : un nom de fichier n'est pas un chemin.
  const cible = path.resolve(DOCUMENTS, path.basename(req.params.nom));
  if (!cible.startsWith(DOCUMENTS + path.sep)) return res.status(404).end();

  let stat;
  try { stat = await fs.promises.stat(cible); } catch { return res.status(404).end(); }

  // ⚠️ Ici, dans une vraie application, vous appelleriez votre source (DMS, S3, API interne) avec
  // VOS identifiants. Si vous le faites avec `fetch()` : demandez `accept-encoding: identity`,
  // n'annoncez que la taille des octets que vous envoyez, et refusez un 206 compressé — les
  // bornes d'un fragment portent sur les octets compressés, un morceau de gzip ne se décompresse
  // pas seul. C'est le piège qui produit un document faux sans que rien ne le signale.
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(req.get("range") || ""));
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Accept-Ranges", "bytes");

  if (m && (m[1] || m[2])) {
    const debut = m[1] ? Number(m[1]) : Math.max(0, stat.size - Number(m[2]));
    const fin = m[1] && m[2] ? Math.min(Number(m[2]), stat.size - 1) : stat.size - 1;
    if (!(debut >= 0 && fin >= debut && debut < stat.size)) return res.status(416).end();
    res.status(206);
    res.setHeader("Content-Range", `bytes ${debut}-${fin}/${stat.size}`);
    res.setHeader("Content-Length", String(fin - debut + 1)); // ce qu'on envoie
    return fs.createReadStream(cible, { start: debut, end: fin }).pipe(res);
  }

  res.setHeader("Content-Length", String(stat.size));
  fs.createReadStream(cible).pipe(res);
});

// Confort de démonstration : ouvrir un document local par son nom.
app.get("/documents/:nom", (req, res) => {
  req.query = {
    preview: "1",
    url: require("node:url").pathToFileURL(path.join(DOCUMENTS, path.basename(req.params.nom))).href,
    name: req.params.nom,
  };
  player.handler(req, res);
});

const PORT = Number(process.env.PORT || 4000);
app.listen(PORT, () => {
  console.log(`http://localhost:${PORT}/documents/<votre-fichier>.pdf`);
  if (!SECRET) console.warn("⚠️  PLAYER_HOST_FETCH_SECRET absent : les routes de rappel refusent tout.");
});
