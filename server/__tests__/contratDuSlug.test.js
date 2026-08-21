// LE CONTRAT DU SLUG EXISTE EN DEUX EXEMPLAIRES, ET C'EST VOULU — DONC IL SE SURVEILLE.
//
// ⚠️ `src/bridge.ts` est le SEUL fichier MIT d'un paquet AGPL : c'est le contrat qu'une application
// hôte importe pour parler au player, et le placer sous la licence du cœur ferait de la licence un
// péage à l'intégration. Lui faire importer `src/shared.ts` (AGPL) dissoudrait cette frontière sans
// que rien ne le signale — le gain « une seule source » coûterait la raison d'être du fichier.
//
// On ne peut donc pas DÉRIVER l'un de l'autre. Ce qui reste est de comparer : cette garde échoue si
// les deux motifs divergent, et c'est elle qui remplace l'import impossible. Une duplication qu'on
// ne peut pas retirer se surveille ; c'est le cas où le PLACEMENT, à lui seul, ne suffit pas.

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");
const lire = (f) => fs.readFileSync(path.join(RACINE, f), "utf8");

const MOTIF = /\/\^\[A-Za-z0-9_-\]\{1,64\}\$\//;

function motifDe(fichier) {
  const m = lire(fichier).match(/SLUG_RE\s*=\s*(\/[^\n;]+\/)/);
  return m ? m[1] : null;
}

describe("le contrat du slug reste identique des deux côtés de la frontière de licence", () => {
  it("les deux fichiers déclarent bien un motif de slug", () => {
    expect(motifDe("src/shared.ts"), "src/shared.ts ne déclare plus SLUG_RE").not.toBeNull();
    expect(motifDe("src/bridge.ts"), "src/bridge.ts ne déclare plus SLUG_RE").not.toBeNull();
  });

  it("et ce motif est LE MÊME — sinon le navigateur et le serveur n'appliquent pas le même contrat", () => {
    expect(motifDe("src/bridge.ts"),
      "Les deux copies du contrat de slug ont divergé. Elles sont dupliquées EXPRÈS (bridge.ts est\n"
      + "MIT, shared.ts est AGPL : l'import est interdit par la licence, pas par la paresse).\n"
      + "Reportez la modification dans les deux, ou changez la frontière de licence en connaissance.")
      .toBe(motifDe("src/shared.ts"));
  });

  it("⚠️ et bridge.ts n'importe TOUJOURS PAS le cœur AGPL — la frontière est la raison de la copie", () => {
    const src = lire("src/bridge.ts");
    expect(src.includes("SPDX-License-Identifier: MIT"), "bridge.ts a perdu son en-tête MIT").toBe(true);
    const imports = [...src.matchAll(/^\s*import\s[^\n]*from\s+"([^"]+)"/gm)].map((m) => m[1]);
    expect(imports,
      "bridge.ts importe un module du cœur : un hôte qui l'inclut se retrouverait à embarquer de\n"
      + "l'AGPL, ce que son en-tête MIT promet précisément d'éviter. C'est cette promesse qui\n"
      + "justifie la duplication surveillée par ce fichier — sans elle, la copie n'a plus de raison.")
      .toEqual([]);
  });

  it("le motif est bien celui du contrat annoncé (12 caractères base64url, borné à 64)", () => {
    expect(MOTIF.test(motifDe("src/shared.ts"))).toBe(true);
  });
});
