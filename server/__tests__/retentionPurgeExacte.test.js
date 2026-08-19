// LA PURGE COMPTE JUSTE, NE DÉPASSE PAS SON PLAFOND, ET NE LAISSE PAS D'ORPHELINS.
//
// ⚠️ TROIS P2 DU NEUVIÈME AUDIT :
//  1. le plafond était dépassable — `Math.ceil(plafond/taille)` tours × `taille` (250 devenait 400) ;
//  2. le dry-run recomptait le premier lot à chaque tour (pas de curseur) — 120 lignes rendaient
//     `examinees=300` au lieu de 120 ;
//  3. la présentation était supprimée même si tous ses messages n'étaient pas partis → orphelins
//     que le balayage suivant ne peut plus rattacher.
// Ce banc modélise un vrai pool paginé par curseur keyset (`id=gt.…`, portable — pas d'`offset`),
// compte les identifiants réellement supprimés (return=representation), et confronte les nombres.

const retention = require("../retention.js");
const schema = require("../schema.js");

// Un pool ordonné, paginé par `col=gt.curseur`, supprimé par `col=in.(…)` avec retour des lignes.
function poolTable(table, col, n) {
  return { table, col, lignes: Array.from({ length: n }, (_, i) => ({ [col]: `${table}-${String(i).padStart(6, "0")}` })) };
}

function harnais({ pools = [], remove = null, dryRun, taille, plafond } = {}) {
  const parTable = Object.fromEntries(pools.map((p) => [p.table, p]));
  const supprimesIds = {};
  const taillesDelete = [];
  const ctx = {
    db: {
      async request(chemin, o = {}) {
        const m = o.method || "GET";
        const table = chemin.split("?")[0];
        const p = parTable[table];
        if (chemin.startsWith("commercial_doc_shares?select=revoked_at")) return [];
        if (chemin.startsWith("doc_presentations?active=eq.false")) return (parTable.doc_presentations && parTable.doc_presentations.lignes.slice(0, 500)) || [];
        if (!p) { if (m === "DELETE") return []; return []; }
        if (m === "DELETE") {
          const dedans = chemin.slice(chemin.indexOf("in.(") + 4, chemin.lastIndexOf(")"));
          const vals = dedans.split(",").map((v) => v.replace(/^"|"$/g, ""));
          const partis = p.lignes.filter((l) => vals.includes(String(l[p.col])));
          p.lignes = p.lignes.filter((l) => !vals.includes(String(l[p.col])));
          (supprimesIds[table] ||= []).push(...partis.map((l) => l[p.col]));
          taillesDelete.push(vals.length);
          return chemin.includes("select=") ? partis.map((l) => ({ [p.col]: l[p.col] })) : [];  // return=representation
        }
        // SELECT : curseur keyset + limite
        const lim = Number(/limit=(\d+)/.exec(chemin)?.[1] || 999);
        const gt = /[?&][a-z_]+=gt\.([^&]+)/.exec(chemin);
        let res = p.lignes;
        if (gt) { const c = decodeURIComponent(gt[1]); res = res.filter((l) => String(l[p.col]) > c); }
        res = [...res].sort((a, b) => (a[p.col] < b[p.col] ? -1 : 1));
        return res.slice(0, lim).map((l) => ({ ...l }));
      },
      async selectAll() { return []; },
    },
    storage: remove ? { remove } : {},
    limits: { async allow() { return true; } },
    errors: { capture() {} },
    config: { supabaseUrl: "https://x.supabase.co", retention: {} },
  };
  retention.init(ctx); schema.init(ctx);
  require("../presentations.js").init(ctx);
  return { supprimesIds, taillesDelete, parTable, opts: { dryRun, taille, plafond } };
}

