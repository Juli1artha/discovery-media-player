// SIX APPELANTS, DEUX PROTÉGÉS.
//
// Deux ordonnanceurs couvraient une partie des écritures de carte ; `pushPage`, `showMap`,
// `hideMap`, `toMap` et la recherche Street View écrivaient directement. Le correctif de 0.1.41, qui
// annonçait « les écritures de carte sont séquentielles », n'en séquençait qu'un chemin sur trois.
//
// ⚠️ Demander à chaque appelant de passer par la bonne porte, c'est une LISTE : le prochain
// l'oubliera, et rien ne le dira. Ce sont donc les fonctions d'écriture elles-mêmes qui deviennent
// ordonnées — il n'existe plus de chemin direct, donc plus rien à oublier.
//
// Signalé par la vérification d'audit (V-2) ; la forme du correctif vient du second hôte, dont la
// remarque sur le cache disait la même chose : « une liste se périme, une forme non ».

import { describe, expect, it } from "vitest";

import { createFileEcritures } from "../live";

/** Des minuteries qu'on avance à la main, et un journal de ce qui part réellement. */
function banc(minMs = 0) {
  let t = 0;
  const poses: { echeance: number; f: () => void }[] = [];
  const journal: string[] = [];
  const file = createFileEcritures({
    minMs,
    now: () => t,
    setTimer: (f, d) => { poses.push({ echeance: t + d, f }); return poses.length; },
  });
  /** Une écriture qui met `duree` à revenir — c'est elle qui crée le désordre. */
  const ecriture = (nom: string, duree = 0) => () =>
    new Promise((ok) => {
      journal.push(`départ:${nom}`);
      const fin = t + duree;
      if (duree === 0) { journal.push(`fin:${nom}`); ok(null); return; }
      poses.push({ echeance: fin, f: () => { journal.push(`fin:${nom}`); ok(null); } });
    });
  return {
    file, journal,
    ecriture,
    // ⚠️ ON VIDANGE LARGEMENT LES MICROTÂCHES, ET CE N'EST PAS DU CONFORT. La chaîne interne de la
    // file compte trois maillons (`tache` → `regler` → `pomper`) : en n'en vidangeant que deux, le
    // banc observait un état intermédiaire et accusait la file de ne pas dépiler. Quatre tests ont
    // échoué pour cette seule raison — un banc qui regarde trop tôt invente des défauts.
    avancer: async (ms: number) => {
      // ⚠️ ON VIDANGE AVANT DE SCRUTER. Une tâche démarre sur une MICROTÂCHE : sa minuterie de fin
      // n'existe donc pas encore au moment où le banc regarde. Sans cette vidange préalable, le banc
      // avançait le temps au-delà d'une échéance qui n'était pas encore posée, et concluait que la
      // file n'avait rien dépilé.
      for (let i = 0; i < 12; i++) await Promise.resolve();
      const fin = t + ms;
      for (;;) {
        const due = poses.filter((p) => p.echeance <= fin).sort((a, b) => a.echeance - b.echeance)[0];
        if (!due) break;
        poses.splice(poses.indexOf(due), 1);
        t = due.echeance;
        due.f();
        for (let i = 0; i < 12; i++) await Promise.resolve();
      }
      t = fin;
      for (let i = 0; i < 12; i++) await Promise.resolve();
    },
    respirer: async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); },
  };
}

describe("une seule écriture en vol", () => {
  // ⚠️ LE DÉFAUT D'ORIGINE : deux PATCH partent ensemble, et c'est le RÉSEAU qui décide lequel
  // arrive en dernier. Une page ancienne peut alors écraser une plus récente.
  it("la seconde attend la première, même si elle est plus rapide", async () => {
    const b = banc();
    b.file.poser("page", b.ecriture("lente", 1000));
    b.file.poser("carte", b.ecriture("rapide", 10));
    await b.respirer();

    expect(b.journal, "la rapide ne doit pas être partie avant la fin de la lente")
      .toEqual(["départ:lente"]);

    await b.avancer(1000);
    await b.avancer(50);
    expect(b.journal).toEqual(["départ:lente", "fin:lente", "départ:rapide", "fin:rapide"]);
  });
});

