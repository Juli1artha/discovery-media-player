// UN CARACTÈRE DE CITATION DANS UN CONTEXTE DE CITATION IMBRIQUÉ COUPE LE PROGRAMME EN DEUX.
//
// ⚠️ Deux fois dans la même journée, et jamais au même endroit :
//
//   1. un accent grave dans un commentaire du script d'audience — qui vit dans un LITTÉRAL DE
//      GABARIT JavaScript. Le gabarit se fermait au milieu du commentaire ; le fichier ne parsait
//      plus. Rattrapé par le lint.
//   2. une apostrophe dans un commentaire d'une étape CI — qui vit dans un `node -e '…'` en
//      guillemets SIMPLES de shell. La chaîne se fermait, la suite devenait du shell, et le job
//      mourait sur « // : Is a directory ». Rattrapé par la CI, sur UNE seule version de Node.
//
// Les deux fois, le commentaire était juste et le code correct : c'est le CONTEXTE D'ACCUEIL qui
// interdisait un caractère. Rien dans le fichier ne le disait, et rien ne le vérifiait — la
// connaissance vivait dans la tête de celui qui avait écrit le bloc en premier.

const fs = require("node:fs");
const path = require("node:path");
const RACINE = path.join(__dirname, "..", "..");

/** Les scripts `node -e '…'` des workflows, avec leur fichier et leur ligne de départ. */
function blocsNodeE() {
  const dossier = path.join(RACINE, ".github", "workflows");
  const out = [];
  for (const f of fs.readdirSync(dossier)) {
    if (!f.endsWith(".yml") && !f.endsWith(".yaml")) continue;
    const src = fs.readFileSync(path.join(dossier, f), "utf8");
    const re = /node\s+-e\s+'/g;
    let m;
    while ((m = re.exec(src)) !== null) {
      const debut = m.index + m[0].length;
      const fin = src.indexOf("'", debut);              // la chaîne shell s'arrête à la PREMIÈRE
      out.push({ f, corps: src.slice(debut, fin === -1 ? src.length : fin) });
    }
  }
  return out;
}

describe("aucune apostrophe dans un script shell entre guillemets simples", () => {
  // RELEVÉ DU JOUR — témoin daté : 4 blocs `node -e '…'` le 2026-08-21. Plancher LARGE : il détecte
  // l'effondrement du balayage (une réécriture des workflows qui change la forme), pas la couverture.
  const PLANCHER_BLOCS = 2;

  it("le balayage voit bien des blocs — sans quoi il ne prouverait rien", () => {
    expect(blocsNodeE().length,
      "plus aucun `node -e '…'` trouvé dans les workflows : le motif ne reconnaît sans doute plus\n"
      + "la forme employée. Étendez-le ; ne baissez pas le plancher.")
      .toBeGreaterThanOrEqual(PLANCHER_BLOCS);
  });

  // ⚠️ La vraie assertion : un bloc qui contient une apostrophe est un bloc TRONQUÉ. On ne peut pas
  // le détecter en lisant le résultat (il a l'air d'un script valide, juste plus court) — donc on
  // vérifie que le corps atteint bien la fin attendue d'un script, et non un milieu de phrase.
  it("chaque bloc se termine sur du code, pas au milieu d'un commentaire", () => {
    for (const { f, corps } of blocsNodeE()) {
      const lignes = corps.split("\n").map((l) => l.trim()).filter(Boolean);
      const derniere = lignes[lignes.length - 1] || "";
      expect(derniere.startsWith("//"),
        `dans ${f}, un script \`node -e\` se termine sur une ligne de COMMENTAIRE :\n`
        + `  ${derniere}\n`
        + "C'est le signe qu'une APOSTROPHE a fermé la chaîne shell au milieu du commentaire : tout\n"
        + "ce qui suit est alors interprété par le shell, et le job meurt sur « // : Is a directory ».\n"
        + "Réécrivez le commentaire sans apostrophe (ni accent grave si le bloc vit aussi dans un\n"
        + "littéral de gabarit).")
        .toBe(false);
    }
  });
});
