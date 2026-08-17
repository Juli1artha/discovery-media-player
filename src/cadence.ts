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

/**
 * Au bout de combien de temps sans le moindre signe cesse-t-on de compter ?
 *
 * ⚠️ Ici aussi, une seule déclaration : le traceur l'applique, les tests s'y réfèrent, et personne
 * ne réécrit « 60 » ou « 180 » ailleurs. Les tests qui épinglaient la valeur sont tombés le jour où
 * elle a changé — alors que la propriété qu'ils décrivaient n'avait pas bougé.
 *
 * Le raisonnement derrière le chiffre vit dans `tracking.ts`, à côté de l'option.
 */
export const SESSION_IDLE_MS = 180_000;

// ── Le canal public : ce qu'une audience relit, et ce qu'un robot peut en faire ──────────────────
//
// ⚠️ DOUZE ACTIONS D'ÉCRITURE ÉTAIENT LIMITÉES, LES DEUX LECTURES NE L'ÉTAIENT PAS. `state=1` et
// `chat=1` sont servis sans session, sur un lien public, et chaque appel coûte une interrogation de
// base. Une boucle sur une URL connue transformait donc un lien de présentation en amplificateur :
// une requête HTTP triviale contre une requête base, autant de fois qu'on veut.
//
// ⚠️ Et c'est la ressource PARTAGÉE qui paie, pas l'appelant : la base est la même pour tous les
// documents de l'instance. Le coût d'un abus ne retombe pas sur celui qui le commet.
//
// Signalé par un audit externe (C-5), dernier constat critique de sa liste.

/** Le filet de resynchronisation de l'audience : il relit l'état ET le chat. */
export const PRESENT_RESYNC_MS = 25_000;

/** Ce que le filet consomme à lui seul, pour un spectateur, sur chacun des deux points. */
export const RESYNC_READS_PER_HOUR = Math.ceil(3_600_000 / PRESENT_RESYNC_MS);

/**
 * Ce que le pilotage du présentateur provoque en plus, par heure.
 *
 * ⚠️ Ce n'est PAS le plafond mécanique. L'ordonnanceur de relecture regroupe à 400 ms : un
 * spectateur pourrait en théorie relire 9 000 fois par heure si le présentateur agissait sans
 * relâche. Dimensionner là-dessus reviendrait à ne rien limiter du tout — un plafond qu'aucun usage
 * réel n'atteint ne protège de rien, c'est la borne qu'on s'est déjà donnée pour les sessions.
 *
 * On dimensionne donc sur une présentation VIVANTE : une action du présentateur toutes les cinq
 * secondes, pendant une heure entière. Au-delà, on n'est plus dans une présentation.
 */
export const PRESENTER_ACTIONS_PER_HOUR = 720;

/** Ce qu'un spectateur légitime relit en une heure, par construction. */
export const PRESENT_READS_PER_HOUR = RESYNC_READS_PER_HOUR + PRESENTER_ACTIONS_PER_HOUR;

// ── Ce qu'un spectateur peut relire, quoi qu'on lui demande ──────────────────────────────────────
//
// ⚠️ LA LIMITE DE 0.1.42 A CRÉÉ UN DÉNI DE SERVICE SUR L'AUDIENCE, ET C'EST NOUS QUI L'AVONS OUVERT.
//
// Le quota ci-dessous est par ADRESSE, et il est calibré sur ce qu'un usage légitime consomme. Mais
// la cadence de relecture n'est pas choisie par le spectateur : elle est choisie par QUI DIFFUSE. Un
// participant hostile qui émet à haute fréquence fait relire chaque spectateur jusqu'à ~9 000 fois
// par heure — l'ordonnanceur regroupe à 400 ms, c'est le plafond mécanique. Trois spectateurs
// derrière la sortie internet d'un bureau dépassent alors le quota, prennent des 429, et LEURS PAGES
// CESSENT DE TOURNER.
//
// Avant la limite, un tel participant coûtait cher. Après, il pouvait faire taire. C'est la leçon de
// `X-Forwarded-For` retournée : la limite ne repose pas sur ce que l'appelant choisit — mais elle
// était PAYÉE par quelqu'un qui ne choisit pas non plus.
//
// ⚠️ ON BORNE DONC LA CAUSE, PAS L'EFFET. Baisser le quota punirait davantage la victime. Le
// spectateur se donne son propre budget : quoi qu'on lui demande, il ne relit jamais plus que ce que
// les actions d'un présentateur justifient. Le correctif propre reste le canal privé — celui-ci
// ferme la porte en attendant, sans rien attendre du serveur.
//
// Le budget couvre la part SIGNALÉE. Le filet périodique s'y ajoute et n'est jamais rationné : c'est
// le plancher qui garantit qu'une audience finit toujours par se resynchroniser, budget épuisé ou
// non. Signalé + filet = exactement la part d'un spectateur.
export const PRESENT_SIGNAL_BUDGET_PER_HOUR = PRESENTER_ACTIONS_PER_HOUR;

