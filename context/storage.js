// D'OÙ LE PLAYER ACCEPTE DE LIRE UN FICHIER — et comment il le sert.
//
// Le player relaie des URL fournies par l'appelant (aperçu, démarrage de présentation). Sans
// barrière, il deviendrait un proxy universel capable d'atteindre le réseau interne de son
// hébergeur. C'est le fichier le plus sensible du projet : **refus par défaut**, trois sources
// autorisées explicitement, rien d'autre.
//
// Ce module ne dépend d'aucun hôte : il est partagé par le studio historique et par le serveur
// autonome (`bin/serve.js`). Une seule implémentation de la garde — c'est la seule façon qu'un
// durcissement profite aux deux.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const path = require("node:path");

/** Chemin canonique des objets PUBLICS du Storage Supabase. */
const PUBLIC_OBJECT_PREFIX = "/storage/v1/object/public/";

/**
 * Origines de Storage autorisées : celle de la base, plus `PLAYER_STORAGE_ORIGINS`
 * (séparées par espace ou virgule).
 */
function storageOrigins(env) {
  const raw = [env.SUPABASE_URL, ...String(env.PLAYER_STORAGE_ORIGINS || "").split(/[\s,]+/)];
  const origins = [];
  for (const candidate of raw) {
    if (!candidate) continue;
    try {
      const { origin } = new URL(candidate);
      if (origin && origin !== "null" && !origins.includes(origin)) origins.push(origin);
    } catch { /* entrée illisible : ignorée, jamais fatale */ }
  }
  return origins;
}

/**
 * Route de l'hôte qui sert les fichiers — motif « l'hôte sert le fichier ».
 *
 * Tous les hôtes n'ont pas leurs documents dans un Storage joignable : ils vivent souvent derrière
 * une clé d'API tierce. Le player **ne portera jamais les identifiants d'un tiers** — autoriser
 * l'origine du tiers lui donnerait le droit d'y lire n'importe quoi avec ces identifiants. L'hôte
 * expose donc UNE route, va chercher le document lui-même, et le player n'autorise que celle-là.
 *
 * `PLAYER_HOST_FETCH_BASE` est un préfixe d'URL COMPLET (origine + début de chemin), jamais une
 * simple origine : autoriser tout un domaine applicatif rendrait le player capable d'appeler
 * n'importe quelle route de l'hôte.
 */
function hostFetchBase(env) {
  try {
    const raw = String(env.PLAYER_HOST_FETCH_BASE || "");
    if (!raw) return null;
    const url = new URL(raw);
    if (url.protocol !== "https:") return null;
    // ⚠️ LA BARRE FINALE EST OBLIGATOIRE, et on la remet plutôt que d'espérer qu'elle soit tapée.
    // La comparaison est un préfixe de CHAÎNE : `…/api/documents` saisi sans barre ouvrirait aussi
    // `/api/documents-prives/tout`. Aucune erreur nulle part — ça marche, ça couvre simplement plus
    // large que ce que quiconque a voulu. Et la faute est du côté le plus facile à commettre : une
    // variable d'environnement tapée à la main, un jour de déploiement.
    const p = url.pathname.endsWith("/") ? url.pathname : url.pathname + "/";
    return { origin: url.origin, path: p };
  } catch {
    return null;
  }
}

/** L'URL désigne-t-elle la route de fichiers de l'hôte ? */
function isHostFetchUrl(candidate, base) {
  if (!base) return false;
  try {
    const url = new URL(String(candidate || ""));
    if (url.protocol !== "https:" || url.username || url.password) return false;
    return url.origin === base.origin && url.pathname.startsWith(base.path);
  } catch {
    return false;
  }
}

// ── Fichiers locaux ────────────────────────────────────────────────────────────────────────────
// Pour servir un dossier de documents sans base ni Storage : `PLAYER_LOCAL_ROOT=/data` autorise
// les URL `file:` situées SOUS ce dossier. C'est ce qui rend le projet essayable en deux commandes,
// et c'est un vrai mode d'exploitation pour qui héberge chez lui.
//
// ⚠️ Délibérément un CHEMIN, pas une origine réseau. On aurait pu autoriser `http://localhost` :
// ç'aurait été rouvrir exactement la porte que la garde ferme (le réseau interne de l'hébergeur
// commence à `localhost`). Un dossier ne mène nulle part ailleurs qu'à lui-même.

function localRoot(env) {
  const raw = String(env.PLAYER_LOCAL_ROOT || "").trim();
  if (!raw) return null;
  try { return fs.realpathSync(path.resolve(raw)); } catch { return null; }
}

/**
 * Le chemin visé reste-t-il SOUS la racine ?
 *
 * ⚠️ On compare des chemins RÉSOLUS et on exige le séparateur : sans lui, une racine `/data`
 * accepterait `/data-prive`. C'est le même piège que la barre finale de `PLAYER_HOST_FETCH_BASE`,
 * une couche plus bas — préfixe de chaîne contre préfixe de segment.
 */
