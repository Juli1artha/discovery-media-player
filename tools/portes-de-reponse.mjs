// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE RÉPONSE NE QUITTE CE SERVEUR QUE PAR UNE PORTE, ET LA PORTE POSE LA RÈGLE.
//
// ⚠️ LA RÈGLE A DÉJÀ ÉTÉ POSÉE UNE FOIS, ET ELLE N'A TENU QUE LÀ OÙ ELLE ÉTAIT ÉCRITE. Le premier
// scan ZAP baseline (règle 10019, 24/08) a trouvé des refus qui partaient avec un code et un corps
// et RIEN d'autre — pas de `Content-Type`, donc le seul corps de ce serveur qu'un navigateur avait
// le droit de deviner. `refuserEnTexte` est née là. Un mois plus tard, l'audit CODEX 5.6 en a
// trouvé trois autres : le `500` du bout de `/doc`, qui ne posait toujours aucun type ; le `400`
// « aucun document demandé », qui posait le type mais pas `nosniff` ; et les deux réponses de
// `bin/serve.js`, qui réécrivaient la recette à la main.
//
// ⚠️ CE N'EST DONC PAS UN OUBLI À RATTRAPER UNE TROISIÈME FOIS. Une règle qu'on réapplique à la
// main se réapplique mal — c'est la même leçon que les mesures du funnel bornées à deux endroits
// sur trois. Le geste n'est pas de vérifier chaque écriture : c'est de n'en laisser qu'une.
// `refuserEnTexte` reçoit son message en PARAMÈTRE ; partout ailleurs, un corps littéral passé à
// `.end()` est précisément la forme qui a fui trois fois.
//
// ⚠️ ON LIT UN ARBRE, PAS UN MOTIF. Ce dépôt a payé trois fois pour des gardes à expression
// régulière (`uses:`, `FROM`, `crypto`) — la dernière accusait le fichier qu'elle venait de faire
// corriger. `typescript` analyse le JavaScript et rend un arbre : un « .end » dans un commentaire
// ou dans une chaîne n'est pas un appel, et il n'a pas besoin qu'on le lui explique.
//
// ⚠️ ET LE JSON A REFAIT LA MÊME CHOSE, EN PLUS GRAND. Trouvé en mesurant le premier volet :
// l'aide de réponse JSON était définie TREIZE fois, à l'identique, sous quatre noms (`jp`, `jd`,
// `j`, `jv`), plus sept corps écrits à la main et cinq réponses inline — vingt endroits, et AUCUN
// ne posait `nosniff`. Ce n'est pas vingt oublis : c'est ce qu'une recette recopiée devient. La
// copie initiale était juste ; c'est la CORRECTION qui ne se propage pas.
//
// Le second volet ne compte donc pas les oublis, il ferme la porte : hors de `server/reponses.js`,
// AUCUN fichier ne déclare `application/json`. Le JSON sort par la porte, ou il ne sort pas.
//
// ⚠️ CE QUE CETTE GARDE NE COUVRE PAS, dit plutôt qu'à moitié couvert.
//   - Un corps CALCULÉ en texte (`res.end(variable)`) échappe au premier volet, et c'est voulu :
//     c'est la forme légitime, celle de `refuserEnTexte` elle-même.
//   - Les AUTRES types — `text/html`, `text/javascript`, `application/pdf` — ne sont pas soumis au
//     second volet. Ils ont déjà leurs propres envoyeurs dans `handler.js` (`sendHtml`, l'actif
//     pdf.js, le relais de fichier), qui posent tous `nosniff`, et les rassembler serait un autre
//     changement que celui-ci. Une garde qui prétend couvrir ce qu'elle ne regarde pas ment.
//
// Usage : node tools/portes-de-reponse.mjs [fichiers…]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import ts from "typescript";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/**
 * ⚠️ LES BUNDLES GÉNÉRÉS SONT HORS PÉRIMÈTRE : ils ne répondent à personne — ils sont chargés
 * dans une page. Les inclure ferait accuser du code compilé, que personne ne corrige à la main.
 */
const REPOND_AUX_REQUETES = /^(server|bin)\/[^/]*\.(js|cjs|mjs)$/;

/** La porte du texte. Elle reçoit son message en paramètre, donc n'écrit aucun littéral. */
export const PORTE = "refuserEnTexte";

/** Le module qui tient les portes — le seul autorisé à déclarer le type d'une réponse JSON. */
export const MODULE_DES_PORTES = "server/reponses.js";

/** Le type dont la déclaration est réservée à la porte. */
export const TYPE_RESERVE = "application/json";

/** Un texte écrit sur place : littéral, gabarit, ou concaténation de ceux-là. */
export function estTexteEcrit(noeud) {
  if (!noeud) return false;
  if (ts.isStringLiteral(noeud) || ts.isNoSubstitutionTemplateLiteral(noeud) || ts.isTemplateExpression(noeud)) return true;
  if (ts.isBinaryExpression(noeud) && noeud.operatorToken.kind === ts.SyntaxKind.PlusToken) {
    return estTexteEcrit(noeud.left) || estTexteEcrit(noeud.right);
  }
  if (ts.isParenthesizedExpression(noeud)) return estTexteEcrit(noeud.expression);
  return false;
}

