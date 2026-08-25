// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE REDIRECTION NE DOIT RIEN OUVRIR QUE L'URL DE DÉPART N'AURAIT PAS OUVERT.
//
// `fetch` suit les redirections par défaut, et n'en revalide aucune. La garde n'examinait que
// l'URL initiale : un amont autorisé qui répond `302` emmenait l'appel où il voulait — `localhost`,
// une adresse privée, une API de métadonnées cloud. L'invariant annoncé dans le README
// (« no redirect following into your private network ») était faux.
//
// ⚠️ ET LE SECRET SUIVAIT. `fetch` ne retire que `Authorization`, `Cookie` et
// `Proxy-Authorization` sur une redirection inter-origines ; un en-tête maison est transmis tel
// quel. Mesuré avec deux serveurs locaux avant de corriger : la destination recevait le secret
// partagé de l'hôte en clair. Ce n'est donc pas seulement une SSRF — c'est l'exfiltration de la
// clé qui autorise à lire TOUS les documents de l'hôte.
//
// Signalé par un audit externe, confirmé par la mesure. Ces tests portent sur les trois portes.

const storage = require("../storage.js");

// ⚠️ `hostBase` est un objet NORMALISÉ (`{origin, path}`), pas une chaîne — la barre finale est
// remise par `hostFetchBase`. Ma première version passait la chaîne brute : trois tests tombaient
// en accusant le code, alors que c'était le harnais qui ne parlait pas la bonne langue.
const HOTE = storage.hostFetchBase({ PLAYER_HOST_FETCH_BASE: "https://app.exemple.fr/api/documents/" });
const PREFIXE_HOTE = "https://app.exemple.fr/api/documents/";
const STORAGE = "https://exemple.supabase.co";
const OK = `${STORAGE}/storage/v1/object/public/resources/demo.pdf`;

const OPTIONS = { origins: [STORAGE], hostBase: HOTE, root: null, secret: "SECRET-DE-L-HOTE" };

/** Rejoue une chaîne de redirections sans réseau, en capturant ce qui part à chaque saut. */
function amont(chaine) {
  const appels = [];
  global.fetch = async (url, init) => {
    appels.push({ url: String(url), secret: (init.headers || {})["x-player-fetch-secret"] || null, redirect: init.redirect });
    const etape = chaine[String(url)];
    if (etape && etape.location) {
      return { status: etape.status || 302, headers: { get: (k) => (k.toLowerCase() === "location" ? etape.location : null) } };
    }
    return { status: 200, ok: true, headers: { get: () => null } };
  };
  return appels;
}

const vraiFetch = global.fetch;
afterEach(() => { global.fetch = vraiFetch; });

describe("là où une redirection a le droit d'aller", () => {
  it("aucune redirection : rien ne change", async () => {
    const appels = amont({});
    const r = await storage.fetchAllowedFile(OK, {}, OPTIONS);
    expect(r.status).toBe(200);
    expect(appels).toHaveLength(1);
    expect(appels[0].redirect, "les sauts doivent être suivis à la main").toBe("manual");
  });

  it("une redirection vers une destination AUTORISÉE est suivie", async () => {
    const suite = `${STORAGE}/storage/v1/object/public/resources/ailleurs.pdf`;
    const appels = amont({ [OK]: { location: suite } });
    const r = await storage.fetchAllowedFile(OK, {}, OPTIONS);
    expect(r.status).toBe(200);
    expect(appels.map((a) => a.url)).toEqual([OK, suite]);
  });

  // ⚠️ LE CŒUR DU SUJET.
  it.each([
    ["localhost", "http://localhost:6379/"],
    ["adresse privée", "http://192.168.1.10/interne"],
    ["métadonnées cloud", "http://169.254.169.254/latest/meta-data/"],
    ["origine non listée", "https://ailleurs.example/doc.pdf"],
    ["changement de nature (file:)", "file:///etc/passwd"],
  ])("une redirection vers %s est refusée", async (_nom, cible) => {
    amont({ [OK]: { location: cible } });
    expect(await storage.fetchAllowedFile(OK, {}, OPTIONS)).toBeNull();
  });

  it("une boucle de redirections finit par être refusée, pas parcourue sans fin", async () => {
    const a = `${STORAGE}/storage/v1/object/public/resources/a.pdf`;
    const b = `${STORAGE}/storage/v1/object/public/resources/b.pdf`;
    const appels = amont({ [OK]: { location: a }, [a]: { location: b }, [b]: { location: a } });
    expect(await storage.fetchAllowedFile(OK, {}, OPTIONS)).toBeNull();
    expect(appels.length, "les sauts sont bornés").toBeLessThanOrEqual(7);
  });
});

// ⚠️ CE QUI COMPTE PLUS QUE LE REFUS LUI-MÊME : ce qui PART à chaque saut.
describe("le secret ne suit jamais un changement de destination", () => {
  const DOC_HOTE = `${PREFIXE_HOTE}dossier/plan.pdf`;

  it("il part vers la route de l'hôte — c'est son rôle", async () => {
    const appels = amont({});
    await storage.fetchAllowedFile(DOC_HOTE, {}, OPTIONS);
    expect(appels[0].secret).toBe("SECRET-DE-L-HOTE");
  });

  it("il ne part JAMAIS vers un Storage public, même autorisé", async () => {
    const appels = amont({});
    await storage.fetchAllowedFile(OK, {}, OPTIONS);
    expect(appels[0].secret).toBeNull();
  });

  // Le cas mesuré avant correction : la route de l'hôte redirige vers un Storage autorisé.
  // L'ancien code envoyait le secret au second parce que le PREMIER y avait droit.
  it("une redirection depuis la route de l'hôte vers ailleurs le laisse derrière", async () => {
    const appels = amont({ [DOC_HOTE]: { location: OK } });
    const r = await storage.fetchAllowedFile(DOC_HOTE, {}, OPTIONS);
    expect(r.status).toBe(200);
    expect(appels).toHaveLength(2);
    expect(appels[0].secret, "premier saut : chez l'hôte").toBe("SECRET-DE-L-HOTE");
    expect(appels[1].secret, "second saut : ailleurs, donc sans secret").toBeNull();
  });

  it("et il repart si le saut revient chez l'hôte", async () => {
    const autre = `${PREFIXE_HOTE}autre/plan.pdf`;
    const appels = amont({ [DOC_HOTE]: { location: autre } });
    await storage.fetchAllowedFile(DOC_HOTE, {}, OPTIONS);
    expect(appels[1].secret).toBe("SECRET-DE-L-HOTE");
  });
});
