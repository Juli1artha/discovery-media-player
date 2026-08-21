// LES WORKFLOWS, LUS COMME DU YAML — PLUS COMME DU TEXTE.
//
// ⚠️ DEUX GARDES DE CE DÉPÔT ONT LU LEURS FICHIERS AVEC DES EXPRESSIONS RÉGULIÈRES, ET LES DEUX
// ONT ÉTÉ AVEUGLES. `env-lues.mjs` d'abord, corrigé par un AST TypeScript. Puis
// `actions-epinglees.mjs`, qui a remplacé un `grep` par un lexer écrit à la main — et le lexer a
// échoué à son tour (revue externe, 21/08). Ces trois formes, toutes valides, lui étaient
// invisibles ou fausses :
//
//     - "uses": actions/checkout@v4          ← clé citée : rendait []
//     - { uses: actions/checkout@v4 }        ← mapping en flow : rendait []
//     run: |2-                               ← indicateur d'indentation AVANT le chomping ;
//       uses: pas/une-action@v1                le lexer reconnaissait `|-2` et pas `|2-`,
//                                              donc il prenait ce SCRIPT pour une action.
//
// Écrire un troisième lexer aurait été la troisième fois. Ce dépôt est avare de dépendances —
// c'est bien — mais l'arbitrage n'est pas « une dépendance contre zéro » : c'est « une dépendance
// contre une garde de sécurité qui ment ». `yaml` est en devDependencies : l'outillage ne part pas
// dans le tarball (`package.json#files` ne l'embarque pas), donc AUCUN intégrateur ne l'installe.
//
// ⚠️ ET IL ÉCHOUE SUR CE QU'IL NE SAIT PAS LIRE. Un document mal formé, un `uses:` dont la valeur
// n'est pas un scalaire (alias YAML, ancre, mapping) : on REFUSE en nommant le fichier et la
// ligne, plutôt que de sauter en silence. Sauter en silence est exactement ce qui a laissé passer
// les trois formes ci-dessus.

import { parseAllDocuments, isMap, isPair, isScalar, isSeq, isAlias } from "yaml";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** La ligne (1-indexée) d'un décalage dans le texte — pour nommer où ça cloche. */
export const ligneDe = (txt, offset) => txt.slice(0, offset).split("\n").length;

/** Toutes les paires clé/valeur d'un document, à toute profondeur. */
function* paires(noeud) {
  if (isPair(noeud)) { yield noeud; yield* paires(noeud.value); return; }
  if (isMap(noeud) || isSeq(noeud)) { for (const item of noeud.items) yield* paires(item); }
}

/**
 * Les `uses:` d'un fichier de workflow — étapes ET workflows réutilisables (`jobs.<id>.uses`),
 * en bloc comme en flow, clé citée ou non, avec le commentaire de fin de ligne s'il y en a un.
 */
export function usesDe(texte, fichier = "") {
  const docs = parseAllDocuments(texte);
  const trouves = [];
  for (const doc of docs) {
    if (doc.errors.length) {
      const e = doc.errors[0];
      throw new Error(`${fichier} : YAML illisible ligne ${ligneDe(texte, e.pos?.[0] ?? 0)} — ${e.message}`);
    }
    for (const paire of paires(doc.contents)) {
      if (!isScalar(paire.key) || String(paire.key.value) !== "uses") continue;
      const valeur = paire.value;
      const ligne = ligneDe(texte, valeur?.range?.[0] ?? paire.key.range?.[0] ?? 0);
      if (isAlias(valeur)) {
        throw new Error(`${fichier}:${ligne} : « uses » vaut un alias YAML (*${valeur.source}) — cette garde ne suit pas les alias, écrivez la référence en clair`);
      }
      if (!isScalar(valeur) || typeof valeur.value !== "string") {
        throw new Error(`${fichier}:${ligne} : « uses » ne vaut pas une chaîne — on refuse plutôt que de deviner`);
      }
      trouves.push({
        fichier,
        ligne,
        reference: valeur.value.trim(),
        // ⚠️ Le commentaire de fin de ligne est ce que `actions-versions.mjs` confronte au SHA.
        // Le perdre rendrait cette garde-là muette sans que rien ne le dise.
        annonce: (valeur.comment || "").trim().split(/\s+/)[0] || null,
      });
    }
  }
  return trouves;
}

/** Les fichiers de workflow d'un dossier. Refuse un dossier vide : la sonde viserait à côté. */
export function workflows(dossier = ".github/workflows") {
  const fichiers = readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f)).map((f) => join(dossier, f)).sort();
  if (!fichiers.length) throw new Error(`aucun workflow dans ${dossier} — la sonde vise à côté`);
  return fichiers;
}

/** Tous les `uses:` du dépôt, fichier par fichier. */
export const usesDuDepot = (dossier = ".github/workflows") =>
  workflows(dossier).flatMap((f) => usesDe(readFileSync(f, "utf8"), f));
