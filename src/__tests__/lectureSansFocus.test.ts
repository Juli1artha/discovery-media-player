// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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

import { SESSION_IDLE_MS } from "../cadence";
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
  // ⚠️ LES MINUTERIES DOIVENT TOURNER, SINON LE BANC NE PEUT RIEN PROUVER.
  //
  // La première version rendait `setInterval: () => 0` — un leurre. Or c'est la boucle périodique
  // qui déclare l'inactivité (`if (now - lastActivity > idleMs) idle = true`). Sans elle, `idle`
  // restait faux pour toujours, et une mutation retirant la règle « tourner une page compte »
  // laissait les tests VERTS : ils n'exerçaient pas la propriété qu'ils décrivaient.
  //
  // Un banc qui neutralise le mécanisme testé est un test qui ne peut pas dire non.
  const minuteries: { periode: number; f: () => void; prochain: number }[] = [];
  const win = {
    ...cible,
    document: doc,
    navigator: { sendBeacon: () => true },
    setInterval: (f: () => void, ms: number) => { minuteries.push({ periode: ms, f, prochain: t + ms }); return minuteries.length; },
    clearInterval: () => {},
    fetch: () => Promise.resolve(),
  };
  // ⚠️ On interroge `totalSeconds()` du traceur plutôt que d'intercepter son transport : c'est la
  // valeur qu'il PUBLIE, donc celle dont dépendent les statistiques. Ma première version guettait
  // les envois — un harnais qui n'en produit aucun aurait rendu 0, et un test qui affirme
  // « ≤ 70 » aurait été VERT sur zéro. Mesurer la sortie réelle plutôt que le tuyau.
  return {
    // ⚠️ CE QUI MANQUAIT AU BANC, ET QUI A LAISSÉ PASSER LA MOITIÉ DU DÉFAUT. `hasFocus()` avait été
    // retiré de la condition de lecture, mais `on(win,"blur",pause)` était resté 170 lignes plus
    // loin. Le banc ne déclenchait jamais `blur` : le test décrivait le bon monde et n'y touchait
    // pas. Troisième banc de la journée à neutraliser ce qu'il teste.
    declencher: (nom: string) => { for (const f of ecouteurs.get(nom) || []) f(); },
    // Le temps avance PAR PAS, en déclenchant les minuteries dues — comme un vrai navigateur.
    avancer: (ms: number) => {
      const fin = t + ms;
      for (;;) {
        const due = minuteries.filter((m) => m.prochain <= fin).sort((a, b) => a.prochain - b.prochain)[0];
        if (!due) break;
        t = due.prochain;
        due.prochain += due.periode;
        due.f();
      }
      t = fin;
    },
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
    // ⚠️ ON DÉRIVE DU SEUIL, ON NE RÉÉCRIT PAS SA VALEUR. Ce test disait « ≤ 70 » : il épinglait
    // 60 s + marge, donc il est tombé le jour où le seuil est passé à trois minutes — alors que la
    // propriété, elle, n'avait pas bougé. Un test qui fixe un nombre interdit de changer le nombre ;
    // un test qui fixe la relation laisse le nombre vivre.
    const seuil = SESSION_IDLE_MS / 1000;
    expect(secondes, "le plafond est le seuil d'inactivité, pas la durée d'horloge")
      .toBeLessThanOrEqual(seuil + 10);
    expect(secondes, "mais on ne retombe pas à zéro pour autant").toBeGreaterThan(30);
  });
});
// TOURNER UNE PAGE EST LA MEILLEURE PREUVE DE LECTURE, ET ELLE NE COMPTAIT PAS.
//
// L'inactivité se mesurait sur des événements d'ENTRÉE — souris, clavier, molette, tactile. Or un
// spectateur qui suit une présentation en direct ne touche rien : les pages tournent devant lui,
// poussées par le présentateur. Il devenait inactif alors que la seule chose qui prouve qu'il
// regarde était en train de se produire.
//
// ⚠️ C'est aussi ce qui remet le seuil à sa place : il n'arbitre plus que les SILENCES. Un lecteur
// réel tourne des pages ; un onglet oublié n'en tourne aucune.
//
// Vu par le second hôte : « ce qui distingue vraiment une lecture d'un onglet oublié n'est pas la
// durée, mais le fait de tourner une page ».
describe("tourner une page compte comme une lecture", () => {
  it("un spectateur qui ne touche rien reste compté tant que les pages tournent", () => {
    const b = banc({ visible: true, focus: false });
    b.tracker.start();
    // Dix minutes, une page toutes les deux minutes, AUCUN événement d'entrée.
    for (let p = 2; p <= 6; p++) { b.avancer(120_000); b.tracker.setPage(p); }
    const secondes = b.tracker.totalSeconds();
    expect(secondes, "sans cette règle, le comptage s'arrêtait au premier silence")
      .toBeGreaterThan(500);
  });

  it("mais un onglet oublié ne tourne aucune page, et reste borné", () => {
    const b = banc({ visible: true, focus: false });
    b.tracker.start();
    b.avancer(600_000);          // dix minutes, rien du tout
    expect(b.tracker.totalSeconds(), "le seuil arbitre les silences, et lui seul")
      .toBeLessThanOrEqual(SESSION_IDLE_MS / 1000 + 10);
  });
});


