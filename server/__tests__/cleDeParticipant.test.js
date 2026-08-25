// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA LIGNE DE PRÉSENCE D'UN COLLÈGUE S'ÉCRASAIT AVEC SON ADRESSE E-MAIL.
//
// `present-attend` journalise qui suit une présentation, combien de temps, et quelles pages. La
// ligne est identifiée par une `key` — et cette clé venait du CLIENT. Pour un membre,
// `attendeeKey()` renvoyait son adresse e-mail.
//
// ⚠️ Donc n'importe quel participant anonyme du lien public n'avait qu'à poster
// `key: "collegue@entreprise.fr"` pour écraser la ligne de ce collègue : changer le nom et l'avatar
// affichés dans la liste des participants, et gonfler son temps de présence. Ce sont les
// statistiques de présentation — c'est-à-dire ce que ce produit vend.
//
// ⚠️ ET LE CORRECTIF ÉTAIT DÉJÀ À MOITIÉ ÉCRIT. Trois lignes plus haut, cette même route dit :
//
//     « Une identité prouvée REMPLACE celle qu'on affirme — elle ne s'y ajoute pas. »
//
// Le nom, l'e-mail et l'avatar avaient bien été remplacés par ceux du jeton. La CLÉ était passée
// entre les mailles, alors que c'est l'identité de la ligne — la seule qui décide quelle ligne on
// écrit. On avait sécurisé le contenu du registre et laissé ouvert le choix de la page.
//
// Signalé par un audit externe (C-7).

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");

const PRES = { slug: "Ab3-_xYz9012", control_hash: "peu-importe", active: true, current_page: 3 };
let recu = null;
require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: {
  ...vraies,
  getPresentation: async () => ({ ...PRES }), listMessages: async () => [],
  recordAttendance: async (slug, arg) => { recu = { slug, ...arg }; return { ok: true }; },
} };
const player = require("../handler.js");

const MEMBRE = { email: "lea@entreprise.fr", name: "Léa", avatar: "https://ex/a.png" };

function contexte({ session = null } = {}) {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: {
      async verifyToken(entete) { return entete && session ? { email: session.email } : null; },
      profileOf: () => session, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; },
    },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "cle", mapsKey: "", extraFrameAncestors: [] },
  };
}

