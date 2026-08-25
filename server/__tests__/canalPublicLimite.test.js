// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// DOUZE ACTIONS D'ÉCRITURE ÉTAIENT LIMITÉES, LES DEUX LECTURES NE L'ÉTAIENT PAS.
//
// `state=1` et `chat=1` sont servis sans session, sur un lien public, et chaque appel coûte une
// interrogation de base. Une boucle sur une URL connue faisait donc d'un lien de présentation un
// amplificateur : une requête HTTP triviale contre une requête base, autant de fois qu'on veut.
//
// ⚠️ Et c'est la ressource PARTAGÉE qui paie, pas l'appelant : la base est la même pour tous les
// documents de l'instance. Le coût d'un abus ne retombe pas sur celui qui le commet — c'est ce qui
// distingue une lenteur d'un incident.
//
// ⚠️ LA PLACE DE LA GARDE EST LE CŒUR DU CORRECTIF. Écrite après `getPresentation`, elle aurait
// laissé passer très exactement la requête qu'elle est censée épargner : le refus serait arrivé une
// fois la dépense faite. Ces tests comptent donc les interrogations de base, pas les codes HTTP.
//
// Signalé par un audit externe (C-5), dernier constat critique de sa liste.

const { PRESENT_QUOTA_PER_HOUR, PRESENT_QUOTA_MARGIN, PRESENT_READ_COALESCE_MS, PRESENT_READ_BURST, PRESENT_READS_PER_HOUR, RESYNC_READS_PER_HOUR, READERS_PER_EGRESS, PRESENT_RESYNC_MS, PRESENTER_ACTIONS_PER_HOUR } = require("../shared.generated.js");

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
const PRES = { slug: "Ab3-_xYz9012", active: true, current_page: 3, chat_locked: false };
let interrogations = 0;
require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: {
  ...vraies,
  getPresentation: async () => { interrogations++; return { ...PRES }; },
  listMessages: async () => { interrogations++; return []; },
} };
const player = require("../handler.js");

function contexte(autorise) {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow(cle, max, fenetre) { return autorise(cle, max, fenetre); } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "cle", mapsKey: "", extraFrameAncestors: [] },
  };
}

/** Joue un GET public et rend le statut, en comptant les interrogations de base qu'il a coûtées. */
// ⚠️ Un slug FRAIS par appel : le cache de lecture vit au niveau du module et traverse les tests,
// qui s'exécutent en quelques millisecondes — bien en deçà de sa fenêtre. Sans ça, un test compte
// des interrogations qu'un autre a déjà payées.
let compteurSlug = 0;
const slugFrais = () => `Slug-${(compteurSlug += 1).toString().padStart(6, "0")}`;

