// CE QUI DOIT ÊTRE ARRÊTÉ DOIT ÊTRE VISIBLE DEPUIS L'ENDROIT QUI ARRÊTE.
//
// `_ordEtat`, `_ordChat` et `_filet` étaient déclarés DANS `connect()` ; `disconnect()`, défini un
// cran au-dessus, ne pouvait pas les atteindre. Après connect → disconnect → connect, les
// relectures de l'ancienne session continuaient : un spectateur qui rouvre la page doublait le
// trafic, et le filet de sécurité battait deux fois. Constat P9 de l'audit.
//
// ⚠️ CETTE GARDE LIT LE GABARIT SERVI, PAS UN CYCLE JOUÉ. Le dire ainsi vaut mieux que de laisser
// croire qu'on a observé deux connexions successives dans un navigateur : ce qui est vérifié ici,
// c'est que chaque poignée créée par la connexion est NOMMÉE dans la déconnexion — une propriété
// de portée, qui se lit dans le texte. Le cycle réel appartient au banc navigateur, et il demande
// un canal Realtime que le banc n'a pas.


const SOURCE = require("./sourceDesPages.cjs").SOURCE_PAGES
  .split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

// ⚠️ `{2}` plutôt que deux espaces littéraux : eslint refuse — et il a raison, deux espaces dans
// une expression régulière ne se comptent pas à l’œil. Ici ils délimitent la fin du corps de la
// fonction, donc s’en tromper d’un ferait mesurer autre chose.
const disconnect = /function disconnect\(\)\{[\s\S]*?\n {2}\}/.exec(SOURCE);

describe("une déconnexion arrête tout ce que la connexion a créé", () => {
  it("le corps de disconnect() reste repérable", () => {
    // Sans ça, les essais suivants passeraient sur une chaîne vide — une garde qui ne trouve pas
    // ce qu'elle inspecte ne garde rien.
    expect(disconnect, "disconnect() introuvable : cette garde ne mesure plus rien").toBeTruthy();
  });

  it("chaque ordonnanceur et minuterie de la session y est nommé", () => {
    for (const poignee of ["_tyIv", "_atIv", "_filet", "_ordEtat", "_ordChat"]) {
      expect(disconnect[0], `${poignee} n'est pas arrêté par disconnect()`).toContain(poignee);
    }
  });

  // ⚠️ La référence GLOBALE est le cas qu'on oublie : elle survit à la fermeture et garde en vie
  // la fermeture entière, donc l'ordonnanceur qu'elle capture.
  it("la référence globale de relecture est retirée", () => {
    expect(disconnect[0]).toContain("__presRelireEtat");
  });

  // ⚠️ ET LES POIGNÉES SONT DÉCLARÉES AU NIVEAU DU CYCLE DE VIE. C'est la propriété qui rend
  // l'arrêt possible : déclarées dans `connect()`, elles étaient invisibles depuis `disconnect()`,
  // et aucune quantité de bonne volonté dans le corps de l'arrêt n'y aurait changé quoi que ce soit.
  it("elles sont déclarées hors de connect(), sinon rien de tout ceci ne tiendrait", () => {
    expect(SOURCE).toMatch(/var _ordEtat=null,_ordChat=null,_filet=null;/);
    expect(SOURCE, "une re-déclaration dans connect() masquerait celle du cycle de vie")
      .not.toMatch(/var _ordEtat=relireAvec|var _ordChat=relireAvec|var _filet=setInterval/);
  });
});
