// GED commerciale : liens de partage tracés (un par destinataire) + agrégation des consultations.
// Tables service-role only (cf. migration v12321) → tout passe par le service role ici.
const crypto = require("crypto");
// Tout ce qui vient de l'hôte passe par le contexte injecté — base, email, marque. C'est ce qui
// permettra à ce fichier de partir dans le dépôt du player sans emporter le studio avec lui.
// ⚠️ Le contexte est REÇU, pas construit. Ce module ne doit pas savoir d'où il vient : c'est ce
// qui lui permettra de partir dans le dépôt du player sans emporter le studio avec lui.
let PLAYER = null;
function init(ctx) { PLAYER = ctx; }


const enc = encodeURIComponent;

// ⚠️ LA CLÉ D'IDEMPOTENCE EST UNE EMPREINTE, PAS UNE CONCATÉNATION (sixième audit). La forme
// historique `hote:<docId>|<email>` portait trois défauts : tronquée à 300 caractères à
// l'ÉCRITURE mais relue ENTIÈRE après un 409 — le perdant légitime finissait en 500 faute de
// trouver son gagnant ; deux docId partageant le préfixe se volaient leur lien ; et un `|` dans
// une composante déplaçait la frontière. JSON.stringify fixe les frontières, sha256 fixe la
// longueur (genre + 65 caractères, loin de toute limite). Une seule fonction pour ÉCRIRE et
// RELIRE : les deux exemplaires du fait ne peuvent plus diverger. Les clés ancien format en
// base s'éteignent d'elles-mêmes — le réemploi passe par doc_id et re-pose la clé canonique.
const cleIdempotence = (genre, composants) =>
  genre + ":" + crypto.createHash("sha256").update(JSON.stringify(composants)).digest("hex");
const low = (s) => String(s || "").trim().toLowerCase();
function newSlug() { return crypto.randomBytes(9).toString("base64url"); } // ~12 chars URL-safe

// Crée un lien de partage (un par destinataire). Dénormalise titre/URL/nom pour résilience (le doc vit dans
// un snapshot). Renvoie le slug.
async function createShare({ docId, docTitle, fileUrl, fileName, recipientEmail, recipientName, attestedRecipientEmail, createdBy, bot, botScript, guided, profileId, allowDownload, isTest, videoLayout, logo, logoDark, brandKey, idemKey}) {
  if (!docId || !fileUrl) throw Object.assign(new Error("doc invalide"), { statusCode: 400 });
  const slug = newSlug();
  // ⚠️ LA CLÉ N'EST ÉCRITE QUE LÀ OÙ LA COLONNE EXISTE — PostgREST rejette le POST ENTIER sur une
  // colonne inconnue : chez un hôte non migré, ce n'est pas l'unicité qu'on perdrait, c'est la
  // CRÉATION de liens. Même sonde que la clé des messages (0005).
  const cleDispo = idemKey ? await require("./schema").attendue("liensUniques") : false;
  const row = {
    ...(cleDispo ? { idem_key: String(idemKey) } : {}),
    slug, doc_id: String(docId), doc_title: docTitle || null, file_url: String(fileUrl), file_name: fileName || null,
    recipient_email: low(recipientEmail) || null, recipient_name: (recipientName || "").trim() || null, created_by: low(createdBy) || null,
    // ⚠️ DEUX CHAMPS, DEUX FAITS. `recipient_email` dit qui a le droit d'EXPÉDIER en son nom au
    // repartage — vide quand personne ne l'a. Celui-ci dit seulement à qui le lien est destiné,
    // pour attribuer une lecture et pouvoir la révoquer.
    //
    // Les confondre revenait à donner à un visiteur attesté par un hôte le pouvoir de faire partir
    // un courrier de nos serveurs, signé de son adresse, vers une adresse choisie par quiconque
    // détient le lien. La garde d'envoi et l'héritage du repartage lisent tous deux
    // `recipient_email` : en le laissant vide, ils refusent sans avoir à connaître cette histoire.
    ...(attestedRecipientEmail ? { attested_recipient_email: low(attestedRecipientEmail) } : {}),
    bot_enabled: !!bot, bot_script: (botScript || "").trim() ? String(botScript).slice(0, 2000) : null, bot_guided: guided !== false,
    bot_profile_id: (profileId || "").trim() ? String(profileId).slice(0, 40) : null,
    allow_download: allowDownload !== false, // défaut : autorisé (rétro-compatible)
    video_layout: ["side-r", "side-l", "split-m"].includes(videoLayout) ? videoLayout : null, // présentateur vidéo « en grand »
    is_test: !!isTest, // « répétition générale » : lien de test exclu des stats/notifications
    // Logo de marque (promoteur) du loader — null = logo 3D Discovery global.
    // Référence de marque (registre) : préférée au logo recopié — un logo rectifié se propage
    // alors aux liens DÉJÀ ENVOYÉS. Le logo direct reste accepté (flux des propositions).
    brand_key: (brandKey || "").trim() || null,
    brand_logo: (logo || "").trim() ? String(logo).trim().slice(0, 500) : null,
    brand_dark: !!logoDark, // fond sombre du loader (logo clair/blanc)
  };
  await PLAYER.db.request("commercial_doc_shares", { method: "POST", headers: { Prefer: "return=minimal" }, body: [row] });
  return { slug };
}

