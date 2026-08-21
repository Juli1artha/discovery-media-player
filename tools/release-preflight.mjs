// AVANT DE POSER UN TAG — TOUT CE QUI PEUT SE CONSTATER, CONSTATÉ.
//
// ⚠️ TROIS FOIS LA PUBLICATION A ÉTÉ LE POINT DE RUPTURE, ET UNE QUATRIÈME S'Y EST AJOUTÉE.
//   0.1.15 — publiée SANS son correctif ;
//   0.1.25 — publiée CASSÉE ;
//   0.1.35 — JAMAIS publiée : PR fusionnée, tag oublié ;
//   0.1.121 — tag posé sur un commit dont le paquet déclarait encore la version précédente. Les
//             gardes de Release/Image ont refusé — elles ont fait leur travail — puis le tag a été
//             recréé quelques minutes plus tard sur le bon commit (troisième audit externe, 21/08).
//
// Les gardes de la forge attrapent l'erreur APRÈS le tag : elles rougissent, il faut comprendre,
// supprimer, refaire. Ce préflight se lance AVANT, sur la machine de qui publie, et répond à une
// seule question : « ce commit est-il publiable, maintenant ? »
//
// ⚠️ IL NE CRÉE NI TAG NI RELEASE, ET NE POUSSE RIEN. Lecture seule, entièrement. Un outil qui
// vérifie ET agit finit par agir sur une vérification incomplète.
//
// ⚠️ ET IL NE PRÉTEND PAS VÉRIFIER CE QU'IL NE VÉRIFIE PAS. Sans `gh`, l'état de la CI lui est
// inaccessible : il le dit, en NON VÉRIFIÉ, avec la commande exacte à lancer — au lieu de rendre
// un vert qui vaudrait pour « je n'ai pas regardé ». C'est la règle que ce dépôt applique à ses
// propres gardes muettes depuis la 0.1.35.
//
// Usage : node tools/release-preflight.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ecarts as ecartsChangelog, sections, sectionDe } from "./changelog.mjs";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const essaye = (fn, defaut = null) => { try { return fn(); } catch { return defaut; } };

// ── Les comparaisons pures : testables sans dépôt, sans réseau ────────────────────────────────

/** La version du paquet doit être celle que le CHANGELOG annonce en tête. */
export function ecartVersionChangelog(versionPaquet, txtChangelog) {
  const derniere = sections(txtChangelog)[0];
  if (!derniere) return "le CHANGELOG n'a aucune section de version";
  if (derniere !== versionPaquet) {
    return `package.json déclare ${versionPaquet}, la section la plus récente du CHANGELOG est ${derniere}`;
  }
  return null;
}

/** Une sortie sans notes est une sortie qui s'annonce sans se décrire. */
export function ecartNotes(version, txtChangelog) {
  const corps = sectionDe(txtChangelog, version);
  if (!corps) return `le CHANGELOG n'a pas de section [${version}] — pas de notes, pas de sortie`;
  if (corps.length < 40) return `la section [${version}] est quasi vide (${corps.length} caractères)`;
  return null;
}

/** Les exemples sont ce que les gens RECOPIENT : ils épinglent la version qu'on publie. */
export function ecartsExemples(versionPaquet, exemples) {
  return exemples
    .filter((e) => e.version !== versionPaquet)
    .map((e) => `${e.fichier} épingle ${e.version}, on publie ${versionPaquet}`);
}

/** Un tag déjà posé ne se repose pas : soit la sortie est faite, soit elle est à réparer. */
export function ecartTagExistant(tag, tagsConnus) {
  return tagsConnus.includes(tag) ? `le tag ${tag} existe déjà — une sortie ne se rejoue pas en la retaguant` : null;
}

// ── Le relevé, sur le dépôt réel ──────────────────────────────────────────────────────────────

function exemplesDuDepot(racine = ".") {
  const dossier = join(racine, "examples");
  if (!existsSync(dossier)) return [];
  const trouves = [];
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const p = join(dossier, e.name, "package.json");
    if (!e.isDirectory() || !existsSync(p)) continue;
    const dep = JSON.parse(readFileSync(p, "utf8")).dependencies?.["discovery-media-player"];
    if (dep) trouves.push({ fichier: `examples/${e.name}/package.json`, version: dep });
  }
  return trouves;
}

