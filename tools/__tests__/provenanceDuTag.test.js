// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA PROVENANCE NOMME LE COMMIT QUI CONSTRUIT LES OCTETS — OU LE RUN REFUSE.
//
// ⚠️ L'INCIDENT EST LA 0.1.136, ET IL EST PUBLIC (docs/VERIFYING-RELEASES.md). Sa récupération a
// été dispatchée depuis `main` : les jobs ont extrait le TAG (octets corrects), mais
// `attest-build-provenance` grave `github.sha` — la tête de `main` à cet instant. La provenance
// publiée nomme donc un commit dont la reconstruction ne reproduit PAS l'archive : 32 des 59
// fichiers publiés diffèrent du commit attesté, 0 du tag. Indiscernable d'une substitution pour
// qui ne sait pas — et le contrôle qui échouerait pour cette raison bénigne est exactement celui
// qui devrait attraper une vraie substitution (un rouge bénin apprend à cliquer à côté).
//
// Le correctif n'est pas de divulguer après coup (c'était la première réponse, elle reste en
// place comme second filet) : c'est de REFUSER en amont. `verifier` compare le commit du run au
// commit du tag et sort en 1 s'ils diffèrent — et comme `publier`, `eprouver` et `attester`
// s'enchaînent derrière lui, aucune attestation ne peut naître d'un run divergent. Ce banc tient
// les DEUX moitiés : le refus existe, ET la chaîne qui lui donne autorité n'est pas détachée —
// retirer un seul maillon `needs` rendrait le garde décoratif sans faire rougir autre chose.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const texte = readFileSync(join(RACINE, ".github/workflows/release.yml"), "utf8");

/** Le bloc d'un job : de `  nom:` au prochain job de même indentation (ou la fin). */
function job(nom) {
  const debut = texte.search(new RegExp(`^ {2}${nom}:\\s*$`, "m"));
  expect(debut, `job « ${nom} » introuvable dans release.yml`).toBeGreaterThanOrEqual(0);
  const suite = texte.slice(debut + 1).search(/^ {2}[a-z_]+:\s*$/m);
  return suite === -1 ? texte.slice(debut) : texte.slice(debut, debut + 1 + suite);
}

describe("le run qui attesterait un autre commit que le tag est refusé avant tout artefact", () => {
  it("verifier confronte le commit du run au commit du tag, et sort en 1 sur divergence", () => {
    const verifier = job("verifier");
    expect(verifier).toContain("provenance will name what built the bytes");
    expect(verifier).toContain("git rev-parse HEAD");
    expect(verifier).toContain('"$GITHUB_SHA"');
    // ⚠️ Le refus doit être un ÉCHEC, pas un avertissement : un warning sur le workflow qui
    // publie est un warning que personne ne lit avant que l'artefact existe.
    expect(verifier).toMatch(/if \[ "\$sha_du_tag" != "\$GITHUB_SHA" \][\s\S]{0,400}exit 1/);
  });

  it("la chaîne needs donne autorité au refus : publier → eprouver → attester derrière verifier", () => {
    // Détacher un maillon (attester sans eprouver, eprouver sans publier…) laisserait le garde
    // vert et l'attestation libre — la mutation exacte que ce test rend rouge.
    expect(job("publier")).toMatch(/needs:\s*verifier/);
    expect(job("eprouver")).toMatch(/needs:\s*publier/);
    expect(job("attester")).toMatch(/needs:\s*eprouver/);
  });

  it("l'attestation vit dans attester, et nulle part ailleurs", () => {
    const usages = texte.match(/uses:\s*actions\/attest-build-provenance@/g) || [];
    expect(usages, "attest-build-provenance dupliqué : une copie hors de la chaîne échapperait au refus").toHaveLength(1);
    expect(job("attester")).toContain("actions/attest-build-provenance@");
  });
});
