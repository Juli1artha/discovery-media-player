// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE PRODUCTEUR D'ARTEFACT DE CHARGE — un programme, pas un banc, et la différence est le point.
//
// Un banc rend vert ou rouge ; ce programme rend UN DOCUMENT, même quand la course échoue
// (`complete: false`, avec la phase et la raison), parce qu'une absence d'artefact ne doit jamais
// ressembler à un banc réussi (audit, 14/09). Il joue la séquence `100 → 1 000 → 100` demandée par
// l'audit — le second bénéficie du JIT et des caches du premier, le troisième est le témoin — dans le
// MÊME processus, sur le même runner, contre le vrai PostgREST de la forge, et écrit un artefact
// par position, conforme à `charge/artefact.schema-<N>.json`, jugés ensuite EN COHORTE par
// `tools/artefact-de-charge.mjs` : même course, positions 1..n, tout ce qui doit être constant l'est.
//
// ⚠️ CE QU'IL MESURE : le scénario `state-hot` — `GET ?present=<slug>&state=1`, la lecture que mille
// spectateurs font toutes les 25 secondes, mutualisée par le cache de lecture. Chaque position reçoit
// SA présentation (données distinctes, `datasetId` = le slug), sa page (= le rang, pour qu'un état
// venu d'une autre présentation soit détectable), un préchauffage hors mesure, puis un générateur EN
// BOUCLE OUVERTE : les requêtes partent à l'heure prévue, la réponse précédente soit revenue ou non,
// et le retard du générateur est mesuré (`generatorLagMs`) — un générateur saturé qui attendrait
// enverrait moins que prévu et fabriquerait de bons percentiles (omission coordonnée).
//
// ⚠️ CE QU'IL NE STOCKE PAS : le débit, le coût par requête — dérivables, donc recalculés par le
// lecteur, jamais écrits (un chiffre dérivé stocké peut diverger de ce qu'il dérive). Et il ne juge
// rien : aucun seuil ici. Le jugement est dans le validateur, sur la FORME et les INVARIANTS ; la
// comparaison entre trains est le travail de qui lit la série.
//
// `node --expose-gc charge/rapport.js --sortie=<dossier> [--sequence=100,1000,100] [--par-spectateur=10]`
// Variables : PLAYER_TEST_POSTGREST_URL, PLAYER_TEST_JWT_SECRET (comme la campagne),
// PLAYER_RAPPORT_POSTGRES / PLAYER_RAPPORT_POSTGREST (les versions, que la forge connaît et pas
// nous ; la seconde se demande à PostgREST lui-même quand elle n'est pas fournie), et
// PLAYER_RAPPORT_PR_HEAD — la tête de la branche d'une PR, que SEUL le YAML peut lire
// (`github.event.pull_request.head.sha`) : aucune variable d'environnement ne la porte.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { pathToFileURL } = require("node:url");
const { monitorEventLoopDelay } = require("node:perf_hooks");
const { Writable } = require("node:stream");

