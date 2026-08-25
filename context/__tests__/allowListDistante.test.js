// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'ALLOW-LIST DISTANTE — LA MOITIÉ DE LA GARDE SSRF QUI N'AVAIT PAS DE BANC.
//
// ⚠️ `storage.test.js` éprouve la RACINE LOCALE, en détail : la remontée par `..`, le dossier
// voisin qui commence pareil, le lien symbolique qui sort, l'octet nul. Rien n'éprouvait l'autre
// moitié — celle qui décide quelles URL DISTANTES le serveur accepte d'aller chercher. C'est
// pourtant celle que `docs/THREAT-MODEL.md` désigne comme la cible la plus précieuse du dépôt
// (T2), pour la raison qui y est écrite : le relais prend une URL influencée par l'appelant et la
// récupère côté serveur, donc avec la position réseau de l'instance.
//
// ⚠️ ON APPLIQUE LE GESTE DE `redirectionsDuRelais.test.js`, QUI EST DÉJÀ CELUI DU DÉPÔT : un
// commentaire qui ÉNONCE une propriété est l'intitulé d'un test. `storage.js` en énonce trois en
// prose, au-dessus des fonctions concernées, et aucune n'était vérifiée :
//
//   « Jamais d'identifiants dans l'URL (`https://victime@vrai-hote/…` : l'origine est bonne, mais
//     des identifiants voyageraient avec la requête). »
//   « LA BARRE FINALE EST OBLIGATOIRE, et on la remet plutôt que d'espérer qu'elle soit tapée. »
//   « `PLAYER_HOST_FETCH_BASE` est un préfixe d'URL COMPLET, jamais une simple origine. »
//
// Les trois sont ci-dessous, avec la condition et le résultat attendu que la phrase donnait déjà.

// CommonJS et globales vitest, comme `storage.test.js` juste à côté : `context/**` est configuré
// en `sourceType: "commonjs"` dans `eslint.config.mjs`, et un `import` y est une erreur d'analyse.
const { storageOrigins, hostFetchBase, isHostFetchUrl, resolveLocal, isAllowedStorageUrl, fetchAllowedFile } =
  require("../storage.js");

const ORIGINE = "https://depot.exemple.test";
const PUBLIC = "/storage/v1/object/public/documents/a.pdf";
const AUTORISEE = ORIGINE + PUBLIC;

describe("les origines déclarées", () => {
  // ⚠️ LE CAS QUI OUVRIRAIT TOUT, ET IL EST SILENCIEUX. `new URL("file:///etc").origin` ne lève
  // pas : il rend la CHAÎNE « null ». Sans le test `origin !== "null"`, cette chaîne entrerait dans
  // la liste des origines autorisées — et comme l'origine de n'importe quelle URL opaque vaut elle
  // aussi « null », la comparaison `origins.includes(url.origin)` deviendrait vraie pour elles.
  // Une seule variable d'environnement mal tapée suffirait, et rien n'aurait l'air cassé.
  it("refuse une origine opaque, dont l'origine vaut la chaîne « null »", () => {
    expect(new URL("file:///etc/passwd").origin).toBe("null"); // la prémisse, pas une supposition
    expect(storageOrigins({ PLAYER_STORAGE_ORIGINS: "file:///etc" })).toEqual([]);
  });

  it("ignore une entrée illisible plutôt que de refuser toute la configuration", () => {
    // Une virgule en trop, un fragment collé : l'instance doit démarrer avec ce qui est valide.
    expect(storageOrigins({ PLAYER_STORAGE_ORIGINS: `pas-une-url, ${ORIGINE}` })).toEqual([ORIGINE]);
  });

  it("ne compte qu'une fois une origine déclarée deux fois", () => {
    // `SUPABASE_URL` est TOUJOURS ajoutée ; la redéclarer dans la liste est le geste naturel de
    // quelqu'un qui veut « être sûr ». Un doublon n'ouvre rien, mais il rend la liste illisible
    // le jour où on la relit pour comprendre ce qui est autorisé.
    const o = storageOrigins({ SUPABASE_URL: ORIGINE + "/rest/v1", PLAYER_STORAGE_ORIGINS: ORIGINE });
    expect(o).toEqual([ORIGINE]);
  });
});

