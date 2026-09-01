// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUI RESTE DE L'HÉRITAGE, RENDU LISIBLE CHEZ CHAQUE HÔTE.
//
// ⚠️ D'OÙ VIENT CE COMPTEUR. Nos tables vivent dans la base de nos hôtes, et l'audit d'un hôte
// énumère SES tables : le schéma d'une dépendance occupe une zone que les inventaires de personne
// ne visitent. Deux hôtes ont découvert 2361 lignes portant encore une adresse IP ou un agent brut
// — non pas en surveillant, mais parce qu'un TIERS avait posé une question sur SA base.
//
// Et il répond à la question qui décide du retrait des colonnes, laquelle ne pouvait jusqu'ici que
// se SUPPOSER : « plus aucune version supportée ne les écrit » se croyait, faute de pouvoir se lire.

const retention = require("../retention.js");

const brancher = (parChemin) => {
  const vus = [];
  retention.init({
    config: {},
    db: {
      async request(chemin) {
        vus.push(chemin);
        const r = parChemin(chemin);
        if (r instanceof Error) throw r;
        return r;
      },
    },
    limits: { async allow() { return true; } },
    errors: { capture() {} },
  });
  return vus;
};

const lignes = (n) => Array.from({ length: n }, (_, i) => ({ id: `x${i}` }));

describe("le compteur de ce qui porte encore ip ou ua", () => {
  it("interroge les TROIS colonnes, sur les deux tables", async () => {
    const vus = brancher(() => []);
    await retention.resteDeLaPurge();
    expect(vus).toHaveLength(3);
    expect(vus.some((c) => c.includes("commercial_doc_sessions") && c.includes("ip=not.is.null"))).toBe(true);
    expect(vus.some((c) => c.includes("commercial_doc_sessions") && c.includes("ua=not.is.null"))).toBe(true);
    expect(vus.some((c) => c.includes("commercial_doc_views") && c.includes("ua=not.is.null"))).toBe(true);
  });

  it("⚠️ et il BORNE son parcours — un diagnostic ne balaie pas un journal entier", async () => {
    const vus = brancher(() => []);
    await retention.resteDeLaPurge();
    for (const c of vus) expect(c).toContain(`limit=${retention.BORNE_RESTE}`);
  });

  // ⚠️ LA SYNTAXE RESTE PORTABLE. `ci.yml` interdit les jointures imbriquées et les arbres
  // booléens de PostgREST : un hôte doit pouvoir porter ces requêtes ailleurs sans les réécrire.
  it("⚠️ n'emploie aucune syntaxe que la règle de portabilité interdit", async () => {
    const vus = brancher(() => []);
    await retention.resteDeLaPurge();
    for (const c of vus) {
      expect(c, "pas de ressource imbriquée").not.toMatch(/select=[^&]*\(/);
      expect(c, "pas d'arbre booléen").not.toMatch(/[?&](or|and)=\(/);
      expect(c, "pas d'offset").not.toContain("offset=");
    }
  });

  it("tout est vide : les trois à zéro, et le verdict est VRAI", async () => {
    brancher(() => []);
    expect(await retention.resteDeLaPurge())
      .toEqual({ borne: retention.BORNE_RESTE, sessionsIp: 0, sessionsUa: 0, vuesUa: 0, vide: true });
  });

  it("il reste des lignes : le compte est rendu, et le verdict est FAUX", async () => {
    brancher((c) => (c.includes("views") ? lignes(7) : c.includes("ip=") ? lignes(3) : []));
    const r = await retention.resteDeLaPurge();
    expect(r.sessionsIp).toBe(3);
    expect(r.sessionsUa).toBe(0);
    expect(r.vuesUa).toBe(7);
    expect(r.vide, "une seule colonne encore peuplée suffit à interdire le retrait").toBe(false);
  });

  it("la borne atteinte se lit « au moins », et le champ `borne` le dit", async () => {
    brancher(() => lignes(retention.BORNE_RESTE));
    const r = await retention.resteDeLaPurge();
    expect(r.sessionsIp).toBe(retention.BORNE_RESTE);
    expect(r.borne, "sans ce champ, la valeur passerait pour un compte exact")
      .toBe(retention.BORNE_RESTE);
  });

  // ⚠️ LE CAS QUI COMPTE LE PLUS. Zéro est la réponse qui AUTORISE à supprimer une colonne. La
  // fabriquer depuis une sonde en panne serait le pire mensonge que cette carte puisse faire — et
  // c'est le mode de panne exact que ce dépôt traque partout : une absence de mesure qui se lit
  // comme une mesure à zéro.
  it("⚠️ une sonde en panne rend `null`, JAMAIS zéro, et le verdict devient indéterminé", async () => {
    brancher((c) => (c.includes("ip=") ? new Error("base injoignable") : []));
    const r = await retention.resteDeLaPurge();
    expect(r.sessionsIp, "une panne n'est pas un vide").toBeNull();
    expect(r.sessionsUa).toBe(0);
    expect(r.vide, "« on ne sait pas » ne doit pas se lire « c'est bon »").toBeNull();
  });

  // ⚠️ LE JOUR OÙ UN EXPLOITANT SUPPRIME LA COLONNE — le geste que ce compteur sert à autoriser —
  // la requête échoue avec le 42703 de PostgreSQL. Rendre `null` ferait lire « on ne sait pas » au
  // moment exact où l'on sait le mieux : rien ne peut porter une colonne qui n'existe plus. Le
  // compteur deviendrait aveugle quand son sujet est réglé.
  it("⚠️ une colonne SUPPRIMÉE compte zéro — c'est un état connu, pas une panne", async () => {
    brancher((c) => {
      if (!c.includes("ip=")) return [];
      const e = new Error("Supabase GET … → 400");
      e.statusCode = 400;
      e.details = { code: "42703", message: 'column "ip" does not exist' };
      return e;
    });
    const r = await retention.resteDeLaPurge();
    expect(r.sessionsIp, "la colonne n'existe plus : rien ne peut la porter").toBe(0);
    expect(r.vide, "et la purge est bien complète ici").toBe(true);
  });

  it("⚠️ mais une AUTRE erreur 400 reste indéterminée — seul 42703 est concluant", async () => {
    brancher((c) => {
      if (!c.includes("ip=")) return [];
      const e = new Error("Supabase GET … → 400");
      e.statusCode = 400;
      e.details = { code: "22P02", message: "invalid input syntax" };
      return e;
    });
    const r = await retention.resteDeLaPurge();
    expect(r.sessionsIp).toBeNull();
    expect(r.vide).toBeNull();
  });

  it("⚠️ et un hôte dont la capacité `db` ne rend pas le corps analysé retombe sur l'indéterminé", async () => {
    brancher((c) => (c.includes("ip=") ? new Error("400") : []));
    expect((await retention.resteDeLaPurge()).sessionsIp,
      "sans détail, ne pas savoir est le côté sûr").toBeNull();
  });

  it("⚠️ et une réponse qui n'est pas une liste est un indéterminé, pas un zéro", async () => {
    brancher(() => ({ message: "quelque chose d'autre" }));
    const r = await retention.resteDeLaPurge();
    expect(r.sessionsIp).toBeNull();
    expect(r.vide).toBeNull();
  });

  it("⚠️ toutes les sondes en panne : rien ne passe pour vide", async () => {
    brancher(() => new Error("base injoignable"));
    const r = await retention.resteDeLaPurge();
    expect([r.sessionsIp, r.sessionsUa, r.vuesUa]).toEqual([null, null, null]);
    expect(r.vide).toBeNull();
  });
});
