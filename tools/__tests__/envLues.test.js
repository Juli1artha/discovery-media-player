// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'extracteur de variables d'environnement, éprouvé cas par cas.
//
// ⚠️ CE BANC EXISTE PARCE QUE DEUX GÉNÉRATIONS DE SONDE TEXTUELLE SE SONT TROMPÉES.
//
//   v1 (grep) : un COMMENTAIRE citant une variable rougissait la CI — une sonde qui lit du
//   commentaire invente des coupables, et la seule issue était de documenter une variable qui
//   n'existe pas (contre-audit externe, 21/08).
//
//   v2 (lexer artisanal) : quatre défauts reproductibles, trouvés par un troisième audit —
//   une regex après une parenthèse fermante masquait TOUT le reste du fichier, les espaces
//   valides de `process . env . X` échappaient, un alias parenthésé aussi, et le TEXTE d'une
//   regex inventait une variable jamais lue. Trois faux négatifs et un faux positif : la pire
//   combinaison, parce qu'une garde qui rate en silence est pire qu'une garde absente — elle
//   fait croire que la vérification a eu lieu.
//
// v3 lit l'AST TypeScript. Ce n'est plus une heuristique sur du texte : un commentaire, une
// chaîne, une regex ne sont pas des nœuds exécutés, donc la question « est-ce une lecture ? »
// ne se pose même plus. Les cas ci-dessous restent, chacun étant un défaut RÉEL constaté — la
// mémoire de ce qui a échoué vaut mieux qu'une confiance dans ce qui marche aujourd'hui.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { variablesLues, accesInterdits, inventaire, analyser } from "../env-lues.mjs";

describe("les quatre reproductions du troisième audit", () => {
  it("4.1 — une regex contenant un guillemet, après une parenthèse fermante, ne masque plus la suite", () => {
    const src = 'if (true) /"/.test("x");\nvoid process.env.VARIABLE_FANTOME;';
    expect(variablesLues(src)).toContain("VARIABLE_FANTOME");
  });

  it("4.2 — les espaces autour des points sont du JavaScript valide, donc une lecture", () => {
    expect(variablesLues("void process . env . VARIABLE_FANTOME;")).toContain("VARIABLE_FANTOME");
  });

  it("4.3 — un alias parenthésé lit bien la variable à l'exécution", () => {
    const src = "const cfg = (process.env);\nvoid cfg.VARIABLE_FANTOME;";
    expect(variablesLues(src)).toContain("VARIABLE_FANTOME");
  });

  it("4.4 — le TEXTE d'une regex n'est jamais une lecture", () => {
    expect(variablesLues("if (ok) /process.env.PAS_LUE/.test(texte);").has("PAS_LUE")).toBe(false);
  });
});

describe("ce qui est une lecture", () => {
  it("accès direct", () => {
    expect(variablesLues("const k = process.env.VARIABLE_FANTOME;")).toContain("VARIABLE_FANTOME");
  });

  it("alias par paramètre par défaut — le motif de context/standalone.js", () => {
    const src = "function f(env = process.env) { return env.VARIABLE_FANTOME; }";
    expect(variablesLues(src)).toContain("VARIABLE_FANTOME");
  });

  it("alias sous un nom quelconque — l'AST le suit, là où le lexer exigeait `env`", () => {
    const src = "const reglages = process.env;\nvoid reglages.VARIABLE_FANTOME;";
    expect(variablesLues(src)).toContain("VARIABLE_FANTOME");
  });

  it("alias transitif", () => {
    const src = "const a = process.env; const b = a;\nvoid b.VARIABLE_FANTOME;";
    expect(variablesLues(src)).toContain("VARIABLE_FANTOME");
  });

  it("accès indexé à nom statique", () => {
    expect(variablesLues('void process["env"]["VARIABLE_FANTOME"];')).toContain("VARIABLE_FANTOME");
  });

  it("optional chaining", () => {
    expect(variablesLues("void process.env?.VARIABLE_FANTOME;")).toContain("VARIABLE_FANTOME");
  });

  it("déstructuration statique — suivie, plus seulement interdite", () => {
    expect(variablesLues("const { VARIABLE_FANTOME } = process.env;")).toContain("VARIABLE_FANTOME");
  });

  it("déstructuration renommée : c'est la PROPRIÉTÉ qui est lue", () => {
    const lues = variablesLues("const { VARIABLE_FANTOME: local } = process.env;");
    expect(lues).toContain("VARIABLE_FANTOME");
    expect(lues.has("LOCAL")).toBe(false);
  });

  it("lecture dans une interpolation de gabarit — le motif de gabarit-agent.js", () => {
    const src = 'const html = `<b>${process.env.VARIABLE_FANTOME ? "oui" : "non"}</b>`;';
    expect(variablesLues(src)).toContain("VARIABLE_FANTOME");
  });

  it("gabarit imbriqué : le texte est ignoré, l'interpolation lue", () => {
    const src = "const x = `a ${ `b process.env.PAS_LUE ${env.VRAIE_LECTURE} c` } d`;";
    const lues = variablesLues("const env = process.env;\n" + src);
    expect(lues).toContain("VRAIE_LECTURE");
    expect(lues.has("PAS_LUE")).toBe(false);
  });
});

