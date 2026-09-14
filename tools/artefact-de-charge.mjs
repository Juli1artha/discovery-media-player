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
// ⚠️ LE SCHÉMA EST COMPILÉ EN ENTIER, PAR UN VALIDATEUR STANDARD EN MODE STRICT, AVANT TOUT ARTEFACT.
// La première version était un validateur maison d'un sous-ensemble de JSON Schema ; un audit y a
// trouvé, deux fois le même jour, une branche du schéma qu'il ne lisait pas : un mot-clé inconnu
// dans `histogram`, qu'aucun exemple ne matérialisait, puis un `$ref` externe au même endroit, que
// personne ne résolvait tant qu'aucun artefact n'avait d'histogramme. Un validateur partiel d'un
// standard, c'est le travail d'entretenir le standard. `ajv` (2020-12, `strict`) compile chaque
// nœud — mots-clés, types des valeurs, `required` en liste, `enum` en liste, résolution des
// références, compilation des motifs — et un schéma qui ne compile pas rend NON CONCLUANT. Un
// parcours préalable maison subsiste pour une seule raison : donner LE CHEMIN des trois défauts
// qu'ajv nomme sans chemin (mot-clé inconnu, référence, motif).
//
// ⚠️ ET LE SCHÉMA NE SAIT DIRE QUE LES FORMES. Un artefact aux bonnes clés et aux nombres
// contradictoires — `complete: true` avec une raison d'échec, `p95 < p50`, `scheduled < completed`,
// `position` hors de `sequence`, zéro observation, un pic mémoire sous la valeur de départ, mille
// 2xx dont aucune inspectée — était conforme. Les invariants entre nombres sont tenus ICI, après la
// forme ; les grandeurs dérivables (débit, appels par requête) ne sont PAS stockées, elles se
// recalculent ; la fixture complète du corpus doit satisfaire tout ça, parce que le même validateur
// jugera les vrais rapports.
//
// ⚠️ UNE COHORTE EST UNE CAMPAGNE, PAS UN TAS DE FICHIERS. 100 → 1 000 → 100 fait trois artefacts ;
// deux présents avec des environnements différents étaient « confrontés en cohorte » et conformes.
// Une cohorte est complète (positions exactement 1..n, tous complets) ou un PRÉFIXE interrompu
// (1..k continu, le dernier `complete: false`, rien après) ; tout ce qui doit être constant l'est,
// nommément ; ce qui varie avec l'échelle est nommément exclu.
//
// ⚠️ L'IMMUTABILITÉ SE PROUVE HORS DE LA COPIE COURANTE. Un banc qui fige des chemins de clés dans
// un littéral se modifie dans le même commit que le schéma. L'ancre est un TAG : `ancres.json`
// nomme, pour chaque numéro, le tag qui a publié le premier artefact ; la garde relit le schéma à
// ce tag et le confronte, empreinte contre empreinte. Et chaque artefact porte `identity.schemaSha256`,
// l'empreinte du schéma sous lequel il a été produit : un artefact dit lui-même contre quoi il a
// été jugé, et le validateur exige que ce soit le schéma qu'il applique.
//
// Trois issues, comme toute garde : conforme (0), violation (1), non concluant (2).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import Ajv2020 from "ajv/dist/2020.js";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
export const DOSSIER_SCHEMAS = "charge";
export const EXEMPLES = "charge/artefacts/exemples";
export const ANCRES = "charge/artefacts/ancres.json";
export const SCHEMA_DE = (version) => `${DOSSIER_SCHEMAS}/artefact.schema-${version}.json`;
/** Le plancher d'observations d'un artefact complet : un p99 sur moins n'en est pas un (audit). */
export const OBSERVATIONS_MIN = 1000;
/** Ce qui VARIE avec l'échelle dans une cohorte, nommément — tout le reste du scénario et du protocole est constant. */
export const VARIABLES_D_ECHELLE = ["scenario.spectators", "scenario.position", "scenario.maxInFlight", "isolation.datasetId"];

/** Les mots-clés que le parcours préalable connaît — ceux du sous-ensemble 2020-12 que le schéma emploie. */
export const MOTS_CLES = new Set([
  "$schema", "$id", "$ref", "$defs", "title", "description",
  "type", "properties", "required", "additionalProperties", "const", "enum",
  "minimum", "minItems", "items", "minLength", "pattern",
  "allOf", "if", "then", "else",
]);

