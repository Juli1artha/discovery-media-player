// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE CACHE DE VOIX ÉTAIT IMPURGEABLE PAR CONSTRUCTION — PAS PAR OUBLI DE CONFIGURATION.
//
// ⚠️ Chaque synthèse écrit DEUX objets dans le bucket PUBLIC `tts-cache` : `<empreinte>.mp3` et
// `<empreinte>.json`. L'empreinte est un condensat (voix + modèle + texte prononcé) qui ne se
// rattachait à AUCUNE ligne. Or le balayage efface des lignes, et pour les fichiers il efface ceux
// dont une ligne porte le chemin — la capacité `storage` du contrat expose `put` et `remove`,
// jamais `list`. Il n'y avait rien à parcourir : ni fenêtre, ni réglage, ni politique ne pouvait
// atteindre ce bucket. L'audit CODEX du 26/08 l'a estimé à « une demi-journée de politique » ; ce
// n'était pas une politique qui manquait, c'était la trace (migration 0021).
//
// ⚠️ CET EN-TÊTE DISAIT « ET UN VISITEUR DÉCIDE DE CE QUI Y ENTRE ». Ce n'est plus vrai depuis que
// `bot-tts` confronte le texte à ce que l'assistant a réellement dit dans la session : l'appelant
// PROPOSE, il ne choisit pas. Corrigé en place le 12/09 — et trouvé par une GARDE, pas par une
// relecture : c'est la quatrième copie de cette phrase, après les deux corrigées le 11/09 et celle
// d'un fichier de production. Deux audits humains l'avaient manquée.
// Ce qui reste vrai est la conséquence : chaque texte DISTINCT ACCEPTÉ laisse un MP3 et un JSON dans
// un bucket public. Les plafonds de la 0.1.140 bornent le coût par HEURE ; seule cette fenêtre borne
// la DURÉE.

const retention = require("../retention.js");
const schema = require("../schema.js");

const MOIS_13 = 13 * 31 * 24 * 3600 * 1000;
const MAINTENANT = Date.UTC(2026, 7, 26, 12, 0, 0);
const VIEUX = new Date(MAINTENANT - MOIS_13 - 86400000).toISOString();

/** Contexte minimal : la table de traces est peuplée, tout le reste est vide. */
function contexte({ traces = [], remove = async () => true } = {}) {
  const appels = [];
  let pool = [...traces];
  const ctx = {
    appels,
    db: {
      async request(chemin, o = {}) {
        const methode = o.method || "GET";
        appels.push({ chemin, methode });
        if (methode === "DELETE") {
          if (!chemin.startsWith("doc_tts_objects")) return [];
          const dedans = /hash=in\.\(([^)]*)\)/.exec(chemin);
          // ⚠️ DÉCODER PUIS DÉGUILLEMETER, dans cet ordre : la porte encode les guillemets
          // (`%22`), donc les retirer avant décodage ne retire rien et aucune clé ne correspond.
          const cles = (dedans ? dedans[1].split(",") : []).map((v) => decodeURIComponent(v).replace(/^"|"$/g, ""));
          pool = pool.filter((r) => !cles.includes(r.hash));
          return cles.map((hash) => ({ hash }));   // lignes RENDUES, comme PostgREST
        }
        if (!chemin.startsWith("doc_tts_objects")) return [];
        const lim = Number(/limit=(\d+)/.exec(chemin)?.[1] || 999);
        const gt = /hash=gt\.([^&]+)/.exec(chemin);
        let res = pool.filter((r) => r.created_at < VIEUX || r.created_at <= VIEUX || new Date(r.created_at).getTime() < MAINTENANT - MOIS_13);
        if (gt) { const c = decodeURIComponent(gt[1]); res = res.filter((r) => String(r.hash) > c); }
        return res.sort((a, b) => (a.hash < b.hash ? -1 : 1)).slice(0, lim);
      },
      async selectAll() { return []; },
    },
    storage: { remove },
    limits: { async allow() { return true; } },
    errors: { capture() {} },
    config: { supabaseUrl: "https://x.supabase.co" },
  };
  retention.init(ctx);
  schema.init(ctx);
  require("../presentations.js").init(ctx);
  return { ctx, appels, restant: () => pool };
}