async function lire(query, { autorise = () => true, entetes = {}, socket = "198.51.100.7", slug = slugFrais() } = {}) {
  interrogations = 0;
  const vues = [];
  player.init(contexte((cle, max, fenetre) => { vues.push({ cle, max, fenetre }); return autorise(cle, max, fenetre); }));
  const res = { statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  await player.handler({ method: "GET", headers: entetes, socket: { remoteAddress: socket }, query: { present: slug, ...query } }, res);
  return { statut: res.statusCode, interrogations, vues, corps: (() => { try { return JSON.parse(res.body); } catch { return {}; } })() };
}

describe("les relectures publiques sont bornées", () => {
  it.each([["l'état", { state: "1" }], ["le chat", { chat: "1" }]])(
    "%s passe par une limite", async (_nom, query) => {
      const r = await lire(query);
      const garde = r.vues.find((v) => String(v.cle).startsWith("pread:"));
      expect(garde, "sans limite, une boucle sur l'URL interroge la base sans fin").toBeTruthy();
      expect(garde.fenetre, "la fenêtre est horaire, comme les autres quotas").toBe(3600);
      expect(garde.max).toBe(PRESENT_QUOTA_PER_HOUR);
    });

  // ⚠️ LE TEST QUI PORTE LE CORRECTIF. Une garde écrite APRÈS l'interrogation refuserait bien, avec
  // le bon code HTTP, après avoir dépensé exactement ce qu'elle protège.
  it.each([["l'état", { state: "1" }], ["le chat", { chat: "1" }]])(
    "%s refusé ne coûte AUCUNE interrogation de base", async (_nom, query) => {
      const r = await lire(query, { autorise: (cle) => !String(cle).startsWith("pread:") });
      expect(r.statut).toBe(429);
      expect(r.corps.error).toBe("rate");
      expect(r.interrogations, "refuser après avoir payé ne protège rien")
        .toBe(0);
    });

  // ⚠️ CE TEST MESURAIT LA BONNE PROPRIÉTÉ PAR LE MAUVAIS INDICE. Il vérifiait « interrogations > 0 »
  // pour s'assurer que la requête faisait un vrai travail — indice devenu faux le jour où un cache
  // de lecture a légitimement supprimé cette interrogation. On garde l'intention (rien n'est
  // court-circuité à tort) en la mesurant sur un slug FRAIS, que le cache n'a pas encore vu.
  it("une relecture autorisée sert bien l'état", async () => {
    const r = await lire({ state: "1" });
    expect(r.statut).toBe(200);
    expect(r.corps.state.current_page, "la garde ne doit pas casser l'usage normal").toBe(3);
    expect(r.interrogations, "sur une clé froide, la ligne doit bien être lue").toBeGreaterThan(0);
  });

  // ⚠️ LA CLÉ EST CE QUE L'APPELANT NE CHOISIT PAS, ET CE TEST A ÉCHOUÉ EN L'AFFIRMANT MAL.
  //
  // Je l'avais écrit en posant un `X-Forwarded-For` et en attendant de le retrouver dans la clé.
  // Il a rendu `pread:anon` — et c'est la garde de 0.1.22 qui parlait : un en-tête que l'appelant
  // écrit lui-même ne fonde aucune limite, il suffirait de le faire varier pour recommencer à zéro.
  // Une limite existait alors, et ne limitait rien.
  //
  // Le test dit donc maintenant la propriété : la clé vient de la CONNEXION, et l'en-tête ne la
  // déplace pas.
  it("la clé vient de la connexion, pas d'un en-tête", async () => {
    const cleDe = (r) => (r.vues.find((v) => String(v.cle).startsWith("pread:")) || {}).cle;

    const direct = await lire({ state: "1" }, { socket: "198.51.100.7" });
    expect(cleDe(direct)).toBe("pread:198.51.100.7");

    const usurpe = await lire({ state: "1" }, { socket: "198.51.100.7", entetes: { "x-forwarded-for": "203.0.113.9" } });
    expect(cleDe(usurpe), "sinon on change d'en-tête et le quota repart à zéro")
      .toBe("pread:198.51.100.7");
  });

  // ⚠️ Un refus muet ferait décrocher toute une salle sans cause nommée : l'exploitant verrait des
  // pages qui cessent de tourner, et rien nulle part ne dirait pourquoi.
  it("un refus est journalisé, une fois par heure", async () => {
    const r = await lire({ state: "1" }, { autorise: (cle) => !String(cle).startsWith("pread:") });
    const avert = r.vues.find((v) => v.cle === "pread:quota-avert");
    expect(avert, "sans ce garde-fou horaire, soit on se tait, soit on inonde le journal").toBeTruthy();
    expect(avert.max).toBe(1);
    expect(avert.fenetre).toBe(3600);
  });

  // La page elle-même n'est pas un sondage : la limiter reviendrait à refuser d'ouvrir le lien.
  it("l'ouverture de la page n'est pas comptée comme une relecture", async () => {
    const r = await lire({});
    expect(r.vues.some((v) => String(v.cle).startsWith("pread:")),
      "un spectateur ouvre la page une fois, il ne la sonde pas").toBe(false);
  });
});

// ⚠️ LE QUOTA SE DÉDUIT DE LA CADENCE, IL NE S'ÉCRIT PAS À LA MAIN. C'est la leçon du quota de
// sessions, qui était passé SOUS ce qu'un seul lecteur consomme sans que personne ne le relise :
// on relit ce qui a l'air douteux, pas ce qui a l'air raisonnable.
describe("le quota tient une audience réelle", () => {
  it("le filet de resynchronisation correspond à son intervalle", () => {
    expect(RESYNC_READS_PER_HOUR).toBe(Math.ceil(3_600_000 / PRESENT_RESYNC_MS));
  });

  it("un spectateur seul est loin du plafond", () => {
    expect(PRESENT_READS_PER_HOUR).toBe(RESYNC_READS_PER_HOUR + PRESENTER_ACTIONS_PER_HOUR);
    expect(PRESENT_READS_PER_HOUR, "un quota sous la cadence refuse un spectateur qui suit normalement")
      .toBeLessThan(PRESENT_QUOTA_PER_HOUR);
  });

  // ⚠️ CETTE FORMULE A CHANGÉ, ET C'EST UN TEST QUI L'A EXIGÉ. Elle ne comptait que la part
  // SOUTENUE d'un spectateur. Quand le client s'est donné un budget avec rafale — pour qu'une page
  // tournée s'affiche tout de suite — une salle pleine dépassait le quota de 475 relectures,
  // exactement la rafale de chacun. Le serveur doit couvrir ce que le client S'AUTORISE, pas sa
  // moyenne, sinon la garde refuse un usage que le produit permet.
  it("et une salle entière derrière une sortie unique passe, rafale et marge comprises", () => {
    expect(PRESENT_QUOTA_PER_HOUR)
      .toBe((PRESENT_READS_PER_HOUR + PRESENT_READ_BURST) * READERS_PER_EGRESS * PRESENT_QUOTA_MARGIN);
    expect(READERS_PER_EGRESS, "dimensionner pour un spectateur revient à refuser le second")
      .toBeGreaterThan(1);
  });

  // ⚠️ CETTE BORNE A CHANGÉ DE RAISON, DONC DE VALEUR — ET C'EST LE POINT DÉLICAT DU CACHE.
  //
  // Elle disait : « un plafond qu'aucun usage réel n'atteint ne protège plus de rien », et fixait
  // 50 000. Ce motif valait quand le quota gardait LA BASE : il devait alors coller à l'usage
  // légitime, et c'est précisément ce qui en faisait une arme retournée — une salle pleine sous
  // martèlement atteignait le plafond et tombait en 429.
  //
  // Le cache par slug retire ce coût. Ce que le quota garde désormais, ce sont les INVOCATIONS, et
  // sa seule mission est de borner une inondation brute. Il doit donc être :
  //
  //   • AU-DESSUS de ce qu'une salle pleine peut légitimement émettre — sinon il redevient une arme ;
  //   • AU-DESSOUS de ce qu'un martèlement peut produire — sinon il ne se déclenche jamais, et une
  //     limite qui ne peut pas dire non ne dit rien.
  //
  // On fixe donc les deux côtés par déduction, plus aucun nombre à la main.
  it("il est au-dessus de l'usage légitime, et au-dessous de ce qu'une attaque produit", () => {
    const salleLegitime = (PRESENT_READS_PER_HOUR + PRESENT_READ_BURST) * READERS_PER_EGRESS;
    const plafondMecanique = (3_600_000 / PRESENT_READ_COALESCE_MS) * READERS_PER_EGRESS;

    expect(PRESENT_QUOTA_PER_HOUR, "au ras de l'usage légitime, le quota redevient une arme retournée")
      .toBeGreaterThan(salleLegitime);
    expect(PRESENT_QUOTA_PER_HOUR, "au-dessus du martèlement, il ne se déclencherait jamais")
      .toBeLessThan(plafondMecanique);
  });
});
