// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CONTRAT DE CONTENU d'une présentation en direct : ce que le présentateur diffuse quand il quitte
// le document pour une carte ou une vue Street View.
//
// Ce contrat traverse trois frontières — le navigateur du présentateur le produit, le serveur le
// valide et le persiste, le navigateur de chaque spectateur l'applique. Il vivait en deux
// exemplaires (une production côté client, un `sanitizeContent` côté serveur sans aucun test) :
// toute divergence se traduisait par une audience qui ne voit pas ce que montre le présentateur,
// sans erreur nulle part.
//
// Ce module est le seul exemplaire. Il est bâti pour les deux côtés : sans DOM, sans Node, sans
// dépendance — il part dans le bundle navigateur ET dans un module CommonJS pour les fonctions
// serverless (cf. player/build/bundle.mjs).

export type MapType = "roadmap" | "satellite" | "hybrid";

/** Ordre de rotation du bouton de fond de carte. */
export const MAP_TYPES: MapType[] = ["roadmap", "satellite", "hybrid"];

/** Centre de repli : la France entière, quand on ne sait pas encore où regarder. */
export const DEFAULT_CENTER: [number, number] = [46.6, 2.5];
export const DEFAULT_ZOOM = 6;

export interface MapContent {
  kind: "map";
  center: [number, number];
  zoom: number;
  marker: [number, number] | null;
  mapType: MapType | null;
  label: string | null;
}

export interface StreetViewContent {
  kind: "streetview";
  position: [number, number];
  pov: { heading: number; pitch: number };
  zoom: number;
}

export type PresentationContent = MapContent | StreetViewContent;

/**
 * Conversion numérique tolérante.
 * ⚠️ Comportement HISTORIQUE conservé : `+null`, `+""` et `+[]` valent 0 et sont finis, donc ces
 * valeurs donnent 0 et non `null`. Le durcir ferait diverger le client du serveur — la seule
 * chose que ce module existe pour empêcher. À changer un jour, des deux côtés à la fois.
 */
function num(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pair(value: unknown): [number, number] | null {
  if (!Array.isArray(value)) return null;
  const a = num(value[0]);
  const b = num(value[1]);
  return a != null && b != null ? [a, b] : null;
}

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/**
 * Valide un contenu reçu de l'extérieur. Refus par défaut : ce qui n'est pas reconnu vaut `null`,
 * c'est-à-dire « on présente le document » — le repli sûr, jamais un écran vide.
 */
export function sanitizeContent(input: unknown): PresentationContent | null {
  if (!input || typeof input !== "object") return null;
  const c = input as Record<string, unknown>;

  // `pdf` et l'absence de genre signifient tous deux « retour au document ».
  if (c.kind === "pdf" || c.kind == null) return null;

  if (c.kind === "streetview") {
    const position = pair(c.position);
    if (!position) return null; // une vue Street View sans position n'a aucun sens
    const rawPov = c.pov && typeof c.pov === "object" ? (c.pov as Record<string, unknown>) : null;
    const pov = rawPov
      ? { heading: num(rawPov.heading) || 0, pitch: clamp(num(rawPov.pitch) || 0, -90, 90) }
      : { heading: 0, pitch: 0 };
    return { kind: "streetview", position, pov, zoom: clamp(num(c.zoom) || 1, 0, 5) };
  }

  if (c.kind !== "map") return null;
  return {
    kind: "map",
    center: pair(c.center) || [...DEFAULT_CENTER] as [number, number],
    zoom: clamp(Math.trunc(num(c.zoom) || DEFAULT_ZOOM), 1, 21),
    marker: pair(c.marker),
    mapType: MAP_TYPES.includes(c.mapType as MapType) ? (c.mapType as MapType) : null,
    label: String(c.label || "").slice(0, 160) || null,
  };
}

/** Fond de carte suivant dans la rotation du bouton. */
export function cycleMapType(current: string | null | undefined): MapType {
  const index = MAP_TYPES.indexOf(current as MapType);
  return MAP_TYPES[(index + 1) % MAP_TYPES.length];
}

/** Libellé du bouton : il annonce ce vers quoi on va, pas ce qu'on regarde. */
export function mapTypeLabel(current: string | null | undefined): string {
  if (current === "roadmap") return "🛰 Satellite";
  if (current === "satellite") return "🗺 Hybride";
  return "🗺 Plan";
}

/** Contenu de départ quand le présentateur bascule sur une carte. */
export function initialMapContent(): MapContent {
  return { kind: "map", center: [...DEFAULT_CENTER] as [number, number], zoom: DEFAULT_ZOOM, marker: null, mapType: null, label: null };
}
