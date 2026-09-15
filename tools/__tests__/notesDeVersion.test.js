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
// soupçon. `NOTES` est arrivé vide à la composition du corps : la Release publique a reçu son
// tarball, son condensat, sa signature, son SBOM et ses trois mesures de charge — et pas une ligne
// des seize entrées qui disaient ce qui avait changé. Les cinq jobs étaient verts, et les cinq
// sorties précédentes portaient les leurs, ce qui rendait la perte invisible.
//
// ⚠️ LA GARDE D'ALORS VIVAIT DU MAUVAIS CÔTÉ. `test -s /tmp/notes.md || exit 1` prouvait que la
// section avait été EXTRAITE. Personne ne posait la seule question qui compte : est-elle ARRIVÉE ?
// C'est exactement le défaut du 22/08 — un motif promis, aucun fichier, pas un mot — dans une autre
// matière. Un contrôle chez le producteur ne dit rien du transport.
//
// ⚠️ ET CE BANC TIENT AUSSI CE QUE MA PREMIÈRE RÉDACTION DU CORRECTIF A FAILLI CASSER. J'avais
// déplacé l'extraction dans un outil de `tools/` — plus propre, testable, une seule implémentation.
// Or un rejeu par `workflow_dispatch` exécute le workflow de `main` CONTRE LE CONTENU DU TAG : cet
// outil n'existe sur AUCUN tag existant, et le rattrapage d'une sortie — la raison même d'être du
// dispatch — serait devenu impossible. Ce qui vit dans le fichier de workflow vient toujours de
// `main` ; ce qui vit dans `tools/` vient du tag. Le dépôt l'écrit ailleurs, à propos du validateur
// de charge, et je l'avais lu.

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { parse } from "yaml";
import { describe, it, expect } from "vitest";

const brut = readFileSync(".github/workflows/release.yml", "utf8");
const workflow = parse(brut);

const etapeAvec = (job, motif) =>
  (workflow.jobs[job].steps || []).find((e) => typeof e.run === "string" && e.run.includes(motif));