describe("la route de l'hôte porte un secret — donc elle est en https, ou elle n'est pas", () => {
  // ⚠️ CE REFUS PROTÈGE `PLAYER_HOST_FETCH_SECRET`. `fetchAllowedFile` pose ce secret en en-tête
  // sur tout saut reconnu comme la route de l'hôte. Si la base pouvait être en http, le secret
  // partirait en clair sur le réseau — et `SECURITY.md` classe sa fuite comme vulnérabilité à
  // part entière, indépendamment de tout document lu.
  it("refuse une base en http : le secret y voyagerait en clair", () => {
    expect(hostFetchBase({ PLAYER_HOST_FETCH_BASE: "http://hote.exemple.test/api/documents/" })).toBeNull();
  });

  it("refuse une base absente ou illisible", () => {
    expect(hostFetchBase({})).toBeNull();
    expect(hostFetchBase({ PLAYER_HOST_FETCH_BASE: "pas-une-url" })).toBeNull();
  });

  // ⚠️ LES DEUX CÔTÉS DE LA BARRE FINALE, et le dépôt sait pourquoi : « une variable
  // d'environnement tapée à la main, un jour de déploiement ». Seule la branche « il faut
  // l'ajouter » était exercée ; celle où elle est déjà là ne l'était pas, et c'est celle qui
  // casserait en silence si quelqu'un « simplifiait » la ternaire.
  it("remet la barre finale quand elle manque", () => {
    expect(hostFetchBase({ PLAYER_HOST_FETCH_BASE: "https://hote.exemple.test/api/documents" }))
      .toEqual({ origin: "https://hote.exemple.test", path: "/api/documents/" });
  });

  it("laisse la barre finale quand elle est déjà là", () => {
    expect(hostFetchBase({ PLAYER_HOST_FETCH_BASE: "https://hote.exemple.test/api/documents/" }))
      .toEqual({ origin: "https://hote.exemple.test", path: "/api/documents/" });
  });

  // ⚠️ LA CONSÉQUENCE RÉELLE DE LA BARRE, celle que le commentaire de `storage.js` décrit : la
  // comparaison est un préfixe de CHAÎNE. Sans elle, `/api/documents` autoriserait aussi
  // `/api/documents-prives/tout`. Le test le vérifie du côté de l'appelant, pas de la normalisation.
  it("n'accepte pas une route voisine dont le chemin commence pareil", () => {
    const base = hostFetchBase({ PLAYER_HOST_FETCH_BASE: "https://hote.exemple.test/api/documents" });
    expect(isHostFetchUrl("https://hote.exemple.test/api/documents/42", base)).toBe(true);
    expect(isHostFetchUrl("https://hote.exemple.test/api/documents-prives/42", base)).toBe(false);
  });

  it("refuse des identifiants dans l'URL, même sur la bonne route", () => {
    const base = hostFetchBase({ PLAYER_HOST_FETCH_BASE: "https://hote.exemple.test/api/documents/" });
    expect(isHostFetchUrl("https://victime@hote.exemple.test/api/documents/42", base)).toBe(false);
  });

  it("sans base configurée, aucune URL n'est la route de l'hôte", () => {
    expect(isHostFetchUrl("https://hote.exemple.test/api/documents/42", null)).toBe(false);
  });
});

