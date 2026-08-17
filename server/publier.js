// AUCUNE ADRESSE NE SORT — LA CATÉGORIE, PAS LES QUATRE CHEMINS CONNUS.
//
// Nous avions corrigé quatre chemins qui portaient l'adresse d'un membre : les champs publics du
// chat, la carte des réactions, la charge de présence, la clé du canal. Le second hôte a dit ce
// qui manquait, et il avait raison : « mon fermé vaut pour les chemins que j'ai su nommer, pas
// pour la catégorie ». Rien ne garantissait qu'il n'y en avait pas un cinquième.
//
// ⚠️ CE N'EST PAS UNE SONDE QUI PRODUIT UNE LISTE. Une garde qui signale « ces vingt endroits
// ressemblent à des adresses » transfère le travail : quelqu'un doit juger vingt cas, et le
// jugement est précisément ce qui ne passe pas à l'échelle. Celle-ci REFUSE — le champ ne sort
// pas, et il faut écrire une décision pour qu'il sorte.
//
// ⚠️ ET ELLE NE NETTOIE PAS EN SILENCE. Effacer l'adresse au passage serait pire que la laisser :
// on croirait la donnée partie alors qu'elle n'a jamais été prévue. Une valeur inattendue à la
// sortie est un défaut de conception, pas une impureté à filtrer — donc on lève.

// Reconnaît une adresse par sa FORME, pas par le nom du champ. `author_email` était nommé ; les
// réactions ne l'étaient pas, et c'est là que l'adresse se cachait.
const ADRESSE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;

/**
 * Rend l'objet tel quel s'il ne porte aucune adresse ; lève sinon, en NOMMANT le chemin.
 *
 * Le chemin compte plus que la valeur : « reactions.👍[0] » dit où regarder, « une adresse a été
 * trouvée » envoie chercher.
 */
/**
 * ⚠️ LES CHAMPS QUE LES GENS RÉDIGENT, ET CEUX QUI DÉSIGNENT QUELQU'UN — la distinction que le
 * premier branchement n'avait pas.
 *
 * Branchée sur tout, la garde levait sur `body` : un participant qui écrit « écris-moi à
 * lea@exemple.fr » dans le chat voyait son message provoquer une exception. Elle transformait un
 * usage normal en panne, et je l'ai mesuré plutôt que supposé.
 *
 * Une adresse DANS UN MESSAGE est du contenu : son auteur l'a écrite exprès, pour un destinataire
 * qu'il a choisi. Une adresse dans un champ d'IDENTITÉ n'a été choisie par personne : elle vient
 * de la base, et elle sort vers toute l'audience. Ce n'est pas la même donnée, et la garde ne doit
 * pas les traiter pareil.
 *
 * ⚠️ LISTE DES CHAMPS DE CONTENU, PAS DES CHAMPS D'IDENTITÉ — et le sens de l'inversion est la
 * garde elle-même. Énumérer ce qu'on protège laisse passer la colonne ajoutée demain ; énumérer
 * ce qu'on EXEMPTE oblige à écrire une décision pour chaque exemption. Un champ inconnu est
 * protégé par défaut.
 */
const CONTENU = new Set(["body", "reply_text", "text", "message", "content", "caption"]);

function publier(valeur, ou = "") {
  if (typeof valeur === "string") {
    if (ADRESSE.test(valeur)) {
      throw Object.assign(
        new Error(`adresse refusée à la sortie publique : ${ou || "(racine)"}`),
        { statusCode: 500, champ: ou },
      );
    }
    return valeur;
  }
  if (Array.isArray(valeur)) { valeur.forEach((v, i) => publier(v, `${ou}[${i}]`)); return valeur; }
  if (valeur && typeof valeur === "object") {
    // ⚠️ Les CLÉS aussi : la carte des réactions portait les identités en clé chez d'autres hôtes,
    // et une garde qui ne regarde que les valeurs laisserait passer exactement ce cas.
    for (const [k, v] of Object.entries(valeur)) {
      publier(k, ou ? `${ou}.<clé>` : "<clé>");
      // Le champ que quelqu'un a rédigé traverse ; tout le reste est inspecté.
      if (CONTENU.has(k)) continue;
      publier(v, ou ? `${ou}.${k}` : k);
    }
    return valeur;
  }
  return valeur;
}

module.exports = { publier, ADRESSE, CONTENU };
