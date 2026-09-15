// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN BANC JOUÉ DEUX FOIS NE DIT PAS DEUX FOIS PLUS ; IL COÛTE DEUX FOIS PLUS ET SE MARCHE DESSUS.
//
// ⚠️ CE QUI EST ARRIVÉ, TROIS FOIS, DE LA MÊME FAÇON. `base/chargeReelle.test.js` a reçu sa propre
// configuration et sa propre étape de forge — et il a continué de tourner AUSSI dans le banc
// `base/`, à son volume par défaut. La ligne d'exclusion qui a corrigé ce cas-là nommait UN fichier.
// `base/endurance.test.js` et `base/statistiquesAgregees.test.js` ont ensuite acquis, pour
// exactement la même raison, leur propre configuration et leur propre étape — et personne n'est
// revenu les écarter du banc `base/`. Relevé par un audit externe (CODEX, 15/09). Puis la garde née
// de ce relevé en a trouvé un troisième, tout seul : `charge/**` tournait sous `npm test` EN PLUS de
// `npm run test:charge`, et ce passage-là est MUET — seule la configuration dédiée pose
// `disableConsoleIntercept`, sans quoi le relevé, unique produit de ce banc, est avalé par Vitest.
//
// ⚠️ AUCUN DES TROIS N'A JAMAIS ROUGI. Un banc joué deux fois est vert deux fois, et le gaspillage
// d'une garde ne se signale pas tout seul. Ce n'est pas qu'une question de temps de forge : les
// passages écrivent dans la MÊME base d'essai, ce qui a déjà fait échouer la graine non idempotente
// de `retention.test.js` sur une clé dupliquée, le jour où un filtre par chemin n'avait pas pris.
//
// ⚠️ LA LEÇON EST DANS LA FORME DU CORRECTIF, PAS DANS SON CONTENU. Les deux premiers correctifs
// nommaient UN fichier ; la règle restait inécrite, et la faute a repoussé au cas suivant, deux
// fois. La règle vit donc maintenant dans `tools/configuration-des-bancs.mjs`, qui tourne aussi sur
// la forge — et que `mutations.mjs` interroge plutôt que de redeviner le périmètre de son côté.

import { readdirSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, beforeAll, afterAll } from "vitest";

import {
  motifEnRegExp, bancs, configurations, chargerConfigurations, couvre, configurationsDe,
  configurationDe, auditerConfigurationDesBancs, GENERALE,
} from "../configuration-des-bancs.mjs";

let par;
beforeAll(async () => { par = await chargerConfigurations("."); });

describe("le traducteur de motifs — sans lui, tout le reste serait vert sur rien", () => {
  it("dit vrai sur les cas que ces configurations emploient", () => {
    expect(motifEnRegExp("base/**/*.test.js").test("base/endurance.test.js")).toBe(true);
    expect(motifEnRegExp("base/**/*.test.js").test("base/coin/x.test.js")).toBe(true);
    expect(motifEnRegExp("base/**/*.test.js").test("charge/x.test.js")).toBe(false);
    expect(motifEnRegExp("**/*.{test,spec}.{ts,js}").test("tools/__tests__/x.test.js")).toBe(true);
    expect(motifEnRegExp("**/*.{test,spec}.{ts,js}").test("src/a.spec.ts")).toBe(true);
    expect(motifEnRegExp("**/*.{test,spec}.{ts,js}").test("a.test.js")).toBe(true);
    expect(motifEnRegExp("**/*.{test,spec}.{ts,js}").test("src/a.ts")).toBe(false);
    expect(motifEnRegExp("base/**").test("base/endurance.test.js")).toBe(true);
    expect(motifEnRegExp("base/chargeReelle.test.js").test("base/autre.test.js")).toBe(false);
  });

  it("⚠️ `**` traverse les dossiers, `*` non — la confusion rendrait la garde muette", () => {
    // Si `**` était traduit comme deux `*`, `charge/**` ne désignerait plus `charge/__tests__/x` :
    // la garde ne verrait plus aucun double, et conclurait vert sur un dépôt fautif.
    expect(motifEnRegExp("charge/**").test("charge/__tests__/rapport.test.js")).toBe(true);
    expect(motifEnRegExp("charge/*").test("charge/__tests__/rapport.test.js")).toBe(false);
    expect(motifEnRegExp("charge/*").test("charge/rapport.test.js")).toBe(true);
  });
});

