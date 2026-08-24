// LA GRAINE DU SCAN DOIT SERVIR — SINON LE SCAN MESURE LE VIDE.
//
// Le job zap sonde ses trois surfaces en CI avant de scanner (un scan d'un 404 est vert et
// vide). Ce banc pose la même question AVANT la CI, en local, là où elle coûte une seconde :
// la graine de tools/zap-base-de-scan.mjs, jouée dans la doublure PostgREST, doit faire rendre
// la visionneuse tracée et la présentation par le player. Une colonne renommée dans le schéma,
// un champ retiré de la graine — c'est ici que ça rougit, pas dans un run de workflow.

const { createRequire } = require("node:module");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const requireCjs = createRequire(__filename);
const { creerPostgrestEnMemoire } = requireCjs("../postgrest-en-memoire.cjs");

describe("la graine du scan ZAP sert ses deux routes", () => {
  let base, player;

  beforeAll(async () => {
    const { graineDeScan } = await import("../zap-base-de-scan.mjs");
    const fichier = pathToFileURL(path.join(__dirname, "..", "..", "examples", "demo", "documents", "sample.pdf")).href;
    ({ serveur: base } = creerPostgrestEnMemoire(graineDeScan(fichier)));
    await new Promise((resolve) => base.listen(0, "127.0.0.1", resolve));

    // Le même câblage que bin/serve.js : contexte autonome, base par SUPABASE_URL. La racine
    // locale couvre le fichier de la graine, comme /data couvre celui du conteneur en CI.
    player = requireCjs("../../server/handler.js");
    const { createStandaloneContext } = requireCjs("../../context/standalone.js");
    player.init(createStandaloneContext({
      ...process.env,
      SUPABASE_URL: `http://127.0.0.1:${base.address().port}`,
      SUPABASE_SERVICE_ROLE_KEY: "cle-sans-valeur-de-scan",
      PLAYER_LOCAL_ROOT: path.join(__dirname, "..", "..", "examples", "demo", "documents"),
    }));
  });

  afterAll(() => new Promise((resolve) => base.close(resolve)));

  async function appel(query) {
    const res = {
      statusCode: 0, headers: {}, body: "",
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(b) { this.body = b == null ? "" : b; },
    };
    await player.handler({ method: "GET", headers: {}, socket: {}, query }, res);
    return res;
  }

  it("le lien tracé rend sa page, avec sa politique", async () => {
    const { SLUG_DOC } = await import("../zap-base-de-scan.mjs");
    const res = await appel({ slug: SLUG_DOC });
    expect(res.statusCode, "un 404 ici = un scan CI qui mesure le vide").toBe(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });

  it("la présentation rend sa page, avec sa politique", async () => {
    const { SLUG_PRESENT } = await import("../zap-base-de-scan.mjs");
    const res = await appel({ present: SLUG_PRESENT });
    expect(res.statusCode, "un 404 ici = un scan CI qui mesure le vide").toBe(200);
    expect(res.headers["content-security-policy"]).toContain("default-src 'none'");
  });
});
