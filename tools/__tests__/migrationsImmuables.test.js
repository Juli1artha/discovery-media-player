// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ CETTE GARDE NAÎT D'UN SIGNAL REÇU PAR UN HÔTE, PAS D'UNE CRAINTE. Entre 0.1.163 et 0.1.164, la
// migration 0004 a changé — un commentaire corrigé en place — et un hôte qui empreinte ses
// migrations a dû faire un `diff -u` pour savoir qu'il n'avait rien à ré-appliquer. Ces bancs
// fixent la règle : une migration présente dans la dernière version publiée ne bouge plus, pas
// même d'un commentaire, et sans tag lisible la garde ne conclut pas.

const { mkdtempSync, writeFileSync, rmSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { tmpdir } = require("node:os");
const { execFileSync } = require("node:child_process");

let garde;
beforeAll(async () => { garde = await import("../migrations-immuables.mjs"); });

const git = (d, ...args) => execFileSync("git", ["-c", "user.name=banc", "-c", "user.email=banc@exemple", ...args], { cwd: d, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });

/** Un dépôt jetable : une migration commitée et taguée `v0.1.1`. */
function depot() {
  const d = mkdtempSync(join(tmpdir(), "migrations-immuables-"));
  git(d, "init", "-q");
  mkdirSync(join(d, "supabase/migrations"), { recursive: true });
  writeFileSync(join(d, "supabase/migrations/0001-base.sql"), "-- base\ncreate table if not exists t (id int);\n");
  git(d, "add", "-A"); git(d, "commit", "-q", "-m", "publiée");
  git(d, "tag", "v0.1.1");
  return d;
}

describe("⚠️ une migration publiée ne change plus", () => {
  it("⚠️ un COMMENTAIRE modifié dans une migration publiée est une violation — c'est le cas qui a fait naître la garde", () => {
    const d = depot();
    try {
      writeFileSync(join(d, "supabase/migrations/0001-base.sql"), "-- base, mieux dite\ncreate table if not exists t (id int);\n");
      const r = garde.auditer(d);
      expect(r.code).toBe(1);
      expect(r.constats.join("\n")).toMatch(/0001-base\.sql diffère de sa version publiée dans v0\.1\.1/);
      expect(r.constats.join("\n"), "le constat dit où porter la correction").toMatch(/migration NEUVE/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("une migration publiée puis RETIRÉE de l'arbre est une violation", () => {
    const d = depot();
    try {
      rmSync(join(d, "supabase/migrations/0001-base.sql"));
      const r = garde.auditer(d);
      expect(r.code).toBe(1);
      expect(r.constats.join("\n")).toMatch(/absente de l'arbre/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("une migration NEUVE à côté d'une publiée intacte est conforme, et comptée", () => {
    const d = depot();
    try {
      writeFileSync(join(d, "supabase/migrations/0002-suite.sql"), "alter table t add column if not exists x int;\n");
      const r = garde.auditer(d);
      expect(r.code, JSON.stringify(r)).toBe(0);
      expect(r.resume).toMatch(/1 migration\(s\) publiée\(s\) dans v0\.1\.1/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("⚠️ la référence est le tag le plus HAUT, pas le dernier de la liste lexicale", () => {
    expect(garde.tagLePlusHaut("v0.1.9\nv0.1.164\nv0.1.10\nbidule\n")).toBe("v0.1.164");
    expect(garde.tagLePlusHaut("v1.0.0\nv0.9.99\n")).toBe("v1.0.0");
    expect(garde.tagLePlusHaut("")).toBeNull();
    // Et sur un vrai dépôt : la migration bouge après un tag plus BAS que le dernier — toujours vue.
    const d = depot();
    try {
      writeFileSync(join(d, "supabase/migrations/0002-suite.sql"), "select 1;\n");
      git(d, "add", "-A"); git(d, "commit", "-q", "-m", "suite"); git(d, "tag", "v0.1.2");
      writeFileSync(join(d, "supabase/migrations/0002-suite.sql"), "select 2;\n");
      const r = garde.auditer(d);
      expect(r.code).toBe(1);
      expect(r.constats.join("\n")).toMatch(/0002-suite\.sql diffère de sa version publiée dans v0\.1\.2/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("⚠️ sans tag lisible, NON CONCLUANT — jamais vert sur rien", () => {
    const d = mkdtempSync(join(tmpdir(), "migrations-immuables-"));
    try {
      git(d, "init", "-q");
      expect(garde.auditer(d).code).toBe(2);
      expect(garde.auditer(d, { lireTags: () => { throw new Error("git absent"); } }).code).toBe(2);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("⚠️ un tag sans aucune migration dessous est NON CONCLUANT — la sonde ne vise rien", () => {
    const d = mkdtempSync(join(tmpdir(), "migrations-immuables-"));
    try {
      git(d, "init", "-q");
      writeFileSync(join(d, "README.md"), "x\n");
      git(d, "add", "-A"); git(d, "commit", "-q", "-m", "vide"); git(d, "tag", "v0.1.1");
      const r = garde.auditer(d);
      expect(r.code).toBe(2);
      expect(r.raisons.join("\n")).toMatch(/aucune migration lue/);
    } finally { rmSync(d, { recursive: true, force: true }); }
  });

  it("confronter() compare des OCTETS : un espace de fin suffit", () => {
    const r = garde.confronter({ "a.sql": "select 1;\n" }, (c) => (c === "a.sql" ? "select 1; \n" : null));
    expect(r.modifiees).toEqual(["a.sql"]);
    expect(garde.confronter({ "a.sql": "x" }, () => null).disparues).toEqual(["a.sql"]);
  });

  // ⚠️ LE DÉPÔT LUI-MÊME. Vert exigé : la forge rapatrie les tags (`fetch-tags`), et un clone local
  // sans tags rend NON CONCLUANT — ce banc rougit alors, exprès, plutôt que de passer en ne
  // regardant rien. `git fetch origin --tags` est la réparation, pas l'assertion.
  it("le dépôt lui-même : chaque migration publiée est intacte", () => {
    const r = garde.auditer();
    expect(r.code, JSON.stringify(r)).toBe(0);
  });
});
