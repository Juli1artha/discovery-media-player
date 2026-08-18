// ⚠️ LA TRACE EXISTAIT À L'ENDROIT EXACT OÙ PERSONNE NE REGARDE.
//
// Une colonne absente était signalée par un `console.warn`, une fois par processus. Sur une
// fonction serverless, c'est une ligne perdue dans une sortie que personne n'ouvre tant que tout a
// l'air de marcher — et « tout a l'air de marcher » est précisément l'état d'un hôte dont trois
// protections dorment en silence. Remarque du second hôte, et elle était juste.
//
// L'état du schéma est donc rapporté par la carte d'identité, que les hôtes interrogent déjà.

const schema = require("../schema.js");

function contexte(repond) {
  return {
    plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, storage: {},
    db: { async request(chemin) { if (!repond(chemin)) throw new Error("400 column does not exist"); return []; } },
  };
}

const TOUT = () => true;
const SAUF_CLE = (chemin) => !chemin.includes("client_key");

describe("l'état du schéma se lit ailleurs que dans un journal", () => {
  it("⚠️ rien de sondé n'est PAS rien de manquant", async () => {
    schema.init(contexte(TOUT));
    const etat = schema.etatDuSchema();
    expect(etat.manquant).toEqual([]);
    // Sans ce compteur, un processus qui n'a rien demandé se lirait « tout va bien » — une absence
    // de résultat qui ressemble à un résultat.
    expect(etat.sondees, "rien ne distingue « aucun défaut » de « aucune question posée »").toBe(0);
    expect(etat.attendues).toBeGreaterThan(0);
  });

  it("une colonne absente apparaît, avec le fichier à appliquer et la fonction qui dort", async () => {
    schema.init(contexte(SAUF_CLE));
    expect(await schema.attendue("envoiUnique")).toBe(false);

    const etat = schema.etatDuSchema();
    expect(etat.sondees).toBe(1);
    expect(etat.manquant).toHaveLength(1);
    expect(etat.manquant[0].migration).toContain("0005-envoi-unique.sql");
    // ⚠️ Le nom du fichier SEUL renverrait l'exploitant lire du SQL pour savoir ce qu'il perd.
    expect(etat.manquant[0].fonction, "on dit quoi appliquer, jamais ce qu'on y gagne").toBeTruthy();
  });

  it("une colonne présente ne figure pas dans les manques", async () => {
    schema.init(contexte(TOUT));
    expect(await schema.attendue("envoiUnique")).toBe(true);
    const etat = schema.etatDuSchema();
    expect(etat.sondees).toBe(1);
    expect(etat.manquant).toEqual([]);
  });

  // ⚠️ La carte d'identité doit répondre QUAND LA BASE NE RÉPOND PLUS : c'est sa raison d'être.
  it("rapporter ne demande rien à la base", async () => {
    let appels = 0;
    schema.init({
      plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, storage: {},
      db: { async request() { appels += 1; return []; } },
    });
    await schema.attendue("rangEcriture");
    const avant = appels;
    schema.etatDuSchema(); schema.etatDuSchema();
    expect(appels, "la carte sonde au lieu de rapporter : elle tombera avec la base").toBe(avant);
  });

  it("un nom d'attente inconnu est une faute de câblage, pas une dégradation", async () => {
    schema.init(contexte(TOUT));
    expect(() => schema.attendue("nExistePas")).toThrow(/inconnue/);
  });

  // ⚠️ L'inventaire est la SOURCE, pas une copie pour l'affichage : c'est ce qui empêche de refaire,
  // en plus petit, le défaut qui avait vidé init.sql de ses cinq migrations.
  it("chaque attente déclarée nomme un fichier de migration qui existe", () => {
    const fs = require("node:fs"), path = require("node:path");
    const racine = path.join(__dirname, "..", "..");
    for (const [nom, a] of Object.entries(schema.ATTENDUES)) {
      expect(fs.existsSync(path.join(racine, a.migration)), `${nom} → ${a.migration}`).toBe(true);
      expect(a.table && a.colonne && a.fonction, nom).toBeTruthy();
    }
  });
});
