// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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
const FENETRES = { journauxMois: 13, presentationsMois: 12, liensRevoquesMois: 13, voixMois: 13 };
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
const MAX_TAILLE = 500, MAX_PLAFOND = 5000;

// ⚠️ LES OPTIONS D'EXÉCUTION SONT VALIDÉES AVANT TOUT DELETE (P1 neuvième audit). La route les
// reçoit d'un appelant ; un `dryRun` non booléen strict, une taille/plafond hors bornes ou une
// clé inconnue font ÉCHOUER la purge — jamais un `Number()` ni un `!!` qui transformerait
// `"false"` en purge réelle. `dryRun` est ce qu'un exploitant lance EN PREMIER : il ne doit pas
// pouvoir supprimer par une faute de type.
const CLES_OPTS = new Set(["dryRun", "taille", "plafond"]);
function optionsValidees(opts) {
  const o = opts || {};
  for (const cle of Object.keys(o)) {
    if (!CLES_OPTS.has(cle)) { const e = new Error(`option de rétention inconnue : ${cle}`); e.retentionInvalide = true; throw e; }
  }
  if ("dryRun" in o && typeof o.dryRun !== "boolean") { const e = new Error("dryRun doit être un booléen strict"); e.retentionInvalide = true; throw e; }
  const entierDans = (v, min, max, nom) => {
    if (v === undefined) return undefined;
    if (typeof v !== "number" || !Number.isInteger(v) || v < min || v > max) {
      const e = new Error(`${nom} doit être un entier dans [${min},${max}] — reçu ${JSON.stringify(v)}`); e.retentionInvalide = true; throw e;
    }
    return v;
  };
  return {
    dryRun: o.dryRun === true,
    taille: entierDans(o.taille, 1, MAX_TAILLE, "taille") ?? LOT,
    plafond: entierDans(o.plafond, 1, MAX_PLAFOND, "plafond") ?? PLAFOND,
  };
}