const texteLitteral = (n) =>
  n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;

/**
 * Les en-têtes qu'une portée pose, sous les DEUX formes que ce dépôt emploie.
 *
 * ⚠️ `writeHead` COMPTE AUTANT QUE `setHeader`, et l'oublier aurait accusé `bin/serve.js` à tort :
 * il posait bien son `Content-Type`, dans l'objet d'un `writeHead`. Une garde qui ne connaît
 * qu'une des deux écritures d'un même fait accuse la seconde.
 */
export function entetesDe(portee) {
  const poses = new Map();
  const noter = (cle, valeur) => { if (cle) poses.set(String(cle).toLowerCase(), valeur == null ? "" : String(valeur)); };
  const visiter = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const appel = n.expression.name.text;
      if (appel === "setHeader") noter(texteLitteral(n.arguments[0]), texteLitteral(n.arguments[1]));
      if (appel === "writeHead") {
        for (const arg of n.arguments) {
          if (!ts.isObjectLiteralExpression(arg)) continue;
          for (const prop of arg.properties) {
            if (!ts.isPropertyAssignment(prop)) continue;
            const cle = ts.isStringLiteral(prop.name) || ts.isIdentifier(prop.name) ? prop.name.text : null;
            noter(cle, texteLitteral(prop.initializer));
          }
        }
      }
    }
    ts.forEachChild(n, visiter);
  };
  visiter(portee);
  return poses;
}

/** La fonction qui entoure un nœud — sa portée de raisonnement. À défaut, le fichier entier. */
const porteeDe = (n, arbre) => {
  for (let p = n.parent; p; p = p.parent) if (ts.isFunctionLike(p)) return p;
  return arbre;
};

/**
 * Les corps écrits sur place qui partent SANS que la règle du dépôt soit posée autour d'eux.
 *
 * ⚠️ CE N'EST PAS « TOUT LITTÉRAL EST FAUTIF », ET LA PREMIÈRE VERSION LE CROYAIT. Elle a relevé
 * sept `res.end('{"ok":…}')` de `routes-liens.js` — sept corps JSON qui POSENT leur type, ligne
 * par ligne. Sept faux positifs sur sept trouvailles, le même échec qu'avec le motif sur
 * `docker run` la veille. Mesurés avant d'être crus, donc corrigés dans la garde et non dans le
 * code juste. La règle exacte est celle que ce dépôt a écrite trois fois à la main :
 *   un corps en TEXTE (type absent, ou `text/…`) doit interdire le reniflage.
 * Un corps JSON qui déclare `application/json` n'est pas cette faute-là.
 *
 * ⚠️ ON NE REGARDE PAS QUI REÇOIT L'APPEL. `res`, `reponse`, `this.res` — le nom du destinataire
 * est une convention, et une garde qui l'exige laisse passer le jour où quelqu'un le renomme.
 */
export function corpsEcrits(fichier, source) {
  const arbre = ts.createSourceFile(fichier, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const trouves = [];
  const visiter = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "end"
        && estTexteEcrit(n.arguments[0])) {
      const poses = entetesDe(porteeDe(n, arbre));
      const type = poses.get("content-type");
      const enTexte = type === undefined || /^text\//i.test(type);
      if (enTexte && poses.get("x-content-type-options") !== "nosniff") {
        const { line } = arbre.getLineAndCharacterOfPosition(n.getStart(arbre));
        trouves.push({
          fichier, ligne: line + 1,
          texte: n.arguments[0].getText(arbre).split("\n")[0].slice(0, 48),
          manque: type === undefined ? "aucun Content-Type, ni nosniff" : `${type} sans nosniff`,
        });
      }
    }
    ts.forEachChild(n, visiter);
  };
  ts.forEachChild(arbre, visiter);
  return trouves;
}

/** Ce qu'il faut corriger, dit avec le geste attendu. */
export const manquements = (trouves) =>
  trouves.map((t) => `${t.fichier}:${t.ligne} — \`.end(${t.texte}…)\` part avec ${t.manque} : un corps en texte que le navigateur a le droit de requalifier. Passez par \`${PORTE}(res, statut, message)\`, qui pose le type ET nosniff en une fois`);

/**
 * Les déclarations de `application/json` faites ailleurs que dans le module des portes.
 *
 * ⚠️ ON VISE LA DÉCLARATION, PAS LE CORPS — et c'est ce qui rend ce volet utile là où le premier
 * ne peut rien. Les treize copies faisaient `res.end(JSON.stringify(obj))` : un corps CALCULÉ, que
 * le premier volet ne voit pas et ne doit pas voir. Ce qu'elles avaient toutes en commun, en
 * revanche, c'est de DÉCLARER le type — donc de décider, chacune dans son coin, ce qui accompagne
 * cette déclaration. C'est cette décision qui ne doit exister qu'en un exemplaire.
 */
