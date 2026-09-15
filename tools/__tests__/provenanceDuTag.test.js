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

/** Les `needs` déclarés d'un job, en liste — que la forme soit `needs: x` ou `needs: [x, y]`. */
function needsDe(nom) {
  const m = /^\s*needs:\s*(.+)$/m.exec(job(nom));
  if (!m) return [];
  return m[1].replace(/[[\]]/g, "").split(",").map((x) => x.trim()).filter(Boolean);
}

/** `nom` est-il ACCESSIBLE depuis `racine` en remontant les `needs` ? La propriété, pas la forme. */
function derriere(nom, racine, vus = new Set()) {
  for (const parent of needsDe(nom)) {
    if (parent === racine) return true;
    if (vus.has(parent)) continue;
    vus.add(parent);
    if (derriere(parent, racine, vus)) return true;
  }
  return false;
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

  it("la chaîne needs donne autorité au refus : tout job qui produit passe DERRIÈRE verifier", () => {
    // Détacher un maillon laisserait le garde vert et l'attestation libre — la mutation exacte que
    // ce test rend rouge. ⚠️ Ce qui compte est l'ACCESSIBILITÉ depuis `verifier`, pas une chaîne
    // littérale : ce banc figeait « publier → eprouver → attester » et il a rougi le jour où
    // `attester` a été rebranché sur `publier` — un changement qui RENFORCE la propriété visée
    // (attester reste derrière verifier) tout en cessant de faire dépendre les preuves d'un test
    // postérieur à la publication. Un banc qui fige une forme au lieu de sa propriété refuse aussi
    // les corrections. Il vérifie donc la propriété, et le maillon retiré a son propre essai.
    for (const nom of ["publier", "eprouver", "attester", "annoncer"]) {
      expect(derriere(nom, "verifier"), `${nom} n'est plus derrière verifier`).toBe(true);
    }
  });

  it("⚠️ attester ne dépend PAS de eprouver : une preuve d'octets publiés n'est pas otage d'un test qui court APRÈS la publication", () => {
    // Le 14/09, `eprouver` a échoué sur une propagation de registre — sans rapport avec les octets —
    // et a emporté le SBOM, l'attestation et la Release. Pendant trois minutes et demie, le paquet
    // était installable sans qu'aucun de ces moyens de vérification n'existe. Les retenir ne protège
    // personne : ceux qui installent alors sont précisément ceux à qui on les refuse. (Un hôte, ADV.)
    expect(needsDe("attester")).not.toContain("eprouver");
    expect(needsDe("attester")).toContain("publier");
    // Et `eprouver` reste une garde : son rouge rougit la course, il ne retient plus les preuves.
    expect(needsDe("eprouver")).toContain("publier");
  });

  it("⚠️ mais la RELEASE PUBLIQUE, elle, attend le test de fumée — la preuve et la recommandation ne sont pas le même objet", () => {
    // ⚠️ CE BANC EXISTE PARCE QUE LE BANC D'AU-DESSUS NE SUFFISAIT PAS. En rattachant `attester` à
    // `publier`, `annoncer` a suivi par simple transitivité et a PERDU sa dépendance à `eprouver` :
    // le graphe autorisait dès lors une Release publique créée pendant que le test du paquet
    // installé était rouge, ou avant qu'il ait fini. Le commentaire en tête de release.yml
    // promettait « publié ÉPROUVÉ » et plus rien ne le tenait. Le banc de l'époque ne demandait que
    // « atteignable depuis verifier », ce qui restait vrai — une propriété trop faible pour voir la
    // perte. Défaut nommé par un auditeur externe (CODEX, 15/09).
    //
    // La distinction qui tient les deux bancs ensemble : l'ATTESTATION porte sur des octets DÉJÀ
    // PARTIS et ne doit attendre personne ; la RELEASE est une recommandation d'installer, et elle
    // attend le test de ce qui s'installe.
    expect(derriere("annoncer", "eprouver"), "annoncer n'attend plus le test de fumée").toBe(true);
    expect(derriere("annoncer", "attester"), "annoncer n'attend plus l'attestation").toBe(true);
  });

  it("⚠️ attester ATTEND dist.integrity au lieu de le demander une fois — l'abri qu'il tenait de eprouver, il le porte lui-même", () => {
    // ⚠️ CE `npm view` ÉTAIT SANS RISQUE, ET LE CORRECTIF DU 14/09 L'A RENDU DANGEREUX. Tant que
    // `attester` dépendait de `eprouver`, celui-ci avait déjà attendu jusqu'à 240 s que le registre
    // serve la version : `dist.integrity` était forcément là. En rattachant `attester` à `publier`
    // — pour une bonne raison — cet abri a disparu sans être remplacé, et le vide de propagation
    // qui a coûté la sortie 0.1.168 se retrouvait RÉARMÉ un job plus loin, frappant cette fois
    // l'attestation. Un correctif qui déplace un risque sans le dire est un correctif à moitié.
    // Défaut nommé par un auditeur externe (CODEX, 15/09).
    //
    // La règle des trois sorties (« réussi, refusé, j'ai renoncé ») est tenue pour toutes les
    // boucles des workflows par `tools/boucles-de-reessai.mjs` ; ce banc-ci tient l'autre moitié,
    // que la garde ne peut pas voir : qu'il y ait une boucle DU TOUT autour de cette lecture.
    const a = job("attester");
    const [, avant] = a.split("dist.integrity");
    expect(avant, "dist.integrity n'est pas lu dans attester").toBeTruthy();
    expect(a, "dist.integrity est demandé sans attente — une seule lecture, juste après publier")
      .toMatch(/for [^\n]*seq 1 \d+[\s\S]*?dist\.integrity[\s\S]*?done/);
  });

  it("l'attestation vit dans attester, et nulle part ailleurs", () => {
    const usages = texte.match(/uses:\s*actions\/attest-build-provenance@/g) || [];
    expect(usages, "attest-build-provenance dupliqué : une copie hors de la chaîne échapperait au refus").toHaveLength(1);
    expect(job("attester")).toContain("actions/attest-build-provenance@");
  });
});
