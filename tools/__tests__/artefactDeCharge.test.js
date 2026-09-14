// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES SIX PIÈCES DE L'ARTEFACT DE CHARGE, DANS L'ORDRE OÙ L'AUDIT LES A DEMANDÉES (14/09/2026) :
// un schéma versionné, un artefact minimal valide, un artefact `complete: false`, un validateur en
// CI, le refus d'un champ obligatoire absent, la compatibilité du schéma 1. Et ce que le dépôt y
// ajoute : un validateur qui LÈVE sur un mot-clé qu'il ne lit pas, parce qu'un validateur qui saute
// l'inconnu rend vert un schéma qu'il ne vérifie pas.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { RACINE } from "./aide/arbre-outils.mjs";
import { auditer, validerArtefact, controlerSchema, MOTS_CLES, SCHEMA, EXEMPLES, VERSION_ATTENDUE } from "../artefact-de-charge.mjs";

const schema = JSON.parse(readFileSync(join(RACINE, SCHEMA), "utf8"));
const lire = (nom) => JSON.parse(readFileSync(join(RACINE, EXEMPLES, nom), "utf8"));
const clone = (o) => JSON.parse(JSON.stringify(o));

/** ⚠️ LE CONTRAT DU SCHÉMA 1, FIGÉ ICI. Ajouter une clé OBLIGATOIRE ou une clé racine casse la série sans changer de numéro : ce banc le dit avant la forge. */
const RACINE_V1 = ["schemaVersion", "complete", "failure", "identity", "environment", "scenario", "workload", "isolation", "measurementWindow",
  "latencyMs", "histogram", "throughputRps", "statuses", "http", "database", "cache", "process", "correctness", "counters", "relay"];
const REQUIS_V1 = ["schemaVersion", "complete", "failure", "identity", "environment", "scenario", "workload", "isolation", "measurementWindow"];
const REQUIS_SI_COMPLET_V1 = ["latencyMs", "throughputRps", "statuses", "http", "database", "cache", "process", "correctness", "counters"];

describe("1. le schéma est versionné, et la version est figée dedans", () => {
  it("schemaVersion vaut 1 par `const`, $id porte la version, la racine n'accepte aucune clé non déclarée", () => {
    expect(controlerSchema(schema)).toEqual([]);
    expect(schema.properties.schemaVersion.const).toBe(VERSION_ATTENDUE);
  });
  it("le contrôle du schéma refuse un schéma qui ne fige pas sa version ou qui ouvre sa racine", () => {
    expect(controlerSchema({ ...clone(schema), properties: { ...schema.properties, schemaVersion: { type: "integer" } } })).toHaveLength(1);
    expect(controlerSchema({ ...clone(schema), additionalProperties: true })).toHaveLength(1);
  });
});

describe("2. et 3. le corpus : un artefact minimal valide, un artefact incomplet", () => {
  it("l'exemple minimal est conforme, et il est COMPLET", () => {
    const a = lire("schema-1-minimal.json");
    expect(a.complete).toBe(true);
    expect(validerArtefact(a, schema).constats).toEqual([]);
  });
  it("l'exemple `complete: false` est conforme SANS les blocs de mesure, et porte sa raison", () => {
    const a = lire("schema-1-incomplet.json");
    expect(a.complete).toBe(false);
    expect(a.latencyMs).toBeUndefined();
    expect(typeof a.failure.reason).toBe("string");
    expect(validerArtefact(a, schema).constats).toEqual([]);
  });
  it("⚠️ un artefact incomplet SANS raison est refusé : une absence d'artefact ne doit pas ressembler à un banc réussi, et un artefact sans raison non plus", () => {
    const a = lire("schema-1-incomplet.json");
    a.failure.reason = null;
    expect(validerArtefact(a, schema).constats.join("\n")).toMatch(/artefact\.failure\.reason : type null, attendu string/);
  });
  it("un artefact COMPLET sans ses blocs de mesure est refusé, bloc par bloc", () => {
    const a = lire("schema-1-minimal.json");
    for (const bloc of REQUIS_SI_COMPLET_V1) delete a[bloc];
    const texte = validerArtefact(a, schema).constats.join("\n");
    for (const bloc of REQUIS_SI_COMPLET_V1) expect(texte).toMatch(new RegExp(`artefact\\.${bloc} : champ obligatoire absent`));
  });
});