// Re-partage depuis la visionneuse publique (forward) : crée un lien ENFANT tracé pour un nouveau
// destinataire, rattaché au lien parent (parent_slug) → chaîne de diffusion. created_by = celui qui forwarde.
async function createReshare(parentSlug, { email, name }) {
  const parent = await getShareBySlug(parentSlug);
  if (!parent) throw Object.assign(new Error("lien introuvable"), { statusCode: 404 });
  const slug = newSlug();

  // ⚠️ ON HÉRITE DE TOUT, ON N'ÉNUMÈRE QUE LES EXCEPTIONS — ET LE SENS DE CETTE INVERSION EST LA
  // CORRECTION ELLE-MÊME.
  //
  // Cette ligne énumérait les colonnes à recopier. Une énumération se périme à chaque colonne
  // ajoutée, en silence, ET DU MAUVAIS CÔTÉ : la nouveauté est oubliée. Les colonnes de cette
  // table sont `not null default`, donc l'oubli ne produisait pas un trou — il produisait une
  // VALEUR PAR DÉFAUT, c'est-à-dire la plus permissive :
  //
  //   • `require_auth` (défaut `false`) — un document derrière le mur d'accès, une fois
  //     re-partagé, s'ouvrait SANS mur. Un destinataire pouvait donc lever la protection en se
  //     transmettant le document à lui-même. C'est le plus grave, et il n'était pas dans le
  //     rapport qui a mené ici.
  //   • `allow_download` (défaut `true`) — le bouton Télécharger revenait sur un document où il
  //     avait été refusé.
  //     ⚠️ À ne pas prendre pour une protection : c'est une PRÉFÉRENCE D'AFFICHAGE. Le lecteur qui
  //     voit le document en a déjà les octets ; masquer le bouton retire une commodité, pas un
  //     accès. Un document qu'on ne veut pas voir sortir ne doit pas être partagé, ou doit l'être
  //     derrière `require_auth` — celui-là, lui, décide de qui obtient les octets.
  //   • `brand_key` — la marque se perdait à l'endroit exact où le document commence à circuler :
  //     le lecteur d'un document VALONEUF transmettait un lien qui s'ouvre sous une autre marque.
  //
  // Aucun de ces trois n'était visible : le lien fonctionne, il est simplement plus permissif que
  // son parent. Signalé par le second hôte, qui a vu la marque — celle qui SE VOIT — et a supposé
  // que le reste suivait. Le reste suivait.
  //
  // Sens de l'inversion : une colonne ajoutée demain sera héritée sans que personne y pense. Si
  // c'est une restriction, elle se propage ; si elle ne doit pas l'être, il faudra l'écrire ici,
  // et ce sera une décision au lieu d'un oubli.
  //
  // `created_at` est retiré : la base le pose. `is_test` est hérité — un lien de répétition dont
  // un enfant compterait dans les vraies statistiques les fausserait.
  const { created_at: _cree, ...herite } = parent;
  const row = {
    ...herite,
    slug,
    recipient_email: low(email) || null,
    recipient_name: (name || "").trim() || null,
    created_by: parent.recipient_email || parent.created_by || null,
    parent_slug: parent.slug,
    revoked: false,
  };
  await PLAYER.db.request("commercial_doc_shares", { method: "POST", headers: { Prefer: "return=minimal" }, body: [row] });
  return { slug, docTitle: parent.doc_title };
}

