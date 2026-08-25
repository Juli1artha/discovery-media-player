// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// AU-DELÀ DE 300 MESSAGES, LES NOUVEAUX DOIVENT ARRIVER — pas rester coincés derrière les anciens.
//
// ⚠️ P1 PERFORMANCE : `order=created_at.asc&limit=300` rendait les 300 PLUS ANCIENS. Au 301e, un
// participant qui relit n'obtient toujours que les 300 premiers : le nouveau message n'apparaît
// JAMAIS chez lui (l'auteur, lui, le voit par la réponse du POST — d'où le défaut invisible en
// démo courte). On demande désormais les 300 plus RÉCENTS (desc) et on les rend dans l'ordre
// chronologique (inversés), comme l'affichage l'attend.
const presentations = require("../presentations.js");

function harnais(nbMessages) {
  let derniereRequete = null;
  const ctx = {
    db: {
      async request(chemin) {
        derniereRequete = chemin;
        if (!chemin.startsWith("doc_presentation_messages?slug=eq.")) return [];
        // Modélise la base : ordonnée par created_at, la clause order/limit décide de la tranche.
        const tous = Array.from({ length: nbMessages }, (_, i) => ({ id: i + 1, body: `m${i + 1}`, created_at: `t${String(i + 1).padStart(6, "0")}`, deleted: false, reactions: {} }));
        const desc = /order=created_at\.desc/.test(chemin);
        const lim = Number(/limit=(\d+)/.exec(chemin)?.[1] || tous.length);
        const tri = desc ? [...tous].reverse() : tous;
        return tri.slice(0, lim);
      },
    },
    errors: { capture() {} },
  };
  presentations.init(ctx);
  require("../schema.js").init(ctx);
  return { derniereRequete: () => derniereRequete };
}

describe("les 300 DERNIERS messages, en ordre chronologique", () => {
  it("301 messages : le tout dernier (m301) est présent, le plus ancien (m1) est tombé", async () => {
    harnais(301);
    const msgs = await presentations.listMessages("s");
    const corps = msgs.map((m) => m.body);
    expect(corps.length).toBe(300);
    expect(corps[corps.length - 1], "le dernier message envoyé apparaît").toBe("m301");
    expect(corps.includes("m1"), "le plus ancien est évincé, pas le plus récent").toBe(false);
  });

  it("rendus dans l'ordre CHRONOLOGIQUE (ancien → récent), pas l'ordre desc de la requête", async () => {
    harnais(305);
    const msgs = await presentations.listMessages("s");
    const ids = msgs.map((m) => m.id);
    expect(ids[0], "le plus ancien des 300 gardés d'abord").toBe(6);
    expect(ids[ids.length - 1], "le plus récent en dernier").toBe(305);
  });

  it("moins de 300 : tout est là, en ordre chronologique", async () => {
    harnais(3);
    const msgs = await presentations.listMessages("s");
    expect(msgs.map((m) => m.body)).toEqual(["m1", "m2", "m3"]);
  });
});
