// EXTRAIT DE handler.js (refactor lot 3 — routes, 19/08/2026) — blocs déplacés À L'IDENTIQUE.
// Reste à PLAT dans server/ (les gardes de forge ciblent server/*.js).

let PLAYER = null;
const init = (ctx) => { PLAYER = ctx; };

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

module.exports = { init, adresseAppelant, lcMembre, cleAnonyme, profilDuJeton };
