// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUE LES EXEMPLES ONT LE DROIT D'ÉPINGLER — UNE RÈGLE, AU LIEU DE DEUX QUI SE CONTREDISENT.
//
// ⚠️ CETTE GARDE ÉTAIT ROUGE DANS L'ÉTAT NORMAL DU DÉPÔT, ET ÇA LUI A COÛTÉ UNE PR (#273, 21/08).
//
// Elle acceptait « la version de main OU la dernière publiée ». Les deux valent la même chose dès
// que la sortie est faite — donc, à la seconde où la 0.1.126 est partie sur npm, les exemples
// restés sur 0.1.125 n'étaient plus ni l'une ni l'autre. Rouge sur main, rouge sur chaque PR
// ouverte, rouge sur les suivantes. Pas un oubli isolé : L'ÉTAT QUI SUIT CHAQUE SORTIE.
//
// Le commentaire de ci.yml disait pourtant, en toutes lettres, que les exemples « se montent tout
// seuls à la sortie suivante » et que « leur retard d'une version est la propriété recherchée ».
// La garde, elle, refusait exactement ce retard-là. Le texte et le contrôle disaient le contraire,
// et c'est le contrôle qui gagne — deux personnes ont trébuché sur cette marche dans la même heure,
// et chacune l'a réparée dans une PR qui parlait d'autre chose (#273 et #276 portaient le même
// correctif de trois lignes ; l'une est morte vide).
//
// ⚠️ UNE ALERTE QUI SE DÉCLENCHE QUAND TOUT VA BIEN APPREND À PASSER OUTRE, et le jour où elle a
// raison, personne ne la lit. C'est le pire état possible pour une garde — pire que son absence,
// qui est au moins un état connu.
//
// LA RÈGLE, MAINTENANT : UN EXEMPLE ÉPINGLE L'UNE DES DEUX DERNIÈRES VERSIONS PUBLIÉES.
//
// Elle remplace les deux anciennes et les contient toutes les deux :
//
//   1. PR de sortie (main dit N+1, npm sert N, exemples sur N)  → N est la dernière publiée   → vert
//   2. PR de sortie, exemples montés à N+1 (le piège de #269)   → N+1 n'est pas encore servie → ROUGE
//   3. état stable après publication (main = npm = N, ex. = N)  → N est la dernière publiée   → vert
//   4. ⭐ après publication de N, exemples encore sur N-1        → l'avant-dernière            → vert
//   5. exemple oublié loin derrière (N-5)                       → ni l'une ni l'autre         → ROUGE
//
// Le cas 4 est le seul qui change, et c'est celui qui rougissait à chaque sortie. Le retard d'une
// version cesse d'être toléré dans une fenêtre et interdit dans l'autre : il est simplement LÉGAL,
// comme le commentaire l'affirmait déjà. Deux versions de retard restent rouges — ce que la garde
// protège (« un intégrateur qui copie reçoit un player périmé ») est intact.
//
// ⚠️ CETTE GARDE DÉPEND DE L'INSTANT OÙ ELLE TOURNE, ET IL FAUT LE SAVOIR. Elle compare les
// exemples au REGISTRE VIVANT, pas au contenu de la branche. Une PR ouverte à travers deux sorties
// rougit donc sans que son auteur ait touché à quoi que ce soit — constaté ce soir sur deux PR,
// pendant que 0.1.127 puis 0.1.128 partaient.
//
// Ce n'est PAS un défaut : fusionner cette branche telle quelle laisserait `main` deux versions en
// arrière, donc le refus est juste. Et ce dépôt exige déjà qu'une branche soit à jour avant de
// fusionner : la garde ne fait que le dire plus tôt, avec un message qui nomme les deux versions
// permises. Le geste est le même — reprendre `main`.
//
// ⚠️ ON DEMANDE AU REGISTRE, PAS AU DÉPÔT. C'est ce que npm SERT qui compte : un exemple épingle
// ce qu'un copieur peut installer. La version de `package.json` n'entre pas dans la règle — si elle
// n'est pas encore publiée, l'épingler casserait le déploiement de la démo, qui installe depuis npm.
//
// ⚠️ REGISTRE INJOIGNABLE ⇒ ON RESSERRE, ON N'ÉLARGIT PAS. Ne pas savoir ne doit jamais autoriser
// davantage : on retombe sur la seule version que main déclare.
//
// Usage : node tools/exemples-epingles.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** Une version STABLE : trois nombres, rien d'autre. `0.2.0-beta.1` n'en est pas une. */
export const estStable = (v) => /^\d+\.\d+\.\d+$/.test(String(v).trim());

/**
 * Compare deux versions x.y.z numériquement — « 0.1.9 » est AVANT « 0.1.10 », pas après.
 *
 * ⚠️ IL NE COMPARE QUE DES VERSIONS STABLES, ET C'EST POURQUOI `acceptables` LES FILTRE D'ABORD
 * (revue externe, 21/08). `"0.2.0-beta.1".split(".")` rend `["0","2","0-beta","1"]`, dont
 * `Number("0-beta")` vaut NaN : toute comparaison devient fausse, et le tri prend un ordre
 * indéfini. Le dépôt n'a jamais publié de préversion — mais une garde qui se casse à la première
 * n'attend pas qu'on le lui dise, elle attend qu'on la lise.
 */
