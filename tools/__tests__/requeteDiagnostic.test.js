// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA REQUÊTE QUE LA CI EXÉCUTE DOIT ÊTRE CELLE QUE L'HÔTE LIT — SINON LE BANC ET L'HÔTE MESURENT
// DEUX CHOSES DIFFÉRENTES.
//
// ⚠️ LE FAIT (28/08). La requête de diagnostic du `revoke` a été écrite trois fois, et aucune des
// deux premières n'a été trouvée fautive par son auteur : v1 (« like '%anon%' », de nous) par un
// hôte, v2 (« un rôle par politique », de l'hôte) par nous. La troisième est éprouvée plutôt que
// relue — et pour que ce soit la bonne qui le soit, elle est EXTRAITE de `supabase/init.sql`, pas
// recopiée. Ce banc garde l'extraction : c'est le seul maillon entre le texte que l'hôte applique et
// le SQL que la forge exécute.
//
// ⚠️ CE QUI EST GARDÉ EN PRIORITÉ EST LE REFUS, PAS LA RÉUSSITE. Une extraction qui rate en silence
// rend un SQL vide ; un SQL vide ne rend jamais de ligne ; un banc qui cherche des lignes vire alors
// au VERT pour la raison exacte qu'il existe pour interdire. Tous les cas ci-dessous vérifient donc
// qu'on refuse — et `INCONCLUSIF`, pas `VIOLATION` : le correctif est dans le fichier ou la marque,
// jamais dans la branche de celui qui passe par là.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { extraire, principal, verifier, OUVRANTE, FERMANTE, SOURCE } from "../requete-diagnostic.mjs";
import { CONFORME, INCONCLUSIF } from "../resultat-garde.mjs";

const bloc = (corps) => `-- prose avant\n-- ${OUVRANTE}\n${corps}\n-- ${FERMANTE}\n-- prose après\n`;
const REQUETE = "--     select 1\n--       from pg_policies p;";

describe("extraire", () => {
  it("rend le SQL du bloc, sans les préfixes de commentaire et sans la prose autour", () => {
    const r = extraire(bloc(REQUETE));
    expect(r.raison).toBeUndefined();
    expect(r.sql).toBe("select 1\n      from pg_policies p;");
  });

  it("conserve l'indentation interne, qui est ce qui rend la requête lisible dans le journal", () => {
    expect(extraire(bloc(REQUETE)).sql).toContain("\n      from");
  });

  // ⚠️ LE CAS QUI MOTIVE « EXACTEMENT UNE ». Deux blocs, et l'extraction rendrait le premier en
  // passant l'autre sous silence : un hôte lirait le second, la forge mesurerait le premier. C'est
  // le même défaut que la requête corrigée elle-même — un instrument qui regarde moins large que
  // l'objet qu'il vérifie.
  it("refuse deux marques ouvrantes plutôt que de rendre la première", () => {
    const r = extraire(bloc(REQUETE) + bloc(REQUETE));
    expect(r.sql).toBeUndefined();
    expect(r.raison).toMatch(/EXACTEMENT une/);
  });

  it.each([
    ["aucune marque", "-- rien ici\n"],
    ["ouvrante seule", `-- ${OUVRANTE}\n${REQUETE}\n`],
    ["fermante seule", `${REQUETE}\n-- ${FERMANTE}\n`],
  ])("refuse quand il manque une marque : %s", (_nom, texte) => {
    expect(extraire(texte).sql).toBeUndefined();
  });

  it("refuse des marques croisées, où la fermante précède l'ouvrante", () => {
    const r = extraire(`-- ${FERMANTE}\n${REQUETE}\n-- ${OUVRANTE}\n`);
    expect(r.raison).toMatch(/croisé/);
  });

  it.each([
    ["bloc vide", "--"],
    ["prose sans select", "-- ceci explique la requête mais n'en est pas une ;"],
    ["requête tronquée, sans point-virgule final", "--     select 1 from pg_policies"],
  ])("refuse un bloc qui n'est pas une requête entière : %s", (_nom, corps) => {
    const r = extraire(bloc(corps));
    expect(r.sql).toBeUndefined();
    expect(r.raison).toBeTruthy();
  });
});

describe("verifier", () => {
  it("rend CONFORME et le SQL à côté du verdict, jamais dedans", () => {
    const r = verifier(() => bloc(REQUETE), "faux.sql");
    expect(r.code).toBe(CONFORME);
    expect(r.sql).toBe("select 1\n      from pg_policies p;");
    expect(r.resume).not.toContain("select 1");
  });

  it("rend INCONCLUSIF — et non VIOLATION — quand le bloc est introuvable", () => {
    expect(verifier(() => "-- rien\n", "faux.sql").code).toBe(INCONCLUSIF);
  });

  it("rend INCONCLUSIF quand le fichier est illisible, au lieu de lever", () => {
    const r = verifier(() => { throw new Error("ENOENT"); }, "absent.sql");
    expect(r.code).toBe(INCONCLUSIF);
  });
});

describe("principal", () => {
  it("écrit le SQL sur la sortie standard et le verdict ailleurs", () => {
    const sortie = [];
    const erreur = [];
    const code = principal({
      verifie: () => verifier(() => bloc(REQUETE), "faux.sql"),
      ecrire: (s) => sortie.push(s),
      alerter: (s) => erreur.push(s),
    });
    expect(code).toBe(CONFORME);
    expect(sortie.join("")).toBe("select 1\n      from pg_policies p;\n");
    expect(erreur.join("\n")).not.toContain("select 1");
  });

  // ⚠️ N'ÉCRIRE RIEN est la moitié qui compte : si un SQL partiel sortait malgré le refus, la CI le
  // donnerait à psql et le rouge parlerait de syntaxe au lieu de parler de la marque manquante.
  it("n'écrit RIEN sur la sortie standard quand il refuse", () => {
    const sortie = [];
    const code = principal({
      verifie: () => verifier(() => "-- rien\n", "faux.sql"),
      ecrire: (s) => sortie.push(s),
      alerter: () => {},
    });
    expect(code).toBe(INCONCLUSIF);
    expect(sortie).toEqual([]);
  });
});

// ⚠️ ET LE FICHIER RÉEL, PARCE QUE TOUT CE QUI PRÉCÈDE EST DU TEXTE FABRIQUÉ. Les marques peuvent
// exister et encadrer autre chose — un déplacement malheureux, un copier-coller. Ce dernier cas
// épingle ce que le bloc réel DOIT contenir : le dépliage de chaque rôle et la mesure de l'état
// résultant, c'est-à-dire précisément les deux traits qui manquaient à v1 et à v2.
describe("le bloc réel de supabase/init.sql", () => {
  const reel = verifier(() => readFileSync(SOURCE, "utf8"), SOURCE);

  it("s'extrait", () => {
    expect(reel.code).toBe(CONFORME);
  });

  it("déplie chaque rôle nommé — le trait qui manquait à la deuxième écriture", () => {
    expect(reel.sql).toContain("unnest(p.roles)");
  });

  it("mesure l'état résultant plutôt que la présence du revoke", () => {
    expect(reel.sql).toContain("has_table_privilege");
  });

  it("couvre les DEUX rôles du geste — le trait qui manquait à la première écriture", () => {
    expect(reel.sql).toContain("'anon'");
    expect(reel.sql).toContain("'authenticated'");
  });
});
