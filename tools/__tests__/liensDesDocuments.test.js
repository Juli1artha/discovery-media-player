// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES LIENS DES DOCUMENTS PUBLIÉS, ÉPROUVÉS SUR LA RÈGLE PUIS SUR LE PAQUET RÉEL.
//
// ⚠️ Neuf des douze liens relatifs du README menaient dans le vide une fois le paquet installé —
// et c'était précisément le lecteur hors ligne au nom duquel on argumentait ailleurs.

import { describe, it, expect } from "vitest";

import { liensRelatifs, cibleResolue, liensMorts, liensLus, temoinsDeForme, PLANCHER_LIENS } from "../liens-des-documents.mjs";
import { fichiersDuTarball } from "../inventaire-tarball.mjs";

describe("relever les liens", () => {
  it("ignore l'externe, l'ancre et le courriel — ils ne se résolvent pas dans le paquet", () => {
    const vus = liensRelatifs("[a](https://x.test) [b](#ancre) [c](mailto:x@y.test) [d](docs/A.md)");
    expect(vus.map((l) => l.cible)).toEqual(["docs/A.md"]);
  });

  it("⚠️ NEUTRALISE les blocs de code sans les supprimer — sinon la ligne annoncée est fausse", () => {
    const texte = ["intro", "```", "[faux](piege.md)", "```", "", "[vrai](cible.md)"].join("\n");
    const vus = liensRelatifs(texte);
    expect(vus.map((l) => l.cible)).toEqual(["cible.md"]);
    expect(vus[0].ligne).toBe(6);
  });

  it("porte la ligne, pas seulement le fichier", () => {
    expect(liensRelatifs("a\nb\n[x](y.md)")[0].ligne).toBe(3);
  });

  it("résout depuis le document qui porte le lien", () => {
    expect(cibleResolue("docs/HOST-CONTRACT.md", "API.md")).toBe("docs/API.md");
    expect(cibleResolue("docs/HOST-CONTRACT.md", "../src/bridge.ts")).toBe("src/bridge.ts");
    expect(cibleResolue("README.md", "examples/")).toBe("examples");
    expect(cibleResolue("README.md", "docs/A.md#section")).toBe("docs/A.md");
  });
});

describe("le verdict", () => {
  const lire = (f) => ({
    "README.md": "[absent](docs/API.md)\n[présent](LICENSE)\n[externe](https://x.test/a.md)",
    "LICENSE": "",
  })[f];

  it("⚠️ accuse le lien mort en donnant fichier:ligne", () => {
    const soucis = liensMorts(["README.md", "LICENSE"], lire);
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toMatch(/^README\.md:1 —/);
    expect(soucis[0]).toContain("docs/API.md");
  });

  it("⚠️ NE REFUSE PAS un lien relatif dont la cible voyage — c'est le bon outil", () => {
    expect(liensMorts(["README.md", "LICENSE"], lire).join("")).not.toContain("LICENSE");
  });

  it("ne lit que les Markdown — un « .js » n'est pas un document", () => {
    expect(liensMorts(["server/x.js"], () => { throw new Error("ne devrait pas être lu"); })).toEqual([]);
  });
});

describe("le paquet réel", () => {
  it("aucun lien relatif ne mène hors du paquet", () => {
    const soucis = liensMorts(fichiersDuTarball());
    expect(soucis, `lien(s) mort(s) :\n${soucis.join("\n")}`).toEqual([]);
  });
});

describe("⚠️ le témoin de la forme — « rien trouvé » n'est pas « rien regardé »", () => {
  // ⚠️ CE QUI ÉTAIT MESURÉ LE 31/08. En vidant la boucle de `matchAll` — une expression qui ne
  // reconnaît plus la forme `[texte](cible)` — l'outil imprimait « 3 document(s) publié(s), aucun
  // lien relatif ne mène hors du paquet » et sortait 0. Il affirmait une propriété de liens qu'il
  // n'avait pas lus. Le plancher comptait les DOCUMENTS PUBLIÉS, pas la FORME RECONNUE.
  it("⚠️ une sonde aveugle ne compte rien, et le témoin le voit", () => {
    expect(temoinsDeForme(["README.md"], () => "de la prose sans le moindre lien")).toBe(0);
  });

  // ⚠️ LE TÉMOIN PASSE PAR LA TRAVERSÉE DU JUGE. `liensLus` est nommée une fois et sert aux deux :
  // un témoin qui referait le parcours resterait vert sur sa copie pendant que l'original dérive.
  it("⚠️ juge et témoin lisent la même traversée", () => {
    const inventaire = ["README.md", "LICENSE"];
    const lire = () => "voir [la licence](LICENSE) et [le vide](ailleurs.md)\n";
    expect([...liensLus(inventaire, lire)].map((l) => l.cible)).toEqual(["LICENSE", "ailleurs.md"]);
    expect(temoinsDeForme(inventaire, lire)).toBe(2);
    expect(liensMorts(inventaire, lire)).toHaveLength(1);
  });

  // Un lien absolu n'est pas un sujet de cette règle : ni le juge ni le témoin ne doivent le voir.
  it("les liens absolus ne gonflent pas le témoin", () => {
    expect(temoinsDeForme(["a.md"], () => "[site](https://exemple.test/x)\n")).toBe(0);
  });
});

// ⚠️ LA POPULATION DU PAQUET RÉEL, ET LE PLANCHER EST À UN POUR UNE RAISON MESURÉE : il n'y a que
// DEUX liens relatifs dans les trois documents publiés, tous deux du README vers ses licences.
// Un plancher plus haut serait collé au relevé du jour sur une population de deux.
describe("⚠️ sur le paquet réel, la sonde reconnaît encore des liens", () => {
  it(`au moins ${PLANCHER_LIENS} lien relatif dans les documents publiés`, () => {
    const vus = temoinsDeForme(fichiersDuTarball());
    expect(vus, "2 le 31/08 (README → LICENSE, README → LICENSE-MIT)").toBeGreaterThanOrEqual(PLANCHER_LIENS);
  });
});