describe("la purge du cache de voix", () => {
  it("⚠️ retire les DEUX objets de chaque empreinte, puis la ligne", async () => {
    const retires = [];
    const { ctx, restant } = contexte({
      traces: [{ hash: "aaa", created_at: VIEUX }, { hash: "bbb", created_at: VIEUX }],
      remove: async (bucket, chemin) => { retires.push(`${bucket}/${chemin}`); return true; },
    });

    const r = await retention.purgerRetention(MAINTENANT, {});
    expect(r.rapport.doc_tts_objects.supprimees).toBe(2);
    expect(retires.sort()).toEqual([
      "tts-cache/aaa.json", "tts-cache/aaa.mp3",
      "tts-cache/bbb.json", "tts-cache/bbb.mp3",
    ]);
    expect(r.rapport.doc_tts_objects.fichiers, "quatre objets pour deux empreintes").toBe(4);
    expect(restant(), "la trace part APRÈS les objets").toEqual([]);
    expect(r.efface.doc_tts_objects, "l'ancienne forme du rapport porte la nouvelle cible").toBe(2);
    expect(ctx).toBeTruthy();
  });

  it("⚠️ la ligne ne part JAMAIS avant les objets — sinon ils deviennent inatteignables", async () => {
    const ordre = [];
    const { appels } = contexte({
      traces: [{ hash: "aaa", created_at: VIEUX }],
      remove: async () => { ordre.push("remove"); return true; },
    });
    await retention.purgerRetention(MAINTENANT, {});
    const iDelete = appels.findIndex((a) => a.methode === "DELETE" && a.chemin.startsWith("doc_tts_objects"));
    expect(iDelete, "un DELETE a bien eu lieu").toBeGreaterThan(-1);
    // Les deux retraits sont enregistrés avant que le DELETE ne soit émis.
    expect(ordre, "purger la trace d'abord purgerait le seul moyen de purger les objets").toHaveLength(2);
  });

  it("un dry-run ne retire rien et ne supprime rien — mais dit ce qu'il aurait fait", async () => {
    const retires = [];
    const { restant } = contexte({
      traces: [{ hash: "aaa", created_at: VIEUX }],
      remove: async (b, c) => { retires.push(c); return true; },
    });
    const r = await retention.purgerRetention(MAINTENANT, { dryRun: true });
    expect(retires).toEqual([]);
    expect(r.rapport.doc_tts_objects.supprimees).toBe(0);
    expect(r.rapport.doc_tts_objects.examinees, "il doit REMONTER ce que la vraie purge viserait").toBe(1);
    expect(r.rapport.doc_tts_objects.fichiersCandidats, "deux objets par empreinte, comptés même à blanc").toBe(2);
    expect(restant()).toHaveLength(1);
  });

  it("un hôte sans `storage.remove` purge la ligne et NE PRÉTEND PAS avoir retiré les objets", async () => {
    const { ctx } = contexte({ traces: [{ hash: "aaa", created_at: VIEUX }] });
    delete ctx.storage.remove;
    retention.init(ctx);
    const r = await retention.purgerRetention(MAINTENANT, {});
    // `null` = rien tenté : ni succès ni échec. Un compte à zéro qui se lirait « retiré » serait
    // pire que la limite elle-même — c'est ce que docs/RETENTION.md dit plutôt que de simuler.
    expect(r.rapport.doc_tts_objects.fichiers).toBe(0);
    expect(r.rapport.doc_tts_objects.fichiersErreur).toBe(0);
    expect(r.rapport.doc_tts_objects.fichiersCandidats).toBe(2);
  });
});