describe("purge exacte", () => {
  it("le plafond N'EST JAMAIS dépassé — taille 200, plafond 250, 300 lignes → 250 supprimées", async () => {
    const h = harnais({ pools: [poolTable("commercial_doc_views", "id", 300)] });
    const r = await retention.purgerRetention(Date.now(), { taille: 200, plafond: 250 });
    const dets = (h.supprimesIds.commercial_doc_views || []).length;
    expect(dets, "jamais plus que le plafond").toBeLessThanOrEqual(250);
    expect(r.rapport.commercial_doc_views.tronque, "il reste → tronqué").toBe(true);
  });

  it("le dry-run compte EXACTEMENT — 120 lignes, taille 50, plafond 300 → examinees 120, zéro DELETE", async () => {
    const h = harnais({ pools: [poolTable("commercial_doc_views", "id", 120)] });
    const r = await retention.purgerRetention(Date.now(), { dryRun: true, taille: 50, plafond: 300 });
    expect(r.rapport.commercial_doc_views.examinees, "le vrai total, pas le plafond re-compté").toBe(120);
    expect((h.supprimesIds.commercial_doc_views || []).length).toBe(0);
    expect(r.rapport.commercial_doc_views.tronque, "120 < 300 → rien ne reste").toBe(false);
  });

  it("dry-run : exactement le plafond, rien au-delà → tronque false ; plafond+1 → tronque true", async () => {
    const a = harnais({ pools: [poolTable("commercial_doc_views", "id", 100)] });
    const ra = await retention.purgerRetention(Date.now(), { dryRun: true, taille: 50, plafond: 100 });
    expect(ra.rapport.commercial_doc_views.tronque, "pile le plafond, rien de plus").toBe(false);
    const b = harnais({ pools: [poolTable("commercial_doc_views", "id", 101)] });
    const rb = await retention.purgerRetention(Date.now(), { dryRun: true, taille: 50, plafond: 100 });
    expect(rb.rapport.commercial_doc_views.tronque, "une de plus que le plafond → il reste").toBe(true);
  });

  it("aucun DELETE ne porte plus d'ids que la taille de lot (250 lignes, taille 100)", async () => {
    const h = harnais({ pools: [poolTable("commercial_doc_views", "id", 250)] });
    await retention.purgerRetention(Date.now(), { taille: 100, plafond: 5000 });
    for (const n of h.taillesDelete) expect(n, "un lot ne dépasse jamais la taille").toBeLessThanOrEqual(100);
    expect((h.supprimesIds.commercial_doc_views || []).length, "les 250 finissent par partir").toBe(250);
  });

  it("un DELETE compte les lignes RENDUES, pas les ids présélectionnés", async () => {
    const h = harnais({ pools: [poolTable("commercial_doc_views", "id", 30)] });
    const r = await retention.purgerRetention(Date.now(), { taille: 50, plafond: 300 });
    expect(r.rapport.commercial_doc_views.supprimees).toBe(30);
    expect((h.supprimesIds.commercial_doc_views || []).length).toBe(30);
  });
});

describe("parent et enfants — jamais d'orphelin", () => {
  function harnaisPresentation(nbMessages) {
    const pres = poolTable("doc_presentations", "slug", 0);
    pres.lignes = [{ slug: "p-morte" }];
    const msgs = poolTable("doc_presentation_messages", "id", nbMessages);
    const att = poolTable("doc_presentation_attendees", "attendee_key", 2);
    return harnais({ pools: [pres, msgs, att] });
  }

  it("6 000 messages, plafond 5 000 : 1er passage garde le parent, 2e le supprime", async () => {
    const h = harnaisPresentation(6000);
    const r1 = await retention.purgerRetention(Date.now(), { taille: 500, plafond: 5000 });
    expect(r1.rapport.presentations.messages, "5 000 messages partis au 1er passage").toBe(5000);
    expect(h.parTable.doc_presentations.lignes.length, "le parent RESTE tant qu'il a des enfants").toBe(1);
    expect(r1.rapport.presentations.supprimees, "aucune présentation supprimée").toBe(0);

    const r2 = await retention.purgerRetention(Date.now(), { taille: 500, plafond: 5000 });
    expect(r2.rapport.presentations.messages, "les 1 000 restants partent").toBe(1000);
    expect(h.parTable.doc_presentations.lignes.length, "le parent part une fois vidé").toBe(0);
    expect(h.parTable.doc_presentation_messages.lignes.length, "zéro message orphelin").toBe(0);
  });
});
