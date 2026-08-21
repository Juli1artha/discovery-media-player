// L'extracteur de variables d'environnement, éprouvé cas par cas.
//
// ⚠️ CE BANC EXISTE PARCE QUE LA PREMIÈRE VERSION DE LA GARDE LISAIT LES COMMENTAIRES.
// « // Exemple : process.env.VARIABLE_COMMENTAIRE » rougissait la CI alors qu'aucun code ne lit
// cette variable (contre-audit externe, 21/08) — une sonde qui lit du commentaire invente des
// coupables, et la seule issue serait d'écrire la documentation d'une variable qui n'existe pas.
// Chaque cas ci-dessous est une mutation que le contre-audit a demandée, ou un motif RÉEL du
// dépôt (l'interpolation vient de server/gabarit-agent.js, l'alias de context/standalone.js).

import { describe, it, expect } from "vitest";
import { variablesLues, accesInterdits, depouiller } from "../env-lues.mjs";

describe("variablesLues — ce qui est une lecture", () => {
  it("voit une lecture directe", () => {
    expect(variablesLues("const k = process.env.VARIABLE_FANTOME;")).toContain("VARIABLE_FANTOME");
  });

  it("voit une lecture via l'alias env de createStandaloneContext", () => {
    expect(variablesLues("function f(env = process.env) { return env.VARIABLE_FANTOME; }")).toContain("VARIABLE_FANTOME");
  });

  it("voit une lecture dans une INTERPOLATION de gabarit — le motif de gabarit-agent.js", () => {
    expect(variablesLues("const html = `<b>${process.env.VARIABLE_FANTOME ? \"oui\" : \"non\"}</b>`;")).toContain("VARIABLE_FANTOME");
  });

  it("void expression : une lecture reste une lecture", () => {
    expect(variablesLues("void process.env.VARIABLE_FANTOME;")).toContain("VARIABLE_FANTOME");
  });
});

describe("variablesLues — ce qui n'en est pas", () => {
  it("ignore un commentaire de ligne", () => {
    expect(variablesLues("// Exemple documentaire : process.env.VARIABLE_COMMENTAIRE\nconst a = 1;").size).toBe(0);
  });

  it("ignore un commentaire de bloc", () => {
    expect(variablesLues("/* process.env.VARIABLE_BLOC est décrite ici */ const a = 1;").size).toBe(0);
  });

  it("ignore une chaîne double", () => {
    expect(variablesLues('const msg = "posez process.env.VARIABLE_CHAINE avant de lancer";').size).toBe(0);
  });

  it("ignore une chaîne simple, même avec échappements", () => {
    expect(variablesLues("const msg = 'lisez \\'process.env.VARIABLE_CHAINE\\' ici';").size).toBe(0);
  });

  it("ignore le TEXTE d'un gabarit — du texte n'est pas une lecture", () => {
    expect(variablesLues("const aide = `documentez process.env.VARIABLE_TEXTE`;").size).toBe(0);
  });

  it("gabarit imbriqué : texte ignoré, interpolation lue", () => {
    const src = "const x = `a ${ `b process.env.PAS_LUE ${env.VRAIE_LECTURE} c` } d`;";
    const lues = variablesLues(src);
    expect(lues).toContain("VRAIE_LECTURE");
    expect(lues.has("PAS_LUE")).toBe(false);
  });
});

describe("accesInterdits — les formes que la garde ne sait pas suivre", () => {
  it("refuse l'accès dynamique par crochets", () => {
    expect(accesInterdits("const v = process.env[cle];").length).toBeGreaterThan(0);
  });

  it("refuse la déstructuration", () => {
    expect(accesInterdits("const { FOO } = process.env;").length).toBeGreaterThan(0);
  });

  it("refuse un alias sous un autre nom que env", () => {
    expect(accesInterdits("const cfg = process.env;").length).toBeGreaterThan(0);
  });

  it("accepte l'alias env — le motif de context/standalone.js", () => {
    expect(accesInterdits("function createStandaloneContext(env = process.env) { return env.X; }").length).toBe(0);
  });

  it("accepte les lectures directes et n'accuse pas un commentaire", () => {
    expect(accesInterdits("// const { A } = process.env — interdit, voir env-lues.mjs\nconst a = process.env.OK_VAR;").length).toBe(0);
  });
});

describe("depouiller — le dépouillement lui-même", () => {
  it("préserve les numéros de ligne (les retours à la ligne survivent aux commentaires)", () => {
    expect(depouiller("a; // x\nb; /* y\nz */ c;").split("\n").length).toBe(3);
  });
});

describe("les littéraux de regex — l'incident server/texte.js", () => {
  it("un guillemet DANS une regex ne décale pas l'état des chaînes du reste du fichier", () => {
    // Le motif exact de texte.js : sans lexage des regex, le \" ouvrait une « chaîne » fantôme
    // et la lecture qui suit devenait invisible — faux négatif global, constaté par mutation.
    const src = 's.replace(/"/g, "&quot;");\nvoid process.env.LUE_APRES_REGEX;';
    expect(variablesLues(src)).toContain("LUE_APRES_REGEX");
  });

  it("une regex contenant // ne tronque pas sa ligne", () => {
    expect(variablesLues("const u = /https:\\/\\//; void process.env.LUE_MEME_LIGNE;")).toContain("LUE_MEME_LIGNE");
  });

  it("le CONTENU d'une regex n'est pas une lecture", () => {
    expect(variablesLues("const r = /process\\.env\\.PAS_LUE/;").size).toBe(0);
  });

  it("la division reste de la division — les chaînes qui suivent restent des chaînes", () => {
    const src = 'const t = x / y; const s = "process.env.PAS_LUE"; void process.env.LUE_VRAIMENT;';
    const lues = variablesLues(src);
    expect(lues).toContain("LUE_VRAIMENT");
    expect(lues.has("PAS_LUE")).toBe(false);
  });

  it("regex après return — le cas où le caractère précédent est une lettre", () => {
    const src = 'function f(s) { return /["<>]/.test(s); }\nvoid process.env.LUE_APRES_RETURN;';
    expect(variablesLues(src)).toContain("LUE_APRES_RETURN");
  });
});
