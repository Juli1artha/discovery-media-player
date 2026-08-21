// L'ÉPINGLAGE DE L'IMAGE DE BASE, ÉPROUVÉ SUR LE VRAI DOCKERFILE ET SUR CE QUI POURRAIT LE CASSER.
//
// ⚠️ Ce dépôt refuse `uses: action@v3` depuis longtemps : une étiquette mobile est un contrat que
// quelqu'un d'autre peut réécrire après coup. `FROM node:24-alpine` était exactement la même
// chose, sans garde (P1, audit externe, 21/08). Les cas ci-dessous décrivent la règle ; le
// dernier de chaque groupe la fait porter sur le fichier qu'on publie vraiment.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { froms, imagesDe, ecartsEpinglage, majeurAnnonce, majeurAttendu, ecartMajeur } from "../images-epinglees.mjs";

const REEL = readFileSync("Dockerfile", "utf8");
const CONDENSAT = "sha256:" + "a".repeat(64);

describe("⚠️ LA SYNTAXE OFFICIELLE QUE LA VERSION LIGNE-À-LIGNE NE VOYAIT PAS", () => {
  // Le motif exigeait `FROM <image> [AS <nom>]` et rien d'autre. Sur un Dockerfile dont TOUS les
  // `FROM` portaient `--platform`, la garde rendait « 0 référence(s), toutes épinglées » et
  // sortait 0 — une garde qui déclare la victoire sur zéro (revue externe, 21/08).
  it("voit un FROM avec --platform", () => {
    const txt = "FROM --platform=$BUILDPLATFORM node:24-alpine AS build\n";
    expect(imagesDe(txt).map((i) => i.reference)).toEqual(["node:24-alpine"]);
    expect(ecartsEpinglage(txt)).toHaveLength(1);
  });

  it("⚠️ voit une image qui entre par COPY --from", () => {
    // Une dépendance qui entre par une autre porte reste une dépendance.
    const txt = `FROM node:24-alpine@${CONDENSAT} AS build\nCOPY --from=nginx:latest /o /o\n`;
    expect(ecartsEpinglage(txt).join(" ")).toMatch(/COPY --from nginx:latest.*n'est pas épinglé/);
  });

  it("ne reproche rien à un COPY --from qui désigne une étape, ni un index", () => {
    const txt = `FROM node:24-alpine@${CONDENSAT} AS build\nCOPY --from=build /a /a\nCOPY --from=0 /b /b\n`;
    expect(ecartsEpinglage(txt)).toEqual([]);
  });

  it("survit aux continuations de ligne et aux commentaires", () => {
    const txt = `# un commentaire : FROM pas/une-image\nFROM \\\n  node:24-alpine@${CONDENSAT}\n`;
    expect(ecartsEpinglage(txt)).toEqual([]);
    expect(imagesDe(txt)).toHaveLength(1);
  });
});

describe("le relevé des FROM", () => {
  it("distingue une image du registre d'une étape interne", () => {
    const txt = `FROM node:24-alpine@${CONDENSAT} AS build\nRUN true\nFROM build AS final\n`;
    const t = froms(txt);
    expect(t).toHaveLength(2);
    expect(t[0].interne).toBe(false);
    expect(t[1].interne).toBe(true);
  });

  it("⚠️ n'exige rien d'une étape interne — une garde impossible à satisfaire finit désactivée", () => {
    const txt = `FROM node:24-alpine@${CONDENSAT} AS build\nFROM build\n`;
    expect(ecartsEpinglage(txt)).toEqual([]);
  });

  it("ne confond pas un alias avec une image de même nom déclarée après", () => {
    // `FROM build` avant qu'aucune étape ne s'appelle `build` désigne bien une image du registre.
    expect(froms("FROM build\n")[0].interne).toBe(false);
  });
});

describe("une référence sans condensat désigne une image différente chaque semaine", () => {
  it("refuse une étiquette nue", () => {
    expect(ecartsEpinglage("FROM node:24-alpine\n").join(" ")).toMatch(/n'est pas épinglé/);
  });

  it("refuse même `latest` — surtout `latest`", () => {
    expect(ecartsEpinglage("FROM node\n")).toHaveLength(1);
  });

  it("refuse un condensat tronqué", () => {
    expect(ecartsEpinglage("FROM node:24-alpine@sha256:d32cdf61\n")).toHaveLength(1);
  });

  it("accepte une référence épinglée", () => {
    expect(ecartsEpinglage(`FROM node:24-alpine@${CONDENSAT}\n`)).toEqual([]);
  });

  it("nomme le fichier, pas « un Dockerfile »", () => {
    expect(ecartsEpinglage("FROM node\n", "images/x/Dockerfile")[0]).toContain("images/x/Dockerfile");
  });

  it("le Dockerfile publié est épinglé", () => {
    expect(ecartsEpinglage(REEL)).toEqual([]);
  });
});

describe("l'étiquette et le condensat sont deux exemplaires du même fait", () => {
  // ⚠️ `node:24-alpine@sha256:…` dont le condensat pointe une image Node 26 est valide pour
  // Docker, se construit, passe tout — et raconte faux à chaque relecteur. Sans confrontation,
  // l'étiquette n'est qu'un commentaire posé sur une ligne de code.
  it("lit la majeure annoncée par l'étiquette", () => {
    expect(majeurAnnonce(`node:24-alpine@${CONDENSAT}`)).toBe(24);
    expect(majeurAnnonce("node:22")).toBe(22);
    expect(majeurAnnonce("node:24.3.0-alpine")).toBe(24);
  });

  it("ne fabrique pas de vérification quand l'étiquette ne nomme aucune majeure", () => {
    expect(majeurAnnonce("node:latest")).toBeNull();
    expect(ecartMajeur("FROM node:latest\n", "v24.0.0")).toBeNull();
  });

  it("retient la DERNIÈRE étape — c'est celle qui s'exécute", () => {
    expect(majeurAttendu(`FROM node:22-alpine@${CONDENSAT} AS build\nFROM node:24-alpine@${CONDENSAT}\n`)).toBe(24);
  });

  it("accepte quand l'image répond la majeure annoncée", () => {
    expect(ecartMajeur(REEL, "v24.7.0")).toBeNull();
  });

  it("refuse quand le condensat embarque une autre majeure que l'étiquette", () => {
    expect(ecartMajeur(REEL, "v26.0.0")).toMatch(/embarque Node 26.*annonce 24/);
  });

  it("refuse une réponse illisible plutôt que de la prendre pour un accord", () => {
    expect(ecartMajeur(REEL, "")).toMatch(/n'a pas rendu de version/);
  });

  it("le Dockerfile publié annonce la LTS active", () => {
    expect(majeurAttendu(REEL)).toBe(24);
  });
});
