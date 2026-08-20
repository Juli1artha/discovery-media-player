// LA CARTE DE SCHÉMA DOIT SUIVRE LES MIGRATIONS — SINON ELLE DIT « COMPLET » SUR UN PÉRIMÈTRE PÉRIMÉ.
//
// ⚠️ Relevé par la session ADV (20/08/2026) sur la 0.1.88 : `ATTENDUES` (server/schema.js) est une
// liste tenue À LA MAIN, et rien ne la relie au dossier des migrations. La 0015 a ajouté une colonne
// conditionnelle (`creator_ip_hash`) sans l'y inscrire — la carte annonçait donc « complet » à un
// hôte qui n'avait pas appliqué la 0015, pendant que sa présence tournait sans plafond ni écriture
// atomique. C'est la classe de la SECONDE SOURCE DE VÉRITÉ (deux gestes, deux endroits, rien qui les
// relie) — celle qu'on a retirée trois fois cette semaine (lire(), payload:{}, cleIdempotence).
//
// On ne peut PAS dériver ATTENDUES du dossier migrations/ (toutes les migrations n'ajoutent pas une
// colonne conditionnelle). Mais on peut exiger une DÉCISION par colonne ajoutée : sondée (ATTENDUES)
// ou délibérément non sondée (NON_SONDEES, avec sa raison). La liste rougit alors à l'AJOUT d'une
// colonne oubliée, au lieu d'être complétée de mémoire.

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");
const SCHEMA = fs.readFileSync(path.join(RACINE, "server", "schema.js"), "utf8");
const DOSSIER = path.join(RACINE, "supabase", "migrations");

// Colonnes ajoutées par une migration mais délibérément NON sondées par la carte — parce que le code
// les écrit SANS dégradation conditionnelle (pas de repli à nommer). Vide aujourd'hui : toute colonne
// ajoutée jusqu'ici est un point de dégradation. Une addition future qui n'en est pas une s'inscrit
// ICI, avec sa raison en commentaire — c'est ce qui fait rougir la liste à l'ajout.
const NON_SONDEES = new Set([
  // Voyage avec `last_token_at` dans la MÊME migration (0017) : sonder l'une suffit à savoir que 0017
  // est appliquée, l'autre est écrite au même endroit et n'a pas de dégradation distincte à signaler.
  "last_no_token_at",
]);

const colonnesATTENDUES = new Set([...SCHEMA.matchAll(/colonne:\s*"([a-z_]+)"/g)].map((m) => m[1]));

function colonnesAjouteesParMigration() {
  const out = [];
  for (const f of fs.readdirSync(DOSSIER)) {
    if (!f.endsWith(".sql")) continue;
    const sql = fs.readFileSync(path.join(DOSSIER, f), "utf8");
    for (const m of sql.matchAll(/add column if not exists\s+([a-z_]+)/g)) out.push({ col: m[1], f });
  }
  return out;
}

describe("la carte de schéma suit les migrations qui ajoutent une colonne", () => {
  // ⚠️ MÊME PLANCHER, MÊME RAISON (cf. cheminDeMigration.test.js) : `> 3` sur un balayage qui voit 10
  // `add column` laissait la couverture tomber des deux tiers sans un rouge. Un plancher affirmé fait
  // échouer un balayage qui cesse de voir, au lieu de le laisser rétrécir en silence.
  const PLANCHER_AJOUTS = 10;

  it("le balayage voit au moins autant d'ajouts de colonnes qu'au jour où on l'a mesuré", () => {
    const vus = colonnesAjouteesParMigration().length;
    expect(vus,
      `le balayage ne voit plus que ${vus} ajouts de colonnes, contre ${PLANCHER_AJOUTS} attendus.\n`
      + "Une migration a probablement écrit son ALTER sous une forme que ce motif ne reconnaît pas.\n"
      + "Étendez le motif, ou baissez PLANCHER_AJOUTS dans le même diff si la baisse est légitime.")
      .toBeGreaterThanOrEqual(PLANCHER_AJOUTS);
  });

  it("chaque `add column` d'une migration est SONDÉ (ATTENDUES) ou exempté explicitement", () => {
    for (const { col, f } of colonnesAjouteesParMigration()) {
      expect(colonnesATTENDUES.has(col) || NON_SONDEES.has(col),
        `« ${col} » (${f}) n'est ni dans ATTENDUES ni dans NON_SONDEES.\n`
        + `La carte de schéma dirait « complet » à un hôte qui n'a pas appliqué ${f}, pendant que la\n`
        + `fonction correspondante tourne dégradée. Ajoutez-la à ATTENDUES (pour qu'elle soit sondée)\n`
        + `ou à NON_SONDEES de ce test (si elle s'écrit sans dégradation, avec la raison).`)
        .toBe(true);
    }
  });
});
