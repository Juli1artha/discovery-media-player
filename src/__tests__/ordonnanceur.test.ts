// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN SIGNAL RELU N'EST PAS ROBUSTE SI L'ATTAQUANT PEUT EMPÊCHER LA RELECTURE D'ARRIVER.
//
// Depuis 0.1.19, toute la défense du canal Realtime public repose sur une relecture : on cesse de
// croire le transport, on relit la source de vérité. Ce qui était écrit :
//
//     function relireEtat(){ clearTimeout(t); t = setTimeout(relire, 120); }
//
// Le commentaire disait « groupé : dix diffusions d'affilée ne doivent pas produire dix requêtes ».
// L'intention est bonne, la forme la retourne : `clearTimeout` REPOUSSE l'échéance. Un participant
// qui diffuse toutes les 100 ms la repousse indéfiniment — la relecture n'arrive JAMAIS.
//
// ⚠️ Affamer la relecture ne falsifie rien : ça empêche l'audience d'apprendre quoi que ce soit. Les
// pages ne tournent plus, le chat se fige, et aucune erreur ne le dit. C'est la panne la plus
// difficile à diagnostiquer, parce que tout a l'air de fonctionner.
//
// Signalé par la seconde passe d'audit (P0-2).

import { describe, expect, it } from "vitest";

import { createScheduler } from "../live";

/** Un temps et des minuteurs qu'on avance à la main : une cadence ne se teste pas en attendant. */
function banc() {
  let t = 0;
  const poses: { a: number; f: () => void; id: number }[] = [];
  let seq = 0;
  return {
    now: () => t,
    setTimer: (f: () => void, d: number) => { const id = ++seq; poses.push({ a: t + d, f, id }); return id; },
    clearTimer: (h: unknown) => { const i = poses.findIndex((p) => p.id === h); if (i >= 0) poses.splice(i, 1); },
    /** Avance le temps et déclenche ce qui doit l'être, dans l'ordre. */
    avancer(ms: number) {
      const fin = t + ms;
      for (;;) {
        poses.sort((a, b) => a.a - b.a);
        const p = poses[0];
        if (!p || p.a > fin) break;
        poses.shift();
        t = p.a;
        p.f();
      }
      t = fin;
    },
    enAttente: () => poses.length,
  };
}

describe("un flot continu de signaux ne repousse plus la relecture", () => {
  // ⚠️ LE TEST QUI MANQUAIT. C'est exactement le scénario de l'audit : un participant hostile
  // diffuse plus vite que le délai de groupage, sans jamais s'arrêter.
  it("une diffusion toutes les 100 ms n'empêche pas l'exécution", () => {
    const b = banc();
    let executions = 0;
    const o = createScheduler((fini) => { executions++; fini(); },
      { minMs: 300, now: b.now, setTimer: b.setTimer, clearTimer: b.clearTimer });

    for (let i = 0; i < 100; i++) { o.signaler(); b.avancer(100); }   // 10 s de harcèlement

    expect(executions, "avec clearTimeout, ce compteur restait à 0 pour toujours").toBeGreaterThan(0);
    // Et la cadence tient : ~10 s à une exécution toutes les 300 ms au plus.
    expect(executions).toBeLessThanOrEqual(Math.ceil(10_000 / 300) + 1);
  });

  // ⚠️ CE TEST VIENT D'UNE MUTATION QUI A SURVÉCU, ET DE CE QU'ELLE A APPRIS.
  //
  // En remettant un `clearTimeout` dans `programmer`, les tests restaient verts. Première lecture :
  // « le test est faible ». Mauvaise. La vraie raison est que L'ÉCHÉANCE EST ABSOLUE : `attente` se
  // calcule depuis `dernier`, pas depuis maintenant, donc reposer le minuteur retombe exactement au
  // même instant. Les deux formes sont équivalentes — reprogrammer NE PEUT PAS repousser, par
  // construction.
  //
  // C'est ce qui distingue cet ordonnanceur du debounce d'origine, où le délai partait de l'instant
  // du signal. Le `if (minuteur !== null) return;` reste utile — il évite de jeter et reposer un
  // minuteur à chaque signal — mais c'est de l'économie, pas la propriété de sûreté.
  //
  // Ce test-ci pin ce qui est vraiment observable : une seule échéance en attente, une seule reprise.
  it("les signaux reçus dans la fenêtre de cadence n'empilent pas les échéances", () => {
    const b = banc();
    let executions = 0;
    const o = createScheduler((fini) => { executions++; fini(); },
      { minMs: 1000, now: b.now, setTimer: b.setTimer, clearTimer: b.clearTimer });

    o.signaler();                                  // part tout de suite
    expect(executions).toBe(1);
    for (let i = 0; i < 20; i++) { b.avancer(10); o.signaler(); }   // 20 signaux dans la fenêtre
    expect(b.enAttente(), "une seule échéance, pas vingt").toBeLessThanOrEqual(1);
    b.avancer(2000);
    expect(executions, "et une seule reprise à l'ouverture de la fenêtre").toBe(2);
  });

  it("cent signaux dans la même milliseconde ne font pas cent requêtes", () => {
    const b = banc();
    let executions = 0;
    const o = createScheduler((fini) => { executions++; fini(); },
      { minMs: 300, now: b.now, setTimer: b.setTimer, clearTimer: b.clearTimer });

    for (let i = 0; i < 100; i++) o.signaler();
    b.avancer(1000);
    expect(executions, "c'est l'amplification vers l'API, l'autre moitié du constat")
      .toBeLessThanOrEqual(2);
  });
});

