// Quelles variables d'environnement le RUNTIME lit-il réellement ?
//
// ⚠️ POURQUOI UN DÉPOUILLEMENT LEXICAL, ET PAS UN grep. La première version de cette garde
// (ci.yml, 21/08) cherchait `process.env.X` dans le texte brut : un COMMENTAIRE qui citait une
// variable — « // Exemple : process.env.VARIABLE_COMMENTAIRE » — la faisait rougir, alors que
// son message affirme détecter ce que le code LIT (contre-audit externe, 21/08). Une sonde qui
// lit du commentaire invente des coupables — c'est mot pour mot la leçon déjà écrite dans la
// garde PostgREST de ci.yml, réapprise ici. On retire donc commentaires et chaînes AVANT de
// chercher, et ce dépouillement a ses propres tests (tools/__tests__/envLues.test.js) : un
// extracteur qui n'est pas testé n'est qu'une opinion sur des regex.
//
// Ce qui est ÉLIMINÉ : commentaires (// et /* */), chaînes ('…' et "…"), et le TEXTE des
// gabarits `…` — du texte n'est pas une lecture. Ce qui est CONSERVÉ : les interpolations
// ${…} des gabarits, parce que c'en est — server/gabarit-agent.js lit ELEVENLABS_API_KEY
// précisément là.
//
// ⚠️ LES LITTÉRAUX DE REGEX SONT LEXÉS, ET CE N'EST PAS DU ZÈLE. La première version les
// ignorait en déclarant « angle mort local » — et server/texte.js a prouvé que c'était faux :
// il contient `.replace(/"/g, …)`, le guillemet DANS la regex ouvrait un état « chaîne » que
// rien ne refermait proprement, et tout le reste du fichier était avalé en silence. Une lecture
// ajoutée en fin de texte.js devenait invisible — un faux NÉGATIF global, découvert en rejouant
// la mutation du contre-audit sur ce fichier précis. Regex ou division se décide comme partout
// (dernier caractère significatif émis + mots-clés) ; le contenu d'une regex est du motif, pas
// une lecture, donc il tombe. L'ambiguïté résiduelle de cette heuristique est déclarée dans les
// tests, pas dissimulée dedans.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Retire commentaires, chaînes et texte de gabarit ; conserve le code, dont les ${…}. */
export function depouiller(src) {
  let sortie = "";
  const pile = [{ type: "code", prof: 0 }];
  for (let i = 0; i < src.length; i++) {
    const c = src[i], d = src[i + 1];
    const cadre = pile[pile.length - 1];
    if (cadre.type === "lcom") { if (c === "\n") { pile.pop(); sortie += "\n"; } continue; }
    if (cadre.type === "bcom") { if (c === "*" && d === "/") { pile.pop(); i++; } else if (c === "\n") sortie += "\n"; continue; }
    if (cadre.type === "sq") { if (c === "\\") i++; else if (c === "'") pile.pop(); continue; }
    if (cadre.type === "dq") { if (c === "\\") i++; else if (c === '"') pile.pop(); continue; }
    if (cadre.type === "tpl") {
      if (c === "\\") { i++; continue; }
      if (c === "`") { pile.pop(); continue; }
      if (c === "$" && d === "{") { pile.push({ type: "code", prof: 1 }); sortie += " "; i++; continue; }
      if (c === "\n") sortie += "\n";
      continue;
    }
    if (cadre.type === "regex") {
      if (c === "\\") { i++; continue; }
      if (c === "[") cadre.classe = true;
      else if (c === "]") cadre.classe = false;
      else if (c === "/" && !cadre.classe) pile.pop(); // les drapeaux qui suivent sont inoffensifs
      continue;
    }
    // code
    if (c === "/" && d === "/") { pile.push({ type: "lcom" }); i++; continue; }
    if (c === "/" && d === "*") { pile.push({ type: "bcom" }); i++; continue; }
    if (c === "/") {
      // Regex ou division ? Le critère standard : ce qui PRÉCÈDE. Après un opérande (identifiant,
      // nombre, `)`, `]`) c'est une division ; après un opérateur, une ouvrante, un début de
      // ligne ou un mot-clé d'expression, c'est une regex.
      const tronc = sortie.replace(/\s+$/, "");
      const avant = tronc.slice(-1);
      const regexPossible = tronc === "" || "=([{,;:!&|?+*%^~<>-".includes(avant)
        || /(?:^|[^\w$])(?:return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await)$/.test(tronc);
      if (regexPossible) { pile.push({ type: "regex", classe: false }); sortie += " "; continue; }
      sortie += c; continue;
    }
    if (c === "'") { pile.push({ type: "sq" }); sortie += " "; continue; }
    if (c === '"') { pile.push({ type: "dq" }); sortie += " "; continue; }
    if (c === "`") { pile.push({ type: "tpl" }); sortie += " "; continue; }
    if (cadre.prof) {
      if (c === "{") cadre.prof++;
      else if (c === "}") { cadre.prof--; if (cadre.prof === 0) { pile.pop(); sortie += " "; continue; } }
    }
    sortie += c;
  }
  return sortie;
}

