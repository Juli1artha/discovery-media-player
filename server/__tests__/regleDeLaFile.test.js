// SIX CHEMINS D'ÉCRITURE, DEUX PROTÉGÉS — ET LA LISTE N'A JAMAIS TENU.
//
// 0.1.41 annonçait « les écritures de carte sont séquentielles ». C'était vrai d'un chemin sur
// trois : deux ordonnanceurs couvraient une partie, pendant que `pushPage`, `showMap`, `hideMap`,
// `toMap` et la recherche Street View écrivaient directement.
//
// ⚠️ La correction n'est pas d'allonger la liste des appelants disciplinés. C'est de rendre les
// FONCTIONS D'ÉCRITURE elles-mêmes ordonnées : il n'existe alors plus de chemin direct, donc plus
// rien à oublier. Cette garde vérifie qu'on n'en a pas rouvert un — pas en énumérant les chemins
// connus, mais en reconnaissant la FORME d'une écriture qui part hors file.
//
// C'est le même geste que pour le cache : une liste se périme, une forme non.

const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "handler.js"), "utf8");

/** Les actions qui MODIFIENT l'état d'une présentation, par opposition à celles qui le lisent. */
const MUTATIONS = ["present-page", "present-content"];

describe("toute écriture de présentation passe par la file", () => {
  it("la file existe, et elle est unique", () => {
    expect(SRC, "sans elle, on retombe sur une discipline d'appel").toContain("createFileEcritures");
    expect(SRC.match(/createFileEcritures\(\{/g) || [], "deux files ne se coordonnent pas entre elles")
      .toHaveLength(1);
  });

  // ⚠️ LE CŒUR DE LA GARDE. Une écriture qui part vraiment est un `fetchBorne` portant une action de
  // mutation. Chacune doit vivre dans une fonction que la file appelle — jamais être atteignable
  // directement depuis un gestionnaire d'événement.
  it.each(MUTATIONS)("%s ne part que depuis une fonction rangée dans la file", (action) => {
    const i = SRC.indexOf(`action:'${action}'`);
    expect(i, `l'action ${action} doit exister`).toBeGreaterThan(0);

    const debut = SRC.lastIndexOf("function ", i);
    const nom = SRC.slice(debut + "function ".length, SRC.indexOf("(", debut)).trim();

    // Le nom de cette fonction doit apparaître dans une tâche posée sur la file. On extrait les
    // corps de tâches puis on cherche par TEXTE : une expression régulière construite dans un
    // gabarit multiplie les échappements, donc les façons de se tromper de sonde — c'est ce qui
    // a fait échouer la première version de cette garde sur du code pourtant correct.
    const posees = [...SRC.matchAll(/\.poser\('[a-z]+',\s*function\(\)\s*\{([^}]*)\}/g)].map((m) => m[1]);
    expect(posees.length, "aucune tâche n'est posée sur la file").toBeGreaterThan(0);
    expect(posees.some((corps) => corps.includes(nom + "(")),
      `« ${nom} » écrit ${action} sans que la file l'appelle : une écriture atteignable hors file `
      + "peut doubler celle qui la précède")
      .toBe(true);
  });

  // ⚠️ ET L'AUTRE MOITIÉ : les fonctions que les appelants utilisent doivent, elles, POSER sur la
  // file. Vérifier seulement la précédente laisserait passer une file branchée sur du code mort.
  it.each(["pushPage", "presentContent"])("%s range son écriture au lieu de l'envoyer", (nom) => {
    const debut = SRC.indexOf(`function ${nom}(`);
    expect(debut, nom).toBeGreaterThan(0);
    const corps = SRC.slice(debut, SRC.indexOf("\n    function ", debut + 10));
    expect(corps, `« ${nom} » doit poser sur la file, pas écrire elle-même`).toContain(".poser(");
  });

  // ⚠️ PLUS AUCUN ORDONNANCEUR PARALLÈLE. Il y en avait deux devant une partie des écritures ; les
  // laisser en place aurait fait deux mécaniques pour un même rôle — la forme exacte qui finit par
  // diverger en silence.
  it("aucun ordonnanceur ne subsiste devant les écritures", () => {
    const gabarit = SRC.slice(SRC.indexOf("var Live=(function(){"));
    const ordonnanceurs = [...gabarit.matchAll(/createScheduler\(/g)];
    expect(ordonnanceurs, "l'ordonnanceur ne sert plus qu'aux RELECTURES de l'audience")
      .toHaveLength(1);
    const i = gabarit.indexOf("createScheduler(");
    expect(gabarit.slice(Math.max(0, i - 700), i), "et le seul restant est bien celui des relectures")
      .toContain("relireAvec");
  });

  // Le battement de cœur n'est pas une mutation d'état : il rafraîchit `last_seen`, ne porte ni page
  // ni contenu, et son ordre n'a aucune conséquence. Son absence de la file est un choix.
  it("le battement de cœur reste hors file, et c'est délibéré", () => {
    expect(SRC, "il ne transporte aucun état : le mettre en file le retarderait pour rien")
      .toContain("action:'present-touch'");
  });
});
