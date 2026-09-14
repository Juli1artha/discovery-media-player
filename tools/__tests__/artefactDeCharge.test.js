// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES SIX PIÈCES DE L'ARTEFACT DE CHARGE, DANS L'ORDRE OÙ L'AUDIT LES A DEMANDÉES (14/09/2026) :
// un schéma versionné, un artefact minimal valide, un artefact `complete: false`, un validateur en
// CI, le refus d'un champ obligatoire absent, la compatibilité du schéma 1. Puis ce que la onzième
// passe a ajouté : le vocabulaire du schéma lu EN ENTIER avant tout artefact, les invariants entre
// nombres, la cohorte, et une doctrine de version qui ne promet pas deux choses contraires.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { RACINE } from "./aide/arbre-outils.mjs";
import {
  auditer, validerArtefact, controlerSchema, controlerVocabulaireSchema, controlerSemantiqueArtefact, controlerCohorte,
  jugerArtefact, schemasPresents, MOTS_CLES, SCHEMA_DE, EXEMPLES, OBSERVATIONS_MIN,
} from "../artefact-de-charge.mjs";

const SCHEMA = SCHEMA_DE(1);
const schema = JSON.parse(readFileSync(join(RACINE, SCHEMA), "utf8"));
const schemas = new Map([[1, schema]]);
const lire = (nom) => JSON.parse(readFileSync(join(RACINE, EXEMPLES, nom), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));
const minimal = () => lire("schema-1-minimal.json");
const incomplet = () => lire("schema-1-incomplet.json");
const constatsDe = (a) => jugerArtefact(a, schemas).constats.join("\n");

/**
 * ⚠️ LE CONTRAT DU SCHÉMA 1, FIGÉ ICI — TOUTES SES CLÉS, pas seulement la racine. Doctrine : ce schéma
 * est immuable dès le premier artefact publié sous son numéro ; une clé en plus ou en moins, obligatoire
 * ou non, est un schéma 2. Ce banc le dit avant la forge. (La première version ne figeait que la racine,
 * et promettait en même temps des ajouts optionnels sans changement de numéro — deux promesses qu'un
 * objet fermé ne peut pas tenir ensemble ; audit, onzième passe.)
 */
const CLES_V1 = ["$defs.memoire.arrayBuffers","$defs.memoire.external","$defs.memoire.heapUsed","$defs.memoire.rss","$defs.percentiles.p50","$defs.percentiles.p95","$defs.percentiles.p99","$defs.percentilesEtMax.max","$defs.percentilesEtMax.p50","$defs.percentilesEtMax.p95","$defs.percentilesEtMax.p99","cache","cache.coalesced","cache.hits","cache.misses","cache.peakInFlight","complete","correctness","correctness.completed","correctness.emptyResponses","correctness.wrongPresentation","counters","counters.after","counters.before","counters.delta","database","database.calls","database.callsPerRequest","database.latencyMs","database.peakInFlight","database.timeouts","environment","environment.arch","environment.cpuCount","environment.memoryLimitMiB","environment.memoryLimitSource","environment.node","environment.os","environment.postgresVersion","environment.postgrestVersion","failure","failure.phase","failure.reason","histogram","histogram.binSetId","histogram.counts","histogram.edges","histogram.unit","http","http.responseBytes","http.responseBytes.max","http.responseBytes.p50","http.responseBytes.p95","http.responseBytes.total","identity","identity.commitSha","identity.packageVersion","identity.runId","identity.timestamp","isolation","isolation.cacheReset","isolation.countersReportedAsDeltas","isolation.databaseReset","isolation.datasetId","isolation.metricsReset","isolation.processReused","latencyMs","latencyMs.max","latencyMs.mean","latencyMs.min","latencyMs.n","latencyMs.p50","latencyMs.p95","latencyMs.p99","measurementWindow","measurementWindow.durationMs","measurementWindow.processUptimeEndMs","measurementWindow.processUptimeStartMs","measurementWindow.startedAt","process","process.cpuSystemMs","process.cpuUserMs","process.eventLoopP99Ms","process.memoryMiB","process.memoryMiB.afterGc","process.memoryMiB.baseline","process.memoryMiB.end","process.memoryMiB.peak","relay","relay.admitted","relay.bytesTransferred","relay.chunkBytes","relay.consumerDelayMs","relay.descriptors","relay.descriptors.idle","relay.descriptors.peak","relay.fileBytes","relay.highWaterMark","relay.refused","scenario","scenario.egressIps","scenario.maxInFlight","scenario.name","scenario.position","scenario.presentations","scenario.repetition","scenario.sequence","scenario.spectators","scenario.warmupRequests","schemaVersion","statuses","statuses.2xx","statuses.429","statuses.503","statuses.other","statuses.other4xx","statuses.other5xx","throughputRps","workload","workload.arrivalModel","workload.arrivalPattern","workload.completedRequests","workload.generatorLagMs","workload.scheduledRequests","workload.startedRequests"];
const REQUIS_V1 = ["schemaVersion", "complete", "failure", "identity", "environment", "scenario", "workload", "isolation", "measurementWindow"];
const REQUIS_SI_COMPLET_V1 = ["latencyMs", "throughputRps", "statuses", "http", "database", "cache", "process", "correctness", "counters"];

