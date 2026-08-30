// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA ROTATION SUIT L'AUDIENCE — ET CHEZ UN HÔTE NON MIGRÉ, ELLE NE DOIT RIEN EMPORTER AVEC ELLE.
//
// ⚠️ LE RISQUE DE CE LOT N'EST PAS LA ROTATION, C'EST LA COLONNE. `docs/MIGRATIONS.md` le dit :
// PostgREST rejette le PATCH ENTIER si une colonne est inconnue. Nommer `view_rotation` chez un hôte
// qui n'a pas appliqué la 0024 ne ferait donc pas perdre la rotation — ça ferait perdre AUSSI le
// changement de page, c'est-à-dire le pilotage en direct tout entier. La fonctionnalité nouvelle
// casserait l'ancienne, en silence, chez les hôtes les plus en retard.
//
// La doublure ci-dessous LÈVE sur une colonne inconnue, exactement comme PostgREST. Sans ça, le banc
// « la page passe quand même » serait vide : il passerait aussi bien avec un code fautif.
const presentations = require("../presentations.js");
const schema = require("../schema.js");

const CONTROL = "jeton-de-controle";

/** @param migre la colonne `view_rotation` existe-t-elle chez cet hôte ? */
function hote({ migre }) {
  const patchs = [];
  const ctx = {
    errors: { capture() {} },
    db: {
      async request(chemin, o) {
        // Sondes de colonnes : `select=<colonne>&limit=0`. Une colonne absente FAIT ÉCHOUER la sonde.
        const sonde = /select=([a-z_]+)&limit=0/.exec(chemin);
        if (sonde) {
          if (sonde[1] === "view_rotation" && !migre) throw new Error("400 column view_rotation does not exist");
          return [];
        }
        if (!o || !o.method) {
          return [{
            slug: "s", control_hash: require("node:crypto").createHash("sha256").update(CONTROL).digest("hex"),
            current_page: 1, active: true, write_seq: 0,
            ...(migre ? { view_rotation: 0 } : {}),
          }];
        }
        if (o.method === "PATCH") {
          // ⚠️ COMME POSTGREST : la colonne inconnue fait échouer la requête ENTIÈRE, pas seulement
          // le champ. C'est ce qui rend le banc capable de distinguer un code prudent d'un code naïf.
          if (!migre && Object.prototype.hasOwnProperty.call(o.body, "view_rotation")) {
            throw new Error("400 column view_rotation does not exist");
          }
          patchs.push(o.body);
          return [{ slug: "s" }];
        }
        return [];
      },
    },
  };
  schema.oublier();
  schema.init(ctx);
  presentations.init(ctx);
  return { patchs };
}

describe("la rotation du présentateur voyage avec sa page", () => {
  it("chez un hôte migré, elle est écrite", async () => {
    const { patchs } = hote({ migre: true });
    const r = await presentations.setPage("s", CONTROL, 4, 1, 90);
    expect(r.ok, "l'écriture a échoué : le banc ne mesurerait rien").toBe(true);
    expect(patchs).toHaveLength(1);
    expect(patchs[0].current_page).toBe(4);
    expect(patchs[0].view_rotation).toBe(90);
  });

  // ⚠️ LE BANC QUI COMPTE. Si le champ était nommé sans condition, la doublure lèverait et la page
  // ne passerait pas — c'est exactement ce qui arriverait chez l'hôte.
  it("chez un hôte NON migré, la page passe quand même et la rotation ne voyage pas", async () => {
    const { patchs } = hote({ migre: false });
    const r = await presentations.setPage("s", CONTROL, 4, 1, 90);
    expect(r.ok,
      "le PATCH a été refusé : nommer une colonne absente ne perd pas la rotation, elle perd\n"
      + "le changement de page — la fonctionnalité nouvelle casse l'ancienne.").toBe(true);
    expect(patchs).toHaveLength(1);
    expect(patchs[0].current_page, "la page doit passer, migration ou pas").toBe(4);
    expect(Object.prototype.hasOwnProperty.call(patchs[0], "view_rotation"),
      "la colonne est nommée alors qu'elle n'existe pas chez cet hôte").toBe(false);
  });

  // ⚠️ UNE LISTE BLANCHE, PAS UN ARRONDI. Le navigateur du présentateur normalise déjà ; tout ce qui
  // arrive hors des quatre valeurs est malformé ou hostile. Deviner ce qu'un client cassé voulait
  // dire lui donnerait raison — et un viewport oblique casserait la couche de texte de TOUTE
  // l'audience, pas seulement de celui qui l'envoie.
  it.each([
    ["un quart de tour", 90, 90],
    ["un demi-tour", 180, 180],
    ["trois quarts", 270, 270],
    ["un tiers de tour", 37, 0],
    ["au-delà du tour", 450, 0],
    ["une chaîne", "90", 0],
    ["NaN", NaN, 0],
    ["absente", undefined, 0],
  ])("normalise une valeur reçue : %s", async (_nom, brute, attendue) => {
    const { patchs } = hote({ migre: true });
    await presentations.setPage("s", CONTROL, 2, 1, brute);
    expect(patchs[0].view_rotation).toBe(attendue);
  });
});
