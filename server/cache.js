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
  // ⚠️ DEUX PLAFONDS, ET LE SECOND EST CELUI QUI COMPTE. Un plafond en NOMBRE d'entrées ne borne rien
  // quand la taille d'une entrée est choisie par l'appelant : 500 réponses de chat à 600 Ko font
  // ~286 Mo, et la clé porte un curseur (`chatAfter`) que le visiteur fait varier à volonté — chaque
  // valeur crée une entrée. On borne donc aussi le POIDS, et le poids est MESURÉ, pas estimé : les
  // valeurs mises en cache ici sont des chaînes JSON. (Relevé par un audit externe.)
  const max = Math.max(1, Number(options && options.max) || 100);
  const maxOctets = Math.max(1, Number(options && options.maxOctets) || 8 * 1024 * 1024);
  const now = (options && options.now) || (() => Date.now());
  /** @type {Map<string, { echeance: number, promesse: Promise<unknown>, poids: number, enVol: boolean }>} */
  const entrees = new Map();
  let poidsTotal = 0;

  const oublier = (k) => {
    const e = entrees.get(k);
    if (!e) return;
    poidsTotal -= e.poids;
    entrees.delete(k);
  };

  // ⚠️ ON N'ÉVINCE JAMAIS UNE PROMESSE EN VOL. L'éviction sert à borner la mémoire des RÉSULTATS ;
  // retirer une demande en cours ne libère rien (elle est déjà lancée) et casse le regroupement : les
  // appelants suivants relanceraient la même production, ce que ce cache existe pour éviter.
  const borner = () => {
    for (const [k, e] of entrees) {
      if (entrees.size <= max && poidsTotal <= maxOctets) break;
      if (!e.enVol) oublier(k);
    }
  };

  const purger = (t) => {
    for (const [k, e] of entrees) if (!e.enVol && e.echeance <= t) oublier(k);
  };

  return {
    /**
     * Rend la valeur en cache si elle est fraîche, sinon la produit — une seule fois pour tous les
     * appelants concurrents.
     */
    async lire(cle, produire) {
      const k = String(cle);
      const t = now();
      // ⚠️ PURGE À CHAQUE ACCÈS. Sans elle, une entrée périmée restait en mémoire jusqu'à ce qu'une
      // AUTRE la pousse dehors : le cache gardait indéfiniment ce qu'il ne servait plus.
      purger(t);
      const vue = entrees.get(k);
      // Une entrée en vol se partage toujours : c'est tout l'objet du regroupement.
      if (vue && (vue.enVol || vue.echeance > t)) return vue.promesse;

      const promesse = Promise.resolve().then(produire);
      // ⚠️ L'ÉCHÉANCE PART DE LA RÉSOLUTION, PAS DE LA DEMANDE. Posée à la demande, elle expirait
      // AVANT que la production ne réponde dès que celle-ci dépassait le TTL — et le regroupement ne
      // servait alors plus à rien pour exactement les producteurs lents, les seuls qu'il valait la
      // peine de mutualiser. Tant qu'elle est en vol, l'entrée ne périme pas.
      entrees.set(k, { echeance: 0, promesse, poids: 0, enVol: true });

      promesse.then(
        (valeur) => {
          const courante = entrees.get(k);
          if (!courante || courante.promesse !== promesse) return;
          courante.enVol = false;
          courante.echeance = now() + ttl;
          // Le poids réel : ces valeurs sont des chaînes JSON. Une valeur d'une autre forme compte
          // pour un poids nominal — mieux vaut sous-estimer que prétendre mesurer ce qu'on ignore.
          courante.poids = typeof valeur === "string" ? valeur.length : 1;
          poidsTotal += courante.poids;
          borner();
        },
        () => {
          // ⚠️ On oublie une promesse ROMPUE, jamais une promesse tenue : sinon un hoquet de base
          // resterait servi pendant toute la fenêtre, et le rétablissement attendrait pour rien.
          const courante = entrees.get(k);
          if (courante && courante.promesse === promesse) oublier(k);
        },
      );
      return promesse;
    },

    /** Pour les tests et l'exploitation : ce que la table contient réellement. */
    taille: () => entrees.size,
    /** Poids cumulé des résultats retenus, en caractères. */
    poids: () => poidsTotal,
  };
}

module.exports = { creerCache };
