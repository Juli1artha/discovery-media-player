// UNE PERMISSION D'ÉCRITURE À LA RACINE EST UN PRIVILÈGE QUI S'ACCORDE PAR OUBLI.
//
// ⚠️ Cinq des huit workflows étaient dans ce cas (relevé du 22/08). Aucun n'était fautif dans son
// intention — chacun avait un job qui avait vraiment besoin du droit. Ce qu'ils laissaient ouvert,
// c'est le job SUIVANT : celui que personne n'a encore écrit hérite du droit sans le demander, et
// son auteur ne le verra pas.
//
// `release.yml` en a déjà fait la démonstration coûteuse : son job qui exécute un tarball
// téléchargé du registre tournait avec de quoi publier sur npm, précisément parce que les droits
// vivaient à la racine.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { ecrituresRacine, ecartsDuFichier, releve } from "../permissions-workflows.mjs";

const AVEC = (bloc) => `name: T\non:\n  push:\n${bloc}jobs:\n  a:\n    runs-on: ubuntu-latest\n    steps:\n      - run: 'true'\n`;

describe("⚠️ CE QUI COMPTE COMME UNE ÉCRITURE", () => {
  it("n'importe quelle portée en write", () => {
    expect(ecrituresRacine({ contents: "read", "security-events": "write" })).toEqual(["security-events"]);
    expect(ecrituresRacine({ contents: "write", issues: "write" })).toEqual(["contents", "issues"]);
  });

  it("⚠️ `write-all`, qui les accorde toutes d'un mot", () => {
    // Il se lit comme une abréviation anodine et vaut plus que tout ce qu'on écrirait à la main.
    expect(ecrituresRacine("write-all")).toEqual(["write-all (toutes les portées)"]);
  });

  it("`read-all`, `{}` et l'absence de bloc ne donnent rien", () => {
    expect(ecrituresRacine("read-all")).toEqual([]);
    expect(ecrituresRacine({})).toEqual([]);
    expect(ecrituresRacine(undefined)).toEqual([]);
    expect(ecrituresRacine(null)).toEqual([]);
  });

  it("`read` explicite non plus", () => {
    expect(ecrituresRacine({ contents: "read", packages: "read" })).toEqual([]);
  });
});

describe("le verdict par fichier", () => {
  it("refuse une écriture racine, en nommant la portée ET la ligne", () => {
    const soucis = ecartsDuFichier(AVEC("permissions:\n  contents: read\n  packages: write\n"), "w.yml");
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toMatch(/w\.yml:\d+ : « packages » en écriture à la RACINE/);
  });

  it("⚠️ ne dit pas seulement CE QUI cloche, mais QUOI FAIRE", () => {
    // Un refus sans geste se contourne en supprimant la garde plutôt qu'en corrigeant le fichier.
    expect(ecartsDuFichier(AVEC("permissions:\n  issues: write\n"), "w.yml")[0])
      .toMatch(/Déplacez-le sur le job qui s'en sert/);
  });

  it("laisse passer une racine en lecture seule, quel que soit ce que font les jobs", () => {
    const txt = `name: T\non:\n  push:\npermissions:\n  contents: read\njobs:\n  a:\n    runs-on: ubuntu-latest\n    permissions:\n      packages: write\n    steps:\n      - run: 'true'\n`;
    expect(ecartsDuFichier(txt, "w.yml")).toEqual([]);
  });

  it("laisse passer un fichier sans bloc permissions", () => {
    expect(ecartsDuFichier(AVEC(""), "w.yml")).toEqual([]);
  });

  it("⚠️ LÈVE sur un document illisible plutôt que de le sauter", () => {
    // Un workflow qu'on n'a pas su lire n'est pas un workflow sans permissions. Sauter en silence
    // est ce qui a coûté trois lecteurs à ce dépôt.
    expect(() => ecartsDuFichier("jobs:\n  a:\n   - x\n  b: [1,\n", "w.yml")).toThrow(/YAML illisible/);
  });
});

describe("⚠️ SUR LES VRAIS WORKFLOWS", () => {
  it("aucun ne porte d'écriture à la racine", () => {
    const { fichiers, soucis } = releve();
    expect(fichiers.length).toBeGreaterThanOrEqual(8);
    expect(soucis).toEqual([]);
  });

  it("⚠️ et les droits n'ont pas DISPARU en chemin — ils sont sur les jobs", () => {
    // La contrepartie qui compte : on pourrait satisfaire la garde en supprimant les permissions
    // au lieu de les déplacer, et casser les workflows sans qu'aucun test ne le dise.
    const attendus = {
      "cla.yml": ["contents: write", "pull-requests: write", "issues: write"],
      "codeql.yml": ["security-events: write"],
      "image.yml": ["packages: write", "attestations: write"],
      "image-reconcile.yml": ["packages: write"],
      "publication.yml": ["issues: write"],
      "release.yml": ["id-token: write", "contents: write"],
    };
    for (const [fichier, droits] of Object.entries(attendus)) {
      const txt = readFileSync(`.github/workflows/${fichier}`, "utf8");
      for (const droit of droits) expect(txt, `${fichier} → ${droit}`).toContain(droit);
    }
  });
});
