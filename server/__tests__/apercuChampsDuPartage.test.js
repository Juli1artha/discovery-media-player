// « UN PARTAGE SANS PARTAGE » — ET CHAQUE CHAMP DOIT Y ÊTRE REBRANCHÉ UN PAR UN.
//
// Le mode aperçu construit un pseudo-partage : un objet qui ressemble à un lien tracé, sans en être
// un. La page, elle, lit `share.<champ>` sans savoir lequel des deux elle sert. Chaque champ absent
// du pseudo dégrade donc en silence, et personne ne sait lequel manque avant qu'il manque.
//
// ⚠️ C'EST ARRIVÉ DEUX FOIS. `internal_token` manquait — les mesures internes retombaient sur
// l'identité que le navigateur affirme. Puis `brand_key` : un hôte à plusieurs marques servait, sur
// le domaine d'un client, le loader d'un AUTRE. Les deux fois, la machinerie était complète et il
// ne manquait qu'un transport.
//
// Le second hôte l'a formulé et proposait de fermer la famille : « que l'aperçu accepte les mêmes
// champs qu'un partage, plutôt qu'une liste choisie ».
//
// ⚠️ MESURÉ, SA PROPOSITION OUVRIRAIT TROP GRAND. La page lit 34 champs ; 20 sont absents du pseudo,
// et 17 le sont DÉLIBÉRÉMENT — tout le greffon assistant (qui ne tourne pas en aperçu, et un test
// vérifie que son script n'y est même pas embarqué), `is_test`, `recipient_email`, `created_by`…
// Les importer en bloc rallumerait des fonctions que l'aperçu n'a pas.
//
// La bonne fermeture n'est donc pas « les mêmes champs », c'est « aucun champ par accident » : tout
// ce que la page lit doit être soit FOURNI, soit DÉCLARÉ absent avec sa raison. Le troisième oubli
// ne passera pas — il échouera ici jusqu'à ce que quelqu'un décide.

const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "handler.js"), "utf8");

/** Ce que le gabarit de la visionneuse lit sur son partage. */
function champsLus() {
  const i = SRC.indexOf("function viewerHtml(");
  const j = SRC.indexOf("\nfunction ", i + 10);
  return [...new Set([...SRC.slice(i, j).matchAll(/\bshare\.([a-z_]+)/g)].map((m) => m[1]))].sort();
}

/** Ce que le pseudo-partage de l'aperçu fournit. */
function champsFournis() {
  const i = SRC.indexOf("const pseudo = { preview: true");
  const bloc = SRC.slice(i, SRC.indexOf("};", i));
  return new Set([...bloc.matchAll(/([a-z_]+):/g)].map((m) => m[1]));
}

/**
 * Les absences VOULUES, chacune avec sa raison. Ajouter une ligne ici est une décision ; l'oublier
 * fait échouer la garde. C'est toute la différence avec une liste qu'on complète après coup.
 */
const ABSENCES_ASSUMEES = {
  // Le greffon assistant ne tourne pas en aperçu — un test vérifie même que son script n'y est
  // pas embarqué (116 Ko qui ne serviraient à rien).
  bot_avatar: "greffon assistant absent de l'aperçu",
  bot_enabled: "greffon assistant absent de l'aperçu",
  bot_greeting: "greffon assistant absent de l'aperçu",
  bot_greeting_doc: "greffon assistant absent de l'aperçu",
  bot_guided: "greffon assistant absent de l'aperçu",
  bot_karaoke: "greffon assistant absent de l'aperçu",
  bot_name: "greffon assistant absent de l'aperçu",
  bot_page_anim: "greffon assistant absent de l'aperçu",
  bot_vclips: "greffon assistant absent de l'aperçu",
  bot_vphoto: "greffon assistant absent de l'aperçu",
  // Propriétés d'un LIEN, qui n'existent pas quand aucun lien n'a été créé.
  created_by: "aucun lien créé : personne ne l'a créé",
  recipient_email: "aucun lien créé : il n'a pas de destinataire",
  is_test: "aucun lien créé : la notion de répétition ne s'applique pas",
  allow_download: "préférence d'affichage portée par un lien ; l'aperçu est interne",
  video_layout: "réglage porté par un lien",
  // Résolus APRÈS construction du pseudo, par `brandForShare` — présents à l'affichage.
  brand_logo: "posé par brandForShare, pas par le pseudo",
  brand_name: "posé par brandForShare, pas par le pseudo",
  brand_dark: "posé par brandForShare, pas par le pseudo",
  // Passé séparément à la fonction de rendu, pas par le partage.
  embed: "transmis en paramètre distinct",
};

describe("l'aperçu ne perd aucun champ par accident", () => {
  const lus = champsLus();
  const fournis = champsFournis();

  it("la page lit bien des champs du partage", () => {
    expect(lus.length, "sans lecture, cette garde ne prouverait rien").toBeGreaterThan(10);
  });

  // ⚠️ LE CŒUR : chaque champ lu est fourni, ou déclaré absent AVEC SA RAISON.
  it.each(champsLus())("« %s » est fourni par l'aperçu, ou son absence est assumée", (champ) => {
    const decide = fournis.has(champ) || Object.prototype.hasOwnProperty.call(ABSENCES_ASSUMEES, champ);
    expect(decide,
      `la page lit « share.${champ} », et l'aperçu ne le fournit pas.\n`
      + "Soit vous l'ajoutez au pseudo-partage, soit vous l'inscrivez dans ABSENCES_ASSUMEES avec la\n"
      + "raison. Les deux oublis précédents — internal_token, puis brand_key — ont dégradé en silence\n"
      + "pendant des semaines : mesures retombées sur une identité affirmée, puis marque d'un autre\n"
      + "client servie sur le domaine du client.")
      .toBe(true);
  });

  // ⚠️ ET LA TABLE DES ABSENCES NE DOIT PAS POURRIR. Une raison écrite pour un champ que la page ne
  // lit plus est un vestige : elle donne à la table l'air d'être à jour alors qu'elle décrit un
  // monde disparu.
  it("aucune absence assumée ne décrit un champ que la page ne lit plus", () => {
    const orphelines = Object.keys(ABSENCES_ASSUMEES).filter((c) => !lus.includes(c));
    expect(orphelines, "à retirer de la table : " + orphelines.join(", ")).toEqual([]);
  });

  // La marque, précisément — le cas qui a motivé cette garde.
  it("la clé de marque est transportée jusqu'au pseudo-partage", () => {
    expect(fournis.has("brand_key"),
      "sans elle, un hôte à plusieurs marques sert le loader d'un autre client")
      .toBe(true);
  });

  it("et elle est résolue sur le chemin de l'aperçu, pas seulement transportée", () => {
    const i = SRC.indexOf("const pseudo = { preview: true");
    const j = SRC.indexOf("return sendPresentHtml", i);
    expect(SRC.slice(i, j), "transporter sans résoudre laisse le loader de l'instance")
      .toContain("brandForShare(pseudo)");
  });
});
