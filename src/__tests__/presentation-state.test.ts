// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
import { describe, it, expect } from "vitest";
import { presentationTransition, switchDocUrl } from "../presentation-state";

const genres = (row: unknown, view = {}) =>
  presentationTransition(row as never, view).map((a) => a.kind);

describe("suivi de l'audience — l'ordre est une règle", () => {
  // Une présentation terminée l'emporte sur tout : le reste de l'état n'a plus de sens.
  it("une présentation terminée coupe court", () => {
    expect(genres({ active: false, current_page: 4, content: { kind: "map" }, file_url: "https://x/y" }))
      .toEqual(["ended"]);
  });

  // Le présentateur montre autre chose : l'audience ne doit ni revenir au PDF ni suivre ses pages.
  it("une carte SUSPEND le suivi du document", () => {
    expect(genres({ active: true, content: { kind: "map", center: [48.8, 2.3], zoom: 14 }, current_page: 7 }))
      .toEqual(["show-map"]);
    expect(genres({ active: true, content: { kind: "streetview", position: [48.8, 2.3] }, current_page: 7 }))
      .toEqual(["show-map"]);
  });

  it("revenir au document quitte la carte", () => {
    expect(genres({ active: true, current_page: 3 })).toEqual(["leave-map", "show-page"]);
    expect(genres({ active: true, content: null, current_page: 3 })).toEqual(["leave-map", "show-page"]);
  });

  // La page 3 de l'ancien document n'est pas la page 3 du nouveau.
  it("un changement de document précède — et remplace — un changement de page", () => {
    const actions = presentationTransition(
      { active: true, file_url: "https://x/neuf.pdf", current_page: 9 },
      { docUrl: "https://x/ancien.pdf" },
    );
    expect(actions.map((a) => a.kind)).toEqual(["leave-map", "switch-doc"]);
    expect(actions[1]).toMatchObject({ kind: "switch-doc", url: "https://x/neuf.pdf" });
  });

  it("le même document ne déclenche pas de rechargement", () => {
    expect(genres({ active: true, file_url: "https://x/a.pdf", current_page: 5 }, { docUrl: "https://x/a.pdf" }))
      .toEqual(["leave-map", "show-page"]);
  });

  it("ne fait rien d'un état absent ou vide", () => {
    expect(genres(null)).toEqual(["nothing"]);
    expect(genres(undefined)).toEqual(["nothing"]);
    expect(genres({ active: true })).toEqual(["leave-map"]);
  });
});

// ⚠️ LE point de sécurité de la bascule vers `broadcast` : sur la voie « table », le contenu venait
// de notre base, donc déjà assaini. Sur la voie « diffusion », il vient du NAVIGATEUR du
// présentateur — et rien n'empêche un participant d'émettre sur le canal. Sans re-validation, il
// imposerait une vue à toute l'audience.
describe("suivi de l'audience — un état diffusé n'est pas digne de confiance", () => {
  it("re-valide le contenu reçu, quelle que soit sa provenance", () => {
    const actions = presentationTransition({ active: true, content: { kind: "map", zoom: 9999, center: ["x", "y"] } });
    expect(actions[0]).toMatchObject({ kind: "show-map" });
    expect(actions[0]).toMatchObject({ content: { zoom: 21, center: [46.6, 2.5] } });
  });

  it("un contenu inconnu ramène au document au lieu d'obéir", () => {
    for (const hostile of [{ kind: "iframe", src: "https://attaquant" }, { kind: 42 }, "map", []]) {
      expect(genres({ active: true, content: hostile, current_page: 2 }), JSON.stringify(hostile))
        .toEqual(["leave-map", "show-page"]);
    }
  });
});

describe("rechargement d'un document changé", () => {
  // Sans paramètre qui change, pdf.js ressert son cache : l'audience continue de voir l'ANCIEN
  // document pendant que le présentateur commente le nouveau.
  it("ajoute un cache-buster, en respectant la requête existante", () => {
    expect(switchDocUrl("/api/doc?present=abc&file=1", "2026-08-13T10:00:00Z"))
      .toBe("/api/doc?present=abc&file=1&v=2026-08-13T10%3A00%3A00Z");
    expect(switchDocUrl("/fichier.pdf", "2026-08-13T10:00:00Z")).toBe("/fichier.pdf?v=2026-08-13T10%3A00%3A00Z");
  });

  it("reste distinct même sans horodatage", () => {
    const a = switchDocUrl("/x?file=1");
    expect(a).toMatch(/&v=\d+$/);
  });
});