const typeDe = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
const estObjet = (v) => !!v && typeof v === "object" && !Array.isArray(v);
const nombre = (v) => typeof v === "number" && Number.isFinite(v);

export class SchemaInconnu extends Error {}

/** L'empreinte canonique d'un schéma : sha256 du JSON sans blancs. Un changement de forme la change, un reformatage non. */
export const empreinteSchema = (schema) => createHash("sha256").update(JSON.stringify(schema)).digest("hex");
/** L'identifiant d'un jeu de classes, DÉRIVÉ de ses bornes. */
export const binSetIdDe = (edges) => `edges-sha256-${createHash("sha256").update(JSON.stringify(edges)).digest("hex").slice(0, 16)}`;

/**
 * ⚠️ LE PARCOURS PRÉALABLE, POUR LES CHEMINS. Chaque nœud du schéma, avant tout artefact : mot-clé
 * inconnu, `$ref` non local ou introuvable, `pattern` qui ne compile pas — les trois défauts qu'ajv
 * nomme sans dire où. Les clés de `properties` et de `$defs` sont des NOMS à cet emplacement
 * seulement ; aucun ensemble global de noms ne filtre rien.
 */
export function controlerVocabulaireSchema(schema, chemin = "#") {
  const problemes = [];
  const resoluble = (ref) => {
    if (typeof ref !== "string" || !ref.startsWith("#/")) return false;
    let cible = schema;
    for (const seg of ref.slice(2).split("/")) { if (!estObjet(cible) || !(seg in cible)) return false; cible = cible[seg]; }
    return true;
  };
  const visiter = (s, ou) => {
    if (s === true || s === false) return;
    if (!estObjet(s)) { problemes.push(`${ou} : sous-schéma illisible (${typeDe(s)})`); return; }
    for (const [k, v] of Object.entries(s)) {
      if (!MOTS_CLES.has(k)) { problemes.push(`${ou}/${k} : mot-clé de schéma inconnu « ${k} » — ce validateur ne le lit pas, donc il ne le vérifierait pas`); continue; }
      if (k === "$ref" && !resoluble(v)) problemes.push(`${ou}/$ref : référence ${JSON.stringify(v)} non prise en charge ou introuvable — seuls les « #/… » locaux qui existent le sont`);
      if (k === "pattern") { try { new RegExp(v, "u"); } catch (e) { problemes.push(`${ou}/pattern : motif ${JSON.stringify(v)} incompilable — ${e.message}`); } }
      if (k === "properties" || k === "$defs") { if (estObjet(v)) for (const [nom, sous] of Object.entries(v)) visiter(sous, `${ou}/${k}/${nom}`); else problemes.push(`${ou}/${k} : doit être un objet`); }
      else if (k === "items" || k === "additionalProperties" || k === "if" || k === "then" || k === "else") { if (typeof v === "boolean") continue; visiter(v, `${ou}/${k}`); }
      else if (k === "allOf") { if (Array.isArray(v)) v.forEach((sous, i) => visiter(sous, `${ou}/${k}/${i}`)); else problemes.push(`${ou}/${k} : doit être une liste`); }
    }
  };
  visiter(schema, chemin);
  return problemes;
}

const compiles = new WeakMap();

/**
 * LA COMPILATION : le parcours préalable pour les chemins, puis ajv 2020-12 en mode strict pour tout
 * le reste — types des valeurs de mots-clés, `required`/`enum` en listes, `type` parmi les types,
 * résolution des références, motifs. Rend `{ valider }` ; lève `SchemaInconnu` avec les défauts.
 * `strictRequired` est le seul relâchement : nos `then: { required }` nomment des clés déclarées à
 * la racine, qu'ajv ne voit pas à travers `allOf`.
 */
export function compilerSchema(schema) {
  if (compiles.has(schema)) return compiles.get(schema);
  const problemes = controlerVocabulaireSchema(schema);
  if (problemes.length) throw new SchemaInconnu(problemes.join(" ; "));
  let valider;
  try {
    valider = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, verbose: true }).compile(schema);
  } catch (e) {
    throw new SchemaInconnu(`le schéma ne compile pas (ajv 2020-12, strict) : ${String(e && e.message || e).split("\n")[0]}`);
  }
  const compile = { valider };
  compiles.set(schema, compile);
  return compile;
}

