// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA VERSION DE NODE QUE L'IMAGE EMBARQUE, CONFRONTÉE À CELLE QU'`engines` AUTORISE.
//
// ⚠️ C'EST LA SECONDE MOITIÉ D'UNE PAIRE DONT LA PREMIÈRE EST GARDÉE DEPUIS LE 30/08.
// `node-des-workflows` confronte `engines` à ce que la FORGE installe. Rien ne le confrontait à ce
// que l'IMAGE embarque — et l'image est ce qu'un auto-hébergeur exécute vraiment, pas ce qui valide
// nos branches. Des deux exemplaires non mesurés, celui-ci était le plus proche de la production.
//
// ⚠️ TROIS GARDES TOUCHENT DÉJÀ CE FICHIER, ET AUCUNE NE POSE CETTE QUESTION. Relevé plutôt que
// supposé, le 31/08 :
//
//     images-epinglees   « chaque image vient-elle d'un condensat ? »   → épinglage, pas version
//     ecartMajeur        « l'étiquette dit-elle vrai sur le condensat ? » → les deux copies entre
//                          elles, jamais confrontées à `engines`
//     docker (job CI)    construit l'image et lui demande sa version    → alimente ecartMajeur
//
// Le jour où `engines` passera au-delà de 24, les trois resteront VERTES : l'image serait épinglée,
// son étiquette dirait vrai, et elle embarquerait un moteur que notre propre paquet déclare non
// supporté. Deux exemplaires cohérents entre eux ne disent rien du troisième fait qu'ils ignorent.
//
// ⚠️ ON NE RÉÉCRIT PAS DE LECTEUR DE DOCKERFILE. Celui de ce dépôt a déjà été aveugle une fois —
// il exigeait `FROM <image>` et ratait `FROM --platform=… <image>`, rendant « 0 référence » sur un
// fichier dont TOUS les FROM la portaient. Il est passé depuis à `dockerfile-ast`, et il a gagné
// deux portes de plus (`COPY --from`, `RUN --mount=from`). Cette garde IMPORTE ce lecteur au lieu
// d'en écrire un quatrième : la leçon de ce dépôt est qu'un lexeur maison finit aveugle, et un
// second exemplaire du même lecteur finirait divergent.
//
// ⚠️ LE PÉRIMÈTRE VIENT DU DISQUE, PAS D'UNE LISTE. `git ls-files` rend les Dockerfiles SUIVIS ;
// une liste écrite cesse de couvrir le jour où quelqu'un en ajoute un, et personne ne relit une
// liste en ajoutant un fichier. C'est la correction que la session STUDIO a apportée à sa propre
// garde le 31/08, et elle vaut ici mot pour mot.
//
// ⚠️ CE PÉRIMÈTRE VIT DANS `images-epinglees`, ET C'EST DÉLIBÉRÉ. Écrire cette garde a montré que
// l'autre en avait besoin — la sienne était une liste écrite dans `ci.yml`, sur la garde de
// sécurité qui exige l'épinglage. Deux exemplaires de « quels Dockerfiles existe-t-il ? »
// divergeraient ; il n'y en a donc qu'un, et il est chez la plus ancienne des deux gardes.
//
// ⚠️ ET LA RÈGLE EST UNE RELATION, PAS UN COMPTAGE. Toute image qui FOURNIT node doit dire
// laquelle. `FROM node@sha256:…` sans étiquette est parfaitement valide, parfaitement épinglé, et
// sa version est indéterminable : un comptage la verrait comme une image de plus, la relation la
// voit comme une dette. C'est la forme exacte de l'étape `setup-node` muette attrapée la veille.
//
// ⚠️ PORTÉE DE LA PREUVE, DITE PLUTÔT QUE TUE. Cette garde lit l'ÉTIQUETTE. Que l'étiquette
// corresponde au condensat est la question d'`ecartMajeur`, qui la tranche en exécutant l'image en
// CI — hors ligne, personne ne peut le savoir. Les deux gardes sont donc complémentaires et
// aucune ne subsume l'autre : celle-ci dit « 24 est-il permis ? », l'autre dit « est-ce vraiment
// 24 ? ». Il faut les deux pour conclure, et c'est écrit ici pour que retirer l'une se voie.
//
// Usage : node tools/node-de-l-image.mjs [Dockerfile...]

