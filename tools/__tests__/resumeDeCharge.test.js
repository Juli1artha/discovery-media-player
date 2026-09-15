// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE TABLEAU SE DÉRIVE DES OCTETS, PARCE QUE JE L'AI RECOPIÉ À LA MAIN ET QU'IL ÉTAIT FAUX.
//
// ⚠️ CE QUI EST ARRIVÉ (14/09). J'ai relayé aux hôtes le relevé de la course d'une PR — 0.1.167,
// commit 8e9e37c, course gha-34894663303-1 — en le présentant comme celui du tag 0.1.168 (commit
// f5f0ae7, course gha-34897302599-1). Les deux campagnes étaient vraies, une seule mesurait le tag,
// et personne ne pouvait le voir : le tableau ne portait ni course, ni version, ni commit. Relevé
// par un auditeur externe (CODEX, 15/09) qui a lu les JSON plutôt que le tableau.
//
// ⚠️ « FAIRE PLUS ATTENTION » N'EST PAS UN CORRECTIF. Ce qui corrige, c'est de retirer l'occasion.
// Ces bancs tiennent les trois propriétés qui le font : le tableau vient des fichiers, l'en-tête
// porte la provenance, chaque fichier vient avec son sha256 — et rien n'est résumé qui n'ait été
// jugé, car une belle présentation fait passer ses chiffres pour vérifiés.

import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

import { auditerResume, resume, tableau, entete, cadence, nombreFr, empreinteFichier } from "../resume-de-charge.mjs";

const RACINE = process.cwd();
const EXEMPLES = join(RACINE, "charge/artefacts/exemples");
const minimal = () => JSON.parse(readFileSync(join(EXEMPLES, "schema-1-minimal.json"), "utf8"));

const dossier = mkdtempSync(join(tmpdir(), "resume-"));
const poser = (nom, objet) => {
  const chemin = join(dossier, nom);
  writeFileSync(chemin, JSON.stringify(objet, null, 2) + "\n");
  return chemin;
};

