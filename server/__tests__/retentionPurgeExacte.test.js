// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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

// ⚠️ CE HARNAIS IGNORE DÉLIBÉRÉMENT LES PRÉDICATS AUTRES QUE `in.(…)` AU DELETE, ET C'EST
// EXACTEMENT POURQUOI IL N'A PAS PU VOIR LE DÉFAUT DU 12/09. Ses pools n'ont qu'une colonne
// d'identifiant : leur faire appliquer `last_at=lt.…` ne filtrerait rien, puisque la date n'existe
// pas dans la donnée modélisée. Une éprouvette qui modélise une base indifférente aux prédicats rend
// le prédicat MANQUANT invisible — aucune assertion écrite au-dessus d'elle ne pouvait le voir.
// Le bloc « une ligne redevenue active » en bas de ce fichier porte sa propre éprouvette, qui APPLIQUE
// les prédicats. Deux modèles, et celui qui compte est nommé.

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
        if (chemin.startsWith("doc_presentations?active=eq.false")) {
          const limMortes = Number(/limit=(\d+)/.exec(chemin)?.[1] || 999);
          return (parTable.doc_presentations && parTable.doc_presentations.lignes.slice(0, limMortes)) || [];
        }
        if (!p) { if (m === "DELETE") return []; return []; }
        if (m === "DELETE") {
          const dedans = chemin.slice(chemin.indexOf("in.(") + 4, chemin.lastIndexOf(")"));
          const vals = dedans.split(",").map((v) => decodeURIComponent(v).replace(/^"|"$/g, ""));
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
        const slugF = /[?&]slug=eq\.([^&]+)/.exec(chemin);
        if (slugF) { const sv = decodeURIComponent(slugF[1]); res = res.filter((l) => l.slug === undefined || l.slug === sv); }
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
    harnais({ pools: [poolTable("commercial_doc_views", "id", 100)] });
    const ra = await retention.purgerRetention(Date.now(), { dryRun: true, taille: 50, plafond: 100 });
    expect(ra.rapport.commercial_doc_views.tronque, "pile le plafond, rien de plus").toBe(false);
    harnais({ pools: [poolTable("commercial_doc_views", "id", 101)] });
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

describe("le plafond est GLOBAL aux présentations, pas par présentation", () => {
  function harnaisPlusieurs(nParImages) {
    const pres = poolTable("doc_presentations", "slug", 0);
    pres.lignes = nParImages.map((_, i) => ({ slug: `p${i}` }));
    const msgs = [];
    nParImages.forEach((n, i) => { for (let k = 0; k < n; k++) msgs.push({ id: `p${i}-m${String(k).padStart(4, "0")}`, slug: `p${i}` }); });
    const poolMsgs = { table: "doc_presentation_messages", col: "id", lignes: msgs };
    const att = { table: "doc_presentation_attendees", col: "attendee_key", lignes: [] };
    // Le harnais filtre les messages par slug via le curseur ; on ajoute un filtre slug.
    const h = harnais({ pools: [pres, poolMsgs, att] });
    return h;
  }

  it("3 présentations, plafond 1 → UN SEUL message supprimé au total (budget global)", async () => {
    const h = harnaisPlusieurs([5, 5, 5]);
    // Le harnais doit filtrer les messages par slug — on patche le pool pour le respecter.
    await retention.purgerRetention(Date.now(), { taille: 1, plafond: 1 });
    const total = (h.supprimesIds.doc_presentation_messages || []).length;
    expect(total, "le plafond 1 est global : un seul message, pas un par présentation").toBe(1);
  });
});

describe("le rapport dryRun est complet pour les présentations", () => {
  it("1 présentation, 3 messages, 2 présences → examinés remontés, zéro DELETE", async () => {
    const pres = poolTable("doc_presentations", "slug", 0); pres.lignes = [{ slug: "p-d" }];
    const msgs = { table: "doc_presentation_messages", col: "id", lignes: [
      { id: "p-d-m1", slug: "p-d" }, { id: "p-d-m2", slug: "p-d" }, { id: "p-d-m3", slug: "p-d" }] };
    const att = { table: "doc_presentation_attendees", col: "attendee_key", lignes: [
      { attendee_key: "p-d-a1", slug: "p-d" }, { attendee_key: "p-d-a2", slug: "p-d" }] };
    const h = harnais({ pools: [pres, msgs, att] });
    const r = await retention.purgerRetention(Date.now(), { dryRun: true });
    const pr = r.rapport.presentations;
    expect(pr.messagesExaminees, "le dry-run dit combien de messages partiraient").toBe(3);
    expect(pr.presencesExaminees, "et combien de présences").toBe(2);
    expect((h.supprimesIds.doc_presentation_messages || []).length, "zéro DELETE en dry-run").toBe(0);
    expect(r.efface.doc_presentation_messages, "efface.* reste 0 en simulation").toBe(0);
  });
});

describe("le rapport tronque dit la vérité pour les présentations", () => {
  function harnaisPres(nbMessages) {
    const pres = poolTable("doc_presentations", "slug", 0); pres.lignes = [{ slug: "pt" }];
    const msgs = { table: "doc_presentation_messages", col: "id", lignes:
      Array.from({ length: nbMessages }, (_, k) => ({ id: `pt-m${k}`, slug: "pt" })) };
    const att = { table: "doc_presentation_attendees", col: "attendee_key", lignes: [] };
    return harnais({ pools: [pres, msgs, att] });
  }

  it("2 messages, plafond 1 → tronque true (un reste), parent gardé", async () => {
    const h = harnaisPres(2);
    const r = await retention.purgerRetention(Date.now(), { taille: 1, plafond: 1 });
    expect(r.rapport.presentations.tronque, "un message reste → rapport tronqué").toBe(true);
    expect(h.parTable.doc_presentations.lignes.length, "le parent est gardé").toBe(1);
  });

  it("le même scénario en dryRun → tronque true (la supervision voit qu'il resterait à faire)", async () => {
    harnaisPres(2);
    const r = await retention.purgerRetention(Date.now(), { dryRun: true, taille: 1, plafond: 1 });
    expect(r.rapport.presentations.tronque).toBe(true);
  });

  it("exactement 1 message, plafond 1, aucun reste → tronque false, parent supprimé", async () => {
    const h = harnaisPres(1);
    const r = await retention.purgerRetention(Date.now(), { taille: 1, plafond: 1 });
    expect(r.rapport.presentations.tronque, "tout est parti → non tronqué").toBe(false);
    expect(h.parTable.doc_presentations.lignes.length, "le parent part une fois vidé").toBe(0);
  });

  it("présence tronquée sans message tronqué → rapport global tronqué", async () => {
    const pres = poolTable("doc_presentations", "slug", 0); pres.lignes = [{ slug: "pt" }];
    const msgs = { table: "doc_presentation_messages", col: "id", lignes: [{ id: "pt-m0", slug: "pt" }] };
    const att = { table: "doc_presentation_attendees", col: "attendee_key", lignes:
      [{ attendee_key: "pt-a0", slug: "pt" }, { attendee_key: "pt-a1", slug: "pt" }] };
    const h = harnais({ pools: [pres, msgs, att] });
    const r = await retention.purgerRetention(Date.now(), { taille: 1, plafond: 1 });
    expect(r.rapport.presentations.tronque, "une présence reste → tronqué même si les messages sont finis").toBe(true);
    expect(h.parTable.doc_presentations.lignes.length, "parent gardé tant qu'une présence reste").toBe(1);
  });
});

describe("l'off-by-one des 500 présentations", () => {
  function harnaisN(nbPres) {
    const pres = poolTable("doc_presentations", "slug", nbPres);   // nbPres présentations mortes
    // pas de messages ni présences : chaque présentation se supprime au premier passage
    return harnais({ pools: [pres, poolTable("doc_presentation_messages", "id", 0), poolTable("doc_presentation_attendees", "attendee_key", 0)] });
  }

  it("exactement 500 présentations, aucune 501e → tronque false", async () => {
    harnaisN(500);
    const r = await retention.purgerRetention(Date.now());
    expect(r.rapport.presentations.examinees, "les 500 sont traitées").toBe(500);
    expect(r.rapport.presentations.tronque, "pile 500, rien après → non tronqué").toBe(false);
  });

  it("501 présentations → seules 500 traitées, tronque true", async () => {
    harnaisN(501);
    const r = await retention.purgerRetention(Date.now());
    expect(r.rapport.presentations.examinees, "on n'en traite que 500 par exécution").toBe(500);
    expect(r.rapport.presentations.tronque, "une 501e existe → tronqué").toBe(true);
  });
});

// ⚠️ UNE LIGNE REDEVENUE ACTIVE NE DOIT PAS ÊTRE SUPPRIMÉE — ET ELLE L'ÉTAIT (audit externe, 12/09).
//
// La purge SÉLECTIONNE par date puis supprimait par IDENTIFIANT SEUL. Entre les deux requêtes, un
// battement peut rafraîchir la ligne : elle n'est plus vieille, et elle partait quand même, jugée
// sur une date qui n'était plus la sienne. C'est destructeur et silencieux — le rapport annonçait
// même « 1 supprimée », ce qui était vrai et trompeur.
//
// ⚠️ L'ÉPROUVETTE CI-DESSOUS APPLIQUE LES PRÉDICATS DE L'URL, comme le fait PostgREST. C'est la
// seule façon de voir un prédicat manquant : contre une base qui les ignore, l'URL fautive et l'URL
// correcte produisent le même résultat.
describe("⚠️ le prédicat de purge voyage avec le DELETE", () => {
  /** Une base qui applique `last_at=lt.` ET `session_id=in.()`, et dont une ligne se rafraîchit après le SELECT. */
  function baseQuiApplique({ battementApresSelect }) {
    let lignes = [{ session_id: "vivante", last_at: "2020-01-01T00:00:00.000Z" }];
    const urls = [];
    const borneDe = (chemin) => {
      const m = /last_at=lt\.([^&]+)/.exec(chemin);
      return m ? decodeURIComponent(m[1]) : null;
    };
    const ctx = {
      errors: { capture() {} },
      limits: { async allow() { return true; } },
      config: { supabaseUrl: "https://x.supabase.co", retention: {} },
      db: {
        async request(chemin, o = {}) {
          const methode = (o.method || "GET").toUpperCase();
          if (!chemin.startsWith("commercial_doc_sessions")) return [];
          urls.push(`${methode} ${chemin}`);
          const borne = borneDe(chemin);
          if (methode === "DELETE") {
            const m = /session_id=in\.\(([^)]*)\)/.exec(chemin);
            const cles = (m ? m[1].split(",") : []).map((v) => decodeURIComponent(v).replace(/^"|"$/g, ""));
            const partis = lignes.filter((r) => cles.includes(r.session_id) && (!borne || r.last_at < borne));
            lignes = lignes.filter((r) => !partis.includes(r));
            return partis.map((r) => ({ session_id: r.session_id }));
          }
          const res = lignes.filter((r) => !borne || r.last_at < borne);
          if (battementApresSelect && res.length) {
            lignes = lignes.map((r) => ({ ...r, last_at: "2026-09-12T00:00:00.000Z" }));
          }
          return res.map((r) => ({ session_id: r.session_id }));
        },
        async selectAll() { return []; },
      },
    };
    retention.init(ctx); schema.init(ctx);
    require("../presentations.js").init(ctx);
    return { urls, restantes: () => lignes };
  }

  const MAINTENANT = Date.UTC(2026, 8, 12);

  it("⚠️ un battement entre le SELECT et le DELETE sauve la ligne — elle n'est plus vieille", async () => {
    const { urls, restantes } = baseQuiApplique({ battementApresSelect: true });
    const r = await retention.purgerRetention(MAINTENANT, {});

    const del = urls.find((u) => u.startsWith("DELETE"));
    expect(del, "un DELETE a bien été tenté").toBeTruthy();
    expect(del, "sans le prédicat de date, la base n'a plus aucune raison d'épargner la ligne")
      .toMatch(/last_at=lt\./);
    expect(restantes(), "la ligne a été rafraîchie : la supprimer détruirait une session VIVANTE")
      .toHaveLength(1);
    expect(r.rapport.commercial_doc_sessions.supprimees,
      "`select=` ne rend que ce qui est RÉELLEMENT parti : le compte reste honnête quand la base refuse")
      .toBe(0);
  });

  it("sans battement, la ligne vieille part normalement — la correction ne bloque pas la purge", async () => {
    const { restantes } = baseQuiApplique({ battementApresSelect: false });
    const r = await retention.purgerRetention(MAINTENANT, {});
    expect(restantes()).toHaveLength(0);
    expect(r.rapport.commercial_doc_sessions.supprimees).toBe(1);
  });

  // ⚠️ LA BORNE, PARCE QU'UNE GRANDEUR QUI NE PEUT PAS SORTIR DE SES BORNES EST LE SEUL TÉMOIN
  // GRATUIT D'UNE DÉFINITION. « Supprimées » ne peut pas dépasser « examinées » : au-dessus, le
  // rapport compterait des lignes que la sélection n'a jamais vues.
  it("⚠️ borne : supprimées ≤ examinées, dans les deux régimes", async () => {
    for (const battementApresSelect of [true, false]) {
      baseQuiApplique({ battementApresSelect });
      const r = await retention.purgerRetention(MAINTENANT, {});
      const c = r.rapport.commercial_doc_sessions;
      expect(c.supprimees, `régime battement=${battementApresSelect}`).toBeLessThanOrEqual(c.examinees);
      expect(c.supprimees).toBeGreaterThanOrEqual(0);
    }
  });
});

