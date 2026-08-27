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

// ⚠️ DE VRAIS `Response`, PAS DES OBJETS QUI Y RESSEMBLENT. Ce faux réseau rendait `{ ok, json }` —
// une forme qu'aucun serveur ne produit : ni `headers`, ni `body`, ni `status` sur le chemin
// heureux. Tant que la route se contentait de `gen.json()`, ça passait ; le jour où elle a lu son
// corps BORNÉ (la réponse vient d'un tiers, sa taille n'est pas la nôtre), le banc s'est mis à
// prouver le contraire de la réalité. `new Response(...)` est du vrai, il coûte une ligne, et il
// n'a aucune raison de diverger de ce qu'ElevenLabs enverra.
const reponseJson = (valeur, statut = 200) =>
  new Response(JSON.stringify(valeur), { status: statut, headers: { "content-type": "application/json" } });

function reseau({ enCache = false, voixEnEchec = [], ajoutVoixOk = true, audio = "QUJD", alignement = [0, 0.12, 0.3], attendre = null } = {}) {
  sorties = [];
  global.fetch = async (url, init = {}) => {
    const u = String(url);
    // `signal` est ENREGISTRÉ : un appel sortant sans abandon est une propriété qui se vérifie.
    sorties.push({ url: u, methode: init.method || "GET", corps: init.body ? JSON.parse(init.body) : null, abandon: !!init.signal });
    if (init.method === "HEAD" || (!init.method && u.includes("/object/public/"))) return new Response(null, { status: enCache ? 200 : 404 });
    if (u.includes("/voices/add/")) return reponseJson({}, ajoutVoixOk ? 200 : 402);
    if (u.includes("/text-to-speech/")) {
      // La barrière permet de tenir des synthèses EN VOL — sans elle, « concurrent » ne veut rien
      // dire dans un banc : chaque appel se résoudrait avant que le suivant ne commence.
      if (attendre) await attendre;
      const voix = decodeURIComponent(u.split("/text-to-speech/")[1].split("/")[0]);
      if (voixEnEchec.includes(voix)) return reponseJson({}, 402);
      return reponseJson({ audio_base64: audio, alignment: alignement ? { character_start_times_seconds: alignement } : undefined });
    }
    throw new Error("appel inattendu : " + u);
  };
}

/** Une barrière que le banc ouvre quand il veut : `{ barriere, liberer }`. */
function barriere() {
  let liberer;
  const attendre = new Promise((r) => { liberer = r; });
  return { attendre, liberer };
}
const unTour = () => new Promise((r) => setTimeout(r, 0));

/** Contexte nominal : chaque capacité ENREGISTRE pour que le test affirme ce qui s'est passé. */
function contexte(surcharges = {}) {
  const poses = []; const captures = []; const ecritures = [];
  const ctx = {
    poses, captures, ecritures,
    // La base n'est touchée QUE pour la trace du cache de voix — chaque écriture est enregistrée.
    db: { request: async (chemin, o = {}) => { ecritures.push({ chemin, methode: o.method || "GET", corps: o.body || null, entetes: o.headers || {} }); return null; } },
    limits: { allow: async () => true },
    storage: { put: async (bucket, chemin, buf, type) => { poses.push({ bucket, chemin, octets: buf.length, type }); return true; } },
    errors: { capture: async (e) => { captures.push(String(e && e.message)); } },
    plugins: { bot: greffonBot() },
    branding: { name: "" },
    config: { supabaseUrl: BASE },
    ...surcharges,
  };
  routes.init(ctx);
  return ctx;
}

// ⚠️ DEPUIS LE 26/08, `bot-tts` EXIGE UNE SESSION ET CONFRONTE LE TEXTE. Les bancs ci-dessous
// portent sur la synthèse, le cache et les bornes : ils ont donc besoin d'une session valide et
// d'un assistant qui a RÉELLEMENT dit ce qu'on lui demande de prononcer. `dire()` le pose par
// défaut ; la confrontation elle-même a ses propres bancs, plus bas, où c'est l'objet du test.
let MESSAGES_BOT = [];

