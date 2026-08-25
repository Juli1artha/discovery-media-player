// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA VOIX DE L'ASSISTANT (bot-tts) — LA ROUTE ENTIÈRE ÉTAIT MORTE AUX BANCS.
//
// ⚠️ gardesAgent.test.js dit explicitement ne pas éprouver « la plomberie (ElevenLabs…) » — et il
// a raison pour les refus. Mais bot-tts n'est pas que du relais : trois PROPRIÉTÉS y vivent, et
// aucune n'était éprouvée.
//
//   1. LE CACHE EST UNE PROMESSE DE COÛT. « Cache hit ? coût ElevenLabs = 0 » — c'est un
//      engagement économique : servir un extrait déjà généré ne doit émettre AUCUN appel de
//      synthèse. Un régressif ici ne casse rien à l'écran ; il facture.
//   2. JAMAIS DE PRÉSENTATION MUETTE — et jamais sous la MAUVAISE CLÉ. La voix d'un profil peut
//      échouer (bibliothèque, quota de slots) : la route replie sur la voix par défaut, et
//      RE-CALCULE la clé de cache. Sans ce recalcul, le clip de la voix par défaut s'enregistrerait
//      sous la clé de la voix du profil — et TOUS les visiteurs suivants entendraient la mauvaise
//      voix, servie depuis le cache, sans plus jamais passer par la synthèse.
//   3. DIRE ≠ MONTRER. La prononciation (behavior.voice.pron) s'applique côté serveur : la
//      synthèse reçoit la version phonétique, le client garde l'orthographe — et `spoken` n'est
//      renvoyé QUE s'il diffère, pour aligner le karaoké.
//
// Idiome du dossier : shares.js remplacé AVANT le require (routes-agent le destructure au
// chargement — un stub posé après arrive trop tard, leçon du 24/08), faux res, contexte injecté.

const crypto = require("node:crypto");
const ID_SHARES = require.resolve("../shares.js");
const vraisShares = require("../shares.js");
let partageRendu = null;
require.cache[ID_SHARES] = {
  id: ID_SHARES, filename: ID_SHARES, loaded: true,
  exports: { ...vraisShares, getShareBySlug: async () => partageRendu },
};

const routes = require("../routes-agent.js");

function fauxRes() {
  return {
    statusCode: 0, entetes: {}, corps: null,
    setHeader(k, v) { this.entetes[k.toLowerCase()] = v; },
    end(s) { this.corps = s ? JSON.parse(s) : null; },
  };
}

const req = { socket: { remoteAddress: "203.0.113.9" }, headers: {} };
const PARTAGE = { slug: "Doc-A", doc_id: "d1", bot_enabled: true, bot_profile_id: "p1" };
const BASE = "https://labase.supabase.co";
const VOIX_DEFAUT = "21m00Tcm4TlvDq8ikWAM";
const MODELE = "eleven_multilingual_v2";
const cleDeCache = (voix, dit) => crypto.createHash("sha256").update(voix + "|" + MODELE + "|v2|" + dit).digest("hex");

/** Le faux réseau : HEAD du cache, synthèses par voix, ajout de voix — tout est ENREGISTRÉ. */
const vraiFetch = global.fetch;
let sorties = [];
function reseau({ enCache = false, voixEnEchec = [], ajoutVoixOk = true, audio = "QUJD", alignement = [0, 0.12, 0.3] } = {}) {
  sorties = [];
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    sorties.push({ url: u, methode: init.method || "GET", corps: init.body ? JSON.parse(init.body) : null });
    if (init.method === "HEAD" || (!init.method && u.includes("/object/public/"))) return { ok: enCache };
    if (u.includes("/voices/add/")) return { ok: ajoutVoixOk, json: async () => ({}) };
    if (u.includes("/text-to-speech/")) {
      const voix = decodeURIComponent(u.split("/text-to-speech/")[1].split("/")[0]);
      if (voixEnEchec.includes(voix)) return { ok: false, status: 402, json: async () => ({}) };
      return { ok: true, json: async () => ({ audio_base64: audio, alignment: alignement ? { character_start_times_seconds: alignement } : undefined }) };
    }
    throw new Error("appel inattendu : " + u);
  };
}

