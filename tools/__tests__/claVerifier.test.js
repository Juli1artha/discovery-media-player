// LA MÉCANIQUE DU CLA, REJOUÉE SANS FORGE NI RÉSEAU.
//
// ⚠️ LES RÈGLES SONT ÉPROUVÉES AILLEURS (cla.test.js) ; ICI C'EST LE FLUX. Une garde bloquante
// dont on n'a jamais vu la mécanique tourner n'est pas éprouvée : les bonnes règles peuvent être
// appelées au mauvais moment, le registre écrit au mauvais endroit, ou le refus rendu comme un
// succès. On simule donc l'API de la forge et on regarde ce qui SORT : code de retour,
// commentaire posté, contenu réellement écrit.
//
// ⚠️ ET SURTOUT LE REFUS PAR DÉFAUT. Le cas qui compte le plus n'est pas « ça marche » mais
// « l'API tombe » : un CLA qui s'ouvre parce qu'on n'a pas pu vérifier ne protège rien, et c'est
// la faute qu'on ne peut pas rattraper puisque le code aura été fusionné.

import { describe, it, expect } from "vitest";
import { executer } from "../cla/verifier.mjs";
import { PHRASE_DE_SIGNATURE, lireRegistre } from "../cla/regles.mjs";

const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

/** Une forge postiche : elle NOTE ce qu'on lui demande, et rend ce qu'on lui a dit de rendre. */
function forge({ commits = [], registre = { signedContributors: [] }, commentaires = [], registreAbsent = false } = {}) {
  const journal = { commentairesPostes: [], commentairesEdites: [], ecrits: [] };
  const appeler = async (url, options = {}) => {
    const methode = options.method || "GET";
    const ok = (corps, status = 200) => ({ ok: true, status, json: async () => corps, text: async () => "" });

    if (url.includes("/pulls/") && url.includes("/commits")) return ok(commits);
    if (url.includes("/contents/") && methode === "GET") {
      if (registreAbsent) return { ok: false, status: 404, text: async () => "Not Found" };
      return ok({ content: b64(JSON.stringify(registre)), sha: "sha-registre" });
    }
    if (url.includes("/contents/") && methode === "PUT") {
      const corps = JSON.parse(options.body);
      journal.ecrits.push({ ...corps, texte: Buffer.from(corps.content, "base64").toString("utf8") });
      return ok({});
    }
    if (url.includes("/issues/") && url.includes("/comments") && methode === "GET") return ok(commentaires);
    if (url.includes("/issues/") && url.includes("/comments") && methode === "POST") {
      journal.commentairesPostes.push(JSON.parse(options.body).body); return ok({ id: 1 });
    }
    if (url.includes("/issues/comments/") && methode === "PATCH") {
      journal.commentairesEdites.push(JSON.parse(options.body).body); return ok({ id: 1 });
    }
    throw new Error("appel inattendu : " + methode + " " + url);
  };
  return { appeler, journal };
}

const contexte = (extra = {}) => ({
  GITHUB_REPOSITORY: "Juli1artha/discovery-media-player",
  CLA_TOKEN: "jeton-de-banc", CLA_PR: "42", CLA_EVENEMENT: "pull_request_target", ...extra,
});

const commit = (login) => ({ sha: "abc12345", author: login ? { login } : null, commit: { author: { name: "Sans compte" } } });

describe("une PR dont tout le monde est en règle", () => {
  it("ouvre la porte quand les auteurs sont dispensés", async () => {
    const { appeler, journal } = forge({ commits: [commit("Juli1artha"), commit("claude")] });
    expect(await executer(contexte(), appeler)).toBe(0);
    expect(journal.ecrits).toHaveLength(0);   // rien à écrire : personne n'a eu à signer
  });

  it("ouvre quand la signature est déjà au registre", async () => {
    const { appeler } = forge({ commits: [commit("alice")], registre: { signedContributors: [{ name: "alice" }] } });
    expect(await executer(contexte(), appeler)).toBe(0);
  });
});

