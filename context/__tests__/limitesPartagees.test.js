// UN COMPTEUR EN MÉMOIRE EST DIVISÉ PAR LE NOMBRE D'INSTANCES, ET RIEN NE LE DIT.
//
// En serverless, plusieurs exécutions servent en parallèle et démarrent à froid : une limite de 120
// par heure en autorise 120 PAR INSTANCE. Elle existe, elle rassure, et elle ne limite qu'une
// fraction de ce qu'elle annonce.
//
// C'est le second hôte qui l'a relevé chez lui — il tourne sur ce contexte, et ne s'en était pas
// aperçu avant qu'on lui pose la question. Sa formulation : « un magasin partagé est une décision de
// contrat, pas de câblage ».

const { createStandaloneContext } = require("../standalone.js");

/** Une base en mémoire qui se comporte comme PostgREST sur cette table. */
function base({ table = true } = {}) {
  const lignes = new Map();
  const appels = [];
  return {
    appels, lignes,
    fetch: async (url, options = {}) => {
      const chemin = String(url).split("/rest/v1/")[1] || "";
      appels.push({ chemin, methode: (options.method || "GET").toUpperCase() });
      if (!table && chemin.startsWith("player_rate_limits")) {
        return { ok: false, status: 400, async text() { return 'relation "player_rate_limits" does not exist'; } };
      }
      if (chemin.startsWith("player_rate_limits")) {
        const cle = decodeURIComponent((chemin.match(/key=eq\.([^&]*)/) || [])[1] || "");
        // ⚠️ `request` lit `text()` et parse — pas `json()`. Ma première version répondait par
        // `json()` : la sonde recevait null, croyait la table absente, et le banc mesurait le repli
        // au lieu de la garantie. Un faux serveur doit répondre comme le vrai, pas comme on l'imagine.
        if (!options.method || options.method === "GET") {
          const l = lignes.get(cle);
          return { ok: true, status: 200, async text() { return JSON.stringify(l ? [l] : []); } };
        }
        const corps = options.body ? JSON.parse(options.body) : null;
        if (options.method === "POST") { const l = corps[0]; lignes.set(l.key, { ...l }); }
        else if (options.method === "PATCH") { lignes.set(cle, { ...lignes.get(cle), ...corps }); }
        return { ok: true, status: 200, async text() { return "[]"; } };
      }
      return { ok: true, status: 200, async text() { return "[]"; } };
    },
  };
}

function contexte(b) {
  const vraiFetch = globalThis.fetch;
  globalThis.fetch = b.fetch;
  // ⚠️ L'ENVIRONNEMENT SE PASSE DIRECTEMENT — j'avais supposé `{ env: … }`, et la base se croyait
  // non configurée : chaque appel échouait avant même d'atteindre le faux serveur. Lire la signature
  // aurait coûté dix secondes.
  const ctx = createStandaloneContext({
    SUPABASE_URL: "https://exemple.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "cle",
  });
  return { ctx, rendre: () => { globalThis.fetch = vraiFetch; } };
}

describe("les limites comptent pour l'instance, pas pour le processus", () => {
  it("le compte est partagé : il persiste dans la table", async () => {
    const b = base();
    const { ctx, rendre } = contexte(b);
    try {
      await ctx.limits.allow("hshare:1.2.3.4", 5, 3600);
      await ctx.limits.allow("hshare:1.2.3.4", 5, 3600);
      expect(b.lignes.get("hshare:1.2.3.4").count,
        "sans table, chaque instance repartirait de zéro").toBe(2);
    } finally { rendre(); }
  });

  it("au-delà du plafond, il refuse", async () => {
    const b = base();
    const { ctx, rendre } = contexte(b);
    try {
      b.lignes.set("x:1", { key: "x:1", count: 3, expires_at: new Date(Date.now() + 60_000).toISOString() });
      expect(await ctx.limits.allow("x:1", 3, 3600)).toBe(false);
    } finally { rendre(); }
  });

  it("une fenêtre expirée repart à un, sans purge", async () => {
    const b = base();
    const { ctx, rendre } = contexte(b);
    try {
      b.lignes.set("x:2", { key: "x:2", count: 99, expires_at: new Date(Date.now() - 1000).toISOString() });
      expect(await ctx.limits.allow("x:2", 3, 3600)).toBe(true);
      expect(b.lignes.get("x:2").count).toBe(1);
    } finally { rendre(); }
  });
});

