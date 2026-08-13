import { describe, it, expect } from "vitest";
import {
  sanitizeContent,
  cycleMapType,
  mapTypeLabel,
  initialMapContent,
  MAP_TYPES,
  DEFAULT_CENTER,
  type MapContent,
} from "../presentation-content";

/** Le retour est une union : ce raccourci évite de répéter l'affinage dans chaque assertion. */
const asMap = (input: unknown) => sanitizeContent(input) as MapContent | null;

// Ce contrat traverse trois frontières : le navigateur du présentateur le produit, le serveur le
// valide, le navigateur de chaque spectateur l'applique. Il n'avait AUCUN test alors qu'une
// divergence s'y traduit par une audience qui ne voit pas ce que montre le présentateur — sans
// erreur nulle part.

describe("contenu de présentation — retour au document", () => {
  // `null` = « on présente le document ». C'est le repli sûr : jamais un écran vide.
  it("tout ce qui n'est pas reconnu ramène au document", () => {
    for (const input of [null, undefined, "", 0, "map", [], { kind: "pdf" }, {}, { kind: "evil" }, { kind: 42 }]) {
      expect(sanitizeContent(input), JSON.stringify(input)).toBeNull();
    }
  });
});

describe("contenu de présentation — carte", () => {
  it("conserve une carte valide", () => {
    expect(sanitizeContent({ kind: "map", center: [48.85, 2.35], zoom: 14, marker: [48.86, 2.34], mapType: "satellite", label: "Paris" }))
      .toEqual({ kind: "map", center: [48.85, 2.35], zoom: 14, marker: [48.86, 2.34], mapType: "satellite", label: "Paris" });
  });

  it("retombe sur la France entière quand le centre est inexploitable", () => {
    for (const center of [undefined, "48,2", ["a", "b"], [1]]) {
      expect(asMap({ kind: "map", center })?.center, JSON.stringify(center)).toEqual(DEFAULT_CENTER);
    }
  });

  it("borne le zoom entre 1 et 21, et le tronque", () => {
    expect(asMap({ kind: "map", zoom: 99 })?.zoom).toBe(21);
    expect(asMap({ kind: "map", zoom: -5 })?.zoom).toBe(1);
    expect(asMap({ kind: "map", zoom: 12.7 })?.zoom).toBe(12);
    expect(asMap({ kind: "map", zoom: "14" })?.zoom).toBe(14);
  });

  it("n'accepte qu'un fond de carte connu", () => {
    for (const t of MAP_TYPES) expect(asMap({ kind: "map", mapType: t })?.mapType).toBe(t);
    for (const t of ["terrain", "", null, "<script>"]) expect(asMap({ kind: "map", mapType: t })?.mapType).toBeNull();
  });

  // Le libellé est saisi par le présentateur et s'affiche chez tous : il est borné ici, échappé à l'affichage.
  it("borne le libellé à 160 caractères", () => {
    expect(asMap({ kind: "map", label: "x".repeat(500) })?.label).toHaveLength(160);
    expect(asMap({ kind: "map", label: "" })?.label).toBeNull();
  });

  it("ne garde un marqueur que s'il est exploitable", () => {
    expect(asMap({ kind: "map", marker: [1, 2] })?.marker).toEqual([1, 2]);
    for (const m of [undefined, null, "1,2", ["a", 2]]) {
      expect(asMap({ kind: "map", marker: m })?.marker, JSON.stringify(m)).toBeNull();
    }
  });
});

describe("contenu de présentation — Street View", () => {
  it("conserve une vue valide", () => {
    expect(sanitizeContent({ kind: "streetview", position: [48.85, 2.35], pov: { heading: 90, pitch: 10 }, zoom: 2 }))
      .toEqual({ kind: "streetview", position: [48.85, 2.35], pov: { heading: 90, pitch: 10 }, zoom: 2 });
  });

  // Une vue Street View sans position n'a aucun sens : on ramène au document.
  it("refuse une vue sans position exploitable", () => {
    for (const position of [undefined, null, "48,2", [1], ["a", "b"]]) {
      expect(sanitizeContent({ kind: "streetview", position }), JSON.stringify(position)).toBeNull();
    }
  });

  // Au-delà de ±90° l'orientation verticale se retourne : la borne évite une audience la tête à l'envers.
  it("borne l'inclinaison à ±90° et le zoom à 0–5", () => {
    expect(sanitizeContent({ kind: "streetview", position: [1, 2], pov: { pitch: 200 } })).toMatchObject({ pov: { pitch: 90 } });
    expect(sanitizeContent({ kind: "streetview", position: [1, 2], pov: { pitch: -200 } })).toMatchObject({ pov: { pitch: -90 } });
    expect(sanitizeContent({ kind: "streetview", position: [1, 2], zoom: 50 })?.zoom).toBe(5);
  });

  it("se passe d'une orientation absente ou biscornue", () => {
    expect(sanitizeContent({ kind: "streetview", position: [1, 2] })).toMatchObject({ pov: { heading: 0, pitch: 0 } });
    expect(sanitizeContent({ kind: "streetview", position: [1, 2], pov: "nord" })).toMatchObject({ pov: { heading: 0, pitch: 0 } });
  });
});

describe("contenu de présentation — bouton de fond de carte", () => {
  it("tourne dans l'ordre, et repart de zéro depuis l'inconnu", () => {
    expect(cycleMapType("roadmap")).toBe("satellite");
    expect(cycleMapType("satellite")).toBe("hybrid");
    expect(cycleMapType("hybrid")).toBe("roadmap");
    expect(cycleMapType(null)).toBe("roadmap");
    expect(cycleMapType("terrain")).toBe("roadmap");
  });

  // Le bouton annonce ce vers quoi on va, pas ce qu'on regarde.
  it("annonce la destination, pas l'état courant", () => {
    expect(mapTypeLabel("roadmap")).toContain("Satellite");
    expect(mapTypeLabel("satellite")).toContain("Hybride");
    expect(mapTypeLabel("hybrid")).toContain("Plan");
    expect(mapTypeLabel(null)).toContain("Plan");
  });
});

describe("contenu de présentation — départ", () => {
  it("démarre sur la France entière, et survit à son propre aller-retour", () => {
    const initial = initialMapContent();
    expect(initial).toMatchObject({ kind: "map", center: DEFAULT_CENTER, zoom: 6, marker: null });
    expect(sanitizeContent(initial)).toEqual(initial);
  });

  // Le contenu revient du serveur puis repart : il doit être stable, sinon la carte dériverait
  // à chaque aller-retour.
  it("est idempotent", () => {
    const once = sanitizeContent({ kind: "map", center: [48.85, 2.35], zoom: 14, mapType: "hybrid", label: "Paris" });
    expect(sanitizeContent(once)).toEqual(once);
    const sv = sanitizeContent({ kind: "streetview", position: [48.85, 2.35], pov: { heading: 12, pitch: 3 }, zoom: 2 });
    expect(sanitizeContent(sv)).toEqual(sv);
  });

  it("ne partage pas son tableau de centre entre deux appels", () => {
    const a = initialMapContent();
    a.center[0] = 0;
    expect(initialMapContent().center).toEqual(DEFAULT_CENTER);
  });
});
