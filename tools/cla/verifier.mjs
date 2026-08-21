// LE CLA, VÉRIFIÉ PAR NOUS — plus par une action archivée.
//
// ⚠️ CE FICHIER S'EXÉCUTE SOUS `pull_request_target`, DONC AVEC LES DROITS D'ÉCRITURE DU DÉPÔT.
// C'est le piège classique de GitHub Actions, et il est ici assumé en connaissance de cause :
//   • il ne lit AUCUN fichier de la pull request, jamais — seulement des données d'API ;
//   • il n'exécute aucun script du dépôt de la PR ;
//   • il est lui-même chargé depuis la BASE (le workflow ne récupère pas la tête de la PR).
// Toute modification qui ferait entrer du contenu de la PR dans ce processus ouvre le dépôt à
// qui sait ouvrir une PR. La relecture de ce fichier compte plus que celle de la plupart du code.
//
// ⚠️ IL REFUSE PLUTÔT QUE DE DEVINER. Une API qui ne répond pas, un registre illisible, un
// auteur que la forge ne reconnaît pas : dans tous ces cas la porte reste fermée, avec le motif
// écrit. Un CLA qui s'ouvre « parce qu'on n'a pas pu vérifier » ne protège rien — et c'est
// précisément la faute qu'on ne peut pas rattraper, puisque le code aura été fusionné.

import { pathToFileURL } from "node:url";
import {
  PHRASE_DE_SIGNATURE, auteursDe, lireRegistre, signatureDans, avecSignature, ecrireRegistre, verdict,
} from "./regles.mjs";

// ⚠️ LE CONTEXTE EST UN ARGUMENT, PAS UNE VARIABLE GLOBALE. C'est ce qui permet au banc
// (tools/__tests__/claVerifier.test.js) de rejouer le flux entier — commentaire posté, registre
// écrit, code de sortie — sans forge ni réseau. Une garde bloquante dont on n'a jamais VU la
// mécanique fonctionner n'est pas une garde éprouvée : ses règles seules le sont.
// Marqueur invisible : c'est par lui qu'on RETROUVE notre commentaire au lieu d'en empiler un
// nouveau à chaque passage. Un fil noyé sous dix rappels identiques ne se lit plus.
const MARQUEUR = "<!-- cla-assistant-maison -->";

