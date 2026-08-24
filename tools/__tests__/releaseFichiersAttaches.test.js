// LES FICHIERS QUE LA RELEASE PROMET, ET CEUX QU'ELLE VÉRIFIE, SONT LA MÊME LISTE.
//
// ⚠️ CE QUI EST ARRIVÉ (rejeu du 22/08). `files:` disait `paquet/*.jsonl` ; le bundle produit par
// l'action d'attestation s'appelle `attestation.json`. Le motif ne correspondait à rien —
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

/** Les motifs de la boucle shell, tels que le shell les verra : sans les guillemets de collage. */
const motifsDeLaGarde = (run) => {
  const m = /for motif in (.+?); do/.exec(run);
  if (!m) throw new Error("la boucle de la garde n'a pas la forme attendue");
  return m[1].split(/\s+/).map((x) => x.replace(/["']/g, ""));
};

const motifsPromis = (files) => String(files).split("\n").map((x) => x.trim()).filter(Boolean);

describe("⚠️ LA RELEASE NE PEUT PAS PROMETTRE UN FICHIER QU'ELLE NE CONTRÔLE PAS", () => {
  it("l'étape qui contrôle existe, et AVANT celle qui publie", () => {
    // Un contrôle placé après la publication ne conditionne rien — c'est déjà la raison pour
    // laquelle `annoncer` est le dernier job du workflow.
    expect(indexGarde, "aucune étape ne contrôle les fichiers attachés").toBeGreaterThanOrEqual(0);
    expect(indexRelease).toBeGreaterThan(indexGarde);
  });

  it("⚠️ les deux listes sont exactement la même", () => {
    expect(motifsDeLaGarde(etapes[indexGarde].run)).toEqual(motifsPromis(etapes[indexRelease].with.files));
  });

  it("elle en promet quatre : le tarball, son condensat, sa provenance, son SBOM", () => {
    // Le compte est le fait qui a été rompu en silence. Ce banc avait prévu le cas : « un jour on
    // en attachera un quatrième — il faudra alors le dire ici ». C'est fait, et le quatrième est
    // le SBOM CycloneDX du paquet, produit par `attester` à côté du tarball qu'il décrit.
    expect(motifsPromis(etapes[indexRelease].with.files)).toHaveLength(4);
  });
});
