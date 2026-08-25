// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA PURGE, CONTRE UNE VRAIE BASE — la moitié « déclaration » du contrat de rétention.
//
// Ce banc sème des lignes VIEILLES (au-delà des fenêtres de docs/RETENTION.md) et leurs jumelles
// FRAÎCHES dans chaque table du périmètre, lance la purge, et confronte :
//   1. le DÉCLARÉ — chaque compte rendu par la purge doit être exactement le nombre semé ;
//   2. les SURVIVANTES — les jumelles fraîches doivent être intactes (une purge qui surefface
//      est aussi fausse qu'une purge qui oublie, et seule la paire attrape les deux sens).
// La moitié « recensement indépendant » n'est PAS ici : c'est une étape de forge qui exécute
// supabase/recensement-retention.sql en SQL nu, après ce banc, sur la même base.
//
// ⚠️ L'archive scellée (trigger 0007/0010) bloque INSERT et UPDATE sur les messages d'une
// présentation inactive — pas DELETE. On sème donc les messages pendant que la présentation est
// ACTIVE, puis on la ferme et on la vieillit.

const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";
if (process.env.CI && !(BASE && SECRET)) {
  throw new Error("banc vraie base : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents.");
}
const skip = !(BASE && SECRET);

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
const jeton = () => {
  const crypto = require("node:crypto");
  const tete = b64({ alg: "HS256", typ: "JWT" });
  const corps = b64({ role: process.env.PLAYER_TEST_ROLE || "player_test" });
  const sig = crypto.createHmac("sha256", SECRET).update(`${tete}.${corps}`).digest("base64url");
  return `${tete}.${corps}.${sig}`;
};

let retention, base;

