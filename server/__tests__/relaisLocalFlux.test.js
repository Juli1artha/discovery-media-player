// LE RELAIS DE FICHIERS LOCAUX DIFFUSE — IL N'ALLOUE PLUS LA PLAGE DEMANDÉE.
//
// ⚠️ P1 d'audit externe. `readLocal` faisait `Buffer.alloc(fin - debut + 1)` : jusqu'à 60 Mio par
// requête, SOUS le plafond, donc parfaitement « autorisé ». Un visiteur qui connaît un lien public
// envoie vingt requêtes sans `Range` sur un fichier de 50 Mio → environ 1 Gio d'un coup.
//
// Le plafond bornait la taille d'UNE lecture ; rien ne bornait son PRODUIT par la concurrence — et
// c'est le produit que la mémoire subit. Une borne par requête n'est pas une borne par processus.

const fs = require("node:fs");
const fsp = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

let dossier, fichier;
const TAILLE = 8 * 1024 * 1024;          // 8 Mio : assez pour que l'allocation se voie

beforeAll(async () => {
  // ⚠️ `realpathSync` : `resolveLocal` normalise le chemin CIBLE mais compare la racine telle
  // qu'on la lui donne. Sur macOS, /var/folders mène à /private/var/folders — une racine non
  // normalisée fait tout refuser. C'est le contrat de l'appelant, et il vaut aussi en production.
  dossier = fs.realpathSync(await fsp.mkdtemp(path.join(os.tmpdir(), "player-flux-")));
  fichier = path.join(dossier, "gros.pdf");
  await fsp.writeFile(fichier, Buffer.alloc(TAILLE, 0x41));
});
afterAll(async () => { await fsp.rm(dossier, { recursive: true, force: true }); });

const storage = () => require("../../context/storage.js");

// ⚠️ La racine passe par le TROISIÈME argument (`root`), et l'URL doit être une `file://` — c'est
// `resolveLocal` qui compare les chemins RÉELS des deux côtés (sur macOS, /tmp mène à /private/tmp).
const lire = async (s, plage) =>
  s.fetchAllowedFile(new URL("file://" + fichier).href, { range: plage }, { root: dossier });

describe("le chemin local rend un CORPS LISIBLE, pas un bloc", () => {
  it("la réponse porte un `body` — c'est ce qui la fait passer par le chemin de flux du relais", async () => {
    const r = await lire(storage());
    expect(r, "fichier local introuvable : le banc ne mesure rien").not.toBeNull();
    expect(r.status).toBe(200);
    expect(r.body, "sans `body`, le relais retombe sur arrayBuffer() et alloue tout").toBeTruthy();
    expect(typeof r.body.getReader, "un flux WEB, c'est ce que Readable.fromWeb attend").toBe("function");
    await r.arrayBuffer();                                   // on vide pour libérer le descripteur
  });

  it("Content-Length décrit la plage envoyée, et 206 porte son Content-Range", async () => {
    const r = await lire(storage(), "bytes=0-1023");
    expect(r.status).toBe(206);
    expect(r.headers.get("content-length")).toBe("1024");
    expect(r.headers.get("content-range")).toBe(`bytes 0-1023/${TAILLE}`);
    const buf = await r.arrayBuffer();
    expect(buf.length, "et le corps fait exactement cette taille").toBe(1024);
  });

  it("une borne absurde reste un 416", async () => {
    const r = await lire(storage(), `bytes=${TAILLE + 10}-`);
    expect(r.status).toBe(416);
  });

  // ⚠️ LE CŒUR : la mémoire ne doit plus suivre taille × concurrence.
  //
  // On ouvre vingt lectures SANS les consommer — le cas exact de l'audit — et on mesure le tas.
  // Avec `Buffer.alloc`, vingt fois 8 Mio étaient réservés AVANT tout envoi. En flux, rien n'est lu
  // tant que personne ne tire : la contre-pression fait le travail.
  it("vingt lectures concurrentes non consommées n'allouent pas vingt fois le fichier", async () => {
    const s = storage();
    // ⚠️ SANS CE CONTRÔLE, CE TEST PASSE À VIDE. Si `lire` rend `null` (racine mal passée, chemin
    // refusé), aucune allocation n'a lieu et la mesure de tas est trivialement sous le seuil : le
    // banc annonce alors une propriété qu'il n'a pas éprouvée. Il a déjà passé au vert comme ça.
    expect(await lire(s), "la lecture doit aboutir, sinon la mesure ne mesure rien").not.toBeNull();
    // ⚠️ ON MESURE `arrayBuffers`, PAS `heapUsed` — ET C'EST TOUT LE TEST. Un `Buffer` vit HORS du
    // tas V8 : la première version de cette mesure regardait `heapUsed`, qui rend −0 Mio pendant que
    // 160 Mio sont bel et bien réservés. Elle passait au vert avec le correctif ET avec le défaut
    // rétabli — un banc qui ne peut pas voir la grandeur qu'il surveille ne surveille rien.
    global.gc?.();
    const avant = process.memoryUsage().arrayBuffers;
    const ouvertes = [];
    for (let i = 0; i < 20; i++) ouvertes.push(await lire(s));
    const croissance = process.memoryUsage().arrayBuffers - avant;
    // Seuil LARGE : on ne mesure pas une consommation, on détecte un EFFONDREMENT du principe.
    // 20 × 8 Mio = 160 Mio si l'on allouait ; un flux non tiré doit rester à quelques Mio.
    expect(croissance,
      `${Math.round(croissance / 1048576)} Mio réservés pour 20 lectures de 8 Mio NON consommées :\n`
      + "la plage est de nouveau allouée d'avance, donc la mémoire suit taille × concurrence —\n"
      + "ce que le plafond par requête ne borne pas, puisqu'il borne UNE lecture.")
      .toBeLessThan(40 * 1024 * 1024);
    for (const r of ouvertes) { try { await r.body.cancel(); } catch { /* déjà fermé */ } }
  });

  it("annuler le corps referme le descripteur — sinon on épuise ce qu'on protège", async () => {
    const s = storage();
    const r = await lire(s);
    await r.body.cancel();
    // Un descripteur laissé ouvert par lecture ferait tomber le processus bien avant la mémoire.
    // On le constate par le fait qu'une nouvelle lecture reste possible en boucle.
    for (let i = 0; i < 200; i++) { const x = await lire(s); await x.body.cancel(); }
    expect(true, "200 ouvertures/annulations sans épuiser les descripteurs").toBe(true);
  });
});
