// Mode « Présenter » : sessions de présentation live (page synchronisée). Table doc_presentations
// (cf. migration v12324) — écriture service role only. Le présentateur détient un control_token ; on en
// stocke le HASH (sha256) → l'audience peut lire la ligne (Realtime) sans pouvoir piloter.
const crypto = require("crypto");
// Base de données via le contexte injecté (cf. _player-context.js) — aucune adhérence au studio.
// ⚠️ Le contexte est REÇU, pas construit. Ce module ne doit pas savoir d'où il vient : c'est ce
// qui lui permettra de partir dans le dépôt du player sans emporter le studio avec lui.
let PLAYER = null;
function init(ctx) { PLAYER = ctx; }


const enc = encodeURIComponent;
const sha = (s) => crypto.createHash("sha256").update(String(s || "")).digest("hex");
const newToken = (n) => crypto.randomBytes(n).toString("base64url");
// Comparaison CONSTANTE-TEMPS des hashes de jeton (pas de fuite d'information par timing).
const sameHash = (a, b) => {
  const ba = Buffer.from(String(a || ""), "utf8"); const bb = Buffer.from(String(b || ""), "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};
// Le jeton fourni correspond-il au hash stocké ?
const tokenMatches = (token, storedHash) => !!(token && storedHash && sameHash(sha(token), storedHash));

// Crée une session → renvoie { slug (public, dans le lien), control (secret présentateur) }.
// owner = { id, email, name, avatar } (membre authentifié). La CLÉ de propriété est l'EMAIL (issu du JWT
// vérifié) → permet reprise / liste / transfert, y compris vers un membre choisi par email.
const lc = (s) => String(s || "").trim().toLowerCase();
async function createPresentation({ docId, fileUrl, fileName, docTitle, presenterName, owner }) {
  if (!fileUrl) throw Object.assign(new Error("doc invalide"), { statusCode: 400 });
  const slug = newToken(9);     // ~12 chars URL-safe
  const control = newToken(18); // secret pilotage
  const o = owner && typeof owner === "object" ? owner : {};
  const row = {
    slug, control_hash: sha(control), doc_id: docId ? String(docId) : null, file_url: String(fileUrl),
    file_name: fileName || null, doc_title: docTitle || null, presenter_name: (presenterName || "").trim() || null,
    owner_user_id: o.id ? String(o.id) : null, owner_email: lc(o.email) || null, owner_name: (o.name || "").slice(0, 120) || null, owner_avatar: (o.avatar || "").slice(0, 600) || null,
    current_page: 1, active: true, last_seen: new Date().toISOString(),
  };
  await PLAYER.db.request("doc_presentations", { method: "POST", headers: { Prefer: "return=minimal" }, body: [row] });
  return { slug, control };
}

// Reprise : le propriétaire (membre authentifié, email issu du JWT) re-génère un control_token frais →
// il reprend la main depuis n'importe quel onglet/navigateur/appareil ; l'ancien control est invalidé.
async function reclaimPresentation(slug, email) {
  if (!slug || !lc(email)) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!row.owner_email || row.owner_email !== lc(email)) return { ok: false, status: 403 };
  const control = newToken(18);
  await PLAYER.db.request(`doc_presentations?slug=eq.${enc(slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { control_hash: sha(control), active: true, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() } });
  return { ok: true, slug, control, page: row.current_page || 1, fileUrl: row.file_url, fileName: row.file_name, docTitle: row.doc_title, docId: row.doc_id };
}

// Heartbeat présentateur (control requis) : rafraîchit last_seen → distingue une présentation vivante d'une orpheline.
async function touchPresentation(slug, control) {
  if (!slug) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!tokenMatches(control, row.control_hash)) return { ok: false, status: 403 };
  await PLAYER.db.request(`doc_presentations?slug=eq.${enc(slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { last_seen: new Date().toISOString() } });
  return { ok: true };
}

// Liste des présentations en cours (membre authentifié). Auto-purge : une présentation active dont le
// dernier heartbeat remonte à > STALE_MS (présentateur parti sans clôturer) est marquée inactive.
const STALE_MS = 3 * 60 * 1000;
async function listActivePresentations(email) {
  const me = lc(email);
  const rows = await PLAYER.db.request("doc_presentations?active=eq.true&select=slug,doc_id,file_url,file_name,doc_title,presenter_name,owner_email,owner_name,owner_avatar,current_page,last_seen,created_at,updated_at&order=updated_at.desc&limit=100");
  const list = Array.isArray(rows) ? rows : [];
  const now = Date.now();
  const stale = list.filter((r) => now - new Date(r.last_seen || r.updated_at || 0).getTime() > STALE_MS).map((r) => r.slug);
  if (stale.length) {
    await PLAYER.db.request(`doc_presentations?slug=in.(${stale.map((s) => enc(s)).join(",")})`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { active: false, updated_at: new Date().toISOString() } }).catch(() => {});
  }
  const live = list.filter((r) => !stale.includes(r.slug));
  return live.map((r) => ({ slug: r.slug, docId: r.doc_id, fileUrl: r.file_url, fileName: r.file_name, docTitle: r.doc_title, presenterName: r.presenter_name, ownerName: r.owner_name, ownerAvatar: r.owner_avatar, currentPage: r.current_page || 1, mine: !!(me && r.owner_email && r.owner_email === me), updatedAt: r.updated_at }));
}

// Clôture sans control_token → utilisée par le panneau « Présentations en direct » pour terminer à distance
// une présentation dont on a perdu l'onglet. Autorisée au PROPRIÉTAIRE (email du JWT) OU à un ADMIN (modération).
async function endPresentationByOwner(slug, email, isAdmin) {
  if (!slug || (!lc(email) && !isAdmin)) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!isAdmin && (!row.owner_email || row.owner_email !== lc(email))) return { ok: false, status: 403 };
  await PLAYER.db.request(`doc_presentations?slug=eq.${enc(slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { active: false, updated_at: new Date().toISOString() } });
  return { ok: true };
}

// Transfert de contrôle : le propriétaire actuel (JWT) désigne un nouveau membre propriétaire (par email).
// Le nouvel owner reprendra la main via reclaimPresentation (control frais) → l'ancien control reste valide
// jusque-là (l'ancien présentateur cesse volontairement de piloter).
async function handoverPresentation(slug, currentEmail, newOwner) {
  const o = newOwner && typeof newOwner === "object" ? newOwner : {};
  if (!slug || !lc(currentEmail) || !lc(o.email)) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!row.owner_email || row.owner_email !== lc(currentEmail)) return { ok: false, status: 403 };
  await PLAYER.db.request(`doc_presentations?slug=eq.${enc(slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { owner_user_id: o.id ? String(o.id) : null, owner_email: lc(o.email), owner_name: (o.name || "").slice(0, 120) || null, owner_avatar: (o.avatar || "").slice(0, 600) || null, updated_at: new Date().toISOString() } });
  return { ok: true, slug };
}

async function getPresentation(slug) {
  const rows = await PLAYER.db.request(`doc_presentations?slug=eq.${enc(String(slug || ""))}&select=*&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// Pilotage : change la page courante (présentateur uniquement, via control_token).
async function setPage(slug, control, page) {
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!tokenMatches(control, row.control_hash)) return { ok: false, status: 403 };
  const p = Math.max(1, Math.trunc(Number(page) || 1));
  await PLAYER.db.request(`doc_presentations?slug=eq.${enc(slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { current_page: p, active: true, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() } });
  return { ok: true };
}

// Fin de présentation → l'audience voit « terminée ».
async function endPresentation(slug, control) {
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!tokenMatches(control, row.control_hash)) return { ok: false, status: 403 };
  await PLAYER.db.request(`doc_presentations?slug=eq.${enc(slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { active: false, updated_at: new Date().toISOString() } });
  return { ok: true };
}

// Chat de présentation (historisé) : ajout d'un message (+ réponse citée) + liste de l'historique.
// Pièce jointe : URL d'upload SIGNÉE (service role) → le client PUT directement dans le bucket. Type/taille
// validés par le bucket (image/*+pdf, ≤10 Mo). L'URL publique finale est renvoyée pour attacher au message.
const ATT_KINDS = { "image/png": "image", "image/jpeg": "image", "image/webp": "image", "image/gif": "image", "application/pdf": "pdf" };
async function createUploadUrl(slug, name, type) {

  // ⚠️ `Object.hasOwn` et pas une simple lecture : un objet littéral hérite de `constructor`,
  // `toString`, `valueOf`, `__proto__`… `ATT_KINDS["constructor"]` rend une FONCTION, donc une
  // valeur vraie — la garde juste en dessous laissait alors passer un type qui n'a jamais été
  // autorisé, et signait une URL d'envoi pour lui. Le type est fourni par l'appelant, sur une
  // action publique. Signalé par un hôte tiers qui venait de trouver la même forme chez lui.
  const demande = String(type || "").toLowerCase();
  const kind = Object.hasOwn(ATT_KINDS, demande) ? ATT_KINDS[demande] : null;
  if (!kind || !slug) return { ok: false, status: 400 };
  const safe = (String(name || "fichier").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60)) || "fichier";
  const path = `${String(slug).replace(/[^a-zA-Z0-9._-]/g, "")}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safe}`;

  // ⚠️ La signature appartient à l'HÔTE : c'est lui qui détient la clé, pas le cœur. Un hôte qui
  // ne fournit pas cette capacité voit la pièce jointe refusée — et prévenue. Le refus silencieux
  // serait pire : une pièce jointe qui ne part jamais, sans que personne sache que la capacité
  // manque.
  if (!PLAYER.storage || typeof PLAYER.storage.signUpload !== "function") {
    try { PLAYER.errors.capture(new Error("storage.signUpload absent du contexte : les pièces jointes de chat sont indisponibles"), {}); } catch { /* jamais bloquant */ }
    return { ok: false, status: 501 };
  }
  const signe = await PLAYER.storage.signUpload("present-attachments", path);
  if (!signe || !signe.token) return { ok: false, status: 502 };
  return { ok: true, path, token: signe.token, kind, publicUrl: signe.publicUrl };
}

/**
 * Les champs d'un message qui ont le droit de sortir du serveur.
 *
 * ⚠️ LISTE BLANCHE, jamais une liste noire. `author_hash` est l'empreinte du jeton qui autorise
 * à éditer et supprimer ce message : le diffuser à toute l'audience donnerait à chacun le droit
 * de réécrire les messages des autres. Une ligne de table renvoyée telle quelle emporterait ce
 * champ sans que personne ne le remarque — d'où la projection explicite, ici et nulle part
 * ailleurs. C'est le même jeu de champs que celui servi à l'historique.
 */
const CHAMPS_PUBLICS = [
  "id", "author_name", "author_email", "author_avatar", "is_presenter", "is_member",
  "body", "attachment", "reactions", "reply_to", "reply_name", "reply_text",
  "deleted", "edited", "created_at",
];
function messagePublic(row) {
  if (!row || typeof row !== "object") return null;
  const out = {};
  for (const c of CHAMPS_PUBLICS) if (c in row) out[c] = row[c];
  return out;
}

/** Renvoie la ligne telle qu'elle est après écriture — sans jamais renvoyer plus que le public. */
function premierPublic(reponse) {
  const row = Array.isArray(reponse) ? reponse[0] : reponse;
  return messagePublic(row);
}

async function addMessage(slug, { name, email, avatar, isPresenter, isMember, body, replyTo, replyName, replyText, authorToken, attachment }) {
  const b = String(body || "").trim().slice(0, 2000);
  // ⚠️ Pas de normalisation ici : `config.supabaseUrl` arrive SANS barre finale, c'est le
  // contrat de l'adaptateur. En rajouter une deuxième couche, c'est deux endroits qui décident —
  // et c'est comme ça que `.replace(/\/+$/, "")` s'est retrouvé à cinq exemplaires dans ce dépôt.
  const base = String((PLAYER.config && PLAYER.config.supabaseUrl) || "");
  let att = null;
  if (attachment && typeof attachment === "object" && attachment.url && String(attachment.url).startsWith(base + "/storage/v1/object/public/present-attachments/")) {
    att = { url: String(attachment.url).slice(0, 600), name: String(attachment.name || "").slice(0, 120), type: String(attachment.type || "").slice(0, 60), kind: attachment.kind === "pdf" ? "pdf" : "image" };
  }
  if ((!b && !att) || !slug) return { ok: false, status: 400 };
  const rt = Number.isFinite(+replyTo) ? Math.trunc(+replyTo) : null;
  const row = {
    slug: String(slug), author_name: (name || "").trim().slice(0, 80) || null,
    author_email: (email || "").trim().toLowerCase().slice(0, 160) || null,
    author_avatar: (avatar || "").slice(0, 600) || null,
    is_presenter: !!isPresenter, is_member: !!isMember, body: b, attachment: att,
    author_hash: authorToken ? sha(authorToken) : null,
    reply_to: rt, reply_name: rt ? ((replyName || "").slice(0, 80) || null) : null, reply_text: rt ? ((replyText || "").slice(0, 140) || null) : null,
  };
  // `return=representation` : c'est la ligne écrite qui part ensuite en diffusion vers l'audience.
  // Sans elle, l'émetteur devrait deviner l'`id` et la date attribués par la base.
  const cree = await PLAYER.db.request("doc_presentation_messages?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: [row] });
  return { ok: true, message: premierPublic(cree) };
}

async function listMessages(slug) {
  const rows = await PLAYER.db.request(`doc_presentation_messages?slug=eq.${enc(String(slug || ""))}&select=id,author_name,author_email,author_avatar,is_presenter,is_member,body,attachment,reactions,reply_to,reply_name,reply_text,deleted,edited,created_at&order=created_at.asc&limit=300`);
  return Array.isArray(rows) ? rows : [];
}

// Éditer son message (jeton d'auteur requis). Ne touche pas aux messages supprimés.
async function editMessage(slug, msgId, authorToken, body) {
  const id = Math.trunc(+msgId); const b = String(body || "").trim().slice(0, 2000);
  if (!id || !b || !authorToken) return { ok: false, status: 400 };
  const rows = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&slug=eq.${enc(String(slug || ""))}&select=author_hash,deleted&limit=1`);
  const m = Array.isArray(rows) && rows[0]; if (!m || m.deleted) return { ok: false, status: 404 };
  if (!m.author_hash || m.author_hash !== sha(authorToken)) return { ok: false, status: 403 };
  const maj = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { body: b, edited: true } });
  return { ok: true, message: premierPublic(maj) };
}