export function typesReserves(fichier, source) {
  if (fichier.endsWith(MODULE_DES_PORTES)) return [];
  const arbre = ts.createSourceFile(fichier, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const trouves = [];
  const visiter = (n) => {
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const poses = entetesDe(n);
      if (poses.get("content-type") === TYPE_RESERVE) {
        const { line } = arbre.getLineAndCharacterOfPosition(n.getStart(arbre));
        trouves.push(`${fichier}:${line + 1} — cette réponse déclare elle-même \`${TYPE_RESERVE}\` : passez par \`repondreJson(res, statut, valeur)\` de \`${MODULE_DES_PORTES}\`, sinon la prochaine correction du type ou de \`nosniff\` ne s'appliquera qu'ici`);
      }
    }
    ts.forEachChild(n, visiter);
  };
  ts.forEachChild(arbre, visiter);
  return trouves;
}

/**
 * ⚠️ LE TÉMOIN DE LA RÈGLE — ET IL EST INJECTÉ, PAS DÉRIVÉ.
 *
 * Cette garde affirme une ABSENCE. Sa panne la plus probable — une sonde qui ne reconnaît plus la
 * forme qu'elle cherche — produit elle aussi une ABSENCE : tout le périmètre vert sans rien avoir
 * mesuré. Le plancher qui existait compte les FICHIERS LUS, jamais la FORME RECONNUE. Mesuré le
 * 31/08 en aveuglant la sonde : l'outil imprimait son résumé complet et sortait 0.
 *
 * ⚠️ POURQUOI INJECTÉ, ET C'EST LA MESURE QUI L'A DIT. Deux gardes voisines ont reçu le même jour
 * un témoin DÉRIVÉ du dépôt : « au moins un bloc permissions », « au moins un appel au module
 * crypto ». La même recette ici REFUSE sur un dépôt SAIN — mesuré, zéro corps reconnu pour onze
 * `.end(` bruts — parce que l'état sain de cette règle-ci est justement ZÉRO occurrence de ce
 * qu'elle cherche : tout passe par le module des portes. Un témoin dérivé aurait exigé la chose
 * même que la garde décourage.
 *
 * Un témoin dérivé n'est donc possible que si la forme correcte est une chose que le dépôt est
 * censé CONTENIR. Sinon il faut la FABRIQUER : poser un cas dont on sait qu'il est fautif, vérifier
 * que la sonde le VOIT, le jeter. Ce mécanisme n'est pas neuf ici — l'étape RLS de `ci.yml` le
 * pratique depuis des semaines sur les politiques Postgres : « on pose une politique dont on sait
 * qu'elle existe, on vérifie que la sonde la VOIT, et on l'enlève. Sans ce détour, le zéro qui suit
 * ne prouverait rien. » Il n'avait pas été porté jusqu'ici.
 *
 * Rend `null` quand la sonde voit, ou la raison du refus.
 */
export function temoinNonVu(voir = corpsEcrits, juger = manquements) {
  const echantillon = 'function h(req, res) { res.end("bonjour"); }\n';
  const vus = voir("__temoin.js", echantillon);
  if (!vus.length) return "la sonde n'a pas vu un corps écrit sur place qu'on venait de poser";
  if (!juger(vus).length) return "la sonde a vu le corps posé mais ne l'a pas jugé fautif, alors qu'il part sans type ni nosniff";
  return null;
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const fichiers = process.argv.slice(2).length ? process.argv.slice(2)
      : execFileSync("git", ["ls-files"], { encoding: "utf8" })
        .split("\n")
        .filter((f) => REPOND_AUX_REQUETES.test(f) && !f.includes("__tests__") && !f.endsWith(".generated.js"));
    if (!fichiers.length) {
      return inconclusif("aucun fichier de server/ ou bin/ relevé par git ls-files — la sonde vise à côté, ou le dépôt n'est pas là");
    }
    const aveugle = temoinNonVu();
    if (aveugle) return inconclusif(`${aveugle} — ce n'est pas une absence de corps fautif, c'est une sonde qui ne lit plus la forme`);

    const lus = fichiers.map((f) => [f, readFileSync(f, "utf8")]);
    const soucis = [
      ...manquements(lus.flatMap(([f, src]) => corpsEcrits(f, src))),
      ...lus.flatMap(([f, src]) => typesReserves(f, src)),
    ];
    if (soucis.length) return violation(soucis);
    return conforme(`portes de réponse : ${fichiers.length} fichier(s) serveur, sonde confirmée par un témoin posé — aucun corps en texte écrit sur place ne part sans type ni nosniff, et \`${TYPE_RESERVE}\` n'est déclaré que dans ${MODULE_DES_PORTES}`);
  }));
}
