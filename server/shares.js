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
const low = (s) => String(s || "").trim().toLowerCase();
function newSlug() { return crypto.randomBytes(9).toString("base64url"); } // ~12 chars URL-safe

// Crée un lien de partage (un par destinataire). Dénormalise titre/URL/nom pour résilience (le doc vit dans
// un snapshot). Renvoie le slug.
async function createShare({ docId, docTitle, fileUrl, fileName, recipientEmail, recipientName, createdBy, bot, botScript, guided, profileId, allowDownload, isTest, videoLayout, logo, logoDark, brandKey}) {
  if (!docId || !fileUrl) throw Object.assign(new Error("doc invalide"), { statusCode: 400 });
  const slug = newSlug();
  const row = {
    slug, doc_id: String(docId), doc_title: docTitle || null, file_url: String(fileUrl), file_name: fileName || null,
    recipient_email: low(recipientEmail) || null, recipient_name: (recipientName || "").trim() || null, created_by: low(createdBy) || null,
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
  const bySlug = {};
  for (const v of viewList) {
    const s = (bySlug[v.slug] = bySlug[v.slug] || { opens: 0, maxPage: 0, seconds: 0, sessions: new Set(), lastAt: null });
    if (v.event === "open") s.opens++;
    const mp = Math.max(Number(v.page) || 0, Number(v.max_page) || 0);
    if (mp > s.maxPage) s.maxPage = mp;
    s.seconds = Math.max(s.seconds, Number(v.seconds) || 0);
    if (v.session_id) s.sessions.add(v.session_id);
    s.lastAt = v.at;
  }
  const enriched = shareList.map((sh) => {
    const a = bySlug[sh.slug] || { opens: 0, maxPage: 0, seconds: 0, sessions: new Set(), lastAt: null };
    return { slug: sh.slug, parent_slug: sh.parent_slug || null, recipient_email: sh.recipient_email, recipient_name: sh.recipient_name, created_by: sh.created_by, created_at: sh.created_at, revoked: sh.revoked, opens: a.opens, sessions: a.sessions.size, maxPage: a.maxPage, seconds: a.seconds, lastAt: a.lastAt };
  });
  // Entonnoir de lecture : page max atteinte PAR SESSION → combien de lecteurs ont atteint AU MOINS la page p.
  const sessMax = {};
  for (const v of viewList) {
    const sid = v.session_id || v.slug;
    const mp = Math.max(Number(v.page) || 0, Number(v.max_page) || 0);
    if (mp > 0) sessMax[sid] = Math.max(sessMax[sid] || 0, mp);
  }
  const reached = Object.values(sessMax);
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
  const byDoc = {};
  for (const v of list) {
    const id = v.doc_id || "";
    if (!id) continue;
    const a = (byDoc[id] = byDoc[id] || { opens: 0, readers: new Set(), maxPage: 0, lastAt: null });
    if (v.event === "open") a.opens++;
    if (v.session_id) a.readers.add(v.session_id);
    a.maxPage = Math.max(a.maxPage, Number(v.page) || 0, Number(v.max_page) || 0);
    a.lastAt = v.at;
  }
  const intByDoc = {};
  for (const s of Array.isArray(internal) ? internal : []) {
    const id = s.doc_id || "";
    if (!id) continue;
    const b = (intByDoc[id] = intByDoc[id] || { opens: 0, users: new Set(), lastAt: null });
    b.opens++;
    if (s.user_email) b.users.add(String(s.user_email).toLowerCase());
    b.lastAt = s.last_at;
  }
  const out = {};
  for (const id of new Set([...Object.keys(byDoc), ...Object.keys(intByDoc)])) {
    const a = byDoc[id] || { opens: 0, readers: new Set(), maxPage: 0, lastAt: null };
    const b = intByDoc[id] || { opens: 0, users: new Set(), lastAt: null };
    out[id] = { opens: a.opens, readers: a.readers.size, maxPage: a.maxPage, lastAt: a.lastAt, internalOpens: b.opens, internalReaders: b.users.size, internalLastAt: b.lastAt };
  }
  return out;
}

// Parse minimal d'un User-Agent → appareil / OS / navigateur (sans dépendance).
function parseUa(ua) {
  const s = String(ua || "");
  let device = /Mobile|iPhone|Android.*Mobile/.test(s) ? "Mobile" : /iPad|Tablet/.test(s) ? "Tablette" : "Ordinateur";
  let os = /Windows/.test(s) ? "Windows" : /iPhone|iPad|iOS/.test(s) ? "iOS" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /Android/.test(s) ? "Android" : /Linux/.test(s) ? "Linux" : "—";
  let browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "—";
  return { device, os, browser };
}

// Upsert d'une session de consultation (résumé envoyé périodiquement par la visionneuse). Stocke le temps
// PAR page (cumulatif côté client → on remplace), totaux, appareil. Conserve started_at (insert) via merge.
async function upsertSession(share, p, { ip, ua }) {
  const num = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : null);
  const sessionId = String(p.sessionId || "").slice(0, 64);
  if (!sessionId) return;
  const pagesTime = (p.pagesTime && typeof p.pagesTime === "object") ? p.pagesTime : {};
  const { device, os, browser } = parseUa(ua);
  const row = {
    session_id: sessionId, slug: share.slug, doc_id: share.doc_id, recipient_email: share.recipient_email,
    num_pages: num(p.numPages), max_page: num(p.maxPage), total_seconds: num(p.totalSeconds) || 0, pages_time: pagesTime,
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
  const nameBySlug = {};
  for (const sh of (Array.isArray(shares) ? shares : [])) nameBySlug[sh.slug] = sh.recipient_name || null;
  return (Array.isArray(sessions) ? sessions : []).map((s) => ({ ...s, recipient_name: nameBySlug[s.slug] || null }));
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
  await PLAYER.db.request(`commercial_doc_shares?slug=eq.${enc(String(slug || ""))}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { revoked: true } });
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

async function upsertInternalSession(p, { ip, ua }) {
  const num = (v) => (Number.isFinite(+v) ? Math.trunc(+v) : null);
  const borne = (v, max) => { const n = num(v); return n == null ? null : Math.max(0, Math.min(n, max)); };
  const sessionId = String(p.sessionId || "").slice(0, 64);
  if (!sessionId || !p.docId) return;
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
    ua: String(ua || "").slice(0, 300), ip: String(ip || "").slice(0, 60), device, os, browser, last_at: new Date().toISOString(),
  };
  await PLAYER.db.request("commercial_doc_internal_sessions?on_conflict=session_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: [row] });
}

// Agrégat interne d'un document : nb de consultations (sessions), lecteurs distincts, détail par membre.
async function internalStatsForDoc(docId) {
  const rows = await PLAYER.db.request(`commercial_doc_internal_sessions?doc_id=eq.${enc(String(docId || ""))}&select=user_email,user_name,max_page,total_seconds,last_at&order=last_at.desc&limit=500`);
  const list = Array.isArray(rows) ? rows : [];
  const byUser = {};
  for (const r of list) {
    const k = low(r.user_email) || (r.user_name || "?");
    const u = (byUser[k] = byUser[k] || { email: r.user_email || null, name: r.user_name || null, opens: 0, maxPage: 0, seconds: 0, lastAt: null });
    u.opens++;
    u.maxPage = Math.max(u.maxPage, Number(r.max_page) || 0);
    u.seconds += Number(r.total_seconds) || 0;
    if (!u.lastAt || r.last_at > u.lastAt) u.lastAt = r.last_at;
    if (!u.name && r.user_name) u.name = r.user_name;
  }
  const users = Object.values(byUser).sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
  return { opens: list.length, readers: users.length, lastAt: list[0]?.last_at || null, users };
}

module.exports = { init, createShare, createReshare, sendReshareEmail, getShareBySlug, logView, upsertSession, listSharesForDoc, listSessionsForDoc, revokeShare, setShareAuth, overview, upsertInternalSession, internalStatsForDoc };
