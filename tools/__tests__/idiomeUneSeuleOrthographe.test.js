// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE IDÉE RECOPIÉE À LA MAIN SE PROPAGE AVEC SES VARIANTES.
//
// ⚠️ LE CHIFFRE QUI COMPTE N'EST PAS « 14 COPIES », C'EST « 3 ORTHOGRAPHES ». Le second hôte l'a
// formulé mieux que « factorisez » : trois écritures de la même idée veut dire que personne ne l'a
// jamais IMPORTÉE — chacun l'a retapée. Et chaque transcription a eu sa propre erreur, parce que la
// mémoire ne retient pas un caractère d'échappement. Les variantes ne sont pas des inattentions :
// ce sont les seules formes qu'une recopie peut produire.
//
// Constaté deux fois dans ce dépôt le même jour :
//
//   • « suis-je le programme principal ? » — 14 sites, 3 orthographes, toutes fausses sur macOS,
//     dont une fausse PARTOUT (elle n'encodait pas les caractères spéciaux). Remède : un module,
//     et l'interdiction de reposer la question ailleurs.
//   • « cette ligne est-elle un commentaire ? » — 20 sites, 3 orthographes. La plus étroite ne
//     reconnaît que `//` : sur un bloc JSDoc elle garde l'ouverture ET toutes les lignes d'étoile
//     comme du CODE. Or ce dépôt a déjà payé trois fois « une sonde qui lit du commentaire invente
//     des coupables ». Les six sites qui la portaient étaient latents, pas actifs — aucun ne lisait
//     encore un fichier dont le bloc cite ce qu'il cherche.
//
// ⚠️ PAS DE MODULE PARTAGÉ POUR CELLE-CI, ET C'EST UNE CONTRAINTE, PAS UN CHOIX. Les bancs de
// `server/__tests__` sont en CommonJS, les outils de `tools/` en modules ES : un seul helper
// importable des deux côtés demanderait une gymnastique qui coûterait plus que l'idiome. Le remède
// dégradé est donc « une seule orthographe, et une garde qui l'exige » — moins fort que « vous ne
// pouvez pas reposer la question », puisqu'il faut encore l'écrire correctement.
//
// ⚠️ LES FORMES INTERDITES SONT CONSTRUITES, PAS ÉCRITES. Si ce fichier les contenait en toutes
// lettres, il s'accuserait lui-même — et l'échappatoire (« sauf moi ») est précisément ce qui vide
// une garde. On les assemble donc caractère par caractère : le fichier n'en contient aucune.

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");
const B = String.fromCharCode(92);          // la barre oblique inverse, jamais écrite telle quelle

const ETROITE  = `/^${B}s*${B}/${B}//`;                        // « // » seulement
const MOYENNE  = `/^${B}s*(${B}/${B}/|${B}*)/`;                // « // » et « * », pas l'ouverture
const COMPLETE = `/^${B}s*(${B}/${B}/|${B}*|${B}/${B}*)/`;     // les trois

const INTERDITES = [
  [ETROITE, "ne reconnaît que « // » : un bloc JSDoc traverse la sonde en entier, ouverture et lignes d'étoile comprises"],
  [MOYENNE, "laisse passer la ligne d'OUVERTURE d'un bloc — celle qui porte souvent la phrase qu'on cherche"],
];

function sources() {
  const out = [];
  for (const base of ["tools", "server"]) {
    const pile = [path.join(RACINE, base)];
    while (pile.length) {
      const d = pile.pop();
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) { pile.push(p); continue; }
        if (!/\.(js|mjs)$/.test(e.name) || e.name.includes(".generated.")) continue;
        if (p === __filename) continue;   // il ne CONTIENT aucune forme, mais l'écrire évite la question
        out.push({ p: path.relative(RACINE, p), texte: fs.readFileSync(p, "utf8") });
      }
    }
  }
  return out;
}

describe("« cette ligne est-elle un commentaire ? » s'écrit d'une seule façon", () => {
  it("la sonde lit bien des sources", () => {
    expect(sources().length, "aucune source relevée : cette garde vise à côté").toBeGreaterThan(30);
  });

  // ⚠️ CONTRÔLE POSITIF. La garde affirme une ABSENCE : sa panne la plus probable — des formes mal
  // assemblées — produit elle aussi une absence, donc un vert. On vérifie que les chaînes construites
  // sont bien celles qu'on croit avant que leur absence ne prouve quoi que ce soit.
  it("les formes interdites sont bien assemblées", () => {
    expect(ETROITE).toBe("/^\\s*\\/\\//");
    expect(MOYENNE).toBe("/^\\s*(\\/\\/|\\*)/");
    expect(COMPLETE).toBe("/^\\s*(\\/\\/|\\*|\\/\\*)/");
  });

  it("la forme complète est bien celle qui est employée, et elle l'est partout", () => {
    const n = sources().reduce((t, s) => t + s.texte.split(COMPLETE).length - 1, 0);
    // Un plancher LARGE : il détecte l'effondrement de la sonde, pas la variation normale.
    expect(n, "la forme complète a disparu du dépôt : la sonde vise à côté").toBeGreaterThanOrEqual(10);
  });

  it("aucune orthographe incomplète ne subsiste", () => {
    const fautes = [];
    for (const { p, texte } of sources()) {
      for (const [forme, pourquoi] of INTERDITES) {
        if (texte.includes(forme)) fautes.push(`${p} : orthographe incomplète — ${pourquoi}`);
      }
    }
    expect(fautes, "une variante d'un idiome recopié est revenue").toEqual([]);
  });
});
