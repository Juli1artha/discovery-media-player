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

/**
 * ⚠️ UN DOUBLE QUI NE MODÉLISE PAS LE SERVEUR REND CERTAINS DÉFAUTS INATTEIGNABLES, PAS SEULEMENT
 * MANQUÉS. Celui d'ici rendait un tableau CONSTANT : il ignorait `limit`, ignorait `offset`, et
 * n'avait aucun plafond à lui. Aucun jeu d'essai ne pouvait donc produire le défaut qu'un hôte réel
 * a trouvé quatre heures après la publication — le plafond `db-max-rows` de PostgREST, réglé à 1000
 * chez Supabase, qui tronque EN AMONT de notre borne et rendait `tronque: false` sur 1651 lignes.
 * Ce n'est pas un cas oublié : c'est une COUCHE non simulée, et un cas non écrit se rattrape quand
 * une couche absente, non.
 *
 * `base(n, plafond)` répond donc comme PostgREST : elle applique `offset`, puis `limit`, puis son
 * propre plafond — dans cet ordre, celui du serveur.
 */
const base = (n, plafond = Infinity) => (chemin) => {
  const lire = (cle) => {
    const m = chemin.match(new RegExp(`[?&]${cle}=(\\d+)`));
    return m ? Number(m[1]) : null;
  };
  const debut = lire("offset") || 0;
  const demande = lire("limit");
  let dispo = Math.max(0, n - debut);
  if (demande !== null) dispo = Math.min(dispo, demande);
  return lignes(Math.min(dispo, plafond));
};

