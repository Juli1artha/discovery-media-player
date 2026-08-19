// LA CONCATÉNATION EST-ELLE COMPLÈTE ? Énuméré depuis le DISQUE, jamais de tête : tout
// gabarit-*.js présent dans server/ doit être dans la source que les essais regardent — sinon
// le prochain gabarit extrait sort du regard de toutes les gardes de texte, en silence.
const fs = require("node:fs");
const path = require("node:path");
const { SOURCE_PAGES, FICHIERS } = require("./sourceDesPages.cjs");

describe("la source des pages couvre tout ce qui existe", () => {
  it("chaque gabarit-*.js du disque est dans la liste", () => {
    const surDisque = fs.readdirSync(path.join(__dirname, "..")).filter((f) => /^(gabarit-|page-|routes-|tiers\.|texte\.|session-cles\.|appelant\.).*\.js$/.test(f));
    expect(surDisque.length).toBeGreaterThanOrEqual(3);
    for (const f of surDisque) {
      expect(FICHIERS, `${f} existe sur le disque et échappe aux gardes de texte`).toContain(`../${f}`);
    }
  });

  it("la concaténation porte bien les gabarits déplacés — un témoin par module", () => {
    for (const temoin of ["LIVE_CSS", "MAP_CSS", "BOT_CSS", "const TIERS"]) {
      expect(SOURCE_PAGES.includes(temoin), `${temoin} absent : un fichier de la liste est vide ou déplacé`).toBe(true);
    }
  });
});
