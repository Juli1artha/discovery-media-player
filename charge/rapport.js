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
// PLAYER_RAPPORT_POSTGRES / PLAYER_RAPPORT_POSTGREST (les versions, que la forge connaît et pas nous).

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

/** Le plafond mémoire du processus, de la source qui le sert — ou null et `unknown`, jamais un chiffre deviné. */
function plafondMemoire(env = process.env, lire = (f) => fs.readFileSync(f, "utf8")) {
  try { const v = lire("/sys/fs/cgroup/memory.max").trim(); if (/^\d+$/.test(v)) return { memoryLimitMiB: Math.max(1, Math.round(Number(v) / MIO)), memoryLimitSource: "cgroup" }; } catch { /* pas de cgroup v2 lisible */ }
  if (/^\d+$/.test(String(env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE || ""))) return { memoryLimitMiB: Math.max(1, Number(env.AWS_LAMBDA_FUNCTION_MEMORY_SIZE)), memoryLimitSource: "lambda-env" };
  if (env.GITHUB_ACTIONS) return { memoryLimitMiB: Math.max(1, Math.round(os.totalmem() / MIO)), memoryLimitSource: "runner" };
  return { memoryLimitMiB: null, memoryLimitSource: "unknown" };
}

function environnement(env = process.env) {
  return {
    node: process.version, os: `${os.platform()} ${os.release()}`, arch: os.arch(), cpuCount: Math.max(1, os.cpus().length),
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

function identite({ env = process.env, empreinte, version = require("../package.json").version, quand = new Date() }) {
  const runId = env.GITHUB_RUN_ID ? `gha-${env.GITHUB_RUN_ID}-${env.GITHUB_RUN_ATTEMPT || 1}` : `local-${quand.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
  return { commitSha: commitCourant(env), packageVersion: version, timestamp: quand.toISOString(), runId, schemaSha256: empreinte };
}

/** Les instants de départ d'une boucle ouverte : `n` requêtes réparties sur `dureeMs`, avec ou sans gigue. */
function planifier(n, dureeMs, motif, alea = Math.random) {
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
function assembler({ identity, environment, scenario, workload, isolation, fenetre, observations, db, cache, processus, compteurs, binSetIdDe }) {
  const lat = centiles(observations.latences);
  const statuses = classerStatuts(observations.statuts);
  const octets = [...observations.octets].sort((a, b) => a - b);
  return {
    schemaVersion: 1, complete: true, failure: { phase: null, reason: null },
    identity, environment, scenario,
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

/** L'artefact d'une position INTERROMPUE : la forme, la raison, rien de mesuré. */
function assemblerEchec({ identity, environment, scenario, workload, isolation, fenetre, phase, reason }) {
  return {
    schemaVersion: 1, complete: false, failure: { phase, reason: String(reason || "raison absente").slice(0, 600) },
    identity, environment, scenario,
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

/** Un appel HTTP réel à travers le handler, chronométré ; la réponse est un vrai flux inscriptible, dont on COMPTE les octets. */
function appelant(player) {
  return function appeler(requete, { corpsEntier = false } = {}) {
    const TETE_MAX = corpsEntier ? Infinity : 4096;
    const tete = [];
    let octets = 0, gardes = 0;
    const res = new Writable({ write(m, _e, cb) { octets += m.length; if (gardes < TETE_MAX) { tete.push(Buffer.from(m)); gardes += m.length; } cb(); } });
    res.statusCode = 0; res.headers = {};
    res.setHeader = function (k, v) { this.headers[String(k).toLowerCase()] = v; };
    res.getHeader = function (k) { return this.headers[String(k).toLowerCase()]; };
    const t0 = process.hrtime.bigint();
    return player.handler(requete, res).then(
      () => ({ ms: Number(process.hrtime.bigint() - t0) / 1e6, statut: res.statusCode, corps: Buffer.concat(tete).toString("utf8"), octets }),
      (e) => ({ ms: Number(process.hrtime.bigint() - t0) / 1e6, statut: 599, corps: "", octets: 0, erreur: String((e && e.message) || e) }),
    );
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
async function executerPosition({ player, presentations, base, appeler, position, sequence, spectators, requetesParSpectateur, dureeCibleMs, warmupRequests, identity, environment, isolation, motif, binSetIdDe, fichierUrl, gc = global.gc, journal = () => {} }) {
  const pageAttendue = position;
  const scenario = { name: "state-hot", spectators, presentations: 1, repetition: 1, position, sequence, warmupRequests, maxInFlight: 0, egressIps: Math.min(spectators, 250) };
  const workload = { arrivalModel: "open-loop", arrivalPattern: motif };
  const debut = new Date();
  const fenetre = { startedAt: debut.toISOString(), durationMs: 0, processUptimeStartMs: Math.round(process.uptime() * 1000), processUptimeEndMs: Math.round(process.uptime() * 1000) };
  let phase = "presentation";
  const echec = (e) => { const err = e instanceof Error ? e : new Error(String(e)); err.phase = phase; err.artefact = assemblerEchec({ identity, environment, scenario, workload, isolation: { ...isolation, datasetId: isolation.datasetId || "aucun" }, fenetre, phase, reason: err.message }); return err; };
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
    const lireEtat = (i) => appeler({ method: "GET", headers: {}, socket: { remoteAddress: `10.0.1.${i % 250}` }, query: { present: p.slug, state: "1" } });

    phase = "warmup";
    for (let i = 0; i < warmupRequests; i += 1) await lireEtat(i);

    phase = "mesure";
    const carteAvant = compteursDeLaCarte(JSON.parse((await appeler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, { corpsEntier: true })).corps));
    const cacheAvant = player.__cacheLecture.compteurs();
    const sonde = sonderBase(base);
    const boucle = monitorEventLoopDelay({ resolution: 10 }); boucle.enable();
    const cpu0 = process.cpuUsage();
    // ⚠️ `afterGc` EXIGE UN VRAI GC : sans `--expose-gc`, la position échoue AVANT de mesurer, et le dit.
    if (typeof gc !== "function") throw new Error("node --expose-gc requis : afterGc ne peut pas être relevé sans lui");
    gc();
    const m0 = process.memoryUsage();
    const pic = { rss: m0.rss, heapUsed: m0.heapUsed, external: m0.external, arrayBuffers: m0.arrayBuffers };
    const echantillonneur = setInterval(() => { const m = process.memoryUsage(); for (const k of Object.keys(pic)) if (m[k] > pic[k]) pic[k] = m[k]; }, 50);

    const total = spectators * requetesParSpectateur;
    const instants = planifier(total, dureeCibleMs, motif);
    const latences = [], statuts = [], octets = [], retards = [];
    const jugements = { correct: 0, vide: 0, autre: 0 };
    let parties = 0, enVol = 0, picEnVol = 0;
    const origine = process.hrtime.bigint();
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
    await Promise.all(finies);
    const dureeMs = maintenant();

    clearInterval(echantillonneur);
    const m1 = process.memoryUsage();
    for (const k of Object.keys(pic)) if (m1[k] > pic[k]) pic[k] = m1[k];
    const cpu1 = process.cpuUsage(cpu0);
    boucle.disable();
    sonde.rendre();
    gc();
    const m2 = process.memoryUsage();
    const cacheApres = player.__cacheLecture.compteurs();
    const carteApres = compteursDeLaCarte(JSON.parse((await appeler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, { corpsEntier: true })).corps));

    const mem = (m) => ({ rss: versMio(m.rss), heapUsed: versMio(m.heapUsed), external: versMio(m.external), arrayBuffers: versMio(m.arrayBuffers) });
    const artefact = assembler({
      identity, environment, scenario: { ...scenario, maxInFlight: picEnVol }, workload, isolation: iso,
      fenetre: { ...fenetre, durationMs: arrondi(dureeMs), processUptimeEndMs: Math.round(process.uptime() * 1000) },
      observations: { latences, statuts, octets, jugements, planifiees: total, parties, retards },
      db: sonde.relever(),
      cache: { hits: cacheApres.hits - cacheAvant.hits, misses: cacheApres.misses - cacheAvant.misses, coalesced: cacheApres.coalesced - cacheAvant.coalesced, peakInFlight: cacheApres.peakInFlight },
      processus: { cpuUserMs: arrondi(cpu1.user / 1000), cpuSystemMs: arrondi(cpu1.system / 1000), eventLoopP99Ms: arrondi(boucle.percentile(99) / 1e6), memoryMiB: { baseline: mem(m0), peak: mem(pic), end: mem(m1), afterGc: mem(m2) } },
      compteurs: { before: carteAvant, after: carteApres, delta: deltas(carteAvant, carteApres) },
      binSetIdDe,
    });
    journal(`  position ${position} — ${spectators} spectateurs × ${requetesParSpectateur} : ${latences.length}/${total} achevées, p50/p95/p99 ${artefact.latencyMs.p50}/${artefact.latencyMs.p95}/${artefact.latencyMs.p99} ms, retard générateur p99 ${artefact.workload.generatorLagMs.p99} ms, 2xx ${artefact.statuses["2xx"]}, cache ${artefact.cache.hits}/${artefact.cache.coalesced}/${artefact.cache.misses} (servies/regroupées/produites), base ${artefact.database.calls} appel(s)`);
    return { artefact };
  } catch (e) { throw echec(e); }
}

/** La course entière : la séquence, un artefact par position, l'arrêt au premier échec, la cohorte jugée. */
async function courir({ sortie, sequence = [100, 1000, 100], requetesParSpectateur = 10, dureeCibleMs = 4000, warmupRequests = 20, motif = "jittered", env = process.env, journal = console.log, contexte, player, presentations, fichierUrl, gc = global.gc }) {
  const outils = await import(pathToFileURL(path.join(RACINE, "tools", "artefact-de-charge.mjs")).href);
  const schemas = outils.schemasPresents(RACINE);
  const { empreinte } = schemas.get(1);
  fs.mkdirSync(sortie, { recursive: true });
  const identity = identite({ env, empreinte });
  const environment = environnement(env);
  const isolation = { processReused: true, databaseReset: false, cacheReset: false, metricsReset: false, countersReportedAsDeltas: true, datasetId: "" };
  const appeler = appelant(player);
  const fichiers = [];
  let code = 0;
  journal(`RAPPORT DE CHARGE — séquence ${JSON.stringify(sequence)}, ${requetesParSpectateur} lectures d'état par spectateur, boucle ouverte ${motif} sur ${dureeCibleMs} ms, course ${identity.runId}`);
  for (let i = 0; i < sequence.length; i += 1) {
    const position = i + 1;
    const fichier = path.join(sortie, `artefact-${position}-${sequence[i]}.json`);
    let artefact;
    try {
      ({ artefact } = await executerPosition({ player, presentations, base: contexte.db, appeler, position, sequence, spectators: sequence[i], requetesParSpectateur, dureeCibleMs, warmupRequests, identity, environment, isolation, motif, binSetIdDe: outils.binSetIdDe, fichierUrl, gc, journal }));
    } catch (e) {
      artefact = e.artefact || assemblerEchec({ identity, environment, scenario: { name: "state-hot", spectators: sequence[i], presentations: 1, repetition: 1, position, sequence, warmupRequests, maxInFlight: 0, egressIps: Math.min(sequence[i], 250) }, workload: { arrivalModel: "open-loop", arrivalPattern: motif }, isolation: { ...isolation, datasetId: "aucun" }, fenetre: { startedAt: new Date().toISOString(), durationMs: 0, processUptimeStartMs: 0, processUptimeEndMs: 0 }, phase: "inconnue", reason: e && e.message });
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
  const { code } = await courir({
    env,
    fichierUrl: pathToFileURL(fichier).href,
    sortie: option("sortie", path.join(RACINE, "charge", "artefacts", "sortie")),
    sequence: option("sequence", "100,1000,100").split(",").map((x) => Number(x.trim())).filter((x) => Number.isInteger(x) && x >= 0),
    requetesParSpectateur: Number(option("par-spectateur", 10)),
    dureeCibleMs: Number(option("duree-ms", 4000)),
    contexte, player, presentations,
  });
  process.exitCode = code;
}

module.exports = { EDGES_MS, quantile, centiles, histogramme, classerStatuts, plafondMemoire, environnement, versionPostgrest, identite, planifier, assembler, assemblerEchec, compteursDeLaCarte, deltas, juger, appelant, sonderBase, executerPosition, courir };

if (require.main === module) main().catch((e) => { console.error(e); process.exitCode = 1; });
