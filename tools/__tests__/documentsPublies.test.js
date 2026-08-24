// LES DOCUMENTS QUE LE PAQUET PROMET, ÉPROUVÉS SUR LA RÈGLE PUIS SUR LE PAQUET RÉEL.
//
// ⚠️ Le défaut d'origine n'était pas « le CHANGELOG manque » : c'était que RIEN NE DISTINGUAIT
// son absence d'une décision. Un banc qui se contenterait de lire `package.json#files` relirait
// l'étiquette ; celui-ci interroge l'inventaire que npm servira — le fait.

import { describe, it, expect } from "vitest";

import { PROMIS, promessesRompues } from "../documents-publies.mjs";
import { fichiersDuTarball } from "../inventaire-tarball.mjs";

const pack = (chemins) => JSON.stringify([{ files: chemins.map((path) => ({ path })) }]);

describe("la règle", () => {
  const tout = Object.keys(PROMIS);

  it("se tait quand toutes les promesses sont tenues", () => {
    expect(promessesRompues(tout)).toEqual([]);
  });

  it("⚠️ refuse en NOMMANT le fautif, pas avec une liste tronquée", () => {
    const rompues = promessesRompues(tout.filter((f) => f !== "docs/RETENTION.md"));
    let message = "";
    try {
      expect(rompues, `promesse(s) rompue(s) :\n${rompues.join("\n")}`).toEqual([]);
    } catch (erreur) {
      message = String(erreur.message);
    }
    // ⚠️ vitest AJOUTE toujours sa forme tronquée (« expected [ Array(1) ] to deeply equal [] »)
    // après le message ; on ne peut pas la supprimer. Ce qui se gagne, c'est qu'elle arrive APRÈS
    // les noms au lieu d'être tout ce qu'on lit — donc on éprouve la présence des noms, pas
    // l'absence du tronqué.
    expect(message).toContain("docs/RETENTION.md");
    expect(message).toContain("le périmètre déclaré de la rétention");
    expect(message.indexOf("docs/RETENTION.md")).toBeLessThan(message.indexOf("Array("));
  });

  it("⚠️ désigne EXACTEMENT le document retiré, et dit ce qu'on perd", () => {
    const soucis = promessesRompues(tout.filter((f) => f !== "CHANGELOG.md"));
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain("CHANGELOG.md");
    expect(soucis[0]).toMatch(/ce qui a changé depuis la version/);
  });

  it("nomme chaque promesse rompue, pas seulement la première", () => {
    const soucis = promessesRompues(["README.md"]);
    expect(soucis).toHaveLength(tout.length - 1);
    for (const chemin of tout.filter((f) => f !== "README.md")) {
      expect(soucis.join("\n")).toContain(chemin);
    }
  });

  it("⚠️ ne refuse PAS un document qui voyage sans être promis — la confrontation est à sens unique", () => {
    expect(promessesRompues([...tout, "docs/README.md", "docs/INTERNE.md"])).toEqual([]);
  });

  it("chaque promesse porte la raison pour laquelle elle voyage", () => {
    for (const [chemin, pourquoi] of Object.entries(PROMIS)) {
      expect(pourquoi, chemin).toBeTruthy();
      expect(pourquoi.length, chemin).toBeGreaterThan(20);
    }
  });
});

describe("la sonde ne conclut pas sur une ignorance", () => {
  it("⚠️ lève sur un inventaire vide au lieu de rendre une liste vide", () => {
    // Une liste vide ferait dire « aucune promesse rompue » à une garde qui n'a rien pu lire.
    expect(() => fichiersDuTarball(() => pack([]))).toThrow(/aucun fichier/);
  });

  it("lit la forme objet comme la forme tableau rendue par npm", () => {
    expect(fichiersDuTarball(() => JSON.stringify({ files: [{ path: "a" }] }))).toEqual(["a"]);
  });
});

describe("le paquet réel", () => {
  const inventaire = fichiersDuTarball();

  it("tient toutes ses promesses", () => {
    // ⚠️ Le message est passé à `expect` : sans lui, vitest refuse sur « expected [ Array(1) ] to
    // deeply equal [] » et il faut relancer la garde à la main pour savoir ce qui manque. Une
    // garde qui refuse sans nommer le fautif est le défaut corrigé sur le décompte des sessions.
    const rompues = promessesRompues(inventaire);
    expect(rompues, `promesse(s) rompue(s) :\n${rompues.join("\n")}`).toEqual([]);
  });

  it("⚠️ le CHANGELOG part vraiment — le défaut d'origine", () => {
    expect(inventaire).toContain("CHANGELOG.md");
  });

  it("⚠️ le périmètre de la garde de LANGUE s'est élargi tout seul", () => {
    // Rien n'a été câblé : elle interroge le même inventaire, donc elle lit le CHANGELOG depuis
    // qu'il voyage. Un périmètre qui se dérive n'a pas de liste à tenir à jour.
    const markdowns = inventaire.filter((f) => f.toLowerCase().endsWith(".md"));
    expect(markdowns).toContain("CHANGELOG.md");
  });
});
