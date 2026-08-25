// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE CIBLE DE PURGE PEUT LÉGITIMEMENT MANQUER — LE CONTRAT LE DIT, LE BALAYAGE L'IGNORAIT.
//
// ⚠️ `docs/HOST-CONTRACT.md` écrit noir sur blanc que les migrations de débit ne sont « délibérément
// pas » dans le périmètre de la carte, parce qu'« un hôte peut fournir sa propre capacité `limits`,
// et sur un tel hôte leur absence est NORMALE, pas un défaut ». Le balayage purgeait pourtant
// `player_rate_limits` sans condition, en CINQUIÈME position sur huit.
//
// Sur un tel hôte — le nôtre — il levait donc à cette ligne, et les liens révoqués comme les
// présentations n'étaient JAMAIS atteints. Le déclencheur enveloppe le balayage dans un `catch` qui
// le classe bénin : armé, il serait resté silencieux et partiellement inopérant. ⚠️ C'est le pire
// des trois états — plus mauvais que désarmé, qui est au moins un état connu.
//
// Trouvé en PRÉ-VOL, avant d'armer : on mesure ce qu'un balayage supprimerait avant de l'autoriser
// à supprimer. Le pré-vol a rapporté zéro ligne à effacer — et une table absente.

const retention = require("../retention.js");

/** L'erreur que PostgREST rend sur une table qu'il ne connaît pas. */
const tableInconnue = () => Object.assign(new Error("Could not find the table 'public.player_rate_limits'"),
  { statusCode: 404, details: { code: "PGRST205" } });

/**
 * Un faux qui NOMME les tables qu'on lui demande, et lève sur celles qu'on lui dit absentes.
 * `absentes` : les tables qui n'existent pas sur cet hôte. `panne` : une table qui échoue autrement.
 */
function base({ absentes = [], panne = null } = {}) {
  const vues = [];
  const table = (chemin) => String(chemin).split("?")[0];
  return {
    vues,
    ctx: {
      errors: { capture() {} },
      limits: { async allow() { return true; } },
      config: { retention: {} },
      db: {
        async request(chemin) {
          const t = table(chemin);
          vues.push(t);
          if (absentes.includes(t)) throw tableInconnue();
          if (panne === t) throw Object.assign(new Error("ECONNRESET"), { code: "ECONNRESET" });
          return [];
        },
      },
    },
  };
}

describe("une cible de purge absente n'interrompt pas le balayage", () => {
  it("sans la table de débit, les cibles SUIVANTES sont quand même purgées", async () => {
    const b = base({ absentes: ["player_rate_limits"] });
    retention.init(b.ctx);
    const r = await retention.purgerRetention(Date.now(), { dryRun: true });

    expect(r.ok, "le balayage ne doit pas échouer sur une absence prévue par le contrat").toBe(true);
    // ⚠️ LA VRAIE ASSERTION : ce qui vient APRÈS la cible manquante a-t-il été atteint ? Sans elle,
    // un balayage qui s'arrête à la cinquième cible sur huit rendrait le même `ok: true`.
    //
    // ⚠️ ET LE TÉMOIN EST LE BLOC DES PRÉSENTATIONS, PAS LES LIENS RÉVOQUÉS. Ma première écriture
    // visait `commercial_doc_shares` — mais cette purge est conditionnée par une sonde de schéma
    // (`revocationDatee`), donc son absence ici ne prouverait pas un arrêt : elle prouverait que la
    // colonne n'est pas déclarée. Un témoin qui peut manquer pour DEUX raisons ne témoigne de rien.
    expect(b.vues.some((t) => t.startsWith("doc_presentation")),
      "les présentations viennent après la table absente : les atteindre prouve que le balayage a continué").toBe(true);
  });

  it("et le rapport DIT qu'elle a été sautée, au lieu de se taire", async () => {
    const b = base({ absentes: ["player_rate_limits"] });
    retention.init(b.ctx);
    const r = await retention.purgerRetention(Date.now(), { dryRun: true });
    // ⚠️ Une ligne absente du rapport se lirait « rien à supprimer », ce qui est une AUTRE
    // affirmation — et la seule des deux qui soit fausse.
    expect(r.rapport.player_rate_limits.sautee, "sauter en silence rend le balayage indistinguable d'un balayage complet")
      .toMatch(/table absente/i);
    expect(r.rapport.player_rate_limits.supprimees).toBe(0);
  });

  // ⚠️ LE CONTRÔLE QUI EMPÊCHE LE CORRECTIF DE TROP AVALER. Tolérer « table absente » ne doit pas
  // tolérer une panne : un balayage qui traverse une base en difficulté sans rien dire serait la
  // purge qui ne purge plus, sans le dire — exactement ce que ce correctif répare.
  it("une PANNE sur la même table, elle, interrompt toujours", async () => {
    const b = base({ panne: "player_rate_limits" });
    retention.init(b.ctx);
    await expect(retention.purgerRetention(Date.now(), { dryRun: true }))
      .rejects.toThrow(/ECONNRESET/);
  });

  it("et un balayage complet reste complet quand rien ne manque", async () => {
    const b = base();
    retention.init(b.ctx);
    const r = await retention.purgerRetention(Date.now(), { dryRun: true });
    expect(r.ok).toBe(true);
    expect(r.rapport.player_rate_limits.sautee, "rien ne manquait : aucune raison de sauter").toBeUndefined();
    expect(b.vues, "la table de débit est bien interrogée quand elle existe").toContain("player_rate_limits");
  });
});