// Une valeur pour `id=in.(…)` : double-guillemets, guillemet et antislash internes échappés —
// PostgREST exige le guillemetage dès qu'une valeur porte un caractère réservé (`:` d'une clé de
// débit, par exemple). Guillemeter TOUJOURS est correct et évite d'avoir à deviner.
// ⚠️ DOUBLE encodage nécessaire (trouvé par le banc volumétrique, audit 10) : le guillemetage
// gère les délimiteurs de PostgREST (virgule, parenthèse) ; l'encodage d'URL gère ceux de l'URL
// (`&`, `#`, `+`, espace…) — un `&` non encodé dans une valeur coupe le filtre `in.(…)` en deux.
// PostgREST décode le percent-encoding avant de parser, donc `%22…%26…%22` redevient `"…&…"`.
const guill = (v) => encodeURIComponent('"' + String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"');

// ⚠️ LES DEUX SEULES PORTES DE DESTRUCTION DU MODULE — dryRun court-circuité en PREMIÈRE ligne.
// « Honoré » ne se prouve pas en lisant chaque DELETE (une fenêtre de lecture décide de la réponse
// — le piège du périmètre), mais en n'ayant QU'UNE porte, gardée ici, et une garde de forme qui
// exige qu'il n'y en ait qu'une (server/__tests__/retentionUnePorte.test.js). Un troisième chemin
// d'écriture DEVRA passer par ces portes, ou il rougira le compte. C'est « retirer la seconde
// source de vérité » appliqué à la suppression : un seul endroit peut détruire.
async function effacerParIds(table, colId, ids, opts) {
  if (opts.dryRun || !ids || !ids.length) return 0;
  const del = await PLAYER.db.request(`${table}?${colId}=in.(${ids.map(guill).join(",")})&select=${colId}`, { method: "DELETE", headers: { Prefer: "return=representation" } });
  return Array.isArray(del) ? del.length : 0;   // lignes RENDUES, pas ids présélectionnés
}
// ⚠️ LE BUCKET EST UN PARAMÈTRE, PAS UNE CONSTANTE — ET LA PORTE RESTE UNIQUE. Deux périmètres
// écrivent des fichiers (`present-attachments` et `tts-cache`) ; leur donner deux fonctions de
// retrait donnerait deux chemins de destruction, dont un seul serait gardé. C'est exactement ce que
// `retentionUnePorte.test.js` refuse de laisser arriver.
async function retirerFichier(bucket, chemin, opts) {
  if (opts.dryRun || !chemin) return null;   // null = rien tenté ; true = retiré ; false = échec
  const retirer = PLAYER.storage && typeof PLAYER.storage.remove === "function" ? PLAYER.storage.remove.bind(PLAYER.storage) : null;
  if (!retirer) return null;
  try { return !!(await retirer(bucket, chemin)); } catch { return false; }
}

// ⚠️ PURGE PAR LOTS BORNÉS (P2 huitième audit). On SÉLECTIONNE un lot d'identifiants (borné,
// ordonné par la colonne de date), on les supprime par `id=in.(…)`, on recommence — jamais un
// DELETE non borné qui ramènerait tout l'historique d'un coup (mémoire, WAL, verrous, timeout).
// `dryRun` sélectionne sans supprimer. Le rapport remplace la liste d'identifiants : examinées,
// supprimées, tronqué (il reste à faire au prochain passage).
// ⚠️ Pagination par CURSEUR KEYSET (`colId=gt.<dernier>`), pas par `offset` — la garde de
// portabilité de la forge interdit `offset=`, et un curseur est de toute façon stable sous
// suppression concurrente. En dry-run le pool ne rétrécit pas : sans curseur, on relisait le
// même premier lot à chaque tour (P2 neuvième audit : 120 lignes comptées 300). Le lot est rogné
// au RESTE du plafond (`min(taille, plafond - examinees)`) pour ne jamais le dépasser. Et on
// compte les lignes RENDUES par le DELETE (`return=representation&select=id`), pas les ids
// présélectionnés : deux exécutions concurrentes n'annoncent pas deux fois la même suppression.
/**
 * « Cette table n'existe pas ici » — et RIEN d'autre.
 *
 * ⚠️ UNE CIBLE DE PURGE PEUT LÉGITIMEMENT MANQUER, LE CONTRAT LE DIT. `docs/HOST-CONTRACT.md` :
 * les migrations de débit « ne sont délibérément pas » dans le périmètre de la carte, parce
 * qu'« un hôte peut fournir sa propre capacité `limits`, et sur un tel hôte leur absence est
 * NORMALE, pas un défaut ». Le balayage, lui, purgeait `player_rate_limits` sans condition — donc
 * sur cet hôte-là il levait à la cinquième cible sur huit, et les liens révoqués comme les
 * présentations n'étaient JAMAIS atteints. Enveloppé dans un `catch` qui le classe bénin, il
 * restait armé, silencieux, et partiellement inopérant : le pire des trois états.
 *
 * ⚠️ AUSSI ÉTROIT QUE `signatureAbsente`, ET POUR LA MÊME RAISON. On accepte le code PostgREST de la
 * table introuvable, ou son message — et rien d'autre. Un 404 seul ne suffit pas : il peut venir
 * d'ailleurs, et avaler une vraie panne ferait de ce correctif une purge qui ne purge plus sans le
 * dire, c'est-à-dire exactement ce qu'il corrige.
 */
function tableAbsente(erreur) {
  if (!erreur) return false;
  const code = erreur.details && (erreur.details.code || (erreur.details.error && erreur.details.error.code));
  if (code === "PGRST205") return true;
  const texte = String(erreur.message || "");
  return texte.includes("PGRST205") || /Could not find the table/i.test(texte);
}

async function purgerParLots(table, filtre, colId, { dryRun = false, taille = LOT, plafond = PLAFOND } = {}, plafondForce) {
  if (plafondForce !== undefined) plafond = plafondForce;
  let examinees = 0, supprimees = 0, tronque = false, curseur = null;
  for (;;) {
    const reste = plafond - examinees;
    if (reste <= 0) { tronque = await resteEncore(table, filtre, colId, curseur, dryRun); break; }
    const limite = Math.min(taille, reste);
    const borneCur = curseur != null ? `&${colId}=gt.${enc(String(curseur))}` : "";
    const lot = await PLAYER.db.request(`${table}?${filtre}${borneCur}&select=${colId}&order=${colId}.asc&limit=${limite}`);
    if (!Array.isArray(lot) || !lot.length) break;
    examinees += lot.length;
    curseur = lot[lot.length - 1][colId];
    supprimees += await effacerParIds(table, colId, lot.map((r) => r[colId]).filter((v) => v != null), { dryRun });
    if (lot.length < limite) break;   // dernier lot (moins que demandé → plus rien après)
  }
  return { examinees, supprimees, tronque };
}

// « Reste-t-il une ligne au-delà du curseur ? » — sonde d'UNE ligne. Départage « on s'est arrêté
// pile au plafond mais tout est parti » de « il reste à faire ». En run réel les lignes lues ont
// été supprimées : la fenêtre a avancé, on relit depuis le début du filtre (curseur non requis).
async function resteEncore(table, filtre, colId, curseur, dryRun) {
  const borneCur = dryRun && curseur != null ? `&${colId}=gt.${enc(String(curseur))}` : "";
  const sonde = await PLAYER.db.request(`${table}?${filtre}${borneCur}&select=${colId}&order=${colId}.asc&limit=1`);
  return Array.isArray(sonde) && sonde.length > 0;
}

// ⚠️ REVALIDATION À LA SUPPRESSION — le MÊME validateur que l'écriture (server/presentations.js),
// avec le slug de la présentation purgée. Une validation d'écriture n'est jamais la seule barrière
// d'un delete : les lignes déjà en base d'avant le correctif peuvent porter une URL piégée.
const { cheminPieceJointe: cheminSurSlug } = require("./presentations");

// Purge des messages d'une présentation morte, par lots bornés qui lisent id+attachment ENSEMBLE :
// on retire les fichiers du bucket du lot (si l'hôte sait), puis on supprime le lot. Rend `tronque`
// pour que l'appelant décide de garder ou non la présentation. Compte les lignes RENDUES.
async function purgerMessagesPresentation(slug, opts, base, plafond) {
  const { dryRun, taille } = opts;
  let supprimees = 0, fichiers = 0, fichiersErreur = 0, fichiersCandidats = 0, examinees = 0, tronque = false, curseur = null;
  for (;;) {
    const reste = plafond - examinees;
    if (reste <= 0) { tronque = await resteEncore("doc_presentation_messages", `slug=eq.${enc(slug)}`, "id", curseur, dryRun); break; }
    const limite = Math.min(taille, reste);
    const borneCur = curseur != null ? `&id=gt.${enc(String(curseur))}` : "";
    const lot = await PLAYER.db.request(`doc_presentation_messages?slug=eq.${enc(slug)}${borneCur}&select=id,attachment&order=id.asc&limit=${limite}`);
    if (!Array.isArray(lot) || !lot.length) break;
    examinees += lot.length;
    curseur = lot[lot.length - 1].id;
    for (const j of lot) {
      const url = j.attachment && (typeof j.attachment === "object" ? j.attachment.url : j.attachment);
      const chemin = cheminSurSlug(url, slug, base);   // hors du dossier du slug → null → jamais retiré (barrière 2)
      if (chemin) fichiersCandidats += 1;              // compté même en dry-run (ce que la vraie purge tenterait)
      const issue = await retirerFichier("present-attachments", chemin, { dryRun });
      if (issue === true) fichiers += 1; else if (issue === false) fichiersErreur += 1;   // false = échec compté
    }
    supprimees += await effacerParIds("doc_presentation_messages", "id", lot.map((r) => r.id).filter((v) => v != null), { dryRun });
    if (lot.length < limite) break;
  }
  return { supprimees, fichiers, fichiersErreur, fichiersCandidats, examinees, tronque };
}

/**
 * Le cache de voix : deux objets par empreinte, et une ligne pour savoir qu'ils existent.
 *
 * ⚠️ SANS LA TABLE, CE PÉRIMÈTRE EST INATTEIGNABLE — ce n'est pas une fenêtre qui manquait. Les
 * objets de `tts-cache` sont nommés par un condensat (voix + modèle + texte prononcé) qui ne se
 * rattache à aucune ligne, et la capacité `storage` du contrat expose `put` et `remove`, jamais
 * `list` : il n'y avait littéralement rien à parcourir. `doc_tts_objects` (migration 0021) est la
 * trace, et c'est elle qui rend cette purge possible.
 *
 * ⚠️ ET C'EST UN VISITEUR QUI DÉCIDE DE CE QUI Y ENTRE. `bot-tts` accepte le texte de l'appelant :
 * un texte unique laisse un MP3 et un JSON dans un bucket PUBLIC. Les plafonds de la 0.1.140
 * bornent le coût par heure ; seule cette fenêtre borne la DURÉE.
 */
async function purgerCacheDeVoix(opts, borneDate) {
  const { dryRun, taille, plafond } = opts;
  const filtre = `created_at=lt.${enc(borneDate)}`;
  let supprimees = 0, fichiers = 0, fichiersErreur = 0, fichiersCandidats = 0, examinees = 0, tronque = false, curseur = null;
  for (;;) {
    const reste = plafond - examinees;
    if (reste <= 0) { tronque = await resteEncore("doc_tts_objects", filtre, "hash", curseur, dryRun); break; }
    const limite = Math.min(taille, reste);
    const borneCur = curseur != null ? `&hash=gt.${enc(String(curseur))}` : "";
    const lot = await PLAYER.db.request(`doc_tts_objects?${filtre}${borneCur}&select=hash&order=hash.asc&limit=${limite}`);
    if (!Array.isArray(lot) || !lot.length) break;
    examinees += lot.length;
    curseur = lot[lot.length - 1].hash;
    for (const o of lot) {
      const h = o && o.hash;
      if (!h) continue;
      // ⚠️ DEUX OBJETS PAR EMPREINTE : l'audio, et son alignement par caractère. Le second n'existe
      // pas toujours. Ce que `remove` en dit remonte TEL QUEL dans `fichiersErreur` : on ne masque
      // pas un retrait raté pour obtenir un compte propre, parce qu'un rapport qui ment sur ce
      // qu'il a fait ne sert plus à rien.
      //
      // ⚠️ ET LA RAISON ÉCRITE ICI ÉTAIT INCOMPLÈTE — « les extraits antérieurs au format v2 n'en
      // ont pas ». C'est vrai et ce n'est pas la cause principale : un hôte a mesuré son bucket le
      // 27/08 et y a trouvé 552 `.mp3` pour 356 `.json`. Cent quatre-vingt-seize audios SEULS, non
      // pas parce qu'ils sont vieux, mais parce que le fournisseur ne rend pas toujours
      // d'alignement. C'est un cas VIVANT, pas un vestige.
      //
      // Conséquence pour qui lit le rapport : `fichiersErreur` peut être élevé sans qu'aucune purge
      // ait échoué — un tiers des empreintes n'a légitimement pas de compagnon à retirer. Le compte
      // reste non masqué, mais sa lecture demande ce paragraphe : un exploitant qui découvrirait
      // deux cents « erreurs » à sa première purge chercherait une panne qui n'existe pas.
      for (const suffixe of [".mp3", ".json"]) {
        fichiersCandidats += 1;   // compté même en dry-run : ce que la vraie purge tenterait
        const issue = await retirerFichier("tts-cache", h + suffixe, { dryRun });
        if (issue === true) fichiers += 1; else if (issue === false) fichiersErreur += 1;
      }
    }
    // ⚠️ LA LIGNE PART APRÈS LES OBJETS, JAMAIS AVANT. Effacer la trace d'abord rendrait les deux
    // objets définitivement inatteignables — on aurait purgé le seul moyen de les purger.
    supprimees += await effacerParIds("doc_tts_objects", "hash", lot.map((r) => r.hash).filter((v) => v != null), { dryRun });
    if (lot.length < limite) break;
  }
  return { supprimees, fichiers, fichiersErreur, fichiersCandidats, examinees, tronque };
}

async function purgerRetention(now, optsBrutes = {}) {
  let f, opts;
  try { f = fenetresValidees(); opts = optionsValidees(optsBrutes); }
  catch (e) {
    if (!e.retentionInvalide) throw e;
    try { PLAYER.errors.capture(e, { route: "retention" }); } catch { /* jamais bloquant */ }
    return { ok: false, error: e.message };   // config OU option douteuse → zéro DELETE
  }
  const base = String((PLAYER.config && PLAYER.config.supabaseUrl) || "");
  const rapport = {};
  const bJournaux = borne(now, f.journauxMois);

  rapport.commercial_doc_views = await purgerParLots("commercial_doc_views", `at=lt.${enc(bJournaux)}`, "id", opts);
  rapport.commercial_doc_sessions = await purgerParLots("commercial_doc_sessions", `last_at=lt.${enc(bJournaux)}`, "session_id", opts);
  rapport.commercial_doc_internal_sessions = await purgerParLots("commercial_doc_internal_sessions", `last_at=lt.${enc(bJournaux)}`, "session_id", opts);
  rapport.doc_bot_sessions = await purgerParLots("doc_bot_sessions", `last_at=lt.${enc(bJournaux)}`, "id", opts);
  // ⚠️ LA SEULE CIBLE QUE LE CONTRAT REND OPTIONNELLE — et le balayage la traitait comme les autres.
  // Son absence est normale sur un hôte qui fournit sa propre capacité `limits` ; elle ne doit donc
  // pas interrompre les trois cibles qui suivent. Sautée, ET DITE : un rapport qui omettrait la
  // ligne se lirait comme « rien à supprimer », ce qui est une autre affirmation.
  rapport.player_rate_limits = await purgerParLots("player_rate_limits", `expires_at=lt.${enc(new Date(now).toISOString())}`, "key", opts)
    .catch((e) => {
      if (!tableAbsente(e)) throw e;
      return { examinees: 0, supprimees: 0, tronque: false, sautee: "table absente — l'hôte fournit ses propres compteurs de débit" };
    });

  // Liens révoqués : seulement là où la révocation est DATÉE (0013).
  const dateDispo = await require("./schema").attendue("revocationDatee");
  rapport.commercial_doc_shares = dateDispo
    ? await purgerParLots("commercial_doc_shares", `revoked=eq.true&revoked_at=lt.${enc(borne(now, f.liensRevoquesMois))}`, "slug", opts)
    : { examinees: 0, supprimees: 0, tronque: false };

  // Cache de voix : les objets d'abord, la trace ensuite. Voir `purgerCacheDeVoix`.
  rapport.doc_tts_objects = await purgerCacheDeVoix(opts, borne(now, f.voixMois));

  // Présentations mortes : bornées à PLAFOND_PRESENTATIONS par exécution ; la ligne, ses messages,
  // ses présences — et les fichiers du bucket si storage.remove est fourni (OPTIONNELLE).
  const bPres = borne(now, f.presentationsMois);
  // ⚠️ On interroge PLAFOND+1 pour départager « pile PLAFOND présentations, rien après » (non
  // tronqué) de « il y en a plus » — `>= PLAFOND` seul rendait un faux positif à exactement 500
  // (P3 douzième audit : annoncé en 0.1.82, mais l'édition avait été perdue, sans essai pour la
  // garder — c'est cet essai-ci qui manquait).
  const mortesLot = await PLAYER.db.request(`doc_presentations?active=eq.false&updated_at=lt.${enc(bPres)}&select=slug&order=slug.asc&limit=${PLAFOND_PRESENTATIONS + 1}`);
  const troncPres = Array.isArray(mortesLot) && mortesLot.length > PLAFOND_PRESENTATIONS;
  const mortes = Array.isArray(mortesLot) ? mortesLot.slice(0, PLAFOND_PRESENTATIONS) : [];
  // ⚠️ BUDGET GLOBAL AUX PRÉSENTATIONS (P2 dixième audit). Le plafond n'était appliqué qu'À CHAQUE
  // présentation : 500 présentations × 5 000 = 2,5 M de messages en une exécution, timeout et
  // contention avec le chat. Deux budgets partagés — messages et présences — décrémentés au fil
  // des présentations ; la boucle s'arrête quand ils sont épuisés (tronque), sans supprimer les
  // parents restants. En dry-run, on parcourt quand même pour REMONTER ce que la vraie purge
  // ferait (examinés), sans jamais détruire.
  const presRapport = { examinees: 0, supprimees: 0, messages: 0, presences: 0, messagesExaminees: 0, presencesExaminees: 0, fichiers: 0, fichiersErreur: 0, fichiersCandidats: 0, tronque: troncPres };
  let budgetMessages = opts.plafond, budgetPresences = opts.plafond;
  for (const p of (Array.isArray(mortes) ? mortes : [])) {
    const slug = p && p.slug; if (!slug) continue;
    if (budgetMessages <= 0 && budgetPresences <= 0) { presRapport.tronque = true; break; }   // budgets épuisés
    presRapport.examinees += 1;
    const msgs = await purgerMessagesPresentation(slug, opts, base, budgetMessages);
    presRapport.messages += msgs.supprimees;
    presRapport.messagesExaminees += msgs.examinees;
    presRapport.fichiers += msgs.fichiers;
    presRapport.fichiersErreur += msgs.fichiersErreur;
    presRapport.fichiersCandidats += msgs.fichiersCandidats;
    budgetMessages -= opts.dryRun ? msgs.examinees : msgs.supprimees;
    // Présences : interrogées AUSSI en dry-run (pour remonter presencesExaminees), suppression
    // no-op via effacerParIds. Budget global partagé.
    const pres = await purgerParLots("doc_presentation_attendees", `slug=eq.${enc(slug)}`, "attendee_key", opts, Math.max(0, budgetPresences));
    presRapport.presences += pres.supprimees;
    presRapport.presencesExaminees += pres.examinees;
    budgetPresences -= opts.dryRun ? pres.examinees : pres.supprimees;
    // ⚠️ LE RAPPORT DIT LA VÉRITÉ : si un enfant est tronqué, le rapport parent l'est aussi
    // (P2 onzième audit — sinon la supervision croit la purge complète alors qu'un reste subsiste).
    presRapport.tronque = presRapport.tronque || msgs.tronque || pres.tronque;
    // La présentation n'est supprimée que si TOUS ses enfants sont partis (9e audit).
    if (!opts.dryRun && !msgs.tronque && !pres.tronque) {
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
    doc_tts_objects: rapport.doc_tts_objects.supprimees,
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

/**
 * CE QUI RESTE DE L'HÉRITAGE, CHEZ CET HÔTE — les lignes qui portent encore une adresse IP ou un
 * User-Agent brut.
 *
 * ⚠️ POURQUOI CE COMPTEUR EXISTE, ET C'EST UN HÔTE QUI L'A DIT. Nos tables vivent dans la base de
 * nos hôtes, et l'audit d'un hôte énumère SES tables : le schéma d'une dépendance occupe une zone
 * que les inventaires de personne ne visitent. Deux hôtes ont découvert 2361 lignes portant ces
 * colonnes — non pas en surveillant, mais parce qu'un TIERS avait posé une question sur SA base.
 * `retentionSweep` dit « je PEUX purger » ; il ne dit pas CE QUI S'ACCUMULE. Ce compteur le dit,
 * chez chacun, sans que personne ait à y penser.
 *
 * ⚠️ ET IL RÉPOND À LA QUESTION QUI DÉCIDE DU RETRAIT DES COLONNES. `0026` et `0027` VIDENT sans
 * supprimer, parce qu'une migration doit rester sûre pendant que la version précédente du code
 * tourne. Le retrait attend que plus aucune version supportée ne les écrive — une condition qu'on
 * ne peut aujourd'hui que SUPPOSER, en croyant savoir quelle version tourne chez qui. `vide` la
 * rend LISIBLE.
 *
 * ⚠️ ON COMPTE DES LIGNES, PAS UN `count=exact`. La capacité `db` de l'hôte rend le corps de la
 * réponse, pas ses en-têtes : le compte de PostgREST voyage dans `Content-Range`, donc il serait
 * illisible sans élargir le contrat d'hôte — que des hôtes tiers implémentent eux-mêmes.
 * D'où un comptage BORNÉ : au plus `BORNE_RESTE` identifiants, une seule petite colonne.
 *
 * ⚠️ CE CHOIX A UN COÛT, ET IL EST NOMMÉ ICI PLUTÔT QUE SUBI : lire des LIGNES, c'est dépendre des
 * plafonds de qui les rend, et un hôte a mesuré que ce plafond peut être SOUS notre borne. Le
 * compte d'en-tête n'a pas de plafond à deviner et ne transporte rien ; il est strictement
 * supérieur, et le seul obstacle est le contrat. Tant que le contrat ne le rend pas, `resteApres`
 * rattrape la seule chose qui rendait le nombre MENSONGER — l'affirmation d'exactitude.
 *
 * ⚠️ ET LA SATURATION SE DIT, ELLE NE SE DEVINE PAS — deux hôtes ont trouvé ce défaut dans la
 * première version, le même jour, indépendamment. Elle demandait `limit=BORNE` et publiait
 * `lignes.length` : sur une base portant cinq mille adresses, elle rendait `1000`, que rien ne
 * distinguait d'un compte exact de mille. Un nombre faux qui se lit comme juste — pire qu'un
 * nombre absent, parce que l'absence fait chercher et que le nombre fait conclure.
 *
 * Le remède vivait à trois cents lignes d'ici : `purgerRetention` rend `tronque` depuis toujours,
 * pour exactement cette raison. On demande donc `BORNE + 1` : en recevoir autant prouve qu'il en
 * reste, sans coûter une ligne de plus. `n` reste plafonné à la borne, et `tronque` dit qu'il faut
 * le lire « au moins ».
 *
 * ⚠️ ET CE CORRECTIF ÉTAIT LUI-MÊME FAUX, D'UN CRAN PLUS LOIN — trouvé par un hôte réel QUATRE
 * HEURES après sa publication. Il comparait le nombre de lignes reçues à NOTRE borne, donc il
 * supposait que le seul plafond fût le nôtre. PostgREST en a un autre, `db-max-rows`, réglé à 1000
 * par défaut chez Supabase : le serveur tronque EN AMONT, et la comparaison porte alors sur le
 * mauvais nombre. Une table de 1651 lignes se lisait `1000` avec `tronque: false` — pire que la
 * version d'avant, qui ne prétendait rien là où celle-ci AFFIRMAIT l'exactitude. `resteApres`
 * ci-dessous pose désormais la seule question dont la réponse ne dépend d'aucun plafond.
 *
 * ⚠️ ET LE COÛT EST INVERSE DE L'INTUITION, donc il est dit plutôt que caché : quand il reste
 * beaucoup de lignes, la base s'arrête à la borne et c'est rapide ; quand il n'en reste AUCUNE,
 * elle parcourt la table pour ne rien trouver. Le cas cher est le cas terminal — celui où ce
 * compteur a fini son office et disparaîtra avec les colonnes qu'il surveille. Il ne s'exécute
 * d'ailleurs que sur `?contract=1&schema=1`, le seul mode où l'appelant demande la base.
 *
 * ⚠️ UN ÉCHEC REND `null`, JAMAIS ZÉRO. Zéro est la réponse qui autorise à supprimer une colonne :
 * la fabriquer à partir d'une sonde en panne serait le pire mensonge que cette carte puisse faire.
 */
// ⚠️ CINQ MILLE, ET LE NOMBRE VIENT D'UNE MESURE. Il valait mille, et le banc écrit avec les
// volumes RÉELS d'un hôte l'a fait rougir : sa table de vues en portait 1651. La borne saturait
// donc dès le premier jour chez lui, et un compteur qui plafonne sous les volumes qu'il est censé
// décrire ne décrit rien. Cinq mille couvre les deux hôtes connus avec de la marge, reste une
// seule petite colonne à transférer, et `tronque` dit le reste. La borne est un plafond de COÛT,
// pas une opinion sur ce qu'un hôte peut avoir.
const BORNE_RESTE = 5000;

const SONDES_RESTE = [
  ["sessionsIp", "commercial_doc_sessions", "session_id", "ip"],
  ["sessionsUa", "commercial_doc_sessions", "session_id", "ua"],
  ["vuesUa", "commercial_doc_views", "id", "ua"],
];

/** Les tables regardées, pour le dénominateur — une par table, pas une par sonde. */
const TABLES_RESTE = [["sessions", "commercial_doc_sessions", "session_id"],
  ["vues", "commercial_doc_views", "id"]];

/**
 * ⚠️ ET LA COLONNE DISPARUE EST UN ÉTAT CONNU, PAS UNE PANNE. Le jour où un exploitant supprime ces
 * colonnes — le geste que ce compteur sert à autoriser — la requête échoue avec le
 * `42703` de PostgreSQL, « colonne inexistante ». Rendre `null` ferait alors lire « on ne sait
 * pas » au moment EXACT où l'on sait le mieux : plus rien ne peut porter une colonne qui n'existe
 * plus. Le compteur deviendrait aveugle précisément quand son sujet est réglé.
 *
 * Toute autre erreur reste `null`. Et un hôte dont la capacité `db` ne rend pas le corps analysé
 * retombe sur `null` : ne pas savoir est le côté sûr, puisque zéro est ce qui autorise à supprimer.
 */
const COLONNE_ABSENTE = "42703";

/**
 * `{ n, tronque, voie }` — `n` nul veut dire indéterminé, jamais zéro.
 *
 * ⚠️ ET `voie` NOMME LE MÉCANISME QUI A PRODUIT LE NOMBRE, parce que le nombre seul ne le dit pas.
 * Un compte exact et un compte borné NON tronqué rendent le même JSON : deux hôtes l'ont relevé le
 * même jour, l'un en constatant qu'il ne pouvait pas vérifier sa propre couture, l'autre en
 * écrivant un contrôle qui n'a marché que par chance de volume — sa table dépassait mille, donc la
 * voie par lignes était structurellement incapable de rendre son chiffre. Sous mille, personne ne
 * peut trancher, et un `db.count` qui rend une chaîne retombe SILENCIEUSEMENT sur la voie bornée :
 * l'hôte croit sa couture branchée alors qu'elle ne sert pas.
 */
const compte = (n, tronque, voie) => ({ n, tronque, voie });

const VOIE_EXACTE = "exact";
const VOIE_BORNEE = "bornee";

/**
 * ⚠️ « MOINS QUE DEMANDÉ » NE PROUVE PAS LA FIN — ET C'EST UN HÔTE RÉEL QUI L'A MONTRÉ.
 *
 * La version précédente comparait le nombre de lignes reçues à NOTRE borne, et concluait « pas
 * tronqué » dès qu'il était plus petit. Elle supposait que le seul plafond fût le nôtre. PostgREST
 * en a un autre, `db-max-rows`, que Supabase règle à 1000 : le serveur rend 1000 lignes quoi qu'on
 * demande. Sur une table de 1651 lignes, la carte a donc publié `1000` AVEC `tronque: false` —
 * c'est-à-dire le défaut qu'on venait de corriger, déplacé d'un cran et AGGRAVÉ : la version d'avant
 * ne prétendait rien, celle-là AFFIRMAIT que le nombre était exact.
 *
 * Le contrôle honnête ne porte donc pas sur une borne connue, mais sur la seule question dont la
 * réponse ne dépend d'aucun plafond : « y a-t-il quelque chose APRÈS ce que j'ai reçu ? » On la
 * pose en demandant UNE ligne au-delà de la dernière reçue. Une ligne rendue prouve qu'il en
 * reste ; aucune prouve que le lot reçu était le tout — quel que soit le plafond qui l'a produit,
 * et sans avoir à le connaître.
 *
 * ⚠️ PAR CURSEUR KEYSET (`cle=gt.<dernier>`), PAS PAR `offset` — et cette phrase est déjà écrite
 * trois cent quatre-vingts lignes plus haut, au-dessus de `purgerParLots`, où elle dit la même
 * chose depuis toujours : la garde de portabilité de la forge interdit `offset=`, et un curseur
 * est de toute façon stable sous écriture concurrente. Première rédaction de cette sonde : par
 * `offset`. La forge l'a refusée. C'est la SECONDE fois dans ce fichier qu'un remède déjà présent
 * n'a pas été vu — après le drapeau `tronque` de `purgerParLots`. Un fichier dont on vient
 * d'écrire la partie difficile se relit mal, et c'est un fait à traiter, pas une excuse.
 *
 * ⚠️ ET CE QU'ELLE NE COUVRE PAS EST DIT, PARCE QU'UNE GARDE MUETTE VAUT MOINS QUE PAS DE GARDE :
 * un plafond serveur à ZÉRO reste indiscernable d'une table vide par le corps seul — les deux
 * requêtes rendent zéro ligne. C'est la limite de la lecture par lignes, et la raison pour laquelle
 * le compte d'en-tête (`Content-Range` sous `Prefer: count=exact`) lui est strictement supérieur :
 * il ne dépend d'aucun plafond. Il demanderait d'élargir la capacité `db` du contrat d'hôte, qui ne
 * rend aujourd'hui que le corps analysé.
 *
 * ⚠️ LES DEUX AUTRES VOIES ONT ÉTÉ MESURÉES CHEZ UN HÔTE, PAS SUPPOSÉES ICI. On les note pour que
 * personne ne les repropose dans six mois en croyant qu'elles n'ont jamais été essayées :
 *
 *   `?select=count()` — MORT. `db-aggregates-enabled` vaut `false` par défaut, vérifié sur DEUX
 *   projets Supabase distincts. Et la mesure est solide pour une raison qui vaut d'être dite :
 *   l'erreur `PGRST123` arrive AVANT le contrôle de droits — la même table, interrogée sans
 *   agrégat, rend `42501 permission denied`. La réponse ne dépend donc ni des droits ni d'un
 *   `revoke` : c'est une propriété de la CONFIGURATION, pas de l'autorisation. C'était la voie
 *   qu'on aurait préférée, puisqu'elle n'engageait aucun contrat.
 *
 *   `Prefer: count=exact` + `Range: 0-0` — MARCHE. Le compte exact voyage dans l'en-tête, le corps
 *   ne transporte rien. C'est donc la SEULE des deux qui existe, et son seul obstacle est le
 *   contrat d'hôte.
 */
async function resteApres(chemin, cle, dernier) {
  // Sans curseur lisible, la fin ne se prouve pas : « au moins » est le seul côté sûr.
  if (dernier == null) return true;
  try {
    const suite = await PLAYER.db.request(
      `${chemin}&${cle}=gt.${enc(String(dernier))}&order=${cle}.asc&limit=1`, { timeoutMs: 8000 });
    // Pas de réponse analysable ⇒ on ne sait pas ⇒ « au moins ». Se tromper vers le minorant ne
    // fait que sous-estimer ; se tromper vers l'exactitude fait conclure.
    return !Array.isArray(suite) || suite.length > 0;
  } catch { return true; }
}

/**
 * ⚠️ LA VOIE EXACTE, QUAND L'HÔTE LA FOURNIT — ET LE CONTRAT DEMANDE LA QUESTION, PAS LE MÉCANISME.
 * `db.count(chemin)` rend « combien de lignes ce chemin sélectionne-t-il ». Un hôte PostgREST y
 * répond par `Prefer: count=exact` ; un hôte sur une autre base par un `count(*)`. Nommer l'en-tête
 * dans le contrat l'aurait rendu PostgREST-seulement, ce que la règle de portabilité refuse.
 *
 * ⚠️ ELLE EST OPTIONNELLE, ET SON ABSENCE N'EST PAS UNE PANNE. Des hôtes tiers implémentent la
 * capacité `db` eux-mêmes ; exiger une méthode nouvelle les casserait tous. Absente, on retombe sur
 * le comptage borné ci-dessous, qui reste juste — seulement moins précis. C'est la seule forme
 * d'ajout au contrat que ce dépôt s'autorise : celle dont le repli est le comportement d'avant.
 *
 * ⚠️ ET TOUT CE QUI N'EST PAS UN ENTIER POSITIF RETOMBE, plutôt que d'être cru. Un hôte qui rend
 * `undefined`, une chaîne, ou un négatif n'a pas répondu à la question — le lire comme un compte
 * fabriquerait le chiffre que ce fichier existe pour ne pas fabriquer.
 */
async function compteExact(chemin) {
  // ⚠️ SORTIE ANTICIPÉE, PAS GARDE — ET LA DISTINCTION EST MESURÉE. Le `catch` ci-dessous suffirait
  // à la correction : appeler une méthode absente lève, on retombe, le résultat est le même. Muté
  // en `if (!PLAYER.db)`, AUCUN banc ne rougit — c'est dit ici plutôt que laissé croire à une
  // protection. Ce que cette ligne achète est un COÛT : sans elle, tout hôte qui n'implémente pas
  // `count` construirait cinq exceptions à chaque lecture de carte, pour rien.
  if (!PLAYER.db || typeof PLAYER.db.count !== "function") return null;
  try {
    const n = await PLAYER.db.count(chemin);
    return Number.isInteger(n) && n >= 0 ? n : null;
  } catch {
    // ⚠️ ON NE RECOPIE PAS ICI LA RÈGLE DE LA COLONNE ABSENTE. Une première rédaction traitait le
    // `42703` sur cette voie aussi, pour rendre zéro « comme l'autre ». Muté, ce branchement n'a
    // fait rougir aucun banc — et pour une raison de fond, pas par manque de cas : une colonne
    // supprimée fait échouer LES DEUX voies de la même façon, donc le repli rend déjà ce zéro. Le
    // branchement n'ajoutait rien d'observable et créait un SECOND endroit où tenir la même règle.
    return null;   // on ne sait pas ⇒ on essaie l'autre voie, qui elle sait lire le 42703
  }
}

async function compterBorne(chemin, cle) {
  // ⚠️ UN COMPTE EXACT N'EST NI BORNÉ NI TRONQUÉ, quelle que soit sa taille : `borne` décrit la
  // méthode par lignes, pas celle-ci. `tronque: false` garde donc le sens qu'il a partout —
  // « lisez ce nombre comme exact » — au lieu d'en prendre un second selon la voie employée.
  const exact = await compteExact(chemin);
  if (exact !== null) return compte(exact, false, VOIE_EXACTE);
  try {
    // ⚠️ BORNE + 1 : la ligne excédentaire ne sert qu'à PROUVER qu'il en reste. On ne la publie pas.
    // ⚠️ ET L'ORDRE N'EST PAS DÉCORATIF : sans lui, « la dernière ligne reçue » ne désigne aucune
    // frontière, et le curseur de la sonde ne voudrait rien dire.
    const lignes = await PLAYER.db.request(
      `${chemin}&order=${cle}.asc&limit=${BORNE_RESTE + 1}`, { timeoutMs: 8000 });
    if (!Array.isArray(lignes)) return compte(null, false, VOIE_BORNEE);
    // Notre propre borne atteinte : la preuve est dans la ligne excédentaire, rien à demander.
    if (lignes.length > BORNE_RESTE) return compte(BORNE_RESTE, true, VOIE_BORNEE);
    // Zéro ligne : la sonde au-delà rendrait zéro elle aussi et n'apprendrait rien — y compris sous
    // un plafond à zéro, que ni l'une ni l'autre ne distingue d'une table vide.
    if (!lignes.length) return compte(0, false, VOIE_BORNEE);
    return compte(lignes.length, await resteApres(chemin, cle, lignes[lignes.length - 1][cle]),
      VOIE_BORNEE);
  } catch (e) {
    if (e && e.details && e.details.code === COLONNE_ABSENTE) return compte(0, false, VOIE_BORNEE);
    return compte(null, false, VOIE_BORNEE);   // indéterminé — surtout pas zéro
  }
}

const compterReste = (table, cle, colonne) =>
  compterBorne(`${table}?select=${cle}&${colonne}=not.is.null`, cle);

/**
 * ⚠️ ET LE COMPTEUR PORTE CE QU'IL A REGARDÉ — un hôte nous l'a demandé, et il avait raison.
 *
 * `sessionsIp: 0` ne distingue pas trois choses : « purgé », « jamais écrit », et « la sonde vise à
 * côté ». Les deux premières se valent pour qui veut supprimer une colonne ; la troisième est un
 * mensonge. Le dénominateur les sépare : « 0 sur 1908 lignes examinées » dit qu'il y avait quelque
 * chose à regarder, « 0 sur 0 » dit que la table est vide ou hors d'atteinte et que le zéro ne
 * prouve rien.
 *
 * C'est notre propre règle anti-vacuité — un plancher compte la FORME RECONNUE, pas les choses
 * comptées — appliquée partout dans `tools/` et absente d'ici jusqu'à ce qu'un lecteur la réclame.
 *
 * ⚠️ ET IL NE COÛTE PRESQUE RIEN, à l'inverse du compte filtré : sans filtre, la base s'arrête à la
 * borne dès les premières lignes. Une par TABLE, pas une par sonde — deux des trois colonnes vivent
 * dans la même.
 */
const compterLignes = (table, cle) => compterBorne(`${table}?select=${cle}`, cle);

async function resteDeLaPurge() {
  const [comptes, totaux] = await Promise.all([
    Promise.all(SONDES_RESTE.map(([, t, c, col]) => compterReste(t, c, col))),
    Promise.all(TABLES_RESTE.map(([, t, c]) => compterLignes(t, c))),
  ]);
  // ⚠️ ACCUMULATEURS NUS, comme celui de `fenetresValidees` plus haut et pour la même raison : la
  // garde de forme reconnaît `Object.create(null)`, et une écriture indexée par autre chose qu'un
  // littéral n'a alors aucun prototype à polluer. Les clés viennent ici de constantes du fichier,
  // mais un objet nu ne coûte rien et la propriété se lit sans avoir à remonter leur provenance.
  const parTable = Object.create(null);
  TABLES_RESTE.forEach(([nom], i) => { parTable[nom] = totaux[i].n; });
  const out = Object.create(null);
  out.borne = BORNE_RESTE;
  // ⚠️ UN SEUL DRAPEAU POUR TOUT LE BLOC, parce qu'il ne sert qu'à une chose : dire au lecteur que
  // les nombres qu'il voit sont des minorants. Un drapeau par compte suggérerait qu'on peut faire
  // confiance aux autres, alors que la borne est commune et que la question ne l'est pas.
  out.tronque = [...comptes, ...totaux].some((c) => c.tronque);
  out.lignes = parTable;
  // ⚠️ UNE SEULE RÉPONSE POUR LES CINQ COMPTES, ET TROIS ÉTATS PLUTÔT QUE DEUX. La question qu'un
  // hôte se pose est « ma couture sert-elle ? », pas « laquelle des cinq ». `"mixte"` n'est pas une
  // commodité : il arrive vraiment — un `count` qui lève sur le chemin d'une colonne supprimée et
  // répond sur le total de la même table — et c'est précisément le cas qu'un drapeau binaire
  // aurait dû arrondir dans un sens ou dans l'autre, donc mentir.
  //
  // ⚠️ CE CHAMP NE DIT RIEN SUR LA JUSTESSE DES NOMBRES, seulement sur leur provenance. Il ne
  // double aucun autre : `tronque` vaut `false` sur les DEUX voies, c'est même toute la raison
  // d'être de cette ligne.
  const voies = [...comptes, ...totaux].map((c) => c.voie);
  out.voie = voies.every((v) => v === VOIE_EXACTE) ? VOIE_EXACTE
    : voies.every((v) => v === VOIE_BORNEE) ? VOIE_BORNEE : "mixte";
  SONDES_RESTE.forEach(([nom], i) => { out[nom] = comptes[i].n; });
  // ⚠️ TROIS ÉTATS, PAS DEUX. `true` : plus rien, le retrait des colonnes est permis ICI. `false` :
  // il reste des lignes. `null` : au moins une sonde n'a pas répondu — on ne sait pas, et « on ne
  // sait pas » ne doit jamais se lire comme « c'est bon ».
  // ⚠️ `vide` RESTE JUSTE MÊME SATURÉ, et c'est ce qui compte : c'est le champ qui autorise le
  // retrait d'une colonne, et la saturation ne peut le rendre que FAUX — jamais vrai à tort.
  out.vide = comptes.some((c) => c.n === null) ? null : comptes.every((c) => c.n === 0);
  return out;
}

module.exports = { init, purgerRetention, tick, borne, resteDeLaPurge, BORNE_RESTE };
