// L'OUTIL QUI DÉRIVE LA SURFACE BASE — ÉPROUVÉ, PARCE QU'IL REMPLACE UNE PROSE QUI AVAIT DÉRIVÉ.
//
// ⚠️ UNE GARDE QU'ON N'A PAS VUE REFUSER NE GARDE RIEN, et celle-ci remplace trois chiffres écrits à
// la main dont chacun s'était éloigné du code sans que personne ne s'en aperçoive. Elle doit donc
// refuser sur des cas fabriqués, dans CHACUNE des formes qu'elle prétend attraper.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceUtile, mesurer, compterIn, annonces, ecarts, fichiersServeur } from "../surface-base.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const f = (nom, texte) => ({ nom, texte });

describe("ce qui est un appel, et ce qui n'en est pas", () => {
  // ⚠️ LE DÉFAUT EXACT DE LA GARDE REMPLACÉE : elle comptait cette ligne-là comme un site d'appel.
  it("une mention en COMMENTAIRE n'est pas un site d'appel", () => {
    const m = mesurer([f("a.js", '// on écrit par PLAYER.db.request, donc…\nPLAYER.db.request("t?select=*");')]);
    expect(m.appels, "un commentaire qui cite l'appel n'appelle rien").toBe(1);
    expect(m.tables).toEqual(["t"]);
  });

  it("un bloc /* */ et une ligne d'étoile non plus", () => {
    expect(sourceUtile(" * PLAYER.db.request(\"x\")").trim()).toBe("");
  });

  it("compte les fichiers qui portent au moins un appel, pas tous les fichiers", () => {
    const m = mesurer([f("a.js", 'PLAYER.db.request("t1?x")'), f("b.js", "const x = 1;")]);
    expect(m.fichiers).toBe(1);
  });
});

describe("les tables, y compris celles qu'un helper reçoit en argument", () => {
  it("prend la table au début du chemin, et ignore les RPC", () => {
    const m = mesurer([f("a.js", 'PLAYER.db.request("doc_presentations?slug=eq.x");\nPLAYER.db.request("rpc/une_fonction", {});')]);
    expect(m.tables).toEqual(["doc_presentations"]);
  });

  // ⚠️ SANS CETTE MOITIÉ, LA PURGE SORTAIT DU COMPTE : retention.js ne nomme jamais ses tables dans
  // un chemin, il les passe en premier argument. C'est ainsi que `player_rate_limits` manquait.
  it("attrape la table passée en premier argument d'un helper de purge", () => {
    const m = mesurer([f("r.js", 'await purgerParLots("player_rate_limits", `expires_at=lt.${x}`, "key", o);')]);
    expect(m.tables).toEqual(["player_rate_limits"]);
  });

  it("ne compte pas deux fois la même table", () => {
    const m = mesurer([f("a.js", 'PLAYER.db.request("t?a");\nPLAYER.db.request("t?b");')]);
    expect(m.tables).toEqual(["t"]);
  });
});

describe("ce qu'elle ne peut PAS résoudre, elle le compte et le dit", () => {
  it("un chemin construit à l'exécution est signalé, jamais deviné", () => {
    const m = mesurer([f("a.js", "PLAYER.db.request(`${table}?select=*`);")]);
    expect(m.tables, "on n'invente pas un nom qu'on ne lit pas").toEqual([]);
    expect(m.dynamiques).toHaveLength(1);
  });

  it("un premier argument qui est une variable aussi", () => {
    const m = mesurer([f("a.js", "PLAYER.db.request(condition, { method: \"PATCH\" });")]);
    expect(m.dynamiques).toHaveLength(1);
  });
});

describe("les « in.(…) » se comptent dans le code, pas dans les explications", () => {
  it("une explication de `in.(…)` en commentaire ne compte pas", () => {
    expect(compterIn([f("a.js", "// un filtre in.( est portable\nconst u = `t?id=in.(${ids})`;")])).toBe(1);
  });
});

describe("l'écart avec ce que le document annonce", () => {
  const dit = (md) => annonces(md);
  const TABLE = [
    "| Call sites | **65**, in **7** files |",
    "| Tables | **10**, plus **6** call sites that build their path at run time |",
    "| `in.(…)` | **3** — translates to … |",
  ].join("\n");

  it("lit les cinq chiffres là où le lecteur les lit", () => {
    expect(dit(TABLE)).toEqual({ appels: 65, fichiers: 7, tables: 10, dynamiques: 6, in: 3 });
  });

  it("aucun écart quand tout concorde", () => {
    expect(ecarts({ appels: 65, fichiers: 7, tables: new Array(10), dynamiques: new Array(6), in: 3 }, dit(TABLE))).toEqual([]);
  });

  it("un chiffre faux est nommé, avec les deux valeurs", () => {
    const e = ecarts({ appels: 65, fichiers: 7, tables: new Array(11), dynamiques: new Array(6), in: 3 }, dit(TABLE));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/annonce 10 pour les tables atteintes, le code en compte 11/);
  });

  // ⚠️ LA FORME QUI DISPARAÎT EST LE PIRE CAS : la garde deviendrait muette EN RESTANT VERTE.
  it("un chiffre qui cesse d'être annoncé sous une forme comparable fait REFUSER", () => {
    const e = ecarts({ appels: 65, fichiers: 7, tables: new Array(10), dynamiques: new Array(6), in: 3 },
      dit("| Tables | ten of them |\n| Call sites | **65**, in **7** files |\n| `in.(…)` | **3** — … |"));
    expect(e.join(" ")).toMatch(/ne peut plus comparer/);
  });
});

describe("le dépôt réel", () => {
  it("le document dit exactement ce que le code fait", () => {
    const fichiers = fichiersServeur(RACINE);
    expect(fichiers.length, "aucun fichier lu : la sonde vise à côté").toBeGreaterThan(3);
    const mesure = { ...mesurer(fichiers), in: compterIn(fichiers) };
    const md = readFileSync(join(RACINE, "docs", "API.md"), "utf8");
    expect(ecarts(mesure, annonces(md)), "docs/API.md a dérivé — relancez node tools/surface-base.mjs")
      .toEqual([]);
  });
});