describe("une PR non signée", () => {
  it("FERME et nomme qui doit signer", async () => {
    const { appeler, journal } = forge({ commits: [commit("alice")] });
    expect(await executer(contexte(), appeler)).toBe(1);
    expect(journal.commentairesPostes[0]).toContain("@alice");
    expect(journal.commentairesPostes[0]).toContain(PHRASE_DE_SIGNATURE);
  });

  it("⚠️ ferme sur un commit sans compte GitHub, et le dit", async () => {
    const { appeler, journal } = forge({ commits: [commit(null)] });
    expect(await executer(contexte(), appeler)).toBe(1);
    expect(journal.commentairesPostes[0]).toMatch(/aucun compte GitHub/);
  });

  it("ÉDITE son commentaire au lieu d'en empiler un second", async () => {
    // Un fil noyé sous dix rappels identiques ne se lit plus — et c'est le rappel qu'on cesse
    // alors de lire, pas le bruit.
    const { appeler, journal } = forge({
      commits: [commit("alice")],
      commentaires: [{ id: 7, body: "<!-- cla-assistant-maison -->\nancien rappel" }],
    });
    expect(await executer(contexte(), appeler)).toBe(1);
    expect(journal.commentairesPostes).toHaveLength(0);
    expect(journal.commentairesEdites).toHaveLength(1);
  });
});

describe("signer par commentaire", () => {
  const commentaire = (corps, auteur) => contexte({
    CLA_EVENEMENT: "issue_comment", CLA_COMMENTAIRE: corps, CLA_AUTEUR_COMMENTAIRE: auteur, CLA_AUTEUR_ID: "999",
  });

  it("la phrase exacte d'un auteur inscrit la signature ET ouvre la porte", async () => {
    const { appeler, journal } = forge({ commits: [commit("alice")] });
    expect(await executer(commentaire(PHRASE_DE_SIGNATURE, "alice"), appeler)).toBe(0);
    expect(journal.ecrits).toHaveLength(1);
    expect(lireRegistre(journal.ecrits[0].texte).map((s) => s.name)).toEqual(["alice"]);
    expect(journal.ecrits[0].branch).toBe("cla-signatures");
  });

  it("⚠️ un TIERS qui poste la phrase ne signe pour personne", async () => {
    const { appeler, journal } = forge({ commits: [commit("alice")] });
    expect(await executer(commentaire(PHRASE_DE_SIGNATURE, "carol"), appeler)).toBe(1);
    expect(journal.ecrits).toHaveLength(0);
  });

  it("une reformulation n'écrit rien", async () => {
    const { appeler, journal } = forge({ commits: [commit("alice")] });
    expect(await executer(commentaire("ok je signe", "alice"), appeler)).toBe(1);
    expect(journal.ecrits).toHaveLength(0);
  });

  it("resigner ne duplique pas et n'écrit pas une seconde fois", async () => {
    const { appeler, journal } = forge({ commits: [commit("alice")], registre: { signedContributors: [{ name: "alice" }] } });
    expect(await executer(commentaire(PHRASE_DE_SIGNATURE, "alice"), appeler)).toBe(0);
    expect(journal.ecrits).toHaveLength(0);
  });

  it("préserve les signatures déjà présentes", async () => {
    const { appeler, journal } = forge({
      commits: [commit("alice")], registre: { signedContributors: [{ name: "bob", id: 1 }] },
    });
    await executer(commentaire(PHRASE_DE_SIGNATURE, "alice"), appeler);
    expect(lireRegistre(journal.ecrits[0].texte).map((s) => s.name).sort()).toEqual(["alice", "bob"]);
  });

  it("crée le registre s'il n'existe pas encore", async () => {
    const { appeler, journal } = forge({ commits: [commit("alice")], registreAbsent: true });
    expect(await executer(commentaire(PHRASE_DE_SIGNATURE, "alice"), appeler)).toBe(0);
    expect(journal.ecrits[0].sha).toBeUndefined();
  });
});

describe("⚠️ le refus par défaut — le cas qui compte le plus", () => {
  it("une API qui tombe FERME la porte", async () => {
    const appeler = async () => { throw new Error("réseau injoignable"); };
    expect(await executer(contexte(), appeler)).toBe(1);
  });

  it("un registre illisible FERME la porte plutôt que de croire que personne n'a signé", async () => {
    const appeler = async (url, o = {}) => {
      if (url.includes("/commits")) return { ok: true, status: 200, json: async () => [commit("alice")] };
      if (url.includes("/contents/")) return { ok: true, status: 200, json: async () => ({ content: b64("{ pas du json"), sha: "x" }) };
      return { ok: true, status: 200, json: async () => [] };
    };
    expect(await executer(contexte(), appeler)).toBe(1);
  });

  it("un contexte incomplet FERME la porte", async () => {
    expect(await executer({ GITHUB_REPOSITORY: "a/b" }, async () => ({ ok: true, json: async () => [] }))).toBe(1);
  });

  it("une réponse d'API en erreur FERME la porte", async () => {
    const appeler = async () => ({ ok: false, status: 500, text: async () => "boom" });
    expect(await executer(contexte(), appeler)).toBe(1);
  });
});