function resolveLocal(candidate, root) {
  if (!root) return null;
  try {
    const url = new URL(String(candidate || ""));
    if (url.protocol !== "file:") return null;
    // `decodeURIComponent` + `path.resolve` normalisent les `..` avant la comparaison ; le `%00`
    // est refusé net (un octet nul tronque un chemin dans certaines couches basses).
    const brut = decodeURIComponent(url.pathname);
    if (brut.includes("\0")) return null;
    // ⚠️ On compare des chemins RÉELS des deux côtés. `path.resolve` seul suffirait contre les
    // `..` (déjà normalisés), mais pas contre un lien symbolique posé DANS la racine et pointant
    // dehors — et pas non plus contre une racine qui EST un lien (sur macOS, `/tmp` mène à
    // `/private/tmp` : la garde refusait alors tout, ce qui se voit, mais l'inverse ne se verrait
    // pas). Si le fichier n'existe pas, le chemin normalisé suffit : il finira en 404.
    let cible = path.resolve(brut);
    try { cible = fs.realpathSync(cible); } catch { /* inexistant : la forme normalisée fait foi */ }
    if (cible !== root && !cible.startsWith(root + path.sep)) return null;
    return cible;
  } catch {
    return null;
  }
}

// ⚠️ PAS DE `.svg`, ET C'EST DÉLIBÉRÉ — deux raisons qui pointent dans le même sens.
//
// 1. SÉCURITÉ. Un SVG est un document exécutable : servi `image/svg+xml` en ligne, il s'ouvre sur
//    L'ORIGINE DU PLAYER et son script s'exécute avec elle. La réponse de streaming ne porte pas
//    de CSP — c'est un fichier, pas une page. Quiconque pourrait déposer un SVG dans une source
//    autorisée obtiendrait donc du script sur le domaine qui sert les documents.
// 2. COHÉRENCE. `isImageDocument()` ne reconnaît pas `.svg` : la visionneuse l'envoyait à pdf.js,
//    qui rendait un écran blanc. Le format était donc servi sans être affichable — le pire des
//    deux mondes.
//
// Les formats affichables sont ceux de la matrice du README : PDF et images bitmap.
const TYPES = {
  ".pdf": "application/pdf", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".gif": "image/gif", ".webp": "image/webp", ".avif": "image/avif",
};

/**
 * Lit un fichier local en présentant la MÊME forme qu'une réponse `fetch` : le reste du player ne
 * doit pas savoir d'où vient l'octet. Le `Range` est honoré — c'est de lui que vient l'affichage
 * des premières pages avant la fin du téléchargement.
 */
async function readLocal(cible, range) {
  let stat;
  try { stat = await fsp.stat(cible); } catch { return null; }
  if (!stat.isFile()) return null;

  const type = TYPES[path.extname(cible).toLowerCase()] || "application/octet-stream";
  const total = stat.size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(String(range || ""));
  let debut = 0, fin = total - 1, statut = 200;
  if (m && (m[1] || m[2])) {
    if (m[1]) { debut = Number(m[1]); fin = m[2] ? Math.min(Number(m[2]), total - 1) : total - 1; }
    else { debut = Math.max(0, total - Number(m[2])); }         // `bytes=-500` : les 500 derniers
    if (!(debut >= 0 && fin >= debut && debut < total)) {
      return reponse(416, {}, Buffer.alloc(0));                  // borne absurde : on le dit
    }
    statut = 206;
  }

  const fh = await fsp.open(cible, "r");
  try {
    const buf = Buffer.alloc(fin - debut + 1);
    const { bytesRead } = await fh.read(buf, 0, buf.length, debut);
    const corps = bytesRead === buf.length ? buf : buf.subarray(0, bytesRead);
    const entetes = { "content-type": type };
    if (statut === 206) entetes["content-range"] = `bytes ${debut}-${fin}/${total}`;
    return reponse(statut, entetes, corps);
  } finally {
    await fh.close();
  }
}

function reponse(status, entetes, corps) {
  const h = new Map(Object.entries(entetes));
  return {
    ok: status < 400,
    status,
    headers: { get: (k) => (h.has(String(k).toLowerCase()) ? h.get(String(k).toLowerCase()) : null) },
    arrayBuffer: async () => corps,
  };
}

// ── La garde ───────────────────────────────────────────────────────────────────────────────────

/**
 * Refus par défaut. On n'accepte que :
 *  - la route de fichiers de l'hôte (préfixe complet, https) ;
 *  - un objet PUBLIC d'un Storage explicitement autorisé (ces fichiers sont déjà accessibles à
 *    tous : on n'expose donc rien de neuf) ;
 *  - un fichier sous `PLAYER_LOCAL_ROOT`, si cette racine est configurée.
 *
 * Jamais d'identifiants dans l'URL (`https://victime@vrai-hote/…` : l'origine est bonne, mais des
 * identifiants voyageraient avec la requête).
 */
function isAllowedStorageUrl(candidate, origins, hostBase, root) {
  if (isHostFetchUrl(candidate, hostBase)) return true;
  if (root && resolveLocal(candidate, root)) return true;
  try {
    const url = new URL(String(candidate || ""));
    if (url.protocol !== "https:") return false;
    if (url.username || url.password) return false;
    if (!origins.includes(url.origin)) return false;
    // `pathname` est déjà normalisé par URL (les « .. » sont résolus avant d'arriver ici).
    return url.pathname.startsWith(PUBLIC_OBJECT_PREFIX);
  } catch {
    return false;
  }
}