async function getShareBySlug(slug) {
  const rows = await PLAYER.db.request(`commercial_doc_shares?slug=eq.${enc(String(slug || ""))}&revoked=eq.false&select=*&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// Journalise un événement de consultation (ouverture / page vue / battement). Best-effort.
async function logView(share, { event, page, maxPage, seconds, sessionId, ua }) {
  const num = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : null);
  const row = {
    slug: share.slug, doc_id: share.doc_id, recipient_email: share.recipient_email,
    event: String(event || "open").slice(0, 16), page: num(page), max_page: num(maxPage), seconds: num(seconds),
    session_id: String(sessionId || "").slice(0, 64) || null, ua: String(ua || "").slice(0, 300) || null,
  };
  await PLAYER.db.request("commercial_doc_views", { method: "POST", headers: { Prefer: "return=minimal" }, body: [row] });
}

// Liste des liens d'un document + stats par lien + agrégat global. Agrégation en mémoire (volume modéré).
/**
 * Liens d'un document.
 *
 * `owner` restreint la liste aux liens créés par cette personne. C'est ce qui permet à un hôte de
 * distinguer « lister MES liens » (acte commercial ordinaire) de « lister tous les liens » (acte
 * d'administration) : sans restriction, un commercial verrait à qui d'autre le document a été
 * envoyé — donc les prospects de ses collègues.
 */
async function listSharesForDoc(docId, owner) {
  const id = enc(String(docId || ""));
  const filtreOwner = owner ? `&created_by=eq.${enc(low(owner))}` : "";
  const [shares, views] = await Promise.all([
    PLAYER.db.request(`commercial_doc_shares?doc_id=eq.${id}&is_test=not.is.true${filtreOwner}&select=*&order=created_at.desc`),
    PLAYER.db.selectAll(`commercial_doc_views?doc_id=eq.${id}&select=slug,event,page,max_page,seconds,session_id,at&order=at.asc`),
  ]);
  const shareList = Array.isArray(shares) ? shares : [];
  const viewList = Array.isArray(views) ? views : [];
  // Le slug est engendré par le serveur, donc celui-ci n'était pas atteignable — on le convertit
  // quand même. Un agrégateur qui doit se justifier au cas par cas finit par se tromper de cas :
  // la règle « toute clé venue d'une ligne va dans une Map » se relit sans réfléchir.
  const bySlug = new Map();
  for (const v of viewList) {
    let s = bySlug.get(v.slug);
    if (!s) { s = { opens: 0, maxPage: 0, seconds: 0, sessions: new Set(), lastAt: null }; bySlug.set(v.slug, s); }
    if (v.event === "open") s.opens++;
    const mp = Math.max(Number(v.page) || 0, Number(v.max_page) || 0);
    if (mp > s.maxPage) s.maxPage = mp;
    s.seconds = Math.max(s.seconds, Number(v.seconds) || 0);
    if (v.session_id) s.sessions.add(v.session_id);
    s.lastAt = v.at;
  }
  const enriched = shareList.map((sh) => {
    const a = bySlug.get(sh.slug) || { opens: 0, maxPage: 0, seconds: 0, sessions: new Set(), lastAt: null };
    return { slug: sh.slug, parent_slug: sh.parent_slug || null, recipient_email: sh.recipient_email, recipient_name: sh.recipient_name, created_by: sh.created_by, created_at: sh.created_at, revoked: sh.revoked, opens: a.opens, sessions: a.sessions.size, maxPage: a.maxPage, seconds: a.seconds, lastAt: a.lastAt };
  });
  // Entonnoir de lecture : page max atteinte PAR SESSION → combien de lecteurs ont atteint AU MOINS la page p.
  // ⚠️ UNE `Map`, PAS UN OBJET — la clé vient du dehors. Voir l'explication complète sur `byDoc`.
  const sessMax = new Map();
  for (const v of viewList) {
    const sid = v.session_id || v.slug;
    const mp = Math.max(Number(v.page) || 0, Number(v.max_page) || 0);
    if (mp > 0) sessMax.set(sid, Math.max(sessMax.get(sid) || 0, mp));
  }
  const reached = [...sessMax.values()];
  const maxReached = reached.reduce((m, x) => Math.max(m, x), 0);
  const funnel = [];
  for (let p = 1; p <= maxReached; p++) funnel.push(reached.filter((x) => x >= p).length);

  const total = {
    shares: shareList.length,
    opened: enriched.filter((x) => x.opens > 0).length,
    opens: enriched.reduce((s, x) => s + x.opens, 0),
    maxPage: enriched.reduce((m, x) => Math.max(m, x.maxPage), 0),
    readers: reached.length, // sessions distinctes ayant tourné au moins une page
  };
  return { shares: enriched, total, funnel };
}

// Vue d'ensemble (tous documents) : stats agrégées par doc_id, pour les badges de la grille + le « top ».
// Sépare bien les OUVERTURES CLIENT (liens tracés = commercial_doc_views) des CONSULTATIONS INTERNES
// (équipe 3D Discovery = commercial_doc_internal_sessions) → la liste peut afficher « vu par l'équipe »
// vs « ouvert par le client » sans mélanger la métrique commerciale.
async function overview() {
  // Borne glissante généreuse (24 mois) : ces tables d'événements grossissent sans fin ; sans filtre, le
  // scan intégral se dégrade avec le temps. 24 mois couvre tout l'historique utile pour la vue d'ensemble
  // (opens / lecteurs / dernière activité) sans changer les chiffres actuels. Filtre servi par l'index sur `at`.
  const since = new Date(Date.now() - 24 * 30 * 24 * 60 * 60 * 1000).toISOString();
  const [views, internal] = await Promise.all([
    // PAGINÉ : au-delà de 1 000 lignes, PostgREST tronquait en silence — et comme le tri
    // est ascendant, c'est le RÉCENT qui disparaissait. Les consultations des trois dernières
    // semaines étaient invisibles du tableau de bord (0 ouverture affichée sur des plans lus).
    PLAYER.db.selectAll(`commercial_doc_views?select=doc_id,event,session_id,page,max_page,at&at=gte.${since}&order=at.asc`),
    PLAYER.db.selectAll(`commercial_doc_internal_sessions?select=doc_id,user_email,last_at&last_at=gte.${since}&order=last_at.asc`).catch(() => []),
  ]);
  const list = Array.isArray(views) ? views : [];
  // ⚠️ POURQUOI DES `Map` DANS TOUT CE FICHIER, ET PAS DES OBJETS.
  //
  // Ces agrégateurs étaient des `{}` indexés par des identifiants, des e-mails, des sessions —
  // tous venus du dehors. Une clé héritée y a une sémantique spéciale, et `X[k] = X[k] || {…}`
  // suffit à tout casser :
  //
  //   `byDoc["__proto__"]` ne rend pas `undefined`, il rend `Object.prototype` — qui est VRAI.
  //   Le `|| {…}` ne se déclenche donc pas, et `a` DEVIENT le prototype. Ensuite `a.opens++`
  //   écrit `Object.prototype.opens = NaN`, et `a.readers.add(…)` lève sur `undefined`.
  //
  // ⚠️ Reproduit avec une seule ligne : `TypeError` immédiate, ET la propriété reste sur le
  // prototype POUR TOUT LE PROCESSUS. Sur une instance serverless tiède, la pollution survit aux
  // requêtes suivantes : chaque objet du processus porte alors un `opens`, et n'importe quel
  // `if (x.opens)` ailleurs devient faux. Une ligne de table pour empoisonner un processus.
  //
  // `user_email` est atteignable sans authentification tant que `PLAYER_INTERNAL_STRICT` n'est pas
  // posé (cf. 0.1.22), donc ce n'est pas théorique.
  //
  // Une `Map` n'a pas de prototype à traverser : ses clés sont des données, pas des noms de
  // propriétés. C'est la seule forme qui n'a rien à se rappeler. La garde statique, elle, filtrait
  // sur des NOMS DE VARIABLES (`id`, `k`, `sid` en étaient absents) — une alarme, jamais une
  // barrière. (audit P1-2)
  const byDoc = new Map();
  for (const v of list) {
    const id = v.doc_id || "";
    if (!id) continue;
    let a = byDoc.get(id);
    if (!a) { a = { opens: 0, readers: new Set(), maxPage: 0, lastAt: null }; byDoc.set(id, a); }
    if (v.event === "open") a.opens++;
    if (v.session_id) a.readers.add(v.session_id);
    a.maxPage = Math.max(a.maxPage, Number(v.page) || 0, Number(v.max_page) || 0);
    a.lastAt = v.at;
  }
  const intByDoc = new Map();
  for (const s of Array.isArray(internal) ? internal : []) {
    const id = s.doc_id || "";
    if (!id) continue;
    let b = intByDoc.get(id);
    if (!b) { b = { opens: 0, users: new Set(), lastAt: null }; intByDoc.set(id, b); }
    b.opens++;
    if (s.user_email) b.users.add(String(s.user_email).toLowerCase());
    b.lastAt = s.last_at;
  }
  // La sortie est rendue en JSON : un objet SANS prototype, pour qu'une clé héritée y reste une
  // clé ordinaire jusqu'au bout de la chaîne.
  const out = Object.create(null);
  for (const id of new Set([...byDoc.keys(), ...intByDoc.keys()])) {
    const a = byDoc.get(id) || { opens: 0, readers: new Set(), maxPage: 0, lastAt: null };
    const b = intByDoc.get(id) || { opens: 0, users: new Set(), lastAt: null };
    out[id] = { opens: a.opens, readers: a.readers.size, maxPage: a.maxPage, lastAt: a.lastAt, internalOpens: b.opens, internalReaders: b.users.size, internalLastAt: b.lastAt };
  }
  return out;
}

// Parse minimal d'un User-Agent → appareil / OS / navigateur (sans dépendance).
function parseUa(ua) {
  // ⚠️ Bornée AVANT analyse. L'analyse statique signale `Android.*Mobile` comme pouvant revenir en
  // arrière ; mesuré avant de corriger, V8 traite ce motif en temps linéaire même sur 200 000
  // caractères — ce n'était donc pas une lenteur réelle. On borne quand même : la colonne stockée
  // était déjà tronquée à 300, seule l'analyse recevait la chaîne entière. Faire entrer une
  // longueur non bornée dans une expression régulière est une habitude qui finit par coûter.
  const s = String(ua || "").slice(0, 300);
  let device = /Mobile|iPhone|Android.*Mobile/.test(s) ? "Mobile" : /iPad|Tablet/.test(s) ? "Tablette" : "Ordinateur";
  let os = /Windows/.test(s) ? "Windows" : /iPhone|iPad|iOS/.test(s) ? "iOS" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /Android/.test(s) ? "Android" : /Linux/.test(s) ? "Linux" : "—";
  let browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "—";
  return { device, os, browser };
}

// Upsert d'une session de consultation (résumé envoyé périodiquement par la visionneuse). Stocke le temps
// PAR page (cumulatif côté client → on remplace), totaux, appareil. Conserve started_at (insert) via merge.
async function upsertSession(share, p, { ip, ua }) {
  const sessionId = String(p.sessionId || "").slice(0, 64);
  if (!sessionId) return;
  const { device, os, browser } = parseUa(ua);
  const row = {
    session_id: sessionId, slug: share.slug, doc_id: share.doc_id, recipient_email: share.recipient_email,
    // Bornées comme la session INTERNE : plafond d'entrées, clés/valeurs numériques, totaux capés.
    num_pages: bornerNombre(p.numPages, BORNES.pages), max_page: bornerNombre(p.maxPage, BORNES.pages),
    total_seconds: bornerNombre(p.totalSeconds, BORNES.secondes) || 0, pages_time: bornerPagesTime(p.pagesTime),
    ua: String(ua || "").slice(0, 300), ip: String(ip || "").slice(0, 60), device, os, browser, last_at: new Date().toISOString(),
  };
  // started_at non touché par l'upsert (default à l'insert ; merge ne l'écrase pas car absent du body).
  await PLAYER.db.request("commercial_doc_sessions?on_conflict=session_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: [row] });
}

// Sessions de consultation d'un document (détail riche par session) + nom du destinataire (jointure share).
async function listSessionsForDoc(docId) {
  const id = enc(String(docId || ""));
  const [sessions, shares] = await Promise.all([
    PLAYER.db.request(`commercial_doc_sessions?doc_id=eq.${id}&select=*&order=last_at.desc&limit=500`),
    PLAYER.db.request(`commercial_doc_shares?doc_id=eq.${id}&is_test=not.is.true&select=slug,recipient_email,recipient_name`),
  ]);
  const nameBySlug = new Map();
  for (const sh of (Array.isArray(shares) ? shares : [])) nameBySlug.set(sh.slug, sh.recipient_name || null);
  return (Array.isArray(sessions) ? sessions : []).map((s) => ({ ...s, recipient_name: nameBySlug.get(s.slug) || null }));
}

// Envoi AUTO du re-partage via 3D Discovery (Resend). Contenu 100% templé (pas de texte libre → anti-spam),
// attribué au recommandeur (destinataire du lien parent), reply-to vers lui. Best-effort.
async function sendReshareEmail({ parent, childSlug, origin, toEmail, toName }) {
  const e = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const url = `${origin.replace(/\/$/, "")}/doc/${childSlug}`;
  const forwarder = parent.recipient_name || parent.recipient_email || "Un contact 3D Discovery";
  const title = parent.doc_title || parent.file_name || "Document";
  let logoUrl = ""; try { logoUrl = await PLAYER.branding.logo(); } catch { /* sans logo */ }
  const hello = toName && toName.trim() ? `Bonjour ${e(toName.trim())},` : "Bonjour,";
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1c1c1c">
    ${logoUrl ? `<div style="text-align:center;padding:8px 0 18px"><img src="${e(logoUrl)}" alt="3D Discovery" style="height:34px"></div>` : `<div style="text-align:center;font-weight:800;font-size:18px;padding:8px 0 18px">3D Discovery</div>`}
    <p style="font-size:15px">${hello}</p>
    <p style="font-size:15px"><b>${e(forwarder)}</b> vous recommande ce document&nbsp;:</p>
    <div style="border:1px solid #e7e3db;border-radius:12px;padding:16px 18px;margin:14px 0">
      <div style="font-weight:700;font-size:16px;margin-bottom:12px">${e(title)}</div>
      <a href="${e(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px">Ouvrir le document</a>
    </div>
    <p style="font-size:13px;color:#777">Vous pouvez répondre directement à cet email pour échanger avec ${e(forwarder)}.</p>
    <p style="font-size:11px;color:#999;margin-top:22px">Propulsé par 3D Discovery — visualisation 3D &amp; visites immersives.</p>
  </div>`;
  // ⚠️ LES CHAMPS STRUCTURÉS ACCOMPAGNENT LE HTML, ILS NE LE REMPLACENT PAS.
  //
  // Un hôte qui envoie avec sa propre identité voudra composer avec son gabarit — et surtout
  // n'y laisser entrer AUCUN texte fourni par l'appelant. Notre HTML, lui, insère `toName` : un
  // champ libre, échappé mais choisi par qui détient le lien, dans un message signé par l'hôte.
  // Lui donner les éléments séparés, c'est lui permettre de n'en reprendre aucun.
  //
  // Le HTML reste là pour un hôte qui ne veut pas composer : rien ne casse pour l'existant.
  return PLAYER.mail.send({
    to: toEmail,
    subject: `${forwarder} vous recommande : ${title}`,
    html,
    replyTo: parent.recipient_email || undefined,
    kind: "reshare",
    doc: { title, url },
    from: { name: parent.recipient_name || null, email: parent.recipient_email || null },
    // Fourni par l'appelant, donc à traiter comme tel : un hôte prudent l'ignore.
    untrusted: { toName: (toName || "").trim() || null },
  });
}

async function revokeShare(slug) {
  // La date borne la rétention (RETENTION.md) — écrite seulement là où la colonne existe (0013).
  const dateDispo = await require("./schema").attendue("revocationDatee");
  await PLAYER.db.request(`commercial_doc_shares?slug=eq.${enc(String(slug || ""))}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { revoked: true, ...(dateDispo ? { revoked_at: new Date().toISOString() } : {}) } });
}

// Soft wall : (dé)verrouille l'accès d'un lien /doc — require_auth=true → connexion visiteur exigée.
async function setShareAuth(slug, requireAuth) {
  await PLAYER.db.request(`commercial_doc_shares?slug=eq.${enc(String(slug || ""))}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { require_auth: !!requireAuth } });
  return { ok: true };
}

