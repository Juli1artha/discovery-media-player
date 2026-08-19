// LA SURFACE QUE CES ESSAIS REGARDENT EST « LE CODE DE PAGE LIVRÉ », PAS UN FICHIER.
//
// Avant le refactor du 19/08, tout vivait dans handler.js et les essais lisaient ce fichier.
// L'extraction des gabarits (live, carte, agent, tiers, texte) aurait VIDÉ ces essais en
// silence : chaque propriété qu'ils exigent aurait déménagé hors de leur regard, et ils
// seraient restés verts — la garde qui énumère maigrit quand on range. La source est donc la
// CONCATÉNATION : un gabarit qui déménage reste sous le regard, un gabarit NOUVEAU doit être
// ajouté ici (et l'essai de complétude ci-dessous le rappelle).
const fs = require("node:fs");

const FICHIERS = [
  "../handler.js", "../gabarit-live.js", "../gabarit-carte.js",
  "../gabarit-agent.js", "../gabarit-legal.js", "../tiers.js", "../texte.js",
  "../session-cles.js", "../page-mur.js", "../page-visionneuse.js", "../page-audience.js",
];

const SOURCE_PAGES = FICHIERS.map((f) => fs.readFileSync(require.resolve(f), "utf8")).join("\n");

module.exports = { SOURCE_PAGES, FICHIERS };
