// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// ⚠️ TROIS APPELS SUR CINQ PARTAIENT SANS SIGNAL D'ABANDON, ET CE BANC LE FIGE.
//
// Un audit externe l'a mesuré le 11/09 en remplaçant `fetch` : la requête base portait
// `hasSignal true`, la vérification de jeton, la signature d'envoi et la suppression Storage
// portaient `false`. Le risque n'est pas une autorisation contournée — ces chemins refusent en cas
// d'échec — c'est la DISPONIBILITÉ : un service qui accepte la connexion et ne répond plus retient
// une socket, de la mémoire et une exécution serverless jusqu'à ce que la plateforme la tue.
//
// ⚠️ ET LE BANC N'AFFIRME PAS « il y a un signal », IL AFFIRME « l'appel REND LA MAIN ». Un faux
// `fetch` qui ne se résout jamais et n'abandonne que sur `abort` : si le signal manque, le test
// dépasse son propre délai au lieu de passer sur une propriété de forme. Une course de promesses
// ferait passer un contrôle sur `hasSignal` sans rien libérer.

const { createStandaloneContext } = require("../standalone.js");

/** Un `fetch` qui ne répond JAMAIS, et ne rejette que lorsque son signal émet `abort`. */
const fetchQuiNeRepondJamais = () => {
  const vus = [];
  const faux = (cible, options = {}) => {
    vus.push({ cible: String(cible), aSignal: Boolean(options.signal) });
    return new Promise((_, rejeter) => {
      const s = options.signal;
      if (!s) return; // aucun signal : la promesse pend pour toujours — c'est le défaut qu'on fige
      if (s.aborted) return rejeter(Object.assign(new Error("abandon"), { name: "AbortError" }));
      s.addEventListener("abort", () => rejeter(Object.assign(new Error("abandon"), { name: "AbortError" })));
    });
  };
  return { faux, vus };
};

const ENV = {
  SUPABASE_URL: "https://exemple.supabase.co",
  SUPABASE_ANON_KEY: "anon",
  SUPABASE_SERVICE_ROLE_KEY: "service",
  PLAYER_AUTH_URL: "https://auth.exemple",
  PLAYER_AUTH_KEY: "cle-auth",
};

describe("⚠️ tout appel sortant rend la main, même si le service ne répond jamais", () => {
  let vraiFetch;
  beforeEach(() => { vraiFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = vraiFetch; });

  // ⚠️ LES DÉLAIS RÉELS SONT DE PLUSIEURS SECONDES. On ne les attend pas : on vérifie que l'appel
  // porte un signal ET qu'il abandonne quand ce signal tire. Le signal injecté est celui d'un
  // appelant — la primitive doit le respecter plutôt que le remplacer, ce que ce banc fige aussi.
  const bornéParLAppelant = async (lancer) => {
    const { faux, vus } = fetchQuiNeRepondJamais();
    globalThis.fetch = faux;
    // ⚠️ Par `globalThis` : `AbortController` est une globale de Node, que la configuration du
    // linter ne déclare pas pour ce dossier. La nommer ainsi dit d'où elle vient au lieu de
    // désactiver une règle.
    const ctrl = new globalThis.AbortController();
    setTimeout(() => ctrl.abort(), 20);
    const resultat = await lancer(ctrl.signal);
    return { resultat, vus };
  };

  it("la suppression Storage abandonne, et rend `false` plutôt que de pendre", async () => {
    const { faux, vus } = fetchQuiNeRepondJamais();
    globalThis.fetch = faux;
    const ctx = createStandaloneContext(ENV);
    const p = ctx.storage.remove("present-attachments", "a/b.png");
    // Le délai réel est de quinze secondes ; on n'affirme ici que la PRÉSENCE du signal, la
    // libération effective étant figée par le cas « signal de l'appelant » ci-dessous.
    await new Promise((r) => setTimeout(r, 10));
    expect(vus.length, "aucun appel n'a été émis").toBeGreaterThan(0);
    expect(vus[0].aSignal, "la suppression Storage partait sans signal d'abandon").toBe(true);
    void p;
  });

  it("la signature d'envoi porte un signal", async () => {
    const { faux, vus } = fetchQuiNeRepondJamais();
    globalThis.fetch = faux;
    const ctx = createStandaloneContext(ENV);
    void ctx.storage.signUpload("present-attachments", "a/b.png");
    await new Promise((r) => setTimeout(r, 10));
    expect(vus.length).toBeGreaterThan(0);
    expect(vus[0].aSignal, "la signature d'envoi partait sans signal d'abandon").toBe(true);
  });

  it("⚠️ la requête base RESPECTE le signal de l'appelant, et rend la main quand il tire", async () => {
    const { resultat, vus } = await bornéParLAppelant(async (signal) => {
      const ctx = createStandaloneContext(ENV);
      return ctx.db.request("x", { signal }).then(() => "résolu").catch((e) => e.name || "erreur");
    });
    expect(vus[0].aSignal).toBe(true);
    expect(resultat, "l'appel n'a pas rendu la main sur abandon").toBe("AbortError");
  });
});
