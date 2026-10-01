// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES LIENS PROTÉGÉS — une date d'expiration et un mot de passe sur un lien tracé (migration 0028).
//
// Demandé par le premier hôte (« Documents à la Drive », lot 6, 01/10/2026) : sa fenêtre de partage
// disait « sans expiration », et le mot de passe existait déjà sur ses liens de PROPOSITION. La règle
// vit ici, une fois, et `shares.js` l'applique au seul endroit où un lien se résout
// (`getShareBySlug`) : la page, le fichier, l'assistant, la mesure et le re-partage passent tous par
// lui. Une porte posée sur la page seule aurait laissé le PDF passer à côté (`?file=1`) — le défaut
// exact que `murDocument.test.js` interdit pour le mur d'accès.
//
//   • EXPIRÉ : le lien ne se résout plus, pour personne — même refus qu'un lien révoqué, mais NOMMÉ
//     (`expired`), parce que la personne qui le reçoit peut demander un nouveau lien et doit le savoir.
//     ⚠️ Une date illisible vaut EXPIRÉE : une protection qu'on ne sait pas lire ne s'ouvre pas.
//   • MOT DE PASSE : le lien ne se résout que pour une requête qui porte le cookie de déverrouillage.
//     ⚠️ SANS REQUÊTE, VERROUILLÉ. Un appelant qui oublie de la passer obtient « introuvable », jamais
//     « ouvert » — l'oubli ferme au lieu d'ouvrir.
//
// ⚠️ LE COOKIE EST SIGNÉ AVEC L'EMPREINTE DU MOT DE PASSE, PAS AVEC UN SECRET DE L'INSTANCE. Un secret
// d'instance aurait été une variable de plus à poser chez chaque hôte, et un correctif qui dort tant
// que personne ne l'a configurée n'en est pas un. L'empreinte ne quitte jamais la base (jamais servie,
// cf. CHAMPS de `listSharesForDoc`) : forger le cookie exige de lire la base, et qui lit la base lit
// déjà l'adresse du fichier. Elle change avec le mot de passe (sel neuf) : changer le mot de passe
// referme tous les navigateurs déjà entrés, sans rien tenir à jour.
//
// Le format de l'empreinte est celui des liens de proposition de l'hôte d'origine (« sel:hash », scrypt,
// hex) : un seul mécanisme chez lui, pas deux qui divergeraient.
const crypto = require("crypto");

const MOT_MIN = 4;
const MOT_MAX = 200;
/** Une expiration au-delà de deux ans n'en est plus une : on refuse plutôt que d'en promettre une vide. */
const DUREE_MAX_JOURS = 730;
/** Le temps qu'un navigateur reste entré après le mot de passe : une journée de travail. */
const COOKIE_DUREE_S = 8 * 3600;

/** Le lien est-il expiré à `maintenant` (ms) ? Sans date, jamais ; date illisible, toujours. */
function expire(share, maintenant) {
  if (!share || share.expires_at == null || share.expires_at === "") return false;
  const t = Date.parse(String(share.expires_at));
  return !Number.isFinite(t) || t <= maintenant;
}

/** L'empreinte d'un mot de passe : scrypt, sel aléatoire, « sel:hash » en hexadécimal. */
function empreinte(mot) {
  const sel = crypto.randomBytes(16).toString("hex");
  return `${sel}:${crypto.scryptSync(String(mot), sel, 32).toString("hex")}`;
}

