// « AUCUNE FAILLE » ET « JE N'AI PAS PU VOIR » NE SONT PAS LE MÊME RÉSULTAT.
//
// ⚠️ L'ÉTAPE REMPLACÉE LISAIT LE CODE DE SORTIE DE `npm audit`, qui vaut non-zéro pour deux
// raisons sans rapport : des failles trouvées, ou un registre injoignable. Le second cas rougissait
// en accusant la branche d'une « faille connue » qui n'existait pas — alors que le commentaire
// juste au-dessus promettait de distinguer les deux. Ce banc éprouve la distinction sur les DEUX
// sorties réelles de npm, relevées le 24/08.

import { describe, it, expect } from "vitest";
import { comptesDe, ecartsProduction, ecartsDeveloppement } from "../failles-connues.mjs";

const aucune = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 };
const releve = (v) => JSON.stringify({ auditReportVersion: 2, metadata: { vulnerabilities: { ...aucune, ...v, total: Object.values({ ...aucune, ...v }).reduce((a, b) => a + b, 0) } } });

// La sortie EXACTE de `npm audit --json --registry=http://127.0.0.1:9`, relevée le 24/08.
const REGISTRE_MUET = JSON.stringify({
  message: "request to http://127.0.0.1:9/-/npm/v1/security/audits/quick failed, reason: connect ECONNREFUSED 127.0.0.1:9",
  error: { summary: "", detail: "" },
});

describe("⚠️ CE QUI DISTINGUE « VU » DE « PAS PU VOIR »", () => {
  it("un relevé présent est lu", () => {
    expect(comptesDe(releve({ moderate: 2 }), "PRODUCTION")).toMatchObject({ moderate: 2 });
  });

  it("⚠️ un registre injoignable LÈVE, et ne rend surtout pas zéro faille", () => {
    // Le cœur du correctif. Rendre `{ total: 0 }` ici serait pire que l'ancien faux rouge : la
    // garde annoncerait « aucune faille » là où elle n'a rien regardé.
    expect(() => comptesDe(REGISTRE_MUET, "PRODUCTION")).toThrow(/aucun relevé.*ECONNREFUSED/s);
  });

  it("une sortie qui n'est pas du JSON lève aussi", () => {
    expect(() => comptesDe("npm ERR! code E401\n", "DÉVELOPPEMENT")).toThrow(/n'a pas rendu du JSON/);
  });

  it("⚠️ et le refus nomme l'arbre concerné", () => {
    // Sans le nom, le lecteur ne sait pas lequel des deux appels a échoué.
    expect(() => comptesDe(REGISTRE_MUET, "DÉVELOPPEMENT")).toThrow(/arbre de DÉVELOPPEMENT/);
  });
});

describe("les deux seuils, et leurs raisons", () => {
  it("production : aucune, quelle que soit la gravité", () => {
    expect(ecartsProduction(comptesDe(releve({}), "P"))).toEqual([]);
    expect(ecartsProduction(comptesDe(releve({ low: 1 }), "P"))[0]).toMatch(/seuil « aucune »/);
    expect(ecartsProduction(comptesDe(releve({ info: 1 }), "P"))).toHaveLength(1);
  });

  it("⚠️ développement : haute ou critique seulement", () => {
    // La contrepartie qui compte : une modérée dans un plugin de test ne doit PAS bloquer, sinon
    // on apprend à contourner la CI — et une CI qu'on contourne ne garde plus rien.
    expect(ecartsDeveloppement(comptesDe(releve({ moderate: 9, low: 3 }), "D"))).toEqual([]);
    expect(ecartsDeveloppement(comptesDe(releve({ high: 1 }), "D"))[0]).toMatch(/seuil « high »/);
    expect(ecartsDeveloppement(comptesDe(releve({ critical: 1 }), "D"))).toHaveLength(1);
  });

  it("le constat dit le DÉTAIL, pas seulement un total", () => {
    // Un total seul oblige à relancer la commande à la main pour savoir quoi corriger.
    expect(ecartsProduction(comptesDe(releve({ high: 1, low: 2 }), "P"))[0]).toMatch(/1 high, 2 low/);
  });
});
