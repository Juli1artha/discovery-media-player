// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA VERSION DE NODE QUE LA FORGE INSTALLE, CONFRONTÉE À CELLE QUE `engines` AUTORISE.
//
// ⚠️ CETTE GARDE EXISTE PARCE QUE SA VOISINE AVAIT DÉJÀ ÉCRIT LE DIAGNOSTIC SANS SE L'APPLIQUER.
// L'en-tête de `plancher-de-node.mjs`, écrit le 25/08, porte ceci :
//
//     « LA CI NE POUVAIT PAS LE VOIR, et c'est le vrai motif de cette garde. `node-version: "22"`
//       résout au DERNIER 22.x : la CI atterrit toujours au-dessus du plancher, quel qu'il soit.
//       Une règle que l'environnement de vérification satisfait par construction n'est pas
//       vérifiée — elle est supposée. »
//
// Cette phrase nomme exactement DEUX paires. `plancher-de-node` en mesure une sérieusement —
// `engines` contre les dépendances de production. Elle laisse l'autre — `engines` contre ce que
// les WORKFLOWS épinglent — sur la prose qui vient de la diagnostiquer. Vérifié plutôt que
// supposé, le 30/08 : dans tout `tools/`, la chaîne `node-version` n'apparaissait qu'UNE fois, et
// c'était dans ce commentaire. Aucun outil ne lisait ce que la forge installe.
//
// On ne rouvre pas la phrase qui explique pourquoi un outil existe : elle est crédible parce
// qu'une garde rigoureuse vit six lignes plus bas. C'est la variante la plus discrète du motif que
// ce dépôt traque — un énoncé VRAI à l'écriture, qui deviendra faux sans que personne le touche,
// le jour où le plancher passera au-delà de 22. Et 22 finira son cycle.
//
// ⚠️ POURQUOI `intersects` ET NON `subset`, ET POURQUOI C'EST EXACT ICI. `node-version: "22"` ne
// demande pas la version 22.0.0 : `actions/setup-node` résout au PLUS HAUT 22.x disponible.
//
//     subset("22", ">=22.13.0")     → faux   ← 22.0.0 est dans « 22 » sans être dans engines.
//                                              Exiger ceci refuserait notre CI d'aujourd'hui, qui
//                                              est saine : un FAUX POSITIF, et une garde qui crie
//                                              faux finit desserrée par celui qu'elle a dérangé.
//     intersects("22", ">=22.13.0") → vrai   ← il existe des 22.x admises. Et comme setup-node
//                                              prend la PLUS HAUTE, c'est bien l'une d'elles.
//     intersects("22", ">=24")      → faux   ← aucune 22.x n'est admise : VIOLATION, celle que
//                                              cette garde existe pour attraper.
//
// La preuve tient en une ligne, et elle a une CONDITION : si `engines` vaut `>=F` sans borne
// supérieure, alors « la portée du workflow rencontre engines » implique « elle contient une
// version ≥ F », donc « son maximum est ≥ F », donc « la version réellement installée satisfait
// engines ». `intersects` est alors exactement la bonne question, pas une approximation.
//
// ⚠️ ET LA CONDITION EST VÉRIFIÉE, PAS SUPPOSÉE — SINON CETTE GARDE SERAIT SON PROPRE SUJET. Sous
// un `engines` BORNÉ EN HAUT (`>=22.13.0 <22.15.0`), le raisonnement tombe : « 22 » rencontrerait
// engines pendant que setup-node installerait 22.20, hors contrat, et la garde serait verte sur
// une violation réelle. On REFUSE donc de conclure dans ce régime, en le nommant, plutôt que de
// rendre un vert dont on ne sait plus ce qu'il vaut. Une garde qui applique un raisonnement hors
// de ses conditions est précisément l'objet de sa propre doctrine.
//
// ⚠️ ET UNE LIMITE QUI EST DITE PLUTÔT QUE SUPPOSÉE, PARCE QUE C'EST UNE MUTATION QUI L'A SORTIE.
// La preuve ci-dessus suppose qu'une version admise par les deux portées EXISTE. Sous
// `engines: ">=22.21.0"` avec un pin `"22"`, `intersects` rend vrai — 22.21.0 est bien dans la
// portée « 22 » — pendant que setup-node installerait la plus haute 22.x PUBLIÉE, qui peut être en
// dessous. La garde serait alors verte sur une violation réelle.
//
// On ne ferme pas ce trou, et voici pourquoi plutôt qu'un silence : le fermer demande de savoir
// quelles versions le registre SERT, donc d'aller sur le réseau. `plancher-de-node` a tranché le
// même arbitrage dans l'autre sens et sa raison vaut ici — une garde qui a besoin du réseau ne
// conclut pas hors ligne, et elle rend « non concluant » les jours où le registre tousse. Le cas
// manqué exige de surcroît qu'on relève le plancher DANS un majeur, sur un correctif non encore
// publié ; le cas qui a motivé cette garde — le plancher qui passe AU-DELÀ d'un majeur épinglé —
// est attrapé exactement.
//
// ⚠️ LES WORKFLOWS SONT ÉNUMÉRÉS DEPUIS LE DISQUE. Une liste écrite cesse de couvrir le jour où
// l'on ajoute un fichier, et personne ne relit une liste en ajoutant un workflow. C'est le même
// mécanisme que celui d'`outils-servis` : pas un oubli, une DISTANCE.
//
// ⚠️ PÉRIMÈTRE, DIT PLUTÔT QUE TU. Cette garde lit `.github/workflows` et rien d'autre. Le
// `Dockerfile` déclare lui aussi une version (`node:24-alpine`, épinglée au condensat) et n'entre
// PAS dans ce relevé : sa forme se lit dans un Dockerfile, ce dépôt a déjà payé deux lecteurs
// aveugles pour ce genre d'exercice, et `images-epinglees` tient ce fichier par un autre bout. Le
// résumé imprime donc ce qu'il a lu — un verdict sans périmètre ne se juge pas.
//
// Usage : node tools/node-des-workflows.mjs [.github/workflows]

