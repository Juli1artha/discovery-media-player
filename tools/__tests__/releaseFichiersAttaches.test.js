// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES FICHIERS QUE LA RELEASE PROMET, ET CEUX QU'ELLE VÉRIFIE, SONT LA MÊME LISTE.
//
// ⚠️ CE QUI EST ARRIVÉ (rejeu du 22/08). `files:` disait `paquet/*.jsonl` ; le bundle produit par
// l'action d'attestation s'appelait alors `attestation.json`. Le motif ne correspondait à rien —
// `softprops/action-gh-release` IGNORE SILENCIEUSEMENT un motif sans correspondance. La Release a
// donc reçu deux fichiers sur les trois annoncés, avec les cinq jobs au vert et pas un mot.
//
// Le correctif est une étape qui refuse quand un motif ne désigne aucun fichier. Mais cette étape
// crée un SECOND exemplaire de la liste — et dans ce dépôt « un fait qui existe en deux exemplaires
// non confrontés dérive ». Le jour où quelqu'un ajoute un fichier à `files:` sans l'ajouter à la
// garde, on revient exactement au silence d'aujourd'hui. Ce banc est la confrontation.
//
// ⚠️ IL NE VÉRIFIE PAS QUE LES FICHIERS EXISTENT — personne ne peut le savoir hors d'une sortie.
// Il vérifie que ce qui est promis est ce qui est contrôlé, ce qui suffit : le contrôle, lui,
// s'exécute au moment où les fichiers sont là.

import { readFileSync } from "node:fs";
import { parse } from "yaml";
import { describe, it, expect } from "vitest";

const workflow = parse(readFileSync(".github/workflows/release.yml", "utf8"));
const etapes = workflow.jobs.annoncer.steps;

const indexGarde = etapes.findIndex((e) => typeof e.run === "string" && e.run.includes("for motif in"));
const indexRelease = etapes.findIndex((e) => String(e.uses || "").startsWith("softprops/action-gh-release@"));

/**
 * Les motifs de CHAQUE boucle de la garde, tels que le shell les verra : sans les guillemets de
 * collage. La garde en a deux, et la différence entre elles est la règle :
 *
 *   • la première EXIGE — un motif sans correspondance arrête la sortie ;
 *   • la seconde DIT — un motif sans correspondance écrit un avertissement et une ligne dans le
 *     corps de la Release, sans l'arrêter.
 *
 * ⚠️ POURQUOI DEUX DEGRÉS PLUTÔT QU'UN. La mesure de charge n'existe que pour les commits dont la
 * CI l'a produite. L'exiger bloquerait tout rejeu par dispatch sur un tag antérieur au producteur —
 * c'est-à-dire exactement les sorties que le dispatch existe pour rattraper. Ce qui reste interdit,
 * et que ce banc tient : qu'un motif promis n'appartienne à AUCUNE des deux boucles, car il
 * redeviendrait alors ce qu'il était le 22/08 — ignoré en silence.
 */
