// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { ecarts as ecartsChangelog, sections, sectionDe } from "./changelog.mjs";
import { ecartsExemples, exemplesDuDepot, versionsPubliees, acceptables, registreExploitable } from "./exemples-epingles.mjs";
import { VIOLATION, INCONCLUSIF } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

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

// ⚠️ LA RÈGLE DES EXEMPLES A VÉCU ICI EN DOUBLE, ET LES DEUX EXEMPLAIRES SE CONTREDISAIENT.
//
// Ce fichier exigeait « les exemples épinglent la version qu'on publie ». `ci.yml` exigeait
// l'inverse : une version pas encore SERVIE casse le déploiement de la démo, qui installe depuis
// npm. Les deux règles étaient donc mutuellement INSATISFIABLES — quoi qu'on épingle à l'heure de
// publier, l'une des deux refusait. Constaté en les faisant tourner côte à côte (21/08) ; ni l'une
// ni l'autre n'avait tort dans son fichier, et personne ne les avait mises face à face.
//
// « Un fait qui existe en deux exemplaires que rien ne confronte finit par diverger » : ici il
// avait déjà divergé, et c'est la procédure de sortie qui l'aurait payé. La règle vit maintenant
// dans `tools/exemples-epingles.mjs`, une fois, et les deux la lisent.

/** Un tag déjà posé ne se repose pas : soit la sortie est faite, soit elle est à réparer. */
export function ecartTagExistant(tag, tagsConnus) {
  return tagsConnus.includes(tag) ? `le tag ${tag} existe déjà — une sortie ne se rejoue pas en la retaguant` : null;
}

/**
 * Les noms de tags que `git ls-remote --tags origin` annonce, tels qu'on doit les comparer.
 *
 * ⚠️ UN TAG ANNOTÉ SORT DEUX FOIS : `refs/tags/v0.1.1` pour l'objet-tag, et `refs/tags/v0.1.1^{}`
 * pour le commit qu'il désigne. Les deux existent bel et bien sur ce dépôt — mesuré le 01/09, la
 * moitié des lignes de `ls-remote` porte le suffixe. Le second n'est pas un tag de plus : c'est le
 * même, déréférencé.
 *
 * ⚠️ ET CETTE LECTURE VIVAIT DANS LA FONCTION PRINCIPALE, DONC NULLE PART OÙ ON PUISSE L'ÉPROUVER.
 * Le préflight ne s'exécute pas sans un dépôt, un réseau et une version à sortir ; le balayage de
 * mutation le déclarait « mesuré sur rien » et passait. Sortie ici, elle a un banc. Le suffixe
 * retiré, `ecartTagExistant` compare des noms comparables ; laissé, il ajoute une entrée qui ne
 * ressemble à aucun tag qu'on poserait — inoffensif aujourd'hui parce que la ligne NUE est là
 * aussi, et c'est exactement le genre de « inoffensif aujourd'hui » qu'on préfère écrire.
 */
export const tagsDuDistant = (sortie) =>
  String(sortie || "").split("\n")
    .map((l) => l.split("refs/tags/")[1])
    .filter(Boolean)
    .map((t) => t.replace(/\^\{\}$/, ""));