describe("le résumé porte sa provenance, et il vient des fichiers", () => {
  it("⚠️ l'en-tête nomme la course, la version ET le commit — les trois qui manquaient le 14/09", () => {
    const a = minimal();
    a.identity = { ...a.identity, runId: "gha-34897302599-1", packageVersion: "0.1.168", commitSha: "f".repeat(40), repository: "Juli1artha/discovery-media-player", event: "push", ref: "refs/tags/v0.1.168" };
    const t = entete([a], { runUrl: "https://example.test/run/1" });
    expect(t).toMatch(/\*\*Course\*\* `gha-34897302599-1`/);
    expect(t).toMatch(/\*\*version\*\* `0\.1\.168`/);
    expect(t).toMatch(/\*\*commit\*\* `f{40}`/);
    expect(t).toMatch(/https:\/\/example\.test\/run\/1/);
    // La topologie aussi : des latences de quelques microsecondes ne se lisent pas sans elle.
    expect(t).toMatch(/client → player `handler-direct`/);
  });

  it("la tête d'une PR est dite quand il y en a une, et tue quand il n'y en a pas", () => {
    // `GITHUB_SHA` sur une PR est un commit de fusion éphémère : sans `prHeadSha`, l'artefact ne se
    // relie à aucun objet durable. Mais l'afficher à `null` sur un tag serait du bruit.
    const a = minimal();
    expect(entete([{ ...a, identity: { ...a.identity, prHeadSha: "a".repeat(40) } }])).toMatch(/tête de PR/);
    expect(entete([a])).not.toMatch(/tête de PR/);
  });

  it("⚠️ chaque fichier vient avec le sha256 de SES OCTETS — un lecteur confronte au lieu de nous croire", () => {
    const f = poser("artefact-1-100.json", minimal());
    const t = resume([f]);
    expect(t).toMatch(new RegExp(`\`artefact-1-100\\.json\` \\| \`${empreinteFichier(f)}\``));
    // Et l'empreinte est bien celle des octets, pas celle d'un objet reformaté.
    expect(empreinteFichier(f)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("le tableau suit l'ordre des positions, quelle que soit celle des fichiers", () => {
    const p = (n, s) => { const a = minimal(); a.scenario = { ...a.scenario, position: n, spectators: s, sequence: [100, 1000, 100] }; a.latencyMs = { ...a.latencyMs, p50: n / 10 }; return a; };
    const lignes = tableau([p(3, 100), p(1, 100), p(2, 1000)]).split("\n").slice(2);
    expect(lignes.map((l) => l.split("|")[1].trim())).toEqual(["1", "2", "3"]);
  });

  it("une position interrompue se lit comme interrompue, avec son code — pas comme une ligne vide", () => {
    // Un tableau qui tait un échec est pire qu'un tableau absent : il donne une campagne pour
    // complète. Le code stable y figure, parce qu'il s'agrège là où un message ne s'agrège pas.
    const a = minimal();
    a.complete = false;
    a.failure = { phase: "mesure", code: "deadline", reason: "3 requêtes n'ont pas répondu" };
    expect(tableau([a])).toMatch(/\*\*interrompue\*\* — deadline : 3 requêtes n'ont pas répondu/);
  });

  it("⚠️ la cadence est DITE : 2 500 req/s contre ~40 nominales, soit 62,5× — un lecteur croyait lire une charge réaliste", () => {
    // Le contrat hôte décrit un spectateur qui relit son état toutes les 25 s. Mille spectateurs
    // donnent donc ~40 requêtes/s ; cette campagne en envoie 2 500. C'est une contrainte délibérée
    // et c'est bien — mais l'artefact ne le disait nulle part, et le tableau non plus.
    const a = minimal();
    a.scenario = { ...a.scenario, spectators: 1000 };
    a.workload = { ...a.workload, scheduledRequests: 10000, targetDurationMs: 4000 };
    const c = cadence(a);
    expect(c.parSeconde).toBe(2500);
    expect(c.nominale).toBe(40);
    expect(c.facteur).toBeCloseTo(62.5, 5);
  });

  it("les nombres portent la virgule décimale, et ce qui n'est pas un nombre ne devient pas zéro", () => {
    expect(nombreFr(0.053)).toBe("0,053");
    expect(nombreFr(9)).toBe("9");
    for (const x of [undefined, null, NaN, Infinity, "3"]) expect(nombreFr(x)).toBe("—");
  });
});

describe("⚠️ RIEN N'EST RÉSUMÉ QUI N'AIT ÉTÉ JUGÉ", () => {
  it("une cohorte conforme est résumée", () => {
    expect(auditerResume({ fichiers: [poser("bon.json", minimal())], racine: RACINE }).code).toBe(0);
  });

  it("⚠️ une cohorte REFUSÉE ne produit pas de tableau — une belle présentation fait passer ses chiffres pour vérifiés", () => {
    // Le cas concret : un seul artefact qui déclare une séquence de trois. C'est exactement la
    // cohorte tronquée que le validateur laissait passer avant le 15/09.
    const a = minimal();
    a.scenario = { ...a.scenario, sequence: [100, 1000, 100], position: 1 };
    const r = auditerResume({ fichiers: [poser("tronque.json", a)], racine: RACINE });
    expect(r.code, "une cohorte refusée a tout de même été résumée").toBe(1);
    expect(r.constats.join("\n")).toMatch(/la cohorte est refusée/);
    expect(r.constats.join("\n")).toMatch(/1 artefact\(s\) tous complets pour une séquence de 3/);
  });

  it("⚠️ NON CONCLUANT sans fichier — un résumé vide se lirait comme une campagne vide", () => {
    // Zéro relevé n'est jamais une conformité : c'est la règle de tout le dossier `tools/`.
    expect(auditerResume({ fichiers: [], racine: RACINE }).code).toBe(2);
    expect(auditerResume({ racine: RACINE }).code).toBe(2);
  });

  it("un JSON illisible rend NON CONCLUANT, pas une violation : on n'a rien appris de la campagne", () => {
    const chemin = join(dossier, "casse.json");
    writeFileSync(chemin, "{ pas du json");
    expect(auditerResume({ fichiers: [chemin], racine: RACINE }).code).not.toBe(0);
  });
});
