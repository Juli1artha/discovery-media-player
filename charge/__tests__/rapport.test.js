// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE PRODUCTEUR D'ARTEFACT, ÉPROUVÉ PIÈCE PAR PIÈCE PUIS DE BOUT EN BOUT. Les pièces : quantile par
// rang, histogramme à classes fixes avec sa sémantique [a, b) et son débordement, statuts disjoints,
// plafond mémoire de la source qui le sert, générateur en boucle ouverte, assemblage d'un artefact
// complet et d'un artefact interrompu — chacun JUGÉ par le validateur, pas seulement « ressemble ».
// Le bout en bout : la course entière contre le double PostgREST en mémoire, deux positions, mille
// observations chacune, la cohorte acceptée par la garde.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { createRequire } = require("node:module");
const requireCjs = createRequire(__filename);

const rapport = requireCjs("../rapport.js");
const { creerPostgrestEnMemoire } = requireCjs("../../tools/postgrest-en-memoire.cjs");
const RACINE = path.join(__dirname, "..", "..");

let outils, schemas, EMPREINTE;
beforeAll(async () => {
  outils = await import(pathToFileURL(path.join(RACINE, "tools", "artefact-de-charge.mjs")).href);
  schemas = outils.schemasPresents(RACINE);
  EMPREINTE = schemas.get(1).empreinte;
});

const juger = (a) => outils.jugerArtefact(a, schemas).constats;

