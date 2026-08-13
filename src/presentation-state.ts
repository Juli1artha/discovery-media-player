// Ce que l'audience fait d'un état de présentation reçu.
//
// Cette décision n'existait qu'à un seul endroit : le gestionnaire d'un `postgres_changes`. Elle
// doit maintenant servir TROIS sources — la table (existant), une diffusion `broadcast` par le
// présentateur, et une relecture d'état à la (re)connexion — parce qu'on veut se passer de la
// lecture anonyme des tables, qui rend aujourd'hui toutes les présentations énumérables.
//
// Une même règle, trois portes d'entrée : elle vit ici, testée, plutôt que recopiée trois fois.
//
// ⚠️ L'ORDRE EST UNE RÈGLE, pas un hasard :
//   1. une présentation terminée l'emporte sur tout ;
//   2. une carte ou une vue Street View SUSPEND le suivi du document — le présentateur montre
//      autre chose, l'audience ne doit pas revenir au PDF ni suivre ses pages ;
//   3. un changement de document précède un changement de page (la page 3 de l'ancien document
//      n'est pas la page 3 du nouveau) ;
//   4. la page en dernier.

import { sanitizeContent, type PresentationContent } from "./presentation-content";

/** L'état d'une présentation, tel qu'il arrive — de la table, d'une diffusion, ou d'une relecture. */
export interface PresentationRow {
  active?: boolean | null;
  content?: unknown;
  file_url?: string | null;
  file_name?: string | null;
  doc_title?: string | null;
  current_page?: number | null;
  updated_at?: string | null;
}

/** Ce que l'audience regarde en ce moment. */
export interface AudienceView {
  docUrl?: string | null;
}

export type PresentationAction =
  | { kind: "ended" }
  | { kind: "show-map"; content: PresentationContent }
  | { kind: "leave-map" }
  | { kind: "switch-doc"; url: string; name?: string; title?: string; updatedAt?: string }
  | { kind: "show-page"; page: number }
  | { kind: "nothing" };

/**
 * Décide ce que l'audience doit faire d'un état reçu.
 *
 * ⚠️ Le contenu est **re-validé ici**. Sur la voie `postgres_changes` il venait de notre base,
 * donc déjà assaini ; sur la voie `broadcast` il vient du NAVIGATEUR du présentateur. Faire
 * confiance à un message diffusé par un client reviendrait à laisser n'importe quel participant
 * imposer une vue à toute l'audience.
 */
export function presentationTransition(
  row: PresentationRow | null | undefined,
  view: AudienceView = {},
): PresentationAction[] {
  if (!row) return [{ kind: "nothing" }];

  // Une présentation terminée l'emporte : plus rien d'autre n'a de sens.
  if (row.active === false) return [{ kind: "ended" }];

  const content = sanitizeContent(row.content);
  if (content) return [{ kind: "show-map", content }];

  const actions: PresentationAction[] = [{ kind: "leave-map" }];

  // Changement de document AVANT changement de page : la page 3 de l'ancien document n'est pas
  // la page 3 du nouveau.
  if (row.file_url && row.file_url !== view.docUrl) {
    actions.push({
      kind: "switch-doc",
      url: row.file_url,
      name: row.file_name || undefined,
      title: row.doc_title || undefined,
      updatedAt: row.updated_at || undefined,
    });
    return actions;
  }

  if (row.current_page) actions.push({ kind: "show-page", page: row.current_page });
  return actions;
}

/**
 * URL de rechargement d'un document changé en cours de présentation.
 *
 * ⚠️ **Le cache-buster n'est pas décoratif.** L'audience recharge le PDF par la même URL de proxy
 * (`?present=<slug>&file=1`) ; sans un paramètre qui change, pdf.js ressert son cache et l'audience
 * continue de voir l'ANCIEN document pendant que le présentateur commente le nouveau.
 */
export function switchDocUrl(base: string, updatedAt?: string): string {
  const jeton = encodeURIComponent(updatedAt || String(Date.now()));
  return `${base}${base.includes("?") ? "&" : "?"}v=${jeton}`;
}
