// LES SECRETS EN CLAIR — CE QUE `.gitignore` NE PEUT PAS ATTRAPER.
//
// ⚠️ LA PROPRIÉTÉ ÉTAIT TENUE, LE CONTRÔLE MANQUAIT. Le dépôt n'a jamais porté de secret, et
// `.gitignore` exclut `.env` et `.env.*`. Aucune de ces deux choses n'est une garde :
//
//   - `.gitignore` ne protège qu'un CHEMIN. Un jeton collé dans un test, une clé PEM dans une
//     fixture, un `git add -f .env` « juste pour essayer » — les trois entrent sans qu'un seul
//     motif les regarde. Le fichier ignoré est le seul cas couvert, et c'est le plus rare.
//   - « on n'en a jamais commité » décrit le passé. C'est le raisonnement que
//     `tools/__tests__/planchersDesGardes.test.js` refuse ailleurs, mot pour mot : une propriété
//     tenue par la mémoire de ses auteurs tient jusqu'au jour où l'un d'eux l'oublie, et personne
//     ne peut savoir à l'avance lequel de ces jours c'est.
//
// Et un secret n'est pas une régression comme une autre : il ne se corrige pas par un commit.
// Réécrire l'historique ne suffit pas non plus — ce qui a été poussé une minute sur un dépôt
// public est à considérer comme divulgué, et la seule issue est la RÉVOCATION. D'où une garde qui
// refuse AVANT le push (`tools/git-hooks/pre-push`) et pas seulement en CI.
//
// ⚠️ LES MOTIFS NE SE RECONNAISSENT PAS EUX-MÊMES, ET CE N'EST PAS UN HASARD. Une garde qui
// s'analyse elle-même est le piège classique de l'espèce : elle rougit sur son propre source, on
// l'exempte, et l'exemption devient le trou. Ici chaque motif est écrit avec une CLASSE de
// caractères là où le secret porte des caractères — `AKIA[0-9A-Z]{16}` ne matche pas le texte
// « AKIA[0-9A-Z]{16} », parce qu'après `AKIA` vient `[`, qui n'est pas dans la classe. Aucun
// fichier n'a donc besoin d'être exempté, ni celui-ci, ni son banc — qui, pour la même raison,
// fabrique ses faux secrets par concaténation à l'exécution plutôt que de les écrire.
//
// ⚠️ ON N'IMPRIME JAMAIS CE QU'ON TROUVE. Un journal de CI est public sur un dépôt public : une
// garde qui recopie le secret dans son message d'erreur le divulgue une seconde fois, à un
// endroit qui, lui, ne se révoque pas. Le constat nomme le fichier, la ligne et l'ESPÈCE du
// secret — assez pour le retrouver en trois secondes, rien pour l'utiliser.
//
// Usage : node tools/secrets-en-clair.mjs [chemin...]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { estExecuteDirectement } from "./execute-directement.mjs";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";

/**
 * ⚠️ CE QU'ON CHERCHE EST CE QU'ON PEUT AFFIRMER. Chaque motif ci-dessous décrit une chaîne dont
 * la FORME suffit à dire qu'elle est un identifiant d'authentification — préfixe attribué par
 * l'émetteur, longueur imposée. On ne cherche donc PAS « une chaîne qui a l'air aléatoire » : un
 * condensat, un SHA d'action épinglée et un nonce CSP y ressemblent tous, et une garde qui sonne
 * sur eux apprend à ses lecteurs à passer outre. « Une alerte qui sonne quand tout va bien apprend
 * aux gens à cliquer à côté » : le prix de ce choix est qu'un secret sans forme reconnaissable
 * passe, et c'est la règle des `.env` plus bas qui rattrape ce cas-là.
 */
export const ESPECES = [
  ["clé privée PEM", /-{5}BEGIN (?:[A-Z]+ )?PRIVATE KEY-{5}/],
  ["identifiant de clé AWS", /AKIA[0-9A-Z]{16}/],
  ["jeton GitHub", /gh[pousr]_[A-Za-z0-9]{36,}/],
  ["jeton npm", /npm_[A-Za-z0-9]{36}/],
  ["jeton Slack", /xox[abprs]-[0-9A-Za-z-]{10,}/],
  ["clé d'API Google", /AIza[0-9A-Za-z_-]{35}/],
  ["clé secrète Stripe (live)", /sk_live_[0-9A-Za-z]{20,}/],
];

/**
 * ⚠️ LE JWT EST LE SEUL CAS OÙ LA FORME NE SUFFIT PAS, ET C'EST PRÉCISÉMENT NOTRE CAS. Supabase
 * émet DEUX jetons de la même forme : la clé publiable, qui a vocation à partir dans un
 * navigateur, et la clé `service_role`, qui contourne toute politique de ligne et dont
 * `SECURITY.md` dit qu'elle n'est lue que côté serveur. Sonner sur les deux rendrait la garde
 * fausse le jour où une documentation montre légitimement la première.
 *
 * On DÉCODE donc la charge utile — c'est du base64url, pas du chiffrement, et n'importe qui le
 * fait — et on ne retient que le rôle qui donne les pleins pouvoirs.
 */
