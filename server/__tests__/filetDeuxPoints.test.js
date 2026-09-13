// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// @vitest-environment jsdom
//
// ⚠️ LE MODÈLE DE CHARGE COMPTAIT UNE DÉCISION PAR INTERVALLE, LE NAVIGATEUR EN PROVOQUE DEUX. Le
// filet de resynchronisation relit l'état ET le chat toutes les 25 s : deux requêtes, deux clés de
// quota depuis le 13/09. `charge/audienceDerriereUneIp.test.js` simule le limiteur à partir de ce
// que le navigateur émet — ce banc est la COUTURE entre les deux : il exécute la vraie page
// d'audience et compte ce qu'un tick du filet émet réellement. Si le gabarit ajoute un troisième
// point un jour, ce banc rougit et le modèle doit suivre. Relevé par un audit externe le 13/09 :
// l'écart faisait annoncer 613 spectateurs par sortie là où le vrai limiteur en portait 306.
//
// ⚠️ ET LE FILET NE PART PAS EN CHŒUR. Mille spectateurs qui rejoignent ensemble relisaient
// ensemble — une rafale de 2 000 GET en phase toutes les 25 s. Le premier tick est désormais tiré
// entre 0 et 25 s ; la période reste de 25 s, la fréquence maximale ne monte pas.

const PRESENTATION_ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
const PRESENTATION = {
  slug: "Ab3-_xYz9012", doc_title: "Démo", file_name: "demo.pdf",
  file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/demo.pdf",
  current_page: 1, active: true, updated_at: "2026-08-16T00:00:00.000Z",
};
require.cache[PRESENTATION_ID] = {
  id: PRESENTATION_ID, filename: PRESENTATION_ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => ({ ...PRESENTATION }), listMessages: async () => [] },
};
const player = require("../handler.js");

function contexteMinimal() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "cle", mapsKey: "", extraFrameAncestors: [] },
  };
}

function scriptsDe(html) {
  const doc = new window.DOMParser().parseFromString(html, "text/html");
  return [...doc.querySelectorAll("script")].map((s) => s.textContent || "");
}

async function pageAudience() {
  player.init(contexteMinimal());
  const res = {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); },
  };
  await player.handler({ method: "GET", headers: {}, socket: {}, query: { present: PRESENTATION.slug } }, res);
  return res.body;
}

/** Rend la page, l'exécute avec un tirage de jitter IMPOSÉ, et compte les relectures par point. */
async function audience(tirage) {
  const html = await pageAudience();
  document.documentElement.innerHTML = html;
  const lectures = [];
  window.fetch = (url) => {
    lectures.push(String(url));
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, state: { active: true, current_page: 1 }, messages: [] }) });
  };
  window.supabase = { createClient: () => ({ channel: () => { const c = { on: () => c, subscribe: () => c, send: () => {}, track: () => {}, untrack: () => {}, unsubscribe: () => {} }; return c; }, removeChannel: () => {} }) };
  const vrai = Math.random;
  Math.random = () => tirage;
  try {
    for (const code of scriptsDe(html)) {
      try { window.eval(code + "\n;try{globalThis.Player=Player;}catch(e){}"); } catch { /* pdf.js n'est pas là */ }
    }
    window.Live.connect(PRESENTATION.slug, { name: "Spectateur", email: "", avatar: "", role: "viewer", member: false }, null);
  } finally { Math.random = vrai; }
  const depuis = lectures.length;
  return {
    etats: () => lectures.slice(depuis).filter((u) => u.includes("state=1")).length,
    chats: () => lectures.slice(depuis).filter((u) => u.includes("chat=1")).length,
  };
}

describe("⚠️ le filet émet ce que le modèle de charge compte : un état ET un chat par tick", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); try { window.Live.disconnect(); } catch { /* pas connecté */ } });

  it("un tick du filet = exactement une relecture d'état et une de chat", async () => {
    const a = await audience(0);              // jitter 0 : le premier tick part tout de suite
    await vi.advanceTimersByTimeAsync(10);
    expect(a.etats(), "contrôle positif : le premier tick a eu lieu").toBe(1);
    expect(a.chats()).toBe(1);
    await vi.advanceTimersByTimeAsync(25_000);
    expect(a.etats(), "un tick de plus, un état de plus").toBe(2);
    expect(a.chats(), "et un chat de plus — deux clés de quota, deux requêtes").toBe(2);
  });

  it("⚠️ le premier tick est décalé de 0 à 25 s selon le tirage, et la période reste de 25 s", async () => {
    const a = await audience(0.5);            // → décalage de 12 500 ms
    await vi.advanceTimersByTimeAsync(12_000);
    expect(a.etats(), "avant le décalage, rien").toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a.etats(), "au décalage, le premier tick").toBe(1);
    await vi.advanceTimersByTimeAsync(24_000);
    expect(a.etats(), "pas avant 25 s de plus").toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(a.etats()).toBe(2);
  });

  it("⚠️ sur une heure, chaque point reste sous RESYNC_READS_PER_HOUR quel que soit le tirage — le décalage n'ajoute rien", async () => {
    const C = window.Player.cadence;
    for (const tirage of [0, 0.999]) {
      const a = await audience(tirage);
      await vi.advanceTimersByTimeAsync(3_600_000);
      // +1 : une heure FERMÉE contient 145 multiples de 25 s quand un tick tombe sur ses deux bords
      // (0 et 3 600 000). C'était déjà vrai sans décalage pour une fenêtre [3600 s, 7200 s] ; la
      // marge ×4 du quota le couvre, et ce banc mesure la période, pas la coïncidence des bords.
      expect(a.etats(), `tirage ${tirage}`).toBeLessThanOrEqual(C.RESYNC_READS_PER_HOUR + 1);
      expect(a.chats(), `tirage ${tirage}`).toBeLessThanOrEqual(C.RESYNC_READS_PER_HOUR + 1);
      expect(a.etats(), "et le filet tourne bien : au moins 143 ticks sur l'heure").toBeGreaterThanOrEqual(C.RESYNC_READS_PER_HOUR - 1);
      try { window.Live.disconnect(); } catch { /* déjà */ }
    }
  });
});
