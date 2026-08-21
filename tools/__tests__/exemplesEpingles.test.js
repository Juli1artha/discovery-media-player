// CE QUE LES EXEMPLES ONT LE DROIT D'ÉPINGLER — LES CINQ ÉTATS DE LA VIE DU DÉPÔT.
//
// ⚠️ L'ancienne règle (« la version de main OU la dernière publiée ») était ROUGE dans l'état
// NORMAL du dépôt : dès la sortie faite, les deux valent la même chose, et des exemples restés une
// version en arrière ne sont plus ni l'une ni l'autre. Rouge sur main, sur chaque PR ouverte, sur
// les suivantes. Ça a coûté #273 (21/08), morte vide parce que #276 portait le même correctif de
// trois lignes, découvert de son côté dans la même heure.
//
// Le commentaire de ci.yml affirmait pourtant que « leur retard d'une version est la propriété
// recherchée ». Le texte et le contrôle se contredisaient, et c'est le contrôle qui gagne.

import { describe, it, expect } from "vitest";
import { comparerVersions, acceptables, ecartsExemples, versionsPubliees, exemplesDuDepot } from "../exemples-epingles.mjs";

const trois = (v) => [
  { fichier: "examples/demo/package.json", version: v },
  { fichier: "examples/express/package.json", version: v },
  { fichier: "examples/vercel/package.json", version: v },
];
const PUBLIEES = ["0.1.122", "0.1.123", "0.1.124", "0.1.125", "0.1.126"];

