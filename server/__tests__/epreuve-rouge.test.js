// ÉPREUVE DE LA PROTECTION DE BRANCHE (19/08/2026) — cet essai échoue VOLONTAIREMENT.
// La PR qui le porte ne doit pas pouvoir être fusionnée : c'est la plateforme qu'on éprouve,
// pas le code. PR à fermer sans merger une fois le refus constaté.
describe("épreuve", () => {
  it("rougit exprès — une garde qu'on n'a pas vue refuser ne garde rien", () => {
    expect(1, "rouge volontaire").toBe(2);
  });
});