describe("le compteur de ce qui porte encore ip ou ua", () => {
  it("interroge les TROIS colonnes, sur les deux tables", async () => {
    const vus = brancher(() => []);
    await retention.resteDeLaPurge();
    // Les requêtes FILTRÉES sont les sondes ; les non filtrées sont les dénominateurs, éprouvés
    // plus bas. Compter les deux ensemble ferait un cas qui passe pour de mauvaises raisons.
    expect(vus.filter((c) => c.includes("not.is.null"))).toHaveLength(3);
    expect(vus.some((c) => c.includes("commercial_doc_sessions") && c.includes("ip=not.is.null"))).toBe(true);
    expect(vus.some((c) => c.includes("commercial_doc_sessions") && c.includes("ua=not.is.null"))).toBe(true);
    expect(vus.some((c) => c.includes("commercial_doc_views") && c.includes("ua=not.is.null"))).toBe(true);
  });

  it("⚠️ et il BORNE son parcours — un diagnostic ne balaie pas un journal entier", async () => {
    const vus = brancher(() => []);
    await retention.resteDeLaPurge();
    for (const c of vus) expect(c).toContain(`limit=${retention.BORNE_RESTE + 1}`);
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
    expect(await retention.resteDeLaPurge()).toEqual({
      borne: retention.BORNE_RESTE, tronque: false, lignes: { sessions: 0, vues: 0 },
      sessionsIp: 0, sessionsUa: 0, vuesUa: 0, vide: true,
    });
  });

  // ⚠️ UN ZÉRO SANS DÉNOMINATEUR NE DISTINGUE PAS TROIS CHOSES : « purgé », « jamais écrit », et
  // « la sonde vise à côté ». Les deux premières se valent pour qui veut supprimer une colonne ; la
  // troisième est un mensonge. C'est notre règle anti-vacuité, appliquée partout dans `tools/` et
  // absente d'ici jusqu'à ce qu'un hôte la réclame.
  // Les volumes sont ceux d'un hôte réel le 01/09 — et c'est ce cas qui a montré qu'une borne à
  // mille saturait dès le premier jour chez lui.
  it("⚠️ le compteur porte ce qu'il a REGARDÉ, par table", async () => {
    brancher((c) => (c.includes("not.is.null") ? [] : base(c.includes("views") ? 1651 : 257)(c)));
    const r = await retention.resteDeLaPurge();
    expect(r.lignes, "deux tables, deux dénominateurs").toEqual({ sessions: 257, vues: 1651 });
    expect(r.tronque, "les volumes réels des hôtes connus doivent tenir sous la borne").toBe(false);
    expect(r.sessionsIp).toBe(0);
    expect(r.vide, "zéro sur 257 et 1651 : le zéro a un sujet").toBe(true);
  });

  it("⚠️ et une table vide se voit — son zéro ne prouve rien", async () => {
    brancher(() => []);
    expect((await retention.resteDeLaPurge()).lignes.sessions,
      "« 0 sur 0 » se distingue de « 0 sur 1908 »").toBe(0);
  });

  it("⚠️ un dénominateur INCONNU reste `null`, comme les comptes", async () => {
    brancher((c) => (c.includes("not.is.null") ? [] : new Error("base injoignable")));
    const r = await retention.resteDeLaPurge();
    expect(r.lignes, "ne pas savoir combien on a regardé n'est pas avoir regardé zéro")
      .toEqual({ sessions: null, vues: null });
  });

  it("⚠️ et le dénominateur ne coûte pas un balayage — il est borné comme les autres", async () => {
    const vus = brancher(() => []);
    await retention.resteDeLaPurge();
    const sansFiltre = vus.filter((c) => !c.includes("not.is.null"));
    expect(sansFiltre, "une requête par TABLE, pas par sonde").toHaveLength(2);
    for (const c of sansFiltre) expect(c).toContain(`limit=${retention.BORNE_RESTE + 1}`);
  });

  it("il reste des lignes : le compte est rendu, et le verdict est FAUX", async () => {
    brancher((c) => (c.includes("views") ? lignes(7) : c.includes("ip=") ? lignes(3) : []));
    const r = await retention.resteDeLaPurge();
    expect(r.sessionsIp).toBe(3);
    expect(r.sessionsUa).toBe(0);
    expect(r.vuesUa).toBe(7);
    expect(r.vide, "une seule colonne encore peuplée suffit à interdire le retrait").toBe(false);
  });

  // ⚠️ LE DÉFAUT QUE DEUX HÔTES ONT TROUVÉ LE MÊME JOUR, INDÉPENDAMMENT. La première version
  // demandait `limit=BORNE` et publiait la longueur : sur une base portant cinq mille adresses elle
  // rendait `1000`, que rien ne distinguait d'un compte exact de mille. Un nombre faux qui se lit
  // comme juste — pire qu'un nombre absent, parce que l'absence fait chercher et que le nombre fait
  // conclure. Le remède existait à trois cents lignes de là : `purgerRetention` rend `tronque`.
  it("⚠️ exactement la borne n'est PAS une troncature", async () => {
    brancher(base(retention.BORNE_RESTE));
    const r = await retention.resteDeLaPurge();
    expect(r.sessionsIp).toBe(retention.BORNE_RESTE);
    expect(r.tronque, "la borne pile, et rien au-delà : le compte est exact").toBe(false);
  });

  it("⚠️ au-delà de la borne, le compte est plafonné ET le dit", async () => {
    brancher(base(retention.BORNE_RESTE + 1));
    const r = await retention.resteDeLaPurge();
    expect(r.sessionsIp, "on ne publie pas la ligne excédentaire").toBe(retention.BORNE_RESTE);
    expect(r.tronque, "sans ce drapeau, la borne se lirait comme un compte exact").toBe(true);
  });

  // ⚠️ LE DÉFAUT QU'UN HÔTE RÉEL A TROUVÉ QUATRE HEURES APRÈS LA PUBLICATION, ET QUE CE BANC NE
  // POUVAIT PAS PRODUIRE. `db-max-rows` de PostgREST vaut 1000 par défaut chez Supabase : le
  // serveur rend 1000 lignes quoi qu'on demande. Comparer la longueur reçue à NOTRE borne suppose
  // que le seul plafond soit le nôtre — dès qu'un plafond serveur passe DESSOUS, il tronque en
  // amont et la comparaison porte sur le mauvais nombre.
  //
  // Une table de 1651 lignes se lisait donc `1000` AVEC `tronque: false`. C'est le défaut de la
  // version précédente déplacé d'un cran et AGGRAVÉ : celle-là ne prétendait rien, celle-ci
  // AFFIRMAIT l'exactitude. « 0 sur 1000 » fait conclure que le zéro est prouvé sur tout, alors
  // que 651 lignes n'ont pas été regardées.
  const PLAFOND_SERVEUR = 1000;   // `db-max-rows`, valeur par défaut de Supabase
  const VUES_REELLES = 1651;      // mesurées chez un hôte, en SQL, le jour du relevé
  const SESSIONS_REELLES = 257;

  // La base exacte de l'hôte qui a trouvé le défaut : purge appliquée (les trois sondes à zéro),
  // 257 sessions sous le plafond, 1651 vues au-dessus. Seule la seconde le révèle.
  const commeEnProduction = (c) => (c.includes("not.is.null")
    ? []
    : base(c.includes("views") ? VUES_REELLES : SESSIONS_REELLES, PLAFOND_SERVEUR)(c));

  it("⚠️ un plafond SERVEUR sous notre borne tronque, et le drapeau doit le dire quand même", async () => {
    brancher(commeEnProduction);
    const r = await retention.resteDeLaPurge();
    expect(r.lignes.vues, "on ne peut rendre que ce que le serveur a bien voulu donner").toBe(PLAFOND_SERVEUR);
    expect(r.lignes.sessions, "257 tient sous le plafond : ce dénominateur-là est exact").toBe(257);
    expect(r.tronque, "⚠️ SANS CE DRAPEAU : 1000 pour 1651, annoncé exact").toBe(true);
  });

  it("⚠️ et il le dit sans connaître le plafond — la question porte sur l'APRÈS, pas sur un nombre", async () => {
    const vus = brancher(commeEnProduction);
    await retention.resteDeLaPurge();
    const sonde = vus.filter((c) => c.includes(`offset=${PLAFOND_SERVEUR}`));
    expect(sonde.length, "une ligne demandée au rang suivant, et une seule").toBe(1);
    expect(sonde[0], "une ligne suffit à prouver qu'il en reste").toContain("limit=1");
  });

  it("⚠️ un plafond serveur ÉGAL au compte réel ne fabrique pas de troncature", async () => {
    brancher((c) => (c.includes("not.is.null") ? [] : base(PLAFOND_SERVEUR, PLAFOND_SERVEUR)(c)));
    const r = await retention.resteDeLaPurge();
    expect(r.lignes.vues).toBe(PLAFOND_SERVEUR);
    expect(r.tronque, "le rang suivant est vide : le lot reçu ÉTAIT le tout").toBe(false);
  });

  it("⚠️ zéro ligne ne coûte pas de seconde requête — la sonde n'apprendrait rien", async () => {
    const vus = brancher(base(0));
    await retention.resteDeLaPurge();
    expect(vus.some((c) => c.includes("offset=")), "rien à prolonger sous un lot vide").toBe(false);
  });

  it("⚠️ une sonde de prolongement en panne rend « au moins », jamais « exactement »", async () => {
    brancher((c) => (c.includes("offset=") ? new Error("réseau") : base(42)(c)));
    const r = await retention.resteDeLaPurge();
    expect(r.tronque, "ne pas savoir s'il en reste se lit comme un minorant").toBe(true);
  });

  it("⚠️ et la ligne excédentaire est demandée, pas devinée", async () => {
    const vus = brancher(() => []);
    await retention.resteDeLaPurge();
    for (const c of vus) expect(c, "BORNE + 1 : la ligne en trop ne sert qu'à prouver qu'il en reste")
      .toContain(`limit=${retention.BORNE_RESTE + 1}`);
  });

  it("⚠️ la saturation d'un DÉNOMINATEUR lève le même drapeau", async () => {
    brancher((c) => (c.includes("not.is.null") ? [] : lignes(retention.BORNE_RESTE + 1)));
    const r = await retention.resteDeLaPurge();
    expect(r.tronque, "un dénominateur tronqué ment autant qu'un compte tronqué").toBe(true);
    expect(r.vide, "et le verdict reste juste : saturé ou non, rien ne porte les colonnes").toBe(true);
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
