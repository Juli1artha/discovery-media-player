// Page publique de consultation d'un document commercial : /doc/:slug → visionneuse pdf.js qui TRACE
// l'ouverture et les PAGES VUES (un lien par destinataire → on sait qui a lu, combien de pages).
//  - GET  /doc/:slug            → HTML visionneuse (pdf.js EMBARQUÉ, servi par ?asset=…, nonce CSP)
//  - GET  /doc/:slug?file=1     → stream le PDF depuis le Storage (MÊME ORIGINE → pas de souci CORS pour pdf.js)
//  - POST /api/doc {slug,event…}→ journalise un événement (open / page / heartbeat) — best-effort
const crypto = require("crypto");
const { Readable } = require("node:stream");
const { pipeline } = require("node:stream/promises");
const { getShareBySlug } = require("./shares");
const { PRESENT_QUOTA_PER_HOUR, PRESENT_CACHE_MS } = require("./shared.generated.js");
const { creerCache } = require("./cache.js");

// ⚠️ UN SEUL CACHE POUR TOUT LE PROCESSUS, ET C'EST LE POINT. Le créer par requête reviendrait à
// n'en avoir aucun : chaque appelant repartirait d'une table vide, et l'effondrement qu'on
// cherche — N spectateurs, une lecture — n'aurait jamais lieu. C'est aussi pourquoi il vit ici,
// au chargement du module, et non dans `init()` : un hôte qui réinitialise son contexte ne doit
// pas vider ce qui protège sa base.
const cacheLecture = creerCache({ ttlMs: PRESENT_CACHE_MS });
const { getPresentation, listMessages } = require("./presentations");
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
  for (const m of ["appelant","routes-visiteur","routes-direct","routes-agent","routes-liens"]) require("./" + m).init(ctx);
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

// Identité de l'appelant (adresse, membre prouvé) : extraite dans server/appelant.js.
const { adresseAppelant } = require("./appelant");

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
      // ── Familles d'actions POST : extraites dans server/routes-*.js. Chaque module traite
      // les siennes et répond ; on teste la réponse, pas une liste d'actions (jamais deux
      // exemplaires de la même liste). L'ordre reproduit celui des blocs d'origine.
      // ⚠️ routes-liens porte le REPLI POST ({"ok":true} pour toute action inconnue) : il répond
      // toujours, et doit rester la DERNIÈRE famille de cette liste.
      for (const famille of ["routes-visiteur", "routes-direct", "routes-agent", "routes-liens"]) {
        if ((await require("./" + famille).traiter(req, res, body, slug)) !== false) return;
      }

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
          "host-share", "host-mail", "retention",
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
        // ⚠️ LE BALAYAGE DE RÉTENTION EST-IL ARMÉ ? La capacité `retention` dit que l'instance PEUT
        // purger ; ce booléen dit si le balayage automatique TOURNE (`config.retention.balayage`).
        // Sans lui, une instance armée est indiscernable d'une instance éteinte — et une purge qui
        // supprime se compose mal avec l'ignorance de savoir si l'on est concerné (signalé par le
        // second hôte). Défaut false, comme la décision par défaut : rien ne s'efface tout seul.
        retentionSweep: !!(PLAYER.config && PLAYER.config.retention && PLAYER.config.retention.balayage === true),
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