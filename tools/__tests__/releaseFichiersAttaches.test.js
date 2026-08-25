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

  it("elle en promet quatre : le tarball, son condensat, sa signature, son SBOM", () => {
    // Le compte est le fait qui a été rompu en silence. Ce banc avait prévu le cas : « un jour on
    // en attachera un quatrième — il faudra alors le dire ici ». C'est fait, et le quatrième est
    // le SBOM CycloneDX du paquet, produit par `attester` à côté du tarball qu'il décrit.
    expect(motifsPromis(etapes[indexRelease].with.files)).toHaveLength(4);
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