// Supprimer (soft) : l'auteur (jeton) OU le présentateur (control_token de la présentation).
async function deleteMessage(slug, msgId, { authorToken, control }) {
  const id = Math.trunc(+msgId);
  if (!id) return { ok: false, status: 400 };
  const rows = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&slug=eq.${enc(String(slug || ""))}&select=author_hash&limit=1`);
  const m = Array.isArray(rows) && rows[0]; if (!m) return { ok: false, status: 404 };
  const byAuthor = tokenMatches(authorToken, m.author_hash);
  let byPresenter = false;
  if (!byAuthor && control) { const pres = await getPresentation(slug); byPresenter = !!(pres && tokenMatches(control, pres.control_hash)); }
  if (!byAuthor && !byPresenter) return { ok: false, status: 403 };
  const maj = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { deleted: true, body: "", reactions: {}, attachment: null } });
  return { ok: true, message: premierPublic(maj) };
}

// Verrouiller / déverrouiller le chat (présentateur uniquement).
async function setChatLock(slug, control, locked) {
  const pres = await getPresentation(slug);
  if (!pres) return { ok: false, status: 404 };
  if (!tokenMatches(control, pres.control_hash)) return { ok: false, status: 403 };
  await PLAYER.db.request(`doc_presentations?slug=eq.${enc(String(slug || ""))}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { chat_locked: !!locked } });
  return { ok: true };
}

