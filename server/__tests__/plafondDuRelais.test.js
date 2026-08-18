// LE RELAIS CHARGEAIT LE FICHIER ENTIER EN MÉMOIRE, SANS AUCUNE BORNE.
//
// Un PDF de 80 Mo, trois requêtes Range simultanées, et une fonction serverless tombe — pas pour un
// document en particulier, pour la somme. Le défaut n'était pas la taille d'un fichier, c'était
// l'absence de toute limite haute.
//
// ⚠️ CE PLAFOND-CI EST LE PREMIER DES DEUX, ET LE SEUL QUI PUISSE ENCORE RÉPONDRE. Il regarde
// `Content-Length` et renonce sans toucher au corps — vérifié ici en constatant que l'amont n'est
// JAMAIS tiré. Refuser après avoir lu ne protège de rien : c'est la lecture qui coûte.
//
// ⚠️ ET UN AMONT QUI N'ANNONCE PAS SA TAILLE PASSE QUAND MÊME ICI. On ne peut pas refuser ce qu'on
// ne sait pas mesurer, et fermer par défaut couperait des stockages parfaitement légitimes. Ce
// n'est plus un trou : le compteur d'octets du flux le rattrape — cf. `relaisEnFlux.test.js`.

const { Writable } = require("node:stream");
const handler = require("../handler.js");

// Le contexte minimal que `init` exige — il lit les greffons au câblage.
function contexte() {
  return { plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, db: {}, storage: {} };
}

class FauxRes extends Writable {
  constructor() { super({ highWaterMark: 1 }); this.statusCode = 0; this.entetes = {}; this.recus = []; }
  setHeader(k, v) { this.entetes[k] = v; }
  _write(m, _e, fini) { this.recus.push(Buffer.from(m)); fini(); }
  octets() { return this.recus.reduce((n, b) => n + b.length, 0); }
}

function reponse({ taille, status = 200 }) {
  let tire = 0, annule = false;
  const entetes = { "content-type": "application/pdf" };
  if (taille != null) entetes["content-length"] = String(taille);
  return {
    ok: status < 400, status, headers: new Headers(entetes),
    combienDeLectures: () => tire,
    aEteAnnule: () => annule,
    // ⚠️ `highWaterMark: 0`, sinon le flux appelle `pull` DE LUI-MÊME à la construction pour
    // remplir sa file : le compteur monterait à 1 sans que le relais ait touché à rien, et
    // l'essai accuserait le produit d'une lecture qui est la sienne.
    body: new ReadableStream({
      pull(controle) { tire += 1; controle.enqueue(new Uint8Array(16)); controle.close(); },
      cancel() { annule = true; },
    }, { highWaterMark: 0 }),
  };
}

describe("le relais refuse ce qui ne tiendrait pas en mémoire", () => {
  it("au-dessus du plafond : 413, et le corps n'est JAMAIS tiré", async () => {
    const r = reponse({ taille: 200 * 1024 * 1024 });
    const res = new FauxRes();
    handler.init(contexte());
    await handler.__relayerFichier(res, r, "inline");

    expect(res.statusCode).toBe(413);
    expect(r.combienDeLectures(), "refuser après avoir tiré le corps ne protège de rien").toBe(0);
    // Lire un corps exige d'en prendre un lecteur, ce qui VERROUILLE le flux : l'absence de verrou
    // dit qu'on n'y a pas touché, là où un compteur ne dit que ce que le harnais veut bien compter.
    expect(r.body.locked).toBe(false);
    expect(r.aEteAnnule(), "corps jamais tiré ET jamais refermé : la connexion amont reste ouverte").toBe(true);
  });

  it("sous le plafond : le fichier passe", async () => {
    const r = reponse({ taille: 1024 });
    const res = new FauxRes();
    handler.init(contexte());
    await handler.__relayerFichier(res, r, "inline");

    expect(res.statusCode).toBe(200);
    expect(res.octets()).toBe(16);
  });

  it("sans taille annoncée : on laisse passer, faute de pouvoir mesurer", async () => {
    const r = reponse({ taille: null });
    const res = new FauxRes();
    handler.init(contexte());
    await handler.__relayerFichier(res, r, "inline");

    expect(res.statusCode).toBe(200);
    expect(res.entetes["Content-Length"]).toBeUndefined();
  });
});
