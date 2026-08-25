// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
import { describe, it, expect } from "vitest";
import {
  clampZoom,
  clampPage,
  progressPercent,
  arrowState,
  fitWidth,
  averageColor,
  isImageDocument,
  MIN_ZOOM,
  MAX_ZOOM,
  PRERENDER_MARGIN,
  CURRENT_PAGE_MARGIN,
} from "../viewer";

describe("visionneuse — zoom", () => {
  it("reste dans les bornes utilisables", () => {
    expect(clampZoom(10)).toBe(MAX_ZOOM);
    expect(clampZoom(0.1)).toBe(MIN_ZOOM);
    expect(clampZoom(1)).toBe(1);
  });

  // Sans arrondi, les clics successifs dérivent : 1 − 0.2 = 0.7999999999999999.
  it("ne dérive pas au fil des clics", () => {
    let z = 1;
    for (let i = 0; i < 5; i++) z = clampZoom(z - 0.2);
    expect(z).toBe(MIN_ZOOM);
    let up = MIN_ZOOM;
    for (let i = 0; i < 20; i++) up = clampZoom(up + 0.2);
    expect(up).toBe(MAX_ZOOM);
    expect(clampZoom(clampZoom(1 - 0.2))).toBe(0.8);
  });

  it("survit à une valeur absurde", () => {
    for (const junk of [NaN, undefined, null, "abc"]) {
      expect(clampZoom(junk as unknown as number)).toBe(MIN_ZOOM);
    }
  });
});

describe("visionneuse — pagination", () => {
  it("ramène toute page dans les bornes du document", () => {
    expect(clampPage(0, 10)).toBe(1);
    expect(clampPage(-3, 10)).toBe(1);
    expect(clampPage(99, 10)).toBe(10);
    expect(clampPage("4", 10)).toBe(4);
    expect(clampPage(undefined, 10)).toBe(1);
  });

  // Document pas encore mesuré : on ne doit ni diviser par zéro ni renvoyer 0.
  it("tient avant que le document soit mesuré", () => {
    expect(clampPage(5, 0)).toBe(1);
    expect(progressPercent(1, 0)).toBe(0);
  });

  it("calcule une progression entière", () => {
    expect(progressPercent(1, 4)).toBe(25);
    expect(progressPercent(4, 4)).toBe(100);
    expect(progressPercent(1, 3)).toBe(33);
    expect(progressPercent(99, 10)).toBe(100);
  });

  it("désactive les flèches aux extrémités", () => {
    expect(arrowState(1, 5)).toEqual({ prevDisabled: true, nextDisabled: false });
    expect(arrowState(3, 5)).toEqual({ prevDisabled: false, nextDisabled: false });
    expect(arrowState(5, 5)).toEqual({ prevDisabled: false, nextDisabled: true });
    // Document non mesuré : « suivant » reste ouvert, sinon on bloquerait au chargement.
    expect(arrowState(1, 0)).toEqual({ prevDisabled: true, nextDisabled: false });
  });

  // Confondre ces deux marges faisait considérer comme « courante » une page encore sous le pli
  // → l'audience était en retard d'une page sur le présentateur.
  it("distingue la marge de pré-rendu de la bande de page courante", () => {
    expect(PRERENDER_MARGIN).toBe("500px 0px");
    expect(CURRENT_PAGE_MARGIN).toBe("-48% 0px -48% 0px");
    expect(PRERENDER_MARGIN).not.toBe(CURRENT_PAGE_MARGIN);
  });
});

describe("visionneuse — largeur d'une page", () => {
  it("en défilement, suit la largeur du cadre et le zoom", () => {
    expect(fitWidth({ containerWidth: 900 })).toBe(900);
    expect(fitWidth({ containerWidth: 900, zoom: 2 })).toBe(1800);
  });

  it("ne descend jamais sous une largeur lisible", () => {
    expect(fitWidth({ containerWidth: 100 })).toBe(280);
    expect(fitWidth({ containerWidth: 0 })).toBe(900); // cadre pas encore mesuré → repli
  });

  // Sans la borne par la hauteur, la page débordait sous la feuille de conversation.
  it("en mode une-page, tient dans la hauteur disponible", () => {
    const large = fitWidth({ containerWidth: 2000, containerHeight: 1000, onePage: true, aspect: 1.35 });
    expect(large).toBeCloseTo((1000 - 28) / 1.35, 5);
    expect(large).toBeLessThan(2000);
  });

  it("retire du calcul ce qui recouvre le document", () => {
    const sans = fitWidth({ containerWidth: 2000, containerHeight: 1000, onePage: true });
    const avecFeuille = fitWidth({ containerWidth: 2000, containerHeight: 1000, onePage: true, overlap: 300 });
    const avecBandeau = fitWidth({ containerWidth: 2000, containerHeight: 1000, onePage: true, reserve: 200 });
    expect(avecFeuille).toBeLessThan(sans);
    expect(avecBandeau).toBeLessThan(sans);
  });

  // Panneau presque plein écran : mieux vaut une page trop haute qu'un timbre-poste illisible.
  it("abandonne la contrainte de hauteur quand elle deviendrait absurde", () => {
    expect(fitWidth({ containerWidth: 800, containerHeight: 200, onePage: true, overlap: 190 })).toBe(800);
  });

  it("n'agrandit jamais une page au-delà du zoom demandé", () => {
    expect(fitWidth({ containerWidth: 400, containerHeight: 5000, onePage: true })).toBe(400);
  });
});

describe("visionneuse — divers", () => {
  it("moyenne une bande de pixels", () => {
    expect(averageColor([255, 0, 0, 255, 255, 0, 0, 255])).toBe("rgb(255,0,0)");
    expect(averageColor([0, 0, 0, 255, 255, 255, 255, 255])).toBe("rgb(128,128,128)");
    expect(averageColor([])).toBe("rgb(0,0,0)"); // canvas vide : pas de division par zéro
  });

  // Le type MIME n'est pas toujours renvoyé par le stockage : le nom fait foi.
  it("reconnaît une image à son nom, pas à son type déclaré", () => {
    for (const n of ["plan.png", "vue.JPG", "a.jpeg", "b.webp", "c.gif", "d.avif", "e.png?v=2"]) {
      expect(isImageDocument(n), n).toBe(true);
    }
    for (const n of ["dossier.pdf", "note.txt", "", null, "image.png.pdf"]) {
      expect(isImageDocument(n), String(n)).toBe(false);
    }
    expect(isImageDocument(null, "https://x/y/photo.jpg")).toBe(true);
  });
});
