// LA FILE SUPPRIME LE DÉSORDRE QU'ON CAUSE, PAS CELUI QU'ON SUBIT.
//
// La file unique du navigateur garantit UNE seule écriture en vol : elle ordonne les DÉPARTS. Mais
// une requête abandonnée par le délai maximal peut très bien être arrivée au serveur — le navigateur
// cesse de l'attendre, il ne l'annule pas chez nous — et y atterrir APRÈS celle qui l'a remplacée.
//
// C'est le dernier cas de désordre, et nous l'avions écrit noir sur blanc en livrant la file plutôt
// que de laisser croire qu'elle le fermait. Le rang le ferme : chaque écriture porte le sien, et le
// serveur refuse un rang qu'il a déjà dépassé.
//
// ⚠️ UN RANG, PAS UN HORODATAGE. Une heure vient d'une horloge, et deux onglets n'ont pas la même.
// Un rang vient d'un compteur : il ne dit pas QUAND, il dit APRÈS QUOI.

const presentations = require("../presentations.js");
const crypto = require("node:crypto");
const sha = (s) => crypto.createHash("sha256").update(String(s || "")).digest("hex");

const CONTROL = "jeton-de-controle";
const LIGNE = { slug: "Ab3-_xYz9012", control_hash: sha(CONTROL), active: true, current_page: 1, write_seq: 0 };

function base({ ligne = LIGNE, colonne = true } = {}) {
  const etat = { ...ligne };
  const ecritures = [];
  // ⚠️ LES DEUX MODULES, COMME EN PRODUCTION. `handler.init` câble presentations ET schema sur le
  // même contexte ; n'initialiser que le premier laisse la sonde sans base, donc silencieusement en
  // « colonne absente » — et le banc mesurerait alors le repli au lieu de la garantie.
  const ctx = {
    db: { async request(chemin, o) {
      if (!colonne && String(chemin).includes("select=write_seq")) {
        throw new Error('column "write_seq" does not exist');
      }
      if (o && o.method === "PATCH") { const t = lignesTouchees(chemin, etat); if (!t.length) return []; ecritures.push(o.body); Object.assign(etat, o.body); return [{ ...etat }]; }
      return [{ ...etat }];
    } },
    limits: { async allow() { return true; } }, errors: { capture() {} },
  };
  presentations.init(ctx);
  require("../schema.js").init(ctx);
  return { etat, ecritures };
}

// ⚠️ MODÉLISE LA CONDITION, PAS SEULEMENT LE SUCCÈS. Le pilotage écrit désormais sous condition
// (`&control_hash=eq.…`, `&active=eq.true`, `&write_seq=lt.…`) et PostgREST répond par les lignes
// TOUCHÉES : zéro ligne = refus. Une doublure qui rendrait toujours une ligne ferait passer les
// essais même si la condition disparaissait du code.
function lignesTouchees(chemin, etat) {
  const cond = String(chemin).split("&").slice(1);
  for (const c of cond) {
    const [champ, valeur] = c.split("=");
    if (champ === "control_hash" && valeur !== "eq." + require("crypto").createHash("sha256").update(String(etat.control_hash_source || "")).digest("hex")) {
      if (valeur !== "eq." + String(etat.control_hash || "")) return [];
    } else if (champ === "active" && valeur === "eq.true" && etat.active === false) {
      return [];
    } else if (champ === "write_seq" && valeur.startsWith("lt.") && Number(etat.write_seq || 0) >= Number(valeur.slice(3))) {
      return [];
    }
  }
  return [{ ...etat }];
}

