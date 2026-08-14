// DEUX RÉSOLUTIONS DU MÊME NOM, À DEUX INSTANTS.
//
// `readLocal` faisait `stat(chemin)` puis, plus bas, `open(chemin)`. Ce sont deux résolutions du
// même NOM à deux moments différents. Entre les deux, le fichier peut avoir été remplacé — une
// synchronisation, un `mv` de déploiement, un client qui réécrit son document.
//
// ⚠️ La conséquence n'est pas un plantage, c'est PIRE : on lisait les octets du NOUVEAU fichier
// avec la taille de l'ANCIEN. Le `Content-Range` annonce alors un total qui ne décrit pas ce qu'il
// transporte, et la visionneuse assemble un document faux sans qu'aucune erreur ne sorte.
//
// Un descripteur désigne un OBJET, pas un nom : `fh.stat()` parle du même fichier que `fh.read()`,
// quoi qu'il advienne du chemin entre-temps.
//
// Signalé par l'analyse statique (js/file-system-race).

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const { fetchAllowedFile, localRoot } = require("../storage.js");

let racine;
beforeEach(async () => {
  racine = await fsp.mkdtemp(path.join(os.tmpdir(), "player-course-"));
});
afterEach(async () => {
  await fsp.rm(racine, { recursive: true, force: true });
});

function source() {
  return { origins: [], hostBase: null, root: localRoot({ PLAYER_LOCAL_ROOT: racine }) };
}
async function lire(nom, range) {
  const url = require("node:url").pathToFileURL(path.join(racine, nom)).href;
  return fetchAllowedFile(url, range ? { range } : {}, source());
}

describe("la taille et les octets viennent du même fichier", () => {
  it("un document entier est servi tel quel", async () => {
    await fsp.writeFile(path.join(racine, "doc.pdf"), Buffer.alloc(5000, 0x41));
    const r = await lire("doc.pdf");
    expect(r.status).toBe(200);
    expect(Buffer.from(await r.arrayBuffer())).toHaveLength(5000);
  });

  it("un fragment reste un fragment", async () => {
    await fsp.writeFile(path.join(racine, "doc.pdf"), Buffer.alloc(5000, 0x41));
    const r = await lire("doc.pdf", "bytes=0-99");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 0-99/5000");
    expect(Buffer.from(await r.arrayBuffer())).toHaveLength(100);
  });

  // ⚠️ LE CAS QUI COMPTE. On remplace le fichier par un PLUS PETIT pendant la lecture. Avec un
  // `stat` par nom, le total annoncé serait celui de l'ancien ; avec le descripteur, la réponse
  // décrit toujours le fichier qu'elle transporte.
  it("remplacer le fichier après ouverture ne fabrique pas un total menteur", async () => {
    const chemin = path.join(racine, "doc.pdf");
    await fsp.writeFile(chemin, Buffer.alloc(5000, 0x41));

    const url = require("node:url").pathToFileURL(chemin).href;
    const promesse = fetchAllowedFile(url, { range: "bytes=0-99" }, source());
    // Le remplacement part avant que la lecture ne soit réglée.
    await fsp.writeFile(path.join(racine, "petit.pdf"), Buffer.alloc(10, 0x42));
    await fsp.rename(path.join(racine, "petit.pdf"), chemin);

    const r = await promesse;
    const total = Number(String(r.headers.get("content-range") || "").split("/")[1]);
    const octets = Buffer.from(await r.arrayBuffer()).length;
    // Quel que soit celui des deux fichiers qu'on a ouvert, le total annoncé est le sien.
    expect([10, 5000], `total annoncé : ${total}`).toContain(total);
    expect(octets, "on n'envoie jamais plus que le fichier ouvert").toBeLessThanOrEqual(total);
  });

  it("un fichier disparu ne rend rien, sans lever", async () => {
    expect(await lire("absent.pdf")).toBeNull();
  });

  it("un dossier n'est pas un document", async () => {
    await fsp.mkdir(path.join(racine, "dossier.pdf"));
    expect(await lire("dossier.pdf")).toBeNull();
  });
});

// ⚠️ LA GARDE. Le test ci-dessus ne peut pas provoquer la course de façon fiable — c'est une
// question d'ordonnancement. Celle-ci refuse la FORME qui la rend possible : interroger un chemin
// pour ensuite en ouvrir un.
describe("aucune lecture n'interroge un chemin pour en ouvrir un ensuite", () => {
  it("readLocal n'appelle pas stat sur un nom", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "storage.js"), "utf8");
    const debut = src.indexOf("async function readLocal");
    const fin = src.indexOf("\nfunction reponse", debut);
    const corps = src.slice(debut, fin);
    expect(corps.includes("fsp.open"), "on ouvre").toBe(true);
    expect(corps.includes("fh.stat()"), "et on interroge le descripteur").toBe(true);
    expect(/fsp\.stat\(/.test(corps), "jamais fsp.stat(chemin) : c'est la course").toBe(false);
  });
});
