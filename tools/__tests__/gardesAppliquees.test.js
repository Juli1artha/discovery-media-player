// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE GARDE APPLIQUÉE À RIEN ET UNE GARDE JAMAIS APPLIQUÉE VALENT LA MÊME CHOSE — ÉPROUVÉ.
//
// ⚠️ CE BANC EST NÉ D'UNE FAUSSE ACCUSATION, ET IL EN GARDE LA FORME. Une analyse du 23/09 a
// déclaré six gardes « jamais lancées ». Les six étaient appliquées au dépôt : cinq par un bloc
// « le dépôt lui-même » qui appelle `garde.auditer()` SANS ARGUMENT, la sixième par `ecarts()` sur
// le vrai CODEOWNERS sous un autre titre. La sonde cherchait un vocabulaire (`racine`, `cwd`) et a
// manqué l'appel nu. Les cas ci-dessous éprouvent donc d'abord les formes qu'une sonde textuelle
// rate — un appel sans argument, un module obtenu par `import()`, un chemin passé à un processus —
// et ensuite celles qu'elle invente : une garde NOMMÉE dans un titre ou un commentaire, qui
// n'applique rien.
//
// Dimensions VARIÉES : la forme de la liaison (import nommé, `import()` assigné, chemin), le titre
// du bloc, l'usage dans le corps, les trois neutralisations reconnues. Dimensions TENUES FIXES : la
// syntaxe des workflows (un seul fichier, un seul job par éprouvette), et l'argument passé à la garde
// dans le bloc — la règle ne le lit pas, et ce banc ne prétend pas qu'elle le lise.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, afterAll, beforeAll } from "vitest";

import {
  estUneGarde, lancementsDe, neutralisation, applicationsDuBanc, auditer, EXEMPTEES,
} from "../gardes-appliquees.mjs";

const GARDE = [
  'import { conclure, conforme } from "./resultat-garde.mjs";',
  'import { estExecuteDirectement } from "./execute-directement.mjs";',
  'if (estExecuteDirectement(import.meta.url)) conclure(conforme("ok"));',
  "",
].join("\n");

const workflow = (run, extra = "") =>
  `name: t\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - name: etape\n${extra}        run: ${run}\n`;

const arbres = [];
afterAll(() => { for (const d of arbres) rmSync(d, { recursive: true, force: true }); });
const arbre = (fichiers) => {
  const d = mkdtempSync(join(tmpdir(), "gardes-appliquees-"));
  arbres.push(d);
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(join(d, chemin, ".."), { recursive: true });
    writeFileSync(join(d, chemin), contenu);
  }
  return d;
};

const bloc = (run, continueOnError = false) => ({ fichier: "w.yml", job: "j", nom: "e", run, continueOnError });
const NOMS = new Set(["a.mjs", "b.mjs"]);

describe("ce qu'est une garde — lu dans l'arbre, jamais dans le texte", () => {
  it("un point d'entrée qui conclut est une garde", () => {
    expect(estUneGarde(GARDE)).toBe(true);
  });

  it("⚠️ la bibliothèque qui DÉFINIT `conclure` sans conclure n'en est pas une", () => {
    expect(estUneGarde("export function conclure(r) { process.exit(r.code); }\n")).toBe(false);
  });

  it("⚠️ un commentaire citant l'idiome ne fait pas d'un utilitaire une garde orpheline", () => {
    const src = "// if (estExecuteDirectement(import.meta.url)) conclure(x);\nexport const f = () => 1;\n";
    expect(estUneGarde(src)).toBe(false);
  });

  it("un outil qui conclut sans point d'entrée n'est pas une garde : rien ne le lance comme programme", () => {
    expect(estUneGarde('import { conclure } from "./r.mjs";\nexport const f = (x) => conclure(x);\n')).toBe(false);
  });
});

