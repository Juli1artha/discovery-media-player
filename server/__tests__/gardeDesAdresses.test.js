// LA CATÉGORIE, PAS LES QUATRE CHEMINS CONNUS.
//
// Nous avions fermé quatre chemins portant l'adresse d'un membre. Le second hôte a nommé ce qui
// manquait : « mon fermé vaut pour les chemins que j'ai su nommer, pas pour la catégorie ».
//
// ⚠️ CETTE GARDE REFUSE, ELLE NE SIGNALE PAS. Une sonde qui produit une liste transfère le travail
// — quelqu'un doit juger vingt cas, et le jugement est ce qui ne passe pas à l'échelle. Ici le
// champ ne sort pas tant que personne n'a écrit une décision.

const { publier } = require("../publier.js");

describe("aucune adresse ne franchit la sortie publique", () => {
  it("laisse passer ce qui n'en porte pas", () => {
    const objet = { id: 1, author_name: "Léa", author_ref: "0123456789abcdef", body: "bonjour @lea" };
    expect(publier(objet)).toBe(objet); // rendu tel quel, sans copie ni nettoyage
  });

  // Les quatre chemins déjà connus, plus ceux qu'on n'a pas nommés : la garde ne les distingue pas.
  it("refuse une adresse, où qu'elle soit, et dit OÙ", () => {
    const cas = [
      [{ author_email: "lea@exemple.fr" }, "author_email"],
      [{ reactions: { "👍": ["lea@exemple.fr"] } }, "reactions.👍[0]"],
      [{ presence: { membres: [{ meta: { mail: "marc@exemple.fr" } }] } }, "presence.membres[0].meta.mail"],
      [{ colonne_ajoutee_demain: "quelqu-un@exemple.fr" }, "colonne_ajoutee_demain"],
    ];
    for (const [objet, chemin] of cas) {
      expect(() => publier(objet)).toThrow(new RegExp(chemin.replace(/[.[\]]/g, "\\$&")));
    }
  });

  // ⚠️ LES CLÉS AUSSI. La carte des réactions porte les identités en CLÉ chez d'autres hôtes : une
  // garde qui ne regarde que les valeurs laisserait passer exactement ce cas-là.
  it("refuse une adresse placée en clé", () => {
    expect(() => publier({ vues: { "lea@exemple.fr": 3 } })).toThrow(/clé/);
  });

  // ⚠️ ELLE NE NETTOIE PAS. Effacer l'adresse au passage ferait croire la donnée partie alors
  // qu'elle n'a jamais été prévue : une valeur inattendue à la sortie est un défaut de conception,
  // pas une impureté à filtrer.
  it("lève au lieu d'effacer", () => {
    const objet = { author_email: "lea@exemple.fr" };
    expect(() => publier(objet)).toThrow();
    expect(objet.author_email).toBe("lea@exemple.fr"); // rien n'a été modifié en douce
  });

  it("ne confond pas une mention avec une adresse", () => {
    expect(() => publier({ body: "merci @lea, et @thomas aussi" })).not.toThrow();
    expect(() => publier({ body: "écris à lea@exemple.fr" })).toThrow();
  });
});
