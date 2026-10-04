// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN CHAMP NOURRI PAR UNE VARIABLE QUE PERSONNE NE FOURNIT EST UN CHAMP MORT.
//
// ⚠️ CE QUI EST ARRIVÉ (PR 546, RELEVÉ LE 15/09). L'artefact de charge porte `identity.prHeadSha`,
// et sa description promet « la tête de la branche d'une PR ». Elle n'est arrivée dans AUCUNE course
// réelle de PR : le producteur lisait `GITHUB_HEAD_SHA`, un nom qui n'existe pas. La forge expose
// `GITHUB_HEAD_REF` — le NOM de la branche — et ne publie la tête que dans
// `github.event.pull_request.head.sha`, qui n'est lisible que depuis le YAML. Le champ valait donc
// `null` partout, et sur une PR c'est précisément le pire endroit : `commitSha` y désigne un commit
// de FUSION ÉPHÉMÈRE que la forge jette ensuite, si bien qu'aucune de ces mesures ne se reliait plus
// à un objet durable.
//
// ⚠️ ET LE BANC D'ALORS ÉTAIT VERT. Il appelait `identite()` avec un environnement FABRIQUÉ, où il
// posait lui-même le nom que le code lisait. Un tel banc prouve que la fonction sait lire la
// variable qu'on lui donne — jamais que quelqu'un la donne. C'est la même faute que le transport des
// notes du 15/09 : on contrôlait chez le producteur, et la question qui comptait était ailleurs.
//
// CE BANC TIENT DONC LES DEUX MOITIÉS DU CÂBLAGE, ET RIEN D'AUTRE :
//   • le côté FORGE — aucune source de ce dépôt ne lit un `GITHUB_*` que la forge ne définit pas ;
//   • le côté DÉPÔT — le YAML réel de la CI, résolu contre une charge utile de PR, nourrit bien
//     `identite()` jusqu'à un `prHeadSha` non nul. C'est le WORKFLOW qui est joué ici, pas une copie.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { parse } from "yaml";
import { describe, it, expect } from "vitest";

import { variablesLues } from "../env-lues.mjs";

const requireCjs = createRequire(import.meta.url);
const rapport = requireCjs("../../charge/rapport.js");
const workflow = parse(readFileSync(".github/workflows/ci.yml", "utf8"));

/**
 * ⚠️ LES VARIABLES QUE GITHUB ACTIONS DÉFINIT, RECOPIÉES EN DUR — comme la liste des suffixes de
 * Scorecard à côté. C'est délibéré : une liste dérivée d'un paquet suivrait ses bugs, alors qu'une
 * liste écrite se relit à chaque montée de version du runner. Elle vient de la documentation des
 * « default environment variables ». Ce qui n'y est pas ne vaut pas `null` à l'exécution : ça vaut
 * `undefined`, silencieusement, pour toujours.
 */
const DEFINIES_PAR_LA_FORGE = new Set([
  "GITHUB_ACTION", "GITHUB_ACTION_PATH", "GITHUB_ACTION_REPOSITORY", "GITHUB_ACTIONS", "GITHUB_ACTOR",
  "GITHUB_ACTOR_ID", "GITHUB_API_URL", "GITHUB_BASE_REF", "GITHUB_ENV", "GITHUB_EVENT_NAME",
  "GITHUB_EVENT_PATH", "GITHUB_GRAPHQL_URL", "GITHUB_HEAD_REF", "GITHUB_JOB", "GITHUB_OUTPUT",
  "GITHUB_PATH", "GITHUB_REF", "GITHUB_REF_NAME", "GITHUB_REF_PROTECTED", "GITHUB_REF_TYPE",
  "GITHUB_REPOSITORY", "GITHUB_REPOSITORY_ID", "GITHUB_REPOSITORY_OWNER", "GITHUB_REPOSITORY_OWNER_ID",
  "GITHUB_RETENTION_DAYS", "GITHUB_RUN_ATTEMPT", "GITHUB_RUN_ID", "GITHUB_RUN_NUMBER",
  "GITHUB_SERVER_URL", "GITHUB_SHA", "GITHUB_STEP_SUMMARY", "GITHUB_TRIGGERING_ACTOR",
  "GITHUB_WORKFLOW", "GITHUB_WORKFLOW_REF", "GITHUB_WORKFLOW_SHA", "GITHUB_WORKSPACE",
]);

