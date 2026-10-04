// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN HÔTE DOIT POUVOIR PROUVER QU'UNE MIGRATION A TOURNÉ, EN SONDANT SA BASE.
//
// ⚠️ Cette propriété était tenue SANS ÊTRE ÉCRITE, et un hôte de production en dépendait déjà : son
// registre de migrations ne disait pas la vérité, donc la seule réponse fiable se lit sur les
// effets. Ce banc éprouve la règle, puis l'applique aux DIX-NEUF migrations réelles.

import { readFileSync, readdirSync } from "node:fs";
import { describe, it, expect } from "vitest";

import { signesDe, improuvables, cleDe, ecarts, lireDossier, genreDuSigne, genresManquants, GENRES_ATTESTES, INDISTINGUABLES_DECLAREES } from "../migrations-detectables.mjs";

describe("les signes qu'une migration laisse", () => {
  it("⚠️ retient la SIGNATURE d'une fonction, pas son nom — c'est l'arité qui a séparé 0017/0018/0019", () => {
    expect(signesDe("drop function public.f(a int, b text); create or replace function public.f(a int, b text, c int) returns void as $$ $$ language sql;"))
      .toEqual(["drop function public.f/2", "function public.f/3"]);
  });

  it("relève les objets qu'un hôte peut sonder", () => {
    expect(signesDe("create table t(id int); create unique index i on t(id); create trigger tr before insert on t execute function f();"))
      .toEqual(["index i", "table t", "trigger tr"]);
  });

  it("⚠️ ne lit pas les commentaires SQL — une sonde qui lit du commentaire invente un coupable", () => {
    expect(signesDe("-- create table fantome(id int)\ncreate table vrai(id int);")).toEqual(["table vrai"]);
  });

  it("⚠️ relève les quatre formes qui manquaient — sept migrations n'avaient AUCUN signe", () => {
    // Elles en laissaient toutes ; c'est la sonde qui ne les cherchait pas, pendant que la garde
    // annonçait « chacune prouvable ». Une couverture affirmée plus large qu'elle n'est.
    expect(signesDe("alter table public.t add column if not exists c text;")).toEqual(["column public.t.c"]);
    expect(signesDe("alter table public.t alter column c drop not null;")).toEqual(["nullability public.t.c drop"]);
    expect(signesDe("alter table public.t replica identity default;")).toEqual(["replica identity public.t default"]);
    expect(signesDe("comment on column public.t.c is 'x';")[0]).toMatch(/^comment public\.t\.c #[0-9a-f]{8}$/);
  });

  it("⚠️ un corps de fonction ne DÉCLARE rien — c'est du code qu'elle exécute", () => {
    // La distinction est DÉCLARATION contre RÉFÉRENCE, et elle n'existe pas dans le texte brut.
    // Une sonde voisine s'y est trompée cinq fois en une journée. Zéro occurrence chez nous
    // aujourd'hui : ce cas ferme une porte, il ne corrige pas un compte.
    const sql = "create or replace function public.f() returns void language plpgsql as $$ begin execute 'create index fantome on t(x)'; end $$;";
    expect(signesDe(sql)).toEqual(["function public.f/0"]);
  });

  it("⚠️ le signe d'un commentaire est son TEXTE — 0012 ne fait que remplacer celui de 0011", () => {
    const a = signesDe("comment on column public.t.c is 'ancien';");
    const b = signesDe("comment on column public.t.c is 'nouveau';");
    expect(a).not.toEqual(b);
    // « cette colonne est-elle commentée ? » répond oui pour les deux : seul le texte les sépare,
    // et `col_description()` le rend, donc c'est sondable.
    expect(a[0].split(" #")[0]).toBe(b[0].split(" #")[0]);
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

  it("⚠️ une migration SANS AUCUN signe est accusée, pas sautée", () => {
    // Le filtre disait `parFichier[f].length &&` : sept migrations passaient sans être regardées.
    // N'avoir aucun signe est PIRE que se confondre — on ne peut même pas nommer quoi sonder.
    const vus = improuvables({ "a.sql": ["table t"], "muette.sql": [] });
    expect(vus.map((x) => x.fichier)).toEqual(["muette.sql"]);
    expect(vus[0].confondueAvec).toEqual([]);
    expect(ecarts({ "a.sql": ["table t"], "muette.sql": [] }, {}).join(" ")).toMatch(/AUCUN signe sondable/);
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

describe("les migrations réelles", () => {
  const parFichier = lireDossier();

  // ⚠️ LE COMPTE SE DÉRIVE, IL NE S'ÉCRIT PAS. Ce banc portait « 19 » en dur : il rougissait à
  // CHAQUE migration ajoutée, en disant « la sonde en trouve 20 au lieu de 19 » — un refus qui
  // n'apprend rien et qu'on corrige sans réfléchir, donc le pire genre. Ce qui doit être vérifié
  // n'est pas un nombre, c'est que la sonde ne SAUTE aucun fichier : on compte les `.sql` du
  // dossier indépendamment, et on exige l'égalité.
  it("la sonde ne saute aucun fichier du dossier", () => {
    const surDisque = readdirSync("supabase/migrations").filter((f) => f.endsWith(".sql"));
    expect(surDisque.length).toBeGreaterThan(0);
    expect(Object.keys(parFichier).sort()).toEqual(surDisque.sort());
  });

  it("⚠️ AUCUNE n'est muette — l'assertion qui manquait", () => {
    // Sans elle, la garde annonçait « chacune prouvable » en en sautant sept, et le banc restait
    // vert. C'est la propriété qui a lâché, donc c'est celle qui doit être écrite.
    const muettes = Object.entries(parFichier).filter(([, s]) => s.length === 0).map(([f]) => f);
    expect(muettes, `migration(s) sans aucun signe sondable : ${muettes.join(", ")}`).toEqual([]);
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

// ⚠️ LE VERDICT SE DONNAIT DÉJÀ POUR PROTÉGÉ : « une sonde qui cesserait de voir une forme ferait
// chuter ce nombre à vue d'œil ». Mesuré le 01/09 en aveuglant les huit détecteurs un par un :
// cinq rendaient rouge, TROIS laissaient la garde verte — `drop function` (63 → 60 signes),
// `nullability` (63 → 62) et `add column` (63 → 52). Onze signes sur soixante-trois pouvaient
// disparaître en silence. Ce qui suit tient l'exigence sur le GENRE reconnu, pas sur le compte.
describe("⚠️ chaque genre de signe attesté doit encore être vu", () => {
  const reel = lireDossier();

  it("les dix genres attestés sont tous présents dans les migrations réelles", () => {
    expect(genresManquants(reel), "un genre absent = un détecteur aveugle, les fichiers étant immuables")
      .toEqual([]);
  });

  it("⚠️ aucun genre vu n'échappe à la liste — sinon une forme neuve serait ajoutée sans protection", () => {
    const vus = [...new Set(Object.values(reel).flat().map(genreDuSigne))].sort();
    expect(vus.filter((g) => !GENRES_ATTESTES.includes(g)),
      "ajoutez le genre à GENRES_ATTESTES en même temps que son détecteur")
      .toEqual([]);
  });

  it("⚠️ et le contrôle NOMME le genre perdu — un corpus amputé d'un genre ne passe pas", () => {
    // On retire de la lecture réelle tout ce que `drop function` avait produit : c'est exactement
    // ce que fait un détecteur aveuglé, et c'est le cas qui restait vert avant le 01/09.
    const ampute = Object.fromEntries(Object.entries(reel)
      .map(([f, signes]) => [f, signes.filter((s) => genreDuSigne(s) !== "drop function")]));
    expect(genresManquants(ampute)).toEqual(["drop function"]);
  });

  it("⚠️ et un corpus vide n'est pas un corpus conforme — l'absence échoue fermée", () => {
    expect(genresManquants({})).toEqual(GENRES_ATTESTES);
  });

  it("`drop function x/3` et `function x/3` sont de deux genres — ce sont deux détecteurs", () => {
    expect(genreDuSigne("drop function player_attendance_bump/10")).toBe("drop function");
    expect(genreDuSigne("function player_attendance_bump/10")).toBe("function");
    expect(genreDuSigne("replica identity views full")).toBe("replica identity");
    expect(genreDuSigne("column views.page")).toBe("column");
  });
});

// ⚠️ DEUX SONDES DE `signesDe` QUE PERSONNE N'ÉPROUVAIT — mesuré le 01/09 en les aveuglant : ni la
// garde ni ce banc ne bougeaient. Elles ne relèvent pas des signes, elles décident de quoi les
// signes sont faits ; leur panne ne fait pas disparaître un signe, elle en fabrique un faux ou en
// dédouble un vrai. C'est la panne dont on ne voit rien.
describe("⚠️ ce que `signesDe` refuse de lire, et pourquoi", () => {
  // ⚠️ ZÉRO OCCURRENCE DANS LES MIGRATIONS D'AUJOURD'HUI — vérifié le 01/09, aucun `/* … */` dans
  // les 25 fichiers. La sonde ne peut donc rien changer au compte actuel, et c'est exactement pour
  // ça qu'elle n'était vue par personne : elle ferme une porte plutôt qu'elle n'ouvre un cas.
  // Ce qui passerait par cette porte est un signe FABRIQUÉ — une migration qu'on croirait prouvable
  // parce qu'elle décrit, en commentaire, une table qu'elle ne crée pas.
  it("⚠️ une table nommée dans un commentaire de bloc n'est pas une table créée", () => {
    const sql = "/* create table public.faux_positif (id int); */\ncreate table public.vraie (id int);";
    expect(signesDe(sql), "seule la vraie compte").toEqual(["table public.vraie"]);
  });

  it("un commentaire de bloc n'avale pas non plus ce qui le suit", () => {
    expect(signesDe("/* rien */ create index if not exists i_x on public.t (c);"))
      .toEqual(["index i_x"]);
  });

  // ⚠️ L'EMPREINTE PORTE SUR LE TEXTE DU COMMENTAIRE, PAS SUR LA MISE EN PAGE DU FICHIER. Ce que
  // `col_description()` rend à un hôte est le littéral stocké : replier la même phrase sur deux
  // lignes ne le change pas. Sans la normalisation, deux écritures du MÊME commentaire donneraient
  // deux empreintes — la garde croirait deux migrations distinguables là où un hôte ne peut pas les
  // séparer, et c'est le sens même de ce qu'elle mesure qui tomberait.
  // ⚠️ ET LE PLI EST INTERNE, PAS EN TÊTE. Un `.trim()` suffirait à absorber l'indentation qui suit
  // le `is` ; ce qu'il ne peut pas absorber, c'est le retour à la ligne AU MILIEU du texte — la
  // forme qu'emploient toutes les migrations de ce dossier, qui coupent un commentaire long en
  // littéraux concaténés (la 0025 le fait sur trois lignes). Un premier cas écrit ici ne repliait
  // qu'en tête et passait aveuglé : il éprouvait `trim`, pas la normalisation.
  it("⚠️ le même commentaire coupé en littéraux concaténés donne la même empreinte", () => {
    const replie = "comment on index public.i is\n  'Sert la question de la fiche : '\n  'filtre, tri et pagination.';";
    const droit = "comment on index public.i is 'Sert la question de la fiche : ' 'filtre, tri et pagination.';";
    expect(signesDe(replie), "un hôte lit le texte stocké, pas la mise en page du fichier")
      .toEqual(signesDe(droit));
    expect(signesDe(droit)[0]).toMatch(/^comment public\.i #[0-9a-f]{8}$/);
  });

  it("⚠️ et deux TEXTES différents donnent bien deux empreintes — sinon la normalisation aurait tout aplati", () => {
    const un = "comment on column public.t.c is 'Une phrase de commentaire.';";
    const autre = "comment on column public.t.c is 'Une AUTRE phrase.';";
    expect(signesDe(autre)).not.toEqual(signesDe(un));
  });
});