describe("les pièces du producteur", () => {
  it("quantile par rang le plus proche : min ≤ p50 ≤ p95 ≤ p99 ≤ max, et les bornes sont des valeurs observées", () => {
    const c = rapport.centiles([5, 1, 4, 2, 3]);
    expect(c).toEqual({ n: 5, min: 1, mean: 3, p50: 3, p95: 5, p99: 5, max: 5 });
    expect(rapport.centiles([])).toEqual({ n: 0, min: 0, mean: 0, p50: 0, p95: 0, p99: 0, max: 0 });
    const mille = Array.from({ length: 1000 }, (_, i) => i + 1);
    expect(rapport.centiles(mille)).toMatchObject({ p50: 500, p95: 950, p99: 990, max: 1000 });
  });
  it("⚠️ l'histogramme : classe [a, b), une valeur ÉGALE à une borne tombe dans la classe qui y commence, au-delà de la dernière c'est overflow", () => {
    const edges = [0, 1, 2, 5];
    const h = rapport.histogramme([0, 0.5, 1, 1.9, 2, 4.99, 5, 100], edges, outils.binSetIdDe);
    expect(h).toEqual({ unit: "ms", binSetId: outils.binSetIdDe(edges), edges, counts: [2, 2, 2], overflow: 2 });
    expect(h.counts.reduce((x, y) => x + y, 0) + h.overflow).toBe(8);
    expect(rapport.EDGES_MS[0]).toBe(0);
  });
  it("⚠️ statuts DISJOINTS : 429 hors other4xx, 503 hors other5xx, 1xx et 3xx dans other, une réponse jamais rendue (0, 599) est une other5xx", () => {
    expect(rapport.classerStatuts([200, 204, 429, 404, 503, 500, 599, 0, 101, 304])).toEqual({ "2xx": 2, "429": 1, other4xx: 1, "503": 1, other5xx: 3, other: 2 });
  });
  it("le plafond mémoire vient de la source qui le sert, ou vaut null avec `unknown` — jamais un chiffre deviné", () => {
    expect(rapport.plafondMemoire({}, () => "268435456\n")).toEqual({ memoryLimitMiB: 256, memoryLimitSource: "cgroup" });
    expect(rapport.plafondMemoire({ AWS_LAMBDA_FUNCTION_MEMORY_SIZE: "1024" }, () => "max\n")).toEqual({ memoryLimitMiB: 1024, memoryLimitSource: "lambda-env" });
    expect(rapport.plafondMemoire({ GITHUB_ACTIONS: "true" }, () => { throw new Error("absent"); }).memoryLimitSource).toBe("runner");
    expect(rapport.plafondMemoire({}, () => { throw new Error("absent"); })).toEqual({ memoryLimitMiB: null, memoryLimitSource: "unknown" });
  });
  it("le générateur en boucle ouverte : n instants triés sur la durée, uniformes ou avec gigue, jamais négatifs", () => {
    expect(rapport.planifier(5, 400, "uniform")).toEqual([0, 100, 200, 300, 400]);
    const j = rapport.planifier(100, 1000, "jittered");
    expect(j).toHaveLength(100);
    expect(j.every((t, i) => t >= 0 && (i === 0 || t >= j[i - 1]))).toBe(true);
    expect(j).not.toEqual(rapport.planifier(100, 1000, "uniform"));
    expect(rapport.planifier(1, 1000, "uniform")).toEqual([0]);
  });
  it("juger une réponse d'état : la bonne page, une autre, ou rien — et une réponse non 2xx n'est pas jugée", () => {
    expect(rapport.juger({ statut: 200, corps: JSON.stringify({ ok: true, state: { current_page: 3 } }) }, 3)).toBe("correct");
    expect(rapport.juger({ statut: 200, corps: JSON.stringify({ ok: true, state: { current_page: 4 } }) }, 3)).toBe("autre");
    expect(rapport.juger({ statut: 200, corps: "" }, 3)).toBe("vide");
    expect(rapport.juger({ statut: 200, corps: JSON.stringify({ ok: true }) }, 3)).toBe("vide");
    expect(rapport.juger({ statut: 503, corps: "" }, 3)).toBeNull();
  });
  it("la version de PostgREST est demandée à PostgREST (racine OpenAPI), et vaut « » quand il ne la dit pas — jamais recopiée", async () => {
    const repond = (corps, ok = true) => async () => ({ ok, json: async () => corps });
    expect(await rapport.versionPostgrest("http://b/", repond({ info: { version: "12.2.3" } }))).toBe("12.2.3");
    expect(await rapport.versionPostgrest("http://b", repond({ info: {} }))).toBe("");
    expect(await rapport.versionPostgrest("http://b", repond({}, false))).toBe("");
    expect(await rapport.versionPostgrest("http://b", async () => { throw new Error("injoignable"); })).toBe("");
    expect(await rapport.versionPostgrest("")).toBe("");
    let url; await rapport.versionPostgrest("http://b/", async (u) => { url = u; return { ok: false }; });
    expect(url).toBe("http://b/rest/v1/");
  });
  it("les compteurs de la carte s'aplatissent en clés stables, et les deltas se calculent clé par clé", () => {
    const avant = rapport.compteursDeLaCarte({ lectureSaturee: { total: 1 }, relaisRefuses: { total: 0 }, mesures: { statuts: { ok: 10, refus4xx: 1, debit429: 0, occupe503: 0, erreur5xx: 0 }, base: { n: 7 } } });
    const apres = { ...avant, "mesures.statuts.ok": 25, "mesures.base.n": 9 };
    expect(rapport.deltas(avant, apres)).toMatchObject({ "mesures.statuts.ok": 15, "mesures.base.n": 2, "lectureSaturee.total": 0 });
    expect(Object.keys(avant)).toEqual(["lectureSaturee.total", "relaisRefuses.total", "mesures.statuts.ok", "mesures.statuts.refus4xx", "mesures.statuts.debit429", "mesures.statuts.occupe503", "mesures.statuts.erreur5xx", "mesures.base.n"]);
  });
});

