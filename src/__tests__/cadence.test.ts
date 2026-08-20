// LE QUOTA NE TENAIT PAS UN SEUL LECTEUR.
//
// Le navigateur écrivait une session interne toutes les 12 s — 300 par heure pour UNE personne — et
// le serveur en autorisait 120 par heure et par adresse. La limite était donc SOUS ce qu'un lecteur
// légitime consomme : après 24 minutes de lecture continue, tout était refusé. Et la clé étant
// l'adresse, une équipe derrière une sortie internet unique — le cas ordinaire d'une entreprise —
// se partageait un quota qu'une seule personne dépasse.
//
// ⚠️ La garde était juste dans sa FORME et fausse dans son CHIFFRE. C'est pour ça que personne ne
// l'a relue : on relit ce qui a l'air douteux, pas ce qui a l'air raisonnable.
//
// ⚠️ Et le refus était MUET. Le 429 n'apparaît que dans la console du lecteur ; le journal horaire
// ne parlait que du champ manquant, pas du quota. L'exploitant voyait une table qui ne se remplit
// pas, sans cause nommée — exactement le symptôme qu'on venait de corriger ailleurs.
//
// Trouvé par le second hôte, sur son instance, en cherchant pourquoi sa table restait vide.
//
// Ces tests ne vérifient pas des VALEURS — elles peuvent changer — mais la RELATION entre elles :
// un quota écrit à la main peut passer sous la cadence, un quota déduit ne le peut pas.

import { describe, expect, it } from "vitest";

import {
  READERS_PER_EGRESS,
  SESSION_INTERVAL_MS,
  SESSION_QUOTA_PER_HOUR,
  SESSION_WRITES_PER_HOUR,
  VIEW_EVENTS_PER_READER_HOUR,
  VIEW_QUOTA_PER_HOUR,
} from "../cadence";

describe("le quota se déduit de la cadence", () => {
  it("ce qu'un lecteur émet correspond bien à l'intervalle", () => {
    expect(SESSION_WRITES_PER_HOUR).toBe(Math.ceil(3_600_000 / SESSION_INTERVAL_MS));
  });

  // ⚠️ LE TEST QUI MANQUAIT. Il tombe pour toute valeur inférieure à 300, c'est-à-dire pour la
  // valeur qui était en production.
  it("il tient au moins un lecteur entier", () => {
    expect(SESSION_QUOTA_PER_HOUR,
      "un quota sous la cadence refuse un lecteur qui lit normalement — c'était le cas à 120/h")
      .toBeGreaterThanOrEqual(SESSION_WRITES_PER_HOUR);
  });

  it("et il en tient plusieurs, parce que l'adresse identifie un bâtiment", () => {
    expect(SESSION_QUOTA_PER_HOUR).toBe(SESSION_WRITES_PER_HOUR * READERS_PER_EGRESS);
    expect(READERS_PER_EGRESS, "dimensionner pour un seul lecteur revient à refuser le second")
      .toBeGreaterThan(1);
  });

  it("une lecture continue d'une journée de travail passe", () => {
    const heures = 8;
    const emis = SESSION_WRITES_PER_HOUR * heures;
    // Le quota est HORAIRE : ce qui compte est qu'une heure de lecture ne le remplisse pas.
    expect(SESSION_WRITES_PER_HOUR).toBeLessThan(SESSION_QUOTA_PER_HOUR);
    expect(emis / heures, "par heure, une personne reste loin du plafond")
      .toBeLessThan(SESSION_QUOTA_PER_HOUR);
  });

  // ⚠️ La clé reste l'ADRESSE, et ce n'est pas un oubli. L'identifiant de session est choisi par le
  // navigateur : un quota fondé dessus se contourne en le changeant — la leçon de
  // `X-Forwarded-For` en 0.1.22, où la limite existait et ne limitait rien. C'est le chiffre qui
  // était faux, pas la clé.
  it("le quota reste borné : ce n'est pas une porte ouverte", () => {
    expect(SESSION_QUOTA_PER_HOUR,
      "un plafond qu'aucun usage réel n'atteint ne protège plus de rien")
      .toBeLessThanOrEqual(50_000);
  });
});

// ⚠️ P1b : open/page/heartbeat ont leur PROPRE seau, sinon ils vidaient le quota des sessions. Même
// discipline — le quota se DÉDUIT du budget par lecteur, il ne s'écrit pas à la main — et il reste borné.
describe("le quota des vues légères est séparé et déduit", () => {
  it("il se déduit du budget par lecteur, jamais écrit à la main", () => {
    expect(VIEW_QUOTA_PER_HOUR).toBe(VIEW_EVENTS_PER_READER_HOUR * READERS_PER_EGRESS);
  });

  it("il est distinct de celui des sessions (c'est tout l'objet de la correction)", () => {
    expect(VIEW_QUOTA_PER_HOUR).not.toBe(SESSION_QUOTA_PER_HOUR);
  });

  it("il tient plusieurs lecteurs et reste borné", () => {
    expect(VIEW_QUOTA_PER_HOUR).toBeGreaterThan(VIEW_EVENTS_PER_READER_HOUR);
    expect(VIEW_QUOTA_PER_HOUR).toBeLessThanOrEqual(50_000);
  });
});