describe("une écriture périmée n'écrase pas une plus récente", () => {
  it("un rang plus grand passe, et se retient", async () => {
    const b = base();
    expect((await presentations.setPage(LIGNE.slug, CONTROL, 5, 3)).ok).toBe(true);
    expect(b.etat.current_page).toBe(5);
    expect(b.etat.write_seq, "le serveur retient jusqu'où il est allé").toBe(3);
  });

  // ⚠️ LE CAS QUE LA FILE NE POUVAIT PAS FERMER : la 3 est abandonnée, la 4 arrive et est écrite,
  // puis la 3 atterrit quand même.
  it("une écriture doublée en vol est refusée à son arrivée", async () => {
    const b = base();
    await presentations.setPage(LIGNE.slug, CONTROL, 9, 4);
    b.ecritures.length = 0;
    const r = await presentations.setPage(LIGNE.slug, CONTROL, 5, 3);
    expect(r.ok, "ce n'est pas une erreur : c'est le système qui fonctionne").toBe(true);
    expect(r.perime).toBe(true);
    expect(b.ecritures, "et surtout, rien n'est écrit").toEqual([]);
    expect(b.etat.current_page, "la page récente survit à l'ancienne").toBe(9);
  });

  it("un rang identique est refusé aussi — deux fois le même n'est pas un progrès", async () => {
    const b = base({ ligne: { ...LIGNE, write_seq: 7 } });
    const r = await presentations.setPage(LIGNE.slug, CONTROL, 2, 7);
    expect(r.perime).toBe(true);
    expect(b.ecritures).toEqual([]);
  });

  // ⚠️ Un client plus ancien n'envoie aucun rang. Le refuser reviendrait à casser toute page servie
  // depuis un cache navigateur — on retombe simplement sur le comportement d'avant.
  it("sans rang, on écrit comme avant", async () => {
    const b = base();
    expect((await presentations.setPage(LIGNE.slug, CONTROL, 4)).ok).toBe(true);
    expect(b.etat.current_page).toBe(4);
    expect(b.ecritures[0].write_seq, "et on ne prétend pas contrôler un ordre qu'on ne connaît pas")
      .toBeUndefined();
  });
});

// ⚠️ SANS LA COLONNE, ON NE CONTRÔLE PLUS RIEN — ET C'EST LE BON REPLI. Refuser les écritures
// ferait d'une migration non appliquée une panne totale de pilotage.
describe("un hôte qui n'a pas migré continue de piloter", () => {
  it("les écritures passent, sans contrôle d'ordre", async () => {
    const b = base({ colonne: false });
    expect((await presentations.setPage(LIGNE.slug, CONTROL, 6, 1)).ok).toBe(true);
    expect(b.etat.current_page).toBe(6);
  });

  it("et une écriture ancienne passe aussi : c'est le comportement d'avant, assumé", async () => {
    const b = base({ colonne: false, ligne: { ...LIGNE, write_seq: 9 } });
    const r = await presentations.setPage(LIGNE.slug, CONTROL, 2, 1);
    expect(r.perime, "on ne peut pas refuser ce qu'on ne sait pas comparer").toBeFalsy();
    expect(b.etat.current_page).toBe(2);
  });

  // ⚠️ LE PIÈGE DANS LEQUEL J'ÉTAIS TOMBÉ EN ÉCRIVANT CE CORRECTIF. PostgREST rejette le PATCH
  // ENTIER si une colonne manque : écrire `write_seq: 0` sans condition dans la reprise aurait cassé
  // LA REPRISE chez tout hôte non migré — pas la nouvelle garantie, la fonction elle-même.
  it("la reprise n'écrit pas le rang quand la colonne manque", async () => {
    const b = base({ colonne: false, ligne: { ...LIGNE, owner_email: "proprio@ex.fr" } });
    const r = await presentations.reclaimPresentation(LIGNE.slug, "proprio@ex.fr");
    expect(r.ok, "la reprise doit continuer de fonctionner").toBe(true);
    expect(Object.keys(b.ecritures[0]), "sinon PostgREST refuse toute la requête")
      .not.toContain("write_seq");
  });

  it("mais elle le remet à zéro quand la colonne existe", async () => {
    const b = base({ ligne: { ...LIGNE, owner_email: "proprio@ex.fr", write_seq: 42 } });
    await presentations.reclaimPresentation(LIGNE.slug, "proprio@ex.fr");
    expect(b.ecritures[0].write_seq, "un jeton neuf ouvre un nouveau domaine d'ordre").toBe(0);
  });
});

// ── Le navigateur, qui est l'autre moitié ────────────────────────────────────────────────────────
describe("le navigateur numérote ses écritures", () => {
  const SRC = require("./sourceDesPages.cjs").SOURCE_PAGES;

  it("chaque écriture de page porte un rang", () => {
    const i = SRC.indexOf("action:'present-page'");
    expect(SRC.slice(i, i + 200), "sans rang envoyé, le serveur ne peut rien ordonner")
      .toContain("seq:prochainRang()");
  });

  it("le compteur repart à zéro à chaque prise de pilotage", () => {
    const prises = [...SRC.matchAll(/PRES=\{slug:[^}]*\}; saveCtl\([^)]*\);\s*_seq=0;/g)];
    expect(prises.length, "démarrage ET reprise : un jeton neuf, un domaine d'ordre neuf")
      .toBe(2);
  });
});
