// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN ARTEFACT DE CHARGE EST UN DOCUMENT, ET UN DOCUMENT SANS SCHÉMA EST UNE CAPTURE D'ÉCRAN.
//
// Le dépôt a des bancs de charge depuis août ; leur produit était une ligne dans le journal de la
// forge, lue par un humain, jamais comparée. Un audit externe l'a dit en une phrase : « la preuve
// runtime attendue pour la performance n'existe pas », et a donné la structure d'un artefact
// (`schemaVersion: 1`) avec le protocole qui le rend comparable — préchauffage, ordre enregistré,
// artefact même en échec, quatre relevés mémoire, générateur mesuré.
//
// ⚠️ CE VALIDATEUR N'IMPLÉMENTE QU'UN SOUS-ENSEMBLE DE JSON SCHEMA, ET IL LE DIT. Pas de dépendance
// nouvelle pour un schéma de deux cents lignes : les mots-clés utilisés sont implémentés ici, et
// TOUT MOT-CLÉ INCONNU DANS LE SCHÉMA REND NON CONCLUANT — jamais ignoré. ⚠️ ET LE VOCABULAIRE EST
// CONTRÔLÉ PAR UN PARCOURS PRÉALABLE DU SCHÉMA ENTIER, indépendant de tout artefact : la première
// version ne le vérifiait qu'en validant, donc un mot-clé inconnu dans une branche optionnelle
// (`histogram`) qu'aucun artefact du corpus ne matérialisait n'était jamais visité, et la garde
// rendait conforme sur un schéma qu'elle ne lisait pas (audit, onzième passe). Un validateur qui
// saute ce qu'il ne connaît pas est la forme de vacuité que ce dépôt traque.
//
// ⚠️ ET LE SCHÉMA NE SAIT DIRE QUE LES FORMES. Un artefact aux bonnes clés et aux nombres
// contradictoires — `complete: true` avec une raison d'échec, `p95 < p50`, `scheduled < completed`,
// `position` hors de `sequence`, zéro observation — était conforme (même audit). Les invariants entre
// nombres sont tenus ICI, après la forme, et la fixture complète du corpus doit les satisfaire : le
// même validateur jugera les vrais rapports, et une forme vide qui passerait dirait qu'un rapport
// vide passerait.
//
// Trois issues, comme toute garde : conforme (0), violation (1), non concluant (2). Non concluant
// quand aucun schéma n'est là, quand l'un emploie un mot-clé inconnu, quand le corpus est vide ou ne
// couvre pas les deux branches (`complete: true` ET `complete: false`).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DOSSIER_SCHEMAS = "charge";
export const EXEMPLES = "charge/artefacts/exemples";
export const SCHEMA_DE = (version) => `${DOSSIER_SCHEMAS}/artefact.schema-${version}.json`;
export const VERSIONS_CONNUES = [1];
/** Le plancher d'observations d'un artefact complet : un p99 sur moins n'en est pas un (audit). */
export const OBSERVATIONS_MIN = 1000;

/** Les mots-clés que ce validateur SAIT lire. Tout autre mot-clé dans un schéma est une erreur. */
export const MOTS_CLES = new Set([
  "$schema", "$id", "$ref", "$defs", "title", "description",
  "type", "properties", "required", "additionalProperties", "const", "enum",
  "minimum", "maximum", "minItems", "items", "minLength", "pattern",
  "allOf", "if", "then", "else",
]);

const typeDe = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
const estType = (v, t) => t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" && Number.isFinite(v) : typeDe(v) === t;
const estObjet = (v) => !!v && typeof v === "object" && !Array.isArray(v);

export class SchemaInconnu extends Error {}

/**
 * ⚠️ LE PARCOURS PRÉALABLE : chaque nœud du schéma, avant tout artefact. Les clés de `properties` et
 * de `$defs` sont des NOMS à cet emplacement seulement ; partout ailleurs, une clé est un mot-clé, et
 * un mot-clé inconnu est rendu AVEC SON CHEMIN. Aucun ensemble global de noms ne filtre rien.
 */
