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


/**
 * Un contexte qui COMPTE les allers-retours, branché sur la couture que le player utilise vraiment
 * (`db.request`). Il répond de façon plausible : ce banc mesure un COÛT, pas une correction — les
 * propriétés sont éprouvées par les autres bancs.
 */
function compteur({ strict = false, avecSecret = true, sans0019 = false } = {}) {
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
        if (chemin.startsWith("rpc/player_attendance_bump")) {
          // ⚠️ UN HÔTE SANS 0019 REFUSE LE CONTRAT LONG, ET C'EST MESURABLE PLUTÔT QU'HISTORIQUE.
          // Le régime dégradé vit encore dans le code (le repli) : on n'a donc pas à le tenir d'une
          // mesure prise sur une ancienne version, qu'aucun banc ne reprendrait jamais. PostgREST
          // résout par jeu d'arguments nommés — l'argument en trop ne correspond à aucune fonction.
          if (sans0019 && o && o.body && "p_control_hash" in o.body) {
            throw Object.assign(new Error("Supabase"), { statusCode: 404, details: { code: "PGRST202" } });
          }
          return [{ ok: true, created: false, capped: false, usurpe: false, introuvable: false, archivee: false, page: 3 }];
        }
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
  // ⚠️ ON REPART D'UN MODULE NEUF, ET CE BANC VIENT DE PROUVER POURQUOI. Seul `handler.js` était
  // vidé du cache ; `presentations.js` gardait donc son état — dont le mémo « cet hôte n'a pas
  // 0019 », armé de 60 s. L'essai du régime dégradé, ajouté juste au-dessus, a fait passer l'essai
  // de MISE À L'ÉCHELLE en régime dégradé sans un mot : son relevé annonçait 300 appels au lieu de
  // 200, et le témoin ne l'a pas vu parce qu'il n'épinglait que le RATIO, lequel ne bouge pas.
  //
  // Un banc dont les essais se transmettent un état ne mesure pas ce que son titre annonce, et
  // l'ordre des essais devient une dépendance invisible. Le témoin épingle désormais aussi le
  // nombre ABSOLU, pour que ce déplacement de régime ne puisse plus passer.
  // ⚠️ TOUS LES MODULES SERVEUR, PAS UN SEUL — ET LA PREMIÈRE TENTATIVE L'A PROUVÉ EN CASSANT. En
  // ne vidant que `presentations.js`, les modules DÉJÀ chargés (routes-direct, schema) gardaient
  // une référence vers l'ancienne instance, celle que plus personne n'initialisait : les routes
  // levaient en silence et le relevé PERDAIT un appel partout. Un banc de coût qui mesure moins
  // parce qu'il est cassé annonce une amélioration — c'est le pire sens possible pour une panne.
  for (const cle of Object.keys(require.cache)) {
    if (cle.includes(`${require("node:path").sep}server${require("node:path").sep}`)) delete require.cache[cle];
  }
  const p = require("../server/handler.js");
  // Le module de schéma doit être LE MÊME que celui qu'utilise le handler fraîchement requis.
  const schemaFrais = require("../server/schema.js");
  p.init(ctx); schemaFrais.init(ctx);
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
  "battement (hôte sans 0019)": 3,
  "100 battements (appels)": 200,
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

  // ⚠️ LE RÉGIME DÉGRADÉ SE MESURE, IL NE SE RACONTE PAS. Nos documents annoncent « 3 allers-retours
  // au lieu de 2 » pour un hôte sans 0019 : ce 3 venait d'une mesure prise sur la v0.1.126, donc d'un
  // passé que plus aucun banc ne rejouerait. Le repli vit pourtant toujours dans le code — il est
  // donc mesurable AUJOURD'HUI, et c'est ce qui permet aux documents d'être confrontés plus bas.
  //
  // ⚠️ ON MESURE LE RÉGIME ÉTABLI, PAS LE PREMIER APPEL. Le tout premier battement d'un hôte non
  // migré en coûte QUATRE : il tente le contrat long, se le fait refuser, puis relit et écrit. Le
  // mémo évite ensuite cette tentative pendant une minute. C'est le régime qui compte pour une salle
  // de 250 personnes — mais le pic initial existe, et l'ignorer serait mesurer ce qui arrange.
  it("BATTEMENT sur un hôte SANS 0019 : le repli coûte ce que coûtait l'ancien code, pas davantage", async () => {
    const c = compteur({ sans0019: true });
    await poster(c.p, { action: "present-attend", slug: "s", key: "anon-porteur", pt: "JETON-VALIDE" });
    c.remettreAZero();
    await poster(c.p, { action: "present-attend", slug: "s", key: "anon-porteur", pt: "JETON-VALIDE" });
    const n = noter("battement (hôte sans 0019)", c.appels.length, "→ 30 op/s à 250 participants");
    expect(n, `un hôte non migré paie ${n} allers-retours par battement`).toBeLessThanOrEqual(BUDGET_BATTEMENT);
    // ⚠️ ANTI-VACUITÉ : sans cette ligne, le test resterait vert si le faux cessait de refuser le
    // contrat long — il mesurerait alors le régime FUSIONNÉ en croyant mesurer le dégradé.
    expect(c.appels.some((a) => a.chemin.startsWith("doc_presentations?")),
      "le repli relit la présentation : c'est ce qui distingue les deux régimes").toBe(true);
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
    // ⚠️ LE RATIO NE SUFFIT PAS : il vaut 10 en régime fusionné comme en régime dégradé. C'est
    // exactement ce qui a laissé cet essai basculer d'un régime à l'autre sans que rien ne rougisse.
    noter("100 battements (appels)", cent);
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
  // ⚠️ LES DOCUMENTS AUSSI PORTENT CE CHIFFRE, ET PERSONNE NE LES CONFRONTAIT. Nous avons écrit
  // « 2 allers-retours », « 3 sans la migration », « 20 op/s », « 30 op/s » dans HOST-CONTRACT.md et
  // CONFIGURATION.md — quatre copies à la main d'un fait que ce banc MESURE, dans les documents
  // qu'un hôte lit précisément pour dimensionner son instance. Un fait vivant recopié se démode ;
  // c'est le troisième cas de la semaine, et celui-là nous l'avions créé nous-mêmes la veille.
  //
  // ⚠️ LE MARQUEUR † EST EXIGÉ, comme pour docs/API.md : le retirer en laissant le chiffre ferait
  // croire au lecteur que ce nombre est écrit à la main. Et la légende est exigée avec lui — un
  // marqueur sans légende ne marque rien, et c'est SA SECONDE PHRASE qui protège les autres
  // documents en disant ce que l'absence de † veut dire.
  it("les documents disent le coût que le banc vient de mesurer", () => {
    const fs = require("node:fs"), path = require("node:path");
    const RACINE = path.join(__dirname, "..");
    const mesure = new Map(releve.map((r) => [r.geste, r.n]));
    const fusionne = mesure.get("battement (jeton porté)");
    const degrade = mesure.get("battement (hôte sans 0019)");
    expect(fusionne, "le banc n'a pas mesuré le régime fusionné : rien à confronter").toBeGreaterThan(0);
    expect(degrade, "le banc n'a pas mesuré le régime dégradé : rien à confronter").toBeGreaterThan(0);
    // 250 participants, un battement toutes les 25 s → le débit est le coût × 10.
    const attendus = new Set([`**${fusionne}**†`, `**${degrade}**†`, `**${fusionne * 10}**†`, `**${degrade * 10}**†`]);

    // ⚠️ ET LE SENS INVERSE, QU'UNE MUTATION A RÉVÉLÉ MANQUANT. La première écriture vérifiait que
    // tout chiffre MARQUÉ est une mesure — mais pas que toute mesure est marquée. Retirer un † en
    // laissant le chiffre passait donc au vert : le nombre sortait du périmètre comparé, et
    // redevenait libre de dériver, dans le silence exact que le marqueur existe pour rompre. Une
    // garde qui n'inspecte que ce qu'on lui présente se vide quand on cesse de lui présenter.
    //
    // Le COMPTE est donc épinglé, comme le témoin des gestes : en retirer un rougit, en ajouter un
    // rougit aussi et quelqu'un décide. C'est un nombre écrit à la main — mais confronté à chaque
    // exécution, ce qui est précisément la différence qu'on passe la semaine à établir.
    const MARQUES_ATTENDUES = { "docs/HOST-CONTRACT.md": 4, "docs/CONFIGURATION.md": 4 };

    const fautes = [];
    for (const doc of ["docs/HOST-CONTRACT.md", "docs/CONFIGURATION.md"]) {
      const texte = fs.readFileSync(path.join(RACINE, doc), "utf8");
      if (!/† \*\*Recomputed from the code/.test(texte)) fautes.push(`${doc} : plus de légende du marqueur †`);
      // ⚠️ LA PHRASE PEUT ÊTRE COUPÉE PAR UN RETOUR À LA LIGNE — le point ne traverse pas un saut de
      // ligne, et la première écriture de cette garde accusait un document parfaitement correct.
      if (!/without †[\s\S]{0,160}hand-written/.test(texte)) fautes.push(`${doc} : la légende ne dit plus ce que l'ABSENCE de † signifie`);
      const marques = [...texte.matchAll(/\*\*(\d+)\*\*†/g)].map((m) => m[0]);
      if (marques.length !== MARQUES_ATTENDUES[doc]) {
        fautes.push(`${doc} : ${marques.length} chiffres marqués, ${MARQUES_ATTENDUES[doc]} attendus — un † retiré sort le nombre du périmètre comparé, un † ajouté demande une décision`);
      }
      for (const m of marques) {
        if (!attendus.has(m)) fautes.push(`${doc} : ${m} n'est aucune des mesures du banc (${[...attendus].join(", ")})`);
      }
    }
    expect(fautes, "un document annonce un coût que le banc ne mesure pas").toEqual([]);
  });

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
