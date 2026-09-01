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
const { init, listSessionsForDoc, listSessionsForRecipient, racineDuLien, curseurDe, curseurLu,
  sessionServie, CHAMPS_SERVIS, CHAMPS_RETENUS } = require("../shares.js");
const { readFileSync } = require("node:fs");

// Le contexte est INJECTÉ par `init`, comme en production : les deux lectures de
// `listSessionsForDoc` sont servies ici, sans base ni réseau.
// Les chemins demandés, pour éprouver la requête elle-même et pas seulement son résultat.
const demandes = [];
// Une base minuscule mais HONNÊTE : elle applique le filtre du curseur, la borne de temps, l'ordre
// et la limite. Un faux qui rendrait tout quel que soit le chemin ne prouverait rien de la
// pagination — c'est la pagination qu'on vient éprouver.
init({
  db: {
    request: async (chemin) => {
      demandes.push(chemin);
      if (chemin.startsWith("commercial_doc_shares")) {
        const dans = /slug=in\.\(([^)]*)\)/.exec(chemin);
        if (!dans) return liens;
        const voulus = new Set(decodeURIComponent(dans[1]).split(",").map((x) => x.replace(/"/g, "")));
        return liens.filter((l) => voulus.has(l.slug));
      }
      if (!chemin.startsWith("commercial_doc_sessions")) return [];
      const dest = /recipient_email=eq\.([^&]*)/.exec(chemin);
      const depuis = /last_at=gte\.([^&]*)/.exec(chemin);
      const jusqua = /last_at=lte\.([^&]*)/.exec(chemin);
      const sauf = /session_id=not\.in\.\(([^&]*)\)/.exec(chemin);
      const limite = /limit=(\d+)/.exec(chemin);
      let vues = sessions.slice();
      if (dest) vues = vues.filter((s) => s.recipient_email === decodeURIComponent(dest[1]));
      if (depuis) vues = vues.filter((s) => s.last_at >= decodeURIComponent(depuis[1]));
      if (jusqua) vues = vues.filter((s) => s.last_at <= decodeURIComponent(jusqua[1]));
      if (sauf) {
        const exclues = new Set(decodeURIComponent(sauf[1]).split(",").map((x) => x.replace(/"/g, "")));
        vues = vues.filter((s) => !exclues.has(s.session_id));
      }
      vues.sort((a, b) => (b.last_at.localeCompare(a.last_at) || b.session_id.localeCompare(a.session_id)));
      return limite ? vues.slice(0, Number(limite[1])) : vues;
    },
  },
});

const lien = (slug, { parent = null, cree = null, email = null, nom = null } = {}) =>
  ({ slug, parent_slug: parent, created_by: cree, recipient_email: email, recipient_name: nom });

// ⚠️ DES HORODATAGES DISTINCTS, parce que l'ordre est une propriété qu'on éprouve. Un jeu d'essai
// où tout porte la même seconde rend l'ordre arbitraire, et un banc qui l'assiette alors n'assiette
// que l'ordre d'insertion de sa propre fixture.
const session = (id, slug, { at = null, email = null, doc = "d1" } = {}) => ({
  session_id: id, slug, doc_id: doc,
  recipient_email: email || `${id}@lu.example`,
  ip: "203.0.113.7",
  last_at: at || `2026-09-01T10:00:0${id.replace(/\D/g, "") || 0}.000Z`,
});

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
    // s3 la plus récente, s1 la plus ancienne : l'ordre rendu doit être descendant.
    sessions = [
      session("s1", "A", { at: "2026-09-01T10:00:01.000Z" }),
      session("s2", "A2", { at: "2026-09-01T10:00:02.000Z" }),
      session("s3", "B", { at: "2026-09-01T10:00:03.000Z" }),
    ];
  });

  it("sans portée, toutes les sessions du document — c'est le rôle qui a list.all", async () => {
    const vues = await listSessionsForDoc("d1", null);
    expect(vues.map((s) => s.session_id), "la plus récente d'abord").toEqual(["s3", "s2", "s1"]);
  });

  it("⚠️ un membre ne voit plus les sessions des liens de ses collègues", async () => {
    const vues = await listSessionsForDoc("d1", "alice@hote.example");
    expect(vues.map((s) => s.session_id), "s3 est un lien de Bob").toEqual(["s2", "s1"]);
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
      .toEqual(["s2", "s1"]);
  });

  it("le nom du destinataire reste joint, comme avant", async () => {
    const vues = await listSessionsForDoc("d1", null);
    expect(vues.map((s) => s.recipient_name)).toEqual(["Eve", "Paul", "Dana"]);
  });
});

// ⚠️ LA FICHE PAR DESTINATAIRE TRAVERSE TOUS LES DOCUMENTS, donc la portée y compte davantage : sans
// elle, un membre lirait l'historique complet d'une personne à qui un collègue a écrit. Et la
// pagination y est le point délicat — le filtre de portée s'applique APRÈS la lecture, donc une page
// peut être plus courte que demandée sans être la dernière.
describe("docshare.sessionsByRecipient : la même portée, sur toute une personne", () => {
  beforeEach(() => {
    demandes.length = 0;
    liens = [
      lien("A", { cree: "alice@hote.example", email: "dana@client.fr", nom: "Dana" }),
      lien("A2", { parent: "A", cree: "dana@client.fr", email: "dana@client.fr", nom: "Dana" }),
      lien("B", { cree: "bob@hote.example", email: "dana@client.fr", nom: "Dana" }),
    ];
    sessions = [
      session("s1", "A", { at: "2026-08-30T10:00:00.000Z", email: "dana@client.fr", doc: "d1" }),
      session("s2", "B", { at: "2026-08-31T10:00:00.000Z", email: "dana@client.fr", doc: "d2" }),
      session("s3", "A2", { at: "2026-09-01T10:00:00.000Z", email: "dana@client.fr", doc: "d1" }),
      session("s4", "A", { at: "2026-09-01T09:00:00.000Z", email: "autre@client.fr", doc: "d1" }),
    ];
  });

  it("rend les lectures de la personne, tous documents confondus, la plus récente d'abord", async () => {
    const { sessions: vues } = await listSessionsForRecipient("dana@client.fr", { owner: null });
    expect(vues.map((s) => s.session_id)).toEqual(["s3", "s2", "s1"]);
    expect(vues.map((s) => s.doc_id), "chaque session porte l'empreinte de son document")
      .toEqual(["d1", "d2", "d1"]);
    expect(vues.find((s) => s.session_id === "s4"), "une autre personne n'entre pas").toBeUndefined();
  });

  it("⚠️ un membre ne voit que sa propre chaîne — le lien de Bob disparaît", async () => {
    const { sessions: vues } = await listSessionsForRecipient("dana@client.fr", { owner: "alice@hote.example" });
    expect(vues.map((s) => s.session_id), "s2 part d'un lien de Bob").toEqual(["s3", "s1"]);
    expect(JSON.stringify(vues)).not.toContain('"slug":"B"');
  });

  it("⚠️ et la retransmission de sa propre chaîne reste visible, avec sa filiation", async () => {
    const { sessions: vues } = await listSessionsForRecipient("dana@client.fr", { owner: "alice@hote.example" });
    const retransmise = vues.find((s) => s.session_id === "s3");
    expect(retransmise.parent_slug).toBe("A");
    expect(retransmise.parent_recipient_email).toBe("dana@client.fr");
  });

  it("une adresse vide ne rend rien et n'interroge pas la base", async () => {
    demandes.length = 0;
    expect(await listSessionsForRecipient("", { owner: null })).toEqual({ sessions: [], curseur: null });
    expect(demandes, "on ne demande pas « les sessions de personne »").toEqual([]);
  });

  it("la borne de temps par défaut est la fenêtre analytique, et elle est passée à la base", async () => {
    await listSessionsForRecipient("dana@client.fr", { owner: null });
    expect(demandes[0]).toMatch(/last_at=gte\./);
  });

  it("⚠️ une borne explicite remonte plus loin — la fiche promet tout l'historique", async () => {
    sessions.push(session("vieux", "A", { at: "2020-01-01T00:00:00.000Z", email: "dana@client.fr" }));
    const parDefaut = await listSessionsForRecipient("dana@client.fr", { owner: null });
    expect(parDefaut.sessions.map((s) => s.session_id), "hors fenêtre : absent").not.toContain("vieux");
    const complet = await listSessionsForRecipient("dana@client.fr", { owner: null, depuis: "2000-01-01T00:00:00.000Z" });
    expect(complet.sessions.map((s) => s.session_id)).toContain("vieux");
  });
});

describe("⚠️ la pagination par curseur : rien de sauté, rien rendu deux fois", () => {
  beforeEach(() => {
    demandes.length = 0;
    liens = [lien("A", { cree: "alice@hote.example", email: "dana@client.fr", nom: "Dana" })];
    sessions = Array.from({ length: 7 }, (_, i) => session(`p${i}`, "A", {
      at: `2026-09-0${i + 1}T10:00:00.000Z`, email: "dana@client.fr",
    }));
  });

  it("parcourt tout en pages de trois, sans doublon ni trou", async () => {
    const vus = [];
    let curseur = null;
    for (let page = 0; page < 10; page += 1) {
      const r = await listSessionsForRecipient("dana@client.fr", { owner: null, limite: 3, apres: curseur });
      vus.push(...r.sessions.map((s) => s.session_id));
      curseur = r.curseur;
      if (!curseur) break;
    }
    expect(vus, "les sept, une seule fois chacune, en ordre descendant")
      .toEqual(["p6", "p5", "p4", "p3", "p2", "p1", "p0"]);
    expect(new Set(vus).size).toBe(7);
  });

  it("⚠️ la fin se lit au curseur nul, JAMAIS à la longueur de la page", async () => {
    const derniere = await listSessionsForRecipient("dana@client.fr", { owner: null, limite: 7 });
    expect(derniere.sessions).toHaveLength(7);
    expect(derniere.curseur, "page pleine et source épuisée : on rend quand même un curseur").not.toBeNull();
    const apres = await listSessionsForRecipient("dana@client.fr", { owner: null, limite: 7, apres: derniere.curseur });
    expect(apres.sessions).toEqual([]);
    expect(apres.curseur).toBeNull();
  });

  it("⚠️ une page sous portée peut être VIDE sans être la dernière — le curseur porte la ligne EXAMINÉE", async () => {
    // Les trois plus récentes appartiennent à Bob, les quatre plus anciennes à Alice.
    liens = [
      lien("A", { cree: "alice@hote.example", email: "dana@client.fr" }),
      lien("B", { cree: "bob@hote.example", email: "dana@client.fr" }),
    ];
    sessions = sessions.map((s, i) => ({ ...s, slug: i >= 4 ? "B" : "A" }));
    const premiere = await listSessionsForRecipient("dana@client.fr", { owner: "alice@hote.example", limite: 3 });
    expect(premiere.sessions, "les trois plus récentes sont à Bob : page vide").toEqual([]);
    expect(premiere.curseur, "et pourtant ce n'est pas la fin").not.toBeNull();
    const suite = await listSessionsForRecipient("dana@client.fr", { owner: "alice@hote.example", limite: 3, apres: premiere.curseur });
    expect(suite.sessions.map((s) => s.session_id)).toEqual(["p3", "p2", "p1"]);
  });

  it("⚠️ à horodatage ÉGAL, c'est session_id qui départage — sinon une session se perd", async () => {
    const memeInstant = "2026-09-09T10:00:00.000Z";
    sessions = [
      session("aa", "A", { at: memeInstant, email: "dana@client.fr" }),
      session("bb", "A", { at: memeInstant, email: "dana@client.fr" }),
    ];
    const p1 = await listSessionsForRecipient("dana@client.fr", { owner: null, limite: 1 });
    expect(p1.sessions.map((s) => s.session_id)).toEqual(["bb"]);
    const p2 = await listSessionsForRecipient("dana@client.fr", { owner: null, limite: 1, apres: p1.curseur });
    expect(p2.sessions.map((s) => s.session_id), "la seconde n'est ni sautée ni répétée").toEqual(["aa"]);
  });

  it("⚠️ PLUS d'ex æquo que la page ne peut en tenir : les exclusions s'ACCUMULENT", async () => {
    // Cinq sessions dans la même milliseconde, des pages de deux. Si le curseur ne portait que les
    // ex æquo de LA page courante, la troisième page re-servirait ceux de la première — et la
    // pagination tournerait en rond sur un horodatage encombré.
    const memeInstant = "2026-09-09T10:00:00.000Z";
    sessions = ["e1", "e2", "e3", "e4", "e5"].map((id) => session(id, "A", { at: memeInstant, email: "dana@client.fr" }));
    const vus = [];
    let curseur = null;
    for (let page = 0; page < 8; page += 1) {
      const r = await listSessionsForRecipient("dana@client.fr", { owner: null, limite: 2, apres: curseur });
      vus.push(...r.sessions.map((x) => x.session_id));
      curseur = r.curseur;
      if (!curseur) break;
    }
    expect(vus.slice().sort(), "les cinq, une seule fois chacune").toEqual(["e1", "e2", "e3", "e4", "e5"]);
    expect(new Set(vus).size, "aucun doublon").toBe(5);
  });

  it("le curseur porte l'horodatage ET les ex æquo déjà servis, et un curseur illisible est refusé", () => {
    expect(curseurDe("2026-09-01T10:00:00.000Z", ["x"])).toBe("2026-09-01T10:00:00.000Z|x");
    expect(curseurDe("2026-09-01T10:00:00.000Z", ["x", "y"])).toBe("2026-09-01T10:00:00.000Z|x,y");
    expect(curseurDe(null, [])).toBeNull();
    expect(curseurLu("2026-09-01T10:00:00.000Z|x,y")).toEqual({ at: "2026-09-01T10:00:00.000Z", ids: ["x", "y"] });
    for (const faux of ["", "sans-barre", "|x", "pas-une-date|x", "2026-09-01T10:00:00.000Z|"]) {
      expect(curseurLu(faux), `« ${faux} » n'est pas une position`).toBeNull();
    }
  });

  it("⚠️ la requête n'emploie AUCUN arbre booléen — `ci.yml` les refuse, un portage n'est pas une réécriture", async () => {
    demandes.length = 0;
    const p1 = await listSessionsForRecipient("dana@client.fr", { owner: null, limite: 2 });
    await listSessionsForRecipient("dana@client.fr", { owner: null, limite: 2, apres: p1.curseur });
    for (const chemin of demandes) {
      expect(chemin, `« ${chemin} » porte un or=(`).not.toMatch(/[?&]or=\(/);
      expect(chemin, `« ${chemin} » porte un and=(`).not.toMatch(/[?&]and=\(/);
      expect(chemin, `« ${chemin} » porte un offset=`).not.toMatch(/offset=/);
    }
    expect(demandes.some((c) => /session_id=not\.in\./.test(c)),
      "la seconde page exclut les ex æquo déjà servis, en filtre plat").toBe(true);
  });

  it("la limite est bornée des deux côtés", async () => {
    await listSessionsForRecipient("dana@client.fr", { owner: null, limite: 99999 });
    expect(demandes[0]).toMatch(/limit=500\b/);
    demandes.length = 0;
    await listSessionsForRecipient("dana@client.fr", { owner: null, limite: 0 });
    expect(demandes[0], "zéro n'est pas une page").toMatch(/limit=100\b/);
  });
});

// ⚠️ CE QUI SORT EST UNE LISTE DE CE QUI EST PERMIS, PAS DE CE QU'ON RETIRE. Les deux lectures
// demandaient `select=*` : ce que la table contient partait par défaut, et une colonne ajoutée
// demain serait partie sans que personne y pense. Dans ce sens-là l'oubli est une FUITE ; dans
// l'autre, c'est une absence que le premier lecteur signale.
describe("⚠️ ce qu'une session laisse sortir", () => {
  beforeEach(() => {
    liens = [lien("A", { cree: "alice@hote.example", email: "dana@client.fr", nom: "Dana" })];
    sessions = [{
      session_id: "s1", slug: "A", doc_id: "d1", recipient_email: "dana@client.fr",
      num_pages: 12, max_page: 4, total_seconds: 360, pages_time: { 1: 30 },
      ua: "Mozilla/5.0", ip: "203.0.113.7", device: "desktop", os: "macOS", browser: "Safari",
      started_at: "2026-09-01T09:00:00.000Z", last_at: "2026-09-01T09:06:00.000Z",
    }];
  });

  it("⚠️ l'IP EN CLAIR ne sort plus — ni par document, ni par destinataire", async () => {
    const parDoc = await listSessionsForDoc("d1", null);
    const parPersonne = await listSessionsForRecipient("dana@client.fr", { owner: null });
    for (const [quoi, vues] of [["par document", parDoc], ["par destinataire", parPersonne.sessions]]) {
      expect(vues, quoi).toHaveLength(1);
      expect(vues[0], quoi).not.toHaveProperty("ip");
      expect(JSON.stringify(vues), `${quoi} : l'adresse ne doit apparaître nulle part`)
        .not.toContain("203.0.113.7");
    }
  });

  it("⚠️ ni le User-Agent BRUT — il est redondant avec device/os/browser, et il empreinte", async () => {
    const parDoc = await listSessionsForDoc("d1", null);
    const parPersonne = await listSessionsForRecipient("dana@client.fr", { owner: null });
    for (const [quoi, vues] of [["par document", parDoc], ["par destinataire", parPersonne.sessions]]) {
      expect(vues[0], quoi).not.toHaveProperty("ua");
      expect(JSON.stringify(vues), `${quoi} : la chaîne brute ne doit apparaître nulle part`)
        .not.toContain("Mozilla/5.0");
      // Ce qu'un lecteur de fiche lit vraiment reste là : `parseUa` l'a extrait à l'écriture.
      expect([vues[0].device, vues[0].os, vues[0].browser], quoi).toEqual(["desktop", "macOS", "Safari"]);
    }
  });

  it("⚠️ et la base ne nous la donne même pas — le `select=` ne la demande pas", async () => {
    demandes.length = 0;
    await listSessionsForDoc("d1", null);
    const lecture = demandes.find((c) => c.startsWith("commercial_doc_sessions"));
    expect(lecture, "plus de select=*").not.toMatch(/select=\*/);
    expect(lecture, "la colonne ip n'est pas demandée").not.toMatch(/\bip\b/);
    expect(lecture, "la colonne ua non plus").not.toMatch(/\bua\b/);
    expect(lecture).toMatch(/select=[^&]*session_id/);
  });

  it("ce qui sert à la fiche continue de sortir", async () => {
    const [vue] = await listSessionsForDoc("d1", null);
    expect(vue.max_page).toBe(4);
    expect(vue.total_seconds).toBe(360);
    expect(vue.pages_time).toEqual({ 1: 30 });
    expect([vue.device, vue.os, vue.browser], "l'appareil lisible, tiré du UA à l'écriture")
      .toEqual(["desktop", "macOS", "Safari"]);
    expect(vue.recipient_name, "la jointure du nom tient toujours").toBe("Dana");
  });

  it("⚠️ une colonne ajoutée demain ne sort PAS par défaut — l'oubli est une absence, pas une fuite", () => {
    const avecNouveaute = { session_id: "x", slug: "A", secret_ajoute_demain: "à ne pas servir" };
    expect(sessionServie(avecNouveaute)).toEqual({ session_id: "x", slug: "A" });
  });

  it("⚠️ CHAQUE colonne de la table est servie ou retenue avec sa raison — sinon la liste dérive", () => {
    // Le sujet est le schéma réel, lu là où il est écrit : une colonne ajoutée à `init.sql` sans
    // décision fait rougir ce cas, et c'est exactement ce qu'on veut d'elle.
    const sql = readFileSync("supabase/init.sql", "utf8");
    const bloc = /create table if not exists public\.commercial_doc_sessions \(([\s\S]*?)\n\);/.exec(sql);
    expect(bloc, "la table doit être lisible dans init.sql — sinon ce contrôle ne prouve rien").toBeTruthy();
    const colonnes = bloc[1].split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("--"))
      .map((l) => l.split(/\s+/)[0])
      .filter((c) => /^[a-z_]+$/.test(c));
    expect(colonnes.length, "aucune colonne lue : la sonde vise à côté").toBeGreaterThan(5);
    const decidees = new Set([...CHAMPS_SERVIS, ...Object.keys(CHAMPS_RETENUS)]);
    expect(colonnes.filter((c) => !decidees.has(c)),
      "une colonne ni servie ni retenue : inscrivez-la dans CHAMPS_SERVIS, ou dans CHAMPS_RETENUS avec sa raison")
      .toEqual([]);
  });

  it("⚠️ et une colonne retenue porte une raison LISIBLE, pas une case cochée", () => {
    expect(Object.keys(CHAMPS_RETENUS)).toEqual(expect.arrayContaining(["ip", "ua"]));
    for (const [colonne, raison] of Object.entries(CHAMPS_RETENUS)) {
      expect(raison.length, `« ${colonne} » : une raison d'un mot n'explique rien`).toBeGreaterThan(40);
    }
    for (const retenu of Object.keys(CHAMPS_RETENUS)) {
      expect(CHAMPS_SERVIS, `« ${retenu} » ne peut pas être dans les deux listes`).not.toContain(retenu);
    }
  });
});
