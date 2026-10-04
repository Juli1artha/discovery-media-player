#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE GARDE APPLIQUÉE À RIEN ET UNE GARDE JAMAIS APPLIQUÉE VALENT LA MÊME CHOSE.
//
// ⚠️ CE QUI EST ARRIVÉ. `filtre-avant-ecriture.mjs` et `attributs-des-generes.mjs` étaient justes,
// couvertes par leurs bancs — et appliquées à ce dépôt NULLE PART : aucun workflow ne les lançait,
// chaque banc les éprouvait sur des arbres fabriqués. Rien ne le montrait, puisque leurs bancs
// étaient verts et qu'un fichier de garde ressemble à un fichier de garde. Les deux ont été
// refermées par un bloc `describe("le dépôt lui-même")`, la convention que les plus anciennes
// suivaient déjà — et `AGENTS.md` a écrit, à ce moment-là : « l'exiger mécaniquement est une garde
// que nous n'avons pas écrite ». C'est celle-ci.
//
// ⚠️ ET ELLE NAÎT D'UNE ERREUR DE MESURE, QUI DIT CE QU'ELLE DOIT ÉVITER. Une analyse du 23/09
// annonçait six gardes « jamais lancées », dont `sections-et-tags`, et affirmait que le vrai
// CHANGELOG n'était jamais confronté aux vrais tags. C'était FAUX pour les six : cinq ont un bloc
// « le dépôt lui-même » qui appelle `garde.auditer()` sans argument — c'est-à-dire sur le dépôt —
// et la sixième (`codeowners-valide`) applique `ecarts()` au vrai CODEOWNERS sous un autre titre.
// La sonde d'alors cherchait un VOCABULAIRE (`racine`, `process.cwd`) et a manqué un appel sans
// argument. D'où les deux choix qui suivent :
//
//   • on énumère ce qui FAIT TOURNER — les blocs `run:` des workflows, les bancs — et non qui
//     « appelle » une garde : un appel peut vivre dans une convention qu'aucune recherche ne voit ;
//   • on lit le code par l'AST, jamais le texte : un nom de garde dans un titre ou un commentaire
//     n'applique rien, et deux bancs de ce dépôt nomment ainsi des gardes qu'ils ne chargent pas.
//
// LA RÈGLE. Une garde — un outil de `tools/` qui CONCLUT dans son bloc d'exécution directe — est
// appliquée à ce dépôt si au moins l'un des deux est vrai :
//
//   1. un bloc `run:` d'un workflow la lance (`node tools/x.mjs`) d'une façon qui peut faire
//      échouer son étape ;
//   2. un banc porte un `describe` dont le titre contient « le dépôt lui-même », et le corps de ce
//      bloc UTILISE quelque chose que le banc a chargé depuis la garde (un nom importé, le module
//      obtenu par `import()`, ou le chemin de la garde passé à un processus).
//
// Sinon elle est refusée — sauf exemption écrite, dont le motif est RE-VÉRIFIÉ à chaque passage.
//
// ⚠️ CE QUE CETTE GARDE NE VÉRIFIE PAS, ET QU'IL NE FAUT PAS LUI PRÊTER :
//   • que le bloc « le dépôt lui-même » applique la garde au DÉPÔT plutôt qu'à une éprouvette : elle
//     vérifie qu'il s'en SERT, pas avec quel argument. Le titre est une déclaration ; la relecture
//     reste le seul contrôle de ce qu'il déclare ;
//   • qu'un workflow qui la lance tourne SOUVENT, ni que son job soit EXIGÉ pour fusionner — ces
//     deux faits vivent dans les déclencheurs et dans un réglage de GitHub, hors de ce dépôt ;
//   • les façons d'avaler un code de sortie autres que celles reconnues ci-dessous (`set +e`,
//     `if node …; then`, `|| echo …`). Elle reconnaît `continue-on-error`, `|| true`, `|| :` et
//     le lancement en arrière-plan, parce que ce sont les seules formes sans ambiguïté — un `||`
//     suivi d'un `exit 1` relance l'échec, et l'accuser serait inventer un coupable.
//
// Usage : node tools/gardes-appliquees.mjs [--racine=.]

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import ts from "typescript";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";
import { blocsDe } from "./shell-des-workflows.mjs";
import { bancs } from "./configuration-des-bancs.mjs";

/** Le titre de la convention — écrit une fois, lu partout. */
export const TITRE_DU_DEPOT = /d[ée]p[ôo]t lui-m[êe]me/i;