describe("ce qui n'en est pas", () => {
  it("commentaire de ligne", () => {
    expect(variablesLues("// Exemple documentaire : process.env.VARIABLE_COMMENTAIRE\nconst a = 1;").size).toBe(0);
  });

  it("commentaire de bloc", () => {
    expect(variablesLues("/* process.env.VARIABLE_BLOC est décrite ici */ const a = 1;").size).toBe(0);
  });

  it("chaîne double", () => {
    expect(variablesLues('const msg = "posez process.env.VARIABLE_CHAINE avant de lancer";').size).toBe(0);
  });

  it("chaîne simple avec échappements", () => {
    expect(variablesLues("const msg = 'lisez \\'process.env.VARIABLE_CHAINE\\' ici';").size).toBe(0);
  });

  it("texte de gabarit", () => {
    expect(variablesLues("const aide = `documentez process.env.VARIABLE_TEXTE`;").size).toBe(0);
  });

  it("séquences d'échappement dans un gabarit", () => {
    expect(variablesLues("const s = `\\${process.env.PAS_LUE} littéral`;").size).toBe(0);
  });
});

describe("les regex, après chaque construction qui précédait un faux négatif", () => {
  const apres = [
    ["une parenthèse fermante", 'if (true) /"/.test("x");'],
    ["un bloc", 'function f() {}\n/"/.test("x");'],
    ["throw", 'try { throw /"/; } catch { /* rien */ }'],
    ["return", 'function g(s) { return /["<>]/.test(s); }'],
    ["une affectation", 'const r = /"/;'],
    ["un point-virgule", 'const a = 1; /"/.test("x");'],
  ];
  for (const [nom, avant] of apres) {
    it(`une lecture qui suit une regex après ${nom} reste visible`, () => {
      expect(variablesLues(`${avant}\nvoid process.env.VARIABLE_FANTOME;`)).toContain("VARIABLE_FANTOME");
    });
  }

  it("une regex contenant une classe de caractères et un faux commentaire ne masque rien", () => {
    const src = 'const u = /^[a-z]+:\\/\\/[^"]+$/;\nvoid process.env.VARIABLE_FANTOME;';
    expect(variablesLues(src)).toContain("VARIABLE_FANTOME");
  });

  it("une division reste une division, et la chaîne qui suit reste une chaîne", () => {
    const src = 'const t = x / y; const s = "process.env.PAS_LUE"; void process.env.LUE_VRAIMENT;';
    const lues = variablesLues(src);
    expect(lues).toContain("LUE_VRAIMENT");
    expect(lues.has("PAS_LUE")).toBe(false);
  });
});

describe("accesInterdits — ce que la garde ne peut PAS suivre est refusé, jamais raté en silence", () => {
  it("refuse un nom entièrement dynamique", () => {
    expect(accesInterdits("const v = process.env[cle];").length).toBeGreaterThan(0);
  });

  it("refuse un nom dynamique derrière un alias", () => {
    expect(accesInterdits("const env = process.env; const v = env[cle];").length).toBeGreaterThan(0);
  });

  it("refuse une capture par reste — elle emporte des noms qu'on ne saura pas nommer", () => {
    expect(accesInterdits("const { PLAYER_LOCAL_ROOT, ...reste } = process.env;").length).toBeGreaterThan(0);
  });

  it("refuse une propriété calculée dans une déstructuration", () => {
    expect(accesInterdits("const { [cle]: v } = process.env;").length).toBeGreaterThan(0);
  });

  it("accepte un nom statique entre crochets — il est lisible", () => {
    expect(accesInterdits('const v = process.env["PLAYER_LOCAL_ROOT"];').length).toBe(0);
  });

  it("accepte les motifs réels du dépôt", () => {
    const src = "function createStandaloneContext(env = process.env) { return env.PLAYER_LOCAL_ROOT; }";
    expect(accesInterdits(src).length).toBe(0);
  });

  it("n'accuse pas un interdit cité en commentaire", () => {
    expect(accesInterdits("// const { A } = process.env — interdit, voir env-lues.mjs\nconst a = process.env.OK_VAR;").length).toBe(0);
  });
});

