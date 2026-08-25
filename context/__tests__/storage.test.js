// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE DOSSIER LOCAL — la source qui rend le player essayable, et celle qui pourrait tout ouvrir.
//
// Servir un dossier est le mode d'exploitation le plus simple (aucune base, aucun Storage) et le
// plus dangereux si la contenance est approximative : un `..`, un lien symbolique, une racine
// voisine dont le nom commence pareil. Ces tests sont la raison pour laquelle on peut la proposer.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { localRoot, resolveLocal, isAllowedStorageUrl, fetchAllowedFile } =
  require("../storage.js");

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "player-")));
const racine = path.join(base, "documents");
const voisin = path.join(base, "documents-prives");   // ⚠️ commence comme la racine
fs.mkdirSync(racine); fs.mkdirSync(voisin);
fs.writeFileSync(path.join(racine, "rapport.pdf"), "%PDF-1.4 " + "x".repeat(200));
fs.writeFileSync(path.join(voisin, "salaires.pdf"), "%PDF-1.4 confidentiel");
fs.writeFileSync(path.join(base, "dehors.pdf"), "%PDF-1.4 dehors");
try { fs.symlinkSync(path.join(base, "dehors.pdf"), path.join(racine, "evasion.pdf")); } catch { /* FS sans liens */ }

const root = localRoot({ PLAYER_LOCAL_ROOT: racine });
const url = (p) => "file://" + p;

describe("racine locale", () => {
  it("n'existe que si on la demande — aucun fichier local par défaut", () => {
    expect(localRoot({})).toBeNull();
    expect(isAllowedStorageUrl(url(path.join(racine, "rapport.pdf")), [], null, null)).toBe(false);
  });

  it("accepte un document de la racine", () => {
    expect(resolveLocal(url(path.join(racine, "rapport.pdf")), root)).toBe(path.join(racine, "rapport.pdf"));
    expect(isAllowedStorageUrl(url(path.join(racine, "rapport.pdf")), [], null, root)).toBe(true);
  });

  // ⚠️ Le piège de la comparaison de chaînes : `/…/documents` accepterait `/…/documents-prives`.
  // C'est le même défaut que la barre finale d'un préfixe d'URL, une couche plus bas.
  it("ne confond pas un dossier voisin dont le nom commence pareil", () => {
    expect(resolveLocal(url(path.join(voisin, "salaires.pdf")), root)).toBeNull();
  });

  it("ne remonte pas hors de la racine", () => {
    expect(resolveLocal(url(path.join(racine, "..", "dehors.pdf")), root)).toBeNull();
    expect(resolveLocal(url("/etc/passwd"), root)).toBeNull();
  });

  // Un lien posé DANS la racine et pointant dehors : le chemin normalisé a l'air bon, le fichier
  // réel ne l'est pas. Seule la résolution des liens le voit.
  it("ne suit pas un lien symbolique qui sort de la racine", () => {
    const lien = path.join(racine, "evasion.pdf");
    if (!fs.existsSync(lien)) return;
    expect(resolveLocal(url(lien), root)).toBeNull();
  });

  it("refuse un octet nul et tout ce qui n'est pas un fichier", () => {
    expect(resolveLocal("file://" + path.join(racine, "rapport.pdf") + "%00.png", root)).toBeNull();
    expect(resolveLocal("https://exemple.fr/x.pdf", root)).toBeNull();
    expect(resolveLocal("", root)).toBeNull();
  });
});

describe("lecture d'un fichier local", () => {
  const source = { origins: [], hostBase: null, root };

  it("sert le fichier entier avec sa vraie taille", async () => {
    const r = await fetchAllowedFile(url(path.join(racine, "rapport.pdf")), {}, source);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await r.arrayBuffer()).length).toBe(209);
  });

  // Le chargement progressif de pdf.js en dépend : sans Range, un document lourd reste blanc.
  it("honore un Range, et le dit", async () => {
    const r = await fetchAllowedFile(url(path.join(racine, "rapport.pdf")), { range: "bytes=0-8" }, source);
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 0-8/209");
    expect(Buffer.from(await r.arrayBuffer()).toString()).toBe("%PDF-1.4 ");
  });

  it("comprend un suffixe (`bytes=-10`)", async () => {
    const r = await fetchAllowedFile(url(path.join(racine, "rapport.pdf")), { range: "bytes=-10" }, source);
    expect(r.status).toBe(206);
    expect(r.headers.get("content-range")).toBe("bytes 199-208/209");
  });

  it("répond 416 sur une borne absurde plutôt que de servir n'importe quoi", async () => {
    const r = await fetchAllowedFile(url(path.join(racine, "rapport.pdf")), { range: "bytes=9999-" }, source);
    expect(r.status).toBe(416);
  });

  it("ne lit rien hors de la racine, même si le chemin existe", async () => {
    expect(await fetchAllowedFile(url(path.join(voisin, "salaires.pdf")), {}, source)).toBeNull();
  });

  it("ne sert pas un dossier", async () => {
    expect(await fetchAllowedFile(url(racine), {}, source)).toBeNull();
  });
});

// ⚠️ UN SVG EST UN DOCUMENT EXÉCUTABLE.
//
// Servi `image/svg+xml` en ligne, il s'ouvre sur l'origine du player et son script s'exécute avec
// elle — et la réponse de streaming ne porte aucune CSP, puisque c'est un fichier et pas une page.
// Il n'était par ailleurs pas affichable : `isImageDocument()` ne le reconnaît pas, la visionneuse
// l'envoyait à pdf.js, écran blanc. Servi sans être affichable : le pire des deux mondes.
describe("formats servis depuis un dossier local", () => {
  const fs = require("node:fs"); const os = require("node:os"); const p = require("node:path");
  const dir = fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(), "player-types-")));
  const root = localRoot({ PLAYER_LOCAL_ROOT: dir });
  const source = { origins: [], hostBase: null, root };

  it("ne sert jamais un SVG comme image en ligne", async () => {
    fs.writeFileSync(p.join(dir, "piege.svg"), '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    const r = await fetchAllowedFile("file://" + p.join(dir, "piege.svg"), {}, source);
    expect(r.headers.get("content-type"), "un SVG ne doit pas sortir en image/svg+xml").not.toBe("image/svg+xml");
    expect(r.headers.get("content-type")).toBe("application/octet-stream");
  });

  it("sert les formats de la matrice avec leur vrai type", async () => {
    for (const [nom, type] of [["a.pdf", "application/pdf"], ["b.png", "image/png"], ["c.jpg", "image/jpeg"],
                               ["d.webp", "image/webp"], ["e.gif", "image/gif"], ["f.avif", "image/avif"]]) {
      fs.writeFileSync(p.join(dir, nom), "x");
      const r = await fetchAllowedFile("file://" + p.join(dir, nom), {}, source);
      expect(r.headers.get("content-type"), nom).toBe(type);
    }
  });
});