function creerVerificateur(env = process.env, appeler = fetch) {
const DEPOT = env.GITHUB_REPOSITORY;
const JETON = env.CLA_TOKEN;
const PR = Number(env.CLA_PR);
const BRANCHE = env.CLA_BRANCHE || "cla-signatures";
const CHEMIN = env.CLA_CHEMIN || "signatures/v1/cla.json";

const api = async (chemin, options = {}) => {
  const reponse = await appeler(`https://api.github.com${chemin}`, {
    ...options,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${JETON}`,
      "x-github-api-version": "2022-11-28",
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...options.headers,
    },
  });
  if (!reponse.ok) {
    const detail = await reponse.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${chemin} → ${reponse.status} ${detail.slice(0, 200)}`);
  }
  return reponse.status === 204 ? null : reponse.json();
};

/**
 * ⚠️ L'AUTEUR AUTHENTIFIÉ DE LA PR — L'ANCRE, ET ELLE MANQUAIT (P0, revue externe du 21/08).
 * Ce fichier ne lisait que `/pulls/{n}/commits`, donc que de l'ATTRIBUTION : GitHub rattache un
 * commit à un compte par l'adresse écrite dans l'en-tête Git, que n'importe qui écrit localement.
 * `pull_request.user.login` est d'une autre nature — il a fallu s'authentifier auprès de la forge
 * pour ouvrir cette PR. C'est le seul login dont on tienne quelque chose.
 */
async function auteurDeLaPR() {
  const pr = await api(`/repos/${DEPOT}/pulls/${PR}`);
  const login = pr?.user?.login;
  if (!login) throw new Error("la forge n'a pas rendu l'auteur de la pull request — on refuse plutôt que de deviner");
  return login;
}

/** Tous les commits de la PR, pagination comprise — une PR longue ne doit pas passer à moitié. */
async function commitsDeLaPR() {
  const tout = [];
  for (let page = 1; page <= 10; page++) {
    const lot = await api(`/repos/${DEPOT}/pulls/${PR}/commits?per_page=100&page=${page}`);
    tout.push(...lot);
    if (lot.length < 100) return tout;
  }
  throw new Error("plus de 1000 commits dans cette PR — vérification refusée plutôt qu'approximée");
}

async function registreActuel() {
  try {
    const fichier = await api(`/repos/${DEPOT}/contents/${CHEMIN}?ref=${BRANCHE}`);
    return { registre: lireRegistre(Buffer.from(fichier.content, "base64").toString("utf8")), sha: fichier.sha };
  } catch (e) {
    if (String(e.message).includes("→ 404")) return { registre: [], sha: null };
    throw e;
  }
}

async function ecrireRegistreDistant(registre, sha, login) {
  await api(`/repos/${DEPOT}/contents/${CHEMIN}`, {
    method: "PUT",
    body: JSON.stringify({
      message: `chore(cla): ${login} signe le CLA (PR #${PR})`,
      content: Buffer.from(ecrireRegistre(registre), "utf8").toString("base64"),
      branch: BRANCHE,
      ...(sha ? { sha } : {}),
    }),
  });
}

/** Pose ou MET À JOUR notre commentaire. Jamais un deuxième : on édite le nôtre. */
async function direSurLaPR(corps) {
  const existants = await api(`/repos/${DEPOT}/issues/${PR}/comments?per_page=100`);
  const notre = existants.find((c) => String(c.body || "").includes(MARQUEUR));
  const body = JSON.stringify({ body: `${MARQUEUR}\n${corps}` });
  if (notre) await api(`/repos/${DEPOT}/issues/comments/${notre.id}`, { method: "PATCH", body });
  else await api(`/repos/${DEPOT}/issues/${PR}/comments`, { method: "POST", body });
}

const demande = (manquants, sansCompte) => [
  "Merci pour cette contribution. Il manque une chose, une seule fois et pour toujours :",
  "la signature du [CLA](https://github.com/Juli1artha/discovery-media-player/blob/main/CLA.md).",
  "",
  "**Vous gardez le droit d'auteur sur votre travail.** Vous accordez une licence, avec droit de",
  "sous-licencier — c'est ce qui permet au cœur de rester AGPL tout en autorisant une licence",
  "commerciale pour les organisations qui ne peuvent pas vivre avec la clause réseau. Sans accord",
  "de chacun, cette seconde licence devient impossible, définitivement.",
  "",
  manquants.length ? `En attente de : ${manquants.map((m) => `@${m}`).join(", ")}` : "",
  sansCompte.length
    ? `\n⚠️ Des commits n'ont **aucun compte GitHub** rattaché (${sansCompte.join(", ")}) : leur auteur ne peut pas signer. Recommittez-les avec l'adresse de votre compte.`
    : "",
  "",
  "Pour signer, répondez ici avec **exactement** cette ligne :",
  "",
  "---",
  "Thanks for this contribution. One thing is missing — once, and for good: signing the",
  "[CLA](https://github.com/Juli1artha/discovery-media-player/blob/main/CLA.md).",
  "",
  "**You keep the copyright in your work.** You grant a licence, with the right to sublicense —",
  "which is what lets the core stay AGPL while a commercial licence remains possible for",
  "organisations that cannot live with the network clause.",
  "",
  "To sign, reply here with **exactly** this line:",
  "",
  "```",
  PHRASE_DE_SIGNATURE,
  "```",
].filter((l) => l !== "").join("\n");

  async function principal() {
  if (!JETON || !DEPOT || !Number.isInteger(PR)) throw new Error("contexte incomplet : CLA_TOKEN, GITHUB_REPOSITORY et CLA_PR sont requis");

  const { authentifie, attribues, logins, sansCompte } =
    auteursDe({ auteurPR: await auteurDeLaPR(), commits: await commitsDeLaPR() });
  let { registre, sha } = await registreActuel();

  // Un commentaire peut VALOIR signature — mais seulement de la part d'un auteur, et seulement
  // avec la phrase exacte (cf. regles.mjs, éprouvé dans tools/__tests__/cla.test.js).
  if (env.CLA_EVENEMENT === "issue_comment") {
    const signataire = signatureDans(env.CLA_COMMENTAIRE, env.CLA_AUTEUR_COMMENTAIRE, logins);
    if (signataire) {
      const augmente = avecSignature(registre, signataire, {
        id: Number(env.CLA_AUTEUR_ID) || null, pullRequestNo: PR, horodatage: new Date().toISOString(),
      });
      if (augmente !== registre) { await ecrireRegistreDistant(augmente, sha, signataire); registre = augmente; }
      console.log(`signature enregistrée : ${signataire}`);
    }
  }

  const v = verdict({ authentifie, attribues, sansCompte, registre });
  if (v.ouvre) {
    console.log(`CLA : ouverte par ${authentifie}${attribues.length ? `, avec ${attribues.join(", ")}` : ""} — rien à signer`);
    await direSurLaPR("✅ CLA en règle — merci. Cette signature couvre toutes vos contributions à venir sur ce dépôt.").catch(() => {});
    return 0;
  }

  await direSurLaPR(demande(v.manquants, v.sansCompte));
  console.error(`::error::CLA non signé par : ${[...v.manquants, ...v.sansCompte].join(", ")}`);
  return 1;
}

  return principal;
}

export { creerVerificateur };

/** Le flux complet, avec son refus par défaut. Rend le code de sortie plutôt que de sortir. */
export async function executer(env = process.env, appeler = fetch) {
  try {
    return await creerVerificateur(env, appeler)();
  } catch (e) {
    // ⚠️ ON REFUSE, ON N'OUVRE PAS. Une panne d'API n'est pas une autorisation.
    console.error(`::error::vérification du CLA impossible — la porte reste fermée : ${e.message}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(await executer());
}