const RACINE = path.join(__dirname, "..");
/** Les classes FIXES de l'histogramme : l'échelle de la carte (`seauxMs`), précédée de 0. Nommées par leur empreinte. */
const EDGES_MS = [0, 1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const MIO = 1024 * 1024;

const versMio = (o) => Math.round((o / MIO) * 100) / 100;
const arrondi = (x) => Math.round(x * 1000) / 1000;

/** Quantile par rang le plus proche sur une liste TRIÉE — min ≤ p50 ≤ p95 ≤ p99 ≤ max par construction. */
function quantile(tries, p) {
  if (!tries.length) return 0;
  return tries[Math.min(tries.length - 1, Math.max(0, Math.ceil((p / 100) * tries.length) - 1))];
}

/** `{ n, min, mean, p50, p95, p99, max }` d'une liste de nombres (non triée). */
function centiles(valeurs) {
  const tries = [...valeurs].sort((a, b) => a - b);
  const n = tries.length;
  const somme = tries.reduce((x, y) => x + y, 0);
  return {
    n, min: n ? arrondi(tries[0]) : 0, mean: n ? arrondi(somme / n) : 0,
    p50: arrondi(quantile(tries, 50)), p95: arrondi(quantile(tries, 95)), p99: arrondi(quantile(tries, 99)), max: n ? arrondi(tries[n - 1]) : 0,
  };
}

/**
 * L'histogramme à classes FIXES : la classe i est [edges[i], edges[i+1]) — borne basse incluse, haute
 * exclue, une valeur égale à une borne tombe dans la classe qui y commence ; au-delà de la dernière
 * borne, `overflow`, pour que des bornes fixes ne perdent aucune observation et n'aient jamais à bouger.
 */
function histogramme(valeurs, edges, binSetIdDe) {
  const counts = new Array(edges.length - 1).fill(0);
  let overflow = 0;
  for (const v of valeurs) {
    if (v >= edges[edges.length - 1]) { overflow += 1; continue; }
    let i = edges.length - 2;
    while (i > 0 && v < edges[i]) i -= 1;
    counts[i] += 1;
  }
  return { unit: "ms", binSetId: binSetIdDe(edges), edges, counts, overflow };
}

/** Catégories DISJOINTES : 429 hors other4xx, 503 hors other5xx, other pour 1xx et 3xx ; une réponse jamais rendue (statut 0 ou 599) est une other5xx. */
function classerStatuts(statuts) {
  const c = { "2xx": 0, "429": 0, other4xx: 0, "503": 0, other5xx: 0, other: 0 };
  for (const s of statuts) {
    if (s >= 200 && s < 300) c["2xx"] += 1;
    else if (s === 429) c["429"] += 1;
    else if (s >= 400 && s < 500) c.other4xx += 1;
    else if (s === 503) c["503"] += 1;
    else if (s >= 500 || s < 100) c.other5xx += 1;
    else c.other += 1;
  }
  return c;
}

// ⚠️ CES DEUX PÉRIODES SONT DES CONDITIONS DE LECTURE, PAS DES RÉGLAGES. Le pic mémoire est le
// maximum VU tous les 50 ms — un pic plus court passe entre deux échantillons — et le p99 de boucle
// ne descend jamais sous la résolution du moniteur. Elles sont donc écrites DANS l'artefact, et
// définies ici pour que l'instrument et ce qu'il déclare ne puissent pas diverger.
const PERIODE_MEMOIRE_MS = 50;

/**
 * L'horloge des bornes de fenêtre, INJECTABLE — et ce n'est pas un confort de banc.
 *
 * ⚠️ « LES TROIS BORNES DÉSIGNENT LA MÊME PÉRIODE » NE SE PROUVE PAS À LA MONTRE. Un banc qui
 * compare `processUptimeEnd − processUptimeStart` à `durationMs` sous une tolérance ne décide rien :
 * sur un double en mémoire, la présentation et le préchauffage qu'il s'agit justement d'EXCLURE
 * prennent quelques millisecondes, et le défaut passe sous n'importe quel seuil qu'on ose écrire.
 * Trop serré, le banc devient instable sous charge ; trop large, il ne voit plus rien. Avec une
 * horloge pilotée, la propriété redevient exacte. La consigne vient de l'audit (CODEX, 15/09), et
 * ma première version l'avait ignorée : c'est la campagne de mutations qui l'a rappelée, en laissant
 * survivre le mutant qui rouvre la fenêtre trop tôt.
 */
const HORLOGE = { uptimeMs: () => Math.round(process.uptime() * 1000), instant: () => new Date().toISOString() };
const RESOLUTION_BOUCLE_MS = 10;

/** Le plafond mémoire du processus, de la source qui le sert — ou null et `unknown`, jamais un chiffre deviné. */
function plafondMemoire(env = process.env, lire = (f) => fs.readFileSync(f, "utf8")) {
  try { const v = lire("/sys/fs/cgroup/memory.max").trim(); if (/^\d+$/.test(v)) return { memoryLimitMiB: Math.max(1, Math.round(Number(v) / MIO)), memoryLimitSource: "cgroup" }; } catch { /* pas de cgroup v2 lisible */ }
  if (/^\d+$/.test(String(env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || ""))) return { memoryLimitMiB: Math.max(1, Number(env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE)), memoryLimitSource: "lambda-env" };
  if (env.GITHUB_ACTIONS) return { memoryLimitMiB: Math.max(1, Math.round(os.totalmem() / MIO)), memoryLimitSource: "runner" };
  return { memoryLimitMiB: null, memoryLimitSource: "unknown" };
}

/** Une chaîne venue de l'environnement qui finira dans un fichier publié : bornée, filtrée, jamais vide. */
const texteBorne = (v, defaut, max = 120) => {
  const t = String(v == null ? "" : v).replace(/[^\x20-\x7E\u00A0-\u024F]/g, "").trim().slice(0, max);
  return t || defaut;
};

/**
 * L'environnement, à la précision qui rend deux relevés comparables.
 *
 * ⚠️ `cpuCount` NE SUFFIT PAS. Deux runners du même fournisseur, à nombre de cœurs égal, n'ont pas
 * le même processeur — et les latences en dépendent bien plus. De même, `process.memoryMiB.peak`
 * n'est pas « le maximum » mais « le maximum VU à la cadence d'échantillonnage » : sans cette
 * période, le chiffre n'est pas interprétable, et un pic plus court passe entre deux relevés.
 * Ajouts demandés par un audit externe (CODEX, 15/09).
 */
function environnement(env = process.env, { memorySampleIntervalMs = PERIODE_MEMOIRE_MS, eventLoopResolutionMs = RESOLUTION_BOUCLE_MS } = {}) {
  const cpus = os.cpus();
  return {
    node: process.version, os: `${os.platform()} ${os.release()}`, arch: os.arch(), cpuCount: Math.max(1, cpus.length),
    cpuModel: texteBorne(cpus[0] && cpus[0].model, "inconnu"),
    runnerProvider: texteBorne(env.RUNNER_ENVIRONMENT || (env.GITHUB_ACTIONS ? "github-hosted" : ""), "local"),
    runnerImage: texteBorne(env.ImageOS || env.RUNNER_IMAGE || "", "inconnue"),
    memorySampleIntervalMs, eventLoopResolutionMs,
    ...plafondMemoire(env),
    postgresVersion: String(env.PLAYER_RAPPORT_POSTGRES || ""), postgrestVersion: String(env.PLAYER_RAPPORT_POSTGREST || ""),
  };
}

/** La version de PostgREST, demandée à PostgREST lui-même (racine OpenAPI, `info.version`) — jamais recopiée d'un nom d'image. Chaîne vide s'il ne la dit pas. */
async function versionPostgrest(base, fetchFn = globalThis.fetch) {
  if (!base) return "";
  try {
    const r = await fetchFn(`${String(base).replace(/\/+$/, "")}/rest/v1/`, { headers: { accept: "application/openapi+json" }, signal: AbortSignal.timeout(3000) });
    if (!r.ok) return "";
    const d = await r.json();
    // ⚠️ BORNÉE ET FILTRÉE : cette chaîne vient du réseau et finit dans un fichier. Une version est
    // faite de chiffres, de lettres, de points, de tirets et de plus — rien d'autre, et pas plus de 40.
    const v = d && d.info && typeof d.info.version === "string" ? d.info.version : "";
    return /^[0-9A-Za-z.+-]{1,40}$/.test(v) ? v : "";
  } catch { return ""; }
}

function commitCourant(env = process.env) {
  if (/^[0-9a-f]{40}$/.test(String(env.GITHUB_SHA || ""))) return env.GITHUB_SHA;
  try { return execFileSync("git", ["rev-parse", "HEAD"], { cwd: RACINE, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(); } catch { return "0".repeat(40); }
}

/**
 * L'identité de la course.
 *
 * ⚠️ `commitSha` SEUL EST AMBIGU SUR UNE PR. `GITHUB_SHA` y désigne un commit de FUSION ÉPHÉMÈRE,
 * fabriqué par la forge pour l'occasion et qui n'existera plus ensuite : un artefact qui ne porte que
 * lui ne se relie à aucun objet durable. `prHeadSha` porte alors la tête réelle de la branche, et
 * `event` dit laquelle des deux lectures s'applique. Le dépôt, la référence, le numéro et la
 * tentative complètent : un rejeu est une AUTRE course sur le même commit, et ses chiffres ne se
 * mélangent pas aux précédents. Ajouts demandés par un audit externe (CODEX, 15/09).
 */
function identite({ env = process.env, empreinte, version = require("../package.json").version, quand = new Date() }) {
  const tentative = Number(env.GITHUB_RUN_ATTEMPT) >= 1 ? Math.trunc(Number(env.GITHUB_RUN_ATTEMPT)) : 1;
  const runId = env.GITHUB_RUN_ID ? `gha-${env.GITHUB_RUN_ID}-${tentative}` : `local-${quand.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
  // ⚠️ `GITHUB_HEAD_SHA` N'EXISTE PAS, et le chercher a rendu ce champ MORT. La forge n'expose la
  // tête d'une PR que dans `github.event.pull_request.head.sha`, qu'un workflow doit passer
  // explicitement : `PLAYER_RAPPORT_PR_HEAD` est ce câblage. Tant que le producteur interrogeait un
  // nom inventé, `prHeadSha` valait `null` dans toutes les vraies courses de PR — et le banc restait
  // vert, puisqu'il éprouvait cette fonction sur un environnement fabriqué plutôt que le câblage.
  const tete = String(env.GITHUB_EVENT_NAME || "").startsWith("pull_request") ? String(env.PLAYER_RAPPORT_PR_HEAD || "") : "";
  return {
    commitSha: commitCourant(env), packageVersion: version, timestamp: quand.toISOString(), runId, schemaSha256: empreinte,
    repository: texteBorne(env.GITHUB_REPOSITORY, "local/local"),
    event: texteBorne(env.GITHUB_EVENT_NAME, "local"),
    ref: texteBorne(env.GITHUB_REF, "local"),
    runNumber: Number.isSafeInteger(Number(env.GITHUB_RUN_NUMBER)) && Number(env.GITHUB_RUN_NUMBER) >= 1 ? Number(env.GITHUB_RUN_NUMBER) : null,
    runAttempt: tentative,
    prHeadSha: /^[0-9a-f]{40}$/.test(tete) ? tete : null,
  };
}

/**
 * Ce qui n'est pas mesurable se refuse AVANT de mesurer, et se nomme. Sort en code 2 : ni un succès
 * (0), ni une campagne qui a échoué en produisant son artefact (1) — une configuration qu'on a
 * refusé de jouer, et dont il n'y a donc rien à publier.
 */
class ConfigurationNonMesurable extends Error {
  constructor(message) { super(message); this.name = "ConfigurationNonMesurable"; }
}

/** Le plafond d'un produit `spectateurs × requêtes` : au-delà, on ne mesure plus, on épuise le runner. */
const REQUETES_MAX = 2_000_000;

/**
 * Un entier de configuration, ou un refus NOMMÉ. Jamais de repli silencieux.
 *
 * ⚠️ LE PARSEUR AVALAIT CE QU'IL NE COMPRENAIT PAS. `--sequence=100,bad,1000` était filtré en
 * `[100, 1000]` : la campagne tournait, l'artefact portait une séquence que personne n'avait
 * demandée, et rien ne le disait. `0` passait aussi — une position à zéro spectateur. Un filtre
 * silencieux sur une entrée de mesure est une falsification discrète de l'expérience.
 */
function entierStrict(valeur, nom, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const n = typeof valeur === "number" ? valeur : Number(String(valeur).trim());
  if (!Number.isSafeInteger(n)) throw new ConfigurationNonMesurable(`${nom} : ${JSON.stringify(String(valeur))} n'est pas un entier sûr`);
  if (n < min || n > max) throw new ConfigurationNonMesurable(`${nom} : ${n} hors des bornes [${min}, ${max}]`);
  return n;
}

/** La séquence demandée, entièrement contrôlée — ou un refus qui dit lequel des rangs est fautif. */
function sequenceStricte(brut, { requetesParSpectateur }) {
  const morceaux = String(brut).split(",").map((x) => x.trim());
  if (!morceaux.length || morceaux.some((x) => x === "")) throw new ConfigurationNonMesurable(`séquence ${JSON.stringify(String(brut))} : un rang vide`);
  const sequence = morceaux.map((x, i) => entierStrict(x, `séquence, rang ${i + 1}`));
  // Le multiplicateur est jugé ici AUSSI, et pas seulement par l'appelant : une fonction exportée se
  // fait appeler ailleurs qu'à l'endroit où on l'a écrite, et `× 0` ne mesure rien.
  const parSpectateur = entierStrict(requetesParSpectateur, "lectures par spectateur");
  const total = sequence.reduce((a, b) => a + b, 0) * parSpectateur;
  if (!Number.isSafeInteger(total) || total > REQUETES_MAX) {
    throw new ConfigurationNonMesurable(`séquence ${JSON.stringify(sequence)} × ${parSpectateur} lectures = ${total} requêtes — au-delà de ${REQUETES_MAX}, ce n'est plus une mesure`);
  }
  return sequence;
}

/**
 * L'identifiant de l'algorithme d'ordonnancement, ÉCRIT DANS L'ARTEFACT avec la graine.
 *
 * ⚠️ UNE GRAINE NE REJOUE RIEN SI L'ALGORITHME QUI LA CONSOMME A CHANGÉ. Enregistrer l'une sans
 * l'autre donne l'illusion de la reproductibilité : le jour où cette fonction change, les anciens
 * artefacts ne se rejouent plus et rien ne le dit. Le nom porte donc sa version, et il change avec
 * elle — c'est un contrat de lecture, pas une étiquette.
 */
const ALGORITHME_ORDONNANCEMENT = "uniforme-gigue-uniforme-v1";

/**
 * Un générateur pseudo-aléatoire DÉTERMINISTE (mulberry32) : même graine, même suite, partout.
 *
 * ⚠️ LA GIGUE ÉTAIT TIRÉE DE `Math.random` ET PERDUE. Deux courses du même protocole n'étaient donc
 * pas la même expérience, et aucune des deux ne se rejouait — on ne pouvait ni reproduire un pic ni
 * démontrer qu'un écart venait du code plutôt que du tirage. Défaut relevé par un auditeur externe
 * (CODEX, 15/09).
 */
function alea32(graine) {
  let a = graine >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Les instants de départ d'une boucle ouverte : `n` requêtes réparties sur `dureeMs`, avec ou sans gigue. */
function planifier(n, dureeMs, motif, graine = 0) {
  const alea = typeof graine === "function" ? graine : alea32(graine);
  const pas = n > 1 ? dureeMs / (n - 1) : 0;
  const instants = [];
  for (let i = 0; i < n; i += 1) {
    const base = i * pas;
    instants.push(motif === "jittered" ? Math.max(0, base + (alea() - 0.5) * pas) : base);
  }
  return instants.sort((a, b) => a - b);
}

/**
 * L'artefact d'une position ACHEVÉE, assemblé depuis ce qui a été observé. `observations` :
 * `{ latences, statuts, octets, jugements: { correct, vide, autre }, planifiees, parties, retards, enVolPic }`.
 */
function assembler({ identity, environment, topology, scenario, workload, isolation, fenetre, observations, db, cache, processus, compteurs, binSetIdDe }) {
  const lat = centiles(observations.latences);
  const statuses = classerStatuts(observations.statuts);
  const octets = [...observations.octets].sort((a, b) => a - b);
  return {
    schemaVersion: 1, complete: true, failure: { phase: null, code: null, reason: null },
    identity, environment, topology, scenario,
    workload: { ...workload, scheduledRequests: observations.planifiees, startedRequests: observations.parties, completedRequests: observations.latences.length, generatorLagMs: (() => { const c = centiles(observations.retards); return { p50: c.p50, p95: c.p95, p99: c.p99, max: c.max }; })() },
    isolation, measurementWindow: fenetre,
    latencyMs: lat,
    histogram: histogramme(observations.latences, EDGES_MS, binSetIdDe),
    statuses,
    http: { responseBytes: { total: octets.reduce((x, y) => x + y, 0), p50: quantile(octets, 50), p95: quantile(octets, 95), max: octets.length ? octets[octets.length - 1] : 0 } },
    database: db, cache, process: processus,
    correctness: { correctResponses: observations.jugements.correct, emptyResponses: observations.jugements.vide, wrongPresentation: observations.jugements.autre },
    counters: compteurs,
  };
}

/**
 * Le message public d'un échec : assaini et borné.
 *
 * ⚠️ UN ARTEFACT D'ÉCHEC PART SUR UNE RELEASE PUBLIQUE, et `reason` dérive d'une `Error`. Une erreur
 * PostgREST peut incorporer plusieurs centaines de caractères de réponse réseau ; une erreur de
 * `fetch` porte l'URL appelée, avec ses paramètres. Recopier tel quel, c'est publier ce qu'on n'a pas
 * regardé — exactement la règle que ce producteur applique déjà au slug rendu par la base. Les
 * caractères de contrôle partent, les URL, en-têtes d'autorisation, adresses et paramètres qui
 * ressemblent à des secrets sont remplacés par une marque VISIBLE plutôt que supprimés : un lecteur
 * doit voir qu'il manque quelque chose. Le détail brut reste dans le journal privé de la course.
 * Demandé par un audit externe (CODEX, 15/09).
 */
function messagePublic(brut) {
  let t = String(brut == null ? "" : brut);
  // Les caractères de contrôle se retirent par code, pas par classe d'expression régulière : une
  // classe qui les contient est elle-même illisible, et `no-control-regex` a raison de la refuser.
  t = Array.from(t, (c) => { const n = c.codePointAt(0); return n < 0x20 || n === 0x7F ? " " : c; }).join("");
  t = t.replace(/\b[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s"']+/g, "«url retirée»");
  t = t.replace(/\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, "«adresse retirée»");
  // ⚠️ ON RETIRE JUSQU'AU BOUT DU SEGMENT, PAS UN SEUL MOT. Une première version prenait le
  // mot-clé puis `\S+` : sur « Authorization: Bearer sk-live-4242 refusé » elle mangeait « Bearer »
  // et PUBLIAIT le jeton juste derrière. Une caviarderie qui laisse passer ce qu'elle vise est pire
  // qu'absente — elle donne l'assurance sans la protection. En cas de doute on en retire trop : un
  // mot de contexte perdu se remplace par le journal privé, un secret publié ne se reprend pas.
  t = t.replace(/\b(authorization|apikey|api[-_]?key|token|secret|password|bearer|jwt)\b[^,;\n]*/gi, "$1 «retiré»");
  t = t.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, "«jeton retiré»");
  t = t.replace(/\s{2,}/g, " ").trim();
  return t.slice(0, 600) || "raison absente";
}

/** La cause STABLE d'un échec, déduite de la phase et du message — `reason` est un texte, ceci est une clé. */
function codeEchec(phase, message) {
  const m = String(message || "");
  if (/budget de position dépassé/.test(m)) return "budget";
  if (/échéance/.test(m)) return "deadline";
  if (phase === "presentation") return "presentation";
  if (phase === "warmup") return "warmup";
  if (/postgrest|postgres|base|database/i.test(m)) return "database";
  if (/schéma|schema/i.test(m)) return "schema";
  return "unknown";
}

/** L'artefact d'une position INTERROMPUE : la forme, la raison, rien de mesuré. */
function assemblerEchec({ identity, environment, topology, scenario, workload, isolation, fenetre, phase, reason }) {
  return {
    schemaVersion: 1, complete: false, failure: { phase, code: codeEchec(phase, reason), reason: messagePublic(reason) },
    identity, environment, topology, scenario,
    workload: { ...workload, scheduledRequests: workload.scheduledRequests || 0, startedRequests: workload.startedRequests || 0, completedRequests: workload.completedRequests || 0, generatorLagMs: workload.generatorLagMs || { p50: 0, p95: 0, p99: 0, max: 0 } },
    isolation, measurementWindow: fenetre,
  };
}

/** Aplatit ce que la carte compte en compteurs de processus — les clés que `counters` porte en avant/après/delta. */
function compteursDeLaCarte(carte) {
  const c = {};
  const nombre = (v) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
  c["lectureSaturee.total"] = nombre(carte && carte.lectureSaturee && carte.lectureSaturee.total);
  c["relaisRefuses.total"] = nombre(carte && carte.relaisRefuses && carte.relaisRefuses.total);
  const st = (carte && carte.mesures && carte.mesures.statuts) || {};
  for (const k of ["ok", "refus4xx", "debit429", "occupe503", "erreur5xx"]) c[`mesures.statuts.${k}`] = nombre(st[k]);
  c["mesures.base.n"] = nombre(carte && carte.mesures && carte.mesures.base && carte.mesures.base.n);
  return c;
}
const deltas = (avant, apres) => Object.fromEntries(Object.keys(avant).map((k) => [k, (apres[k] || 0) - (avant[k] || 0)]));

/** L'échéance d'une requête : au-delà, elle ne répondra pas, et l'attendre encore n'apprend rien. */
const ECHEANCE_REQUETE_MS = 30_000;

/**
 * Un appel à travers le handler, chronométré ; la réponse est un vrai flux inscriptible, dont on
 * COMPTE les octets.
 *
 * ⚠️ CE N'EST PAS UN APPEL HTTP DE BOUT EN BOUT, et ce commentaire disait le contraire. Le trajet
 * lecteur → socket → parseur HTTP → `bin/serve.js` n'est PAS exercé : `player.handler` est appelé
 * directement. PostgREST, lui, est réel, et la réponse est un vrai `Writable`. La distinction
 * compte pour qui relit les chiffres seuls : des latences de quelques microsecondes sont cohérentes
 * sous cette topologie, et se liraient comme des latences réseau sans elle. Formulation corrigée
 * après un audit externe (CODEX, 15/09) ; la topologie est désormais ÉCRITE dans l'artefact plutôt
 * que déductible d'un commentaire.
 *
 * ⚠️ ET IL A UNE ÉCHÉANCE, parce qu'un handler qui ne résout jamais bloquait tout. `Promise.all`
 * attendait une promesse suspendue indéfiniment : la course ne finissait pas, n'échouait pas, et
 * n'écrivait AUCUN artefact — le producteur promet pourtant un document même en échec. Défaut
 * relevé par un auditeur externe (CODEX, 15/09).
 */
function appelant(player) {
  return function appeler(requete, { corpsEntier = false, echeanceMs = ECHEANCE_REQUETE_MS } = {}) {
    const TETE_MAX = corpsEntier ? Infinity : 4096;
    const tete = [];
    let octets = 0, gardes = 0;
    const res = new Writable({ write(m, _e, cb) { octets += m.length; if (gardes < TETE_MAX) { tete.push(Buffer.from(m)); gardes += m.length; } cb(); } });
    res.statusCode = 0; res.headers = {};
    // ⚠️ `destroy(erreur)` ÉMET `error`, et un `error` sans écouteur est une exception NON CAPTURÉE
    // qui tue le processus — le producteur mourrait au lieu d'écrire l'artefact d'échec qu'il
    // promet, c'est-à-dire exactement le défaut que l'échéance était censée corriger.
    res.on("error", () => {});
    res.setHeader = function (k, v) { this.headers[String(k).toLowerCase()] = v; };
    res.getHeader = function (k) { return this.headers[String(k).toLowerCase()]; };
    // Le signal voyage DANS la requête synthétique : un handler qui l'observe peut renoncer de
    // lui-même, et celui qui l'ignore se fait couper sa réponse — ce qui le fait renoncer aussi.
    const controleur = new AbortController();
    const requeteSignalee = Object.assign(Object.create(Object.getPrototypeOf(requete) || Object.prototype), requete, { signal: controleur.signal });
    const t0 = process.hrtime.bigint();
    const ms = () => Number(process.hrtime.bigint() - t0) / 1e6;
    let minuterie;
    const echeance = new Promise((resolve) => {
      minuterie = setTimeout(() => {
        controleur.abort();
        res.destroy(new Error("échéance"));
        resolve({ ms: ms(), statut: 598, corps: "", octets, expire: true });
      }, echeanceMs);
      if (typeof minuterie.unref === "function") minuterie.unref();
    });
    const course = player.handler(requeteSignalee, res).then(
      () => ({ ms: ms(), statut: res.statusCode, corps: Buffer.concat(tete).toString("utf8"), octets }),
      (e) => ({ ms: ms(), statut: 599, corps: "", octets: 0, erreur: String((e && e.message) || e) }),
    );
    return Promise.race([course, echeance]).finally(() => clearTimeout(minuterie));
  };
}

/** Juge une réponse 2xx de `?present=&state=1` : la bonne page, une autre, ou rien. */
function juger(reponse, pageAttendue) {
  if (!(reponse.statut >= 200 && reponse.statut < 300)) return null;
  let corps;
  try { corps = JSON.parse(reponse.corps); } catch { return "vide"; }
  if (!corps || !corps.state || typeof corps.state !== "object") return "vide";
  return corps.state.current_page === pageAttendue ? "correct" : "autre";
}

/** Une sonde sur `db.request` : appels, pic en vol, délais dépassés, latences — posée sur la couture, retirée après. */
function sonderBase(base) {
  const vraie = base.request.bind(base);
  let appels = 0, enVol = 0, pic = 0, delais = 0;
  const latences = [];
  base.request = async (chemin, o) => {
    appels += 1; enVol += 1; if (enVol > pic) pic = enVol;
    const t0 = process.hrtime.bigint();
    try { return await vraie(chemin, o); } catch (e) { if (e && (e.name === "TimeoutError" || e.name === "AbortError")) delais += 1; throw e; } finally { enVol -= 1; latences.push(Number(process.hrtime.bigint() - t0) / 1e6); }
  };
  return {
    relever() { const c = centiles(latences); return { calls: appels, peakInFlight: pic, timeouts: delais, latencyMs: { p50: c.p50, p95: c.p95, p99: c.p99 } }; },
    rendre() { base.request = vraie; },
  };
}

/**
 * Une position de la séquence : sa présentation, son préchauffage, sa fenêtre en boucle ouverte, ses relevés.
 * Rend `{ artefact }` ; lève avec `{ phase }` attaché sur ce qui a échoué.
 */
async function executerPosition({ player, presentations, base, appeler, position, sequence, spectators, requetesParSpectateur, dureeCibleMs, warmupRequests, identity, environment, isolation, motif, binSetIdDe, fichierUrl, gc = global.gc, journal = () => {}, echeanceRequeteMs = ECHEANCE_REQUETE_MS, budgetPositionMs, graine = 0, topology, horloge = HORLOGE }) {
  const pageAttendue = position;
  // ⚠️ `maxInFlight` A QUITTÉ `scenario`, ET CE N'EST PAS COSMÉTIQUE. Il y figurait parmi les
  // ENTRÉES — nom, effectifs, rang, préchauffage — alors qu'il est un RÉSULTAT, rempli après la
  // mesure avec le pic observé. Un lecteur y voyait donc un plafond imposé au générateur, quand
  // aucun ne l'est : la boucle est ouverte, c'est tout son intérêt. Il vit maintenant dans
  // `workload.peakInFlight`, avec ce qu'on a observé du générateur. Relevé par un audit externe
  // (CODEX, 15/09).
  const scenario = { name: "state-hot", spectators, presentations: 1, repetition: 1, position, sequence, warmupRequests, egressIps: Math.min(spectators, 250) };
  const workload = {
    arrivalModel: "open-loop", arrivalPattern: motif,
    targetDurationMs: dureeCibleMs, requestsPerSpectator: requetesParSpectateur,
    scheduleAlgorithm: ALGORITHME_ORDONNANCEMENT, scheduleSeed: graine, egressPattern: "round-robin",
    peakInFlight: 0,
  };
  const fenetre = { startedAt: horloge.instant(), durationMs: 0, processUptimeStartMs: horloge.uptimeMs(), processUptimeEndMs: horloge.uptimeMs() };
  let phase = "presentation";
  // ⚠️ LES INSTRUMENTS SE DÉCLARENT HORS DU `try` POUR SE RETIRER DANS LE `finally`. L'échantillonneur
  // mémoire, le moniteur de boucle et la sonde posée sur `db.request` étaient tous trois installés
  // DANS le bloc et retirés à la fin du chemin heureux : une exception — et il y en a désormais, les
  // échéances en produisent — laissait un `setInterval` vivant, un moniteur actif et surtout
  // `base.request` toujours détourné, donc la position suivante mesurée à travers l'instrument de la
  // précédente. Relevé par un auditeur externe (CODEX, 15/09).
  let sonde, boucle, echantillonneur, vueCache;
  const echec = (e) => { const err = e instanceof Error ? e : new Error(String(e)); err.phase = phase; err.artefact = assemblerEchec({ identity, environment, topology, scenario, workload, isolation: { ...isolation, datasetId: isolation.datasetId || "aucun" }, fenetre, phase, reason: err.message }); return err; };
  try {
    const p = await presentations.createPresentation({
      docId: `rapport-${position}-${crypto.randomBytes(4).toString("hex")}`, fileUrl: fichierUrl, fileName: "rapport.pdf",
      docTitle: `Rapport ${position}`, presenterName: "Rapport", owner: { email: "rapport@exemple.test", name: "Rapport" },
    });
    // ⚠️ LE SLUG VIENT DE LA BASE, ET IL FINIT DANS L'ARTEFACT : filtré par liste blanche et borné, ou la
    // position échoue — un artefact ne porte pas de chaîne qu'on n'a pas regardée.
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(String(p.slug))) throw new Error(`slug inattendu rendu par la base : ${JSON.stringify(String(p.slug).slice(0, 80))}`);
    await presentations.setPage(p.slug, p.control, pageAttendue);
    const iso = { ...isolation, datasetId: p.slug };
    const lireEtat = (i) => appeler({ method: "GET", headers: {}, socket: { remoteAddress: `10.0.1.${i % 250}` }, query: { present: p.slug, state: "1" } }, { echeanceMs: echeanceRequeteMs });

    phase = "warmup";
    for (let i = 0; i < warmupRequests; i += 1) await lireEtat(i);

    phase = "mesure";
    // ⚠️ LES COMPTEURS SE LISENT PAR UNE COUTURE INTERNE, PAS PAR UNE REQUÊTE. Cette lecture passait
    // par `GET ?contract=1` — donc TRAVERSAIT le handler et incrémentait `mesures.statuts.ok` au
    // passage : le delta d'une fenêtre de 1 000 requêtes valait 1 001, à chaque position, et
    // l'observateur se comptait lui-même. `__compteursSansObserver()` rend l'état sans le modifier.
    // ⚠️ ET SURTOUT PAS PAR UNE SOUSTRACTION CACHÉE : retrancher « la requête d'observation » aurait
    // corrigé le chiffre en rendant l'instrument moins auditable que lorsqu'il était faux. Ce que la
    // fenêtre contient d'autre que la charge se DIT — voir `counters.observerOverheadRequests`.
    // Défaut relevé par un audit externe (CODEX, 15/09).
    const lireCompteurs = () => compteursDeLaCarte(player.__compteursSansObserver());
    const carteAvant = lireCompteurs();
    const cacheAvant = player.__cacheLecture.compteurs();
    // Le pic en vol du cache doit être celui de CETTE fenêtre : `compteurs().peakInFlight` est un
    // maximum depuis le démarrage, et le recopier faisait hériter une position calme du pic de la
    // précédente, à côté de hits/misses/coalesced qui étaient, eux, des deltas.
    vueCache = player.__cacheLecture.observerEnVol();
    sonde = sonderBase(base);
    boucle = monitorEventLoopDelay({ resolution: RESOLUTION_BOUCLE_MS }); boucle.enable();
    const cpu0 = process.cpuUsage();
    // ⚠️ `afterGc` EXIGE UN VRAI GC : sans `--expose-gc`, la position échoue AVANT de mesurer, et le dit.
    if (typeof gc !== "function") throw new Error("node --expose-gc requis : afterGc ne peut pas être relevé sans lui");
    gc();
    const m0 = process.memoryUsage();
    const pic = { rss: m0.rss, heapUsed: m0.heapUsed, external: m0.external, arrayBuffers: m0.arrayBuffers };
    echantillonneur = setInterval(() => { const m = process.memoryUsage(); for (const k of Object.keys(pic)) if (m[k] > pic[k]) pic[k] = m[k]; }, PERIODE_MEMOIRE_MS);

    const total = spectators * requetesParSpectateur;
    const instants = planifier(total, dureeCibleMs, motif, graine);
    const latences = [], statuts = [], octets = [], retards = [];
    const jugements = { correct: 0, vide: 0, autre: 0 };
    let parties = 0, enVol = 0, picEnVol = 0;
    // ⚠️ LES TROIS BORNES DE LA FENÊTRE SONT PRISES ICI, AU MÊME INSTANT. Elles ne l'étaient pas :
    // `startedAt` et `processUptimeStartMs` dataient du DÉBUT DE LA POSITION — avant la création de
    // la présentation et avant le préchauffage — tandis que `durationMs` partait d'après le GC, et
    // `processUptimeEndMs` était relevé après les sondes, le GC final et la lecture des compteurs.
    // Trois périodes différentes sous un seul nom : sur la course du tag, l'écart atteignait 55 ms
    // pour une fenêtre annoncée de 4 002 ms. Un champ qui s'appelle « fenêtre de mesure » doit
    // désigner UNE fenêtre. `afterGc` reste explicitement hors d'elle, comme avant. Relevé par un
    // audit externe (CODEX, 15/09).
    const origine = process.hrtime.bigint();
    fenetre.startedAt = horloge.instant();
    fenetre.processUptimeStartMs = horloge.uptimeMs();
    const maintenant = () => Number(process.hrtime.bigint() - origine) / 1e6;
    const finies = [];
    for (let i = 0; i < total; i += 1) {
      finies.push(new Promise((resolve) => {
        setTimeout(() => {
          retards.push(Math.max(0, maintenant() - instants[i]));
          parties += 1; enVol += 1; if (enVol > picEnVol) picEnVol = enVol;
          lireEtat(i % spectators).then((r) => {
            enVol -= 1;
            latences.push(r.ms); statuts.push(r.statut); octets.push(r.octets);
            const j = juger(r, pageAttendue); if (j) jugements[j] += 1;
            resolve();
          });
        }, Math.max(0, instants[i]));
      }));
    }
    // ⚠️ UN BUDGET GLOBAL EN PLUS DES ÉCHÉANCES PAR REQUÊTE. Les unes bornent chaque appel, celui-ci
    // borne la POSITION : un ordonnanceur qui ne lâche jamais la main, une base qui accepte les
    // connexions sans répondre, un `setTimeout` qui ne tire pas — autant de façons de ne jamais
    // atteindre `Promise.all` sans qu'aucune requête n'ait individuellement expiré.
    const budget = budgetPositionMs || Math.max(60_000, dureeCibleMs * 10);
    let minuterieBudget;
    const depassement = new Promise((_, rejeter) => {
      minuterieBudget = setTimeout(() => rejeter(new Error(`budget de position dépassé : ${budget} ms pour ${total} requêtes, ${latences.length} achevée(s) — la course ne progresse plus`)), budget);
      if (typeof minuterieBudget.unref === "function") minuterieBudget.unref();
    });
    try {
      await Promise.race([Promise.all(finies), depassement]);
    } finally {
      clearTimeout(minuterieBudget);
    }
    // Fermée immédiatement après la dernière réponse, avec sa jumelle : rien entre les deux.
    const dureeMs = maintenant();
    fenetre.processUptimeEndMs = horloge.uptimeMs();

    // ⚠️ UNE REQUÊTE EXPIRÉE INVALIDE LA POSITION, elle ne se range pas dans les statuts. À ces
    // latences, une échéance de trente secondes qui tire ne dit pas « le système est lent » mais
    // « quelque chose ne répond plus » : la ranger dans `other5xx` produirait un artefact d'allure
    // normale au milieu d'une panne.
    const expirees = statuts.filter((x) => x === 598).length;
    if (expirees) throw new Error(`${expirees} requête(s) sur ${total} n'ont pas répondu avant leur échéance de ${echeanceRequeteMs} ms`);

    clearInterval(echantillonneur);
    const m1 = process.memoryUsage();
    for (const k of Object.keys(pic)) if (m1[k] > pic[k]) pic[k] = m1[k];
    const cpu1 = process.cpuUsage(cpu0);
    boucle.disable();
    sonde.rendre();
    gc();
    const m2 = process.memoryUsage();
    const cacheApres = player.__cacheLecture.compteurs();
    const carteApres = lireCompteurs();

    const mem = (m) => ({ rss: versMio(m.rss), heapUsed: versMio(m.heapUsed), external: versMio(m.external), arrayBuffers: versMio(m.arrayBuffers) });
    const artefact = assembler({
      identity, environment, topology, scenario, workload: { ...workload, peakInFlight: picEnVol }, isolation: iso,
      fenetre: { ...fenetre, durationMs: arrondi(dureeMs) },
      observations: { latences, statuts, octets, jugements, planifiees: total, parties, retards },
      db: sonde.relever(),
      cache: {
        hits: cacheApres.hits - cacheAvant.hits, misses: cacheApres.misses - cacheAvant.misses, coalesced: cacheApres.coalesced - cacheAvant.coalesced,
        peakInFlight: vueCache.pic(), processLifetimePeakInFlight: cacheApres.peakInFlight,
      },
      processus: { cpuUserMs: arrondi(cpu1.user / 1000), cpuSystemMs: arrondi(cpu1.system / 1000), eventLoopP99Ms: arrondi(boucle.percentile(99) / 1e6), memoryMiB: { baseline: mem(m0), peak: mem(pic), end: mem(m1), afterGc: mem(m2) } },
      // `observerOverheadRequests: 0` — et c'est un fait, pas une convention : les compteurs sont
      // désormais lus par une couture interne qui ne traverse pas le handler, donc la fenêtre ne
      // contient rien d'autre que la charge. Le champ existe pour que le jour où elle contiendrait
      // autre chose, ce soit ÉCRIT plutôt que soustrait en silence.
      compteurs: { before: carteAvant, after: carteApres, delta: deltas(carteAvant, carteApres), observerOverheadRequests: 0 },
      binSetIdDe,
    });
    journal(`  position ${position} — ${spectators} spectateurs × ${requetesParSpectateur} : ${latences.length}/${total} achevées, p50/p95/p99 ${artefact.latencyMs.p50}/${artefact.latencyMs.p95}/${artefact.latencyMs.p99} ms, retard générateur p99 ${artefact.workload.generatorLagMs.p99} ms, 2xx ${artefact.statuses["2xx"]}, cache ${artefact.cache.hits}/${artefact.cache.coalesced}/${artefact.cache.misses} (servies/regroupées/produites), base ${artefact.database.calls} appel(s)`);
    return { artefact };
  } catch (e) {
    throw echec(e);
  } finally {
    if (echantillonneur) clearInterval(echantillonneur);
    if (boucle) boucle.disable();
    if (sonde) sonde.rendre();
    if (vueCache) vueCache.fermer();
  }
}

/** La course entière : la séquence, un artefact par position, l'arrêt au premier échec, la cohorte jugée. */
async function courir({ sortie, sequence = [100, 1000, 100], requetesParSpectateur = 10, dureeCibleMs = 4000, warmupRequests = 20, motif = "jittered", env = process.env, journal = console.log, contexte, player, presentations, fichierUrl, gc = global.gc, echeanceRequeteMs = ECHEANCE_REQUETE_MS, budgetPositionMs, graine = 20260915, horloge = HORLOGE }) {
  // ⚠️ PREMIÈRE INSTRUCTION, ET C'EST VOULU : rien avant elle, pas même un `mkdir`. Une séquence VIDE N'EST PAS UNE COURSE RÉUSSIE. Sans ce refus, la boucle ne tourne pas, aucun
  // artefact n'est écrit, et `auditer` — appelé sans fichier — juge LE CORPUS D'EXEMPLES puis rend
  // vert : « 2 artefact(s) conformes », code 0, zéro mesure produite. Le programme annonçait donc
  // un succès en confondant la conformité de ses propres fixtures avec une campagne. Défaut relevé
  // par un auditeur externe (CODEX, 15/09). Ce qui n'est pas mesurable se refuse ici, avant de
  // demander un verdict à quoi que ce soit.
  if (!Array.isArray(sequence) || !sequence.length) {
    throw new ConfigurationNonMesurable("séquence vide : il n'y a aucune position à jouer, et une course sans position n'est pas une course réussie");
  }
  const outils = await import(pathToFileURL(path.join(RACINE, "tools", "artefact-de-charge.mjs")).href);
  const schemas = outils.schemasPresents(RACINE);
  const { empreinte } = schemas.get(1);
  fs.mkdirSync(sortie, { recursive: true });
  const identity = identite({ env, empreinte });
  const environment = environnement(env);
  // ⚠️ LA TOPOLOGIE EST UNE CONDITION DE LA MESURE, PAS UN DÉTAIL D'IMPLÉMENTATION. Écrite dans
  // l'artefact parce que des latences de quelques microsecondes sont cohérentes SOUS CELLE-CI et
  // invraisemblables autrement : le générateur appelle `player.handler()` dans le processus, sans
  // socket, sans parseur HTTP et sans `bin/serve.js`, contre un PostgREST réel en loopback. Deux
  // artefacts de topologies différentes ne se comparent pas, et le lecteur doit pouvoir le voir sans
  // relire le code du producteur. Demandé par un audit externe (CODEX, 15/09).
  const topology = { clientToPlayer: "handler-direct", playerToDatabase: "loopback-http", playerProcesses: 1 };
  // ⚠️ `processReused` DISAIT LE CONTRAIRE DE CE QU'IL VALAIT : à `true` partout, y compris à la
  // position 1 où aucun processus n'avait encore servi. Ce qu'il énonçait vraiment — toutes les
  // positions partagent UN processus — a maintenant son nom.
  const isolation = { sameProcessAcrossCohort: true, databaseReset: false, cacheReset: false, metricsReset: false, countersReportedAsDeltas: true, datasetId: "" };
  // Une graine PAR POSITION, dérivée de celle de la course : deux positions ne doivent pas rejouer
  // la même suite de gigue, et la course entière doit rester reproductible d'un seul nombre.
  const graineDe = (i) => (graine + i * 0x9E3779B1) >>> 0;
  const appeler = appelant(player);
  const fichiers = [];
  let code = 0;
  journal(`RAPPORT DE CHARGE — séquence ${JSON.stringify(sequence)}, ${requetesParSpectateur} lectures d'état par spectateur, boucle ouverte ${motif} sur ${dureeCibleMs} ms, course ${identity.runId}`);
  for (let i = 0; i < sequence.length; i += 1) {
    const position = i + 1;
    const fichier = path.join(sortie, `artefact-${position}-${sequence[i]}.json`);
    let artefact;
    try {
      ({ artefact } = await executerPosition({ player, presentations, base: contexte.db, appeler, position, sequence, spectators: sequence[i], requetesParSpectateur, dureeCibleMs, warmupRequests, identity, environment, isolation, motif, binSetIdDe: outils.binSetIdDe, fichierUrl, gc, journal, echeanceRequeteMs, budgetPositionMs, graine: graineDe(i), topology, horloge }));
    } catch (e) {
      artefact = e.artefact || assemblerEchec({
        identity, environment, topology,
        scenario: { name: "state-hot", spectators: sequence[i], presentations: 1, repetition: 1, position, sequence, warmupRequests, egressIps: Math.min(sequence[i], 250) },
        workload: { arrivalModel: "open-loop", arrivalPattern: motif, targetDurationMs: dureeCibleMs, requestsPerSpectator: requetesParSpectateur, scheduleAlgorithm: ALGORITHME_ORDONNANCEMENT, scheduleSeed: graineDe(i), egressPattern: "round-robin", peakInFlight: 0 },
        isolation: { ...isolation, datasetId: "aucun" },
        fenetre: { startedAt: new Date().toISOString(), durationMs: 0, processUptimeStartMs: 0, processUptimeEndMs: 0 },
        phase: "inconnue", reason: e && e.message,
      });
      journal(`  position ${position} — ÉCHEC en phase ${artefact.failure.phase} : ${artefact.failure.reason}`);
      code = 1;
    }
    fs.writeFileSync(fichier, JSON.stringify(artefact, null, 2) + "\n");
    fichiers.push(fichier);
    if (!artefact.complete) break;
  }
  const verdict = outils.auditer({ racine: RACINE, fichiers });
  journal(verdict.code === 0 ? `  cohorte : ${verdict.resume}` : `  cohorte REFUSÉE :\n    ${(verdict.constats || verdict.raisons || []).join("\n    ")}`);
  return { code: code || verdict.code, fichiers, verdict };
}

async function main() {
  const argv = process.argv.slice(2);
  const option = (nom, defaut) => { const a = argv.find((x) => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : defaut; };
  const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
  const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";
  if (!BASE || !SECRET) { console.error("rapport de charge : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents — rien à mesurer, et s'esquiver ne produirait pas d'artefact"); process.exit(2); }
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const tete = b64({ alg: "HS256", typ: "JWT" }), corps = b64({ role: process.env.PLAYER_TEST_ROLE || "player_test" });
  const jeton = `${tete}.${corps}.${crypto.createHmac("sha256", SECRET).update(`${tete}.${corps}`).digest("base64url")}`;
  // Une racine locale RÉELLE avec un fichier réel, comme la campagne : `createPresentation` veut une URL
  // que le stockage autorise, même si le scénario `state-hot` ne lit jamais le fichier.
  const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rapport-")));
  const fichier = path.join(racine, "rapport.pdf");
  fs.writeFileSync(fichier, Buffer.alloc(1024, 0x25));
  const contexte = require("../context/standalone.js").createStandaloneContext({ ...process.env, SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: jeton, PLAYER_LOCAL_ROOT: racine });
  const player = require("../server/handler.js");
  player.init(contexte);
  const presentations = require("../server/presentations.js");
  const env = { ...process.env, PLAYER_RAPPORT_POSTGREST: process.env.PLAYER_RAPPORT_POSTGREST || await versionPostgrest(BASE) };
  // ⚠️ LA CONFIGURATION SE CONTRÔLE AVANT DE MESURER, ET UN REFUS SORT EN 2. `Number(option(...))`
  // rendait NaN sans un mot, et le filtre de la séquence amputait ce qu'il ne comprenait pas.
  let demande;
  try {
    const requetesParSpectateur = entierStrict(option("par-spectateur", 10), "--par-spectateur");
    demande = {
      requetesParSpectateur,
      sequence: sequenceStricte(option("sequence", "100,1000,100"), { requetesParSpectateur }),
      dureeCibleMs: entierStrict(option("duree-ms", 4000), "--duree-ms", { min: 1, max: 3_600_000 }),
    };
  } catch (e) {
    if (!(e instanceof ConfigurationNonMesurable)) throw e;
    console.error(`rapport de charge : ${e.message} — rien n'a été mesuré, et s'en accommoder produirait un artefact qui ment sur son protocole`);
    process.exitCode = 2;
    return;
  }
  let code;
  try {
    ({ code } = await courir({
      env,
      fichierUrl: pathToFileURL(fichier).href,
      sortie: option("sortie", path.join(RACINE, "charge", "artefacts", "sortie")),
      ...demande,
      contexte, player, presentations,
    }));
  } catch (e) {
    if (!(e instanceof ConfigurationNonMesurable)) throw e;
    console.error(`rapport de charge : ${e.message}`);
    process.exitCode = 2;
    return;
  }
  process.exitCode = code;
}

module.exports = { EDGES_MS, REQUETES_MAX, HORLOGE, ALGORITHME_ORDONNANCEMENT, PERIODE_MEMOIRE_MS, RESOLUTION_BOUCLE_MS, ConfigurationNonMesurable, entierStrict, sequenceStricte, alea32, messagePublic, codeEchec, quantile, centiles, histogramme, classerStatuts, plafondMemoire, environnement, versionPostgrest, identite, planifier, assembler, assemblerEchec, compteursDeLaCarte, deltas, juger, appelant, sonderBase, executerPosition, courir };

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
