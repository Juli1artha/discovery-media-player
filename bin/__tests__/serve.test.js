// LE SERVEUR AUTONOME — la preuve que le cœur ne dépend d'aucune plateforme.
//
// Le player est un gestionnaire `(req, res)` : Vercel, Next.js, Express et le serveur HTTP de Node
// l'acceptent tel quel. Ce test tient cette promesse — si un jour le cœur se met à exiger un objet
// de requête particulier, c'est ici que ça casse, pas chez celui qui essaie de l'héberger.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "player-serve-")));
fs.writeFileSync(path.join(racine, "rapport.pdf"), "%PDF-1.4 " + "x".repeat(400));
process.env.PLAYER_LOCAL_ROOT = racine;

const { versParametres } = require("../serve.js");

const params = (chemin) => versParametres(new URL("http://localhost:3000" + chemin));

describe("traduction des chemins publics", () => {
  // ⚠️ Ces deux formes vivent dans des courriels envoyés à des tiers. Elles ne changent jamais.
  it("garde /doc/:slug et /present/:slug", () => {
    expect(params("/doc/Ab3-_xYz9012")).toMatchObject({ slug: "Ab3-_xYz9012" });
    expect(params("/present/Ab3-_xYz9012")).toMatchObject({ present: "Ab3-_xYz9012" });
  });

  it("refuse un slug qui n'en est pas un", () => {
    expect(params("/doc/../../etc/passwd").slug).toBeUndefined();
  });

  it("ouvre un document du dossier local par son nom", () => {
    const q = params("/preview/rapport.pdf");
    expect(q.preview).toBe("1");
    expect(q.url).toBe("file://" + path.join(racine, "rapport.pdf"));
    expect(q.name).toBe("rapport.pdf");
  });
});

describe("le player répond sans plateforme", () => {
  const player = require("../../server/handler.js");
  const { createStandaloneContext } = require("../../context/standalone.js");
  player.init(createStandaloneContext(process.env));

  async function appel(query, headers = {}) {
    const res = {
      statusCode: 0, headers: {}, body: "",
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(b) { this.body = b == null ? "" : b; },
    };
    await player.handler({ method: "GET", headers, socket: {}, query }, res);
    return res;
  }

  it("affiche un document du dossier local, sans base ni Storage", async () => {
    const res = await appel(params("/preview/rapport.pdf"));
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toMatch(/Player\.tracking\.createTracker\(/);
  });

  it("sert le fichier avec sa vraie taille et accepte un Range", async () => {
    const q = { ...params("/preview/rapport.pdf"), stream: "1" };
    const entier = await appel(q);
    expect(entier.statusCode).toBe(200);
    expect(entier.headers["content-length"]).toBe("409");

    const bout = await appel(q, { range: "bytes=0-8" });
    expect(bout.statusCode).toBe(206);
    expect(bout.headers["content-range"]).toBe("bytes 0-8/409");
  });

  it("dit qui il est sans configuration", async () => {
    const carte = JSON.parse(await appel({ contract: "1" }).then((r) => r.body));
    expect(carte.contract).toBe(1);
    // Aucun greffon : le cœur affiche, trace et présente tout seul.
    expect(Object.values(carte.plugins).every((v) => v === false)).toBe(true);
  });

  // ⚠️ Le défaut qui compte : sans câblage, le player ne SAIT PAS qui a le droit de diffuser.
  // Il refuse. Un droit qu'on ne sait pas accorder ne s'accorde pas.
  it("refuse la diffusion tant que l'hôte n'a pas répondu", async () => {
    const ctx = createStandaloneContext({ ...process.env, PLAYER_HOST_AUTHZ_URL: "" });
    expect(await ctx.identity.canManageShares({ email: "a@b.fr" }, "create")).toBe(false);
    expect(await ctx.identity.canManageShares(null, "create")).toBe(false);
  });
});