import { readFileSync } from "node:fs";

import { parseAllDocuments, isMap, isScalar, isSeq } from "yaml";
import semver from "semver";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";
import { workflows, ligneDe } from "./workflows-yaml.mjs";

/**
 * ⚠️ DEUX PLANCHERS, PARCE QU'UN SEUL SE LAISSE CONTOURNER PAR UN BALAYAGE QUI RÉTRÉCIT. Un
 * relevé qui perdrait la moitié du dossier rendrait encore « aucune violation » avec un plancher
 * unique sur le nombre de déclarations. Aujourd'hui : 12 déclarations sur 5 fichiers.
 */
export const PLANCHER_DECLARATIONS = 8;
export const PLANCHER_FICHIERS = 4;

/** L'entrée d'action qui demande une version, et sa sœur qui la lit dans un fichier. */
const CLE = "node-version";
const CLE_FICHIER = "node-version-file";

const paireDe = (noeud, cle) => isMap(noeud)
  ? noeud.items.find((p) => isScalar(p.key) && String(p.key.value) === cle) || null
  : null;

/** Une valeur scalaire, ou `null` si ce n'en est pas une — on ne devine pas. */
const scalaire = (noeud) => (isScalar(noeud) && noeud.value != null ? String(noeud.value) : null);

/**
 * Les entrées d'une matrice de job, par clé : `{ node: ["22", "24"] }`.
 *
 * ⚠️ `include:` EST LU AUSSI. Une version ajoutée par `include` s'exécute exactement comme les
 * autres ; ne lire que la liste principale ferait une garde exhaustive dans un périmètre qu'elle
 * ne dirait pas. Ce qu'on ne sait pas lire n'est pas sauté : c'est rendu dans `illisibles`.
 */
function matriceDe(job, fichier, texte) {
  const valeurs = new Map();
  const illisibles = [];
  const matrice = paireDe(paireDe(job, "strategy")?.value, "matrix")?.value;
  if (!isMap(matrice)) return { valeurs, illisibles };

  const noter = (cle, noeud) => {
    const v = scalaire(noeud);
    if (v == null) {
      illisibles.push(`${fichier}:${ligneDe(texte, noeud?.range?.[0] ?? 0)} : matrix.${cle} porte une entrée qui n'est pas un scalaire — on refuse plutôt que de deviner`);
      return;
    }
    if (!valeurs.has(cle)) valeurs.set(cle, []);
    valeurs.get(cle).push({ valeur: v, ligne: ligneDe(texte, noeud.range?.[0] ?? 0) });
  };

  for (const paire of matrice.items) {
    const cle = scalaire(paire.key);
    if (cle == null) continue;
    if (cle === "include") {
      if (!isSeq(paire.value)) continue;
      for (const entree of paire.value.items) {
        if (!isMap(entree)) continue;
        for (const sous of entree.items) {
          const sousCle = scalaire(sous.key);
          if (sousCle != null) noter(sousCle, sous.value);
        }
      }
      continue;
    }
    if (cle === "exclude") continue;
    if (isSeq(paire.value)) for (const item of paire.value.items) noter(cle, item);
  }
  return { valeurs, illisibles };
}

