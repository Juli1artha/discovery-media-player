// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUE CETTE INSTANCE A VÉCU — MESURÉ, BORNÉ, ET HONNÊTE SUR CE QU'IL NE DIT PAS.
//
// ⚠️ IL N'Y AVAIT QU'UN SEUL CHIFFRE, ET IL NE RÉPONDAIT QU'À UNE SEULE QUESTION. `lectureSaturee`
// (0.1.139) compte les refus du plafond d'admission — utile, et strictement insuffisant : « la
// route est-elle lente ? », « lesquelles ? », « la base ou nous ? », « combien de 5xx ? », « la
// boucle d'événements décroche-t-elle ? » n'avaient AUCUNE réponse observable. Décider d'optimiser
// sans elles, c'est deviner ; l'audit CODEX du 26/08 le dit, et les deux hôtes intégrateurs ont
// confirmé qu'ils ne pouvaient pas produire la mesure depuis chez eux.
//
// ⚠️ DES SEAUX, PAS DES ÉCHANTILLONS. Garder les durées pour calculer un vrai centile demanderait
// une table qui grandit avec le trafic — c'est-à-dire une fuite mémoire commandée par l'appelant,
// le piège que `server/cache.js` documente déjà. L'échelle de seaux est FIXE : la mémoire de ce
// module est bornée par construction, quel que soit le nombre d'appels.
//
// ⚠️ ET UN CENTILE SUR SEAUX EST UNE BORNE, PAS UNE VALEUR. `p95: 250` se lit « 95 % des appels
// sous 250 ms », jamais « le 95e vaut 250 ms ». Le champ s'appelle donc `sousMs`, pour qu'aucun
// lecteur n'ait à deviner. Prétendre une précision qu'on n'a pas serait pire que le seau.
//
// ⚠️ PROCESSUS-LOCAL, ET REMIS À ZÉRO À CHAQUE DÉPLOIEMENT. Comme `lectureSaturee` et les champs de
// présence : une instance qui répond n'est pas toutes les instances. Agréger est le travail de
// l'hôte. `fenetreS` accompagne donc TOUT total — « 0 erreur » peut vouloir dire « ce processus a
// démarré il y a quatre secondes », et un total sans sa fenêtre ment par omission.

const { monitorEventLoopDelay } = require("node:perf_hooks");

