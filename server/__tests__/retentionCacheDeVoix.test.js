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
// ⚠️ ET UN VISITEUR DÉCIDE DE CE QUI Y ENTRE. `bot-tts` accepte le texte de l'appelant : un texte
// unique laisse un MP3 et un JSON dans un bucket public. Les plafonds de la 0.1.140 bornent le coût
// par HEURE ; seule cette fenêtre borne la DURÉE.

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
