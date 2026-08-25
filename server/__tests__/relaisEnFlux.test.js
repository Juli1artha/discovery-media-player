// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ LE PLAFOND ANNONCÉ CROIT L'AMONT SUR PAROLE — CE QUI N'EN FAIT PAS UNE PROTECTION.
//
// Un stockage qui n'annonce aucune taille, ou qui en annonce une fausse, traversait le relais sans
// être inquiété : le fichier ENTIER partait en mémoire. Trois requêtes Range simultanées sur un gros
// document, et la fonction tombe — pas pour ce document, pour la somme.
//
// Le relais passe donc en FLUX, avec un compteur qui rompt. Ce fichier éprouve trois choses que la
// bufferisation rendait invérifiables :
//   1. qu'on relaie VRAIMENT au fil de l'eau (des octets arrivent avant que l'amont ait fini),
//   2. qu'un amont qui MENT est coupé, et qu'on cesse de tirer chez lui,
//   3. qu'on n'annonce une longueur que lorsqu'elle décrit ce qu'on envoie.

// ⚠️ Le plafond est lu au CHARGEMENT du module : l'affecter après le `require` ne changerait rien.
process.env.PLAYER_MAX_RELAY_BYTES = String(256 * 1024);
const { Writable } = require("node:stream");
const handler = require("../handler.js");

const PLAFOND = 256 * 1024;
const MORCEAU = 30 * 1024; // > le tampon interne du flux, et 8 morceaux tiennent sous le plafond

function contexte(journal) {
  return {
    plugins: {}, has: () => false, branding: {}, config: {}, db: {}, storage: {},
    errors: { capture(e) { journal.push(String((e && e.message) || e)); } },
  };
}

// ⚠️ UN VRAI FLUX EN SORTIE. Contre un objet qui se contente d'enregistrer un appel à `end`, une
// implémentation qui bufferise tout et une qui relaie au fil de l'eau sont indiscernables.
class FauxRes extends Writable {
  constructor() { super({ highWaterMark: 1 }); this.statusCode = 0; this.entetes = {}; this.recus = []; this.detruit = false; }
  setHeader(k, v) { this.entetes[k] = v; }
  _write(morceau, _enc, fini) { this.recus.push(Buffer.from(morceau)); setImmediate(fini); }
  _destroy(err, fini) { this.detruit = true; fini(err); }
  octets() { return this.recus.reduce((n, b) => n + b.length, 0); }
}

// Une source qui rend la main à chaque morceau : `avantChaque` observe l'amont pendant qu'il coule.
function source(nombre, taille, options = {}) {
  let i = 0;
  return new ReadableStream({
    pull(controle) {
      if (i >= nombre) { controle.close(); return; }
      i += 1;
      if (options.avantChaque) options.avantChaque(i);
      controle.enqueue(new Uint8Array(taille));
    },
    cancel() { if (options.onAnnule) options.onAnnule(); },
  });
}

function reponse(entetes, body, status = 200) {
  return { ok: status < 400, status, headers: new Headers(entetes), body };
}

describe("le relais coule au lieu de tout charger", () => {
  it("des octets sont déjà partis quand l'amont produit son dernier morceau", async () => {
    const journal = []; handler.init(contexte(journal));
    const res = new FauxRes();
    let dejaSortis = null;
    const corps = source(8, MORCEAU, { avantChaque: (n) => { if (n === 8) dejaSortis = res.octets(); } });

    await handler.__relayerFichier(res, reponse({ "content-type": "application/pdf" }, corps), "inline");

    expect(res.octets()).toBe(8 * MORCEAU);
    // Une implémentation qui bufferise n'a RIEN écrit à cet instant : elle lit d'abord, écrit ensuite.
    expect(dejaSortis, "le relais a tout lu avant d'écrire quoi que ce soit").toBeGreaterThan(0);
  });

  it("un amont qui annonce 1 Ko et en envoie 1,25 Mo est COUPÉ, et on cesse de tirer chez lui", async () => {
    const journal = []; handler.init(contexte(journal));
    const res = new FauxRes();
    let annule = false;
    const corps = source(40, MORCEAU, { onAnnule: () => { annule = true; } });

    await handler.__relayerFichier(res, reponse({ "content-length": "1024", "content-type": "application/pdf" }, corps), "inline");

    expect(res.octets(), "le plafond n'a pas retenu un amont qui ment").toBeLessThanOrEqual(PLAFOND);
    expect(res.detruit, "on ne peut pas répondre 413 après le premier octet : il faut rompre").toBe(true);
    // ⚠️ Le point n'est pas d'arrêter d'écrire, c'est d'arrêter de LIRE : sans annulation, l'amont
    // continue de nous envoyer le fichier et la mémoire y passe quand même.
    expect(annule, "on a cessé d'écrire mais on tirait encore chez l'amont").toBe(true);
    expect(journal.join(" ")).toContain("relais interrompu");
  });

  it("amont comprimé : AUCUNE longueur annoncée — fetch décompresse, la longueur reçue est fausse", async () => {
    const journal = []; handler.init(contexte(journal));
    const res = new FauxRes();
    const corps = source(2, 1000);

    await handler.__relayerFichier(res, reponse(
      { "content-length": "300", "content-encoding": "gzip", "content-type": "application/pdf" }, corps), "inline");

    expect(res.entetes["Content-Length"], "300 octets annoncés, 2000 envoyés : le client coupe ou attend").toBeUndefined();
    expect(res.octets()).toBe(2000);
  });

  it("amont non comprimé : la longueur annoncée est relayée telle quelle", async () => {
    const journal = []; handler.init(contexte(journal));
    const res = new FauxRes();

    await handler.__relayerFichier(res, reponse(
      { "content-length": "2000", "content-type": "application/pdf" }, source(2, 1000)), "inline");

    expect(res.entetes["Content-Length"]).toBe("2000");
    expect(res.octets()).toBe(2000);
  });
});

// ⚠️ CE QUE LE PASSAGE EN FLUX A FAILLI CASSER, ET QUI N'EST PAS UN CAS LIMITE.
//
// `storage.fetchFile` est une capacité de l'HÔTE : il rend ce qu'il veut du moment qu'il sait dire
// `arrayBuffer()`. Le chemin fichier local du mode autonome ne rend rien d'autre — pas de corps
// lisible. Traiter cette absence comme « rien à envoyer » servait des fichiers VIDES, en silence.
describe("un amont sans corps lisible reste servi, entier", () => {
  it("les octets passent, et la longueur — connue — est annoncée", async () => {
    const journal = []; handler.init(contexte(journal));
    const res = new FauxRes();
    const octets = Buffer.from("des octets bien réels", "utf8"); // un accent = deux octets : on compte, on ne devine pas
    const amont = {
      ok: true, status: 200,
      headers: new Headers({ "content-type": "application/pdf" }),
      arrayBuffer: async () => octets,
    };

    await handler.__relayerFichier(res, amont, "inline");

    expect(res.octets(), "un fichier vide servi sans une erreur pour le dire").toBe(octets.length);
    expect(res.entetes["Content-Length"]).toBe(String(octets.length));
  });
});
