// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES SESSIONS D'UN DOCUMENT SE LISENT PAR CHAÎNE D'ORIGINE, PAS PAR DERNIER MAILLON.
//
// ⚠️ CE QUI ÉTAIT OUVERT. `listSessionsForDoc` rendait `select=*` sur `commercial_doc_sessions`
// sans aucun filtre — or cette table porte `recipient_email` ET `ip`. Tout membre autorisé à
// appeler `docshare.sessions` obtenait donc, pour n'importe quel document, l'adresse et l'adresse
// IP de chaque destinataire, y compris les prospects de ses collègues. C'est exactement ce que la
// distinction `list` / `list.all` empêche depuis qu'un hôte l'a demandée : la porte stricte avait
// une porte large à côté d'elle, et deux appels suffisaient à passer par la seconde.
//
// ⚠️ ET LE FILTRE ÉVIDENT AURAIT ÉTÉ FAUX. `createReshare` pose `created_by: parent.recipient_email`
// — le lien que Paul reçoit de Dana est donc « créé par » Dana, pas par le commercial qui a envoyé
// le document à Dana. Un filtre sur `created_by = moi` aurait caché au commercial les lectures de
// sa propre descendance : celles qu'il a causées. La portée remonte `parent_slug` jusqu'à la
// racine, et c'est le créateur de CELLE-LÀ qui décide.
//
// Règle retenue avec l'appelant : une session, un lecteur, visible par sa chaîne d'origine.

const ID = require.resolve("../shares.js");

// Ce que la base rendrait, par table. Les deux lectures de `listSessionsForDoc` sont servies ici.
let sessions = [];
let liens = [];

delete require.cache[ID];
const { init, listSessionsForDoc, racineDuLien } = require("../shares.js");

// Le contexte est INJECTÉ par `init`, comme en production : les deux lectures de
// `listSessionsForDoc` sont servies ici, sans base ni réseau.
init({
  db: {
    request: async (chemin) => {
      if (chemin.startsWith("commercial_doc_sessions")) return sessions;
      if (chemin.startsWith("commercial_doc_shares")) return liens;
      return [];
    },
  },
});

const lien = (slug, { parent = null, cree = null, email = null, nom = null } = {}) =>
  ({ slug, parent_slug: parent, created_by: cree, recipient_email: email, recipient_name: nom });

const session = (id, slug) => ({ session_id: id, slug, doc_id: "d1", recipient_email: `${id}@lu.example`, ip: "203.0.113.7", last_at: "2026-09-01T10:00:00.000Z" });

describe("la racine d'une chaîne de re-partages", () => {
  const chaine = new Map([["racine", null], ["enfant", "racine"], ["petit", "enfant"]]);

  it("un lien sans parent est sa propre racine", () => {
    expect(racineDuLien("racine", chaine)).toBe("racine");
  });

  it("un lien retransmis remonte jusqu'à la racine, quel que soit le nombre de sauts", () => {
    expect(racineDuLien("enfant", chaine)).toBe("racine");
    expect(racineDuLien("petit", chaine)).toBe("racine");
  });

  it("⚠️ un lien inconnu est INATTRIBUABLE — on ne devine pas", () => {
    expect(racineDuLien("jamais-vu", chaine)).toBeNull();
    expect(racineDuLien("", chaine)).toBeNull();
  });

  it("⚠️ un maillon manquant rompt la chaîne plutôt que de l'attribuer au dernier connu", () => {
    expect(racineDuLien("orphelin", new Map([["orphelin", "disparu"]]))).toBeNull();
  });

  it("⚠️ une chaîne qui boucle ne tourne pas et n'attribue rien", () => {
    expect(racineDuLien("a", new Map([["a", "b"], ["b", "a"]]))).toBeNull();
  });

  it("⚠️ et une chaîne plus longue que tout re-partage réel est refusée, pas parcourue sans fin", () => {
    const longue = new Map();
    for (let i = 0; i < 200; i += 1) longue.set(`n${i}`, i === 199 ? null : `n${i + 1}`);
    expect(racineDuLien("n0", longue)).toBeNull();
    expect(racineDuLien("n0", longue, 500), "assez de sauts : la racine est trouvée").toBe("n199");
  });
});

describe("docshare.sessions : ce qu'un membre voit, et ce qu'il ne voit plus", () => {
  beforeEach(() => {
    liens = [
      lien("A", { cree: "alice@hote.example", email: "dana@client.fr", nom: "Dana" }),
      // Dana retransmet à Paul : `created_by` devient Dana, la racine reste le lien d'Alice.
      lien("A2", { parent: "A", cree: "dana@client.fr", email: "paul@client.fr", nom: "Paul" }),
      lien("B", { cree: "bob@hote.example", email: "eve@client.fr", nom: "Eve" }),
    ];
    sessions = [session("s1", "A"), session("s2", "A2"), session("s3", "B")];
  });

  it("sans portée, toutes les sessions du document — c'est le rôle qui a list.all", async () => {
    const vues = await listSessionsForDoc("d1", null);
    expect(vues.map((s) => s.session_id)).toEqual(["s1", "s2", "s3"]);
  });

  it("⚠️ un membre ne voit plus les sessions des liens de ses collègues", async () => {
    const vues = await listSessionsForDoc("d1", "alice@hote.example");
    expect(vues.map((s) => s.session_id), "s3 est un lien de Bob").toEqual(["s1", "s2"]);
    expect(JSON.stringify(vues), "ni l'adresse ni l'IP du prospect de Bob ne sortent")
      .not.toContain("s3@lu.example");
  });

  it("⚠️ mais il voit la DESCENDANCE de ses propres liens — il a causé cette lecture", async () => {
    const vues = await listSessionsForDoc("d1", "alice@hote.example");
    const paul = vues.find((s) => s.session_id === "s2");
    expect(paul, "la retransmission de Dana appartient à la chaîne d'Alice").toBeTruthy();
    expect(paul.parent_slug).toBe("A");
    expect(paul.parent_recipient_email, "la filiation voyage avec la session").toBe("dana@client.fr");
    expect(paul.parent_recipient_name).toBe("Dana");
  });

  it("⚠️ et le destinataire INTERMÉDIAIRE n'hérite pas de la portée d'un commercial", async () => {
    // Dana est `created_by` du lien de Paul. Si la portée s'arrêtait au dernier maillon, elle
    // verrait la session de Paul — mais Dana n'est pas un membre de l'hôte, et surtout la règle
    // est « la chaîne d'origine », pas « le maillon qui précède ».
    expect((await listSessionsForDoc("d1", "dana@client.fr")).map((s) => s.session_id)).toEqual([]);
  });

  it("⚠️ une session dont le lien n'existe plus n'est attribuée à personne", async () => {
    sessions = [session("s9", "disparu")];
    expect(await listSessionsForDoc("d1", "alice@hote.example")).toEqual([]);
    expect((await listSessionsForDoc("d1", null)).map((s) => s.session_id),
      "list.all la voit encore : ne rien filtrer n'est pas la même chose que filtrer sur rien")
      .toEqual(["s9"]);
  });

  it("la comparaison des adresses ne dépend pas de la casse", async () => {
    expect((await listSessionsForDoc("d1", "ALICE@Hote.Example")).map((s) => s.session_id))
      .toEqual(["s1", "s2"]);
  });

  it("le nom du destinataire reste joint, comme avant", async () => {
    const vues = await listSessionsForDoc("d1", null);
    expect(vues.map((s) => s.recipient_name)).toEqual(["Dana", "Paul", "Eve"]);
  });
});