export function controlerVocabulaireSchema(schema, chemin = "#") {
  const inconnus = [];
  const visiter = (s, ou) => {
    if (s === true || s === false) return;
    if (!estObjet(s)) { inconnus.push(`${ou} : sous-schéma illisible (${typeDe(s)})`); return; }
    for (const [k, v] of Object.entries(s)) {
      if (!MOTS_CLES.has(k)) { inconnus.push(`${ou}/${k} : mot-clé de schéma inconnu « ${k} » — ce validateur ne le lit pas, donc il ne le vérifierait pas`); continue; }
      if (k === "properties" || k === "$defs") { if (estObjet(v)) for (const [nom, sous] of Object.entries(v)) visiter(sous, `${ou}/${k}/${nom}`); else inconnus.push(`${ou}/${k} : doit être un objet`); }
      else if (k === "items" || k === "additionalProperties" || k === "if" || k === "then" || k === "else") { if (typeof v === "boolean") continue; visiter(v, `${ou}/${k}`); }
      else if (k === "allOf") { if (Array.isArray(v)) v.forEach((sous, i) => visiter(sous, `${ou}/${k}/${i}`)); else inconnus.push(`${ou}/${k} : doit être une liste`); }
    }
  };
  visiter(schema, chemin);
  return inconnus;
}

function resoudre(ref, racineSchema) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) throw new SchemaInconnu(`$ref non pris en charge : ${JSON.stringify(ref)} (seuls les « #/… » locaux le sont)`);
  let cible = racineSchema;
  for (const seg of ref.slice(2).split("/")) {
    if (!estObjet(cible) || !(seg in cible)) throw new SchemaInconnu(`$ref introuvable : ${ref}`);
    cible = cible[seg];
  }
  return cible;
}

/** Valide `valeur` contre `schema` ; accumule les constats sous `chemin`. Rend true si rien n'est à redire. */
function valider(valeur, schema, chemin, constats, racineSchema) {
  if (schema === true) return true;
  if (schema === false) { constats.push(`${chemin} : refusé par le schéma (false)`); return false; }
  if (!estObjet(schema)) throw new SchemaInconnu(`${chemin} : sous-schéma illisible`);
  for (const k of Object.keys(schema)) if (!MOTS_CLES.has(k)) throw new SchemaInconnu(`${chemin} : mot-clé de schéma inconnu « ${k} »`);
  const avant = constats.length;

  if ("$ref" in schema) valider(valeur, resoudre(schema.$ref, racineSchema), chemin, constats, racineSchema);
  if ("type" in schema) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((t) => estType(valeur, t))) constats.push(`${chemin} : type ${typeDe(valeur)}, attendu ${types.join(" | ")}`);
  }
  if ("const" in schema && JSON.stringify(valeur) !== JSON.stringify(schema.const)) constats.push(`${chemin} : vaut ${JSON.stringify(valeur)}, attendu exactement ${JSON.stringify(schema.const)}`);
  if ("enum" in schema && !schema.enum.some((e) => JSON.stringify(e) === JSON.stringify(valeur))) constats.push(`${chemin} : ${JSON.stringify(valeur)} n'est pas parmi ${JSON.stringify(schema.enum)}`);
  if (typeof valeur === "number") {
    if ("minimum" in schema && valeur < schema.minimum) constats.push(`${chemin} : ${valeur} < minimum ${schema.minimum}`);
    if ("maximum" in schema && valeur > schema.maximum) constats.push(`${chemin} : ${valeur} > maximum ${schema.maximum}`);
  }
  if (typeof valeur === "string") {
    if ("minLength" in schema && valeur.length < schema.minLength) constats.push(`${chemin} : chaîne de ${valeur.length} caractère(s), minimum ${schema.minLength}`);
    if ("pattern" in schema && !new RegExp(schema.pattern).test(valeur)) constats.push(`${chemin} : ${JSON.stringify(valeur)} ne respecte pas /${schema.pattern}/`);
  }
  if (Array.isArray(valeur)) {
    if ("minItems" in schema && valeur.length < schema.minItems) constats.push(`${chemin} : ${valeur.length} élément(s), minimum ${schema.minItems}`);
    if ("items" in schema) valeur.forEach((v, i) => valider(v, schema.items, `${chemin}[${i}]`, constats, racineSchema));
  }
  if (estObjet(valeur)) {
    const props = schema.properties || {};
    if ("required" in schema) for (const r of schema.required) if (!(r in valeur)) constats.push(`${chemin}.${r} : champ obligatoire absent`);
    for (const [k, v] of Object.entries(valeur)) {
      if (k in props) valider(v, props[k], `${chemin}.${k}`, constats, racineSchema);
      else if ("additionalProperties" in schema) {
        if (schema.additionalProperties === false) constats.push(`${chemin}.${k} : clé non déclarée par le schéma — aucune clé ne s'ajoute sans y être écrite`);
        else valider(v, schema.additionalProperties, `${chemin}.${k}`, constats, racineSchema);
      }
    }
  }
  if ("allOf" in schema) for (const s of schema.allOf) valider(valeur, s, chemin, constats, racineSchema);
  if ("if" in schema) {
    const essai = [];
    const tient = valider(valeur, schema.if, chemin, essai, racineSchema);
    if (tient && "then" in schema) valider(valeur, schema.then, chemin, constats, racineSchema);
    if (!tient && "else" in schema) valider(valeur, schema.else, chemin, constats, racineSchema);
  }
  return constats.length === avant;
}

