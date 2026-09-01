// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'OUTIL QUI DÉRIVE LA SURFACE BASE — ÉPROUVÉ, PARCE QU'IL REMPLACE UNE PROSE QUI AVAIT DÉRIVÉ.
//
// ⚠️ UNE GARDE QU'ON N'A PAS VUE REFUSER NE GARDE RIEN, et celle-ci remplace trois chiffres écrits à
// la main dont chacun s'était éloigné du code sans que personne ne s'en aperçoive. Elle doit donc
// refuser sur des cas fabriqués, dans CHACUNE des formes qu'elle prétend attraper.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { sourceUtile, mesurer, compterIn, annonces, ecarts, fichiersServeur, effondrement, compterOr, COMPAREES } from "../surface-base.mjs";

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
    "| Call sites | **65**†, in **7**† files |",
    "| Tables | **10**†, plus **6**† call sites that build their path at run time |",
    "| `in.(…)` | **3**† — translates to … |",
    "| `or=()` | **2**† — le curseur à deux coordonnées |",
    "† **Recomputed from the code on every CI run** by `tools/surface-base.mjs`.",
  ].join("\n");

  it("lit chaque chiffre là où le lecteur le lit", () => {
    expect(dit(TABLE)).toEqual({ appels: 65, fichiers: 7, tables: 10, dynamiques: 6, in: 3, or: 2, legende: true });
  });

  // ⚠️ LE MARQUEUR EST EXIGÉ, SINON IL PEUT MENTIR. Le retirer en laissant le chiffre ferait croire
  // au lecteur que ce nombre est écrit à la main — et, bien pire, ferait croire à celui d'un AUTRE
  // document que le sien est dérivé, puisque tout se ressemblerait de nouveau.
  it("un chiffre dont on retire le † fait REFUSER, il ne passe pas pour écrit à la main", () => {
    const sansMarqueur = TABLE.replace("| Tables | **10**†", "| Tables | **10**");
    expect(ecarts({ appels: 65, fichiers: 7, tables: new Array(10), dynamiques: new Array(6), in: 3, or: 2 }, dit(sansMarqueur))
      .join(" ")).toMatch(/ne peut plus comparer/);
  });

  // ⚠️ UN MARQUEUR SANS LÉGENDE NE MARQUE RIEN : le signe ne vaut que par la phrase qui dit ce
  // qu'il promet, et surtout par celle qui dit ce que son ABSENCE veut dire ailleurs.
  it("la légende retirée fait REFUSER, même si les cinq chiffres sont justes", () => {
    const sansLegende = TABLE.split("\n").filter((l) => !l.startsWith("†")).join("\n");
    expect(ecarts({ appels: 65, fichiers: 7, tables: new Array(10), dynamiques: new Array(6), in: 3, or: 2 }, dit(sansLegende))
      .join(" ")).toMatch(/légende du marqueur/);
  });

  it("aucun écart quand tout concorde", () => {
    expect(ecarts({ appels: 65, fichiers: 7, tables: new Array(10), dynamiques: new Array(6), in: 3, or: 2 }, dit(TABLE))).toEqual([]);
  });

  it("un chiffre faux est nommé, avec les deux valeurs", () => {
    const e = ecarts({ appels: 65, fichiers: 7, tables: new Array(11), dynamiques: new Array(6), in: 3, or: 2 }, dit(TABLE));
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/annonce 10 pour les tables atteintes, le code en compte 11/);
  });

  // ⚠️ LA FORME QUI DISPARAÎT EST LE PIRE CAS : la garde deviendrait muette EN RESTANT VERTE.
  it("un chiffre qui cesse d'être annoncé sous une forme comparable fait REFUSER", () => {
    const e = ecarts({ appels: 65, fichiers: 7, tables: new Array(10), dynamiques: new Array(6), in: 3, or: 2 },
      dit("| Tables | ten of them |\n| Call sites | **65**, in **7** files |\n| `in.(…)` | **3** — … |"));
    expect(e.join(" ")).toMatch(/ne peut plus comparer/);
  });
});

describe("le dépôt réel", () => {
  it("le document dit exactement ce que le code fait", () => {
    const fichiers = fichiersServeur(RACINE);
    expect(fichiers.length, "aucun fichier lu : la sonde vise à côté").toBeGreaterThan(3);
    const mesure = { ...mesurer(fichiers), in: compterIn(fichiers), or: compterOr(fichiers) };
    const md = readFileSync(join(RACINE, "docs", "API.md"), "utf8");
    expect(ecarts(mesure, annonces(md)), "docs/API.md a dérivé — relancez node tools/surface-base.mjs")
      .toEqual([]);
  });
});

