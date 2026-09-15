// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE BOUCLE DE RÉESSAI A TROIS SORTIES. Ce banc éprouve la sonde sur les deux formes qui l'ont
// prise en défaut pendant son écriture — la boucle d'UNE SEULE LIGNE, qui est celle de l'incident du
// 14/09, et l'`::error::` qui existe AILLEURS dans le bloc et ne parle pas de l'abandon — puis sur le
// dépôt lui-même, avec un témoin planté qui doit la faire rougir.

import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { RACINE } from "./aide/arbre-outils.mjs";
import { auditer, bouclesDe, testeDe, premiereInstruction } from "../boucles-de-reessai.mjs";

/** Un dépôt jetable portant les workflows donnés. */
function depot(workflows) {
  const d = mkdtempSync(join(tmpdir(), "boucles-"));
  mkdirSync(join(d, ".github", "workflows"), { recursive: true });
  for (const [nom, contenu] of Object.entries(workflows)) writeFileSync(join(d, ".github", "workflows", nom), contenu);
  return d;
}
const flux = (run) => `name: T\non: push\njobs:\n  j:\n    runs-on: ubuntu-latest\n    steps:\n      - name: E\n        run: |\n${run.split("\n").map((l) => `          ${l}`).join("\n")}\n`;

describe("reconnaître une boucle de réessai, et ce qui la suit", () => {
  it("⚠️ une boucle d'UNE SEULE LIGNE est une boucle : c'est la forme de l'incident, et la première sonde ne la voyait pas", () => {
    const b = bouclesDe('for i in $(seq 1 20); do npm view "p@1" version && break || sleep 6; done\nmkdir /tmp/x');
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ ligne: 1, aveu: false, suivante: "mkdir /tmp/x" });
  });
  it("une boucle SANS attente n'est pas un réessai : la sonde ne juge pas les boucles ordinaires", () => {
    expect(bouclesDe("for f in a b c; do echo $f; done\necho fini")).toEqual([]);
    expect(bouclesDe("for route in /a /b; do\n  code=$(curl -s $route)\ndone\necho fini")).toEqual([]);
  });
  it("une boucle imbriquée dans une boucle de réessai n'est pas un second cas", () => {
    const b = bouclesDe("while true; do\n  for x in a b; do echo $x; done\n  sleep 1\ndone\necho '::error::jamais'");
    expect(b).toHaveLength(1);
    expect(b[0].aveu).toBe(true);
  });
  it("le test de la boucle : son programme et sa cible, sur une ligne comme sur plusieurs", () => {
    expect(testeDe('for i in $(seq 1 20); do npm view "discovery-media-player@$V" version >/dev/null && break || sleep 6; done', ""))
      .toEqual({ programme: "npm", cible: "discovery-media-player@$V" });
    expect(testeDe("for i in $(seq 1 30); do", "  curl -fsS localhost:3000/healthz >/dev/null 2>&1 && break; sleep 2\ndone"))
      .toEqual({ programme: "curl", cible: "localhost:3000/healthz" });
  });
  it("la première instruction saute les lignes vides et les commentaires, jamais le code", () => {
    expect(premiereInstruction(["done", "", "# un commentaire", "   ", "vrai-code"], 0)).toBe("vrai-code");
    expect(premiereInstruction(["done"], 0)).toBe("");
  });

  it("⚠️ une instruction CONTINUÉE par `\\` est UNE instruction, pas sa première ligne", () => {
    // La sonde lisait une LIGNE là où le shell lit une INSTRUCTION. `cmd \` puis
    // `|| { echo "::error::…"; exit 1; }` est la forme la plus répandue de ce dépôt — la largeur
    // de ces fichiers l'impose — et la sonde y voyait `cmd \`, sans aveu : elle REFUSAIT une
    // boucle conforme. Un refus faux n'est pas anodin : il pousse à écrire la forme que l'outil
    // accepte plutôt que la forme juste, et à ce régime plus personne ne croit ses refus.
    expect(premiereInstruction(["done", '[ -n "$X" ] \\', '|| { echo "::error::rien"; exit 1; }'], 0))
      .toBe('[ -n "$X" ] || { echo "::error::rien"; exit 1; }');
    // Trois lignes aussi, et la continuation s'arrête à la première ligne qui ne la porte pas.
    expect(premiereInstruction(["done", "a \\", "b \\", "c", "d"], 0)).toBe("a b c");
  });

  it("⚠️ l'aveu porté par la SECONDE ligne d'une instruction continuée compte", () => {
    // Le banc d'à côté vérifie le recollage ; celui-ci vérifie qu'il sert à quelque chose.
    const [b] = bouclesDe(['for i in $(seq 1 3); do curl -sf x && break || sleep 1; done', '[ -n "$X" ] \\', '|| { echo "::error::jamais venu"; exit 1; }'].join("\n"));
    expect(b, "la boucle n'est même pas relevée").toBeTruthy();
    expect(b.aveu, "l'aveu est sur la seconde ligne de l'instruction, et il compte").toBe(true);
  });
});

