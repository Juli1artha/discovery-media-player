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
  const out = Object.create(null);   // nu : la garde de forme reconnaît cet accumulateur
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

// Bornes d'exécution par défaut — un lot raisonnable, un plafond qui tient dans une fenêtre
// serverless. L'appelant peut resserrer (dryRun, taille, plafond) ; jamais dépasser sans le dire.
const LOT = 200, PLAFOND = 5000, PLAFOND_PRESENTATIONS = 500;

// Une valeur pour `id=in.(…)` : double-guillemets, guillemet et antislash internes échappés —
// PostgREST exige le guillemetage dès qu'une valeur porte un caractère réservé (`:` d'une clé de
// débit, par exemple). Guillemeter TOUJOURS est correct et évite d'avoir à deviner.
const guill = (v) => '"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';

// ⚠️ PURGE PAR LOTS BORNÉS (P2 huitième audit). On SÉLECTIONNE un lot d'identifiants (borné,
// ordonné par la colonne de date), on les supprime par `id=in.(…)`, on recommence — jamais un
// DELETE non borné qui ramènerait tout l'historique d'un coup (mémoire, WAL, verrous, timeout).
// `dryRun` sélectionne sans supprimer. Le rapport remplace la liste d'identifiants : examinées,
// supprimées, tronqué (il reste à faire au prochain passage).
async function purgerParLots(table, filtre, colId, { dryRun = false, taille = LOT, plafond = PLAFOND } = {}) {
  let examinees = 0, supprimees = 0;
  const maxTours = Math.max(1, Math.ceil(plafond / taille));
  let tours = 0, tronque = false;
  for (;;) {
    if (tours >= maxTours) { tronque = true; break; }
    tours += 1;
    const lot = await PLAYER.db.request(`${table}?${filtre}&select=${colId}&order=${colId}.asc&limit=${taille}`);
    if (!Array.isArray(lot) || !lot.length) break;
    examinees += lot.length;
    if (!dryRun) {
      const ids = lot.map((r) => r[colId]).filter((v) => v != null).map(guill);
      if (ids.length) {
        await PLAYER.db.request(`${table}?${colId}=in.(${ids.join(",")})`, { method: "DELETE", headers: { Prefer: "return=minimal" } });
        supprimees += ids.length;
      }
    }
    if (lot.length < taille) break;   // dernier lot
    if (dryRun) { tronque = tours >= maxTours; if (tours >= maxTours) break; }
  }
  return { examinees, supprimees, tronque };
}

// ⚠️ REVALIDATION À LA SUPPRESSION — le MÊME validateur que l'écriture (server/presentations.js),
// avec le slug de la présentation purgée. Une validation d'écriture n'est jamais la seule barrière
// d'un delete : les lignes déjà en base d'avant le correctif peuvent porter une URL piégée.
const { cheminPieceJointe: cheminSurSlug } = require("./presentations");

