// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES IMAGES QUE LA FORGE TIRE S'ÉPINGLENT COMME CELLES DU DOCKERFILE.
//
// ⚠️ LA RÈGLE EXISTAIT, ET ELLE NE REGARDAIT QU'UN FICHIER. `images-epinglees` refuse un
// `FROM node:24-alpine` sans condensat : « l'étiquette 24-alpine désigne une image différente
// chaque semaine, et deux constructions du MÊME commit produisent alors deux images ». Le
// raisonnement était écrit ; il s'arrêtait au `Dockerfile`. Pendant ce temps la forge lançait
// `postgres:16-alpine` en service et `postgrest/postgrest:v12.2.3` dans un `docker run`, tous deux
// sur une étiquette mobile (audit CODEX 5.6, 25/08).
//
// ⚠️ ET LA CONSÉQUENCE EST PIRE ICI QUE DANS LE DOCKERFILE. Ces deux images font tourner les bancs
// de BASE — contraintes, atomicité, migrations réelles. Une preuve produite contre un PostgreSQL
// qui n'est pas celui qu'on croit reste une preuve, mais plus personne ne sait de quoi.
//
// ⚠️ `v12.2.3` N'EST PAS UN ÉPINGLAGE. Une étiquette de version est une CONVENTION de son éditeur,
// pas une propriété du registre : rien n'empêche techniquement de la redéplacer. Le condensat, lui,
// n'est pas déplaçable — c'est le contenu. On garde l'étiquette à côté pour qu'un humain lise ce
// qu'il est censé lire, et la confrontation des deux vit là où elle vivait déjà : c'est le registre
// qui refuse de servir autre chose.
//
// ⚠️ CETTE SONDE NE LIT QUE DU YAML, ET C'EST UN CHOIX PAYÉ D'UN ÉCHEC. Le premier essai cherchait
// les images dans les blocs `run:` avec un motif sur `docker run`. Il a accusé trois emplacements :
// `host` (pris dans `--network host`), et deux images CONSTRUITES SUR PLACE, qui n'ont pas de
// registre et donc rien à épingler. Trois faux positifs sur trois trouvailles. Un bloc `run:` est
// du shell : dire « ceci est une image » y demande de réécrire la grammaire de `docker run`, et
// une sonde qui devine finit par accuser du code juste — le pire état d'une garde.
//
// D'où la règle du dépôt, qui est une règle d'ÉCRITURE avant d'être une règle de lecture :
// UNE IMAGE DE REGISTRE SE DÉCLARE EN YAML, jamais dans le corps d'une commande. Deux formes,
// les deux lues ici sans deviner :
//   - `services.<nom>.image:` et `container:` — le YAML natif des workflows ;
//   - une variable `env:` dont le NOM commence par `IMAGE_`, que la commande utilise par
//     `"$IMAGE_…"`. Le préfixe n'est pas décoratif : c'est lui qui rend la valeur trouvable.
//
// ⚠️ LA LIMITE, DITE EN CLAIR PLUTÔT QUE COUVERTE À MOITIÉ. Une image de registre écrite en dur
// dans un `run:` échappe à cette sonde. On ne la rattrape pas par un motif — on la rend inutile :
// la convention ci-dessus donne un endroit où l'écrire, et le second contrôle ci-dessous refuse
// qu'un `$IMAGE_…` soit utilisé sans être déclaré, pour que la convention ne s'applique pas
// seulement quand on y pense.
//
// Usage : node tools/images-des-workflows.mjs [.github/workflows]

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { parse } from "yaml";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const DOSSIER = ".github/workflows";

/** Un condensat, seul épinglage qui ne se redéplace pas. */
export const EPINGLEE = /@sha256:[0-9a-f]{64}$/;

/** Le nom qui rend une valeur `env:` trouvable comme image. */
export const PREFIXE_IMAGE = /^IMAGE_[A-Z0-9_]*$/;

/**
 * ⚠️ UNE EXPRESSION `${{ … }}` N'EST PAS ÉPINGLABLE ICI, et l'exiger serait une faute : la valeur
 * ne vit pas dans ce fichier, c'est l'appelant qui la décide. C'est à LUI qu'il faut la demander,
 * pas à cette ligne — la sonde la saute donc, et le compte des sautées est imprimé.
 */
export const differee = (reference) => reference.includes("${{");

/**
 * Les images qu'un workflow DÉCLARE, désignées par leur chemin YAML (pas par un numéro de ligne :
 * l'analyse rend un arbre, et un chemin reste juste quand le fichier bouge).
 */
