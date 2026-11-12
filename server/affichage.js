// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE MODE D'AFFICHAGE D'UNE SESSION (#617, migration 0029) — ce que la visionneuse envoie, et ce qu'on en garde.
//
// Le relevé L0 (#593) a mesuré la lecture d'avant le gabarit « lecture » ; pour savoir si L1 à L6 ont changé quelque
// chose, chaque session doit dire comment elle était affichée. Un objet venu du NAVIGATEUR, donc du dehors : on ne
// garde que des clés connues, des valeurs d'une liste fermée, des compteurs entiers bornés. Rien de libre, rien de
// personnel — on compte qu'on a cherché, jamais ce qu'on a cherché.

/** Les gestes comptés. Une clé inconnue est ignorée, jamais écrite. */
const GESTES = ["clavier", "fleches", "vignettes", "zoom", "rotation", "ajustement", "recherche", "resultats", "sommaire"];
const MAX_COMPTEUR = 9999;
const VALEURS = {
  gabarit: ["lecture", "ancien"],
  ajustement: ["page", "largeur"],
  format: ["paysage", "portrait"],
};

/** Un compteur : entier entre 0 et 9 999, ou rien. */
function compteur(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.min(MAX_COMPTEUR, Math.trunc(n));
}

/**
 * L'`affichage` d'une session, borné ; `null` s'il n'en reste rien d'utile (absent, forgé, vide).
 * @param {unknown} brut
 * @returns {null | { gabarit?: string, ajustement?: string, format?: string, une_page?: boolean, gestes?: Record<string, number> }}
 */
function bornerAffichage(brut) {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return null;
  const sortie = Object.create(null);
  for (const cle of Object.keys(VALEURS)) {
    const v = brut[cle];
    if (typeof v === "string" && VALEURS[cle].includes(v)) sortie[cle] = v;
  }
  if (typeof brut.une_page === "boolean") sortie.une_page = brut.une_page;
  const g = brut.gestes;
  if (g && typeof g === "object" && !Array.isArray(g)) {
    const gestes = Object.create(null);
    for (const nom of GESTES) {
      // `hasOwnProperty` : un compteur hérité (`__proto__`, `constructor`) n'est pas un geste.
      if (!Object.prototype.hasOwnProperty.call(g, nom)) continue;
      const n = compteur(g[nom]);
      if (n !== null) gestes[nom] = n;
    }
    if (Object.keys(gestes).length) sortie.gestes = gestes;
  }
  // Sans gabarit, la session ne dit pas l'essentiel : on ne garde pas une moitié de mesure.
  return sortie.gabarit ? sortie : null;
}

module.exports = { bornerAffichage, GESTES, MAX_COMPTEUR };