const arbreDe = (source, fichier) =>
  ts.createSourceFile(fichier, source, ts.ScriptTarget.Latest, true, fichier.endsWith(".ts") ? ts.ScriptKind.TS : ts.ScriptKind.JS);

const pourChaqueNoeud = (noeud, visite) => {
  visite(noeud);
  ts.forEachChild(noeud, (enfant) => pourChaqueNoeud(enfant, visite));
};

const nomAppele = (appel) => {
  const e = appel.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (e.kind === ts.SyntaxKind.ImportKeyword) return "import";
  return null;
};

const estLitteral = (n) => n && (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n));

/** Le nom de ce qu'un appel appelle : `f(…)`, `x.f(…)`, `import(…)`. */
const nomDeLAppele = (appel) => {
  const e = appel.expression;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return nomAppele(appel);
};

/**
 * Les appels dont un argument littéral est un CHEMIN qu'on suit : on le charge, on le joint, on le
 * lance. ⚠️ SANS CETTE LISTE, LE PREMIER BANC DE CETTE GARDE L'A FAIT MENTIR : il contient
 * `toEqual(["orphelins-tts.mjs"])`, un nom de fichier dans une assertion, et la garde a crédité
 * d'une application l'outil d'exploitation qu'elle exempte. Un nom écrit n'est pas un chemin suivi.
 */
const APPELS_DE_CHEMIN = new Set(["join", "resolve", "spawn", "spawnSync", "execFile", "execFileSync", "fork", "import", "require", "requireCjs"]);

/**
 * Est-ce une garde ? Un APPEL à `estExecuteDirectement(...)` et un APPEL à `conclure(...)`, lus dans
 * l'arbre syntaxique. Le texte ne suffit pas : `resultat-garde.mjs` définit `conclure` sans
 * conclure, et un commentaire citant l'idiome ferait d'un utilitaire une garde orpheline.
 */
export function estUneGarde(source, fichier = "outil.mjs") {
  let point = false, conclut = false;
  pourChaqueNoeud(arbreDe(source, fichier), (n) => {
    if (!ts.isCallExpression(n)) return;
    const nom = nomAppele(n);
    if (nom === "estExecuteDirectement") point = true;
    if (nom === "conclure") conclut = true;
  });
  return point && conclut;
}

/** Les gardes de `tools/`, par nom de fichier. */
export function gardesDe(racine = ".") {
  const dossier = join(racine, "tools");
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith(".mjs"))
    .map((e) => ({ nom: e.name, source: readFileSync(join(dossier, e.name), "utf8") }))
    .filter((g) => estUneGarde(g.source, g.nom));
}

/**
 * Pourquoi un lancement ne peut pas faire échouer son étape — ou `null` s'il le peut.
 * Ne reconnaît que les formes SANS AMBIGUÏTÉ ; voir l'en-tête pour celles qu'elle laisse passer.
 */
export function neutralisation(ligne, bloc) {
  if (bloc.continueOnError) return "son étape porte `continue-on-error` : un échec n'arrête rien";
  if (/\|\|\s*(true|:)\s*(;|$|\))/.test(ligne)) return "un `|| true` avale son code de sortie";
  if (/(^|[^&])&\s*$/.test(ligne)) return "lancée en arrière-plan : personne n'attend son code de sortie";
  return null;
}

