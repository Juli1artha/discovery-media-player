// L'ÉTIQUETTE ÉCRITE À CÔTÉ DU SHA DIT-ELLE LA VÉRITÉ ?
//
// ⚠️ CE TROU A ÉTÉ TROUVÉ EN DIRECT, ET IL A LAISSÉ PASSER UNE MONTÉE DE MAJEURE (#253, 21/08).
// Dependabot a remplacé trois SHA de `github/codeql-action` et laissé le commentaire inchangé :
//
//     - uses: github/codeql-action/init@ff2f1c62… # v3      ← le SHA est v4.37.7
//
// Le SHA posé porte le tag `v4.37.7`. L'ancien portait `v3.37.7`. Le fichier annonçait donc une
// montée de correctif là où il posait une MAJEURE sur l'outil d'analyse de sécurité du dépôt. Un
// relecteur lit « v3 → v3 » et approuve. La CI était verte : elle vérifiait que le SHA EST un SHA,
// jamais que l'étiquette DIT vrai.
//
// C'est exactement la confrontation bâtie pour le Dockerfile dans la même PR (#274) — « l'étiquette
// et le condensat sont deux exemplaires du même fait » — et elle n'avait pas été portée du côté des
// actions. Le raisonnement était écrit ; le contrôle manquait. Douze jours plus tard il aurait
// manqué pareil, mais personne n'aurait regardé les tags à la main.
//
// ⚠️ IL FAUT LE RÉSEAU, ET ON NE PRÉTEND PAS SAVOIR QUAND ON NE SAIT PAS. `git ls-remote --tags`
// interroge le dépôt de l'action. Si le dépôt ne répond pas, on ne peut pas distinguer une panne
// d'un mensonge : on le DIT, bruyamment, sans rougir (règle des gardes muettes de la 0.1.35). Ce
// qui rougit, c'est ce qu'on a pu constater et qui est faux.
//
// Usage : node tools/actions-versions.mjs [.github/workflows]

import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { usesDuDepot } from "./workflows-yaml.mjs";

/**
 * Le dépôt qui porte l'action. `github/codeql-action/init` vit dans `github/codeql-action` : le
 * troisième segment est un chemin DANS le dépôt, pas un dépôt.
 */
export function depotDe(reference) {
  // ⚠️ Une action LOCALE n'a pas de dépôt distant à interroger — et `./locale` se découpe en deux
  // segments comme `owner/repo`. Relevé par le banc de ce fichier, avant que la garde ne parte
  // chercher les tags de « github.com/./locale ».
  if (reference.startsWith("./") || reference.startsWith("../")) return null;
  const bouts = reference.split("@")[0].split("/");
  if (bouts.length < 2) return null;
  const [proprietaire, depot] = bouts;
  if (!proprietaire || !depot || proprietaire === "." || proprietaire === "..") return null;
  return `${proprietaire}/${depot}`;
}

// ⚠️ LA LECTURE A DÉMÉNAGÉ, ET C'EST UN DÉFAUT QUI L'A CHASSÉE. Ce fichier extrayait lui-même le
// commentaire de fin de ligne, à partir des lignes brutes du lexer voisin — donc il héritait de
// tous ses angles morts : clé citée, mapping en flow, indicateur `|2-`. Une garde qui vérifie
// l'honnêteté d'une étiquette ne peut pas se permettre de ne pas voir la ligne.
// `tools/workflows-yaml.mjs` rend maintenant la référence ET son annonce depuis un arbre YAML 1.2.
// Ce fichier ne garde que la DÉCISION.

/**
 * ⚠️ « v4 » EST UNE ANNONCE HONNÊTE POUR UN SHA TAGUÉ `v4.37.7`. On ne compare pas des chaînes :
 * on demande si l'étiquette annoncée DÉSIGNE l'une des versions que ce SHA porte réellement — soit
 * exactement (`v4.3.0` pour le tag `v4.3.0`, ou le tag mouvant `v4`), soit comme préfixe de
 * famille (`v4` pour `v4.37.7`). Exiger l'égalité stricte rendrait rouge la moitié du dépôt, qui
 * écrit `# v7` en face d'un `v7.0.2` — et une garde qui crie faux contamine le canal.
 */