export function estJetonServiceRole(jwt) {
  const charge = jwt.split(".")[1];
  if (!charge) return false;
  try {
    const json = Buffer.from(charge.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    return /"role"\s*:\s*"service_role"/.test(json);
  } catch {
    return false; // charge illisible : ce n'est pas un JWT, donc pas celui qu'on cherche
  }
}

const JWT = /eyJ[0-9A-Za-z_-]{6,}\.[0-9A-Za-z_-]{20,}\.[0-9A-Za-z_-]{10,}/g;

/**
 * ⚠️ LA RÈGLE PROPRE À CE DÉPÔT, ET CELLE QUI ATTRAPE LE CAS RÉEL. `.env.example` déclare
 * vingt-et-une variables dont le NOM annonce un secret — `SUPABASE_SERVICE_ROLE_KEY`,
 * `PLAYER_HOST_FETCH_SECRET`, `PLAYER_IP_HASH_SECRET` — et les porte toutes à valeur VIDE. C'est
 * la bonne convention, elle est tenue partout, et rien ne l'exigeait.
 *
 * Or l'accident qui remplit un `.env.example` n'est pas une faute de frappe : c'est quelqu'un qui
 * a rempli le fichier pour faire tourner l'exemple sur SA machine, et qui le commite avec le
 * reste. Le secret n'a alors aucune forme reconnaissable — c'est une phrase de passe, une chaîne
 * de vingt caractères — et aucun motif de la liste ci-dessus ne le verra jamais. Seul son NOM le
 * trahit, et le nom, on l'a.
 *
 * ⚠️ CE QUI RESTE PERMIS EST CE QUI NE PEUT PAS ÊTRE UN SECRET : le vide, et une valeur qui se
 * DÉSIGNE comme un gabarit (`<…>`, `…`, `changeme`, `xxx`). Tout le reste est refusé, y compris
 * ce qui paraît inoffensif — la garde ne sait pas distinguer « exemple réaliste » de « vraie clé
 * de la préproduction », et c'est exactement la confusion qui produit l'incident.
 */
/**
 * ⚠️ LE MOT PEUT ÊTRE N'IMPORTE OÙ DANS LE NOM, PAS SEULEMENT À LA FIN. La première version était
 * ancrée en fin (`…$`) : elle voyait `PLAYER_HOST_FETCH_SECRET` et ratait `SECRET_KEY_BASE`,
 * `API_TOKEN_VALUE`, `PRIVATE_KEY_PATH`, `SIGNING_KEYS` — des noms parfaitement courants, et
 * précisément le genre de secret que cette règle existe pour attraper, puisqu'il n'a aucune forme
 * reconnaissable. Une règle qui ne couvre que les noms bien terminés donne l'assurance sans la
 * couverture, ce qui est pire que pas de règle : on cesse de regarder.
 *
 * Les bornes `(^|_)` et `(_|$)` évitent l'excès inverse : `KEYCLOAK_URL` ou `TOKENIZER` ne sont
 * pas des secrets, et une garde qui les refuse s'use aussi vite qu'une garde qui rate.
 *
 * ⚠️ ET `PUBLIC` / `PUBLISHABLE` SORT DE LA RÈGLE, DÉLIBÉRÉMENT. Une clé publiable est FAITE pour
 * atteindre un navigateur : `SUPABASE_PUBLISHABLE_KEY` avec sa valeur est la configuration
 * normale, pas un incident. C'est la même distinction que ce fichier fait déjà plus haut en
 * décodant les JWT Supabase pour ne refuser que `service_role`.
 */
const NOM_DE_SECRET = /(^|_)(SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIALS?|KEY|KEYS)(_|$)/;
const NOM_PUBLIC = /(^|_)(PUBLIC|PUBLISHABLE|ANON)(_|$)/;
const GABARIT = /^(?:<.*>|\.{3}|…|x{3,}|changeme|change_me|your[-_].*|todo|placeholder|dummy|example)$/i;

/**
 * La valeur d'une ligne `.env`, telle que dotenv la lirait.
 *
 * ⚠️ UN COMMENTAIRE EN FIN DE LIGNE N'EST PAS UNE VALEUR, et la première version le prenait pour
 * un secret. `PLAYER_IP_HASH_SECRET=   # openssl rand -base64 48` est l'idiome dotenv standard —
 * valeur VIDE, plus l'indication de comment la fabriquer — et la garde y voyait
 * `# openssl rand -base64 48`, refusait, et bloquait le `pre-push` ET la CI pour un secret absent.
 *
 * Une garde qui sonne quand tout va bien apprend à passer outre, et c'est le jour où elle a raison
 * qu'on ne la lit plus. Le prix de ce faux positif était d'autant plus élevé qu'il tombait sur le
 * geste le plus courant : documenter comment engendrer la valeur qu'on ne commite pas.
 *
 * ⚠️ SEULEMENT SI LA VALEUR N'EST PAS CITÉE. `SECRET="abc # def"` porte un `#` qui fait partie du
 * secret ; le tronquer laisserait passer une vraie valeur en n'en jugeant qu'un morceau.
 */
export function valeurDe(brut) {
  const t = String(brut).trim();
  const cite = /^(['"])(.*)\1/.exec(t);
  if (cite) return cite[2].trim();
  // ⚠️ ON RETIRE LE COMMENTAIRE SUR LA CHAÎNE BRUTE, PAS SUR LA CHAÎNE ÉBARBÉE. Écrit
  // `t.replace(/\s+#.*$/, "")`, le cas qui compte échouait : `SECRET=   # openssl rand …` a son
  // espace mangé par le `trim()`, la valeur commence donc par `#`, et il n'y a plus d'espace à
  // faire correspondre. La ligne exacte que ce correctif vise passait à côté du correctif.
  // `(^|\s)#` couvre les deux : commentaire seul, et commentaire après une valeur.
  return String(brut).replace(/(^|\s)#.*$/, "").trim();
}

export function secretsDeEnv(texte) {
  const trouves = [];
  texte.split(/\r?\n/).forEach((ligne, i) => {
    const m = /^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(ligne);
    if (!m) return;
    const [, nom, brut] = m;
    if (!NOM_DE_SECRET.test(nom) || NOM_PUBLIC.test(nom)) return;
    const valeur = valeurDe(brut);
    if (!valeur || GABARIT.test(valeur)) return;
    trouves.push({ ligne: i + 1, espece: `valeur écrite pour « ${nom} », dont le nom annonce un secret` });
  });
  return trouves;
}

/** Les espèces reconnaissables à leur forme, dans n'importe quel fichier texte. */
export function secretsDeTexte(texte) {
  const trouves = [];
  const lignes = texte.split(/\r?\n/);
  lignes.forEach((ligne, i) => {
    for (const [espece, motif] of ESPECES) {
      if (motif.test(ligne)) trouves.push({ ligne: i + 1, espece });
    }
    for (const jwt of ligne.match(JWT) || []) {
      if (estJetonServiceRole(jwt)) trouves.push({ ligne: i + 1, espece: "jeton Supabase service_role" });
    }
  });
  return trouves;
}

/**
 * ⚠️ SUR LES FICHIERS SUIVIS, PAS SUR LE DOSSIER. Un `node_modules` ou un `dist/` local ferait
 * sonner la garde sur du code qui n'est pas le nôtre et qui n'entrera jamais dans un commit. La
 * question posée est « le dépôt PORTE-t-il un secret », et le dépôt, c'est ce que git suit.
 */
export function fichiersSuivis(chemins = []) {
  const sortie = execFileSync("git", ["ls-files", "-z", "--", ...chemins], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });
  return sortie.split("\0").filter(Boolean);
}

export function inspecter(fichiers, lire = (f) => readFileSync(f, "utf8")) {
  const constats = [];
  for (const fichier of fichiers) {
    let texte;
    try {
      texte = lire(fichier);
    } catch {
      continue; // illisible ou disparu entre le relevé et la lecture : rien à affirmer dessus
    }
    // ⚠️ UN BINAIRE N'EST PAS ANALYSÉ, ET IL EST DIT POURQUOI. Le PDF de démonstration
    // (`examples/demo/documents/sample.pdf`) produirait des correspondances au hasard de ses
    // octets. Un secret n'est pas déposé dans un PDF par accident ; un faux positif dans un PDF,
    // lui, arrive à chaque exécution.
    if (texte.includes("\0")) continue;
    const nom = fichier.split("/").pop() || "";
    const trouves = nom.startsWith(".env")
      ? [...secretsDeTexte(texte), ...secretsDeEnv(texte)]
      : secretsDeTexte(texte);
    for (const t of trouves) constats.push(`${fichier}:${t.ligne} : ${t.espece} — un secret poussé est à considérer comme divulgué : RÉVOQUEZ-LE, puis retirez-le de la branche`);
  }
  return constats;
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    // ⚠️ `tenter` parce que `git ls-files` LÈVE hors d'un dépôt git — un refus prudent de la
    // garde, pas une faute de la branche (voir tools/resultat-garde.mjs).
    const fichiers = fichiersSuivis(process.argv.slice(2));
    if (!fichiers.length) return inconclusif("aucun fichier suivi relevé — la sonde vise à côté");
    const constats = inspecter(fichiers);
    if (constats.length) return violation(constats);
    return conforme(`secrets : ${fichiers.length} fichier(s) suivi(s) inspecté(s), aucun identifiant d'authentification en clair`);
  }));
}
