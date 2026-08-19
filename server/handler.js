// Page publique de consultation d'un document commercial : /doc/:slug → visionneuse pdf.js qui TRACE
// l'ouverture et les PAGES VUES (un lien par destinataire → on sait qui a lu, combien de pages).
//  - GET  /doc/:slug            → HTML visionneuse (pdf.js EMBARQUÉ, servi par ?asset=…, nonce CSP)
//  - GET  /doc/:slug?file=1     → stream le PDF depuis le Storage (MÊME ORIGINE → pas de souci CORS pour pdf.js)
//  - POST /api/doc {slug,event…}→ journalise un événement (open / page / heartbeat) — best-effort
const crypto = require("crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { getShareBySlug, logView, upsertSession, createReshare, sendReshareEmail, upsertInternalSession,
  createShare, revokeShare, setShareAuth, overview: docOverview, listSharesForDoc, listSessionsForDoc, internalStatsForDoc , cleIdempotence } = require("./shares");
const { SESSION_QUOTA_PER_HOUR, PRESENT_QUOTA_PER_HOUR, PRESENT_CACHE_MS } = require("./shared.generated.js");
const { creerCache } = require("./cache.js");

// ⚠️ UN SEUL CACHE POUR TOUT LE PROCESSUS, ET C'EST LE POINT. Le créer par requête reviendrait à
// n'en avoir aucun : chaque appelant repartirait d'une table vide, et l'effondrement qu'on
// cherche — N spectateurs, une lecture — n'aurait jamais lieu. C'est aussi pourquoi il vit ici,
// au chargement du module, et non dans `init()` : un hôte qui réinitialise son contexte ne doit
// pas vider ce qui protège sa base.
const cacheLecture = creerCache({ ttlMs: PRESENT_CACHE_MS });
const { createPresentation, getPresentation, setPage, endPresentation, addMessage, listMessages, toggleReaction, editMessage, deleteMessage, setChatLock, createUploadUrl, reclaimPresentation, touchPresentation, listActivePresentations, handoverPresentation, endPresentationByOwner, recordAttendance, presentationStats, listPresentationsForDoc, switchPresentationDoc, setPresentationContent } = require("./presentations");
// CONTEXTE INJECTÉ : tout ce que le player emprunte à l'application hôte passe par ici — stockage,
// base, identité, limites, marque, journalisation — et rien d'autre. C'est la frontière qui permettra
// de brancher un second projet, puis d'ouvrir le cœur. Cf. api/_player-context.js.
// ⚠️ Le contexte est REÇU (`init`), pas construit ici. Ce fichier ne sait pas quelle application
// l'héberge — c'est ce qui lui permettra de partir dans le dépôt du player. Le point d'entrée
// Vercel (api/doc.js) est le seul à connaître le studio.
let PLAYER = null;
function init(ctx) {
  PLAYER = ctx;
  // Le domaine reçoit le même contexte : une seule construction pour tout le player.
  require("./shares").init(ctx);
  require("./retention").init(ctx);
  require("./gabarit-agent").init(ctx);
  for (const m of ["session-cles","gabarit-legal","page-mur","page-visionneuse","page-audience"]) require("./" + m).init(ctx);
  require("./presentations").init(ctx);
  require("./brands").init(ctx);
  // ⚠️ Réinitialisé avec le contexte : les réponses de la sonde valent pour UNE base. Un hôte qui
  // rebranche son contexte sur un autre projet doit reposer la question, pas hériter des réponses.
  require("./schema").init(ctx);
  docbot = ctx.plugins.bot;
}
const isAllowedStorageUrl = (url) => PLAYER.storage.isAllowedUrl(url);

// GREFFONS de ce studio — jamais du player. `null` quand le module est absent ou coupé
// (`PLAYER_PLUGINS_OFF`) : chaque usage doit donc être gardé, et le player continue sans eux.
let docbot = null;
// Cœur du player (futur projet open source, cf. player/README.md) : code navigateur écrit en
// modules TypeScript testés sous player/src/, regroupé par `npm run build:player`. Injecté tel
// quel dans la visionneuse — `window.Player` y expose le contrat postMessage avec l'app.
// Version publiée du player — lue là où elle est déjà déclarée, pour qu'elle ne puisse pas
// diverger de ce que l'hôte a réellement installé.
const PLAYER_VERSION = require("../package.json").version;
// Registre des marques : le loader porte celle du CLIENT dont on montre le document.
const brands = require("./brands");

const { jsonPourScript } = require("./texte");
// Content-Disposition sûr : un en-tête HTTP ne tolère QUE de l'ASCII imprimable (un accent/emoji dans le nom de
// fichier → TypeError ERR_INVALID_CHAR qui casse tout le stream). Repli ASCII pour filename= + RFC 5987 filename*
// pour conserver le nom unicode exact. (esc() = échappement HTML, inadapté à un en-tête → ne plus l'utiliser ici.)
const dispositionInline = (name) => {
  const raw = String(name || "document.pdf");
  const ascii = raw.replace(/[^\x20-\x7E]/g, "_").replace(/["\\]/g, "").trim() || "document.pdf";
  return `inline; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(raw)}`;
};
const originOf = (u) => { try { return new URL(u).origin; } catch { return ""; } };
// ⚠️ CETTE VERSION EST DANS LA PLAGE DE CVE-2024-4367 (exécution de script à l'ouverture d'un PDF
// forgé, quand `isEvalSupported` garde sa valeur par défaut). Deux raisons pour lesquelles elle
// est encore là, et il faut les distinguer :
//
//   1. Notre CSP n'autorise pas `unsafe-eval`, ce qui bloque le chemin d'exploitation. Mais cette
//      atténuation était IMPLICITE — une modification de CSP la rouvrait sans que rien ne le dise.
//      Les quatre appels à `getDocument` forcent donc désormais `isEvalSupported: false`, en
//      défense en profondeur : la protection ne dépend plus d'un en-tête écrit ailleurs.
//   2. La montée vers 4.x+ a été FAITE (0.1.66) : bibliothèque embarquée, modules ES servis par
//      notre route ?asset=…, worker de même origine. L'historique de la contrainte cdnjs vit dans
//      le CHANGELOG ; ce commentaire a longtemps décrit la migration au futur.
//
// Signalé par un audit externe. Fermer le chemin d'abord, migrer ensuite — dans cet ordre.
// ⚠️ PDF.JS EST EMBARQUÉ (pdfjs-dist, épinglé exact) ET SERVI PAR NOTRE ROUTE `?asset=…`. Trois
// ans de CDN ont coûté : un tiers dans la CSP, un worker impossible à couvrir par SRI (il n'entre
// pas par une balise), le ballet d'empreintes qui le contournait, et un épinglage suspendu à ce
// que cdnjs continuait de publier. Un actif de même origine EST nos octets.
//
// Actifs pdf.js : URLs extraites dans server/tiers.js.

// Tiers épinglés (SUPAJS, TIERS, balise…) : extraits dans server/tiers.js.
const { TIERS } = require("./tiers");

const { notFoundHtml, softWallHtml } = require("./page-mur");
const { viewerHtml } = require("./page-visionneuse");
const { presentHtml } = require("./page-audience");

/**
 * Pied de mentions d'une page servie. `tracked` = cette page mesure la lecture de la personne qui
 * la regarde — la mention de mesure n'apparaît QUE dans ce cas, et elle est affichée par défaut.
 * Les autres liens n'apparaissent que si l'hôte les a configurés : neutre par défaut, comme la marque.
 */
/**
 * Relaie un fichier vers le lecteur. À n'utiliser QUE via cette fonction — les trois chemins de
 * streaming (lien tracé, aperçu interne, page audience) faisaient la même chose à trois endroits,
 * et la même erreur.
 *
 * ⚠️ LE PIÈGE, signalé par le second hôte en implémentant sa propre route : `fetch()`
 * **décompresse le corps pour nous, et garde les en-têtes reçus**. Relayer fidèlement le
 * `Content-Length` de l'amont annonce donc la taille du COMPRESSÉ alors qu'on sert du décompressé
 * — le lecteur reçoit un PDF **tronqué**. Ce n'est plus « le chargement progressif ne marche pas »,
 * c'est « le document est corrompu », et sans erreur nulle part.
 *
 * On ne relaie donc JAMAIS la taille annoncée : on envoie celle des octets qu'on envoie vraiment.
 *
 * ⚠️ Et un 206 compressé est irrécupérable : les bornes portent sur les octets compressés, un
 * fragment gzip ne se décompresse pas seul. On refuse bruyamment plutôt que de servir du faux.
 */

// ⚠️ CE QU'ON RELAIE S'OUVRE SUR NOTRE ORIGINE.
//
// Un fichier relayé sort du domaine qui sert les documents — donc avec ses cookies, son
// `localStorage` et ses jetons de présentation. Relayer un `Content-Type` exécutable revient à
// héberger le script de quelqu'un d'autre chez soi : un SVG déposé dans une source autorisée
// (bucket public, route de l'hôte) s'ouvre `image/svg+xml`, et son `<script>` s'exécute avec
// notre origine. La réponse de streaming ne porte aucune CSP — c'est un fichier, pas une page.
//
// Retirer `.svg` de la table des types locaux (côté `context/storage.js`) ne réglait que la
// moitié du sujet : l'amont distant annonce le type qu'il veut, et on le recopiait.
//
// On ne REFUSE pas pour autant : le fichier existe, quelqu'un a le droit de le récupérer, et un
// 502 sur une pièce jointe légitime serait une panne. On le rend simplement **inerte** — type
// générique et téléchargement forcé. Il n'était de toute façon pas affichable (la matrice des
// formats du README ne connaît que le PDF et les images bitmap).
const TYPES_EXECUTABLES = /^(image\/svg|text\/html|application\/xhtml|application\/xml|text\/xml)/i;

// jsonPourScript : extrait dans server/texte.js.

// ⚠️ `X-Forwarded-For` EST UN EN-TÊTE, DONC UNE AFFIRMATION DU CLIENT.
//
// Onze endroits en prenaient la première valeur pour identifier l'appelant, et toutes les limites
// de débit s'appuyaient dessus. Un client qui atteint directement le serveur — c'est le cas du
// serveur autonome, et de toute instance dont le proxy ne réécrit pas cet en-tête — pouvait donc
// en changer à chaque requête et n'être jamais limité. La limite existait, elle ne limitait rien.
//
// Le caractère « par processus » des compteurs était documenté ; la confiance dans un en-tête non
// authentifié ne l'était pas. C'est la différence entre une limite approximative et une limite
// décorative.
//
// La décision revient à l'hôte, parce que lui seul sait s'il y a un proxy devant lui :
// `identity.clientIp(req)` s'il la fournit, sinon l'adresse de la socket — jamais l'en-tête. Un
// hôte derrière un proxy déclare sa politique dans son câblage ; un hôte sans proxy n'a rien à
// faire, et il est protégé par défaut.
function adresseAppelant(req) {
  try {
    if (PLAYER.identity && typeof PLAYER.identity.clientIp === "function") {
      const v = PLAYER.identity.clientIp(req);
      if (v) return String(v).slice(0, 60);
    }
  } catch { /* une IP indisponible ne doit pas empêcher de lire un document */ }
  return String((req.socket && req.socket.remoteAddress) || "").slice(0, 60);
}

/**
 * Cet appelant est-il un MEMBRE de l'hôte, prouvé — pas déclaré ?
 *
 * ⚠️ L'appartenance décide de quelle POPULATION une lecture rejoint. « Ce client a lu douze
 * minutes » ne vaut que si un collègue relisant le document n'entre pas dans le même compte : c'est
 * la promesse que ce produit vend. Un booléen envoyé par le navigateur ne prouve rien — il est
 * choisi par qui l'envoie.
 *
 * Le jeton d'accès, lui, est vérifié par l'hôte. Absent ou invalide : pas membre. Jamais de repli
 * sur ce que l'appelant affirme, sinon la vérification ne sert qu'aux honnêtes.
 */
// Clés de localStorage : extraites dans server/session-cles.js.


/**
 * Le profil PROUVÉ de l'appelant : ce que son jeton dit de lui, jamais ce qu'il affirme.
 *
 * ⚠️ `isPresenter` et `isMember` étaient vérifiés depuis 0.1.25/0.1.28, mais `name`, `email` et
 * `avatar` venaient toujours du corps de la requête — même quand un jeton valide accompagnait
 * l'appel. Un membre authentifié pouvait donc publier un message portant le nom et l'adresse d'un
 * collègue, AVEC le badge membre : l'attribution visuelle disait quelqu'un d'autre.
 *
 * ⚠️ Ça ne donnait aucun droit — modifier et supprimer s'autorisent par `author_hash`, pas par
 * l'e-mail (cf. `editMessage`). Le dommage est l'attribution, pas la prise de contrôle. C'est déjà
 * assez : dans une discussion, un message signé du nom d'un autre est le problème.
 *
 * L'hôte peut fournir `identity.profileOf` pour dire comment lire SON utilisateur. Sans ce
 * crochet, on lit les formes courantes — et l'e-mail, lui, est universel.
 *
 * Signalé par la seconde passe d'audit (P1-6).
 */
/**
 * La clé d'un participant qui ne peut RIEN prouver.
 *
 * Un anonyme n'a pas de jeton : sa clé vient forcément de son navigateur, et le serveur ne peut pas
 * la lui contester. Ce qu'il peut faire, c'est l'empêcher de sortir de son espace de noms — donc de
 * ressembler à la clé d'un membre, qui est une adresse e-mail.
 *
 * ⚠️ C'est la même logique que le quota fondé sur l'adresse : on ne fonde pas une garantie sur ce
 * que l'appelant choisit. Ici on ne peut pas éviter qu'il choisisse ; on peut borner ce qu'il peut
 * choisir. Deux anonymes restent séparés par une valeur imprévisible, comme deux sessions.
 *
 * Une clé absente ou hors forme n'est pas une erreur : elle vaut « inconnu ». Un participant mal
 * compté vaut mieux qu'une audience refusée.
 */
/** La clé d'un membre : son adresse, normalisée — la recherche de ligne est exacte. */
function lcMembre(email) {
  return String(email || "").trim().toLowerCase();
}

function cleAnonyme(brut) {
  const v = String(brut == null ? "" : brut).trim().slice(0, 120);
  return /^anon-[A-Za-z0-9_-]{4,}$/.test(v) ? v : "anon-inconnu";
}

async function profilDuJeton(req) {
  try {
    const u = await PLAYER.identity.verifyToken((req.headers && req.headers.authorization) || "");
    if (!u || !u.email) return null;
    if (typeof PLAYER.identity.profileOf === "function") {
      const p = PLAYER.identity.profileOf(u) || {};
      return { email: String(p.email || u.email), name: String(p.name || ""), avatar: String(p.avatar || "") };
    }
    const meta = (u && u.user_metadata) || {};
    return {
      email: String(u.email),
      name: String(u.name || meta.name || meta.full_name || ""),
      avatar: String(u.avatar || meta.avatarUrl || meta.avatar_url || ""),
    };
  } catch { return null; }
}

/**
 * Plafond du relais, en octets. Réglable par l'exploitant : un hôte qui sert des plans
 * d'architecte n'a pas les mêmes documents qu'un hôte qui sert des notices.
 */
const PLAFOND_RELAIS = Number(process.env.PLAYER_MAX_RELAY_BYTES || 0) || 60 * 1024 * 1024;

async function relayerFichier(res, r, disposition) {
  if (!r) { res.statusCode = 404; res.end("Fichier indisponible"); return; }
  // 413 et 416 sont des REFUS ARGUMENTÉS de l'amont local (plafond, borne absurde) : les fondre
  // dans un 502 dirait « panne » là où l'amont a dit « demande irrecevable ».
  if (!r.ok && r.status !== 206) {
    res.statusCode = r.status === 413 || r.status === 416 ? r.status : 502;
    res.end(r.status === 413 ? "Fichier trop volumineux" : "Fichier indisponible");
    return;
  }

  const compresse = !!r.headers.get("content-encoding");
  if (compresse && r.status === 206) { res.statusCode = 502; res.end("Fichier indisponible"); return; }

  // ⚠️ DEUX BORNES, ET LA SECONDE EST LA SEULE QUI TIENNE DEVANT UN AMONT QUI MENT.
  //
  // La première regarde `Content-Length` et renonce AVANT d'ouvrir le corps. C'est la seule qui
  // puisse encore répondre 413, puisque rien n'est parti — mais elle croit l'amont sur parole : un
  // stockage qui n'annonce rien, ou qui annonce 1 Ko et en envoie 500, passait sans être inquiété.
  //
  // La seconde COMPTE LES OCTETS QUI PASSENT et rompt au dépassement. Elle ne peut plus répondre
  // 413 : les en-têtes sont partis avec le premier octet, et on ne dédit pas un en-tête déjà
  // envoyé. Elle coupe. Le client voit un transfert interrompu — désagréable et honnête, là où
  // l'épuisement de la mémoire emportait la fonction ENTIÈRE, donc aussi les requêtes des autres.
  const brute = r.headers.get("content-length");
  const annoncee = Number(brute || 0);
  if (annoncee > PLAFOND_RELAIS) {
    try { PLAYER.errors.capture(new Error(`relais refusé : ${annoncee} octets au-dessus du plafond de ${PLAFOND_RELAIS}`), { route: "relais" }); } catch { /* jamais bloquant */ }
    res.statusCode = 413;
    res.end("Fichier trop volumineux");
    // ⚠️ Renoncer ne suffit pas : un corps jamais tiré laisse la connexion amont OUVERTE, et le
    // pool de sockets s'épuise sur les gros fichiers — exactement la ressource qu'on protège.
    try { if (r.body) r.body.cancel(); } catch { /* déjà refermé */ }
    return;
  }

  res.statusCode = r.status;
  const typeAmont = r.headers.get("content-type") || "application/pdf";
  const executable = TYPES_EXECUTABLES.test(typeAmont);
  res.setHeader("Content-Type", executable ? "application/octet-stream" : typeAmont);
  // ⚠️ On ÉCRASE la disposition, on ne la complète pas : les chemins de streaming passent
  // `inline; filename=…` pour que la visionneuse affiche le document. Sur un type exécutable,
  // `inline` est précisément ce qu'il ne faut pas — et un `|| "attachment"` n'aurait jamais servi.
  if (executable) disposition = "attachment";
  // `nosniff` : sans lui, un `text/plain` contenant du HTML peut être requalifié par le
  // navigateur — la garde ci-dessus porterait alors sur un type qui n'est pas celui qui s'ouvre.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Accept-Ranges", "bytes");
  // Les bornes d'un `Content-Range` ne valent que si l'amont n'a pas compressé.
  const cr = !compresse && r.headers.get("content-range");
  if (cr) res.setHeader("Content-Range", cr);
  // ⚠️ `fetch` DÉCOMPRESSE DE LUI-MÊME, et c'est le piège du flux. Sur un amont gzip,
  // `Content-Length` compte les octets COMPRIMÉS alors que nous relayons les octets déployés :
  // le recopier ferait attendre au client des octets qui ne viendront jamais, ou lui ferait couper
  // le document au milieu. La bufferisation nous rendait ce service sans qu'on le demande —
  // `buf.length` était toujours juste. En flux, il faut savoir se taire ; voir plus bas.
  if (disposition) res.setHeader("Content-Disposition", disposition);
  res.setHeader("Cache-Control", "private, max-age=600");

  // ⚠️ UN AMONT SANS CORPS LISIBLE N'EST PAS UNE ANOMALIE, C'EST LE CONTRAT. `storage.fetchFile`
  // est une capacité de l'HÔTE : il rend ce qu'il veut, du moment qu'il sait dire `arrayBuffer()`.
  // Le chemin fichier local du mode autonome, lui, ne rend rien d'autre. Traiter cette absence
  // comme « rien à envoyer » servait des fichiers VIDES, sans une erreur pour le dire — un défaut
  // pire que celui qu'on ferme ici, et que seuls deux essais existants ont vu tomber.
  //
  // Ici la borne du flux ne peut rien : `arrayBuffer()` a déjà tout alloué quand on pourrait
  // compter. Seule la taille annoncée protège — ce qui suffit, parce qu'un hôte qui rend un corps
  // en un bloc l'a lu depuis quelque chose dont il connaît la taille.
  if (!r.body) {
    const buf = Buffer.from(await r.arrayBuffer());
    res.setHeader("Content-Length", String(buf.length)); // connue, donc annoncée
    res.end(buf);
    return;
  }

  // ⚠️ ON N'ANNONCE UNE LONGUEUR QUE QUAND ON SAIT QU'ELLE DÉCRIT CE QU'ON ENVOIE — et en flux,
  // la seule qu'on ait est celle de l'amont. Sans encodage elle est exacte : on la garde, elle
  // vaut une barre de progression. Avec encodage on se tait (cf. plus haut), et la fin du corps
  // fait foi. Sans annonce amont, on se tait aussi : c'est le prix du flux, payé en connaissance.
  if (!compresse && brute) res.setHeader("Content-Length", brute);

  const plafond = PLAFOND_RELAIS;
  try {
    await pipeline(Readable.fromWeb(r.body), async function* (source) {
      let vus = 0;
      for await (const morceau of source) {
        vus += morceau.length;
        if (vus > plafond) throw new Error(`relais interrompu : ${vus} octets reçus, plafond ${plafond}`);
        yield morceau;
      }
    }, res);
  } catch (erreur) {
    // ⚠️ ROMPRE, PAS RÉPONDRE — et le DIRE. Aucun code de retour n'est plus disponible ; ne
    // reste que la coupure. Une coupure fréquente ici est un plafond mal réglé ou un amont
    // défaillant : l'avaler ferait passer un défaut d'exploitation pour un caprice du réseau.
    try { PLAYER.errors.capture(erreur instanceof Error ? erreur : new Error(String(erreur)), { route: "relais" }); } catch { /* jamais bloquant */ }
    try { res.destroy(); } catch { /* le socket est peut-être déjà parti */ }
  }
}

// Pied légal : extrait dans server/gabarit-legal.js.


function sendHtml(res, status, html, scriptSrc, imgExtra, frameAncestors) {
  res.statusCode = status;
  // Origine Supabase Storage (voix ElevenLabs mise en cache dans le bucket public tts-cache) → autorisée en media-src.
  let supaOrigin; try { supaOrigin = new URL((PLAYER.config && PLAYER.config.supabaseUrl) || "").origin; } catch { supaOrigin = ""; }
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    // ⚠️ `'none'` DOIT ÊTRE SEUL ou la directive est invalide — « 'none' 'self' » a fait rejeter
    // la CSP entière par Chrome (vu à la sonde du banc, pas en relisant le code).
    `script-src ${scriptSrc ? scriptSrc + " 'self'" : "'self'"}`,
    "worker-src 'self'",
    `connect-src 'self'${supaOrigin ? " " + supaOrigin : ""}`,
    `img-src 'self' data: blob:${imgExtra ? " " + imgExtra : ""}`,
    `media-src 'self'${supaOrigin ? " " + supaOrigin : ""}`,
    "style-src 'unsafe-inline'",
    "base-uri 'none'",
    // ⚠️ `form-action` NE RETOMBE PAS SUR `default-src`. C'est l'une des rares directives à ne pas
    // hériter : une page en `default-src 'none'` peut malgré tout poster un formulaire n'importe
    // où. Aucune de nos pages ne contient de `<form>` — les envois passent par `fetch`, donc par
    // `connect-src` — mais un script injecté pourrait en fabriquer un pour exfiltrer vers un
    // domaine tiers, et rien ne l'en empêchait.
    //
    // `'self'` plutôt que `'none'` : le mur d'accès et la connexion visiteur peuvent avoir besoin
    // d'un envoi de même origine, et casser une authentification pour fermer une porte que
    // personne n'a franchie serait un mauvais échange. `'self'` ferme l'exfiltration, qui est le
    // risque réel.
    "form-action 'self'",
    // ⚠️ CE COMMENTAIRE ANNONÇAIT `'none'` POUR LA PAGE PUBLIQUE, ET C'ÉTAIT FAUX. Un lien tracé
    // sans `embed` est servi en `frame-ancestors 'self'` (cf. la route `doc`) : encadrement de
    // MÊME ORIGINE uniquement, ce qui reste sain — un détournement de clic suppose une page
    // étrangère, et une page hostile sur notre propre origine serait déjà une compromission bien
    // pire. Mais la phrase, elle, faisait croire à un refus total.
    //
    // Trouvé en écrivant l'essai de bout en bout : l'assertion recopiait ce commentaire, et c'est
    // elle qui est tombée. Le comportement est désormais VÉRIFIÉ par ce banc, donc ce que vous
    // lisez ici ne peut plus dériver seul.
    `frame-ancestors ${frameAncestors || "'none'"}`,
  ].join("; "));
  res.end(html);
}