// — Consultations INTERNES (équipe), table dédiée → n'affecte PAS les stats prospects. —
// Upsert d'une session interne (depuis l'aperçu interne de la visionneuse).
// ⚠️ CES CHAMPS VIENNENT DU NAVIGATEUR, DONC ILS SONT DES AFFIRMATIONS, PAS DES MESURES.
//
// La population INTERNE est celle dont le produit dit qu'elle ne doit jamais être mélangée aux
// prospects : « ce client a lu douze minutes » ne vaut que si un collègue relisant le document
// n'entre pas dans le même compte. Or n'importe qui pouvait écrire une session interne avec
// n'importe quel e-mail et n'importe quelle durée.
//
// Les bornes ci-dessous ne rendent pas la donnée authentique — elles empêchent qu'elle soit
// ABSURDE, et qu'un appel répété fasse grossir la base sans limite. L'authenticité, elle, demande
// que l'hôte se porte garant de l'identité (jeton signé) : c'est le second volet, et il est
// signalé au point d'entrée plutôt qu'ici.
const BORNES = { pages: 10_000, secondes: 24 * 3600, entreesPagesTime: 2_000 };
// ⚠️ BORNER CE QUI VIENT DU DEHORS — les DEUX chemins de session (interne ET externe). Un objet
// libre sans plafond laisse un seul appel écrire un JSON de la taille qu'il veut (P1 performance).
const bornerNombre = (v, max) => { const n = Number.isFinite(+v) ? Math.trunc(+v) : null; return n == null ? null : Math.max(0, Math.min(n, max)); };
function bornerPagesTime(brut) {
  const src = (brut && typeof brut === "object" && !Array.isArray(brut)) ? brut : {};
  const out = {};
  let n = 0;
  for (const k in src) {
    if (++n > BORNES.entreesPagesTime) break;
    const page = Number.isFinite(+k) ? Math.trunc(+k) : null;
    if (page == null || page < 0 || page > BORNES.pages) continue;
    out[String(page)] = bornerNombre(src[k], BORNES.secondes) || 0;
  }
  return out;
}