/** Une erreur ajv, dite dans les mots de cette garde, avec son chemin en pointé. */
function constatDe(e) {
  const chemin = `artefact${e.instancePath.replace(/\/(\d+)(?=\/|$)/g, "[$1]").replace(/\//g, ".")}`;
  const p = e.params || {};
  switch (e.keyword) {
    case "required": return `${chemin}.${p.missingProperty} : champ obligatoire absent`;
    case "additionalProperties": return `${chemin}.${p.additionalProperty} : clé non déclarée par le schéma — aucune clé ne s'ajoute sans y être écrite`;
    case "type": return `${chemin} : type ${typeDe(e.data)}, attendu ${p.type}`;
    case "const": return `${chemin} : vaut ${JSON.stringify(e.data)}, attendu exactement ${JSON.stringify(p.allowedValue)}`;
    case "enum": return `${chemin} : ${JSON.stringify(e.data)} n'est pas parmi ${JSON.stringify(p.allowedValues)}`;
    case "minimum": return `${chemin} : ${e.data} < minimum ${p.limit}`;
    case "minItems": return `${chemin} : ${Array.isArray(e.data) ? e.data.length : "?"} élément(s), minimum ${p.limit}`;
    case "minLength": return `${chemin} : chaîne de ${typeof e.data === "string" ? e.data.length : "?"} caractère(s), minimum ${p.limit}`;
    case "pattern": return `${chemin} : ${JSON.stringify(e.data)} ne respecte pas /${p.pattern}/`;
    default: return `${chemin} : ${e.keyword} — ${e.message}`;
  }
}

/** La FORME : valide un artefact contre un schéma compilé. Rend `{ constats }` (vide = conforme). Lève `SchemaInconnu`. */
export function validerArtefact(artefact, schema) {
  const { valider } = compilerSchema(schema);
  if (valider(artefact)) return { constats: [] };
  // Les erreurs `if` ne sont que des jalons (« must match then schema ») : la cause est l'erreur d'à côté.
  return { constats: [...new Set(valider.errors.filter((e) => e.keyword !== "if").map(constatDe))] };
}

const ordonnes = (o, cles, ou, c) => {
  if (!estObjet(o)) return;
  const presentes = cles.filter((k) => nombre(o[k]));
  for (let i = 1; i < presentes.length; i += 1) {
    const a = presentes[i - 1], b = presentes[i];
    if (o[a] > o[b]) c.push(`${ou} : ${a} (${o[a]}) > ${b} (${o[b]}) — les quantiles ne sont pas ordonnés`);
  }
};

/**
 * LES INVARIANTS ENTRE NOMBRES, après la forme. Chaque constat porte son chemin. Ce que ces règles
 * DÉCIDENT, parce que le schéma ne le disait pas, est écrit dans les descriptions du schéma.
 * `empreinte` : celle du schéma appliqué, que l'artefact doit porter.
 */