export function comparerVersions(a, b) {
  const na = String(a).split(".").map(Number), nb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] || 0) - (nb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Les versions qu'un exemple a le droit d'épingler : les DEUX dernières servies par le registre.
 * Sans registre, la seule que main déclare — ne pas savoir ne doit pas élargir ce qu'on autorise.
 */
export function acceptables(versionDeMain, publiees) {
  // ⚠️ LES PRÉVERSIONS NE COMPTENT PAS. Un exemple est ce qu'un intégrateur RECOPIE : il l'installe
  // et attend que ça marche. `0.2.0-beta.2` n'est pas ce qu'on lui propose, et deux bêta publiées
  // à la suite deviendraient « les deux dernières » — la garde recommanderait alors une version
  // que personne ne devrait épingler.
  const stables = (publiees || []).filter(estStable);
  // ⚠️ Ce repli rendait `[versionDeMain]`, c'est-à-dire une version dont personne n'a dit qu'elle
  // était servie. Même raison que ci-dessus : on ne fabrique pas une réponse à partir de rien.
  if (!stables.length) {
    throw new Error("aucune version stable servie — il n'y a pas de version acceptable à nommer");
  }
  return [...stables].sort(comparerVersions).slice(-2).reverse();
}

/**
 * ⚠️ LE REGISTRE A-T-IL NOMMÉ UNE VERSION STABLE ? SANS ÇA, CETTE GARDE N'ÉTABLIT RIEN.
 *
 * Sa propriété est « les exemples épinglent une version que npm SERT ». Une panne du registre ne la
 * dégrade pas : elle la rend inaccessible. Le repli précédent — exiger la version de `main` — était
 * un proxy pour une AUTRE propriété, et un mauvais : `main` déclare régulièrement une version pas
 * encore publiée. C'est même exactement ce que `publication.yml` surveille toutes les heures.
 *
 * ⚠️ ET LA BONNE RÉPONSE ÉTAIT DÉJÀ ÉCRITE À CÔTÉ. `release-preflight.mjs` refuse de conclure sans
 * registre depuis le premier jour, et son commentaire nomme ce repli-ci comme « le pire des
 * choix ». Deux exemplaires du même raisonnement, dont un seul avait raison — la situation que ce
 * dépôt passe son temps à interdire ailleurs (P1, audit externe du 22/08).
 *
 * Une préversion ne compte pas non plus : un registre qui ne sert que des bêta ne sert aucune
 * version épinglable, donc il n'y a rien à confronter.
 */
export const registreExploitable = (publiees) => (publiees || []).some(estStable);

export function ecartsExemples(versionDeMain, publiees, exemples) {
  // ⚠️ ON LÈVE PLUTÔT QUE DE RENDRE `[]`. Un tableau vide se lit « aucun écart », c'est-à-dire une
  // conclusion — la conclusion précisément qu'on n'a pas le droit de tirer. C'est ce que rendait la
  // version précédente, et un banc l'avait figé.
  if (!registreExploitable(publiees)) {
    throw new Error("le registre n'a nommé aucune version stable — « les exemples épinglent une version servie » ne peut pas être établi, et exiger la version de main répondrait à une autre question");
  }
  const permises = acceptables(versionDeMain, publiees);
  return exemples
    .filter((e) => !permises.includes(e.version))
    .map((e) => `${e.fichier} épingle ${e.version}, qui n'est ni la dernière publiée (${permises[0]}) ni celle d'avant (${permises[1] ?? "—"}). `
      + (comparerVersions(e.version, permises[0]) > 0
        ? "Elle n'est pas encore SERVIE : le déploiement de la démo installe depuis npm et échouerait. Laissez les exemples sur une version publiée."
        : "Un copieur recevrait un player périmé."));
}

/**
 * ⚠️ UNE GARDE QUI NE PEUT PAS SAVOIR NE DOIT JAMAIS ÊTRE PLUS STRICTE QUE CELLE QUI SAIT.
 *
 * C'est la règle que ce fichier posait sans la nommer, et l'avoir laissée implicite a produit une
 * divergence (relevé du 24/08, pendant la sortie de la 0.1.131).
 *
 * Deux gardes répondent à « un exemple épingle-t-il une version installable ? ». Celle-ci, en
 * forge, interroge le REGISTRE — elle sait. Les bancs, hors ligne, lisent le CHANGELOG — ils ne
 * savent pas si la section la plus récente est déjà servie. Or pendant toute PR de sortie, `main`
 * documente N+1 que npm ne sert pas encore.
 *
 *   fenêtre en ligne (vérité)   : {N, N-1}      ← ce que npm sert
 *   fenêtre du CHANGELOG        : {N+1, N}      ← ce que le dépôt documente
 *
 * Les bancs refusaient donc N-1, que la garde en forge ACCEPTE. Deux réponses à une question,
 * et la plus stricte venait de celle qui en savait le moins. C'est ce qui a fait rougir la PR de
 * sortie sur des exemples parfaitement légaux — l'alerte qui sonne quand tout va bien, encore.
 *
 * ⚠️ LE REMÈDE N'EST PAS DE DEVINER. Aucun signal local ne dit si la tête du CHANGELOG est publiée :
 * `package.json` la déclare dans les deux cas, et les tags peuvent manquer d'un clone superficiel.
 * Ce qu'on sait avec CERTITUDE, c'est que la fenêtre réelle est soit {v0, v1}, soit {v1, v2} — selon
 * que la tête est publiée ou non. Leur UNION, {v0, v1, v2}, contient donc la vérité dans les deux
 * cas, quoi qu'il arrive.
 *
 * Le banc est alors délibérément PLUS LARGE que la forge : il ne peut plus contredire la garde qui
 * sait, et il attrape quand même le vrai retard (N-3 et au-delà). Le verdict fin reste en forge,
 * là où le réseau est légitime.
 */
export function fenetreHorsLigne(versionsDocumentees) {
  const stables = (versionsDocumentees || []).filter(estStable);
  // ⚠️ ANTI-VACUITÉ : sans versions lues, « hors fenêtre » serait vide pour tout le monde et le
  // banc conclurait au vert sans avoir rien mesuré.
  if (stables.length < 2) {
    throw new Error("moins de deux versions documentées — la fenêtre hors ligne ne peut pas être établie");
  }
  return stables.slice(0, 3);
}

/** Les versions que le CHANGELOG documente, de la plus récente à la plus ancienne. */
export const versionsDuChangelog = (texte) =>
  [...String(texte).matchAll(/^## \[(\d+\.\d+\.\d+)\]/gm)].map((m) => m[1]);

/**
 * Les exemples hors d'une fenêtre donnée. ⚠️ UN SEUL EXEMPLAIRE DE CE CALCUL : les deux bancs le
 * réécrivaient chacun de leur côté, avec des commentaires presque identiques — c'est-à-dire deux
 * copies de plus de la même règle, dans un dépôt qui interdit la deuxième.
 */
export const horsFenetre = (exemples, fenetre) =>
  (exemples || [])
    .filter((e) => !fenetre.includes(e.version))
    .map((e) => `${e.fichier} épingle ${e.version}, hors de la fenêtre (${fenetre.join(", ")})`);

export function exemplesDuDepot(racine = ".") {
  const dossier = join(racine, "examples");
  if (!existsSync(dossier)) return [];
  const trouves = [];
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const p = join(dossier, e.name, "package.json");
    if (!e.isDirectory() || !existsSync(p)) continue;
    const dep = JSON.parse(readFileSync(p, "utf8")).dependencies?.["discovery-media-player"];
    if (dep) trouves.push({ fichier: `examples/${e.name}/package.json`, version: dep });
  }
  return trouves;
}

export function versionsPubliees(executer = () =>
  execFileSync("npm", ["view", "discovery-media-player", "versions", "--json"], { encoding: "utf8", timeout: 60000 })) {
  try {
    const brut = JSON.parse(executer());
    return Array.isArray(brut) ? brut : [brut];
  } catch {
    return null;
  }
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    const exemples = exemplesDuDepot();
    if (!exemples.length) return inconclusif("aucun exemple relevé — la sonde vise à côté");

    // ⚠️ CE CONSTAT-LÀ NE DÉPEND PAS DU REGISTRE, donc il se tient même quand rien d'autre ne se
    // tient : un exemple qui ne déclare pas son moteur se copie sur une machine où il ne tourne pas.
    // Il est relevé AVANT l'interrogation de npm pour que la panne du registre ne l'emporte pas.
    const soucis = [];
    if (!readFileSync("examples/demo/package.json", "utf8").includes('">=22"')) {
      soucis.push("examples/demo/package.json ne déclare pas node >=22");
    }

    const publiees = versionsPubliees();
    if (!registreExploitable(publiees)) {
      const raison = "le registre n'a nommé aucune version stable — « les exemples épinglent une version servie » n'a pas pu être vérifié ; exiger la version de main répondrait à une AUTRE question, et `main` déclare régulièrement une version pas encore publiée";
      // Une violation qu'on a pu établir l'emporte sur ce qu'on n'a pas pu regarder : elle, elle
      // est vraie. Le reste part en non-concluant, jamais en vert.
      return soucis.length ? violation(soucis, [raison]) : inconclusif(raison);
    }

    soucis.push(...ecartsExemples(version, publiees, exemples));
    if (soucis.length) return violation(soucis);

    const permises = acceptables(version, publiees);
    return conforme(`exemples : ${exemples.length} sur ${permises.join(" ou ")} — servies par le registre, donc installables`);
  }));
}