function greffonBot(surcharges = {}) {
  return {
    getProfile: async () => ({}),
    pronFix: () => null,
    getSession: async (id) => (id === "sess-A" ? { share_slug: "Doc-A" } : id === "sess-B" ? { share_slug: "Doc-B" } : null),
    listMessages: async () => MESSAGES_BOT,
    ...surcharges,
  };
}

const dire = async (texte = "Bonjour à tous", opts = {}) => {
  // ⚠️ ON AJOUTE, ON N'ÉCRASE PAS. Une session ACCUMULE ses messages, et le banc de concurrence
  // lance quatre `dire()` de textes différents en parallèle : remplacer la liste faisait que chacun
  // effaçait la preuve des trois autres, qui se refusaient alors les uns les autres.
  if (!opts.sansAvoirEteDit) MESSAGES_BOT.push({ role: "bot", text: texte });
  const res = fauxRes();
  const corps = { action: "bot-tts", slug: "Doc-A", text: texte };
  if (!opts.sansSession) corps.sessionId = opts.sessionId || "sess-A";
  await routes.traiter(req, res, corps, "Doc-A");
  return res;
};

// ⚠️ LE CACHE DE SYNTHÈSE VIT DANS LE MODULE, DONC IL SURVIT À CHAQUE BANC. Sans cette remise à
// zéro, le second banc qui prononce le même texte est servi par la mémoire du premier : il compte
// zéro appel à ElevenLabs et en conclut que la route n'appelle pas. Il mesurerait le banc d'avant.
beforeEach(() => { partageRendu = PARTAGE; process.env.ELEVENLABS_API_KEY = "cle-11labs"; routes._tts.cache.vider(); MESSAGES_BOT = []; });
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
    contexte({ plugins: { bot: greffonBot({ getProfile: async () => PROFIL_AVEC_VOIX }) } });
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
    contexte({ plugins: { bot: greffonBot({ pronFix: () => (t) => t.replace("SQL", "ess-ku-elle") }) } });
    reseau();
    const res = await dire("Le moteur SQL répond");
    const synthese = sorties.find((s) => s.url.includes("/text-to-speech/"));
    expect(synthese.corps.text).toBe("Le moteur ess-ku-elle répond");
    expect(res.corps.spoken).toBe("Le moteur ess-ku-elle répond");
    // Et la clé de cache est celle du texte DIT — deux orthographes, une prononciation : un clip.
    expect(res.corps.url).toContain(cleDeCache(VOIX_DEFAUT, "Le moteur ess-ku-elle répond"));
  });

  it("une prononciation qui plante n'empêche pas de parler : on retombe sur l'orthographe", async () => {
    contexte({ plugins: { bot: greffonBot({ pronFix: () => () => { throw new Error("règle cassée"); } }) } });
    reseau();
    const res = await dire("Bonjour");
    expect(res.corps.ok).toBe(true);
    expect(res.corps.spoken).toBeUndefined();
  });
});

