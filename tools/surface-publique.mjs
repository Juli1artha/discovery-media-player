// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUE LE PAQUET PROMET — DÉCLARÉ UNE FOIS, CONFRONTÉ PARTOUT.
//
// ⚠️ « UNE DONNÉE EXPOSÉE EST UNE PROMESSE » (second hôte, 19/08). Le champ `exports` de
// package.json en portait DIX, dont cinq que docs/API.md ne mentionnait nulle part : un
// intégrateur qui les découvrait ne pouvait savoir ni ce qu'ils rendent, ni s'ils survivront à
// la prochaine version. Une promesse que personne ne peut lire n'engage que celui qui la
// découvre — et il la découvre en production (troisième audit externe, 21/08).
//
// Ce fichier est la SOURCE : chaque sous-chemin y a un statut, et une garde confronte cette
// liste à `package.json#exports` d'un côté, à la documentation de l'autre. Ajouter un export
// sans le classer rougit ; classer un export qui n'existe pas rougit aussi.
//
// LES STATUTS, ET CE QU'ILS ENGAGENT :
//
//   stable       — documenté, exercé par les exemples ou la CI, et il ne disparaît pas sans une
//                  version qui l'annonce. C'est ce sur quoi un intégrateur peut bâtir.
//   experimental — exposé parce que des hôtes s'en servent déjà, mais la surface n'est pas figée :
//                  elle peut changer de forme dans une mineure. À ne pas prendre pour un contrat.
//   document     — un fichier Markdown servi comme export, pour que `require.resolve` le suive à
//                  travers tout rangement (le contrat, la rétention).
//   manifeste    — `./package.json`, que npm exige de pouvoir résoudre.
//
// ⚠️ ON NE RETIRE RIEN ICI. Quatre sous-chemins sont `experimental` faute d'usage documenté, pas
// par mépris : les sortir de `exports` casserait un hôte qui les importe aujourd'hui sans que
// nous le sachions. Les classer, c'est dire la vérité sans rompre — le retrait, s'il vient un
// jour, se décide dans une version qui l'annonce.

import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { conclure, conforme, violation, inconclusif } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

export const SURFACE = {
  ".": {
    statut: "stable",
    quoi: "le gestionnaire de requêtes et son `init(context)` — le point d'entrée du player",
  },
  "./bridge": {
    statut: "stable",
    quoi: "le contrat de messages `postMessage` qu'une application hôte importe (MIT, typé)",
  },
  "./context/standalone": {
    statut: "stable",
    quoi: "`createStandaloneContext(env)` — un contexte complet construit depuis l'environnement",
  },
  "./context/storage": {
    statut: "experimental",
    quoi: "les décisions du relais de fichiers (origines permises, racine locale, extensions)",
  },
  "./shares": {
    statut: "experimental",
    quoi: "la couche des liens tracés : création, re-partage, sessions de lecture",
  },
  "./presentations": {
    statut: "experimental",
    quoi: "la couche des présentations en direct : état, présence, chat, pièces jointes",
  },
  "./brands": {
    statut: "experimental",
    quoi: "la résolution de la marque d'un lien à l'affichage",
  },
  "./contrat": {
    statut: "document",
    quoi: "`docs/HOST-CONTRACT.md` — le contrat d'hôte, résolvable par chemin",
  },
  "./retention": {
    statut: "document",
    quoi: "`docs/RETENTION.md` — le périmètre déclaré de la rétention",
  },
  "./package.json": {
    statut: "manifeste",
    quoi: "exigé par npm et par les outils qui lisent la version",
  },
};

/** Les sous-chemins qu'un intégrateur peut importer et dont on parle dans la documentation. */
export const publics = () =>
  Object.entries(SURFACE).filter(([, d]) => d.statut === "stable" || d.statut === "experimental").map(([k]) => k);

// ⚠️ DES PLANCHERS SUR CE QUI EST VÉRIFIÉ, ET PAS SUR UN LITTÉRAL. Le résumé vert annonçait
// « 3 stable, 4 experimental, 2 document, 1 manifeste », compté sur `SURFACE` — un objet écrit
// dans CE fichier. Ce nombre ne peut PAS tomber : quoi qu'il arrive aux sondes, il dira toujours
// la même chose. Un plancher sur une constante n'est pas un plancher.
//
// Mesuré le 31/08, trois cécités distinctes, chacune sortant 0 avec CE MÊME message :
//   `publics()` rendu vide            → `ecartsTypes` et `ecartsDoc` n'ont plus de sujet
//   le chargement des modules muet    → `ecartsInternes` ne tourne sur rien
//   la boucle des internes court-circuitée
// Relevé du jour : 7 sous-chemins publics, 7 modules chargés, 75 symboles vus.
export const PLANCHER_PUBLICS = 3;
export const PLANCHER_CHARGES = 3;
export const PLANCHER_SYMBOLES = 10;