describe("la convention `env` du dépôt — sur du code RÉEL, pas des extraits", () => {
  // ⚠️ CE BANC AURAIT ATTRAPÉ LA RÉGRESSION QUE LE PASSAGE À L'AST A FAILLI LIVRER.
  // `context/storage.js` reçoit `function hostFetchBase(env)` depuis standalone.js : rien dans
  // le fichier ne lie `env` à process.env, donc un AST purement local rate PLAYER_HOST_FETCH_BASE
  // et PLAYER_STORAGE_ORIGINS — deux variables perdues en silence, exactement le faux négatif
  // qu'on venait de chasser. Trouvé en comparant les inventaires v2 et v3 avant de livrer ; ce
  // test le rejoue sur le fichier lui-même, pour que la prochaine réécriture s'y casse aussi.
  it("les deux variables de context/storage.js sont vues, paramètre nu compris", () => {
    const lues = variablesLues(readFileSync("context/storage.js", "utf8"), "context/storage.js");
    expect(lues).toContain("PLAYER_HOST_FETCH_BASE");
    expect(lues).toContain("PLAYER_STORAGE_ORIGINS");
  });

  it("un paramètre `env` nu est de l'environnement, par convention", () => {
    expect(variablesLues("function f(env) { return env.VARIABLE_FANTOME; }")).toContain("VARIABLE_FANTOME");
  });

  it("l'inventaire réel couvre tout ce que la génération précédente voyait", () => {
    // La garde de la garde : une réécriture peut être plus juste, jamais plus aveugle.
    const { lues } = inventaire(".");
    for (const attendue of ["PLAYER_LOCAL_ROOT", "ELEVENLABS_API_KEY", "PLAYER_HOST_AUTH_STORAGE_KEY",
      "PLAYER_HOST_FETCH_BASE", "PLAYER_STORAGE_ORIGINS", "SUPABASE_URL", "DOC_FRAME_ANCESTORS"]) {
      expect(lues).toContain(attendue);
    }
    expect(lues.size).toBeGreaterThanOrEqual(38);
  });
});

describe("robustesse", () => {
  it("un fichier syntaxiquement cassé ne passe pas en silence", () => {
    expect(() => variablesLues("const a = {{{ ;")).toThrow();
  });
});

describe("⚠️ LE REFUS DIT OÙ LA VARIABLE EST LUE", () => {
  // Cette garde nommait la variable oubliée et s'arrêtait là : le lecteur recevait `PLAYER_TRUC`
  // et devait la chercher dans bin/, context/ et server/. Elle était la SEULE de ce dossier à
  // refuser sans position, et elle l'avait sous la main. Relevé du 24/08, en faisant rougir les
  // onze gardes une par une pour lire ce qu'elles rendent.

  it("chaque forme de lecture porte sa ligne", () => {
    const src = [
      "const a = process.env.PLAYER_UN;",
      "function f() {",
      "  return process.env[\"PLAYER_DEUX\"];",
      "}",
      "const { PLAYER_TROIS } = process.env;",
      "",
    ].join("\n");
    const { ou } = analyser(src, "server/x.js");
    expect(ou.get("PLAYER_UN")).toBe("server/x.js:1");
    expect(ou.get("PLAYER_DEUX")).toBe("server/x.js:3");
    expect(ou.get("PLAYER_TROIS")).toBe("server/x.js:5");
  });

  it("⚠️ la PREMIÈRE lecture suffit — une variable lue dix fois n'a qu'une correction", () => {
    // Elle se corrige dans docs/CONFIGURATION.md, pas à chaque site. Lister dix positions
    // ferait un message que personne ne lit jusqu'au bout.
    const { ou } = analyser("process.env.PLAYER_UN;\nprocess.env.PLAYER_UN;\n", "server/x.js");
    expect(ou.get("PLAYER_UN")).toBe("server/x.js:1");
  });

  it("⚠️ et `lues` reste un Set — c'est la forme que les autres bancs attendent", () => {
    // La position vient À CÔTÉ. Changer `lues` aurait cassé le test de propriété des lecteurs,
    // qui fait `[...analyser(...).lues]`.
    const { lues } = analyser("process.env.PLAYER_UN;\n", "server/x.js");
    expect(lues).toBeInstanceOf(Set);
    expect([...lues]).toEqual(["PLAYER_UN"]);
  });
});