/** La FORME : valide un artefact contre un schéma. Rend `{ constats }` (vide = conforme). Lève `SchemaInconnu`. */
export function validerArtefact(artefact, schema) {
  const constats = [];
  valider(artefact, schema, "artefact", constats, schema);
  return { constats: [...new Set(constats)] };
}

const nombre = (v) => typeof v === "number" && Number.isFinite(v);
const ordonnes = (o, cles, ou, constats) => {
  if (!estObjet(o)) return;
  const presentes = cles.filter((c) => nombre(o[c]));
  for (let i = 1; i < presentes.length; i += 1) {
    const a = presentes[i - 1], b = presentes[i];
    if (o[a] > o[b]) constats.push(`${ou} : ${a} (${o[a]}) > ${b} (${o[b]}) — les quantiles ne sont pas ordonnés`);
  }
};

/**
 * LES INVARIANTS ENTRE NOMBRES, après la forme. Chaque constat porte son chemin. Ce que ces règles
 * DÉCIDENT, parce que le schéma ne le disait pas : `latencyMs.n` compte une observation par requête
 * achevée, quel que soit son statut, donc n === workload.completedRequests ; `correctness.completed`
 * ne compte que les réponses CORRECTES, donc ≤ completedRequests ; les statuts sont disjoints et
 * leur somme vaut completedRequests.
 */
