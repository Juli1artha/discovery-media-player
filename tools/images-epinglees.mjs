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
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { readFileSync } from "node:fs";

import { estExecuteDirectement } from "./execute-directement.mjs";

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
    trouvees.push({ reference: depuis, alias: null, source: "COPY --from", interne: estInterne(depuis, etapes) });
  }

  // ⚠️ TROISIÈME PORTE : `RUN --mount=type=bind,from=<image>`.
  //
  // Cette garde lisait `FROM` puis `COPY --from`, et l'audit du 22/08 a montré qu'elle laissait
  // passer celle-ci sans un mot :
  //
  //     RUN --mount=type=bind,from=nginx:latest,source=/etc,target=/src true
  //
  // `from` y accepte exactement les mêmes trois choses qu'un `COPY --from` — une étape, un index
  // d'étape, ou une image du registre. Une image montée pendant un `RUN` s'exécute contre le
  // système de fichiers de la construction : elle fournit des octets qui finissent dans l'artefact,
  // et elle n'était épinglée par rien.
  //
  // C'est la deuxième fois qu'on ajoute une porte à cette garde. La leçon écrite en #288 tenait
  // déjà : « une dépendance qui entre par une autre porte reste une dépendance » — elle nommait
  // `COPY --from`, et celle-ci existait déjà.
  for (const inst of doc.getInstructions()) {
    if (inst.getKeyword() !== "RUN") continue;
    for (const flag of inst.getFlags?.() || []) {
      if (flag.getName() !== "mount") continue;
      const depuis = sourceDuMontage(flag.getValue());
      if (!depuis) continue;
      trouvees.push({ reference: depuis, alias: null, source: "RUN --mount=from", interne: estInterne(depuis, etapes) });
    }
  }
  return trouvees;
}

/**
 * `--from=X` désigne une étape (`build`), un index d'étape (`0`), ou une image du registre.
 * Seule la dernière est une dépendance à épingler.
 */
const estInterne = (reference, etapes) => etapes.has(reference.toLowerCase()) || /^\d+$/.test(reference);

/**
 * Le `from=` d'un `--mount`, ou `null`. La valeur du drapeau est une liste `clé=valeur` séparée
 * par des virgules — `type=bind,from=nginx:latest,source=/etc`. Un montage de cache, de secret ou
 * de tmpfs n'a pas de `from=` : il ne fait entrer aucune image, et il n'y a rien à reprocher.
 */
export function sourceDuMontage(valeur) {
  for (const morceau of String(valeur || "").split(",")) {
    const i = morceau.indexOf("=");
    if (i < 0) continue;
    // ⚠️ On ne coupe qu'au PREMIER `=` : une référence peut en contenir un (un condensat, non,
    // mais une valeur de montage voisine oui) et couper partout tronquerait la référence.
    if (morceau.slice(0, i).trim() !== "from") continue;
    return morceau.slice(i + 1).trim() || null;
  }
  return null;
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

if (estExecuteDirectement(import.meta.url)) {
  const fichiers = process.argv.slice(2).length ? process.argv.slice(2) : ["Dockerfile"];
  // ⚠️ `tenter` : un Dockerfile absent ou illisible ne dit rien de l'épinglage. Il sortait 1, avec
  // une trace de pile ENOENT en guise de verdict.
  conclure(tenter(() => {
    const textes = fichiers.map((f) => [f, readFileSync(f, "utf8")]);
    const externes = textes.flatMap(([, t]) => imagesDe(t)).filter((i) => !i.interne);

    // ⚠️ ZÉRO IMAGE N'EST PAS UN SUCCÈS — et ce n'est pas une violation non plus. C'est ce que
    // rendait la version précédente sur un Dockerfile dont tous les `FROM` portaient `--platform` :
    // « 0 référence(s), toutes épinglées ». Verte, vide, muette sur les deux. Le fichier n'est pas
    // fautif : c'est la sonde qui ne l'a pas lu.
    if (!externes.length) {
      return inconclusif(`aucune image externe trouvée dans ${fichiers.join(", ")} — la sonde vise à côté, ou le fichier n'est pas celui qu'on croit`);
    }
    const soucis = textes.flatMap(([f, t]) => ecartsEpinglage(t, f));
    if (soucis.length) return violation(soucis);
    return conforme(`images de base : ${externes.length} référence(s) externe(s), toutes épinglées sur un condensat`);
  }));
}