describe("l'allow-list distante", () => {
  const passe = (u) => isAllowedStorageUrl(u, [ORIGINE], null, null);

  // ⚠️ LA PHRASE DU CODE, RETOURNÉE EN TEST. « L'origine est bonne, mais des identifiants
  // voyageraient avec la requête. » C'est le contournement classique : l'attaquant n'a pas besoin
  // de changer d'origine, il lui suffit d'en préfixer une valide pour que le serveur émette une
  // requête authentifiée qu'il n'a pas voulue.
  it("refuse « https://victime@vrai-hote/… » — l'origine est bonne, les identifiants voyageraient", () => {
    expect(passe("https://victime@depot.exemple.test" + PUBLIC)).toBe(false);
  });

  it("refuse aussi un mot de passe seul", () => {
    expect(passe("https://:motdepasse@depot.exemple.test" + PUBLIC)).toBe(false);
  });

  it("refuse http, même sur une origine autorisée", () => {
    // L'origine http n'est de toute façon pas dans la liste, mais la garde ne s'en remet pas à ça :
    // elle refuse le protocole AVANT de comparer, pour que l'ordre des tests n'ait pas d'importance.
    expect(isAllowedStorageUrl("http://depot.exemple.test" + PUBLIC, ["http://depot.exemple.test"], null, null))
      .toBe(false);
  });

  it("refuse un objet NON public d'une origine autorisée", () => {
    // Le préfixe public est la raison pour laquelle autoriser une origine n'expose rien de neuf :
    // ces objets sont déjà lisibles par tous. Un objet privé du même Storage ne l'est pas.
    expect(passe(ORIGINE + "/storage/v1/object/prive/documents/a.pdf")).toBe(false);
  });

  it("refuse une candidate absente plutôt que de lever", () => {
    // Un appelant qui transmet `undefined` doit obtenir un refus, pas une exception qui remonte
    // jusqu'à une 500 : le cœur échoue FERMÉ, il ne tombe pas.
    expect(passe(undefined)).toBe(false);
    expect(passe("")).toBe(false);
  });

  it("témoin : un objet public d'une origine autorisée passe", () => {
    // Sans ce témoin, tous les refus ci-dessus seraient satisfaits par une garde qui refuse TOUT.
    expect(passe(AUTORISEE)).toBe(true);
  });
});

describe("sans configuration, rien ne passe", () => {
  it("aucune racine locale : aucun chemin ne se résout", () => {
    expect(resolveLocal("file:///etc/passwd", null)).toBeNull();
  });

  it("aucune option : le relais refuse au lieu d'autoriser par défaut", async () => {
    // ⚠️ FERMÉ PAR DÉFAUT, y compris quand l'appelant oublie de passer sa configuration. C'est le
    // cas qu'un `origins || []` mal placé transformerait en « aucune contrainte » plutôt qu'en
    // « aucune origine autorisée » — deux lectures opposées de la même absence.
    await expect(fetchAllowedFile(AUTORISEE)).resolves.toBeNull();
  });
});

describe("le Range est relayé, et rien n'est inventé", () => {
  const vraiFetch = globalThis.fetch;
  afterEach(() => { globalThis.fetch = vraiFetch; });

  const espionner = () => {
    const vus = [];
    globalThis.fetch = async (url, o) => { vus.push({ url: String(url), headers: o.headers }); return { status: 200 }; };
    return vus;
  };

  it("transmet le Range demandé tel quel à l'amont", async () => {
    // Un PDF de plusieurs mégaoctets se lit page par page : si le Range n'est pas relayé, l'amont
    // renvoie tout le fichier à chaque saut de page. Correct, et inutilisable.
    const vus = espionner();
    await fetchAllowedFile(AUTORISEE, { range: "bytes=0-1023" }, { origins: [ORIGINE] });
    expect(vus[0].headers.range).toBe("bytes=0-1023");
  });

  it("n'invente aucun en-tête Range quand l'appelant n'en demande pas", async () => {
    // L'autre côté de la même branche : un `range` fabriqué ferait répondre 206 à une requête qui
    // attend 200, et certains lecteurs refusent la réponse partielle qu'ils n'ont pas demandée.
    const vus = espionner();
    await fetchAllowedFile(AUTORISEE, {}, { origins: [ORIGINE] });
    expect(vus[0].headers).not.toHaveProperty("range");
    expect(vus[0].headers["accept-encoding"]).toBe("identity");
  });
});
