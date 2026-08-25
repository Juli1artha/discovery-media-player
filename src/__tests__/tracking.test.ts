// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
import { describe, it, expect } from "vitest";
import { createTracker, type TrackerOptions } from "../tracking";
import { SESSION_IDLE_MS } from "../cadence";

// Environnement navigateur minimal et PILOTABLE : c'est tout l'intérêt d'avoir sorti ce code des
// template literals — le temps, la visibilité et le focus deviennent des variables du test.
function harness(over: Partial<TrackerOptions> = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const listeners = new Map<string, Set<() => void>>();
  const timers: Array<{ fn: () => void; every: number; id: number }> = [];
  let clock = 1_000_000;
  let visible = true;
  let focused = true;
  let nextTimer = 1;

  const target = {
    addEventListener: (type: string, h: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(h);
    },
    removeEventListener: (type: string, h: () => void) => { listeners.get(type)?.delete(h); },
  };
  const doc = {
    ...target,
    get visibilityState() { return visible ? "visible" : "hidden"; },
    hasFocus: () => focused,
  } as unknown as Document;
  const win = {
    ...target,
    setInterval: (fn: () => void, every: number) => { const id = nextTimer++; timers.push({ fn, every, id }); return id; },
    clearInterval: (id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  } as unknown as Window;

  const tracker = createTracker({
    doc, win,
    now: () => clock,
    send: (p) => sent.push(p),
    sessionId: "sess-test",
    ...over,
  });

  return {
    tracker, sent, listeners, timers,
    /** Avance le temps SANS déclencher les minuteries — le temps passe, on ne persiste pas. */
    advance: (ms: number) => { clock += ms; },
    fire: (type: string) => listeners.get(type)?.forEach((h) => h()),
    hide: () => { visible = false; },
    show: () => { visible = true; },
    blur: () => { focused = false; },
    focus: () => { focused = true; },
    tickTimers: () => timers.slice().forEach((t) => t.fn()),
    events: () => sent.map((p) => p.event),
  };
}

describe("tracking — séparation des deux populations", () => {
  it("un lien public journalise l'ouverture puis les pages atteintes", () => {
    const h = harness({ slug: "Ab3-_xYz9012" });
    h.tracker.start();
    h.tracker.setPage(2);
    expect(h.events()).toEqual(["open", "page"]);
    expect(h.sent[1]).toMatchObject({ slug: "Ab3-_xYz9012", event: "page", page: 2, maxPage: 2 });
  });

  // Un aperçu interne qui journaliserait un `open` gonflerait l'entonnoir du prospect.
  it("un aperçu interne n'émet AUCUN open ni page", () => {
    const h = harness({ internal: { docId: "doc-1", email: "moi@example.fr", name: "Moi" } });
    h.tracker.start();
    h.tracker.setPage(2);
    h.tracker.setPage(3);
    expect(h.events()).toEqual([]);
    h.tracker.flush();
    expect(h.events()).toEqual(["session"]);
  });

  it("sans slug ni contexte interne, rien n'est envoyé du tout", () => {
    const h = harness();
    h.tracker.start();
    h.tracker.setPage(4);
    h.tracker.flush();
    expect(h.sent).toEqual([]);
  });
});

describe("tracking — le temps ne compte que si on regarde vraiment", () => {
  it("compte le temps passé, page par page", () => {
    const h = harness({ slug: "s" });
    h.tracker.start();
    h.advance(4000);
    h.tracker.setPage(2);
    h.advance(6000);
    h.tracker.flush();
    const session = h.sent.find((p) => p.event === "session")!;
    expect(session.pagesTime).toEqual({ 1: 4, 2: 6 });
    expect(session.totalSeconds).toBe(10);
  });

  it("ne compte pas un onglet caché, et persiste en partant", () => {
    const h = harness({ slug: "s" });
    h.tracker.start();
    h.advance(3000);
    h.hide();
    h.fire("visibilitychange");
    expect(h.events()).toEqual(["open", "session"]); // caché ⇒ on persiste tout de suite
    h.advance(600_000); // dix minutes dans un onglet oublié
    h.show();
    h.fire("visibilitychange");
    h.advance(2000);
    h.tracker.flush();
    const last = h.sent[h.sent.length - 1];
    expect(last.totalSeconds).toBe(5); // 3 + 2, les dix minutes cachées ne comptent pas
  });

  // ⚠️ CE TEST DISAIT L'INVERSE, ET C'ÉTAIT LA VOIX QUI CONTREDISAIT 0.1.39.
  //
  // Il exigeait qu'une fenêtre sans focus cesse de compter. 0.1.39 a retiré `hasFocus()` de la
  // condition de lecture pour qu'un document affiché sur un second écran compte — mais
  // `on(win,"blur",pause)` était resté, et CE TEST l'exigeait. Le projet disait donc deux choses à
  // la fois : « un document visible compte » et « une fenêtre sans focus ne compte pas ».
  //
  // ⚠️ Et il PASSAIT dans les deux mondes tant que le banc de l'autre fichier ne déclenchait pas
  // `blur` : chaque suite décrivait un contrat différent sans jamais se croiser.
  //
  // Le contrat est tranché : perdre le focus signifie « une autre fenêtre est au premier plan »,
  // pas « ce document n'est plus lu ». Seul `visibilitychange` a cette autorité.
  it("une fenêtre qui perd le focus continue de compter si le document reste visible", () => {
    const h = harness({ slug: "s" });
    h.tracker.start();
    h.advance(3000);
    h.blur();
    h.fire("blur");
    h.advance(60_000);          // une minute sur l'autre écran, document toujours affiché
    h.focus();
    h.fire("focus");
    h.advance(1000);
    h.tracker.flush();
    const compte = h.sent[h.sent.length - 1].totalSeconds as number;
    expect(compte, "c'est le cas du double écran : 4 s comptées pour 64 s de lecture")
      .toBeGreaterThan(50);
  });

  // ⚠️ Ce qui n'a PAS changé, et qui doit rester vrai : un onglet CACHÉ ne compte pas. C'est
  // `visibilitychange` qui le dit, et lui seul — sans quoi retirer `blur` ouvrirait la porte d'à
  // côté en fermant celle-ci.
  it("mais un onglet caché ne compte toujours pas", () => {
    const h = harness({ slug: "s" });
    h.tracker.start();
    h.advance(3000);
    h.hide();
    h.fire("visibilitychange");
    h.advance(120_000);
    h.tracker.flush();
    expect(h.sent[h.sent.length - 1].totalSeconds, "caché reste caché").toBeLessThan(6);
  });

  it("met en pause après inactivité, et repart à la première interaction", () => {
    const h = harness({ slug: "s", idleMs: 60_000 });
    h.tracker.start();
    h.advance(70_000);
    h.tickTimers(); // la minuterie d'inactivité constate 70 s > 60 s
    const afterIdle = h.tracker.totalSeconds();
    h.advance(300_000);
    expect(h.tracker.totalSeconds()).toBe(afterIdle); // le chrono est bien arrêté
    h.tracker.noteActivity();
    h.advance(5000);
    expect(h.tracker.totalSeconds()).toBe(afterIdle + 5);
  });
});

describe("tracking — progression dans le document", () => {
  it("ne journalise une page qu'à la première visite (l'entonnoir mesure la progression)", () => {
    const h = harness({ slug: "s" });
    h.tracker.start();
    h.tracker.setPage(2);
    h.tracker.setPage(3);
    h.tracker.setPage(2); // retour en arrière
    h.tracker.setPage(3); // et re-avance
    expect(h.events()).toEqual(["open", "page", "page"]);
    expect(h.tracker.maxPage()).toBe(3);
  });

  it("ignore une page nulle ou identique à la courante", () => {
    const h = harness({ slug: "s" });
    h.tracker.start();
    h.tracker.setPage(0);
    h.tracker.setPage(2);
    h.tracker.setPage(2);
    expect(h.events()).toEqual(["open", "page"]);
  });
});

describe("tracking — forme des charges utiles", () => {
  it("session publique : rattachée au slug", () => {
    const h = harness({ slug: "Ab3-_xYz9012" });
    h.tracker.start();
    h.tracker.setPageCount(12);
    h.tracker.setPage(5);
    h.advance(3000);
    h.tracker.flush();
    expect(h.sent[h.sent.length - 1]).toMatchObject({
      event: "session", sessionId: "sess-test", slug: "Ab3-_xYz9012",
      numPages: 12, maxPage: 5, totalSeconds: 3,
    });
    expect(h.sent[h.sent.length - 1].internal).toBeUndefined();
  });

  it("session interne : rattachée au document et au membre, jamais à un slug", () => {
    const h = harness({ internal: { docId: "doc-1", email: "moi@example.fr", name: "Moi" } });
    h.tracker.start();
    h.tracker.setPageCount(4);
    h.tracker.flush();
    const p = h.sent[h.sent.length - 1];
    expect(p).toMatchObject({ event: "session", internal: true, docId: "doc-1", email: "moi@example.fr", name: "Moi" });
    expect(p.slug).toBeUndefined();
  });
});

describe("tracking — cycle de vie", () => {
  it("persiste périodiquement, puis plus rien après stop()", () => {
    const h = harness({ slug: "s", sessionEveryMs: 12_000 });
    h.tracker.start();
    h.advance(12_000);
    h.tickTimers();
    expect(h.events().filter((e) => e === "session")).toHaveLength(1);

    h.tracker.stop();
    expect(h.timers).toHaveLength(0);
    h.fire("beforeunload"); // écouteurs retirés → sans effet
    expect(h.events().filter((e) => e === "session")).toHaveLength(1);
  });

  it("start() deux fois ne double pas les écouteurs", () => {
    const h = harness({ slug: "s" });
    h.tracker.start();
    h.tracker.start();
    expect(h.timers).toHaveLength(2); // inactivité + session, une seule fois
    expect(h.events()).toEqual(["open"]);
  });

  // Perdre une mesure est ennuyeux ; perdre l'affichage du document est inacceptable.
  it("un transport qui échoue n'interrompt pas la lecture", () => {
    const h = harness({ slug: "s", send: () => { throw new Error("réseau coupé"); } });
    expect(() => { h.tracker.start(); h.tracker.setPage(2); h.tracker.flush(); }).not.toThrow();
    expect(h.tracker.maxPage()).toBe(2); // l'état interne reste juste
  });
});

// ⚠️ LE TEMPS PEUT SAUTER SANS QU'AUCUN ÉVÉNEMENT NE PRÉVIENNE.
//
// Machine en veille, capot rabattu, processus gelé : l'onglet reste `visible`, la fenêtre garde le
// focus, aucun `visibilitychange` ni `blur` ne part — et les minuteries ne tournent pas non plus,
// donc la boucle d'inactivité ne peut pas faire son travail. Au réveil, un delta brut versait la
// totalité du sommeil dans la page courante : **28 805 secondes** pour huit heures de veille.
//
// Ce n'est pas un cas tordu, c'est la façon dont un portable se ferme le soir. Et c'est
// exactement le nombre sur lequel repose tout le produit — « ce client a lu pendant douze
// minutes » n'a de valeur que si le nombre est honnête quand il est petit ET quand il est grand.
//
// Trouvé en vérifiant une relecture externe qui pointait le bon endroit avec le mauvais
// diagnostic : elle recommandait de couper sur `visibilitychange`, ce qui était déjà fait depuis
// le premier jour. Le trou était là où aucun événement ne part.
describe("tracking — le temps qui saute", () => {
  it("huit heures de veille ne font pas huit heures de lecture", () => {
    const h = harness();
    h.tracker.start();
    h.tracker.setPage(1);
    h.advance(5000);
    h.fire("mousemove");        // dernière activité réelle
    h.advance(8 * 3600_000);    // capot rabattu : ni événement, ni minuterie
    h.tickTimers();             // réveil
    // Jusqu'à la dernière activité, plus le délai de grâce — ce que la boucle d'inactivité aurait
    // décompté si elle avait pu tourner.
    expect(h.tracker.totalSeconds()).toBeLessThanOrEqual(SESSION_IDLE_MS / 1000 + 10);
    expect(h.tracker.totalSeconds()).toBeGreaterThanOrEqual(60);
  });

  it("le plafond vaut aussi pour le total lu en cours de route", () => {
    const h = harness();
    h.tracker.start();
    h.tracker.setPage(1);
    h.advance(3000);
    h.fire("scroll");
    h.advance(4 * 3600_000);    // veille, SANS réveil des minuteries
    expect(h.tracker.totalSeconds()).toBeLessThanOrEqual(SESSION_IDLE_MS / 1000 + 10);
  });

  // ⚠️ Le plafond ne doit pas rogner une lecture NORMALE : quelqu'un qui lit produit des
  // événements, donc `lastActivity` avance et le plafond avance avec lui.
  it("une lecture active longue n'est pas rognée", () => {
    const h = harness();
    h.tracker.start();
    h.tracker.setPage(1);
    for (let i = 0; i < 20; i++) { h.advance(10_000); h.fire("mousemove"); }  // 200 s, actif
    expect(h.tracker.totalSeconds()).toBeGreaterThanOrEqual(195);
    expect(h.tracker.totalSeconds()).toBeLessThanOrEqual(205);
  });

  // Lire sans bouger reste lire, tant qu'on est sous le seuil d'inactivité.
  it("une pause silencieuse sous le seuil compte toujours", () => {
    const h = harness();
    h.tracker.start();
    h.tracker.setPage(1);
    h.advance(30_000);
    expect(h.tracker.totalSeconds()).toBeGreaterThanOrEqual(29);
  });
});