/**
 * Va chercher un fichier autorisé, en relayant la requête `Range`.
 *
 * ⚠️ On demande explicitement du NON COMPRESSÉ : `fetch()` décompresse le corps tout en gardant
 * les en-têtes de l'amont — relayer sa taille annoncée servirait un PDF tronqué, sans erreur.
 *
 * ⚠️ Le secret n'accompagne QUE la route de l'hôte. L'envoyer à un Storage public le ferait fuiter
 * dans les journaux d'un tiers, où il n'a rien à faire.
 */
// ⚠️ `fetch` SUIT LES REDIRECTIONS PAR DÉFAUT, ET N'EN REVALIDE AUCUNE.
//
// La garde ci-dessus n'examinait que l'URL de DÉPART. Un amont autorisé — la route de l'hôte, ou
// n'importe quelle origine de Storage listée — qui répond `302` emmenait donc l'appel où il
// voulait : `localhost`, une adresse privée, une API de métadonnées cloud. L'invariant annoncé
// dans le README (« no redirect following into your private network ») était faux.
//
// ⚠️ ET LE SECRET SUIVAIT. `fetch` ne retire que `Authorization`, `Cookie` et
// `Proxy-Authorization` lors d'une redirection inter-origines — un en-tête maison comme
// `x-player-fetch-secret` est transmis tel quel. Mesuré avec deux serveurs locaux avant de
// corriger : la destination recevait le secret partagé de l'hôte en clair. Ce n'est donc pas
// seulement une SSRF, c'est une exfiltration de la clé qui autorise à lire TOUS ses documents.
//
// On suit donc les sauts à la main. Trois propriétés, et chacune ferme une porte différente :
//   1. chaque saut repasse la garde complète — une redirection n'ouvre rien que l'URL de départ
//      n'aurait pas ouvert ;
//   2. le secret est recalculé À CHAQUE SAUT — il ne part que si CE saut-là est sous la route de
//      l'hôte, jamais parce que le premier l'était ;
//   3. le nombre de sauts est borné, et le protocole ne peut pas changer de nature : une
//      redirection vers `file:` transformerait un amont distant en lecture de disque local.
const MAX_REDIRECTIONS = 5;
const DELAI_MAX_MS = 60_000;

async function fetchAllowedFile(url, { range } = {}, { origins, hostBase, root, secret } = {}) {
  if (!isAllowedStorageUrl(url, origins || [], hostBase, root)) return null;
  const local = root && resolveLocal(url, root);
  if (local) return readLocal(local, range);

  let cible = String(url);
  for (let saut = 0; saut <= MAX_REDIRECTIONS; saut++) {
    const headers = { "accept-encoding": "identity" };
    if (range) headers.range = range;
    // Recalculé à chaque tour : c'est CE saut-ci qui doit être sous la route de l'hôte.
    if (isHostFetchUrl(cible, hostBase) && secret) headers["x-player-fetch-secret"] = secret;

    // Un amont qui ne répond jamais immobiliserait la requête et ses ressources indéfiniment.
    // Le délai est large — un gros document met du temps — mais il est borné.
    const r = await fetch(cible, { headers, redirect: "manual", signal: AbortSignal.timeout(DELAI_MAX_MS) });
    if (r.status < 300 || r.status > 399) return r;

    const suivante = r.headers.get("location");
    if (!suivante) return r; // 3xx sans destination : on rend la réponse telle quelle
    let absolue;
    try { absolue = new URL(suivante, cible); } catch { return null; }
    // ⚠️ Jamais de changement de nature : `file:` ferait d'un amont distant une lecture de disque.
    if (absolue.protocol !== "https:" && absolue.protocol !== "http:") return null;
    if (!isAllowedStorageUrl(absolue.href, origins || [], hostBase, root)) return null;
    cible = absolue.href;
  }
  return null; // boucle de redirections : on refuse plutôt que de tourner
}

/**
 * Les extensions que le player sait AFFICHER — dérivées de la table ci-dessus, jamais recopiées.
 *
 * ⚠️ `bin/serve.js` en tenait une seconde liste pour sa page d'accueil, et elle contenait encore
 * `.svg` après son retrait en 0.1.7. La page de PREMIER CONTACT proposait donc un format que la
 * visionneuse ne sait plus ouvrir : on clique, et on reçoit un téléchargement. Deux listes du même
 * fait finissent toujours par diverger — celle-ci se déduit.
 */
const EXTENSIONS_AFFICHABLES = Object.freeze(Object.keys(TYPES));

module.exports = {
  EXTENSIONS_AFFICHABLES,
  PUBLIC_OBJECT_PREFIX,
  storageOrigins,
  hostFetchBase,
  isHostFetchUrl,
  localRoot,
  resolveLocal,
  isAllowedStorageUrl,
  fetchAllowedFile,
};
