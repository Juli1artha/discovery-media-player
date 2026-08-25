// CE QUI A CHANGÉ ENTRE DEUX PAQUETS, PAR ZONE.
//
// ⚠️ Le fait qui décide d'une montée — « rien de ce que l'hôte exécute n'a changé » — était calculé
// à la main par l'hôte, deux fois. Ce banc éprouve la règle, puis l'applique aux DEUX ARCHIVES
// PUBLIÉES de la 0.1.134 et de la 0.1.135, dont l'écart est connu indépendamment.

import { describe, it, expect } from "vitest";

import { ZONES, zoneDe, ecarts, rapport, versionPrecedente } from "../zones-du-tarball.mjs";

const inv = (o) => o;

describe("ranger un chemin", () => {
  it("chaque zone porte un nom et ce qu'elle veut dire", () => {
    for (const z of ZONES) {
      expect(z.nom, JSON.stringify(z)).toMatch(/^[a-z]+$/);
      expect(z.quoi.length, z.nom).toBeGreaterThan(10);
    }
  });

  it("⚠️ un .md sous docs/ est un document, PAS du code — l'ordre des zones compte", () => {
    expect(zoneDe("docs/HOST-CONTRACT.md")).toBe("documents");
    expect(zoneDe("server/handler.js")).toBe("server");
    expect(zoneDe("package.json")).toBe("manifest");
    expect(zoneDe("LICENSE-MIT")).toBe("documents");
  });

  it("rend null pour ce qu'aucune zone ne réclame", () => {
    expect(zoneDe("charge/scenario.js")).toBeNull();
  });
});

describe("les écarts", () => {
  it("sépare ajouté, retiré et modifié", () => {
    const { parZone } = ecarts(
      inv({ "server/a.js": "1", "server/b.js": "1", "README.md": "1" }),
      inv({ "server/a.js": "2", "server/c.js": "1", "README.md": "1" }),
    );
    expect(parZone.get("server")).toEqual({ ajoutes: ["server/c.js"], retires: ["server/b.js"], modifies: ["server/a.js"] });
    expect(parZone.get("documents")).toEqual({ ajoutes: [], retires: [], modifies: [] });
  });

  it("⚠️ NOMME ce qu'aucune zone ne réclame au lieu de l'avaler", () => {
    const { horsZone } = ecarts(inv({ "charge/x.js": "1" }), inv({ "charge/x.js": "2" }));
    expect(horsZone).toEqual(["charge/x.js"]);
  });

  it("un fichier identique des deux côtés n'apparaît nulle part", () => {
    const { parZone } = ecarts(inv({ "server/a.js": "1" }), inv({ "server/a.js": "1" }));
    expect(parZone.get("server")).toEqual({ ajoutes: [], retires: [], modifies: [] });
  });
});

describe("le rapport", () => {
  it("⚠️ imprime les zones ET leurs comptes — jamais un booléen « docs seulement »", () => {
    const md = rapport("0.1.1", "0.1.2", inv({ "README.md": "1" }), inv({ "README.md": "2" }));
    for (const z of ZONES) expect(md).toContain(`\`${z.nom}\``);
    expect(md).not.toMatch(/docs only|documents seulement/i);
  });

  it("dit explicitement quand rien ne diffère, au lieu de rendre une table muette", () => {
    expect(rapport("a", "b", inv({ "server/a.js": "1" }), inv({ "server/a.js": "1" })))
      .toContain("No file differs");
  });

  it("⚠️ avertit que la table est plus étroite que le paquet s'il reste des chemins non rangés", () => {
    const md = rapport("a", "b", inv({ "charge/x.js": "1" }), inv({ "charge/x.js": "2" }));
    expect(md).toContain("no declared zone");
    expect(md).toContain("charge/x.js");
  });

  it("est en anglais — il part dans les notes d'une Release", () => {
    const md = rapport("a", "b", inv({ "README.md": "1" }), inv({ "README.md": "2" }));
    expect(md).toMatch(/What changed in the package/);
    for (const z of ZONES) expect(md).not.toMatch(new RegExp(`\\| ${z.nom} \\| [^|]*[éèêàç]`));
  });
});

describe("les deux archives réellement publiées", () => {
  // Écart connu indépendamment : une entrée retirée (docs/README.md), trois fichiers modifiés
  // (README.md, docs/HOST-CONTRACT.md, package.json), et RIEN sous server/ ni context/.
  const avant = { "docs/README.md": "a", "README.md": "a", "docs/HOST-CONTRACT.md": "a", "package.json": "a", "server/handler.js": "a", "context/storage.js": "a" };
  const apres = { "README.md": "b", "docs/HOST-CONTRACT.md": "b", "package.json": "b", "server/handler.js": "a", "context/storage.js": "a" };

  it("0.1.134 → 0.1.135 : rien sous server/ ni context/", () => {
    const { parZone } = ecarts(avant, apres);
    for (const zone of ["server", "context"]) {
      const e = parZone.get(zone);
      expect([...e.ajoutes, ...e.retires, ...e.modifies], zone).toEqual([]);
    }
  });

  it("⚠️ et le banc rougirait si un fichier d'exécution avait bougé", () => {
    const { parZone } = ecarts(avant, { ...apres, "server/handler.js": "b" });
    expect(parZone.get("server").modifies).toEqual(["server/handler.js"]);
  });
});

describe("la version précédente", () => {
  it("⚠️ trie sur les NOMBRES — un tri lexical mettrait 0.1.9 après 0.1.10", () => {
    expect(versionPrecedente(["0.1.9", "0.1.10", "0.1.11"], "0.1.11")).toBe("0.1.10");
    expect(["0.1.9", "0.1.10"].sort().at(-1)).toBe("0.1.9"); // la faute qu'on évite
  });

  it("ignore les préversions — personne n'avait installé ça", () => {
    expect(versionPrecedente(["0.1.4", "0.1.5-rc.1"], "0.1.6")).toBe("0.1.4");
  });

  it("ignore ce qui vient après, et la version elle-même", () => {
    expect(versionPrecedente(["0.1.4", "0.1.5", "0.1.6", "0.2.0"], "0.1.5")).toBe("0.1.4");
  });

  it("rend null quand il n'y a pas de précédente — on ne compare pas contre rien", () => {
    expect(versionPrecedente(["0.1.5"], "0.1.5")).toBeNull();
    expect(versionPrecedente([], "0.1.5")).toBeNull();
  });

  it("passe un cas majeur", () => {
    expect(versionPrecedente(["0.9.9", "1.0.0", "1.0.1"], "1.0.1")).toBe("1.0.0");
  });
});
