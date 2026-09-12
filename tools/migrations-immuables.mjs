// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE MIGRATION PUBLIÉE NE CHANGE PLUS — PAS MÊME SES COMMENTAIRES.
//
// ⚠️ CETTE GARDE NAÎT D'UN SIGNAL QU'UN HÔTE A REÇU, ET QUE NOUS N'AVIONS PAS VU PARTIR. Entre
// 0.1.163 et 0.1.164, `supabase/migrations/0004-limites-atomiques.sql` a changé : un commentaire
// corrigé en place, parce qu'il portait une affirmation retirée (« non atomiques ») et que la règle
// de ce dépôt est de corriger là où la phrase a été lue. Aucune instruction SQL touchée. Mais les
// migrations VOYAGENT dans le tarball depuis qu'elles y sont : ce ne sont plus des documents, ce
// sont des artefacts que des hôtes ont déjà EXÉCUTÉS — et un hôte prudent les empreinte. Pour lui,
// un fichier de migration qui bouge après application est exactement le scénario qu'il redoute, et
// il a dû faire un `diff -u` pour apprendre que rien n'était à ré-appliquer. (Relevé par l'hôte ADV,
// 13/09/2026.)
//
// La règle qui en sort : **une migration présente dans la dernière version publiée est identique,
// octet pour octet, dans l'arbre de travail.** Une correction de prose se porte dans le contrat ou
// dans une migration NEUVE, jamais dans un fichier qu'un hôte a déjà appliqué. C'est pour cela que
// `affirmations-retirees.mjs` traite désormais `supabase/migrations/` comme une archive : les deux
// gardes se contrediraient sinon, l'une exigeant la correction en place que l'autre interdit.
//
// ⚠️ LA RÉFÉRENCE EST LE TAG LE PLUS HAUT, PAS « LE DERNIER ». `git tag -l` rend un ordre lexical
// (`v0.1.9` après `v0.1.164`) ; on compare des triplets numériques. Et sans tag lisible — dépôt cloné
// sans tags, `git` absent — la confrontation n'est pas possible : NON CONCLUANT, jamais vert.
//
// ⚠️ ELLE COMPARE DES OCTETS, PAS DES INSTRUCTIONS. Filtrer les commentaires pour ne comparer que le
// SQL « utile » rendrait la garde verte sur précisément le cas qui l'a fait naître.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOSSIER = "supabase/migrations";

/** Le tag `vX.Y.Z` le plus haut d'une sortie `git tag -l`, ou null. Triplets numériques, pas lexical. */
export function tagLePlusHaut(sortie) {
  const tags = String(sortie || "").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^v\d+\.\d+\.\d+$/.test(l));
  let meilleur = null, cle = null;
  for (const t of tags) {
    const k = t.slice(1).split(".").map(Number);
    if (!cle || k[0] > cle[0] || (k[0] === cle[0] && (k[1] > cle[1] || (k[1] === cle[1] && k[2] > cle[2])))) { meilleur = t; cle = k; }
  }
  return meilleur;
}

/**
 * Confronte les migrations publiées dans `tag` à celles de l'arbre de travail.
 * `publiees` : { chemin → contenu au tag } ; `lireIci(chemin)` : contenu dans l'arbre, ou null si absent.
 */
export function confronter(publiees, lireIci) {
  const modifiees = [], disparues = [];
  for (const [chemin, contenu] of Object.entries(publiees)) {
    const ici = lireIci(chemin);
    if (ici === null) disparues.push(chemin);
    else if (ici !== contenu) modifiees.push(chemin);
  }
  return { modifiees, disparues };
}

export function auditer(racine = RACINE, {
  lireTags = () => execFileSync("git", ["tag", "-l"], { cwd: racine, encoding: "utf8" }),
  listerAuTag = (tag) => execFileSync("git", ["ls-tree", "--name-only", tag, `${DOSSIER}/`], { cwd: racine, encoding: "utf8" }),
  lireAuTag = (tag, chemin) => execFileSync("git", ["show", `${tag}:${chemin}`], { cwd: racine, encoding: "utf8" }),
} = {}) {
  let tags;
  try { tags = lireTags(); } catch (e) {
    return inconclusif(`\`git tag -l\` a échoué (${e && e.message ? e.message.split("\n")[0] : "cause inconnue"}) : sans tags, la`
      + " confrontation avec la dernière version publiée ne peut pas être établie, et rien n'a été vérifié");
  }
  const tag = tagLePlusHaut(tags);
  if (!tag) {
    return inconclusif("aucun tag de version lisible — dépôt cloné sans tags (`fetch-tags`) : la confrontation"
      + " avec la dernière version publiée ne peut pas être établie, et rien n'a été vérifié");
  }

  let chemins;
  try {
    chemins = String(listerAuTag(tag)).split(/\r?\n/).map((l) => l.trim()).filter((l) => l.endsWith(".sql"));
  } catch (e) {
    return inconclusif(`\`git ls-tree ${tag}\` a échoué (${e && e.message ? e.message.split("\n")[0] : "cause inconnue"}) : le`
      + " tag est nommé mais son arbre n'est pas lisible ici (clone sans l'objet du tag ?) — rien n'a été vérifié");
  }
  if (!chemins.length) {
    return inconclusif(`aucune migration lue sous ${DOSSIER}/ dans ${tag} — la sonde vise à côté, ou le dossier a`
      + " changé de place : rien n'a été vérifié");
  }

  const publiees = {};
  for (const chemin of chemins) {
    try { publiees[chemin] = lireAuTag(tag, chemin); } catch (e) {
      return inconclusif(`\`git show ${tag}:${chemin}\` a échoué (${e && e.message ? e.message.split("\n")[0] : "cause inconnue"}) : rien n'a été vérifié`);
    }
  }
  const lireIci = (chemin) => {
    const p = join(racine, chemin);
    return existsSync(p) ? readFileSync(p, "utf8") : null;
  };
  const { modifiees, disparues } = confronter(publiees, lireIci);

  const constats = [];
  for (const c of modifiees) {
    constats.push(`${c} diffère de sa version publiée dans ${tag}. Une migration livrée est un artefact que des hôtes`
      + " ont déjà EXÉCUTÉ et empreinté : la modifier — même un commentaire — leur signale une migration à"
      + " ré-appliquer. Restaurez le fichier (`git checkout " + tag + " -- " + c + "`) et portez la"
      + " correction dans docs/HOST-CONTRACT.md, docs/MIGRATIONS.md, ou une migration NEUVE.");
  }
  for (const c of disparues) {
    constats.push(`${c} est publiée dans ${tag} et absente de l'arbre : un hôte qui rejoue \`supabase/migrations/\``
      + " ne la trouve plus, et la numérotation ne dit plus ce qui a été appliqué. Une migration ne se retire pas.");
  }
  if (constats.length) return violation(constats);

  const neuves = (() => {
    try {
      return execFileSync("git", ["ls-files", `${DOSSIER}/`], { cwd: racine, encoding: "utf8" })
        .split(/\r?\n/).map((l) => l.trim()).filter((l) => l.endsWith(".sql") && !(l in publiees)).length;
    } catch { return null; }
  })();
  return conforme(`${chemins.length} migration(s) publiée(s) dans ${tag} confrontée(s) à l'arbre : identiques octet pour octet`
    + (neuves === null ? "" : ` ; ${neuves} nouvelle(s) depuis`));
}

if (estExecuteDirectement(import.meta.url)) conclure(tenter(() => auditer()));
