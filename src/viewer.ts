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
  /** Proportion hauteur/largeur de la première page, AVANT rotation du lecteur. */
  aspect?: number;
  /**
   * Rotation demandée par le lecteur, en degrés. La proportion est tournée avec elle : sans ça, une
   * page mise en paysage serait ajustée comme si elle était restée en portrait, et déborderait du
   * cadre exactement dans le mode où elle doit y tenir entière.
   */
  rotation?: number;
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

  const aspect = aspectApresRotation(input.aspect, input.rotation);
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


// ── Lot 0 du chantier « trois gestes » : l'arithmétique, ici, pas dans le gabarit ──────────────
//
// ⚠️ CE QUI SUIT NE DESSINE RIEN ET NE MESURE RIEN, comme le reste de ce module. Le zoom au geste,
// la rotation et les vignettes ont tous besoin de calculs que le littéral de gabarit de
// `server/page-visionneuse.js` ne peut pas éprouver — un banc ne s'y exécute pas. Les écrire ici
// les rend testables sans navigateur, et c'est la seule raison pour laquelle ce module existe.

/** Rotations que la visionneuse sait poser. Tout le reste s'y ramène par arrondi au quart de tour. */
export const ROTATIONS = [0, 90, 180, 270] as const;

const nombreFini = (v: unknown, defaut = 0): number =>
  typeof v === "number" && Number.isFinite(v) ? v : defaut;

/**
 * Rotation À PASSER à pdf.js, composée de celle du fichier et de celle demandée par le lecteur.
 *
 * ⚠️ ET C'EST UNE COMPOSITION, PAS UN REMPLACEMENT — LE PIÈGE EST DANS LA DOCUMENTATION DE PDF.JS.
 * `getViewport({rotation})` dit : « si omise, elle vaut la rotation de la page ». Donner une valeur
 * ABSOLUE écrase donc celle que porte le fichier. Or les documents numérisés en paysage portent très
 * couramment `/Rotate 90` : un « remettre à zéro » qui passerait 0 ne redresserait pas un document
 * de travers, il COUCHERAIT un document qui était droit. La rotation du fichier est le point de
 * départ, jamais une valeur à écraser.
 *
 * L'arrondi au quart de tour est délibéré : la spécification PDF impose un multiple de 90, des
 * fichiers réels ne la respectent pas, et un viewport oblique casserait la couche de texte.
 */
export function rotationEffective(intrinseque: unknown, demandee: unknown): number {
  const quarts = Math.round((nombreFini(intrinseque) + nombreFini(demandee)) / 90);
  return (((quarts % 4) + 4) % 4) * 90;
}

/**
 * Proportion hauteur/largeur d'une page une fois tournée.
 *
 * ⚠️ CE CALCUL GOUVERNE LE SUIVI DE LECTURE, PAS SEULEMENT L'AFFICHAGE. La proportion fixe la
 * hauteur des gabarits posés AVANT rendu ; ces gabarits fixent la longueur du document ; cette
 * longueur décide de la page que l'observateur d'intersection appelle « courante » — et c'est cette
 * page-là que le suivi enregistre. Une proportion non tournée à 90° fausse donc les statistiques
 * d'un partage, en silence et sans rien casser à l'écran.
 */
export function aspectApresRotation(aspect: unknown, rotation: unknown): number {
  const a = nombreFini(aspect, 0) > 0 ? (aspect as number) : DEFAULT_ASPECT;
  const r = rotationEffective(0, rotation);
  return r === 90 || r === 270 ? 1 / a : a;
}

export interface AncrageInput {
  /** Position de défilement AVANT le changement de zoom, en pixels. */
  defilement: { x: number; y: number };
  /** Point à garder immobile, en coordonnées du CADRE (curseur ou milieu des deux doigts). */
  point: { x: number; y: number };
  /** Taille visible du cadre de défilement. */
  cadre: { largeur: number; hauteur: number };
  /** Taille TOTALE du contenu avant le changement, marges comprises. */
  contenu: { largeur: number; hauteur: number };
  /**
   * Part du contenu qui NE GRANDIT PAS avec le zoom : marges du conteneur, espaces entre les pages.
   * ⚠️ Sans elle, le contenu est cru proportionnel au zoom alors qu'un document de cent pages porte
   * plus de mille cinq cents pixels d'espacements fixes — l'ancrage dérive d'autant vers le bas.
   */
  fixe?: { largeur: number; hauteur: number };
  zoomAvant: number;
  zoomApres: number;
}