export function controlerSemantiqueArtefact(a) {
  const c = [];
  if (!estObjet(a)) return c;
  const { complete, failure, scenario: s, workload: w, latencyMs: l, measurementWindow: f, histogram: h, counters: k, statuses: st, correctness: co, environment: e, http, database: db } = a;

  if (complete === true && estObjet(failure) && (failure.phase !== null || failure.reason !== null)) c.push("artefact.failure : un artefact complete: true ne porte ni phase ni reason d'échec");
  if (estObjet(e)) {
    const inconnu = e.memoryLimitSource === "unknown";
    if (inconnu && e.memoryLimitMiB !== null) c.push(`artefact.environment.memoryLimitMiB : ${e.memoryLimitMiB} avec memoryLimitSource unknown — un plafond inconnu vaut null`);
    if (!inconnu && !(Number.isInteger(e.memoryLimitMiB) && e.memoryLimitMiB > 0)) c.push(`artefact.environment.memoryLimitMiB : source ${JSON.stringify(e.memoryLimitSource)} nommée mais plafond ${JSON.stringify(e.memoryLimitMiB)} — un plafond connu est un entier positif`);
  }
  if (estObjet(s) && Array.isArray(s.sequence) && Number.isInteger(s.position)) {
    if (s.position < 1 || s.position > s.sequence.length) c.push(`artefact.scenario.position : ${s.position} hors de sequence (${s.sequence.length} rang(s))`);
    else if (s.sequence[s.position - 1] !== s.spectators) c.push(`artefact.scenario.spectators : ${s.spectators} alors que sequence[${s.position - 1}] vaut ${s.sequence[s.position - 1]}`);
  }
  if (estObjet(w)) {
    if (nombre(w.scheduledRequests) && nombre(w.startedRequests) && w.scheduledRequests < w.startedRequests) c.push(`artefact.workload : startedRequests (${w.startedRequests}) > scheduledRequests (${w.scheduledRequests})`);
    if (nombre(w.startedRequests) && nombre(w.completedRequests) && w.startedRequests < w.completedRequests) c.push(`artefact.workload : completedRequests (${w.completedRequests}) > startedRequests (${w.startedRequests})`);
    ordonnes(w.generatorLagMs, ["p50", "p95", "p99", "max"], "artefact.workload.generatorLagMs", c);
  }
  if (estObjet(f) && nombre(f.processUptimeStartMs) && nombre(f.processUptimeEndMs) && f.processUptimeEndMs < f.processUptimeStartMs) c.push(`artefact.measurementWindow : processUptimeEndMs (${f.processUptimeEndMs}) < processUptimeStartMs (${f.processUptimeStartMs})`);
  if (complete === true) {
    if (estObjet(f) && nombre(f.durationMs) && !(f.durationMs > 0)) c.push("artefact.measurementWindow.durationMs : 0 — un artefact complet a duré");
    if (estObjet(l) && nombre(l.n) && l.n < OBSERVATIONS_MIN) c.push(`artefact.latencyMs.n : ${l.n} observation(s), un artefact complet en porte au moins ${OBSERVATIONS_MIN}`);
  }
  if (estObjet(l)) {
    ordonnes(l, ["min", "p50", "p95", "p99", "max"], "artefact.latencyMs", c);
    if (nombre(l.min) && nombre(l.mean) && nombre(l.max) && !(l.min <= l.mean && l.mean <= l.max)) c.push(`artefact.latencyMs.mean : ${l.mean} hors de [min ${l.min}, max ${l.max}]`);
    if (estObjet(w) && nombre(w.completedRequests) && nombre(l.n) && l.n !== w.completedRequests) c.push(`artefact.latencyMs.n : ${l.n} observation(s) pour ${w.completedRequests} requête(s) achevée(s) — une observation par requête achevée, ni plus ni moins`);
  }
  if (estObjet(http) && estObjet(http.responseBytes)) ordonnes(http.responseBytes, ["p50", "p95", "max"], "artefact.http.responseBytes", c);
  if (estObjet(db)) ordonnes(db.latencyMs, ["p50", "p95", "p99"], "artefact.database.latencyMs", c);
  if (estObjet(h) && Array.isArray(h.edges) && Array.isArray(h.counts)) {
    for (let i = 1; i < h.edges.length; i += 1) if (!(h.edges[i] > h.edges[i - 1])) { c.push(`artefact.histogram.edges : ${h.edges[i - 1]} puis ${h.edges[i]} — les classes ne sont pas strictement croissantes`); break; }
    if (h.counts.length !== h.edges.length - 1) c.push(`artefact.histogram.counts : ${h.counts.length} classe(s) pour ${h.edges.length} bord(s) — il en faut une de moins`);
    const somme = h.counts.reduce((x, y) => x + y, 0);
    if (estObjet(l) && nombre(l.n) && somme !== l.n) c.push(`artefact.histogram.counts : somme ${somme} pour latencyMs.n ${l.n}`);
  }
  if (estObjet(st) && estObjet(w) && nombre(w.completedRequests)) {
    const total = ["2xx", "429", "other4xx", "503", "other5xx", "other"].reduce((x, cle) => x + (nombre(st[cle]) ? st[cle] : 0), 0);
    if (total !== w.completedRequests) c.push(`artefact.statuses : somme ${total} pour ${w.completedRequests} requête(s) achevée(s) — les catégories sont disjointes et couvrent tout`);
  }
  if (estObjet(co) && estObjet(w) && nombre(w.completedRequests)) {
    const total = ["completed", "emptyResponses", "wrongPresentation"].reduce((x, cle) => x + (nombre(co[cle]) ? co[cle] : 0), 0);
    if (total > w.completedRequests) c.push(`artefact.correctness : ${total} réponse(s) jugée(s) pour ${w.completedRequests} achevée(s)`);
  }
  if (estObjet(k) && estObjet(k.before) && estObjet(k.after) && estObjet(k.delta)) {
    const cles = new Set([...Object.keys(k.before), ...Object.keys(k.after), ...Object.keys(k.delta)]);
    for (const cle of cles) {
      if (!(cle in k.before) || !(cle in k.after) || !(cle in k.delta)) { c.push(`artefact.counters : « ${cle} » n'est pas dans les trois relevés`); continue; }
      if (k.delta[cle] !== k.after[cle] - k.before[cle]) c.push(`artefact.counters.delta.${cle} : ${k.delta[cle]} alors que after − before vaut ${k.after[cle] - k.before[cle]}`);
    }
  }
  return c;
}

