// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// Ce que l'audience fait d'un état de présentation reçu.
//
// Cette décision n'existait qu'à un seul endroit : le gestionnaire du canal temps réel de
// l'époque, qui lisait la table. Elle sert aujourd'hui DEUX sources — le signal `broadcast` du
// présentateur (charge vide, jamais un contenu) et la relecture d'état HTTP à la (re)connexion —
// la lecture anonyme des tables, qui rendait toutes les présentations énumérables, a été retirée.
// (Ce paragraphe a décrit l'ancien monde au présent pendant plusieurs versions — cinquième audit.)
//
// Une même règle, trois portes d'entrée : elle vit ici, testée, plutôt que recopiée trois fois.
//
// ⚠️ L'ORDRE EST UNE RÈGLE, pas un hasard :
//   1. une présentation terminée l'emporte sur tout ;
//   2. une carte ou une vue Street View SUSPEND le suivi du document — le présentateur montre
//      autre chose, l'audience ne doit pas revenir au PDF ni suivre ses pages ;
//   3. la ROTATION avant tout ce qui concerne le document : elle change la géométrie, et l'appliquer
//      après un changement de page ferait payer DEUX reconstructions au lieu d'une ;
//   4. un changement de document précède un changement de page (la page 3 de l'ancien document
//      n'est pas la page 3 du nouveau) ;
//   5. la page en dernier.

import { sanitizeContent, type PresentationContent } from "./presentation-content";
import { rotationEffective } from "./viewer";

/** L'état d'une présentation, tel qu'il arrive — de la table, d'une diffusion, ou d'une relecture. */
export interface PresentationRow {
  active?: boolean | null;
  content?: unknown;
  file_url?: string | null;
  file_name?: string | null;
  doc_title?: string | null;
  current_page?: number | null;
  /**
   * Rotation posée par le présentateur, en degrés.
   *
   * ⚠️ ELLE ARRIVE PAR UNE VOIE NON FIABLE, et c'est pourquoi elle est normalisée ici plutôt que
   * chez l'appelant. Sur le canal `broadcast`, cet état vient du NAVIGATEUR du présentateur : une
   * valeur absurde — 37, `NaN`, une chaîne — poserait un viewport oblique qui casse la couche de
   * texte de toute l'audience. `rotationEffective` la ramène au quart de tour, comme le contenu est
   * ré-assaini deux lignes plus bas.
   */
  view_rotation?: number | null;
  updated_at?: string | null;
}

/** Ce que l'audience regarde en ce moment. */
export interface AudienceView {
  docUrl?: string | null;
  /** Rotation actuellement appliquée par l'audience — sert à ne rien faire quand rien n'a changé. */
  rotation?: number | null;
}

export type PresentationAction =
  | { kind: "ended" }
  | { kind: "show-map"; content: PresentationContent }
  | { kind: "leave-map" }
  | { kind: "switch-doc"; url: string; name?: string; title?: string; updatedAt?: string }
  | { kind: "rotate"; rotation: number }
  | { kind: "show-page"; page: number }
  | { kind: "nothing" };

/**
 * Décide ce que l'audience doit faire d'un état reçu.
 *
 * ⚠️ Le contenu est **re-validé ici**. Relu par la route HTTP il vient de notre base,
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

  // ⚠️ LA ROTATION AVANT LE DOCUMENT ET LA PAGE. Elle change la proportion des pages, donc la
  // hauteur des gabarits, donc la géométrie entière : l'appliquer après un changement de page
  // ferait reconstruire deux fois, et la première reconstruction viserait une page dont la position
  // est sur le point de bouger.
  //
  // ⚠️ ET ON N'ÉMET RIEN QUAND RIEN N'A CHANGÉ. La relecture HTTP à la reconnexion rejoue tout
  // l'état : sans cette comparaison, chaque reconnexion ferait tourner le document de zéro degré —
  // c'est-à-dire le reconstruirait pour rien, au moment précis où l'audience vient de rejoindre.
  const rotation = rotationEffective(0, row.view_rotation);
  if (rotation !== rotationEffective(0, view.rotation)) actions.push({ kind: "rotate", rotation });

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
