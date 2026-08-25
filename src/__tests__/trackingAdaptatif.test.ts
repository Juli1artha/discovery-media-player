// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE SESSION IDENTIQUE NE SE RÉÉCRIT PAS — LE FILET PÉRIODIQUE NE PAIE QUE CE QUI A CHANGÉ.
//
// ⚠️ P1 « réduction de charge ». Le filet de persistance tournait à cadence fixe et RÉÉMETTAIT à
// chaque tick, même quand la mesure n'avait pas bougé d'un iota : un onglet caché, un lecteur
// inactif, un document laissé ouvert écrivaient une session à l'identique toutes les N secondes.
// Autant d'écritures base pour zéro information nouvelle. Le drapeau « dirty » (ici : la signature
// (totalSeconds, maxPage, numPages) comparée à la dernière ENVOYÉE) coupe ces réémissions : le tick
// n'écrit que si quelque chose a réellement changé depuis le dernier envoi.
//
// La cadence de base passe par ailleurs de 12 s à 30 s (SESSION_INTERVAL_MS) — 2,5× moins même pour
// un lecteur pleinement actif — et le quota s'en déduit toujours (cf. cadence.test.ts).

import { describe, it, expect } from "vitest";
import { createTracker, type TrackerOptions } from "../tracking";

function harness(over: Partial<TrackerOptions> = {}) {
  const sent: Array<Record<string, unknown>> = [];
  const listeners = new Map<string, Set<() => void>>();
  const timers: Array<{ fn: () => void; every: number; id: number }> = [];
  let clock = 1_000_000;
  let visible = true;
  let nextTimer = 1;
  const target = {
    addEventListener: (type: string, h: () => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(h);
    },
    removeEventListener: (type: string, h: () => void) => { listeners.get(type)?.delete(h); },
  };
  const doc = { ...target, get visibilityState() { return visible ? "visible" : "hidden"; } } as unknown as Document;
  const win = {
    ...target,
    setInterval: (fn: () => void, every: number) => { const id = nextTimer++; timers.push({ fn, every, id }); return id; },
    clearInterval: (id: number) => { const i = timers.findIndex((t) => t.id === id); if (i >= 0) timers.splice(i, 1); },
  } as unknown as Window;
  const tracker = createTracker({ doc, win, now: () => clock, send: (p) => sent.push(p), sessionId: "s1", ...over });
  return {
    tracker, sent,
    advance: (ms: number) => { clock += ms; },
    fire: (type: string) => listeners.get(type)?.forEach((h) => h()),
    hide: () => { visible = false; },
    // Le filet périodique = la minuterie la plus lente (celle de session, pas celle d'inactivité à 5 s).
    tickSession: () => { const t = timers.slice().sort((a, b) => b.every - a.every)[0]; if (t) t.fn(); },
    sessions: () => sent.filter((p) => p.event === "session").length,
  };
}

describe("tracking adaptatif — le filet ne réémet que ce qui a changé", () => {
  it("un lecteur actif : chaque tick apporte du temps neuf, donc écrit", () => {
    const h = harness({ slug: "s" });
    h.tracker.start();
    h.advance(30_000); h.tickSession();
    h.advance(30_000); h.tickSession();
    expect(h.sessions()).toBe(2);
  });

  it("rien de neuf entre deux ticks ⇒ AUCUNE réémission", () => {
    const h = harness({ slug: "s" });
    h.tracker.start();
    h.advance(30_000); h.tickSession();     // 1re écriture : 30 s lues
    const apres = h.sessions();
    h.tickSession();                         // aucun temps écoulé, même page
    h.tickSession();
    expect(h.sessions(), "une session identique ne doit pas être réécrite").toBe(apres);
  });

  it("un onglet caché n'écrit qu'une fois, pas à chaque tick", () => {
    const h = harness({ slug: "s" });
    h.tracker.start();
    h.advance(10_000);
    h.hide(); h.fire("visibilitychange");    // met en pause + persiste une fois (10 s lues)
    const apres = h.sessions();
    h.tickSession(); h.tickSession(); h.tickSession(); // caché : rien ne change
    expect(h.sessions(), "un onglet caché ne réémet pas de session à l'identique").toBe(apres);
  });

  it("après une pause, tourner une page rouvre l'écriture", () => {
    const h = harness({ slug: "s" });
    h.tracker.start();
    h.advance(30_000); h.tickSession();
    const apres = h.sessions();
    h.tickSession();                         // rien de neuf → sauté
    expect(h.sessions()).toBe(apres);
    h.advance(5_000); h.tracker.setPage(2); h.tickSession(); // progression réelle
    expect(h.sessions()).toBe(apres + 1);
  });
});

// ⚠️ P2 audit CODEX 5.6 — RÉGRESSION DE 0.1.85, LA MIENNE. La signature « déjà envoyée » était
// mémorisée AVANT l'appel au transport, et `post()` avale les exceptions comme `sendBeacon` peut
// renvoyer `false` sans lever. Un envoi raté verrouillait donc la mesure : le tick suivant, à mesure
// identique, était sauté. Pour un lecteur actif ça se rattrape (le temps avance) ; s'il passe inactif
// ou ferme juste après, la DERNIÈRE mesure disparaît. La signature ne doit être retenue QUE si
// l'envoi est parti — un `false` explicite ou une exception = non parti, on réessaiera.
describe("tracking adaptatif — un envoi qui échoue est réessayé, pas verrouillé", () => {
  // On ne compte que les `session` — `start()` émet aussi un `open`, hors sujet ici.
  const nbSessions = (recus: Array<Record<string, unknown>>) => recus.filter((p) => p.event === "session").length;

  it("transport qui JETTE : le tick suivant réémet la même mesure", () => {
    let jette = true;
    const recus: Array<Record<string, unknown>> = [];
    const h = harness({ slug: "s", send: (p) => { if (jette) throw new Error("réseau coupé"); recus.push(p); } });
    h.tracker.start();
    h.advance(30_000); h.tickSession();          // 1re tentative : le transport jette
    expect(nbSessions(recus), "l'exception est avalée, rien n'est parti").toBe(0);
    jette = false;
    h.tickSession();                              // même mesure → DOIT réessayer
    expect(nbSessions(recus), "un envoi raté n'est pas verrouillé").toBe(1);
  });

  it("sendBeacon renvoie false (file pleine) : idem, réessai", () => {
    let ok = false;
    const recus: Array<Record<string, unknown>> = [];
    const h = harness({ slug: "s", send: (p) => { if (!ok) return false; recus.push(p); return true; } });
    h.tracker.start();
    h.advance(30_000); h.tickSession();
    expect(nbSessions(recus)).toBe(0);
    ok = true;
    h.tickSession();
    expect(nbSessions(recus), "un false explicite = non parti").toBe(1);
  });

  it("un envoi RÉUSSI reste sauté au tick suivant (le dirty tient toujours)", () => {
    const recus: Array<Record<string, unknown>> = [];
    const h = harness({ slug: "s", send: (p) => { recus.push(p); return true; } });
    h.tracker.start();
    h.advance(30_000); h.tickSession();
    h.tickSession();                              // même mesure, envoi précédent réussi → sauté
    expect(nbSessions(recus)).toBe(1);
  });
});
