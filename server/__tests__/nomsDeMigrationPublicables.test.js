// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN NOM DE MIGRATION EST UNE VALEUR PUBLIÉE — DONC IL PASSE LA GARDE DE L'HÔTE, OU IL NE SORT PAS.
//
// ⚠️ CE QUE CETTE GARDE PROTÈGE, ET POURQUOI ELLE EST ICI ET PAS CHEZ L'HÔTE. Une garde d'hôte
// refuse toute carte d'identité contenant `supabase|secret|key|token` — un balayage de TEXTE,
// volontairement grossier, qui protège quelque chose de réel : une carte publique qui laisserait
// fuiter une URL de projet, une clé ou un jeton. `presenceJetons` porte ce nom-là (et non
// `presenceTokens`) parce qu'elle a déjà tiré une fois, et le commentaire qui l'accompagne pose la
// doctrine : LE BON GESTE FACE À SON REFUS EST DE CHANGER CE QU'ON ÉMET, JAMAIS DE DESSERRER LA
// GARDE.
//
// Le 30/08 elle a tiré une seconde fois, sur `connues` — nos noms de migration étaient publiés
// préfixés de `supabase/migrations/`. Faux positif : ce sont nos chemins, identiques chez tous les
// hôtes, sans URL ni identifiant de projet. Le préfixe a donc été retiré de ce que la carte publie.
//
// ⚠️ MAIS RETIRER LE PRÉFIXE NE RÈGLE QUE LA COLLISION DU JOUR, PAS LA CLASSE — et c'est la session
// STUDIO qui l'a nommé, en rapportant l'incident : le nom de fichier reste une valeur que NOUS
// choisissons à chaque migration. Rien n'empêcherait `0031-refresh-token-rotation.sql` de rouvrir
// exactement le même refus des mois plus tard, chez tous les hôtes à la fois, sans que personne
// fasse le lien avec ce commentaire.
//
// Notre discipline de nommage français le couvre en pratique — 24 fichiers, aucun ne trébuche. Mais
// « en pratique » veut dire qu'une garde de SÉCURITÉ chez chaque hôte repose sur une habitude que
// rien ne mesure chez nous. C'est le motif « une règle tenue par habitude a un taux de couverture
// que personne ne mesure ». Ce banc convertit l'habitude en règle : il rougit au moment où
// quelqu'un nomme mal un fichier, pas des mois plus tard chez un tiers.

const fs = require("node:fs");
const path = require("node:path");

const DOSSIER = path.join(__dirname, "..", "..", "supabase", "migrations");

// Le motif de la garde d'hôte, repris tel quel. On ne l'assouplit pas : c'est le sien, pas le nôtre,
// et c'est justement parce qu'il est grossier qu'il protège.
const MOTIF_HOTE = /supabase|secret|key|token/i;

const fichiers = () => fs.readdirSync(DOSSIER).filter((f) => f.endsWith(".sql"));

describe("un nom de migration ne peut pas faire tirer la garde d'un hôte", () => {
  // ⚠️ PLANCHER — sans lui, un banc qui ne lit RIEN passe. Un dossier renommé, un filtre trop
  // étroit, et « aucun nom fautif » devient vrai pour la pire des raisons.
  //
  // Le nombre est EXACT, et la justification est la même que celle du plancher d'ajouts de colonnes :
  // il est monotone par construction. Une migration n'est jamais supprimée — elle a déjà tourné chez
  // des hôtes, et `cheminDeMigration.test.js` interdit d'en défaire une. Aucun ménage légitime ne
  // peut donc le faire baisser, et l'exactitude ne coûte aucun faux positif.
  //
  // RELEVÉ DU JOUR — témoin daté : 24 migrations le 2026-08-30.
  const PLANCHER = 24;

  it("le balayage voit au moins autant de migrations qu'au jour où on l'a mesuré", () => {
    const vus = fichiers().length;
    expect(vus,
      `le balayage ne voit plus que ${vus} migrations, contre ${PLANCHER} attendues.\n`
      + "Ce nombre est monotone : une BAISSE est une perte de vue du balayage, jamais un ménage.\n"
      + "Corrigez le balayage ; ne baissez pas le plancher.")
      .toBeGreaterThanOrEqual(PLANCHER);
  });

  it("aucun nom de fichier ne contient un mot qui ferait refuser la carte", () => {
    const fautifs = fichiers().filter((f) => MOTIF_HOTE.test(f));
    expect(fautifs,
      `ces migrations portent un mot que la garde d'un hôte refuse : ${fautifs.join(", ")}.\n`
      + "Leur nom est PUBLIÉ dans la carte d'identité (`manquant`, `connues`), et une garde d'hôte\n"
      + "balaie cette carte pour `supabase|secret|key|token`. Un de ces mots dans un nom de fichier\n"
      + "fait refuser la carte ENTIÈRE chez l'hôte — pas seulement la ligne fautive.\n\n"
      + "Renommez le fichier. Ne demandez pas à l'hôte d'assouplir sa garde : desserrer est\n"
      + "exactement ce qui vide une garde, et celle-ci protège une carte PUBLIQUE contre la fuite\n"
      + "d'une URL de projet, d'une clé ou d'un jeton. Le français y suffit — « jeton » pour token,\n"
      + "« clé » pour key, « secret » n'a pas d'usage légitime dans un nom de migration.")
      .toEqual([]);
  });

  // ⚠️ CONTRÔLES POSITIFS — sans eux, les deux bancs ci-dessus passeraient tout aussi bien avec un
  // motif cassé. C'est la forme que le STUDIO a employée sur son propre resserrement, et elle vaut
  // dans les deux sens : on prouve que le motif MORD avant de se réjouir qu'il ne morde pas.
  it.each([
    ["0031-refresh-token-rotation.sql", "token"],
    ["0032-api-key-par-hote.sql", "key"],
    ["0033-secret-de-presence.sql", "secret"],
    ["0034-supabase-realtime.sql", "supabase"],
  ])("le motif refuse bien « %s » (mot : %s)", (nom) => {
    expect(MOTIF_HOTE.test(nom), `« ${nom} » devrait être refusé et ne l'est pas`).toBe(true);
  });

  it("et il laisse passer les noms que nous employons vraiment", () => {
    for (const f of fichiers()) {
      expect(MOTIF_HOTE.test(f), `« ${f} » est refusé alors qu'il est en place`).toBe(false);
    }
    // ⚠️ Celui-ci en particulier : il PARLE de jetons, et c'est précisément le nom qu'il fallait
    // choisir pour qu'il passe. La preuve que la discipline française n'est pas un ornement.
    expect(fichiers()).toContain("0017-jeton-presence.sql");
  });
});