/**
 * Les versions de node qu'un fichier de workflow demande à la forge d'installer.
 *
 * Rend `{ declarations, illisibles }` : ce qui a pu être lu, et ce qui n'a pas pu l'être. Le
 * second n'est JAMAIS vide en silence — un `node-version` qu'on ne sait pas résoudre rend la
 * garde non concluante, il ne disparaît pas du relevé.
 */
export function versionsDe(texte, fichier = "") {
  const declarations = [];
  const illisibles = [];

  for (const doc of parseAllDocuments(texte)) {
    if (doc.errors.length) {
      const e = doc.errors[0];
      throw new Error(`${fichier} : YAML illisible ligne ${ligneDe(texte, e.pos?.[0] ?? 0)} — ${e.message}`);
    }
    const jobs = paireDe(doc.contents, "jobs")?.value;
    if (!isMap(jobs)) continue;

    for (const paireJob of jobs.items) {
      const job = paireJob.value;
      const nomJob = scalaire(paireJob.key) || "?";
      if (!isMap(job)) continue;

      const { valeurs, illisibles: illisiblesMatrice } = matriceDe(job, fichier, texte);
      illisibles.push(...illisiblesMatrice);

      const etapes = paireDe(job, "steps")?.value;
      if (!isSeq(etapes)) continue;

      for (const etape of etapes.items) {
        const avec = paireDe(etape, "with")?.value;
        if (!isMap(avec)) continue;

        // ⚠️ SAUTER CETTE FORME LA RENDRAIT INVISIBLE À LA GARDE ET BIEN VIVANTE DANS LA FORGE.
        // `node-version-file` désigne un `.nvmrc` ou un `package.json` : la version existe, elle
        // est juste écrite ailleurs. Ce dépôt n'en a aucun aujourd'hui ; le jour où il en gagne
        // un, cette garde le DIT au lieu de rétrécir sans laisser de trace.
        const parFichier = paireDe(avec, CLE_FICHIER);
        if (parFichier) {
          illisibles.push(`${fichier}:${ligneDe(texte, parFichier.value?.range?.[0] ?? 0)} (job « ${nomJob} ») : la version vient de « ${CLE_FICHIER} », que cette garde ne suit pas — ajoutez-lui cette lecture plutôt que de laisser une version non confrontée`);
          continue;
        }

        const paire = paireDe(avec, CLE);
        if (!paire) continue;
        const ligne = ligneDe(texte, paire.value?.range?.[0] ?? paire.key.range?.[0] ?? 0);
        const brut = scalaire(paire.value);
        if (brut == null) {
          illisibles.push(`${fichier}:${ligne} (job « ${nomJob} ») : « ${CLE} » ne vaut pas un scalaire — on refuse plutôt que de deviner`);
          continue;
        }

        const expression = brut.trim().match(/^\$\{\{\s*matrix\.([A-Za-z_][A-Za-z0-9_-]*)\s*\}\}$/);
        if (expression) {
          const entrees = valeurs.get(expression[1]);
          if (!entrees?.length) {
            illisibles.push(`${fichier}:${ligne} (job « ${nomJob} ») : « ${CLE} » lit matrix.${expression[1]}, que la matrice de ce job ne déclare pas — la version installée est indéterminable ici`);
            continue;
          }
          for (const e of entrees) {
            declarations.push({ fichier, ligne: e.ligne, job: nomJob, portee: e.valeur, via: `matrix.${expression[1]}` });
          }
          continue;
        }

        if (brut.includes("${{")) {
          illisibles.push(`${fichier}:${ligne} (job « ${nomJob} ») : « ${CLE} » vaut l'expression « ${brut} », que cette garde ne sait pas résoudre — la version installée n'est pas confrontée à engines`);
          continue;
        }

        declarations.push({ fichier, ligne, job: nomJob, portee: brut.trim(), via: null });
      }
    }
  }
  return { declarations, illisibles };
}

