// ON RECONNAÎT UN CONFLIT AU FAIT, PAS AU LIBELLÉ.
//
// ⚠️ CE QUE SIX SITES FAISAIENT, ET CE QUE ÇA AVALAIT. Le test était
// `message.includes("409")` — « 409 » n'importe où dans la chaîne. Or le message que
// `context/standalone.js` compose porte le CHEMIN, donc le slug, l'identifiant, le numéro de page.
// Un document dont le slug contient « 409 » — un numéro de référence, une date — faisait passer
// n'importe quelle panne pour un conflit. Et l'usage est toujours `if (!conflit) throw` : une
// vraie erreur 500 était donc AVALÉE, et le code continuait comme si la ligne existait déjà.
//
// Mesuré le 24/08 sur les formes réelles : trois cas sur quatre partaient en faux conflit.
//
// La leçon vient d'un exploitant qui l'a payée sur son propre outillage : il avait trié un
// résultat sur un LIBELLÉ, et le tri s'est renversé le jour où il a trouvé un meilleur mot. Un
// TEST sur un libellé a la même fragilité, en pire — il ne se renverse pas, il se trompe en
// silence.

const { estConflit } = require("../erreurs-base.js");

const err = (message, statut) =>
  Object.assign(new Error(message), statut === undefined ? {} : { statusCode: statut });

describe("⚠️ LE STATUT TRANCHE, ET IL PASSE AVANT LE TEXTE", () => {
  it("un 409 déclaré est un conflit", () => {
    expect(estConflit(err("Supabase POST /x → 409", 409))).toBe(true);
  });

  it("⚠️ un statut qui dit 500 gagne contre un message qui dit 409", () => {
    // Le cas qui prouve l'ORDRE. Si le texte était consulté en premier — ou même en second sans
    // condition — le défaut survivrait derrière une façade.
    expect(estConflit(err("Supabase POST /x → 409", 500))).toBe(false);
  });

  it("et un 409 dans le texte ne rattrape pas un statut absent de la plage", () => {
    expect(estConflit(err("peu importe", 503))).toBe(false);
  });
});

describe("⚠️ LES QUATRE CAS QUI ONT MOTIVÉ CE FICHIER", () => {
  // Les formes exactes que `context/standalone.js` compose : `Supabase ${methode} ${chemin} →
  // ${status}`. Le chemin est AVANT la flèche, le statut après.
  const REELS = [
    ["conflit véritable", "Supabase POST /doc_presentation_attendees → 409", 409, true],
    ["slug qui contient 409", "Supabase POST /doc_presentation_attendees?slug=eq.demo409 → 500", 500, false],
    ["identifiant qui contient 409", "Supabase PATCH /doc_bot_sessions?id=eq.sess-409abc → 500", 500, false],
    ["numéro de page 409", "Supabase GET /doc_pages?page=eq.409 → 503", 503, false],
  ];

  for (const [quoi, message, statut, attendu] of REELS) {
    it(`${quoi} → ${attendu ? "conflit" : "PAS un conflit"}`, () => {
      expect(estConflit(err(message, statut))).toBe(attendu);
    });

    it(`${quoi}, même sans statut posé par l'hôte`, () => {
      // ⚠️ LE REPLI COMPTE AUTANT. Un hôte tiers implémente `db.request` lui-même et peut n'avoir
      // jamais posé `statusCode` ; s'il retombait sur l'ancien test, le défaut reviendrait par là.
      expect(estConflit(err(message))).toBe(attendu);
    });
  }
});

describe("le repli, pour un hôte qui ne pose pas de statut", () => {
  it("reconnaît « 409 » APRÈS la flèche, quel que soit le détail qui suit", () => {
    // Deux formats vus dans ce dépôt : le tiret de `standalone.js`, et la suite directe des bancs.
    expect(estConflit(err("Supabase POST /x → 409 — duplicate key"))).toBe(true);
    expect(estConflit(err("Supabase POST commercial_doc_shares → 409 duplicate key cds_idem_key_uniq"))).toBe(true);
  });

  it("⚠️ et JAMAIS avant elle — c'est toute la différence avec le test qu'il remplace", () => {
    expect(estConflit(err("Supabase POST /409/x → 500"))).toBe(false);
    expect(estConflit(err("409"))).toBe(false);
  });

  it("une erreur sans message, ou pas d'erreur du tout, n'est pas un conflit", () => {
    // Rendre `true` ici avalerait une panne dont on ne sait rien — le contraire du refus-par-défaut.
    expect(estConflit(err(""))).toBe(false);
    expect(estConflit(null)).toBe(false);
    expect(estConflit(undefined)).toBe(false);
  });
});