describe("une seule requête en vol", () => {
  it("les signaux reçus pendant une exécution n'en ouvrent pas d'autre", () => {
    const b = banc();
    let ouvertes = 0;
    let terminer: (() => void) | null = null;
    const o = createScheduler((fini) => { ouvertes++; terminer = fini; },
      { minMs: 0, now: b.now, setTimer: b.setTimer, clearTimer: b.clearTimer });

    o.signaler();
    expect(ouvertes).toBe(1);
    for (let i = 0; i < 10; i++) o.signaler();
    expect(ouvertes, "dix signaux pendant une requête en vol").toBe(1);

    terminer!();
    expect(ouvertes, "et une seule reprise à la fin, pas dix").toBe(2);
  });

  // ⚠️ LE DERNIER SIGNAL EST TOUJOURS SERVI. Borner sans ça reviendrait à perdre le signal qui
  // comptait — la dernière page tournée, le dernier message.
  it("ce qui arrive pendant une exécution en déclenche une autre après", () => {
    const b = banc();
    const vus: number[] = [];
    let terminer: (() => void) | null = null;
    let n = 0;
    const o = createScheduler((fini) => { vus.push(++n); terminer = fini; },
      { minMs: 0, now: b.now, setTimer: b.setTimer, clearTimer: b.clearTimer });

    o.signaler();
    o.signaler();          // arrive pendant la première
    terminer!();
    expect(vus).toEqual([1, 2]);

    terminer!();
    expect(vus, "et sans nouveau signal, on s'arrête").toEqual([1, 2]);
  });

  it("un `fini` appelé deux fois n'ouvre pas deux exécutions", () => {
    const b = banc();
    let ouvertes = 0;
    let terminer: (() => void) | null = null;
    const o = createScheduler((fini) => { ouvertes++; terminer = fini; },
      { minMs: 0, now: b.now, setTimer: b.setTimer, clearTimer: b.clearTimer });
    o.signaler();
    o.signaler();
    terminer!();
    const apres = ouvertes;
    terminer!();
    expect(ouvertes).toBe(apres);
  });
});

describe("la cadence minimale tient", () => {
  it("jamais plus d'une exécution par minMs", () => {
    const b = banc();
    const instants: number[] = [];
    const o = createScheduler((fini) => { instants.push(b.now()); fini(); },
      { minMs: 500, now: b.now, setTimer: b.setTimer, clearTimer: b.clearTimer });

    for (let i = 0; i < 200; i++) { o.signaler(); b.avancer(50); }   // 10 s, signal toutes les 50 ms
    for (let i = 1; i < instants.length; i++) {
      expect(instants[i] - instants[i - 1], `entre ${instants[i - 1]} et ${instants[i]}`)
        .toBeGreaterThanOrEqual(500);
    }
    expect(instants.length).toBeGreaterThan(1);
  });

  it("`maintenant()` passe outre — c'est le filet périodique", () => {
    const b = banc();
    let executions = 0;
    const o = createScheduler((fini) => { executions++; fini(); },
      { minMs: 10_000, now: b.now, setTimer: b.setTimer, clearTimer: b.clearTimer });

    o.signaler();
    expect(executions).toBe(1);
    o.signaler();
    b.avancer(100);
    expect(executions, "la cadence bloque").toBe(1);
    o.maintenant();
    expect(executions, "le filet doit pouvoir rattraper un signal perdu").toBe(2);
  });
});

describe("l'arrêt est un arrêt", () => {
  it("plus rien ne part après arreter(), et rien ne reste en attente", () => {
    const b = banc();
    let executions = 0;
    const o = createScheduler((fini) => { executions++; fini(); },
      { minMs: 500, now: b.now, setTimer: b.setTimer, clearTimer: b.clearTimer });

    o.signaler();
    o.signaler();
    o.arreter();
    b.avancer(10_000);
    o.signaler();
    o.maintenant();
    b.avancer(10_000);
    expect(executions, "une page démontée ne doit plus interroger le serveur").toBe(1);
    expect(b.enAttente()).toBe(0);
  });
});