/**
 * La rafale autorisée d'emblée.
 *
 * ⚠️ Sans elle, le budget serait juste et l'usage insupportable : une page tournée doit s'afficher
 * TOUT DE SUITE, pas au rythme moyen. On autorise donc une salve courte — un enchaînement rapide de
 * quelques pages, ce qu'un présentateur fait réellement — puis on retombe sur le rythme soutenu.
 *
 * Une rafale qui vaudrait le plafond mécanique ne bornerait rien ; une rafale d'une seule relecture
 * rendrait la présentation poussive. Le test fixe cette relation, pas ce nombre.
 */
export const PRESENT_READ_BURST = 20;

/**
 * Le quota horaire par adresse, déduit — jamais écrit à la main.
 *
 * ⚠️ Même clé et même raison que pour les sessions : l'adresse identifie un bâtiment, pas un
 * spectateur, et c'est la seule chose que l'appelant ne choisit pas. Une salle de réunion qui suit
 * une présentation à vingt-cinq derrière une sortie unique est le cas ordinaire.
 *
 * ⚠️ LA RAFALE EN FAIT PARTIE, ET C'EST UN TEST QUI L'A DIT. La première version multipliait la
 * seule part soutenue : une salle pleine dépassait alors le quota de 475 relectures — exactement la
 * rafale de chacun. Le serveur doit couvrir ce que le client S'AUTORISE, pas ce qu'il consomme en
 * moyenne, sinon la garde refuse un usage que le produit permet.
 */
export const PRESENT_QUOTA_PER_HOUR = (PRESENT_READS_PER_HOUR + PRESENT_READ_BURST) * READERS_PER_EGRESS;

// ── Le délai au bout duquel on rend la main ──────────────────────────────────────────────────────
//
// ⚠️ CE RISQUE EST NÉ D'UN CORRECTIF. Avant 0.1.41, l'ordonnanceur d'écritures appelait `fini()`
// immédiatement : les écritures partaient dans le désordre, mais rien ne pouvait se bloquer. En les
// rendant séquentielles — `presentContent()` rend sa promesse, l'ordonnanceur l'attend — on a
// échangé un défaut de correction contre un risque de DISPONIBILITÉ : une requête qui reste
// suspendue ne règle jamais sa promesse, `fini()` n'est jamais appelé, et plus aucune écriture ne
// part. Le présentateur pilote alors dans le vide, en silence.
//
// Un navigateur ne garantit aucun délai : une requête peut rester en vol indéfiniment sur un réseau
// qui bascule. C'est donc à l'appelant de rendre la main.
//
// ⚠️ CE QUE LE DÉLAI RESTAURE, ET CE QU'IL NE RESTAURE PAS. Il rend la VIVACITÉ : la file repart. Il
// ne rend pas l'ORDRE — une requête abandonnée peut très bien être arrivée au serveur, et atterrir
// après celle qui l'a remplacée. Garantir l'ordre malgré un abandon demande un numéro de version
// porté par l'écriture ; c'est le chantier de la file unique, pas celui-ci. Mieux vaut le dire que
// laisser croire que ce délai règle les deux.
export const PRESENT_WRITE_TIMEOUT_MS = 10_000;