import { readFileSync } from "node:fs";

import semver from "semver";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";
import { froms, dockerfilesSuivis, ecartesDuPerimetre } from "./images-epinglees.mjs";
import { estUnPlancherSansPlafond } from "./node-des-workflows.mjs";

/**
 * L'image officielle de node, sous les formes qu'un registre accepte.
 *
 * ⚠️ Le périmètre est étroit ET DIT. Une image dérivée qui embarque node sans s'appeler `node`
 * (`cimg/node`, une base maison) n'entre pas dans ce relevé : sa version ne se lit pas dans son
 * nom. Élargir au jugé fabriquerait des faux positifs sur des images dont l'étiquette ne parle pas
 * de node du tout — et une garde qui crie faux finit desserrée par celui qu'elle a dérangé.
 */
const MOTIF_IMAGE_NODE = /^(?:docker\.io\/)?(?:library\/)?node(?::|@|$)/;

/**
 * ⚠️ UN PLANCHER À UN, ET C'EST DÉLIBÉRÉ. Le Dockerfile en porte DEUX aujourd'hui (construction et
 * exécution), et un plancher à deux serait collé au relevé du jour : fusionner les deux étages est
 * un ménage parfaitement sain, et la garde rougirait dessus. C'est le défaut que la session STUDIO
 * a trouvé chez elle le 31/08 — « une garde qui rougit sur un geste sain finit desserrée ».
 *
 * Un plancher à UN dit la seule chose qui soit vraie de tout état sain : ce dépôt publie une image
 * node, donc il en existe au moins une. En dessous, la sonde n'a pas lu.
 */
export const PLANCHER_IMAGES = 1;

/**
 * La portée semver que porte l'étiquette d'une image node, ou `null` si elle n'en porte pas.
 *
 * `node:24-alpine` → « 24 » ; `node:22.13.0-slim` → « 22.13.0 » ; `node:alpine` → null.
 */
export function porteeDeLEtiquette(reference) {
  const sansCondensat = String(reference).split("@")[0];
  const etiquette = sansCondensat.includes(":") ? sansCondensat.slice(sansCondensat.indexOf(":") + 1) : "";
  if (!etiquette) return null;
  const tete = etiquette.split("-")[0];
  return semver.validRange(tete) ? tete : null;
}

/** Les images qui fournissent node dans un Dockerfile, avec ce que leur étiquette annonce. */
export function imagesNodeDe(txt, fichier = "Dockerfile") {
  return froms(txt)
    .filter((f) => !f.interne && MOTIF_IMAGE_NODE.test(String(f.reference)))
    .map((f) => ({
      fichier,
      ligne: f.ligne,
      reference: String(f.reference),
      // ⚠️ DEUX ABSENCES DIFFÉRENTES, ET LES CONFONDRE SERAIT LA FAUTE. Pas d'étiquette du tout =
      // rien n'est déclaré, c'est une VIOLATION du dépôt. Une étiquette que semver ne lit pas
      // (`node:alpine`, `node:lts`) = quelque chose est déclaré et la garde ne sait pas le lire,
      // c'est NON CONCLUANT. Même séparation que pour `lts/*` dans les workflows.
      etiquetee: String(f.reference).split("@")[0].includes(":"),
      portee: porteeDeLEtiquette(f.reference),
    }));
}

/** Tout ce que les Dockerfiles suivis embarquent comme node. */
export function imagesNodeDuDepot(fichiers = dockerfilesSuivis()) {
  return fichiers.flatMap((f) => imagesNodeDe(readFileSync(f, "utf8"), f));
}

