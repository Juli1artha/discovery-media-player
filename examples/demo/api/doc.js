// LA DÉMONSTRATION EN LIGNE : le player, un dossier, un PDF. Aucune base, aucun secret.
//
// C'est aussi le plus petit hôte possible — une fonction, une dépendance, aucune décision.
// Tout ce qui demande des décisions (qui a le droit de diffuser, quelle marque pour quel client)
// concerne les liens tracés, et il n'y en a pas ici.
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// ⚠️ RÉSOLU DEPUIS CE FICHIER, PAS DEPUIS LE DOSSIER DE TRAVAIL.
//
// Première version : `path.join(process.cwd(), "documents")`. Le déploiement a répondu « Document
// indisponible » — la garde refusait le fichier, parce qu'il n'était pas là. `cwd` valait
// `/var/task`, mais la plateforme avait conservé l'arborescence du DÉPÔT dans la fonction : le
// dossier se trouvait à `/var/task/examples/demo/documents`.
//
// Le dossier de travail est décidé par la plateforme ; `__dirname` est décidé par le code. Le
// second est juste partout — en local, sur Vercel, et sur la prochaine plateforme.
const DOCUMENTS = path.join(__dirname, "..", "documents");
process.env.PLAYER_LOCAL_ROOT = DOCUMENTS;

const player = require("discovery-media-player");
const { createStandaloneContext } = require("discovery-media-player/context/standalone");

player.init(createStandaloneContext(process.env));

module.exports = async function handler(req, res) {
  const q = req.query || {};

  // ⚠️ `?diag=1` — la démonstration sait dire ce qu'elle voit.
  //
  // Le premier déploiement a affiché « Document indisponible » : la garde refusait le fichier,
  // sans qu'on puisse savoir si le dossier n'était pas embarqué ou s'il n'était pas là où on le
  // cherche. Deux causes, un seul symptôme — exactement ce qu'on passe notre temps à séparer
  // ailleurs. Aucune donnée sensible ici : des chemins et des booléens.
  if (q.diag === "1") {
    const fs = require("node:fs");
    const lire = (d) => { try { return fs.readdirSync(d).slice(0, 20); } catch (e) { return `illisible: ${e.code}`; } };
    res.statusCode = 200;
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.end(JSON.stringify({
      cwd: process.cwd(),
      dossierAttendu: DOCUMENTS,
      dossierExiste: fs.existsSync(DOCUMENTS),
      contenu: lire(DOCUMENTS),
      voisinsDuCwd: lire(process.cwd()),
      racineDuLambda: lire("/var/task"),
    }, null, 2));
    return;
  }
  // `/` et `/preview/<nom>` sont réécrits ici (cf. vercel.json). On construit les paramètres de
  // l'aperçu côté serveur : le visiteur ne voit jamais de chemin de fichier dans son navigateur,
  // et la garde de stockage reste seule juge de ce qui est lisible.
  // ⚠️ `doc`, PAS `name` — et cette lettre a coûté un déploiement.
  //
  // La condition testait `q.name`. Or l'URL que le player construit lui-même pour aller chercher
  // le fichier porte `name=sample.pdf` : cette requête entrait donc dans la branche, se faisait
  // réécrire, PERDAIT son `stream=1`, et recevait la page HTML à la place du PDF. La visionneuse
  // affichait « Impossible d'afficher ce document » — vrai, et sans indice.
  //
  // Mon propre test l'avait signalé avant le déploiement. Je l'ai écarté en me disant que le cas
  // ne se présenterait pas. Un paramètre qui n'appartient qu'à ce fichier ne peut pas entrer en
  // collision avec ceux du player.
  if (q.demo === "1" || q.doc) {
    const nom = path.basename(String(q.doc || "sample.pdf"));
    req.query = {
      preview: "1",
      name: nom,
      title: "Discovery Media Player",
      url: pathToFileURL(path.join(DOCUMENTS, nom)).href,
    };
  }
  return player.handler(req, res);
};
