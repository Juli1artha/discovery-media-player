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

/**
 * @param migre     la colonne `view_rotation` existe-t-elle chez cet hôte ?
 * @param stockee   ce que la LIGNE porte déjà — pour la reprise, où c'est la base qui fait autorité.
 */
function hote({ migre, stockee = 0 }) {
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
            current_page: 7, active: true, write_seq: 0, owner_email: "moi@exemple.fr",
            ...(migre ? { view_rotation: stockee } : {}),
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

// ⚠️ LA DIVERGENCE MUETTE QUE LA REPRISE LAISSAIT S'INSTALLER. Un rechargement remet la vue du
// présentateur à son état d'origine — c'est une décision, pas un oubli : c'est ce que font tous les
// lecteurs de documents. Mais l'audience, elle, continuait d'afficher la `view_rotation` de la base.
// Le présentateur voyait donc son document DROIT et son audience le voyait COUCHÉ, et rien ne le
// disait à personne : de son côté tout allait bien, il n'avait aucune raison de toucher le bouton.
//
// La règle est celle qui valait déjà pour la page, étendue à ce qui manquait : à la reprise, la
// présentation l'emporte sur l'état local. Au démarrage c'est l'inverse — `startPresent` pousse la
// rotation courante du présentateur — et les deux sont cohérents : on ne reprend que ce qui existe.
describe("à la reprise, la présentation l'emporte sur l'état local", () => {
  const MOI = "moi@exemple.fr";

  it.each([90, 180, 270])("l'orientation stockée (%s°) est rendue au présentateur qui reprend", async (stockee) => {
    hote({ migre: true, stockee });
    const r = await presentations.reclaimPresentation("s", MOI);
    expect(r.ok, "la reprise a échoué : le banc ne mesurerait rien").toBe(true);
    expect(r.rotation, "le présentateur reprend droit pendant que son audience reste couchée").toBe(stockee);
  });

  // ⚠️ CONTRÔLE POSITIF DE LA PAGE, DANS LE MÊME BANC. Sans lui, une reprise qui ne rendrait plus
  // RIEN passerait les assertions ci-dessus dès que la rotation stockée vaut 0.
  it("rend la page ET l'orientation, pas l'une au prix de l'autre", async () => {
    hote({ migre: true, stockee: 90 });
    const r = await presentations.reclaimPresentation("s", MOI);
    expect(r.page, "la reprise ne saute plus à la page en cours").toBe(7);
    expect(r.rotation).toBe(90);
  });

  // ⚠️ CÔTÉ LECTURE IL N'Y A PAS DE PIÈGE DE MIGRATION, et ce banc le PROUVE au lieu de le supposer.
  // `getPresentation` lit `select=*` : chez un hôte non migré la colonne est simplement absente. Le
  // rejet du PATCH entier sur colonne inconnue ne concerne que l'écriture — la doublure lèverait si
  // on avait sondé la colonne, et la reprise échouerait tout entière.
  it("chez un hôte NON migré, la reprise fonctionne et rend zéro", async () => {
    hote({ migre: false });
    const r = await presentations.reclaimPresentation("s", MOI);
    expect(r.ok, "la reprise est cassée chez un hôte non migré : elle perd le pilotage, pas la rotation").toBe(true);
    expect(r.page).toBe(7);
    expect(r.rotation).toBe(0);
  });

  // ⚠️ LA MÊME PORTE QU'À L'ÉCRITURE, ET POUR LA MÊME RAISON. Une base qu'un hôte a écrite à la main
  // peut porter n'importe quoi ; un viewport oblique casse la couche de texte de TOUTE l'audience.
  // Deux copies d'une liste blanche divergent — celle-ci est énoncée une fois, `ROTATIONS`.
  it.each([
    ["un tiers de tour", 37, 0],
    ["au-delà du tour", 450, 0],
    ["une chaîne", "90", 0],
    ["nulle", null, 0],
    ["NaN", NaN, 0],
  ])("normalise ce que la base porte : %s", async (_nom, brute, attendue) => {
    hote({ migre: true, stockee: brute });
    const r = await presentations.reclaimPresentation("s", MOI);
    expect(r.rotation).toBe(attendue);
  });
});
