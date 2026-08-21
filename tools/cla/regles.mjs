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
 * ⚠️ DES ADRESSES DISPENSÉES, POUR LES CO-AUTEURS QU'AUCUN COMPTE NE PORTE. Même doctrine que
 * `claude` ci-dessus : un agent ne produit pas d'œuvre de l'esprit, il n'a rien à concéder. Une
 * ligne `Co-authored-by:` qui nomme l'une de ces adresses n'ajoute donc aucune obligation. Toute
 * AUTRE adresse non résolvable en compte GitHub BLOQUE, en nommant qui : on ne peut pas demander
 * sa signature à quelqu'un qu'on ne sait pas joindre, et l'ignorer serait le laisser passer.
 */
export const EMAILS_DISPENSES = ["noreply@anthropic.com"];

/** `12345+octocat@users.noreply.github.com` et `octocat@users.noreply.github.com` → « octocat ». */
export function loginDeNoreply(email) {
  const m = /^(?:\d+\+)?([^@\s]+)@users\.noreply\.github\.com$/i.exec(String(email || "").trim());
  return m && LOGIN_VALIDE.test(m[1]) ? m[1] : null;
}

/** Les `Co-authored-by:` d'un message de commit — la contribution invisible du diff. */
export function coAuteursDe(message) {
  const trouves = [];
  for (const ligne of String(message || "").split("\n")) {
    const m = /^\s*co-authored-by\s*:\s*(.*?)\s*<([^>]+)>\s*$/i.exec(ligne);
    if (m) trouves.push({ nom: m[1] || m[2], email: m[2].toLowerCase() });
  }
  return trouves;
}

/**
 * Qui doit signer pour cette PR.
 *
 * ⚠️ CE MODULE A CONFONDU ATTRIBUTION ET AUTHENTIFICATION, ET C'ÉTAIT CONTOURNABLE (P0, revue
 * externe du 21/08). Il ne partait que de `commit.author.login`, en affirmant que « le login est
 * ce que la forge a authentifié ». C'EST FAUX : GitHub RATTACHE un commit à un compte en
 * comparant l'adresse de l'en-tête Git aux adresses de ce compte. Cette adresse est écrite par
 * qui fabrique le commit, localement, sans preuve. C'est de l'attribution, pas de la preuve.
 *
 * Le contournement, rejoué contre l'ancien code : `mallory` ouvre une PR dont les commits portent
 * l'adresse du mainteneur. GitHub les attribue à `Juli1artha`, qui est dispensé. Verdict rendu :
 * « ouvre: true, manquants: [] ». `mallory` n'apparaissait NULLE PART et le CLA était déclaré en
 * règle — sur le contrôle dont toute la raison d'être est la couverture juridique de la double
 * licence.
 *
 * LA CORRECTION TIENT EN UNE PHRASE : l'auteur AUTHENTIFIÉ de la PR (`pull_request.user.login`,
 * le seul login que la forge ait réellement vérifié, puisqu'il a fallu s'y connecter pour ouvrir
 * la PR) est l'ANCRE. L'attribution garde son utilité — nommer les autres personnes dont le
 * travail est dans la PR — mais elle ne peut plus qu'AJOUTER des obligations, jamais en retirer.
 *
 * ⚠️ LIMITE ASSUMÉE, ÉCRITE PLUTÔT QUE TUE : un contributeur qui usurpe l'adresse d'un tiers
 * MASQUE l'obligation de ce tiers (son travail passe sous une attribution dispensée). Il ne peut
 * plus masquer la SIENNE, qui est le trou qu'on ferme ici. Fermer l'autre demanderait de vérifier
 * les signatures cryptographiques des commits — un chantier distinct, et une exigence que le
 * dépôt n'impose pas encore à ses contributeurs.
 */
export function auteursDe({ auteurPR, commits } = {}) {
  const attribues = new Set(), sansCompte = [];
  const authentifie = auteurPR && LOGIN_VALIDE.test(auteurPR) ? auteurPR : null;
  const exemptEmail = new Set(EMAILS_DISPENSES.map((e) => e.toLowerCase()));

  for (const c of commits || []) {
    const login = c?.author?.login;
    if (login && LOGIN_VALIDE.test(login)) attribues.add(login);
    else sansCompte.push(c?.commit?.author?.name || c?.sha?.slice(0, 8) || "inconnu");

    for (const co of coAuteursDe(c?.commit?.message)) {
      if (exemptEmail.has(co.email)) continue;
      const depuisNoreply = loginDeNoreply(co.email);
      if (depuisNoreply) attribues.add(depuisNoreply);
      else sansCompte.push(`${co.nom} <${co.email}> (co-auteur)`);
    }
  }
  if (authentifie) attribues.delete(authentifie); // il a sa place à part, pas deux fois
  return {
    authentifie,
    attribues: [...attribues].sort(),
    // ⚠️ `logins` reste l'ensemble de CEUX QUI PEUVENT SIGNER par commentaire — l'auteur
    // authentifié compris. Ne pas l'y mettre l'empêcherait de signer sa propre PR.
    logins: [...new Set([...(authentifie ? [authentifie] : []), ...attribues])].sort(),
    sansCompte: [...new Set(sansCompte)],
  };
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

/**
 * Le verdict, en une valeur. `manquants` vide et `sansCompte` vide ⇒ la porte s'ouvre.
 *
 * ⚠️ SANS AUTEUR AUTHENTIFIÉ, ON REFUSE. Si l'appelant n'a pas su dire QUI a ouvert la PR, il n'y
 * a pas d'ancre : tout le reste n'est que de l'attribution, et l'attribution se falsifie. Refuser
 * là est la seule réponse honnête — c'est la règle du fichier depuis le premier jour, appliquée
 * à son propre point d'entrée.
 */
export function verdict({ authentifie, attribues, auteurs, sansCompte, registre }) {
  // `auteurs` reste accepté pour les appels qui ne distinguent pas encore les deux origines.
  const aSigner = [...new Set([...(authentifie ? [authentifie] : []), ...(attribues || auteurs || [])])];
  const manquants = nonSignes(aSigner, registre);
  const sansAncre = authentifie ? [] : ["l'auteur de la pull request n'a pas pu être identifié"];
  return {
    ouvre: manquants.length === 0 && (sansCompte || []).length === 0 && sansAncre.length === 0,
    manquants,
    sansCompte: [...(sansCompte || []), ...sansAncre],
  };
}