// ⚠️ LE REFUS LOCAL EST TOUJOURS JUSTE, ET IL EST GRATUIT. Le compteur local ne voit que ce que CE
// processus a servi : il sous-compte toujours. S'il dépasse déjà, le partagé dépasse aussi.
describe("l'abus se refuse sans aller-retour", () => {
  it("une fois le plafond atteint localement, plus aucune requête ne part", async () => {
    const b = base();
    const { ctx, rendre } = contexte(b);
    try {
      for (let i = 0; i < 3; i++) await ctx.limits.allow("y:1", 3, 3600);
      const avant = b.appels.length;
      expect(await ctx.limits.allow("y:1", 3, 3600)).toBe(false);
      expect(b.appels.length, "refuser doit être gratuit, sinon l'abus coûte plus que l'usage")
        .toBe(avant);
    } finally { rendre(); }
  });
});

// ⚠️ LE CHEMIN DE LECTURE RESTE LOCAL : ses réponses viennent déjà d'un cache par slug, posé
// précisément pour ne rien coûter à la base. Y adosser un compteur partagé ferait payer à la garde
// le prix qu'on venait d'épargner à ce qu'elle garde.
describe("le chemin de lecture ne paie pas d'aller-retour", () => {
  it("une relecture publique ne touche pas la table des compteurs", async () => {
    const b = base();
    const { ctx, rendre } = contexte(b);
    try {
      await ctx.limits.allow("pread:1.2.3.4", 1000, 3600);
      expect(b.appels.some((a) => a.chemin.startsWith("player_rate_limits")),
        "sur ce chemin, la protection réelle est le cache, pas le compteur").toBe(false);
    } finally { rendre(); }
  });

  it("mais elle reste bornée localement", async () => {
    const b = base();
    const { ctx, rendre } = contexte(b);
    try {
      for (let i = 0; i < 2; i++) await ctx.limits.allow("pread:9.9.9.9", 2, 3600);
      expect(await ctx.limits.allow("pread:9.9.9.9", 2, 3600)).toBe(false);
    } finally { rendre(); }
  });
});

// ⚠️ SANS LA TABLE, ON RETOMBE SUR LE COMPORTEMENT D'AVANT — ET ON LE DIT. Refuser tout ferait
// d'une migration non appliquée une panne ; se taire laisserait un hôte croire ses limites serrées.
describe("un hôte qui n'a pas migré continue de servir", () => {
  it("les appels passent, comptés localement", async () => {
    const b = base({ table: false });
    const { ctx, rendre } = contexte(b);
    try {
      expect(await ctx.limits.allow("z:1", 2, 3600)).toBe(true);
      expect(await ctx.limits.allow("z:1", 2, 3600)).toBe(true);
      expect(await ctx.limits.allow("z:1", 2, 3600), "la limite locale s'applique toujours").toBe(false);
    } finally { rendre(); }
  });

  it("et la table n'est sondée qu'une fois", async () => {
    const b = base({ table: false });
    const { ctx, rendre } = contexte(b);
    try {
      for (let i = 0; i < 10; i++) await ctx.limits.allow(`z:${i}`, 50, 3600);
      const sondes = b.appels.filter((a) => a.chemin.includes("select=key"));
      expect(sondes.length, "une sonde par appel ferait payer l'absence de table à chaque requête")
        .toBe(1);
    } finally { rendre(); }
  });
});
