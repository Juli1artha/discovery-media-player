// CE QU'UN GESTE COÛTE À LA BASE — compté, pas estimé, et BORNÉ par des budgets qui rougissent.
//
// ⚠️ POURQUOI COMPTER PLUTÔT QUE CHRONOMÉTRER. Une latence mesurée sur une base mutualisée n'est pas
// reproductible : deux exécutions donnent deux nombres, aucun seuil ne tient, et un seuil qui rougit
// au hasard finit desserré — c'est le mode de panne le plus coûteux de ce dépôt. Le coût STRUCTUREL,
// lui, est déterministe : un battement fait N allers-retours, toujours les mêmes. C'est ce nombre qui
// décide si 250 participants tiennent, et c'est lui qu'un audit demandait de mesurer AVANT de fusionner
// des appels : on ne fusionne pas ce qu'on n'a pas compté.
//
// ⚠️ LES BUDGETS SONT DES DÉTECTEURS DE DÉRIVE, PAS LA MESURE DU JOUR. Collés au relevé, ils
// rougiraient au premier appel légitime ajouté et seraient relevés sans réfléchir. Ils sont donc
// LARGES, avec le relevé daté écrit à côté comme témoin — même doctrine que les planchers de
// couverture. Le franchir veut dire qu'un geste a changé d'ORDRE DE GRANDEUR, pas qu'il a bougé.

const schema = require("../server/schema.js");

/**
 * Un contexte qui COMPTE les allers-retours, branché sur la couture que le player utilise vraiment
 * (`db.request`). Il répond de façon plausible : ce banc mesure un COÛT, pas une correction — les
 * propriétés sont éprouvées par les autres bancs.
 */
function compteur({ strict = false, avecSecret = true } = {}) {
  const appels = [];
  const ctx = {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: {
      async request(chemin, o) {
        appels.push({ chemin, methode: (o && o.method) || "GET" });
        const m = (o && o.method) || "GET";
        if (/select=[a-z_]+&limit=0/.test(chemin)) return [];
        if (chemin.startsWith("doc_presentations?") && m === "GET") return [{ slug: "s", active: true, current_page: 3, control_hash: "h", chat_locked: false }];
        if (chemin.startsWith("rpc/player_attendance_bump")) return [{ ok: true, created: false, capped: false, usurpe: false }];
        if (chemin.startsWith("doc_presentation_messages")) return [];
        if (chemin.startsWith("doc_presentation_attendees")) return [];
        return [];
      },
      async selectAll() { appels.push({ chemin: "selectAll", methode: "GET" }); return []; },
    },
    mail: { async send() {} },
    identity: {
      async verifyToken() { return null; },
      roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; },
      verifyPresenceToken: (t) => (t === "JETON-VALIDE" ? { slug: "s", key: "anon-porteur" } : null),
      signPresenceToken: (slug, key) => (avecSecret ? `JETON(${slug}|${key})` : ""),
    },
    // ⚠️ LE COMPTEUR DE DÉBIT COÛTE UN ALLER-RETOUR, ET IL DOIT ÊTRE COMPTÉ. Le stubber « pour
    // simplifier » retirait un tiers du coût réel d'un battement : le banc aurait annoncé 2 là où la
    // production en fait 3, et c'est précisément le nombre sur lequel on déciderait de fusionner des
    // appels. Un banc de coût qui omet un coût ne mesure pas, il rassure.
    limits: { async allow() { appels.push({ chemin: "rpc/player_rate_limit_bump (limites)", methode: "POST" }); return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], presenceStrict: strict, ipHashSecret: "sel" },
  };
  delete require.cache[require.resolve("../server/handler.js")];
  const p = require("../server/handler.js"); p.init(ctx); schema.init(ctx);
  return { p, appels, remettreAZero: () => { appels.length = 0; } };
}

const poster = async (p, body) => {
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b == null ? "" : b); } };
  await p.handler({ method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {}, body }, res);
  return res.statusCode;
};
const lire = async (p, query) => {
  const res = { statusCode: 0, body: "", setHeader() {}, end(b) { this.body = String(b == null ? "" : b); } };
  await p.handler({ method: "GET", headers: {}, socket: {}, query }, res);
  return res.statusCode;
};

