// UNE PRÉSENTATION TERMINÉE DEVIENT UNE ARCHIVE : on la relit, on ne l'écrit plus.
//
// Sept routes écrivaient encore après la clôture — messages, réactions, verrou du chat, présence,
// et jusqu'à une URL d'envoi signée vers le bucket d'une session close. Le fil n'était plus
// surveillé par personne : c'est le moment idéal pour y déposer quelque chose.
//
// ⚠️ LA LECTURE RESTE OUVERTE, ET C'EST UN CHOIX. Ce qui s'est dit pendant une présentation a de la
// valeur après : on relit une question, on retrouve un lien. Le risque est dans l'écriture.
//
// ⚠️ « TERMINÉE » VEUT DIRE DÉCIDÉE, PAS PÉRIMÉE. Une présentation devient inactive après trois
// minutes sans battement, et son présentateur doit pouvoir revenir : refuser le chat dans ce cas
// couperait la parole à une salle pendant que l'orateur rebranche son portable.

const crypto = require("node:crypto");
const presentations = require("../presentations.js");

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const CONTROL = "jeton";

function base(ligne) {
  const ecritures = [];
  const ctx = {
    db: {
      async request(chemin, o) {
        if (!o || !o.method) return [{ ...ligne }];
        ecritures.push(chemin);
        return [{ ...ligne }];
      },
    },
    storage: { async signUpload() { return { token: "t", publicUrl: "u" }; } },
    limits: { async allow() { return true; } },
    errors: { capture() {} },
  };
  presentations.init(ctx);
  require("../schema.js").init(ctx);
  return ecritures;
}

const CLOSE = { slug: "s", active: false, control_hash: null, owner_email: "moi@x.fr" };
const PERIMEE = { slug: "s", active: false, control_hash: sha(CONTROL), owner_email: "moi@x.fr" };
const VIVANTE = { slug: "s", active: true, control_hash: sha(CONTROL), owner_email: "moi@x.fr" };

// Les sept portes, décrites par ce qu'elles font plutôt que par leur nom.
const PORTES = [
  ["déposer un message", (p) => p.addMessage("s", { name: "L", body: "coucou", authorToken: "j" })],
  ["réagir à un message", (p) => p.toggleReaction("s", 1, "👍", "0123456789abcdef")],
  ["modifier un message", (p) => p.editMessage("s", 1, "j", "corrigé")],
  ["supprimer un message", (p) => p.deleteMessage("s", 1, { authorToken: "j" })],
  ["verrouiller le chat", (p) => p.setChatLock("s", CONTROL, true)],
  ["signer un envoi de fichier", (p) => p.createUploadUrl("s", "x.pdf", "application/pdf")],
  ["s'annoncer présent", (p) => p.recordAttendance("s", null, { key: "k", name: "L" })],
];

describe("après la clôture, plus rien ne s'écrit", () => {
  for (const [quoi, appel] of PORTES) {
    it(`refuse : ${quoi}`, async () => {
      const ecritures = base(CLOSE);
      const r = await appel(presentations);
      expect(r.ok).toBe(false);
      expect(r.status).toBe(409);
      expect(ecritures, "aucune écriture ne doit partir en base").toEqual([]);
    });
  }
});

describe("mais une présentation seulement PÉRIMÉE reste vivante", () => {
  // ⚠️ SANS CETTE MOITIÉ, LE CORRECTIF SERAIT UNE PANNE. Le portable du présentateur dort trois
  // minutes, la présentation passe inactive — et le chat de la salle se fermerait pour tout le
  // monde, définitivement pour un présentateur anonyme qui ne peut pas reprendre.
  for (const [quoi, appel] of PORTES) {
    it(`laisse passer : ${quoi}`, async () => {
      base(PERIMEE);
      const r = await appel(presentations);
      expect(r.status).not.toBe(409);
    });
  }

  it("et une présentation vivante n'est évidemment pas une archive", async () => {
    base(VIVANTE);
    expect((await presentations.addMessage("s", { name: "L", body: "b", authorToken: "j" })).status).not.toBe(409);
  });
});

describe("la lecture, elle, reste ouverte", () => {
  // C'est le choix de produit : l'historique d'une présentation close se relit.
  it("l'historique d'une présentation close se lit encore", async () => {
    base(CLOSE);
    await expect(presentations.listMessages("s")).resolves.toBeInstanceOf(Array);
  });
});