// ⚠️ LE PLANCHER SUR LES TABLES NE TENAIT QUE DANS LE CAS PARFAITEMENT VIDE. Il s'écrivait avec une
// branche sur le NOM de la clé — `cle === "tables" ? mesure.tables.length : mesure[cle]` — et
// mesuré le 01/09 en aveuglant ce littéral : zéro table refusait encore, une, deux ou trois
// passaient. La raison est une coercition JavaScript : `[] < 4` vaut `true` (tableau vide → 0),
// mais `["a"] < 4` compare « a » à 4, donc `NaN < 4`, donc faux.
//
// Or la panne que ce plancher existe pour attraper est une sonde qui trouve ENCORE quelque chose —
// une sur quatre — pas une sonde qui ne trouve plus rien. Il ne tenait donc pas dans le seul cas
// qui compte.
describe("⚠️ le plancher refuse une sonde à moitié aveugle, pas seulement une sonde muette", () => {
  const abondant = { lectures: 99, ecritures: 99, rpc: 99 };

  it("refuse UNE table trouvée sur quatre attendues — le cas d'une sonde qui trouve encore", () => {
    expect(effondrement({ ...abondant, tables: ["a"] }))
      .toEqual([expect.stringMatching(/^tables : 1 trouvé\(s\), plancher/)]);
  });

  it("refuse aussi zéro, deux et trois", () => {
    for (const t of [[], ["a", "b"], ["a", "b", "c"]]) {
      expect(effondrement({ ...abondant, tables: t }).length, `${t.length} table(s)`).toBe(1);
    }
  });

  it("et laisse passer un relevé abondant", () => {
    expect(effondrement({ ...abondant, tables: ["a", "b", "c", "d"] })).toEqual([]);
  });

  it("⚠️ le compte annoncé est un NOMBRE, pas un tableau imprimé de travers", () => {
    expect(effondrement({ ...abondant, tables: ["a"] })[0]).toContain("1 trouvé(s)");
  });
});

// ⚠️ LA LIGNE « or=(), and=(), offset= | 0 » NE PORTAIT PAS LE MARQUEUR †, donc rien ne la relisait.
// Elle était vraie le jour où elle a été écrite, et le premier curseur de pagination l'a rendue
// fausse dans le commit même qui l'a laissée à zéro. Quatre lignes du tableau étaient mesurées, pas
// celle-là — et le lecteur qui pèse un portage ne pouvait pas savoir laquelle était tenue.
describe("⚠️ les « or=(…) » sont comptés comme les autres, parce qu'un zéro à la main pourrit", () => {
  it("compte un or=( dans un chemin de requête, et rien d'autre", () => {
    const f = (texte) => [{ nom: "x.js", texte }];
    expect(compterOr(f('PLAYER.db.request(`t?or=(a.lt.1,and(b.eq.2))`)'))).toBe(1);
    expect(compterOr(f('PLAYER.db.request(`t?x=1&or=(a.lt.1)`)'))).toBe(1);
    expect(compterOr(f('PLAYER.db.request("t?select=*")')), "aucun or= : zéro").toBe(0);
    expect(compterOr(f('// or=(ceci est un commentaire)')), "un commentaire n'est pas du code").toBe(0);
  });

  it("⚠️ le document et le code doivent s'accorder sur CE chiffre aussi", () => {
    const mesure = { appels: 1, fichiers: 1, tables: [], dynamiques: [], in: 0, or: 1 };
    const dit = { appels: 1, fichiers: 1, tables: 0, dynamiques: 0, in: 0, or: 0, legende: true };
    expect(ecarts(mesure, dit)).toEqual([expect.stringMatching(/annonce 0 pour les « or=\(…\) », le code en compte 1/)]);
  });

  it("⚠️ et un chiffre retiré du document fait REFUSER, pas conclure", () => {
    const mesure = { appels: 1, fichiers: 1, tables: [], dynamiques: [], in: 0, or: 0 };
    const dit = { appels: 1, fichiers: 1, tables: 0, dynamiques: 0, in: 0, or: null, legende: true };
    expect(ecarts(mesure, dit)).toEqual([expect.stringMatching(/n'annonce plus les « or=\(…\) » sous une forme lisible/)]);
  });

  it("⚠️ le nombre de chiffres se COMPTE — la phrase verte disait « les cinq » en toutes lettres", () => {
    const mesure = { appels: 1, fichiers: 1, tables: [], dynamiques: [], in: 0, or: 0 };
    const dit = Object.fromEntries([...COMPAREES.map(([c, lire]) => [c, lire(mesure)]), ["legende", true]]);
    expect(ecarts(mesure, dit), "toutes les mesures comparées, sans exception oubliée").toEqual([]);
    expect(COMPAREES.length, "six le 01/09 — et le vert le lit d'ici, il ne l'écrit pas").toBeGreaterThanOrEqual(6);
  });

  it("le document réel annonce bien le or= avec son marqueur", () => {
    const dit = annonces(readFileSync("docs/API.md", "utf8"));
    expect(dit.or, "sans le † le motif ne matche pas, et la garde refuse").not.toBeNull();
    expect(dit.or).toBe(compterOr(fichiersServeur()));
  });
});
