// UN RENVOI RÉSEAU NE DOIT PAS ANNULER LA RÉACTION QU'ON VIENT D'AJOUTER.
//
// « Basculer » n'a de sens qu'une fois. Un double-clic, une reprise de requête, un renvoi après
// timeout — et l'émoji que le participant vient d'allumer s'éteint. Il ne voit AUCUNE erreur : il
// voit son émoji clignoter, alors il recommence, ce qui rebascule encore. Constat P10 de l'audit.
//
// ⚠️ L'APPELANT SAIT CE QU'IL VEUT, PAS CE QU'IL FAUT INVERSER. Poser un état rend l'opération
// idempotente : rejouer la même intention deux fois donne le même résultat qu'une fois.

const presentations = require("../presentations.js");

const MOI = "0123456789abcdef";

function base(reactionsInitiales) {
  const etat = { reactions: reactionsInitiales };
  presentations.init({
    db: {
      async request(chemin, o) {
        if (String(chemin).startsWith("doc_presentations?")) return [{ slug: "s", active: true, control_hash: "h" }];
        if (!o || !o.method) return [{ id: 1, reactions: etat.reactions }];
        if (o.method === "PATCH") { etat.reactions = o.body.reactions; return [{ id: 1, reactions: etat.reactions, author_hash: "x" }]; }
        return [];
      },
    },
    errors: { capture() {} },
  });
  return etat;
}

describe("poser un état plutôt que basculer", () => {
  it("rejouer « j'ajoute » deux fois laisse UNE réaction", async () => {
    const etat = base({});
    await presentations.toggleReaction("s", 1, "👍", MOI, true);
    await presentations.toggleReaction("s", 1, "👍", MOI, true);   // le renvoi réseau
    expect(etat.reactions["👍"]).toEqual([MOI]);
  });

  it("rejouer « je retire » deux fois n'en remet pas une", async () => {
    const etat = base({ "👍": [MOI] });
    await presentations.toggleReaction("s", 1, "👍", MOI, false);
    await presentations.toggleReaction("s", 1, "👍", MOI, false);
    expect(etat.reactions["👍"]).toBeUndefined();
  });

  // ⚠️ LE DÉFAUT, TEL QU'IL SE PRODUISAIT. Sans intention, le second appel inverse le premier —
  // et c'est exactement ce qu'un client d'avant continuera de faire, volontairement.
  it("sans intention, on bascule — l'ancien comportement, conservé pour les anciens clients", async () => {
    const etat = base({});
    await presentations.toggleReaction("s", 1, "👍", MOI);
    expect(etat.reactions["👍"]).toEqual([MOI]);
    await presentations.toggleReaction("s", 1, "👍", MOI);
    expect(etat.reactions["👍"], "deux envois, plus aucune réaction : le défaut").toBeUndefined();
  });

  it("l'intention d'un participant ne touche pas celle d'un autre", async () => {
    const etat = base({ "👍": ["fedcba9876543210"] });
    await presentations.toggleReaction("s", 1, "👍", MOI, true);
    expect(etat.reactions["👍"]).toEqual(["fedcba9876543210", MOI]);
  });
});
