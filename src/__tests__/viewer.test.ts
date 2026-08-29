// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
import { describe, it, expect } from "vitest";
import {
  CURRENT_PAGE_MARGIN,
  DEFAULT_ASPECT,
  MAX_ZOOM,
  MIN_ZOOM,
  PRERENDER_MARGIN,
  ROTATIONS,
  ancrageApresZoom,
  arrowState,
  aspectApresRotation,
  averageColor,
  clampPage,
  clampZoom,
  fitWidth,
  isImageDocument,
  progressPercent,
  rotationEffective,
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

// ── Lot 0 « trois gestes » : rotation et ancrage du zoom ────────────────────────────────────────
//
// ⚠️ LES ATTENTES CI-DESSOUS SONT CALCULÉES À LA MAIN, PAS DÉRIVÉES DE LA FONCTION. Un banc qui
// rejoue la formule de son sujet passe quoi que la formule dise — il mesure sa propre copie. Chaque
// nombre attendu ici a été posé sur le papier depuis l'énoncé (« le point visé ne bouge pas »), et
// c'est ce qui le fait rougir quand la formule change.

describe("rotationEffective", () => {
  it("compose deux quarts de tour", () => {
    expect(rotationEffective(90, 90)).toBe(180);
  });

  it("revient à zéro au tour complet", () => {
    expect(rotationEffective(270, 90)).toBe(0);
    expect(rotationEffective(0, 720)).toBe(0);
  });

  it("accepte une rotation négative — « tourner à gauche » est un −90", () => {
    expect(rotationEffective(0, -90)).toBe(270);
    expect(rotationEffective(90, -180)).toBe(270);
  });

  // ⚠️ LE CAS QUI MOTIVE TOUTE LA FONCTION. Un document numérisé en paysage porte `/Rotate 90`.
  // Si « remettre à zéro » passait 0 en absolu à pdf.js, ce document se coucherait — la fonction
  // qui prétend redresser casserait précisément les fichiers qui étaient droits.
  it("PART de la rotation du fichier au lieu de l'écraser", () => {
    expect(rotationEffective(90, 0)).toBe(90);
    expect(rotationEffective(90, 90)).not.toBe(90);
  });

  it("arrondit au quart de tour un fichier qui ne respecte pas la spécification", () => {
    expect(rotationEffective(45, 0)).toBe(90);
    expect(rotationEffective(10, 0)).toBe(0);
  });

  it("traite une valeur absente ou absurde comme zéro, sans lever", () => {
    expect(rotationEffective(undefined, null)).toBe(0);
    expect(rotationEffective(NaN, "90")).toBe(0);
    expect(rotationEffective(Infinity, 90)).toBe(90);
  });

  it("ne rend que des quarts de tour", () => {
    for (const d of [0, 37, 90, 145, 180, 269, 270, 359, -400]) {
      expect(ROTATIONS).toContain(rotationEffective(0, d));
    }
  });
});

describe("aspectApresRotation", () => {
  it("laisse la proportion intacte à plat et à l'envers", () => {
    expect(aspectApresRotation(1.4, 0)).toBeCloseTo(1.4, 10);
    expect(aspectApresRotation(1.4, 180)).toBeCloseTo(1.4, 10);
  });

  it("l'inverse au quart de tour, dans les deux sens", () => {
    expect(aspectApresRotation(1.25, 90)).toBeCloseTo(0.8, 10);
    expect(aspectApresRotation(1.25, 270)).toBeCloseTo(0.8, 10);
    expect(aspectApresRotation(1.25, -90)).toBeCloseTo(0.8, 10);
  });

  it("retombe sur la proportion par défaut quand celle donnée n'en est pas une", () => {
    expect(aspectApresRotation(0, 0)).toBe(DEFAULT_ASPECT);
    expect(aspectApresRotation(-2, 0)).toBe(DEFAULT_ASPECT);
    expect(aspectApresRotation(undefined, 0)).toBe(DEFAULT_ASPECT);
    expect(aspectApresRotation(NaN, 90)).toBeCloseTo(1 / DEFAULT_ASPECT, 10);
  });

  it("tourner quatre fois ramène au point de départ", () => {
    let a: number = 1.35;
    for (let i = 0; i < 4; i++) a = aspectApresRotation(a, 90);
    expect(a).toBeCloseTo(1.35, 10);
  });
});

describe("ancrageApresZoom", () => {
  const cas = (o: Partial<Parameters<typeof ancrageApresZoom>[0]>) =>
    ancrageApresZoom({
      defilement: { x: 0, y: 0 },
      point: { x: 0, y: 0 },
      cadre: { largeur: 500, hauteur: 500 },
      contenu: { largeur: 1000, hauteur: 2000 },
      zoomAvant: 1,
      zoomApres: 2,
      ...o,
    } as Parameters<typeof ancrageApresZoom>[0]);

  // Le cadre fait 500 ; le contenu 1000 déborde donc, aucune marge de centrage. Le point visé est à
  // 250 du bord du cadre, le défilement à 100 : la matière visée est à 350 du haut du contenu. Au
  // double, elle passe à 700 ; pour la laisser à 250 sous les yeux, il faut défiler de 450.
  it("garde le point visé immobile quand le contenu déborde", () => {
    const r = cas({ defilement: { x: 100, y: 300 }, point: { x: 250, y: 400 }, contenu: { largeur: 1000, hauteur: 2000 } });
    expect(r.x).toBeCloseTo(450, 6);
    expect(r.y).toBeCloseTo(1000, 6);
  });

  // ⚠️ LE CAS QUE LA FORMULE NAÏVE RATE. Un document plus étroit que le cadre est CENTRÉ et son
  // défilement vaut zéro : la matière sous le curseur n'est pas « point + défilement », elle est
  // décalée d'une demi-marge. Ignorer ce décalage ancre bien un document zoomé et fait sauter un
  // document vu en entier — c'est-à-dire au moment exact où le lecteur commence à zoomer.
  it("tient compte de la marge de centrage quand le contenu est plus étroit que le cadre", () => {
    const r = cas({
      cadre: { largeur: 500, hauteur: 500 },
      contenu: { largeur: 300, hauteur: 300 },
      defilement: { x: 0, y: 0 },
      point: { x: 250, y: 250 },
    });
    expect(r.x).toBeCloseTo(50, 6);
    expect(r.y).toBeCloseTo(50, 6);
  });

  it("ne rend jamais un défilement négatif", () => {
    const r = cas({ zoomApres: 0.5, point: { x: 100, y: 100 }, defilement: { x: 0, y: 0 } });
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it("ne dépasse pas le défilement maximal, même sur un point hors du cadre", () => {
    const r = cas({ defilement: { x: 500, y: 1500 }, point: { x: 600, y: 600 }, contenu: { largeur: 1000, hauteur: 2000 } });
    expect(r.x).toBeCloseTo(1500, 6);   // 2000 de contenu − 500 de cadre
    expect(r.y).toBeCloseTo(3500, 6);   // 4000 de contenu − 500 de cadre
  });

  // ⚠️ LES ESPACEMENTS NE GRANDISSENT PAS AVEC LE ZOOM. Cent pages séparées de 16 px font plus de
  // 1500 px qui restent identiques au double. Croire tout le contenu proportionnel projette le
  // lecteur trop bas, et d'autant plus qu'il est loin dans le document.
  it("n'étire pas la part fixe du contenu", () => {
    const commun = { defilement: { x: 0, y: 1000 }, point: { x: 0, y: 250 }, contenu: { largeur: 1000, hauteur: 2000 } };
    const avecFixe = cas({ ...commun, fixe: { largeur: 0, hauteur: 500 } });
    const sansFixe = cas(commun);
    expect(avecFixe.y).toBeCloseTo(1937.5, 6);
    expect(sansFixe.y).toBeCloseTo(2250, 6);
  });

  it("ne bouge rien plutôt que d'inventer une position quand le zoom de départ est absurde", () => {
    expect(cas({ zoomAvant: 0, defilement: { x: 7, y: 9 } })).toEqual({ x: 7, y: 9 });
    expect(cas({ zoomApres: -1, defilement: { x: 7, y: 9 } })).toEqual({ x: 7, y: 9 });
    expect(cas({ zoomAvant: NaN, defilement: { x: 7, y: 9 } })).toEqual({ x: 7, y: 9 });
  });

  // ⚠️ LE CRITÈRE D'ACCEPTATION LUI-MÊME, ÉCRIT SANS LA FORMULE. On calcule où la matière visée
  // s'affiche avant, puis où elle s'affiche après, avec une expression indépendante de la fonction —
  // et on exige que ce soit le même endroit. C'est le banc qui survit à une réécriture complète.
  it("le point visé s'affiche au même endroit avant et après, sur onze niveaux de zoom", () => {
    const cadre = 500, contenu = 1600, defilement = 400, point = 180;
    const ecran = (coord: number, defil: number, taille: number) =>
      coord - defil + Math.max(0, (cadre - taille) / 2);
    const vise = point + defilement - Math.max(0, (cadre - contenu) / 2);

    for (let i = 0; i <= 10; i++) {
      const zoomApres = 0.6 + i * 0.24;
      const r = ancrageApresZoom({
        defilement: { x: 0, y: defilement },
        point: { x: 0, y: point },
        cadre: { largeur: cadre, hauteur: cadre },
        contenu: { largeur: contenu, hauteur: contenu },
        zoomAvant: 1,
        zoomApres,
      });
      const contenuApres = contenu * zoomApres;
      const maxDefil = Math.max(0, contenuApres - cadre);
      // Hors zone de butée seulement : contre une butée, le point NE PEUT PAS rester immobile, et
      // exiger qu'il le reste demanderait à la fonction de mentir.
      if (r.y > 0.001 && r.y < maxDefil - 0.001) {
        expect(ecran(vise * zoomApres, r.y, contenuApres)).toBeCloseTo(point, 6);
      }
    }
  });
});

describe("fitWidth avec rotation", () => {
  const base = { containerWidth: 900, containerHeight: 700, onePage: true, aspect: 1.4 };

  it("tourne la proportion en mode une-page : une page couchée tient autrement", () => {
    expect(fitWidth({ ...base, rotation: 90 })).not.toBeCloseTo(fitWidth(base), 6);
  });

  it("une page couchée peut occuper plus de largeur qu'une page debout", () => {
    expect(fitWidth({ ...base, rotation: 90 })).toBeGreaterThan(fitWidth({ ...base, rotation: 0 }));
  });

  it("ignore la rotation hors du mode une-page — la largeur y suit le cadre, pas la hauteur", () => {
    const defilant = { containerWidth: 900, containerHeight: 700, onePage: false, aspect: 1.4, zoom: 1 };
    expect(fitWidth({ ...defilant, rotation: 90 })).toBe(fitWidth(defilant));
  });

  it("sans rotation, rend exactement ce qu'il rendait avant l'ajout du paramètre", () => {
    expect(fitWidth({ ...base, rotation: 0 })).toBe(fitWidth(base));
    expect(fitWidth({ ...base, rotation: undefined })).toBe(fitWidth(base));
  });
});