/** Les sources exécutées du dépôt — pas les bancs, pas les bundles générés, pas `node_modules`. */
const sources = (racine) => {
  const trouves = [];
  const visiter = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (e.name !== "__tests__" && e.name !== "node_modules") visiter(p); continue; }
      if (!/\.(js|mjs|cjs)$/.test(p) || p.endsWith(".generated.js")) continue;
      trouves.push(p);
    }
  };
  for (const d of racine) visiter(d);
  return trouves;
};

/** L'étape de la CI qui lance le producteur — trouvée par son APPEL, jamais par son nom. */
const etapeDuProducteur = () => {
  const etapes = Object.values(workflow.jobs).flatMap((j) => j.steps || []);
  const e = etapes.find((x) => typeof x.run === "string" && /(^|\s)node\s[^\n]*charge\/rapport\.js/.test(x.run));
  expect(e, "aucune étape de la CI ne lance charge/rapport.js").toBeTruthy();
  return e;
};

/**
 * ⚠️ LE MINUSCULE ÉVALUATEUR D'EXPRESSIONS `${{ … }}`, et pourquoi il vaut mieux qu'une copie. Sans
 * lui, ce banc devrait RECOPIER la valeur attendue du câblage — et une copie ne confronte rien : le
 * jour où le YAML change, la copie reste juste et le banc reste vert. Ici c'est le texte RÉEL du
 * workflow qui est résolu, contre une charge utile de PR fabriquée. Fabriquée est le bon mot :
 * seule la charge utile de la forge l'est ; le câblage, lui, est celui qui tournera.
 * `a.b || 'x'` rend le premier terme vrai, comme la forge.
 */
const resoudre = (valeur, contexte) =>
  String(valeur).replace(/\$\{\{([^}]*)\}\}/g, (_, expr) => {
    for (const terme of String(expr).split("||").map((x) => x.trim())) {
      if (/^'.*'$/.test(terme)) { const s = terme.slice(1, -1); if (s) return s; continue; }
      const v = terme.split(".").reduce((o, k) => (o == null ? undefined : o[k]), contexte);
      if (v !== undefined && v !== null && v !== "") return String(v);
    }
    return "";
  });

const TETE = "b".repeat(40);
const FUSION = "c".repeat(40);
const CONTEXTE_DE_PR = {
  github: {
    event_name: "pull_request",
    sha: FUSION,
    event: { pull_request: { head: { sha: TETE } } },
  },
};

/** L'environnement du producteur tel que la forge le composerait, depuis le YAML réel. */
const environnementDeLEtape = (etape, contexte) => {
  const env = {};
  for (const [nom, valeur] of Object.entries(etape.env || {})) env[nom] = resoudre(valeur, contexte);
  return env;
};

describe("⚠️ LE CÔTÉ FORGE : on ne lit pas une variable que personne ne définit", () => {
  it("aucune source du dépôt ne lit un GITHUB_* absent de la documentation du runner", () => {
    // `GITHUB_HEAD_SHA` — le nom inventé du 15/09 — serait refusé ici, et il l'aurait été avant
    // d'être publié trois fois. `GITHUB_HEAD_REF` existe, lui, mais porte le NOM de la branche :
    // la ressemblance des deux noms est exactement ce qui rend cette faute facile.
    const fautes = [];
    for (const f of sources(["bin", "context", "server", "charge", "tools"])) {
      for (const nom of variablesLues(readFileSync(f, "utf8"), f)) {
        if (nom.startsWith("GITHUB_") && !DEFINIES_PAR_LA_FORGE.has(nom)) fautes.push(`${f} lit ${nom}`);
      }
    }
    expect(fautes, "une variable GITHUB_* que la forge ne définit pas vaudra undefined pour toujours, en silence").toEqual([]);
  });

  it("la liste elle-même n'est pas vide, et le témoin qui la rendrait inutile est refusé", () => {
    // Une liste vide, ou un filtre qui ne filtre rien, rendrait l'essai d'à côté vert sur tout.
    expect(DEFINIES_PAR_LA_FORGE.has("GITHUB_SHA")).toBe(true);
    expect(DEFINIES_PAR_LA_FORGE.has("GITHUB_HEAD_SHA")).toBe(false);
    expect(variablesLues("void process.env.GITHUB_HEAD_SHA;", "t.js").has("GITHUB_HEAD_SHA")).toBe(true);
  });
});

