// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// Géométrie de la visionneuse : zoom, largeur de page, pagination, progression.
//
// Ce sont des calculs, pas du dessin — mais ils vivaient au milieu du DOM, mêlés à des
// `getBoundingClientRect()` et des `classList`, donc invérifiables. Chacune de ces règles a un
// motif précis, et certaines réparent un bug constaté : le décalage d'une page entre ce que
// montre le présentateur et ce que voit l'audience venait du choix de la bande de détection.
//
// Ici on ne mesure rien : les mesures sont fournies par l'appelant, qui seul connaît le DOM.

/** Bornes du zoom manuel. Au-delà, pdf.js rend des pages inutilisables (trop lourdes ou illisibles). */
export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 3;

/** Proportion de repli d'une page quand le document n'a pas encore été mesuré (~A4 portrait). */
export const DEFAULT_ASPECT = 1.35;

/** Largeur minimale d'une page : en dessous, le texte n'est plus lisible sur téléphone. */
export const MIN_PAGE_WIDTH = 280;

/**
 * Réglages des deux observateurs de défilement. Ils ont des rôles DIFFÉRENTS, et les confondre
 * était le bug :
 *  - `PRERENDER` déclenche le rendu un peu avant que la page arrive (marge large) → défilement fluide ;
 *  - `CURRENT_PAGE` détermine la page RÉELLEMENT regardée, via une bande fine au centre du cadre.
 * Utiliser la marge de pré-rendu pour la page courante faisait considérer comme « courante » une
 * page encore à 500 px sous le pli — d'où une audience en retard d'une page sur le présentateur.
 */
export const PRERENDER_MARGIN = "500px 0px";
export const CURRENT_PAGE_MARGIN = "-48% 0px -48% 0px";

/** Zoom borné et arrondi au dixième — sans arrondi, les clics successifs dérivent (0.7999…). */
export function clampZoom(zoom: number): number {
  const rounded = Math.round((Number(zoom) || 0) * 10) / 10;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rounded));
}

/** Numéro de page ramené dans les bornes du document. Tolère `undefined`, `0`, une chaîne. */
export function clampPage(page: unknown, pageCount: number): number {
  const total = pageCount || 1;
  return Math.max(1, Math.min(total, Number(page) || 1));
}

/** Progression de lecture, en pourcentage entier. Sans document mesuré : 0. */
export function progressPercent(page: number, pageCount: number): number {
  if (!pageCount) return 0;
  return Math.round((clampPage(page, pageCount) / pageCount) * 100);
}

/** État des flèches du mode « une seule page ». */
export function arrowState(page: number, pageCount: number): { prevDisabled: boolean; nextDisabled: boolean } {
  return {
    prevDisabled: page <= 1,
    nextDisabled: !!pageCount && page >= pageCount,
  };
}

export interface FitInput {
  /** Largeur utile du cadre de défilement, hors marges. */
  containerWidth: number;
  /** Hauteur utile du cadre. Ignorée hors du mode « une seule page ». */
  containerHeight?: number;
  zoom?: number;
  /** Mode « une seule page » : la page doit tenir ENTIÈREMENT dans le cadre visible. */
  onePage?: boolean;
  /** Proportion hauteur/largeur de la première page. */
  aspect?: number;
  /** Hauteur occultée par un panneau qui recouvre le bas du document (feuille mobile). */
  overlap?: number;
  /** Hauteur réservée à un bandeau (mode barre, lecteur guidé…). */
  reserve?: number;
}

/** Respiration conservée sous et au-dessus de la page en mode « une seule page ». */
const BREATHING = 28;

/**
 * Largeur à donner à une page.
 *
 * En défilement vertical, c'est simplement la largeur du cadre fois le zoom. En mode « une seule
 * page », la page doit tenir dans la HAUTEUR disponible : on la borne donc par ce que la hauteur
 * autorise, une fois retirés le panneau qui la recouvre et le bandeau réservé. Sans cette borne,
 * la page débordait sous la feuille de conversation et le lecteur ne voyait plus le bas.
 */
export function fitWidth(input: FitInput): number {
  const zoom = input.zoom ?? 1;
  const width = Math.max(MIN_PAGE_WIDTH, input.containerWidth || 900) * zoom;
  if (!input.onePage) return width;

  const aspect = input.aspect || DEFAULT_ASPECT;
  const available = (input.containerHeight || 600) - BREATHING - (input.overlap || 0) - (input.reserve || 0);
  const maxByHeight = available / aspect;
  // Sous ce seuil la contrainte de hauteur produirait une page minuscule (panneau presque
  // plein écran) : on préfère une page trop haute qu'un timbre-poste illisible.
  return maxByHeight > 120 ? Math.min(width, maxByHeight) : width;
}

/** Couleur moyenne d'une bande de pixels RGBA — sert à prolonger la page dans le fond de l'écran. */
export function averageColor(pixels: ArrayLike<number>): string {
  const count = pixels.length / 4;
  if (!count) return "rgb(0,0,0)";
  let r = 0, g = 0, b = 0;
  for (let i = 0; i < pixels.length; i += 4) { r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; }
  return `rgb(${Math.round(r / count)},${Math.round(g / count)},${Math.round(b / count)})`;
}

/** Le nom du fichier fait foi : le type MIME n'est pas toujours renvoyé par le stockage. */
export function isImageDocument(fileName?: string | null, fileUrl?: string | null): boolean {
  return /[.](png|jpe?g|webp|gif|avif)($|[?])/i.test(String(fileName || fileUrl || ""));
}

