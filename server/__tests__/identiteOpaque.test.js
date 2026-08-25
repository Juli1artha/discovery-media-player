// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// AUCUNE ADRESSE NE SORT — ET LES DEUX MOITIÉS DU CALCUL DOIVENT COÏNCIDER.
//
// `author_email` figurait dans les champs publics du chat : chaque message rendu à n'importe quel
// participant portait l'adresse de son auteur. Nos audiences sont des visiteurs anonymes externes,
// donc il suffisait d'ouvrir l'historique pour repartir avec les adresses de toute l'équipe.
//
// ⚠️ TROIS AUTRES CHEMINS PORTAIENT LA MÊME DONNÉE, dont deux que l'audit n'avait pas relevés :
// la carte des RÉACTIONS (stockée avec `email || nom` comme identité de réacteur), la charge de
// présence, et jusqu'à la CLÉ du canal de présence — visible de tous les participants. Fermer le
// champ le plus visible et laisser les trois autres n'aurait rien fermé du tout.
//
// ⚠️ ET LE REMPLAÇANT SE CALCULE DES DEUX CÔTÉS. Le serveur dérive la référence d'un auteur depuis
// le hachage stocké ; le navigateur la dérive depuis son jeton. Deux exemplaires d'une même règle,
// dans deux langages : si elles divergent d'un caractère, plus personne ne reconnaît ses propres
// messages ni ses propres réactions — sans qu'aucune erreur ne s'affiche. On les confronte.

const crypto = require("node:crypto");
const presentations = require("../presentations.js");
// ⚠️ LA SOURCE TypeScript, pas un artefact : c'est la règle du navigateur telle qu'elle est
// ÉCRITE qu'on confronte à celle du serveur. Passer par un paquet construit ferait dépendre cet
// essai d'une étape de construction — et le rendrait muet le jour où elle est oubliée.
let referenceAuteur;
beforeAll(async () => { ({ referenceAuteur } = await import("../../src/live.ts")); });

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");

function contexte(rows) {
  presentations.init({
    db: {
      async request(chemin, options) {
        if (options && options.method) return rows.ecriture ? [rows.ecriture] : [];
        return rows.lecture || [];
      },
    },
  });
}

describe("aucune adresse ne sort du chat", () => {
  it("un message public ne porte ni adresse ni matériel de jeton", async () => {
    const ligne = {
      id: 7, author_name: "Léa", author_email: "lea@exemple.fr", author_hash: sha("jeton-de-lea"),
      author_avatar: "", is_presenter: false, is_member: true, body: "bonjour",
      reactions: { "👍": [sha("x").slice(0, 16)] }, deleted: false, created_at: "2026-08-17T10:00:00Z",
    };
    contexte({ lecture: [ligne] });
    const [message] = await presentations.listMessages("slug-essai");

    const texte = JSON.stringify(message);
    expect(texte).not.toContain("lea@exemple.fr");
    expect(texte).not.toContain("@");                       // aucune adresse, sous aucune forme
    expect(texte).not.toContain(ligne.author_hash);         // ni le matériel gardé en base
    expect(message.author_email).toBeUndefined();
    expect(message.author_hash).toBeUndefined();
    // Ce qui reste permet toujours d'attribuer le message à quelqu'un, sans dire qui c'est.
    expect(message.author_name).toBe("Léa");
    expect(message.author_ref).toMatch(/^[0-9a-f]{16}$/);
  });

  // ⚠️ Les anciennes lignes portent des adresses DANS LES RÉACTIONS, et aucune migration ne les
  // réécrira. On garde le compte — la pastille affiche toujours « 👍 2 » — sans laisser sortir
  // l'identité de personne.
  it("une réaction héritée garde son compte et perd son identité", async () => {
    contexte({ lecture: [{
      id: 8, author_name: "Marc", author_hash: sha("jeton-de-marc"),
      reactions: { "👍": ["lea@exemple.fr", "marc"], "🎉": ["thomas@exemple.fr"] },
    }] });
    const [message] = await presentations.listMessages("slug-essai");

    expect(JSON.stringify(message.reactions)).not.toContain("@");
    expect(JSON.stringify(message.reactions)).not.toContain("marc");
    expect(message.reactions["👍"]).toHaveLength(2);
    expect(message.reactions["🎉"]).toHaveLength(1);
  });

  it("une référence déjà opaque traverse intacte", async () => {
    const ref = sha("quelqu-un").slice(0, 16);
    contexte({ lecture: [{ id: 9, author_hash: sha("j"), reactions: { "👍": [ref] } }] });
    const [message] = await presentations.listMessages("slug-essai");
    expect(message.reactions["👍"]).toEqual([ref]);
  });
});