/** Toutes les clés déclarées d'un schéma, en chemins pointés, dédoublonnées. */
function clesDe(s) {
  const vues = new Set();
  const marcher = (o, p) => {
    if (!o || typeof o !== "object") return;
    if (o.properties) for (const [k, v] of Object.entries(o.properties)) { const q = p ? `${p}.${k}` : k; vues.add(q); marcher(v, q); }
    if (o.items) marcher(o.items, `${p}[]`);
    if (o.allOf) o.allOf.forEach((x) => { marcher(x.then, p); marcher(x.else, p); });
  };
  marcher(s, "");
  for (const [k, v] of Object.entries(s.$defs || {})) marcher(v, `$defs.${k}`);
  return [...vues].sort();
}

describe("1. le schéma est versionné, et la version est figée dedans", () => {
  it("le fichier porte son numéro, schemaVersion vaut 1 par `const`, $id porte la version, la racine n'accepte aucune clé non déclarée", () => {
    expect(SCHEMA).toBe("charge/artefact.schema-1.json");
    expect(controlerSchema(schema, 1)).toEqual([]);
    expect(schema.properties.schemaVersion.const).toBe(1);
    expect(schemasPresents().get(1)).toEqual(schema);
  });
  it("le contrôle du schéma refuse un schéma qui ne fige pas sa version ou qui ouvre sa racine", () => {
    expect(controlerSchema({ ...clone(schema), properties: { ...schema.properties, schemaVersion: { type: "integer" } } }, 1)).toHaveLength(1);
    expect(controlerSchema({ ...clone(schema), additionalProperties: true }, 1)).toHaveLength(1);
    expect(controlerSchema(schema, 2)).toHaveLength(2);
  });
});

