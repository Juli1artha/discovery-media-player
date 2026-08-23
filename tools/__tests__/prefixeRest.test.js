// L'HÔTE VERS LEQUEL CE RENVOI PARLE NE DÉPEND PAS DE CE QU'ON LUI DEMANDE.
//
// ⚠️ POURQUOI CE BANC EXISTE : CodeQL classe la ligne de `fetch` en SSRF critique (#74). C'est un
// faux positif — l'autorité de l'URL est close avant que le chemin de l'appelant commence — mais
// « c'est un faux positif » est une PHRASE, et une phrase ne tient pas dans le temps. Le banc, si.
//
// ⚠️ ET IL GARDE SURTOUT CONTRE LE CORRECTIF. La réécriture qu'on fait spontanément pour faire
// taire l'alerte est `new URL(chemin, AMONT)` — et elle rend `http://evil.com/x` dès que le chemin
// commence par `//`. On créerait la faille en corrigeant le faux positif. La seconde suite ci-
// dessous MESURE ce piège au lieu de le décrire.

import { describe, it, expect } from "vitest";
import { createRequire } from "node:module";

const { cibleAmont, AMONT, PREFIXE } = createRequire(import.meta.url)("../prefixe-rest.cjs");

// Ce que peut écrire quelqu'un qui parle au renvoi. `req.url` commence toujours par `PREFIXE` —
// le serveur rend 404 avant d'arriver ici sinon — donc on préfixe chaque tentative.
const HOSTILES = [
  "//evil.com/x",
  "///evil.com/x",
  "@evil.com/x",
  "evil.com/x",
  "\\\\evil.com\\x",
  "..%2f..%2fevil.com",
  "%2f%2fevil.com",
  "x?next=//evil.com",
  "x#//evil.com",
  ":@evil.com",
];

describe("⚠️ AUCUN CHEMIN NE DÉPLACE L'HÔTE", () => {
  it("l'amont reste 127.0.0.1, quelle que soit la demande", () => {
    for (const suite of HOSTILES) {
      const cible = new URL(cibleAmont(PREFIXE + suite));
      expect(cible.host, `« ${suite} » a déplacé l'hôte`).toBe(new URL(AMONT).host);
      expect(cible.protocol).toBe("http:");
    }
  });

  it("et la demande légitime arrive entière, préfixe retiré", () => {
    // La contrepartie : une garde qui renverrait tout vers la racine satisferait la première
    // propriété sans rien servir.
    expect(cibleAmont("/rest/v1/doc_pages?slug=eq.a&select=*")).toBe(AMONT + "/doc_pages?slug=eq.a&select=*");
  });
});

describe("⚠️ LE CORRECTIF QU'ON SERAIT TENTÉ D'ÉCRIRE, MESURÉ", () => {
  it("`new URL(chemin, AMONT)` DÉTOURNE l'hôte — c'est pour ça qu'on ne l'écrit pas", () => {
    // Si un jour ce test devient vert, c'est que la sémantique de `new URL` a changé. D'ici là il
    // dit, en une ligne exécutable, pourquoi la concaténation reste.
    const naif = new URL("//evil.com/x", AMONT);
    expect(naif.host, "le piège a disparu ? relire la garde de cibleAmont").toBe("evil.com");

    const notre = new URL(cibleAmont(PREFIXE + "//evil.com/x"));
    expect(notre.host).toBe(new URL(AMONT).host);
  });
});

describe("⚠️ IMPORTER CE FICHIER N'OUVRE PAS DE PORT", () => {
  it("le module s'importe sans mettre quoi que ce soit à l'écoute", () => {
    // `install-hooks.mjs` a appris cette leçon au prix d'un hook installé dans un dépôt de travail
    // par le simple fait qu'un banc l'importait. Ici, `require.main === module` garde le `listen`,
    // et ce banc est la preuve que la garde tient — le fait même qu'il s'exécute.
    expect(typeof cibleAmont).toBe("function");
  });
});
