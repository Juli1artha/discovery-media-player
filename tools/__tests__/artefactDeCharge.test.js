// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES SIX PIÈCES DE L'ARTEFACT DE CHARGE, DANS L'ORDRE OÙ L'AUDIT LES A DEMANDÉES (14/09/2026) :
// un schéma versionné, un artefact minimal valide, un artefact `complete: false`, un validateur en
// CI, le refus d'un champ obligatoire absent, la compatibilité du schéma 1. Puis ce que les dixième
// et onzième passes ont ajouté : le schéma COMPILÉ en entier avant tout artefact (ajv strict, plus un
// parcours pour les chemins), les invariants entre nombres, la cohorte comme campagne, l'ancre de
// publication relue au tag, et une doctrine de version qui ne promet pas deux choses contraires.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

import { RACINE } from "./aide/arbre-outils.mjs";
import {
  auditer, validerArtefact, compilerSchema, controlerSchema, controlerVocabulaireSchema, controlerSemantiqueArtefact, controlerCohorte, controlerAncres,
  jugerArtefact, schemasPresents, empreinteSchema, binSetIdDe, MOTS_CLES, SCHEMA_DE, EXEMPLES, ANCRES, OBSERVATIONS_MIN, CONSTANTES_DE_COHORTE, VARIABLES_D_ECHELLE,
} from "../artefact-de-charge.mjs";