async function purgerRetention(now, opts = {}) {
  let f;
  try { f = fenetresValidees(); }
  catch (e) {
    if (!e.retentionInvalide) throw e;
    try { PLAYER.errors.capture(e, { route: "retention" }); } catch { /* jamais bloquant */ }
    return { ok: false, error: e.message };   // config douteuse → zéro DELETE
  }
  const base = String((PLAYER.config && PLAYER.config.supabaseUrl) || "");
  const rapport = {};
  const bJournaux = borne(now, f.journauxMois);

  rapport.commercial_doc_views = await purgerParLots("commercial_doc_views", `at=lt.${enc(bJournaux)}`, "id", opts);
  rapport.commercial_doc_sessions = await purgerParLots("commercial_doc_sessions", `last_at=lt.${enc(bJournaux)}`, "session_id", opts);
  rapport.commercial_doc_internal_sessions = await purgerParLots("commercial_doc_internal_sessions", `last_at=lt.${enc(bJournaux)}`, "session_id", opts);
  rapport.doc_bot_sessions = await purgerParLots("doc_bot_sessions", `last_at=lt.${enc(bJournaux)}`, "id", opts);
  rapport.player_rate_limits = await purgerParLots("player_rate_limits", `expires_at=lt.${enc(new Date(now).toISOString())}`, "key", opts);

  // Liens révoqués : seulement là où la révocation est DATÉE (0013).
  const dateDispo = await require("./schema").attendue("revocationDatee");
  rapport.commercial_doc_shares = dateDispo
    ? await purgerParLots("commercial_doc_shares", `revoked=eq.true&revoked_at=lt.${enc(borne(now, f.liensRevoquesMois))}`, "slug", opts)
    : { examinees: 0, supprimees: 0, tronque: false };

  // Présentations mortes : bornées à PLAFOND_PRESENTATIONS par exécution ; la ligne, ses messages,
  // ses présences — et les fichiers du bucket si storage.remove est fourni (OPTIONNELLE).
  const bPres = borne(now, f.presentationsMois);
  const mortes = await PLAYER.db.request(`doc_presentations?active=eq.false&updated_at=lt.${enc(bPres)}&select=slug&order=slug.asc&limit=${PLAFOND_PRESENTATIONS}`);
  const presRapport = { examinees: 0, supprimees: 0, messages: 0, presences: 0, fichiers: 0, fichiersErreur: 0, tronque: Array.isArray(mortes) && mortes.length >= PLAFOND_PRESENTATIONS };
  const retirer = PLAYER.storage && typeof PLAYER.storage.remove === "function" ? PLAYER.storage.remove.bind(PLAYER.storage) : null;
  for (const p of (Array.isArray(mortes) ? mortes : [])) {
    const slug = p && p.slug; if (!slug) continue;
    presRapport.examinees += 1;
    if (retirer && !opts.dryRun) {
      const jointes = await PLAYER.db.request(`doc_presentation_messages?slug=eq.${enc(slug)}&attachment=not.is.null&select=attachment`);
      for (const j of (Array.isArray(jointes) ? jointes : [])) {
        const url = j && j.attachment && (typeof j.attachment === "object" ? j.attachment.url : j.attachment);
        const chemin = cheminSurSlug(url, slug, base);
        if (!chemin) continue;   // hors du dossier du slug → jamais supprimé (barrière 2)
        try { if (await retirer("present-attachments", chemin)) presRapport.fichiers += 1; } catch { presRapport.fichiersErreur += 1; /* le fichier survit, la ligne part */ }
      }
    }
    if (!opts.dryRun) {
      presRapport.messages += (await purgerParLots("doc_presentation_messages", `slug=eq.${enc(slug)}`, "id", opts)).supprimees;
      presRapport.presences += (await purgerParLots("doc_presentation_attendees", `slug=eq.${enc(slug)}`, "attendee_key", opts)).supprimees;
    }
    if (!opts.dryRun) {
      presRapport.supprimees += (await purgerParLots("doc_presentations", `slug=eq.${enc(slug)}`, "slug", opts)).supprimees;
    }
  }
  rapport.presentations = presRapport;

  // `efface` : l'ANCIENNE forme (table → nombre supprimé), dérivée du rapport — les appelants et
  // essais existants continuent de lire `r.efface.commercial_doc_views`. Le rapport détaillé vit
  // à côté, sous `r.rapport`.
  const efface = {
    commercial_doc_views: rapport.commercial_doc_views.supprimees,
    commercial_doc_sessions: rapport.commercial_doc_sessions.supprimees,
    commercial_doc_internal_sessions: rapport.commercial_doc_internal_sessions.supprimees,
    doc_bot_sessions: rapport.doc_bot_sessions.supprimees,
    player_rate_limits: rapport.player_rate_limits.supprimees,
    commercial_doc_shares: rapport.commercial_doc_shares.supprimees,
    doc_presentations: presRapport.supprimees,
    doc_presentation_messages: presRapport.messages,
    doc_presentation_attendees: presRapport.presences,
    pieces_jointes: presRapport.fichiers,
  };
  return { ok: true, dryRun: !!opts.dryRun, efface, rapport };
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
