// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE RELEASE QUI NE DIT PAS CE QUI A CHANGÉ N'EST PAS UNE RELEASE.
//
// ⚠️ CE QUI EST ARRIVÉ (15/09, SORTIE 0.1.169). Les notes voyageaient de `verifier` à `annoncer`
// par une SORTIE DE JOB. La forge l'a supprimée en chemin, et l'a écrit dans son journal :
//
//     ##[warning]Skip output 'notes' since it may contain secret.
//
// Le runner confronte chaque sortie aux valeurs masquées et jette la sortie ENTIÈRE au moindre
// soupçon. La section 0.1.169 décrivait le correctif de caviardage des messages d'échec et citait,
// pour l'illustrer, une chaîne en forme de clé d'API : un texte qui PARLE d'un secret a été traité
// COMME un secret. La Release publique est partie avec son tarball, son condensat, sa signature,
// son SBOM et ses trois mesures de charge — et sans une ligne de ses notes. Les cinq jobs étaient
// verts, et les cinq sorties précédentes portaient les leurs, ce qui rendait la perte invisible.
//
// ⚠️ LA GARDE D'ALORS VIVAIT DU MAUVAIS CÔTÉ. `test -s /tmp/notes.md || exit 1` prouvait que la
// section avait été EXTRAITE. Personne ne posait la seule question qui compte : est-elle ARRIVÉE ?
// C'est exactement le défaut du 22/08 — un motif promis, aucun fichier, pas un mot — dans une autre
// matière. Un contrôle chez le producteur ne dit rien du transport.
//
// Ces bancs tiennent les deux moitiés du correctif : le transport n'est plus une sortie de job, et
// le consommateur refuse ce qui n'est pas arrivé.