// RELEVÉ DU JOUR — témoins datés (2026-08-21), et CONFRONTÉS par le banc lui-même.
//
// ⚠️ CE RELEVÉ ÉTAIT DE LA PROSE, ET IL AVAIT DÉRIVÉ SUR QUATRE LIGNES SUR CINQ. Daté du 20/08, il
// annonçait « battement : 2 » quand le banc en imprimait 3, « changement de page : 2 » pour 1,
// « resynchronisation d'état : 1 » pour 0, « resynchronisation de chat : 2 » pour 0. Personne ne
// mentait : le banc a évolué (le compteur de débit, longtemps stubbé, est devenu comptable) et la
// prose est restée. Un fait écrit à deux endroits diverge tant que personne ne les confronte — c'est
// la règle qui vaut déjà pour init.sql et pour docs/API.md.
//
// ⚠️ ET LA DÉRIVE ÉTAIT DU MAUVAIS CÔTÉ : elle annonçait le coût PLUS BAS qu'il n'était. Le relevé
// qui rassure est celui qu'on ne relit jamais. Le témoin est donc devenu une DONNÉE que le banc
// compare à ce qu'il vient de mesurer : le mettre à jour redevient une décision, pas un oubli.
//
// Les budgets restent, plus larges, et disent autre chose : ce qu'on TOLÉRERAIT. Le témoin dit ce
// qui EST. Un geste qui bouge rougit ici même en restant sous son budget — c'est exactement
// l'érosion que la trace imprimée voulait rendre visible, désormais gardée.
const TEMOIN = {
  "battement (jeton porté)": 2,
  "battement (bootstrap)": 2,
  "changement de page": 1,
  "resync état × 20 spectateurs": 0,
  "resync chat × 20, même curseur": 0,
  "100 battements / 10 battements": 10,
};
const BUDGET_BATTEMENT = 4;
const BUDGET_PAGE = 5;
const BUDGET_RESYNC = 4;

// ⚠️ CE BANC IMPRIME SES CHIFFRES. Un banc de coût qui se contente de ne pas rougir ne sert qu'à
// rassurer : le nombre EST le produit du banc, le budget n'en est que la borne. Sans la trace, personne
// ne saurait qu'un geste est passé de 2 à 3 tant qu'il reste sous 4 — et c'est précisément l'érosion
// qu'on veut voir venir.
const releve = [];
afterAll(() => {
  if (!releve.length) return;
  const large = Math.max(...releve.map((r) => r.geste.length));
  console.log("\n  COÛT PAR GESTE (allers-retours base)");
  for (const r of releve) console.log(`    ${r.geste.padEnd(large)}  ${String(r.n).padStart(3)}${r.note ? "   " + r.note : ""}`);
  console.log("");
});
const noter = (geste, n, note) => { releve.push({ geste, n, note }); return n; };

