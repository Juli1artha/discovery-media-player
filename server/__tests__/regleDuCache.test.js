// UNE LISTE SE PÉRIME, UNE FORME NON.
//
// Le cache de lecture a d'abord été posé sur DEUX ROUTES ÉNUMÉRÉES — `state=1` et `chat=1`. Le
// second hôte a vu le défaut avant nous :
//
//   « la troisième route de lecture arrivera sans cache, et ça ne se verra pas »
//
// C'est le motif croisé six fois cette semaine, et il est d'autant plus tenace qu'une énumération
// PASSE : elle couvre exactement ce qu'on lui a donné, et rien n'échoue le jour où le monde s'agrandit.
//
// La règle est donc écrite dans le code — une table de lectures partagées, servie par un seul
// chemin — et cette garde vérifie que personne ne la contourne. Pas en listant les routes connues,
// mais en reconnaissant la FORME d'une route qui répond sans passer par le cache.
//
// ⚠️ Une garde qui énumère ne voit que ce qu'on y a mis. Celle-ci voit aussi le prochain.

const fs = require("node:fs");
const path = require("node:path");

const SRC = require("./sourceDesPages.cjs").SOURCE_PAGES;

/** Le bloc qui sert une présentation publique, de son ouverture à sa fermeture. */
function blocPresentation() {
  const debut = SRC.indexOf("if (q.present) {");
  expect(debut, "le bloc des lectures publiques doit exister").toBeGreaterThan(0);
  let profondeur = 0;
  for (let i = debut; i < SRC.length; i++) {
    if (SRC[i] === "{") profondeur++;
    else if (SRC[i] === "}") { profondeur--; if (profondeur === 0) return SRC.slice(debut, i + 1); }
  }
  throw new Error("bloc non refermé");
}

describe("toute lecture publique passe par le cache", () => {
  const bloc = blocPresentation();

  it("la table des lectures partagées existe, et le chemin qui la sert aussi", () => {
    expect(bloc, "sans table, on retombe sur une énumération de branches").toContain("LECTURES_PARTAGEES");
    expect(bloc, "un seul chemin sert ces lectures, et il passe par le cache")
      .toMatch(/cacheLecture\.lire\(/);
  });

  // ⚠️ LE CŒUR DE LA GARDE, ET C'EST UNE FORME.
  //
  // Le chemin mis en cache ne sérialise JAMAIS au moment de répondre : il rend `res.end(corps)`, la
  // sérialisation ayant eu lieu dans le producteur, à l'intérieur du cache. Une branche qui écrit
  // `res.end(JSON.stringify(…))` dans ce bloc est donc, par construction, une route qui répond SANS
  // passer par le cache — quel que soit son nom, et même si personne n'a pensé à l'ajouter ici.
  //
  // La seule exception est le refus de quota : ce n'est pas une charge partagée, c'est une erreur,
  // et la mettre en cache servirait un 429 à qui n'en a pas déclenché.
  it("aucune branche ne sérialise sa réponse au moment de répondre", () => {
    const directes = [...bloc.matchAll(/res\.end\(JSON\.stringify\(([^\n]*)/g)].map((m) => m[1]);
    const horsRegle = directes.filter((l) => !l.includes('error: "rate"'));
    expect(horsRegle,
      "une lecture publique qui répond sans passer par le cache :\n" + horsRegle.join("\n")
      + "\nSi elle est identique pour tous les spectateurs d'un même slug, elle appartient à "
      + "LECTURES_PARTAGEES. Sinon, dites ici pourquoi elle n'y est pas.")
      .toEqual([]);
  });

  it("le refus de quota, lui, reste hors cache — et c'est délibéré", () => {
    expect(bloc, "mettre une erreur en cache la servirait à qui ne l'a pas déclenchée")
      .toMatch(/res\.end\(JSON\.stringify\(\{ ok: false, error: "rate" \}\)\)/);
  });

  // ⚠️ La table doit rester une table : deux entrées aujourd'hui, et la garde ne dit rien du nombre.
  // Ce qu'elle exige, c'est qu'il n'existe pas de chemin PARALLÈLE.
  it("elle contient bien les lectures d'aujourd'hui", () => {
    for (const param of ["state", "chat"]) {
      expect(bloc.slice(bloc.indexOf("LECTURES_PARTAGEES"), bloc.indexOf("for (const lecture")), param)
        .toContain(`param: "${param}"`);
    }
  });

  // Le relais de fichier n'est pas une charge partagée : des octets, avec des en-têtes de plage
  // propres à l'appelant. Son absence de la table est un choix, et il est écrit à côté.
  it("le relais de fichier est explicitement hors table, avec sa raison", () => {
    const i = bloc.indexOf("LECTURES_PARTAGEES");
    expect(bloc.slice(Math.max(0, i - 1600), i), "une absence non justifiée se lit comme un oubli")
      .toMatch(/file=1/);
  });
});