describe("comparer des versions", () => {
  it("⚠️ 0.1.9 est AVANT 0.1.10 — le tri lexical dirait le contraire", () => {
    expect(comparerVersions("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(["0.1.10", "0.1.9"].sort(comparerVersions)).toEqual(["0.1.9", "0.1.10"]);
  });

  it("ordonne les majeures et mineures", () => {
    expect(comparerVersions("1.0.0", "0.9.9")).toBeGreaterThan(0);
    expect(comparerVersions("0.2.0", "0.1.99")).toBeGreaterThan(0);
    expect(comparerVersions("0.1.126", "0.1.126")).toBe(0);
  });
});

describe("les deux dernières publiées, et rien d'autre", () => {
  it("les prend dans le registre, pas dans le dépôt", () => {
    expect(acceptables("0.1.127", PUBLIEES)).toEqual(["0.1.126", "0.1.125"]);
  });

  it("ne se fie pas à l'ordre du registre", () => {
    expect(acceptables("x", ["0.1.126", "0.1.122", "0.1.125"])).toEqual(["0.1.126", "0.1.125"]);
  });

  it("survit à un registre qui n'a qu'une version", () => {
    expect(acceptables("0.1.1", ["0.1.1"])).toEqual(["0.1.1"]);
  });
});

describe("LES CINQ ÉTATS DE LA VIE DU DÉPÔT", () => {
  it("1. PR de sortie, exemples laissés à la publiée → vert", () => {
    // main dit 0.1.127, npm sert 0.1.126, les exemples sont restés à 0.1.126.
    expect(ecartsExemples("0.1.127", PUBLIEES, trois("0.1.126"))).toEqual([]);
  });

  it("2. PR de sortie, exemples montés à la version pas encore servie → ROUGE (le piège de #269)", () => {
    const soucis = ecartsExemples("0.1.127", PUBLIEES, trois("0.1.127"));
    expect(soucis).toHaveLength(3);
    expect(soucis[0]).toMatch(/n'est pas encore SERVIE.*démo installe depuis npm/);
  });

  it("3. état stable après publication → vert", () => {
    expect(ecartsExemples("0.1.126", PUBLIEES, trois("0.1.126"))).toEqual([]);
  });

  it("⭐ 4. APRÈS PUBLICATION, EXEMPLES ENCORE UNE VERSION EN ARRIÈRE → vert", () => {
    // ⚠️ LE CAS QUI A COÛTÉ #273. C'est l'état normal du dépôt entre une sortie et le geste humain
    // qui monte les exemples — et l'ancienne règle le rendait rouge. Une alerte qui se déclenche
    // quand tout va bien apprend à passer outre.
    expect(ecartsExemples("0.1.126", PUBLIEES, trois("0.1.125"))).toEqual([]);
  });

  it("5. exemple oublié loin derrière → ROUGE", () => {
    // Le défaut d'origine : la démo épinglait 0.1.20 et les autres 0.1.7, cent onze versions en
    // arrière. Deux versions de retard suffisent à rougir — la protection est intacte.
    const soucis = ecartsExemples("0.1.126", PUBLIEES, trois("0.1.124"));
    expect(soucis).toHaveLength(3);
    expect(soucis[0]).toMatch(/Un copieur recevrait un player périmé/);
  });
});

describe("les messages", () => {
  it("nomment celui qui diverge, pas « un exemple »", () => {
    const melange = trois("0.1.126");
    melange[1] = { fichier: "examples/express/package.json", version: "0.1.7" };
    const soucis = ecartsExemples("0.1.126", PUBLIEES, melange);
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain("examples/express/package.json");
  });

  it("disent les deux versions permises", () => {
    expect(ecartsExemples("0.1.126", PUBLIEES, trois("0.1.7"))[0])
      .toMatch(/dernière publiée \(0\.1\.126\).*celle d'avant \(0\.1\.125\)/);
  });

  it("distinguent « trop neuve » de « périmée » — ce ne sont pas les mêmes gestes", () => {
    expect(ecartsExemples("x", PUBLIEES, trois("0.1.200"))[0]).toMatch(/pas encore SERVIE/);
    expect(ecartsExemples("x", PUBLIEES, trois("0.1.7"))[0]).toMatch(/périmé/);
  });

  it("refuse une plage par construction — elle n'est jamais une version publiée", () => {
    expect(ecartsExemples("0.1.126", PUBLIEES, trois("^0.1.0"))).toHaveLength(3);
    expect(ecartsExemples("0.1.126", PUBLIEES, trois("~0.1.126"))).toHaveLength(3);
  });
});

describe("⚠️ registre injoignable : on RESSERRE, on n'élargit pas", () => {
  // Ne pas savoir ne doit jamais autoriser davantage. C'est la règle des gardes muettes appliquée
  // à une absence de réponse plutôt qu'à un contrôle sauté.
  it("n'autorise plus que la version de main", () => {
    expect(ecartsExemples("0.1.126", null, trois("0.1.126"))).toEqual([]);
    expect(ecartsExemples("0.1.126", null, trois("0.1.125"))).toHaveLength(3);
  });

  it("le dit dans le message plutôt que de laisser croire à un oubli", () => {
    expect(ecartsExemples("0.1.126", [], trois("0.1.125"))[0]).toMatch(/registre est injoignable/);
  });

  it("rend null quand npm ne répond pas, sans lever", () => {
    expect(versionsPubliees(() => { throw new Error("réseau"); })).toBeNull();
    expect(versionsPubliees(() => "pas du json")).toBeNull();
  });

  it("accepte la réponse d'un paquet à version unique, que npm rend en scalaire", () => {
    expect(versionsPubliees(() => '"0.1.1"')).toEqual(["0.1.1"]);
  });
});

describe("le dépôt réel", () => {
  it("a bien trois exemples, et ils épinglent une version exacte", () => {
    const exemples = exemplesDuDepot();
    expect(exemples.length).toBeGreaterThanOrEqual(3);
    for (const e of exemples) expect(e.version, e.fichier).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("⚠️ ils passent la règle contre les versions réellement publiées ce jour-là", () => {
    expect(ecartsExemples("0.1.126", PUBLIEES, exemplesDuDepot())).toEqual([]);
  });
});
