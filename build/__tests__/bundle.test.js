// L'ARTEFACT NE DOIT PAS DÉPENDRE DU DOSSIER D'OÙ ON LE CONSTRUIT.
//
// `server/*.generated.js` sont produits par `npm run build` et COMMITTÉS : les plateformes
// serverless déploient les routes telles quelles, elles ne construisent rien. Un test de fraîcheur
// vérifie qu'ils correspondent aux sources — mais ce test ne vaut que si « construire » donne
// toujours le même résultat.
//
// ⚠️ Ça n'a pas toujours été le cas. esbuild écrit le chemin de chaque module dans sa sortie,
// relatif à son dossier de travail : le player vivant dans deux arborescences (son dépôt, et le
// studio qui le consomme), le même code produisait deux fichiers différents de sept octets. La
// CI aurait annoncé « artefact périmé » sur un artefact parfaitement à jour — et, l'habitude
// venant, on aurait fini par ignorer ce signal-là.

const path = require("node:path");

describe("bundle navigateur", () => {
  it("ne contient aucun chemin absolu de la machine qui l'a construit", async () => {
    const { render, renderShared } = await import("../bundle.mjs");
    const racine = path.resolve(__dirname, "..", "..");
    for (const [nom, sortie] of [["navigateur", await render()], ["partagé", await renderShared()]]) {
      expect(sortie, nom).not.toContain(racine);
      expect(sortie, nom).not.toContain(path.dirname(racine));
    }
  });

  // Les chemins de modules que garde esbuild sont relatifs à la racine DU PLAYER — donc identiques
  // que le dépôt soit autonome ou imbriqué dans un hôte.
  it("ne cite ses sources que par leur chemin dans le player", async () => {
    const { renderShared, SHARED_SOURCES } = await import("../bundle.mjs");
    const sortie = await renderShared();
    expect(SHARED_SOURCES[0]).toMatch(/^src\//);
    expect(sortie).toContain(SHARED_SOURCES[0]);
    expect(sortie).not.toContain("player/" + SHARED_SOURCES[0]);
  });
});
