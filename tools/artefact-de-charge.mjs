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
// TOUT MOT-CLÉ INCONNU DANS LE SCHÉMA FAIT LEVER — jamais ignorer. Un validateur qui saute ce qu'il
// ne connaît pas rend vert un schéma qu'il ne lit pas, et c'est exactement la forme de vacuité que
// ce dépôt traque (« a check can only refuse if its two inputs stay distinguishable »).
//
// Trois issues, comme toute garde : conforme (0), violation (1), non concluant (2). Non concluant
// quand le schéma est absent, quand il emploie un mot-clé inconnu, quand le corpus d'exemples est
// vide ou ne couvre pas les deux branches (`complete: true` ET `complete: false`).

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
export const SCHEMA = "charge/artefact.schema.json";
export const EXEMPLES = "charge/artefacts/exemples";
export const VERSION_ATTENDUE = 1;

/** Les mots-clés que ce validateur SAIT lire. Tout autre mot-clé dans un schéma est une erreur. */
export const MOTS_CLES = new Set([
  "$schema", "$id", "$ref", "$defs", "title", "description",
  "type", "properties", "required", "additionalProperties", "const", "enum",
  "minimum", "maximum", "minItems", "items", "minLength", "pattern",
  "allOf", "if", "then", "else",
]);

const typeDe = (v) => v === null ? "null" : Array.isArray(v) ? "array" : typeof v;
const estType = (v, t) => t === "integer" ? Number.isInteger(v) : t === "number" ? typeof v === "number" && Number.isFinite(v) : typeDe(v) === t;

class SchemaInconnu extends Error {}

function resoudre(ref, racineSchema) {
  if (typeof ref !== "string" || !ref.startsWith("#/")) throw new SchemaInconnu(`$ref non pris en charge : ${JSON.stringify(ref)} (seuls les « #/… » locaux le sont)`);
  let cible = racineSchema;
  for (const seg of ref.slice(2).split("/")) {
    if (!cible || typeof cible !== "object" || !(seg in cible)) throw new SchemaInconnu(`$ref introuvable : ${ref}`);
    cible = cible[seg];
  }
  return cible;
}

/** Valide `valeur` contre `schema` ; accumule les constats sous `chemin`. Rend true si rien n'est à redire. */
function valider(valeur, schema, chemin, constats, racineSchema) {
  if (schema === true) return true;
  if (schema === false) { constats.push(`${chemin} : refusé par le schéma (false)`); return false; }
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) throw new SchemaInconnu(`${chemin} : sous-schéma illisible`);
  for (const k of Object.keys(schema)) if (!MOTS_CLES.has(k)) throw new SchemaInconnu(`${chemin} : mot-clé de schéma inconnu « ${k} » — ce validateur ne le lit pas, donc il ne le vérifierait pas`);
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
  if (valeur && typeof valeur === "object" && !Array.isArray(valeur)) {
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

/** Valide un artefact. Rend `{ constats }` (vide = conforme). Lève `SchemaInconnu` sur un schéma qu'on ne sait pas lire. */
export function validerArtefact(artefact, schema) {
  const constats = [];
  valider(artefact, schema, "artefact", constats, schema);
  return { constats: [...new Set(constats)] };
}

/** Le schéma lui-même dit-il ce qu'on attend d'un schéma 1 ? */
export function controlerSchema(schema) {
  const constats = [];
  if (schema?.properties?.schemaVersion?.const !== VERSION_ATTENDUE) constats.push(`le schéma ne fige pas schemaVersion à ${VERSION_ATTENDUE} (properties.schemaVersion.const)`);
  if (typeof schema?.$id !== "string" || !schema.$id.includes(`schema-${VERSION_ATTENDUE}`)) constats.push(`$id ne porte pas la version (attendu « schema-${VERSION_ATTENDUE} » dans ${JSON.stringify(schema?.$id)})`);
  if (schema?.additionalProperties !== false) constats.push("la racine accepte des clés non déclarées : une clé s'ajouterait sans être écrite");
  if (!Array.isArray(schema?.required) || !schema.required.includes("schemaVersion") || !schema.required.includes("complete")) constats.push("schemaVersion et complete doivent être obligatoires");
  return constats;
}

export function auditer({ racine = RACINE, fichiers = [] } = {}) {
  const cheminSchema = join(racine, SCHEMA);
  if (!existsSync(cheminSchema)) return inconclusif(`${SCHEMA} absent : rien à confronter`);
  const schema = JSON.parse(readFileSync(cheminSchema, "utf8"));
  const defauts = controlerSchema(schema);
  if (defauts.length) return violation(defauts.map((d) => `${SCHEMA} : ${d}`));

  const dossier = join(racine, EXEMPLES);
  const exemples = existsSync(dossier) ? readdirSync(dossier).filter((f) => f.endsWith(".json")).sort().map((f) => join(EXEMPLES, f)) : [];
  // ⚠️ RÈGLE ANTI-VACUITÉ : sans corpus, le validateur n'a rien validé, et un schéma qui refuserait
  // tout serait vert. Les deux branches doivent être couvertes : un schéma qui casse `complete: false`
  // ne se verrait pas sur un corpus qui n'en a pas.
  if (!exemples.length) return inconclusif(`aucun exemple dans ${EXEMPLES} : le schéma n'a été confronté à rien`);

  const constats = [];
  const branches = new Set();
  const lus = [];
  for (const f of [...exemples, ...fichiers.map((x) => resolve(racine, x))]) {
    const chemin = resolve(racine, f);
    let artefact;
    try { artefact = JSON.parse(readFileSync(chemin, "utf8")); } catch (e) { constats.push(`${f} : JSON illisible — ${e.message}`); continue; }
    let r;
    try { r = validerArtefact(artefact, schema); } catch (e) {
      if (e instanceof SchemaInconnu) return inconclusif(`${SCHEMA} : ${e.message}`);
      throw e;
    }
    lus.push(f);
    if (artefact && typeof artefact.complete === "boolean") branches.add(artefact.complete);
    for (const c of r.constats) constats.push(`${f} — ${c}`);
  }
  if (constats.length) return violation(constats);
  if (branches.size < 2) return inconclusif(`le corpus ${EXEMPLES} ne couvre pas les deux branches (complete: true ET false) : ${[...branches].join(", ") || "aucune"}`);
  return conforme(`${lus.length} artefact(s) conformes au schéma ${VERSION_ATTENDUE} (${exemples.length} exemple(s) du corpus${fichiers.length ? `, ${fichiers.length} fourni(s)` : ""}) ; ${schema.required.length} champs obligatoires à la racine, aucune clé hors schéma`);
}

if (estExecuteDirectement(import.meta.url)) {
  const fichiers = process.argv.slice(2).filter((a) => a.startsWith("--fichier=")).map((a) => a.slice("--fichier=".length));
  conclure(tenter(() => auditer({ fichiers })));
}