describe("les deux moitiés du calcul disent la même chose", () => {
  // ⚠️ SI ELLES DIVERGENT, RIEN NE CASSE VISIBLEMENT : les boutons « Modifier » disparaissent, les
  // réactions ne se retirent plus, et personne ne reçoit d'erreur. Exactement le genre de panne
  // qu'un essai doit attraper, parce que l'usage ne l'attrape pas.
  it("le navigateur retrouve la référence que le serveur dérive", async () => {
    for (const jeton of ["jeton-simple", "a", "Ω-accentué-ÿ", crypto.randomBytes(24).toString("base64url")]) {
      contexte({ lecture: [{ id: 1, author_hash: sha(jeton) }] });
      const [message] = await presentations.listMessages("s");
      expect(await referenceAuteur(jeton)).toBe(message.author_ref);
    }
  });

  it("sans moteur de hachage, le navigateur ne prétend rien", async () => {
    expect(await referenceAuteur("jeton", null)).toBe("");
    expect(await referenceAuteur("", undefined)).toBe("");
  });
});

describe("la présence ne publie plus d'adresse", () => {
  // ⚠️ DEUX CHEMINS, ET LE SECOND EST INVISIBLE À QUI NE LIT QUE LA CHARGE : la CLÉ du canal de
  // présence était `email + ':' + identifiant`, et une clé de présence est lisible par TOUS les
  // participants — indépendamment de ce que `track()` envoie. Fermer la charge et laisser la clé
  // n'aurait rien fermé.
  //
  // Cette garde lit le gabarit servi plutôt qu'un canal ouvert : le Realtime n'existe pas au banc,
  // et la question posée ici — « qu'est-ce que la page ANNONCE » — se lit dans le texte qu'elle
  // exécute. Le dire ainsi vaut mieux que d'affirmer qu'on a observé le réseau.
  it("ni la charge de présence ni la clé du canal ne portent d'adresse", () => {
    const source = require("./sourceDesPages.cjs").SOURCE_PAGES;
    const sansCommentaires = source.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

    const track = /ch\.track\(\{[^}]*\}\)/.exec(sansCommentaires);
    expect(track, "l'appel track() doit rester repérable, sinon cette garde ne garde rien").toBeTruthy();
    expect(track[0]).not.toMatch(/email/);
    expect(track[0]).toContain("ref:MOIREF");

    const cle = /presence:\{key:[^}]*\}/.exec(sansCommentaires);
    expect(cle, "la clé de présence doit rester repérable").toBeTruthy();
    expect(cle[0]).not.toMatch(/email/);

    // Et l'identité d'un réacteur ne part plus DU TOUT du client : MOIREF est public (le tableau
    // des réactions porte les refs de tous), donc s'y fier laissait usurper. Le client envoie son
    // JETON, le serveur dérive — l'essai vérifie que l'ancien champ a bien disparu de l'appel.
    expect(sansCommentaires).toContain("authorToken:authToken()");
    expect(sansCommentaires).not.toMatch(/reactor:MOIREF/);
    expect(sansCommentaires).not.toContain("reactor:reactorId()");
  });
});
