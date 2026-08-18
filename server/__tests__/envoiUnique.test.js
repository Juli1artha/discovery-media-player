// DEUX ENVOIS DU MÊME MESSAGE NE FONT PAS DEUX MESSAGES.
//
// Un renvoi réseau, un double-clic, une reprise après délai : la requête part deux fois et la base
// enregistre deux lignes. Le participant voit son message en double, et rien ne le lui explique —
// il n'y a eu aucune erreur, seulement un succès de trop. Constat P10 de l'audit.
//
// ⚠️ UN REFUS D'UNICITÉ N'EST PAS UNE ERREUR, C'EST UNE CONFIRMATION. La contrainte dit « ce message
// est déjà là » : le remonter au participant remplacerait « deux messages » par « une erreur », ce
// qui n'est pas mieux. On relit la ligne déjà écrite et on la rend comme un succès.

const presentations = require("../presentations.js");

function base({ colonne = true, conflit = false } = {}) {
  const ecrits = [];
  const ctx = {
    db: {
      async request(chemin, o) {
        // La sonde de schéma : la colonne existe-t-elle ?
        if (chemin.includes("select=client_key&limit=0")) {
          if (!colonne) throw new Error("column \"client_key\" does not exist");
          return [];
        }
        if (chemin.startsWith("doc_presentations?")) return [{ slug: "s", active: true, control_hash: "h" }];
        if (o && o.method === "POST") {
          if (conflit && ecrits.length) throw new Error("Supabase POST doc_presentation_messages → 409");
          ecrits.push(o.body[0]);
          return [{ id: ecrits.length, author_hash: "x", body: o.body[0].body, client_key: o.body[0].client_key }];
        }
        // Relecture après conflit.
        if (chemin.includes("client_key=eq.")) return ecrits.length ? [{ id: 1, author_hash: "x", body: ecrits[0].body }] : [];
        return [];
      },
    },
    errors: { capture() {} },
  };
  presentations.init(ctx);
  require("../schema.js").init(ctx);
  return ecrits;
}

const envoi = (cle) => ({ name: "Léa", body: "bonjour", authorToken: "j", clientKey: cle });

describe("un renvoi ne crée pas un second message", () => {
  it("la clé part en base quand la colonne existe", async () => {
    const ecrits = base();
    await presentations.addMessage("s", envoi("abc123"));
    expect(ecrits[0].client_key).toBe("abc123");
  });

  // ⚠️ LE CAS QUI COMPTE : la base refuse, et l'appelant reçoit un SUCCÈS.
  it("un conflit d'unicité rend le message déjà écrit, comme un succès", async () => {
    const ecrits = base({ conflit: true });
    await presentations.addMessage("s", envoi("abc123"));
    const r = await presentations.addMessage("s", envoi("abc123"));   // le renvoi
    expect(ecrits).toHaveLength(1);            // une seule ligne
    expect(r.ok).toBe(true);                   // et aucune erreur remontée
    expect(r.deja).toBe(true);
    expect(r.message.body).toBe("bonjour");
  });

  // ⚠️ SANS LA COLONNE, LA CLÉ N'EST PAS ÉCRITE — sinon PostgREST rejette le POST ENTIER et c'est
  // l'ENVOI qu'on perdrait, pas l'idempotence. Même piège que le rang d'écriture, même sonde.
  it("chez un hôte non migré, la clé n'est pas écrite et l'envoi passe", async () => {
    const ecrits = base({ colonne: false });
    const r = await presentations.addMessage("s", envoi("abc123"));
    expect(r.ok).toBe(true);
    expect(ecrits[0].client_key).toBeUndefined();
  });

  // ⚠️ ET ON NE PRÉTEND PAS. Si la relecture ne trouve rien, le 409 venait d'autre chose : le taire
  // ferait croire à un envoi réussi qui n'a pas eu lieu.
  it("un 409 dont on ne retrouve pas la ligne remonte", async () => {
    const ctx = {
      db: {
        async request(chemin, o) {
          if (chemin.includes("select=client_key&limit=0")) return [];
          if (chemin.startsWith("doc_presentations?")) return [{ slug: "s", active: true, control_hash: "h" }];
          if (o && o.method === "POST") throw new Error("Supabase POST → 409");
          return [];   // la relecture ne trouve rien
        },
      },
      errors: { capture() {} },
    };
    presentations.init(ctx);
    require("../schema.js").init(ctx);
    await expect(presentations.addMessage("s", envoi("abc123"))).rejects.toThrow(/409/);
  });
});
