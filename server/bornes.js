// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES RÉGLAGES DU RELAIS, BORNÉS À UN SEUL ENDROIT — parce qu'un nombre fini n'est pas un délai.
//
// ⚠️ `setTimeout` PLAFONNE À 2 147 483 647 ms ET RAMÈNE TOUT DÉPASSEMENT À 1 ms. Un délai de
// progression configuré à 2 147 483 648 ms — « environ 24,8 jours » — abandonnait le transfert en
// 6 ms, avec 65 `TimeoutOverflowWarning` pour le dire (reproduit par un audit externe, cinquième
// passe, 13/09). La première borne acceptait « tout nombre fini positif » : une décimale, l'infini
// sous la forme d'un très grand entier, tout passait jusqu'à Node. On n'accepte donc qu'un ENTIER
// SÛR dans une plage écrite, bien sous la limite native, et une valeur hors plage retombe sur le
// défaut EN LE DISANT — une fois, à l'initialisation, pas à chaque relais.
//
// Le même module sert le cœur (`handler.init`) et le contexte autonome : une seule décision.

/** Relais simultanés par processus. 1 024 est une borne de configuration, pas une recommandation :
 *  64 relais × 8 Mio avec des clients lents ont fait monter la RSS de 63 à 193–257 Mio (mesuré par
 *  un audit externe) — sur un processus à 256 Mio, 16 à 32 est le bon ordre de grandeur. */
const RELAIS_SIMULTANES_DEFAUT = 64, RELAIS_SIMULTANES_MIN = 1, RELAIS_SIMULTANES_MAX = 1024;
/** Délais du relais, en millisecondes entières : de 1 ms à 24 h. Vingt-quatre heures est une borne
 *  applicative, très en dessous des 2 147 483 647 ms que `setTimeout` sait tenir. */
const RELAIS_STALL_MS_DEFAUT = 30_000, RELAIS_MAX_MS_DEFAUT = 900_000;
const RELAIS_MS_MIN = 1, RELAIS_MS_MAX = 86_400_000;

/**
 * Un entier sûr dans [min, max], sinon le défaut. `undefined` et `null` sont « non posé » : le
 * défaut s'applique sans être un défaut de configuration ; tout le reste hors plage l'est.
 * @returns {{ valeur: number, valide: boolean, posee: boolean }}
 */
function entierBorne(v, { defaut, min, max }) {
  if (v === undefined || v === null || v === "") return { valeur: defaut, valide: true, posee: false };
  // Un nombre, ou une chaîne (l'environnement n'en connaît pas d'autre) — jamais un booléen, que
  // `Number(true)` transformerait en un délai de 1 ms parfaitement « valide ».
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v.trim()) : NaN;
  const valide = Number.isSafeInteger(n) && n >= min && n <= max;
  return { valeur: valide ? n : defaut, valide, posee: true };
}

/**
 * Les trois réglages du relais, lus dans `config`, bornés, avec la liste de ce qui a été refusé —
 * pour que l'appelant le dise une fois, avec la plage, plutôt que d'appliquer un défaut en silence.
 * @returns {{ plafond: number, stallMs: number, maxMs: number, invalides: string[] }}
 */
function bornesRelais(config) {
  const c = config || {};
  const plafond = entierBorne(c.maxConcurrentRelays, { defaut: RELAIS_SIMULTANES_DEFAUT, min: RELAIS_SIMULTANES_MIN, max: RELAIS_SIMULTANES_MAX });
  const stall = entierBorne(c.relayStallMs, { defaut: RELAIS_STALL_MS_DEFAUT, min: RELAIS_MS_MIN, max: RELAIS_MS_MAX });
  const total = entierBorne(c.relayMaxMs, { defaut: RELAIS_MAX_MS_DEFAUT, min: RELAIS_MS_MIN, max: RELAIS_MS_MAX });
  const invalides = [];
  if (!plafond.valide) invalides.push(`maxConcurrentRelays=${String(c.maxConcurrentRelays)} (entier de ${RELAIS_SIMULTANES_MIN} à ${RELAIS_SIMULTANES_MAX}, défaut ${RELAIS_SIMULTANES_DEFAUT})`);
  if (!stall.valide) invalides.push(`relayStallMs=${String(c.relayStallMs)} (entier de ${RELAIS_MS_MIN} à ${RELAIS_MS_MAX} ms, défaut ${RELAIS_STALL_MS_DEFAUT})`);
  if (!total.valide) invalides.push(`relayMaxMs=${String(c.relayMaxMs)} (entier de ${RELAIS_MS_MIN} à ${RELAIS_MS_MAX} ms, défaut ${RELAIS_MAX_MS_DEFAUT})`);
  return { plafond: plafond.valeur, stallMs: stall.valeur, maxMs: total.valeur, invalides };
}

module.exports = {
  entierBorne, bornesRelais,
  RELAIS_SIMULTANES_DEFAUT, RELAIS_SIMULTANES_MIN, RELAIS_SIMULTANES_MAX,
  RELAIS_STALL_MS_DEFAUT, RELAIS_MAX_MS_DEFAUT, RELAIS_MS_MIN, RELAIS_MS_MAX,
};
