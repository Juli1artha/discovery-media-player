// UNE COLONNE INTRODUITE SANS SA MIGRATION CASSE TOUTES LES ÉCRITURES DE SON CHEMIN.
//
// PostgREST rejette un `PATCH` portant une colonne inconnue. Un hôte qui déploie le code avant la
// migration ne perd donc pas la fonction nouvelle : il perd **toute la requête**, et le message
// parle d'une colonne, pas d'une version. Il n'a aucun moyen de faire le lien.
//
// ⚠️ Ce n'est pas une hypothèse : deux chantiers ont été repoussés pour cette seule raison — le
// numéro de version des écritures, et le destinataire attesté demandé par le second hôte. Le manque
// d'un chemin de migration bloquait les deux.
//
// ⚠️ ET LE PLAYER N'APPLIQUERA JAMAIS CES MIGRATIONS. Il parle à la base par PostgREST, qui
// n'exécute pas de DDL. C'est l'hôte qui applique ; le player DÉTECTE, et nomme le fichier à
// appliquer plutôt que de renvoyer une erreur de base.

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");
const INIT = fs.readFileSync(path.join(RACINE, "supabase", "init.sql"), "utf8");
const DOSSIER = path.join(RACINE, "supabase", "migrations");

const migrations = () =>
  (fs.existsSync(DOSSIER) ? fs.readdirSync(DOSSIER) : []).filter((f) => f.endsWith(".sql")).sort();

const sqlDesMigrations = () =>
  migrations().map((f) => fs.readFileSync(path.join(DOSSIER, f), "utf8")).join("\n");

describe("le chemin de migration existe et dit ses règles", () => {
  it("le dossier existe, et il est numéroté", () => {
    for (const f of migrations()) {
      expect(f, `« ${f} » doit commencer par un numéro : sans ordre, deux hôtes appliquent deux suites`)
        .toMatch(/^\d{4}-[a-z0-9-]+\.sql$/);
    }
  });

  it("aucun numéro n'est utilisé deux fois", () => {
    const numeros = migrations().map((f) => f.slice(0, 4));
    expect(new Set(numeros).size, "deux migrations au même rang : l'ordre devient indéterminé")
      .toBe(numeros.length);
  });

  // ⚠️ ADDITIVE, ET C'EST CE QUI REND L'ORDRE DE DÉPLOIEMENT INOFFENSIF. Migration d'abord : la
  // colonne existe et personne ne l'écrit. Code d'abord : la sonde détecte l'absence et dégrade.
  // Un `drop`, un `rename` ou un `not null` casse cette symétrie et transforme l'ordre en piège.
  it.each(["drop column", "drop table", "rename to", "rename column", "set not null"])(
    "aucune migration ne contient « %s »", (interdit) => {
      const fautives = migrations().filter((f) => {
        let sql = fs.readFileSync(path.join(DOSSIER, f), "utf8").toLowerCase();
        // ⚠️ « alter publication … drop table » n'est PAS un drop de table : il retire la table
        // d'une PUBLICATION — additif au sens de cette garde (les données ne bougent pas, un hôte
        // au code ancien continue de fonctionner). Le motif brut l'attrapait (0009) ; on retire
        // cette forme-là, et elle seule, avant de chercher — la garde reste entière pour le reste.
        sql = sql.replace(/alter\s+publication\s+\S+\s+drop\s+table/g, "");
        return sql.includes(interdit);
      });
      expect(fautives,
        `« ${interdit} » n'est pas additif : un hôte qui n'a pas encore déployé le nouveau code casse.\n`
        + "Ajoutez plutôt, et retirez une fois que plus personne ne lit l'ancien champ.")
        .toEqual([]);
    });

  it("chaque migration est rejouable", () => {
    for (const f of migrations()) {
      const sql = fs.readFileSync(path.join(DOSSIER, f), "utf8").toLowerCase();
      const ajouts = [...sql.matchAll(/\b(add column|create table|create index)\b/g)].map((m) => m[1]);
      for (const a of ajouts) {
        expect(sql, `« ${f} » : « ${a} » sans « if not exists » — un hôte qui doute rejouera`)
          .toMatch(new RegExp(`${a}\\s+if not exists`));
      }
    }
  });

  it("chaque migration dit ce qui se passe TANT QU'ELLE N'EST PAS APPLIQUÉE", () => {
    for (const f of migrations()) {
      const sql = fs.readFileSync(path.join(DOSSIER, f), "utf8");
      expect(sql, `« ${f} » doit décrire la dégradation exacte, pas « ça ne marche pas »`)
        .toMatch(/Sans lui\s*:/i);
    }
  });
});

// ⚠️ LA GARDE QUI FERME LA FAMILLE. Le contrat dit « additive » ; celle-ci vérifie qu'aucune colonne
// n'arrive sans être déclarée quelque part — ni dans l'installation, ni dans une migration.
describe("toute colonne écrite par le code est déclarée", () => {
  /** Les noms de colonnes que le serveur écrit dans un corps de requête. */
  function colonnesEcrites() {
    const noms = new Set();
    for (const f of fs.readdirSync(path.join(RACINE, "server"))) {
      if (!f.endsWith(".js") || f.includes(".generated.") || f.startsWith("__")) continue;
      // ⚠️ ON RETIRE LES COMMENTAIRES AVANT DE LIRE, ET C'EST UNE DÉTECTION QUI L'A EXIGÉ. La
      // première version accusait une colonne « ligne » qui n'existe pas : elle lisait la phrase
      // « figés à la première ligne : un transfert… » d'un commentaire situé DANS un corps
      // d'écriture. Une sonde qui lit du commentaire invente des coupables — et un faux positif
      // dans une garde de schéma coûte plus cher qu'un vrai négatif : on finit par la desserrer.
      //
      // Seulement les commentaires EN DÉBUT DE LIGNE : retirer tout « // » couperait les URL des
      // chaînes, ce qui ferait lire un code qui n'existe pas.
      const src = fs.readFileSync(path.join(RACINE, "server", f), "utf8")
        .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
      // `body: { colonne: …, autre: … }` — on ne lit que les corps d'écriture.
      for (const m of src.matchAll(/body:\s*\{([^}]*)\}/g)) {
        for (const c of m[1].matchAll(/\b([a-z][a-z0-9_]{2,})\s*:/g)) noms.add(c[1]);
      }
    }
    return [...noms];
  }

  const declare = (nom) => INIT.includes(nom) || sqlDesMigrations().includes(nom);
  // Clés de protocole PostgREST et champs internes, qui ne sont pas des colonnes.
  const HORS_SCHEMA = new Set(["method", "headers", "prefer", "body", "signal", "range"]);

  it("le balayage trouve bien des colonnes", () => {
    expect(colonnesEcrites().length).toBeGreaterThan(10);
  });

  it.each(colonnesEcrites().filter((c) => !new Set(["method", "headers", "prefer", "body", "signal", "range"]).has(c)))(
    "« %s » est déclarée dans l'installation ou dans une migration", (colonne) => {
      expect(declare(colonne),
        `le code écrit « ${colonne} », et ni supabase/init.sql ni supabase/migrations/ ne la déclarent.\n`
        + "Un hôte qui déploie ce code verra TOUTES les écritures de ce chemin échouer, avec un\n"
        + "message parlant d'une colonne et non d'une version. Ajoutez la migration.")
        .toBe(true);
    });

  it("les clés de protocole ne sont pas confondues avec des colonnes", () => {
    for (const k of HORS_SCHEMA) expect(declare(k) || true).toBe(true);
  });
});