/** Contexte nominal : chaque capacité ENREGISTRE pour que le test affirme ce qui s'est passé. */
function contexte(surcharges = {}) {
  const poses = []; const captures = [];
  const ctx = {
    poses, captures,
    limits: { allow: async () => true },
    storage: { put: async (bucket, chemin, buf, type) => { poses.push({ bucket, chemin, octets: buf.length, type }); return true; } },
    errors: { capture: async (e) => { captures.push(String(e && e.message)); } },
    plugins: { bot: { getProfile: async () => ({}), pronFix: () => null } },
    branding: { name: "" },
    config: { supabaseUrl: BASE },
    ...surcharges,
  };
  routes.init(ctx);
  return ctx;
}

const dire = async (texte = "Bonjour à tous") => {
  const res = fauxRes();
  await routes.traiter(req, res, { action: "bot-tts", slug: "Doc-A", text: texte }, "Doc-A");
  return res;
};

beforeEach(() => { partageRendu = PARTAGE; process.env.ELEVENLABS_API_KEY = "cle-11labs"; });
afterEach(() => { delete process.env.ELEVENLABS_API_KEY; delete process.env.ELEVENLABS_VOICE_ID; global.fetch = vraiFetch; });

describe("les refus de bot-tts, chacun avec son code", () => {
  it("sans clé serveur : désactivé PROPREMENT (200, disabled) — pas une erreur, une absence de capacité", async () => {
    delete process.env.ELEVENLABS_API_KEY;
    contexte(); reseau();
    const res = await dire();
    expect(res.statusCode).toBe(200);
    expect(res.corps).toEqual({ ok: false, disabled: true });
    expect(sorties).toHaveLength(0);
  });

  it("un lien inconnu ou sans assistant : 404 — la voix n'existe que là où l'assistant existe", async () => {
    contexte(); reseau();
    partageRendu = null;
    expect((await dire()).statusCode).toBe(404);
    partageRendu = { ...PARTAGE, bot_enabled: false };
    expect((await dire()).statusCode).toBe(404);
  });

  it("un texte fait de blancs est vide : 400 — on ne facture pas la synthèse du silence", async () => {
    contexte(); reseau();
    const res = await dire("  \n\t  ");
    expect(res.statusCode).toBe(400);
    expect(res.corps.error).toBe("empty");
    expect(sorties).toHaveLength(0);
  });

  it("le plafond par adresse refuse en 429 avant tout appel", async () => {
    contexte({ limits: { allow: async () => false } }); reseau();
    const res = await dire();
    expect(res.statusCode).toBe(429);
    expect(sorties).toHaveLength(0);
  });
});

describe("le cache est une promesse de coût", () => {
  it("un extrait en cache se sert depuis le CDN : zéro appel de synthèse, zéro écriture", async () => {
    const ctx = contexte(); reseau({ enCache: true });
    const res = await dire();
    expect(res.corps.ok).toBe(true);
    expect(res.corps.cached).toBe(true);
    expect(res.corps.url).toContain("/object/public/tts-cache/");
    expect(sorties.filter((s) => s.url.includes("elevenlabs"))).toHaveLength(0);
    expect(ctx.poses).toHaveLength(0);
  });
});

describe("la synthèse nominale et ses dégradations honnêtes", () => {
  it("génère, range l'audio ET l'alignement, et rend leurs deux URL — sans `spoken` quand rien ne diffère", async () => {
    const ctx = contexte(); reseau();
    const res = await dire("Bonjour à tous");
    expect(res.corps.ok).toBe(true);
    const cle = cleDeCache(VOIX_DEFAUT, "Bonjour à tous");
    expect(res.corps.url).toBe(`${BASE}/storage/v1/object/public/tts-cache/${cle}.mp3`);
    expect(res.corps.align).toBe(`${BASE}/storage/v1/object/public/tts-cache/${cle}.json`);
    expect(res.corps.spoken).toBeUndefined();
    expect(ctx.poses.map((p) => p.chemin)).toEqual([`${cle}.mp3`, `${cle}.json`]);
    // L'alignement est stocké en MILLISECONDES entières — le client fait l'hypothèse.
    expect(ctx.poses[1].type).toBe("application/json");
  });

  it("sans alignement dans la réponse, align vaut null — le client retombe sur la synchro estimée", async () => {
    contexte(); reseau({ alignement: null });
    const res = await dire();
    expect(res.corps.ok).toBe(true);
    expect(res.corps.align).toBe(null);
  });

  it("un texte trop long est tronqué à 700 caractères AVANT la synthèse — le plafond de coût est côté serveur", async () => {
    contexte(); reseau();
    await dire("x".repeat(2000));
    const synthese = sorties.find((s) => s.url.includes("/text-to-speech/"));
    expect(synthese.corps.text).toHaveLength(700);
  });

  it("échec de synthèse : 200 { ok:false } et l'échec est CAPTURÉ — visible côté exploitant, silencieux côté visiteur", async () => {
    const ctx = contexte(); reseau({ voixEnEchec: [VOIX_DEFAUT] });
    const res = await dire();
    expect(res.statusCode).toBe(200);
    expect(res.corps).toEqual({ ok: false });
    expect(ctx.captures.join(" ")).toMatch(/elevenlabs/);
  });

  it("un audio vide ou une écriture qui échoue rendent ok:false — jamais une URL qui pointerait sur rien", async () => {
    contexte(); reseau({ audio: "" });
    expect((await dire()).corps).toEqual({ ok: false });
    contexte({ storage: { put: async () => false } }); reseau();
    expect((await dire()).corps).toEqual({ ok: false });
  });
});