const SCHEMA = SCHEMA_DE(1);
const schema = JSON.parse(readFileSync(join(RACINE, SCHEMA), "utf8"));
const EMPREINTE = empreinteSchema(schema);
const schemas = new Map([[1, { schema, empreinte: EMPREINTE }]]);
const lire = (nom) => JSON.parse(readFileSync(join(RACINE, EXEMPLES, nom), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const minimal = () => lire("schema-1-minimal.json");
const incomplet = () => lire("schema-1-incomplet.json");
const constatsDe = (a) => jugerArtefact(a, schemas).constats.join("\n");

/**
 * ⚠️ LE CONTRAT DU SCHÉMA 1, FIGÉ ICI — TOUTES SES CLÉS. Ce littéral se modifie dans le même commit
 * que le schéma : il dit à l'auteur qu'il touche au contrat, il ne PROUVE pas l'immuabilité. La preuve
 * est ailleurs : `ancres.json` et le tag qui a publié le premier artefact (voir « l'ancre »).
 */
const CLES_V1 = ["$defs.memoire.arrayBuffers","$defs.memoire.external","$defs.memoire.heapUsed","$defs.memoire.rss","$defs.percentiles.p50","$defs.percentiles.p95","$defs.percentiles.p99","$defs.percentilesEtMax.max","$defs.percentilesEtMax.p50","$defs.percentilesEtMax.p95","$defs.percentilesEtMax.p99","cache","cache.coalesced","cache.hits","cache.misses","cache.peakInFlight","complete","correctness","correctness.correctResponses","correctness.emptyResponses","correctness.wrongPresentation","counters","counters.after","counters.before","counters.delta","database","database.calls","database.latencyMs","database.peakInFlight","database.timeouts","environment","environment.arch","environment.cpuCount","environment.memoryLimitMiB","environment.memoryLimitSource","environment.node","environment.os","environment.postgresVersion","environment.postgrestVersion","failure","failure.phase","failure.reason","histogram","histogram.binSetId","histogram.counts","histogram.edges","histogram.overflow","histogram.unit","http","http.responseBytes","http.responseBytes.max","http.responseBytes.p50","http.responseBytes.p95","http.responseBytes.total","identity","identity.commitSha","identity.packageVersion","identity.runId","identity.schemaSha256","identity.timestamp","isolation","isolation.cacheReset","isolation.countersReportedAsDeltas","isolation.databaseReset","isolation.datasetId","isolation.metricsReset","isolation.processReused","latencyMs","latencyMs.max","latencyMs.mean","latencyMs.min","latencyMs.n","latencyMs.p50","latencyMs.p95","latencyMs.p99","measurementWindow","measurementWindow.durationMs","measurementWindow.processUptimeEndMs","measurementWindow.processUptimeStartMs","measurementWindow.startedAt","process","process.cpuSystemMs","process.cpuUserMs","process.eventLoopP99Ms","process.memoryMiB","process.memoryMiB.afterGc","process.memoryMiB.baseline","process.memoryMiB.end","process.memoryMiB.peak","relay","relay.admitted","relay.bytesTransferred","relay.chunkBytes","relay.consumerDelayMs","relay.descriptors","relay.descriptors.idle","relay.descriptors.peak","relay.fileBytes","relay.highWaterMark","relay.refused","scenario","scenario.egressIps","scenario.maxInFlight","scenario.name","scenario.position","scenario.presentations","scenario.repetition","scenario.sequence","scenario.spectators","scenario.warmupRequests","schemaVersion","statuses","statuses.2xx","statuses.429","statuses.503","statuses.other","statuses.other4xx","statuses.other5xx","workload","workload.arrivalModel","workload.arrivalPattern","workload.completedRequests","workload.generatorLagMs","workload.scheduledRequests","workload.startedRequests"];
const REQUIS_V1 = ["schemaVersion", "complete", "failure", "identity", "environment", "scenario", "workload", "isolation", "measurementWindow"];
const REQUIS_SI_COMPLET_V1 = ["latencyMs", "statuses", "http", "database", "cache", "process", "correctness", "counters"];

function clesDe(s) {
  const vues = new Set();
  const marcher = (o, p) => {
    if (!o || typeof o !== "object") return;
    if (o.properties) for (const [k, v] of Object.entries(o.properties)) { const q = p ? `${p}.${k}` : k; vues.add(q); marcher(v, q); }
    if (o.items) marcher(o.items, `${p}[]`);
    if (o.allOf) o.allOf.forEach((x) => { marcher(x.if, p); marcher(x.then, p); marcher(x.else, p); });
  };
  marcher(s, "");
  for (const [k, v] of Object.entries(s.$defs || {})) marcher(v, `$defs.${k}`);
  return [...vues].sort();
}

/** Un dépôt git jetable portant `fichiers` au tag `tag`, puis `apres` dans l'arbre de travail. */
function depotAvecTag({ tag, auTag, apres }) {
  const d = mkdtempSync(join(tmpdir(), "ancre-"));
  const git = (...args) => execFileSync("git", args, { cwd: d, stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q");
  mkdirSync(join(d, EXEMPLES), { recursive: true });
  for (const [f, contenu] of Object.entries(auTag)) writeFileSync(join(d, f), contenu);
  git("add", "-A"); git("commit", "-q", "-m", "publication"); git("tag", tag);
  for (const [f, contenu] of Object.entries(apres)) writeFileSync(join(d, f), contenu);
  return d;
}

describe("1. le schéma est versionné, et la version est figée dedans", () => {
  it("le fichier porte son numéro, schemaVersion vaut 1 par `const`, $id porte la version, la racine n'accepte aucune clé non déclarée", () => {
    expect(SCHEMA).toBe("charge/artefact.schema-1.json");
    expect(controlerSchema(schema, 1)).toEqual([]);
    expect(schema.properties.schemaVersion.const).toBe(1);
    expect(schemasPresents().get(1).schema).toEqual(schema);
    expect(schemasPresents().get(1).empreinte).toBe(EMPREINTE);
  });
  it("le contrôle du schéma refuse un schéma qui ne fige pas sa version ou qui ouvre sa racine", () => {
    expect(controlerSchema({ ...clone(schema), properties: { ...schema.properties, schemaVersion: { type: "integer" } } }, 1)).toHaveLength(1);
    expect(controlerSchema({ ...clone(schema), additionalProperties: true }, 1)).toHaveLength(1);
    expect(controlerSchema(schema, 2)).toHaveLength(2);
  });
  it("l'empreinte est canonique : un reformatage ne la change pas, une borne modifiée la change", () => {
    expect(empreinteSchema(JSON.parse(JSON.stringify(schema, null, 8)))).toBe(EMPREINTE);
    const s = clone(schema); s.properties.environment.properties.cpuCount.minimum = 2;
    expect(empreinteSchema(s)).not.toBe(EMPREINTE);
  });
});

describe("2. et 3. le corpus : un artefact minimal valide, un artefact incomplet", () => {
  it("l'exemple minimal est conforme en forme ET en invariants, il est COMPLET, et il porte l'empreinte du schéma", () => {
    const a = minimal();
    expect(a.complete).toBe(true);
    expect(a.identity.schemaSha256).toBe(EMPREINTE);
    expect(validerArtefact(a, schema).constats).toEqual([]);
    expect(controlerSemantiqueArtefact(a, { empreinte: EMPREINTE })).toEqual([]);
  });
  it("l'exemple `complete: false` est conforme SANS les blocs de mesure, et porte sa raison", () => {
    const a = incomplet();
    expect(a.complete).toBe(false);
    expect(a.latencyMs).toBeUndefined();
    expect(typeof a.failure.reason).toBe("string");
    expect(constatsDe(a)).toBe("");
  });
  it("⚠️ un artefact incomplet SANS raison est refusé : une absence d'artefact ne doit pas ressembler à un banc réussi, et un artefact sans raison non plus", () => {
    const a = incomplet(); a.failure.reason = null;
    expect(constatsDe(a)).toMatch(/artefact\.failure\.reason : type null, attendu string/);
  });
  it("un artefact COMPLET sans ses blocs de mesure est refusé, bloc par bloc", () => {
    const a = minimal();
    for (const bloc of REQUIS_SI_COMPLET_V1) delete a[bloc];
    const texte = constatsDe(a);
    for (const bloc of REQUIS_SI_COMPLET_V1) expect(texte).toMatch(new RegExp(`artefact\\.${bloc} : champ obligatoire absent`));
  });
  it("⚠️ complete: false + scénario relay SANS le bloc relay → conforme ; complete: true → refusé", () => {
    const a = incomplet(); a.scenario.name = "relay";
    expect(constatsDe(a)).toBe("");
    const b = minimal(); b.scenario.name = "relay";
    expect(constatsDe(b)).toMatch(/artefact\.relay : champ obligatoire absent/);
    b.relay = { fileBytes: 8, chunkBytes: 1, highWaterMark: 1, consumerDelayMs: 0, bytesTransferred: 8000, admitted: 1000, refused: 0, descriptors: { idle: 1, peak: 2 } };
    expect(constatsDe(b)).toBe("");
  });
  it("⚠️ un artefact qui ne porte pas l'empreinte du schéma appliqué est refusé : il a été produit sous un autre schéma, ou n'en nomme aucun", () => {
    const a = minimal(); a.identity.schemaSha256 = "0".repeat(64);
    expect(constatsDe(a)).toMatch(/artefact\.identity\.schemaSha256 : "0{64}" n'est pas l'empreinte du schéma appliqué/);
  });
});

describe("5. le refus d'un champ obligatoire absent, avec son chemin", () => {
  it("chaque champ obligatoire de la racine, retiré un à un, est refusé PAR SON NOM", () => {
    for (const champ of REQUIS_V1) {
      const a = minimal(); delete a[champ];
      expect(validerArtefact(a, schema).constats.join("\n"), champ).toMatch(new RegExp(`artefact\\.${champ} : champ obligatoire absent`));
    }
  });
  it("un champ obligatoire absent EN PROFONDEUR est refusé avec son chemin complet", () => {
    const a = minimal();
    delete a.process.memoryMiB.afterGc; delete a.workload.generatorLagMs.max; delete a.workload.arrivalPattern; delete a.identity.schemaSha256;
    const texte = constatsDe(a);
    expect(texte).toMatch(/artefact\.process\.memoryMiB\.afterGc : champ obligatoire absent/);
    expect(texte).toMatch(/artefact\.workload\.generatorLagMs\.max : champ obligatoire absent/);
    expect(texte).toMatch(/artefact\.workload\.arrivalPattern : champ obligatoire absent/);
    expect(texte).toMatch(/artefact\.identity\.schemaSha256 : champ obligatoire absent/);
  });
  it("⚠️ aucune clé ne s'ajoute sans être écrite : une clé hors schéma est refusée, à la racine comme en profondeur — les dérivées retirées comprises", () => {
    const a = minimal(); a.nouvelleCle = 1; a.latencyMs.p999 = 0; a.scenario.requests = 0; a.throughputRps = 1000; a.database.callsPerRequest = 0; a.correctness.completed = 0;
    const texte = constatsDe(a);
    for (const cle of ["nouvelleCle", "latencyMs.p999", "scenario.requests", "throughputRps", "database.callsPerRequest", "correctness.completed"]) expect(texte).toMatch(new RegExp(`artefact\\.${cle.replace(".", "\\.")} : clé non déclarée`));
  });
  it("les types et les bornes mordent : un p95 négatif, un cpuCount à zéro, un sha court, des énumérations inconnues, une séquence vide", () => {
    const a = minimal();
    a.latencyMs.p95 = -1; a.environment.cpuCount = 0; a.identity.commitSha = "abc"; a.scenario.name = "warm"; a.workload.arrivalModel = "jittered"; a.workload.arrivalPattern = "open-loop"; a.scenario.sequence = []; a.isolation.datasetId = "";
    const texte = constatsDe(a);
    expect(texte).toMatch(/artefact\.latencyMs\.p95 : -1 < minimum 0/);
    expect(texte).toMatch(/artefact\.environment\.cpuCount : 0 < minimum 1/);
    expect(texte).toMatch(/artefact\.identity\.commitSha : "abc" ne respecte pas/);
    expect(texte).toMatch(/artefact\.scenario\.name : "warm" n'est pas parmi/);
    expect(texte).toMatch(/artefact\.workload\.arrivalModel : "jittered" n'est pas parmi/);
    expect(texte).toMatch(/artefact\.workload\.arrivalPattern : "open-loop" n'est pas parmi/);
    expect(texte).toMatch(/artefact\.scenario\.sequence : 0 élément\(s\), minimum 1/);
    expect(texte).toMatch(/artefact\.isolation\.datasetId : chaîne de 0 caractère\(s\), minimum 1/);
  });
});

describe("⚠️ les invariants entre nombres : un artefact aux bonnes clés peut encore ne rien mesurer, ou se contredire", () => {
  const edges = () => minimal().histogram.edges;
  const cas = [
    ["complete: true avec une raison d'échec", (a) => { a.failure.reason = "échec"; }, /artefact\.failure : un artefact complete: true ne porte ni phase ni reason/],
    ["position hors de sequence", (a) => { a.scenario.position = 9; }, /artefact\.scenario\.position : 9 hors de sequence/],
    ["spectators ≠ sequence[position − 1]", (a) => { a.scenario.sequence = [100, 1000, 100]; a.scenario.position = 2; a.scenario.spectators = 999; }, /artefact\.scenario\.spectators : 999 alors que sequence\[1\] vaut 1000/],
    ["scheduled < started < completed", (a) => { a.workload.scheduledRequests = 10; a.workload.startedRequests = 20; a.workload.completedRequests = 30; }, /startedRequests \(20\) > scheduledRequests \(10\)[\s\S]*completedRequests \(30\) > startedRequests \(20\)/],
    ["quantiles désordonnés", (a) => { Object.assign(a.latencyMs, { min: 100, p50: 4, p95: 3, p99: 2, max: 1, mean: 50 }); }, /artefact\.latencyMs : min \(100\) > p50 \(4\)/],
    ["mean hors de [min, max]", (a) => { Object.assign(a.latencyMs, { min: 1, mean: 9, max: 5, p50: 1, p95: 1, p99: 1 }); }, /artefact\.latencyMs\.mean : 9 hors de \[min 1, max 5\]/],
    ["histogramme dont la première borne n'est pas 0", (a) => { const e = [1, 2]; a.histogram = { unit: "ms", binSetId: binSetIdDe(e), edges: e, counts: [1000], overflow: 0 }; }, /artefact\.histogram\.edges\[0\] : 1 — la première borne est 0/],
    ["histogramme aux classes non croissantes", (a) => { const e = [0, 100, 1]; a.histogram = { unit: "ms", binSetId: binSetIdDe(e), edges: e, counts: [1000, 0], overflow: 0 }; }, /artefact\.histogram\.edges : 100 puis 1/],
    ["histogramme : autant de comptes que de bords", (a) => { const e = [0, 1, 2]; a.histogram = { unit: "ms", binSetId: binSetIdDe(e), edges: e, counts: [500, 500, 0], overflow: 0 }; }, /artefact\.histogram\.counts : 3 classe\(s\) pour 3 bord\(s\)/],
    ["histogramme dont comptes + débordement ne font pas n", (a) => { a.histogram.overflow = 1; }, /artefact\.histogram\.counts : somme 1001 \(débordement compris\) pour latencyMs\.n 1000/],
    ["⚠️ binSetId qui n'est pas dérivé de SES bornes : deux jeux de bornes ne portent jamais le même identifiant", (a) => { a.histogram.edges = [0, 2]; a.histogram.counts = [1000]; }, /artefact\.histogram\.binSetId : "edges-sha256-[0-9a-f]{16}" n'est pas dérivé de ces bornes \(attendu edges-sha256-[0-9a-f]{16}\)/],
    ["uptime qui recule", (a) => { a.measurementWindow.processUptimeEndMs = 0; a.measurementWindow.processUptimeStartMs = 5; }, /processUptimeEndMs \(0\) < processUptimeStartMs \(5\)/],
    ["complete sans durée", (a) => { a.measurementWindow.durationMs = 0; }, /artefact\.measurementWindow\.durationMs : 0 — un artefact complet a duré/],
    ["complete avec trop peu d'observations", (a) => { a.latencyMs.n = 999; a.workload.completedRequests = 999; a.workload.startedRequests = 999; a.statuses["2xx"] = 999; a.correctness.correctResponses = 999; a.histogram.counts[1] = 999; }, new RegExp(`artefact\\.latencyMs\\.n : 999 observation\\(s\\), un artefact complet en porte au moins ${OBSERVATIONS_MIN}`)],
    ["n ≠ completedRequests", (a) => { a.latencyMs.n = 1001; }, /artefact\.latencyMs\.n : 1001 observation\(s\) pour 1000 requête\(s\) achevée\(s\)/],
    ["statuts dont la somme n'est pas completedRequests", (a) => { a.statuses["429"] = 1; }, /artefact\.statuses : somme 1001 pour 1000 requête\(s\) achevée\(s\)/],
    ["⚠️ mille 2xx dont aucune inspectée", (a) => { a.correctness = { correctResponses: 0, emptyResponses: 0, wrongPresentation: 0 }; }, /artefact\.correctness : 0 réponse\(s\) jugée\(s\) pour 1000 réponse\(s\) 2xx — chaque 2xx est inspectée/],
    ["exactitude qui juge plus de 2xx qu'il n'en est arrivé", (a) => { a.correctness.emptyResponses = 1; }, /artefact\.correctness : 1001 réponse\(s\) jugée\(s\) pour 1000 réponse\(s\) 2xx/],
    ["timeouts > calls", (a) => { a.database.calls = 1; a.database.timeouts = 2; }, /artefact\.database\.timeouts : 2 pour 1 appel\(s\)/],
    ["pic mémoire sous le départ", (a) => { a.process.memoryMiB.peak.rss = 10; }, /artefact\.process\.memoryMiB\.peak\.rss : 10 < baseline 60/],
    ["pic mémoire sous la fin", (a) => { a.process.memoryMiB.end.external = 99; }, /artefact\.process\.memoryMiB\.peak\.external : 9 < end 99/],
    ["delta ≠ after − before", (a) => { a.counters = { before: { x: 1 }, after: { x: 3 }, delta: { x: 1 } }; }, /artefact\.counters\.delta\.x : 1 alors que after − before vaut 2/],
    ["un compteur absent d'un des trois relevés", (a) => { a.counters = { before: { x: 1 }, after: { x: 3 }, delta: {} }; }, /artefact\.counters : « x » n'est pas dans les trois relevés/],
    ["plafond mémoire inconnu mais chiffré", (a) => { a.environment.memoryLimitMiB = 256; }, /artefact\.environment\.memoryLimitMiB : 256 avec memoryLimitSource unknown/],
    ["plafond mémoire nommé mais null", (a) => { a.environment.memoryLimitSource = "cgroup"; }, /source "cgroup" nommée mais plafond null/],
  ];
  for (const [titre, casser, attendu] of cas) {
    it(`${titre} → refusé, avec son chemin`, () => {
      const a = minimal(); casser(a);
      expect(constatsDe(a)).toMatch(attendu);
    });
  }
  it("l'histogramme de l'exemple porte un identifiant DÉRIVÉ de ses bornes, et le dérivé est stable", () => {
    expect(minimal().histogram.binSetId).toBe(binSetIdDe(edges()));
    expect(binSetIdDe([0, 1])).toMatch(/^edges-sha256-[0-9a-f]{16}$/);
    expect(binSetIdDe([0, 1])).not.toBe(binSetIdDe([0, 2]));
  });
  it("les relations du bloc relay : admis + refusés = achevées, refusés ≤ 503, octets ≤ admis × taille, pic ≥ repos", () => {
    const base = () => { const a = minimal(); a.scenario.name = "relay"; a.relay = { fileBytes: 8, chunkBytes: 1, highWaterMark: 1, consumerDelayMs: 0, bytesTransferred: 8000, admitted: 1000, refused: 0, descriptors: { idle: 1, peak: 2 } }; return a; };
    expect(constatsDe(base())).toBe("");
    let a = base(); a.relay.admitted = 999;
    expect(constatsDe(a)).toMatch(/artefact\.relay : admitted \(999\) \+ refused \(0\) ≠ completedRequests \(1000\)/);
    a = base(); a.relay.admitted = 999; a.relay.refused = 1;
    expect(constatsDe(a)).toMatch(/artefact\.relay\.refused : 1 > statuses\.503 \(0\)/);
    a = base(); a.relay.bytesTransferred = 8001;
    expect(constatsDe(a)).toMatch(/artefact\.relay\.bytesTransferred : 8001 > admitted × fileBytes \(8000\)/);
    a = base(); a.relay.descriptors.peak = 0;
    expect(constatsDe(a)).toMatch(/artefact\.relay\.descriptors\.peak : 0 < idle 1/);
  });
  it("un artefact incomplet n'est pas tenu à la durée ni aux observations, mais ses autres invariants tiennent", () => {
    const a = incomplet(); a.scenario.position = 4;
    expect(constatsDe(a)).toMatch(/artefact\.scenario\.position : 4 hors de sequence \(3 rang\(s\)\)/);
    a.scenario.position = 2;
    expect(constatsDe(a)).toBe("");
  });
  it("la forme passe avant les invariants : un artefact difforme n'est pas jugé sur ses nombres", () => {
    const a = minimal(); delete a.latencyMs; a.failure.reason = "x";
    const texte = constatsDe(a);
    expect(texte).toMatch(/artefact\.latencyMs : champ obligatoire absent/);
    expect(texte).not.toMatch(/ne porte ni phase ni reason/);
  });
});

describe("⚠️ la cohorte est une campagne, pas un tas de fichiers", () => {
  const membre = (i, n, sequence = [100, 1000, 100]) => {
    const a = minimal();
    a.scenario.sequence = sequence; a.scenario.position = i; a.scenario.spectators = n; a.isolation.datasetId = `jeu-${i}`;
    return { nom: `p${i}.json`, artefact: a };
  };
  const trio = () => [membre(1, 100), membre(2, 1000), membre(3, 100)];
  const interrompu = (i) => {
    const { nom, artefact: m } = membre(i, [100, 1000, 100][i - 1]);
    m.complete = false; m.failure = { phase: "load", reason: "la course s'est arrêtée" };
    for (const bloc of ["latencyMs", "histogram", "statuses", "http", "database", "cache", "process", "correctness", "counters"]) delete m[bloc];
    return { nom, artefact: m };
  };
  it("trois positions 1..3, tous complets, tout ce qui doit être constant l'est → rien à redire", () => {
    expect(controlerCohorte(trio())).toEqual([]);
    for (const { artefact } of trio()) expect(constatsDe(artefact)).toBe("");
  });
  it("⚠️ deux artefacts complets sur une séquence de trois → refusé : une campagne complète tient toutes ses positions", () => {
    expect(controlerCohorte(trio().slice(0, 2)).join("\n")).toMatch(/cohorte : 2 artefact\(s\) tous complets pour une séquence de 3/);
  });
  it("un préfixe interrompu 1..2 dont le dernier est complete: false → recevable ; un trou, un incomplet suivi d'un complet, deux incomplets → refusés", () => {
    expect(controlerCohorte([membre(1, 100), interrompu(2)])).toEqual([]);
    expect(controlerCohorte([membre(1, 100), membre(3, 100)]).join("\n")).toMatch(/cohorte : positions \[1,3\] — une cohorte est un préfixe continu 1\.\.k/);
    expect(controlerCohorte([interrompu(1), membre(2, 1000)]).join("\n")).toMatch(/cohorte : p1\.json incomplet\(s\) mais p2\.json complet après — rien ne suit le premier échec/);
    expect(controlerCohorte([interrompu(1), interrompu(2)]).join("\n")).toMatch(/cohorte : 2 artefacts incomplets .* — une campagne s'arrête au premier échec/);
  });
  it("⚠️ l'environnement, le protocole et l'empreinte du schéma sont constants ; ce qui varie avec l'échelle est nommément exclu", () => {
    const t = trio();
    t[1].artefact.environment.node = "v99"; t[2].artefact.workload.arrivalPattern = "burst"; t[2].artefact.isolation.cacheReset = false; t[1].artefact.identity.schemaSha256 = "f".repeat(64);
    const texte = controlerCohorte(t).join("\n");
    expect(texte).toMatch(/p2\.json : environment \{.*"node":"v99".*\} diffère de p1\.json/);
    expect(texte).toMatch(/p3\.json : workload\.arrivalPattern "burst" diffère de p1\.json \("uniform"\)/);
    expect(texte).toMatch(/p3\.json : isolation\.cacheReset false diffère de p1\.json \(true\)/);
    expect(texte).toMatch(/p2\.json : identity\.schemaSha256 "f{64}" diffère/);
    // Ce qui varie : les effectifs, les rangs, le plafond en vol, le jeu de données — jamais comparés.
    const v = trio(); v[1].artefact.scenario.maxInFlight = 1000;
    expect(controlerCohorte(v)).toEqual([]);
    for (const chemin of VARIABLES_D_ECHELLE) expect(CONSTANTES_DE_COHORTE, chemin).not.toContain(chemin);
  });
  it("un même binSetId avec des bornes différentes, une position doublée, un jeu réemployé, un runId qui diffère → nommés", () => {
    const t = trio();
    t[2].artefact.scenario.position = 1; t[2].artefact.scenario.spectators = 100;
    t[1].artefact.isolation.datasetId = "jeu-1";
    t[1].artefact.identity.runId = "autre";
    t[1].artefact.histogram.edges = [0, 2]; t[1].artefact.histogram.counts = [1000];   // même binSetId (copié), autres bornes
    const texte = controlerCohorte(t).join("\n");
    expect(texte).toMatch(/p3\.json : position 1 déjà tenue par p1\.json/);
    expect(texte).toMatch(/p2\.json : datasetId "jeu-1" déjà employé par p1\.json/);
    expect(texte).toMatch(/p2\.json : identity\.runId "autre" diffère de p1\.json/);
    expect(texte).toMatch(/p2\.json : histogram\.binSetId edges-sha256-[0-9a-f]{16} porte les bornes \[0,2\] alors que p1\.json porte/);
  });
});

describe("6. la compatibilité du schéma 1, et sa doctrine", () => {
  it("un autre numéro de version est refusé : la série ne mélange pas deux sémantiques", () => {
    const a = minimal(); a.schemaVersion = 2;
    expect(validerArtefact(a, schema).constats.join("\n")).toMatch(/artefact\.schemaVersion : vaut 2, attendu exactement 1/);
    expect(constatsDe(a)).toMatch(/aucun schéma de ce numéro \(présents : 1\)/);
  });
  it("⚠️ TOUTES les clés du schéma 1 sont EXACTEMENT celles figées ici — une clé en plus ou en moins est un schéma 2", () => {
    expect(clesDe(schema)).toEqual(CLES_V1);
    expect([...schema.required].sort()).toEqual([...REQUIS_V1].sort());
    const complet = schema.allOf.find((s) => s.if?.properties?.complete?.const === true && !s.if?.properties?.scenario);
    expect([...complet.then.required].sort()).toEqual([...REQUIS_SI_COMPLET_V1].sort());
  });
  it("le schéma et le README disent la même doctrine : immuable une fois publié, un schéma suivant pour toute clé ou sémantique nouvelle", () => {
    const readme = readFileSync(join(RACINE, "charge/artefacts/README.md"), "utf8");
    for (const texte of [schema.description, readme]) {
      expect(texte).toMatch(/immuable/i);
      expect(texte).not.toMatch(/optionnelle s'ajoute sans changer de version/);
    }
  });
  it("tout artefact du corpus valide sous son schéma — le corpus EST le test de compatibilité", () => {
    const noms = readdirSync(join(RACINE, EXEMPLES)).filter((f) => f.endsWith(".json"));
    expect(noms.length).toBeGreaterThanOrEqual(2);
    for (const nom of noms) expect(constatsDe(lire(nom)), nom).toBe("");
  });
});

describe("⚠️ l'ancre : l'immuabilité se prouve contre le tag qui a publié, pas contre la copie courante", () => {
  const fichiers = (s) => ({ [SCHEMA]: JSON.stringify(s), [join(EXEMPLES, "schema-1-minimal.json")]: JSON.stringify(minimal()), [join(EXEMPLES, "schema-1-incomplet.json")]: JSON.stringify(incomplet()) });
  it("sans ancres.json : rien n'est ancré, la garde le dit dans son résumé, et aucun git n'est appelé", () => {
    const r = controlerAncres(schemas, { racine: mkdtempSync(join(tmpdir(), "sans-ancre-")), lireAuTag: () => { throw new Error("ne doit pas être appelé"); } });
    expect(r).toEqual({ constats: [], raisons: [], ancres: 0 });
    expect(auditer().resume).toMatch(/aucun schéma encore ancré à une publication/);
  });
  it("⚠️ schéma modifié après le tag qui l'a publié → VIOLATION, empreintes nommées, remède : un schéma 2", () => {
    const modifie = clone(schema); modifie.properties.environment.properties.cpuCount.minimum = 2;
    const d = depotAvecTag({ tag: "v9.9.9", auTag: { ...fichiers(schema), [ANCRES]: JSON.stringify({ 1: { tag: "v9.9.9" } }) }, apres: { [SCHEMA]: JSON.stringify(modifie) } });
    try {
      const r = auditer({ racine: d });
      expect(r.code, JSON.stringify(r)).toBe(1);
      expect(r.constats.join("\n")).toMatch(/charge\/artefact\.schema-1\.json : empreinte [0-9a-f]{16}… alors que le tag v9\.9\.9, qui a publié le premier artefact 1, porte [0-9a-f]{16}… — un schéma publié est immuable : toute clé ou sémantique nouvelle fait un schéma 2/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it("schéma identique au tag (reformaté, même empreinte) → conforme, et le résumé compte l'ancre relue", () => {
    const d = depotAvecTag({ tag: "v9.9.9", auTag: { ...fichiers(schema), [ANCRES]: JSON.stringify({ 1: { tag: "v9.9.9" } }) }, apres: { [SCHEMA]: JSON.stringify(schema, null, 4) } });
    try {
      const r = auditer({ racine: d });
      expect(r.code, JSON.stringify(r)).toBe(0);
      expect(r.resume).toMatch(/1 ancre\(s\) de publication relue\(s\) au tag/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it("tag illisible ou git absent → NON CONCLUANT, jamais vert ; un schéma ancré qui a disparu → violation", () => {
    const d = mkdtempSync(join(tmpdir(), "ancre-"));
    try {
      mkdirSync(join(d, EXEMPLES), { recursive: true });
      for (const [f, c] of Object.entries(fichiers(schema))) writeFileSync(join(d, f), c);
      writeFileSync(join(d, ANCRES), JSON.stringify({ 1: { tag: "v9.9.9" }, 2: { tag: "v9.9.9" } }));
      const r = auditer({ racine: d, lireAuTag: () => { throw new Error("fatal: not a git repository"); } });
      expect(r.code).toBe(2);
      expect(r.raisons.join("\n")).toMatch(/git show v9\.9\.9:charge\/artefact\.schema-1\.json.*a échoué \(fatal: not a git repository\)/);
      const r2 = controlerAncres(schemasPresents(d), { racine: d, lireAuTag: () => JSON.stringify(schema) });
      expect(r2.constats.join("\n")).toMatch(/le schéma 2 est ancré au tag v9\.9\.9 mais charge\/artefact\.schema-2\.json n'est plus là/);
      writeFileSync(join(d, ANCRES), JSON.stringify({ 1: { tag: "pas-un-tag" } }));
      expect(controlerAncres(schemasPresents(d), { racine: d }).raisons.join("\n")).toMatch(/ne nomme pas un tag vX\.Y\.Z/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});

describe("⚠️ le schéma est COMPILÉ en entier, avant tout artefact — jamais lu seulement là où le corpus passe", () => {
  it("un mot-clé de schéma inconnu FAIT LEVER en validant, il n'est pas ignoré", () => {
    const s = clone(schema); s.properties.latencyMs.properties.p99.multipleOf = 0.5;
    expect(() => validerArtefact(minimal(), s)).toThrow(/mot-clé de schéma inconnu « multipleOf »/);
  });
  it("⚠️ un $ref EXTERNE dans une branche optionnelle absente du corpus → non concluant, avec le chemin du $ref (la reproduction de l'audit)", () => {
    const s = clone(schema); s.properties.histogram.properties.edges.items = { $ref: "https://example.invalid/schema" };
    expect(controlerVocabulaireSchema(s)).toEqual(["#/properties/histogram/properties/edges/items/$ref : référence \"https://example.invalid/schema\" non prise en charge ou introuvable — seuls les « #/… » locaux qui existent le sont"]);
    const d = mkdtempSync(join(tmpdir(), "artefact-"));
    try {
      mkdirSync(join(d, EXEMPLES), { recursive: true });
      writeFileSync(join(d, SCHEMA), JSON.stringify(s));
      for (const nom of ["schema-1-minimal.json", "schema-1-incomplet.json"]) writeFileSync(join(d, EXEMPLES, nom), JSON.stringify(lire(nom)));
      const r = auditer({ racine: d });
      expect(r.code).toBe(2);
      expect(r.raisons.join("\n")).toMatch(/charge\/artefact\.schema-1\.json #\/properties\/histogram\/properties\/edges\/items\/\$ref : référence "https:\/\/example\.invalid\/schema"/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it("un mot-clé inconnu, une référence locale introuvable, un motif incompilable : chacun avec son chemin, dans une branche que rien n'exerce", () => {
    const s = clone(schema);
    s.properties.histogram.properties.edges.p99 = true;
    s.properties.histogram.properties.counts.items = { $ref: "#/$defs/absent" };
    s.properties.histogram.properties.binSetId.pattern = "(";
    const trouves = controlerVocabulaireSchema(s);
    expect(trouves.some((t) => t.startsWith("#/properties/histogram/properties/edges/p99 : mot-clé de schéma inconnu « p99 »"))).toBe(true);
    expect(trouves.some((t) => t.startsWith("#/properties/histogram/properties/counts/items/$ref : référence \"#/$defs/absent\""))).toBe(true);
    expect(trouves.some((t) => t.startsWith("#/properties/histogram/properties/binSetId/pattern : motif \"(\" incompilable"))).toBe(true);
    expect(trouves).toHaveLength(3);
  });
  it("⚠️ ce que le parcours ne regarde pas, ajv strict le refuse : un `required` en chaîne, un `enum` en chaîne, un `type` inconnu, un `minimum` en chaîne — dans une branche absente du corpus", () => {
    for (const [casser, attendu] of [
      [(s) => { s.properties.histogram.required = "unit"; }, /histogram\/required must be array/],
      [(s) => { s.properties.histogram.properties.unit.enum = "ms"; }, /histogram\/properties\/unit\/enum must be array/],
      [(s) => { s.properties.histogram.properties.unit.type = "entier"; }, /histogram\/properties\/unit\/type must be equal to one of the allowed values/],
      [(s) => { s.properties.histogram.properties.overflow.minimum = "0"; }, /histogram\/properties\/overflow\/minimum must be number/],
    ]) {
      const s = clone(schema); casser(s);
      expect(controlerVocabulaireSchema(s)).toEqual([]);
      expect(() => compilerSchema(s)).toThrow(attendu);
      expect(() => compilerSchema(s)).toThrow(/le schéma ne compile pas \(ajv 2020-12, strict\)/);
    }
  });
  it("le vocabulaire du parcours est celui que le schéma emploie, ni plus ni moins d'utile : chaque mot-clé connu apparaît dans le schéma", () => {
    const employes = new Set();
    const marcher = (o) => { if (!o || typeof o !== "object") return; if (Array.isArray(o)) { o.forEach(marcher); return; } for (const [k, v] of Object.entries(o)) { employes.add(k); if (k === "properties" || k === "$defs") Object.values(v).forEach(marcher); else marcher(v); } };
    marcher(schema);
    for (const k of MOTS_CLES) expect(employes.has(k), k).toBe(true);
  });
});

describe("4. la garde de la forge : trois issues", () => {
  it("sur le dépôt : conforme, en nommant les artefacts, la compilation en entier et l'état des ancres", () => {
    const r = auditer();
    expect(r.code, JSON.stringify(r)).toBe(0);
    expect(r.resume).toMatch(/2 artefact\(s\) conformes — forme et invariants — aux schémas 1 compilés en entier \(ajv 2020-12 strict\) ; 2 exemple\(s\) du corpus ; aucun schéma encore ancré/);
  });
  it("des artefacts fournis par --fichier= sont jugés avec le corpus ET confrontés en cohorte, chaque défaut nommé avec son fichier", () => {
    const d = mkdtempSync(join(tmpdir(), "artefact-"));
    try {
      const a = minimal(); a.statuses.other5xx = -3;
      const b = minimal(); b.isolation.datasetId = "exemple-1";
      writeFileSync(join(d, "course-a.json"), JSON.stringify(a));
      writeFileSync(join(d, "course-b.json"), JSON.stringify(b));
      const r = auditer({ fichiers: [join(d, "course-a.json"), join(d, "course-b.json")] });
      expect(r.code).toBe(1);
      const texte = r.constats.join("\n");
      expect(texte).toMatch(/course-a\.json — artefact\.statuses\.other5xx : -3 < minimum 0/);
      expect(texte).toMatch(/cohorte — course-b\.json : position 1 déjà tenue par course-a\.json/);
      expect(texte).toMatch(/cohorte — course-b\.json : datasetId "exemple-1" déjà employé par course-a\.json/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it("⚠️ NON CONCLUANT sans schéma, sans corpus, ou avec un corpus qui ne couvre qu'une branche — jamais vert sur rien", () => {
    const d = mkdtempSync(join(tmpdir(), "artefact-"));
    try {
      expect(auditer({ racine: d }).code).toBe(2);
      mkdirSync(join(d, EXEMPLES), { recursive: true });
      writeFileSync(join(d, SCHEMA), JSON.stringify(schema));
      expect(auditer({ racine: d }).code).toBe(2);
      writeFileSync(join(d, EXEMPLES, "seul.json"), JSON.stringify(minimal()));
      const r = auditer({ racine: d });
      expect(r.code).toBe(2);
      expect(r.raisons.join("\n")).toMatch(/ne couvre pas les deux branches du schéma 1/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it("un corpus dont la fixture complète est VIDE (zéro observation, zéro durée) est refusé : le même validateur jugera les vrais rapports", () => {
    const d = mkdtempSync(join(tmpdir(), "artefact-"));
    try {
      mkdirSync(join(d, EXEMPLES), { recursive: true });
      writeFileSync(join(d, SCHEMA), JSON.stringify(schema));
      const a = minimal(); a.latencyMs.n = 0; a.workload = { ...a.workload, scheduledRequests: 0, startedRequests: 0, completedRequests: 0 }; a.measurementWindow.durationMs = 0; a.statuses["2xx"] = 0; a.correctness.correctResponses = 0; a.histogram.counts[1] = 0;
      writeFileSync(join(d, EXEMPLES, "vide.json"), JSON.stringify(a));
      writeFileSync(join(d, EXEMPLES, "incomplet.json"), JSON.stringify(incomplet()));
      const r = auditer({ racine: d });
      expect(r.code).toBe(1);
      expect(r.constats.join("\n")).toMatch(/vide\.json — artefact\.measurementWindow\.durationMs : 0/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
