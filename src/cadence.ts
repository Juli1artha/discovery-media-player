// LA CADENCE DU SUIVI, ET LE QUOTA QUI DOIT LA SUPPORTER.
//
// ⚠️ CES DEUX CONSTANTES SONT UN SEUL CONTRAT, ET ELLES ONT DIVERGÉ EN SILENCE.
//
// Le navigateur écrivait une session interne toutes les 12 s — 300 par heure pour UN lecteur — et
// le serveur en autorisait 120 par heure et par IP. La limite ne tenait donc pas 0,4 lecteur : elle
// était sous ce qu'une seule personne consomme en lisant normalement. Après 24 minutes de lecture
// continue, tout était refusé.
//
// ⚠️ Et le refus était MUET. Le 429 n'apparaît que dans la console du lecteur ; le journal horaire
// ne parlait que du champ manquant, pas du quota. Un exploitant voyait donc une table qui ne se
// remplit pas, sans cause nommée — exactement le symptôme qu'on venait de corriger ailleurs.
//
// La garde était juste dans sa forme et fausse dans son chiffre, et c'est pour ça que personne ne
// l'a relue : on relit ce qui a l'air douteux, pas ce qui a l'air raisonnable.
//
// Elles vivent donc ici, dans le module PARTAGÉ, dont l'en-tête généré dit déjà pourquoi : « deux
// implémentations d'un même contrat finissent toujours par diverger en silence ». Le quota se
// CALCULE depuis la cadence : changer l'une déplace l'autre, sans qu'on ait à y penser.
//
// Trouvé par le second hôte, sur son instance, en cherchant pourquoi sa table restait vide.

/** Intervalle entre deux écritures de session, côté navigateur. */
export const SESSION_INTERVAL_MS = 12_000;

/** Ce qu'un seul lecteur émet en une heure, par construction. */
export const SESSION_WRITES_PER_HOUR = Math.ceil(3_600_000 / SESSION_INTERVAL_MS);

/**
 * Lecteurs internes simultanés qu'une même sortie internet doit pouvoir porter.
 *
 * ⚠️ La clé du quota est l'ADRESSE, et une adresse n'identifie pas une lecture — elle identifie un
 * bâtiment. Une équipe derrière une sortie unique, c'est le cas ORDINAIRE d'une entreprise, pas le
 * cas limite. Dimensionner pour un seul lecteur revient à refuser le second.
 *
 * ⚠️ POURQUOI PAS LA SESSION COMME CLÉ, qui semblerait plus juste : l'identifiant de session est
 * choisi par le navigateur. Un quota fondé dessus se contourne en le changeant — c'est exactement
 * la leçon de `X-Forwarded-For` en 0.1.22, où la limite existait et ne limitait rien. Une limite ne
 * peut porter que sur ce que l'appelant NE CHOISIT PAS. L'adresse reste donc la clé ; c'est le
 * chiffre qui était faux, pas la clé.
 */
export const READERS_PER_EGRESS = 25;

/** Le quota horaire, déduit — jamais écrit à la main. */
export const SESSION_QUOTA_PER_HOUR = SESSION_WRITES_PER_HOUR * READERS_PER_EGRESS;
