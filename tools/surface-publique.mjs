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
  ".": ["__relayerFichier", "__jsonPourScript"],
};

export function ecartsInternes(sousChemin, symboles) {
  const toleres = INTERNES_TOLERES[sousChemin] || [];
  return (symboles || []).filter((s) => s.startsWith("__") && !toleres.includes(s))
    .map((s) => `« ${sousChemin} » rend un nouveau symbole interne « ${s} » — décidez-le dans INTERNES_TOLERES, ou ne l'exportez pas`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const paquet = JSON.parse(readFileSync("package.json", "utf8"));
  const soucis = [
    ...ecartsExports(paquet.exports),
    ...ecartsTypes(paquet.exports),
    ...ecartsDoc(readFileSync("docs/API.md", "utf8")),
  ];
  for (const [sousChemin, cible] of Object.entries(SURFACE)) {
    if (!["stable", "experimental"].includes(cible.statut)) continue;
    const chemin = paquet.exports[sousChemin];
    const fichier = typeof chemin === "string" ? chemin : chemin?.default;
    if (!fichier || !fichier.endsWith(".js")) continue;
    try {
      const { createRequire } = await import("node:module");
      const mod = createRequire(pathToFileURL("./package.json"))(fichier);
      soucis.push(...ecartsInternes(sousChemin, Object.keys(mod)));
    } catch { /* un module qui ne se charge pas hors contexte n'est pas le sujet de cette garde */ }
  }
  if (soucis.length) {
    for (const s of soucis) console.error("::error::" + s);
    process.exit(1);
  }
  const parStatut = Object.values(SURFACE).reduce((a, d) => ({ ...a, [d.statut]: (a[d.statut] || 0) + 1 }), {});
  console.log("surface publique : " + Object.entries(parStatut).map(([s, n]) => `${n} ${s}`).join(", ") + " — manifeste, package.json et documentation d'accord");
}
