// UNE REQUÊTE QUI NE REVIENT PAS BLOQUAIT TOUT CE QUI L'ATTENDAIT.
//
// ⚠️ CE RISQUE EST NÉ D'UN CORRECTIF, ET C'EST LE POINT DE CE FICHIER. Avant 0.1.41 l'ordonnanceur
// d'écritures appelait `fini()` immédiatement : les écritures partaient dans le désordre, mais rien
// ne pouvait se bloquer. En les rendant séquentielles — la requête est désormais attendue — on a
// échangé un défaut de correction contre un risque de DISPONIBILITÉ.
//
// Une requête suspendue ne règle jamais sa promesse : `fini()` n'est jamais appelé, la file ne
// repart pas, et le présentateur pilote dans le vide sans qu'aucun message ne le dise. Un navigateur
// ne garantit aucun délai de son côté — sur un réseau qui bascule, une requête peut rester en vol
// indéfiniment.
//
// Signalé par la vérification d'audit qui a suivi 0.1.43 : « si le fetch reste suspendu, fini()
// n'est jamais appelé et l'ordonnanceur reste bloqué ».
//
// ⚠️ CE QUI EST TESTÉ EST LA VIVACITÉ, PAS L'ORDRE. Une requête abandonnée peut très bien être
// arrivée au serveur et y atterrir après celle qui l'a remplacée. Garantir l'ordre malgré un abandon
// demande un numéro de version porté par l'écriture — chantier de la file unique. Le test le dit
// explicitement plus bas plutôt que de laisser croire que ce délai règle les deux.

import { describe, expect, it } from "vitest";

import { PRESENT_WRITE_TIMEOUT_MS } from "../cadence";
import { createScheduler, fetchBorne } from "../live";

/** Des minuteries qu'on avance à la main : le test ne doit jamais attendre vraiment. */
function horloge() {
  let t = 0;
  let suivant = 1;
  const poses = new Map<number, { echeance: number; f: () => void }>();
  return {
    maintenant: () => t,
    setTimer: (f: () => void, d: number) => { const id = suivant++; poses.set(id, { echeance: t + d, f }); return id; },
    clearTimer: (id: unknown) => { poses.delete(id as number); },
    enCours: () => poses.size,
    avancer: (ms: number) => {
      t += ms;
      for (const [id, m] of [...poses]) if (m.echeance <= t) { poses.delete(id); m.f(); }
    },
  };
}

const respirer = () => new Promise((r) => setTimeout(r, 0));

describe("une requête bornée rend toujours la main", () => {
  it("une requête qui ne revient JAMAIS finit par échouer", async () => {
    const h = horloge();
    const jamais = new Promise<Response>(() => {});
    let regle: string | null = null;

    fetchBorne("/api/doc", {}, 10_000, { fetch: () => jamais, setTimer: h.setTimer, clearTimer: h.clearTimer })
      .then(() => { regle = "tenue"; }, () => { regle = "rompue"; });

    h.avancer(9_999); await respirer();
    expect(regle, "avant le délai, on attend encore").toBeNull();

    h.avancer(2); await respirer();
    expect(regle, "sans ça, la promesse ne se règle jamais et la file ne repart pas").toBe("rompue");
  });

  it("elle abandonne la requête, sans en faire une condition", async () => {
    const h = horloge();
    let abandonnee = false;
    const fetchQuiEcoute: typeof fetch = (_u, o) => {
      (o?.signal as AbortSignal | undefined)?.addEventListener("abort", () => { abandonnee = true; });
      return new Promise<Response>(() => {});
    };
    fetchBorne("/api/doc", {}, 1_000, { fetch: fetchQuiEcoute, setTimer: h.setTimer, clearTimer: h.clearTimer }).catch(() => {});
    h.avancer(1_001); await respirer();
    expect(abandonnee, "on coupe le fil quand on peut — mais rendre la main compte plus").toBe(true);
  });

  it("une requête qui répond n'est pas retardée, et ne laisse pas de minuterie", async () => {
    const h = horloge();
    const reponse = { ok: true } as Response;
    const p = fetchBorne("/api/doc", {}, 10_000, { fetch: async () => reponse, setTimer: h.setTimer, clearTimer: h.clearTimer });
    await expect(p).resolves.toBe(reponse);
    expect(h.enCours(), "une minuterie oubliée par appel, c'est une fuite à la cadence des écritures")
      .toBe(0);
  });

  it("un échec réseau reste un échec, il n'est pas transformé en délai", async () => {
    const h = horloge();
    const p = fetchBorne("/api/doc", {}, 10_000, { fetch: async () => { throw new Error("reseau"); }, setTimer: h.setTimer, clearTimer: h.clearTimer });
    await expect(p).rejects.toThrow("reseau");
    expect(h.enCours()).toBe(0);
  });
});

// ⚠️ LE TEST QUI PORTE LE CORRECTIF. Les précédents décrivent la fonction ; celui-ci décrit la
// PANNE — l'ordonnanceur qui ne repart plus.
describe("l'ordonnanceur repart, même derrière une requête suspendue", () => {
  it("sans borne, la file se fige pour toujours", async () => {
    const h = horloge();
    let executions = 0;
    const ord = createScheduler((fini) => {
      executions++;
      new Promise<Response>(() => {}).then(fini as () => void, fini as () => void); // ne se règle jamais
    }, { minMs: 0, now: h.maintenant, setTimer: h.setTimer, clearTimer: h.clearTimer });

    ord.signaler(); await respirer();
    ord.signaler(); h.avancer(60_000); await respirer();
    expect(executions, "c'est la panne : une seule écriture part, et plus jamais aucune autre")
      .toBe(1);
  });

  it("avec la borne, la file repart au bout du délai", async () => {
    const h = horloge();
    let executions = 0;
    const ord = createScheduler((fini) => {
      executions++;
      fetchBorne("/api/doc", {}, 10_000, { fetch: () => new Promise<Response>(() => {}), setTimer: h.setTimer, clearTimer: h.clearTimer })
        .then(fini as () => void, fini as () => void);
    }, { minMs: 0, now: h.maintenant, setTimer: h.setTimer, clearTimer: h.clearTimer });

    ord.signaler(); await respirer();
    ord.signaler();                       // demandée pendant que la première est en vol
    h.avancer(10_001); await respirer();
    h.avancer(1); await respirer();
    expect(executions, "la seconde écriture doit partir une fois la première abandonnée")
      .toBeGreaterThanOrEqual(2);
  });
});

describe("le délai est déclaré une seule fois", () => {
  it("il vient du module partagé, pas d'un nombre écrit dans le gabarit", () => {
    expect(PRESENT_WRITE_TIMEOUT_MS).toBeGreaterThan(0);
  });

  // ⚠️ Une borne qu'un usage normal atteint transformerait une lenteur en écriture perdue ; une
  // borne qu'aucune panne n'atteint ne débloquerait rien. On fixe la relation, pas le nombre.
  it("il laisse largement le temps d'une écriture, sans laisser le temps d'une panne", () => {
    expect(PRESENT_WRITE_TIMEOUT_MS, "une écriture de page aboutit en une seconde ou deux")
      .toBeGreaterThanOrEqual(5_000);
    expect(PRESENT_WRITE_TIMEOUT_MS, "au-delà, le présentateur a déjà tourné trois pages dans le vide")
      .toBeLessThanOrEqual(30_000);
  });
});
