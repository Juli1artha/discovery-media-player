// LE RELAIS CHARGEAIT LE FICHIER ENTIER EN MÉMOIRE, SANS AUCUNE BORNE.
//
// Un PDF de 80 Mo, trois requêtes Range simultanées, et une fonction serverless tombe — pas pour un
// document en particulier, pour la somme. Le défaut n'était pas la taille d'un fichier, c'était
// l'absence de toute limite haute.
//
// ⚠️ LE REFUS ARRIVE AVANT L'ALLOCATION. Refuser après avoir lu le corps ne protège de rien : c'est
// la lecture qui coûte. On regarde donc `Content-Length` et on renonce sans toucher au corps —
// vérifié ici en constatant que `arrayBuffer()` n'est jamais appelé.
//
// ⚠️ ET UN AMONT QUI N'ANNONCE PAS SA TAILLE PASSE QUAND MÊME. On ne peut pas refuser ce qu'on ne
// sait pas mesurer, et fermer par défaut couperait des stockages parfaitement légitimes. Cette
// borne garde contre le GROS, pas contre l'inconnu — c'est le streaming qui fermera l'inconnu, et
// il n'est pas fait.

const handler = require("../handler.js");

function reponse({ taille, ok = true, status = 200 }) {
  let corpsLu = 0;
  return {
    ok, status,
    headers: { get: (k) => (k.toLowerCase() === "content-length" ? (taille == null ? null : String(taille)) : null) },
    async arrayBuffer() { corpsLu++; return new ArrayBuffer(taille || 0); },
    combienDeLectures: () => corpsLu,
  };
}

// Le contexte minimal que `init` exige — il lit les greffons au câblage.
function contexte() {
  return { plugins: {}, has: () => false, errors: { capture() {} }, branding: {}, config: {}, db: {}, storage: {} };
}

function fauxRes() {
  return {
    statusCode: 0, entetes: {}, corps: null,
    setHeader(k, v) { this.entetes[k] = v; },
    end(c) { this.corps = c; },
  };
}

describe("le relais refuse ce qui ne tiendrait pas en mémoire", () => {
  it("au-dessus du plafond : 413, et le corps n'est JAMAIS lu", async () => {
    const r = reponse({ taille: 200 * 1024 * 1024 });
    const res = fauxRes();
    handler.init(contexte());
    await handler.__relayerFichier(res, r, "inline");

    expect(res.statusCode).toBe(413);
    expect(r.combienDeLectures(), "refuser après allocation ne protège de rien").toBe(0);
  });

  it("sous le plafond : le fichier passe", async () => {
    const r = reponse({ taille: 1024 });
    const res = fauxRes();
    handler.init(contexte());
    await handler.__relayerFichier(res, r, "inline");

    expect(res.statusCode).toBe(200);
    expect(r.combienDeLectures()).toBe(1);
  });

  it("sans taille annoncée : on laisse passer, faute de pouvoir mesurer", async () => {
    const r = reponse({ taille: null });
    const res = fauxRes();
    handler.init(contexte());
    await handler.__relayerFichier(res, r, "inline");

    expect(res.statusCode).toBe(200);
  });
});