// ⚠️ `ip` N'EST PLUS LU, ET LA SIGNATURE LE DIT. L'appelant continue de le passer — il ne sait pas
// ce que chaque table conserve, et ce n'est pas à lui de le savoir. Mais le garder en paramètre
// nommé laisserait croire qu'il sert : c'est comme ça qu'une donnée revient dans une ligne où elle
// n'a rien à faire. Une lecture interne, c'est un collègue ; on ne conserve pas son adresse.
async function upsertInternalSession(p, { ip: _ip, ua }) {
  const num = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : null);
  const borne = (v, max) => { const n = num(v); return n == null ? null : Math.max(0, Math.min(n, max)); };
  const sessionId = String(p.sessionId || "").slice(0, 64);
  // ⚠️ UN REJET MUET A COÛTÉ DES SEMAINES À UN HÔTE.
  //
  // Cette garde est juste — une session sans document ne mesure rien — mais elle ne DISAIT rien.
  // Le second hôte a monté son suivi interne, l'a cru en service, et a découvert bien plus tard que
  // la table était vide : son `docId` ne partait pas, et chaque battement était jeté ici en silence.
  //
  // ⚠️ Ce n'est pas la garde qui était en cause, c'est son mutisme. Une mesure qui ne remonte rien
  // est indistinguable d'une mesure qui n'a rien à remonter : personne ne va chercher une panne
  // qu'aucun signal n'annonce. La même leçon que le trou de session interne signalé une fois par
  // heure en 0.1.22 — un état anormal qu'on ne dit pas devient l'état normal.
  //
  // Une fois par heure suffit : le but est qu'un exploitant qui ouvre ses journaux tombe dessus,
  // pas de compter les rejets. Demandé par le second hôte, à qui ça aurait fait gagner des semaines.
  if (!sessionId || !p.docId) {
    try {
      if (await PLAYER.limits.allow("intsess:jetee", 1, 3600)) {
        const manque = !sessionId ? "sessionId" : "docId";
        PLAYER.errors.capture(new Error(`session interne jetée : ${manque} absent — rien ne sera mesuré tant qu'il manque`), { route: "internal-session" });
      }
    } catch { /* un journal ne doit jamais empêcher une lecture */ }
    return;
  }
  const { device, os, browser } = parseUa(ua);
  const row = {
    session_id: sessionId, doc_id: String(p.docId).slice(0, 200), user_email: low(p.userEmail).slice(0, 160) || null,
    user_name: (p.userName || "").trim().slice(0, 120) || null,
    num_pages: borne(p.numPages, BORNES.pages), max_page: borne(p.maxPage, BORNES.pages),
    total_seconds: borne(p.totalSeconds, BORNES.secondes) || 0,
    // ⚠️ Un objet libre venu du dehors : sans plafond, un seul appel peut écrire un JSON de la
    // taille qu'il veut, autant de fois qu'il veut. On garde la forme, bornée.
    pages_time: (() => {
      const src = (p.pagesTime && typeof p.pagesTime === "object" && !Array.isArray(p.pagesTime)) ? p.pagesTime : {};
      const out = {};
      let n = 0;
      for (const k in src) {
        if (++n > BORNES.entreesPagesTime) break;
        const page = num(k);
        if (page == null || page < 0 || page > BORNES.pages) continue;
        out[String(page)] = borne(src[k], BORNES.secondes) || 0;
      }
      return out;
    })(),
    // ⚠️ NI `ua` NI `ip` ICI, ET C'EST LE CORRECTIF — PAS UNE COLONNE À AJOUTER.
    //
    // Ces deux champs partaient vers une table qui ne les a pas. PostgREST refusait l'insertion
    // (« column "ua" ... does not exist »), le `catch` de l'appelant avalait le refus, et la route
    // répondait `{"ok":true}`. Le suivi interne n'a donc JAMAIS rien écrit — ni chez le second
    // hôte, ni chez nous : notre table de production comptait zéro ligne.
    //
    // ⚠️ Le schéma avait raison, c'est le code qui mentait. Une lecture INTERNE, c'est un collègue :
    // `device`, `os` et `browser` — dérivés — suffisent, et on ne conserve pas l'agent complet ni
    // l'adresse de ses propres équipes. La table des sessions EXTERNES les porte, elle, parce que
    // ce n'est ni la même population ni la même promesse.
    //
    // Corriger en AJOUTANT les colonnes aurait fait l'inverse : mettre le schéma au niveau du code
    // au lieu du code au niveau de l'intention. Ce qu'on garde sur ses propres équipes ne se décide
    // pas par un message d'erreur PostgREST.
    //
    // Trouvé par le second hôte, vérifié en rejouant l'insertion.
    device, os, browser, last_at: new Date().toISOString(),
  };
  await PLAYER.db.request("commercial_doc_internal_sessions?on_conflict=session_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: [row] });
}