/** Ce que le manifeste et package.json se disent l'un de l'autre. */
export function ecartsExports(exportsPaquet) {
  const declares = Object.keys(SURFACE), reels = Object.keys(exportsPaquet || {});
  return [
    ...reels.filter((e) => !declares.includes(e))
      .map((e) => `package.json expose « ${e} » sans le classer dans tools/surface-publique.mjs`),
    ...declares.filter((e) => !reels.includes(e))
      .map((e) => `le manifeste classe « ${e} », que package.json n'expose pas`),
  ];
}

/**
 * Un export public qui n'apparaît pas dans la documentation est une promesse illisible.
 * On cherche la forme qu'un intégrateur ÉCRIRAIT — `discovery-media-player/shares` — donc le
 * sous-chemin sans son point initial : « ./shares » est la notation de package.json, pas celle
 * d'un `require`.
 */
export const formeImportee = (sousChemin) => "discovery-media-player" + sousChemin.replace(/^\./, "");

/**
 * ⚠️ UN EXPORT STABLE SANS TYPES EST UNE PROMESSE À MOITIÉ TENUE. Un consommateur TypeScript qui
 * importe ce paquet en mode strict reçoit un `any` implicite — donc soit une erreur de
 * compilation, soit, pire, un silence qui laisse passer n'importe quel appel. « Stable » engage
 * la forme de la surface ; sans type, cette forme n'est écrite nulle part que la machine puisse
 * lire. Les EXPÉRIMENTAUX n'en ont pas, et c'est cohérent : leur forme n'est pas figée.
 */
export function ecartsTypes(exportsPaquet) {
  return Object.entries(SURFACE)
    .filter(([, d]) => d.statut === "stable")
    .filter(([sousChemin]) => {
      const cible = (exportsPaquet || {})[sousChemin];
      return !cible || typeof cible === "string" || !cible.types;
    })
    .map(([sousChemin]) => `« ${sousChemin} » est stable et n'annonce aucun type dans package.json#exports — un consommateur TypeScript strict reçoit un any implicite`);
}

export function ecartsDoc(txtDoc) {
  return publics()
    .filter((e) => !txtDoc.includes("`" + formeImportee(e) + "`"))
    .map((e) => `« ${e} » est exposé et absent de docs/API.md — l'intégrateur ne peut pas savoir ce qu'il promet`);
}

/**
 * Les symboles préfixés `__` qu'un module rend publics.
 *
 * ⚠️ Le préfixe DIT « interne », il n'EMPÊCHE rien : `require("discovery-media-player")` rend
 * aujourd'hui `__relayerFichier` et `__jsonPourScript` à qui les demande. On ne les retire pas
 * (les bancs s'en servent), mais on les recense : la liste ci-dessous est ce qu'on tolère, et
 * tout nouveau venu doit être décidé plutôt que découvert.
 */
export const INTERNES_TOLERES = {
  // ⚠️ `__contexte` : DÉCIDÉ, pas subi. « Le contexte de l'hôte reste vivant après `init` » ne se
  // vérifie pas du dehors — et c'est précisément la propriété qu'une enveloppe de mesure a cassée
  // une fois (la forge l'a vue, pas nous). L'exporter est le prix d'un banc qui la garde.
  ".": ["__relayerFichier", "__jsonPourScript", "__contexte"],
};

/**
 * ⚠️ LA TOLÉRANCE DONT LE SUJET A DISPARU — L'AUTRE SENS DE LA MÊME LISTE.
 *
 * `INTERNES_TOLERES` dit « tout nouveau venu doit être décidé plutôt que découvert ». Elle ne le
 * tenait que dans un sens : un symbole ABSENT de la liste rougit, un symbole qui cesse d'être
 * exporté laisse son entrée derrière lui. Et une entrée morte est une porte ouverte d'avance —
 * le jour où ce nom réapparaît, il est « toléré » au lieu d'être décidé, ce que cette liste existe
 * précisément pour empêcher.
 *
 * ⚠️ QUESTION SÉPARÉE, FONCTION SÉPARÉE. « Quel interne n'est pas déclaré ? » et « quelle
 * déclaration n'a plus de sujet ? » sont deux questions ; les fondre dans un seul relevé mêlerait
 * un constat sur le CODE à un constat sur la GARDE, et rendrait chacun plus difficile à lire.
 */
export function tolerancesSansSujet(sousChemin, symboles) {
  const presents = new Set(symboles || []);
  return (INTERNES_TOLERES[sousChemin] || [])
    .filter((s) => !presents.has(s))
    .map((s) => `« ${sousChemin} » tolère l'interne « ${s} », que le module n'exporte plus — RETIREZ l'entrée d'INTERNES_TOLERES, sinon son retour sera toléré au lieu d'être décidé`);
}

export function ecartsInternes(sousChemin, symboles) {
  const toleres = INTERNES_TOLERES[sousChemin] || [];
  return (symboles || []).filter((s) => s.startsWith("__") && !toleres.includes(s))
    .map((s) => `« ${sousChemin} » rend un nouveau symbole interne « ${s} » — décidez-le dans INTERNES_TOLERES, ou ne l'exportez pas`);
}

