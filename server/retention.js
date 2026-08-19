// LA PURGE DÉCLARE, LE RECENSEMENT LA CONTREDIT.
//
// Ce module est UNE des deux moitiés du contrat de rétention (docs/RETENTION.md) : il efface ce
// qui a dépassé sa fenêtre et DÉCLARE ses comptes, table par table. L'autre moitié —
// `supabase/recensement-retention.sql` — recompte en SQL nu ce qui reste dans le périmètre
// revendiqué, sans partager une ligne, une fonction ni un filtre avec ce fichier : deux textes
// qui ne peuvent pas être faux de la même manière. La forge les confronte sur une base réelle.
//
// ⚠️ Le compte déclaré vient des LIGNES RENDUES par le DELETE (`Prefer: return=representation`,
// select réduit à une colonne), jamais d'un comptage préalable : ce qui est déclaré est ce qui a
// été fait, pas ce qui était prévu.
//
// ⚠️ L'absence ne se prouve pas ici : ce module peut seulement dire ce qu'il a effacé. La
// question « son périmètre couvre-t-il ce qui existe ? » appartient à la garde de forge qui
// confronte les colonnes du schéma vivant à docs/RETENTION.md.

let PLAYER = null;
const init = (ctx) => { PLAYER = ctx; };
const enc = encodeURIComponent;

// Fenêtres par défaut de docs/RETENTION.md — l'hôte ajuste via `config.retention`.
const FENETRES = { journauxMois: 13, presentationsMois: 12, liensRevoquesMois: 13 };
const CLES_FENETRE = Object.keys(FENETRES);
const MIN_MOIS = 1, MAX_MOIS = 120;

// ⚠️ UNE FENÊTRE EST UN ENTIER DE MOIS DANS [1,120] — RIEN D'AUTRE (P2 huitième audit). Une valeur
// négative calculerait une borne FUTURE (perte massive), zéro purgerait tout, une chaîne/NaN/
// Infinity produirait une date invalide. On refuse AVANT le premier DELETE, en NOMMANT la clé.
// Zéro n'est PAS une purge immédiate : ce serait un geste trop dangereux pour un défaut de config.
function fenetresValidees() {
  const brut = { ...FENETRES, ...((PLAYER.config && PLAYER.config.retention) || {}) };
  const out = {};
  for (const cle of CLES_FENETRE) {
    const v = brut[cle];
    if (typeof v !== "number" || !Number.isInteger(v) || v < MIN_MOIS || v > MAX_MOIS) {
      const e = new Error(`fenêtre de rétention invalide : ${cle}=${JSON.stringify(v)} — attendu un entier de mois dans [${MIN_MOIS},${MAX_MOIS}]. Aucune suppression.`);
      e.retentionInvalide = true;
      throw e;
    }
    out[cle] = v;
  }
  return out;
}

// ⚠️ Borne = N mois avant `now`, en UTC, RABATTUE au dernier jour du mois cible. `Date.setMonth`
// déborde (« 31 mars − 1 mois » → 3 mars) et l'heure locale + le changement d'heure décalaient la
// borne : on construit la date en UTC, jour rabattu sur le dernier du mois visé.
function borne(now, mois) {
  const d = new Date(now);
  const a = d.getUTCFullYear();
  const m = d.getUTCMonth() - mois;
  const dernierDuMois = new Date(Date.UTC(a, m + 1, 0)).getUTCDate();   // jour 0 du mois suivant = dernier du mois
  const jour = Math.min(d.getUTCDate(), dernierDuMois);
  return new Date(Date.UTC(a, m, jour, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds())).toISOString();
}

async function effacer(chemin) {
  const lignes = await PLAYER.db.request(chemin, { method: "DELETE", headers: { Prefer: "return=representation" } });
  return Array.isArray(lignes) ? lignes.length : 0;
}

// ⚠️ REVALIDATION À LA SUPPRESSION — le MÊME validateur que l'écriture (server/presentations.js),
// avec le slug de la présentation purgée. Une validation d'écriture n'est jamais la seule barrière
// d'un delete : les lignes déjà en base d'avant le correctif peuvent porter une URL piégée.
const { cheminPieceJointe: cheminSurSlug } = require("./presentations");

