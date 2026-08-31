// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUE L'IMAGE EMBARQUE CONTRE CE QU'`engines` AUTORISE — LA SECONDE MOITIÉ DE LA PAIRE.
//
// ⚠️ CETTE GARDE EST VERTE AUJOURD'HUI, comme sa jumelle des workflows, et pour la même raison :
// 24 satisfait `>=22.13.0`. Un banc qui se contenterait de constater ce vert prouverait que la CI
// passe, jamais que la garde voit. On l'éprouve donc sur le jour où le plancher dépassera 24.
//
// ⚠️ ET SUR LES DEUX SENS, parce qu'un seul ne prouve que la moitié : `engines` relevé au-dessus de
// l'image, ET une vraie ligne `FROM` du dépôt dépouillée de son étiquette. Le second met le LECTEUR
// dans le chemin du rouge ; sans lui, tout ce qui rougit ici est parti d'objets fabriqués par nous.

import { readFileSync } from "node:fs";

import { describe, it, expect } from "vitest";

import {
  porteeDeLEtiquette,
  imagesNodeDe,
  imagesNodeDuDepot,
  verdict,
  PLANCHER_IMAGES,
} from "../node-de-l-image.mjs";
import { CONFORME, VIOLATION, INCONCLUSIF } from "../resultat-garde.mjs";

const ENGINES = JSON.parse(readFileSync("package.json", "utf8")).engines?.node;
const reel = imagesNodeDuDepot();

const img = (o) => ({ fichier: "Dockerfile", ligne: 1, reference: "node:24-alpine@sha256:abc", etiquetee: true, portee: "24", ...o });

describe("ce que l'étiquette annonce", () => {
  it("lit la version, variante comprise", () => {
    expect(porteeDeLEtiquette("node:24-alpine@sha256:abc")).toBe("24");
    expect(porteeDeLEtiquette("node:22.13.0-slim")).toBe("22.13.0");
    expect(porteeDeLEtiquette("node:24")).toBe("24");
  });

  // ⚠️ `node:alpine` et `node:lts` DÉCLARENT quelque chose que semver ne lit pas. Les rendre « 0 »
  // ou les sauter donnerait un vert pour n'avoir pas su lire.
  it("⚠️ rend null sur une étiquette sans version — jamais un chiffre inventé", () => {
    expect(porteeDeLEtiquette("node:alpine")).toBeNull();
    expect(porteeDeLEtiquette("node:lts")).toBeNull();
    expect(porteeDeLEtiquette("node@sha256:abc")).toBeNull();
  });
});

describe("ce que la sonde relève dans un Dockerfile", () => {
  it("voit l'image node et ignore ce qui n'en est pas", () => {
    const r = imagesNodeDe("FROM node:24-alpine@sha256:abc AS build\nFROM ghcr.io/zaproxy/zaproxy:2.17.0@sha256:def\n", "D");
    expect(r).toHaveLength(1);
    expect(r[0].portee).toBe("24");
  });

  // ⚠️ LA FORME QUI AVAIT AVEUGLÉ LE LECTEUR MAISON DE CE DÉPÔT. Elle est ici parce que cette garde
  // IMPORTE ce lecteur : si quelqu'un le remplaçait un jour par une lecture à la ligne, ce banc le
  // dirait depuis ce fichier-ci aussi.
  it("⚠️ tient `FROM --platform=…`, la syntaxe qui avait rendu « 0 référence »", () => {
    const r = imagesNodeDe("FROM --platform=$BUILDPLATFORM node:24-alpine@sha256:abc AS build\n", "D");
    expect(r).toHaveLength(1);
  });

  it("⚠️ une image node SANS étiquette est relevée, et marquée muette", () => {
    const r = imagesNodeDe("FROM node@sha256:abc\n", "D");
    expect(r).toHaveLength(1);
    expect(r[0].etiquetee, "rien ne déclare la version : c'est une dette, pas une lecture ratée").toBe(false);
  });

  it("ne compte pas une étape interne comme une image du registre", () => {
    const r = imagesNodeDe("FROM node:24-alpine@sha256:abc AS node\nFROM node\n", "D");
    expect(r, "la seconde ligne réutilise l'étape locale, elle ne tire rien du registre").toHaveLength(1);
  });
});