export function preflight({ racine = ".", reseau = true } = {}) {
  const controles = [];
  const ajoute = (nom, souci, detail) => controles.push({ nom, etat: souci ? "ECHEC" : "OK", message: souci || detail });
  const inconnu = (nom, pourquoi, commande) => controles.push({ nom, etat: "NON VÉRIFIÉ", message: pourquoi, commande });

  const version = JSON.parse(readFileSync(join(racine, "package.json"), "utf8")).version;
  const tag = `v${version}`;
  const changelog = readFileSync(join(racine, "CHANGELOG.md"), "utf8");

  // 1. L'arbre de travail. Un fichier non commité ne part pas dans le tag, mais a pu servir à
  //    faire passer les contrôles qu'on vient de lancer.
  const sale = essaye(() => git("status", "--porcelain"));
  ajoute("arbre de travail propre", sale ? `fichiers non commités :\n    ${sale.split("\n").join("\n    ")}` : null,
    "rien en attente");

  // 2. Le commit candidat EST celui de main. Publier depuis autre chose publie ce que personne
  //    n'a relu.
  if (reseau) essaye(() => git("fetch", "--quiet", "origin", "main"));
  const tete = essaye(() => git("rev-parse", "HEAD"));
  const principale = essaye(() => git("rev-parse", "origin/main"));
  if (!principale) inconnu("HEAD est origin/main", "origin/main introuvable (dépôt sans distant ?)", "git fetch origin main");
  else ajoute("HEAD est origin/main", tete !== principale ? `HEAD=${tete?.slice(0, 8)} ≠ origin/main=${principale.slice(0, 8)}` : null,
    `${tete?.slice(0, 8)}`);

  // 3. Les deux exemplaires de la version : le manifeste et le journal.
  ajoute("package.json et CHANGELOG s'accordent", ecartVersionChangelog(version, changelog), `${version}`);

  // 4. Les notes existent AVANT la sortie — c'est elles que la Release publiera.
  ajoute("la section du CHANGELOG a des notes", ecartNotes(version, changelog), "notes présentes");

  // 5. Les références de comparaison, exactes.
  const soucisChangelog = ecartsChangelog(changelog);
  ajoute("références du CHANGELOG exactes", soucisChangelog.length ? soucisChangelog.join(" | ") : null,
    `${sections(changelog).length} sections`);

  // 6. Les exemples suivent.
  const exemples = exemplesDuDepot(racine);
  const soucisExemples = ecartsExemples(version, exemples);
  ajoute("les exemples épinglent cette version", soucisExemples.length ? soucisExemples.join(" | ") : null,
    `${exemples.length} exemples sur ${version}`);

  // 7. Le tag est libre — localement ET sur le distant.
  const locaux = essaye(() => git("tag", "-l").split("\n").filter(Boolean), []);
  ajoute("le tag est libre en local", ecartTagExistant(tag, locaux), `${tag} disponible`);
  if (reseau) {
    const distants = essaye(() => git("ls-remote", "--tags", "origin")
      .split("\n").map((l) => l.split("refs/tags/")[1]).filter(Boolean).map((t) => t.replace(/\^\{\}$/, "")), null);
    if (distants === null) inconnu("le tag est libre sur origin", "le distant n'a pas répondu", "git ls-remote --tags origin");
    else ajoute("le tag est libre sur origin", ecartTagExistant(tag, distants), `${tag} disponible`);
  }

  // 8. La CI du commit exact. ⚠️ Publier sur du rouge est le trou jumeau d'une fusion sans
  //    protection de branche : la 0.1.68 est partie pendant que sa CI était rouge.
  const aGh = essaye(() => { execFileSync("gh", ["--version"], { stdio: "ignore" }); return true; }, false);
  if (!reseau || !aGh) {
    inconnu("la CI du commit est verte", aGh ? "réseau désactivé" : "`gh` n'est pas installé — cet outil ne peut pas voir la forge",
      `gh run list --commit ${tete || "<sha>"} --workflow CI --json status,conclusion`);
  } else {
    const etat = essaye(() => execFileSync("gh",
      ["run", "list", "--commit", tete, "--workflow", "CI", "--json", "status,conclusion", "-q", '.[0] | "\\(.status) \\(.conclusion)"'],
      { encoding: "utf8" }).trim(), null);
    if (!etat) inconnu("la CI du commit est verte", "aucune course CI visible pour ce commit", `gh run list --commit ${tete}`);
    else ajoute("la CI du commit est verte", etat !== "completed success" ? `la CI conclut « ${etat} »` : null, etat);
  }

  return { version, tag, controles };
}

export function rapport({ version, tag, controles }) {
  const lignes = [`Préflight de publication — ${tag}`, ""];
  const large = Math.max(...controles.map((c) => c.nom.length));
  for (const c of controles) {
    const marque = c.etat === "OK" ? "  ok " : c.etat === "ECHEC" ? "ECHEC" : "  ?  ";
    lignes.push(`${marque} ${c.nom.padEnd(large)}  ${c.message}`);
    if (c.commande) lignes.push(`${" ".repeat(large + 7)}→ ${c.commande}`);
  }
  const echecs = controles.filter((c) => c.etat === "ECHEC");
  const nonVus = controles.filter((c) => c.etat === "NON VÉRIFIÉ");
  lignes.push("");
  if (echecs.length) lignes.push(`REFUSÉ : ${echecs.length} contrôle(s) en échec. Ne posez pas ${tag}.`);
  else if (nonVus.length) lignes.push(`Rien ne s'oppose à ${tag} — mais ${nonVus.length} contrôle(s) n'ont PAS été vérifiés (voir « ? »). Vérifiez-les à la main avant de taguer.`);
  else lignes.push(`Publiable : git tag -a ${tag} -m "${version}" && git push origin ${tag}`);
  return { texte: lignes.join("\n"), echecs: echecs.length };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { texte, echecs } = rapport(preflight());
  console.log(texte);
  process.exit(echecs ? 1 : 0);
}
