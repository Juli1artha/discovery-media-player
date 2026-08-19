// UN DOUBLE DÉCLARE CE QU'IL NE SIMULE PAS — pas seulement ce qu'il simule.
//
// ⚠️ Cran suggéré par le second hôte (dixième audit) après le bug d'encodage `in.()` : un double
// ne peut pas révéler un défaut d'une couche qu'il n'habite pas. La liste de ce qu'il SIMULE ne dit
// pas où il est aveugle ; la liste de ce qu'il N'HABITE PAS le dit. Cet essai exige que le double
// PostgREST en mémoire porte cette liste, non vide, et qu'elle nomme la couche qui a masqué le
// bug — l'encodage d'URL. Sans elle, « ce double n'a pas de contraintes » laisse croire que
// l'absence se limite aux contraintes.
const { COUCHES_ABSENTES } = require("../../tools/postgrest-en-memoire.cjs");

describe("le double déclare ses couches absentes", () => {
  it("la liste existe et n'est pas vide", () => {
    expect(Array.isArray(COUCHES_ABSENTES)).toBe(true);
    expect(COUCHES_ABSENTES.length, "un double muet sur ses angles morts en a autant qu'un honnête").toBeGreaterThanOrEqual(4);
  });

  it("elle nomme la couche qui a masqué le bug in.() — l'encodage d'URL", () => {
    expect(COUCHES_ABSENTES, "le défaut du 10e audit vivait dans cette couche absente").toContain("encodage-url");
  });
});
