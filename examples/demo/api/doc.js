// LA DÉMONSTRATION EN LIGNE : le player, un dossier, un PDF. Aucune base, aucun secret.
//
// C'est aussi le plus petit hôte possible — une fonction, une dépendance, aucune décision.
// Tout ce qui demande des décisions (qui a le droit de diffuser, quelle marque pour quel client)
// concerne les liens tracés, et il n'y en a pas ici.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// ⚠️ Calculé ICI, pas posé en variable d'environnement : une plateforme serverless décide seule
// d'où elle exécute la fonction. Un chemin absolu écrit à la main serait juste sur l'une et faux
// sur la suivante — et le symptôme serait « aucun document », sans indice sur la cause.
const DOCUMENTS = path.join(process.cwd(), "documents");
process.env.PLAYER_LOCAL_ROOT = DOCUMENTS;

const player = require("discovery-media-player");
const { createStandaloneContext } = require("discovery-media-player/context/standalone");

player.init(createStandaloneContext(process.env));

module.exports = async function handler(req, res) {
  const q = req.query || {};
  // `/` et `/preview/<nom>` sont réécrits ici (cf. vercel.json). On construit les paramètres de
  // l'aperçu côté serveur : le visiteur ne voit jamais de chemin de fichier dans son navigateur,
  // et la garde de stockage reste seule juge de ce qui est lisible.
  if (q.demo === "1" || q.name) {
    const nom = path.basename(String(q.name || "sample.pdf"));
    req.query = {
      preview: "1",
      name: nom,
      title: "Discovery Media Player",
      url: pathToFileURL(path.join(DOCUMENTS, nom)).href,
    };
  }
  return player.handler(req, res);
};
