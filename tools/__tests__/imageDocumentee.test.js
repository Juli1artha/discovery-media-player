// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE IMAGE CITÉE DANS LA DOCUMENTATION PORTE LE NOM QUE LA FORGE PUBLIE.
//
// ⚠️ `docs/RELEASING.md` listait `ghcr.io/…:<version>` dans sa liste de vérification d'après-sortie
// alors que la forge publie `:v0.1.138`. Un registre répond `404` pour « n'existe pas » et pour
// « tu as demandé le mauvais nom » avec les mêmes trois chiffres : le lecteur ne pouvait pas
// distinguer une doc fausse d'un pipeline qui a sauté l'image — et le second cas est exactement ce
// que cette liste existe pour attraper (0.1.67 → 0.1.69).

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import {
  referencesFautives, tagAcceptable, forgeExigeEncoreLeV, AU_PERIMETRE,
  OU_LE_TAG_EST_DECIDE, MOTIF_DU_WORKFLOW,
} from "../image-documentee.mjs";

const IMG = "ghcr.io/juli1artha/discovery-media-player";
const lu = (ligne) => referencesFautives("t.md", ligne);

describe("ce qui est refusé", () => {
  it("⚠️ LE DÉFAUT RÉEL : un gabarit sans le `v`", () => {
    // ⚠️ CE CAS A ÉTÉ RATÉ PAR LA PREMIÈRE VERSION DE LA GARDE. « < » n'était pas dans le jeu de
    // caractères du tag, donc `:<version>` se lisait « aucun tag » et passait — vert sur le défaut
    // exact qui l'avait fait naître. Un tag OCI réel ne contient jamais « < » ; la ligne qui a fui
    // n'était pas un tag réel, c'était un gabarit de documentation.
    const [souci] = lu(`docker manifest inspect ${IMG}:<version>`);
    expect(souci).toContain(":<version>");
    expect(souci, "le message doit donner la forme juste, pas seulement le refus").toContain(":v<version>");
  });

  it("une version concrète sans le `v`", () => {
    expect(lu(`docker pull ${IMG}:0.1.138`)).toHaveLength(1);
  });

  it("dit pourquoi le 404 est trompeur, pas seulement qu'il y en a un", () => {
    expect(lu(`${IMG}:0.1.138`)[0]).toContain("ne peut pas le distinguer d'une image réellement absente");
  });

  it("nomme le fichier et la ligne", () => {
    const soucis = referencesFautives("docs/RELEASING.md", `a\nb\n${IMG}:2.0\n`);
    expect(soucis[0].startsWith("docs/RELEASING.md:3")).toBe(true);
  });
});

describe("les formes légitimes, qui ne doivent JAMAIS être accusées", () => {
  // ⚠️ CE BLOC EST LE PLUS IMPORTANT DU FICHIER. Deux gardes écrites cette semaine ont accusé du
  // code juste — trois faux positifs sur trois, puis sept sur sept. Une garde qui accuse à tort
  // apprend à ses lecteurs que son rouge est du bruit.
  it.each([
    ["le tag que la forge publie", `${IMG}:v0.1.128`],
    ["son gabarit", `${IMG}:v<version>`],
    ["`latest`, qui existe et que la sortie promeut", `${IMG}:latest`],
    ["aucun tag — donc `latest` implicite", `docker run ${IMG}`],
    ["un tag construit par le shell", "docker push ghcr.io/$depot:v$publiee"],
  ])("%s", (_, ligne) => {
    expect(lu(ligne)).toEqual([]);
  });

  it("⚠️ une URL de l'API du registre n'est pas une image — elle est précédée de `://`", () => {
    expect(lu("curl https://ghcr.io/v2/juli1artha/discovery-media-player/manifests/0.1.138")).toEqual([]);
    expect(lu('curl "https://ghcr.io/token?scope=repository:juli1artha/discovery-media-player:pull"')).toEqual([]);
  });

  it("⚠️ et le CHANGELOG a le droit de CITER la faute qu'il rapporte", () => {
    // Un journal décrit ce qui était faux ; lui interdire de le nommer serait absurde. L'ellipse
    // n'appartient pas au jeu de caractères OCI, donc la citation s'écarte d'elle-même — sans
    // exception par nom de fichier, qu'il faudrait se rappeler.
    expect(lu("La doc disait `ghcr.io/…:<version>`, ce qui rendait 404.")).toEqual([]);
  });
});

describe("la règle n'est pas une seconde copie du fait", () => {
  it("⚠️ elle est CONFRONTÉE à `image.yml`, qui décide vraiment de la forme du tag", () => {
    expect(forgeExigeEncoreLeV(readFileSync(OU_LE_TAG_EST_DECIDE, "utf8")),
      `${OU_LE_TAG_EST_DECIDE} n'exige plus ${MOTIF_DU_WORKFLOW}`).toBe(true);
  });

  it("si le workflow cessait de l'exiger, la garde le dirait au lieu d'accuser en son nom", () => {
    expect(forgeExigeEncoreLeV("un workflow qui ne dit plus rien du tag")).toBe(false);
  });

  it("un tag acceptable : absent, `latest`, ou préfixé `v`", () => {
    expect([undefined, "latest", "v1.2.3"].every(tagAcceptable)).toBe(true);
    expect(["1.2.3", "<version>", "main"].some(tagAcceptable)).toBe(false);
  });
});

describe("les documents réels du dépôt", () => {
  const fichiers = execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(AU_PERIMETRE);

  it("le périmètre est peuplé, et contient les deux pages qui citent l'image", () => {
    // Sans ce plancher, un renommage rendrait la garde verte en ne lisant rien.
    expect(fichiers.length).toBeGreaterThan(10);
    expect(fichiers).toContain("docs/RELEASING.md");
    expect(fichiers).toContain("docs/VERIFYING-RELEASES.md");
  });

  it("⚠️ aucune référence documentée ne rendrait 404", () => {
    const soucis = fichiers.flatMap((f) => referencesFautives(f, readFileSync(f, "utf8")));
    expect(soucis, soucis.join("\n")).toEqual([]);
  });
});