describe("coût par geste, en allers-retours base", () => {
  it("BATTEMENT avec jeton : le chemin le plus chaud du produit reste bon marché", async () => {
    const c = compteur();
    await poster(c.p, { action: "present-attend", slug: "s", key: "anon-porteur", pt: "JETON-VALIDE" });
    c.remettreAZero();
    await poster(c.p, { action: "present-attend", slug: "s", key: "anon-porteur", pt: "JETON-VALIDE" });
    const n = noter("battement (jeton porté)", c.appels.length, `→ ${Math.round(c.appels.length * 250 / 25)} op/s à 250 participants`);
    expect(n, `un battement coûte ${n} allers-retours — 250 participants toutes les 25 s en font ${Math.round(n * 250 / 25)}/s`)
      .toBeLessThanOrEqual(BUDGET_BATTEMENT);
  });

  it("BATTEMENT en bootstrap : pas plus cher que le régime établi", async () => {
    const c = compteur();
    await poster(c.p, { action: "present-attend", slug: "s", key: "anon-neuf", wantToken: "1" });
    c.remettreAZero();
    await poster(c.p, { action: "present-attend", slug: "s", key: "anon-neuf2", wantToken: "1" });
    expect(noter("battement (bootstrap)", c.appels.length)).toBeLessThanOrEqual(BUDGET_BATTEMENT);
  });

  it("CHANGEMENT DE PAGE : le geste du présentateur, payé une fois pour toute l'audience", async () => {
    const c = compteur();
    await poster(c.p, { action: "present-page", slug: "s", control: "c", page: 4, seq: 2 });
    c.remettreAZero();
    await poster(c.p, { action: "present-page", slug: "s", control: "c", page: 5, seq: 3 });
    expect(noter("changement de page", c.appels.length)).toBeLessThanOrEqual(BUDGET_PAGE);
  });

  // ⚠️ DEUX COÛTS DE NATURES DIFFÉRENTES, ET LES CONFONDRE FAIT MENTIR LA MESURE. Le cache mutualise
  // la LECTURE DE CONTENU : vingt spectateurs à jour partagent une seule interrogation. Le compteur de
  // DÉBIT, lui, ne peut pas se mutualiser — il compte par appelant, c'est sa définition. Il reste donc
  // un PLANCHER de un aller-retour par spectateur, quoi que fasse le cache.
  //
  // Ce banc l'a appris à son auteur : tant que le compteur de débit était stubbé, il annonçait « 20
  // spectateurs = 0 appel », ce qui était faux et flatteur. Une mesure qui omet une catégorie ne
  // mesure pas moins — elle mesure autre chose, et personne ne le sait.
  const parCategorie = (appels) => ({
    debit: appels.filter((a) => a.chemin.includes("player_rate_limit_bump")).length,
    contenu: appels.filter((a) => !a.chemin.includes("player_rate_limit_bump")).length,
  });

  it("RESYNC D'ÉTAT : la LECTURE se mutualise ; le compteur de débit reste par spectateur", async () => {
    const c = compteur();
    await lire(c.p, { present: "s", state: "1" });
    c.remettreAZero();
    const N = 20;
    await Promise.all(Array.from({ length: N }, () => lire(c.p, { present: "s", state: "1" })));
    const { contenu, debit } = parCategorie(c.appels);
    noter(`resync état × ${N} spectateurs`, contenu, `lectures — plancher de débit : ${debit}`);
    expect(contenu, `sans mutualisation ce serait ${N} lectures — c'est tout l'objet du cache`).toBeLessThanOrEqual(BUDGET_RESYNC);
    expect(debit, "le débit compte par appelant : un plancher incompressible, à connaître").toBe(N);
  });

  it("RESYNC DE CHAT différentielle : même partage à curseur égal", async () => {
    const c = compteur();
    await lire(c.p, { present: "s", chat: "1", chatAfter: "42" });
    c.remettreAZero();
    const N = 20;
    await Promise.all(Array.from({ length: N }, () => lire(c.p, { present: "s", chat: "1", chatAfter: "42" })));
    const { contenu, debit } = parCategorie(c.appels);
    noter(`resync chat × ${N}, même curseur`, contenu, `lectures — plancher de débit : ${debit}`);
    expect(contenu, "une salle à jour du même message partage UNE lecture").toBeLessThanOrEqual(BUDGET_RESYNC);
  });

  // ⚠️ LA PROPRIÉTÉ QUI DÉCIDE DE LA MISE À L'ÉCHELLE : le coût doit croître LINÉAIREMENT avec les
  // participants. Un geste qui relit la liste des présents, ou qui recompte, deviendrait quadratique —
  // invisible à 3 participants, mortel à 250. On compare donc deux volumes plutôt qu'un seul.
  it("MISE À L'ÉCHELLE : 100 battements coûtent 10× ce que 10 coûtent, pas 100×", async () => {
    const mesurer = async (n) => {
      const c = compteur();
      await poster(c.p, { action: "present-attend", slug: "s", key: "anon-0", pt: "JETON-VALIDE" });
      c.remettreAZero();
      for (let i = 0; i < n; i += 1) await poster(c.p, { action: "present-attend", slug: "s", key: `anon-${i}`, pt: "JETON-VALIDE" });
      return c.appels.length;
    };
    const dix = await mesurer(10);
    const cent = await mesurer(100);
    const facteur = cent / dix;
    noter("100 battements / 10 battements", Number(facteur.toFixed(1)), `(${cent} contre ${dix})`);
    expect(facteur, `100 battements coûtent ${cent} appels contre ${dix} pour 10 — facteur ${facteur.toFixed(1)}, attendu ~10`)
      .toBeLessThanOrEqual(12);
  });

  // ⚠️ LA CONFRONTATION, EN DERNIER — parce qu'elle lit ce que les essais précédents ont noté. Sans
  // elle, le relevé en tête de fichier est de la prose : il a dérivé sur quatre lignes sur cinq
  // avant que quiconque ne s'en aperçoive, et toujours vers le BAS.
  //
  // ⚠️ ELLE VÉRIFIE AUSSI QUE CHAQUE TÉMOIN A ÉTÉ MESURÉ. Un essai renommé ou retiré ferait
  // disparaître son geste du relevé, et une comparaison qui ne parcourt que ce qui est présent
  // resterait verte sur un banc qui ne mesure plus rien — la vacuité classique.
  it("le relevé daté en tête de fichier dit ce que le banc vient de mesurer", () => {
    const mesure = new Map(releve.map((r) => [r.geste, r.n]));
    const ecarts = [];
    for (const [geste, attendu] of Object.entries(TEMOIN)) {
      if (!mesure.has(geste)) { ecarts.push(`${geste} : PLUS MESURÉ (témoin ${attendu})`); continue; }
      const n = mesure.get(geste);
      if (n !== attendu) ecarts.push(`${geste} : ${n} mesuré, ${attendu} au témoin`);
    }
    for (const { geste, n } of releve) {
      if (!(geste in TEMOIN)) ecarts.push(`${geste} : ${n} mesuré, ABSENT du témoin`);
    }
    expect(ecarts,
      "le témoin daté et la mesure divergent. Si le changement est voulu, mettez le témoin à jour "
      + "AVEC sa date — c'est une décision, pas un ajustement")
      .toEqual([]);
  });
});