// Page « soft wall » : CSP dédiée — autorise Google Identity Services (One-Tap) en plus du nonce.
function sendSoftWallHtml(res, html, nonce, imgExtra, frameAncestors) {
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' https://accounts.google.com/gsi/client`,
    "connect-src 'self' https://accounts.google.com/gsi/",
    "frame-src https://accounts.google.com/gsi/",
    `img-src 'self' data: blob:${imgExtra ? " " + imgExtra : ""}`,
    "style-src 'unsafe-inline' https://accounts.google.com/gsi/style",
    "base-uri 'none'",
    // ⚠️ `form-action` NE RETOMBE PAS SUR `default-src`. C'est l'une des rares directives à ne pas
    // hériter : une page en `default-src 'none'` peut malgré tout poster un formulaire n'importe
    // où. Aucune de nos pages ne contient de `<form>` — les envois passent par `fetch`, donc par
    // `connect-src` — mais un script injecté pourrait en fabriquer un pour exfiltrer vers un
    // domaine tiers, et rien ne l'en empêchait.
    //
    // `'self'` plutôt que `'none'` : le mur d'accès et la connexion visiteur peuvent avoir besoin
    // d'un envoi de même origine, et casser une authentification pour fermer une porte que
    // personne n'a franchie serait un mauvais échange. `'self'` ferme l'exfiltration, qui est le
    // risque réel.
    "form-action 'self'",
    `frame-ancestors ${frameAncestors || "'self'"}`,
  ].join("; "));
  res.end(html);
}

/**
 * Ancres de framing d'une page INTÉGRÉE (?embed=1). Extrait du chemin nominal : une page de refus
 * doit pouvoir être encadrée exactement comme la visionneuse qu'elle remplace — sinon le
 * navigateur bloque le rendu et le message de refus ci-dessous n'est jamais émis.
 */
// ⚠️ LA MÊME SOURCE QUE LA CARTE D'IDENTITÉ, ET C'EST TOUT LE SUJET. Cette fonction lisait
// `process.env.DOC_FRAME_ANCESTORS` pendant que `?contract=1` annonçait
// `PLAYER.config.extraFrameAncestors`. Les deux coïncident tant qu'un hôte remplit sa
// configuration depuis cette variable — c'est le cas des deux hôtes actuels, donc rien n'était
// cassé. Mais un hôte qui la calcule autrement (base, fichier, autre nom de variable) verrait la
// carte annoncer une liste et l'en-tête CSP en servir une autre : « configuré » et « servi »
// divergents à l'intérieur même du mécanisme construit pour détecter cette divergence.
function embedFrameAncestors() {
  return ["'self'", "https://*.vercel.app"]
    .concat((PLAYER.config && PLAYER.config.extraFrameAncestors) || [])
    .join(" ");
}

/**
 * REFUS D'AFFICHER, dit à voix haute.
 *
 * ⚠️ Signalé par le second hôte en câblant son application : `embed-ready` qui n'arrive pas peut
 * vouloir dire deux choses OPPOSÉES — le player n'est pas là (instance absente, en panne), ou le
 * player REFUSE (lien révoqué, mur d'accès, greffon manquant en fail-closed). Un hôte prudent
 * replie sur le lecteur du navigateur au bout de quelques secondes ; dans le second cas, ce repli
 * OUVRE un document que le player venait de fermer. Le silence était donc un trou de sécurité.
 *
 * On répond `embed-denied` : la décision reste la nôtre, l'hôte apprend seulement à ne pas replier.
 */
function sendRefusal(res, reason, embed) {
  if (!embed) return sendHtml(res, 404, notFoundHtml());
  const nonce = crypto.randomBytes(16).toString("base64");
  const html = notFoundHtml() + `<script nonce="${nonce}">try{parent.postMessage({type:"3dd-doc-embed-denied",reason:${jsonPourScript(String(reason))}},"*")}catch(e){}</script>`;
  return sendHtml(res, 404, html, `'nonce-${nonce}'`, "", embedFrameAncestors());
}

// Page indisponible + soft wall : extraites dans server/page-mur.js.
// Titre d'onglet + visionneuse : extraits dans server/page-visionneuse.js.
function originesImages(logoInstance, share) {
  const s = share || {};
  return [
    originOf(logoInstance),
    originOf(s.brand_logo),
    originOf(s.bot_avatar),
    // ⚠️ Celui-ci ne cassait pas, et c'est pire qu'un défaut visible : il marchait PAR ACCIDENT,
    // parce que la photo du présentateur et l'avatar de l'assistant sortent en général du même
    // stockage, donc de la même origine. Le jour où un hôte range l'une ailleurs, elle disparaît
    // sans que rien n'ait changé chez lui.
    originOf(s.bot_vphoto),
    // ⚠️ Trouvé par la garde à son premier passage, et il ne se voyait pas : cette adresse ne part
    // pas dans le HTML mais dans la configuration, et c'est la couche live qui en fait une image à
    // l'exécution — dans la liste des participants. Un défaut de politique sur une image construite
    // par du script se lit encore moins qu'un autre : la page est déjà chargée quand il se produit.
    originOf(s.presenter_avatar),
  ].filter(Boolean).join(" ");
}

