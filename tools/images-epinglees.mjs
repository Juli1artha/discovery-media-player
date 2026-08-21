// L'IMAGE DE BASE EST UNE DÉPENDANCE — ET LES DÉPENDANCES S'ÉPINGLENT.
//
// ⚠️ CE DÉPÔT EXIGEAIT DÉJÀ CETTE RÈGLE, POUR LES ACTIONS SEULEMENT. `ci.yml` refuse depuis
// longtemps `uses: machin@v3` : une étiquette mobile est un contrat que quelqu'un d'autre peut
// réécrire après coup, et une action réécrite s'exécute avec nos droits. La même phrase vaut mot
// pour mot pour `FROM node:24-alpine` — l'étiquette `24-alpine` désigne une image différente
// chaque semaine — et pourtant rien ne la vérifiait (P1, audit externe, 21/08).
//
// La conséquence n'est pas théorique. Deux constructions du MÊME commit produisaient deux images
// différentes : celle qu'on a éprouvée en CI et celle qu'un auto-hébergeur obtient en
// reconstruisant trois semaines plus tard. Aucune des deux n'est fausse, et c'est bien le
// problème — rien ne dit laquelle tourne.
//
// ⚠️ ON GARDE L'ÉTIQUETTE À CÔTÉ DU CONDENSAT, ET CE N'EST PAS DE LA DÉCORATION.
// `node:24-alpine@sha256:…` : le condensat fait foi pour Docker, l'étiquette dit à un humain ce
// qu'il est censé lire. Un condensat nu est illisible — personne ne relit une PR qui remplace
// soixante-quatre caractères par soixante-quatre autres. Mais l'étiquette devient alors un SECOND
// EXEMPLAIRE d'un fait, et ce dépôt sait ce que deviennent les exemplaires non confrontés : ils
// divergent. La confrontation existe, elle est ailleurs — le job `docker` de la CI construit
// l'image puis lui demande sa version de Node, et la compare à la majeure écrite ici. Le
// commentaire ne suffirait pas.
//
// Usage : node tools/images-epinglees.mjs [Dockerfile...]

import { DockerfileParser } from "dockerfile-ast";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

/**
 * Les images EXTERNES d'un Dockerfile — celles qui viennent d'un registre.
 *
 * ⚠️ CETTE GARDE LISAIT LE DOCKERFILE À LA LIGNE, ET ELLE ÉTAIT AVEUGLE (revue externe, 21/08).
 * Son motif exigeait `FROM <image> [AS <nom>]` et rien d'autre. Or ceci est la syntaxe OFFICIELLE :
 *
 *     FROM --platform=$BUILDPLATFORM node:24-alpine AS build
 *
 * Elle ne voyait pas cette ligne. Sur un Dockerfile dont TOUS les `FROM` portent `--platform`,
 * elle rendait « 0 référence(s), toutes épinglées sur un condensat » et sortait 0 — constaté.
 * UNE GARDE QUI DÉCLARE LA VICTOIRE SUR ZÉRO est le pire cas possible : elle est verte, elle est
 * vide, et rien ne le dit. Mes cinq autres outils refusent quand la sonde ne trouve rien ; celui-ci
 * était le seul où je l'avais oublié.
 *
 * ⚠️ ELLE IGNORAIT AUSSI `COPY --from=nginx:latest`, qui fait entrer une image du registre dans
 * l'artefact final aussi sûrement qu'un `FROM`. Une dépendance qui entre par une autre porte reste
 * une dépendance.
 *
 * La lecture passe donc par un vrai analyseur de Dockerfile, pour la même raison que les workflows
 * sont passés à un analyseur YAML : c'est le troisième lecteur maison de ce dépôt qui échoue.
 */