// Échelle en millisecondes. Volontairement courte en bas (un appel sain se compte en dizaines de
// ms) et large en haut : au-delà de 10 s, savoir « c'est très long » suffit à agir.
const SEAUX_MS = [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
const RESOLUTION_BOUCLE_MS = 20;

/** Un histogramme à seaux fixes : `SEAUX_MS.length + 1` entiers, quel que soit le trafic. */
function creerHistogramme() {
  const seaux = new Array(SEAUX_MS.length + 1).fill(0);
  let n = 0, maxMs = 0;
  return {
    poser(ms) {
      n += 1;
      if (ms > maxMs) maxMs = ms;
      let i = 0;
      while (i < SEAUX_MS.length && ms > SEAUX_MS[i]) i += 1;
      seaux[i] += 1;
    },
    /**
     * Borne haute du seau où tombe le rang demandé. `null` quand rien n'a été mesuré : zéro
     * appel et « des appels tous instantanés » sont deux affirmations différentes.
     */
    sousMs(centile) {
      if (!n) return null;
      const rang = Math.ceil((centile / 100) * n);
      let cumul = 0;
      for (let i = 0; i < seaux.length; i += 1) {
        cumul += seaux[i];
        if (cumul >= rang) return i < SEAUX_MS.length ? SEAUX_MS[i] : null;   // null = au-delà de l'échelle
      }
      return null;
    },
    compte: () => n,
    max: () => Math.round(maxMs),
  };
}

/** Familles de routes — grossières EXPRÈS : une famille par nature de travail, pas par action. */
const FAMILLES = ["document", "presentation", "action", "fichier", "carte", "autre"];

const histos = new Map(FAMILLES.map((f) => [f, creerHistogramme()]));
const histoBase = creerHistogramme();
const statuts = { ok: 0, refus4xx: 0, debit429: 0, occupe503: 0, erreur5xx: 0 };

// ⚠️ ENCLENCHÉ À L'IMPORT, ET ÇA A ÉTÉ VÉRIFIÉ AVANT D'ÊTRE ÉCRIT. Un compteur qui retiendrait la
// boucle d'événements empêcherait le processus de sortir — donc casserait l'arrêt gracieux de
// `bin/serve.js`, mesuré en 0.1.139. Le banc à vrai processus (SIGTERM → code 0) est ce qui tient
// cette propriété : si cet histogramme retenait quoi que ce soit, il rougirait.
const boucle = monitorEventLoopDelay({ resolution: RESOLUTION_BOUCLE_MS });
boucle.enable();

const maintenant = () => Number(process.hrtime.bigint() / 1000n) / 1000;   // ms, monotone

/**
 * Chronomètre un appel. Rend la fonction de fin — appelée avec le statut réel de la réponse.
 * Ne jette jamais : une mesure qui casse une requête n'est plus une mesure, c'est une panne.
 */
function chrono(famille) {
  const debut = maintenant();
  let close = false;
  return function fin(statut) {
    if (close) return;                     // deux fins pour un appel fausseraient le compte
    close = true;
    try {
      const ms = Math.max(0, maintenant() - debut);
      (histos.get(famille) || histos.get("autre")).poser(ms);
      const s = Number(statut) || 0;
      if (s === 429) statuts.debit429 += 1;
      else if (s === 503) statuts.occupe503 += 1;
      else if (s >= 500) statuts.erreur5xx += 1;
      else if (s >= 400) statuts.refus4xx += 1;
      else if (s > 0) statuts.ok += 1;
    } catch { /* jamais bloquant */ }
  };
}

/**
 * Enveloppe la capacité `db` de l'hôte pour en mesurer la latence.
 *
 * ⚠️ AU SEAM, PAS DANS NOS APPELS. La base est fournie PAR L'HÔTE : mesurer à chaque site d'appel
 * demanderait de se souvenir à soixante-sept endroits, et le premier oubli passerait inaperçu.
 * Enveloppée ici, la mesure couvre tout ce qui passe par la capacité — y compris ce que personne
 * n'a encore écrit. La forme rendue est la MÊME (mêmes méthodes, mêmes valeurs, mêmes rejets) :
 * un décorateur qui change le contrat mesurerait autre chose que la production.
 */
function observerBase(db) {
  if (!db || typeof db.request !== "function" || db.__mesuree) return db;
  // ⚠️ ON DÉLÈGUE À L'OBJET VIVANT, ON NE PHOTOGRAPHIE PAS SES MÉTHODES. La première version
  // capturait `db.request` à l'enveloppement et appelait la fonction capturée : tout ce qui
  // remplaçait `db.request` APRÈS `init` cessait alors d'être appelé — en silence. Ce n'est pas un
  // cas d'école, c'est ce qui a rougi la forge : un banc pose sa sonde après `init`, et un hôte a
  // exactement le même droit (enveloppe de réessai, client câblé paresseusement, instrumentation).
  // Une mesure qui change ce qui s'exécute n'est plus une mesure.
  //
  // ⚠️ ET `Object.create(db)` PLUTÔT QU'UNE COPIE, POUR LA MÊME RAISON. Un `{ ...db }` fige AUSSI
  // les champs qui ne sont pas des méthodes (`configuree`…) à leur valeur du moment. L'héritage
  // laisse passer tout ce qu'on ne redéfinit pas, vivant.
  const mesurer = (nom) => async (...args) => {
    const debut = maintenant();
    try { return await db[nom](...args); }
    finally { try { histoBase.poser(Math.max(0, maintenant() - debut)); } catch { /* noop */ } }
  };
  const vu = Object.create(db);
  vu.__mesuree = true;
  vu.request = mesurer("request");
  if (typeof db.selectAll === "function") vu.selectAll = mesurer("selectAll");
  // ⚠️ CHAQUE MÉTHODE AJOUTÉE À LA CAPACITÉ DOIT ÊTRE AJOUTÉE ICI, et l'héritage rend cet oubli
  // SILENCIEUX : `Object.create` laisse passer une méthode nouvelle, vivante et non mesurée — donc
  // le paragraphe ci-dessus, qui promet de couvrir « y compris ce que personne n'a encore écrit »,
  // deviendrait faux sans que rien ne rougisse. `count` est optionnelle chez l'hôte ; quand elle
  // existe, elle interroge la base et son temps compte comme le reste.
  if (typeof db.count === "function") vu.count = mesurer("count");
  return vu;
}

const centiles = (h) => {
  const n = h.compte();
  if (!n) return { n: 0 };
  return { n, p50sousMs: h.sousMs(50), p95sousMs: h.sousMs(95), p99sousMs: h.sousMs(99), maxMs: h.max() };
};

const mio = (octets) => Math.round((octets / 1048576) * 10) / 10;

/**
 * Des nanosecondes rapportées par l'échantillonneur au RETARD réel, en millisecondes.
 *
 * ⚠️ LA RÉSOLUTION EST RETRANCHÉE. `monitorEventLoopDelay` observe la durée réelle de son propre
 * minuteur : au repos elle vaut la résolution, pas zéro. Sans cette soustraction, une instance
 * parfaitement oisive annoncerait 20 ms de retard en permanence et ferait chercher une panne qui
 * n'existe pas.
 *
 * ⚠️ ET C'EST UNE FONCTION NOMMÉE PARCE QUE SON BANC LE DEMANDAIT. Écrite dans le corps de
 * `relever`, elle n'était éprouvable qu'en MESURANT une boucle réelle — donc par un seuil de
 * grandeur (« au repos, moins de 10 ms »), qui dépend de la charge de la machine et a rougi deux
 * fois le 26/08 sur un conteneur occupé. Le seuil ne gardait pas la soustraction : il gardait le
 * calme de la machine. La propriété, elle, est arithmétique et se vérifie sans chronomètre.
 */
const retardMs = (ns) => Math.max(0, Math.round((ns / 1e6 - RESOLUTION_BOUCLE_MS) * 10) / 10);

/**
 * Le relevé, tel que la carte le publie.
 *
 * ⚠️ AUCUN SLUG, AUCUNE ADRESSE, AUCUN TEXTE. Ce sont des compteurs et des durées : rien ici ne
 * désigne un visiteur, un document ou une présentation. C'est ce qui permet de le publier sur une
 * carte qu'un hôte lit sans authentification particulière.
 */
function relever() {
  // nu : la garde de forme reconnaît cet accumulateur (`proprieteEcrite.test.js`)
  const routes = Object.create(null);
  for (const [nom, h] of histos) { const c = centiles(h); if (c.n) routes[nom] = c; }
  const m = process.memoryUsage();
  return {
    fenetreS: Math.round(process.uptime()),
    // ⚠️ L'ÉCHELLE EST PUBLIÉE AVEC LES CHIFFRES. Sans elle, `p95sousMs: 250` ne dit pas si la
    // mesure suivante aurait pu être 251 ou 999 — un lecteur ne peut pas juger de sa précision.
    seauxMs: SEAUX_MS,
    routes,
    base: centiles(histoBase),
    statuts: { ...statuts },
    memoireMio: { rss: mio(m.rss), heap: mio(m.heapUsed), tampons: mio(m.arrayBuffers || 0) },
    // ⚠️ LE RETARD, PAS L'INTERVALLE. `monitorEventLoopDelay` observe la durée réelle de son propre
    // minuteur : au repos elle vaut la résolution, pas zéro. On retranche donc la résolution — un
    // « retard de 20 ms » permanent sur une instance parfaitement oisive ferait chercher une panne
    // qui n'existe pas.
    //
    // ⚠️ ET « PAS ENCORE MESURÉ » N'EST PAS « ZÉRO ». Tant que l'histogramme n'a aucun échantillon,
    // sa moyenne est `NaN` — que `JSON.stringify` rendrait en `null` par accident. On rend `null`
    // DÉLIBÉRÉMENT, avec `n`, plutôt que de publier un zéro qui se lirait « la boucle est saine ».
    boucleMs: (() => {
      const n = boucle.count || 0;
      return n
        ? { n, moyen: retardMs(boucle.mean), p99: retardMs(boucle.percentile(99)), resolutionMs: RESOLUTION_BOUCLE_MS }
        : { n: 0, moyen: null, p99: null, resolutionMs: RESOLUTION_BOUCLE_MS };
    })(),
  };
}

/** Pour les bancs : repartir d'une instance vierge sans recharger le module. */
function vider() {
  for (const nom of FAMILLES) histos.set(nom, creerHistogramme());
  // Écrits un par un, pour la même raison que les deux enveloppes de `observerBase` : une clé
  // calculée sur un objet ordinaire est la forme que `proprieteEcrite.test.js` refuse.
  statuts.ok = 0; statuts.refus4xx = 0; statuts.debit429 = 0; statuts.occupe503 = 0; statuts.erreur5xx = 0;
}

module.exports = { chrono, observerBase, relever, vider, FAMILLES, SEAUX_MS, __histoBase: histoBase, __retardMs: retardMs };
