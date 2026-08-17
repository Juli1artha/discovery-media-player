// UN CACHE COURT SUR LE CHEMIN DE LECTURE PUBLIC.
//
// ⚠️ IL NE REMPLACE PAS UNE LIMITE, IL SUPPRIME CE QU'ELLE GARDAIT. `state=1` et `chat=1` lisent une
// ligne identique pour tous les spectateurs d'une même présentation à un instant donné. Les relire
// une fois par spectateur n'apporte rien ; les relire une fois par FENÊTRE fait s'effondrer
// n'importe quelle cadence — légitime ou hostile — à un accès base, quel que soit le nombre
// d'appelants. Il n'y a plus de ressource à saturer, donc plus de victime.
//
// L'idée vient du second hôte, qui a vu plus loin que notre quota : « la cadence de relecture est
// imposée par qui diffuse, donc tout quota par appelant est une arme retournée ».
//
// ⚠️ TROIS PIÈGES, ET ILS SONT TOUS DANS CE FICHIER.
//
// 1. LA RAFALE FROIDE. Vingt-cinq spectateurs qui arrivent ensemble sur une clé absente
//    produiraient vingt-cinq lectures si l'on ne mémorisait que le RÉSULTAT. On mémorise donc la
//    PROMESSE : le premier déclenche, les autres attendent la même. C'est exactement le cas que le
//    cache existe pour couvrir — le rater le viderait de son sens dans la seule situation qui
//    compte.
//
// 2. LA CLÉ VIENT DE L'APPELANT. Le slug est dans l'URL : n'importe qui peut en demander un million
//    de différents. Une table sans borne deviendrait une fuite mémoire commandée depuis l'extérieur.
//    On plafonne, et on évince le plus ancien.
//
// 3. UN ÉCHEC NE SE MÉMORISE PAS. Servir une erreur pendant toute la fenêtre transformerait un
//    hoquet en panne visible, et retarderait le rétablissement. On oublie la promesse rompue.
//
// ⚠️ CE QUE CE CACHE NE FAIT PAS : il vit dans la mémoire du PROCESSUS. En serverless, plusieurs
// instances servent en parallèle et démarrent à froid — l'effondrement est donc « une lecture par
// fenêtre ET PAR INSTANCE », pas « une lecture ». C'est la même limite que celle d'un compteur de
// débit en mémoire, et elle est écrite ici plutôt que découverte plus tard. Elle reste un
// effondrement de plusieurs ordres de grandeur.

/**
 * Un cache à durée de vie courte, avec regroupement des demandes concurrentes.
 *
 * @param {{ ttlMs: number, max?: number, now?: () => number }} options
 */
function creerCache(options) {
  const ttl = Math.max(0, Number(options && options.ttlMs) || 0);
  const max = Math.max(1, Number(options && options.max) || 500);
  const now = (options && options.now) || (() => Date.now());
  /** @type {Map<string, { echeance: number, promesse: Promise<unknown> }>} */
  const entrees = new Map();

  return {
    /**
     * Rend la valeur en cache si elle est fraîche, sinon la produit — une seule fois pour tous les
     * appelants concurrents.
     */
    async lire(cle, produire) {
      const k = String(cle);
      const t = now();
      const vue = entrees.get(k);
      if (vue && vue.echeance > t) return vue.promesse;

      const promesse = Promise.resolve().then(produire);
      entrees.set(k, { echeance: t + ttl, promesse });

      // ⚠️ On oublie une promesse ROMPUE, jamais une promesse tenue : sinon un hoquet de base
      // resterait servi pendant toute la fenêtre, et le rétablissement attendrait pour rien.
      promesse.catch(() => {
        const courante = entrees.get(k);
        if (courante && courante.promesse === promesse) entrees.delete(k);
      });

      // Éviction : la plus ancienne d'abord (Map conserve l'ordre d'insertion). La clé venant de
      // l'appelant, une table sans borne serait une fuite mémoire commandée depuis l'extérieur.
      if (entrees.size > max) {
        for (const vieille of entrees.keys()) {
          entrees.delete(vieille);
          if (entrees.size <= max) break;
        }
      }
      return promesse;
    },

    /** Pour les tests et l'exploitation : ce que la table contient réellement. */
    taille: () => entrees.size,
  };
}

module.exports = { creerCache };