describe("⚠️ LE TRANSPORT DES NOTES N'EST PLUS UNE SORTIE DE JOB", () => {
  it("aucun job ne déclare d'output qui transporte les notes", () => {
    // ⚠️ LA CAUSE RACINE, ÉNONCÉE COMME PROPRIÉTÉ. Une sortie de job est confrontée aux valeurs
    // masquées et peut être SUPPRIMÉE sans que rien n'échoue : le transport est alors fragile au
    // CONTENU de ce qu'il transporte. Aucune consigne de prudence ne protège de ça — seule la forme
    // le fait. Un artefact n'est confronté à rien.
    for (const [nom, job] of Object.entries(workflow.jobs)) {
      expect(Object.keys(job.outputs || {}), `le job ${nom} transporte des notes par une sortie de job`).not.toContain("notes");
    }
    expect(brut, "une sortie de job réintroduit le transport supprimé le 15/09").not.toMatch(/needs\.\w+\.outputs\.notes/);
    expect(brut, "le corps se compose encore depuis une variable que la forge peut vider").not.toMatch(/\$\{\{\s*needs\.verifier\.outputs\.notes\s*\}\}/);
  });

  it("verifier téléverse les notes comme ARTEFACT, en refusant de n'en téléverser aucune", () => {
    const depots = (workflow.jobs.verifier.steps || []).filter((e) => String(e.uses || "").startsWith("actions/upload-artifact@"));
    const notes = depots.find((e) => e.with && e.with.name === "notes-de-version");
    expect(notes, "verifier ne téléverse pas les notes").toBeTruthy();
    expect(String(notes.with.path)).toMatch(/notes\.md/);
    // `if-no-files-found: error` : un artefact vide se téléverserait en silence, et on retomberait
    // exactement sur ce qu'on corrige — un transport qui ne dit pas qu'il n'a rien porté.
    expect(notes.with["if-no-files-found"]).toBe("error");
  });

  it("annoncer le télécharge, et REFUSE un corps sans notes — la garde manquante du 15/09", () => {
    const telecharge = (workflow.jobs.annoncer.steps || [])
      .filter((e) => String(e.uses || "").startsWith("actions/download-artifact@"))
      .find((e) => e.with && e.with.name === "notes-de-version");
    expect(telecharge, "annoncer ne récupère pas les notes").toBeTruthy();

    const compose = etapeAvec("annoncer", "corps.md");
    expect(compose).toBeTruthy();
    expect(compose.run, "rien n'arrête la sortie quand les notes ne sont pas arrivées")
      .toMatch(/\[ -s paquet\/notes\.md \] \|\|[\s\S]*?exit 1/);
    expect(compose.run, "le corps ne se compose pas depuis le fichier").toMatch(/cat paquet\/notes\.md > corps\.md/);
    expect(compose.run, "le corps se compose encore depuis une variable d'environnement").not.toMatch(/"\$NOTES"/);
  });

  it("⚠️ l'extraction reste DANS le workflow — sinon aucun tag existant ne peut plus être rejoué", () => {
    // ⚠️ MA PREMIÈRE RÉDACTION DE CE CORRECTIF A ÉCHOUÉ ICI. Elle appelait un outil de `tools/`,
    // absent de tous les tags publiés : un rejeu par dispatch — qui exécute le workflow de `main`
    // contre le contenu du TAG — serait mort sur « module introuvable », et le rattrapage d'une
    // sortie ratée, raison d'être du dispatch, aurait cessé d'exister. Ce banc fige la contrainte
    // pour qu'elle ne se redécouvre pas un jour de panne.
    const extraction = etapeAvec("verifier", "extraire CHANGELOG.md");
    expect(extraction, "l'extraction ne vit plus dans le workflow").toBeTruthy();
    expect(extraction.run, "l'extraction dépend d'un fichier du dépôt, indisponible sur les tags antérieurs")
      .not.toMatch(/node tools\//);
    // Et elle refuse AVANT la publication npm : une section absente ne doit pas se découvrir une
    // fois le paquet parti chez les gens.
    expect(extraction.run).toMatch(/test -s \/tmp\/notes\.md \|\|[\s\S]*?exit 1/);
    const jobs = Object.keys(workflow.jobs);
    expect(jobs.indexOf("verifier")).toBeLessThan(jobs.indexOf("publier"));
    expect([].concat(workflow.jobs.publier.needs)).toContain("verifier");
  });

  it("⚠️ l'extraction rend BIEN la section demandée, et s'arrête à la version suivante", () => {
    // Le shell du workflow, joué tel quel sur un CHANGELOG fabriqué : une section qui emporterait
    // la version d'après publierait les notes de deux sorties sous le nom d'une seule, et le texte
    // resterait parfaitement plausible.
    const faux = [
      "# Changelog", "", "## [Unreleased]", "",
      "## [0.2.0] — 2026-10-01", "", "### Added", "- la chose neuve", "",
      "## [0.1.169] — 2026-09-15", "", "### Fixed", "- la chose corrigée", "",
      "## [0.1.168] — 2026-09-14", "", "### Added", "- l'ancienne chose", "",
    ].join("\n");
    const awk = (extraction, version) => {
      const m = extraction.run.match(/extraire\(\) \{ awk -v v="\$V" '([\s\S]*?)' "\$1"; \}/);
      expect(m, "la fonction d'extraction n'a pas la forme attendue").toBeTruthy();
      return execFileSync("awk", ["-v", `v=${version}`, m[1], "/dev/stdin"], { input: faux, encoding: "utf8" });
    };
    const extraction = etapeAvec("verifier", "extraire CHANGELOG.md");
    expect(awk(extraction, "0.1.169").trim()).toBe("### Fixed\n- la chose corrigée");
    expect(awk(extraction, "0.2.0").trim()).toBe("### Added\n- la chose neuve");
    expect(awk(extraction, "9.9.9").trim()).toBe("");
  });

  it("le CHANGELOG du dépôt a bien une section pour la version du paquet", () => {
    // Un témoin sur le dépôt lui-même : l'essai d'à côté prouverait l'extraction sur un CHANGELOG
    // fabriqué, et resterait vert le jour où le nôtre perdrait sa section.
    const version = JSON.parse(readFileSync("package.json", "utf8")).version;
    const lignes = readFileSync("CHANGELOG.md", "utf8").split("\n");
    const debut = lignes.findIndex((l) => l.startsWith(`## [${version}]`));
    expect(debut, `aucune section « ## [${version}] » dans le CHANGELOG`).toBeGreaterThanOrEqual(0);
    const reste = lignes.slice(debut + 1);
    const fin = reste.findIndex((l) => l.startsWith("## ["));
    expect((fin < 0 ? reste : reste.slice(0, fin)).join("\n").trim().length).toBeGreaterThan(200);
  });
});