/** LA COHORTE : plusieurs artefacts d'une même course, confrontés entre eux. `[{ nom, artefact }]`. */
export function controlerCohorte(membres) {
  const c = [];
  if (membres.length < 2) return c;
  const premier = membres[0].artefact;
  const cle = (a, ...ch) => ch.reduce((o, k) => (estObjet(o) ? o[k] : undefined), a);
  for (const { nom, artefact } of membres.slice(1)) {
    for (const [libelle, ch] of [["identity.runId", ["identity", "runId"]], ["identity.commitSha", ["identity", "commitSha"]], ["identity.packageVersion", ["identity", "packageVersion"]], ["scenario.sequence", ["scenario", "sequence"]]]) {
      if (JSON.stringify(cle(artefact, ...ch)) !== JSON.stringify(cle(premier, ...ch))) c.push(`${nom} : ${libelle} ${JSON.stringify(cle(artefact, ...ch))} diffère de ${membres[0].nom} (${JSON.stringify(cle(premier, ...ch))}) — pas la même course`);
    }
  }
  const positions = new Map(), jeux = new Map();
  for (const { nom, artefact } of membres) {
    const p = cle(artefact, "scenario", "position"), d = cle(artefact, "isolation", "datasetId");
    if (positions.has(p)) c.push(`${nom} : position ${p} déjà tenue par ${positions.get(p)}`); else positions.set(p, nom);
    if (jeux.has(d)) c.push(`${nom} : datasetId ${JSON.stringify(d)} déjà employé par ${jeux.get(d)} — des données distinctes par scénario`); else jeux.set(d, nom);
  }
  return c;
}

/** Le schéma lui-même dit-il ce qu'on attend d'un schéma N ? */
export function controlerSchema(schema, version) {
  const constats = [];
  if (schema?.properties?.schemaVersion?.const !== version) constats.push(`le schéma ne fige pas schemaVersion à ${version} (properties.schemaVersion.const)`);
  if (typeof schema?.$id !== "string" || !schema.$id.includes(`schema-${version}`)) constats.push(`$id ne porte pas la version (attendu « schema-${version} » dans ${JSON.stringify(schema?.$id)})`);
  if (schema?.additionalProperties !== false) constats.push("la racine accepte des clés non déclarées : une clé s'ajouterait sans être écrite");
  if (!Array.isArray(schema?.required) || !schema.required.includes("schemaVersion") || !schema.required.includes("complete")) constats.push("schemaVersion et complete doivent être obligatoires");
  return constats;
}

/** Charge les schémas présents : `{ version → schema }`. */
export function schemasPresents(racine = RACINE) {
  const dossier = join(racine, DOSSIER_SCHEMAS);
  const schemas = new Map();
  if (!existsSync(dossier)) return schemas;
  for (const f of readdirSync(dossier)) {
    const m = /^artefact\.schema-(\d+)\.json$/.exec(f);
    if (m) schemas.set(Number(m[1]), JSON.parse(readFileSync(join(dossier, f), "utf8")));
  }
  return schemas;
}

