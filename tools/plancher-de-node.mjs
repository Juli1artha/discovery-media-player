// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE PLANCHER DE NODE QU'ON DÉCLARE, CONFRONTÉ À CELUI QU'ON EXIGE VRAIMENT.
//
// ⚠️ CE QUI A ÉTÉ MESURÉ LE 25/08. `package.json` annonçait `engines: { node: ">=22" }`. Sa seule
// dépendance de PRODUCTION, `pdfjs-dist@6.2.108` — le moteur qui rend les documents — exige
// `>=22.13.0 || >=24`. Entre node 22.0 et 22.12, notre paquet déclare donc que tout va bien et
// fait tourner son moteur de rendu sur une version que ce moteur déclare non supportée.
//
// ⚠️ ET NPM N'ARRÊTE RIEN. `engine-strict` vaut `false` par défaut : npm émet un `EBADENGINE` dans
// le bruit de l'installation, puis installe. L'auto-hébergeur n'a que notre déclaration pour se
// décider, et notre déclaration était plus permissive que la réalité.
//
// ⚠️ LA CI NE POUVAIT PAS LE VOIR, et c'est le vrai motif de cette garde. `node-version: "22"`
// résout au DERNIER 22.x : la CI atterrit toujours au-dessus du plancher, quel qu'il soit. Une
// règle que l'environnement de vérification satisfait par construction n'est pas vérifiée — elle
// est supposée. C'est la même forme que les deux exemplaires non confrontés du Dockerfile
// (`images-epinglees`) et de l'étiquette des actions (`actions-versions`) : deux copies d'un même
// fait, dont une seule est lue.
//
// ⚠️ DEUX PLANCHERS, PAS UN. Celui de PRODUCTION est ce que `engines` doit dire — un auto-hébergeur
// ne reçoit ni `jsdom` ni `rolldown`. Celui de DÉVELOPPEMENT est plus haut (`jsdom` exige
// `^22.22.2 || ^24.15.0 || >=26.0.0`) et n'a rien à faire dans `engines` : il ne concerne que qui
// clone le dépôt. Les confondre rendrait `engines` faussement strict, ce qui écarterait des hôtes
// que le paquet sert très bien.
//
// ⚠️ ON NE LIT NI `node_modules` NI LE RÉSEAU. Tout vient de `package-lock.json`, qui porte déjà
// `engines` et le drapeau `dev` de chaque entrée : la garde conclut avant même `npm ci`, hors
// ligne, et sur ce qui sera RÉELLEMENT installé plutôt que sur ce qui traîne dans un dossier.
// La leçon vient du poste d'un hôte, le 25/08 : son `node_modules` datait d'il y a 32 versions, et
// tout ce qui s'appuyait dessus mesurait un autre dépôt que le sien.
//
// ⚠️ ET ON NE COMPARE PAS DES INTERVALLES À LA MAIN. `semver.subset` répond exactement à la
// question posée — « toute version que NOUS admettons est-elle admise par la dépendance ? ». Un
// analyseur d'intervalles écrit ici serait le troisième lexer de ce dépôt, après celui des `uses:`
// et celui des `FROM` ; les deux premiers ont été aveugles, chacun à sa façon.
//
// Usage : node tools/plancher-de-node.mjs

import { readFileSync } from "node:fs";

import semver from "semver";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** Le document où le plancher de développement est écrit pour qui clone le dépôt. */
export const OU_EST_ECRIT_LE_PLANCHER_DEV = "CONTRIBUTING.md";

/**
 * Ce que les paquets du verrou exigent de Node.
 *
 * ⚠️ `production: true` retient les entrées SANS le drapeau `dev` — celles qu'un `npm i` d'un
 * auto-hébergeur installe. `false` les prend toutes : c'est ce que reçoit qui clone.
 *
 * ⚠️ UNE PORTÉE NON LISIBLE N'EST PAS SAUTÉE EN SILENCE. `engines.node` est presque toujours une
 * chaîne, mais rien ne l'oblige ; ce qu'on ne sait pas lire ressort dans `illisibles` pour que
 * l'appelant refuse de conclure plutôt que d'ignorer.
 */
export function exigencesDu(verrou, { production }) {
  const exigences = [];
  const illisibles = [];
  for (const [chemin, entree] of Object.entries(verrou.packages || {})) {
    // ⚠️ L'entrée `""` est le paquet LUI-MÊME : son `engines` est ce qu'on confronte, jamais une
    // exigence à satisfaire. La confondre ferait une garde qui se compare à elle-même — verte par
    // construction, ce que ce dépôt appelle une garde satisfaite par sa propre prose.
    if (!chemin) continue;
    if (production && entree.dev) continue;
    const portee = entree?.engines?.node;
    if (portee === undefined) continue;
    if (typeof portee !== "string" || !semver.validRange(portee)) {
      illisibles.push(`${chemin} déclare un engines.node qu'on ne sait pas lire : ${JSON.stringify(portee)}`);
      continue;
    }
    exigences.push({ chemin, portee });
  }
  return { exigences, illisibles };
}

/**
 * Les dépendances qui refusent des versions que notre déclaration admet.
 *
 * ⚠️ ON NOMME UN TÉMOIN quand on en a un. « Votre intervalle n'est pas un sous-ensemble du mien »
 * n'apprend rien à qui doit corriger ; « node 22.0.0 passe chez vous et pas chez pdfjs-dist » se
 * vérifie en une commande.
 */
