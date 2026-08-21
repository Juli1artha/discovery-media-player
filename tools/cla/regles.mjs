// QUI DOIT SIGNER LE CLA, ET QUI A DÉJÀ SIGNÉ — LES RÈGLES, SÉPARÉES DE LA MÉCANIQUE.
//
// ⚠️ POURQUOI CE FICHIER EXISTE PLUTÔT QU'UNE ACTION TIERCE. `contributor-assistant/github-action`
// est ARCHIVÉE depuis le 23/03/2026 (constaté par l'API : archived=true, dernier commit ce
// jour-là), et elle émettait déjà l'avertissement « cette action vise Node 20, forcée sur
// Node 24 ». Tant que le CLA n'était que signalé, c'était supportable. Depuis qu'il est
// BLOQUANT, une action non maintenue tient la porte de toutes les contributions : le jour où
// la forge retire ce qu'elle utilise, plus aucune PR ne passe, et personne n'aura été prévenu.
//
// ⚠️ ET LE MOMENT ÉTAIT LE BON : le registre était VIDE (`signedContributors: []`) — aucun
// contributeur externe n'avait encore eu à signer. Migrer plus tard aurait voulu dire déplacer
// des signatures, c'est-à-dire risquer d'en perdre une. Une dette se rembourse quand elle ne
// coûte rien, pas quand elle fait mal.
//
// Ce module ne parle à personne : il ne fait que RÉPONDRE. La mécanique (API, commentaires,
// écriture du registre) vit dans verifier.mjs, et c'est ce qui rend ces règles éprouvables.

/** La phrase EXACTE qui vaut signature. Toute autre formulation ne signe rien. */
export const PHRASE_DE_SIGNATURE = "I have read the CLA Document and I hereby sign the CLA";

/**
 * ⚠️ LE MAINTENEUR EST LE CONCÉDANT : il ne s'accorde pas une licence à lui-même. Les bots ne
 * produisent pas d'œuvre de l'esprit — rien à concéder non plus. `claude` est l'identité des
 * commits produits par l'agent, ajoutée sur décision explicite du mainteneur (PR #256).
 */
export const DISPENSES = ["Juli1artha", "dependabot[bot]", "github-actions[bot]", "claude"];

/** Un login GitHub, tel que la forge les forme. Sert à REFUSER tout le reste. */
const LOGIN_VALIDE = /^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}(?:\[bot\])?$/;

/**
 * Les auteurs d'une PR, dédoublonnés.
 *
 * ⚠️ ON PART DE `author.login`, PAS DE L'ADRESSE DU COMMIT. L'e-mail d'un commit est écrit par
 * qui pousse : n'importe qui peut signer un commit du nom d'un autre. Le login, lui, est ce que
 * la forge a authentifié. Un commit sans login attribué (auteur inconnu de GitHub) est RENDU
 * comme tel plutôt qu'ignoré — le silence est ce qui laisse passer.
 */
export function auteursDe(commits) {
  const logins = new Set(), sansCompte = [];
  for (const c of commits || []) {
    const login = c?.author?.login;
    if (login && LOGIN_VALIDE.test(login)) logins.add(login);
    else sansCompte.push(c?.commit?.author?.name || c?.sha?.slice(0, 8) || "inconnu");
  }
  return { logins: [...logins].sort(), sansCompte };
}

/** Le registre, tel qu'il est rangé sur la branche des signatures. */
export function lireRegistre(texte) {
  let brut;
  try { brut = JSON.parse(texte || '{"signedContributors":[]}'); }
  catch { throw new Error("le registre des signatures ne se parse pas — on ne devine pas qui a signé"); }
  const liste = Array.isArray(brut?.signedContributors) ? brut.signedContributors : [];
  return liste.filter((s) => s && typeof s.name === "string");
}

/** Qui, parmi les auteurs, doit encore signer. Les dispensés n'y figurent jamais. */
export function nonSignes(auteurs, registre, dispenses = DISPENSES) {
  const signes = new Set(registre.map((s) => s.name.toLowerCase()));
  const exempts = new Set(dispenses.map((d) => d.toLowerCase()));
  return auteurs.filter((a) => !exempts.has(a.toLowerCase()) && !signes.has(a.toLowerCase()));
}

/**
 * Ce commentaire vaut-il signature, et par qui ?
 *
 * ⚠️ LA PHRASE EST EXACTE, PAS APPROXIMATIVE. On tolère les espaces autour et un point final —
 * un client de messagerie en ajoute — mais rien d'autre : « je signe » ou une phrase reformulée
 * ne signent pas. Ce qui est concédé ici est une licence ; l'à-peu-près n'y a pas sa place.
 * Et seul un AUTEUR de la PR peut signer pour lui-même : un tiers qui poste la phrase ne signe
 * pour personne.
 */
export function signatureDans(corps, auteurDuCommentaire, auteursAttendus) {
  const propre = String(corps || "").trim().replace(/\.$/, "").replace(/\s+/g, " ");
  if (propre !== PHRASE_DE_SIGNATURE) return null;
  const trouve = (auteursAttendus || []).find((a) => a.toLowerCase() === String(auteurDuCommentaire || "").toLowerCase());
  return trouve || null;
}

/** Le registre, augmenté d'une signature. Idempotent : signer deux fois ne duplique pas. */
export function avecSignature(registre, login, { id, pullRequestNo, horodatage }) {
  if (registre.some((s) => s.name.toLowerCase() === login.toLowerCase())) return registre;
  return [...registre, { name: login, id: id ?? null, pullRequestNo: pullRequestNo ?? null, created_at: horodatage }];
}

/** Le registre, tel qu'il se range sur la branche : trié, stable, lisible par un humain. */
export const ecrireRegistre = (registre) =>
  JSON.stringify({ signedContributors: [...registre].sort((a, b) => a.name.localeCompare(b.name)) }, null, 2) + "\n";

/** Le verdict, en une valeur. `manquants` vide et `sansCompte` vide ⇒ la porte s'ouvre. */
export function verdict({ auteurs, sansCompte, registre }) {
  const manquants = nonSignes(auteurs, registre);
  return {
    ouvre: manquants.length === 0 && (sansCompte || []).length === 0,
    manquants,
    sansCompte: sansCompte || [],
  };
}
