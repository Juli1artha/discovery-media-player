// LE FICHIER LOCAL ÉTAIT ALLOUÉ EN ENTIER, PUIS SEULEMENT REFUSÉ.
//
// Le plafond du relais se vérifiait dans le handler, sur `Content-Length` — donc APRÈS que
// `readLocal` avait déjà fait son `Buffer.alloc` de toute la plage. Un fichier local plus grand
// que le plafond coûtait son allocation À CHAQUE REQUÊTE avant d'être refusé : le refus payait
// exactement le prix qu'il devait éviter. Sur une instance publique, c'est un déni de service à
// une requête près. Constat du troisième audit.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { localRoot, fetchAllowedFile } = require("../storage.js");

const racine = fs.mkdtempSync(path.join(os.tmpdir(), "player-plafond-"));
fs.writeFileSync(path.join(racine, "gros.pdf"), Buffer.alloc(200, 7));
const root = localRoot({ PLAYER_LOCAL_ROOT: racine });
const url = "file://" + path.join(racine, "gros.pdf");
const source = { origins: [], hostBase: null, root, secret: "" };

afterAll(() => { fs.rmSync(racine, { recursive: true, force: true }); });

describe("le plafond du relais local refuse AVANT d'allouer", () => {
  const ancien = process.env.PLAYER_MAX_RELAY_BYTES;
  afterEach(() => {
    if (ancien === undefined) delete process.env.PLAYER_MAX_RELAY_BYTES;
    else process.env.PLAYER_MAX_RELAY_BYTES = ancien;
  });

  it("un fichier plus grand que le plafond : 413, corps vide", async () => {
    process.env.PLAYER_MAX_RELAY_BYTES = "100";
    const r = await fetchAllowedFile(url, {}, source);
    expect(r.status).toBe(413);
    expect((await r.arrayBuffer()).length, "un refus qui transporte le corps n'a rien refusé").toBe(0);
  });

  // ⚠️ La moitié légitime : une PLAGE sous le plafond d'un fichier au-dessus passe — c'est tout
  // l'intérêt du Range, servir un morceau d'un document qu'on refuserait en entier.
  it("une plage sous le plafond du même fichier passe", async () => {
    process.env.PLAYER_MAX_RELAY_BYTES = "100";
    const r = await fetchAllowedFile(url, { range: "bytes=0-49" }, source);
    expect(r.status).toBe(206);
    expect((await r.arrayBuffer()).length).toBe(50);
  });

  it("sans plafond posé : le défaut de 60 Mo laisse passer un fichier ordinaire", async () => {
    delete process.env.PLAYER_MAX_RELAY_BYTES;
    const r = await fetchAllowedFile(url, {}, source);
    expect(r.status).toBe(200);
    expect((await r.arrayBuffer()).length).toBe(200);
  });
});
