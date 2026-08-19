// UNE ACTION D'AUTORISATION QUI N'EST PAS DANS LE CONTRAT CASSE UN HÔTE SANS RIEN DIRE.
//
// `identity.canManageShares(user, action)` demande à l'hôte s'il accorde un droit, nommé par une
// chaîne. Un hôte prudent tient une table FERMÉE : une action inconnue vaut refus — c'est la bonne
// posture, et c'est celle que le contrat recommande.
//
// ⚠️ CONSÉQUENCE : introduire un nom d'action sans l'écrire dans le contrat fait répondre NON à tout
// le monde chez cet hôte, administrateurs compris. Pas parce que le droit manque : parce que sa table
// est plus ancienne que le player. Et le refus ressemble alors à un problème de rôles, ce qui est
// exactement ce qui le rend coûteux à diagnostiquer.
//
// C'est arrivé : `presentations.stats` a été introduit sans être documenté, et c'est le second hôte
// qui l'a vu venir en lisant l'annonce — pas nous en l'écrivant. « Un contrat peut se rompre en
// silence » est sa formule ; celle-ci a failli se rompre deux heures après qu'il l'a écrite.
//
// ⚠️ Cette garde ne liste pas les actions connues : elle lit celles que le CODE demande et vérifie
// que chacune figure dans le contrat. Une liste se périme, une forme non.

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");
const CONTRAT = fs.readFileSync(path.join(RACINE, "docs", "HOST-CONTRACT.md"), "utf8");

/** Tous les noms d'action passés en clair à l'autorisation de l'hôte, dans tout le serveur. */
function actionsDemandees() {
  const noms = new Set();
  for (const f of fs.readdirSync(path.join(RACINE, "server"))) {
    if (!f.endsWith(".js") || f.includes(".generated.") || f.startsWith("__")) continue;
    const src = fs.readFileSync(path.join(RACINE, "server", f), "utf8");
    for (const m of src.matchAll(/canManageShares\(\s*[A-Za-z_$][\w$]*\s*,\s*"([^"]+)"/g)) noms.add(m[1]);
  }
  return [...noms];
}

describe("toute action d'autorisation demandée est écrite dans le contrat", () => {
  const demandees = actionsDemandees();

  it("le code en demande bien", () => {
    expect(demandees.length, "sans action littérale, cette garde ne prouverait rien")
      .toBeGreaterThan(0);
  });

  // ⚠️ DANS LE TABLEAU, PAS N'IMPORTE OÙ — ET C'EST UNE MUTATION QUI L'A DIT. La première version
  // se contentait d'une mention quelque part dans le fichier : retirer une ligne du tableau la
  // laissait passer, parce que le nom subsistait dans un paragraphe de prose. Or ce qu'un hôte
  // recopie dans sa table, c'est le TABLEAU. Une garde qui accepte une mention accepte un contrat
  // que personne ne peut appliquer.
  const lignesDuTableau = CONTRAT.split("\n").filter((l) => /^\|\s*`[^`]+`\s*\|/.test(l));

  it.each(actionsDemandees())("« %s » figure dans le TABLEAU du contrat", (nom) => {
    expect(lignesDuTableau.some((l) => l.startsWith(`| \`${nom}\``)),
      `l'action « ${nom} » est demandée par le code sans figurer dans le tableau du contrat.\n`
      + "Un hôte à table fermée répondra NON à tout le monde, administrateurs compris — et le refus "
      + "ressemblera à un problème de rôles. Ajoutez-la au tableau de docs/HOST-CONTRACT.md.")
      .toBe(true);
  });

  // ⚠️ ET LES DEUX DROITS RESTENT DEUX. Rien ne les épinglait : une mutation qui les refond en un
  // seul passait, alors qu'elle retire à l'hôte le choix d'ouvrir l'historique à toute l'équipe en
  // réservant les participants. La séparation est une décision de contrat, pas un détail de code.
  it("l'historique et les participants demandent deux droits distincts", () => {
    const src = require("./sourceDesPages.cjs").SOURCE_PAGES;
    const droit = (action) => {
      // ⚠️ On vise la branche qui EXÉCUTE (`else if`), pas la liste de garde en tête de groupe où
      // les mêmes noms apparaissent d'abord. La première version lisait cette liste et rendait donc
      // le droit de la branche voisine — une sonde qui pointe le mauvais « premier ».
      const i = src.indexOf(`else if (body.action === "${action}")`);
      const m = /canManageShares\(\s*[A-Za-z_$][\w$]*\s*,\s*"([^"]+)"/.exec(src.slice(i, i + 700));
      return m && m[1];
    };
    expect(droit("present-doc-list"), "voir QU'UNE présentation a eu lieu")
      .toBe("presentations.list.all");
    expect(droit("present-stats"), "voir QUI y était — noms, adresses, temps de présence")
      .toBe("presentations.stats");
    expect(droit("present-doc-list")).not.toBe(droit("present-stats"));
  });

  // ⚠️ ET L'AVERTISSEMENT LUI-MÊME FAIT PARTIE DU CONTRAT. Documenter la liste ne suffit pas si le
  // lecteur ne sait pas qu'elle GRANDIT : c'est la croissance, pas la liste, qui casse une table
  // fermée à la mise à jour suivante.
  it("le contrat dit que cette liste grandit, et ce que ça coûte", () => {
    expect(CONTRAT, "une table fermée doit être relue à chaque montée de version")
      .toMatch(/closed table|table fermée|list grows|liste grandit/i);
  });

  // Les actions transmises par variable (le groupe `docshare.*`) ne sont pas lisibles ici : elles
  // viennent du corps de la requête. Le tableau du contrat les couvre, et ce test le rappelle plutôt
  // que de laisser croire que la garde voit tout.
  it("les actions historiques restent listées, même si le code les passe par variable", () => {
    for (const nom of ["create", "list", "list.all", "revoke", "setauth", "overview", "sessions", "test"]) {
      expect(lignesDuTableau.some((l) => l.startsWith(`| \`${nom}\``)), nom).toBe(true);
    }
  });
});
