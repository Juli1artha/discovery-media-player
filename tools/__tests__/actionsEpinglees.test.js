// LA GARDE D'ÉPINGLAGE DES ACTIONS, ÉPROUVÉE SUR CE QU'ELLE RATAIT.
//
// ⚠️ Elle existait depuis longtemps, en `grep`, et elle était aveugle DANS LES DEUX SENS. Elle
// voyait des commentaires (documenter la règle rendait la CI rouge — c'est ainsi qu'on l'a
// trouvée), et surtout elle ne voyait pas des actions : `uses: "actions/checkout@v4"` entre
// guillemets passait sans un mot. C'est la garde la plus sensible du dépôt — une action s'exécute
// avec les droits d'une forge qui PUBLIE sur npm.
//
// Même défaut que le lexer de `tools/env-lues.mjs`, corrigé pour la même raison : on ne lit pas un
// format structuré avec une expression régulière.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { ecartEpinglage, ecarts } from "../actions-epinglees.mjs";
import { usesDuDepot } from "../workflows-yaml.mjs";

const SHA = "3d3c42e5aac5ba805825da76410c181273ba90b1";

// ⚠️ LA LECTURE N'EST PLUS ÉPROUVÉE ICI, PARCE QU'ELLE N'EST PLUS FAITE ICI.
//
// Ce banc contenait les formes que le `grep` d'origine ratait, puis celles que le lexer qui l'a
// remplacé ratait à son tour (clé citée, mapping en flow, `|2-`). Deux lecteurs maison, deux
// cécités. La lecture vit maintenant dans `tools/workflows-yaml.mjs`, sur un analyseur YAML 1.2,
// et c'est son banc qui porte ces cas — tous, y compris ceux que ce fichier ne savait pas voir.
//
// Ce qui reste ici est la DÉCISION : qu'est-ce qui doit être épinglé, et qu'est-ce qui n'a pas
// à l'être.

describe("ce qui doit être épinglé, et ce qui n'a pas à l'être", () => {
  it("un SHA de 40 caractères passe", () => {
    expect(ecartEpinglage(`actions/checkout@${SHA}`)).toBeNull();
  });

  it("une étiquette ne passe pas, quelle qu'elle soit", () => {
    for (const ref of ["v4", "main", "v4.1.1", "latest"]) {
      expect(ecartEpinglage(`o/r@${ref}`), ref).toMatch(/pas sur un commit/);
    }
  });

  it("⚠️ une référence SANS `@` est le pire cas — elle suit la branche par défaut", () => {
    expect(ecartEpinglage("actions/checkout")).toMatch(/branche par défaut/);
  });

  it("une action LOCALE n'a rien à épingler — l'exiger serait impossible à satisfaire", () => {
    expect(ecartEpinglage("./.github/actions/maison")).toBeNull();
    expect(ecartEpinglage("../ailleurs")).toBeNull();
  });

  it("un workflow réutilisable suit la même règle", () => {
    expect(ecartEpinglage("o/r/.github/workflows/x.yml@v1")).toMatch(/pas sur un commit/);
    expect(ecartEpinglage(`o/r/.github/workflows/x.yml@${SHA}`)).toBeNull();
  });

  it("une image docker s'épingle par condensat, pour la raison du Dockerfile", () => {
    expect(ecartEpinglage("docker://alpine:3.20")).toMatch(/condensat/);
    expect(ecartEpinglage("docker://alpine@sha256:" + "b".repeat(64))).toBeNull();
  });

  it("un SHA tronqué n'est pas un SHA", () => {
    expect(ecartEpinglage("o/r@3d3c42e5")).toMatch(/pas sur un commit/);
  });
});

describe("les workflows réellement présents", () => {
  const toutes = usesDuDepot();

  it("il y en a, et la sonde ne vise pas à côté", () => {
    expect(toutes.length).toBeGreaterThan(0);
  });

  it("toutes leurs actions sont épinglées sur un commit", () => {
    expect(ecarts(toutes)).toEqual([]);
  });

  it("⚠️ et on en voit au moins autant qu'avant — changer de lecteur ne doit rien perdre", () => {
    // Le grep comptait 28 références épinglées ; le lexer 28 ; l'analyseur YAML 29 (il voit une
    // forme que les deux précédents ne voyaient pas). Le seuil est un plancher délibéré.
    expect(toutes.length).toBeGreaterThanOrEqual(28);
  });
});