export function ecartVersion({ reference, annonce }, tags) {
  if (!tags || !tags.length) {
    return `« ${reference} » annonce ${annonce}, mais ce commit ne porte AUCUN tag — l'annonce n'est adossée à rien. Épinglez un commit publié, ou retirez le commentaire.`;
  }
  const honnete = tags.some((t) => t === annonce || t.startsWith(annonce + "."));
  if (honnete) return null;
  return `« ${reference} » annonce ${annonce}, mais ce commit est ${tags.join(", ")} — l'étiquette et le SHA ne désignent pas la même version`;
}

/** Les tags que porte chaque commit d'un dépôt distant. Rend `null` si le dépôt n'a pas répondu. */
export function tagsDuDepot(depot, executer = (url) =>
  execFileSync("git", ["ls-remote", "--tags", url], { encoding: "utf8", timeout: 30000 })) {
  let sortie;
  try {
    sortie = executer(`https://github.com/${depot}`);
  } catch {
    return null;
  }
  const parSha = new Map();
  for (const ligne of sortie.split("\n")) {
    const m = /^([0-9a-f]{40})\s+refs\/tags\/(.+?)(\^\{\})?$/.exec(ligne.trim());
    if (!m) continue;
    const [, sha, tag] = m;
    if (!parSha.has(sha)) parSha.set(sha, []);
    if (!parSha.get(sha).includes(tag)) parSha.get(sha).push(tag);
  }
  return parSha;
}

/**
 * Le verdict complet, à partir d'un relevé déjà fait. Sépare ce qui est FAUX de ce qu'on n'a pas
 * pu voir : les deux ne se disent pas de la même façon, et surtout pas avec le même silence.
 */
export function verdict(toutes, tagsParDepot) {
  const ecarts = [], nonVus = [];
  for (const e of toutes) {
    const parSha = tagsParDepot.get(e.depot);
    if (parSha === null || parSha === undefined) {
      nonVus.push(`${e.depot} n'a pas répondu — « ${e.reference} » (${e.annonce}) n'a pas été vérifiée`);
      continue;
    }
    const souci = ecartVersion(e, parSha.get(e.sha));
    if (souci) ecarts.push(`${e.fichier} : ${souci}`);
  }
  return { ecarts, nonVus };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const toutes = usesDuDepot(process.argv[2] || ".github/workflows")
    // Une action sans commentaire n'annonce rien : il n'y a rien à confronter, et rien à
    // reprocher. Une action non épinglée sur un SHA est le sujet de la garde VOISINE.
    .filter((u) => u.annonce && /@[0-9a-f]{40}$/.test(u.reference))
    .map((u) => ({ ...u, depot: depotDe(u.reference), sha: u.reference.slice(-40) }));
  if (!toutes.length) {
    console.error("::error::aucune action épinglée avec une étiquette — la sonde vise à côté");
    process.exit(1);
  }
  const depots = [...new Set(toutes.map((e) => e.depot))];
  const tagsParDepot = new Map(depots.map((d) => [d, tagsDuDepot(d)]));

  const { ecarts, nonVus } = verdict(toutes, tagsParDepot);
  for (const n of nonVus) console.error("::warning::" + n);
  if (ecarts.length) {
    for (const e of ecarts) console.error("::error::" + e);
    process.exit(1);
  }
  const vues = toutes.length - nonVus.length;
  console.log(`étiquettes : ${vues}/${toutes.length} confrontées à leur SHA sur ${depots.length} dépôts, toutes exactes`
    + (nonVus.length ? ` — ⚠️ ${nonVus.length} NON VÉRIFIÉE(S), voir ci-dessus` : ""));
}