// Réaction emoji (toggle) : le participant (identifié par email ou nom) ajoute/retire un emoji sur un message.
async function toggleReaction(slug, msgId, emoji, reactor) {
  const id = Math.trunc(+msgId); const e = String(emoji || "").slice(0, 8); const who = String(reactor || "").slice(0, 160).toLowerCase();
  if (!id || !e || !who) return { ok: false, status: 400 };
  const rows = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&slug=eq.${enc(String(slug || ""))}&select=reactions&limit=1`);
  const cur = (Array.isArray(rows) && rows[0] && rows[0].reactions && typeof rows[0].reactions === "object") ? rows[0].reactions : {};
  const arr = Array.isArray(cur[e]) ? cur[e] : [];
  const i = arr.indexOf(who);
  if (i >= 0) arr.splice(i, 1); else arr.push(who);
  if (arr.length) cur[e] = arr; else delete cur[e];
  const maj = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { reactions: cur } });
  return { ok: true, message: premierPublic(maj) };
}

// ── Statistiques de présentation (assistance) ────────────────────────────────────────────────────────────
// Heartbeat d'un participant : upsert de sa ligne d'assistance. On accumule le temps de présence (intervalles
// < 60 s → un aller-retour ne gonfle pas total_ms) et l'ensemble des pages vues (page courante de la présentation).
const ATTEND_MAX_GAP_MS = 60 * 1000;
async function recordAttendance(slug, { key, name, email, avatar, isMember, isPresenter }) {
  if (!slug || !key) return { ok: false, status: 400 };
  const pres = await getPresentation(slug);
  if (!pres) return { ok: false, status: 404 };
  const page = Math.max(1, Math.trunc(Number(pres.current_page) || 1));
  const now = Date.now();
  const rows = await PLAYER.db.request(`doc_presentation_attendees?slug=eq.${enc(slug)}&attendee_key=eq.${enc(String(key))}&select=*&limit=1`);
  const cur = Array.isArray(rows) && rows[0];
  if (!cur) {
    const row = { slug: String(slug), attendee_key: String(key).slice(0, 200), name: (name || "").slice(0, 120) || null, email: lc(email) || null, avatar: (avatar || "").slice(0, 600) || null, is_member: !!isMember, is_presenter: !!isPresenter, first_seen: new Date(now).toISOString(), last_seen: new Date(now).toISOString(), total_ms: 0, pages: [page] };
    await PLAYER.db.request("doc_presentation_attendees", { method: "POST", headers: { Prefer: "return=minimal" }, body: [row] });
    return { ok: true };
  }
  const gap = now - new Date(cur.last_seen || now).getTime();
  const addMs = gap > 0 && gap <= ATTEND_MAX_GAP_MS ? gap : 0;
  const pages = Array.isArray(cur.pages) ? cur.pages.slice() : [];
  if (!pages.includes(page)) pages.push(page);
  await PLAYER.db.request(`doc_presentation_attendees?slug=eq.${enc(slug)}&attendee_key=eq.${enc(String(key))}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { last_seen: new Date(now).toISOString(), total_ms: Number(cur.total_ms || 0) + addMs, pages, name: (name || cur.name || "").slice(0, 120) || null, avatar: (avatar || cur.avatar || "").slice(0, 600) || null } });
  return { ok: true };
}