describe.skipIf(skip)("rétention : le déclaré et les survivantes", () => {
  const IL_Y_A = (mois) => { const d = new Date(); d.setMonth(d.getMonth() - mois); return d.toISOString(); };
  const RECENT = new Date().toISOString();

  beforeAll(async () => {
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    const contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    require("../server/handler.js").init(contexte);
    retention = require("../server/retention.js");
    base = contexte.db;

    // Journaux : une vieille + une fraîche par table.
    await base.request("commercial_doc_views", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { slug: "ret-v", doc_id: "ret-doc", event: "view", at: IL_Y_A(14), ua: "vieux" },
      { slug: "ret-v", doc_id: "ret-doc", event: "view", at: RECENT, ua: "frais" },
    ] });
    await base.request("commercial_doc_sessions", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { session_id: "ret-s-vieille", slug: "ret-v", doc_id: "ret-doc", ip: "203.0.113.7", last_at: IL_Y_A(14), started_at: IL_Y_A(14) },
      { session_id: "ret-s-fraiche", slug: "ret-v", doc_id: "ret-doc", ip: "203.0.113.8", last_at: RECENT, started_at: RECENT },
    ] });
    await base.request("commercial_doc_internal_sessions", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { session_id: "ret-i-vieille", doc_id: "ret-doc", user_email: "vieux@exemple.fr", last_at: IL_Y_A(14), started_at: IL_Y_A(14) },
      { session_id: "ret-i-fraiche", doc_id: "ret-doc", user_email: "frais@exemple.fr", last_at: RECENT, started_at: RECENT },
    ] });
    await base.request("doc_bot_sessions", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { id: "ret-b-vieille", share_slug: "ret-l-vivant", doc_id: "ret-doc", last_at: IL_Y_A(14), created_at: IL_Y_A(14) },
      { id: "ret-b-fraiche", share_slug: "ret-l-vivant", doc_id: "ret-doc", last_at: RECENT, created_at: RECENT },
    ] });
    await base.request("player_rate_limits", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { key: "ret-limite-expiree", count: 1, expires_at: IL_Y_A(1) },
      { key: "ret-limite-vivante", count: 1, expires_at: new Date(Date.now() + 3600_000).toISOString() },
    ] });
    // Liens : un révoqué ancien (part), un révoqué récent et un vivant (restent).
    await base.request("commercial_doc_shares", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { slug: "ret-l-revoque-ancien", doc_id: "ret-doc", file_url: "https://x.supabase.co/storage/v1/object/public/r/d.pdf", revoked: true, revoked_at: IL_Y_A(14) },
      { slug: "ret-l-revoque-recent", doc_id: "ret-doc", file_url: "https://x.supabase.co/storage/v1/object/public/r/d.pdf", revoked: true, revoked_at: RECENT },
      { slug: "ret-l-vivant", doc_id: "ret-doc", file_url: "https://x.supabase.co/storage/v1/object/public/r/d.pdf", revoked: false, revoked_at: null },
    ] });
    // Présentations : morte-ancienne (part, avec messages+présences semés AVANT la clôture),
    // morte-récente et active-ancienne (restent, avec leurs messages).
    await base.request("doc_presentations", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { slug: "ret-p-morte", doc_id: "ret-doc", file_url: "u", active: true, current_page: 1 },
      { slug: "ret-p-recente", doc_id: "ret-doc", file_url: "u", active: true, current_page: 1 },
      { slug: "ret-p-active", doc_id: "ret-doc", file_url: "u", active: true, current_page: 1 },
    ] });
    await base.request("doc_presentation_messages", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { slug: "ret-p-morte", author_name: "Vieux", author_hash: "h1", body: "à purger" },
      { slug: "ret-p-morte", author_name: "Vieux", author_hash: "h1", body: "à purger aussi" },
      { slug: "ret-p-active", author_name: "Actif", author_hash: "h2", body: "doit survivre" },
    ] });
    await base.request("doc_presentation_attendees", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { slug: "ret-p-morte", attendee_key: "ret-a1", name: "Vieux" },
      { slug: "ret-p-active", attendee_key: "ret-a2", name: "Actif" },
    ] });
    await base.request("doc_presentations?slug=eq.ret-p-morte", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { active: false, updated_at: IL_Y_A(13) } });
    await base.request("doc_presentations?slug=eq.ret-p-recente", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { active: false, updated_at: RECENT } });
    await base.request("doc_presentations?slug=eq.ret-p-active", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { updated_at: IL_Y_A(13) } });
  });

  it("déclare EXACTEMENT ce qu'elle a semé de vieux — et pas une ligne fraîche", async () => {
    const r = await retention.purgerRetention(Date.now());
    expect(r.ok).toBe(true);
    expect(r.efface.commercial_doc_views, "le journal vieux de 14 mois part, le frais reste").toBe(1);
    expect(r.efface.commercial_doc_sessions).toBe(1);
    expect(r.efface.commercial_doc_internal_sessions).toBe(1);
    expect(r.efface.doc_bot_sessions).toBe(1);
    expect(r.efface.player_rate_limits, "au moins la limite expirée semée").toBeGreaterThanOrEqual(1);
    expect(r.efface.commercial_doc_shares, "le révoqué ANCIEN seul — pas le récent, pas le vivant").toBe(1);
    expect(r.efface.doc_presentations, "la morte-ancienne seule").toBe(1);
    expect(r.efface.doc_presentation_messages, "ses deux messages").toBe(2);
    expect(r.efface.doc_presentation_attendees, "sa présence").toBe(1);
  });

  it("les survivantes sont INTACTES — une purge qui surefface est aussi fausse qu'une qui oublie", async () => {
    const [vues, sessions, liens, pres, msgs] = await Promise.all([
      base.request("commercial_doc_views?slug=eq.ret-v&select=ua"),
      base.request("commercial_doc_sessions?session_id=eq.ret-s-fraiche&select=session_id"),
      base.request("commercial_doc_shares?slug=in.(ret-l-revoque-recent,ret-l-vivant)&select=slug"),
      base.request("doc_presentations?slug=in.(ret-p-recente,ret-p-active)&select=slug"),
      base.request("doc_presentation_messages?slug=eq.ret-p-active&select=id"),
    ]);
    expect(vues.length, "la vue fraîche survit").toBe(1);
    expect(vues[0].ua).toBe("frais");
    expect(sessions.length).toBe(1);
    expect(liens.length, "révoqué récent + vivant").toBe(2);
    expect(pres.length, "morte-récente + active-ancienne").toBe(2);
    expect(msgs.length, "le message de la présentation ACTIVE survit").toBe(1);
  });
});