// ── Le relevé, sur le dépôt réel ──────────────────────────────────────────────────────────────

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

  // 6. Les exemples épinglent l'une des deux dernières PUBLIÉES — pas celle qu'on s'apprête à
  //    publier, qui n'est servie par personne au moment où on lit ces lignes.
  //    ⚠️ Sans registre, on ne CONCLUT PAS. Le repli de `ci.yml` (« exiger la version de main »)
  //    serait ici le pire des choix : c'est exactement la version qui ne doit pas y être. Le
  //    préflight sait dire « je n'ai pas regardé » — c'est sa règle depuis le premier jour.
  const exemples = exemplesDuDepot(racine);
  const publiees = reseau ? versionsPubliees() : null;
  // ⚠️ « a répondu » ne suffit pas : un registre qui ne sert que des préversions ne nomme aucune
  // version épinglable. `registreExploitable` porte cette nuance UNE fois, et les deux outils la
  // lisent — c'est la même correction que celle appliquée à la garde de CI le 22/08.
  if (!registreExploitable(publiees)) {
    inconnu("les exemples épinglent une version servie",
      !reseau ? "réseau désactivé" : publiees ? "le registre n'a nommé aucune version stable" : "le registre n'a pas répondu",
      "npm view discovery-media-player versions --json");
  } else {
    const soucisExemples = ecartsExemples(version, publiees, exemples);
    ajoute("les exemples épinglent une version servie", soucisExemples.length ? soucisExemples.join(" | ") : null,
      `${exemples.length} exemples sur ${acceptables(version, publiees).join(" ou ")}`);
  }

  // 7. Le tag est libre — localement ET sur le distant.
  const locaux = essaye(() => git("tag", "-l").split("\n").filter(Boolean), []);
  ajoute("le tag est libre en local", ecartTagExistant(tag, locaux), `${tag} disponible`);
  if (reseau) {
    const distants = essaye(() => tagsDuDistant(git("ls-remote", "--tags", "origin")), null);
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
  // ⚠️ LES DEUX COMPTES SORTENT D'ICI, ET LE SECOND MANQUAIT. `nonVus` était calculé pour la PHRASE
  // et jeté ensuite : l'appelant ne recevait que `echecs`, donc un préflight où RIEN n'avait pu
  // être vérifié rendait 0. Le texte le disait honnêtement — « 2 contrôle(s) n'ont PAS été
  // vérifiés » — mais le CODE DE SORTIE, seul lu par un script ou une CI, disait « vas-y ».
  // Une garde dont la prose et le verdict machine divergent est celle qu'on croira le jour où
  // on ne lira pas la prose. Et c'est le préflight de PUBLICATION.
  lignes.push("");
  if (echecs.length) lignes.push(`REFUSÉ : ${echecs.length} contrôle(s) en échec. Ne posez pas ${tag}.`);
  else if (nonVus.length) lignes.push(`Rien ne s'oppose à ${tag} — mais ${nonVus.length} contrôle(s) n'ont PAS été vérifiés (voir « ? »). Vérifiez-les à la main avant de taguer.`);
  else lignes.push(`Publiable : git tag -a ${tag} -m "${version}" && git push origin ${tag}`);
  return { texte: lignes.join("\n"), echecs: echecs.length, nonVerifies: nonVus.length };
}

// ⚠️ TROIS ISSUES, PAS DEUX — et les codes viennent d'`resultat-garde.mjs` plutôt que d'être
// réécrits ici : un fait en deux exemplaires diverge tant que personne ne les confronte, et c'est
// précisément le contrat que ce dépôt vient d'unifier.
//
// Ce fichier n'emprunte pas `rendre()` : il imprime un RAPPORT destiné à un humain qui s'apprête à
// taguer, pas des lignes `::error::` pour un journal de forge. Ce qu'il partage avec les autres
// gardes, c'est la SIGNIFICATION des codes — la seule chose qu'un appelant lit.
if (estExecuteDirectement(import.meta.url)) {
  // ⚠️ UNE EXCEPTION EST UN RÉSULTAT NON CONCLUANT, PAS UN REFUS DE PUBLIER. Sans ce filet, un
  // `git` indisponible ou un CHANGELOG absent remontait jusqu'à Node, qui sortait 1 — c'est-à-dire
  // « REFUSÉ, ne posez pas ce tag », avec une trace de pile en guise d'explication. Le refus
  // prudent de la garde prenait l'apparence d'un verdict sur la sortie.
  let rendu;
  try {
    rendu = rapport(preflight());
  } catch (e) {
    console.error("::error::GARDE NON CONCLUANTE — le préflight n'a pas pu s'exécuter : "
      + ((e && e.message) || e) + " ; le correctif est dans son environnement, pas dans la branche");
    process.exit(INCONCLUSIF);
  }
  console.log(rendu.texte);
  if (rendu.echecs) process.exit(VIOLATION);
  if (rendu.nonVerifies) process.exit(INCONCLUSIF);
}