describe("ce qui lance une garde, et ce qui la neutralise", () => {
  it("un lancement nu est reconnu, et peut faire échouer son étape", () => {
    expect(lancementsDe([bloc("node tools/a.mjs")])).toEqual([{ outil: "a.mjs", ou: "w.yml › j › e", neutralise: null }]);
  });

  it("une ligne commentée ne lance rien", () => {
    expect(lancementsDe([bloc("# node tools/a.mjs\necho rien")])).toEqual([]);
  });

  it("⚠️ `continue-on-error` neutralise, quel que soit le texte", () => {
    expect(lancementsDe([bloc("node tools/a.mjs", true)])[0].neutralise).toMatch(/continue-on-error/);
  });

  it("⚠️ `|| true` et `|| :` avalent le code de sortie", () => {
    expect(neutralisation(" || true", bloc(""))).toMatch(/\|\| true/);
    expect(neutralisation(" --x || :", bloc(""))).toMatch(/\|\| true/);
  });

  it("⚠️ un `||` qui RELANCE l'échec n'est pas une neutralisation — l'accuser inventerait un coupable", () => {
    expect(neutralisation(' || { echo "::error::non"; exit 1; }', bloc(""))).toBe(null);
  });

  it("⚠️ un lancement en arrière-plan n'est attendu par personne ; `&&` n'est pas `&`", () => {
    expect(neutralisation(" 54321 &", bloc(""))).toMatch(/arrière-plan/);
    expect(neutralisation(" && echo ok", bloc(""))).toBe(null);
  });

  it("⚠️ un `|| true` posé sur la ligne de SUITE neutralise aussi — c'est une seule commande", () => {
    expect(lancementsDe([bloc("node tools/a.mjs \\\n  --x \\\n  || true")])[0].neutralise).toMatch(/\|\| true/);
  });
});

describe("ce qu'un banc applique au dépôt — ce qu'il UTILISE, pas ce qu'il nomme", () => {
  const app = (src) => applicationsDuBanc(src, "t.test.js", NOMS);

  it("⚠️ un import nommé utilisé dans le bloc « le dépôt lui-même » applique la garde", () => {
    const src = 'import { ecarts } from "../a.mjs";\ndescribe("le dépôt lui-même", () => { it("x", () => ecarts()); });\n';
    expect([...app(src).appliquees]).toEqual(["a.mjs"]);
  });

  it("⚠️ `garde = await import(…)` puis `garde.auditer()` SANS ARGUMENT — la forme que la première sonde a manquée", () => {
    const src = [
      "let garde;",
      'beforeAll(async () => { garde = await import("../a.mjs"); });',
      'describe("le dépôt lui-même", () => { it("x", () => { garde.auditer(); }); });',
    ].join("\n");
    expect([...app(src).appliquees]).toEqual(["a.mjs"]);
  });

  it("le chemin de la garde passé à un processus l'applique", () => {
    const src = 'describe("le dépôt lui-même", () => { it("x", () => spawnSync(node, [join(__dirname, "..", "a.mjs")])); });\n';
    expect([...app(src).appliquees]).toEqual(["a.mjs"]);
  });

  it("⚠️ un nom de garde dans une ASSERTION n'est pas un chemin suivi — la faute que ce banc a trouvée en naissant", () => {
    // Le bloc « le dépôt lui-même » de CE fichier contient `toEqual(["orphelins-tts.mjs"])`. La
    // première rédaction le lisait comme un chemin et créditait l'outil qu'elle exempte.
    // `toContain("a.mjs")` est l'axe qui compte : un ARGUMENT DIRECT d'un appel qui ne suit aucun
    // chemin. Sans lui, ce cas ne distinguerait pas « tout appel » de « un appel de chemin ».
    const src = 'import { f } from "../b.mjs";\ndescribe("le dépôt lui-même", () => { expect(f()).toEqual(["a.mjs"]); expect(f()).toContain("a.mjs"); });\n';
    expect([...app(src).appliquees]).toEqual(["b.mjs"]);
  });

  it("le titre peut porter une précision, et la casse ne compte pas", () => {
    const src = 'import { f } from "../a.mjs";\ndescribe("⚠️ LE DÉPÔT LUI-MÊME : le vrai fichier", () => { f(); });\n';
    expect([...app(src).appliquees]).toEqual(["a.mjs"]);
  });

  it("⚠️ une garde NOMMÉE dans un titre ou un commentaire n'est pas appliquée — c'était la fausse piste inverse", () => {
    const src = [
      '// a.mjs est la garde voisine',
      'import { f } from "../b.mjs";',
      'describe("le dépôt lui-même", () => { it("ce que `a.mjs` fait aussi", () => f()); });',
    ].join("\n");
    expect([...app(src).appliquees]).toEqual(["b.mjs"]);
  });

  it("⚠️ chargée mais pas utilisée dans le bloc : rien n'est appliqué", () => {
    const src = 'import { f } from "../a.mjs";\nconst x = f;\ndescribe("le dépôt lui-même", () => { it("x", () => 1); });\n';
    expect([...app(src).appliquees]).toEqual([]);
  });

  it("⚠️ utilisée dans un bloc d'un AUTRE titre : rien n'est appliqué — le titre est la déclaration", () => {
    const src = 'import { f } from "../a.mjs";\ndescribe("le vrai fichier", () => { f(); });\n';
    expect(app(src)).toEqual({ blocs: 0, appliquees: new Set() });
  });

  it("le compte des blocs reconnus est rendu : c'est lui qui tombe si la sonde devient aveugle", () => {
    const src = 'describe("le dépôt lui-même", () => {});\ndescribe("Le dépôt lui-même, encore", () => {});\n';
    expect(app(src).blocs).toBe(2);
  });
});

