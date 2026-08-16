// UN DOCUMENT AFFICHÉ SUR UN SECOND ÉCRAN ÉTAIT COMPTÉ COMME UNE ABSENCE.
//
// `viewable()` exigeait `doc.hasFocus()`. Or `hasFocus()` répond « l'utilisateur tape ICI », pas
// « l'utilisateur regarde ». Un lecteur sur double écran — document visible quarante secondes, mains
// sur l'autre écran — était compté DEUX SECONDES.
//
// ⚠️ Et ça ne touchait pas que la population interne. Un prospect qui garde une plaquette ouverte
// pendant qu'on lui en parle au téléphone est le cas d'usage CENTRAL d'un lien de présentation, et
// il se mesurait comme une absence. La fonction promettait « temps de lecture » et rendait « temps
// de frappe ».
//
// `visibilityState` valait `visible` pendant tout ce temps : le signal juste était disponible,
// écrasé par une condition plus stricte qui répondait à une autre question.
//
// Trouvé par le second hôte sur une lecture RÉELLE — 26 s de présence, 2 s comptées — après un
// premier diagnostic (« le cadre n'avait pas le focus ») que le lecteur lui-même a corrigé.

import { describe, expect, it } from "vitest";

import { createTracker } from "../tracking";

/** Un document et une fenêtre qu'on pilote : la visibilité et le focus se règlent à la main. */
function banc({ visible = true, focus = false } = {}) {
  let t = 0;
  const envois: Record<string, unknown>[] = [];
  const ecouteurs = new Map<string, ((e?: unknown) => void)[]>();
  const cible = {
    addEventListener: (n: string, f: (e?: unknown) => void) => {
      ecouteurs.set(n, [...(ecouteurs.get(n) || []), f]);
    },
    removeEventListener: () => {},
  };
  const doc = {
    ...cible,
    get visibilityState() { return visible ? "visible" : "hidden"; },
    hasFocus: () => focus,
    documentElement: { scrollTop: 0, scrollHeight: 100, clientHeight: 100 },
  };
  const win = {
    ...cible,
    document: doc,
    navigator: { sendBeacon: () => true },
    setInterval: () => 0,
    clearInterval: () => {},
    fetch: () => Promise.resolve(),
  };
  // ⚠️ On interroge `totalSeconds()` du traceur plutôt que d'intercepter son transport : c'est la
  // valeur qu'il PUBLIE, donc celle dont dépendent les statistiques. Ma première version guettait
  // les envois — un harnais qui n'en produit aucun aurait rendu 0, et un test qui affirme
  // « ≤ 70 » aurait été VERT sur zéro. Mesurer la sortie réelle plutôt que le tuyau.
  return {
    avancer: (ms: number) => { t += ms; },
    envois,
    tracker: createTracker({
      slug: "s1",
      win: win as unknown as Window,
      doc: doc as unknown as Document,
      now: () => t,
    }),
  };
}

describe("ce qui compte comme une lecture", () => {
  // ⚠️ LE CAS EXACT DU SECOND HÔTE : visible, sans focus, quarante secondes.
  it("un document visible sans focus est lu", () => {
    const b = banc({ visible: true, focus: false });
    b.tracker.start();
    b.avancer(40_000);
    const secondes = b.tracker.totalSeconds();
    expect(secondes, "40 s de lecture rendaient 2 s : hasFocus mesurait la frappe, pas le regard")
      .toBeGreaterThanOrEqual(35);
  });

  it("un document caché ne l'est pas", () => {
    const b = banc({ visible: false, focus: true });
    b.tracker.start();
    b.avancer(40_000);
    expect(b.tracker.totalSeconds(), "un onglet en arrière-plan n'est pas lu").toBeLessThan(2);
  });

  // ⚠️ CE QUI RESTE, ET QUI EST VOULU. Le seuil d'inactivité est désormais SEUL à distinguer un
  // lecteur d'un onglet oublié : sans aucune interaction, une lecture plafonne à `idleMs`. Mieux
  // que zéro, moins qu'une lecture réelle de dix minutes — c'est un arbitrage sur ce que « lire »
  // veut dire, pas un défaut, et il est écrit à côté de l'option.
  it("sans la moindre interaction, la lecture plafonne au seuil d'inactivité", () => {
    const b = banc({ visible: true, focus: false });
    b.tracker.start();
    b.avancer(600_000);            // dix minutes, aucun événement
    const secondes = b.tracker.totalSeconds();
    expect(secondes, "le plafond est le seuil d'inactivité, pas la durée d'horloge")
      .toBeLessThanOrEqual(70);
    expect(secondes, "mais on ne retombe pas à zéro pour autant").toBeGreaterThan(30);
  });
});