// Agrégat interne d'un document : nb de consultations (sessions), lecteurs distincts, détail par membre.
async function internalStatsForDoc(docId) {
  const rows = await PLAYER.db.request(`commercial_doc_internal_sessions?doc_id=eq.${enc(String(docId || ""))}&select=user_email,user_name,max_page,total_seconds,last_at&order=last_at.desc&limit=500`);
  const list = Array.isArray(rows) ? rows : [];
  // ⚠️ La clé est un e-mail que l'appelant choisit — c'est le cas atteignable sans authentification.
  const byUser = new Map();
  for (const r of list) {
    const k = low(r.user_email) || (r.user_name || "?");
    let u = byUser.get(k);
    if (!u) { u = { email: r.user_email || null, name: r.user_name || null, opens: 0, maxPage: 0, seconds: 0, lastAt: null }; byUser.set(k, u); }
    u.opens++;
    u.maxPage = Math.max(u.maxPage, Number(r.max_page) || 0);
    u.seconds += Number(r.total_seconds) || 0;
    if (!u.lastAt || r.last_at > u.lastAt) u.lastAt = r.last_at;
    if (!u.name && r.user_name) u.name = r.user_name;
  }
  const users = [...byUser.values()].sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
  return { opens: list.length, readers: users.length, lastAt: list[0]?.last_at || null, users };
}

module.exports = {
  cleIdempotence, init, createShare, createReshare, sendReshareEmail, getShareBySlug, logView, upsertSession, listSharesForDoc, listSessionsForDoc, revokeShare, setShareAuth, overview, upsertInternalSession, internalStatsForDoc };
