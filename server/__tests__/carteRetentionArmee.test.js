// LA CARTE DIT SI LE BALAYAGE DE RÉTENTION EST ARMÉ.
//
// ⚠️ Signalé par le second hôte (suite du neuvième audit) : la carte annonce la CAPACITÉ
// `retention` (l'instance PEUT purger) mais pas si le balayage automatique est ARMÉ
// (`config.retention.balayage === true`). Les deux défauts du 9e audit se composaient : une purge
// qui supprimait quand on la croyait à blanc, sur une instance dont la carte ne disait pas si elle
// était armée. Comme `internalStrict`, l'état doit être MESURABLE — un cockpit doit pouvoir le
// lire, pas le déduire d'un journal.
const schema = require("../schema.js");

async function carte(retentionCfg) {
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; }, isTrustedHostCall: () => false },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], retention: retentionCfg },
  };
  delete require.cache[require.resolve("../handler.js")];
  const p = require("../handler.js"); p.init(ctx); schema.init(ctx);
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b == null ? "" : b); } };
  await p.handler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, res);
  return JSON.parse(res.body);
}

describe("l'armement de la rétention est dans la carte", () => {
  it("balayage: true → retentionSweep true", async () => {
    expect((await carte({ balayage: true })).retentionSweep).toBe(true);
  });
  it("balayage absent ou false → retentionSweep false (le défaut, et le nôtre)", async () => {
    expect((await carte({})).retentionSweep).toBe(false);
    expect((await carte({ balayage: false })).retentionSweep).toBe(false);
    expect((await carte(undefined)).retentionSweep).toBe(false);
  });
});
