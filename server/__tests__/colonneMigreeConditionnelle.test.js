// CONNAÎTRE LE PIÈGE N'EMPÊCHE PAS D'Y TOMBER.
//
// `docs/MIGRATIONS.md` le dit en toutes lettres : PostgREST rejette le PATCH ENTIER si une colonne
// est inconnue. Deux heures après l'avoir écrit, j'ai posé `write_seq: 0` sans condition dans la
// reprise de présentation — la REPRISE aurait cessé de fonctionner chez tout hôte non migré. Pas la
// garantie nouvelle : la fonction elle-même.
//
// ⚠️ La sonde existait, et je ne l'avais pas appelée là. Ce qui manquait n'était pas la
// connaissance, c'était la garde : rien ne vérifiait qu'un champ appartenant à une migration soit
// écrit CONDITIONNELLEMENT.
//
// C'est la forme habituelle — une règle qu'on retient est une règle qu'on oubliera ; une règle que
// la construction impose ne s'oublie pas.

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");
const MIGRATIONS = path.join(RACINE, "supabase", "migrations");

/** Les colonnes ajoutées par une migration : celles qui peuvent manquer chez un hôte. */
function colonnesMigrees() {
  const noms = new Set();
  for (const f of fs.readdirSync(MIGRATIONS).filter((n) => n.endsWith(".sql"))) {
    const sql = fs.readFileSync(path.join(MIGRATIONS, f), "utf8");
    for (const m of sql.matchAll(/add column\s+if not exists\s+([a-z_]+)/gi)) noms.add(m[1]);
  }
  return [...noms];
}

/** Les fichiers serveur, commentaires retirés — une sonde qui lit du commentaire invente des cas. */
function sources() {
  return fs.readdirSync(path.join(RACINE, "server"))
    .filter((f) => f.endsWith(".js") && !f.includes(".generated.") && !f.startsWith("__"))
    .map((f) => ({
      nom: f,
      code: fs.readFileSync(path.join(RACINE, "server", f), "utf8")
        .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n"),
    }));
}

describe("une colonne qui vient d'une migration ne s'écrit jamais sans condition", () => {
  const migrees = colonnesMigrees();

  it("il y a bien des colonnes migrées à surveiller", () => {
    expect(migrees.length, "sans migration, cette garde ne prouverait rien").toBeGreaterThan(0);
  });

  it.each(colonnesMigrees())("« %s » n'est écrite que derrière une condition", (colonne) => {
    const fautifs = [];
    for (const { nom, code } of sources()) {
      // Les portées protégées : `...(cond ? { … } : {})`. Tout ce qui est dedans est conditionnel.
      const protegees = [...code.matchAll(/\.\.\.\([^)]*\?\s*\{[^}]*\}\s*:\s*\{\}\)/g)]
        .map((m) => [m.index, m.index + m[0].length]);
      for (const m of code.matchAll(new RegExp(`\\b${colonne}\\s*:`, "g"))) {
        const dedans = protegees.some(([d, f]) => m.index >= d && m.index < f);
        if (!dedans) fautifs.push(`${nom}:${code.slice(0, m.index).split("\n").length}`);
      }
    }
    expect(fautifs,
      `« ${colonne} » est écrite sans condition (${fautifs.join(", ")}).\n`
      + "PostgREST rejette le PATCH ENTIER si la colonne manque : chez un hôte non migré, ce n'est\n"
      + "pas la fonction nouvelle qui casse, c'est toute la requête. Passez par\n"
      + "schema.aLaColonne() et écrivez le champ derrière un `...(dispo ? { … } : {})`.")
      .toEqual([]);
  });
});
