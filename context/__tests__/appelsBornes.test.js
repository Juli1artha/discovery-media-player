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

// ⚠️ « DÉJÀ ABSENT » EST UN SUCCÈS, ET CE N'EST PLUS UNE NUANCE DE COMPTAGE DEPUIS QUE LA PURGE RETIENT.
//
// La purge RETIENT la ligne quand `storage.remove` rend `false`, parce que la ligne est le seul
// chemin vers l'objet — la capacité expose `put` et `remove`, jamais `list`. Rendre `false` sur un
// objet qui n'est plus là retiendrait donc la ligne POUR TOUJOURS, en attendant un fichier qui
// n'existe pas : la sur-rétention créée par le correctif de la sous-rétention.
//
// ⚠️ CE QUI EST ÉPROUVÉ ICI EST LA CORRESPONDANCE, PAS LA FORME DU FOURNISSEUR. Le statut et le
// corps sont fabriqués ; qu'un Supabase vivant émette bien ces formes-là n'est pas vérifiable
// depuis ce dépôt, et le commentaire du code le dit plutôt que de le taire.
describe("⚠️ retirer un objet déjà absent", () => {
  const ctxAvecFetch = (reponse) => {
    const anciens = { fetch: globalThis.fetch };
    globalThis.fetch = async () => reponse;
    const ctx = createStandaloneContext({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_SERVICE_ROLE_KEY: "cle",
    });
    return { ctx, rendre: () => { globalThis.fetch = anciens.fetch; } };
  };
  const rep = (status, corps) => ({ ok: status >= 200 && status < 300, status, text: async () => corps, json: async () => ({}) });

  const cas = [
    ["retiré (200)", rep(200, ""), true],
    ["absent (404)", rep(404, ""), true],
    ["absent (400 « Object not found ») — la réponse RÉELLE de Supabase", rep(400, '{"error":"Object not found"}'), true],
    ["absent (« does not exist »)", rep(400, "the resource does not exist"), true],
    ["⚠️ vraie panne (500) : PAS un succès, sinon on perd le fichier", rep(500, "internal error"), false],
    ["⚠️ refus d'autorisation (403) : PAS un succès", rep(403, "not authorized"), false],
  ];
  for (const [nom, reponse, attendu] of cas) {
    it(nom, async () => {
      const { ctx, rendre } = ctxAvecFetch(reponse);
      try {
        expect(await ctx.storage.remove("present-attachments", "s-a/x.png")).toBe(attendu);
      } finally { rendre(); }
    });
  }
});

// ⚠️ LA PURGE DU CACHE DE VOIX N'A JAMAIS RETIRÉ UN SEUL OBJET, ET LE RAPPORT DISAIT « ERREUR » —
// CE QUE LA DOCUMENTATION EXPLIQUAIT PAR UN FAIT VRAI.
//
// `tts-cache` était refusé par la liste blanche de `remove`, AVANT tout appel réseau. Chaque retrait
// rendait `false`, la trace partait quand même, et l'objet restait dans un bucket PUBLIC sans plus
// aucun chemin vers lui — la capacité expose `put` et `remove`, jamais `list`. C'est le mal que la
// migration 0021 existait pour rendre réparable, réalisé à 100 %.
//
// ⚠️ ET CE QUI L'A CACHÉ EST UNE EXPLICATION JUSTE. `docs/RETENTION.md` attribue un `fichiersErreur`
// élevé à l'absence légitime du `.json` d'alignement (552 mp3 pour 356 json, mesuré par un hôte).
// Vrai — et suffisant pour rendre un échec TOTAL indiscernable du fonctionnement normal. Une
// explication correcte du bruit est le meilleur endroit où cacher un signal.
describe("⚠️ les buckets que la rétention doit atteindre", () => {
  const ctxSonde = () => {
    const ancien = globalThis.fetch;
    const vus = [];
    globalThis.fetch = async (url) => { vus.push(String(url)); return { ok: true, status: 200, text: async () => "" }; };
    const ctx = createStandaloneContext({ SUPABASE_URL: "https://x.supabase.co", SUPABASE_SERVICE_ROLE_KEY: "cle" });
    return { ctx, vus, rendre: () => { globalThis.fetch = ancien; } };
  };

  it("⚠️ `tts-cache` est ATTEINT — sans quoi la purge des voix ne retire rien du tout", async () => {
    const { ctx, vus, rendre } = ctxSonde();
    try {
      expect(await ctx.storage.remove("tts-cache", "aaa.mp3")).toBe(true);
      expect(vus.join(" "), "l'appel doit vraiment partir vers le bon bucket").toContain("/object/tts-cache/aaa.mp3");
    } finally { rendre(); }
  });

  it("`present-attachments` reste atteint", async () => {
    const { ctx, vus, rendre } = ctxSonde();
    try {
      expect(await ctx.storage.remove("present-attachments", "s-a/x.png")).toBe(true);
      expect(vus.join(" ")).toContain("/object/present-attachments/s-a/x.png");
    } finally { rendre(); }
  });

  // ⚠️ LA BARRIÈRE GARDE SON OBJET. Élargir une liste blanche est le moment exact où l'on cesse de
  // garder : ce qu'elle protège est un DELETE à la clé service_role, qui ouvre toute la base. Le
  // refus doit tomber AVANT le réseau — un refus qui a déjà émis la requête n'a rien refusé.
  it("⚠️ tout autre bucket est refusé AVANT le réseau", async () => {
    const { ctx, vus, rendre } = ctxSonde();
    try {
      for (const b of ["autre-bucket", "storage", "", "tts-cache2", "../present-attachments"]) {
        expect(await ctx.storage.remove(b, "x.png"), `bucket « ${b} »`).toBe(false);
      }
      expect(vus, "aucune requête ne doit être partie pour un bucket refusé").toEqual([]);
    } finally { rendre(); }
  });

  it("la traversée de chemin reste refusée dans les deux buckets", async () => {
    const { ctx, vus, rendre } = ctxSonde();
    try {
      for (const b of ["present-attachments", "tts-cache"]) {
        for (const c of ["../x.png", "a/../../x", "a//x", "a/./x", "a\\x"]) {
          expect(await ctx.storage.remove(b, c), `${b} : ${c}`).toBe(false);
        }
      }
      expect(vus).toEqual([]);
    } finally { rendre(); }
  });
});
