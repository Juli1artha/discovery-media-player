// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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

/**
 * Intervalle PLANCHER entre deux écritures de session, côté navigateur.
 *
 * ⚠️ C'EST LA CADENCE LA PLUS RAPIDE, ET C'EST ELLE QUI DIMENSIONNE LE QUOTA. Deux réductions de
 * charge s'appuient dessus (P1 « réduction de charge ») :
 *   1. la cadence est passée de 12 s à 30 s — 2,5× moins d'écritures même pour un lecteur qui lit
 *      sans discontinuer ;
 *   2. le traceur n'émet plus au tick QUE si la mesure a changé depuis le dernier envoi (drapeau
 *      « dirty », cf. `tracking.ts`) : un onglet caché, un lecteur inactif, un document laissé
 *      ouvert n'écrivent plus une session à l'identique toutes les 30 s.
 * Le worst-case reste UN envoi par intervalle plancher pour un lecteur pleinement actif — c'est ce
 * que le quota ci-dessous couvre. Le drapeau dirty ne fait que descendre EN DESSOUS de ce plafond ;
 * il ne le déplace pas, donc il n'entre pas dans le calcul du quota (sûr par construction).
 */
export const SESSION_INTERVAL_MS = 30_000;

/** Ce qu'un seul lecteur émet AU PIRE en une heure (cadence plancher), par construction. */
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

/** Le quota horaire des SESSIONS (upsert riche), déduit — jamais écrit à la main. */
export const SESSION_QUOTA_PER_HOUR = SESSION_WRITES_PER_HOUR * READERS_PER_EGRESS;

// ── Les événements analytiques LÉGERS : open / page / heartbeat ────────────────────────────────────
//
// ⚠️ P1b (audit CODEX 5.6). Le chemin externe gardait open, page ET session dans le MÊME seau, dont
// le quota ne comptait que les sessions : 25 lecteurs derrière une IP le dépassaient par leurs
// open/page avant même leurs sessions, et la mesure était abandonnée en silence. On sépare : la
// session (un `upsert`) garde `SESSION_QUOTA_PER_HOUR` ; open/page/heartbeat (un `logView`, bien
// meilleur marché) ont leur propre seau.
//
// Le budget par lecteur suit la même échelle que celui d'une présentation VIVANTE — une action
// toutes les 5 s pendant une heure (PRESENTER_ACTIONS_PER_HOUR = 720). C'est très au-dessus d'un
// lecteur réel (open une fois, une page par page NOUVELLE atteinte), donc généreux, et c'est
// assumé : logView est bon marché, le seau ne sert qu'à borner une inondation, pas à arbitrer un
// usage. Un événement `page` ne compte QUE la première atteinte d'une page ; le rejeu, lui, tombe
// sous ce plafond.
export const VIEW_EVENTS_PER_READER_HOUR = 720;

/** Le quota horaire des vues légères, par adresse, déduit — jamais écrit à la main. */
export const VIEW_QUOTA_PER_HOUR = VIEW_EVENTS_PER_READER_HOUR * READERS_PER_EGRESS;

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
// Le quota est déduit plus bas, une fois la marge déclarée — cf. PRESENT_QUOTA_MARGIN.

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

// ── Le cache court : supprimer le problème plutôt que le borner ──────────────────────────────────
//
// ⚠️ UN QUOTA SUR LE CHEMIN DE LECTURE EST UNE ARME RETOURNÉE, PAR CONSTRUCTION. Le second hôte l'a
// formulé mieux que nous : la cadence de relecture est imposée par QUI DIFFUSE, donc tout quota par
// appelant y punit la victime. Le budget client de 0.1.45 fait baisser le rythme ; il déplace le
// seuil, il ne retire pas l'arme.
//
// Or `state=1` lit UNE SEULE LIGNE, identique pour tous les spectateurs d'une même présentation à un
// instant donné. Une réponse mise en cache par slug fait s'effondrer n'importe quelle cadence —
// légitime ou hostile — à un accès base par fenêtre. Ce n'est plus une limite : il n'y a plus de
// ressource à saturer, donc plus de victime.
//
// ⚠️ ET LA FENÊTRE SE DÉDUIT, ELLE NE SE CHOISIT PAS. Le second hôte proposait une seconde, en
// citant notre doctrine de 0.1.19 : « une diffusion est un signal, pas une vérité ». Cette doctrine
// porte sur l'AUTORITÉ, pas sur la latence — et depuis qu'on a vidé les charges de diffusion,
// précisément à cause d'elle, la relecture n'est plus un filet : c'est le SEUL chemin par lequel le
// numéro de page arrive. Une seconde de cache retarderait donc CHAQUE page tournée d'autant, pour
// toute l'audience.
//
// La bonne fenêtre est celle qu'on accepte déjà : l'ordonnanceur de relecture regroupe les signaux,
// et un spectateur attend donc déjà jusqu'à ce délai. Un cache de la même durée effondre autant sans
// coûter une milliseconde de plus. Le jour où une diffusion reportera de nouveau une charge, la
// fenêtre pourra s'allonger — tant que la relecture porte l'état, elle ne doit pas.

/** La fenêtre de regroupement de l'ordonnanceur de relecture, côté audience. */
export const PRESENT_READ_COALESCE_MS = 400;

/**
 * La durée de vie du cache de lecture, côté serveur.
 *
 * ⚠️ Elle est ÉGALE à la fenêtre de regroupement, et ce n'est pas une coïncidence à maintenir à la
 * main : au-delà, on ajoute au spectateur une attente qu'il n'a pas déjà consentie ; en deçà, on
 * paie des accès base que personne ne perçoit. Les deux nombres sont un seul contrat.
 */
export const PRESENT_CACHE_MS = PRESENT_READ_COALESCE_MS;

/**
 * La marge du quota de lecture, une fois le cache en place.
 *
 * ⚠️ CE QUE LE QUOTA GARDE A CHANGÉ, DONC SON CHIFFRE DOIT CHANGER. Il protégeait la base : il
 * devait donc coller au plus près de l'usage légitime, et c'est ce qui en faisait une arme — une
 * salle pleine sous martèlement atteignait exactement le plafond, et tombait en 429.
 *
 * Le cache retire ce coût. Il reste le coût d'INVOCATION — sur serverless, les invocations sont
 * elles-mêmes mesurées et saturables — donc le garde-fou ne disparaît pas : il remonte. Son seul
 * rôle désormais est de borner une inondation brute, jamais d'arbitrer une cadence légitime.
 *
 * Couper une vraie audience coûte plus cher que de servir quelques milliers de réponses déjà en
 * mémoire : la marge est donc large, et assumée comme telle.
 */
export const PRESENT_QUOTA_MARGIN = 4;

export const PRESENT_QUOTA_PER_HOUR = (PRESENT_READS_PER_HOUR + PRESENT_READ_BURST) * READERS_PER_EGRESS * PRESENT_QUOTA_MARGIN;