export function controlerSemantiqueArtefact(a, { empreinte } = {}) {
  const c = [];
  if (!estObjet(a)) return c;
  const { complete, failure, identity: id, scenario: s, workload: w, latencyMs: l, measurementWindow: f, histogram: h, counters: k, statuses: st, correctness: co, environment: e, http, database: db, process: pr, relay: r } = a;

  if (empreinte && estObjet(id) && id.schemaSha256 !== empreinte) c.push(`artefact.identity.schemaSha256 : ${JSON.stringify(id.schemaSha256)} n'est pas l'empreinte du schéma appliqué (${empreinte}) — cet artefact a été produit sous un autre schéma, ou n'en nomme aucun`);
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
  if (estObjet(db)) {
    ordonnes(db.latencyMs, ["p50", "p95", "p99"], "artefact.database.latencyMs", c);
    if (nombre(db.timeouts) && nombre(db.calls) && db.timeouts > db.calls) c.push(`artefact.database.timeouts : ${db.timeouts} pour ${db.calls} appel(s)`);
  }
  if (estObjet(h) && Array.isArray(h.edges) && Array.isArray(h.counts)) {
    if (h.edges[0] !== 0) c.push(`artefact.histogram.edges[0] : ${h.edges[0]} — la première borne est 0, sinon une observation en dessous n'a pas de classe`);
    for (let i = 1; i < h.edges.length; i += 1) if (!(h.edges[i] > h.edges[i - 1])) { c.push(`artefact.histogram.edges : ${h.edges[i - 1]} puis ${h.edges[i]} — les classes ne sont pas strictement croissantes`); break; }
    if (h.counts.length !== h.edges.length - 1) c.push(`artefact.histogram.counts : ${h.counts.length} classe(s) pour ${h.edges.length} bord(s) — il en faut une de moins`);
    const somme = h.counts.reduce((x, y) => x + y, 0) + (nombre(h.overflow) ? h.overflow : 0);
    if (estObjet(l) && nombre(l.n) && somme !== l.n) c.push(`artefact.histogram.counts : somme ${somme} (débordement compris) pour latencyMs.n ${l.n}`);
    const attendu = binSetIdDe(h.edges);
    if (typeof h.binSetId === "string" && h.binSetId !== attendu) c.push(`artefact.histogram.binSetId : ${JSON.stringify(h.binSetId)} n'est pas dérivé de ces bornes (attendu ${attendu}) — deux jeux de bornes ne portent jamais le même identifiant`);
  }
  if (estObjet(st) && estObjet(w) && nombre(w.completedRequests)) {
    const total = ["2xx", "429", "other4xx", "503", "other5xx", "other"].reduce((x, cle) => x + (nombre(st[cle]) ? st[cle] : 0), 0);
    if (total !== w.completedRequests) c.push(`artefact.statuses : somme ${total} pour ${w.completedRequests} requête(s) achevée(s) — les catégories sont disjointes et couvrent tout`);
  }
  if (estObjet(co) && estObjet(st) && nombre(st["2xx"])) {
    const total = ["correctResponses", "emptyResponses", "wrongPresentation"].reduce((x, cle) => x + (nombre(co[cle]) ? co[cle] : 0), 0);
    if (total !== st["2xx"]) c.push(`artefact.correctness : ${total} réponse(s) jugée(s) pour ${st["2xx"]} réponse(s) 2xx — chaque 2xx est inspectée, ni plus ni moins`);
  }
  if (estObjet(pr) && estObjet(pr.memoryMiB)) {
    const { baseline, peak, end } = pr.memoryMiB;
    for (const g of ["rss", "heapUsed", "external", "arrayBuffers"]) {
      if (estObjet(peak) && estObjet(baseline) && nombre(peak[g]) && nombre(baseline[g]) && peak[g] < baseline[g]) c.push(`artefact.process.memoryMiB.peak.${g} : ${peak[g]} < baseline ${baseline[g]} — un pic couvre la fenêtre qu'il prétend couvrir`);
      if (estObjet(peak) && estObjet(end) && nombre(peak[g]) && nombre(end[g]) && peak[g] < end[g]) c.push(`artefact.process.memoryMiB.peak.${g} : ${peak[g]} < end ${end[g]} — un pic couvre la fenêtre qu'il prétend couvrir`);
    }
  }
  if (estObjet(r)) {
    if (estObjet(r.descriptors) && nombre(r.descriptors.peak) && nombre(r.descriptors.idle) && r.descriptors.peak < r.descriptors.idle) c.push(`artefact.relay.descriptors.peak : ${r.descriptors.peak} < idle ${r.descriptors.idle}`);
    if (estObjet(w) && nombre(w.completedRequests) && nombre(r.admitted) && nombre(r.refused) && r.admitted + r.refused !== w.completedRequests) c.push(`artefact.relay : admitted (${r.admitted}) + refused (${r.refused}) ≠ completedRequests (${w.completedRequests}) — une requête est une tentative de relais`);
    if (estObjet(st) && nombre(st["503"]) && nombre(r.refused) && r.refused > st["503"]) c.push(`artefact.relay.refused : ${r.refused} > statuses.503 (${st["503"]}) — un refus d'admission est une 503`);
    if (nombre(r.bytesTransferred) && nombre(r.admitted) && nombre(r.fileBytes) && r.bytesTransferred > r.admitted * r.fileBytes) c.push(`artefact.relay.bytesTransferred : ${r.bytesTransferred} > admitted × fileBytes (${r.admitted * r.fileBytes})`);
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

const lireChemin = (a, chemin) => chemin.split(".").reduce((o, k) => (estObjet(o) ? o[k] : undefined), a);
/** Ce qui doit être IDENTIQUE dans une cohorte, nommément ; `VARIABLES_D_ECHELLE` dit ce qui ne l'est pas. */
export const CONSTANTES_DE_COHORTE = [
  "schemaVersion", "identity.runId", "identity.commitSha", "identity.packageVersion", "identity.schemaSha256", "environment",
  "scenario.name", "scenario.presentations", "scenario.repetition", "scenario.sequence", "scenario.warmupRequests", "scenario.egressIps",
  "workload.arrivalModel", "workload.arrivalPattern",
  "isolation.processReused", "isolation.databaseReset", "isolation.cacheReset", "isolation.metricsReset", "isolation.countersReportedAsDeltas",
];

/**
 * LA COHORTE : les artefacts d'une même course, confrontés entre eux. `[{ nom, artefact }]`.
 * Complète : positions exactement 1..sequence.length, tous `complete: true`. Interrompue : un préfixe
 * continu 1..k dont le DERNIER est `complete: false`, et rien après. Tout le reste est refusé.
 */
export function controlerCohorte(membres) {
  const c = [];
  if (membres.length < 2) return c;
  const premier = membres[0];
  for (const m of membres.slice(1)) {
    for (const chemin of CONSTANTES_DE_COHORTE) {
      const a = lireChemin(m.artefact, chemin), b = lireChemin(premier.artefact, chemin);
      if (JSON.stringify(a) !== JSON.stringify(b)) c.push(`${m.nom} : ${chemin} ${JSON.stringify(a)} diffère de ${premier.nom} (${JSON.stringify(b)}) — pas la même course, ou pas les mêmes conditions`);
    }
  }
  const positions = new Map(), jeux = new Map(), bornesParId = new Map();
  for (const { nom, artefact } of membres) {
    const p = lireChemin(artefact, "scenario.position"), d = lireChemin(artefact, "isolation.datasetId"), h = lireChemin(artefact, "histogram");
    if (positions.has(p)) c.push(`${nom} : position ${p} déjà tenue par ${positions.get(p)}`); else positions.set(p, nom);
    if (jeux.has(d)) c.push(`${nom} : datasetId ${JSON.stringify(d)} déjà employé par ${jeux.get(d)} — des données distinctes par scénario`); else jeux.set(d, nom);
    if (estObjet(h) && typeof h.binSetId === "string") {
      const deja = bornesParId.get(h.binSetId);
      if (deja && JSON.stringify(deja.edges) !== JSON.stringify(h.edges)) c.push(`${nom} : histogram.binSetId ${h.binSetId} porte les bornes ${JSON.stringify(h.edges)} alors que ${deja.nom} porte ${JSON.stringify(deja.edges)} — un même identifiant, des bornes différentes`);
      else if (!deja) bornesParId.set(h.binSetId, { nom, edges: h.edges });
    }
  }
  // ⚠️ LA COUVERTURE, PAS SEULEMENT L'UNICITÉ : la séquence annonce n rangs, et la cohorte doit les
  // tenir tous — ou s'arrêter net sur un échec, et le dire.
  const sequence = lireChemin(premier.artefact, "scenario.sequence");
  if (Array.isArray(sequence) && positions.size === membres.length) {
    const ordonnee = [...membres].sort((x, y) => lireChemin(x.artefact, "scenario.position") - lireChemin(y.artefact, "scenario.position"));
    const rangs = ordonnee.map((m) => lireChemin(m.artefact, "scenario.position"));
    const continu = rangs.every((r, i) => r === i + 1);
    const incomplets = ordonnee.filter((m) => m.artefact.complete !== true);
    if (!continu) c.push(`cohorte : positions ${JSON.stringify(rangs)} — une cohorte est un préfixe continu 1..k de la séquence ${JSON.stringify(sequence)}`);
    else if (!incomplets.length && rangs.length !== sequence.length) c.push(`cohorte : ${rangs.length} artefact(s) tous complets pour une séquence de ${sequence.length} — une campagne complète tient toutes ses positions, une campagne interrompue porte un dernier artefact complete: false`);
    else if (incomplets.length) {
      const dernier = ordonnee[ordonnee.length - 1];
      if (dernier.artefact.complete === true) c.push(`cohorte : ${incomplets.map((m) => m.nom).join(", ")} incomplet(s) mais ${dernier.nom} complet après — rien ne suit le premier échec`);
      else if (incomplets.length > 1) c.push(`cohorte : ${incomplets.length} artefacts incomplets (${incomplets.map((m) => m.nom).join(", ")}) — une campagne s'arrête au premier échec`);
    }
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

/** Les schémas présents : `{ version → { schema, empreinte } }`. */
export function schemasPresents(racine = RACINE) {
  const dossier = join(racine, DOSSIER_SCHEMAS);
  const schemas = new Map();
  if (!existsSync(dossier)) return schemas;
  for (const f of readdirSync(dossier)) {
    const m = /^artefact\.schema-(\d+)\.json$/.exec(f);
    if (m) { const schema = JSON.parse(readFileSync(join(dossier, f), "utf8")); schemas.set(Number(m[1]), { schema, empreinte: empreinteSchema(schema) }); }
  }
  return schemas;
}

/**
 * ⚠️ L'ANCRE D'IMMUTABILITÉ : `ancres.json` = `{ "<version>": { "tag": "vX.Y.Z" } }`, le tag qui a publié
 * le premier artefact sous ce numéro. Le schéma courant doit avoir l'empreinte du schéma À CE TAG.
 * Rend `{ constats, raisons }` : un écart est une violation, un git ou un tag illisible est non concluant.
 */
export function controlerAncres(schemas, { racine = RACINE, lireAuTag = (tag, chemin) => execFileSync("git", ["show", `${tag}:${chemin}`], { cwd: racine, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) } = {}) {
  const constats = [], raisons = [];
  const chemin = join(racine, ANCRES);
  if (!existsSync(chemin)) return { constats, raisons, ancres: 0 };
  let ancres;
  try { ancres = JSON.parse(readFileSync(chemin, "utf8")); } catch (e) { return { constats, raisons: [`${ANCRES} illisible — ${e.message}`], ancres: 0 }; }
  let n = 0;
  for (const [v, ancre] of Object.entries(estObjet(ancres) ? ancres : {})) {
    const version = Number(v), tag = estObjet(ancre) ? ancre.tag : undefined;
    if (!/^v\d+\.\d+\.\d+$/.test(String(tag))) { raisons.push(`${ANCRES} : l'ancre du schéma ${v} ne nomme pas un tag vX.Y.Z (${JSON.stringify(tag)})`); continue; }
    const present = schemas.get(version);
    if (!present) { constats.push(`${ANCRES} : le schéma ${v} est ancré au tag ${tag} mais ${SCHEMA_DE(v)} n'est plus là — un schéma publié ne disparaît pas`); continue; }
    let auTag;
    try { auTag = JSON.parse(lireAuTag(tag, SCHEMA_DE(v))); } catch (e) { raisons.push(`\`git show ${tag}:${SCHEMA_DE(v)}\` a échoué (${String(e && e.message || e).split("\n")[0]}) : l'ancre du schéma ${v} n'a pas pu être relue`); continue; }
    n += 1;
    const attendue = empreinteSchema(auTag);
    if (attendue !== present.empreinte) constats.push(`${SCHEMA_DE(v)} : empreinte ${present.empreinte.slice(0, 16)}… alors que le tag ${tag}, qui a publié le premier artefact ${v}, porte ${attendue.slice(0, 16)}… — un schéma publié est immuable : toute clé ou sémantique nouvelle fait un schéma ${version + 1}`);
  }
  return { constats, raisons, ancres: n };
}

/** Un artefact, les deux couches. Rend `{ constats }` ; lève `SchemaInconnu` ; version absente → constat. */
export function jugerArtefact(artefact, schemas) {
  const version = estObjet(artefact) ? artefact.schemaVersion : undefined;
  const present = schemas.get(version);
  if (!present) return { constats: [`artefact.schemaVersion : ${JSON.stringify(version)} — aucun schéma de ce numéro (présents : ${[...schemas.keys()].join(", ") || "aucun"})`] };
  const forme = validerArtefact(artefact, present.schema).constats;
  if (forme.length) return { constats: forme };
  return { constats: controlerSemantiqueArtefact(artefact, { empreinte: present.empreinte }) };
}

export function auditer({ racine = RACINE, fichiers = [], lireAuTag } = {}) {
  const schemas = schemasPresents(racine);
  if (!schemas.size) return inconclusif(`aucun ${DOSSIER_SCHEMAS}/artefact.schema-<N>.json : rien à confronter`);
  const defauts = [];
  for (const [version, { schema }] of schemas) for (const d of controlerSchema(schema, version)) defauts.push(`${SCHEMA_DE(version)} : ${d}`);
  if (defauts.length) return violation(defauts);
  // ⚠️ LA COMPILATION, AVANT TOUT ARTEFACT : un défaut dans une branche qu'aucun exemple ne
  // matérialise ne se verrait jamais en validant. Non concluant : le schéma n'est pas lisible en entier.
  for (const [version, { schema }] of schemas) {
    try { compilerSchema(schema); } catch (e) { if (e instanceof SchemaInconnu) return inconclusif(`${SCHEMA_DE(version)} ${e.message}`); throw e; }
  }
  const ancres = controlerAncres(schemas, { racine, ...(lireAuTag ? { lireAuTag } : {}) });
  if (ancres.raisons.length) return inconclusif(ancres.raisons);
  if (ancres.constats.length) return violation(ancres.constats);

  const dossier = join(racine, EXEMPLES);
  const exemples = existsSync(dossier) ? readdirSync(dossier).filter((f) => f.endsWith(".json")).sort().map((f) => join(EXEMPLES, f)) : [];
  // ⚠️ RÈGLE ANTI-VACUITÉ : sans corpus, le validateur n'a rien validé, et un schéma qui refuserait
  // tout serait vert. Les deux branches doivent être couvertes, POUR CHAQUE schéma présent.
  if (!exemples.length) return inconclusif(`aucun exemple dans ${EXEMPLES} : le schéma n'a été confronté à rien`);

  const constats = [];
  const branches = new Map([...schemas.keys()].map((v) => [v, new Set()]));
  const lus = [], cohorte = [];
  for (const f of [...exemples, ...fichiers.map((x) => resolve(racine, x))]) {
    const chemin = resolve(racine, f), nom = exemples.includes(f) ? f : basename(f);
    let artefact;
    try { artefact = JSON.parse(readFileSync(chemin, "utf8")); } catch (e) { constats.push(`${nom} : JSON illisible — ${e.message}`); continue; }
    const r = jugerArtefact(artefact, schemas);
    lus.push(nom);
    if (estObjet(artefact) && branches.has(artefact.schemaVersion) && typeof artefact.complete === "boolean" && exemples.includes(f)) branches.get(artefact.schemaVersion).add(artefact.complete);
    if (!exemples.includes(f)) cohorte.push({ nom, artefact });
    for (const c of r.constats) constats.push(`${nom} — ${c}`);
  }
  for (const c of controlerCohorte(cohorte)) constats.push(`cohorte — ${c}`);
  if (constats.length) return violation(constats);
  for (const [v, b] of branches) if (b.size < 2) return inconclusif(`le corpus ${EXEMPLES} ne couvre pas les deux branches du schéma ${v} (complete: true ET false) : ${[...b].join(", ") || "aucune"}`);
  return conforme(`${lus.length} artefact(s) conformes — forme et invariants — aux schémas ${[...schemas.keys()].join(", ")} compilés en entier (ajv 2020-12 strict) ; ${exemples.length} exemple(s) du corpus${fichiers.length ? `, ${fichiers.length} fourni(s) confrontés en cohorte` : ""} ; ${ancres.ancres ? `${ancres.ancres} ancre(s) de publication relue(s) au tag` : "aucun schéma encore ancré à une publication"}`);
}

if (estExecuteDirectement(import.meta.url)) {
  const argv = process.argv.slice(2);
  if (argv.includes("--empreinte")) {
    for (const [v, { empreinte }] of schemasPresents()) console.log(`schéma ${v} : ${empreinte}`);
  } else {
    const fichiers = argv.filter((a) => a.startsWith("--fichier=")).map((a) => a.slice("--fichier=".length));
    conclure(tenter(() => auditer({ fichiers })));
  }
}
