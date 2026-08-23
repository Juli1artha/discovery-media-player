// Quelles variables d'environnement le RUNTIME lit-il réellement ?
//
// ⚠️ TROISIÈME GÉNÉRATION, ET LES DEUX PREMIÈRES ONT ÉCHOUÉ POUR LA MÊME RAISON : elles
// cherchaient dans du TEXTE ce qui est une question de CODE.
//
//   v1 (grep) : un commentaire citant une variable rougissait la CI. Une sonde qui lit du
//   commentaire invente des coupables — même leçon que la sonde PostgREST de ci.yml.
//
//   v2 (lexer artisanal) : quatre défauts trouvés par un troisième audit externe (21/08).
//   Une regex contenant un guillemet, placée après une parenthèse fermante, décalait l'état
//   des chaînes et masquait TOUT le reste du fichier ; `process . env . X` (espaces valides)
//   passait entre les mailles ; `const cfg = (process.env)` aussi ; et le texte d'une regex
//   inventait une variable. Trois faux négatifs et un faux positif.
//
//   ⚠️ UN FAUX NÉGATIF EST PIRE QU'UNE GARDE ABSENTE : il fait croire que la vérification a
//   eu lieu. C'est pour ça qu'on ne rafistole pas l'heuristique une troisième fois.
//
// v3 lit l'AST TypeScript (`typescript` est déjà une dépendance de développement — la même
// qui sert à `npm run typecheck`, donc rien de neuf n'entre dans la chaîne). Un commentaire,
// une chaîne, une regex ne sont pas des nœuds exécutés : la question « est-ce une lecture ? »
// ne se pose plus, elle se lit dans la forme de l'arbre.
//
// CE QUI EST SUIVI : `process.env.NOM`, avec espaces, parenthèses et chaînage optionnel ;
// `process["env"]["NOM"]` à nom statique ; les alias de `process.env` (quel que soit leur nom,
// y compris transitifs et en paramètre par défaut — le motif de context/standalone.js) ; la
// déstructuration statique, renommage compris.
//
// CE QUI EST REFUSÉ PLUTÔT QUE RATÉ : tout ce dont le nom n'est pas lisible statiquement —
// `process.env[cle]`, une capture par reste, une propriété calculée. La garde ne PEUT pas les
// suivre ; elle le dit et bloque, au lieu de rendre un inventaire silencieusement incomplet.
//
// ⚠️ UNE CONVENTION, ASSUMÉE COMME TELLE : l'identifiant `env` désigne l'environnement, même
// quand rien dans le fichier ne le lie à `process.env`. Ce n'est pas une déduction, c'est la
// forme du dépôt — `context/storage.js` reçoit `function hostFetchBase(env)` depuis
// `standalone.js`, et y lit PLAYER_HOST_FETCH_BASE et PLAYER_STORAGE_ORIGINS. Sans cette
// convention, l'AST les rate : constaté en comparant l'inventaire v2 et v3 avant de livrer,
// deux variables perdues en silence — le faux négatif qu'on venait de chasser, réintroduit par
// sa propre correction. Suivre un `env` inter-fichiers demanderait un graphe de types ; la
// convention coûte, au pire, une variable sur-détectée, donc une ligne de documentation.
// Sur-matcher coûte une ligne ; sous-matcher coûte une variable qui n'existe pour personne —
// même arbitrage que la garde de rétention.
//
// ANGLE MORT DÉCLARÉ, celui qui reste : un environnement passé sous un AUTRE nom que `env` à
// travers une frontière de fichier. Rien ne le fait aujourd'hui (vérifié par le diff v2↔v3) ;
// le jour où quelqu'un l'écrit, c'est cette ligne qu'il faut relire.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import ts from "typescript";
import { estExecuteDirectement } from "./execute-directement.mjs";

// Les variables d'environnement de ce dépôt sont en MAJUSCULES, sans exception. Le filtre
// écarte le bruit (`env.length`, `env.toString`) sans jamais écarter une vraie variable.
const NOM_VALIDE = /^[A-Z][A-Z0-9_]{2,}$/;

const deballer = (n) => {
  while (n && (ts.isParenthesizedExpression(n) || ts.isAsExpression?.(n) || ts.isNonNullExpression(n))) n = n.expression;
  return n;
};

/** Ce nœud désigne-t-il `process.env` — directement, ou par un alias déjà connu ? */
function estProcessEnv(noeud, alias) {
  const n = deballer(noeud);
  if (!n) return false;
  if (ts.isIdentifier(n)) return alias.has(n.text);
  if (ts.isPropertyAccessExpression(n)) {
    const objet = deballer(n.expression);
    return ts.isIdentifier(objet) && objet.text === "process" && n.name.text === "env";
  }
  if (ts.isElementAccessExpression(n)) {
    const objet = deballer(n.expression);
    const arg = deballer(n.argumentExpression);
    return ts.isIdentifier(objet) && objet.text === "process"
      && arg && ts.isStringLiteralLike(arg) && arg.text === "env";
  }
  return false;
}