export function imagesDe(txt) {
  const doc = DockerfileParser.parse(txt);
  const etapes = new Set();
  const trouvees = [];

  for (const from of doc.getFROMs()) {
    const reference = from.getImage();
    const alias = from.getBuildStage();
    if (reference) {
      trouvees.push({ reference, alias, source: "FROM", interne: etapes.has(reference.toLowerCase()) });
    }
    if (alias) etapes.add(alias.toLowerCase());
  }

  for (const copy of doc.getCOPYs()) {
    const depuis = copy.getFromFlag()?.getValue();
    if (!depuis) continue;
    // `COPY --from=build` désigne une étape ; `COPY --from=0` un index d'étape. Ni l'un ni
    // l'autre ne vient d'un registre.
    const interne = etapes.has(depuis.toLowerCase()) || /^\d+$/.test(depuis);
    trouvees.push({ reference: depuis, alias: null, source: "COPY --from", interne });
  }
  return trouvees;
}

/** Rétro-compatible : les `FROM` seuls, tels que la garde les nommait avant. */
export const froms = (txt) => imagesDe(txt).filter((i) => i.source === "FROM");

const CONDENSAT = /@sha256:[0-9a-f]{64}$/;

/** Une référence de registre sans condensat désigne une image différente chaque semaine. */
export function ecartsEpinglage(txt, fichier = "Dockerfile") {
  return imagesDe(txt)
    .filter((i) => !i.interne && !CONDENSAT.test(i.reference))
    .map((i) => `${fichier} : « ${i.source} ${i.reference} » n'est pas épinglé — ajoutez @sha256:… (la même règle que pour les actions)`);
}

/**
 * La MAJEURE que l'étiquette annonce, pour la confronter à ce que l'image contient vraiment.
 * `node:24-alpine@sha256:…` → 24. Rend `null` si l'étiquette ne nomme pas de majeure : on ne
 * fabrique pas une vérification à partir de rien.
 */
export function majeurAnnonce(reference) {
  const m = /^node:(\d+)[.-]/.exec(reference) || /^node:(\d+)$/.exec(reference);
  return m ? Number(m[1]) : null;
}

/** La majeure attendue pour l'image finale — la DERNIÈRE étape est celle qui s'exécute. */
export function majeurAttendu(txt) {
  const externes = froms(txt).filter((f) => !f.interne);
  for (let i = externes.length - 1; i >= 0; i--) {
    const m = majeurAnnonce(externes[i].reference);
    if (m !== null) return m;
  }
  return null;
}

/**
 * ⚠️ L'ÉTIQUETTE MENT-ELLE ? C'est la question que le condensat rend possible et nécessaire :
 * `node:24-alpine@sha256:…` où le condensat pointe une image Node 26 est parfaitement valide pour
 * Docker, se construit, passe tous les tests — et raconte faux à tout relecteur. Le job `docker`
 * de la CI passe ici la version que l'image RÉPOND (`node --version`).
 */
export function ecartMajeur(txt, versionObservee) {
  const attendu = majeurAttendu(txt);
  if (attendu === null) return null;
  const m = /^v?(\d+)\./.exec(String(versionObservee).trim());
  if (!m) return `l'image n'a pas rendu de version de Node lisible (« ${versionObservee} »)`;
  if (Number(m[1]) !== attendu) {
    return `l'image embarque Node ${m[1]}, mais le Dockerfile annonce ${attendu} dans son étiquette — le condensat et l'étiquette ne désignent pas la même chose`;
  }
  return null;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fichiers = process.argv.slice(2).length ? process.argv.slice(2) : ["Dockerfile"];
  const externes = fichiers.flatMap((f) => imagesDe(readFileSync(f, "utf8"))).filter((i) => !i.interne);

  // ⚠️ ZÉRO IMAGE N'EST PAS UN SUCCÈS. C'est ce que rendait la version précédente sur un
  // Dockerfile dont tous les `FROM` portaient `--platform` : « 0 référence(s), toutes épinglées ».
  // Une garde qui déclare la victoire sur rien est verte, vide, et muette sur les deux.
  if (!externes.length) {
    console.error(`::error::aucune image externe trouvée dans ${fichiers.join(", ")} — la sonde vise à côté, ou le fichier n'est pas celui qu'on croit`);
    process.exit(1);
  }
  const soucis = fichiers.flatMap((f) => ecartsEpinglage(readFileSync(f, "utf8"), f));
  if (soucis.length) {
    for (const s of soucis) console.error("::error::" + s);
    process.exit(1);
  }
  console.log(`images de base : ${externes.length} référence(s) externe(s), toutes épinglées sur un condensat`);
}