async function purgerRetention(now) {
  let f;
  try { f = fenetresValidees(); }
  catch (e) {
    if (!e.retentionInvalide) throw e;
    try { PLAYER.errors.capture(e, { route: "retention" }); } catch { /* jamais bloquant */ }
    return { ok: false, error: e.message };   // config douteuse → zéro DELETE
  }
  const base = String((PLAYER.config && PLAYER.config.supabaseUrl) || "");
  const efface = {};
  const bJournaux = borne(now, f.journauxMois);

  efface.commercial_doc_views = await effacer(`commercial_doc_views?at=lt.${enc(bJournaux)}&select=id`);
  efface.commercial_doc_sessions = await effacer(`commercial_doc_sessions?last_at=lt.${enc(bJournaux)}&select=session_id`);
  efface.commercial_doc_internal_sessions = await effacer(`commercial_doc_internal_sessions?last_at=lt.${enc(bJournaux)}&select=session_id`);
  efface.doc_bot_sessions = await effacer(`doc_bot_sessions?last_at=lt.${enc(bJournaux)}&select=id`);
  efface.player_rate_limits = await effacer(`player_rate_limits?expires_at=lt.${enc(new Date(now).toISOString())}&select=key`);

  // Liens révoqués : seulement là où la révocation est DATÉE (0013) — sans la colonne, la purge
  // resterait muette plutôt que d'inventer une borne depuis l'âge du lien.
  const dateDispo = await require("./schema").attendue("revocationDatee");
  efface.commercial_doc_shares = dateDispo
    ? await effacer(`commercial_doc_shares?revoked=eq.true&revoked_at=lt.${enc(borne(now, f.liensRevoquesMois))}&select=slug`)
    : 0;

  // Présentations mortes : la ligne, ses messages, ses présences — et les fichiers du bucket si
  // l'hôte fournit storage.remove (capacité OPTIONNELLE : sans elle, la limite est écrite dans
  // RETENTION.md plutôt que simulée ici).
  const bPres = borne(now, f.presentationsMois);
  const mortes = await PLAYER.db.request(`doc_presentations?active=eq.false&updated_at=lt.${enc(bPres)}&select=slug`);
  efface.doc_presentations = 0; efface.doc_presentation_messages = 0;
  efface.doc_presentation_attendees = 0; efface.pieces_jointes = 0;
  const retirer = PLAYER.storage && typeof PLAYER.storage.remove === "function" ? PLAYER.storage.remove.bind(PLAYER.storage) : null;
  for (const p of (Array.isArray(mortes) ? mortes : [])) {
    const slug = p && p.slug; if (!slug) continue;
    if (retirer) {
      const jointes = await PLAYER.db.request(`doc_presentation_messages?slug=eq.${enc(slug)}&attachment=not.is.null&select=attachment`);
      for (const j of (Array.isArray(jointes) ? jointes : [])) {
        const url = j && j.attachment && (typeof j.attachment === "object" ? j.attachment.url : j.attachment);
        const chemin = cheminSurSlug(url, slug, base);
        if (!chemin) continue;   // hors du dossier du slug → jamais supprimé (barrière 2)
        try { if (await retirer("present-attachments", chemin)) efface.pieces_jointes += 1; } catch { /* le fichier survit, la ligne part quand même — limite dite */ }
      }
    }
    efface.doc_presentation_messages += await effacer(`doc_presentation_messages?slug=eq.${enc(slug)}&select=id`);
    efface.doc_presentation_attendees += await effacer(`doc_presentation_attendees?slug=eq.${enc(slug)}&select=attendee_key`);
    efface.doc_presentations += await effacer(`doc_presentations?slug=eq.${enc(slug)}&select=slug`);
  }
  return { ok: true, efface };
}

// Balayage opportuniste : au plus UN par fenêtre de 24 h (le verrou est le compteur de débit
// partagé — même mécanique que les limites, donc multi-processus sans coordination). Jamais
// bloquant : la route qui l'héberge répond sans l'attendre, l'échec se capture.
//
// ⚠️ OPT-IN STRICT (`config.retention.balayage === true`), et le second hôte a payé pour la
// règle avant qu'elle existe : il consomme le contexte autonome TEL QUEL — « nous n'avons rien
// à brancher parce que nous n'avons rien débranché » — et le premier envoi de lien après sa
// montée aurait balayé selon NOS fenêtres par défaut, sans que personne n'ait rien décidé.
// Les fenêtres sont des décisions MÉTIER (ce qu'un conseiller peut encore prouver à un client) ;
// une suppression n'agit donc que là où un exploitant l'a écrite. `retention.run` reste
// disponible sans opt-in : appeler la route EST la décision.
function tick() {
  const r = PLAYER.config && PLAYER.config.retention;
  if (!r || r.balayage !== true) return;
  Promise.resolve()
    .then(() => PLAYER.limits.allow("retention:sweep", 1, 86400))
    .then((permis) => { if (permis) return purgerRetention(Date.now()); })
    .catch((e) => { try { PLAYER.errors.capture(e, { route: "retention", benin: true }); } catch { /* jamais bloquant */ } });
}

module.exports = { init, purgerRetention, tick, borne };