// ⚠️ VOLUMÉTRIE SUR VRAI POSTGREST (P3 dixième audit) : les cas complexes étaient surtout couverts
// par des doubles mémoire. Ici, plusieurs lots, plafond exact et +1, une présentation de plus de
// 5 000 messages en deux passages, dry-run complet, et des identifiants à caractères RÉSERVÉS
// (`&`, `#`, `"`, `,`) — c'est le guillemetage de `in.(…)` qui se prouve contre le vrai serveur.
describe.skipIf(skip)("rétention : volumétrie et caractères réservés (vrai PostgREST)", () => {
  const VIEUX = (() => { const d = new Date(); d.setMonth(d.getMonth() - 14); return d.toISOString(); })();
  let retention2, base2;

  beforeAll(async () => {
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    const contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    require("../server/handler.js").init(contexte);
    retention2 = require("../server/retention.js");
    base2 = contexte.db;
    // 250 sessions anciennes, ids à caractères réservés : la clé de débit peut porter `:` et plus.
    const rl = [];
    const reserves = ['a&b', 'c#d', 'e"f', 'g,h', 'i:j'];
    for (let k = 0; k < 250; k++) rl.push({ key: `vol-${k}-${reserves[k % 5]}`, count: 1, expires_at: VIEUX });
    await base2.request("player_rate_limits", { method: "POST", headers: { Prefer: "return=minimal" }, body: rl });
  });

  // ⚠️ Ce describe laisse VOLONTAIREMENT des lignes (pour éprouver la troncature) — mais le
  // recensement de la forge exige ZÉRO ancienne ligne après la suite. On nettoie donc tout ce
  // qu'on a semé, quoi qu'il arrive.
  afterAll(async () => {
    if (skip) return;
    await base2.request("player_rate_limits?key=like.vol-*", { method: "DELETE", headers: { Prefer: "return=minimal" } });
    await base2.request("doc_presentation_messages?slug=eq.vol-pres", { method: "DELETE", headers: { Prefer: "return=minimal" } });
    await base2.request("doc_presentation_attendees?slug=eq.vol-pres", { method: "DELETE", headers: { Prefer: "return=minimal" } });
    await base2.request("doc_presentations?slug=eq.vol-pres", { method: "DELETE", headers: { Prefer: "return=minimal" } });
  });

  it("plafond exact : 50 sur 250 → tronque, 50 supprimées, 200 restent", async () => {
    const r = await retention2.purgerRetention(Date.now(), { taille: 25, plafond: 50 });
    expect(r.rapport.player_rate_limits.supprimees, "exactement le plafond").toBe(50);
    expect(r.rapport.player_rate_limits.tronque, "il reste → tronqué").toBe(true);
    const reste = await base2.request("player_rate_limits?key=like.vol-*&select=key");
    expect(reste.length, "200 sur 250 restent").toBe(200);
  });

  it("dry-run complet : compte sans supprimer, sur des ids à caractères réservés", async () => {
    const avant = (await base2.request("player_rate_limits?key=like.vol-*&select=key")).length;
    const r = await retention2.purgerRetention(Date.now(), { dryRun: true, taille: 100, plafond: 5000 });
    expect(r.rapport.player_rate_limits.examinees, "il compte tout ce qui reste").toBe(avant);
    expect(r.rapport.player_rate_limits.supprimees, "dry-run ne supprime rien").toBe(0);
    const apres = (await base2.request("player_rate_limits?key=like.vol-*&select=key")).length;
    expect(apres, "rien n'a bougé").toBe(avant);
  });

  it("une présentation de 60 messages part en DEUX passages (plafond 50), sans orphelin", async () => {
    await base2.request("doc_presentations", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { slug: "vol-pres", doc_id: "vol", file_url: "u", active: true, current_page: 1 }] });
    const semis = [];
    for (let k = 0; k < 60; k++) semis.push({ slug: "vol-pres", author_name: "V", author_hash: "h", body: `m${k}` });
    await base2.request("doc_presentation_messages", { method: "POST", headers: { Prefer: "return=minimal" }, body: semis });
    await base2.request("doc_presentations?slug=eq.vol-pres", { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { active: false, updated_at: VIEUX } });
    const p1 = await retention2.purgerRetention(Date.now(), { taille: 25, plafond: 50 });
    expect(p1.rapport.presentations.messages, "50 au premier passage").toBe(50);
    const restePres1 = await base2.request("doc_presentations?slug=eq.vol-pres&select=slug");
    expect(restePres1.length, "le parent reste tant qu'il a des enfants").toBe(1);
    const p2 = await retention2.purgerRetention(Date.now(), { taille: 25, plafond: 50 });
    expect(p2.rapport.presentations.messages, "les 10 derniers partent").toBe(10);
    const resteMsg = await base2.request("doc_presentation_messages?slug=eq.vol-pres&select=id");
    expect(resteMsg.length, "zéro message orphelin").toBe(0);
    const restePres2 = await base2.request("doc_presentations?slug=eq.vol-pres&select=slug");
    expect(restePres2.length, "le parent part une fois vidé").toBe(0);
  });
});
