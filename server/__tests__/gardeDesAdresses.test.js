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
      // ⚠️ Une CHAÎNE, pas une expression régulière construite à la volée : `toThrow` traite une
      // chaîne comme une sous-chaîne à trouver. Ma première version fabriquait une expression en
      // échappant les points et les crochets — et pas les antislashs, ce que CodeQL a refusé. Un
      // échappement incomplet dans un essai est le même défaut que partout ailleurs ; ici il ne
      // servait à rien, puisque la comparaison littérale suffisait.
      expect(() => publier(objet)).toThrow(chemin);
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

  // ⚠️ LA DISTINCTION QUI A MANQUÉ AU PREMIER BRANCHEMENT, et qui aurait cassé le chat.
  //
  // Une adresse DANS UN MESSAGE est du contenu : son auteur l'a écrite exprès, pour un
  // destinataire qu'il a choisi. Une adresse dans un champ d'IDENTITÉ n'a été choisie par
  // personne — elle vient de la base et sort vers toute l'audience.
  it("laisse passer une adresse écrite dans un message, refuse la même dans une identité", () => {
    expect(() => publier({ body: "écris-moi à lea@exemple.fr" })).not.toThrow();
    expect(() => publier({ reply_text: "il disait marc@exemple.fr" })).not.toThrow();
    // Le même texte, dans un champ qui désigne quelqu'un : refusé.
    expect(() => publier({ author_name: "lea@exemple.fr" })).toThrow(/author_name/);
  });

  // ⚠️ ON ÉNUMÈRE CE QU'ON EXEMPTE, PAS CE QU'ON PROTÈGE. L'inversion EST la garde : un champ
  // ajouté demain est protégé par défaut, et l'exempter demande d'écrire une décision.
  it("protège par défaut un champ que personne n'a prévu", () => {
    expect(() => publier({ champ_invente_demain: "quelqu-un@exemple.fr" })).toThrow(/champ_invente_demain/);
  });

  it("ne confond pas une mention avec une adresse", () => {
    expect(() => publier({ body: "merci @lea, et @thomas aussi" })).not.toThrow();
    expect(() => publier({ author_name: "écris à lea@exemple.fr" })).toThrow();
  });
});
