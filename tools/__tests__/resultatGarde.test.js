// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES TROIS VERDICTS, ET SURTOUT LA FRONTIÈRE ENTRE LES DEUX ROUGES.
//
// ⚠️ Avant ce module, les six gardes du dépôt sortaient 1 pour « le dépôt viole la règle » ET pour
// « la sonde n'a rien trouvé à lire » (P1, revue externe du 21/08). Les cas ci-dessous portent sur
// ce que ce mélange coûtait : un auteur qui constate une fois qu'un rouge n'est pas de son fait
// apprend que le rouge de cette garde est parfois du bruit.
//
// La propriété qu'ils tiennent vraiment : 2 ÉCHOUE. Un non-concluant n'a rien prouvé, donc il ne
// peut pas être vert — sinon on aurait fabriqué la garde muette que ce dépôt refuse.

import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi } from "vitest";
import {
  CONFORME, VIOLATION, INCONCLUSIF,
  conforme, violation, inconclusif, tenter, rendre, conclure,
} from "../resultat-garde.mjs";

const journal = () => {
  const ecrits = [], alertes = [];
  return { ecrits, alertes, sorties: { ecrire: (m) => ecrits.push(m), alerter: (m) => alertes.push(m) } };
};

describe("⚠️ LES DEUX ROUGES NE SE DISENT PAS DE LA MÊME FAÇON", () => {
  it("une violation nomme ce qui cloche, sans préfixe de non-concluance", () => {
    const j = journal();
    expect(rendre(violation(["ci.yml:3 : « a/b@v1 » n'est pas épinglée"]), j.sorties)).toBe(VIOLATION);
    expect(j.alertes).toEqual(["::error::ci.yml:3 : « a/b@v1 » n'est pas épinglée"]);
    expect(j.alertes.join(" ")).not.toMatch(/NON CONCLUANTE/);
  });

  it("⚠️ un non-concluant DIT que le correctif n'est pas dans la branche", () => {
    // C'est toute la valeur du code 2 : sans cette phrase, les deux rouges se ressemblent dans un
    // journal de CI, et le lecteur ne peut pas savoir lequel le concerne.
    const j = journal();
    expect(rendre(inconclusif("la sonde vise à côté"), j.sorties)).toBe(INCONCLUSIF);
    expect(j.alertes[0]).toBe("::error::GARDE NON CONCLUANTE — la sonde vise à côté");
    expect(j.alertes.join(" ")).toMatch(/pas dans la branche/);
  });

  it("⚠️ 2 N'EST PAS UN SUCCÈS — il est non nul, comme 1", () => {
    // Si un non-concluant sortait 0, la CI passerait au vert sur une garde qui n'a rien vérifié.
    expect(INCONCLUSIF).not.toBe(CONFORME);
    expect(INCONCLUSIF).toBeGreaterThan(0);
    expect(VIOLATION).toBeGreaterThan(0);
  });

  it("un conforme écrit son résumé sur la sortie normale, pas sur le canal d'alerte", () => {
    const j = journal();
    expect(rendre(conforme("30 références, toutes épinglées"), j.sorties)).toBe(CONFORME);
    expect(j.ecrits).toEqual(["30 références, toutes épinglées"]);
    expect(j.alertes).toEqual([]);
  });
});

describe("les avertissements accompagnent n'importe quel verdict", () => {
  it("un conforme peut porter ce qu'on n'a pas pu voir", () => {
    // `actions-versions.mjs` en dépend : il confronte ce qu'il peut et DIT ce qui manque.
    const j = journal();
    expect(rendre(conforme("29/30 confrontées", ["github/x n'a pas répondu"]), j.sorties)).toBe(CONFORME);
    expect(j.alertes).toEqual(["::warning::github/x n'a pas répondu"]);
    expect(j.ecrits).toEqual(["29/30 confrontées"]);
  });

  it("une violation les porte aussi, avant ses constats", () => {
    const j = journal();
    rendre(violation(["c'est faux"], ["y n'a pas répondu"]), j.sorties);
    expect(j.alertes).toEqual(["::warning::y n'a pas répondu", "::error::c'est faux"]);
  });
});

