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
      { id: "ret-b-vieille", doc_id: "ret-doc", last_at: IL_Y_A(14), created_at: IL_Y_A(14) },
      { id: "ret-b-fraiche", doc_id: "ret-doc", last_at: RECENT, created_at: RECENT },
    ] });
    await base.request("player_rate_limits", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { key: "ret-limite-expiree", count: 1, expires_at: IL_Y_A(1) },
      { key: "ret-limite-vivante", count: 1, expires_at: new Date(Date.now() + 3600_000).toISOString() },
    ] });
    // Liens : un révoqué ancien (part), un révoqué récent et un vivant (restent).
    await base.request("commercial_doc_shares", { method: "POST", headers: { Prefer: "return=minimal" }, body: [
      { slug: "ret-l-revoque-ancien", doc_id: "ret-doc", file_url: "https://x.supabase.co/storage/v1/object/public/r/d.pdf", revoked: true, revoked_at: IL_Y_A(14) },
      { slug: "ret-l-revoque-recent", doc_id: "ret-doc", file_url: "https://x.supabase.co/storage/v1/object/public/r/d.pdf", revoked: true, revoked_at: RECENT },
      { slug: "ret-l-vivant", doc_id: "ret-doc", file_url: "https://x.supabase.co/storage/v1/object/public/r/d.pdf", revoked: false },
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
