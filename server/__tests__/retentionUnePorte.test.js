// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE OPTION N'EST PAS SEULEMENT DÉFINIE ET TRANSMISE — ELLE DOIT ÊTRE HONORÉE SUR CHAQUE CHEMIN.
//
// ⚠️ Le second hôte a affiné la règle des trois audits (clé tronquée, backfill, dryRun) : « définie »
// se prouve au validateur, « transmise » au site d'appel — un point — mais « honorée » se prouve
// en ÉNUMÉRANT les chemins d'écriture, autant d'endroits qu'il y en a. Et une garde à FENÊTRE de
// lecture retomberait dans le piège du périmètre (sa propre première lecture voyait un DELETE sans
// garde, sur quinze lignes). La forme robuste n'est donc pas « chaque DELETE est sous un if » mais
// « il n'y a qu'UNE porte de destruction », court-circuitée par dryRun en première ligne — et on
// garde qu'il n'y en a qu'une. La garde grandit avec le fichier : un troisième chemin d'écriture
// devra passer par la porte, ou il introduira un `method: "DELETE"` que ce compte refuse.

const fs = require("node:fs");
const retention = require("../retention.js");

const SRC = fs.readFileSync(require.resolve("../retention.js"), "utf8");

describe("une seule porte de destruction, honorant dryRun", () => {
  it("UN seul `method: \"DELETE\"` dans tout le fichier", () => {
    const n = (SRC.match(/method:\s*"DELETE"/g) || []).length;
    expect(n, "chaque suppression passe par la porte unique — un 2e DELETE = un chemin non gardé").toBe(1);
  });

  it("UN seul retrait de fichier (`.remove(`) dans tout le fichier", () => {
    const n = (SRC.match(/\.remove\(/g) || []).length + (SRC.match(/\bretirer\(/g) || []).length;
    expect(n, "chaque retrait passe par la porte unique").toBe(1);
  });

  it("la porte DELETE court-circuite dryRun AVANT d'émettre quoi que ce soit", () => {
    // La fonction qui contient l'unique DELETE doit tester dryRun avant lui.
    const idx = SRC.indexOf('method: "DELETE"');
    const debutFn = SRC.lastIndexOf("async function", idx);
    const avant = SRC.slice(debutFn, idx);
    expect(/dryRun/.test(avant), "dryRun est consulté avant le DELETE").toBe(true);
  });
});

describe("honoré par EXÉCUTION : dryRun ne touche à rien, sur AUCUN chemin", () => {
  it("un dry-run n'émet aucun DELETE ni aucun retrait — journaux, liens ET présentations", async () => {
    const destructifs = [];
    const ctx = {
      db: {
        async request(chemin, o = {}) {
          if ((o.method || "GET") === "DELETE") destructifs.push({ type: "delete", chemin });
          if (chemin.startsWith("commercial_doc_shares?select=revoked_at")) return [];
          if (chemin.startsWith("doc_presentations?active=eq.false")) return [{ slug: "p1" }];
          // toute sélection rend une ligne, pour donner à chaque chemin de quoi vouloir supprimer
          if ((o.method || "GET") === "GET" && /select=/.test(chemin)) {
            if (/id=gt\.|attendee_key=gt\.|slug=gt\./.test(chemin)) return [];
            if (chemin.includes("select=id,attachment")) return [{ id: "m1", attachment: null }];
            return [{ id: "x1", session_id: "x1", key: "x1", slug: "x1", attendee_key: "x1" }];
          }
          return [];
        },
        async selectAll() { return []; },
      },
      storage: { async remove() { destructifs.push({ type: "remove" }); return true; } },
      limits: { async allow() { return true; } },
      errors: { capture() {} },
      config: { supabaseUrl: "https://x.supabase.co", retention: {} },
    };
    retention.init(ctx);
    require("../schema.js").init(ctx);
    require("../presentations.js").init(ctx);
    const r = await retention.purgerRetention(Date.now(), { dryRun: true });
    expect(r.dryRun).toBe(true);
    expect(destructifs, "dryRun ne doit RIEN détruire, sur aucun chemin").toEqual([]);
  });
});
