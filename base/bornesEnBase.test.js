// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA BASE REFUSE ELLE-MÊME UNE MESURE ABSURDE — PAS SEULEMENT LE CODE QUI ÉCRIT.
//
// ⚠️ POURQUOI DEUX BORNES POUR UN MÊME NOMBRE. `server/shares.js` borne ce qu'IL écrit ; la
// contrainte (migration 0020) borne ce que la TABLE accepte, de qui que ce soit — une reprise, un
// script d'exploitation, une route future, un hôte qui écrit dans sa propre base. Ce n'est pas un
// doublon paresseux : c'est la dernière ligne, et elle est la seule que le code applicatif ne peut
// pas contourner en changeant d'avis.
//
// ⚠️ ET ELLE NE SE DÉDUIT PAS DE LA DOCUMENTATION. `check` posé `not valid` puis validé, sur une
// table déjà peuplée, avec un rejeu qui ne doit rien changer : trois comportements qu'un double en
// mémoire ne sait pas simuler — il n'a ni contraintes ni transactions. Éprouvés ici devant un vrai
// PostgreSQL, ou pas éprouvés du tout.
//
// Le défaut d'origine : audit CODEX 5.6, 25/08. Un visiteur muni d'un lien valide écrivait
// 2 147 483 647 dans `page`, et l'agrégation du funnel mourait ensuite d'un dépassement mémoire —
// mesuré : `FATAL ERROR: JavaScript heap out of memory` en huit secondes, sur UNE ligne.

const crypto = require("node:crypto");

const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";

// Même règle que les autres bancs de base : dans la forge, s'esquiver est un échec.
if (process.env.CI && !(BASE && SECRET)) {
  throw new Error(
    "banc des bornes en base : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents. " +
    "S'esquiver reviendrait à ne rien éprouver — le service PostgREST n'a pas démarré ?");
}
const decrire = BASE && SECRET ? describe : describe.skip;

function jeton() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const tete = b64({ alg: "HS256", typ: "JWT" });
  const corps = b64({ role: process.env.PLAYER_TEST_ROLE || "player_test" });
  const sig = crypto.createHmac("sha256", SECRET).update(`${tete}.${corps}`).digest("base64url");
  return `${tete}.${corps}.${sig}`;
}

decrire("les bornes que la base fait respecter", () => {
  let base;

  beforeAll(() => {
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    const contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    base = contexte.db;   // la MÊME base que le player
  });

  const ligne = (col, valeur) => ({
    slug: "borne-" + crypto.randomBytes(4).toString("hex"),
    doc_id: "d", event: "page", [col]: valeur,
  });

  const poser = (row) =>
    base.request("commercial_doc_views", { method: "POST", headers: { Prefer: "return=minimal" }, body: [row] });

  for (const [col, hors] of [["page", 2147483647], ["max_page", 2147483647], ["seconds", 2147483647]]) {
    it(`⚠️ REFUSE ${col} = ${hors} — la valeur exacte du 25/08`, async () => {
      await expect(poser(ligne(col, hors))).rejects.toThrow();
    });

    it(`accepte ${col} à la borne exacte — une contrainte trop stricte casserait un usage légitime`, async () => {
      const max = col === "seconds" ? 86400 : 10000;
      await expect(poser(ligne(col, max))).resolves.not.toThrow();
    });

    it(`refuse ${col} négatif`, async () => {
      await expect(poser(ligne(col, -1))).rejects.toThrow();
    });
  }

  // ⚠️ CE QUE CE BANC NE PEUT PAS PROUVER, ET QUI SE PROUVE AILLEURS. PostgREST n'expose pas
  // `pg_constraint` : « la contrainte est-elle VALIDÉE, ou seulement posée `not valid` ? » ne se
  // demande pas d'ici. La réponse vient de la migration elle-même — son `validate constraint`
  // échouerait sur une table contenant une ligne hors plage, et la forge applique les migrations
  // sur une base neuve puis rejouée. Le dire vaut mieux que d'écrire un test qui réaffirme la
  // ligne précédente en ayant l'air d'en vérifier une autre.
});