describe("⚠️ LE DÉPÔT LUI-MÊME : chaque banc est joué une fois, et une seule", () => {
  it("la sonde trouve réellement les configurations et les bancs", () => {
    // Le plancher de ce fichier : une sonde qui ne lit rien satisferait tout ce qui suit.
    expect(configurations(".").length).toBeGreaterThanOrEqual(5);
    expect(bancs(".").length).toBeGreaterThan(100);
    expect(bancs(".")).toContain("tools/__tests__/configurationDesBancs.test.js");
  });

  it("aucun banc n'est joué par deux configurations, aucun n'est orphelin", async () => {
    const r = await auditerConfigurationDesBancs({ racine: "." });
    expect(r.constats || [], "le détail est dans les constats").toEqual([]);
    expect(r.code).toBe(0);
  });

  it("⚠️ les trois bancs spécialisés de base/ sont bien écartés du banc général de base/", () => {
    // Le cas nommément : la régression se lirait ici avant de se lire dans un compte.
    for (const f of ["base/chargeReelle.test.js", "base/endurance.test.js", "base/statistiquesAgregees.test.js"]) {
      expect(configurationsDe(par, f), `${f} n'est pas joué par exactement une configuration`).toHaveLength(1);
      expect(configurationsDe(par, f)[0]).not.toBe("vitest.base.config.mjs");
    }
    // Et `charge/` n'est plus joué par la configuration générale, qui avalait son relevé.
    expect(configurationsDe(par, "charge/coutParGeste.test.js")).toEqual(["vitest.charge.config.mjs"]);
  });

  it("⚠️ `configurationDe` rend ce que `mutations.mjs` doit passer à vitest — null pour la générale", () => {
    // La campagne de mutation lançait `npx vitest run <fichier>` sans configuration : le jour où
    // `charge/**` est sorti de la générale, onze mutants sont devenus NON CONCLUANTS d'un coup,
    // sous le libellé trompeur « base ROUGE ». Un lanceur qui devine le périmètre devine faux.
    expect(configurationDe(par, "charge/__tests__/rapport.test.js")).toBe("vitest.charge.config.mjs");
    expect(configurationDe(par, "base/endurance.test.js")).toBe("vitest.endurance.config.mjs");
    expect(configurationDe(par, "tools/__tests__/configurationDesBancs.test.js")).toBe(null);
  });
});