describe("l'assemblage produit des artefacts que le validateur ACCEPTE — c'est le juge, pas la ressemblance", () => {
  const identity = () => rapport.identite({ env: { GITHUB_SHA: "a".repeat(40), GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "2" }, empreinte: EMPREINTE, version: "0.0.0", quand: new Date("2026-09-14T00:00:00Z") });
  const environment = () => rapport.environnement({});
  const scenario = (position, spectators) => ({ name: "state-hot", spectators, presentations: 1, repetition: 1, position, sequence: [100, 1000, 100], warmupRequests: 20, maxInFlight: 7, egressIps: Math.min(spectators, 250) });
  const workload = () => ({ arrivalModel: "open-loop", arrivalPattern: "jittered" });
  const isolation = (d) => ({ processReused: true, databaseReset: false, cacheReset: false, metricsReset: false, countersReportedAsDeltas: true, datasetId: d });
  const fenetre = () => ({ startedAt: "2026-09-14T00:00:00Z", durationMs: 4000, processUptimeStartMs: 1000, processUptimeEndMs: 5000 });
  it("un artefact complet, depuis mille observations synthétiques : forme et invariants acceptés, identité et empreinte comprises", () => {
    const latences = Array.from({ length: 1000 }, (_, i) => (i % 50) + 0.5);
    const statuts = Array.from({ length: 1000 }, (_, i) => (i % 100 === 0 ? 503 : 200));
    const jugements = { correct: 985, vide: 3, autre: 2 };   // = 990 réponses 2xx
    const a = rapport.assembler({
      identity: identity(), environment: environment(), scenario: scenario(1, 100), workload: workload(), isolation: isolation("slug-1"), fenetre: fenetre(),
      observations: { latences, statuts, octets: latences.map(() => 512), jugements, planifiees: 1000, parties: 1000, retards: latences.map(() => 0.1) },
      db: { calls: 12, peakInFlight: 3, timeouts: 0, latencyMs: { p50: 1, p95: 2, p99: 3 } },
      cache: { hits: 900, misses: 12, coalesced: 88, peakInFlight: 3 },
      processus: { cpuUserMs: 100, cpuSystemMs: 10, eventLoopP99Ms: 2, memoryMiB: { baseline: { rss: 60, heapUsed: 20, external: 5, arrayBuffers: 1 }, peak: { rss: 80, heapUsed: 30, external: 9, arrayBuffers: 4 }, end: { rss: 70, heapUsed: 25, external: 6, arrayBuffers: 2 }, afterGc: { rss: 70, heapUsed: 15, external: 3, arrayBuffers: 1 } } },
      compteurs: { before: { "mesures.base.n": 1 }, after: { "mesures.base.n": 13 }, delta: { "mesures.base.n": 12 } },
      binSetIdDe: outils.binSetIdDe,
    });
    expect(juger(a)).toEqual([]);
    expect(a.statuses).toEqual({ "2xx": 990, "429": 0, other4xx: 0, "503": 10, other5xx: 0, other: 0 });
    expect(a.latencyMs.n).toBe(1000);
    expect(a.histogram.counts.reduce((x, y) => x + y, 0) + a.histogram.overflow).toBe(1000);
    expect(a.identity).toMatchObject({ commitSha: "a".repeat(40), runId: "gha-1-2", schemaSha256: EMPREINTE });
    expect(a.throughputRps).toBeUndefined();
  });
  it("un artefact interrompu : la forme, la phase, la raison — accepté SANS bloc de mesure ; et une raison vide devient une raison quand même", () => {
    const e = rapport.assemblerEchec({ identity: identity(), environment: environment(), scenario: scenario(2, 1000), workload: workload(), isolation: isolation("slug-2"), fenetre: fenetre(), phase: "mesure", reason: "listen EPERM" });
    expect(juger(e)).toEqual([]);
    expect(e).toMatchObject({ complete: false, failure: { phase: "mesure", reason: "listen EPERM" } });
    expect(e.latencyMs).toBeUndefined();
    expect(rapport.assemblerEchec({ identity: identity(), environment: environment(), scenario: scenario(2, 1000), workload: workload(), isolation: isolation("x"), fenetre: fenetre(), phase: "p", reason: "" }).failure.reason).toBe("raison absente");
  });
  it("⚠️ l'assemblage NE MENT PAS SUR LE VOLUME : 999 observations font un artefact que le validateur refuse, pas un artefact arrangé", () => {
    const latences = Array.from({ length: 999 }, () => 1);
    const a = rapport.assembler({
      identity: identity(), environment: environment(), scenario: scenario(1, 100), workload: workload(), isolation: isolation("slug-1"), fenetre: fenetre(),
      observations: { latences, statuts: latences.map(() => 200), octets: latences.map(() => 1), jugements: { correct: 999, vide: 0, autre: 0 }, planifiees: 1000, parties: 1000, retards: latences.map(() => 0) },
      db: { calls: 0, peakInFlight: 0, timeouts: 0, latencyMs: { p50: 0, p95: 0, p99: 0 } }, cache: { hits: 0, misses: 0, coalesced: 0, peakInFlight: 0 },
      processus: { cpuUserMs: 0, cpuSystemMs: 0, eventLoopP99Ms: 0, memoryMiB: { baseline: { rss: 1, heapUsed: 1, external: 1, arrayBuffers: 1 }, peak: { rss: 1, heapUsed: 1, external: 1, arrayBuffers: 1 }, end: { rss: 1, heapUsed: 1, external: 1, arrayBuffers: 1 }, afterGc: { rss: 1, heapUsed: 1, external: 1, arrayBuffers: 1 } } },
      compteurs: { before: {}, after: {}, delta: {} }, binSetIdDe: outils.binSetIdDe,
    });
    expect(juger(a).join("\n")).toMatch(/artefact\.latencyMs\.n : 999 observation\(s\)/);
  });
});