describe("⚠️ LA GARDE REFUSE, PLUTÔT QUE DE CONCLURE AU VERT", () => {
  const OUTILS = { "tools/a.mjs": GARDE, "tools/b.mjs": GARDE };

  it("⚠️ NON CONCLUANT sans `tools/` — zéro garde n'est jamais une conformité", () => {
    expect(auditer({ racine: arbre({ "x.txt": "" }) }).code).toBe(2);
  });

  it("⚠️ NON CONCLUANT sans workflow — rien ne lance rien, la confrontation n'a pas de sujet", () => {
    expect(auditer({ racine: arbre(OUTILS), exemptees: {} }).code).toBe(2);
  });

  it("le cas conforme passe — sans ce témoin, une garde qui refuse tout satisferait chaque refus", () => {
    const d = arbre({
      ...OUTILS,
      ".github/workflows/ci.yml": workflow("node tools/a.mjs"),
      "tools/__tests__/b.test.js": 'import { f } from "../b.mjs";\ndescribe("le dépôt lui-même", () => { f(); });\n',
    });
    const r = auditer({ racine: d, exemptees: {} });
    expect(r.code, JSON.stringify(r)).toBe(0);
    expect(r.resume).toMatch(/2 garde\(s\) : 1 lancée\(s\) par un workflow .*1 appliquée\(s\) par un banc seulement .*— b\.mjs/);
  });

  it("⚠️ une garde appliquée à rien est refusée, et nommée", () => {
    const d = arbre({ ...OUTILS, ".github/workflows/ci.yml": workflow("node tools/a.mjs") });
    const r = auditer({ racine: d, exemptees: {} });
    expect(r.code).toBe(1);
    expect(r.constats.join("\n")).toMatch(/tools\/b\.mjs : aucun workflow ne la lance, et aucun bloc « le dépôt lui-même » ne s'en sert/);
    expect(r.constats.join("\n")).not.toMatch(/tools\/a\.mjs/);
  });

  it("⚠️ une garde lancée seulement là où son échec ne compte pas est refusée, avec la raison", () => {
    const d = arbre({ ...OUTILS, ".github/workflows/ci.yml": workflow("node tools/a.mjs && node tools/b.mjs || true") });
    const r = auditer({ racine: d, exemptees: {} });
    expect(r.code).toBe(1);
    expect(r.constats.join("\n")).toMatch(/tools\/b\.mjs n'est lancée que là où son échec ne compte pas — ci\.yml › j › etape : un `\|\| true`/);
  });

  it("⚠️ `continue-on-error` sur l'étape suffit à ne rien appliquer", () => {
    const d = arbre({ "tools/a.mjs": GARDE, ".github/workflows/ci.yml": workflow("node tools/a.mjs", "        continue-on-error: true\n") });
    expect(auditer({ racine: d, exemptees: {} }).constats.join("\n")).toMatch(/continue-on-error/);
  });

  describe("les exemptions sont re-vérifiées à chaque passage", () => {
    const base = { ...OUTILS, ".github/workflows/ci.yml": workflow("node tools/a.mjs") };
    const exemptant = (tient) => ({ "b.mjs": { pourquoi: "un outil d'exploitation", tientEncore: () => tient } });

    it("une exemption dont le motif tient dispense", () => {
      expect(auditer({ racine: arbre(base), exemptees: exemptant(true) }).code).toBe(0);
    });

    it("⚠️ une exemption dont le motif ne tient plus est refusée — elle cacherait une garde orpheline", () => {
      const r = auditer({ racine: arbre(base), exemptees: exemptant(false) });
      expect(r.code).toBe(1);
      expect(r.constats.join("\n")).toMatch(/tools\/b\.mjs est exemptée parce que « un outil d'exploitation » — et ce n'est plus vrai/);
    });

    it("⚠️ une exemption qui ne dispense plus rien est refusée", () => {
      const d = arbre({ ...OUTILS, ".github/workflows/ci.yml": workflow("node tools/a.mjs && node tools/b.mjs") });
      expect(auditer({ racine: d, exemptees: exemptant(true) }).constats.join("\n")).toMatch(/exemptée ET appliquée/);
    });

    it("⚠️ une exemption qui ne désigne plus aucune garde est refusée", () => {
      const r = auditer({ racine: arbre(base), exemptees: { ...exemptant(true), "disparue.mjs": { pourquoi: "x", tientEncore: () => true } } });
      expect(r.constats.join("\n")).toMatch(/l'exemption de tools\/disparue\.mjs ne désigne plus aucune garde/);
    });
  });
});

describe("le dépôt lui-même", () => {
  // ⚠️ UN SEUL AUDIT POUR LE BLOC, ET UN DÉLAI DÉCLARÉ. L'audit lit en AST tous les bancs et tous
  // les workflows du dépôt : 1,6 à 1,8 s seul, mesuré le 04/10 sur une machine chargée. Pendant
  // l'étape de couverture, tous les fichiers en parallèle, il a dépassé les 5 s par défaut de vitest
  // — rouge sur un dépôt conforme ; le même banc lancé seul passe. La cause n'est PAS
  // l'instrumentation, qui ne couvre ni `tools/` ni ses bancs : c'est la concurrence des autres
  // fichiers, non mesurée plus finement. Le délai n'est pas ce que ce bloc mesure — son sujet est la
  // conclusion de l'audit. Le refaire trois fois triplait seulement le coût, d'où l'unique appel.
  let r;
  beforeAll(() => { r = auditer(); }, 60_000);

  it("⚠️ chaque garde de ce dépôt est appliquée à ce dépôt — et c'est CE banc qui le mesure", () => {
    expect(r.code, (r.constats || r.raisons || []).join("\n")).toBe(0);
  });

  it("la sonde reconnaît assez de formes pour que la confrontation ait un sujet", () => {
    // ⚠️ LE PLANCHER VIT ICI, PAS DANS LA GARDE : il porte sur la population de CE dépôt, et une
    // éprouvette plus petite n'a pas à le satisfaire. Il compte les FORMES RECONNUES — lancements et
    // blocs — et non les fichiers ouverts : c'est le nombre qui tombe quand la sonde devient aveugle.
    const { resume } = r;
    const [, gardes, lancees, lancements, blocs] = resume.match(/^(\d+) garde\(s\) : (\d+) lancée\(s\) par un workflow \((\d+) lancement\(s\) reconnu\(s\).*\((\d+) bloc\(s\) « le dépôt lui-même »/).map(Number);
    expect(gardes, "moins de trente gardes reconnues : `estUneGarde` ne lit plus l'idiome").toBeGreaterThanOrEqual(30);
    expect(lancees, "moins de trente gardes lancées par un workflow : la sonde des blocs `run:` est aveugle").toBeGreaterThanOrEqual(30);
    expect(lancements).toBeGreaterThanOrEqual(lancees);
    expect(blocs, "moins de six blocs « le dépôt lui-même » reconnus : le titre ou l'AST n'est plus lu").toBeGreaterThanOrEqual(6);
  });

  it("l'exemption d'aujourd'hui a toujours son sujet, et son motif tient", () => {
    // Une exemption de banc vérifiée seulement sur des éprouvettes pourrait survivre à son motif.
    expect(Object.keys(EXEMPTEES)).toEqual(["orphelins-tts.mjs"]);
    expect(r.resume).toMatch(/1 exemptée\(s\) : orphelins-tts\.mjs$/);
  });
});
