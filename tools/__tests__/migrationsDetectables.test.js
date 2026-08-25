// UN HÔTE DOIT POUVOIR PROUVER QU'UNE MIGRATION A TOURNÉ, EN SONDANT SA BASE.
//
// ⚠️ Cette propriété était tenue SANS ÊTRE ÉCRITE, et un hôte de production en dépendait déjà : son
// registre de migrations ne disait pas la vérité, donc la seule réponse fiable se lit sur les
// effets. Ce banc éprouve la règle, puis l'applique aux DIX-NEUF migrations réelles.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { signesDe, improuvables, cleDe, ecarts, lireDossier, INDISTINGUABLES_DECLAREES } from "../migrations-detectables.mjs";

describe("les signes qu'une migration laisse", () => {
  it("⚠️ retient la SIGNATURE d'une fonction, pas son nom — c'est l'arité qui a séparé 0017/0018/0019", () => {
    expect(signesDe("drop function public.f(a int, b text); create or replace function public.f(a int, b text, c int) returns void as $$ $$ language sql;"))
      .toEqual(["drop function public.f/2", "function public.f/3"]);
  });

  it("relève les objets qu'un hôte peut sonder", () => {
    expect(signesDe("create table t(id int); create unique index i on t(id); create trigger tr before insert on t execute function f();"))
      .toEqual(["index i", "table t", "trigger tr"]);
  });

  it("⚠️ ne lit pas les commentaires — une sonde qui lit du commentaire invente un coupable", () => {
    expect(signesDe("-- create table fantome(id int)\ncreate table vrai(id int);")).toEqual(["table vrai"]);
  });
});

describe("la règle", () => {
  it("⚠️ la propriété est « un signe À ELLE », pas « deux jeux identiques »", () => {
    // Le cas réel : 0007 partage sa fonction avec 0010 mais possède deux triggers ; elle est
    // prouvable. 0010 n'a que la fonction partagée ; elle ne l'est pas. Le défaut est UNILATÉRAL,
    // et un groupement par jeux identiques le manquait faute de groupe.
    const vus = improuvables({
      "0007.sql": ["function f/0", "trigger a", "trigger b"],
      "0010.sql": ["function f/0"],
    });
    expect(vus.map((x) => x.fichier)).toEqual(["0010.sql"]);
    expect(vus[0].confondueAvec).toEqual(["0007.sql"]);
  });

  it("⚠️ un « create or replace » sans drop devient improuvable — le cas prédit", () => {
    const vus = improuvables({
      "0018.sql": ["drop function f/11", "function f/12"],
      "0020.sql": ["function f/12"],
    });
    expect(vus.map((x) => x.fichier)).toEqual(["0020.sql"]);
  });

  it("⚠️ le même avec le drop de la signature précédente est prouvable — la discipline tenue", () => {
    expect(improuvables({
      "0019.sql": ["drop function f/12", "function f/13"],
      "0020.sql": ["drop function f/13", "function f/14"],
    })).toEqual([]);
  });

  it("dit AVEC QUI elle se confond — sinon on ne sait pas où regarder", () => {
    expect(cleDe({ fichier: "b.sql", confondueAvec: ["a.sql"] })).toBe("b.sql (se confond avec a.sql)");
  });

  it("une migration déclarée n'est plus accusée", () => {
    const parFichier = { "a.sql": ["function f/0", "trigger t"], "b.sql": ["function f/0"] };
    const cle = "b.sql (se confond avec a.sql)";
    expect(ecarts(parFichier, {})).toHaveLength(1);
    expect(ecarts(parFichier, { [cle]: "raison" })).toEqual([]);
  });

  it("⚠️ une déclaration qui ne correspond plus à rien est refusée — un mensonge qui dort", () => {
    expect(ecarts({ "a.sql": ["table t"] }, { "b.sql (se confond avec a.sql)": "raison" }).join(" "))
      .toMatch(/ne l'est plus — retirez la déclaration/);
  });
});

describe("les dix-neuf migrations réelles", () => {
  const parFichier = lireDossier();

  it("la sonde en trouve bien", () => {
    expect(Object.keys(parFichier).length).toBe(19);
  });

  it("aucun écart non déclaré", () => {
    const soucis = ecarts(parFichier);
    expect(soucis, `écart(s) :\n${soucis.join("\n")}`).toEqual([]);
  });

  it("⚠️ 0010 EST improuvable, et c'est déclaré plutôt que masqué", () => {
    // Elle est appliquée ailleurs, donc immuable : la réécrire serait le défaut qu'on fait crier.
    const vus = improuvables(parFichier).map((x) => x.fichier);
    expect(vus).toEqual(["0010-archive-verrou-share.sql"]);
    expect(Object.values(INDISTINGUABLES_DECLAREES)[0]).toMatch(/LIRE LE CORPS/);
  });

  it("⚠️ 0017, 0018 et 0019 se prouvent par le drop de la signature d'avant", () => {
    const arite = (f) => signesDe(readFileSync(`supabase/migrations/${f}`, "utf8"))
      .filter((s) => s.startsWith("drop function")).map((s) => s.split("/").pop());
    expect(arite("0017-jeton-presence.sql")).toEqual(["10"]);
    expect(arite("0018-bootstrap-non-usurpable.sql")).toEqual(["11"]);
    expect(arite("0019-presence-lit-la-presentation.sql")).toEqual(["12"]);
  });

  it("⚠️ 0015 ne se prouve QUE par l'index qu'elle crée — sans lui, elle serait invisible", () => {
    const signes = signesDe(readFileSync("supabase/migrations/0015-presence-atomique.sql", "utf8"));
    expect(signes).toContain("index idx_attendees_slug_creator");
    expect(signes.filter((s) => s.startsWith("drop"))).toEqual([]);
  });
});