describe("⚠️ LA GARDE REFUSE, PLUTÔT QUE DE CONCLURE AU VERT", () => {
  const arbres = [];
  const arbre = (fichiers) => {
    const d = join(tmpdir(), `config-bancs-${Math.random().toString(36).slice(2)}`);
    arbres.push(d);
    for (const [chemin, contenu] of Object.entries(fichiers)) {
      const complet = join(d, chemin);
      mkdirSync(join(complet, ".."), { recursive: true });
      writeFileSync(complet, contenu);
    }
    return d;
  };
  const config = (test) => `export default { test: ${JSON.stringify(test)} };\n`;
  const paquet = (scripts) => JSON.stringify({ name: "t", scripts });

  afterAll(() => { for (const d of arbres) { try { rmSync(d, { recursive: true, force: true }); } catch { /* rien */ } } });

  it("⚠️ NON CONCLUANT sur un arbre sans configuration — zéro n'est jamais une conformité", async () => {
    expect((await auditerConfigurationDesBancs({ racine: arbre({ "package.json": paquet({}) }) })).code).toBe(2);
  });

  it("⚠️ NON CONCLUANT quand il n'y a aucun banc — la confrontation n'aurait pas de sujet", async () => {
    const d = arbre({ "package.json": paquet({}), "vitest.config.mjs": config({ include: ["**/*.test.js"] }) });
    expect((await auditerConfigurationDesBancs({ racine: d })).code).toBe(2);
  });

  it("le cas conforme passe — sans ce témoin, une garde qui refuse tout satisferait chaque refus", async () => {
    const d = arbre({
      "package.json": paquet({ "test:coin": "vitest run --config vitest.coin.config.mjs" }),
      "vitest.config.mjs": config({ include: ["**/*.test.js"], exclude: ["coin/**"] }),
      "vitest.coin.config.mjs": config({ include: ["coin/**/*.test.js"] }),
      "a.test.js": "", "coin/b.test.js": "",
    });
    expect((await auditerConfigurationDesBancs({ racine: d })).code).toBe(0);
  });

  it("⚠️ le double exact du 15/09 est REFUSÉ, et le fichier fautif est nommé", async () => {
    const d = arbre({
      "package.json": paquet({ "test:coin": "vitest run --config vitest.coin.config.mjs" }),
      "vitest.config.mjs": config({ include: ["**/*.test.js"] }),
      "vitest.coin.config.mjs": config({ include: ["coin/**/*.test.js"] }),
      "coin/b.test.js": "",
    });
    const r = await auditerConfigurationDesBancs({ racine: d });
    expect(r.code).toBe(1);
    expect(r.constats.join("\n")).toMatch(/coin\/b\.test\.js est joué par 2 configurations/);
  });

  it("un banc que plus personne ne joue est refusé aussi — « au plus une » se satisferait par zéro", async () => {
    const d = arbre({
      "package.json": paquet({}),
      "vitest.config.mjs": config({ include: ["**/*.test.js"], exclude: ["coin/**"] }),
      "coin/b.test.js": "",
    });
    const r = await auditerConfigurationDesBancs({ racine: d });
    expect(r.code).toBe(1);
    expect(r.constats.join("\n")).toMatch(/coin\/b\.test\.js n'est joué par AUCUNE configuration/);
  });

  it("une exclusion qui ne désigne plus rien est refusée — elle a l'air de protéger", async () => {
    const d = arbre({
      "package.json": paquet({}),
      "vitest.config.mjs": config({ include: ["**/*.test.js"], exclude: ["coin/disparu.test.js", "node_modules/**"] }),
      "a.test.js": "",
    });
    const r = await auditerConfigurationDesBancs({ racine: d });
    expect(r.code).toBe(1);
    expect(r.constats.join("\n")).toMatch(/écarte « coin\/disparu\.test\.js », qui ne désigne aucun banc/);
    expect(r.constats.join("\n"), "node_modules n'est pas un banc de ce dépôt").not.toMatch(/node_modules/);
  });

  it("⚠️ une configuration que personne ne lance est refusée — écarter n'est pas faire tourner ailleurs", async () => {
    const d = arbre({
      "package.json": paquet({}),
      "vitest.config.mjs": config({ include: ["**/*.test.js"], exclude: ["coin/**"] }),
      "vitest.coin.config.mjs": config({ include: ["coin/**/*.test.js"] }),
      "coin/b.test.js": "",
    });
    const r = await auditerConfigurationDesBancs({ racine: d });
    expect(r.code).toBe(1);
    expect(r.constats.join("\n")).toMatch(/vitest\.coin\.config\.mjs n'est lancée par aucune commande npm/);
    // Et la générale échappe à cette exigence : `vitest` la prend sans qu'on la nomme.
    expect(r.constats.join("\n")).not.toMatch(new RegExp(`${GENERALE.replace(/\./g, "\\.")} n'est lancée`));
  });

  it("`couvre` lit include ET exclude — un exclude ignoré rendrait tout le monde coupable", () => {
    expect(couvre({ include: ["a/**"], exclude: [] }, "a/x.test.js")).toBe(true);
    expect(couvre({ include: ["a/**"], exclude: ["a/x.test.js"] }, "a/x.test.js")).toBe(false);
    expect(couvre({ include: ["a/**"] }, "b/x.test.js")).toBe(false);
    expect(couvre({}, "a/x.test.js")).toBe(false);
  });

  it("la sonde de bancs ignore node_modules et les dépôts d'exemple", () => {
    // Sans quoi elle ramasserait les bancs de nos dépendances, et accuserait le dépôt de milliers
    // d'orphelins — une garde qui crie tout le temps est une garde qu'on désactive.
    const d = join(tmpdir(), `config-bancs-${Math.random().toString(36).slice(2)}`);
    arbres.push(d);
    for (const p of ["a.test.js", "node_modules/paquet/x.test.js", "examples/site/y.test.js"]) {
      mkdirSync(join(d, p, ".."), { recursive: true });
      writeFileSync(join(d, p), "");
    }
    expect(bancs(d)).toEqual(["a.test.js"]);
    expect(readdirSync(join(d, "node_modules")).length, "l'arbre d'essai contenait bien de quoi se tromper").toBe(1);
  });
});
