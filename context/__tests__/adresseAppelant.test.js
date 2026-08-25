// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// `X-Forwarded-For` EST UN EN-TÊTE, DONC UNE AFFIRMATION DU CLIENT.
//
// Onze endroits en prenaient la PREMIÈRE valeur pour identifier l'appelant, et toutes les limites
// de débit s'appuyaient dessus. Un client qui atteint directement le serveur — le cas du serveur
// autonome, et de toute instance dont le proxy ne réécrit pas cet en-tête — en changeait à chaque
// requête et n'était jamais limité.
//
// ⚠️ La limite existait, elle ne limitait rien. C'est la différence entre une limite approximative
// et une limite décorative — et seule la seconde donne une fausse assurance.
//
// ⚠️ ET LE SENS DE LECTURE EST L'ERREUR CLASSIQUE. Le DÉBUT de la chaîne est ce que le client a
// écrit ; la FIN est ce que les proxys ont constaté. Prendre le premier élément revient à croire
// l'appelant sur parole. On lit donc depuis la fin, d'autant de sauts que l'exploitant en déclare.
//
// Signalé par un audit externe (P1-6).

const { createStandaloneContext } = require("../standalone.js");

const contexte = (sauts) => createStandaloneContext({
  SUPABASE_URL: "https://x.supabase.co", PLAYER_TRUSTED_PROXY_HOPS: sauts,
});
const requete = (xff, socket = "10.0.0.1") => ({
  socket: { remoteAddress: socket },
  headers: xff == null ? {} : { "x-forwarded-for": xff },
});

describe("sans proxy déclaré, l'en-tête n'existe pas", () => {
  it("⚠️ une chaîne forgée est ignorée", () => {
    expect(contexte("").identity.clientIp(requete("1.1.1.1, 2.2.2.2"))).toBe("10.0.0.1");
  });

  it("un appelant qui change d'en-tête à chaque requête garde la même identité", () => {
    const ctx = contexte("");
    const vues = ["a", "b", "c"].map((v) => ctx.identity.clientIp(requete(v)));
    expect(new Set(vues).size, "sinon aucune limite de débit ne tient").toBe(1);
  });
});

describe("avec un proxy déclaré, on lit depuis la fin", () => {
  it("la chaîne forgée en amont ne sert à rien", () => {
    // Le client écrit ce qu'il veut ; le proxy ajoute la vraie valeur EN DERNIER.
    expect(contexte("1").identity.clientIp(requete("forge, autre-forge, 203.0.113.9"))).toBe("203.0.113.9");
  });

  it("deux proxys : on remonte de deux", () => {
    expect(contexte("2").identity.clientIp(requete("client, 203.0.113.9, 10.1.1.1"))).toBe("203.0.113.9");
  });

  it("sans en-tête, on retombe sur la socket", () => {
    expect(contexte("1").identity.clientIp(requete(null))).toBe("10.0.0.1");
  });

  // Une chaîne plus courte que le nombre de sauts déclarés ne doit pas rendre `undefined` :
  // une IP absente ferait tomber toutes les requêtes dans le même seau.
  it("une chaîne trop courte ne casse pas la résolution", () => {
    expect(contexte("5").identity.clientIp(requete("203.0.113.9"))).toBe("203.0.113.9");
  });

  it("un nombre de sauts absurde est borné", () => {
    expect(contexte("999").identity.clientIp(requete("203.0.113.9"))).toBeTruthy();
    expect(contexte("-3").identity.clientIp(requete("1.1.1.1"))).toBe("10.0.0.1");
  });
});

// ⚠️ Le cœur ne doit plus jamais lire cet en-tête lui-même : c'est une décision d'hôte, parce que
// lui seul sait s'il y a un proxy devant lui.
describe("le cœur ne lit plus l'en-tête", () => {
  it("aucune occurrence de x-forwarded-for dans le serveur", () => {
    const fs = require("node:fs");
    const path = require("node:path");
    for (const f of ["handler.js", "shares.js", "presentations.js"]) {
      const src = fs.readFileSync(path.join(__dirname, "..", "..", "server", f), "utf8");
      const lignes = src.split("\n")
        .map((l, i) => [i + 1, l])
        .filter(([, l]) => l.includes('headers["x-forwarded-for"]') && !/^\s*(\/\/|\*)/.test(l));
      expect(lignes, `${f} : l'IP se demande au contexte`).toEqual([]);
    }
  });
});