function sendPresentHtml(res, html, nonce, supaUrl, imgExtra, frameAncestors) {
  const wss = String(supaUrl || "").replace(/^https:/, "wss:");
  res.statusCode = 200;
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", [
    "default-src 'none'",
    `script-src 'nonce-${nonce}' 'self' https://cdn.jsdelivr.net https://unpkg.com https://maps.googleapis.com https://maps.gstatic.com`,
    "worker-src 'self'",
    `connect-src 'self' https://cdn.jsdelivr.net https://nominatim.openstreetmap.org https://*.googleapis.com https://*.gstatic.com ${supaUrl} ${wss}`,
    `img-src 'self' data: blob: https://*.tile.openstreetmap.org https://unpkg.com https://*.googleapis.com https://*.gstatic.com https://*.ggpht.com https://*.googleusercontent.com ${supaUrl}${imgExtra ? " " + imgExtra : ""}`,
    "style-src 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
    "font-src https://fonts.gstatic.com data:",
    "base-uri 'none'",
    // ⚠️ `form-action` NE RETOMBE PAS SUR `default-src`. C'est l'une des rares directives à ne pas
    // hériter : une page en `default-src 'none'` peut malgré tout poster un formulaire n'importe
    // où. Aucune de nos pages ne contient de `<form>` — les envois passent par `fetch`, donc par
    // `connect-src` — mais un script injecté pourrait en fabriquer un pour exfiltrer vers un
    // domaine tiers, et rien ne l'en empêchait.
    //
    // `'self'` plutôt que `'none'` : le mur d'accès et la connexion visiteur peuvent avoir besoin
    // d'un envoi de même origine, et casser une authentification pour fermer une porte que
    // personne n'a franchie serait un mauvais échange. `'self'` ferme l'exfiltration, qui est le
    // risque réel.
    "form-action 'self'",
    `frame-ancestors ${frameAncestors || "'none'"}`,
  ].join("; "));
  res.end(html);
}

// Page audience : extraite dans server/page-audience.js.

async function readJsonBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") { try { return JSON.parse(req.body); } catch { return {}; } }
  return await new Promise((resolve) => {
    let data = ""; req.on("data", (c) => { data += c; if (data.length > 1e5) req.destroy(); });
    req.on("end", () => { try { resolve(JSON.parse(data || "{}")); } catch { resolve({}); } });
    req.on("error", () => resolve({}));
  });
}

/**
 * Paramètres de la requête, quelle que soit la plateforme.
 *
 * Le gestionnaire lit `req.query` — la convention des plateformes serverless (Vercel, Next.js) et
 * d'Express. Un serveur HTTP nu ne la remplit pas : `req.query` est alors `undefined`, et TOUT
 * paramètre disparaît.
 *
 * ⚠️ CE QUE ÇA DONNAIT, ET POURQUOI C'ÉTAIT LE PIRE DES SYMPTÔMES. Sans paramètres, la requête
 * partait chercher un partage nommé « rien », n'en trouvait pas, et affichait « Ce lien n'est plus
 * valide ou a été révoqué ». Un intégrateur voyait donc un REFUS là où il n'avait simplement pas
 * branché la plateforme. C'est exactement l'inversion qu'on passe notre temps à corriger : une
 * erreur de câblage ne doit jamais ressembler à une décision.
 *
 * Signalé par un hôte qui montait le player sur `http.createServer` : chez lui ça aurait marché en
 * production (Vercel remplit `req.query`) — par chance, pas par construction.
 */
function parametres(req) {
  if (req.query && typeof req.query === "object") return req.query;
  try {
    return Object.fromEntries(new URL(req.url || "/", "http://interne").searchParams);
  } catch {
    return {};
  }
}

