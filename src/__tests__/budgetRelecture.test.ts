// LA LIMITE DE 0.1.42 A CRÉÉ UN DÉNI DE SERVICE SUR L'AUDIENCE.
//
// Le quota serveur est par ADRESSE, et je l'ai calibré sur ce qu'un usage légitime consomme. Mais la
// cadence de relecture n'est pas choisie par le spectateur : elle est choisie par QUI DIFFUSE. Un
// participant hostile qui émet à haute fréquence fait relire chaque spectateur jusqu'à ~9 000 fois
// par heure — l'ordonnanceur regroupe à 400 ms, c'est le plafond mécanique. Trois spectateurs
// derrière la sortie internet d'un bureau dépassent alors le quota, prennent des 429, et leurs pages
// cessent de tourner.
//
// ⚠️ Avant la limite, un tel participant coûtait cher. Après, il peut faire TAIRE. C'est la leçon de
// `X-Forwarded-For` retournée : la limite ne repose pas sur ce que l'appelant choisit — mais elle est
// payée par quelqu'un qui ne choisit pas non plus.
//
// On borne donc la CAUSE, pas l'effet : baisser le quota punirait davantage la victime. Le
// spectateur se donne son propre budget et ne relit jamais plus que ce que les actions d'un
// présentateur justifient.

import { describe, expect, it } from "vitest";

import {
  PRESENTER_ACTIONS_PER_HOUR,
  PRESENT_QUOTA_PER_HOUR,
  PRESENT_READS_PER_HOUR,
  PRESENT_READ_BURST,
  PRESENT_SIGNAL_BUDGET_PER_HOUR,
  READERS_PER_EGRESS,
  RESYNC_READS_PER_HOUR,
} from "../cadence";
import { createBudget } from "../live";

function banc(parHeure = PRESENT_SIGNAL_BUDGET_PER_HOUR, rafale = PRESENT_READ_BURST) {
  let t = 0;
  const b = createBudget({ parHeure, rafale, now: () => t });
  return {
    budget: b,
    avancer: (ms: number) => { t += ms; },
    /** Combien de relectures passent si on en demande sans relâche pendant `ms` ? */
    marteler: (ms: number, pas = 400) => {
      let passees = 0;
      for (let i = 0; i < ms; i += pas) { if (b.prendre()) passees++; t += pas; }
      return passees;
    },
  };
}

describe("un spectateur ne relit jamais plus que sa part", () => {
  // ⚠️ LE TEST QUI PORTE LE CORRECTIF : le martèlement, à la cadence maximale de l'ordonnanceur.
  it("un diffuseur hostile ne fait plus relire 9 000 fois par heure", () => {
    const b = banc();
    const passees = b.marteler(3_600_000);          // une heure de signaux toutes les 400 ms
    const plafondMecanique = 3_600_000 / 400;       // 9 000 : ce que l'ordonnanceur seul autorise

    expect(passees, "c'était la porte : la salle entière dépassait le quota et prenait des 429")
      .toBeLessThan(plafondMecanique / 5);
    expect(passees, "et le budget doit être tenu, à la rafale près")
      .toBeLessThanOrEqual(PRESENT_SIGNAL_BUDGET_PER_HOUR + PRESENT_READ_BURST);
  });

  it("mais une présentation normale n'est pas rationnée", () => {
    const b = banc();
    let passees = 0;
    // Un présentateur qui tourne une page toutes les cinq secondes pendant une demi-heure.
    for (let i = 0; i < 360; i++) { if (b.budget.prendre()) passees++; b.avancer(5_000); }
    expect(passees, "rationner un usage réel remplacerait un déni de service par un autre")
      .toBe(360);
  });

  it("une salve immédiate passe : une page tournée s'affiche tout de suite", () => {
    const b = banc();
    let passees = 0;
    for (let i = 0; i < PRESENT_READ_BURST; i++) if (b.budget.prendre()) passees++;
    expect(passees, "sans rafale, le budget serait juste et la présentation poussive")
      .toBe(PRESENT_READ_BURST);
  });

  it("et le budget se recharge avec le temps, il ne s'épuise pas définitivement", () => {
    const b = banc();
    b.marteler(600_000);                              // dix minutes de martèlement : à sec
    expect(b.budget.prendre(), "à sec, on refuse").toBe(false);
    b.avancer(3_600_000);                             // une heure de calme
    expect(b.budget.prendre(), "un budget qui ne se recharge pas fige l'audience pour de bon")
      .toBe(true);
  });
});

// ⚠️ LES DEUX NOMBRES SONT UN SEUL CONTRAT. C'est la discipline de ce module : le quota serveur et
// le budget client se déduisent l'un de l'autre, sinon ils divergent en silence — exactement ce qui
// s'est passé entre la cadence d'écriture des sessions et son quota.
describe("le budget du client est sa part du quota du serveur", () => {
  it("signalé + filet = ce qu'un spectateur consomme, par construction", () => {
    expect(PRESENT_SIGNAL_BUDGET_PER_HOUR + RESYNC_READS_PER_HOUR).toBe(PRESENT_READS_PER_HOUR);
  });

  it("et une salle pleine reste dans le quota, même sous martèlement", () => {
    const b = banc();
    const parSpectateur = b.marteler(3_600_000) + RESYNC_READS_PER_HOUR;
    expect(parSpectateur * READERS_PER_EGRESS,
      "c'est la propriété qui ferme le déni de service : marteler ne fait plus dépasser la salle")
      .toBeLessThanOrEqual(PRESENT_QUOTA_PER_HOUR);
  });

  it("le budget signalé suit les actions d'un présentateur, il n'est pas écrit à la main", () => {
    expect(PRESENT_SIGNAL_BUDGET_PER_HOUR).toBe(PRESENTER_ACTIONS_PER_HOUR);
  });

  // ⚠️ On fixe la relation, pas le nombre. Une rafale au plafond mécanique ne bornerait rien ; une
  // rafale d'une seule relecture rendrait la présentation poussive.
  it("la rafale est courte devant le budget, et n'est pas nulle", () => {
    expect(PRESENT_READ_BURST).toBeGreaterThan(1);
    expect(PRESENT_READ_BURST).toBeLessThan(PRESENT_SIGNAL_BUDGET_PER_HOUR / 10);
  });
});
