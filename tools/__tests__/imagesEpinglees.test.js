// L'ÉPINGLAGE DE L'IMAGE DE BASE, ÉPROUVÉ SUR LE VRAI DOCKERFILE ET SUR CE QUI POURRAIT LE CASSER.
//
// ⚠️ Ce dépôt refuse `uses: action@v3` depuis longtemps : une étiquette mobile est un contrat que
// quelqu'un d'autre peut réécrire après coup. `FROM node:24-alpine` était exactement la même
// chose, sans garde (P1, audit externe, 21/08). Les cas ci-dessous décrivent la règle ; le
// dernier de chaque groupe la fait porter sur le fichier qu'on publie vraiment.

import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { froms, imagesDe, ecartsEpinglage, majeurAnnonce, majeurAttendu, ecartMajeur, sourceDuMontage } from "../images-epinglees.mjs";

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

describe("⚠️ LA TROISIÈME PORTE : RUN --mount=from=", () => {
  // Cette garde lisait `FROM`, puis `COPY --from` après #288. L'audit du 22/08 a montré qu'une
  // image pouvait encore entrer par un montage de construction, sans un mot :
  //
  //     RUN --mount=type=bind,from=nginx:latest,source=/etc,target=/src true
  //
  // Une image montée pendant un `RUN` fournit des octets qui finissent dans l'artefact. La leçon
  // écrite en #288 tenait déjà — « une dépendance qui entre par une autre porte reste une
  // dépendance » — elle nommait `COPY --from`, et celle-ci existait déjà.

  it("⚠️ voit une image du registre montée par RUN, et la refuse", () => {
    const txt = `FROM node:24-alpine@${CONDENSAT} AS build\nRUN --mount=type=bind,from=nginx:latest,source=/etc,target=/src true\n`;
    expect(ecartsEpinglage(txt).join(" ")).toMatch(/RUN --mount=from nginx:latest.*n'est pas épinglé/);
  });

  it("accepte la même image quand elle porte un condensat", () => {
    const txt = `FROM node:24-alpine@${CONDENSAT} AS build\nRUN --mount=type=bind,from=nginx:1@${CONDENSAT},target=/s true\n`;
    expect(ecartsEpinglage(txt)).toEqual([]);
  });

  it("ne reproche rien à un montage qui désigne une étape, ni un index", () => {
    const txt = `FROM node:24-alpine@${CONDENSAT} AS build\nRUN --mount=from=build,target=/b true\nRUN --mount=type=bind,from=0,target=/z true\n`;
    expect(ecartsEpinglage(txt)).toEqual([]);
  });

  it("ignore les montages qui ne font entrer aucune image", () => {
    // cache, secret, tmpfs : pas de `from=`, donc rien à reprocher — et surtout pas un faux
    // positif sur `type=cache`, que le vrai Dockerfile pourrait adopter demain.
    const txt = `FROM node:24-alpine@${CONDENSAT} AS build\nRUN --mount=type=cache,target=/root/.npm --mount=type=secret,id=x npm ci\n`;
    expect(ecartsEpinglage(txt)).toEqual([]);
    expect(imagesDe(txt).filter((i) => i.source === "RUN --mount=from")).toEqual([]);
  });

  it("relève chaque montage d'un RUN qui en porte plusieurs", () => {
    const txt = `FROM node:24-alpine@${CONDENSAT} AS build\nRUN --mount=from=alpine:3,target=/a --mount=from=busybox:1,target=/b true\n`;
    expect(ecartsEpinglage(txt)).toHaveLength(2);
  });

  describe("la lecture du drapeau", () => {
    it("trouve from où qu'il soit dans la liste", () => {
      expect(sourceDuMontage("type=bind,from=x:1,source=/e")).toBe("x:1");
      expect(sourceDuMontage("from=x:1")).toBe("x:1");
      expect(sourceDuMontage("target=/a,from=x:1")).toBe("x:1");
    });

    it("rend null quand il n'y a pas de from", () => {
      expect(sourceDuMontage("type=cache,target=/root/.npm")).toBeNull();
      expect(sourceDuMontage("")).toBeNull();
      expect(sourceDuMontage(undefined)).toBeNull();
    });

    it("⚠️ ne confond pas une clé qui CONTIENT « from »", () => {
      // `fromage=x` n'est pas `from=x`. Une comparaison par inclusion aurait fabriqué une
      // référence à partir d'un drapeau qui n'en désigne aucune.
      expect(sourceDuMontage("fromage=x,target=/a")).toBeNull();
    });

    it("ne coupe qu'au premier signe égal", () => {
      expect(sourceDuMontage("from=reg.example/o/i:1@sha256:abc")).toBe("reg.example/o/i:1@sha256:abc");
    });
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

describe("⚠️ LE REFUS DIT OÙ, PAS SEULEMENT QUOI", () => {
  // Relevé du 24/08, en faisant rougir les onze gardes une par une pour LIRE ce qu'elles rendent :
  // quatre nommaient `fichier:ligne`, trois connaissaient la position et la jetaient. Celle-ci en
  // faisait partie — et un Dockerfile multi-étages porte plusieurs portes, donc « le fichier » ne
  // suffit pas à envoyer quelqu'un au bon endroit.
  const CONDENSAT_OK = "sha256:" + "a".repeat(64);
  const TROIS_PORTES = [
    `FROM node:24@${CONDENSAT_OK} AS base`,
    "RUN true",
    "FROM python:3.12",
    "COPY --from=golang:1.22 /go /go",
    "RUN --mount=type=bind,from=busybox:1.36,target=/s true",
    "",
  ].join("\n");

  it("chaque porte est nommée avec SA ligne", () => {
    const soucis = ecartsEpinglage(TROIS_PORTES, "Dockerfile");
    expect(soucis).toHaveLength(3);
    expect(soucis[0]).toMatch(/^Dockerfile:3 .*FROM python:3\.12/);
    expect(soucis[1]).toMatch(/^Dockerfile:4 .*COPY --from golang:1\.22/);
    expect(soucis[2]).toMatch(/^Dockerfile:5 .*RUN --mount=from busybox:1\.36/);
  });

  it("⚠️ et les lignes sont DISTINCTES — un décalage constant se lirait comme une position juste", () => {
    // La contrepartie qui compte : `ligne: 1` partout satisferait « il y a une ligne » et
    // n'aiderait personne. C'est aussi pourquoi `ligneDe` ajoute 1 — `dockerfile-ast` compte à
    // partir de zéro, et une position décalée d'une ligne est pire qu'une position absente.
    const lignes = ecartsEpinglage(TROIS_PORTES, "Dockerfile").map((s) => Number(/:(\d+) /.exec(s)[1]));
    expect(new Set(lignes).size).toBe(3);
    expect(lignes).toEqual([3, 4, 5]);
  });
});