describe("2. et 3. le corpus : un artefact minimal valide, un artefact incomplet", () => {
  it("l'exemple minimal est conforme en forme ET en invariants, et il est COMPLET", () => {
    const a = minimal();
    expect(a.complete).toBe(true);
    expect(validerArtefact(a, schema).constats).toEqual([]);
    expect(controlerSemantiqueArtefact(a)).toEqual([]);
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
  // ⚠️ `relay` contient des octets transmis, des admis, des refusés : c'est un bloc de MESURE, et la
  // première condition l'exigeait dès que le scénario s'appelait relay, même à `complete: false`.
  it("⚠️ complete: false + scénario relay SANS le bloc relay → conforme ; complete: true → refusé", () => {
    const a = incomplet(); a.scenario.name = "relay";
    expect(constatsDe(a)).toBe("");
    const b = minimal(); b.scenario.name = "relay";
    expect(constatsDe(b)).toMatch(/artefact\.relay : champ obligatoire absent/);
    b.relay = { fileBytes: 0, chunkBytes: 0, highWaterMark: 0, consumerDelayMs: 0, bytesTransferred: 0, admitted: 0, refused: 0, descriptors: { idle: 0, peak: 0 } };
    expect(constatsDe(b)).toBe("");
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
    delete a.process.memoryMiB.afterGc; delete a.workload.generatorLagMs.max; delete a.workload.arrivalPattern;
    const texte = constatsDe(a);
    expect(texte).toMatch(/artefact\.process\.memoryMiB\.afterGc : champ obligatoire absent/);
    expect(texte).toMatch(/artefact\.workload\.generatorLagMs\.max : champ obligatoire absent/);
    expect(texte).toMatch(/artefact\.workload\.arrivalPattern : champ obligatoire absent/);
  });
  it("⚠️ aucune clé ne s'ajoute sans être écrite : une clé hors schéma est refusée, à la racine comme en profondeur", () => {
    const a = minimal(); a.nouvelleCle = 1; a.latencyMs.p999 = 0; a.scenario.requests = 0;
    const texte = constatsDe(a);
    expect(texte).toMatch(/artefact\.nouvelleCle : clé non déclarée/);
    expect(texte).toMatch(/artefact\.latencyMs\.p999 : clé non déclarée/);
    expect(texte).toMatch(/artefact\.scenario\.requests : clé non déclarée/);
  });
  it("les types et les bornes mordent : un p95 négatif, un cpuCount à zéro, un sha court, des énumérations inconnues", () => {
    const a = minimal();
    a.latencyMs.p95 = -1; a.environment.cpuCount = 0; a.identity.commitSha = "abc"; a.scenario.name = "warm"; a.workload.arrivalModel = "jittered"; a.workload.arrivalPattern = "open-loop";
    const texte = constatsDe(a);
    expect(texte).toMatch(/artefact\.latencyMs\.p95 : -1 < minimum 0/);
    expect(texte).toMatch(/artefact\.environment\.cpuCount : 0 < minimum 1/);
    expect(texte).toMatch(/artefact\.identity\.commitSha : "abc" ne respecte pas/);
    expect(texte).toMatch(/artefact\.scenario\.name : "warm" n'est pas parmi/);
    expect(texte).toMatch(/artefact\.workload\.arrivalModel : "jittered" n'est pas parmi/);
    expect(texte).toMatch(/artefact\.workload\.arrivalPattern : "open-loop" n'est pas parmi/);
  });
});

describe("⚠️ les invariants entre nombres : un artefact aux bonnes clés peut encore ne rien mesurer, ou se contredire", () => {
  const cas = [
    ["complete: true avec une raison d'échec", (a) => { a.failure.reason = "échec"; }, /artefact\.failure : un artefact complete: true ne porte ni phase ni reason/],
    ["position hors de sequence", (a) => { a.scenario.position = 9; }, /artefact\.scenario\.position : 9 hors de sequence/],
    ["spectators ≠ sequence[position − 1]", (a) => { a.scenario.sequence = [100, 1000, 100]; a.scenario.position = 2; a.scenario.spectators = 999; }, /artefact\.scenario\.spectators : 999 alors que sequence\[1\] vaut 1000/],
    ["scheduled < started < completed", (a) => { a.workload.scheduledRequests = 10; a.workload.startedRequests = 20; a.workload.completedRequests = 30; a.latencyMs.n = 30; }, /startedRequests \(20\) > scheduledRequests \(10\)[\s\S]*completedRequests \(30\) > startedRequests \(20\)/],
    ["percentiles désordonnés", (a) => { Object.assign(a.latencyMs, { min: 100, p50: 4, p95: 3, p99: 2, max: 1, mean: 50 }); }, /artefact\.latencyMs : min \(100\) > p50 \(4\)/],
    ["mean hors de [min, max]", (a) => { Object.assign(a.latencyMs, { min: 1, mean: 9, max: 5, p50: 1, p95: 1, p99: 1 }); }, /artefact\.latencyMs\.mean : 9 hors de \[min 1, max 5\]/],
    ["histogramme aux classes non croissantes", (a) => { a.histogram = { unit: "ms", binSetId: "b", edges: [100, 1], counts: [1000] }; }, /artefact\.histogram\.edges : 100 puis 1/],
    ["histogramme : autant de comptes que de bords", (a) => { a.histogram = { unit: "ms", binSetId: "b", edges: [0, 1, 2], counts: [500, 500, 0] }; }, /artefact\.histogram\.counts : 3 classe\(s\) pour 3 bord\(s\)/],
    ["histogramme dont la somme n'est pas n", (a) => { a.histogram = { unit: "ms", binSetId: "b", edges: [0, 1, 2], counts: [500, 499] }; }, /artefact\.histogram\.counts : somme 999 pour latencyMs\.n 1000/],
    ["histogramme sans binSetId (forme, mais la forme est un invariant du protocole)", (a) => { a.histogram = { unit: "ms", edges: [0, 1], counts: [1000] }; }, /artefact\.histogram\.binSetId : champ obligatoire absent/],
    ["uptime qui recule", (a) => { a.measurementWindow.processUptimeEndMs = 0; a.measurementWindow.processUptimeStartMs = 5; }, /processUptimeEndMs \(0\) < processUptimeStartMs \(5\)/],
    ["complete sans durée", (a) => { a.measurementWindow.durationMs = 0; }, /artefact\.measurementWindow\.durationMs : 0 — un artefact complet a duré/],
    ["complete avec trop peu d'observations", (a) => { a.latencyMs.n = 999; a.workload.completedRequests = 999; a.workload.startedRequests = 999; a.statuses["2xx"] = 999; a.correctness.completed = 999; }, new RegExp(`artefact\\.latencyMs\\.n : 999 observation\\(s\\), un artefact complet en porte au moins ${OBSERVATIONS_MIN}`)],
    ["n ≠ completedRequests", (a) => { a.latencyMs.n = 1001; }, /artefact\.latencyMs\.n : 1001 observation\(s\) pour 1000 requête\(s\) achevée\(s\)/],
    ["statuts dont la somme n'est pas completedRequests", (a) => { a.statuses["429"] = 1; }, /artefact\.statuses : somme 1001 pour 1000 requête\(s\) achevée\(s\)/],
    ["exactitude qui juge plus de réponses qu'il n'en est arrivé", (a) => { a.correctness.emptyResponses = 1; }, /artefact\.correctness : 1001 réponse\(s\) jugée\(s\) pour 1000 achevée\(s\)/],
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

describe("la cohorte : plusieurs artefacts d'une même course, confrontés entre eux", () => {
  const trio = () => [100, 1000, 100].map((n, i) => {
    const a = minimal();
    a.scenario.sequence = [100, 1000, 100]; a.scenario.position = i + 1; a.scenario.spectators = n; a.isolation.datasetId = `jeu-${i + 1}`;
    return { nom: `p${i + 1}.json`, artefact: a };
  });
  it("trois positions uniques, même runId, même séquence, même commit, jeux distincts → rien à redire", () => {
    expect(controlerCohorte(trio())).toEqual([]);
    for (const { artefact } of trio()) expect(constatsDe(artefact)).toBe("");
  });
  it("une position doublée, un jeu de données réemployé, un runId ou une séquence qui diffère → nommés", () => {
    const t = trio();
    t[2].artefact.scenario.position = 1; t[2].artefact.scenario.spectators = 100;
    t[1].artefact.isolation.datasetId = "jeu-1";
    t[1].artefact.identity.runId = "autre";
    t[2].artefact.scenario.sequence = [100, 1000];
    const texte = controlerCohorte(t).join("\n");
    expect(texte).toMatch(/p3\.json : position 1 déjà tenue par p1\.json/);
    expect(texte).toMatch(/p2\.json : datasetId "jeu-1" déjà employé par p1\.json/);
    expect(texte).toMatch(/p2\.json : identity\.runId "autre" diffère de p1\.json/);
    expect(texte).toMatch(/p3\.json : scenario\.sequence \[100,1000\] diffère de p1\.json/);
  });
});

describe("6. la compatibilité du schéma 1", () => {
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
  it("le schéma et le README disent la même doctrine : immuable une fois publié, un schéma suivant pour toute clé ou sémantique nouvelle — plus jamais « une clé optionnelle s'ajoute sans changer de version »", () => {
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

describe("⚠️ le validateur ne saute jamais ce qu'il ne lit pas — et il lit le schéma EN ENTIER, avant tout artefact", () => {
  it("un mot-clé de schéma inconnu FAIT LEVER en validant, il n'est pas ignoré", () => {
    const s = clone(schema); s.properties.latencyMs.properties.p99.multipleOf = 0.5;
    expect(() => validerArtefact(minimal(), s)).toThrow(/mot-clé de schéma inconnu « multipleOf »/);
  });
  it("⚠️ un mot-clé inconnu dans une branche OPTIONNELLE qu'aucun artefact ne matérialise est trouvé par le parcours préalable, avec son chemin", () => {
    const s = clone(schema); s.properties.histogram.properties.edges.p99 = true;
    // En validant seulement, rien ne le voit : l'exemple minimal n'a pas d'histogramme.
    expect(validerArtefact(minimal(), s).constats).toEqual([]);
    expect(controlerVocabulaireSchema(s)).toEqual(["#/properties/histogram/properties/edges/p99 : mot-clé de schéma inconnu « p99 » — ce validateur ne le lit pas, donc il ne le vérifierait pas"]);
  });
  it("le parcours préalable visite $defs, items, additionalProperties, allOf, if, then, else — et ne prend un nom de champ pour un mot-clé nulle part", () => {
    expect(controlerVocabulaireSchema(schema)).toEqual([]);
    const s = clone(schema);
    s.$defs.memoire.properties.rss.format = "x";
    s.properties.scenario.properties.sequence.items.uniqueItems = true;
    s.$defs.compteurs.additionalProperties.multipleOf = 1;
    s.allOf[0].then.dependentRequired = {};
    s.allOf[0].if.properties.complete.oneOf = [];
    s.allOf[0].else.properties.failure.properties.reason.maxLength = 3;
    const trouves = controlerVocabulaireSchema(s);
    for (const chemin of ["#/$defs/memoire/properties/rss/format", "#/properties/scenario/properties/sequence/items/uniqueItems", "#/$defs/compteurs/additionalProperties/multipleOf", "#/allOf/0/then/dependentRequired", "#/allOf/0/if/properties/complete/oneOf", "#/allOf/0/else/properties/failure/properties/reason/maxLength"]) {
      expect(trouves.some((t) => t.startsWith(chemin)), chemin).toBe(true);
    }
    expect(trouves).toHaveLength(6);
  });
  it("chaque mot-clé du vocabulaire connu est implémenté (sinon un schéma qui l'emploierait passerait le parcours et ne serait pas vérifié)", () => {
    const src = readFileSync(join(RACINE, "tools/artefact-de-charge.mjs"), "utf8");
    for (const k of MOTS_CLES) if (!["$schema", "$id", "title", "description", "$defs"].includes(k)) expect(src, k).toMatch(new RegExp(`"${k.replace("$", "\\$")}" in schema|k === "${k.replace("$", "\\$")}"|schema\\.${k.replace("$", "\\$")}`));
  });
});

describe("4. la garde de la forge : trois issues", () => {
  it("sur le dépôt : conforme, en nommant le nombre d'artefacts, les schémas et le vocabulaire lu en entier", () => {
    const r = auditer();
    expect(r.code, JSON.stringify(r)).toBe(0);
    expect(r.resume).toMatch(/2 artefact\(s\) conformes — forme et invariants — aux schémas 1 .*vocabulaire des schémas lu en entier/);
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
  it("⚠️ un schéma qui emploie un mot-clé inconnu dans une branche absente du corpus rend NON CONCLUANT, avec le chemin — c'est la reproduction de l'audit", () => {
    const d = mkdtempSync(join(tmpdir(), "artefact-"));
    try {
      mkdirSync(join(d, EXEMPLES), { recursive: true });
      const s = clone(schema); s.properties.histogram.properties.edges.p99 = true;
      writeFileSync(join(d, SCHEMA), JSON.stringify(s));
      for (const nom of ["schema-1-minimal.json", "schema-1-incomplet.json"]) writeFileSync(join(d, EXEMPLES, nom), JSON.stringify(lire(nom)));
      const r = auditer({ racine: d });
      expect(r.code).toBe(2);
      expect(r.raisons.join("\n")).toMatch(/charge\/artefact\.schema-1\.json #\/properties\/histogram\/properties\/edges\/p99 : mot-clé de schéma inconnu « p99 »/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it("un corpus dont la fixture complète est VIDE (zéro observation, zéro durée) est refusé : le même validateur jugera les vrais rapports", () => {
    const d = mkdtempSync(join(tmpdir(), "artefact-"));
    try {
      mkdirSync(join(d, EXEMPLES), { recursive: true });
      writeFileSync(join(d, SCHEMA), JSON.stringify(schema));
      const a = minimal(); a.latencyMs.n = 0; a.workload = { ...a.workload, scheduledRequests: 0, startedRequests: 0, completedRequests: 0 }; a.measurementWindow.durationMs = 0; a.statuses["2xx"] = 0; a.correctness.completed = 0;
      writeFileSync(join(d, EXEMPLES, "vide.json"), JSON.stringify(a));
      writeFileSync(join(d, EXEMPLES, "incomplet.json"), JSON.stringify(incomplet()));
      const r = auditer({ racine: d });
      expect(r.code).toBe(1);
      expect(r.constats.join("\n")).toMatch(/vide\.json — artefact\.measurementWindow\.durationMs : 0/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