/** Ce mot de passe correspond-il à cette empreinte ? Comparaison à temps constant. */
function motValide(mot, emp) {
  const m = String(mot == null ? "" : mot);
  const [sel, hash] = String(emp || "").split(":");
  if (!m || !sel || !hash || m.length > MOT_MAX) return false;
  const a = Buffer.from(hash, "hex");
  const b = crypto.scryptSync(m, sel, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Le nom du cookie d'un lien : une empreinte du slug, pour qu'un nom de cookie ne trahisse pas un lien. */
const nomDuCookie = (slug) => "dmp_lien_" + crypto.createHash("sha256").update(String(slug)).digest("hex").slice(0, 24);
const jeton = (slug, emp) => crypto.createHmac("sha256", String(emp)).update("lien-deverrouille\0" + String(slug)).digest("base64url");

function lireCookie(req, nom) {
  const brut = String((req && req.headers && req.headers.cookie) || "");
  for (const part of brut.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === nom) return part.slice(i + 1).trim();
  }
  return "";
}

/** Ce lien est-il ouvert pour cette requête ? Sans mot de passe, oui ; avec, seulement au cookie valide. */
function deverrouille(share, req) {
  if (!share || !share.password_hash) return true;
  if (!req) return false;
  const attendu = Buffer.from(jeton(share.slug, share.password_hash));
  const recu = Buffer.from(lireCookie(req, nomDuCookie(share.slug)));
  return recu.length === attendu.length && crypto.timingSafeEqual(recu, attendu);
}

/**
 * Le cookie posé après le bon mot de passe. `SameSite=Lax` : le lien arrive par un courriel, une
 * navigation de premier niveau ; `Strict` le perdrait au premier clic venu d'un webmail.
 * ⚠️ Un lien protégé INTÉGRÉ chez un tiers (iframe d'une autre origine) ne reçoit pas ce cookie : la
 * page du mot de passe reste affichée dans le cadre, et le dit à l'hôte (`password-required`).
 */
const cookieDeverrouillage = (share) =>
  `${nomDuCookie(share.slug)}=${jeton(share.slug, share.password_hash)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${COOKIE_DUREE_S}`;

/**
 * LA PROTECTION DEMANDÉE PAR L'HÔTE, lue et BORNÉE — ou le refus qui dit quoi corriger.
 *
 *   expiresAt : absent = inchangé ; `null` = sans expiration ; une date ISO à venir, à deux ans au plus.
 *   password  : absent = inchangé ; `null` ou "" = sans mot de passe ; sinon 4 à 200 caractères.
 *
 * Rend `{ champs }` — les colonnes à écrire, VIDE si rien n'est demandé — et `protege` : la demande
 * pose-t-elle une protection ? (C'est elle qui exige la migration : retirer une protection qu'on n'a
 * jamais pu poser ne coûte rien.)
 */
function protectionDemandee(entree, maintenant) {
  const e = entree && typeof entree === "object" ? entree : {};
  const champs = {};
  let protege = false;
  if (e.expiresAt !== undefined) {
    if (e.expiresAt === null || e.expiresAt === "") champs.expires_at = null;
    else {
      const t = Date.parse(String(e.expiresAt));
      if (!Number.isFinite(t)) return { refus: "Date d'expiration illisible." };
      if (t <= maintenant) return { refus: "La date d'expiration doit être à venir." };
      if (t > maintenant + DUREE_MAX_JOURS * 86_400_000) return { refus: `Une expiration se fixe à ${DUREE_MAX_JOURS} jours au plus.` };
      champs.expires_at = new Date(t).toISOString();
      protege = true;
    }
  }
  if (e.password !== undefined) {
    if (e.password === null || e.password === "") champs.password_hash = null;
    else {
      const m = String(e.password);
      if (m.length < MOT_MIN) return { refus: `Le mot de passe compte ${MOT_MIN} caractères au moins.` };
      if (m.length > MOT_MAX) return { refus: `Le mot de passe compte ${MOT_MAX} caractères au plus.` };
      champs.password_hash = empreinte(m);
      protege = true;
    }
  }
  return { champs, protege };
}

/**
 * Ce qu'un hôte voit de la protection d'un lien — l'échéance et un booléen, JAMAIS l'empreinte.
 * La clé servie est `expiresAt`, comme `lastAt` dans la même liste : la forme « colonne: valeur » est
 * celle que `colonneMigreeConditionnelle.test.js` lit comme une ÉCRITURE, et une lecture n'a pas à s'y
 * confondre (même choix que le `delete` du re-partage dans shares.js).
 */
const protectionServie = (sh) => ({ expiresAt: (sh && sh.expires_at) || null, protege: !!(sh && sh.password_hash) });

module.exports = {
  MOT_MIN, MOT_MAX, DUREE_MAX_JOURS, COOKIE_DUREE_S,
  expire, empreinte, motValide, nomDuCookie, deverrouille, cookieDeverrouillage, protectionDemandee, protectionServie,
};