describe("l'aveu : un `::error::` qui suit, ou le rejeu du test — et rien d'autre", () => {
  const boucle = 'for i in $(seq 1 20); do npm view "p@1" version >/dev/null 2>&1 && break || sleep 6; done';
  it("un `::error::` immédiatement après le `done` suffit", () => {
    expect(bouclesDe(`${boucle}\necho "::error::le registre ne sert pas p@1"; exit 1`)[0].aveu).toBe(true);
  });
  it("le rejeu du test suffit : son échec compte, sous `bash -e` comme derrière un `||`", () => {
    expect(bouclesDe(`${boucle}\nnpm view "p@1" version >/dev/null || exit 1`)[0].aveu).toBe(true);
    expect(bouclesDe(`${boucle}\nnpm view "p@1" version`)[0].aveu).toBe(true);
  });
  it("⚠️ le MÊME PROGRAMME sur une AUTRE cible ne rejoue rien — c'est le défaut exact du 14/09", () => {
    // `npm init` après une attente de `npm view` : même programme, autre chose. La première version
    // de cette sonde acceptait, parce qu'elle cherchait le programme sans la cible.
    expect(bouclesDe(`${boucle}\nmkdir -p /tmp/fume && cd /tmp/fume && npm init -y`)[0].aveu).toBe(false);
  });
  it("⚠️ un `::error::` AILLEURS dans le bloc ne vaut pas aveu : la sonde cherchait la chaîne, pas le sens", () => {
    // Le bloc fautif en portait deux, dans le script Node qu'il lance ensuite, à propos d'autre chose.
    const bloc = `${boucle}\nmkdir -p /tmp/fume\nnode -e 'console.error("::error::la page ne contient aucun script"); process.exit(1)'`;
    expect(bouclesDe(bloc)[0].aveu).toBe(false);
  });
});

describe("la garde sur le dépôt : trois issues", () => {
  it("conforme, en comptant les boucles ET les blocs relus", () => {
    const r = auditer();
    expect(r.code, JSON.stringify(r)).toBe(0);
    expect(r.resume).toMatch(/[1-9]\d* boucle\(s\) de réessai dans \d+ bloc\(s\) « run: » de \d+ workflow\(s\)/);
  });
  it("⚠️ UN TÉMOIN PLANTÉ FAIT ROUGIR — sans quoi le vert ci-dessus ne prouve rien", () => {
    const d = depot({
      "vrai.yml": readFileSync(join(RACINE, ".github/workflows/zap.yml"), "utf8"),
      "temoin.yml": flux('for i in $(seq 1 5); do curl -fsS localhost:1/ >/dev/null && break || sleep 1; done\necho "on continue comme si de rien n\'était"'),
    });
    try {
      const r = auditer(d);
      expect(r.code).toBe(1);
      expect(r.constats).toHaveLength(1);
      expect(r.constats[0]).toMatch(/temoin\.yml › j › E : la boucle de réessai .* sort par épuisement/);
      expect(r.constats[0]).toMatch(/on continue comme si de rien n'était/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it("⚠️ NON CONCLUANT quand la sonde ne voit AUCUNE boucle — zéro n'est pas une conformité", () => {
    const d = depot({ "sans.yml": flux("echo rien\nnpm test") });
    try {
      const r = auditer(d);
      expect(r.code).toBe(2);
      expect(r.raisons.join("\n")).toMatch(/AUCUNE boucle de réessai reconnue/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
  it("NON CONCLUANT sans dossier de workflows : jamais vert sur rien", () => {
    const d = mkdtempSync(join(tmpdir(), "boucles-vide-"));
    try { expect(auditer(d).code).toBe(2); } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