export function imagesDeclarees(fichier, texte) {
  const w = parse(texte) || {};
  const trouvees = [];
  const envs = (ou, bloc) => {
    for (const [cle, valeur] of Object.entries(bloc || {})) {
      if (PREFIXE_IMAGE.test(cle) && typeof valeur === "string") trouvees.push({ ou: `${ou}.env.${cle}`, reference: valeur });
    }
  };
  envs(fichier, w.env);
  for (const [job, def] of Object.entries(w.jobs || {})) {
    const chemin = `${fichier} › ${job}`;
    envs(chemin, def?.env);
    const conteneur = typeof def?.container === "string" ? def.container : def?.container?.image;
    if (typeof conteneur === "string") trouvees.push({ ou: `${chemin}.container`, reference: conteneur });
    for (const [nom, svc] of Object.entries(def?.services || {})) {
      const image = typeof svc === "string" ? svc : svc?.image;
      if (typeof image === "string") trouvees.push({ ou: `${chemin}.services.${nom}`, reference: image });
    }
    (def?.steps || []).forEach((etape, i) => envs(`${chemin} › ${etape?.name || `étape ${i + 1}`}`, etape?.env));
  }
  return trouvees;
}

/** Les références déclarées qui ne portent pas de condensat. */
export const nonEpinglees = (images) =>
  images.filter((i) => !differee(i.reference) && !EPINGLEE.test(i.reference))
    .map((i) => `${i.ou} — « ${i.reference} » n'est pas épinglée : une étiquette se redéplace, un condensat non. Ajoutez @sha256:… en gardant l'étiquette à côté`);

/**
 * Les `$IMAGE_…` employés par une commande sans qu'aucun `env:` du fichier ne les déclare.
 *
 * ⚠️ CE CONTRÔLE EST CE QUI REND LA CONVENTION AUTO-PORTANTE. Sans lui, « déclarer l'image en
 * YAML » resterait une politesse : on écrirait `$IMAGE_ZAP` sans jamais le définir, la sonde
 * n'aurait rien à lire et rendrait vert. Ici la commande DÉSIGNE ce que le YAML doit contenir.
 */
export function utilisesNonDeclares(fichier, texte, declarees) {
  const w = parse(texte) || {};
  const connus = new Set(declarees.map((i) => i.ou.split(".env.")[1]).filter(Boolean));
  const manquants = new Set();
  for (const def of Object.values(w.jobs || {})) {
    for (const etape of def?.steps || []) {
      if (typeof etape?.run !== "string") continue;
      for (const [, nom] of etape.run.matchAll(/\$\{?(IMAGE_[A-Z0-9_]*)\b/g)) if (!connus.has(nom)) manquants.add(nom);
    }
  }
  return [...manquants].map((n) => `${fichier} — « $${n} » est utilisé par une commande mais aucun \`env:\` ne le déclare : l'image tirée serait alors invisible à toute relecture`);
}

/** Chaque workflow du dossier, avec son texte et ce qu'il déclare — le banc lit la même chose. */
export function lireDossier(dossier = DOSSIER) {
  return readdirSync(dossier)
    .filter((f) => /\.ya?ml$/.test(f))
    .sort()
    .map((fichier) => {
      const texte = readFileSync(join(dossier, fichier), "utf8");
      return { fichier, texte, images: imagesDeclarees(fichier, texte) };
    });
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const dossier = process.argv[2] || DOSSIER;
    const parFichier = lireDossier(dossier);
    if (!parFichier.length) {
      return inconclusif(`aucun workflow dans ${dossier} — la sonde vise à côté, et un vert ne prouverait rien`);
    }
    const toutes = parFichier.flatMap(({ images }) => images);
    // ⚠️ ZÉRO IMAGE EST UN AVERTISSEMENT, PAS UN SUCCÈS. Ce dépôt en déclare ; si la sonde n'en
    // trouve plus aucune, c'est qu'elle a cessé de lire — pas que la forge a cessé d'en tirer.
    if (!toutes.length) {
      return inconclusif(`aucune image déclarée relevée dans ${parFichier.length} workflow(s) — le dépôt en déclare, donc la sonde ne lit plus ce qu'elle croit lire`);
    }
    const soucis = [
      ...parFichier.flatMap(({ images }) => nonEpinglees(images)),
      ...parFichier.flatMap(({ fichier, texte, images }) => utilisesNonDeclares(fichier, texte, images)),
    ];
    if (soucis.length) return violation(soucis);
    const differees = toutes.filter((i) => differee(i.reference)).length;
    const reste = differees ? `, ${differees} laissée(s) à l'appelant (\${{ … }})` : "";
    return conforme(`images des workflows : ${toutes.length - differees} référence(s) déclarée(s) dans ${parFichier.length} fichier(s), toutes épinglées sur un condensat${reste}`);
  }));
}
