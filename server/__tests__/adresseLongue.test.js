// UNE ADRESSE TROP LONGUE BLOQUAIT L'INSTANCE ENTIÈRE.
//
// Le re-partage validait l'adresse avec `/.+@.+\..+/`. Ce motif reprend à chaque position de
// départ : son coût croît avec le CARRÉ de la longueur. Mesuré avant de corriger — 49 ms sur
// 10 000 caractères, 3 900 ms sur 100 000.
//
// ⚠️ Ce n'est pas une lenteur pour l'appelant, c'est un arrêt pour tout le monde : Node a une seule
// boucle d'événements, et une expression régulière ne rend pas la main. Une requête, quatre
// secondes d'instance figée — pour tous les lecteurs, pas seulement celui qui l'a envoyée.
//
// ⚠️ Et le débit ne protégeait pas : la limite de 8/h par IP est vérifiée APRÈS le motif. Une
// garde placée derrière ce qu'elle doit garder ne garde rien.
//
// Signalé par l'analyse statique (js/polynomial-redos).

const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "handler.js"), "utf8");

describe("le coût du motif d'adresse", () => {
  // On mesure le motif lui-même : c'est lui l'objet du test, et sa forme n'a pas changé — seule
  // la longueur qu'on lui donne a changé.
  const MOTIF = /.+@.+\..+/;
  const cout = (n) => {
    const t = process.hrtime.bigint();
    MOTIF.test("a".repeat(n));
    return Number(process.hrtime.bigint() - t) / 1e6;
  };

  it("croît avec le carré de la longueur — c'est bien un piège, pas une intuition", () => {
    const petit = Math.max(cout(4000), 0.5);
    const grand = cout(16000);
    // ×4 en longueur devrait donner ×4 en temps si le coût était linéaire. Il donne ~×16.
    expect(grand / petit, `4 000 → ${petit.toFixed(1)} ms, 16 000 → ${grand.toFixed(1)} ms`)
      .toBeGreaterThan(6);
  });

  it("borné à 254, il ne coûte plus rien", () => {
    expect(cout(254)).toBeLessThan(5);
  });
});

describe("la borne est posée avant le motif, pas après", () => {
  const ligne = SRC.split("\n").find((l) => l.includes("error: \"email\""));

  it("la longueur est vérifiée dans la même condition", () => {
    expect(ligne, "la ligne de validation existe").toBeTruthy();
    expect(ligne).toMatch(/mail\.length > 254/);
  });

  // ⚠️ L'ORDRE EST LE FOND. `length > 254 || motif` court-circuite : le motif n'est jamais atteint
  // sur une chaîne longue. Écrite dans l'autre sens, la borne serait décorative.
  it("la longueur passe en premier dans le OU", () => {
    const i = ligne.indexOf("mail.length");
    const j = ligne.indexOf(".test(mail)");
    expect(i, "sinon le motif s'exécute quand même").toBeLessThan(j);
  });
});