export function tropLarges(declare, exigences) {
  const temoin = semver.minVersion(declare);
  return exigences
    .filter(({ portee }) => !semver.subset(declare, portee))
    .map(({ chemin, portee }) => {
      const contre = temoin && !semver.satisfies(temoin, portee) ? ` — par exemple node ${temoin} : admis par engines, refusé par cette dépendance` : "";
      return `${chemin} exige node ${portee}, plus strict que le engines.node du paquet (${declare})${contre}`;
    });
}

/**
 * La plus basse version que TOUTES les exigences acceptent, ou `null` si on ne peut pas la prouver.
 *
 * ⚠️ ON PROPOSE, PUIS ON VÉRIFIE. Le plus haut des minimums individuels est un CANDIDAT, pas une
 * réponse : rien ne garantit qu'une version qui satisfait l'intervalle le plus exigeant satisfait
 * tous les autres (`^22.22.2` et `>=24` n'ont aucune version commune sous 24). On le confronte donc
 * à chaque intervalle, et on rend `null` plutôt qu'un nombre qu'on n'aurait pas éprouvé.
 */
export function plancherProuve(exigences) {
  const minimums = exigences
    .map(({ chemin, portee }) => ({ chemin, portee, min: semver.minVersion(portee) }))
    .filter((x) => x.min);
  if (!minimums.length) return null;
  const candidat = minimums.reduce((a, b) => (semver.gt(b.min, a.min) ? b : a));
  const refusent = exigences.filter(({ portee }) => !semver.satisfies(candidat.min, portee));
  return refusent.length ? null : { version: semver.parse(candidat.min).version, du: candidat.chemin, portee: candidat.portee };
}

/**
 * Le plancher est-il ÉCRIT dans ce texte ?
 *
 * ⚠️ AUX BORNES, PAS EN SOUS-CHAÎNE. « 22.2.2 » se trouve dans « 22.22.2 » : une recherche naïve
 * bénirait un document qui annonce un plancher plus BAS que le vrai — exactement le sens de
 * l'erreur qu'on ferme ici. Et cette décision vit dans une fonction exportée, pas dans le point
 * d'entrée : une règle qu'on ne peut pas appeler depuis un banc est une règle qu'on ne teste pas.
 */
export const plancherEcritDans = (texte, version) =>
  new RegExp(`(^|[^\\d.])${version.replace(/\./g, "\\.")}([^\\d.]|$)`).test(texte);

if (estExecuteDirectement(import.meta.url)) {
  // ⚠️ `tenter` : un `package.json` ou un verrou illisible ne dit RIEN du plancher — il dit qu'on
  // n'a pas pu regarder. C'est le cas du dépôt vide, et c'est un 2, jamais un 1.
  conclure(tenter(() => {
    const paquet = JSON.parse(readFileSync("package.json", "utf8"));
    const verrou = JSON.parse(readFileSync("package-lock.json", "utf8"));

    const declare = paquet?.engines?.node;
    if (typeof declare !== "string" || !semver.validRange(declare)) {
      return inconclusif(`package.json ne déclare pas un engines.node lisible (${JSON.stringify(declare)}) — il n'y a rien à confronter`);
    }

    const prod = exigencesDu(verrou, { production: true });
    const tout = exigencesDu(verrou, { production: false });
    const illisibles = [...new Set([...prod.illisibles, ...tout.illisibles])];
    if (illisibles.length) return inconclusif(illisibles);

    // ⚠️ LE PLANCHER DE LA SONDE. Zéro exigence lue ne veut pas dire « aucune contrainte » : ça veut
    // dire qu'on a lu un verrou vide, ou pas le bon. Une garde qui déclare victoire là-dessus est
    // celle que `planchers-des-gardes` existe pour attraper.
    if (!prod.exigences.length) {
      return inconclusif("aucune dépendance de production ne déclare engines.node dans package-lock.json — la sonde n'a rien lu, donc rien n'est prouvé");
    }

    const constats = tropLarges(declare, prod.exigences);
    if (constats.length) return violation(constats);

    const plancherDev = plancherProuve(tout.exigences);
    if (!plancherDev) {
      return inconclusif("le plancher de développement ne se prouve pas : la plus haute des exigences minimales n'est pas acceptée par toutes les autres — un intervalle est disjoint des autres, et il faut le lire à la main");
    }

    // ⚠️ LE NOMBRE ÉCRIT DANS LE DOCUMENT EST UN SECOND EXEMPLAIRE, donc il divergera. Le jour où
    // `jsdom` monte son plancher, la chaîne de développement le suit sans que personne n'ouvre
    // CONTRIBUTING — et le contributeur qui s'y fie lit une version qui ne démarre plus. C'est
    // exactement la divergence étiquette/condensat, sur un autre couple.
    const contributing = readFileSync(OU_EST_ECRIT_LE_PLANCHER_DEV, "utf8");
    if (!plancherEcritDans(contributing, plancherDev.version)) {
      return violation(
        `${OU_EST_ECRIT_LE_PLANCHER_DEV} n'écrit nulle part le plancher de développement mesuré (node ${plancherDev.version}, imposé par ${plancherDev.du} qui exige ${plancherDev.portee}) — un contributeur sous cette version obtient un « Startup Error » qui parle d'un bogue npm et conseille de supprimer package-lock.json, jamais sa version de node`,
      );
    }

    const plancherProd = semver.minVersion(declare);
    return conforme(
      `plancher de node : engines dit ${declare} (soit ${plancherProd} au plus bas), et aucune des ${prod.exigences.length} dépendance(s) de production n'exige davantage — plancher de développement mesuré à ${plancherDev.version}, écrit dans ${OU_EST_ECRIT_LE_PLANCHER_DEV} (${tout.exigences.length} exigences lues au total)`,
    );
  }));
}
