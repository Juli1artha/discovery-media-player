// UNE DOUBLURE QUI MENT EST PIRE QUE PAS DE DOUBLURE.
//
// Ce faux PostgREST sert de base aux essais de bout en bout : la visionneuse tracée et la page
// d'audience passent par lui. S'il répond « aucun résultat » à une requête qu'il n'a pas comprise,
// tous ces essais deviennent verts en ne mesurant rien — et pire, ils resteront verts le jour où le
// player commencera à poser une requête qu'il ne sait pas traiter.
//
// ⚠️ CE QUI EST VÉRIFIÉ ICI EN PREMIER, C'EST DONC LE REFUS. Le reste — filtres, tri, écriture —
// n'a de valeur que parce qu'un 400 attend tout ce qui sort du chemin connu.

const { creerPostgrestEnMemoire } = require("../postgrest-en-memoire.cjs");

async function avecServeur(tables, essai) {
  const { serveur } = creerPostgrestEnMemoire(tables);
  await new Promise((r) => serveur.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${serveur.address().port}/rest/v1/`;
  try { return await essai(base, tables); } finally { serveur.close(); }
}

const lire = async (base, chemin) => {
  const r = await fetch(base + chemin);
  return { code: r.status, corps: await r.json().catch(() => null) };
};

describe("la base d'essai refuse plutôt que d'inventer", () => {
  it("un filtre qu'elle ne connaît pas donne un 400 qui le NOMME", async () => {
    await avecServeur({ t: [{ id: 1, nom: "a" }] }, async (base) => {
      const { code, corps } = await lire(base, "t?nom=like.*a*");
      expect(code).toBe(400);
      // Le message doit contenir la requête fautive : sans ça, on cherche le défaut dans le player
      // alors qu'il est dans la doublure.
      expect(corps.message).toContain("nom=like.*a*");
    });
  });

  it("une méthode non implémentée ne passe pas pour un succès", async () => {
    await avecServeur({ t: [] }, async (base) => {
      const r = await fetch(base + "t", { method: "PUT", body: "{}" });
      expect(r.status).toBe(405);
    });
  });

  // `offset` est interdit par la garde de portabilité de la forge : le rencontrer ici voudrait dire
  // que quelque chose est passé à travers. On refuse, plutôt que de faire semblant de savoir.
  it("refuse ce que la garde de portabilité interdit déjà", async () => {
    await avecServeur({ t: [] }, async (base) => {
      expect((await lire(base, "t?offset=10")).code).toBe(400);
    });
  });
});

describe("la base d'essai répond comme PostgREST sur ce qu'elle couvre", () => {
  it("filtre, projette, trie et borne", async () => {
    const tables = {
      t: [
        { id: 1, slug: "a", rang: "3", cache: "x" },
        { id: 2, slug: "b", rang: "1", cache: "y" },
        { id: 3, slug: "a", rang: "2", cache: "z" },
      ],
    };
    await avecServeur(tables, async (base) => {
      expect((await lire(base, "t?slug=eq.a&select=*")).corps).toHaveLength(2);
      // La projection ne rend QUE les colonnes demandées — un essai qui lirait une colonne non
      // demandée passerait ici et échouerait en production.
      expect((await lire(base, "t?slug=eq.b&select=slug,rang")).corps[0]).toEqual({ slug: "b", rang: "1" });
      expect((await lire(base, "t?select=rang&order=rang.desc&limit=2")).corps.map((l) => l.rang)).toEqual(["3", "2"]);
      expect((await lire(base, "t?slug=in.(a,b)&select=id")).corps).toHaveLength(3);
    });
  });

  // ⚠️ `not.is.true` VEUT DIRE « PAS VRAI », donc `null` compris. C'est ce qui distingue un partage
  // d'essai d'un partage ordinaire dont la colonne n'a jamais été renseignée : traiter `null` comme
  // exclu ferait disparaître les partages les plus anciens des statistiques.
  it("« pas vrai » inclut la colonne jamais renseignée", async () => {
    const tables = { t: [{ id: 1, is_test: true }, { id: 2, is_test: false }, { id: 3, is_test: null }] };
    await avecServeur(tables, async (base) => {
      expect((await lire(base, "t?is_test=not.is.true&select=id")).corps.map((l) => l.id)).toEqual([2, 3]);
    });
  });

  it("écrit, fusionne sur conflit, et rend ce qu'on lui demande de rendre", async () => {
    await avecServeur({}, async (base, tables) => {
      // `return=minimal` : rien dans le corps, la ligne en table.
      await fetch(base + "s", { method: "POST", headers: { Prefer: "return=minimal", "Content-Type": "application/json" }, body: JSON.stringify([{ session_id: "s1", vues: 1 }]) });
      expect(tables.s).toHaveLength(1);

      // `on_conflict` + `merge-duplicates` : la même clé met à jour au lieu d'ajouter.
      await fetch(base + "s?on_conflict=session_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal", "Content-Type": "application/json" }, body: JSON.stringify([{ session_id: "s1", vues: 2 }]) });
      expect(tables.s).toHaveLength(1);
      expect(tables.s[0].vues).toBe(2);

      // `return=representation` : la ligne écrite revient, projetée.
      const r = await fetch(base + "s?session_id=eq.s1&select=vues", { method: "PATCH", headers: { Prefer: "return=representation", "Content-Type": "application/json" }, body: JSON.stringify({ vues: 9 }) });
      expect(await r.json()).toEqual([{ vues: 9 }]);
    });
  });

  it("la pagination par Range est celle que selectAll utilise", async () => {
    const tables = { t: Array.from({ length: 5 }, (_, i) => ({ id: i + 1 })) };
    await avecServeur(tables, async (base) => {
      const r = await fetch(base + "t?select=id", { headers: { Range: "2-3" } });
      expect((await r.json()).map((l) => l.id)).toEqual([3, 4]);
    });
  });
});