function arbre(src, fichier = "source.js") {
  const source = ts.createSourceFile(fichier, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  // ⚠️ Un fichier que le parseur refuse ne doit PAS rendre un inventaire vide : ce serait le
  // faux négatif de la v2, repeint en neuf. On échoue bruyamment.
  const erreurs = source.parseDiagnostics || [];
  if (erreurs.length) {
    const m = ts.flattenDiagnosticMessageText(erreurs[0].messageText, " ");
    throw new Error(`${fichier} : le parseur refuse ce fichier (${m}) — inventaire impossible`);
  }
  return source;
}

/** Parcourt tous les nœuds, y compris les interpolations de gabarit (l'AST les traverse seul). */
function pourChaqueNoeud(source, visiteur) {
  const marcher = (n) => { visiteur(n); ts.forEachChild(n, marcher); };
  ts.forEachChild(source, marcher);
}

/** Les identifiants liés à `process.env`, jusqu'au point fixe (alias d'alias), plus la
 *  convention `env` du dépôt — voir l'en-tête : elle porte deux variables réelles. */
function aliasDe(source) {
  const alias = new Set(["env"]);
  for (let tour = 0, ajout = true; ajout && tour < 10; tour++) {
    ajout = false;
    pourChaqueNoeud(source, (n) => {
      const lie = (nom, init) => {
        if (!nom || !init || !ts.isIdentifier(nom)) return;
        if (alias.has(nom.text) || !estProcessEnv(init, alias)) return;
        alias.add(nom.text); ajout = true;
      };
      if (ts.isVariableDeclaration(n)) lie(n.name, n.initializer);
      else if (ts.isParameter(n)) lie(n.name, n.initializer);
      else if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.EqualsToken) lie(n.left, n.right);
    });
  }
  return alias;
}

/** { lues, interdits } pour une source. Lève si le fichier ne se parse pas. */
export function analyser(src, fichier = "source.js") {
  const source = arbre(src, fichier);
  const alias = aliasDe(source);
  const lues = new Set(), interdits = [];
  const refuser = (raison, n) => interdits.push({ raison, extrait: n.getText().slice(0, 80).replace(/\s+/g, " ") });

  pourChaqueNoeud(source, (n) => {
    // process.env.NOM  ·  env.NOM  ·  process.env?.NOM
    if (ts.isPropertyAccessExpression(n) && estProcessEnv(n.expression, alias)) {
      if (NOM_VALIDE.test(n.name.text)) lues.add(n.name.text);
      return;
    }
    // process.env["NOM"] statique ; tout nom calculé est refusé, jamais deviné
    if (ts.isElementAccessExpression(n) && estProcessEnv(n.expression, alias)) {
      const arg = deballer(n.argumentExpression);
      if (arg && ts.isStringLiteralLike(arg)) { if (NOM_VALIDE.test(arg.text)) lues.add(arg.text); }
      else refuser("nom d'environnement calculé — illisible statiquement", n);
      return;
    }
    // const { NOM, AUTRE: local } = process.env
    if (ts.isVariableDeclaration(n) && n.initializer && estProcessEnv(n.initializer, alias)
        && n.name && ts.isObjectBindingPattern(n.name)) {
      for (const element of n.name.elements) {
        if (element.dotDotDotToken) { refuser("capture par reste de process.env — emporte des noms qu'on ne saura pas nommer", element); continue; }
        const cle = element.propertyName || element.name;
        if (ts.isComputedPropertyName(cle)) { refuser("propriété calculée dans une déstructuration de process.env", element); continue; }
        const nom = ts.isIdentifier(cle) || ts.isStringLiteralLike(cle) ? cle.text : null;
        if (nom && NOM_VALIDE.test(nom)) lues.add(nom);
      }
    }
  });
  return { lues, interdits };
}

export const variablesLues = (src, fichier) => analyser(src, fichier).lues;
export const accesInterdits = (src, fichier) => analyser(src, fichier).interdits;

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
      const { lues: l, interdits: i } = analyser(readFileSync(p, "utf8"), p);
      for (const v of l) lues.add(v);
      for (const a of i) interdits.push({ fichier: p, ...a });
    }
  };
  for (const d of ["bin", "context", "server"]) visiter(join(racine, d));
  return { lues, interdits };
}

// Exécution directe : le contrat de la garde.
//   0 — toute variable lue est documentée, et tout accès est lisible ;
//   1 — le dépôt viole la règle (variable non documentée, accès au nom illisible) ;
//   2 — la garde n'a pas pu conclure (voir tools/resultat-garde.mjs).
if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const { lues, interdits } = inventaire();

    // ⚠️ ZÉRO VARIABLE N'EST PAS UN SUCCÈS — LE MÊME DÉFAUT QUE LA GARDE DOCKER, ICI AUSSI.
    // Ce bloc imprimait « 0 variables lues (AST), toutes documentées » et sortait 0 dès que
    // l'inventaire ne trouvait rien : un dossier déplacé, un `racine` qui vise à côté, un jour où
    // `bin/`, `context/` et `server/` ne contiennent plus de `.js` lisible. Ce runtime lit
    // certainement son environnement ; un relevé vide décrit la sonde, pas le code. Personne
    // n'avait signalé celui-ci — il a été trouvé en portant le correctif de la garde Docker.
    if (!lues.size) {
      return inconclusif("aucune variable d'environnement relevée dans bin/, context/, server/ — la sonde vise à côté : ce runtime en lit forcément");
    }

    const doc = readFileSync("docs/CONFIGURATION.md", "utf8");
    const oubliees = [...lues].filter((v) => !HORS_SURFACE.has(v) && !doc.includes("`" + v + "`")).sort();

    const constats = interdits.map((i) => `${i.fichier} : ${i.raison} (« ${i.extrait} »)`);
    if (oubliees.length) {
      constats.push("variable(s) lue(s) par le code, absente(s) de docs/CONFIGURATION.md : " + oubliees.join(", ") + " — pour un exploitant, une variable non documentée n'existe pas");
    }
    if (constats.length) return violation(constats);
    return conforme("environnement : " + lues.size + " variables lues (AST), toutes documentées, aucun nom illisible");
  }));
}