/** Chaque `node tools/x.mjs` des blocs `run:`, avec ce qui le neutralise éventuellement. */
export function lancementsDe(blocs) {
  const lancements = [];
  for (const bloc of blocs) {
    // Les suites `\` ne forment qu'une commande : un `|| true` peut se trouver sur la ligne d'après.
    const lignes = bloc.run.replace(/\\\n\s*/g, " ").split("\n");
    for (const brute of lignes) {
      const ligne = brute.trim();
      if (ligne.startsWith("#")) continue;
      for (const m of ligne.matchAll(/(?:^|[\s;&|(`])node\s+(?:\.\/)?tools\/([a-z0-9-]+\.mjs)\b/g)) {
        const fin = ligne.slice(m.index + m[0].length);
        lancements.push({
          outil: m[1], ou: `${bloc.fichier} › ${bloc.job} › ${bloc.nom}`,
          neutralise: neutralisation(fin, bloc),
        });
      }
    }
  }
  return lancements;
}

/** Les blocs `run:` de tous les workflows, avec `continue-on-error` de l'étape ou du job. */
export function blocsDesWorkflows(racine = ".") {
  const dossier = join(racine, ".github", "workflows");
  if (!existsSync(dossier)) return [];
  return readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f)).sort()
    .flatMap((f) => blocsDe(f, readFileSync(join(dossier, f), "utf8")));
}

/** Le nom de fichier de garde que désigne un littéral de CHEMIN, ou `null` pour toute autre chaîne. */
const gardeDuChemin = (texte, noms) => {
  if (!/^(?:[\w.-]+\/)*[a-z0-9-]+\.mjs$/.test(texte)) return null;
  const nom = basename(texte);
  return noms.has(nom) ? nom : null;
};

/**
 * Les gardes qu'un banc APPLIQUE au dépôt : celles dont quelque chose de chargé est utilisé dans un
 * bloc « le dépôt lui-même ». Rend `{ blocs, appliquees }` — le nombre de blocs reconnus est la
 * forme que la sonde a VUE, et c'est lui qui peut tomber si elle devient aveugle.
 */
export function applicationsDuBanc(source, fichier, noms) {
  const arbre = arbreDe(source, fichier);
  const liaisons = new Map();       // identifiant local → garde
  const lier = (nom, garde) => { if (nom) liaisons.set(nom, garde); };
  const nomsDuMotif = (motif) => {
    if (ts.isIdentifier(motif)) return [motif.text];
    if (ts.isObjectBindingPattern(motif) || ts.isArrayBindingPattern(motif)) {
      return motif.elements.flatMap((e) => (ts.isBindingElement(e) ? nomsDuMotif(e.name) : []));
    }
    return [];
  };

  pourChaqueNoeud(arbre, (n) => {
    // import { a, b as c } from "../garde.mjs" · import * as g from … · import g from …
    if (ts.isImportDeclaration(n) && estLitteral(n.moduleSpecifier)) {
      const garde = gardeDuChemin(n.moduleSpecifier.text, noms);
      const clause = n.importClause;
      if (!garde || !clause) return;
      lier(clause.name?.text, garde);
      const nb = clause.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) lier(nb.name.text, garde);
      if (nb && ts.isNamedImports(nb)) for (const el of nb.elements) lier(el.name.text, garde);
      return;
    }
    // garde = await import("../garde.mjs") · const { x } = require("../garde.mjs") · …
    if (ts.isCallExpression(n) && ["import", "require", "requireCjs"].includes(nomAppele(n)) && estLitteral(n.arguments[0])) {
      const garde = gardeDuChemin(n.arguments[0].text, noms);
      if (!garde) return;
      let p = n.parent;
      while (p && (ts.isAwaitExpression(p) || ts.isParenthesizedExpression(p))) p = p.parent;
      if (p && ts.isVariableDeclaration(p)) for (const nom of nomsDuMotif(p.name)) lier(nom, garde);
      if (p && ts.isBinaryExpression(p) && p.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(p.left)) lier(p.left.text, garde);
    }
  });

  let blocs = 0;
  const appliquees = new Set();
  pourChaqueNoeud(arbre, (n) => {
    if (!ts.isCallExpression(n) || nomAppele(n) !== "describe") return;
    const [titre, corps] = n.arguments;
    if (!estLitteral(titre) || !TITRE_DU_DEPOT.test(titre.text) || !corps) return;
    blocs += 1;
    pourChaqueNoeud(corps, (m) => {
      if (ts.isIdentifier(m) && liaisons.has(m.text)) appliquees.add(liaisons.get(m.text));
      // le chemin de la garde passé à un processus : spawnSync(node, [join(…, "garde.mjs")])
      if (ts.isCallExpression(m) && APPELS_DE_CHEMIN.has(nomDeLAppele(m))) {
        for (const arg of m.arguments) {
          if (!estLitteral(arg)) continue;
          const g = gardeDuChemin(arg.text, noms);
          if (g) appliquees.add(g);
        }
      }
    });
  });
  return { blocs, appliquees };
}

const lire = (racine, chemin) => { try { return readFileSync(join(racine, chemin), "utf8"); } catch { return ""; } };

/**
 * Les gardes qui n'ont PAS à être appliquées au dépôt, et pourquoi. Chaque motif est RE-VÉRIFIÉ :
 * une exemption dont la raison a disparu est refusée comme une garde orpheline, puisqu'elle en
 * cacherait une.
 */
export const EXEMPTEES = {
  "orphelins-tts.mjs": {
    pourquoi: "outil d'EXPLOITATION, pas une garde de dépôt : il supprime des objets d'un bucket sur confirmation chiffrée et a besoin d'une base vivante — la CI n'a rien à lui donner, et docs/RETENTION.md le documente pour l'opérateur",
    tientEncore: (racine, source) => /--supprimer/.test(source)
      && lire(racine, "docs/RETENTION.md").includes("node tools/orphelins-tts.mjs"),
  },
};

export function auditer({ racine = ".", exemptees = EXEMPTEES } = {}) {
  const gardes = gardesDe(racine);
  // ⚠️ ZÉRO N'EST JAMAIS UNE CONFORMITÉ : sans garde ou sans workflow, la confrontation n'a pas de sujet.
  if (!gardes.length) return inconclusif("aucune garde trouvée sous tools/ — il n'y a rien à confronter");
  const blocs = blocsDesWorkflows(racine);
  if (!blocs.length) return inconclusif("aucun bloc « run: » sous .github/workflows — rien ne lance quoi que ce soit, la confrontation n'a pas de sujet");

  const noms = new Set(gardes.map((g) => g.nom));
  const lancements = lancementsDe(blocs).filter((l) => noms.has(l.outil));
  const lancees = new Set(lancements.filter((l) => !l.neutralise).map((l) => l.outil));

  const parBanc = new Map();          // garde → bancs qui l'appliquent
  let blocsReconnus = 0;
  for (const banc of bancs(racine)) {
    const { blocs: n, appliquees } = applicationsDuBanc(readFileSync(join(racine, banc), "utf8"), banc, noms);
    blocsReconnus += n;
    for (const g of appliquees) parBanc.set(g, [...(parBanc.get(g) || []), banc]);
  }

  const constats = [];
  for (const g of gardes) {
    const appliquee = lancees.has(g.nom) || parBanc.has(g.nom);
    const ex = exemptees[g.nom];
    if (ex) {
      if (!ex.tientEncore(racine, g.source)) constats.push(`tools/${g.nom} est exemptée parce que « ${ex.pourquoi} » — et ce n'est plus vrai du fichier : une exemption qui survit à son motif cache une garde orpheline`);
      else if (appliquee) constats.push(`tools/${g.nom} est exemptée ET appliquée — l'exemption ne dispense plus rien, retirez-la avant qu'elle ne couvre un jour l'absence`);
      continue;
    }
    if (appliquee) continue;
    const neutres = lancements.filter((l) => l.outil === g.nom && l.neutralise);
    if (neutres.length) {
      for (const l of neutres) constats.push(`tools/${g.nom} n'est lancée que là où son échec ne compte pas — ${l.ou} : ${l.neutralise}`);
    } else {
      // Ce qui a été MESURÉ, et rien de plus : un banc peut appliquer la garde au dépôt sous un autre
      // titre — c'était le cas de `codeowners-valide` — et l'accuser de ne rien garder serait faux.
      constats.push(`tools/${g.nom} : aucun workflow ne la lance, et aucun bloc « le dépôt lui-même » ne s'en sert — lancez-la dans une étape, ou appliquez-la au dépôt dans un describe("le dépôt lui-même") ; si un banc le fait déjà sous un autre titre, c'est ce titre qu'il faut changer`);
    }
  }
  for (const nom of Object.keys(exemptees)) {
    if (!noms.has(nom)) constats.push(`l'exemption de tools/${nom} ne désigne plus aucune garde — une exemption morte fait croire qu'un cas est traité`);
  }
  if (constats.length) return violation(constats);

  const parBancSeul = gardes.filter((g) => !exemptees[g.nom] && !lancees.has(g.nom) && parBanc.has(g.nom)).map((g) => g.nom);
  return conforme(
    `${gardes.length} garde(s) : ${gardes.filter((g) => lancees.has(g.nom)).length} lancée(s) par un workflow `
    + `(${lancements.length} lancement(s) reconnu(s) dans ${blocs.length} bloc(s) « run: »), `
    + `${parBancSeul.length} appliquée(s) par un banc seulement (${blocsReconnus} bloc(s) « le dépôt lui-même » reconnu(s)) `
    + `— ${parBancSeul.join(", ") || "aucune"} ; ${Object.keys(exemptees).filter((n) => noms.has(n)).length} exemptée(s) : `
    + `${Object.keys(exemptees).filter((n) => noms.has(n)).join(", ") || "aucune"}`,
  );
}

if (estExecuteDirectement(import.meta.url)) {
  const racine = (process.argv.slice(2).find((x) => x.startsWith("--racine=")) || "--racine=.").slice("--racine=".length);
  conclure(tenter(() => auditer({ racine })));
}
