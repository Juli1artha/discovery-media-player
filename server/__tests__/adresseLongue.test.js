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


const SRC = require("./sourceDesPages.cjs").SOURCE_PAGES;

describe("le coût du motif d'adresse", () => {
  // On mesure le motif lui-même : c'est lui l'objet du test, et sa forme n'a pas changé — seule
  // la longueur qu'on lui donne a changé.
  const MOTIF = /.+@.+\..+/;

  /**
   * Le coût du motif, estimé par le MINIMUM de plusieurs prises.
   *
   * ⚠️ CE TEST A ÉTÉ INSTABLE, ET SA MÉTHODE ÉTAIT EN CAUSE. Il prenait UNE mesure par taille : le
   * jour où l'ordonnanceur préempte le processus pendant la petite, le rapport s'effondre. Vu en
   * vrai — 5,7 au lieu de ~16 dans la suite complète, puis quatre passages sur quatre en isolation.
   * Autrement dit son verdict dépendait de la charge de la machine.
   *
   * ⚠️ Et un test instable a un danger propre, pire que l'échec : on apprend à l'ignorer, puis on
   * l'ignore le jour où il a raison.
   *
   * Le minimum est l'estimateur juste ici, et ce n'est pas « réessayer jusqu'au vert » : le bruit
   * d'ordonnancement ne fait qu'AJOUTER du temps, jamais en retirer. La plus petite prise est donc
   * la plus proche du coût intrinsèque — une moyenne, elle, intègre le bruit qu'on cherche à écarter.
   *
   * L'allocation de la chaîne sort de la zone mesurée : elle croît elle aussi avec la longueur, et
   * la compter fausserait précisément le rapport qu'on veut établir.
   */
  const cout = (n, prises = 7) => {
    const sujet = "a".repeat(n);
    let mini = Infinity;
    for (let i = 0; i < prises; i++) {
      const t = process.hrtime.bigint();
      MOTIF.test(sujet);
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      if (ms < mini) mini = ms;
    }
    return mini;
  };

  // ⚠️ DEUXIÈME PASSE DE STABILISATION, ET LA CAUSE ÉTAIT AILLEURS CETTE FOIS. Le minimum de
  // plusieurs prises avait réglé le RAPPORT ; c'est le TEMPS TOTAL qui a lâché — sept prises d'un
  // motif quadratique sur 16 000 caractères frôlent le plafond de 5 s dès que la machine est
  // chargée (vu trois fois en un après-midi, jamais deux fois de suite). Le carré étant le carré,
  // il se démontre aussi bien sur 2 000 → 8 000 pour un seizième du coût — et un plafond explicite
  // dit qu'on a PENSÉ au temps, plutôt que d'hériter du défaut global.
  it("croît avec le carré de la longueur — c'est bien un piège, pas une intuition", () => {
    const petit = Math.max(cout(2000), 0.01);
    const grand = cout(8000);
    // ×4 en longueur devrait donner ×4 en temps si le coût était linéaire. Il donne ~×16.
    expect(grand / petit, `2 000 → ${petit.toFixed(2)} ms, 8 000 → ${grand.toFixed(2)} ms`)
      .toBeGreaterThan(6);
  }, 15000);

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
