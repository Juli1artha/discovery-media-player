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
const fenetres = () => ({ ...FENETRES, ...((PLAYER.config && PLAYER.config.retention) || {}) });

// Borne calendaire : N mois avant `now`, en ISO — les fenêtres de RETENTION.md parlent en mois.
function borne(now, mois) { const d = new Date(now); d.setMonth(d.getMonth() - mois); return d.toISOString(); }

async function effacer(chemin) {
  const lignes = await PLAYER.db.request(chemin, { method: "DELETE", headers: { Prefer: "return=representation" } });
  return Array.isArray(lignes) ? lignes.length : 0;
}

// Chemin du bucket depuis l'URL publique d'une pièce jointe — nul si l'URL vient d'ailleurs.
function cheminPieceJointe(url) {
  const m = /\/present-attachments\/(.+)$/.exec(String(url || ""));
  return m ? m[1].split("?")[0] : null;
}

async function purgerRetention(now) {
  const f = fenetres();
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
        const chemin = cheminPieceJointe(j && j.attachment);
        if (!chemin) continue;
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
function tick() {
  Promise.resolve()
    .then(() => PLAYER.limits.allow("retention:sweep", 1, 86400))
    .then((permis) => { if (permis) return purgerRetention(Date.now()); })
    .catch((e) => { try { PLAYER.errors.capture(e, { route: "retention", benin: true }); } catch { /* jamais bloquant */ } });
}

module.exports = { init, purgerRetention, tick, cheminPieceJointe };
