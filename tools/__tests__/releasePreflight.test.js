// LE PRÉFLIGHT DE PUBLICATION, ÉPROUVÉ SUR LES SORTIES QUI ONT MAL TOURNÉ.
//
// Chaque comparaison ci-dessous porte le nom d'un incident réel :
//   0.1.15  — publiée sans son correctif (commit après fusion) ;
//   0.1.25  — publiée cassée ;
//   0.1.35  — jamais publiée : tag oublié, CI verte, CHANGELOG affirmatif ;
//   0.1.68  — publiée pendant que sa CI était rouge ;
//   0.1.121 — taguée sur un commit dont le paquet déclarait encore la version précédente.
//
// ⚠️ Ce banc n'exerce que les fonctions PURES. Le relevé git/réseau n'est pas simulé : un double
// de `git` prouverait surtout que le double est d'accord avec lui-même. Ce qui compte ici, ce sont
// les règles de décision — et elles se lisent sans dépôt.

import { describe, it, expect } from "vitest";
import { ecartVersionChangelog, ecartNotes, ecartsExemples, ecartTagExistant, rapport } from "../release-preflight.mjs";

const CHL = `## [0.1.9] — 2026-01-09

### Fixed
- Une correction décrite assez longuement pour valoir des notes de version.

## [0.1.8] — 2026-01-08

### Added
- Autre chose, également décrite.
`;

describe("la version du paquet et celle du journal — l'incident 0.1.121", () => {
  it("accepte quand les deux disent la même chose", () => {
    expect(ecartVersionChangelog("0.1.9", CHL)).toBeNull();
  });

  it("refuse un paquet en avance sur son journal", () => {
    expect(ecartVersionChangelog("0.1.10", CHL)).toMatch(/déclare 0\.1\.10.*plus récente.*0\.1\.9/);
  });

  it("refuse un paquet en retard — le cas exact du tag posé trop tôt", () => {
    expect(ecartVersionChangelog("0.1.8", CHL)).toMatch(/déclare 0\.1\.8/);
  });

  it("refuse un journal sans aucune section", () => {
    expect(ecartVersionChangelog("0.1.9", "# Changelog\n")).toMatch(/aucune section/);
  });
});

describe("les notes de version — sans elles, une sortie s'annonce sans se décrire", () => {
  it("acceptent une section fournie", () => {
    expect(ecartNotes("0.1.9", CHL)).toBeNull();
  });

  it("refusent une version absente du journal", () => {
    expect(ecartNotes("0.1.99", CHL)).toMatch(/pas de section.*pas de notes, pas de sortie/);
  });

  it("refusent une section quasi vide", () => {
    expect(ecartNotes("0.1.9", "## [0.1.9] — 2026-01-09\n\n### Fixed\n- rien\n")).toMatch(/quasi vide/);
  });
});

describe("les exemples — ce que les gens recopient", () => {
  const trois = (v) => [
    { fichier: "examples/demo/package.json", version: v },
    { fichier: "examples/express/package.json", version: v },
    { fichier: "examples/vercel/package.json", version: v },
  ];

  it("acceptent quand ils épinglent la version publiée", () => {
    expect(ecartsExemples("0.1.9", trois("0.1.9"))).toEqual([]);
  });

  it("refusent une version exacte mais ancienne — pas seulement une plage", () => {
    const soucis = ecartsExemples("0.1.9", trois("0.1.7"));
    expect(soucis).toHaveLength(3);
    expect(soucis[0]).toMatch(/épingle 0\.1\.7, on publie 0\.1\.9/);
  });

  it("nomment celui qui diverge, pas « un exemple »", () => {
    const melange = [...trois("0.1.9")];
    melange[1] = { fichier: "examples/express/package.json", version: "0.1.2" };
    expect(ecartsExemples("0.1.9", melange)).toEqual([expect.stringContaining("examples/express/package.json")]);
  });
});

describe("le tag — une sortie ne se rejoue pas en la retaguant", () => {
  it("accepte un tag libre", () => {
    expect(ecartTagExistant("v0.1.9", ["v0.1.7", "v0.1.8"])).toBeNull();
  });

  it("refuse un tag déjà posé", () => {
    expect(ecartTagExistant("v0.1.8", ["v0.1.7", "v0.1.8"])).toMatch(/existe déjà/);
  });
});

describe("le rapport — un « non vérifié » ne se confond jamais avec un vert", () => {
  const rendre = (controles) => rapport({ version: "0.1.9", tag: "v0.1.9", controles });

  it("autorise, et donne la commande, quand tout est constaté", () => {
    const { texte, echecs } = rendre([{ nom: "un", etat: "OK", message: "bon" }]);
    expect(echecs).toBe(0);
    expect(texte).toContain("git tag -a v0.1.9");
  });

  it("refuse dès un seul échec, et ne propose aucune commande", () => {
    const { texte, echecs } = rendre([{ nom: "un", etat: "OK", message: "bon" }, { nom: "deux", etat: "ECHEC", message: "cassé" }]);
    expect(echecs).toBe(1);
    expect(texte).toContain("REFUSÉ");
    expect(texte).not.toContain("git tag -a");
  });

  it("⚠️ ne dit PAS « publiable » quand un contrôle n'a pas pu être fait", () => {
    // La règle des gardes muettes (0.1.35), appliquée au préflight lui-même : un contrôle sauté
    // qui ressemble à un contrôle réussi est exactement ce qui laisse partir une sortie cassée.
    const { texte, echecs } = rendre([
      { nom: "un", etat: "OK", message: "bon" },
      { nom: "CI", etat: "NON VÉRIFIÉ", message: "gh absent", commande: "gh run list" },
    ]);
    expect(echecs).toBe(0);
    expect(texte).not.toContain("git tag -a");
    expect(texte).toMatch(/n'ont PAS été vérifiés/);
    expect(texte).toContain("gh run list");
  });
});
