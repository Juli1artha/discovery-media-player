// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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
// 4. ⚠️ LE PLAFOND DES RÉSULTATS NE BORNE PAS LES DEMANDES EN VOL — et c'est par là que ça cédait.
//    Le piège 2 était traité pour les valeurs RETENUES, mais une entrée en vol n'est jamais évincée
//    (piège 1 : l'évincer casserait le regroupement). Tant que la base ne répond pas, RIEN ne
//    bornait donc l'admission : 10 000 clés distinctes pendantes donnaient 10 000 entrées ET 10 000
//    producteurs — donc 10 000 requêtes, sockets et promesses ouvertes, avec `max: 100`. Mesuré, pas
//    supposé. Il faut un plafond SÉPARÉ sur les demandes en vol, et un REFUS quand il est atteint :
//    borner l'admission est la seule chose qui borne une base lente. (Relevé par un audit externe.)
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
/**
 * ⚠️ UNE ERREUR TYPÉE, PAS UN `null` NI UN THROW ANONYME. La route doit pouvoir distinguer « la base
 * a échoué » (500) de « nous refusons d'admettre une demande de plus » (503, réessayable) : ce sont
 * deux situations opposées pour l'appelant, et les confondre lui ferait abandonner une requête qui
 * n'attendait qu'une seconde.
 */
const CODE_SATURATION = "cache-sature";
function erreurSaturation(plafond) {
  const e = new Error(`cache saturé : ${plafond} demandes déjà en vol`);
  e.code = CODE_SATURATION;
  e.statusCode = 503;
  e.retryAfter = 1;
  return e;
}