/** Un artefact, les deux couches. Rend `{ constats }` ; lève `SchemaInconnu` ; `version` absente → constat. */
export function jugerArtefact(artefact, schemas) {
  const version = estObjet(artefact) ? artefact.schemaVersion : undefined;
  const schema = schemas.get(version);
  if (!schema) return { constats: [`artefact.schemaVersion : ${JSON.stringify(version)} — aucun schéma de ce numéro (présents : ${[...schemas.keys()].join(", ") || "aucun"})`] };
  const forme = validerArtefact(artefact, schema).constats;
  if (forme.length) return { constats: forme };
  return { constats: controlerSemantiqueArtefact(artefact) };
}

export function auditer({ racine = RACINE, fichiers = [] } = {}) {
  const schemas = schemasPresents(racine);
  if (!schemas.size) return inconclusif(`aucun ${DOSSIER_SCHEMAS}/artefact.schema-<N>.json : rien à confronter`);
  const defauts = [];
  for (const [version, schema] of schemas) {
    for (const d of controlerSchema(schema, version)) defauts.push(`${SCHEMA_DE(version)} : ${d}`);
  }
  if (defauts.length) return violation(defauts);
  // ⚠️ LE VOCABULAIRE, AVANT TOUT ARTEFACT : un mot-clé inconnu dans une branche qu'aucun exemple ne
  // matérialise ne se verrait jamais en validant. Non concluant : le schéma n'est pas lu en entier.
  for (const [version, schema] of schemas) {
    const inconnus = controlerVocabulaireSchema(schema);
    if (inconnus.length) return inconclusif(inconnus.map((i) => `${SCHEMA_DE(version)} ${i}`));
  }

  const dossier = join(racine, EXEMPLES);
  const exemples = existsSync(dossier) ? readdirSync(dossier).filter((f) => f.endsWith(".json")).sort().map((f) => join(EXEMPLES, f)) : [];
  // ⚠️ RÈGLE ANTI-VACUITÉ : sans corpus, le validateur n'a rien validé, et un schéma qui refuserait
  // tout serait vert. Les deux branches doivent être couvertes, POUR CHAQUE schéma présent.
  if (!exemples.length) return inconclusif(`aucun exemple dans ${EXEMPLES} : le schéma n'a été confronté à rien`);

  const constats = [];
  const branches = new Map([...schemas.keys()].map((v) => [v, new Set()]));
  const lus = [], cohorte = [];
  for (const f of [...exemples, ...fichiers.map((x) => resolve(racine, x))]) {
    const chemin = resolve(racine, f), nom = fichiers.length && !exemples.includes(f) ? basename(f) : f;
    let artefact;
    try { artefact = JSON.parse(readFileSync(chemin, "utf8")); } catch (e) { constats.push(`${nom} : JSON illisible — ${e.message}`); continue; }
    let r;
    try { r = jugerArtefact(artefact, schemas); } catch (e) {
      if (e instanceof SchemaInconnu) return inconclusif(e.message);
      throw e;
    }
    lus.push(nom);
    if (estObjet(artefact) && branches.has(artefact.schemaVersion) && typeof artefact.complete === "boolean" && exemples.includes(f)) branches.get(artefact.schemaVersion).add(artefact.complete);
    if (!exemples.includes(f)) cohorte.push({ nom, artefact });
    for (const c of r.constats) constats.push(`${nom} — ${c}`);
  }
  for (const c of controlerCohorte(cohorte)) constats.push(`cohorte — ${c}`);
  if (constats.length) return violation(constats);
  for (const [v, b] of branches) if (b.size < 2) return inconclusif(`le corpus ${EXEMPLES} ne couvre pas les deux branches du schéma ${v} (complete: true ET false) : ${[...b].join(", ") || "aucune"}`);
  return conforme(`${lus.length} artefact(s) conformes — forme et invariants — aux schémas ${[...schemas.keys()].join(", ")} (${exemples.length} exemple(s) du corpus${fichiers.length ? `, ${fichiers.length} fourni(s) confrontés en cohorte` : ""}) ; vocabulaire des schémas lu en entier, aucune clé hors schéma`);
}

if (estExecuteDirectement(import.meta.url)) {
  const fichiers = process.argv.slice(2).filter((a) => a.startsWith("--fichier=")).map((a) => a.slice("--fichier=".length));
  conclure(tenter(() => auditer({ fichiers })));
}