/**
 * Sur un axe : où faut-il défiler pour que le point visé ne bouge pas ?
 *
 * ⚠️ LA MARGE DE CENTRAGE EST LA MOITIÉ DU PROBLÈME. Le conteneur des pages est centré
 * (`align-items:center`, `min-width:100%`) : tant que le document est plus étroit que le cadre, il
 * flotte au milieu et le défilement vaut zéro. Une formule qui ignore ce décalage ancre correctement
 * un document zoomé et fait sauter un document dézoomé — c'est-à-dire exactement au moment où le
 * lecteur regarde la page entière.
 */
function ancrerUnAxe(
  defilement: number,
  point: number,
  cadre: number,
  contenu: number,
  fixe: number,
  k: number,
): number {
  const partFixe = Math.min(Math.max(0, fixe), Math.max(0, contenu));
  const contenuApres = partFixe + Math.max(0, contenu - partFixe) * k;
  // On étire la COORDONNÉE par le rapport des tailles totales, pas par le zoom : les espacements ne
  // grandissent pas, donc le document grandit moins vite que le zoom, et un point situé au bas d'un
  // long document se retrouverait sinon bien plus bas qu'il ne doit.
  const rapport = contenu > 0 ? contenuApres / contenu : 1;
  const margeAvant = Math.max(0, (cadre - contenu) / 2);
  const coordonnee = point + defilement - margeAvant;
  const cible = coordonnee * rapport - point;
  // ⚠️ IL N'Y A PAS DE MARGE DE CENTRAGE « APRÈS », ET C'EST UNE DÉMONSTRATION, PAS UN OUBLI. La
  // symétrie appelle un `margeApres` ici ; il serait MORT. Cette marge n'est non nulle que si le
  // contenu reste plus étroit que le cadre — et dans ce cas la butée haute vaut zéro, donc la sortie
  // vaut zéro quoi qu'on ajoute. Les deux conditions s'excluent. Écrit d'abord avec, la mutation qui
  // le retirait a SURVÉCU au banc : c'est ce qui a mis le code mort en évidence, puis un balayage de
  // 195 840 combinaisons a confirmé zéro cas observable. Ne le rajoutez pas « pour la symétrie » :
  // il donnerait à lire un traitement qui n'a jamais lieu.
  return Math.min(Math.max(0, cible), Math.max(0, contenuApres - cadre));
}

/**
 * Position de défilement à poser APRÈS un changement de zoom pour que le point visé reste sous le
 * curseur ou entre les doigts.
 *
 * ⚠️ SANS ELLE, LE ZOOM ACTUEL DÉRIVE DÉJÀ — le pas de 0,2 des boutons le rend seulement supportable.
 * Au pincement, la dérive devient le défaut principal : l'œil suit le point qu'il vise, et le voir
 * fuir donne l'impression que la visionneuse résiste.
 */
export function ancrageApresZoom(input: AncrageInput): { x: number; y: number } {
  const avant = nombreFini(input.zoomAvant, 0);
  const apres = nombreFini(input.zoomApres, 0);
  const defilement = {
    x: nombreFini(input.defilement && input.defilement.x),
    y: nombreFini(input.defilement && input.defilement.y),
  };
  // Un zoom de départ nul ou absurde ne donne aucun rapport exploitable : on ne bouge rien plutôt
  // que de projeter le lecteur à une position inventée.
  if (avant <= 0 || apres <= 0) return defilement;

  const k = apres / avant;
  const fixe = input.fixe || { largeur: 0, hauteur: 0 };
  return {
    x: ancrerUnAxe(
      defilement.x,
      nombreFini(input.point && input.point.x),
      nombreFini(input.cadre && input.cadre.largeur),
      nombreFini(input.contenu && input.contenu.largeur),
      nombreFini(fixe.largeur),
      k,
    ),
    y: ancrerUnAxe(
      defilement.y,
      nombreFini(input.point && input.point.y),
      nombreFini(input.cadre && input.cadre.hauteur),
      nombreFini(input.contenu && input.contenu.hauteur),
      nombreFini(fixe.hauteur),
      k,
    ),
  };
}
