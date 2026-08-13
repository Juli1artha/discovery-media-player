// LE CÂBLAGE — le seul fichier que vous écrivez.
//
// Tout ce que le player emprunte à votre application arrive par ici, et rien d'autre. C'est aussi
// la raison pour laquelle ce fichier vous appartient : il ne contient que des décisions qui sont
// les vôtres — votre base, vos droits, votre marque. Un câblage généré devrait les deviner, et
// vous n'auriez plus d'endroit où les changer.
//
// Le plus court chemin : partir du contexte autonome et ne remplacer que ce qui vous est propre.
// La version complète (avec greffons, journalisation, envoi d'email) tient en ~200 lignes ;
// celle-ci en fait ~60 et fonctionne.

const { createStandaloneContext } = require("discovery-media-player/context/standalone");

const base = createStandaloneContext(process.env);

module.exports = {
  ...base,

  identity: {
    ...base.identity,

    /**
     * Qui, chez vous, a le droit de diffuser un document ?
     *
     * ⚠️ **C'est votre règle, pas celle du player.** Il vérifie qu'un jeton est valide ; savoir
     * quels membres peuvent envoyer, révoquer ou consulter les statistiques relève de votre modèle
     * de droits. Sans réponse : refus. Un droit qu'on ne sait pas accorder ne s'accorde pas.
     *
     * ⚠️ **L'action est transmise** (`create`, `list`, `revoke`, `setauth`, `overview`,
     * `sessions`, `test`). Un booléen unique pour les sept confond deux choses différentes :
     * envoyer un document à SON prospect est un acte commercial ordinaire ; révoquer le lien d'un
     * autre ou lire l'aperçu global est un acte d'administration. Si votre modèle ne fait pas la
     * distinction, ignorez le paramètre — c'est parfaitement valide.
     */
    async canManageShares(user, action) {
      if (!user || !user.email) return false;
      const role = String((user.app_metadata || {}).role || "").toLowerCase();
      if (role === "admin") return true;
      // Un commercial envoie et suit SES documents ; il n'administre pas ceux des autres.
      const administration = ["revoke", "overview", "setauth"];
      return role === "sales" && !administration.includes(String(action));
    },
  },

  branding: {
    ...base.branding,

    /**
     * La marque du client dont on montre le document, résolue à L'AFFICHAGE.
     *
     * ⚠️ Le lien porte une RÉFÉRENCE, jamais une copie du logo. Un lien tracé vit des semaines
     * dans une boîte mail : un logo figé au moment de l'envoi ne suivrait pas une charte corrigée.
     * Résolue ici, la correction se propage à tout ce qui est déjà parti.
     *
     * ⚠️ `name` n'est pas décoratif : c'est ce qui s'affiche quand le logo ne charge PAS. C'est le
     * champ que tout le monde oublie, et le seul qui serve quand le reste échoue.
     *
     * `null` (client inconnu, supprimé) ⇒ marque de l'instance. Ce n'est pas une erreur.
     */
    async forKey(key) {
      const client = await maBaseClients.get(String(key)); // ← votre source de vérité
      return client && client.logo
        ? { logo: client.logo, name: client.nom || "", dark: !!client.fondSombre }
        : null;
    },
  },
};

// Remplacez par votre propre accès — ORM, requête SQL, appel interne. Le player ne sait pas ce
// qu'est un client : il passe une clé, il reçoit une marque.
const maBaseClients = {
  async get(_key) {
    return null;
  },
};