// ⚠️ CE QUE LE VISITEUR CHOISIT, C'EST CE QUE VOTRE COMPTE ELEVENLABS SYNTHÉTISE — ET ÇA SE PAIE.
//
// `bot-tts` accepte `body.text` tel quel : un slug public valide suffit, aucune session n'est
// exigée, et rien ne rattache le texte à une réponse du bot. Le plafond de débit (400/h/IP) ne
// borne que la CADENCE d'une adresse ; il ne borne ni le coût par appel, ni le nombre d'appels
// sortants simultanés, ni la taille de ce qu'on accepte en retour. Le ticket signé qui liera texte
// et réponse du bot est un autre chantier. Ces bancs-ci tiennent les trois bornes qui ne demandent
// aucun changement de protocole — et qui manquaient toutes les trois. (Audit CODEX du 26/08.)
describe("les bornes de la synthèse : coût, concurrence, taille", () => {
  it("⚠️ cent appels SIMULTANÉS sur le même texte ne produisent QU'UNE synthèse", async () => {
    const { attendre, liberer } = barriere();
    const ctx = contexte(); reseau({ attendre });

    // Le HEAD du cache ne voit pas ce qui n'est pas encore écrit : sans regroupement, ces cent
    // appels manquaient tous le cache ensemble et payaient cent fois le même extrait.
    const tous = Array.from({ length: 100 }, () => dire("Le même texte pour tout le monde"));
    await unTour();
    liberer();
    const reponses = await Promise.all(tous);

    const syntheses = sorties.filter((s) => s.url.includes("/text-to-speech/"));
    expect(syntheses, "une synthèse pour cent demandes identiques").toHaveLength(1);
    expect(ctx.poses.filter((p) => p.chemin.endsWith(".mp3")), "un seul objet écrit").toHaveLength(1);
    expect(reponses.every((r) => r.statusCode === 200 && r.corps.ok), "les cent sont servis").toBe(true);
    const urls = new Set(reponses.map((r) => r.corps.url));
    expect(urls.size, "tous reçoivent le MÊME extrait").toBe(1);
  });

  it("⚠️ au-delà du plafond de synthèses simultanées : 503 réessayable, pas un appel de plus", async () => {
    const { attendre, liberer } = barriere();
    contexte(); reseau({ attendre });

    // Des textes DIFFÉRENTS : le regroupement ne peut rien pour eux, chacun coûte un appel.
    const enVol = Array.from({ length: routes._tts.SYNTHESES_SIMULTANEES }, (_, i) => dire(`Texte numéro ${i}`));
    await unTour();

    const refuse = await dire("Le texte de trop");
    expect(refuse.statusCode, "503 dit « attends une seconde » ; 500 dirait « abandonne »").toBe(503);
    expect(refuse.corps).toEqual({ ok: false, error: "busy" });
    expect(refuse.entetes["retry-after"]).toBe("1");
    expect(sorties.filter((s) => s.url.includes("/text-to-speech/")),
      "le refus doit être ANTÉRIEUR à l'appel payant — sinon il ne borne rien")
      .toHaveLength(routes._tts.SYNTHESES_SIMULTANEES);

    liberer();
    await Promise.all(enVol);
  });

  it("⚠️ une réponse au-delà du plafond est refusée SANS être stockée, et l'échec est dit", async () => {
    const ctx = contexte();
    // Un corps volontairement plus gros que ce qu'on accepte : `gen.json()` l'aurait pris entier.
    reseau({ audio: "Q".repeat(routes._tts.MAX_REPONSE_OCTETS + 1024) });

    const res = await dire("Un texte quelconque");
    expect(res.statusCode).toBe(200);
    expect(res.corps, "côté visiteur : pas de voix, pas d'erreur").toEqual({ ok: false });
    expect(ctx.poses, "rien ne doit atteindre le stockage").toEqual([]);
    expect(ctx.captures.join(" "), "côté exploitant : dire POURQUOI").toMatch(/au-delà de/);
  });

  it("⚠️ AUCUN appel sortant ne part sans abandon — HEAD, ajout de voix et synthèse", async () => {
    const ctx = contexte();
    ctx.plugins.bot.getProfile = async () => ({ behavior: { voice: { id: "VoixDuProfil", owner: "proprietaire-x" } } });
    reseau({ voixEnEchec: ["VoixDuProfil"] });

    await dire("Bonjour");
    const sansAbandon = sorties.filter((s) => !s.abandon).map((s) => s.url);
    expect(sansAbandon,
      "un fetch sans signal immobilise sa socket ET sa place d'admission jusqu'à ce que la "
      + "plateforme tue la fonction — c'est la panne qu'`appelHote` a déjà corrigée ailleurs")
      .toEqual([]);
    // Le banc ne prouve rien s'il n'a rien vu partir : les trois familles d'appel sont exercées.
    expect(sorties.some((s) => s.methode === "HEAD")).toBe(true);
    expect(sorties.some((s) => s.url.includes("/voices/add/"))).toBe(true);
    expect(sorties.some((s) => s.url.includes("/text-to-speech/"))).toBe(true);
  });
});

