// LA CLÉ DES STATISTIQUES ÉTAIT DIFFUSÉE À TOUTE L'AUDIENCE.
//
// La présence Realtime transporte un `uid` pour dédoublonner l'affichage — « je me vois deux fois »
// après une reconnexion. En 0.1.42 nous y avons mis `attendeeKey()`, c'est-à-dire l'identité de la
// LIGNE DE PRÉSENCE d'un participant anonyme.
//
// ⚠️ N'importe quel participant pouvait donc lire dans le canal la clé d'un voisin, la reposter sur
// `present-attend`, et écraser son temps de présence, son nom et son avatar. Le canal distribuait
// lui-même de quoi falsifier les mesures qu'il servait.
//
// À décharge, l'état d'avant était pire : `uid` valait l'ADRESSE E-MAIL des membres, servie à tout
// visiteur anonyme du lien public. On a fermé une fuite et laissé un rejeu.
//
// ⚠️ DEUX BESOINS, DEUX VALEURS. Dédoublonner un affichage demande une valeur stable et PUBLIQUE ;
// identifier une ligne de mesure demande une valeur stable et NON DIVULGUÉE. Une seule valeur pour
// les deux finit toujours par trahir l'un des deux usages.
//
// Signalé par la vérification d'audit (V-5), sur du code que nous venions d'écrire.

const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

const { PLAYER_BROWSER_JS } = require("../browser.generated.js");
const SRC = fs.readFileSync(path.join(__dirname, "..", "handler.js"), "utf8");

/** On EXÉCUTE le paquet livré : c'est lui qui part chez les hôtes, pas nos sources. */
function playerDuPaquet() {
  const bac = { crypto: require("node:crypto").webcrypto, console };
  bac.globalThis = bac;
  vm.createContext(bac);
  return new vm.Script(PLAYER_BROWSER_JS + "\n;Player").runInContext(bac);
}
const memoire = () => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } }; };

describe("ce qui part dans la présence n'identifie aucune ligne de mesure", () => {
  const P = playerDuPaquet();

  it("les deux identifiants d'un même navigateur sont différents", () => {
    const store = memoire();
    const mesure = P.live.attendeeKey(store, "session");
    const presence = P.live.presenceId(store);
    expect(presence, "diffuser la clé de mesure, c'est distribuer de quoi falsifier les statistiques")
      .not.toBe(mesure);
  });

  // ⚠️ Et pas seulement différents : l'un ne doit pas se déduire de l'autre.
  it("l'un ne contient pas l'autre", () => {
    const store = memoire();
    const mesure = P.live.attendeeKey(store, "session");
    const presence = P.live.presenceId(store);
    expect(presence.includes(mesure), "un préfixe partagé rendrait la séparation cosmétique").toBe(false);
    expect(mesure.includes(presence)).toBe(false);
  });

  it("chacun reste stable pour un même navigateur", () => {
    const store = memoire();
    expect(P.live.presenceId(store)).toBe(P.live.presenceId(store));
    expect(P.live.attendeeKey(store, "s")).toBe(P.live.attendeeKey(store, "s"));
  });

  it("et imprévisible d'un navigateur à l'autre", () => {
    const vus = new Set(Array.from({ length: 20 }, () => P.live.presenceId(memoire())));
    expect(vus.size).toBe(20);
    for (const v of vus) expect(v.length, "un tirage sérieux, pas huit caractères de Math.random")
      .toBeGreaterThan(16);
  });

  // ⚠️ LE CHEMIN QUE CE BANC N'EXERÇAIT PAS, ET OÙ LA SÉPARATION ÉTAIT COSMÉTIQUE.
  //
  // Sans stockage — navigation privée, quota, stockage bloqué — les deux fonctions retombaient sur
  // le MÊME identifiant de session : « p-MYID42 » et « anon-MYID42 ». Lire l'identifiant de présence
  // d'un voisin donnait donc sa clé de participation, exactement là où le lecteur est le plus
  // dégradé. Les tests ci-dessus passaient quand même : ils fournissaient toujours un stockage.
  //
  // Un banc qui n'exerce pas le chemin dégradé décrit un monde où le défaut n'existe pas.
  it("sans stockage non plus, l'un ne se déduit pas de l'autre", () => {
    const mesure = P.live.attendeeKey(null, "MYID42");
    const presence = P.live.presenceId(null);
    expect(presence).not.toBe(mesure);
    const graine = mesure.replace(/^anon-/, "");
    expect(presence.includes(graine), "une graine partagée rend la séparation cosmétique").toBe(false);
  });

  it("et sans stockage, deux navigateurs ne se ressemblent pas", () => {
    const vus = new Set(Array.from({ length: 20 }, () => P.live.presenceId(null)));
    expect(vus.size, "un repli déterministe se devine").toBe(20);
  });

  it("ils sont rangés sous deux clés de stockage distinctes", () => {
    const store = memoire();
    P.live.attendeeKey(store, "s");
    P.live.presenceId(store);
    const cles = Object.keys(store).length ? [] : null;
    void cles;
    expect(P.live.STORAGE_KEYS.presenceId).not.toBe(P.live.STORAGE_KEYS.attendeeKey);
  });
});

// ── Le câblage, qui est l'autre moitié ───────────────────────────────────────────────────────────
//
// ⚠️ Deux identifiants distincts ne servent à rien si la page diffuse encore le mauvais. C'est la
// leçon du jeton interne : vérifier sans émettre refuse tout, émettre sans vérifier ne ferme rien.
describe("la page diffuse l'identifiant de présence, pas la clé de mesure", () => {
  const i = SRC.indexOf("ch.track(");
  const charge = SRC.slice(i, SRC.indexOf(")", SRC.indexOf("{", i)) + 1);

  it("la charge de présence existe", () => {
    expect(i, "sans elle, ce test ne prouverait rien").toBeGreaterThan(0);
  });

  it("elle ne porte plus la clé de participation", () => {
    expect(charge, "c'était le défaut : la clé des statistiques diffusée à toute l'audience")
      .not.toContain("attKey()");
  });

  it("elle porte l'identifiant de présence", () => {
    expect(charge).toContain("presId()");
  });

  // Et la clé de mesure, elle, ne part QUE vers le serveur, dans la requête de présence.
  it("la clé de participation ne part que dans present-attend", () => {
    // On écarte la DÉCLARATION de la fonction : elle n'envoie rien, elle définit.
    const usages = [...SRC.matchAll(/attKey\(\)/g)]
      .filter((m) => !SRC.slice(m.index - 12, m.index).includes("function "))
      .map((m) => SRC.slice(Math.max(0, m.index - 300), m.index));
    expect(usages.length, "elle doit encore servir quelque part").toBeGreaterThan(0);
    for (const contexte of usages) {
      expect(contexte, "la clé de mesure ne doit voyager que vers le serveur")
        .toContain("present-attend");
    }
  });
});
