// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUE L'OUTIL DE NETTOYAGE OSE APPELER « CANDIDAT », ET TOUT CE QU'IL REFUSE DE TOUCHER.
//
// ⚠️ IL NE PEUT PAS DISTINGUER NOS ORPHELINS DE CEUX D'UN HÔTE, et c'est la contrainte qui dessine
// tout le reste. Un objet sans ligne est l'un de trois : orphelin de la purge cassée, vestige
// d'avant la migration 0021, ou fichier écrit par l'hôte lui-même sous notre convention de nommage
// — un intégrateur en a rapporté 908, et le contrat garde la trace de ce que s'y conformer aurait
// coûté. Aucune mesure ne les sépare. D'où : rapport par défaut, et un nombre à recopier pour agir.

import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "vitest";

import { classer, AGE_DEFAUT_JOURS, BUCKET } from "../orphelins-tts.mjs";

const MAINTENANT = Date.UTC(2026, 8, 12);
const jours = (n) => new Date(MAINTENANT - n * 86400000).toISOString();
const obj = (name, n) => ({ name, created_at: jours(n) });

describe("classer les objets du cache de voix", () => {
  it("un objet que la base connaît est TENU — la purge s'en occupe, pas nous", () => {
    const r = classer([obj("aaa.mp3", 9999), obj("aaa.json", 9999)], ["aaa"], { maintenant: MAINTENANT });
    expect(r.tenus.sort()).toEqual(["aaa.json", "aaa.mp3"]);
    expect(r.candidats).toEqual([]);
  });

  it("sans ligne et assez vieux : candidat", () => {
    const r = classer([obj("bbb.mp3", AGE_DEFAUT_JOURS + 1)], [], { maintenant: MAINTENANT });
    expect(r.candidats).toEqual(["bbb.mp3"]);
  });

  // ⚠️ LE CAS QUI JUSTIFIE L'ÂGE, ET IL N'EST PAS THÉORIQUE. Un objet récent sans ligne peut être une
  // synthèse dont l'écriture de trace vient d'échouer : le supprimer effacerait un fichier que le
  // produit s'apprête à servir. Seul l'âge sépare « la trace n'est pas encore là » de « elle ne
  // viendra jamais ».
  it("⚠️ sans ligne mais RÉCENT : intouché — la trace peut n'être pas encore écrite", () => {
    const r = classer([obj("ccc.mp3", 3)], [], { maintenant: MAINTENANT });
    expect(r.candidats).toEqual([]);
    expect(r.recents).toEqual(["ccc.mp3"]);
  });

  // ⚠️ SANS DATE, ON NE SAIT PAS, DONC ON NE SUPPRIME PAS. Traiter l'absence de date comme « vieux »
  // ferait de chaque réponse tronquée du fournisseur une autorisation de destruction.
  it("⚠️ une date illisible ne vaut pas « vieux »", () => {
    const r = classer([{ name: "ddd.mp3", created_at: "pas-une-date" }, { name: "eee.mp3" }], [], { maintenant: MAINTENANT });
    expect(r.candidats).toEqual([]);
    expect(r.illisibles.sort()).toEqual(["ddd.mp3", "eee.mp3"]);
  });

  it("⚠️ un nom qui n'est pas le nôtre n'est jamais candidat", () => {
    const r = classer([obj("photo.png", 9999), obj("dossier/", 9999), obj("aaa", 9999)], [], { maintenant: MAINTENANT });
    expect(r.candidats).toEqual([]);
    expect(r.illisibles).toHaveLength(3);
  });

  it("les deux objets d'une empreinte suivent la même ligne", () => {
    const r = classer([obj("fff.mp3", 9999), obj("fff.json", 9999)], [], { maintenant: MAINTENANT });
    expect(r.candidats.sort()).toEqual(["fff.json", "fff.mp3"]);
  });

  // ⚠️ BORNE : chaque objet tombe dans EXACTEMENT une catégorie. Une grandeur bornée qui sort de ses
  // bornes est le seul témoin gratuit d'une définition — ici, qu'aucun objet n'est compté deux fois
  // ni oublié, ce qu'un rapport de destruction doit garantir avant toute autre qualité.
  it("⚠️ borne : tenus + récents + candidats + illisibles = le nombre d'objets", () => {
    const objets = [obj("aaa.mp3", 9999), obj("aaa.json", 2), obj("bbb.mp3", 9999), obj("ccc.mp3", 1),
      { name: "zzz.mp3" }, obj("photo.png", 9999)];
    const r = classer(objets, ["aaa"], { maintenant: MAINTENANT });
    expect(r.tenus.length + r.recents.length + r.candidats.length + r.illisibles.length).toBe(objets.length);
  });

  it("le bucket visé est bien celui du cache de voix", () => {
    expect(BUCKET).toBe("tts-cache");
  });
});

// ⚠️ L'OUTIL NE JOINT PERSONNE TANT QU'ON NE LE LUI DEMANDE PAS. Il vit dans `tools/`, où
// `planchersDesGardes` lance CHAQUE fichier sur un dépôt vide : un outil qui contacterait le réseau
// dès son lancement ferait de ce banc un client de production.
describe("⚠️ le silence par défaut, et le refus d'accuser la branche", () => {
  const outil = join(dirname(fileURLToPath(import.meta.url)), "..", "orphelins-tts.mjs");
  const lancer = (args, env) => {
    try {
      execFileSync(process.execPath, [outil, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, ...env } });
      return { code: 0, sortie: "" };
    } catch (e) { return { code: e.status ?? 1, sortie: String(e.stdout || "") + String(e.stderr || "") }; }
  };

  it("sans argument : NON CONCLUANT, et aucun appel réseau", () => {
    const { code, sortie } = lancer([]);
    expect(code).toBe(2);
    expect(sortie).toMatch(/rien n'a été demandé/);
  });

  it("sans identifiants : NON CONCLUANT, pas une violation de la branche", () => {
    const { code } = lancer(["--inspecter"], { SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" });
    expect(code).toBe(2);
  });

  // ⚠️ LE PIÈGE QUI A MOTIVÉ `tenterAsync`. `tenter` est SYNCHRONE : son `try` voit une fonction
  // `async` RENDRE une promesse sans lever, donc son `catch` n'est jamais atteint. Une coupure
  // réseau sortait alors en 1 — « ce dépôt viole la règle » — au lieu de 2. Le code est court, il se
  // lit bien, et il n'échoue que quand quelque chose d'autre échoue : rien ne l'aurait signalé.
  it("⚠️ une panne RÉSEAU rend 2, jamais 1 — l'exception est asynchrone", () => {
    const { code, sortie } = lancer(["--inspecter"],
      { SUPABASE_URL: "https://hote.invalide.exemple", SUPABASE_SERVICE_ROLE_KEY: "k" });
    expect(code, "1 accuserait la branche d'une panne de réseau").toBe(2);
    expect(sortie).toMatch(/GARDE NON CONCLUANTE/);
  });
});
