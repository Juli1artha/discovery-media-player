// LA BASE DU PLAYER ET L'ÉMETTEUR DES JETONS SONT DEUX CHOSES DIFFÉRENTES.
//
// `SUPABASE_URL` servait les deux rôles. C'est vrai — et même nécessaire — tant que le player et
// son application partagent un déploiement. C'est faux PAR CONSTRUCTION dès qu'une instance est
// séparée : la base appartient au player, l'identité appartient à l'hôte. Les membres du second
// hôte recevaient donc des jetons émis par un projet et vérifiés contre un autre, ce qui mettait
// toute la moitié « membre » de la surface hors d'atteinte — diffusion, statistiques,
// présentations authentifiées.
//
// ⚠️ Troisième hypothèse de cette forme en deux jours, après `'self'` pour l'encadrement et
// « même origine » pour l'aperçu. Elles ne se voient qu'en exerçant la séparation.

const { createStandaloneContext } = require("../standalone.js");

/** Capture l'appel réseau : c'est l'URL et la clé envoyées qui sont le sujet, pas la réponse. */
function espionner(reponse = { ok: true, json: async () => ({ email: "a@b.fr" }) }) {
  const appels = [];
  global.fetch = async (url, init) => {
    appels.push({ url: String(url), entetes: (init && init.headers) || {} });
    return reponse;
  };
  return appels;
}

const vraiFetch = global.fetch;
afterEach(() => { global.fetch = vraiFetch; });

const BASE = "https://labase.supabase.co";
const EMETTEUR = "https://lhote.supabase.co";

function contexte(env) {
  return createStandaloneContext({ SUPABASE_URL: BASE, SUPABASE_SERVICE_ROLE_KEY: "service", ...env });
}

describe("où le player va vérifier un jeton", () => {
  it("sans PLAYER_AUTH_URL : contre sa propre base — une instance existante ne change pas", async () => {
    const appels = espionner();
    const ctx = contexte({ SUPABASE_PUBLISHABLE_KEY: "publiable" });
    await ctx.identity.verifyToken("Bearer jeton");
    expect(appels[0].url).toBe(`${BASE}/auth/v1/user`);
    expect(appels[0].entetes.apikey).toBe("publiable");
  });

  it("avec PLAYER_AUTH_URL : contre l'émetteur de l'hôte", async () => {
    const appels = espionner();
    const ctx = contexte({ PLAYER_AUTH_URL: EMETTEUR, PLAYER_AUTH_KEY: "cle-hote" });
    await ctx.identity.verifyToken("Bearer jeton");
    expect(appels[0].url).toBe(`${EMETTEUR}/auth/v1/user`);
    expect(appels[0].entetes.apikey).toBe("cle-hote");
  });

  // Même leçon que `PLAYER_HOST_FETCH_BASE` : on normalise plutôt que de documenter.
  it("une barre finale de trop ne fabrique pas une URL absurde", async () => {
    const appels = espionner();
    const ctx = contexte({ PLAYER_AUTH_URL: `${EMETTEUR}//`, PLAYER_AUTH_KEY: "cle-hote" });
    await ctx.identity.verifyToken("Bearer jeton");
    expect(appels[0].url).toBe(`${EMETTEUR}/auth/v1/user`);
  });
});

// ⚠️ LE POINT QUI N'ÉTAIT PAS DANS LA DEMANDE, ET QUI COMPTE LE PLUS.
//
// Le repli de clé allait jusqu'à `SUPABASE_SERVICE_ROLE_KEY` — la clé maîtresse de NOTRE base,
// celle qui ouvre toutes les tables. Tant que l'émetteur était notre propre projet, l'envoyer
// était sans conséquence. Vers l'émetteur d'un TIERS, ce serait la lui remettre, sur une simple
// erreur de configuration. Un émetteur distinct exige donc sa propre clé.
describe("ce qui ne doit jamais partir vers un émetteur tiers", () => {
  it("la clé de service ne suit pas le repli vers un émetteur distinct", async () => {
    const appels = espionner();
    const ctx = contexte({ PLAYER_AUTH_URL: EMETTEUR, SUPABASE_PUBLISHABLE_KEY: "publiable" });
    await ctx.identity.verifyToken("Bearer jeton");
    expect(appels, "aucun appel ne doit partir sans clé propre").toHaveLength(0);
  });

  it("aucune clé de la base ne fuit vers l'émetteur, même publiable", async () => {
    const appels = espionner();
    const ctx = contexte({ PLAYER_AUTH_URL: EMETTEUR, PLAYER_AUTH_KEY: "cle-hote", SUPABASE_PUBLISHABLE_KEY: "publiable" });
    await ctx.identity.verifyToken("Bearer jeton");
    const envoye = JSON.stringify(appels[0].entetes);
    expect(envoye).not.toContain("publiable");
    expect(envoye).not.toContain("service");
  });

  // Un refus silencieux ressemble à un droit manquant : le membre est « non authentifié » et
  // personne ne sait pourquoi. C'est exactement la panne qu'on passe la semaine à retirer.
  it("une clé manquante se dit, au lieu de refuser en silence", async () => {
    espionner();
    const vus = [];
    const vraiErr = console.error;
    console.error = (...a) => vus.push(a.map(String).join(" "));
    try {
      const ctx = createStandaloneContext({ SUPABASE_URL: BASE, PLAYER_AUTH_URL: EMETTEUR });
      await ctx.identity.verifyToken("Bearer jeton");
    } finally { console.error = vraiErr; }
    expect(vus.join(" ")).toMatch(/PLAYER_AUTH_KEY/);
  });
});

describe("ce qui ne change pas", () => {
  it("sans jeton, personne n'est authentifié", async () => {
    espionner();
    const ctx = contexte({ PLAYER_AUTH_URL: EMETTEUR, PLAYER_AUTH_KEY: "cle-hote" });
    expect(await ctx.identity.verifyToken("")).toBeNull();
  });

  it("un émetteur qui refuse fait un refus, pas une exception", async () => {
    espionner({ ok: false, status: 401, json: async () => ({}) });
    const ctx = contexte({ PLAYER_AUTH_URL: EMETTEUR, PLAYER_AUTH_KEY: "cle-hote" });
    expect(await ctx.identity.verifyToken("Bearer faux")).toBeNull();
  });

  // ⚠️ Le rôle vient de l'émetteur, donc de l'hôte — et de `app_metadata` uniquement.
  // `user_metadata` est modifiable par l'utilisateur : s'y fier laisserait chacun choisir ses
  // droits, chez nous comme chez lui.
  it("le rôle se lit dans app_metadata, jamais dans user_metadata", () => {
    const ctx = contexte({});
    expect(ctx.identity.roleOf({ app_metadata: { role: "Admin" }, user_metadata: { role: "root" } })).toBe("admin");
    expect(ctx.identity.roleOf({ user_metadata: { role: "admin" } })).toBe("");
    expect(ctx.identity.isAdmin({ user_metadata: { role: "admin" } })).toBe(false);
  });
});