const motifsDesBoucles = (run) => {
  const boucles = [...run.matchAll(/for motif in (.+?); do/g)].map((m) => m[1].split(/\s+/).map((x) => x.replace(/["']/g, "")));
  if (!boucles.length) throw new Error("la boucle de la garde n'a pas la forme attendue");
  return boucles;
};
const motifsDeLaGarde = (run) => motifsDesBoucles(run).flat();

const motifsPromis = (files) => String(files).split("\n").map((x) => x.trim()).filter(Boolean);

describe("⚠️ LA RELEASE NE PEUT PAS PROMETTRE UN FICHIER QU'ELLE NE CONTRÔLE PAS", () => {
  it("l'étape qui contrôle existe, et AVANT celle qui publie", () => {
    // Un contrôle placé après la publication ne conditionne rien — c'est déjà la raison pour
    // laquelle `annoncer` est le dernier job du workflow.
    expect(indexGarde, "aucune étape ne contrôle les fichiers attachés").toBeGreaterThanOrEqual(0);
    expect(indexRelease).toBeGreaterThan(indexGarde);
  });

  it("⚠️ aucun motif promis n'échappe aux deux boucles, et aucune boucle ne contrôle un motif qui n'est pas promis", () => {
    expect([...motifsDeLaGarde(etapes[indexGarde].run)].sort())
      .toEqual([...motifsPromis(etapes[indexRelease].with.files)].sort());
  });

  it("elle en EXIGE quatre — le tarball, son condensat, sa signature, son SBOM — et en DIT un cinquième", () => {
    // Le compte est le fait qui a été rompu en silence. Ce banc avait prévu le cas : « un jour on
    // en attachera un quatrième — il faudra alors le dire ici ». Le quatrième est le SBOM
    // CycloneDX ; le cinquième est la mesure de charge du commit publié, reprise de sa propre
    // course CI par `attester`, et c'est le seul qui soit dit plutôt qu'exigé.
    const [exiges, dits] = motifsDesBoucles(etapes[indexGarde].run);
    expect(exiges).toHaveLength(4);
    expect(dits).toEqual(["paquet/*-charge-*.json"]);
    expect(motifsPromis(etapes[indexRelease].with.files)).toHaveLength(5);
  });

  it("⚠️ la boucle qui EXIGE arrête la sortie, celle qui DIT ne l'arrête pas — sinon les deux degrés n'en font qu'un", () => {
    const run = etapes[indexGarde].run;
    const [avant, apres] = run.split('for motif in "paquet/"*-charge-*.json; do');
    expect(avant, "la boucle des exigés ne lève pas de drapeau d'échec").toMatch(/::error::[\s\S]*manquants=1/);
    expect(run, "rien n'arrête la sortie quand un fichier exigé manque").toMatch(/\[ "\$manquants" = 0 \] \|\| exit 1/);
    expect(apres, "la boucle qui DIT écrit un avertissement").toMatch(/::warning::/);
    expect(apres.split("ls -l")[0], "la boucle qui DIT ne doit ni poser manquants=1 ni sortir en 1").not.toMatch(/manquants=1|exit 1/);
  });

  it("la mesure attachée est celle du commit, reprise de sa course CI — jamais une mesure refaite ici", () => {
    // Refaire la mesure dans le workflow de sortie donnerait une AUTRE mesure pour le même commit :
    // autre runner, autre instant, autre base. Deux séries pour un point, et rien pour départager.
    const attester = workflow.jobs.attester.steps;
    const reprise = attester.find((e) => typeof e.run === "string" && e.run.includes("gh run download"));
    expect(reprise, "aucune étape ne reprend l'artefact de charge de la course du commit").toBeTruthy();
    expect(reprise.run).toMatch(/--workflow CI/);
    expect(reprise.run).toMatch(/git rev-parse HEAD/);
    // Et elle ne l'attache qu'après l'avoir jugée, en cohorte.
    expect(reprise.run).toMatch(/node tools\/artefact-de-charge\.mjs \$args/);
    expect(workflow.jobs.attester.permissions).toMatchObject({ "actions": "read" });

    // ⚠️ AUCUNE PRODUCTION DE MESURE ICI — et c'est un APPEL qui est interdit, pas un mot. Le corps
    // de la Release NOMME `charge/rapport.js` en prose, pour dire au lecteur d'une sortie sans
    // mesure pourquoi elle n'en a pas ; interdire la chaîne de caractères condamnerait cette phrase
    // et pousserait à la retirer — on perdrait l'explication sans rien gagner sur le fond.
    // Ce qui doit rester vrai est plus étroit : qu'aucune étape ne LANCE le producteur.
    const lancements = Object.values(workflow.jobs)
      .flatMap((job) => job.steps || [])
      .map((e) => e.run)
      .filter((run) => typeof run === "string" && /(^|\s)node\s[^\n]*charge\/rapport\.js/.test(run));
    expect(lancements, "une étape de la sortie produit une mesure au lieu de reprendre celle du commit")
      .toHaveLength(0);
  });

  it("⚠️ au moins un actif promis porte un suffixe que Scorecard reconnaît comme signature", () => {
    // ⚠️ UNE VRAIE SIGNATURE SOUS LE MAUVAIS NOM COMPTE ZÉRO, ET C'EST ARRIVÉ ICI. L'OpenSSF
    // Scorecard — v5.5.0, celle qu'embarque l'action épinglée par scorecard.yml — ne reconnaît
    // une release comme signée qu'à un suffixe de sa liste (probes/releasesAreSigned/impl.go,
    // lue sur le source du tag) : .asc, .minisig, .sig, .sign, .sigstore, .sigstore.json.
    // Le bundle s'appelait `attestation.json` — chaque sortie signée depuis la 0.1.130, et
    // Signed-Releases à 0/10, parce qu'aucun nom d'actif ne le DISAIT dans un vocabulaire
    // que l'outil comprend.
    //
    // Ce test empêche le retour silencieux de ce faux négatif : renommer le bundle hors de la
    // liste — revenir au nom de l'action, « simplifier » l'extension — rend le score faux sans
    // rien casser d'autre, et c'est précisément la classe de dérive qu'un banc doit attraper.
    // La liste est recopiée ici EN DUR, comme l'étiquette d'à côté d'un SHA : si Scorecard
    // change la sienne, c'est une montée de version à relire, pas une constante à suivre.
    const SUFFIXES_SCORECARD = [".asc", ".minisig", ".sig", ".sign", ".sigstore", ".sigstore.json"];
    const promis = motifsPromis(etapes[indexRelease].with.files);
    const reconnus = promis.filter((p) => SUFFIXES_SCORECARD.some((s) => p.endsWith(s)));
    expect(reconnus, "aucun actif promis ne porte un suffixe de signature reconnu — Signed-Releases retomberait à 0 en silence")
      .not.toHaveLength(0);
  });

  it("le bundle promis porte la version, pas un nom générique", () => {
    // `attestation.json` était aussi un nom ANONYME : détaché de la release, il ne dit pas ce
    // qu'il signe. Le motif promis doit être versionné comme le tarball et le SBOM le sont.
    const sigstore = motifsPromis(etapes[indexRelease].with.files).find((p) => p.endsWith(".sigstore.json"));
    expect(sigstore).toMatch(/discovery-media-player-.*\.sigstore\.json$|\*\.sigstore\.json$/);
  });
});
