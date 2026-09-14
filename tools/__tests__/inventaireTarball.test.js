// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ LE STDERR DE `npm pack` ÉTAIT JETÉ. Sur une forge au cache npm non inscriptible, `npm pack`
// sort en 255 avec `EPERM`, et la seule pièce qui remontait était « code 255 » : un audit externe a
// passé une passe entière à attribuer six rouges avant de trouver la cause (neuvième passe, 14/09).
// Ce banc lance un VRAI sous-processus qui échoue avec une cause identifiable, et exige que la
// cause traverse toute la chaîne jusqu'au message de l'erreur.

import { describe, it, expect } from "vitest";

import { lancerPack, fichiersDuTarball } from "../inventaire-tarball.mjs";

describe("⚠️ la cause d'un échec de npm pack traverse la chaîne", () => {
  it("un sous-processus qui échoue avec un message identifiable : code, signal et stderr sont dans l'erreur", () => {
    let erreur = null;
    try { lancerPack(process.execPath, ["-e", "console.error('CAUSE-IDENTIFIABLE: EPERM cache non inscriptible'); process.exit(255)"]); }
    catch (e) { erreur = e; }
    expect(erreur, "contrôle positif : ça échoue").not.toBeNull();
    expect(erreur.message).toMatch(/a échoué : code 255, signal aucun/);
    expect(erreur.message, "la cause est là, pas seulement le code").toMatch(/CAUSE-IDENTIFIABLE: EPERM cache non inscriptible/);
    expect(erreur.cause && erreur.cause.status).toBe(255);
  });
  it("un sous-processus muet dit qu'il l'est, plutôt que de laisser croire qu'il n'y avait rien à lire", () => {
    let erreur = null;
    try { lancerPack(process.execPath, ["-e", "process.exit(3)"]); } catch (e) { erreur = e; }
    expect(erreur.message).toMatch(/code 3, signal aucun — stderr vide/);
  });
  it("la cause remonte jusqu'à fichiersDuTarball, qui ne la réécrit pas", () => {
    expect(() => fichiersDuTarball(() => lancerPack(process.execPath, ["-e", "console.error('LA-CAUSE'); process.exit(1)"])))
      .toThrow(/LA-CAUSE/);
  });
  it("le stderr est borné — une avalanche ne noie pas la pièce", () => {
    let erreur = null;
    try { lancerPack(process.execPath, ["-e", "for(let i=0;i<500;i++)console.error('ligne '+i+' '.repeat(50)); process.exit(1)"]); } catch (e) { erreur = e; }
    expect(erreur.message.length).toBeLessThan(900);
    expect(erreur.message).toMatch(/ligne 499/);
  });
});