// Détail d'une présentation : entête + participants + nombre de messages par participant.
async function presentationStats(slug) {
  if (!slug) return { ok: false, status: 400 };
  const pres = await getPresentation(slug);
  if (!pres) return { ok: false, status: 404 };
  const [attRows, msgRows] = await Promise.all([
    PLAYER.db.request(`doc_presentation_attendees?slug=eq.${enc(slug)}&select=*&order=first_seen.asc&limit=500`),
    PLAYER.db.request(`doc_presentation_messages?slug=eq.${enc(slug)}&deleted=eq.false&select=author_email,author_name&limit=1000`),
  ]);
  const msgs = Array.isArray(msgRows) ? msgRows : [];
  const msgByKey = {};
  msgs.forEach((m) => { const k = lc(m.author_email) || ("name:" + (m.author_name || "")); msgByKey[k] = (msgByKey[k] || 0) + 1; });
  const attendees = (Array.isArray(attRows) ? attRows : []).map((a) => {
    const k = lc(a.email) || ("name:" + (a.name || ""));
    const pages = Array.isArray(a.pages) ? a.pages : [];
    return { name: a.name, email: a.email, avatar: a.avatar, isMember: !!a.is_member, isPresenter: !!a.is_presenter, firstSeen: a.first_seen, lastSeen: a.last_seen, totalMs: Number(a.total_ms || 0), pages, pagesCount: pages.length, msgCount: msgByKey[k] || 0 };
  });
  const viewers = attendees.filter((a) => !a.isPresenter);
  const start = new Date(pres.created_at || 0).getTime();
  const lastActivity = Math.max(new Date(pres.updated_at || 0).getTime(), ...attendees.map((a) => new Date(a.lastSeen || 0).getTime()), start);
  return {
    ok: true,
    presentation: { slug: pres.slug, docId: pres.doc_id, docTitle: pres.doc_title, fileName: pres.file_name, presenterName: pres.presenter_name, ownerName: pres.owner_name, currentPage: pres.current_page || 1, active: !!pres.active, createdAt: pres.created_at, endedAt: pres.active ? null : pres.updated_at, durationMs: Math.max(0, lastActivity - start) },
    summary: { total: viewers.length, members: viewers.filter((a) => a.isMember).length, externals: viewers.filter((a) => !a.isMember).length, messages: msgs.length, pagesReached: Math.max(1, pres.current_page || 1) },
    attendees,
  };
}