/** Les deux motifs de lecture du dépôt : `process.env.X` direct, et `env.X` via
 *  createStandaloneContext(env = process.env). Sur source DÉPOUILLÉE uniquement. */
export function variablesLues(src) {
  const lues = new Set();
  for (const m of depouiller(src).matchAll(/\b(?:process\.)?env\.([A-Z][A-Z0-9_]{2,})\b/g)) lues.add(m[1]);
  return lues;
}

/** Formes d'accès que l'extracteur ne sait PAS suivre — donc interdites plutôt que ratées :
 *  accès dynamique par crochets, déstructuration, alias sous un autre nom que `env`. */
export function accesInterdits(src) {
  const nettoye = depouiller(src);
  const trouves = [];
  for (const [motif, raison] of [
    [/process\.env\s*\[/g, "accès dynamique process.env[…] — illisible pour la garde de documentation"],
    [/\{[^{}]*\}\s*=\s*process\.env\b/g, "déstructuration de process.env — les noms échappent à la garde"],
    [/\b(?!env\b)[A-Za-z_$][\w$]*\s*=\s*process\.env\s*(?![.[\w])/g, "alias de process.env sous un autre nom que `env`"],
  ]) {
    for (const m of nettoye.matchAll(motif)) trouves.push({ extrait: m[0].trim(), raison });
  }
  return trouves;
}

// Outillage de forge, jamais lu par une instance : le documenter mentirait sur la surface.
const HORS_SURFACE = new Set(["PREFIXE_REST_AMONT", "PREFIXE_REST_PORT"]);

// Périmètre : le RUNTIME — bin/, context/, server/ — fichiers .js, hors tests, hors bundles
// générés (du code navigateur minifié, où `env` peut être n'importe quelle variable locale).
export function inventaire(racine = ".") {
  const lues = new Set(), interdits = [];
  const visiter = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__") visiter(p); continue; }
      if (!p.endsWith(".js") || p.endsWith(".generated.js")) continue;
      const src = readFileSync(p, "utf8");
      for (const v of variablesLues(src)) lues.add(v);
      for (const a of accesInterdits(src)) interdits.push({ fichier: p, ...a });
    }
  };
  for (const d of ["bin", "context", "server"]) visiter(join(racine, d));
  return { lues, interdits };
}

// Exécution directe : le contrat de la garde. Sortie 1 = une variable lue sans documentation,
// ou une forme d'accès que la garde ne saurait pas suivre.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  const { lues, interdits } = inventaire();
  const doc = readFileSync("docs/CONFIGURATION.md", "utf8");
  const oubliees = [...lues].filter((v) => !HORS_SURFACE.has(v) && !doc.includes("`" + v + "`")).sort();
  let echec = false;
  if (interdits.length) {
    echec = true;
    for (const i of interdits) console.error(`::error::${i.fichier} : ${i.raison} (« ${i.extrait} »)`);
  }
  if (oubliees.length) {
    echec = true;
    console.error("::error::variable(s) lue(s) par le code, absente(s) de docs/CONFIGURATION.md : " + oubliees.join(", ") + " — pour un exploitant, une variable non documentée n'existe pas");
  }
  if (echec) process.exit(1);
  console.log("environnement : " + lues.size + " variables lues, toutes documentées, aucun accès hors motifs");
}