// ⚠️ LE BUCKET `tts-cache` ÉTAIT IMPURGEABLE PAR CONSTRUCTION — pas par oubli de configuration.
// Chaque synthèse y écrit `<empreinte>.mp3` et `<empreinte>.json` ; l'empreinte est un condensat
// (voix + modèle + texte prononcé) qui ne se rattachait à AUCUNE ligne. Le balayage de rétention
// efface des lignes, et pour les fichiers il efface ceux dont une ligne porte le chemin — la
// capacité `storage` du contrat expose `put` et `remove`, jamais `list`. Il n'y avait rien à
// parcourir. L'audit CODEX du 26/08 rangeait ça en « ajouter une politique, 0,5 jour » : ce n'était
// pas une politique qui manquait, c'était la trace. (Migration 0021.)
describe("la trace qui rend le cache de voix purgeable", () => {
  it("⚠️ un objet écrit laisse une empreinte datée — et JAMAIS le texte", async () => {
    const ctx = contexte(); reseau();
    await dire("Une phrase à prononcer");

    const traces = ctx.ecritures.filter((e) => e.chemin.startsWith("doc_tts_objects"));
    expect(traces, "sans elle, rien ne pourra jamais purger ces deux objets").toHaveLength(1);
    expect(traces[0].methode).toBe("POST");
    expect(traces[0].entetes.Prefer, "rejouer une empreinte déjà connue ne doit pas être une erreur")
      .toContain("ignore-duplicates");

    const [ligne] = traces[0].corps;
    expect(Object.keys(ligne), "l'empreinte suffit à retrouver les deux objets").toEqual(["hash"]);
    expect(ligne.hash).toBe(cleDeCache(VOIX_DEFAUT, "Une phrase à prononcer"));
    // La donnée personnelle éventuelle vit déjà dans le bucket ; l'écrire ICI la rendrait
    // interrogeable, ce qui est strictement pire que de ne pas l'avoir.
    expect(JSON.stringify(traces[0].corps)).not.toContain("Une phrase");
  });

  it("l'empreinte tracée est celle de la voix RÉELLEMENT utilisée, repli compris", async () => {
    const ctx = contexte();
    ctx.plugins.bot.getProfile = async () => ({ behavior: { voice: { id: "VoixDuProfil" } } });
    reseau({ voixEnEchec: ["VoixDuProfil"] });

    await dire("Bonjour");
    const [trace] = ctx.ecritures.filter((e) => e.chemin.startsWith("doc_tts_objects"));
    // Le repli écrit l'objet sous SA clé : tracer l'autre laisserait un objet orphelin, éternel.
    expect(trace.corps[0].hash).toBe(cleDeCache(VOIX_DEFAUT, "Bonjour"));
  });

  it("⚠️ une trace qui échoue ne rend pas la présentation muette — mais elle est DITE", async () => {
    const ctx = contexte({ db: { request: async () => { throw new Error("base injoignable"); } } });
    reseau();

    const res = await dire("Bonjour");
    expect(res.corps.ok, "la voix passe avant la trace").toBe(true);
    // Un rejet muet est indistinguable d'un cache vide : personne ne va chercher une panne
    // qu'aucun signal n'annonce. C'est la leçon de la session interne jetée en silence.
    expect(ctx.captures.join(" ")).toMatch(/trace du cache de voix non écrite/);
    expect(ctx.captures.join(" ")).toMatch(/hors de toute fenêtre de rétention/);
  });

  it("un extrait SERVI DEPUIS LE CACHE n'écrit pas de trace — il n'a rien créé", async () => {
    const ctx = contexte(); reseau({ enCache: true });
    const res = await dire("Déjà connue");
    expect(res.corps.cached).toBe(true);
    expect(ctx.ecritures.filter((e) => e.chemin.startsWith("doc_tts_objects")),
      "la trace du premier passage existe déjà ; une seconde ligne ne dirait rien de plus").toHaveLength(0);
  });
});

