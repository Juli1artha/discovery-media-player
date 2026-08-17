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

/**
 * Une base en mémoire qui se comporte comme PostgREST — et surtout comme la FONCTION.
 *
 * ⚠️ Elle modélise l'incrément ATOMIQUE : un seul geste, verdict rendu sur la valeur écrite. Une
 * doublure qui rejouerait lire-calculer-écrire ne pourrait pas distinguer le correctif du défaut,
 * puisque c'est précisément la séparation des deux gestes qui était le défaut.
 */
function base({ table = true, fonction = true } = {}) {
  const lignes = new Map();
  const appels = [];
  return {
    appels, lignes,
    fetch: async (url, options = {}) => {
      const chemin = String(url).split("/rest/v1/")[1] || "";
      appels.push({ chemin, methode: (options.method || "GET").toUpperCase() });

      if (chemin.startsWith("rpc/player_rate_limit_bump")) {
        // Migration non appliquée : PostgREST ne connaît pas la fonction.
        if (!fonction) return { ok: false, status: 404, async text() { return "Could not find the function"; } };
        const { p_key: cle, p_max: max, p_window_seconds: fenetre } = JSON.parse(options.body || "{}");
        const ligne = lignes.get(cle);
        // ⚠️ Une date se compare comme une DATE. La table rend des horodatages ISO, et comparer une
        // chaîne à un nombre répond « faux » sans rien dire — une fenêtre expirée passait alors pour
        // vivante, et l'essai accusait le correctif.
        const expiree = !ligne || new Date(ligne.expires_at).getTime() <= Date.now();
        const compte = expiree ? 1 : ligne.count + 1;
        const fin = expiree ? new Date(Date.now() + fenetre * 1000).toISOString() : ligne.expires_at;
        lignes.set(cle, { key: cle, count: compte, expires_at: fin });
        return { ok: true, async text() { return JSON.stringify([{ autorise: compte <= max, compte }]); } };
      }

      if (chemin.startsWith("player_rate_limits")) {
        // La sonde de présence de la table, seule lecture REST qui reste.
        if (!table) return { ok: false, status: 400, async text() { return 'relation "player_rate_limits" does not exist'; } };
        return { ok: true, async text() { return "[]"; } };
      }
      return { ok: true, async text() { return "[]"; } };
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

// ⚠️ L'ESSAI QUI JUSTIFIE TOUT LE CHANGEMENT — et le seul que l'ancienne implémentation ne pouvait
// pas passer. Lire, calculer, écrire : sous charge, c'est-à-dire exactement quand une limite sert à
// quelque chose, plusieurs requêtes lisent le même compte et écrivent chacune « ce compte + 1 ».
// Une limite qui ne tient que lorsque personne ne pousse ne limite rien.
describe("sous concurrence, la limite tient", () => {
  it("deux instances qui poussent en même temps ne dépassent pas le plafond commun", async () => {
    const b = base();
    // ⚠️ DEUX CONTEXTES, UNE SEULE TABLE — c'est la seule façon d'observer ce que le correctif
    // protège. Dans UN processus, l'étage local plafonne avant même que la base soit consultée :
    // un essai à un seul contexte mesurerait le compteur en mémoire et serait vert des deux côtés
    // du correctif. Ce que la fonction atomique garde, c'est ce que deux instances font ENSEMBLE.
    const a = contexte(b), z = contexte(b);
    try {
      const verdicts = await Promise.all([
        ...Array.from({ length: 8 }, () => a.ctx.limits.allow("charge:commune", 10, 3600)),
        ...Array.from({ length: 8 }, () => z.ctx.limits.allow("charge:commune", 10, 3600)),
      ]);
      // Seize tentatives, chacune sous le plafond LOCAL de son instance : sans compteur partagé
      // atomique, seize passeraient.
      expect(verdicts.filter(Boolean)).toHaveLength(10);
      expect(b.lignes.get("charge:commune").count).toBe(16);
    } finally { a.rendre(); z.rendre(); }
  });

  // Le chemin de migration, pris au sérieux : chez un hôte qui n'a pas appliqué la fonction,
  // PostgREST répond 404. On laisse passer — un 429 raté coûte moins cher qu'une visionneuse
  // morte — mais on le DIT, en nommant le fichier. Une garde qui s'ouvre en silence ne garde rien.
  it("sans la fonction, on laisse passer et on nomme la migration", async () => {
    const b = base({ fonction: false });
    const { ctx, rendre } = contexte(b);
    const dits = [];
    const vraiErr = console.error;
    console.error = (...a) => dits.push(a.join(" "));
    try {
      expect(await ctx.limits.allow("y:1", 5, 3600)).toBe(true);
      expect(await ctx.limits.allow("y:1", 5, 3600)).toBe(true);
      expect(dits.join(" ")).toContain("0004-limites-atomiques.sql");
      // Dit UNE fois, pas à chaque appel : un journal qui se répète devient un journal qu'on filtre.
      expect(dits.filter((l) => l.includes("0004-limites-atomiques")).length).toBe(1);
    } finally { console.error = vraiErr; rendre(); }
  });
});
