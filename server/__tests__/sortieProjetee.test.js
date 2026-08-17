// AUCUNE SORTIE SANS PROJECTION.
//
// La garde catégorielle des adresses (server/publier.js) n'a trouvé aucun endroit où se brancher :
// toute sortie publique du player a DÉJÀ une liste blanche, et toute sortie portant des adresses
// est autorisée. La catégorie visée était vide — non par chance, mais parce que la discipline
// tenait. Ce qui manquait, c'est ce qui la fait tenir DEMAIN.
//
// ⚠️ CETTE GARDE VÉRIFIE LA PROPRIÉTÉ STRUCTURELLE, PAS LE CONTENU : une ligne de base ne quitte
// jamais une fonction telle quelle. Le jour où quelqu'un ajoute une lecture et rend directement ce
// que PostgREST a répondu, une colonne ajoutée entre-temps sort sans que personne ne l'ait décidé.
//
// ⚠️ ET CE DÉFAUT A EXISTÉ, AUJOURD'HUI MÊME. `listMessages` rendait ses lignes telles quelles, en
// comptant sur la seule liste du `select`. Ça tenait tant que cette liste ne contenait que du
// public — puis la référence d'auteur a exigé de lire `author_hash`, qui serait ressorti intact
// vers toute l'audience. Une garde qui dépend de ce qu'on n'a pas demandé cède au premier champ
// qu'on demande. Celle-ci ne dépend que de la FORME du code.

const fs = require("node:fs");
const path = require("node:path");

const DOSSIER = path.join(__dirname, "..");

/** Le source, commentaires retirés — une garde qui lit du commentaire invente des coupables. */
function sourceUtile(fichier) {
  return fs.readFileSync(path.join(DOSSIER, fichier), "utf8")
    .split("\n")
    .map((l, i) => ({ n: i + 1, texte: /^\s*(\/\/|\*|\/\*)/.test(l) ? "" : l }));
}

const FICHIERS = fs.readdirSync(DOSSIER)
  .filter((f) => f.endsWith(".js") && !f.endsWith(".generated.js"));

describe("une ligne de base ne quitte jamais une fonction telle quelle", () => {
  it("aucune lecture n'est rendue sans projection", () => {
    const fautes = [];

    for (const fichier of FICHIERS) {
      const lignes = sourceUtile(fichier);
      // Les variables qui reçoivent une réponse de la base.
      const brutes = new Set();
      for (const { texte } of lignes) {
        const m = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+PLAYER\.db\.(?:request|selectAll)\(/.exec(texte);
        if (m) brutes.add(m[1]);
      }
      if (!brutes.size) continue;

      for (const { n, texte } of lignes) {
        for (const v of brutes) {
          // `return v`, `return v || []`, `return Array.isArray(v) ? v : []` — la ligne sort nue.
          const nue = new RegExp(`return\\s+(Array\\.isArray\\(${v}\\)\\s*\\?\\s*${v}\\s*:\\s*\\[\\]|${v}\\s*(\\|\\|\\s*\\[\\])?)\\s*;`);
          if (nue.test(texte)) fautes.push(`${fichier}:${n} — « ${texte.trim()} »`);
        }
      }
    }

    expect(fautes, "une réponse de base sort sans projection : ajoutez un .map(projection)").toEqual([]);
  });

  // ⚠️ UNE GARDE QU'ON N'A PAS VUE REFUSER NE GARDE RIEN. Celle-ci se relit elle-même sur un cas
  // fabriqué : sans ça, une expression régulière qui ne correspond à rien passerait pour un dépôt
  // sain. C'est la même exigence qu'on pose au reste du code, posée à l'outil qui le surveille.
  it("et elle reconnaît la faute quand on la lui montre", () => {
    const exemple = [
      "async function lireTout(slug) {",
      "  const rows = await PLAYER.db.request(`t?slug=eq.${slug}&select=*`);",
      "  return Array.isArray(rows) ? rows : [];",
      "}",
    ].join("\n");

    const brutes = new Set();
    for (const l of exemple.split("\n")) {
      const m = /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*await\s+PLAYER\.db\.(?:request|selectAll)\(/.exec(l);
      if (m) brutes.add(m[1]);
    }
    expect([...brutes]).toEqual(["rows"]);

    const nue = /return\s+(Array\.isArray\(rows\)\s*\?\s*rows\s*:\s*\[\]|rows\s*(\|\|\s*\[\])?)\s*;/;
    expect(exemple.split("\n").some((l) => nue.test(l))).toBe(true);
  });
});
