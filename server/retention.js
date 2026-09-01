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
 * illisible sans élargir le contrat d'hôte — ce qu'un compteur de diagnostic ne justifie pas.
 * D'où un comptage BORNÉ : au plus `BORNE_RESTE` identifiants, une seule petite colonne. Atteindre
 * la borne se lit « au moins autant », jamais « exactement ».
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
const BORNE_RESTE = 1000;

const SONDES_RESTE = [
  ["sessionsIp", "commercial_doc_sessions", "session_id", "ip"],
  ["sessionsUa", "commercial_doc_sessions", "session_id", "ua"],
  ["vuesUa", "commercial_doc_views", "id", "ua"],
];

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

async function compterReste(table, cle, colonne) {
  try {
    const lignes = await PLAYER.db.request(
      `${table}?select=${cle}&${colonne}=not.is.null&limit=${BORNE_RESTE}`,
      { timeoutMs: 8000 },
    );
    return Array.isArray(lignes) ? lignes.length : null;
  } catch (e) {
    if (e && e.details && e.details.code === COLONNE_ABSENTE) return 0;
    return null;   // indéterminé — surtout pas zéro
  }
}

async function resteDeLaPurge() {
  const comptes = await Promise.all(SONDES_RESTE.map(([, t, c, col]) => compterReste(t, c, col)));
  const out = { borne: BORNE_RESTE };
  SONDES_RESTE.forEach(([nom], i) => { out[nom] = comptes[i]; });
  // ⚠️ TROIS ÉTATS, PAS DEUX. `true` : plus rien, le retrait des colonnes est permis ICI. `false` :
  // il reste des lignes. `null` : au moins une sonde n'a pas répondu — on ne sait pas, et « on ne
  // sait pas » ne doit jamais se lire comme « c'est bon ».
  out.vide = comptes.some((n) => n === null) ? null : comptes.every((n) => n === 0);
  return out;
}

module.exports = { init, purgerRetention, tick, borne, resteDeLaPurge, BORNE_RESTE };
