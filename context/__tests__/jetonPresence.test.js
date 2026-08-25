// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE JETON DE PRÉSENCE — SIGNÉ, LIÉ À (slug, key), EXPIRABLE, INFALSIFIABLE SANS LE SECRET.
//
// ⚠️ Socle de P1c étape 2 (incrément 1). Le jeton lie `slug + key + exp` et n'est vérifiable qu'avec
// `PLAYER_PRESENCE_SECRET`. Il empêchera un tiers d'écraser une présence enregistrée (il ne prouve pas
// une vraie personne — le plafond de création reste). Ici on éprouve le socle cryptographique seul :
// aller-retour, falsification, mauvais secret, expiration, absence de secret.

const crypto = require("node:crypto");
const { createStandaloneContext } = require("../standalone.js");

const SECRET = "secret-de-banc-32-octets-au-moins";
const idAvec = (secret) => createStandaloneContext({ PLAYER_PRESENCE_SECRET: secret }).identity;

describe("jeton de présence", () => {
  it("aller-retour : un jeton signé se relit en (slug, key)", () => {
    const id = idAvec(SECRET);
    const t = id.signPresenceToken("s-abc", "anon-xyz", 3600);
    expect(t).toMatch(/\./);
    expect(id.verifyPresenceToken(t)).toEqual({ slug: "s-abc", key: "anon-xyz" });
  });

  it("falsifié : un octet changé dans la signature invalide le jeton", () => {
    const id = idAvec(SECRET);
    const t = id.signPresenceToken("s", "k", 3600);
    const casse = t.slice(0, -1) + (t.slice(-1) === "A" ? "B" : "A");
    expect(id.verifyPresenceToken(casse)).toBeNull();
  });

  it("mauvais secret : un jeton d'une instance ne vaut pas chez une autre", () => {
    const t = idAvec(SECRET).signPresenceToken("s", "k", 3600);
    expect(idAvec("un-autre-secret-entierement").verifyPresenceToken(t)).toBeNull();
  });

  it("expiré : un `exp` dépassé est refusé (comparaison en millisecondes)", () => {
    // Jeton forgé À LA MAIN avec un exp passé, signé avec le vrai secret.
    const corps = Buffer.from(JSON.stringify({ slug: "s", key: "k", exp: Math.floor(Date.now() / 1000) - 10 }), "utf8").toString("base64url");
    const sig = crypto.createHmac("sha256", SECRET).update(corps).digest("base64url");
    expect(idAvec(SECRET).verifyPresenceToken(`${corps}.${sig}`)).toBeNull();
  });

  it("sans secret : on ne signe rien et on ne vérifie rien", () => {
    const id = idAvec("");
    expect(id.signPresenceToken("s", "k", 3600)).toBe("");
    const t = idAvec(SECRET).signPresenceToken("s", "k", 3600);
    expect(id.verifyPresenceToken(t)).toBeNull();
  });

  it("charge incomplète : un jeton sans slug ou sans key est refusé", () => {
    const sansSlug = Buffer.from(JSON.stringify({ key: "k", exp: Math.floor(Date.now() / 1000) + 3600 }), "utf8").toString("base64url");
    const sig = crypto.createHmac("sha256", SECRET).update(sansSlug).digest("base64url");
    expect(idAvec(SECRET).verifyPresenceToken(`${sansSlug}.${sig}`)).toBeNull();
  });
});