describe("⚠️ LE CÔTÉ DÉPÔT : le câblage du workflow RÉEL, joué jusqu'à l'artefact", () => {
  const empreinte = "0".repeat(64);

  it("l'étape qui lance le producteur passe la tête de PR depuis l'évènement — la seule source qui l'ait", () => {
    const etape = etapeDuProducteur();
    expect(String((etape.env || {}).PLAYER_RAPPORT_PR_HEAD || ""), "le câblage de la tête de PR a disparu de la CI")
      .toMatch(/github\.event\.pull_request\.head\.sha/);
  });

  it("⚠️ résolu contre une PR, ce câblage donne un prHeadSha NON NUL — ce que le banc d'avant ne disait pas", () => {
    const env = { ...environnementDeLEtape(etapeDuProducteur(), CONTEXTE_DE_PR), GITHUB_EVENT_NAME: "pull_request", GITHUB_SHA: FUSION, GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" };
    const id = rapport.identite({ env, empreinte, version: "0.0.0", quand: new Date("2026-09-15T00:00:00Z") });
    expect(id.prHeadSha, "identity.prHeadSha est nul sur une PR : le champ est mort, comme avant le correctif").toBe(TETE);
    // Et `commitSha` reste la fusion : les deux disent des choses différentes, c'est tout l'intérêt.
    expect(id.commitSha).toBe(FUSION);
  });

  it("⚠️ le témoin négatif : sans le câblage, le même chemin rend null — l'essai d'au-dessus dépend donc bien de lui", () => {
    // Sans ce témoin, un `identite()` qui rendrait la tête par un autre moyen ferait passer l'essai
    // précédent alors que le câblage aurait disparu.
    const etape = etapeDuProducteur();
    const sansCablage = { ...etape, env: Object.fromEntries(Object.entries(etape.env || {}).filter(([k]) => k !== "PLAYER_RAPPORT_PR_HEAD")) };
    const env = { ...environnementDeLEtape(sansCablage, CONTEXTE_DE_PR), GITHUB_EVENT_NAME: "pull_request", GITHUB_SHA: FUSION, GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" };
    expect(rapport.identite({ env, empreinte, version: "0.0.0", quand: new Date() }).prHeadSha).toBe(null);
  });

  it("hors PR, le câblage se résout à vide et prHeadSha vaut null — exiger une tête sur un tag en inventerait une", () => {
    const contexteDeTag = { github: { event_name: "push", sha: "d".repeat(40), event: {} } };
    const env = { ...environnementDeLEtape(etapeDuProducteur(), contexteDeTag), GITHUB_EVENT_NAME: "push", GITHUB_SHA: "d".repeat(40), GITHUB_RUN_ID: "1", GITHUB_RUN_ATTEMPT: "1" };
    const id = rapport.identite({ env, empreinte, version: "0.0.0", quand: new Date() });
    expect(id.prHeadSha).toBe(null);
    expect(id.event).toBe("push");
  });

  it("l'évaluateur d'expressions rend bien ce que la forge rendrait, sur les deux branches du `||`", () => {
    // Un évaluateur qui rendrait toujours la tête ferait passer le témoin négatif comme le reste.
    expect(resoudre("${{ github.event.pull_request.head.sha || '' }}", CONTEXTE_DE_PR)).toBe(TETE);
    expect(resoudre("${{ github.event.pull_request.head.sha || '' }}", { github: { event: {} } })).toBe("");
    expect(resoudre("${{ github.event.pull_request.head.sha || 'repli' }}", { github: { event: {} } })).toBe("repli");
    expect(resoudre("rien à résoudre", CONTEXTE_DE_PR)).toBe("rien à résoudre");
  });
});