// Changer le document présenté SANS interrompre la session (même slug → chat/présence/participants conservés).
// Autorisé au propriétaire (email du JWT) OU à un admin. L'URL est validée en amont (isAllowedStorageUrl, doc.js).
async function switchPresentationDoc(slug, email, isAdmin, { fileUrl, fileName, docTitle, docId }) {
  if (!slug || !fileUrl) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!isAdmin && (!row.owner_email || row.owner_email !== lc(email))) return { ok: false, status: 403 };
  await PLAYER.db.request(`doc_presentations?slug=eq.${enc(slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: {
    file_url: String(fileUrl), file_name: fileName || null, doc_title: docTitle || null, doc_id: docId ? String(docId) : null,
    content: null, current_page: 1, active: true, last_seen: new Date().toISOString(), updated_at: new Date().toISOString(),
  } });
  return { ok: true };
}

// Contenu courant de la présentation : bascule PDF ↔ carte live (Leaflet). Réservé propriétaire/admin.
// content = { kind:'map', center:[lat,lng], zoom, marker:[lat,lng]|null, label } ; kind 'pdf'/null → le document.
// Contrat de contenu partagé avec le navigateur — UN seul exemplaire, testé sous player/src/.
// Il traverse trois frontières (présentateur → serveur → audience) : deux implémentations
// finissaient par diverger, et une audience qui ne voit pas la bonne carte n'émet aucune erreur.
const { sanitizeContent } = require("./shared.generated.js");

async function setPresentationContent(slug, email, isAdmin, content) {
  if (!slug) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!isAdmin && (!row.owner_email || row.owner_email !== lc(email))) return { ok: false, status: 403 };
  await PLAYER.db.request(`doc_presentations?slug=eq.${enc(slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { content: sanitizeContent(content), active: true, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() } });
  return { ok: true };
}

