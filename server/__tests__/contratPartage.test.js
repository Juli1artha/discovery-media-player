// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE MÊME CONTRAT, LU DES DEUX CÔTÉS.
//
// ⚠️ CE FICHIER EXISTE PARCE QUE CES ASSERTIONS ÉTAIENT AU MAUVAIS ENDROIT. Elles vivaient dans
// `src/__tests__/cadence.test.ts` — une suite compilée pour le NAVIGATEUR — et lisaient des
// fichiers avec `node:fs`. Vitest les exécutait sans broncher (il tourne dans Node), mais `tsc`
// refusait le module : `main` était rouge depuis 0.1.36, et trois versions ont été publiées
// dessus.
//
// ⚠️ Je ne l'ai pas vu parce que je COMPTAIS LES SUCCÈS au lieu de chercher les échecs :
// `gh pr checks | grep -c pass` rend 6 même quand une tâche échoue à côté. Un compte de réussites
// ne dit rien des échecs — c'est exactement la faute que ce dépôt reproche à ses propres gardes
// depuis deux jours, commise sur l'outil qui devait les surveiller.
//
// Une assertion qui lit le disque appartient à la suite serveur. Le nommer ici évite qu'elle
// remonte un jour dans la suite navigateur pour être « à côté de ce qu'elle vérifie ».

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");
const lire = (rel) => fs.readFileSync(path.join(RACINE, rel), "utf8");

describe("les deux côtés lisent le même contrat de cadence", () => {
  it("le navigateur ne redéclare pas la cadence", () => {
    const src = lire("src/tracking.ts");
    expect(src, "une constante recopiée est une constante qui divergera")
      .toContain("SESSION_INTERVAL_MS");
    expect(src, "l'ancienne valeur en dur ne doit plus être là").not.toMatch(/\?\?\s*12000/);
  });

  it("le serveur non plus, et il déduit son quota", () => {
    const src = require("./sourceDesPages.cjs").SOURCE_PAGES;
    expect(src).toContain("SESSION_QUOTA_PER_HOUR");
    expect(src, "le quota écrit à la main est ce qui a produit le défaut")
      .not.toMatch(/intsess:\$\{ipInt\}`,\s*\d+/);
  });

  it("le refus de quota se dit, il ne se devine pas", () => {
    const src = require("./sourceDesPages.cjs").SOURCE_PAGES;
    expect(src).toContain("intsess:quota-avert");
    // ⚠️ Le signalement doit précéder le `return`, sinon il ne s'exécute jamais.
    // Le 429 ne s'écrit plus `res.statusCode = 429` : toutes les réponses JSON passent par une
    // porte unique, et le statut y est le deuxième argument.
    const i = src.indexOf("intsess:quota-avert");
    const j = src.indexOf("repondreJson(res, 429", i);
    expect(j, "un 429 doit suivre le journal").toBeGreaterThan(i);
    expect(j - i, "et dans le même bloc").toBeLessThan(900);
  });
});

// ⚠️ `hasFocus` NE DÉCIDE PLUS DE CE QUI EST LU.
//
// Il répond « l'utilisateur tape ici », pas « l'utilisateur regarde ». Un document visible sur un
// second écran pendant quarante secondes était compté DEUX SECONDES. Il peut servir ailleurs — ce
// qu'on refuse, c'est qu'il gouverne le comptage.
//
// ⚠️ Cette garde est ICI et non dans la suite navigateur, parce qu'elle lit un fichier. C'est la
// TROISIÈME fois de la journée que je place une lecture de disque dans une suite compilée pour le
// navigateur : `tsc` refuse `node:fs`, vitest l'exécute sans broncher, et `main` reste rouge
// pendant que les PR paraissent vertes. La règle est simple et je l'ai enfreinte deux fois après
// l'avoir écrite : une assertion qui lit le disque appartient à la suite serveur.
describe("le comptage de lecture ne dépend pas du focus", () => {
  it("la condition de lecture n'interroge pas hasFocus", () => {
    const src = lire("src/tracking.ts");
    const i = src.indexOf("const viewable");
    expect(i, "la condition existe").toBeGreaterThan(0);
    expect(src.slice(i, i + 200), "hasFocus mesure la frappe, pas le regard").not.toContain("hasFocus");
  });

  it("et start() n'amorce pas le comptage sur un onglet caché", () => {
    const src = lire("src/tracking.ts");
    expect(src, "un onglet d'arrière-plan comptait `idleMs` sans avoir jamais été vu")
      .toContain("activeSince = viewable() ? now() : null");
  });
});