describe("5. le refus d'un champ obligatoire absent, avec son chemin", () => {
  it("chaque champ obligatoire de la racine, retiré un à un, est refusé PAR SON NOM", () => {
    for (const champ of REQUIS_V1) {
      const a = lire("schema-1-minimal.json");
      delete a[champ];
      const { constats } = validerArtefact(a, schema);
      expect(constats.join("\n"), champ).toMatch(new RegExp(`artefact\\.${champ} : champ obligatoire absent`));
    }
  });
  it("un champ obligatoire absent EN PROFONDEUR est refusé avec son chemin complet", () => {
    const a = lire("schema-1-minimal.json");
    delete a.process.memoryMiB.afterGc;
    delete a.workload.generatorLagMs.max;
    const texte = validerArtefact(a, schema).constats.join("\n");
    expect(texte).toMatch(/artefact\.process\.memoryMiB\.afterGc : champ obligatoire absent/);
    expect(texte).toMatch(/artefact\.workload\.generatorLagMs\.max : champ obligatoire absent/);
  });
  it("⚠️ aucune clé ne s'ajoute sans être écrite : une clé hors schéma est refusée, à la racine comme en profondeur", () => {
    const a = lire("schema-1-minimal.json");
    a.nouvelleCle = 1;
    a.latencyMs.p999 = 0;
    const texte = validerArtefact(a, schema).constats.join("\n");
    expect(texte).toMatch(/artefact\.nouvelleCle : clé non déclarée/);
    expect(texte).toMatch(/artefact\.latencyMs\.p999 : clé non déclarée/);
  });
  it("les types et les bornes mordent : un p95 négatif, un cpuCount à zéro, un sha court, une énumération inconnue", () => {
    const a = lire("schema-1-minimal.json");
    a.latencyMs.p95 = -1; a.environment.cpuCount = 0; a.identity.commitSha = "abc"; a.scenario.name = "warm"; a.workload.arrivalModel = "closed-loop";
    const texte = validerArtefact(a, schema).constats.join("\n");
    expect(texte).toMatch(/artefact\.latencyMs\.p95 : -1 < minimum 0/);
    expect(texte).toMatch(/artefact\.environment\.cpuCount : 0 < minimum 1/);
    expect(texte).toMatch(/artefact\.identity\.commitSha : "abc" ne respecte pas/);
    expect(texte).toMatch(/artefact\.scenario\.name : "warm" n'est pas parmi/);
    expect(texte).toMatch(/artefact\.workload\.arrivalModel : "closed-loop" n'est pas parmi/);
  });
  it("un scénario `relay` exige le bloc relay ; les autres non", () => {
    const a = lire("schema-1-minimal.json");
    a.scenario.name = "relay";
    expect(validerArtefact(a, schema).constats.join("\n")).toMatch(/artefact\.relay : champ obligatoire absent/);
    a.relay = { fileBytes: 0, chunkBytes: 0, highWaterMark: 0, consumerDelayMs: 0, bytesTransferred: 0, admitted: 0, refused: 0, descriptors: { idle: 0, peak: 0 } };
    expect(validerArtefact(a, schema).constats).toEqual([]);
  });
});

describe("6. la compatibilité du schéma 1", () => {
  it("un autre numéro de version est refusé : la série ne mélange pas deux sémantiques", () => {
    const a = lire("schema-1-minimal.json");
    a.schemaVersion = 2;
    expect(validerArtefact(a, schema).constats.join("\n")).toMatch(/artefact\.schemaVersion : vaut 2, attendu exactement 1/);
  });
  it("⚠️ les clés de la racine et les champs obligatoires du schéma 1 sont EXACTEMENT ceux figés ici — une clé obligatoire de plus casse la série", () => {
    expect(Object.keys(schema.properties).sort()).toEqual([...RACINE_V1].sort());
    expect([...schema.required].sort()).toEqual([...REQUIS_V1].sort());
    const complet = schema.allOf.find((s) => s.if?.properties?.complete?.const === true);
    expect([...complet.then.required].sort()).toEqual([...REQUIS_SI_COMPLET_V1].sort());
  });
  it("tout artefact du corpus valide sous le schéma 1 — le corpus EST le test de compatibilité", () => {
    const noms = readdirSync(join(RACINE, EXEMPLES)).filter((f) => f.endsWith(".json"));
    expect(noms.length).toBeGreaterThanOrEqual(2);
    for (const nom of noms) expect(validerArtefact(lire(nom), schema).constats, nom).toEqual([]);
  });
});

describe("⚠️ le validateur ne saute jamais ce qu'il ne lit pas", () => {
  it("un mot-clé de schéma inconnu FAIT LEVER, il n'est pas ignoré", () => {
    const s = clone(schema);
    s.properties.latencyMs.properties.p99.multipleOf = 0.5;
    expect(() => validerArtefact(lire("schema-1-minimal.json"), s)).toThrow(/mot-clé de schéma inconnu « multipleOf »/);
  });
  it("chaque mot-clé que le schéma emploie est un mot-clé que le validateur connaît (sinon il aurait levé au-dessus, et ce banc le dit à sa manière)", () => {
    const vus = new Set();
    const parcourir = (s) => { if (s && typeof s === "object" && !Array.isArray(s)) { for (const [k, v] of Object.entries(s)) { vus.add(k); if (["properties", "$defs"].includes(k)) Object.values(v).forEach(parcourir); else if (["allOf"].includes(k)) v.forEach(parcourir); else if (typeof v === "object") parcourir(v); } } };
    parcourir(schema);
    // Les clés de `properties` et `$defs` sont des NOMS, pas des mots-clés : on ne les compte pas.
    const nomsDeChamps = new Set();
    const collecter = (s) => { if (s && typeof s === "object" && !Array.isArray(s)) { for (const [k, v] of Object.entries(s)) { if (["properties", "$defs"].includes(k)) { Object.keys(v).forEach((n) => nomsDeChamps.add(n)); Object.values(v).forEach(collecter); } else if (typeof v === "object") collecter(v); } } };
    collecter(schema);
    const inconnus = [...vus].filter((k) => !MOTS_CLES.has(k) && !nomsDeChamps.has(k));
    expect(inconnus).toEqual([]);
  });
});

describe("4. la garde de la forge : trois issues", () => {
  it("sur le dépôt : conforme, en nommant le nombre d'artefacts et de champs obligatoires", () => {
    const r = auditer();
    expect(r.code, JSON.stringify(r)).toBe(0);
    expect(r.resume).toMatch(/2 artefact\(s\) conformes au schéma 1/);
  });
  it("un artefact fourni par --fichier= est validé avec le corpus, et un défaut y est nommé avec son fichier", () => {
    const d = mkdtempSync(join(tmpdir(), "artefact-"));
    try {
      const a = lire("schema-1-minimal.json"); a.statuses["5xx"] = -3;
      writeFileSync(join(d, "course.json"), JSON.stringify(a));
      const r = auditer({ fichiers: [join(d, "course.json")] });
      expect(r.code).toBe(1);
      expect(r.constats.join("\n")).toMatch(/course\.json — artefact\.statuses\.5xx : -3 < minimum 0/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it("⚠️ NON CONCLUANT sans schéma, sans corpus, ou avec un corpus qui ne couvre qu'une branche — jamais vert sur rien", () => {
    const d = mkdtempSync(join(tmpdir(), "artefact-"));
    try {
      expect(auditer({ racine: d }).code).toBe(2);
      mkdirSync(join(d, "charge", "artefacts", "exemples"), { recursive: true });
      writeFileSync(join(d, SCHEMA), JSON.stringify(schema));
      expect(auditer({ racine: d }).code).toBe(2);
      writeFileSync(join(d, EXEMPLES, "seul.json"), JSON.stringify(lire("schema-1-minimal.json")));
      const r = auditer({ racine: d });
      expect(r.code).toBe(2);
      expect(r.raisons.join("\n")).toMatch(/ne couvre pas les deux branches/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it("un schéma qui emploie un mot-clé inconnu rend NON CONCLUANT, pas conforme", () => {
    const d = mkdtempSync(join(tmpdir(), "artefact-"));
    try {
      mkdirSync(join(d, "charge", "artefacts", "exemples"), { recursive: true });
      const s = clone(schema); s.properties.throughputRps.exclusiveMaximum = 1e9;
      writeFileSync(join(d, SCHEMA), JSON.stringify(s));
      for (const nom of ["schema-1-minimal.json", "schema-1-incomplet.json"]) writeFileSync(join(d, EXEMPLES, nom), JSON.stringify(lire(nom)));
      const r = auditer({ racine: d });
      expect(r.code).toBe(2);
      expect(r.raisons.join("\n")).toMatch(/mot-clé de schéma inconnu « exclusiveMaximum »/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
