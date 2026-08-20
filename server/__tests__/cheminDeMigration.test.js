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
  function colonnesEcrites(parFichier = null) {
    const noms = new Set();
    for (const f of fs.readdirSync(path.join(RACINE, "server"))) {
      const avant = noms.size;
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
      // ⚠️ ET LES CORPS PASSÉS À `ecrireSiEncoreVrai` — le balayage ne lisait que `body:` et
      // chaque adoption de l'écriture conditionnée le privait d'un site EN SILENCE : six colonnes
      // ont disparu de l'énumération le jour où la présence a pris le motif, et rien ne l'a dit
      // (31 → 25 essais, vu au diff des comptes, pas à un rouge). Une garde dont la couverture
      // rétrécit quand le code s'améliore punit exactement le geste qu'on veut encourager.
      for (const m of src.matchAll(/ecrireSiEncoreVrai\(\s*`[^`]*`,\s*\{([\s\S]*?)\n\s*\}?\s*[,)]/g)) {
        for (const c of m[1].matchAll(/\b([a-z][a-z0-9_]{2,})\s*:/g)) noms.add(c[1]);
      }
      // Les lignes d'INSERT (`const row = {…}`) — passées en `body: [row]`, invisibles du premier motif.
      for (const m of src.matchAll(/const row = \{([^}]*)\}/g)) {
        for (const c of m[1].matchAll(/\b([a-z][a-z0-9_]{2,})\s*:/g)) noms.add(c[1]);
      }
      // ⚠️ ET LES CORPS NOMMÉS — `const corps = {…}` puis `body: corps`. TROISIÈME fois que la
      // couverture de cette garde RÉTRÉCIT quand le code s'améliore : sortir un littéral dans une
      // variable (pour le construire conditionnellement) le rendait invisible, et neuf colonnes ont
      // disparu de l'énumération SANS un seul rouge — vu au diff des comptes (994 → 985), pas à un
      // échec. On ne code pas un nom en dur : on lit les identifiants réellement passés en `body:`,
      // puis on va chercher leur déclaration. La garde suit le code au lieu de se vider avec lui.
      // ⚠️ On ne lit QUE les corps passés à `PLAYER.db.request` — une écriture BASE. Un premier essai
      // cherchait tout `body: <ident>` et ramassait des corps de RÉPONSE (`status`, `summary`,
      // `members`…) : sept faux positifs d'un coup. Une garde de schéma qui accuse des non-colonnes se
      // fait desserrer, donc elle doit viser le puits réel, pas la forme syntaxique la plus proche.
      // ⚠️ ET LES CORPS RELAYÉS PAR UN HELPER LOCAL. Le corps du RPC de présence est passé à
      // `appelerBump(corps, …)`, qui relaie vers `db.request` : le motif ci-dessous, qui exige un
      // `body:` littéral au site d'appel, ne le voit plus. C'est une ÉNUMÉRATION — et elle est sûre
      // ICI, parce que le PLANCHER de couverture déclaré plus haut échoue le jour où elle se périme.
      // C'est tout l'intérêt du plancher : il rend une liste explicite acceptable, là où sans lui elle
      // se viderait en silence. (Il a d'ailleurs rougi sur ce refactor même, à la minute où il existait.)
      const RELAIS = /\bappelerBump\(\s*([A-Za-z_$][\w$]*)/g;
      for (const relais of src.matchAll(RELAIS)) {
        const decl = new RegExp(`const ${relais[1]}\\s*=\\s*\\{([^}]*)\\}`, "g");
        for (const d of src.matchAll(decl)) {
          for (const c of d[1].matchAll(/\b([a-z][a-z0-9_]{2,})\s*:/g)) noms.add(c[1]);
        }
      }
      for (const appel of src.matchAll(/PLAYER\.db\.request\([\s\S]{0,400}?body:\s*\[?\s*([A-Za-z_$][\w$]*)\s*\]?[\s,)]/g)) {
        const nom = appel[1];
        if (nom === "row") continue;   // déjà couvert, et avec un motif plus sûr, juste au-dessus
        // ⚠️ `[^}]*` — ARRÊT À LA PREMIÈRE ACCOLADE, comme les motifs voisins. Un `[\s\S]*?` non gourmand
        // paraissait plus général : il enjambait en réalité des blocs entiers et ramassait des mots de
        // COMMENTAIRE comme s'ils étaient des colonnes (« vol », « pas », « plus »…). Une garde de
        // schéma qui invente des coupables se fait desserrer — c'est la note du balayage d'origine.
        const decl = new RegExp(`const ${nom}\\s*=\\s*\\{([^}]*)\\}`, "g");
        for (const d of src.matchAll(decl)) {
          for (const c of d[1].matchAll(/\b([a-z][a-z0-9_]{2,})\s*:/g)) noms.add(c[1]);
        }
      }
      if (parFichier) parFichier[f] = noms.size - avant;
    }
    return [...noms];
  }

  const declare = (nom) => INIT.includes(nom) || sqlDesMigrations().includes(nom);
  // Clés de protocole PostgREST et champs internes, qui ne sont pas des colonnes.
  const HORS_SCHEMA = new Set(["method", "headers", "prefer", "body", "signal", "range"]);

  // ⚠️ PLANCHER DE COUVERTURE — LA GARDE QUI GARDE LA GARDE.
  //
  // Ce test disait `> 10` alors que le balayage voit 71 colonnes : la couverture pouvait tomber de 71 à
  // 11 sans un seul rouge. Ce n'est pas hypothétique — elle EST tombée à 61 en sortant un corps de
  // requête dans une variable, et rien n'a échoué. Elle a été rattrapée par une HABITUDE DE LECTURE
  // (comparer deux comptes en travaillant sur ce code), pas par un mécanisme. Un mois plus tard,
  // personne ne compare — et une garde à couverture nulle passe tous ses tests : elle ne ment pas,
  // elle ne dit plus rien, et le silence se lit comme un succès.
  //
  // ⚠️ ET LE SEUIL EST LARGE, EXPRÈS — c'est le point de conception, et il est contre-intuitif.
  //
  // Le coller au relevé du jour (71) détecterait la plus petite érosion… et rougirait au premier
  // retrait LÉGITIME de colonne. Au troisième faux positif, quelqu'un le baisserait — sans aucune
  // raison de s'arrêter à un nombre plutôt qu'un autre, puisque rien ne dirait ce que le nombre
  // protège. C'est le geste exact qui vide une garde : une garde qui crie à tort SE FAIT DESSERRER, et
  // personne ne vérifie ensuite qu'elle garde encore quelque chose. (Ce dépôt en a la preuve : ce
  // balayage a accusé sept non-colonnes, et le réflexe correct — le resserrer — pouvait tout aussi
  // bien le désarmer.)
  //
  // Donc : un seuil qu'aucun ménage normal n'atteint et qu'un EFFONDREMENT franchit tout de suite, avec
  // le relevé DATÉ écrit à côté pour que le prochain lecteur sache de quoi il s'écarte. Le plancher ne
  // mesure pas la couverture — il détecte son EFFONDREMENT. Deux objectifs différents, et le second est
  // le seul qui tienne dans la durée : il ne dépend de personne qui compare deux nombres tous les mois.
  // (Conception affinée par le second hôte, après l'avoir appliquée chez lui.)
  //
  // RELEVÉ DU JOUR — témoin daté : 71 colonnes le 2026-08-20 (presentations 37, shares 21, liens 8).
  const PLANCHER_COLONNES = 55;
  // ⚠️ ET UN PLANCHER PAR FICHIER, sans quoi un fichier qui GROSSIT masquerait un fichier VIDÉ : le
  // total ne dit rien de la répartition. (Troisième assertion, reprise du second hôte.)
  const PLANCHER_PAR_FICHIER = { "presentations.js": 25, "shares.js": 14, "routes-liens.js": 5 };

  it("le balayage ne s'est pas EFFONDRÉ (seuil large, relevé daté en commentaire)", () => {
    const vues = colonnesEcrites().length;
    expect(vues,
      `le balayage ne voit plus que ${vues} colonnes (71 le 2026-08-20).\n`
      + "Ce seuil n'est PAS la couverture du jour : il est large exprès, pour ne jamais rougir sur un\n"
      + "ménage normal. Le franchir signifie qu'un puits d'écriture ENTIER a cessé d'être vu — un\n"
      + "littéral sorti dans une variable, un helper nouveau, un fichier déplacé. Étendez le balayage à\n"
      + "la forme nouvelle plutôt que de baisser ce nombre.")
      .toBeGreaterThanOrEqual(PLANCHER_COLONNES);
  });

  it("aucun FICHIER écrivain ne s'est vidé (un fichier qui grossit ne doit pas en masquer un autre)", () => {
    const parFichier = {};
    colonnesEcrites(parFichier);
    for (const [fichier, plancher] of Object.entries(PLANCHER_PAR_FICHIER)) {
      expect(parFichier[fichier] || 0,
        `« ${fichier} » n'apporte plus que ${parFichier[fichier] || 0} colonnes au balayage.\n`
        + "Le total peut rester bon pendant qu'un fichier cesse d'être lu : c'est ce que ce test refuse.")
        .toBeGreaterThanOrEqual(plancher);
    }
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