describe("de bout en bout : la course contre le double PostgREST en mémoire, jugée en cohorte", () => {
  let base, contexte, player, presentations, racine, sortie;
  beforeAll(async () => {
    ({ serveur: base } = creerPostgrestEnMemoire({ doc_presentations: [], doc_presentation_attendees: [], doc_presentation_messages: [] }));
    await new Promise((resolve) => base.listen(0, "127.0.0.1", resolve));
    racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rapport-banc-")));
    fs.writeFileSync(path.join(racine, "rapport.pdf"), Buffer.alloc(1024, 0x25));
    sortie = path.join(racine, "sortie");
    const { createStandaloneContext } = requireCjs("../../context/standalone.js");
    contexte = createStandaloneContext({ SUPABASE_URL: `http://127.0.0.1:${base.address().port}`, SUPABASE_SERVICE_ROLE_KEY: "cle-de-banc", PLAYER_LOCAL_ROOT: racine });
    player = requireCjs("../../server/handler.js");
    player.init(contexte);
    presentations = requireCjs("../../server/presentations.js");
  }, 30_000);
  afterAll(async () => {
    await new Promise((resolve) => base.close(resolve));
    try { fs.rmSync(racine, { recursive: true, force: true }); } catch { /* déjà parti */ }
  });

  it("deux positions de 100 spectateurs × 10 lectures : deux artefacts complets, même course, cohorte acceptée par la garde", async () => {
    const lignes = [];
    // ⚠️ `gc` injecté : ce banc tourne sans --expose-gc et n'affirme rien sur la mémoire ; il éprouve la
    // CHAÎNE — génération, relevés, assemblage, écriture, jugement en cohorte. La forge, elle, l'expose.
    const r = await rapport.courir({ sortie, sequence: [100, 100], requetesParSpectateur: 10, dureeCibleMs: 800, warmupRequests: 5, contexte, player, presentations, fichierUrl: pathToFileURL(path.join(racine, "rapport.pdf")).href, gc: () => {}, journal: (l) => lignes.push(l), env: { ...process.env, GITHUB_SHA: "b".repeat(40), GITHUB_RUN_ID: "77" } });
    expect(r.code, lignes.join("\n")).toBe(0);
    expect(r.fichiers.map((f) => path.basename(f))).toEqual(["artefact-1-100.json", "artefact-2-100.json"]);
    const [a, b] = r.fichiers.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
    for (const x of [a, b]) {
      expect(juger(x), JSON.stringify(x).slice(0, 400)).toEqual([]);
      expect(x.complete).toBe(true);
      expect(x.latencyMs.n).toBe(1000);
      expect(x.workload).toMatchObject({ arrivalModel: "open-loop", arrivalPattern: "jittered", scheduledRequests: 1000, startedRequests: 1000, completedRequests: 1000 });
      expect(x.statuses["2xx"]).toBe(1000);
      expect(x.correctness).toEqual({ correctResponses: 1000, emptyResponses: 0, wrongPresentation: 0 });
      expect(x.identity).toMatchObject({ runId: "gha-77-1", commitSha: "b".repeat(40), schemaSha256: EMPREINTE });
      expect(x.cache.hits + x.cache.coalesced + x.cache.misses).toBeGreaterThan(0);
    }
    expect(a.isolation.datasetId).not.toBe(b.isolation.datasetId);
    expect([a.scenario.position, b.scenario.position]).toEqual([1, 2]);
    expect(r.verdict.resume).toMatch(/2 fourni\(s\) confrontés en cohorte/);
  }, 60_000);

  it("⚠️ une position qui échoue laisse un artefact `complete: false` avec sa phase, la course s'arrête, le code est 1 — et la cohorte interrompue reste recevable", async () => {
    const lignes = [];
    const cassees = { ...presentations, setPage: async () => { throw new Error("base injoignable pendant la mise en page"); } };
    const r = await rapport.courir({ sortie: path.join(racine, "sortie-echec"), sequence: [100, 100, 100], requetesParSpectateur: 10, dureeCibleMs: 200, warmupRequests: 0, contexte, player, presentations: cassees, fichierUrl: pathToFileURL(path.join(racine, "rapport.pdf")).href, gc: () => {}, journal: (l) => lignes.push(l), env: { ...process.env, GITHUB_SHA: "c".repeat(40) } });
    expect(r.code).toBe(1);
    expect(r.fichiers).toHaveLength(1);
    const a = JSON.parse(fs.readFileSync(r.fichiers[0], "utf8"));
    expect(a).toMatchObject({ complete: false, failure: { phase: "presentation", reason: "base injoignable pendant la mise en page" } });
    expect(juger(a)).toEqual([]);
    expect(lignes.join("\n")).toMatch(/position 1 — ÉCHEC en phase presentation/);
  }, 30_000);

  it("⚠️ UNE SÉQUENCE VIDE N'EST PAS UNE COURSE RÉUSSIE — le producteur jugeait ses propres fixtures et rendait vert", async () => {
    // ⚠️ LE DÉFAUT EXACT. La boucle ne tournait pas, aucun artefact n'était écrit, et `auditer`
    // appelé SANS FICHIER jugeait le corpus d'exemples : « 2 artefact(s) conformes », code 0.
    // Le programme confondait la conformité de ses fixtures avec une campagne, et sortait en
    // succès sans avoir rien mesuré. Relevé par un auditeur externe (CODEX, 15/09).
    //
    // Le refus est la PREMIÈRE instruction de `courir`, avant le moindre `mkdir` : une configuration
    // qu'on refuse de jouer ne doit pas laisser de trace sur le disque.
    await expect(rapport.courir({ sortie: path.join(racine, "jamais"), sequence: [] }))
      .rejects.toThrow(/séquence vide/);
    expect(fs.existsSync(path.join(racine, "jamais")), "un refus a tout de même créé le dossier de sortie").toBe(false);
  });

  it("⚠️ la configuration se REFUSE, elle ne se rabote pas : une séquence invalide était silencieusement amputée", () => {
    // `"100,bad,1000".split(",").map(Number).filter(Number.isInteger)` rendait `[100, 1000]` : la
    // campagne tournait sur une séquence que PERSONNE n'avait demandée, l'artefact la portait comme
    // si elle était le protocole, et rien nulle part ne le disait. Un filtre silencieux sur une
    // entrée de mesure est une falsification discrète de l'expérience.
    const refus = (seq, pps = 10) => {
      try { rapport.sequenceStricte(seq, { requetesParSpectateur: pps }); return null; } catch (e) { return e; }
    };
    expect(refus("100,bad,1000").message).toMatch(/rang 2 : "bad" n'est pas un entier sûr/);
    expect(refus("100,,1000").message).toMatch(/un rang vide/);
    expect(refus("NaN").message).toMatch(/n'est pas un entier sûr/);
    expect(refus("-5").message, "un effectif négatif").toMatch(/hors des bornes/);
    expect(refus("0").message, "⚠️ zéro spectateur passait : une position qui ne mesure rien").toMatch(/hors des bornes/);
    expect(refus("100", 0).message, "zéro lecture par spectateur ne mesure rien non plus").toMatch(/hors des bornes/);
    expect(refus("1e308").message, "hors des entiers sûrs").toMatch(/n'est pas un entier sûr/);
    expect(refus("100000", 100).message, "au-delà du plafond, ce n'est plus une mesure").toMatch(/au-delà de 2000000/);
    // Et ce qui est légitime passe — un refus qui refuse tout ne prouverait rien.
    expect(rapport.sequenceStricte("100,1000,100", { requetesParSpectateur: 10 })).toEqual([100, 1000, 100]);
    for (const e of [refus("100,bad,1000"), refus("0")]) expect(e).toBeInstanceOf(rapport.ConfigurationNonMesurable);
  });

  it("⚠️ un handler qui NE RÉSOUT JAMAIS ne bloque plus : la position expire, et elle laisse son artefact d'échec", async () => {
    // ⚠️ SANS ÉCHÉANCE, `Promise.all` attendait une promesse suspendue POUR TOUJOURS : la course ne
    // finissait pas, n'échouait pas, et n'écrivait AUCUN artefact — alors que le producteur promet
    // un document même en échec. Le pire des trois états : ni succès, ni échec documenté, rien.
    // Relevé par un auditeur externe (CODEX, 15/09).
    // Le handler répond à la carte des compteurs et se TAIT sur les lectures d'état : c'est le
    // chemin exact du défaut — la course atteint `Promise.all` et n'en ressort jamais.
    const muetSurLesLectures = {
      ...player,
      handler: (req, res) => (req.query && req.query.present ? new Promise(() => {}) : player.handler(req, res)),
    };
    const r = await rapport.courir({
      sortie: path.join(racine, "sortie-suspendue"), sequence: [2], requetesParSpectateur: 1,
      dureeCibleMs: 20, warmupRequests: 0, contexte, player: muetSurLesLectures, presentations,
      echeanceRequeteMs: 300, budgetPositionMs: 2000,
      fichierUrl: pathToFileURL(path.join(racine, "rapport.pdf")).href, gc: () => {},
      journal: () => {}, env: { ...process.env, GITHUB_SHA: "d".repeat(40) },
    });
    expect(r.code, "une course qui expire n'est pas un succès").toBe(1);
    expect(r.fichiers, "la course a expiré SANS laisser d'artefact — le défaut exact").toHaveLength(1);
    const a = JSON.parse(fs.readFileSync(r.fichiers[0], "utf8"));
    expect(a.complete).toBe(false);
    expect(a.failure.phase, "l'échéance est tombée pendant la mesure").toBe("mesure");
    expect(a.failure.reason, "l'échec doit NOMMER l'échéance, pas accuser le parseur JSON")
      .toMatch(/2 requête\(s\) sur 2 n'ont pas répondu avant leur échéance de 300 ms/);
    // Et l'artefact d'échec reste un artefact valide : c'est tout l'intérêt d'en produire un.
    expect(juger(a)).toEqual([]);
  }, 120_000);
});