// ⚠️ UN PARENT NE SURVIT PAS À UN ENFANT RETENU — ET C'EST LE CORRECTIF D'UN DÉFAUT QUI FAILLIT EN
// ROUVRIR UN AUTRE.
//
// Le neuvième audit avait fermé l'orphelin « la présentation part alors qu'il reste des messages » :
// la condition exige que rien ne soit TRONQUÉ. Le correctif du 12/09 introduit une SECONDE façon de
// ne pas être parti — un message dont le fichier a résisté est gardé exprès, sans que `tronque` soit
// posé. La condition ne la connaissait pas : le parent serait parti au-dessus d'un enfant retenu,
// exactement l'orphelin déjà fermé, rouvert par la réparation d'autre chose.
describe("⚠️ un message dont la pièce jointe a résisté retient sa ligne ET son parent", () => {
  function base({ remove }) {
    let messages = [
      { id: "m-1", slug: "s-a", attachment: { url: "https://x.supabase.co/storage/v1/object/public/present-attachments/s-a/un.png" } },
      { id: "m-2", slug: "s-a", attachment: { url: "https://x.supabase.co/storage/v1/object/public/present-attachments/s-a/deux.png" } },
    ];
    let presentations = [{ slug: "s-a" }];
    const ctx = {
      errors: { capture() {} },
      limits: { async allow() { return true; } },
      config: { supabaseUrl: "https://x.supabase.co", retention: {} },
      storage: { remove },
      db: {
        async request(chemin, o = {}) {
          const methode = (o.method || "GET").toUpperCase();
          const table = chemin.split("?")[0];
          if (chemin.startsWith("doc_presentations?active=eq.false")) return presentations.map((p) => ({ ...p }));
          if (methode === "DELETE") {
            const m = /(?:id|slug)=in\.\(([^)]*)\)/.exec(chemin);
            const cles = (m ? m[1].split(",") : []).map((v) => decodeURIComponent(v).replace(/^"|"$/g, ""));
            if (table === "doc_presentation_messages") {
              const partis = messages.filter((r) => cles.includes(r.id));
              messages = messages.filter((r) => !cles.includes(r.id));
              return partis.map((r) => ({ id: r.id }));
            }
            if (table === "doc_presentations") {
              const partis = presentations.filter((r) => cles.includes(r.slug));
              presentations = presentations.filter((r) => !cles.includes(r.slug));
              return partis.map((r) => ({ slug: r.slug }));
            }
            return [];
          }
          if (table === "doc_presentation_messages") {
            const gt = /id=gt\.([^&]+)/.exec(chemin);
            let res = [...messages].sort((a, b) => (a.id < b.id ? -1 : 1));
            if (gt) { const c = decodeURIComponent(gt[1]); res = res.filter((r) => r.id > c); }
            const lim = Number(/limit=(\d+)/.exec(chemin)?.[1] || 999);
            return res.slice(0, lim).map((r) => ({ id: r.id, attachment: r.attachment }));
          }
          if (table === "doc_presentations") {
            const lim = Number(/limit=(\d+)/.exec(chemin)?.[1] || 999);
            return presentations.slice(0, lim).map((p) => ({ ...p }));
          }
          return [];
        },
        async selectAll() { return []; },
      },
    };
    retention.init(ctx); schema.init(ctx);
    require("../presentations.js").init(ctx);
    return { messages: () => messages, presentations: () => presentations };
  }

  const MAINTENANT = Date.UTC(2026, 8, 12);

  it("⚠️ le retrait échoue sur UNE pièce jointe : cette ligne reste, et la présentation aussi", async () => {
    const etat = base({ remove: async (bucket, chemin) => !String(chemin).endsWith("deux.png") });
    const r = await retention.purgerRetention(MAINTENANT, {});
    const pres = r.rapport.presentations;

    expect(etat.messages().map((m) => m.id),
      "le message dont le fichier a résisté garde le seul chemin qui mène à ce fichier")
      .toEqual(["m-2"]);
    expect(pres.retenues, "une ligne gardée exprès doit se lire dans le rapport").toBe(1);
    expect(etat.presentations(),
      "supprimer le parent au-dessus d'un enfant retenu rouvrirait l'orphelin du neuvième audit")
      .toHaveLength(1);
  });

  it("tout se retire : la ligne ET le parent partent — la correction ne bloque pas la purge", async () => {
    const etat = base({ remove: async () => true });
    const r = await retention.purgerRetention(MAINTENANT, {});
    expect(etat.messages()).toHaveLength(0);
    expect(r.rapport.presentations.retenues).toBe(0);
    expect(etat.presentations(), "rien ne retient plus le parent").toHaveLength(0);
  });
});
