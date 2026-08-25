// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'EXPORT PUBLIC `recordAttendance(slug, participant)` DOIT RESTER APPELABLE À DEUX ARGUMENTS.
//
// ⚠️ P1a de l'audit CODEX 5.6 — ET C'ÉTAIT MA RÉGRESSION (0.1.84). En glissant l'optimisation
// « présentation déjà chargée » dans le 2e slot POSITIONNEL, j'ai déplacé le vrai paramètre : le
// participant est passé en 3e position, destructuré SANS défaut. Un hôte tiers appelant l'ancien
// contrat public `recordAttendance(slug, participant)` recevait alors
// `TypeError: Cannot destructure property 'key' of 'undefined'`. Le module est un export publié
// (`./presentations` dans package.json) : sa signature positionnelle est un contrat.
//
// La forme correcte remet le participant en 2e position et range l'optimisation dans un SAC
// D'OPTIONS : `recordAttendance(slug, participant, { presentation })`. Deux arguments = l'ancien
// contrat, la présentation est relue ; trois = la route fournit la présentation déjà chargée et
// aucune relecture n'a lieu.

const presentations = require("../presentations.js");

function harnais() {
  const etat = { lecturesPres: 0, inserts: 0, ligne: null };
  presentations.init({
    errors: { capture() {} },
    db: {
      async request(chemin, o) {
        // Ce banc éprouve le CONTRAT d'appel (2 vs 3 args) via la boucle de repli : RPC 0015 absente.
        if (chemin.startsWith("rpc/player_attendance_bump")) throw new Error("404 : Could not find the function");
        if (chemin.startsWith("doc_presentations?")) {
          etat.lecturesPres += 1;
          return [{ slug: "s", active: true, control_hash: "h", current_page: 2 }];
        }
        if (!o || !o.method) return etat.ligne ? [{ ...etat.ligne, pages: etat.ligne.pages.slice() }] : [];
        if (o.method === "POST") { etat.inserts += 1; etat.ligne = { ...o.body[0] }; return []; }
        if (o.method === "PATCH") { Object.assign(etat.ligne, o.body); return [{ ...etat.ligne }]; }
        return [];
      },
    },
  });
  return etat;
}

describe("recordAttendance — contrat d'export public", () => {
  it("APPEL À DEUX ARGUMENTS : ne jette pas, retombe sur une lecture de la présentation", async () => {
    const etat = harnais();
    let r;
    await expect((async () => { r = await presentations.recordAttendance("s", { key: "k", name: "L" }); })())
      .resolves.not.toThrow();
    expect(r).toEqual({ ok: true });
    expect(etat.lecturesPres, "sans présentation fournie, elle est relue").toBe(1);
    expect(etat.inserts).toBe(1);
  });

  it("APPEL À TROIS ARGUMENTS : la présentation fournie évite la relecture", async () => {
    const etat = harnais();
    const pres = { slug: "s", active: true, control_hash: "h", current_page: 5 };
    const r = await presentations.recordAttendance("s", { key: "k2", name: "M" }, { presentation: pres });
    expect(r).toEqual({ ok: true });
    expect(etat.lecturesPres, "présentation déjà chargée : aucune relecture").toBe(0);
  });

  it("participant absent : 400 propre, jamais un TypeError", async () => {
    harnais();
    await expect(presentations.recordAttendance("s")).resolves.toEqual({ ok: false, status: 400 });
  });
});