import { readFileSync, mkdtempSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "yaml";
import { describe, it, expect } from "vitest";

import { sectionDe, auditerNotes } from "../notes-de-version.mjs";

const brut = readFileSync(".github/workflows/release.yml", "utf8");
const workflow = parse(brut);
const dossier = mkdtempSync(join(tmpdir(), "notes-"));

const CHANGELOG = [
  "# Changelog", "",
  "## [Unreleased]", "",
  "## [0.2.0] — 2026-10-01", "",
  "### Added", "- la chose neuve", "",
  "## [0.1.169] — 2026-09-15", "",
  "### Fixed", "- la chose corrigée", "",
  "## [0.1.168] — 2026-09-14", "",
  "### Added", "- l'ancienne chose", "",
].join("\n");

describe("extraire la section d'une version", () => {
  it("rend le contenu, sans le titre, et s'arrête à la version suivante", () => {
    // ⚠️ S'ARRÊTER AU SUIVANT N'EST PAS UN DÉTAIL : une section qui emporterait la version d'après
    // publierait les notes de deux sorties sous le nom d'une seule, et le texte resterait plausible.
    expect(sectionDe(CHANGELOG, "0.1.169")).toBe("### Fixed\n- la chose corrigée");
    expect(sectionDe(CHANGELOG, "0.2.0")).toBe("### Added\n- la chose neuve");
    expect(sectionDe(CHANGELOG, "0.1.168")).toBe("### Added\n- l'ancienne chose");
  });

  it("une version absente rend le vide, et une section vide aussi", () => {
    expect(sectionDe(CHANGELOG, "9.9.9")).toBe("");
    expect(sectionDe("## [1.0.0]\n\n## [0.9.0]\n\n### Added\n- x", "1.0.0")).toBe("");
  });

  it("⚠️ une section absente ou vide REFUSE — publier sans dire ce qui a changé n'est pas une sortie", () => {
    expect(auditerNotes({ version: "9.9.9", changelog: CHANGELOG }).code).toBe(1);
    expect(auditerNotes({ version: "9.9.9", changelog: CHANGELOG }).constats.join("")).toMatch(/pas de notes, pas de sortie/);
    expect(auditerNotes({ version: "0.1.169", changelog: CHANGELOG }).code).toBe(0);
  });

  it("sans version demandée : NON CONCLUANT, jamais vert sur rien", () => {
    expect(auditerNotes({ changelog: CHANGELOG }).code).toBe(2);
  });

  it("⚠️ la section va dans un FICHIER, jamais sur la sortie standard", () => {
    // `conclure` écrit le résumé de la garde sur stdout. Si la section y partait aussi, la ligne
    // « section 0.1.169 : 2 lignes, 30 octets » entrerait dans le corps de la Release — et cela ne
    // se verrait qu'une fois la page publiée.
    const chemin = join(dossier, "notes.md");
    const r = auditerNotes({ version: "0.1.169", changelog: CHANGELOG, sortie: chemin });
    expect(r.code).toBe(0);
    expect(readFileSync(chemin, "utf8")).toBe("### Fixed\n- la chose corrigée\n");
    // Et sans `--sortie`, rien n'est écrit : `verifier` s'en sert comme d'un pur refus.
    const jamais = join(dossier, "jamais.md");
    expect(auditerNotes({ version: "0.1.169", changelog: CHANGELOG }).code).toBe(0);
    expect(existsSync(jamais)).toBe(false);
  });

  it("le CHANGELOG réel rend une section non vide pour la version du paquet", () => {
    // Un témoin sur le dépôt lui-même : les fixtures ci-dessus prouveraient la fonction sur un
    // CHANGELOG qui n'est pas le nôtre.
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    const r = auditerNotes({ version });
    expect(r.code, `aucune section pour ${version}`).toBe(0);
    expect(sectionDe(readFileSync("CHANGELOG.md", "utf8"), version).length).toBeGreaterThan(200);
  });
});

describe("⚠️ LE TRANSPORT DES NOTES N'EST PLUS UNE SORTIE DE JOB", () => {
  it("aucun job ne déclare d'output qui transporte les notes", () => {
    // ⚠️ LA CAUSE RACINE, ÉNONCÉE COMME PROPRIÉTÉ. Une sortie de job est confrontée aux valeurs
    // masquées et peut être SUPPRIMÉE sans que rien n'échoue — ce qui rend le transport fragile au
    // CONTENU de ce qu'il transporte. Aucune consigne de prudence ne protège de ça ; seule la forme
    // le fait. Un fichier d'artefact n'est jamais confronté à quoi que ce soit.
    for (const [nom, job] of Object.entries(workflow.jobs)) {
      const sorties = Object.keys(job.outputs || {});
      expect(sorties, `le job ${nom} transporte des notes par une sortie de job`).not.toContain("notes");
    }
    expect(brut, "une sortie de job réintroduit le transport supprimé le 15/09").not.toMatch(/outputs:[\s\S]{0,120}notes:/);
    expect(brut).not.toMatch(/needs\.\w+\.outputs\.notes/);
  });

  it("les notes descendent dans le paquet, extraites par l'outil unique", () => {
    const attester = workflow.jobs.attester.steps;
    const depose = attester.find((e) => typeof e.run === "string" && e.run.includes("notes-de-version.mjs"));
    expect(depose, "attester ne dépose pas les notes dans le paquet").toBeTruthy();
    expect(depose.run).toMatch(/--sortie=\/tmp\/sortie\/notes\.md/);
    // ⚠️ ET `verifier` GARDE SON REFUS, qui doit tomber AVANT la publication npm : une section
    // absente ne doit pas se découvrir une fois le paquet parti chez les gens.
    const garde = workflow.jobs.verifier.steps.find((e) => typeof e.run === "string" && e.run.includes("notes-de-version.mjs"));
    expect(garde, "verifier ne refuse plus une version sans section").toBeTruthy();
    expect(garde.run, "verifier ne doit rien écrire : il refuse, il ne transporte pas").not.toMatch(/--sortie=/);
  });

  it("⚠️ annoncer REFUSE un corps sans notes — la garde manquante du 15/09", () => {
    // La garde d'alors vivait chez le producteur et était verte : la section avait bien été
    // extraite. Celle-ci vit chez le consommateur, et pose la question qui manquait.
    const compose = workflow.jobs.annoncer.steps.find((e) => typeof e.run === "string" && e.run.includes("corps.md"));
    expect(compose).toBeTruthy();
    expect(compose.run, "rien n'arrête la sortie quand les notes ne sont pas arrivées")
      .toMatch(/\[ -s paquet\/notes\.md \] \|\|[\s\S]*?exit 1/);
    // Le corps se compose des FICHIERS, plus d'une variable d'environnement.
    expect(compose.run).toMatch(/cat paquet\/notes\.md > corps\.md/);
    expect(compose.run, "le corps se compose encore depuis une variable que la forge peut vider").not.toMatch(/"\$NOTES"/);
  });

  it("le fichier des notes voyage bien dans le paquet téléversé", () => {
    // Un fichier écrit dans /tmp/sortie n'arrive à `annoncer` que si le bundle l'emporte. Sans ce
    // banc, déposer les notes ailleurs les ferait manquer — et la garde d'`annoncer` refuserait
    // alors chaque sortie, ce qui est bruyant mais pas moins cassé.
    const televerse = workflow.jobs.attester.steps.find((e) => String(e.uses || "").startsWith("actions/upload-artifact@"));
    expect(televerse, "attester ne téléverse aucun paquet").toBeTruthy();
    expect(String(televerse.with.path)).toMatch(/\/tmp\/sortie/);
  });
});