async function handler(req, res) {
  try {
    const q = parametres(req);
    const slug = String(q.slug || "").trim();

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      // ── Connexion VISITEUR (soft wall) : demande d'un code par email, puis vérification. ──
      // Émet un jeton signé posé en cookie qui débloque les contenus gatés (require_auth).
      if (body.action === "visitor-request" || body.action === "visitor-verify" || body.action === "visitor-google") {
        const jv = (status, obj, cookie) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); if (cookie) res.setHeader("Set-Cookie", cookie); res.end(JSON.stringify(obj)); };
        const V = PLAYER.plugins.visitors;
        if (!V) return jv(404, { ok: false, error: "disabled" });
        const ip = adresseAppelant(req) || "ip";
        if (body.action === "visitor-request") {
          if (!(await PLAYER.limits.allow(`vcode:${ip}`, 20, 3600))) return jv(429, { ok: false, error: "rate" });
          const sh = await getShareBySlug(String(body.slug || ""));
          return jv(200, await V.requestCode(body.email, { title: sh && sh.doc_title }));
        }
        const recordUnlock = async (visitor, method) => {
          try {
            if (!body.slug || !visitor || !visitor.email) return;
            await PLAYER.db.request("xp_visitor_unlocks", { method: "POST", headers: { Prefer: "return=minimal" }, body: [{ doc_slug: String(body.slug), email: visitor.email, name: visitor.name || null, method }] });
          } catch (e) {
      // ⚠️ TROUVÉ EN VÉRIFIANT LE TARBALL DE 0.1.37, PAS PAR LA GARDE QUI VENAIT DE NAÎTRE.
      //
      // Celle-ci filtrait sur une LISTE DE NOMS de fonctions d'écriture. `recordUnlock` écrit
      // directement par `PLAYER.db.request`, donc elle ne l'a pas vu — exactement le défaut que
      // l'audit reprochait à la garde des prototypes, reproduit dans une garde écrite le même jour
      // pour éviter ce genre de chose.
      //
      // La garde vise désormais la FORME (toute écriture en base rattrapée en silence), pas des
      // noms. Une liste ne voit que ce qu'on y a mis ; une forme voit aussi le prochain.
      try {
        if (await PLAYER.limits.allow("unlock:echec", 1, 3600)) {
          PLAYER.errors.capture(new Error(`déverrouillage visiteur non journalisé : ${e && e.message ? e.message : "cause inconnue"}`), { route: "visitor-unlock" });
        }
      } catch { /* un journal ne doit jamais empêcher une lecture */ }
    }
        };
        if (body.action === "visitor-google") {
          const r = await V.verifyGoogle(body.credential);
          if (r.ok) await recordUnlock(r.visitor, "google");
          return r.ok ? jv(200, { ok: true }, r.setCookie) : jv(400, r);
        }
        const r = await V.verifyCode(body.email, body.code, body.name);
        if (r.ok) await recordUnlock(r.visitor, "email");
        return r.ok ? jv(200, { ok: true }, r.setCookie) : jv(400, r);
      }
      // Mode « Présenter » : démarrage / changement de page / fin. start = public (URL Storage validée) ;
      // page & end exigent le control_token (secret présentateur). L'audience (slug seul) ne peut pas piloter.
      if (body.action === "present-start" || body.action === "present-page" || body.action === "present-end" || body.action === "present-touch") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          if (body.action === "present-start") {
            if (!isAllowedStorageUrl(String(body.fileUrl || ""))) return jp(400, { ok: false, error: "url" });
            const ip = adresseAppelant(req) || "anon";
            const allowed = await PLAYER.limits.allow(`pstart:${ip}`, 60, 3600);
            if (!allowed) return jp(429, { ok: false, error: "rate" });
            // On rattache la présentation au membre (JWT) → reprise / liste / transfert. Best-effort : sans
            // session valide la présentation démarre quand même mais ne sera pas reprenable.
            let owner = null;
            const u = await PLAYER.identity.verifyToken(req.headers.authorization);
            if (u && u.email) { const m = u.user_metadata || {}; owner = { id: u.id, email: u.email, name: body.presenterName || m.name || u.email || "", avatar: body.presenterAvatar || m.avatarUrl || "" }; }
            const out = await createPresentation({ docId: body.docId, fileUrl: body.fileUrl, fileName: body.fileName, docTitle: body.docTitle, presenterName: body.presenterName, owner });
            return jp(200, { ok: true, slug: out.slug, control: out.control });
          }
          const r = body.action === "present-page"
            ? await setPage(String(body.slug || ""), String(body.control || ""), body.page, body.seq)
            : body.action === "present-touch"
            ? await touchPresentation(String(body.slug || ""), String(body.control || ""))
            : await endPresentation(String(body.slug || ""), String(body.control || ""));
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch (erreur) {
          // ⚠️ CE CATCH A AVALÉ TROIS JOURS DE CLÔTURES IMPOSSIBLES SANS UNE TRACE. Chez le second
          // hôte, chaque « Terminer » échouait en 23502 (marqueur d'archive NOT NULL) — et ce 500
          // muet ne laissait RIEN, même pas une ligne dans le journal d'erreurs. Un journal que
          // personne ne lit vaut peu ; aucun journal ne vaut rien du tout.
          try { PLAYER.errors.capture(erreur instanceof Error ? erreur : new Error(String(erreur)), { route: "present-" + String(body.action || "").replace(/^present-/, "") }); } catch { /* jamais bloquant */ }
          return jp(500, { ok: false });
        }
      }
      // Assistant IA « présentateur » (bot) sur un lien tracé bot_enabled. PUBLIC (prospect anonyme) → rate-limit IP.
      // Synthèse vocale (ElevenLabs) : Léa lit ses messages. PUBLIC (audience anonyme), mais gated : la clé
      // reste côté serveur, le slug doit être un lien-bot valide, et l'audio est mis en CACHE dans le bucket
      // « tts-cache » (nom = hash voix+modèle+texte) → un message identique n'est synthétisé qu'une fois.
      if (body.action === "bot-tts") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        if (!docbot) return jp(404, { ok: false, error: "disabled" });
        try {
          const apiKey = process.env.ELEVENLABS_API_KEY;
          if (!apiKey) return jp(200, { ok: false, disabled: true });
          const share = await getShareBySlug(String(body.slug || ""));
          if (!share || !share.bot_enabled) return jp(404, { ok: false, error: "bot" });
          const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 700);
          if (!text) return jp(400, { ok: false, error: "empty" });
          const ip = adresseAppelant(req) || "anon";
          if (!(await PLAYER.limits.allow(`doctts:${ip}`, 400, 3600))) return jp(429, { ok: false, error: "rate" });
          const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
          let voiceId = defaultVoiceId;
          // Voix PAR AGENT : le profil du lien peut porter sa propre voix ElevenLabs (behavior.voice.id).
          // Le cache est déjà haché par voix → changer la voix d'un agent régénère proprement ses extraits.
          let voiceOwner = "", voiceName = "", pron = null;
          try { const bp = await docbot.getProfile(share.bot_profile_id); const bv = bp && bp.behavior && bp.behavior.voice; if (bv && bv.id) { voiceId = String(bv.id); voiceOwner = String(bv.owner || ""); voiceName = String(bv.name || ""); } pron = docbot.pronFix(bp); } catch { /* voix par défaut, sans prononciation */ }
          // DIRE ≠ MONTRER : la prononciation (behavior.voice.pron) s'applique ICI, côté serveur — le client
          // envoie et affiche l'ORTHOGRAPHE, la synthèse (et son cache) travaille sur la version phonétique.
          // `spoken` est renvoyé quand il diffère → le viewer aligne le karaoké dessus (mapping mot à mot).
          const spoken = (() => { if (!pron) return text; try { const s = pron(text).replace(/\s+/g, " ").trim().slice(0, 700); return s || text; } catch { return text; } })();
          const modelId = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
          const base = (PLAYER.config && PLAYER.config.supabaseUrl) || "";
          // « v2 » = version du format de cache : les extraits v1 (sans alignement timestamps) sont ignorés
          // d'office et tout se régénère AVEC l'horodatage par caractère (karaoké exact). Anciens fichiers = poids mort minime.
          const keyFor = (vid) => crypto.createHash("sha256").update(vid + "|" + modelId + "|v2|" + spoken).digest("hex");
          let hash = keyFor(voiceId);
          let objPath = hash + ".mp3";
          let pub = base + "/storage/v1/object/public/tts-cache/" + objPath;
          let pubAlign = base + "/storage/v1/object/public/tts-cache/" + hash + ".json";
          // Cache hit ? On sert directement l'URL CDN (coût ElevenLabs = 0). align : les anciens extraits
          // n'ont pas de JSON (404) → le client retombe sur la synchro estimée, rien ne casse.
          try { const head = await fetch(pub, { method: "HEAD" }); if (head.ok) return jp(200, { ok: true, url: pub, align: pubAlign, cached: true, spoken: spoken !== text ? spoken : undefined }); } catch { /* miss */ }
          // WITH-TIMESTAMPS : audio + horodatage PAR CARACTÈRE → surlignage karaoké EXACT côté client.
          const synth = (vid) => fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(vid) + "/with-timestamps", {
            method: "POST",
            headers: { "xi-api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
            body: JSON.stringify({ text: spoken, model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }),
          });
          let gen = await synth(voiceId);
          // Voix de la BIBLIOTHÈQUE pas encore dans le compte → ajout automatique puis nouvel essai ;
          // si l'ajout échoue (quota de slots), on REPLIE sur la voix par défaut : jamais de présentation muette.
          if (!gen.ok && voiceOwner && /^[A-Za-z0-9_-]{8,80}$/.test(voiceOwner)) {
            try {
              await fetch("https://api.elevenlabs.io/v1/voices/add/" + encodeURIComponent(voiceOwner) + "/" + encodeURIComponent(voiceId), {
                method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({ new_name: (voiceName || `Voix ${PLAYER.branding.name || "player"}`).slice(0, 80) }),
              });
            } catch { /* repli défaut ci-dessous */ }
            gen = await synth(voiceId);
          }
          if (!gen.ok && voiceId !== defaultVoiceId) {
            voiceId = defaultVoiceId; gen = await synth(voiceId);
            // Le repli se met en cache SOUS SA PROPRE clé (voix par défaut) — souvent déjà présente.
            hash = keyFor(voiceId); objPath = hash + ".mp3";
            pub = base + "/storage/v1/object/public/tts-cache/" + objPath;
            pubAlign = base + "/storage/v1/object/public/tts-cache/" + hash + ".json";
          }
          if (!gen.ok) { try { await PLAYER.errors.capture(new Error("elevenlabs " + gen.status), { where: "bot-tts" }); } catch { /* noop */ } return jp(200, { ok: false }); }
          const data = await gen.json().catch(() => null);
          const buf = data && data.audio_base64 ? Buffer.from(data.audio_base64, "base64") : Buffer.alloc(0);
          if (!buf.length) return jp(200, { ok: false });
          const up = await PLAYER.storage.put("tts-cache", objPath, buf, "audio/mpeg");
          // Surveillance du réservoir ElevenLabs (throttlée 1×/h) — cf. _provider-quotas.js.
          try { await PLAYER.plugins.providerQuotas?.tick("elevenlabs"); } catch { /* jamais bloquant */ }
          if (!up) return jp(200, { ok: false });
          // Alignement compact : instants de DÉBUT par caractère (ms) — mêmes index que le texte envoyé.
          let hasAlign = false;
          try {
            const al = data.alignment || data.normalized_alignment;
            if (al && Array.isArray(al.character_start_times_seconds)) {
              const tms = al.character_start_times_seconds.map((x) => Math.round(Number(x) * 1000));
              hasAlign = await PLAYER.storage.put("tts-cache", hash + ".json", Buffer.from(JSON.stringify({ t: tms })), "application/json");
            }
          } catch { /* sans alignement → synchro estimée côté client */ }
          return jp(200, { ok: true, url: pub, align: hasAlign ? pubAlign : null, spoken: spoken !== text ? spoken : undefined });
        } catch { return jp(500, { ok: false }); }
      }
      if (body.action === "bot-start" || body.action === "bot-say" || body.action === "bot-history" || body.action === "bot-nudge" || body.action === "bot-book" || body.action === "bot-contact" || body.action === "bot-rate" || body.action === "bot-script") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        if (!docbot) return jp(404, { ok: false, error: "disabled" });
        try {
          const ip = adresseAppelant(req) || "anon";
          const allowed = await PLAYER.limits.allow(`docbot:${ip}`, 120, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          const share = await getShareBySlug(String(body.slug || ""));
          if (!share || !share.bot_enabled) return jp(404, { ok: false, error: "bot" });
          const pages = Math.max(0, Math.min(500, Number(body.pages) || 0));
          const mobile = body.mobile === 1 || body.mobile === true; // téléphone → messages courts + autoplay steps
          if (body.action === "bot-rate") { // satisfaction (1-5 étoiles) posée depuis le bloc central du viewer
            const sess = await docbot.getSession(String(body.sessionId || ""));
            if (!sess || sess.share_slug !== share.slug) return jp(400, { ok: false, error: "session" });
            const note = Math.max(1, Math.min(5, Number(body.rating) || 0));
            if (!note) return jp(400, { ok: false, error: "rating" });
            const cmt = String(body.comment || "").trim().slice(0, 500); // mot facultatif (2e temps du bloc)
            await PLAYER.db.request("doc_bot_sessions?id=eq." + encodeURIComponent(String(body.sessionId)), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: cmt ? { rating: note, rating_comment: cmt } : { rating: note } });
            return jp(200, { ok: true });
          }
          if (body.action === "bot-history") return jp(200, { ok: true, messages: await docbot.listMessages(String(body.sessionId || "")) });
          // ⚠️ Même piège : un objet littéral répond à `constructor`. Sans `Object.hasOwn`, une
          // langue « constructor » passait la garde et finissait interpolée dans le prompt du
          // modèle sous la forme « function Object() { [native code] } ».
          const langueDemandee = String(body.lang || "").toLowerCase();
          const blang = Object.hasOwn(docbot.I18N_LANGS, langueDemandee) ? langueDemandee : null; // fr/inconnu → null (langue source)
          if (body.action === "bot-start") return jp(200, { ok: true, ...(await docbot.botStart(share, pages, mobile, String(body.intent || ""), blang)) });
          // Bascule de langue EN COURS de présentation : renvoie le script (traduit ou FR) — le client
          // remplace sa liste d'étapes et rejoue le message courant dans la nouvelle langue.
          if (body.action === "bot-script") {
            const sess = await docbot.getSession(String(body.sessionId || ""));
            if (!sess || sess.share_slug !== share.slug) return jp(400, { ok: false, error: "session" });
            const sp = docbot.applyPron(await docbot.scriptedPayload(share.doc_id, blang, String(body.sessionId)), await docbot.getProfile(share.bot_profile_id));
            if (!sp) return jp(400, { ok: false, error: "script" });
            return jp(200, { ok: true, steps: sp.steps, voiceScript: sp.voice, message: sp.hook, closing: sp.closing, messageSay: sp.hookSay, closingSay: sp.closingSay });
          }
          if (body.action === "bot-nudge") { const rn = await docbot.botNudge(String(body.sessionId || ""), share, pages, mobile); if (rn.error) return jp(400, { ok: false, error: rn.error }); return jp(200, { ok: true, ...rn }); }
          if (body.action === "bot-book") { const rb = await docbot.bookSlot(String(body.sessionId || ""), share, String(body.book || "")); if (rb.error) return jp(400, { ok: false, error: rb.error }); return jp(200, { ok: true, ...rb }); }
          // Formulaire de coordonnées : parcours DÉTERMINISTE (zéro appel IA → réponse immédiate).
          if (body.action === "bot-contact") { const rc = await docbot.contactLead(String(body.sessionId || ""), share, { name: body.name, email: body.email, phone: body.phone }); if (rc.error) return jp(400, { ok: false, error: rc.error }); return jp(200, { ok: true, ...rc }); }
          const text = String(body.text || "").slice(0, 1000).trim();
          if (!text) return jp(400, { ok: false, error: "empty" });
          const r = await docbot.botSay(String(body.sessionId || ""), share, text, pages, mobile, blang);
          if (r.error) return jp(400, { ok: false, error: r.error });
          return jp(200, { ok: true, ...r });
        } catch { return jp(500, { ok: false }); }
      }
      // Assistance (heartbeat) : PUBLIC (l'audience est anonyme). Journalise qui suit / combien de temps / pages vues.
      // Rate-limit généreux par IP (heartbeat ≈ 145/h/participant) : bloque le spam d'assistants factices sans
      // gêner un usage normal ; fail-open, et un 429 ici ne dégrade que les stats (pas la présentation).
      if (body.action === "present-attend") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const ip = adresseAppelant(req) || "anon";
          const allowed = await PLAYER.limits.allow(`patt:${ip}`, 1000, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          // ⚠️ CES DEUX BOOLÉENS ÉTAIENT CEUX DE L'APPELANT. `isMember` sépare la population interne
          // de celle des prospects — c'est la promesse même du produit — et `isPresenter` accorde le
          // titre dans la liste des participants. Les deux venaient du corps de la requête : un
          // prospect pouvait se compter comme collègue, et se donner le titre de présentateur.
          //
          // Ce qui distingue un présentateur d'un participant n'est pas ce qu'il affirme, c'est le
          // `control_token` — `present-chat` le vérifiait déjà pour le badge des messages, cette
          // route ne le faisait pas. Et l'appartenance se prouve par le jeton d'accès de la session :
          // cette route est un `fetch`, elle peut porter un en-tête (contrairement au suivi de
          // lecture, qui part par `sendBeacon` et signe donc dans le corps).
          const pres = await getPresentation(String(body.slug || ""));
          if (!pres) return jp(404, { ok: false });
          const estPresentateur = !!(body.control && require("crypto").createHash("sha256").update(String(body.control)).digest("hex") === pres.control_hash);
          // ⚠️ Une identité prouvée REMPLACE celle qu'on affirme — elle ne s'y ajoute pas. Sinon la
          // vérification ne servirait qu'à décorer une affirmation qu'on croit toujours.
          const profil = await profilDuJeton(req);
          // ⚠️ ET LA CLÉ EN FAIT PARTIE — C'EST MÊME LA SEULE QUI COMPTE. Le correctif ci-dessus a
          // remplacé le nom, l'e-mail et l'avatar par ceux du jeton, et laissé passer `key`, qui est
          // pourtant l'IDENTITÉ DE LA LIGNE. Or pour un membre cette clé EST son e-mail : un
          // participant anonyme n'avait qu'à poster la vôtre pour écraser votre ligne — nom, avatar —
          // et gonfler votre temps de présence. Ce sont les statistiques de présentation, c'est-à-dire
          // ce que ce produit vend.
          //
          // On dérive donc la clé de ce qui est prouvé, et jamais de ce qui est affirmé. Un anonyme,
          // lui, ne peut rien prouver : sa clé reste la sienne, mais enfermée dans un espace de noms
          // dont elle ne peut pas sortir — elle ne pourra jamais ressembler à l'e-mail d'un membre.
          const r = await recordAttendance(String(body.slug || ""), {
            // ⚠️ MINUSCULÉE, ET CE DÉTAIL EST UNE LIGNE DE PRÉSENCE. La clé cliente que 0.1.42 a
            // remplacée l'était (`me.email.toLowerCase()`) ; la clé dérivée ne l'était pas, et la
            // ligne se retrouve par `attendee_key=eq.` — une correspondance EXACTE. Un hôte dont
            // l'identité rend l'adresse telle qu'elle a été saisie aurait donc vu, pour un même
            // membre, une SECONDE ligne apparaître : temps cumulé reparti de zéro, et le collègue
            // affiché deux fois dans la liste des participants.
            //
            // Sans effet là où les adresses sont déjà normalisées — c'est le cas des deux hôtes
            // actuels, et c'est pour ça que rien ne l'aurait signalé. Un contrat ouvert ne se
            // repose pas sur ce que ses deux premiers hôtes font.
            key: profil ? lcMembre(profil.email) : cleAnonyme(body.key),
            name: (profil && profil.name) || body.name,
            email: profil ? profil.email : body.email,
            avatar: (profil && profil.avatar) || body.avatar,
            isMember: !!profil, isPresenter: estPresentateur,
          });
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // Gestion des présentations (membre AUTHENTIFIÉ requis) : liste / reprise / transfert / stats / historique doc.
      if (body.action === "present-list" || body.action === "present-reclaim" || body.action === "present-handover" || body.action === "present-owner-end" || body.action === "present-stats" || body.action === "present-doc-list" || body.action === "present-switch" || body.action === "present-content") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const u = await PLAYER.identity.verifyToken(req.headers.authorization);
          // ⚠️ UNE EXCEPTION, ET UNE SEULE. `present-content` pilote ce que la présentation AFFICHE,
          // exactement comme `present-page` tourne les pages — et `present-page` se contente du
          // `control_token`, sans session. Exiger un JWT ici cassait les présentations démarrées
          // sans session, que `present-start` autorise pourtant : la carte ne suivait pas, en
          // silence. Le jeton de contrôle est vérifié plus bas, contre la ligne de la présentation.
          //
          // ⚠️ Les autres actions de ce groupe restent réservées à une session, et `present-switch`
          // — changer le DOCUMENT montré — au propriétaire : décider ce qu'on montre n'est pas
          // piloter l'affichage.
          const pilotage = body.action === "present-content" && !!body.control;
          if ((!u || !u.email) && !pilotage) return jp(401, { ok: false, error: "auth" });
          const isAdmin = !!u && PLAYER.identity.isAdmin(u);
          let r;
          if (body.action === "present-list") r = { ok: true, presentations: await listActivePresentations(u.email) };
          else if (body.action === "present-reclaim") r = await reclaimPresentation(String(body.slug || ""), u.email);
          else if (body.action === "present-owner-end") r = await endPresentationByOwner(String(body.slug || ""), u.email, isAdmin);
          // ⚠️ DEUX DROITS, PAS UN — ET LEUR NOM EST UN ÉLÉMENT DE CONTRAT.
          //
          // Voir qu'une présentation a eu lieu et voir QUI y était sont deux sensibilités
          // différentes : l'historique rend des slugs, des noms de présentateurs et des compteurs ;
          // les statistiques rendent les NOMS, les ADRESSES et le temps de présence de participants
          // qui sont souvent des prospects. Un hôte peut vouloir ouvrir le premier à toute l'équipe
          // et réserver le second — les fondre en un seul droit lui retirerait ce choix.
          //
          // ⚠️ Les noms suivent la convention existante : `list` / `list.all`, où le suffixe dit
          // « au-delà des miennes ». Ils sont documentés dans docs/HOST-CONTRACT.md, et une garde
          // vérifie que tout nom demandé ici y figure — une action inconnue vaut refus chez un hôte
          // prudent, donc l'introduire en silence casserait son instance sans rien dire.
          //
          // Le droit est demandé PARESSEUSEMENT : un propriétaire n'a pas à payer un aller-retour
          // pour lire ce qui lui appartient déjà.
          else if (body.action === "present-stats") {
            r = await presentationStats(String(body.slug || ""), u.email, isAdmin,
              () => PLAYER.identity.canManageShares(u, "presentations.stats"));
          }
          else if (body.action === "present-doc-list") {
            r = { ok: true, presentations: await listPresentationsForDoc(String(body.docId || ""), u.email, isAdmin,
              () => PLAYER.identity.canManageShares(u, "presentations.list.all")) };
          }
          else if (body.action === "present-switch") {
            if (!isAllowedStorageUrl(String(body.fileUrl || ""))) return jp(400, { ok: false, error: "url" });
            r = await switchPresentationDoc(String(body.slug || ""), u.email, isAdmin, { fileUrl: body.fileUrl, fileName: body.fileName, docTitle: body.docTitle, docId: body.docId });
          }
          else if (body.action === "present-content") r = await setPresentationContent(String(body.slug || ""), (u && u.email) || "", isAdmin, body.content, String(body.control || ""));
          else r = await handoverPresentation(String(body.slug || ""), u.email, body.newOwner);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // Chat de présentation (historisé) : n'importe quel participant (présentateur ou audience) poste un
      // message. Écriture via service role ; anti-spam par IP (60/h). La présentation doit exister.
      if (body.action === "present-chat") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const pres = await getPresentation(String(body.slug || ""));
          if (!pres) return jp(404, { ok: false });
          const ip = adresseAppelant(req) || "anon";
          const allowed = await PLAYER.limits.allow(`pchat:${ip}`, 60, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          // Le badge « présentateur » n'est accordé QUE si le control_token est valide (sinon n'importe quel
          // participant pourrait poster un message usurpant le présentateur). Sert aussi au chat verrouillé.
          const validControl = !!(body.control && require("crypto").createHash("sha256").update(String(body.control)).digest("hex") === pres.control_hash);
          if (pres.chat_locked && !validControl) return jp(423, { ok: false, error: "locked" });
          // `isMember` restait l'affirmation du client, alors que `isPresenter` était vérifié juste
          // au-dessus. Deux poids sur la même ligne : le badge « présentateur » se méritait, celui
          // de collègue se réclamait.
          const profil = await profilDuJeton(req);
          const r = await addMessage(String(body.slug || ""), {
            name: (profil && profil.name) || body.name,
            email: profil ? profil.email : body.email,
            avatar: (profil && profil.avatar) || body.avatar,
            isPresenter: validControl, isMember: !!profil, body: body.body, replyTo: body.replyTo, replyName: body.replyName, replyText: body.replyText, authorToken: body.authorToken, attachment: body.attachment , clientKey: body.clientKey });
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // Pièce jointe : URL d'upload signée (la présentation doit exister ; rate-limit).
      if (body.action === "present-upload-url") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const pres = await getPresentation(String(body.slug || ""));
          if (!pres) return jp(404, { ok: false });
          const ip = adresseAppelant(req) || "anon";
          const allowed = await PLAYER.limits.allow(`pup:${ip}`, 30, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          const r = await createUploadUrl(String(body.slug || ""), body.name, body.type);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // Chat : éditer / supprimer un message, verrouiller le chat.
      if (body.action === "present-msg-edit" || body.action === "present-msg-delete" || body.action === "present-chatlock") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          let r;
          if (body.action === "present-msg-edit") r = await editMessage(String(body.slug || ""), body.msgId, String(body.authorToken || ""), body.body);
          else if (body.action === "present-msg-delete") r = await deleteMessage(String(body.slug || ""), body.msgId, { authorToken: body.authorToken, control: body.control });
          else r = await setChatLock(String(body.slug || ""), String(body.control || ""), !!body.locked);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // Réaction emoji (toggle) sur un message du chat de présentation.
      if (body.action === "present-react") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const ip = adresseAppelant(req) || "anon";
          const allowed = await PLAYER.limits.allow(`preact:${ip}`, 200, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          // ⚠️ LE CINQUIÈME ARGUMENT A MANQUÉ ICI PENDANT TROIS VERSIONS. `toggleReaction` sait
          // poser un état depuis 0.1.56, le client l'envoie depuis 0.1.56 — et cette ligne le
          // jetait. Les essais éprouvaient la FONCTION, jamais la route : le correctif était vu
          // refuser en mutation et inactif en production. Trouvé par le troisième audit.
          // ⚠️ `body.reactor` N'EST PLUS LU. C'est un champ que le client CHOISIT, et les refs des
          // autres participants sont publics (le tableau des réactions les porte) : s'y fier
          // laissait n'importe qui poser ou retirer les réactions d'un autre. L'identité se
          // dérive du jeton d'auteur — le secret qui ne quitte pas le navigateur qui l'a tiré.
          const reacteur = require("./presentations").reacteurDepuisJeton(body.authorToken);
          const r = await toggleReaction(String(body.slug || ""), body.msgId, body.emoji, reacteur, body.etat);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch { return jp(500, { ok: false }); }
      }
      // ── LIENS DE PARTAGE TRACÉS (un par destinataire) ────────────────────────────────────────
      // Ces actions vivaient dans la route de synchronisation du studio, derrière son modèle de
      // droits maison — inappelables par un autre hôte. Elles appartiennent au player : c'est lui
      // qui fabrique les liens, les sert et les trace.
      //
      // ⚠️ QUI a le droit de diffuser un document est en revanche une règle de l'HÔTE, pas du
      // player : elle passe par le contexte (`identity.canManageShares`). Le player se contente de
      // vérifier le jeton. Sans réponse de l'hôte : refus.
      // ── RÉTENTION (docs/RETENTION.md) ────────────────────────────────────────────────────────
      // Déclenchement explicite : hôte de confiance ou admin. Renvoie les comptes DÉCLARÉS —
      // le recensement indépendant (SQL nu) est l'autre moitié du contrat, pas cette route.
      if (body.action === "retention.run") {
        const jd = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const hote = !!(PLAYER.identity.isTrustedHostCall && PLAYER.identity.isTrustedHostCall(req.headers));
          let admin = false;
          if (!hote) { const u = await PLAYER.identity.verifyToken(req.headers.authorization); admin = !!(u && PLAYER.identity.isAdmin(u)); }
          if (!hote && !admin) return jd(403, { ok: false, error: "retention.run : hôte de confiance ou admin requis" });
          return jd(200, await require("./retention").purgerRetention(Date.now()));
        } catch (e) { try { PLAYER.errors.capture(e, { route: "retention" }); } catch { /* jamais bloquant */ } return jd(500, { ok: false }); }
      }
      if (String(body.action || "").startsWith("docshare.")) {
        const jd = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        // Balayage de rétention opportuniste — au plus un par 24 h, jamais bloquant.
        try { require("./retention").tick(); } catch { /* jamais bloquant */ }
        try {
          // ── L'HÔTE PARLE EN SON NOM PROPRE ────────────────────────────────────────────────
          //
          // Un lien ANONYME — la plaquette publique d'un programme, lue par un prospect sans
          // compte — n'a pas de membre derrière lui. Exiger un JWT forcerait l'hôte à inventer
          // une identité qui n'existe pas : un compte de service dont le mot de passe ouvre bien
          // plus que la création d'un lien, ou pire, l'aperçu interne détourné — ce qui rangerait
          // un prospect dans la population INTERNE et ferait mentir la seule phrase qui compte
          // ici : « ce client a lu pendant douze minutes ».
          //
          // C'est la même nature que `/authz` et `/branding`, que l'hôte sert déjà en serveur à
          // serveur. Demandé par le second hôte, qui avait écarté les trois contournements
          // lui-même avant d'écrire.
          //
          // ⚠️ TROIS VERROUS, et chacun ferme une porte différente :
          //   1. `create` UNIQUEMENT — révoquer, lister, lire des statistiques restent des actes
          //      de membre. Un secret de serveur ne doit pas donner à voir qui a lu quoi.
          //   2. AUCUN destinataire — le nominatif a un membre. L'admettre ici rouvrirait par la
          //      bande ce que le JWT protège.
          //   3. IDEMPOTENT par `docId` — sans ça, un redéploiement, une reprise sur erreur ou un
          //      double clic donnent trois liens pour la même plaquette, donc des statistiques
          //      fragmentées en trois, découvertes en les lisant six mois plus tard.
          if (typeof PLAYER.identity.isTrustedHostCall === "function"
              && PLAYER.identity.isTrustedHostCall(req.headers)) {
            if (body.action !== "docshare.create") {
              return jd(403, { ok: false, error: "L'appel serveur à serveur ne crée que des liens sans destinataire." });
            }
            // ⚠️ LE DESTINATAIRE ATTESTÉ : L'HÔTE SE PORTE GARANT, IL N'AFFIRME PAS.
            //
            // Cette route refusait tout destinataire, au motif qu'un lien nommé appartient à un
            // membre. Le second hôte a montré la limite : il IDENTIFIE lui-même son visiteur — code
            // à usage unique, espace projet — et veut ses lectures comptées, attribuées, révocables.
            // Le lien anonyme est exclu (il serait transmissible à qui n'y a pas droit) et le lien
            // nominatif exige un jeton de membre que ce visiteur n'aura jamais.
            //
            // Ce qui change tout est QUI FOURNIT L'ADRESSE. Dans le cas refusé, elle venait d'un
            // formulaire rempli par un inconnu. Ici elle vient de la base de l'hôte, après
            // vérification, et le visiteur ne la saisit jamais. C'est la forme du jeton interne :
            // l'hôte atteste, le player n'a plus à croire l'appelant.
            //
            // ⚠️ ET ELLE NE VA PAS DANS `recipient_email`, PARCE QUE CE CHAMP PORTE DEUX FAITS.
            // « À qui ce lien est destiné » et « qui a le droit d'expédier en son nom au repartage »
            // y vivaient ensemble. Un visiteur attesté doit avoir le premier sans le second — il n'a
            // jamais engagé sa responsabilité chez nous, et `sendReshareEmail` fait du destinataire
            // du parent l'EXPÉDITEUR (`from`, `replyTo`) d'un message vers une adresse choisie par
            // qui détient le lien. Lui donner ce champ ferait de nos serveurs un relais de courrier
            // signé d'un visiteur.
            //
            // En le rangeant ailleurs, `recipient_email` reste vide sur toute la chaîne : la garde
            // d'envoi refuse, et l'héritage du repartage (`created_by: parent.recipient_email || …`)
            // ne transmet rien. Les deux refusent SANS SAVOIR POURQUOI on les protège — la règle est
            // devenue une conséquence de la donnée, pas une consigne à retenir en deux endroits.
            const atteste = String(body.recipientEmail || "").trim().toLowerCase();
            const docId = String(body.docId || "").trim();
            if (!docId || !body.fileUrl) return jd(400, { ok: false, error: "docId/fileUrl requis" });

            const ipH = adresseAppelant(req) || "hote";
            if (!(await PLAYER.limits.allow(`hshare:${ipH}`, 120, 3600))) return jd(429, { ok: false, error: "rate" });

            // ⚠️ SANS LA COLONNE, ON REFUSE — ON N'ÉCRIT PAS AILLEURS. Un hôte qui n'a pas appliqué
            // la migration verrait sinon son visiteur rangé dans `recipient_email` par défaut, donc
            // capable d'expédier en son nom : le repli silencieux ouvrirait exactement la porte que
            // la séparation ferme. On nomme le fichier à appliquer et on s'arrête.
            if (atteste) {
              const pret = await require("./schema").attendue("destinataireAtteste");
              if (!pret) {
                return jd(409, { ok: false, error: "migration", message: "Destinataire attesté indisponible : appliquez supabase/migrations/0001-destinataire-atteste.sql." });
              }
            }

            // ⚠️ LA CLÉ D'IDEMPOTENCE COMPTE MAINTENANT LE DESTINATAIRE ATTESTÉ. « Le lien de l'hôte
            // pour ce document » ne suffit plus : un lien anonyme et un lien attesté ont tous deux
            // ni créateur ni destinataire au sens de `recipient_email`. Sans cette distinction, le
            // premier visiteur attesté récupérerait le lien anonyme du document — et tous les
            // suivants le même, donc des lectures attribuées à la mauvaise personne.
            const filtreAtteste = atteste
              ? `&attested_recipient_email=eq.${encodeURIComponent(atteste)}`
              : "&attested_recipient_email=is.null";
            const dejaLa = await PLAYER.db.request(
              `commercial_doc_shares?doc_id=eq.${encodeURIComponent(docId)}&created_by=is.null&recipient_email=is.null${filtreAtteste}&select=slug&limit=1`,
            );
            const cleHote = cleIdempotence("hote", [docId, atteste || ""]);
            if (Array.isArray(dejaLa) && dejaLa[0]) {
              // Réemploi d'une ligne historique (sans clé) : on lui POSE la clé au passage — les
              // demandes suivantes la trouveront par l'unicité, et les doublons d'avant 0011
              // s'éteignent d'eux-mêmes faute d'être resservis.
              const cleDispo = await require("./schema").attendue("liensUniques");
              // ⚠️ MÊME RATTRAPAGE QUE LE CHEMIN DE CRÉATION (septième audit : le correctif ne
              // s'était pas appliqué à lui-même). Deux doublons d'avant 0011 en concurrence :
              // l'index refuse la seconde pose de clé — on relit le gagnant au lieu de rendre 500.
              try {
                await PLAYER.db.request(`commercial_doc_shares?slug=eq.${encodeURIComponent(dejaLa[0].slug)}`, {
                  method: "PATCH", headers: { Prefer: "return=minimal" },
                  body: { doc_title: body.docTitle || null, file_url: String(body.fileUrl), file_name: body.fileName || null, revoked: false, ...(cleDispo ? { idem_key: cleHote } : {}) },
                });
              } catch (erreur) {
                if (!String((erreur && erreur.message) || "").includes("409")) throw erreur;
                try { PLAYER.errors.capture(new Error("backfill hôte : la clé était déjà posée ailleurs — " + docId), { route: "hostshare", benin: true }); } catch { /* jamais bloquant */ }
                const gagnant = await PLAYER.db.request(`commercial_doc_shares?idem_key=eq.${encodeURIComponent(cleHote)}&select=slug&limit=1`);
                if (!Array.isArray(gagnant) || !gagnant[0]) throw erreur;
                return jd(200, { ok: true, slug: gagnant[0].slug, reused: true });
              }
              return jd(200, { ok: true, slug: dejaLa[0].slug, reused: true });
            }
            // `createdBy` reste NUL : personne ne l'a créé. Le filtre « mes liens » compare
            // `created_by=eq.<email>`, qui exclut les NUL — ce lien n'apparaît donc dans la liste
            // de personne, et reste visible en administration (`list.all`, qui ne filtre pas).
            // ⚠️ LA LECTURE-PUIS-ÉCRITURE NE PROMET RIEN : deux demandes dans la même seconde
            // passaient toutes deux le « déjà là ? » et DEUX liens naissaient — les statistiques du
            // document se fragmentent entre eux. La contrainte (0011) promet ; le 409 qu'elle rend
            // est une CONFIRMATION : l'autre demande a gagné, on relit son lien et on le rend
            // `reused` — même règle que le renvoi d'un message (0005).
            try {
              const neuf = await createShare({
                brandKey: body.brandKey, docId, docTitle: body.docTitle, fileUrl: body.fileUrl,
                fileName: body.fileName, createdBy: null, attestedRecipientEmail: atteste || null,
                bot: body.bot, botScript: body.botScript,
                guided: body.guided, profileId: body.profileId, allowDownload: body.allowDownload,
                videoLayout: body.videoLayout, logo: body.logo, logoDark: body.logoDark,
                idemKey: cleHote,
              });
              return jd(200, { ok: true, slug: neuf.slug, reused: false });
            } catch (erreur) {
              if (!String((erreur && erreur.message) || "").includes("409")) throw erreur;
              try { PLAYER.errors.capture(new Error("lien hôte déjà créé par une demande simultanée : " + docId), { route: "hostshare", benin: true }); } catch { /* jamais bloquant */ }
              const gagnant = await PLAYER.db.request(`commercial_doc_shares?idem_key=eq.${encodeURIComponent(cleHote)}&select=slug&limit=1`);
              if (!Array.isArray(gagnant) || !gagnant[0]) throw erreur;   // 409 d'autre chose : on ne l'invente pas
              return jd(200, { ok: true, slug: gagnant[0].slug, reused: true });
            }
          }

          const u = await PLAYER.identity.verifyToken(req.headers.authorization);
          if (!u || !u.email) return jd(401, { ok: false, error: "auth" });
          // L'action est transmise telle quelle (`create`, `revoke`…) : l'hôte peut séparer
          // l'envoi d'un document — acte commercial ordinaire — de l'administration des liens.
          const acte = String(body.action || "").slice("docshare.".length);
          if (!(await PLAYER.identity.canManageShares(u, acte))) return jd(403, { ok: false, error: "Action non autorisée pour ce rôle." });
        if (body.action === "docshare.setauth") {
          return jd(200, await setShareAuth(String(body.slug || ""), !!body.requireAuth));
        }
        if (body.action === "docshare.overview") {
          return jd(200, { ok: true, byDoc: await docOverview() });
        }
        if (body.action === "docshare.sessions") {
          return jd(200, { ok: true, sessions: await listSessionsForDoc(String(body.docId || "")) });
        }
        if (body.action === "docshare.list") {
          const docId = String(body.docId || "");
          // DEUX portées, et c'est l'hôte qui tranche : « tous les liens » est un acte
          // d'administration, « mes liens » un acte commercial ordinaire. Sans cette distinction,
          // un commercial verrait à qui d'autre le document a été envoyé — les prospects de ses
          // collègues. Un hôte qui ne distingue pas répond oui aux deux et retrouve la liste
          // complète, comme avant.
          const tout = await PLAYER.identity.canManageShares(u, "list.all");
          const [data, internal] = await Promise.all([
            listSharesForDoc(docId, tout ? null : u.email),
            internalStatsForDoc(docId).catch(() => null),
          ]);
          return jd(200, { ok: true, ...data, internal, scope: tout ? "all" : "mine" });
        }
        // « Répétition générale » : UN lien de test par document (réutilisé, re-patché avec le fichier et
        // l'agent ACTUELS à chaque ouverture). Sessions/leads flaggés is_test → exclus stats/notifications.
        if (body.action === "docshare.test") {
          const docId = String(body.docId || "");
          if (!docId || !body.fileUrl) return jd(400, { ok: false, error: "docId/fileUrl requis" });
          const ex = await PLAYER.db.request(`commercial_doc_shares?doc_id=eq.${encodeURIComponent(docId)}&is_test=eq.true&select=slug&limit=1`);
          const cleTest = cleIdempotence("repetition", [docId]);
          if (Array.isArray(ex) && ex[0]) {
            const cleDispo = await require("./schema").attendue("liensUniques");
            // Même rattrapage que ci-dessus : le backfill de la répétition pose la même clé.
            try {
              await PLAYER.db.request(`commercial_doc_shares?slug=eq.${encodeURIComponent(ex[0].slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { doc_title: body.docTitle || null, file_url: String(body.fileUrl), file_name: body.fileName || null, bot_enabled: true, bot_guided: true, bot_profile_id: (body.profileId || "").trim() || null, revoked: false, ...(cleDispo ? { idem_key: cleTest } : {}) } });
            } catch (erreur) {
              if (!String((erreur && erreur.message) || "").includes("409")) throw erreur;
              try { PLAYER.errors.capture(new Error("backfill répétition : la clé était déjà posée ailleurs — " + docId), { route: "docshare-test", benin: true }); } catch { /* jamais bloquant */ }
              const gagnant = await PLAYER.db.request(`commercial_doc_shares?idem_key=eq.${encodeURIComponent(cleTest)}&select=slug&limit=1`);
              if (!Array.isArray(gagnant) || !gagnant[0]) throw erreur;
              return jd(200, { ok: true, slug: gagnant[0].slug, reused: true });
            }
            return jd(200, { ok: true, slug: ex[0].slug });
          }
          // Deux ouvertures simultanées de la répétition : la contrainte tranche, le perdant relit.
          try {
            const t = await createShare({ docId, docTitle: body.docTitle, fileUrl: body.fileUrl, fileName: body.fileName, recipientName: "Répétition (test)", createdBy: u.email, bot: true, guided: true, profileId: body.profileId, isTest: true, idemKey: cleTest });
            return jd(200, { ok: true, slug: t.slug });
          } catch (erreur) {
            if (!String((erreur && erreur.message) || "").includes("409")) throw erreur;
            try { PLAYER.errors.capture(new Error("lien de répétition déjà créé par une demande simultanée : " + docId), { route: "docshare-test", benin: true }); } catch { /* jamais bloquant */ }
            const gagnant = await PLAYER.db.request(`commercial_doc_shares?idem_key=eq.${encodeURIComponent(cleTest)}&select=slug&limit=1`);
            if (!Array.isArray(gagnant) || !gagnant[0]) throw erreur;
            return jd(200, { ok: true, slug: gagnant[0].slug, reused: true });
          }
        }
        if (body.action === "docshare.revoke") {
          await revokeShare(String(body.slug || ""));
          return jd(200, { ok: true });
        }
        const { slug } = await createShare({ brandKey: body.brandKey, docId: body.docId, docTitle: body.docTitle, fileUrl: body.fileUrl, fileName: body.fileName, recipientEmail: body.recipientEmail, recipientName: body.recipientName, createdBy: u.email, bot: body.bot, botScript: body.botScript, guided: body.guided, profileId: body.profileId, allowDownload: body.allowDownload, videoLayout: body.videoLayout, logo: body.logo, logoDark: body.logoDark });
        return jd(200, { ok: true, slug });
        } catch { return jd(500, { ok: false }); }
      }

      // Re-partage (forward depuis la visionneuse) : crée un lien enfant tracé, et envoie l'email via 3D
      // Discovery si demandé (body.send). Anti-spam : contenu templé + RATE LIMIT par IP (8/h).
      if (body.action === "reshare") {
        const mail = String(body.email || "").trim().toLowerCase();
        const j = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        // ⚠️ LA LONGUEUR AVANT LE MOTIF — et ici ce n'est pas de la prudence, c'est mesuré :
        // `.+@.+\..+` reprend à chaque position de départ, coût 49 ms sur 10 000 caractères,
        // 3 900 ms sur 100 000. Une seule requête, sur une route ouverte au lecteur, bloquait la
        // boucle d'événements quatre secondes — l'instance entière, pas seulement l'appelant.
        // Le débit (8/h par IP) ne protégeait rien : il est vérifié APRÈS, deux lignes plus bas.
        // 254 est le maximum d'une adresse (RFC 5321) : au-delà ce n'est pas « long », c'est faux.
        if (mail.length > 254 || !/.+@.+\..+/.test(mail)) return j(400, { ok: false, error: "email" });
        const ip = adresseAppelant(req) || "anon";
        const allowed = await PLAYER.limits.allow(`reshare:${ip}`, 8, 3600);
        if (!allowed) return j(429, { ok: false, error: "rate", message: "Trop de partages, réessayez plus tard." });
        let out = null;
        try { out = await createReshare(body.slug || slug, { email: mail, name: body.name }); } catch { /* parent introuvable */ }
        if (!out) return j(404, { ok: false });
        let sent = false;
        let refusEnvoi = null;
        if (body.send) {
          try {
            const parent = await getShareBySlug(body.slug || slug);
            // ⚠️ ON N'ENVOIE DE COURRIER QUE POUR UN LIEN QUI A UN DESTINATAIRE.
            //
            // Le lecteur d'un lien ANONYME est un visiteur quelconque : lui laisser demander un
            // envoi ferait des serveurs de l'hôte un relais de courrier non sollicité, avec SON
            // domaine dans l'en-tête. Ce qui coûte cher n'est pas le message parti, c'est la
            // réputation d'expéditeur : elle met des semaines à revenir, et pendant ce temps
            // AUCUN de ses emails n'arrive — factures, relances, notifications d'équipe
            // comprises. Une commodité sur une page publique mettrait en jeu tout son courrier
            // transactionnel.
            //
            // Un lien nominatif, lui, a été créé par quelqu'un qui s'est authentifié et qui
            // engage sa responsabilité. `recipient_email` est nul sur exactement les liens sans
            // membre derrière — c'est déjà la clé d'idempotence du chemin serveur à serveur.
            //
            // ⚠️ La garde est ICI, sur le chemin qui agit, et pas chez l'hôte à l'arrivée. Un
            // filtre à l'arrivée dépend d'une liste à jour ; un chemin qui ne sait pas formuler
            // la demande ne la formulera jamais par accident. Même raison que les trois verrous
            // de `docshare.create`. Demandé par le second hôte, qui l'a réclamée CHEZ NOUS alors
            // qu'il aurait pu la poser chez lui.
            if (!parent || !parent.recipient_email) {
              refusEnvoi = "no-recipient";
              throw new Error("envoi réservé aux liens nominatifs");
            }
            // ⚠️ `Host` EST CHOISI PAR LE CLIENT. Le lien inséré dans un email signé par l'hôte
            // était construit avec cet en-tête : sur le serveur autonome, ou derrière un proxy qui
            // ne le réécrit pas strictement, un lecteur pouvait demander un envoi parfaitement
            // légitime dont le bouton pointe vers SON domaine. L'email part de l'hôte, avec sa
            // marque et sa réputation, vers le destinataire choisi par l'attaquant.
            //
            // ⚠️ UNE ALERTE N'EST PAS UNE INTERDICTION.
            //
            // 0.1.21 posait `PLAYER_PUBLIC_URL`, retombait sur `Host` quand elle manquait, et
            // SIGNALAIT le repli. C'était le bon réflexe de compatibilité et la mauvaise
            // conclusion : le journal ne bloque pas un email d'hameçonnage. Une instance mal
            // configurée continuait d'envoyer, signée de sa marque, avec un bouton pointant où le
            // lecteur voulait — et l'exploitant l'apprenait dans un rapport d'abus.
            //
            // ⚠️ CE QU'ON REFUSE, C'EST L'ENVOI — PAS LE LIEN. Le lien enfant est créé, tracé, et
            // rendu à l'appelant : il peut le transmettre lui-même. Ce qui est retenu est la seule
            // chose qu'on ne peut pas rattraper — un courrier parti de nos serveurs, avec notre
            // domaine dans l'en-tête et notre réputation d'expéditeur derrière.
            //
            // La compatibilité invoquée en 0.1.21 ne tenait donc pas : refuser l'envoi ne casse
            // pas la création du lien, qui est la fonction principale de cette route.
            //
            // Signalé par la seconde passe d'audit (P1-1).
            const publique = String(PLAYER.legal.publicUrl || "").trim();
            if (!publique) {
              try { PLAYER.errors.capture(new Error("PLAYER_PUBLIC_URL non configurée : envoi refusé (le lien de l'email serait construit depuis l'en-tête Host, que le client choisit)"), { route: "reshare" }); } catch { /* jamais bloquant */ }
              refusEnvoi = "public-url-unconfigured";
              throw new Error("URL publique non configurée");
            }
            const origin = publique;
            const r = await sendReshareEmail({ parent, childSlug: out.slug, origin, toEmail: mail, toName: body.name });
            sent = !!(r && r.sent);
          } catch { /* best-effort : le lien existe quand même */ }
        }
        // Le refus se DIT : « rien n'est parti » et « l'envoi n'était pas permis » ne se
        // ressemblent pas, et une interface qui les confond propose un bouton qui ne marchera
        // jamais.
        return j(200, { ok: true, slug: out.slug, sent, ...(refusEnvoi ? { sendRefused: refusEnvoi } : {}) });
      }
      const ua0 = req.headers["user-agent"];
      const ip0 = adresseAppelant(req);
      // ⚠️ CONSULTATION INTERNE : L'IDENTITÉ EST AFFIRMÉE PAR LE NAVIGATEUR, PAS PROUVÉE.
      //
      // La population interne est celle que le produit promet de ne jamais mélanger aux prospects.
      // Or cette route acceptait n'importe quel e-mail, n'importe quel document, sans jeton ni
      // limite : on pouvait fabriquer « tel collègue a lu ce document trois heures ».
      //
      // Le suivi part par `sendBeacon`, qui ne sait pas porter d'en-tête — exiger un JWT casserait
      // le seul transport qui survive à la fermeture d'un onglet, c'est-à-dire le moment où la
      // mesure compte le plus. La preuve doit donc voyager dans le CORPS, et venir de l'hôte :
      // lui seul sait qui est son membre.
      //
      // `PLAYER_INTERNAL_STRICT` laisse chaque hôte fermer la porte à son rythme :
      //   • absent  → on accepte, borné et limité, et on le SIGNALE une fois de temps en temps ;
      //   • posé    → sans jeton valide, rien n'est écrit.
      // Une fermeture par défaut casserait les instances en service, dont la nôtre. Une porte
      // qu'on laisse ouverte sans le dire est un défaut ; une porte qu'on laisse ouverte en le
      // disant, avec le verrou fourni, est une transition.
      if (body.internal && body.event === "session") {
        const ipInt = ip0 || "anon";
        // ⚠️ LE QUOTA SE DÉDUIT DE LA CADENCE, IL NE S'ÉCRIT PLUS À LA MAIN.
        //
        // Il valait 120/h alors que le navigateur émet 300/h POUR UN SEUL LECTEUR : la limite ne
        // tenait pas 0,4 lecteur, et refusait tout après 24 minutes de lecture continue. La clé
        // étant l'adresse, une équipe derrière une sortie unique — le cas ordinaire d'une
        // entreprise — se partageait ce que même une personne dépasse.
        //
        // ⚠️ La garde était juste dans sa forme et fausse dans son chiffre : c'est pour ça que
        // personne ne l'a relue. On relit ce qui a l'air douteux, pas ce qui a l'air raisonnable.
        //
        // Détail et arithmétique : src/cadence.ts. Trouvé par le second hôte.
        if (!(await PLAYER.limits.allow(`intsess:${ipInt}`, SESSION_QUOTA_PER_HOUR, 3600))) {
          // ⚠️ UN REFUS MUET EST UNE TABLE VIDE SANS CAUSE NOMMÉE. Le 429 n'apparaît que dans la
          // console du lecteur ; l'exploitant, lui, voyait sa mesure ne pas monter et n'avait rien
          // à quoi le rattacher. C'est la règle des gardes muettes appliquée au quota lui-même —
          // et le signalement passe AVANT le `return`, sans quoi il ne s'exécuterait jamais.
          try {
            if (await PLAYER.limits.allow("intsess:quota-avert", 1, 3600)) {
              PLAYER.errors.capture(new Error(`session interne refusée : quota horaire atteint (${SESSION_QUOTA_PER_HOUR}/h par adresse) — la mesure s'arrête tant qu'il l'est`), { route: "internal-session" });
            }
          } catch { /* un journal ne doit jamais empêcher une lecture */ }
          res.statusCode = 429; res.setHeader("Content-Type", "application/json"); res.end('{"ok":false,"error":"rate"}');
          return;
        }
        const jeton = typeof PLAYER.identity.verifyInternalToken === "function"
          ? PLAYER.identity.verifyInternalToken(String(body.it || ""))
          : null;
        const strict = !!(PLAYER.config && PLAYER.config.internalStrict);
        if (strict && !jeton) {
          res.statusCode = 403; res.setHeader("Content-Type", "application/json"); res.end('{"ok":false,"error":"internal-token"}');
          return;
        }
        if (!strict && !jeton) {
          // Une fois par heure et par instance : assez pour être vu dans les journaux, pas assez
          // pour les noyer — un avertissement répété à chaque battement ne se lit plus.
          if (await PLAYER.limits.allow("intsess:avert", 1, 3600)) {
            try { PLAYER.errors.capture(new Error("session interne écrite sans jeton : l'identité vient du navigateur. Poser PLAYER_INTERNAL_STRICT=1 une fois l'hôte à jour"), { route: "internal-session" }); } catch { /* ignore */ }
          }
        }
        // Le jeton fait foi quand il est là : c'est l'hôte qui se porte garant, pas l'appelant.
        try {
          await upsertInternalSession({
            sessionId: body.sessionId,
            docId: jeton ? jeton.docId : body.docId,
            userEmail: jeton ? jeton.email : body.email,
            userName: jeton ? (jeton.name || body.name) : body.name,
            numPages: body.numPages, maxPage: body.maxPage, totalSeconds: body.totalSeconds, pagesTime: body.pagesTime,
          }, { ip: ip0, ua: ua0 });
        } catch (e) {
          // ⚠️ CE `catch` A COÛTÉ UNE JOURNÉE À UN HÔTE, ET IL ÉTAIT À TROIS LIGNES DU COMMENTAIRE
          // QUI DIT DE NE PAS FAIRE ÇA.
          //
          // La ligne écrite portait `ua` et `ip` ; la table des sessions internes ne les a pas.
          // PostgREST refusait, ce `catch` avalait le refus, et la route répondait `{"ok":true}`.
          // Ni le second hôte ni nous n'avions une seule ligne mesurée — notre table de production
          // en comptait ZÉRO — et rien, nulle part, ne le disait.
          //
          // « best-effort » est une intention juste : une mesure ne doit jamais empêcher de lire un
          // document. Mais best-effort ne veut pas dire MUET. Ce qu'on rattrape ici, c'est le droit
          // de continuer — pas le droit de ne rien dire.
          //
          // ⚠️ La leçon dépasse ce bloc : une règle écrite dans un commentaire ne protège pas le
          // code qui la suit. C'est pourquoi elle est aussi devenue un test —
          // server/__tests__/ecritureMuette.test.js refuse tout `catch` vide autour d'une écriture
          // de mesure.
          try {
            if (await PLAYER.limits.allow("intsess:echec", 1, 3600)) {
              PLAYER.errors.capture(new Error(`écriture de session interne refusée : ${e && e.message ? e.message : "cause inconnue"} — la mesure ne s'enregistre pas`), { route: "internal-session" });
            }
          } catch { /* un journal ne doit jamais empêcher une lecture */ }
        }
        res.statusCode = 200; res.setHeader("Content-Type", "application/json"); res.end('{"ok":true}');
        return;
      }
      const share = await getShareBySlug(body.slug || slug);
      if (share && !share.is_test) { // répétition générale : la lecture de test ne compte pas dans les stats
        try {
          // 'session' = résumé riche (temps par page, appareil) → upsert ; open/page/heartbeat → journal léger (funnel/overview).
          if (body.event === "session") await upsertSession(share, { sessionId: body.sessionId, numPages: body.numPages, maxPage: body.maxPage, totalSeconds: body.totalSeconds, pagesTime: body.pagesTime }, { ip: ip0, ua: ua0 });
          else await logView(share, { event: body.event, page: body.page, maxPage: body.maxPage, seconds: body.seconds, sessionId: body.sessionId, ua: ua0 });
        } catch (e) {
          // ⚠️ LE MÊME `catch` MUET, SUR LE CHEMIN EXTERNE. Trouvé par la garde écrite pour
          // l'interne : une fois la règle devenue un test, elle a désigné son jumeau.
          //
          // Celui-ci n'a rien cassé jusqu'ici — la table des sessions externes a bien les colonnes
          // qu'on lui envoie. Mais il aurait avalé le prochain écart de la même façon, et personne
          // n'aurait rien vu : c'est ce qui rend la classe dangereuse, pas l'instance.
          try {
            if (await PLAYER.limits.allow("sess:echec", 1, 3600)) {
              PLAYER.errors.capture(new Error(`écriture de mesure refusée : ${e && e.message ? e.message : "cause inconnue"} — la lecture n'est pas comptée`), { route: "track" });
            }
          } catch { /* un journal ne doit jamais empêcher une lecture */ }
        }
      }
      res.statusCode = 200; res.setHeader("Content-Type", "application/json"); res.end('{"ok":true}');
      return;
    }

    // AUCUN DOCUMENT DEMANDÉ. Ni slug, ni présentation, ni aperçu, ni carte d'identité — il n'y a
    // rien à afficher, et ce n'est pas un refus. Le dire franchement évite qu'un intégrateur
    // cherche un lien révoqué là où il lui manque un paramètre.
    if (req.method === "GET" && !slug && !q.present && !q.preview && !q.contract && !q.asset) {
      res.statusCode = 400;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Aucun document demandé. Attendu : ?slug=… , ?present=… , ?preview=1, ?contract=1 ou ?asset=….\n" +
              "Si vous intégrez le player, vérifiez que la plateforme fournit les paramètres de requête.");
      return;
    }

    // ── ACTIFS PDF.JS (`?asset=pdf` / `?asset=pdfworker`) ────────────────────────────────────
    // La bibliothèque est EMBARQUÉE (pdfjs-dist, épinglée exacte) et servie depuis notre origine.
    // Ce que ça ferme d'un coup : le tiers CDN dans la CSP, le script sans SRI possible (le worker
    // n'entre pas par une balise), et le ballet d'empreintes qui l'entourait — un actif de même
    // origine EST nos octets. Public et sans base, comme la carte : un actif qui exigerait une
    // session casserait la page avant qu'elle existe. L'URL porte la version → cache immuable.
    if (req.method === "GET" && (String(q.asset || "") === "pdf" || String(q.asset || "") === "pdfworker")) {
      const fichier = q.asset === "pdf" ? "pdfjs-dist/build/pdf.min.mjs" : "pdfjs-dist/build/pdf.worker.min.mjs";
      // Lu UNE fois par processus : la dépendance est épinglée exacte, les octets ne changent
      // qu'avec un déploiement — relire 1,7 Mo sur disque à chaque requête ne prouvait rien.
      if (!global.__actifsPdfjs) global.__actifsPdfjs = Object.create(null);
      let octets = global.__actifsPdfjs[fichier] || null;
      if (!octets) {
        try { octets = global.__actifsPdfjs[fichier] = require("node:fs").readFileSync(require.resolve(fichier)); } catch { /* dépendance absente */ }
      }
      if (!octets) { res.statusCode = 404; res.end("actif indisponible"); return; }
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/javascript; charset=utf-8");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      res.setHeader("Content-Length", String(octets.length));
      res.end(octets);
      return;
    }

    // ── CARTE D'IDENTITÉ (`?contract=1`) ─────────────────────────────────────────────────────
    // La règle 4 du contrat demande à l'hôte d'épingler la version qu'il vise et de le VÉRIFIER.
    // Sans point d'interrogation, cette règle était une intention : un hôte ne pouvait pas écrire
    // le test. Placé en tête à dessein — c'est un outil de diagnostic, il doit répondre même
    // quand le reste ne va pas, et ne demande donc ni session ni base.
    //
    // Ce qu'il contient : de quoi DÉCIDER (le numéro de contrat, les capacités présentes), rien
    // qui aide à attaquer — aucune URL, aucun secret, aucun nom d'hôte. Les greffons sont donnés
    // en booléens parce qu'un hôte doit pouvoir refuser de démarrer si le mur d'accès manque
    // alors qu'il compte dessus.
    if (String(q.contract || "") === "1") {
      // ⚠️ `&schema=1` : la SEULE partie de cette carte qui demande la base, et seulement quand on
      // la réclame. Sans le paramètre, la route garde sa propriété de répondre quand plus rien ne
      // répond ; avec lui, l'appelant choisit d'en avoir besoin. Un échec ici ne fait pas échouer
      // la carte — il devient le verdict « indetermine ».
      res.statusCode = 200;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader("Cache-Control", "no-store, max-age=0");
      const p = PLAYER.plugins || {};
      res.end(JSON.stringify({
        product: "discovery-media-player",
        // ⚠️ LE champ à épingler. Il ne bouge QUE sur une rupture (règle 2) : ajouter une action,
        // un paramètre ou un motif de refus ne le change pas.
        contract: 1,
        version: PLAYER_VERSION,
        // Ce que cette instance sait faire. Un hôte teste la présence, jamais l'ordre.
        // `host-auth` : cette instance sait vérifier les jetons auprès d'un émetteur DISTINCT de
        // sa base (PLAYER_AUTH_URL). Un hôte tiers en a besoin pour savoir si ses membres
        // peuvent seulement s'authentifier — sans ça, sa seule voie était d'essayer et de lire
        // un refus qui ressemble à un droit manquant. Le nom, jamais l'émetteur : la carte reste
        // muette sur les URL.
        capabilities: [
          "docshare", "presentations", "embed-denied", "host-fetch", "brand-reference", "host-auth",
          "host-share", "host-mail",
        ],
        // ⚠️ POUR QUELLES ORIGINES cette instance accepte d'être encadrée. Un booléen ne
        // suffisait pas : un hôte a besoin de voir que SON domaine manque, pas seulement que
        // l'intégration est possible. C'est la seule panne qu'il ne peut pas diagnostiquer
        // autrement — le navigateur bloque avant tout script, et rien ne peut lui être émis.
        // Ce n'est pas un secret : ces mêmes valeurs partent dans chaque en-tête CSP servi.
        frameAncestors: ["'self'", "https://*.vercel.app"].concat(PLAYER.config.extraFrameAncestors || []),
        // Même besoin que `frameAncestors`, l'inverse de la réponse : là on nomme les origines
        // parce qu'un hôte doit voir que LA SIENNE manque ; ici un booléen suffit, parce que
        // l'hôte connaît déjà son émetteur — il veut seulement savoir si l'instance le regarde.
        // Dire lequel n'aiderait personne et renseignerait qui sonde.
        separateIssuer: !!(PLAYER.config && PLAYER.config.separateIssuer),
        // ⚠️ « L'identité interne vient-elle d'un JETON, ou du navigateur ? » En mode transitoire
        // (false), la route interne accepte docId/email/name tels que le client les déclare — un
        // appelant peut fabriquer « tel collègue a consulté tel document ». Le booléen rend l'état
        // MESURABLE : un cockpit peut refuser une instance non stricte, au lieu de le découvrir en
        // lisant un journal. Demandé par le second hôte (cinquième audit, P1-4).
        internalStrict: !!(PLAYER.config && PLAYER.config.internalStrict),
        // ⚠️ L'ÉTAT DU SCHÉMA, LÀ OÙ ON REGARDE. Une colonne absente était signalée par un
        // `console.warn`, une fois par processus : sur une fonction serverless, une ligne perdue
        // dans une sortie que personne n'ouvre tant que tout a l'air de marcher — et « tout a
        // l'air de marcher » est exactement l'état d'un hôte dont trois protections dorment. Cette
        // carte est ce qu'un hôte interroge déjà pour épingler sa version ; c'est donc ici.
        // Elle RAPPORTE ce qui est connu, elle ne sonde pas : un diagnostic ne doit pas tomber en
        // même temps que ce qu'il diagnostique.
        // ⚠️ `couvre` DIT LA PORTÉE, parce que « complet » sans portée surpromet : les migrations de
        // limites (0003/0004) n'y sont PAS — un hôte peut fournir sa propre capacité `limits`, et
        // chez lui leur absence est normale. Ce champ empêche de lire « complet » comme « tout le
        // dossier supabase/ est appliqué ». Relevé par le troisième audit.
        schema: { couvre: "colonnes-conditionnelles",
          ...(String(q.schema || "") === "1"
            ? await require("./schema").sonderTout()
            : require("./schema").etatDuSchema()) },
        // « L'hôte peut-il créer un lien en son nom propre ? » — configuré, pas seulement
        // possible. Un hôte qui oublie le secret reçoit un 401 qui ressemble à un droit
        // manquant ; ce booléen le lui dit sans qu'il ait à essayer.
        hostShare: !!(PLAYER.config && PLAYER.config.hostShare),
        hostMail: !!(PLAYER.config && PLAYER.config.hostMail),
        // Greffons de l'hôte : présents ou coupés (PLAYER_PLUGINS_OFF). Booléens uniquement.
        plugins: {
          bot: !!p.bot, visitors: !!p.visitors, brandIntro: !!p.brandIntro,
          botBrowser: !!p.botBrowser, providerQuotas: !!p.providerQuotas,
        },
      }));
      return;
    }

    // ⚠️ Lu ICI, une seule fois, et AVANT toute branche capable de refuser. Il était calculé plus
    // bas, dans le seul chemin du lien tracé : l'aperçu interne et la page d'audience refusaient
    // donc en silence. Signalé par un hôte dont la visionneuse interne utilise
    // précisément `?preview=1&embed=1` — le premier mode qu'un nouvel hôte exerce, et celui où un
    // refus de configuration ressemble le plus à une instance injoignable.
    const embed = String(q.embed || "") === "1";

    // Mode « Présenter » côté AUDIENCE : `?present=<slug>` → page live (suit le présentateur via Realtime) ;
    // `&file=1` → stream le PDF de la présentation (Range, même origine pour pdf.js).
    if (q.present) {
      // ⚠️ LA GARDE PASSE DEVANT L'INTERROGATION DE BASE, PAS DERRIÈRE.
      //
      // `state=1` et `chat=1` sont servis sans session, sur un lien public, et chaque appel coûte
      // une requête base. Une boucle sur une URL connue faisait donc d'un lien de présentation un
      // amplificateur : une requête HTTP triviale contre une requête base, autant de fois qu'on
      // veut. Douze actions d'écriture étaient limitées ; ces deux LECTURES ne l'étaient pas.
      //
      // ⚠️ Et c'est la ressource PARTAGÉE qui paie : la base est la même pour tous les documents de
      // l'instance. Le coût d'un abus ne retombe pas sur celui qui le commet.
      //
      // Placée AVANT `getPresentation` — écrite après, elle aurait laissé passer très exactement la
      // requête qu'elle est censée épargner. Le quota se déduit de la cadence de l'audience
      // (`src/cadence.ts`), il n'est pas choisi à la main.
      const sondage = String(q.state || "") === "1" || String(q.chat || "") === "1";
      if (sondage) {
        const ipSondage = adresseAppelant(req) || "anon";
        if (!(await PLAYER.limits.allow(`pread:${ipSondage}`, PRESENT_QUOTA_PER_HOUR, 3600))) {
          // ⚠️ UN REFUS MUET FAIT UNE AUDIENCE QUI DÉCROCHE SANS CAUSE NOMMÉE. Le 429 n'apparaît
          // que dans la console du spectateur ; l'exploitant, lui, verrait des pages qui ne tournent
          // plus chez tout un bâtiment. Une fois par heure suffit à nommer la cause sans inonder.
          if (await PLAYER.limits.allow("pread:quota-avert", 1, 3600)) {
            try {
              console.warn(`[player] relectures de présentation refusées : quota horaire par adresse atteint (${PRESENT_QUOTA_PER_HOUR}/h). Une audience nombreuse derrière une sortie unique verra ses pages cesser de tourner.`);
            } catch { /* sans console */ }
          }
          res.statusCode = 429; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ ok: false, error: "rate" }));
          return;
        }
      }
      // Historique du chat (chargé au join par présentateur ET audience).
      // ÉTAT de la présentation, relu par l'audience à la reconnexion ou au retour d'onglet.
      // C'est la porte qui permettra de retirer la lecture anonyme des tables : l'audience n'a
      // plus besoin de lire `doc_presentations` pour connaître la page courante. On ne renvoie
      // QUE ce que l'audience doit savoir — ni propriétaire, ni jeton, ni horodatages internes.
      // ⚠️ LA RÈGLE, PAS LA LISTE — ET C'EST LE SECOND HÔTE QUI A EU RAISON.
      //
      // La première version mettait en cache DEUX ROUTES ÉNUMÉRÉES. Leur remarque : « la troisième
      // route de lecture arrivera sans cache, et ça ne se verra pas ». C'est le motif croisé six
      // fois cette semaine — une liste se périme, une forme non.
      //
      // La règle est donc écrite ici, et le code la fait respecter par construction : TOUTE RÉPONSE
      // IDENTIQUE POUR TOUS LES SPECTATEURS D'UN MÊME SLUG SE CACHE. Ajouter une lecture publique,
      // c'est ajouter une entrée à cette table — elle sera mise en cache sans qu'on y pense, parce
      // qu'il n'existe pas d'autre chemin pour la servir.
      //
      // ⚠️ LA CONDITION D'ADMISSION EST « IDENTIQUE POUR TOUS », PAS « EN LECTURE SEULE ». Une
      // réponse qui dépendrait de l'appelant servirait l'état d'un visiteur à un autre — défaut
      // d'une tout autre gravité que celui qu'on ferme. Elle se revérifie à chaque champ ajouté.
      //
      // Le cache englobe la LECTURE ET la sérialisation : sous rafale, une seule des deux se paie.
      // `file=1` ne figure pas dans cette table, et c'est délibéré : il relaie des octets avec des
      // en-têtes de plage propres à l'appelant — ce n'est pas une charge partagée.
      const LECTURES_PARTAGEES = [
        { param: "state", produire: async (p) => ({ ok: true, state: {
          active: p.active !== false,
          current_page: p.current_page || 1,
          content: p.content || null,
          file_url: p.file_url || null,
          file_name: p.file_name || null,
          doc_title: p.doc_title || null,
          updated_at: p.updated_at || null,
          // ⚠️ CE CHAMP A PORTÉ `presenter_key` PENDANT UNE JOURNÉE, ET C'ÉTAIT DEUX FAUTES.
          //
          // 1. FUITE. `attendeeKey()` renvoie l'ADRESSE E-MAIL quand le participant en a une. La clé
          //    du présentateur était donc son e-mail, servi à tout visiteur anonyme du lien — sur la
          //    route même dont le commentaire ci-dessus promet « rien que ce que l'audience doit
          //    savoir ». Le champ portait un nom technique, et personne (moi compris) n'est allé
          //    voir ce qu'il contenait.
          //
          // 2. CE N'ÉTAIT PAS UNE PREUVE. Le badge comparait cette clé à l'`uid` de la charge de
          //    présence — que le client COMPOSE. Lire la clé publique puis s'annoncer avec elle
          //    suffisait à porter le titre. On avait remplacé « le client déclare son rôle » par
          //    « le client déclare une valeur que le serveur lui a donnée » : plus laborieux à
          //    exploiter, pas plus vrai.
          //
          // ⚠️ Comparer deux valeurs que le client choisit ou connaît n'est pas une preuve. Le nom
          // du présentateur vient de l'hôte, il ne se compare à rien, et il s'affiche à part de la
          // liste des participants — laquelle ne porte plus aucun titre.
          //
          // Signalé par la seconde passe d'audit (P0-4) ; la fuite n'y était pas.
          presenter_name: String(p.presenter_name || "") || null,
        } }) },
        { param: "chat", produire: async (p, slug) => ({ ok: true, messages: await listMessages(slug), locked: !!p.chat_locked }) },
      ];
      for (const lecture of LECTURES_PARTAGEES) {
        if (String(q[lecture.param] || "") !== "1") continue;
        const slugLu = String(q.present);
        const corps = await cacheLecture.lire(`${lecture.param}:${slugLu}`, async () => {
          const p = await getPresentation(slugLu);
          return p ? JSON.stringify(await lecture.produire(p, slugLu)) : null;
        });
        if (!corps) return sendRefusal(res, "ended", embed);
        res.statusCode = 200; res.setHeader("Content-Type", "application/json"); res.setHeader("Cache-Control", "no-store");
        res.end(corps);
        return;
      }
      // ⚠️ LA LIGNE N'EST LUE QU'ICI, ET C'EST CE QUI DONNE SON SENS AU CACHE. Elle était lue
      // PLUS HAUT, avant toutes les branches : les deux chemins mis en cache la relisaient donc
      // quand même — le cache ne retirait rien, et il ajoutait une seconde interrogation. Une
      // mémoire posée derrière une dépense ne l'épargne pas.
      const pres = await getPresentation(String(q.present));
      if (!pres) return sendRefusal(res, "ended", embed);
      if (String(q.file || "") === "1") {
        if (!isAllowedStorageUrl(pres.file_url)) { res.statusCode = 404; res.end("Fichier indisponible"); return; }
        const range = req.headers["range"];
        const r = await PLAYER.storage.fetchFile(pres.file_url, { range });
        await relayerFichier(res, r, null);
        return;
      }
      const supaUrl = (PLAYER.config && PLAYER.config.supabaseUrl) || "";
      const supaKey = (PLAYER.config && PLAYER.config.supabasePublishableKey) || "";
      let alogo = ""; try { alogo = await PLAYER.branding.logo(); } catch { /* sans logo */ }
      const anonce = crypto.randomBytes(16).toString("base64");
      // Même sujet, trouvé en vérifiant le précédent : cette page ne passait AUCUN paramètre,
      // donc `frame-ancestors 'none'` — encadrable par personne, pas même par sa propre origine.
      // `'none'` reste le défaut hors intégration (anti-clickjacking) ; en `?embed=1`, un hôte
      // qui affiche l'audience dans son application doit pouvoir le faire.
      return sendPresentHtml(res, presentHtml(pres, anonce, alogo, supaUrl, supaKey), anonce, supaUrl,
        originOf(alogo), embed ? embedFrameAncestors() : "'none'");
    }

    // Aperçu interne (depuis la bibliothèque) : même visionneuse pdf.js, SANS lien tracé ni suivi.
    // `?preview=1&url=<storage public>&name=&title=` → HTML ; `&stream=1` → stream le fichier (Range).
    if (String(q.preview || "") === "1") {
      const url = String(q.url || "");
      if (!isAllowedStorageUrl(url)) return sendRefusal(res, "url-not-allowed", embed);
      if (String(q.stream || "") === "1") {
        const range = req.headers["range"];
        const r = await PLAYER.storage.fetchFile(url, { range });
        await relayerFichier(res, r, dispositionInline(q.name));
        return;
      }
      const supaUrl = (PLAYER.config && PLAYER.config.supabaseUrl) || "";
      const supaKey = (PLAYER.config && PLAYER.config.supabasePublishableKey) || "";
      const pseudo = { preview: true, embed, slug: "", file_name: String(q.name || "document.pdf"), doc_title: String(q.title || q.name || "Document"), raw_url: url, doc_id: String(q.docId || ""), presenter_name: String(q.by || ""), presenter_avatar: String(q.av || ""), internal_email: String(q.uemail || ""), internal_token: String(q.it || ""), supa_url: supaUrl, supa_key: supaKey, auto_present: String(q.autopresent || "") === "1", resume_slug: String(q.resume || ""), brand_key: String(q.brand || "") || null, stream_url: `/api/doc?preview=1&stream=1&url=${encodeURIComponent(url)}&name=${encodeURIComponent(String(q.name || ""))}` };
      // ⚠️ LA MARQUE MANQUAIT ICI, ET SEULEMENT ICI. Toute la machinerie existe — l'hôte répond à
      // `PLAYER_HOST_BRAND_URL`, `branding.forKey` résout, les liens tracés affichent la bonne
      // marque. Ce chemin-ci ne l'appelait simplement pas, et aucun paramètre ne transportait la
      // clé. Un hôte à plusieurs marques servait donc, sur le domaine d'un client, le loader d'un
      // autre — le visiteur voyant l'enseigne d'une entreprise qu'il ne connaît pas.
      //
      // Signalé par le second hôte, sur une notice ouverte chez son client.
      try {
        const marque = await brands.brandForShare(pseudo);
        if (marque) { pseudo.brand_logo = marque.logo; pseudo.brand_name = marque.name; pseudo.brand_dark = marque.dark; }
      } catch { /* le loader dégrade, il n'empêche pas de lire */ }
      let plogo = ""; try { plogo = await PLAYER.branding.logo(); } catch { /* sans logo */ }
      const pnonce = crypto.randomBytes(16).toString("base64");
      // Aperçu interne : CSP relâchée (supabase-js jsdelivr + Realtime wss) pour la présence + le chat live,
      // framing MÊME ORIGINE (iframe DocViewer). La visionneuse PUBLIQUE /doc/:slug garde sa CSP stricte.
      // ⚠️ `'self'` ÉTAIT ÉCRIT EN DUR ICI, et l'hypothèse était juste jusqu'au jour où elle a
      // cessé de l'être. Chez l'hôte d'origine, l'application et le player sont le MÊME
      // déploiement : même origine, `'self'` suffit, et c'est même le bon réglage. Pour une
      // instance séparée — c'est toute la raison d'être d'une seconde instance — l'aperçu est sur
      // un domaine et l'application sur un autre. Le navigateur bloquait alors l'iframe avant
      // tout script : aucun `embed-denied` ne pouvait partir, et l'hôte voyait un silence.
      //
      // Conséquence absurde relevée par cet hôte : la page de REFUS, corrigée la veille, était
      // encadrable chez lui — pas la page de SUCCÈS. Le chemin d'erreur était plus portable que
      // le chemin nominal.
      return sendPresentHtml(res, viewerHtml(pseudo, pnonce, plogo), pnonce, supaUrl, originesImages(plogo, pseudo),
        embed ? embedFrameAncestors() : "'self'");
    }

    const share = slug ? await getShareBySlug(slug) : null;
    if (!share) return sendRefusal(res, "revoked", embed);

    // Soft wall : un document require_auth n'est servi qu'à un visiteur au jeton valide.
    // Mur d'accès visiteur — greffon. SANS lui, un document « compte requis » ne doit surtout PAS
    // devenir librement lisible : on FERME (404) au lieu de dégrader en accès ouvert. Fail-closed.
    const visitors = PLAYER.plugins.visitors;
    const visitor = visitors ? visitors.currentVisitor(req) : null;
    if (share.require_auth === true && !visitors) return sendRefusal(res, "auth-unavailable", embed);
    const gated = share.require_auth === true && !visitor;

    if (String(q.file || "") === "1") {
      if (gated) { res.statusCode = 401; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify({ ok: false, error: "auth" })); return; }
      // Stream depuis le Storage en RELAYANT les requêtes Range → pdf.js charge progressivement (les 1res
      // pages s'affichent sans télécharger tout le PDF) → affichage bien plus rapide.
      const range = req.headers["range"];
      const r = await PLAYER.storage.fetchFile(share.file_url, { range });
      await relayerFichier(res, r, dispositionInline(share.file_name));
      return;
    }

    // Soft wall : contenu réservé → on sert la page de connexion visiteur (email + code)
    // AVANT de charger le lecteur. À la vérification, le cookie est posé → un reload lève le mur.
    if (gated) {
      let wlogo = ""; try { wlogo = await PLAYER.branding.logo(); } catch { /* sans logo */ }
      const wnonce = crypto.randomBytes(16).toString("base64");
      const gcid = visitors.googleClientId();
      // Intégré : le mur reste affiché (le visiteur peut s'y connecter sur place) mais il DIT à
      // l'hôte que le document est retenu — sinon l'hôte croit à une panne et replie sur son
      // lecteur, qui lui ouvrirait le document que ce mur protège.
      const wall = softWallHtml(share, wnonce, wlogo, gcid)
        + (embed ? `<script nonce="${wnonce}">try{parent.postMessage({type:"3dd-doc-embed-denied",reason:"auth-required"},"*")}catch(e){}</script>` : "");
      return sendSoftWallHtml(res, wall, wnonce, [originOf(wlogo), originOf(share.brand_logo)].filter(Boolean).join(" "), embed ? embedFrameAncestors() : null);
    }

    // Identité du profil d'assistant (nom, avatar, tagline, couleur) → header du chat, bulle flottante,
    // mini-avatars des messages. Best-effort : sans profil, identité par défaut.
    if (share.bot_enabled && docbot) {
      try {
        const bp = await docbot.getProfile(share.bot_profile_id);
        share.bot_name = bp.name; share.bot_avatar = bp.avatar_url; share.bot_tagline = bp.tagline; share.bot_accent = bp.accent_color;
        share.bot_greeting = (bp.behavior && bp.behavior.greeting) || ""; // accueil pré-chargé → affiché INSTANTANÉMENT côté client
        share.bot_greeting_doc = (bp.behavior && bp.behavior.greeting_doc) || ""; // accueil DÉDIÉ à la présentation d'un document (plus court que l'accueil chat)
        share.bot_vphoto = (bp.behavior && bp.behavior.video && bp.behavior.video.photo) || ""; // photo PRÉSENTATEUR (webcam / split mobile) — plan large, environnement réel
        // Les PORTES proposent « En vidéo » seulement si des clips existent réellement (manifeste FR).
        try { const av = PLAYER.plugins.avatarClips; const cl = av && await av.clipsFor(share.doc_id, null, bp); share.bot_vclips = !!(cl && Object.keys(cl.clips || {}).length); } catch { share.bot_vclips = false; }
        share.bot_karaoke = (bp.behavior && bp.behavior.karaoke) || ""; // style des sous-titres voix choisi PAR AGENT
      } catch { /* identité par défaut */ }
    }
    // Marque du loader : celle du client (registre, résolue MAINTENANT donc toujours à jour),
    // sinon le logo recopié dans le lien, sinon celle de l'instance.
    try {
      const marque = await brands.brandForShare(share);
      if (marque) { share.brand_logo = marque.logo; share.brand_name = marque.name; share.brand_dark = marque.dark; }
    } catch { /* le loader dégrade, il n'empêche pas de lire */ }
    let logoUrl = ""; try { logoUrl = await PLAYER.branding.logo(); } catch { /* sans logo */ }
    // Pitch du document (résumé de l'analyse IA) : personnalise l'écran d'accueil — le prospect comprend
    // tout de suite CE QU'EST ce document avant de choisir comment le découvrir.
    let pitch = "";
    if (share.bot_enabled && share.doc_id && docbot) {
      try {
        const fiche = await docbot.getDocFiche(share.doc_id);
        pitch = String((fiche && fiche.brief && fiche.brief.summary) || "").replace(/\s+/g, " ").trim();
        if (pitch.length > 190) { const cut = pitch.slice(0, 190).lastIndexOf(". "); pitch = cut > 90 ? pitch.slice(0, cut + 1) : pitch.slice(0, 187) + "…"; }
      } catch { /* pas de fiche → accueil générique */ }
    }
    // ?embed=1 : la visionneuse est en surimpression dans une page hôte (le plan d'un
    // lot dans une expérience 3D) → sa barre porte la croix de sortie.
    share.embed = embed;
    const nonce = crypto.randomBytes(16).toString("base64");
    // FRAMING. Page publique : 'self' seulement (anti-clickjacking). Mode INTÉGRÉ
    // (?embed=1) : les expériences ne vivent pas toutes derrière le proxy
    // /experience — certaines expériences, les préversions et les liens de diffusion sont servis
    // sur leurs propres domaines Vercel, où 'self' bloquait l'overlay des plans
    // (page blanche constatée le 10/08). On y autorise donc les domaines Vercel
    // (+ extras via DOC_FRAME_ANCESTORS, séparés par des espaces — futurs domaines
    // custom d'XP). La CSP frame-ancestors PRIME sur le X-Frame-Options SAMEORIGIN
    // global du vercel.json (spec : XFO ignoré quand frame-ancestors est présent).
    // ⚠️ EMBARQUEMENT DEMANDÉ SANS HÔTE AUTORISÉ : le seul cas où le player ne peut pas se
    // défendre lui-même. C'est le NAVIGATEUR qui bloque, avant que la page ne soit chargée —
    // donc aucun `embed-denied` ne peut partir, et l'hôte voit un silence indiscernable d'une
    // instance injoignable. Le signaler ici est la seule occasion : c'est le moment exact où l'on
    // sait qu'on est destiné à être encadré. Sans DOC_FRAME_ANCESTORS, personne ne peut AFFICHER,
    // exactement comme sans PLAYER_HOST_AUTHZ_URL personne ne peut DIFFUSER.
    if (share.embed && !(PLAYER.config.extraFrameAncestors || []).length) {
      try {
        PLAYER.errors.capture(
          new Error("?embed=1 demandé mais DOC_FRAME_ANCESTORS est vide : seuls une page de même origine et *.vercel.app peuvent encadrer cette instance"),
          { route: "doc", indice: "le navigateur bloquera l'iframe avant le chargement — aucun embed-denied ne partira" },
        );
      } catch { /* jamais bloquant */ }
    }
    const frameAncestors = share.embed
      ? embedFrameAncestors()
      : "'self'";
    return sendHtml(res, 200, viewerHtml(share, nonce, logoUrl, pitch), `'nonce-${nonce}'`, originesImages(logoUrl, share), frameAncestors);
  } catch (error) {
    try { await PLAYER.errors.capture(error, { route: "doc", method: req.method }); } catch { /* ignore */ }
    res.statusCode = 500; res.end("Erreur");
  }
}

// ⚠️ `TIERS` est exporté pour être CONFRONTÉ, pas pour être utilisé. Le banc navigateur et la
// forge doivent pouvoir demander « quelles dépendances tierces, à quelles empreintes » sans en
// tenir une seconde liste — c'est la seule façon qu'une empreinte périmée finisse par se voir.
// ⚠️ Exporté pour être ÉPROUVÉ, pas pour être appelé : le plafond du relais ne se vérifie qu en
// regardant si le corps a été lu, ce qu aucune route ne peut montrer de l extérieur.
module.exports = { handler, init, TIERS, __relayerFichier: relayerFichier, __jsonPourScript: jsonPourScript };

// redeploy: forcer le build production (Vercel a sauté la prod du merge #463 — wording re-partage).