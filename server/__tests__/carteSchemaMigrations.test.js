// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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
  // ⚠️ PLANCHER — ET ICI, CONTRAIREMENT AUX AUTRES, IL EST EXACT. Le raisonnement général (seuil large,
  // cf. cheminDeMigration.test.js) vient de ce qu'un plancher qui rougit sur un ménage normal finit
  // desserré. Mais ce balayage-ci compte les `add column` du dossier des migrations, et ce nombre est
  // STRICTEMENT MONOTONE par construction : une migration n'est jamais supprimée (elle a déjà tourné
  // chez des hôtes), et une autre garde de ce fichier interdit `drop column`. Il n'existe donc AUCUN
  // ménage légitime qui le fasse baisser — l'exactitude n'a pas de coût en faux positifs, et donne la
  // sensibilité maximale. Une règle s'applique en raisonnant sur ce qu'elle protège, pas en bloc.
  //
  // ⚠️ ET LA CONDITION DE VALIDITÉ DE CETTE EXACTITUDE EST UNE AUTRE GARDE — donc elle se nomme, et
  // ici elle se CONTRÔLE. La monotonie n'est pas une propriété du monde : elle tient parce que
  // `cheminDeMigration.test.js` interdit `drop column`. Un mécanisme peut se vider — c'est tout le
  // sujet de ces gardes — et le jour où celui-là rétrécirait, ce seuil exact deviendrait un seuil
  // ARBITRAIRE sans que rien ne rougisse. Une condition ÉCRITE vaut mieux qu'une condition supposée ;
  // une condition CONTRÔLÉE vaut mieux qu'une condition écrite — et contrairement à celle de `tronque`
  // (qui exigerait des en-têtes hors de portée), celle-ci est vérifiable en trois lignes. (relevé 2e hôte)
  //
  // RELEVÉ DU JOUR — témoin daté : 10 ajouts de colonnes le 2026-08-20.
  const PLANCHER_AJOUTS = 10;

  it("le balayage voit au moins autant d'ajouts de colonnes qu'au jour où on l'a mesuré", () => {
    const vus = colonnesAjouteesParMigration().length;
    expect(vus,
      `le balayage ne voit plus que ${vus} ajouts de colonnes, contre ${PLANCHER_AJOUTS} attendus.\n`
      + "Une migration a probablement écrit son ALTER sous une forme que ce motif ne reconnaît pas.\n"
      + "Ce nombre est monotone (aucune migration ne disparaît) : une BAISSE est donc toujours une\n"
      + "perte de vue du balayage, jamais un ménage. Étendez le motif ; ne baissez pas le plancher.")
      .toBeGreaterThanOrEqual(PLANCHER_AJOUTS);
  });

  it("le plancher EXACT reste justifié : `drop column` est toujours interdit ailleurs", () => {
    const gardeAdditive = fs.readFileSync(
      path.join(RACINE, "server", "__tests__", "cheminDeMigration.test.js"), "utf8");
    expect(gardeAdditive.includes('"drop column"'),
      "PLANCHER_AJOUTS est EXACT parce qu'aucun ménage légitime ne peut le faire baisser — et ça ne\n"
      + "tient que tant que `drop column` est interdit par cheminDeMigration.test.js. Cette interdiction\n"
      + "a disparu : la monotonie n'est plus garantie, donc ce seuil exact n'est plus justifié. Rendez-le\n"
      + "large (comme les autres planchers) ou rétablissez l'interdiction.")
      .toBe(true);
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

// ⚠️ « COMPLET » N'A JAMAIS VOULU DIRE CE QUE SES LECTEURS Y LISENT, ET RIEN NE LE DISAIT.
//
// La session STUDIO l'a mesuré des deux côtés le 30/08 : elle applique la 0024, relit
// `?contract=1&schema=1`, et obtient `attendues: 9 · sondees: 9 · complet · manquant: []` — mot pour
// mot ce qu'elle lisait AVANT la migration. Elle ne pouvait pas voir la 0024 quitter une liste où
// elle n'était jamais entrée : leur player est en 0.1.142, et `view_rotation` n'entre dans ATTENDUES
// qu'avec la version qui apporte la fonction.
//
// La garde du dessus ferme le trou « le CODE oublie une migration ». Celui-ci est l'autre : « l'HÔTE
// exécute un code plus ancien que la migration » — et il est structurel, aucune version ne peut
// connaître ce qui lui est postérieur. La seule réponse qui reste vraie quand le lecteur est plus
// récent que nous, c'est de DIRE CE QU'ON CONNAÎT. D'où `connues`.
//
// ⚠️ ET UNE LISTE QU'ON PUBLIE POUR ÊTRE COMPARÉE DOIT ÊTRE COMPARABLE : c'est ce que les deux
// derniers bancs vérifient, et c'est là que serait le prochain défaut.
describe("la carte dit ce que ce code SAIT attendre, pas seulement ce qui lui manque", () => {
  const schema = require("../schema.js");

  /** Un hôte dont `manquante` est absente : la sonde `select=<col>&limit=0` LÈVE, comme PostgREST. */
  function hote(manquante) {
    schema.oublier();
    schema.init({
      errors: { capture() {} },
      db: {
        async request(chemin) {
          const sonde = /select=([a-z_]+)&limit=0/.exec(chemin);
          if (sonde && sonde[1] === manquante) throw new Error("400 column does not exist");
          return [];
        },
      },
    });
  }

  it("`connues` nomme TOUTES les migrations d'ATTENDUES, sans en taire une", () => {
    hote(null);
    const { connues } = schema.etatDuSchema();
    const attendues = [...new Set(Object.values(schema.ATTENDUES).map((a) => a.migration))];
    expect(connues.length, "`connues` est vide : elle ne renseignerait personne").toBeGreaterThan(0);
    for (const m of attendues) {
      expect(connues, `« ${m} » est attendue par ce code mais absente de \`connues\``).toContain(m);
    }
    expect(connues.length).toBe(attendues.length);
  });

  // ⚠️ ON DONNE UN NOM DE FICHIER, DONC IL DOIT EXISTER. Mal nommé, il enverrait l'hôte appliquer
  // quelque chose d'introuvable — c'est le seul champ de la carte qui lui demande d'aller chercher
  // un fichier chez nous.
  //
  // ⚠️ ET LE RÉPERTOIRE EST RECOLLÉ ICI, PAS PUBLIÉ LÀ-BAS. La carte ne porte plus le préfixe
  // `supabase/…` — une garde d'hôte tire dessus — donc c'est ce banc qui tient la relation
  // « valeur publiée + racine = fichier réel ». Sans lui, retirer le préfixe aurait pu retirer
  // aussi le sens de la valeur sans que rien ne rougisse.
  it("chaque migration nommée existe vraiment dans le dépôt, une fois recollée à sa racine", () => {
    hote(null);
    for (const m of schema.etatDuSchema().connues) {
      expect(m.includes("/"), `« ${m} » porte un chemin : la carte ne doit publier qu'un NOM`).toBe(false);
      expect(fs.existsSync(path.join(RACINE, "supabase", "migrations", m)),
        `« ${m} » est nommée par la carte et n'existe pas`).toBe(true);
    }
  });

  // ⚠️ LE BANC QUI COMPTE. Publier deux listes ne sert à rien si elles ne parlent pas la même langue :
  // tout l'usage de `connues` est de répondre « ma liste contient-elle 0024 ? », et un hôte ne peut le
  // faire que si `manquant` nomme ses fichiers À L'IDENTIQUE. Un jour où l'une porterait le chemin
  // complet et l'autre le nom nu, les deux resteraient « justes » séparément et inutilisables ensemble.
  it("`manquant` nomme ses migrations dans le MÊME vocabulaire que `connues`", async () => {
    const cible = Object.values(schema.ATTENDUES)[0];
    hote(cible.colonne);
    const etat = await schema.sonderTout();
    expect(etat.manquant.length,
      "aucune migration manquante alors que la sonde LÈVE : ce banc ne prouverait rien").toBeGreaterThan(0);
    for (const m of etat.manquant) {
      expect(etat.connues, `« ${m.migration} » manque mais n'est pas dans \`connues\` : les deux listes divergent`)
        .toContain(m.migration);
    }
    expect(etat.verdict, "une colonne absente doit trancher seule").toBe("incomplet");
  });
});
