// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA RÉTENTION EST ARMABLE DEPUIS UN CONTEXTE AUTONOME, ÉPROUVÉ.
//
// ⚠️ ELLE NE L'ÉTAIT PAS. `server/retention.js` exige `config.retention.balayage === true`, et cet
// opt-in strict est juste — les fenêtres sont des décisions métier, une suppression ne doit agir
// que là où un exploitant l'a écrite. Mais `context/standalone.js` n'exposait AUCUNE clé de
// rétention : un hôte qui consomme ce contexte tel quel n'avait nulle part où l'écrire. Seuls ceux
// qui rédigent leur contexte à la main pouvaient armer la purge. Un opt-in dont une partie du parc
// ne peut pas se saisir n'est pas un opt-in, c'est une indisponibilité — et deux hôtes l'ont
// découvert en comptant ce qui s'était accumulé chez eux.

const { retentionDepuisEnv } = require("../standalone.js");
const retention = require("../../server/retention.js");

describe("ce qu'un contexte autonome peut décider de la rétention", () => {
  it("rien posé : aucune clé, donc le balayage reste désarmé", () => {
    expect(retentionDepuisEnv({})).toEqual({});
  });

  it("⚠️ et un objet vide DÉSARME bien — c'est la valeur par défaut qui compte", () => {
    // `tick()` lit `r.balayage !== true`. Un objet vide n'est pas nul : ce cas vérifie que la
    // présence de la clé `retention` ne suffit pas à armer quoi que ce soit.
    expect(retentionDepuisEnv({}).balayage).toBeUndefined();
  });

  it("armé explicitement, et seulement par « 1 »", () => {
    expect(retentionDepuisEnv({ PLAYER_RETENTION_SWEEP: "1" })).toEqual({ balayage: true });
    for (const valeur of ["", "0", "true", "oui", "yes", " 1"]) {
      expect(retentionDepuisEnv({ PLAYER_RETENTION_SWEEP: valeur }).balayage,
        `« ${valeur} » n'arme pas : une purge ne se déclenche pas sur une approximation`)
        .toBeUndefined();
    }
  });

  it("les quatre fenêtres se règlent chacune par sa variable", () => {
    expect(retentionDepuisEnv({
      PLAYER_RETENTION_SWEEP: "1",
      PLAYER_RETENTION_LOGS_MONTHS: "6",
      PLAYER_RETENTION_PRESENTATIONS_MONTHS: "3",
      PLAYER_RETENTION_REVOKED_LINKS_MONTHS: "24",
      PLAYER_RETENTION_VOICE_MONTHS: "1",
    })).toEqual({ balayage: true, journauxMois: 6, presentationsMois: 3, liensRevoquesMois: 24, voixMois: 1 });
  });

  // ⚠️ LE PIÈGE QUE CE CAS GARDE. `fenetresValidees` fusionne cet objet PAR-DESSUS les défauts.
  // Poser `journauxMois: undefined` pour une variable absente ferait échouer la validation — et
  // donc refuser TOUTE purge — chez le cas le plus banal qui soit : un hôte qui arme sans régler
  // les mois. Une clé absente doit être absente, pas présente et vide.
  it("⚠️ une variable absente ne pose PAS la clé, sinon elle écraserait le défaut par `undefined`", () => {
    const r = retentionDepuisEnv({ PLAYER_RETENTION_SWEEP: "1" });
    expect(Object.keys(r)).toEqual(["balayage"]);
    expect("journauxMois" in r, "la clé ne doit pas exister du tout").toBe(false);
  });
});

// ⚠️ ET LE COMPORTEMENT SE VÉRIFIE À TRAVERS LE CŒUR, pas seulement sur la forme de l'objet. Ce
// qu'un hôte veut savoir n'est pas « quelle forme a ma config » mais « qu'est-ce qui sera
// supprimé » — et la réponse doit être ZÉRO tant que la configuration est douteuse.
describe("⚠️ ce que le cœur en fait, et combien de lignes il supprime", () => {
  const brancher = (env) => {
    let deletes = 0;
    retention.init({
      config: { retention: retentionDepuisEnv(env), supabaseUrl: "https://exemple.test" },
      db: { async request(_c, o) { if (o && o.method === "DELETE") deletes += 1; return []; }, async selectAll() { return []; } },
      limits: { async allow() { return true; } },
      errors: { capture() {} },
    });
    return () => deletes;
  };

  it("armé sans fenêtres : accepté, sur les défauts documentés", async () => {
    brancher({ PLAYER_RETENTION_SWEEP: "1" });
    const r = await retention.purgerRetention(Date.now());
    expect(r.ok, "un hôte qui arme sans régler les mois doit fonctionner").not.toBe(false);
  });

  it.each([
    ["illisible", "abc"],
    ["non entière", "12.5"],
    ["à zéro", "0"],
    ["hors bornes", "999"],
    ["négative", "-1"],
  ])("⚠️ une fenêtre %s refuse la purge en nommant la clé, et ne supprime RIEN", async (_quoi, valeur) => {
    const lus = brancher({ PLAYER_RETENTION_SWEEP: "1", PLAYER_RETENTION_LOGS_MONTHS: valeur });
    const r = await retention.purgerRetention(Date.now());
    expect(r.ok, "une configuration douteuse ne supprime pas « au mieux »").toBe(false);
    expect(r.error, "le message doit NOMMER la clé fautive").toContain("journauxMois");
    expect(lus(), "zéro suppression, pas « celles dont on était sûr »").toBe(0);
  });
});
