// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'ATTESTATION DE PURGE EST UN ENGAGEMENT, ÉPROUVÉ.
//
// ⚠️ POURQUOI CE N'EST PLUS UNE COMMODITÉ. Le commentaire de colonne posé par la 0026 et la 0027
// avait été conçu pour être lu par une personne voulant prouver une purge. Un hôte nous a signalé
// qu'il est lu par une MACHINE : son inventaire le croise avec les comptes résiduels et en tire une
// alarme. Cesser de le poser ne casserait rien chez nous — ça rendrait cette alarme muette, sans
// rien lui dire. C'est le moment où un artefact devient un engagement, et un engagement qui ne vit
// que dans une phrase est un fait figé de plus. Ceci est ce qui rougit si quelqu'un le défait.

import { describe, it, expect } from "vitest";
import { colonnesVidees, colonnesAttestees, manquements, fichiersSql, MARQUEUR }
  from "../attestation-de-purge.mjs";

describe("ce qu'une purge fait, et ce qu'elle laisse", () => {
  it("relève les colonnes qu'un texte VIDE", () => {
    expect(colonnesVidees("update public.t set ip = null where ip is not null;"))
      .toEqual(["public.t.ip"]);
  });

  it("n'appelle pas purge une écriture qui pose une VALEUR", () => {
    expect(colonnesVidees("update public.t set ip = '1.2.3.4';")).toEqual([]);
  });

  it("relève l'attestation quand le commentaire COMMENCE par le marqueur", () => {
    expect(colonnesAttestees(`comment on column public.t.ip is '${MARQUEUR}0026. Détail.';`))
      .toEqual(["public.t.ip"]);
  });

  // ⚠️ LE MARQUEUR EST EN TÊTE, PAS QUELQUE PART. Un lecteur machine cherche un préfixe stable ;
  // le trouver au milieu d'une phrase ne lui rendrait pas le même service, et accepter les deux
  // ferait de la position un détail — donc quelque chose qu'un jour on déplace sans le savoir.
  it("⚠️ un marqueur enfoui dans la phrase n'est pas une attestation", () => {
    expect(colonnesAttestees(`comment on column public.t.ip is 'Cette colonne est ${MARQUEUR}0026.';`))
      .toEqual([]);
  });

  it("un commentaire quelconque n'atteste rien", () => {
    expect(colonnesAttestees("comment on column public.t.ip is 'colonne héritée';")).toEqual([]);
  });
});

describe("⚠️ la règle : ce qui est vidé est attesté", () => {
  const lire = (f) => ({
    "bon.sql": `update public.t set ip = null;\ncomment on column public.t.ip is '${MARQUEUR}0026.';`,
    "muet.sql": "update public.t set ip = null;",
    "reformule.sql": "update public.t set ip = null;\ncomment on column public.t.ip is 'colonne vidée';",
  }[f]);

  it("une purge accompagnée de son attestation passe", () => {
    expect(manquements(["bon.sql"], lire).soucis).toEqual([]);
  });

  it("⚠️ une purge SANS attestation est refusée, en nommant la colonne", () => {
    const { soucis } = manquements(["muet.sql"], lire);
    expect(soucis).toHaveLength(1);
    expect(soucis[0]).toContain("public.t.ip");
    expect(soucis[0], "le message doit dire ce qu'un hôte y perd").toContain("muette");
  });

  it("⚠️ et une attestation REFORMULÉE est refusée comme une absente", () => {
    expect(manquements(["reformule.sql"], lire).soucis).toHaveLength(1);
  });

  it("compte ce qu'elle a lu — un zéro ne serait pas une absence de purge", () => {
    expect(manquements(["bon.sql"], lire)).toMatchObject({ videes: 1, attestees: 1 });
  });
});

// ⚠️ ET SUR LE DÉPÔT RÉEL, pas seulement sur des fixtures : c'est là que l'engagement se tient.
describe("⚠️ le dépôt réel tient son engagement", () => {
  it("toutes les colonnes vidées y sont attestées", () => {
    const { soucis, videes } = manquements(fichiersSql());
    expect(videes, "aucune purge reconnue : la sonde vise à côté").toBeGreaterThan(0);
    expect(soucis).toEqual([]);
  });

  it("⚠️ et le marqueur n'a pas bougé — des hôtes s'y accrochent", () => {
    expect(MARQUEUR, "reformuler ce préfixe rend muettes les alarmes qui le cherchent")
      .toBe("VIDE ET PLUS JAMAIS ECRITE depuis la ");
    // ⚠️ ASCII PUR, ET C'EST LA PROPRIÉTÉ QUI COMPTE — pas la casse, que ma première écriture de ce
    // cas affirmait à tort. Sans accent, il traverse les encodages ; sans apostrophe, il n'a pas à
    // être échappé dans un littéral SQL, donc sa forme ne change pas selon l'endroit où il est posé.
    expect(MARQUEUR, "sans accent ni apostrophe : il traverse les encodages et les littéraux SQL")
      .toMatch(/^[A-Za-z ]+$/);
  });
});