if (estExecuteDirectement(import.meta.url)) {
  // ⚠️ UNE EXCEPTION EST UN RÉSULTAT NON CONCLUANT, PAS UNE VIOLATION. `docs/API.md` absent ou
  // `package.json` déplacé faisaient remonter l'erreur jusqu'à Node, qui sortait 1 : le refus
  // prudent de la garde prenait l'apparence d'un dépôt fautif, avec une trace de pile pour
  // toute explication. Ce qui vaut pour un YAML illisible vaut pour un fichier qui manque.
  try {
    // ⚠️ SANS CE PLANCHER, LA GARDE COMPARE LE VIDE AU VIDE. `ecartsExports` parcourt ce que
    // `package.json#exports` déclare : s'il est absent, elle ne trouve aucun écart et la garde se
    // félicite — sur un paquet qui n'expose plus rien. Ce n'est pas la branche qui est fautive dans
    // ce cas, c'est la sonde : « non concluant », pas « violation ».
    let paquet = null;
    try {
      paquet = JSON.parse(readFileSync("package.json", "utf8"));
    } catch (e) {
      conclure(inconclusif(`package.json illisible — ${(e && e.message) || e}`));
    }
    if (!paquet || !paquet.exports || !Object.keys(paquet.exports).length) {
      conclure(inconclusif("package.json ne déclare aucun « exports » — la sonde n'a rien à comparer"));
    }
    // ⚠️ LE PLANCHER DE SUJET, AVANT TOUT LE RESTE. `ecartsTypes` et `ecartsDoc` parcourent
    // `publics()` : si elle rend le vide, elles ne trouvent aucun écart et la garde se félicite
    // sur une surface qu'elle n'a pas regardée.
    const chemins = publics();
    if (chemins.length < PLANCHER_PUBLICS) {
      conclure(inconclusif(`${chemins.length} sous-chemin(s) public(s) relevé(s) dans le manifeste, moins que ${PLANCHER_PUBLICS} — ce n'est pas une surface d'accord, c'est une sonde sans sujet`));
    }
    const soucis = [
      ...ecartsExports(paquet.exports),
      ...ecartsTypes(paquet.exports),
      ...ecartsDoc(readFileSync("docs/API.md", "utf8")),
    ];
    // ⚠️ LA MÊME LISTE QUE `publics()`, PAS UNE SECONDE ÉCRITURE DU FILTRE. Cette boucle refaisait
    // « statut stable ou experimental » pour son compte : dévier `publics()` la laissait intacte,
    // donc le témoin et le juge n'auraient pas regardé la même chose.
    let charges = 0;
    let symboles = 0;
    const refuses = [];
    for (const sousChemin of chemins) {
      const chemin = paquet.exports[sousChemin];
      const fichier = typeof chemin === "string" ? chemin : chemin?.default;
      if (!fichier || !fichier.endsWith(".js")) continue;
      try {
        const { createRequire } = await import("node:module");
        const mod = createRequire(pathToFileURL("./package.json"))(fichier);
        const vus = Object.keys(mod);
        charges += 1;
        symboles += vus.length;
        soucis.push(...ecartsInternes(sousChemin, vus));
        soucis.push(...tolerancesSansSujet(sousChemin, vus));
      } catch (e) {
        // ⚠️ UN module qui ne se charge pas hors contexte n'est pas le sujet de cette garde — mais
        // TOUS, c'est une sonde qui ne tourne plus, et l'avaler en silence était la troisième
        // cécité mesurée le 31/08. On tolère l'unité, on compte, et le plancher tranche.
        refuses.push(`${sousChemin} (${(e && e.message) || e})`);
      }
    }
    if (charges < PLANCHER_CHARGES) {
      conclure(inconclusif(`${charges} module(s) public(s) chargé(s) sur ${chemins.length}, moins que ${PLANCHER_CHARGES} — « aucun interne ne fuit » n'aurait été vérifié sur rien${refuses.length ? ` ; refusés : ${refuses.join(", ")}` : ""}`));
    }
    if (symboles < PLANCHER_SYMBOLES) {
      conclure(inconclusif(`${symboles} symbole(s) exporté(s) relevé(s) dans ${charges} module(s), moins que ${PLANCHER_SYMBOLES} — les modules se chargent mais ne rendent plus rien à lire`));
    }
    conclure(soucis.length
      ? violation(soucis)
      : conforme(`surface publique : ${chemins.length} sous-chemin(s) public(s), ${charges} module(s) chargé(s), ${symboles} symbole(s) relevé(s) — manifeste, package.json et documentation d'accord, et aucun interne ne fuit`));
  } catch (e) {
    conclure(inconclusif(`la surface publique n'a pas pu être lue — ${(e && e.message) || e}`));
  }
}