// ── LA ROTATION SUIT L'AUDIENCE ────────────────────────────────────────────────────────────────
//
// ⚠️ CETTE VALEUR ARRIVE PAR UNE VOIE NON FIABLE. Sur le canal `broadcast`, l'état vient du
// NAVIGATEUR du présentateur : elle est donc normalisée ici, comme le contenu est ré-assaini. Un
// viewport oblique casserait la couche de texte de TOUTE l'audience, pas seulement de celui qui
// l'envoie.
describe("presentationTransition — rotation", () => {
  const vivante = { active: true, file_url: "/doc.pdf", current_page: 3 };

  it("demande la rotation quand le présentateur a tourné", () => {
    const a = presentationTransition({ ...vivante, view_rotation: 90 }, { docUrl: "/doc.pdf", rotation: 0 });
    expect(a).toContainEqual({ kind: "rotate", rotation: 90 });
  });

  // ⚠️ SANS CETTE LIGNE, CHAQUE RECONNEXION RECONSTRUIRAIT LE DOCUMENT POUR RIEN. La relecture HTTP
  // rejoue tout l'état à la (re)connexion : émettre « tourne de 0° » y ferait payer une
  // reconstruction complète au moment exact où l'audience vient de rejoindre.
  it("n'émet RIEN quand la rotation n'a pas changé", () => {
    const a = presentationTransition({ ...vivante, view_rotation: 90 }, { docUrl: "/doc.pdf", rotation: 90 });
    expect(a.some((x) => x.kind === "rotate")).toBe(false);
  });

  it("traite l'absence de rotation comme zéro, des deux côtés", () => {
    const a = presentationTransition(vivante, { docUrl: "/doc.pdf" });
    expect(a.some((x) => x.kind === "rotate")).toBe(false);
  });

  it("émet la rotation quand l'audience revient à zéro", () => {
    const a = presentationTransition({ ...vivante, view_rotation: 0 }, { docUrl: "/doc.pdf", rotation: 270 });
    expect(a).toContainEqual({ kind: "rotate", rotation: 0 });
  });

  // ⚠️ L'ORDRE EST UNE RÈGLE : tourner APRÈS avoir montré la page ferait reconstruire deux fois, et
  // la première reconstruction viserait une page dont la position est sur le point de bouger.
  it("tourne AVANT de montrer la page", () => {
    const a = presentationTransition({ ...vivante, view_rotation: 90 }, { docUrl: "/doc.pdf", rotation: 0 });
    const iRot = a.findIndex((x) => x.kind === "rotate");
    const iPage = a.findIndex((x) => x.kind === "show-page");
    expect(iRot).toBeGreaterThanOrEqual(0);
    expect(iPage).toBeGreaterThan(iRot);
  });

  it("tourne AUSSI quand le document change — sinon le nouveau document arrive droit", () => {
    const a = presentationTransition({ ...vivante, file_url: "/autre.pdf", view_rotation: 90 }, { docUrl: "/doc.pdf", rotation: 0 });
    const iRot = a.findIndex((x) => x.kind === "rotate");
    const iDoc = a.findIndex((x) => x.kind === "switch-doc");
    expect(iRot).toBeGreaterThanOrEqual(0);
    expect(iDoc).toBeGreaterThan(iRot);
  });

  it.each([
    ["un tiers de tour", 37, 0],
    ["une chaîne", "90", 0],
    ["NaN", NaN, 0],
    ["au-delà du tour", 450, 90],
    ["négative", -90, 270],
  ])("normalise une valeur venue du navigateur du présentateur : %s", (_nom, brute, attendue) => {
    const a = presentationTransition({ ...vivante, view_rotation: brute as number }, { docUrl: "/doc.pdf", rotation: 180 });
    expect(a).toContainEqual({ kind: "rotate", rotation: attendue });
  });

  // ⚠️ LES DEUX CÔTÉS SE NORMALISENT, PAS SEULEMENT CELUI QUI ARRIVE. La rotation que l'audience
  // porte déjà vient de la BASE au chargement de la page, pas d'une action que nous aurions émise :
  // si la base contient 450, comparer 90 à 450 émettrait une rotation « vers 90 » alors que
  // l'audience y est déjà — une reconstruction complète du document au moment où elle rejoint.
  it("ne compare pas une valeur normalisée à une valeur brute", () => {
    const a = presentationTransition({ ...vivante, view_rotation: 450 }, { docUrl: "/doc.pdf", rotation: 450 });
    expect(a.some((x) => x.kind === "rotate")).toBe(false);
  });

  it("une présentation terminée l'emporte : aucune rotation", () => {
    const a = presentationTransition({ ...vivante, active: false, view_rotation: 90 }, { docUrl: "/doc.pdf", rotation: 0 });
    expect(a).toEqual([{ kind: "ended" }]);
  });

  it("une carte suspend tout, rotation comprise", () => {
    const a = presentationTransition(
      { ...vivante, view_rotation: 90, content: { kind: "map", center: [46, 2], zoom: 6, mapType: "roadmap" } },
      { docUrl: "/doc.pdf", rotation: 0 },
    );
    expect(a.some((x) => x.kind === "rotate")).toBe(false);
  });
});