// ── CE QUE LE VISITEUR PEUT FAIRE DIRE, ET CE QU'IL NE PEUT PLUS ────────────────────────────────
// ⚠️ LA SEULE ROUTE DE CE DÉPÔT QUI DÉPENSE DE L'ARGENT. Jusqu'au 26/08, `bot-tts` acceptait
// `body.text` tel quel : un slug public valide suffisait, aucune session n'était exigée, et rien ne
// rattachait le texte à une réponse réellement produite. Les bornes posées le même jour
// (regroupement, quatre synthèses simultanées, 8 Mio, délais) bornaient le DÉBIT du dégât, jamais
// sa NATURE : n'importe qui muni d'un lien pouvait faire synthétiser n'importe quoi, à la facture
// de l'hôte.
//
// ⚠️ ON COMPARE LE PRONONCÉ, PAS L'ÉCRIT — et c'est strictement plus fort. `pronFix` peut envoyer
// deux orthographes sur la même prononciation, et c'est le prononcé qui fait l'empreinte du cache.
// Un texte accepté est donc SOIT un message réel, SOIT un texte dont l'extrait est déjà payé.
describe("le texte doit avoir été dit par l'assistant", () => {
  it("sans session : refusé, et AUCUN appel payant", async () => {
    contexte(); reseau();
    const res = await dire("Bonjour à tous", { sansSession: true });
    expect(res.statusCode).toBe(400);
    expect(res.corps).toEqual({ ok: false, error: "session" });
    expect(sorties.filter((s) => s.url.includes("/text-to-speech/")), "un refus qui appelle quand même ne borne rien").toHaveLength(0);
  });

  it("session d'un AUTRE document : refusée, même si le texte y a été dit", async () => {
    // ⚠️ Sans cette liaison, un `sessionId` glané ailleurs suffirait — et la confrontation se ferait
    // alors contre les messages d'une conversation qui n'est pas celle du lien présenté.
    contexte(); reseau();
    const res = await dire("Bonjour à tous", { sessionId: "sess-B" });
    expect(res.statusCode).toBe(400);
    expect(res.corps).toEqual({ ok: false, error: "session" });
    expect(sorties.filter((s) => s.url.includes("/text-to-speech/"))).toHaveLength(0);
  });

  it("un texte que l'assistant n'a JAMAIS dit : refusé, et aucun appel payant", async () => {
    contexte(); reseau();
    MESSAGES_BOT.push({ role: "bot", text: "Bonjour, je vous présente ce document." });
    const res = await dire("Lis-moi ce roman entier à mes frais", { sansAvoirEteDit: true });
    expect(res.statusCode).toBe(400);
    expect(res.corps).toEqual({ ok: false, error: "texte" });
    expect(sorties.filter((s) => s.url.includes("/text-to-speech/"))).toHaveLength(0);
  });

  it("⚠️ ce que le VISITEUR a écrit ne compte pas — sinon la garde ne garde rien", async () => {
    // Le chemin le plus court pour contourner une confrontation aux messages : écrire soi-même le
    // texte via `bot-say`, puis demander qu'on le prononce. Seuls les rôles de l'ASSISTANT comptent.
    contexte(); reseau();
    MESSAGES_BOT.push({ role: "user", text: "Texte arbitraire que je paie avec ton compte" });
    const res = await dire("Texte arbitraire que je paie avec ton compte", { sansAvoirEteDit: true });
    expect(res.statusCode).toBe(400);
    expect(res.corps).toEqual({ ok: false, error: "texte" });
    expect(sorties.filter((s) => s.url.includes("/text-to-speech/"))).toHaveLength(0);
  });

  it("un message réellement dit passe, sous les trois rôles admis", async () => {
    for (const role of ["bot", "assistant", "AI"]) {
      routes._tts.cache.vider();
      MESSAGES_BOT = [];
      contexte(); reseau();
      MESSAGES_BOT.push({ role, text: `Phrase du rôle ${role}` });
      const res = await dire(`Phrase du rôle ${role}`, { sansAvoirEteDit: true });
      expect(res.statusCode, `le rôle « ${role} » doit être admis`).toBe(200);
      expect(res.corps.ok).toBe(true);
    }
  });

  it("⚠️ la confrontation porte sur le PRONONCÉ : une autre orthographe, même prononciation, passe", async () => {
    // `pronFix` remplace « SQL » par « ess-ku-elle ». L'assistant a dit « SQL » ; on demande
    // « ess-ku-elle ». Les deux se prononcent pareil, donc l'extrait est LE MÊME objet du cache :
    // accepter ne coûte rien, refuser aurait rejeté un cas légitime.
    contexte({ plugins: { bot: greffonBot({ pronFix: () => (t) => t.replace("SQL", "ess-ku-elle") }) } });
    reseau();
    MESSAGES_BOT.push({ role: "bot", text: "Ce document parle de SQL" });
    const res = await dire("Ce document parle de ess-ku-elle", { sansAvoirEteDit: true });
    expect(res.statusCode).toBe(200);
    expect(res.corps.ok).toBe(true);
  });

  it("⚠️ une lecture des messages qui ÉCHOUE refuse, et le dit — jamais « d'accord »", async () => {
    // Sur une route qui dépense, « je n'ai pas su vérifier » doit se lire « non ». Et le code doit
    // distinguer l'indisponibilité du texte refusé : un exploitant ne cherche pas au même endroit.
    const ctx = contexte({ plugins: { bot: greffonBot({ listMessages: async () => { throw new Error("base injoignable"); } }) } });
    reseau();
    const res = await dire("Bonjour à tous");
    expect(res.statusCode).toBe(503);
    expect(res.corps).toEqual({ ok: false, error: "indisponible" });
    expect(sorties.filter((s) => s.url.includes("/text-to-speech/"))).toHaveLength(0);
    expect(ctx.captures.some((c) => c.includes("base injoignable")), "un refus muet est indistinguable d'un cache vide").toBe(true);
  });

  it("⚠️ le texte se lit dans `text`, `content` OU `body` — un hôte réel utilise le troisième", async () => {
    // ⚠️ SIGNALÉ PAR UN HÔTE AVANT QU'IL NE BUTE DESSUS, le 27/08. Ses messages portent leur texte
    // dans `body` ; son `role` valait bien `bot`, donc ce n'était pas le rôle qui cassait. Sans ce
    // champ, notre lecteur rendait une chaîne vide pour CHACUN de ses messages — ensemble vide,
    // donc TOUT refusé, sur une intégration parfaitement correcte.
    for (const champ of ["text", "content", "body"]) {
      routes._tts.cache.vider();
      MESSAGES_BOT = [];
      contexte(); reseau();
      MESSAGES_BOT.push({ role: "bot", [champ]: `Phrase portée par ${champ}` });
      const res = await dire(`Phrase portée par ${champ}`, { sansAvoirEteDit: true });
      expect(res.statusCode, `le texte porté par « ${champ} » doit être lu`).toBe(200);
      expect(res.corps.ok).toBe(true);
    }
  });

  it("⚠️ et un champ vide ne fait pas écran au suivant", async () => {
    // Un hôte peut porter les deux, l'un vide. Prendre le premier PRÉSENT plutôt que le premier
    // NON VIDE refuserait un message que l'assistant a bel et bien dit.
    contexte(); reseau();
    MESSAGES_BOT.push({ role: "bot", text: "", body: "Le vrai texte" });
    const res = await dire("Le vrai texte", { sansAvoirEteDit: true });
    expect(res.statusCode).toBe(200);
    expect(res.corps.ok).toBe(true);
  });

  it("⚠️ des messages illisibles ne valent pas accord : ensemble vide, tout refusé", async () => {
    // La forme d'un message vient du greffon de l'hôte, qu'aucun contrat n'écrit. Si elle change,
    // la garde doit se fermer, pas s'ouvrir.
    contexte({ plugins: { bot: greffonBot({ listMessages: async () => [null, 42, { pasDeRole: "x" }, { role: "bot" }] }) } });
    reseau();
    const res = await dire("Bonjour à tous", { sansAvoirEteDit: true });
    expect(res.statusCode).toBe(400);
    expect(res.corps).toEqual({ ok: false, error: "texte" });
    expect(sorties.filter((s) => s.url.includes("/text-to-speech/"))).toHaveLength(0);
  });
});
