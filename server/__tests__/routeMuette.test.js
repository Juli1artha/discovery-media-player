// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE ROUTE QUI REND 500 SANS RIEN SIGNALER EST UNE PANNE INVISIBLE.
//
// ⚠️ CE QUI EST ARRIVÉ, ET COMMENT ON L'A SU. `bot-tts` levait un `TypeError` à CHAQUE appel — le
// module `crypto` n'était pas lié après une extraction, et `keyFor()` construit la clé du cache,
// donc le jet précède toujours la lecture : aucun « cache hit » ne pouvait sauver la route. Deux
// versions durant, sur toute instance dont `plugins.bot` est posé, la voix du bot était
// entièrement hors service.
//
// Personne ne l'a vu, et ce n'est pas une négligence d'exploitant. Le corps de la route était
// enveloppé dans un `catch` NU qui rendait `{ ok: false }` : ni pile, ni message, ni appel à
// `errors.capture`. La supervision de l'hôte n'aurait rien vu MÊME correctement branchée — c'est
// la route qui était muette. Le défaut a fini par être trouvé en LISANT le code, pas en le
// surveillant.
//
// ⚠️ ET C'ÉTAIT UN OUBLI RÉPÉTÉ, PAS UNE DOCTRINE. Neuf `catch` rendaient 500 sans signaler ; un
// seul capturait. `handler.js`, `presentations.js` et `retention.js` capturent depuis longtemps —
// l'intention de la maison était claire, seules ces routes l'avaient perdue en chemin.
//
// Ce banc éprouve la route qui a cassé. Les huit autres sont corrigées de la même main ; elles ne
// sont pas éprouvées ici, et le dire vaut mieux que de laisser croire qu'elles le sont.

const player = require("../handler.js");

function contexte(captures, quiLeve) {
  return {
    plugins: { bot: { async getProfile() { return null; }, pronFix: () => null } },
    has: (n) => n === "bot",
    storage: { isAllowedUrl: () => false, async fetchFile() { return null; }, async put() {} },
    db: { async request() { if (quiLeve) throw new Error("base injoignable"); return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    // ⚠️ AUTHENTIFIÉ : `present-content` et `docshare.revoke` rendent 401 AVANT leur `try`, donc
    // sans identité le banc ne mesurait pas ce qu'il croyait — il mesurait un refus d'accès.
    identity: { async verifyToken() { return { email: "op@exemple.test" }; }, roleOf: () => "admin", isAdmin: () => true, async canManageShares() { return true; } },
    limits: { async allow() { if (quiLeve) throw new Error("base injoignable"); return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture(e, meta) { captures.push({ message: String(e && e.message), meta }); } },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "", supabasePublishableKey: "", mapsKey: "", extraFrameAncestors: [] },
  };
}

async function appeler(corps, { quiLeve }) {
  const captures = [];
  player.init(contexte(captures, quiLeve));
  const res = {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); },
  };
  await player.handler(
    { method: "POST", headers: { "content-type": "application/json" }, socket: {}, url: "/api/doc", body: corps },
    res,
  );
  return { res, captures };
}

const appelerBotTts = (opts) => appeler({ action: "bot-tts", slug: "un-lien", text: "bonjour" }, opts);

describe("une panne dans bot-tts", () => {
  const avant = process.env.ELEVENLABS_API_KEY;
  beforeAll(() => { process.env.ELEVENLABS_API_KEY = "cle-de-banc"; });
  afterAll(() => { if (avant === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = avant; });

  it("⚠️ EST SIGNALÉE, et pas seulement rendue en 500 — c'est ce qui manquait pendant deux versions", async () => {
    const { res, captures } = await appelerBotTts({ quiLeve: true });
    expect(res.statusCode).toBe(500);
    expect(captures).toHaveLength(1);
    expect(captures[0].message).toContain("base injoignable");
  });

  it("nomme la route dans ce qu'elle signale — un 500 sans nom n'oriente personne", async () => {
    const { captures } = await appelerBotTts({ quiLeve: true });
    expect(captures[0].meta).toEqual({ route: "bot-tts" });
  });

  it("⚠️ ne signale RIEN quand rien ne casse — une alerte qui sonne à vide apprend à ne plus regarder", async () => {
    const { captures } = await appelerBotTts({ quiLeve: false });
    expect(captures).toEqual([]);
  });
});

// ⚠️ LES NEUF CHEMINS, PAS SEULEMENT CELUI QUI A CASSÉ. La première version de ce banc n'éprouvait
// que `bot-tts` et le disait — « les huit autres ne sont pas couvertes ». La CI a refusé, sur la
// couverture, et elle avait raison : neuf pannes muettes remplacées par neuf chemins de signalement
// non éprouvés, c'est la même faute en plus petit.
//
// ⚠️ ET L'ÉTIQUETTE N'EST PLUS CHOISIE À LA MAIN. Chaque `catch` couvre un BLOC de plusieurs
// actions — celui de `routes-agent` en porte huit — donc un nom fixe aurait menti sur huit appels
// sur neuf. Ce qui est signalé est l'action RÉELLE de la requête, dérivée du corps.
describe("chaque route qui rend 500 signale ce qui l'a fait tomber", () => {
  const avant = process.env.ELEVENLABS_API_KEY;
  beforeAll(() => { process.env.ELEVENLABS_API_KEY = "cle-de-banc"; });
  afterAll(() => { if (avant === undefined) delete process.env.ELEVENLABS_API_KEY; else process.env.ELEVENLABS_API_KEY = avant; });

  const CAS = [
    { action: "bot-tts", corps: { slug: "s", text: "bonjour" } },
    { action: "bot-say", corps: { slug: "s", sessionId: "x", text: "bonjour" } },
    { action: "present-attend", corps: { slug: "s" } },
    { action: "present-content", corps: { slug: "s", content: {} } },
    { action: "present-chat", corps: { slug: "s", body: "coucou" } },
    { action: "present-upload-url", corps: { slug: "s", name: "a.png", type: "image/png" } },
    { action: "present-msg-delete", corps: { slug: "s", msgId: "1" } },
    { action: "present-react", corps: { slug: "s", msgId: "1", emoji: "👍" } },
    { action: "docshare.revoke", corps: { slug: "s" } },
  ];

  for (const { action, corps } of CAS) {
    it(`« ${action} » : 500 signalé, et l'action nommée`, async () => {
      const { res, captures } = await appeler({ action, ...corps }, { quiLeve: true });
      expect(res.statusCode).toBe(500);
      expect(captures).toHaveLength(1);
      expect(captures[0].meta).toEqual({ route: action });
      expect(captures[0].message).toContain("base injoignable");
    });
  }
});
