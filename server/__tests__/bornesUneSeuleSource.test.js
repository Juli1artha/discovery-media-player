// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// DEUX NOMBRES, QUARANTE-TROIS EXEMPLAIRES, ET AUCUN NE REGARDAIT LA SOURCE.
//
// ⚠️ CETTE PR A FERMÉ UN DOUBLON ET EN A OUVERT UN AUTRE, PLUS GRAND. `upsertInternalSession`
// redéfinissait `bornerNombre` : corrigé. Mais `10000` et `86400` — les valeurs de `BORNES` dans
// `server/shares.js` — sont maintenant RECOPIÉES dans les contraintes SQL : dix-huit fois dans la
// migration 0020, neuf fois dans la 0023, seize fois dans `init.sql`. Le commentaire de la 0020 dit
// « les bornes reprennent celles du code », et c'est exactement le genre de phrase qui reste vraie
// jusqu'au jour où elle ne l'est plus.
//
// ⚠️ CE QUE COÛTERAIT LA DIVERGENCE, ET POURQUOI ELLE SERAIT SILENCIEUSE UN MOMENT. Monter
// `BORNES.pages` à 20 000 : le code borne à 20 000, la base refuse au-delà de 10 000 — chaque
// mesure entre les deux devient une écriture REFUSÉE, et le chemin d'écriture des vues avale ses
// refus (c'est la leçon de la session interne muette). Baisser `BORNES` : la base devient plus
// laxiste que le code, et la protection « dernière ligne » que la 0020 revendique ne protège plus
// de ce qu'elle annonce. Dans les deux sens, rien ne rougit.
//
// ⚠️ CE BANC NE COMPARE PAS DES OCCURRENCES, IL COMPARE DES PLAFONDS. Chercher « 10000 » n'importe
// où dans un fichier SQL confondrait une borne avec un identifiant ou un commentaire. On ne lit que
// les deux formes qui EXPRIMENT un plafond : la comparaison d'une contrainte `check`, et le
// rabattement `least(greatest(col, 0), N)` des migrations. Ce sont les seuls endroits où le nombre
// décide de quelque chose.

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");
const lire = (p) => fs.readFileSync(path.join(RACINE, p), "utf8");

/**
 * Les bornes du code, LUES à leur source.
 *
 * ⚠️ REFUSER DE CONCLURE PLUTÔT QUE CONCLURE AU VERT. Si cette ligne change de forme, la sonde ne
 * sait plus ce qu'elle compare — et une garde qui ne peut pas mesurer doit refuser, pas se taire.
 * C'est la même règle tri-état que les gardes de `tools/`.
 */
function bornesDuCode() {
  const src = lire("server/shares.js");
  const m = /const BORNES = \{([^}]*)\}/.exec(src);
  if (!m) throw new Error("GARDE NON CONCLUANTE : `const BORNES = { … }` introuvable dans server/shares.js");
  const nombre = (cle) => {
    const t = new RegExp(cle + "\\s*:\\s*([0-9_ *+]+)").exec(m[1]);
    if (!t) throw new Error(`GARDE NON CONCLUANTE : la clé « ${cle} » n'est plus lisible dans BORNES`);
    // ⚠️ UNE SOMME DE PRODUITS, PAS UN ÉVALUATEUR. `10_000` et `24 * 3600` sont les deux formes
    // qu'on lit ; les calculer à la main tient en une ligne, alors qu'un `Function(…)` mettrait un
    // évaluateur dynamique dans un banc pour économiser cette ligne-là. La garde de forme est déjà
    // passée au-dessus : ce qui arrive ici ne contient que des chiffres, des `*` et des `+`.
    if (!/^[0-9_ *+]+$/.test(t[1])) throw new Error(`GARDE NON CONCLUANTE : « ${cle} » n'est plus un littéral`);
    return t[1].replace(/_/g, "").split("+")
      .reduce((somme, terme) => somme + terme.split("*").reduce((produit, f) => produit * Number(f.trim()), 1), 0);
  };
  return { pages: nombre("pages"), secondes: nombre("secondes") };
}

/** Tout nombre qui EXPRIME un plafond dans un fichier SQL — pas toute occurrence d'un nombre. */
function plafondsDuSql(fichier) {
  const sql = lire(fichier);
  const trouves = [];
  for (const m of sql.matchAll(/<=\s*(\d+)/g)) trouves.push({ forme: "check", valeur: Number(m[1]) });
  for (const m of sql.matchAll(/least\(greatest\([^,]+,\s*0\),\s*(\d+)\)/g)) trouves.push({ forme: "rabattement", valeur: Number(m[1]) });
  return trouves;
}

const FICHIERS = [
  "supabase/init.sql",
  "supabase/migrations/0020-mesures-bornees.sql",
  "supabase/migrations/0023-bornes-des-sessions-internes.sql",
];

describe("les bornes de mesure n'ont qu'une source", () => {
  const BORNES = bornesDuCode();

  it("la sonde lit bien la source — sinon elle ne compare rien", () => {
    expect(BORNES.pages, "BORNES.pages").toBe(10000);
    expect(BORNES.secondes, "BORNES.secondes = 24 h").toBe(86400);
  });

  for (const fichier of FICHIERS) {
    it(`⚠️ ${fichier} : chaque plafond est une valeur de \`BORNES\``, () => {
      const plafonds = plafondsDuSql(fichier);
      // ⚠️ ANTI-VACUITÉ. Un fichier renommé, une contrainte réécrite autrement, et la sonde ne
      // trouverait plus rien — elle rendrait « aucun plafond fautif » sur zéro plafond lu, ce qui
      // se lit exactement comme « tout va bien ». On exige d'abord qu'elle ait vu quelque chose.
      expect(plafonds.length, "aucun plafond lu : la sonde ne regarde plus au bon endroit").toBeGreaterThanOrEqual(6);

      const autorisees = new Set([BORNES.pages, BORNES.secondes]);
      const etrangers = plafonds.filter((p) => !autorisees.has(p.valeur));
      expect(etrangers,
        `plafond(s) qui ne viennent pas de BORNES : ${JSON.stringify(etrangers)}\n`
        + `Le code borne à ${BORNES.pages} pages / ${BORNES.secondes} s ; ce fichier dit autre chose.\n`
        + "Monter BORNES sans la base fait REFUSER des écritures que le code croit valides ; la\n"
        + "baisser rend la base plus laxiste que le code, et la « dernière ligne » ne l'est plus.")
        .toEqual([]);
    });
  }

  it("⚠️ les DEUX bornes sont effectivement gardées, pas seulement l'une", () => {
    // Un fichier qui ne porterait que des bornes de pages passerait le test ci-dessus sans jamais
    // confronter `secondes` — et la moitié de la propriété serait perdue sans que rien ne le dise.
    const toutes = FICHIERS.flatMap(plafondsDuSql).map((p) => p.valeur);
    expect(toutes, "aucune borne de pages confrontée").toContain(BORNES.pages);
    expect(toutes, "aucune borne de secondes confrontée").toContain(BORNES.secondes);
  });
});