/** Tout ce que les workflows d'un dossier demandent d'installer. */
export function versionsDuDepot(dossier = ".github/workflows") {
  const declarations = [];
  const illisibles = [];
  for (const f of workflows(dossier)) {
    const r = versionsDe(readFileSync(f, "utf8"), f);
    declarations.push(...r.declarations);
    illisibles.push(...r.illisibles);
  }
  return { declarations, illisibles };
}

/**
 * `engines` est-il un plancher SANS plafond ? C'est la condition sous laquelle `intersects`
 * répond exactement à la question posée — voir l'en-tête.
 */
export function estUnPlancherSansPlafond(engines) {
  const bas = semver.minVersion(engines);
  return bas ? semver.subset(`>=${bas.version}`, engines) : false;
}

/**
 * Le verdict, à partir de ce qui a été lu. Séparé de la lecture du disque pour que le banc
 * puisse l'éprouver sur des relevés fabriqués, sans écrire un seul fichier.
 */
export function verdict({ engines, declarations, illisibles }) {
  if (typeof engines !== "string" || !engines.trim()) {
    return inconclusif("package.json ne déclare pas engines.node — il n'y a rien à quoi confronter les workflows");
  }
  if (!semver.validRange(engines)) {
    return inconclusif(`engines.node vaut « ${engines} », que semver ne sait pas lire — on refuse plutôt que de comparer au jugé`);
  }
  if (illisibles.length) return inconclusif(illisibles);

  const fichiers = new Set(declarations.map((d) => d.fichier));
  if (declarations.length < PLANCHER_DECLARATIONS) {
    return inconclusif(`le relevé ne voit que ${declarations.length} déclaration(s) de « ${CLE} » (plancher ${PLANCHER_DECLARATIONS}) — un balayage qui ne lit plus les workflows rendrait « aucune violation » pour n'avoir rien lu`);
  }
  if (fichiers.size < PLANCHER_FICHIERS) {
    return inconclusif(`le relevé ne voit des déclarations que dans ${fichiers.size} fichier(s) (plancher ${PLANCHER_FICHIERS}) — le compte peut tenir alors que la moitié du dossier n'est plus lue`);
  }

  if (!estUnPlancherSansPlafond(engines)) {
    return inconclusif(`engines.node vaut « ${engines} », qui porte un PLAFOND — le raisonnement de cette garde (setup-node installe la plus haute version de la portée demandée) n'est exact que sous un plancher sans plafond, et appliqué ici il pourrait rendre vert une CI qui tourne hors contrat ; lisez la paire à la main, ou étendez cette garde au régime borné`);
  }

  const bas = semver.minVersion(engines).version;
  const constats = [];
  for (const d of declarations) {
    const ou = `${d.fichier}:${d.ligne} (job « ${d.job} »${d.via ? `, via ${d.via}` : ""})`;
    if (!semver.validRange(d.portee)) {
      // ⚠️ « lts/* », « latest », « node » : setup-node les accepte, semver non. On ne les compare
      // pas au jugé, et on ne les saute pas non plus.
      return inconclusif(`${ou} : « ${CLE}: ${d.portee} » n'est pas une portée que semver sait lire — cette version n'est donc pas confrontée à engines, et une garde qui saute ce qu'elle ne lit pas est verte pour de mauvaises raisons`);
    }
    if (!semver.intersects(d.portee, engines)) {
      constats.push(`${ou} : la forge installera node ${d.portee}, qu'engines.node « ${engines} » n'admet pas — ce job valide donc sur un moteur que notre propre paquet déclare non supporté, et rien d'autre ne le dirait`);
    }
  }
  if (constats.length) return violation(constats);

  return conforme(
    `node des workflows : ${declarations.length} déclaration(s) de « ${CLE} » dans ${fichiers.size} fichier(s) de .github/workflows, toutes admises par engines.node « ${engines} » (plancher ${bas}) — portées relevées : ${[...new Set(declarations.map((d) => d.portee))].sort().join(", ")}`,
  );
}

export function garde(dossier = ".github/workflows", racine = ".") {
  return tenter(() => {
    let paquet;
    try {
      paquet = JSON.parse(readFileSync(`${racine}/package.json`, "utf8"));
    } catch (e) {
      return inconclusif(`package.json est illisible (${e.message}) — la sonde vise à côté`);
    }
    const { declarations, illisibles } = versionsDuDepot(dossier);
    return verdict({ engines: paquet?.engines?.node, declarations, illisibles });
  });
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(garde(process.argv[2] || ".github/workflows"));
}