describe("⚠️ UNE EXCEPTION EST UN NON-CONCLUANT, PAS UNE VIOLATION", () => {
  // Le cas qui motivait le plus la séparation. `workflows-yaml.mjs` LÈVE délibérément sur un
  // document illisible — « on refuse plutôt que de deviner ». Ce refus prudent remontait jusqu'à
  // Node, qui sortait 1 : il prenait l'apparence d'une violation, avec une trace de pile en guise
  // d'explication.
  it("transforme un jet en verdict 2 et garde le message", () => {
    const r = tenter(() => { throw new Error("ci.yml:12 : YAML illisible"); });
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons).toEqual(["ci.yml:12 : YAML illisible"]);
  });

  it("survit à un jet qui n'est pas une Error", () => {
    expect(tenter(() => { throw "panne sèche"; }).code).toBe(INCONCLUSIF);
  });

  it("laisse passer un verdict normal sans le toucher", () => {
    expect(tenter(() => conforme("tout va bien"))).toEqual({ code: CONFORME, resume: "tout va bien", avertissements: [] });
  });
});

describe("conclure", () => {
  it("ne sort pas sur un conforme — process.exit(0) tronque les écritures en tampon", () => {
    const sortir = vi.fn();
    vi.spyOn(console, "log").mockImplementation(() => {});
    expect(conclure(conforme("ok"), sortir)).toBe(CONFORME);
    expect(sortir).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it("sort sur 1 et sur 2, avec le code correspondant", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const s1 = vi.fn(); conclure(violation(["faux"]), s1);
    const s2 = vi.fn(); conclure(inconclusif(["pas vu"]), s2);
    expect(s1).toHaveBeenCalledWith(VIOLATION);
    expect(s2).toHaveBeenCalledWith(INCONCLUSIF);
    vi.restoreAllMocks();
  });
});

// ⚠️ CE QUI PRÉCÈDE ÉPROUVE LE MODULE ; CE QUI SUIT ÉPROUVE QU'IL EST BRANCHÉ.
//
// Un banc sur `resultat-garde.mjs` seul resterait vert si une garde cessait de l'appeler — et
// l'appel est exactement ce qu'on corrige. Les deux outils ci-dessous sont les seuls à conclure
// sans réseau ni `npm pack` : ils sont lancés pour de vrai, sur une sonde volontairement à côté.
describe("⚠️ LES GARDES RENDENT VRAIMENT 2, PAS 1", () => {
  const lancer = (args) => {
    const r = spawnSync(process.execPath, args, { encoding: "utf8" });
    return { code: r.status, sortie: (r.stdout || "") + (r.stderr || "") };
  };

  it("actions-epinglees : un dossier sans workflow est non concluant", () => {
    const vide = mkdtempSync(join(tmpdir(), "sonde-"));
    const { code, sortie } = lancer(["tools/actions-epinglees.mjs", vide]);
    expect(code).toBe(INCONCLUSIF);
    expect(sortie).toMatch(/GARDE NON CONCLUANTE/);
  });

  it("images-epinglees : un fichier sans image externe est non concluant, pas fautif", () => {
    const { code, sortie } = lancer(["tools/images-epinglees.mjs", "package.json"]);
    expect(code).toBe(INCONCLUSIF);
    expect(sortie).toMatch(/la sonde vise à côté/);
  });

  it("images-epinglees : le vrai Dockerfile reste conforme, et sort 0", () => {
    // La contrepartie : le code 2 ne doit pas devenir la réponse à tout.
    const { code } = lancer(["tools/images-epinglees.mjs"]);
    expect(code).toBe(CONFORME);
  });
});