// PERDRE LE FOCUS N'EST PAS CESSER DE LIRE.
//
// 0.1.39 a retiré `hasFocus()` de la condition de lecture — et laissé `on(win,"blur",pause)`. Sur
// un second écran, cliquer sur l'autre fenêtre déclenche `blur`, donc `pause()`, donc le comptage
// s'arrête quand même. Le correctif était largement inopérant dans le cas exact qu'il visait.
//
// ⚠️ Signalé par un audit externe, pas par nos tests : le banc ne déclenchait jamais `blur`.
describe("perdre le focus n'arrête pas la lecture d'un document visible", () => {
  it("le document reste compté pendant qu'on travaille sur l'autre écran", () => {
    const b = banc({ visible: true, focus: false });
    b.tracker.start();
    b.avancer(5_000);
    b.declencher("blur");        // l'utilisateur clique sur la fenêtre de l'autre écran
    b.avancer(60_000);           // une minute, document toujours affiché
    const secondes = b.tracker.totalSeconds();

    // ⚠️ LE SEUIL EST SERRÉ EXPRÈS, ET LA PREMIÈRE VERSION NE MORDAIT PAS.
    //
    // Elle exigeait « > 50 » sur 65 s écoulées, et passait AUSSI avec le défaut : `blur` mettait
    // bien en pause, mais le `flush` périodique (12 s) appelle `commit()`, qui se termine par
    // `activeSince = viewable() ? now() : null` — donc le comptage repartait tout seul au flush
    // suivant. Le défaut coûtait au plus UN intervalle, pas la session entière.
    //
    // Ça nuance le constat de l'audit — l'impact réel était borné — et ça ne l'annule pas : chaque
    // aller-retour entre écrans rabotait jusqu'à douze secondes, en silence. Mais un test qui
    // tolère douze secondes de perte ne peut pas voir douze secondes de perte.
    expect(secondes, "aucune seconde ne doit se perdre : 65 s écoulées, 65 s lues")
      .toBeGreaterThanOrEqual(63);
  });

  // ⚠️ Ce que `blur` ne doit PAS ouvrir : un onglet réellement caché reste non compté, et c'est
  // `visibilitychange` qui le dit. Retirer une garde ne doit pas en desserrer une autre.
  it("mais un document caché reste non compté", () => {
    const b = banc({ visible: false, focus: false });
    b.tracker.start();
    b.declencher("visibilitychange");
    b.avancer(60_000);
    expect(b.tracker.totalSeconds(), "caché est caché, focus ou pas").toBeLessThan(3);
  });
});