// Historique des présentations d'un document (pour l'onglet Suivi) : la plus récente d'abord, avec le nb de participants.
async function listPresentationsForDoc(docId) {
  if (!docId) return [];
  const rows = await PLAYER.db.request(`doc_presentations?doc_id=eq.${enc(String(docId))}&select=slug,presenter_name,owner_name,current_page,active,created_at,updated_at&order=created_at.desc&limit=50`);
  const list = Array.isArray(rows) ? rows : [];
  // UNE requête groupée (in.(…)) au lieu d'une par présentation (N+1, jusqu'à 50) ; agrégation en mémoire.
  const counts = {};
  if (list.length) {
    try {
      const slugs = list.map((p) => enc(p.slug)).join(",");
      const att = await PLAYER.db.request(`doc_presentation_attendees?slug=in.(${slugs})&is_presenter=eq.false&select=slug&limit=5000`);
      for (const a of Array.isArray(att) ? att : []) counts[a.slug] = (counts[a.slug] || 0) + 1;
    } catch { /* best-effort : compteurs à 0 */ }
  }
  return list.map((p) => ({ slug: p.slug, presenterName: p.presenter_name, ownerName: p.owner_name, currentPage: p.current_page || 1, active: !!p.active, createdAt: p.created_at, endedAt: p.active ? null : p.updated_at, attendees: counts[p.slug] || 0 }));
}

module.exports = {
  messagePublic, CHAMPS_PUBLICS, init, createPresentation, getPresentation, setPage, endPresentation, addMessage, listMessages, toggleReaction, editMessage, deleteMessage, setChatLock, createUploadUrl, reclaimPresentation, touchPresentation, listActivePresentations, handoverPresentation, endPresentationByOwner, recordAttendance, presentationStats, listPresentationsForDoc, switchPresentationDoc, setPresentationContent };
