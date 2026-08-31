// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CHAQUE BLOC `run:` DES WORKFLOWS DOIT ÊTRE DU SHELL VALIDE.
//
// ⚠️ Un bloc `run:` n'est analysé par personne avant de s'exécuter — et pour un workflow de sortie,
// il s'exécute APRÈS la publication npm. C'est ce qui est arrivé à la 0.1.136 : npm publié, image
// publiée, aucune Release, parce qu'une apostrophe fermait une chaîne shell.

import { describe, it, expect } from "vitest";

import { analyserAvecBash, blocsDe, blocsFautifs, sautes, lireDossier, temoinNonVu } from "../shell-des-workflows.mjs";

const wf = (steps, extra = "") => `name: T\non: push\njobs:\n  j:\n${extra}    steps:\n${steps}`;

describe("relever les blocs", () => {
  it("prend les étapes qui portent un « run: », pas les « uses: »", () => {
    const b = blocsDe("t.yml", wf("      - uses: actions/checkout@abc\n      - name: deux\n        run: echo ok\n"));
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ fichier: "t.yml", job: "j", nom: "deux", shell: "bash", run: "echo ok" });
  });

  it("nomme une étape sans nom par son rang — sinon on ne sait pas laquelle", () => {
    expect(blocsDe("t.yml", wf("      - run: echo ok\n"))[0].nom).toBe("étape 1");
  });

  it("hérite du shell déclaré par le job", () => {
    const b = blocsDe("t.yml", wf("      - run: print('x')\n", "    defaults:\n      run:\n        shell: python\n"));
    expect(b[0].shell).toBe("python");
  });
});

describe("le verdict", () => {
  const faux = (script) => (script.includes("PIEGE") ? "syntax error near unexpected token `('" : null);

  it("⚠️ accuse en nommant fichier › job › étape", () => {
    const b = blocsDe("release.yml", wf("      - name: poser le nom\n        run: node -e 'PIEGE'\n"));
    expect(blocsFautifs(b, faux)).toEqual([
      "release.yml › j › poser le nom : syntax error near unexpected token `('",
    ]);
  });

  it("se tait sur un bloc valide", () => {
    expect(blocsFautifs(blocsDe("t.yml", wf("      - run: echo ok\n")), faux)).toEqual([]);
  });

  it("⚠️ SAUTE un shell qui n'est pas bash au lieu de l'accuser à tort", () => {
    const b = blocsDe("t.yml", wf("      - shell: python\n        run: PIEGE\n"));
    expect(blocsFautifs(b, faux)).toEqual([]);
    expect(sautes(b).map((x) => x.shell)).toEqual(["python"]);
  });
});

describe("les workflows réels", () => {
  const blocs = lireDossier();

  it("la sonde en trouve, et beaucoup", () => {
    // Sans ce plancher, un dossier renommé rendrait la garde verte en n'analysant rien.
    expect(blocs.length).toBeGreaterThan(50);
  });

  it("⚠️ aucun bloc n'est refusé par bash", () => {
    const soucis = blocsFautifs(blocs);
    expect(soucis, `bloc(s) invalide(s) :\n${soucis.join("\n")}`).toEqual([]);
  });

  it("⚠️ et le défaut de la 0.1.136 EST attrapé par la règle", () => {
    // L'apostrophe de « d'attestation » ferme la chaîne ; bash lit le JavaScript et bute sur « ( ».
    const fautif = wf("      - name: poser le nom\n        run: |\n          node -e '\n            console.error(\"le fichier d'attestation nest pas un bundle (mediaType: \" + mt + \")\");\n          '\n");
    expect(blocsFautifs(blocsDe("release.yml", fautif))).toHaveLength(1);
  });
});

describe("⚠️ le témoin — INJECTÉ, parce que l'état sain de cette règle est ZÉRO bloc refusé", () => {
  // ⚠️ CE QUI ÉTAIT MESURÉ LE 31/08. En remplaçant l'appel à `execFileSync` par `return null` —
  // un bash qui n'est plus lancé — l'outil imprimait « 112 bloc(s) « run: » ANALYSÉS PAR BASH,
  // aucun refusé » et sortait 0. La phrase était littéralement fausse, et c'est celle que la
  // forge affiche à chaque course verte : une phrase qui AFFIRME un fait mesuré porte l'autorité
  // de la mesure sans en porter la charge, et n'est relue par personne.
  it("⚠️ un analyseur muet est vu, et nommé", () => {
    expect(temoinNonVu(() => null)).toMatch(/n'a pas refusé un script qu'on sait cassé/);
  });

  it("un analyseur qui refuse ce qu'il doit refuser ne dit rien", () => {
    expect(temoinNonVu(() => "syntax error")).toBe(null);
  });

  // ⚠️ ET IL ÉPROUVE LE VRAI BASH, PAS UN DOUBLE. Le témoin par défaut passe par l'analyseur que
  // le juge appelle ; une doublure ici prouverait que la doublure marche.
  it("⚠️ sur le bash de cette machine, sans doublure", () => {
    expect(temoinNonVu()).toBe(null);
    expect(analyserAvecBash("if [ -z ]; then\n", "bash"), "bash doit refuser un « then » sans « fi »").toBeTruthy();
    expect(analyserAvecBash("echo ok\n", "bash"), "et accepter un script valide").toBe(null);
  });

  // ⚠️ UN TÉMOIN DÉRIVÉ ÉTAIT IMPOSSIBLE ICI, ET C'EST LA RAISON DE L'INJECTION. Il aurait compté
  // « au moins un bloc que bash refuse », c'est-à-dire exigé du dépôt la chose même que la règle
  // interdit : il refuserait un dépôt sain. La forme correcte n'est pas quelque chose que ce
  // dépôt doit CONTENIR, donc il faut la fabriquer.
  it("⚠️ le dépôt réel ne contient AUCUN bloc refusé — d'où l'injection", () => {
    expect(blocsFautifs(lireDossier())).toEqual([]);
  });
});