describe("jamais de présentation muette — et jamais sous la mauvaise clé", () => {
  const PROFIL_AVEC_VOIX = { behavior: { voice: { id: "voix-profil", owner: "proprietaire-biblio", name: "Voix Acme" } } };

  it("voix de profil en échec : ajout à la bibliothèque tenté, puis repli voix par défaut — le visiteur entend quand même", async () => {
    contexte({ plugins: { bot: { getProfile: async () => PROFIL_AVEC_VOIX, pronFix: () => null } } });
    reseau({ voixEnEchec: ["voix-profil"] });
    const res = await dire("Bonjour à tous");
    expect(res.corps.ok).toBe(true);
    const essais = sorties.filter((s) => s.url.includes("/text-to-speech/")).map((s) => decodeURIComponent(s.url.split("/text-to-speech/")[1].split("/")[0]));
    expect(essais).toEqual(["voix-profil", "voix-profil", VOIX_DEFAUT]);
    expect(sorties.some((s) => s.url.includes("/voices/add/proprietaire-biblio/voix-profil"))).toBe(true);
    // ⚠️ LA CLÉ DE CACHE EST CELLE DE LA VOIX QUI A PARLÉ. Sous la clé du profil, ce clip de
    // repli serait servi à tous les visiteurs suivants comme s'il était la voix du profil.
    expect(res.corps.url).toContain(cleDeCache(VOIX_DEFAUT, "Bonjour à tous"));
    expect(res.corps.url).not.toContain(cleDeCache("voix-profil", "Bonjour à tous"));
  });

  it("un profil sans voix propre parle directement avec la voix par défaut, sans détour", async () => {
    contexte(); reseau();
    await dire();
    const essais = sorties.filter((s) => s.url.includes("/text-to-speech/"));
    expect(essais).toHaveLength(1);
    expect(sorties.some((s) => s.url.includes("/voices/add/"))).toBe(false);
  });
});

describe("dire ≠ montrer : la prononciation s'applique côté serveur", () => {
  it("la synthèse reçoit la version phonétique, la réponse porte `spoken` pour aligner le karaoké", async () => {
    contexte({ plugins: { bot: { getProfile: async () => ({}), pronFix: () => (t) => t.replace("SQL", "ess-ku-elle") } } });
    reseau();
    const res = await dire("Le moteur SQL répond");
    const synthese = sorties.find((s) => s.url.includes("/text-to-speech/"));
    expect(synthese.corps.text).toBe("Le moteur ess-ku-elle répond");
    expect(res.corps.spoken).toBe("Le moteur ess-ku-elle répond");
    // Et la clé de cache est celle du texte DIT — deux orthographes, une prononciation : un clip.
    expect(res.corps.url).toContain(cleDeCache(VOIX_DEFAUT, "Le moteur ess-ku-elle répond"));
  });

  it("une prononciation qui plante n'empêche pas de parler : on retombe sur l'orthographe", async () => {
    contexte({ plugins: { bot: { getProfile: async () => ({}), pronFix: () => () => { throw new Error("règle cassée"); } } } });
    reseau();
    const res = await dire("Bonjour");
    expect(res.corps.ok).toBe(true);
    expect(res.corps.spoken).toBeUndefined();
  });
});
