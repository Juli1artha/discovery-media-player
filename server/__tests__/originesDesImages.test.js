// FOURNIR UNE URL SANS AUTORISER SON ORIGINE REVIENT À NE PAS LA FOURNIR.
//
// 0.1.47 transportait la clé de marque, la résolvait, et écrivait le bon `src` dans la page. Mais
// l'origine du logo n'était pas ajoutée à `img-src` sur la route d'aperçu : le navigateur demandait
// l'image et se la refusait. Le fichier répondait pourtant 200.
//
// ⚠️ ET AUCUNE SONDE SERVEUR NE PEUT VOIR ÇA. Le HTML rendu est parfait, le script se compile, le
// paquet est conforme. Ni l'étape de fumée, ni la garde d'artefact, ni un test qui exécute la page
// ne mordent — seul un navigateur le montre. C'est le second hôte qui l'a vu, à l'œil, chez son
// client.
//
// ⚠️ C'EST LE QUATRIÈME CHAMP DE LA MÊME FAMILLE, ET LE PREMIER D'UNE AUTRE NATURE. `internal_token`,
// la marque et les noms d'action manquaient tous DANS la page. Celui-ci EST dans la page : ce qui
// manquait, c'est ce que la page a le droit de faire ensuite. La garde « aucun champ par accident »
// ne pouvait donc pas l'attraper — le champ était fourni.
//
// La forme, telle que le second hôte l'a énoncée : toute valeur qui produit une URL destinée au
// navigateur doit, par construction, ajouter son origine à la politique.


const SRC = require("./sourceDesPages.cjs").SOURCE_PAGES;

/**
 * Le corps de la fonction qui rassemble les origines autorisées, COMMENTAIRES RETIRÉS.
 *
 * ⚠️ Troisième sonde de la journée à devoir apprendre ça, et la seule qui soit la mienne à double
 * titre : le test cherchait le mot « HTML » pour vérifier qu'on ne dérive pas la politique du rendu,
 * et l'a trouvé dans le commentaire qui EXPLIQUE qu'on ne le fait pas. Une garde qui lit du
 * commentaire accuse le texte qui la justifie.
 */
function listeDesOrigines() {
  const i = SRC.indexOf("function originesImages(");
  expect(i, "la liste doit exister en UN seul endroit").toBeGreaterThan(0);
  return SRC.slice(i, SRC.indexOf("\n}", i))
    .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
}

/**
 * Les champs du partage qui portent une URL d'image, reconnus à leur NATURE et non listés.
 *
 * ⚠️ Une liste de noms connus ne verrait que ce qu'on y a mis — et c'est précisément comme ça que
 * `bot_vphoto` a échappé pendant des mois. Il ne cassait pas : la photo du présentateur et l'avatar
 * de l'assistant sortent en général du même stockage, donc de la même origine. Il marchait PAR
 * ACCIDENT, ce qui est pire qu'un défaut visible.
 */
function champsPorteursDImage() {
  const i = SRC.indexOf("function viewerHtml(");
  const j = SRC.indexOf("\nfunction ", i + 10);
  const rendu = SRC.slice(i, j);
  return [...new Set(
    [...rendu.matchAll(/share\.([a-z_]*(?:logo|avatar|photo|image|icon)[a-z_]*)/g)].map((m) => m[1]),
  )].sort();
}

describe("toute valeur qui produit une URL d'image autorise son origine", () => {
  it("la fonction des origines existe, et elle est unique", () => {
    expect([...SRC.matchAll(/function originesImages\(/g)]).toHaveLength(1);
  });

  it("le balayage trouve bien des champs porteurs d'image", () => {
    expect(champsPorteursDImage().length, "sans champ trouvé, cette garde ne prouverait rien")
      .toBeGreaterThan(0);
  });

  it.each(champsPorteursDImage())("« %s » figure dans la liste des origines", (champ) => {
    expect(listeDesOrigines().includes(champ),
      `la page rend « share.${champ} » comme une URL d'image, et son origine n'est pas autorisée.\n`
      + "Le navigateur la bloquera : le HTML sera parfait, le fichier répondra 200, et rien côté\n"
      + "serveur ne le verra. Ajoutez-la à originesImages().")
      .toBe(true);
  });

  // ⚠️ ET LES DEUX ROUTES DOIVENT L'EMPRUNTER. Une liste unique ne sert à rien si une route continue
  // de composer la sienne — c'était exactement l'état de 0.1.47 : le lien tracé dérivait trois
  // origines, l'aperçu une seule.
  it.each(["sendPresentHtml(res, viewerHtml(", "sendHtml(res, 200, viewerHtml("])(
    "la route « %s… » passe par la liste unique", (appel) => {
      const i = SRC.indexOf(appel);
      expect(i, appel).toBeGreaterThan(0);
      const ligne = SRC.slice(i, SRC.indexOf("\n", i));
      expect(ligne, "cette route compose sa propre liste : deux politiques finissent par diverger")
        .toContain("originesImages(");
    });

  it("aucune route ne compose encore une liste d'origines à la main", () => {
    const composees = [...SRC.matchAll(/\[originOf\([^\]]*\)\]\.filter\(Boolean\)\.join\(" "\)/g)]
      .map((m) => m[0]);
    // Le mur d'accès garde la sienne : il ne rend ni l'assistant ni sa photo, et le dire ici évite
    // qu'on l'aligne par réflexe sur une liste plus large que ce qu'il affiche.
    const horsVisionneuse = composees.filter((c) => !c.includes("wlogo"));
    expect(horsVisionneuse, "à faire passer par originesImages() : " + horsVisionneuse.join(" | "))
      .toEqual([]);
  });
});

// ⚠️ ON NE DÉRIVE PAS LA POLITIQUE DU HTML RENDU. Ce serait plus général, et ça la viderait de son
// sens : autoriser tout ce que la page référence, c'est autoriser aussi ce qu'une valeur mal filtrée
// y aurait glissé. La liste porte des CHAMPS connus, pas des URL trouvées.
describe("la politique se construit à partir de champs, pas d'URL trouvées", () => {
  it("elle ne relit pas le HTML qu'elle protège", () => {
    expect(listeDesOrigines(), "une politique déduite de la page n'en est plus une")
      .not.toMatch(/html|match\(|src=/i);
  });
});