/** Le verdict, séparé de la lecture du disque pour que le banc l'éprouve sur des relevés fabriqués. */
export function verdict({ engines, images }) {
  if (typeof engines !== "string" || !engines.trim()) {
    return inconclusif("package.json ne déclare pas engines.node — il n'y a rien à quoi confronter l'image");
  }
  if (!semver.validRange(engines)) {
    return inconclusif(`engines.node vaut « ${engines} », que semver ne sait pas lire — on refuse plutôt que de comparer au jugé`);
  }
  if (images.length < PLANCHER_IMAGES) {
    return inconclusif(`aucune image node relevée dans les Dockerfiles suivis (plancher ${PLANCHER_IMAGES}) — la règle serait vraie pour n'avoir rien lu`);
  }

  // ⚠️ LA RELATION D'ABORD : une image qui ne DIT pas sa version ne peut pas être comparée, et la
  // taire reviendrait à conclure sur un sous-ensemble sans le dire.
  const muettes = images.filter((i) => !i.etiquetee).map((i) =>
    `${i.fichier}:${i.ligne} : « ${i.reference} » fournit node sans étiquette de version — le condensat fait foi pour Docker, mais plus personne, ni humain ni garde, ne peut dire quelle version tourne`);
  if (muettes.length) return violation(muettes);

  const illisibles = images.filter((i) => i.portee === null).map((i) =>
    `${i.fichier}:${i.ligne} : l'étiquette de « ${i.reference} » ne porte pas de version que semver sache lire — cette image n'est donc pas confrontée à engines, et une garde qui saute ce qu'elle ne lit pas est verte pour de mauvaises raisons`);
  if (illisibles.length) return inconclusif(illisibles);

  if (!estUnPlancherSansPlafond(engines)) {
    return inconclusif(`engines.node vaut « ${engines} », qui porte un PLAFOND — le raisonnement de cette garde n'est exact que sous un plancher sans plafond ; lisez la paire à la main, ou étendez cette garde au régime borné`);
  }

  const constats = images
    .filter((i) => !semver.intersects(i.portee, engines))
    .map((i) => `${i.fichier}:${i.ligne} : l'image embarque node ${i.portee}, qu'engines.node « ${engines} » n'admet pas — c'est ce qu'un auto-hébergeur EXÉCUTE, pas seulement ce que la CI valide`);
  if (constats.length) return violation(constats);

  const bas = semver.minVersion(engines).version;
  return conforme(
    `node de l'image : ${images.length} image(s) node dans ${new Set(images.map((i) => i.fichier)).size} Dockerfile(s) suivi(s), toutes étiquetées et admises par engines.node « ${engines} » (plancher ${bas}) — portées relevées : ${[...new Set(images.map((i) => i.portee))].sort().join(", ")}`,
  );
}

export function garde(fichiers, racine = ".") {
  return tenter(() => {
    let paquet;
    try {
      paquet = JSON.parse(readFileSync(`${racine}/package.json`, "utf8"));
    } catch (e) {
      return inconclusif(`package.json est illisible (${e.message}) — la sonde vise à côté`);
    }
    const r = verdict({ engines: paquet?.engines?.node, images: imagesNodeDuDepot(fichiers || dockerfilesSuivis()) });
    // ⚠️ L'AVERTISSEMENT N'ÉCHOUE PAS, ET C'EST VOULU : écarter `Dockerfile.md` est presque
    // toujours juste. Presque. Le dire coûte une ligne de journal ; le taire coûterait un
    // Dockerfile invisible dont personne ne saurait jamais qu'il l'est.
    const ecartes = fichiers ? [] : ecartesDuPerimetre();
    return ecartes.length
      ? { ...r, avertissements: [...(r.avertissements || []), `écarté du périmètre comme document : ${ecartes.join(", ")} — si l'un d'eux est un vrai Dockerfile, renommez-le`] }
      : r;
  });
}

if (estExecuteDirectement(import.meta.url)) {
  const args = process.argv.slice(2);
  conclure(garde(args.length ? args : undefined));
}