describe("regroupement par genre", () => {
  // Tourner trois pages pendant qu'une écriture est en vol ne doit produire qu'une écriture : la
  // dernière. Sinon la file transmet fidèlement un désordre qu'elle aurait pu absorber.
  it("trois pages tournées pendant un envoi n'en écrivent qu'une : la dernière", async () => {
    const b = banc();
    b.file.poser("page", b.ecriture("p1", 1000));
    await b.respirer();
    b.file.poser("page", b.ecriture("p2"));
    b.file.poser("page", b.ecriture("p3"));
    b.file.poser("page", b.ecriture("p4"));
    await b.avancer(1000);

    expect(b.journal.filter((l) => l.startsWith("départ")), "p2 et p3 sont périmées avant même de partir")
      .toEqual(["départ:p1", "départ:p4"]);
  });

  // ⚠️ MAIS UNE PAGE ET UNE CARTE SONT DEUX FAITS DIFFÉRENTS. Les regrouper ensemble en perdrait un :
  // le présentateur tourne la page ET déplace sa carte, les deux doivent arriver.
  it("deux genres ne se regroupent pas entre eux", async () => {
    const b = banc();
    b.file.poser("page", b.ecriture("p1", 100));
    b.file.poser("carte", b.ecriture("c1"));
    await b.avancer(500);
    expect(b.journal.filter((l) => l.startsWith("départ"))).toEqual(["départ:p1", "départ:c1"]);
  });

  // ⚠️ Et le remplacement ne DÉPLACE PAS la demande dans la file : l'ordre entre genres est celui de
  // la première demande de chaque genre. Sinon une carte agitée passerait sans cesse devant une page.
  it("remplacer une écriture ne la fait pas doubler les autres", async () => {
    const b = banc();
    b.file.poser("page", b.ecriture("bloque", 1000));
    await b.respirer();
    b.file.poser("carte", b.ecriture("c1"));
    b.file.poser("page", b.ecriture("p2"));
    b.file.poser("carte", b.ecriture("c2"));
    await b.avancer(1000);

    expect(b.journal.filter((l) => l.startsWith("départ")),
      "la carte était demandée en premier, elle reste en premier")
      .toEqual(["départ:bloque", "départ:c2", "départ:p2"]);
  });

  it("une écriture remplacée voit quand même sa promesse se régler", async () => {
    const b = banc();
    b.file.poser("page", b.ecriture("bloque", 100));
    await b.respirer();
    let reglee = false;
    b.file.poser("page", b.ecriture("perimee")).then(() => { reglee = true; });
    b.file.poser("page", b.ecriture("finale"));
    await b.avancer(200);
    expect(reglee, "superposée n'est pas perdue : celui qui attendait doit être libéré").toBe(true);
  });
});

describe("un rythme minimum", () => {
  // Un déplacement de carte à la souris produirait sinon une écriture par image. Ce rythme remplace
  // les deux ordonnanceurs que la file absorbe.
  it("deux écritures d'affilée sont espacées", async () => {
    const b = banc(500);
    b.file.poser("carte", b.ecriture("c1"));
    await b.respirer();
    b.file.poser("carte", b.ecriture("c2"));
    await b.avancer(100);
    expect(b.journal.filter((l) => l.startsWith("départ")), "trop tôt").toEqual(["départ:c1"]);
    await b.avancer(500);
    expect(b.journal.filter((l) => l.startsWith("départ"))).toEqual(["départ:c1", "départ:c2"]);
  });
});

describe("un échec ne bloque pas la file", () => {
  it("la suivante part quand même", async () => {
    const b = banc();
    b.file.poser("page", () => Promise.reject(new Error("réseau")));
    b.file.poser("carte", b.ecriture("c1"));
    await b.respirer();
    await b.respirer();
    expect(b.journal, "une écriture perdue ne doit pas emporter les suivantes").toContain("départ:c1");
  });

  it("et celui qui l'attendait n'est pas laissé en suspens", async () => {
    const b = banc();
    let regle = false;
    b.file.poser("page", () => Promise.reject(new Error("réseau"))).then(() => { regle = true; });
    await b.respirer();
    await b.respirer();
    expect(regle, "un appelant qui attend une écriture ratée doit être libéré").toBe(true);
  });
});