function creerCache(options) {
  const ttl = Math.max(0, Number(options && options.ttlMs) || 0);
  // ⚠️ DEUX PLAFONDS, ET LE SECOND EST CELUI QUI COMPTE. Un plafond en NOMBRE d'entrées ne borne rien
  // quand la taille d'une entrée est choisie par l'appelant : 500 réponses de chat à 600 Ko font
  // ~286 Mo, et la clé porte un curseur (`chatAfter`) que le visiteur fait varier à volonté — chaque
  // valeur crée une entrée. On borne donc aussi le POIDS, et le poids est MESURÉ, pas estimé : les
  // valeurs mises en cache ici sont des chaînes JSON. (Relevé par un audit externe.)
  const max = Math.max(1, Number(options && options.max) || 100);
  const maxOctets = Math.max(1, Number(options && options.maxOctets) || 8 * 1024 * 1024);
  // ⚠️ LE TROISIÈME PLAFOND, ET C'EST LUI QUI TIENT SOUS UNE BASE LENTE. Les deux autres ne bornent
  // que ce qui est RÉSOLU ; celui-ci borne ce qui est ADMIS. Une valeur volontairement basse devant
  // `max` : une entrée en vol coûte une requête, une socket et une promesse, bien plus cher qu'un
  // résultat en mémoire.
  const maxEnVol = Math.max(1, Number(options && options.maxEnVol) || 128);
  const now = (options && options.now) || (() => Date.now());
  // ⚠️ CE QUI EST REFUSÉ NE LAISSAIT AUCUNE TRACE. Le plafond d'admission existe depuis longtemps
  // et il rend un 503 propre — mais rien ne comptait combien de fois il avait servi. La question
  // « sature-t-on, en vrai ? » n'avait donc AUCUNE réponse observable, et c'est précisément celle
  // dont dépend la décision d'optimiser ou non le chemin chaud. Optimiser sans elle, c'est deviner.
  let nSatures = 0;
  let dernierSature = null;
  /** @type {Map<string, { echeance: number, promesse: Promise<unknown>, poids: number, enVol: boolean, rendrePlace?: () => void }>} */
  const entrees = new Map();
  let poidsTotal = 0;
  let nEnVol = 0;      // tenu à jour à chaque transition — compter la Map à la demande serait O(n)

  const oublier = (k) => {
    const e = entrees.get(k);
    if (!e) return;
    poidsTotal -= e.poids;
    // Une entrée en vol qu'on retire (promesse rompue) libère sa place d'admission — sans quoi le
    // plafond se remplirait définitivement au premier incident de base. Le rendu passe par le verrou
    // de la promesse : c'est lui qui garantit qu'une place n'est rendue qu'une fois.
    if (e.enVol && typeof e.rendrePlace === "function") e.rendrePlace();
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
      // ⚠️ UNE CLÉ DÉJÀ EN VOL SE PARTAGE TOUJOURS, MÊME AU PLAFOND. C'est l'ordre de ces deux tests
      // qui décide : refuser d'abord ferait échouer des appelants que le regroupement pouvait servir
      // gratuitement — la saturation punirait alors la rafale légitime, exactement ce que ce cache
      // existe pour absorber. On ne refuse que ce qui coûterait une requête DE PLUS.
      if (vue && (vue.enVol || vue.echeance > t)) return vue.promesse;

      if (nEnVol >= maxEnVol) {
        nSatures += 1;
        dernierSature = t;
        throw erreurSaturation(maxEnVol);
      }

      const promesse = Promise.resolve().then(produire);
      // ⚠️ UN DÉCOMPTE IDEMPOTENT PAR PROMESSE. Deux chemins libèrent la place (résolution, et
      // `oublier` sur rejet) : sans ce verrou, une place pouvait être rendue DEUX fois, `nEnVol`
      // passait sous zéro et le plafond cessait silencieusement de refuser — un plafond qui ne peut
      // plus être atteint ne se distingue pas d'un plafond absent.
      let placeRendue = false;
      const rendrePlace = () => { if (!placeRendue) { placeRendue = true; nEnVol -= 1; } };
      nEnVol += 1;
      // ⚠️ L'ÉCHÉANCE PART DE LA RÉSOLUTION, PAS DE LA DEMANDE. Posée à la demande, elle expirait
      // AVANT que la production ne réponde dès que celle-ci dépassait le TTL — et le regroupement ne
      // servait alors plus à rien pour exactement les producteurs lents, les seuls qu'il valait la
      // peine de mutualiser. Tant qu'elle est en vol, l'entrée ne périme pas.
      entrees.set(k, { echeance: 0, promesse, poids: 0, enVol: true, rendrePlace });

      promesse.then(
        (valeur) => {
          const courante = entrees.get(k);
          rendrePlace();
          if (!courante || courante.promesse !== promesse) return;
          courante.enVol = false;
          courante.echeance = now() + ttl;
          // ⚠️ DES OCTETS, PAS DES CARACTÈRES. `.length` compte des unités UTF-16 : « 界 » y vaut 1
          // et pèse 3 octets en mémoire comme sur le fil. Un contenu non latin sous-estimait donc le
          // poids d'un facteur 3 — un plafond « 8 Mo » en laissait passer 24. La valeur d'une autre
          // forme compte pour un poids nominal : mieux vaut sous-estimer que prétendre mesurer ce
          // qu'on ignore. (Relevé par un audit externe.)
          courante.poids = typeof valeur === "string" ? Buffer.byteLength(valeur, "utf8") : 1;
          poidsTotal += courante.poids;
          borner();
        },
        () => {
          // ⚠️ On oublie une promesse ROMPUE, jamais une promesse tenue : sinon un hoquet de base
          // resterait servi pendant toute la fenêtre, et le rétablissement attendrait pour rien.
          const courante = entrees.get(k);
          if (courante && courante.promesse === promesse) oublier(k);
          rendrePlace();   // idempotent : `oublier` a pu le faire, ou l'entrée avoir été remplacée
        },
      );
      return promesse;
    },

    /** Pour les tests et l'exploitation : ce que la table contient réellement. */
    taille: () => entrees.size,
    /** Poids cumulé des résultats retenus, en OCTETS UTF-8. */
    poids: () => poidsTotal,
    /** Demandes actuellement en vol — ce que le plafond d'admission borne. */
    enVol: () => nEnVol,
    /**
     * Ce que le plafond a refusé depuis le démarrage de ce processus.
     *
     * ⚠️ UN TOTAL SEUL MENT PAR OMISSION, et c'est pour ça que `dernier` l'accompagne. « 0 refus »
     * ne veut pas dire « on ne sature pas » : ça peut vouloir dire « ce processus vient de
     * démarrer ». La même règle que `presenceFusion` dans la carte — un rapport d'exécution n'est
     * pas un inventaire, et une absence d'observation n'est pas une preuve. Celui qui LIT reste
     * responsable de savoir depuis quand ce processus regarde ; la carte, elle, le lui dit.
     */
    satures: () => ({ total: nSatures, dernier: dernierSature }),
  };
}

module.exports = { creerCache, CODE_SATURATION };