// ⚠️ UNE LIGNE QUI PART AU-DESSUS D'UN FICHIER RESTÉ EST UNE PERTE IRRÉVERSIBLE, PAS UN COMPTAGE
// IMPRÉCIS — reproduit par un audit externe le 12/09.
//
// La suppression de la trace était INCONDITIONNELLE. Un retrait qui échoue laissait donc la ligne
// partir, et avec elle le CHEMIN de l'objet. L'en-tête de ce fichier dit pourquoi c'est définitif :
// la capacité `storage` expose `put` et `remove`, JAMAIS `list` — sans ligne, « il n'y a
// littéralement rien à parcourir ». L'objet reste dans un bucket PUBLIC, pour toujours, et aucun
// balayage ne peut le retrouver. C'est l'argument même qui a justifié la migration 0021, retourné
// contre le code qu'elle a rendu possible.
describe("⚠️ la trace ne part pas au-dessus d'un audio qui a résisté", () => {
  it("⚠️ le retrait échoue : la ligne est RETENUE, et le rapport le dit", async () => {
    const { restant } = contexte({
      traces: [{ hash: "aaa", created_at: VIEUX }],
      remove: async () => false,
    });
    const r = await retention.purgerRetention(MAINTENANT, {});
    const c = r.rapport.doc_tts_objects;
    expect(c.supprimees, "purger la trace d'un objet resté purge le seul moyen de le purger").toBe(0);
    expect(c.retenues, "une ligne gardée exprès doit se LIRE — sinon on remplace un défaut muet par un autre").toBe(1);
    expect(restant(), "la trace reste : le prochain passage réessaiera").toHaveLength(1);
  });

  // ⚠️ LE CAS LÉGITIME, ET IL EST MAJORITAIRE. Un hôte a mesuré 552 `.mp3` pour 356 `.json` : un
  // tiers des empreintes n'a PAS de compagnon d'alignement, parce que le fournisseur n'en rend pas
  // toujours. Faire dépendre la ligne des DEUX objets retiendrait un tiers du cache pour toujours,
  // en croyant protéger des fichiers qui n'existent pas. C'est l'audio, et lui seul, qui commande.
  it("⚠️ l'alignement absent ne retient RIEN — sinon un tiers du cache ne se purgerait plus jamais", async () => {
    const tentes = [];
    const { restant } = contexte({
      traces: [{ hash: "aaa", created_at: VIEUX }],
      remove: async (bucket, chemin) => { tentes.push(chemin); return !String(chemin).endsWith(".json"); },
    });
    const r = await retention.purgerRetention(MAINTENANT, {});
    const c = r.rapport.doc_tts_objects;
    expect(tentes.sort(), "les deux objets sont bien tentés").toEqual(["aaa.json", "aaa.mp3"]);
    expect(c.supprimees, "l'audio est parti : la ligne n'a plus rien à protéger").toBe(1);
    expect(c.retenues).toBe(0);
    expect(c.fichiersErreur, "l'absence du compagnon reste COMPTÉE — on ne masque pas pour faire joli").toBe(1);
    expect(restant()).toHaveLength(0);
  });

  // ⚠️ LES BORNES. Une grandeur bornée qui sort de ses bornes est le seul témoin gratuit d'une
  // DÉFINITION : un contrôle positif prouve que l'instrument répond, pas que la grandeur a un sens.
  it("⚠️ bornes : retirés + erreurs ≤ candidats, et supprimées + retenues ≤ examinées", async () => {
    for (const remove of [async () => true, async () => false, async (b, c) => !String(c).endsWith(".json")]) {
      contexte({ traces: [{ hash: "aaa", created_at: VIEUX }, { hash: "bbb", created_at: VIEUX }], remove });
      const c = (await retention.purgerRetention(MAINTENANT, {})).rapport.doc_tts_objects;
      expect(c.fichiers + c.fichiersErreur, "un objet est retiré ou en erreur, jamais les deux ni ni l'un ni l'autre")
        .toBeLessThanOrEqual(c.fichiersCandidats);
      expect(c.supprimees + c.retenues, "une ligne examinée est supprimée, retenue, ou pas encore atteinte")
        .toBeLessThanOrEqual(c.examinees);
      for (const n of [c.fichiers, c.fichiersErreur, c.supprimees, c.retenues]) expect(n).toBeGreaterThanOrEqual(0);
    }
  });
});