async function attendre(corps, { session = null } = {}) {
  recu = null;
  player.init(contexte({ session }));
  const res = { statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  const entetes = { "content-type": "application/json" };
  if (session) entetes.authorization = "Bearer jeton-valide";
  await player.handler({ method: "POST", headers: entetes, socket: {}, query: {}, body: { action: "present-attend", slug: PRES.slug, ...corps } }, res);
  return { statut: res.statusCode, cle: recu && recu.key };
}

describe("la clé d'un membre vient du jeton, jamais du corps", () => {
  it("un membre est journalisé sous l'adresse que son jeton prouve", async () => {
    const r = await attendre({ key: "peu-importe" }, { session: MEMBRE });
    expect(r.cle).toBe("lea@entreprise.fr");
  });

  // ⚠️ LE CAS DE L'ATTAQUE, DANS LES DEUX SENS.
  it("un membre ne peut pas se faire passer pour un autre", async () => {
    const r = await attendre({ key: "patron@entreprise.fr" }, { session: MEMBRE });
    expect(r.cle, "la clé affirmée est ignorée, même venant d'un membre authentifié")
      .toBe("lea@entreprise.fr");
  });

  it("un anonyme ne peut pas écrire dans la ligne d'un membre", async () => {
    const r = await attendre({ key: "lea@entreprise.fr" });
    expect(r.cle, "c'était l'attaque : poster l'adresse d'un collègue pour écraser sa ligne")
      .not.toBe("lea@entreprise.fr");
    expect(r.cle, "elle retombe dans l'espace de noms des anonymes").toMatch(/^anon-/);
  });
});

// ⚠️ UN DÉTAIL DE CASSE EST UNE LIGNE DE PRÉSENCE.
//
// La clé cliente que 0.1.42 a remplacée était minusculée ; la clé dérivée ne l'était pas. Or la
// ligne se retrouve par `attendee_key=eq.` — une correspondance EXACTE. Un hôte dont l'identité rend
// l'adresse telle qu'elle a été saisie aurait vu, pour un même membre, une SECONDE ligne apparaître :
// temps cumulé reparti de zéro, et le collègue affiché deux fois dans la liste des participants.
//
// ⚠️ Sans effet là où les adresses sont déjà normalisées — c'est le cas des deux hôtes actuels, et
// c'est précisément pourquoi rien ne l'aurait signalé. Un contrat ouvert ne se repose pas sur ce que
// ses deux premiers hôtes font. Trouvé en relisant 0.1.42 avant d'en annoncer la mise à jour.
describe("la clé d'un membre est normalisée, quelle que soit la casse du jeton", () => {
  it.each([
    ["Lea@Entreprise.FR"],
    ["  lea@entreprise.fr  "],
    ["LEA@ENTREPRISE.FR"],
  ])("%s donne la même clé", async (adresse) => {
    const r = await attendre({ key: "peu-importe" }, { session: { ...MEMBRE, email: adresse } });
    expect(r.cle, "une casse différente ferait repartir le temps de présence de zéro")
      .toBe("lea@entreprise.fr");
  });
});

describe("un anonyme garde sa clé, mais ne sort pas de son espace de noms", () => {
  it("une clé de navigateur bien formée est conservée", async () => {
    const r = await attendre({ key: "anon-3f9c2a1b7d" });
    expect(r.cle, "sinon chaque rechargement compterait comme un nouveau participant")
      .toBe("anon-3f9c2a1b7d");
  });

  it.each([
    ["une adresse e-mail", "quelquun@ailleurs.fr"],
    ["une clé sans préfixe", "3f9c2a1b7d"],
    ["un préfixe imité avec un point", "anon.lea@entreprise.fr"],
    ["des caractères hors alphabet", "anon-lea@entreprise.fr"],
    ["une clé vide", ""],
    ["une clé absente", undefined],
    ["un objet", { toString: () => "anon-truc" }],
  ])("%s ne peut pas servir de clé", async (_nom, key) => {
    const r = await attendre({ key });
    expect(r.cle).toMatch(/^anon-/);
    expect(String(r.cle), "aucune valeur choisie hors forme ne doit traverser")
      .not.toContain("@");
  });

  it("une clé démesurée est bornée", async () => {
    const r = await attendre({ key: "anon-" + "a".repeat(5000) });
    expect(String(r.cle).length, "une clé sans borne remplit la colonne de la table")
      .toBeLessThanOrEqual(120);
  });

  // ⚠️ Deux anonymes restent séparés — la correction ne doit pas les fondre en un seul.
  it("deux navigateurs anonymes restent deux participants", async () => {
    const a = await attendre({ key: "anon-aaaaaaaa" });
    const b = await attendre({ key: "anon-bbbbbbbb" });
    expect(a.cle).not.toBe(b.cle);
  });
});

// ── Le navigateur, qui est l'autre moitié ────────────────────────────────────────────────────────
//
// ⚠️ ON MESURE L'ARTEFACT, PAS L'ARBRE DE TRAVAIL. C'est le paquet généré qui part chez les hôtes ;
// une source corrigée dont le paquet n'a pas été reconstruit ne corrige rien. Ça vient de se
// produire dans cette session même : le premier `build` a échoué en silence et le diff ne montrait
// aucun changement du paquet.
describe("le paquet navigateur n'envoie plus d'adresse comme clé", () => {
  const vm = require("node:vm");
  const { PLAYER_BROWSER_JS } = require("../browser.generated.js");

  /** On EXÉCUTE le paquet livré et on appelle sa fonction — pas de lecture de texte minifié. */
  function playerDuPaquet() {
    const bac = { crypto: require("node:crypto").webcrypto, console };
    bac.globalThis = bac;
    vm.createContext(bac);
    return new vm.Script(PLAYER_BROWSER_JS + "\n;Player").runInContext(bac);
  }
  const memoire = () => { const d = {}; return { getItem: (k) => (k in d ? d[k] : null), setItem: (k, v) => { d[k] = String(v); } }; };

  // ⚠️ ON LUI TEND L'IDENTITÉ DE TOUTES LES FAÇONS POSSIBLES. Ma première version de cette garde
  // LISAIT le texte du paquet à la recherche de « .email » — et une mutation qui remettait le défaut
  // sous un autre nom passait au travers. Une garde qui reconnaît une écriture ne garde pas un
  // comportement ; celle-ci appelle la fonction et regarde ce qu'elle rend.
  it("aucune forme d'appel ne lui fait rendre une adresse", () => {
    const P = playerDuPaquet();
    const membre = { email: "lea@entreprise.fr", name: "Léa" };
    const essais = [
      [memoire()],
      [memoire(), "session-42"],
      [membre, memoire(), "session-42"],          // l'ANCIENNE signature, si un appelant traînait
      [memoire(), membre],
      [null, "session-42"],
    ];
    for (const args of essais) {
      const cle = String(P.live.attendeeKey(...args));
      expect(cle, `appel ${JSON.stringify(args.length)} : aucune adresse ne doit sortir d'ici`)
        .not.toContain("@");
      expect(cle, "et la clé reste dans l'espace de noms des anonymes").toMatch(/^anon-/);
    }
  });

  it("elle est stable pour un même navigateur", () => {
    const P = playerDuPaquet();
    const store = memoire();
    expect(P.live.attendeeKey(store, "s")).toBe(P.live.attendeeKey(store, "s"));
  });

  it("et imprévisible d'un navigateur à l'autre", () => {
    const P = playerDuPaquet();
    const cles = new Set(Array.from({ length: 20 }, () => P.live.attendeeKey(memoire(), "s")));
    expect(cles.size, "c'est la seule chose qui sépare deux participants anonymes").toBe(20);
    for (const c of cles) expect(c.length, "un tirage sérieux, pas huit caractères de Math.random")
      .toBeGreaterThan(16);
  });
});
