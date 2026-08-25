// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE RÉPONSE NE QUITTE CE SERVEUR QUE PAR UNE PORTE, ET LA PORTE POSE LA RÈGLE.
//
// ⚠️ La règle a été posée une fois (scan ZAP baseline, règle 10019, 24/08) et n'a tenu que là où
// elle était écrite. Un mois plus tard, l'audit CODEX 5.6 en trouvait trois autres : le `500` du
// bout de `/doc`, sans aucun type ; le `400` « aucun document demandé », typé mais sans `nosniff` ;
// et les deux réponses de `bin/serve.js`. Une règle réappliquée à la main se réapplique mal.

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { corpsEcrits, estTexteEcrit, entetesDe, manquements, typesReserves, MODULE_DES_PORTES } from "../portes-de-reponse.mjs";
import ts from "typescript";

const lu = (source) => corpsEcrits("t.js", source);
const fn = (corps) => `function f(res) {\n${corps}\n}`;

describe("ce qui est un corps écrit sur place", () => {
  const expr = (code) => ts.createSourceFile("x.js", `x(${code})`, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    .statements[0].expression.arguments[0];

  it("un littéral, un gabarit, et une concaténation qui en contient un", () => {
    expect(estTexteEcrit(expr('"Erreur"'))).toBe(true);
    expect(estTexteEcrit(expr("`Erreur ${x}`"))).toBe(true);
    expect(estTexteEcrit(expr('"a" + b'))).toBe(true);
  });

  it("⚠️ mais PAS un corps calculé — c'est la forme légitime, celle de la porte elle-même", () => {
    expect(estTexteEcrit(expr("message"))).toBe(false);
    expect(estTexteEcrit(expr("JSON.stringify(o)"))).toBe(false);
  });
});

describe("les en-têtes d'une portée, sous les deux écritures du dépôt", () => {
  const poses = (corps) => {
    const arbre = ts.createSourceFile("x.js", fn(corps), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    return entetesDe(arbre.statements[0]);
  };

  it("lit un `setHeader`", () => {
    expect(poses('res.setHeader("Content-Type", "text/plain");').get("content-type")).toBe("text/plain");
  });

  it("⚠️ lit AUSSI l'objet d'un `writeHead` — l'ignorer aurait accusé `bin/serve.js` à tort", () => {
    expect(poses('res.writeHead(404, { "Content-Type": "text/plain" });').get("content-type")).toBe("text/plain");
  });
});

describe("les trois formes qui ont réellement fui", () => {
  it("⚠️ un corps sans AUCUN type — le `500` du bout de `/doc`", () => {
    const [t] = lu(fn('res.statusCode = 500; res.end("Erreur");'));
    expect(t.manque).toBe("aucun Content-Type, ni nosniff");
    expect(manquements([t])[0]).toContain("refuserEnTexte");
  });

  it("⚠️ un `text/plain` sans nosniff — le `400` « aucun document demandé »", () => {
    const [t] = lu(fn('res.setHeader("Content-Type", "text/plain; charset=utf-8"); res.end("rien");'));
    expect(t.manque).toContain("sans nosniff");
  });

  it("⚠️ la même faute écrite en `writeHead` — les deux réponses de `bin/serve.js`", () => {
    expect(lu(fn('res.writeHead(404, { "Content-Type": "text/plain" }); res.end("Not found");'))).toHaveLength(1);
  });
});

describe("ce que la garde NE doit PAS accuser", () => {
  // ⚠️ CE BLOC EST LE PLUS IMPORTANT DU FICHIER. La première version de cette garde relevait tout
  // littéral et a accusé sept `res.end('{"ok":…}')` de `routes-liens.js` — sept corps JSON qui
  // posent leur type, ligne par ligne. Sept faux positifs sur sept trouvailles. Une garde qui
  // accuse du code juste apprend à ses lecteurs que son rouge est du bruit.
  it("⚠️ un corps JSON qui déclare son type : ce n'est pas cette faute-là", () => {
    expect(lu(fn('res.setHeader("Content-Type", "application/json"); res.end(\'{"ok":true}\');'))).toEqual([]);
  });

  it("un texte qui pose type ET nosniff", () => {
    expect(lu(fn('res.setHeader("Content-Type", "text/plain"); res.setHeader("X-Content-Type-Options", "nosniff"); res.end("ok");'))).toEqual([]);
  });

  it("un corps calculé, quel que soit son type", () => {
    expect(lu(fn("res.end(octets);"))).toEqual([]);
  });

  it("⚠️ un « .end » écrit dans un commentaire ou dans une chaîne — on lit un arbre, pas un motif", () => {
    expect(lu(fn('// res.end("Erreur")\nconst s = \'res.end("Erreur")\';\nreturn s;'))).toEqual([]);
  });
});

describe("le second volet : le JSON sort par la porte, ou il ne sort pas", () => {
  // ⚠️ CE VOLET EXISTE PARCE QUE LE PREMIER NE POUVAIT RIEN VOIR ICI. Les treize copies de l'aide
  // JSON faisaient `res.end(JSON.stringify(obj))` — un corps CALCULÉ, que le premier volet ne
  // regarde pas et ne doit pas regarder. Ce qu'elles avaient en commun, c'est de DÉCLARER le type,
  // donc de décider chacune dans son coin ce qui l'accompagne. Aucune des vingt ne posait
  // `nosniff` : ce n'est pas vingt oublis, c'est ce qu'une recette recopiée devient.
  const copie = 'function f(res) {\n  const jp = (s, o) => { res.statusCode = s; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(o)); };\n  return jp(200, {});\n}';

  it("⚠️ une quatorzième copie de l'aide JSON est refusée, et le message dit pourquoi", () => {
    const [souci] = typesReserves("server/routes-neuve.js", copie);
    expect(souci).toContain("application/json");
    expect(souci).toContain("ne s'appliquera qu'ici");
  });

  it("⚠️ mais le module des portes a le droit — c'est LUI la définition", () => {
    expect(typesReserves(MODULE_DES_PORTES, copie)).toEqual([]);
    expect(typesReserves("/ailleurs/" + MODULE_DES_PORTES, copie)).toEqual([]);
  });

  it("un `application/json` qui n'est pas un en-tête de réponse n'est pas visé", () => {
    // Le vrai cas : `routes-agent.js` en passe un à `fetch` et à `storage.put`.
    expect(typesReserves("server/routes-agent.js", 'fetch(u, { headers: { "Content-Type": "application/json" } });')).toEqual([]);
    expect(typesReserves("server/routes-agent.js", 'PLAYER.storage.put("c", "k", b, "application/json");')).toEqual([]);
  });

  it("un autre type déclaré reste permis — il a ses propres envoyeurs, et la garde le dit", () => {
    expect(typesReserves("server/handler.js", 'function f(res) { res.setHeader("Content-Type", "text/javascript; charset=utf-8"); }')).toEqual([]);
  });
});

describe("les fichiers réels du dépôt", () => {
  const fichiers = execFileSync("git", ["ls-files"], { encoding: "utf8" })
    .split("\n")
    .filter((f) => /^(server|bin)\/[^/]*\.(js|cjs|mjs)$/.test(f) && !f.includes("__tests__") && !f.endsWith(".generated.js"));

  it("la sonde lit un périmètre peuplé", () => {
    // Sans ce plancher, un dossier renommé rendrait la garde verte en n'analysant rien.
    expect(fichiers.length).toBeGreaterThan(20);
  });

  it("⚠️ aucun corps en texte ne part sans type ni nosniff", () => {
    const soucis = fichiers.flatMap((f) => manquements(corpsEcrits(f, readFileSync(f, "utf8"))));
    expect(soucis, soucis.join("\n")).toEqual([]);
  });

  it("⚠️ et `application/json` n'est déclaré que dans le module des portes", () => {
    const soucis = fichiers.flatMap((f) => typesReserves(f, readFileSync(f, "utf8")));
    expect(soucis, soucis.join("\n")).toEqual([]);
  });

  it("le module des portes est bien dans le périmètre lu — sinon les deux règles ne visent rien", () => {
    expect(fichiers).toContain(MODULE_DES_PORTES);
  });
});
