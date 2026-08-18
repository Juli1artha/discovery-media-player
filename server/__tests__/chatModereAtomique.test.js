// LA SUPPRESSION DOIT TOUJOURS GAGNER SUR LE CONTENU.
//
// L'édition et la réaction vérifiaient « pas supprimé » à la LECTURE, puis écrivaient par id seul :
// une suppression entre les deux vidait le message — et l'écriture retardée RESSUSCITAIT le texte
// ou les réactions dans une ligne marquée supprimée. Effacé à l'écran, vivant dans le JSON.
// Cinquième audit, P1-3.
//
// ⚠️ LE HARNAIS ÉVALUE LES CONDITIONS CONTRE LA LIGNE COURANTE — un harnais qui rend toujours
// « une ligne modifiée » validerait aussi l'ancien code.

const crypto = require("node:crypto");
const presentations = require("../presentations.js");
const schema = require("../schema.js");
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

const JETON = "jeton-de-l-auteur";
const AUTRE = "jeton-d-un-autre";

function table(depart = {}) {
  const etat = {
    ligne: { id: 1, slug: "s", body: "bonjour", author_hash: sha(JETON), deleted: false,
      reactions: {}, reactions_seq: 0, attachment: null, reply_text: null, reply_name: null, edited: false, ...depart },
    lectures: 0, surLecture: null,
  };
  function correspond(chemin) {
    for (const partie of chemin.split("?")[1].split("&")) {
      const [colonne, reste] = partie.split("=", 2);
      if (["select", "limit"].includes(colonne)) continue;
      const [op, ...v] = reste.split(".");
      const valeur = decodeURIComponent(v.join("."));
      if (op === "eq" && String(etat.ligne[colonne]) !== valeur) return false;
    }
    return true;
  }
  const ctx = {
    errors: { capture() {} }, plugins: {}, has: () => false, branding: {}, config: {}, storage: {},
    db: { async request(chemin, o) {
      if (chemin.startsWith("doc_presentations?")) return [{ slug: "s", active: true, control_hash: sha("control"), chat_locked: false }];
      if (chemin.includes("select=reactions_seq&limit=0")) return [];   // la sonde : colonne présente
      if (!o || !o.method) {
        const resultat = correspond(chemin) ? [{ ...etat.ligne }] : [];
        etat.lectures += 1;
        if (etat.surLecture) etat.surLecture(etat);
        return resultat;
      }
      if (o.method === "PATCH") {
        if (!correspond(chemin)) return [];
        Object.assign(etat.ligne, o.body);
        return [{ ...etat.ligne }];
      }
      return [];
    } },
  };
  presentations.init(ctx); schema.init(ctx);
  return etat;
}

describe("la suppression gagne toujours sur le contenu", () => {
  it("une édition retardée ne ressuscite pas un message supprimé entre lecture et écriture", async () => {
    const t = table();
    t.surLecture = (etat) => { if (etat.lectures === 1) { etat.ligne.deleted = true; etat.ligne.body = ""; } };
    const r = await presentations.editMessage("s", 1, JETON, "texte ressuscité");
    expect(r.ok).toBe(false);
    expect(r.status, "la course doit être refusée par la CONDITION").toBe(409);
    expect(t.ligne.body, "le texte est revenu dans une ligne supprimée").toBe("");
  });

  it("une réaction retardée ne fait pas revivre un message supprimé pendant la boucle", async () => {
    const t = table();
    t.surLecture = (etat) => { if (etat.lectures === 1) { etat.ligne.deleted = true; etat.ligne.reactions = {}; } };
    const r = await presentations.toggleReaction("s", 1, "👍", "aaaaaaaaaaaaaaaa", true);
    expect(r.ok).toBe(false);
    expect(t.ligne.reactions, "une réaction s'est posée sur un message effacé").toEqual({});
  });

  it("supprimer deux fois est idempotent — zéro ligne veut dire « déjà fait »", async () => {
    const t = table({ deleted: true, body: "" });
    const r = await presentations.deleteMessage("s", 1, { authorToken: JETON });
    expect(r.ok).toBe(true);
    expect(r.deja).toBe(true);
    expect(t.ligne.deleted).toBe(true);
  });

  it("la suppression efface AUSSI la citation — un message supprimé ne cite plus rien", async () => {
    const t = table({ reply_text: "le message cité", reply_name: "Alice" });
    const r = await presentations.deleteMessage("s", 1, { authorToken: JETON });
    expect(r.ok).toBe(true);
    expect(t.ligne.reply_text).toBe(null);
    expect(t.ligne.reply_name).toBe(null);
  });

  it("le chemin légitime : éditer son propre message vivant passe", async () => {
    const t = table();
    const r = await presentations.editMessage("s", 1, JETON, "bonsoir");
    expect(r.ok).toBe(true);
    expect(t.ligne.body).toBe("bonsoir");
    expect(t.ligne.edited).toBe(true);
  });

  it("et l'autre jeton reste refusé — la condition n'a pas remplacé l'autorisation", async () => {
    const t = table();
    const r = await presentations.editMessage("s", 1, AUTRE, "vandalisme");
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(t.ligne.body).toBe("bonjour");
  });
});

// ⚠️ LA CEINTURE COUVRE AUSSI LE PASSÉ : les courses d'avant ce correctif ont pu laisser du contenu
// sous deleted=true — la projection est le dernier endroit qui peut refuser de le resservir.
describe("une ligne supprimée sort VIDE, quoi que porte la base", () => {
  it("corps, pièce jointe, réactions et citation forcés à vide", () => {
    const fantome = {
      id: 9, slug: "s", deleted: true,
      body: "texte resté en base", attachment: { url: "https://x/piece.pdf" },
      reactions: { "👍": ["aaaaaaaaaaaaaaaa"] }, reply_text: "citation restée", reply_name: "Bob",
      author_name: "Alice", author_hash: sha(JETON), created_at: "2026-08-01",
    };
    const pub = presentations.messagePublic(fantome);
    expect(pub.body).toBe("");
    expect(pub.attachment).toBe(null);
    expect(pub.reactions).toEqual({});
    expect(pub.reply_text).toBe(null);
    expect(pub.reply_name).toBe(null);
    expect(pub.deleted).toBe(true);
  });
});
