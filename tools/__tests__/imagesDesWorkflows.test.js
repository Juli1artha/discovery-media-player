// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES IMAGES QUE LA FORGE TIRE S'ÉPINGLENT COMME CELLES DU DOCKERFILE.
//
// ⚠️ La règle existait et ne regardait que le `Dockerfile`. Pendant ce temps la CI lançait
// `postgres:16-alpine` et `postgrest/postgrest:v12.2.3` sur des étiquettes MOBILES — et ces deux
// images font tourner les bancs de base. Un vert obtenu contre une image inconnue ne se transporte
// pas : personne ne sait plus contre quoi la preuve a été produite.
//
// ⚠️ Ce banc éprouve aussi la LIMITE de la sonde, parce qu'elle est le fruit d'un échec : un
// premier essai lisait les blocs `run:` au motif et a accusé `host` (de `--network host`) et deux
// images construites sur place. La sonde ne lit donc que du YAML, et la convention « une image se
// déclare » est ce qui rend ce choix tenable.

import { describe, it, expect } from "vitest";

import { imagesDeclarees, nonEpinglees, utilisesNonDeclares, lireDossier, differee } from "../images-des-workflows.mjs";

const CONDENSAT = "@sha256:" + "a".repeat(64);
const wf = (corps) => `name: T\non: push\njobs:\n${corps}`;

describe("relever ce qui est déclaré", () => {
  it("lit un service, et le nomme par son chemin", () => {
    const t = wf("  j:\n    services:\n      pg:\n        image: postgres:16-alpine\n");
    expect(imagesDeclarees("ci.yml", t)).toEqual([{ ou: "ci.yml › j.services.pg", reference: "postgres:16-alpine" }]);
  });

  it("lit un `container:`, sous ses deux formes", () => {
    expect(imagesDeclarees("t.yml", wf("  j:\n    container: node:24\n"))[0].reference).toBe("node:24");
    expect(imagesDeclarees("t.yml", wf("  j:\n    container:\n      image: node:24\n"))[0].reference).toBe("node:24");
  });

  it("⚠️ lit une variable `env:` NOMMÉE `IMAGE_…` — c'est le préfixe qui la rend trouvable", () => {
    const t = wf("  j:\n    steps:\n      - name: lancer\n        env:\n          IMAGE_X: r/x:1\n        run: docker run \"$IMAGE_X\"\n");
    expect(imagesDeclarees("t.yml", t)).toEqual([{ ou: "t.yml › j › lancer.env.IMAGE_X", reference: "r/x:1" }]);
  });

  it("ignore une variable `env:` qui n'annonce pas une image", () => {
    const t = wf("  j:\n    steps:\n      - env:\n          JWT: secret-de-banc\n        run: echo ok\n");
    expect(imagesDeclarees("t.yml", t)).toEqual([]);
  });

  it("⚠️ ne cherche RIEN dans le corps d'un `run:` — c'est du shell, et le motif y accusait du code juste", () => {
    // `--network host` : le premier essai en tirait une « image » nommée `host`.
    const t = wf("  j:\n    steps:\n      - run: docker run -d --network host player:ci\n");
    expect(imagesDeclarees("t.yml", t)).toEqual([]);
  });

  it("n'invente rien sur un job sans conteneur ni service", () => {
    expect(imagesDeclarees("image.yml", wf("  image:\n    runs-on: ubuntu-latest\n"))).toEqual([]);
  });
});

describe("le verdict", () => {
  const img = (reference) => [{ ou: "t.yml › j.services.pg", reference }];

  it("⚠️ refuse une étiquette nue, et dit pourquoi elle ne suffit pas", () => {
    const [souci] = nonEpinglees(img("postgres:16-alpine"));
    expect(souci).toContain("postgres:16-alpine");
    expect(souci).toContain("une étiquette se redéplace, un condensat non");
  });

  it("⚠️ refuse une étiquette de VERSION : `v12.2.3` est une convention d'éditeur, pas le contenu", () => {
    expect(nonEpinglees(img("postgrest/postgrest:v12.2.3"))).toHaveLength(1);
  });

  it("accepte l'étiquette gardée à côté du condensat — l'humain lit l'une, Docker fait foi de l'autre", () => {
    expect(nonEpinglees(img(`postgres:16-alpine${CONDENSAT}`))).toEqual([]);
  });

  it("⚠️ refuse un condensat qui n'est pas en fin de référence — sinon un suffixe le contourne", () => {
    expect(nonEpinglees(img(`postgres${CONDENSAT}:16-alpine`))).toHaveLength(1);
  });

  it("⚠️ SAUTE une expression `${{ … }}` au lieu de l'accuser : c'est l'appelant qui la décide", () => {
    expect(differee("${{ inputs.image }}")).toBe(true);
    expect(nonEpinglees(img("${{ inputs.image }}"))).toEqual([]);
  });
});

describe("la convention se tient elle-même", () => {
  it("⚠️ refuse un `$IMAGE_…` employé sans être déclaré — sinon la sonde n'aurait rien à lire", () => {
    const t = wf('  j:\n    steps:\n      - run: docker run "$IMAGE_ZAP"\n');
    const [souci] = utilisesNonDeclares("zap.yml", t, imagesDeclarees("zap.yml", t));
    expect(souci).toContain("$IMAGE_ZAP");
    expect(souci).toContain("aucun `env:` ne le déclare");
  });

  it("se tait quand la commande emploie ce que le YAML déclare", () => {
    const t = wf('  j:\n    steps:\n      - env:\n          IMAGE_ZAP: z/z:1\n        run: docker run "$IMAGE_ZAP"\n');
    expect(utilisesNonDeclares("zap.yml", t, imagesDeclarees("zap.yml", t))).toEqual([]);
  });
});

describe("les workflows réels", () => {
  const parFichier = lireDossier();
  const toutes = parFichier.flatMap(({ images }) => images);

  it("la sonde lit un dossier peuplé", () => {
    // Sans ce plancher, un dossier renommé rendrait la garde verte en n'analysant rien.
    expect(parFichier.length).toBeGreaterThan(5);
    expect(toutes.length).toBeGreaterThanOrEqual(2);
  });

  it("⚠️ toutes les images déclarées portent un condensat", () => {
    const soucis = nonEpinglees(toutes);
    expect(soucis, `image(s) non épinglée(s) :\n${soucis.join("\n")}`).toEqual([]);
  });

  it("⚠️ et tout `$IMAGE_…` employé est déclaré", () => {
    const soucis = parFichier.flatMap(({ fichier, texte, images }) => utilisesNonDeclares(fichier, texte, images));
    expect(soucis, soucis.join("\n")).toEqual([]);
  });
});