describe("le verdict", () => {
  it("accepte une image node 24 sous un plancher `>=22.13.0`", () => {
    expect(verdict({ engines: ">=22.13.0", images: [img()] }).code).toBe(CONFORME);
  });

  // ⚠️ LE CAS POUR LEQUEL CETTE GARDE EXISTE. Les trois gardes qui touchent déjà ce fichier
  // resteraient vertes : l'image est épinglée, son étiquette dit vrai, et elle embarque un moteur
  // que notre propre paquet déclare non supporté.
  it("⚠️ refuse node 24 le jour où le plancher passe à `>=26`", () => {
    const r = verdict({ engines: ">=26", images: [img()] });
    expect(r.code).toBe(VIOLATION);
    expect(r.constats[0]).toMatch(/c'est ce qu'un auto-hébergeur EXÉCUTE/);
  });

  // ⚠️ LA RELATION, ET C'EST LA FORME DE L'ÉTAPE `setup-node` MUETTE, TRANSPOSÉE.
  it("⚠️ refuse une image qui fournit node sans étiquette de version", () => {
    const r = verdict({ engines: ENGINES, images: [img({ etiquetee: false, portee: null, reference: "node@sha256:abc" })] });
    expect(r.code).toBe(VIOLATION);
    expect(r.constats[0]).toMatch(/sans étiquette de version/);
  });

  // ⚠️ DEUX ABSENCES DIFFÉRENTES : rien de déclaré = VIOLATION (ci-dessus) ; déclaré mais illisible
  // = NON CONCLUANT. Les confondre accuserait l'auteur d'une lecture que la garde ne sait pas faire.
  it("⚠️ une étiquette que semver ne lit pas est NON CONCLUANTE, pas une violation", () => {
    const r = verdict({ engines: ENGINES, images: [img({ reference: "node:alpine@sha256:abc", portee: null })] });
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/ne porte pas de version que semver sache lire/);
  });

  it("refuse un relevé vide — la règle serait vraie pour n'avoir rien lu", () => {
    const r = verdict({ engines: ENGINES, images: [] });
    expect(r.code).toBe(INCONCLUSIF);
    expect(r.raisons[0]).toMatch(/plancher/);
  });

  it("refuse de conclure sous un `engines` borné en haut", () => {
    expect(verdict({ engines: ">=22.13.0 <25", images: [img()] }).code).toBe(INCONCLUSIF);
  });

  it("refuse un `engines` absent ou illisible", () => {
    expect(verdict({ engines: undefined, images: [img()] }).code).toBe(INCONCLUSIF);
    expect(verdict({ engines: "récent", images: [img()] }).code).toBe(INCONCLUSIF);
  });
});

// ⚠️ LE VRAI DÉPÔT. Sans ce bloc, tout ce qui précède prouve que la fonction sait comparer.
describe("les Dockerfiles du dépôt tels qu'ils sont", () => {
  it("la sonde voit au moins une image node, et toutes sont étiquetées", () => {
    expect(reel.length).toBeGreaterThanOrEqual(PLANCHER_IMAGES);
    expect(reel.filter((i) => !i.etiquetee), "une image fournit node sans dire laquelle").toEqual([]);
  });

  it("ce que l'image embarque est admis par engines", () => {
    const r = verdict({ engines: ENGINES, images: reel });
    expect(r.constats || r.raisons || [], r.resume).toEqual([]);
    expect(r.code).toBe(CONFORME);
  });

  it("⚠️ et elle rougirait le jour où `engines` passerait à `>=26`", () => {
    const r = verdict({ engines: ">=26", images: reel });
    expect(r.code).toBe(VIOLATION);
    expect(r.constats.length, "toutes les images node doivent être nommées").toBe(reel.length);
  });

  // ⚠️ LE SECOND SENS, SUR LE TEXTE RÉEL. Il met le LECTEUR dans le chemin du rouge — sans lui,
  // tout ce qui rougit plus haut est parti d'objets que nous avons fabriqués nous-mêmes.
  // ⚠️ TOUTES LES IMAGES, PAS LA PREMIÈRE — ET C'EST UNE CORRECTION DE MÉTHODE, PAS DE ZÈLE.
  //
  // Ce banc visait `reel[0]`, c'est-à-dire l'ORDRE DE TRI du dossier. Mesuré : la propriété tient
  // pour les deux images, donc le vert n'était pas un accident. Mais « nous l'avons mesuré
  // aujourd'hui » et « cela ne peut pas dépendre du tri » ne sont pas la même affirmation : la
  // première a une date, la seconde n'en a pas. Un banc qui choisit sa cible dans une liste triée
  // prouve ce qu'il prouve pour ce classement-là, et personne ne relit un banc quand il ajoute un
  // fichier. C'est le défaut trouvé le 31/08 dans le banc voisin ; ici on le retire par
  // construction plutôt que de le constater absent.
  it("⚠️ CHAQUE vraie ligne FROM dépouillée de son étiquette est refusée — texte réel, lecteur réel", () => {
    expect(reel.length, "aucune image à dépouiller : ce banc vise à côté").toBeGreaterThan(0);

    for (const cible of reel) {
      const ou = `${cible.fichier}:${cible.ligne}`;
      const texte = readFileSync(cible.fichier, "utf8");
      const nu = cible.reference.split(":")[0] + "@" + cible.reference.split("@")[1];
      const mute = texte.replace(cible.reference, nu);
      expect(mute, `${ou} : la mutation n'a rien changé — elle ne prouverait rien`).not.toBe(texte);

      const lu = imagesNodeDe(mute, cible.fichier);
      expect(lu.some((i) => !i.etiquetee), `${ou} : le lecteur n'a pas vu l'image dépouillée`).toBe(true);
      expect(verdict({ engines: ENGINES, images: lu }).code, ou).toBe(VIOLATION);
    }
  });
});
