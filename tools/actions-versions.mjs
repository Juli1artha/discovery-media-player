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

import { usesDuDepot } from "./workflows-yaml.mjs";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

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
    // ⚠️ `${fichier}:${ligne}`, PAS `${fichier} :`. Le relevé portait déjà la ligne — `usesDe` la
    // rend — et ce message la jetait. Un workflow qui épingle dix actions obligeait alors le
    // lecteur à chercher laquelle. Constaté en faisant rougir les onze gardes une par une pour
    // lire ce qu'elles disent : quatre nommaient la ligne, trois la connaissaient sans la dire.
    if (souci) ecarts.push(`${e.fichier}:${e.ligne} : ${souci}`);
  }
  return { ecarts, nonVus };
}

if (estExecuteDirectement(import.meta.url)) {
  const dossier = process.argv[2] || ".github/workflows";
  conclure(tenter(() => {
    // Une action LOCALE (`./…`) n'a pas de dépôt distant, et une action non épinglée sur un SHA est
    // le sujet de la garde VOISINE.
    const epinglees = usesDuDepot(dossier).filter((u) => /@[0-9a-f]{40}$/.test(u.reference));
    if (!epinglees.length) return inconclusif(`aucune action épinglée sur un commit dans ${dossier} — la sonde vise à côté`);

    // ⚠️ UNE ACTION SANS ÉTIQUETTE SORTAIT DE LA GARDE PAR LE HAUT (P2, audit du 22/08).
    //
    // Ce filtre disait `u.annonce && …` : retirer le commentaire `# v4` d'une des 35 références ne
    // faisait rien rougir. L'épinglage tenait toujours — la garde voisine l'exige — mais la
    // confrontation disparaissait, et avec elle la seule chose qu'un humain peut relire. Quarante
    // caractères hexadécimaux ne se relisent pas ; c'est précisément pour ça que ce dépôt écrit
    // l'étiquette à côté. Une garde qu'on peut vider en supprimant un commentaire n'en est pas une.
    const muettes = epinglees.filter((u) => !u.annonce)
      .map((u) => `${u.fichier}:${u.ligne} : « ${u.reference} » n'annonce aucune version — un SHA de 40 caractères est illisible, l'étiquette « # vN » est ce qui se relit, et c'est elle que cette garde confronte. Sans elle il n'y a plus rien à vérifier.`);

    const aConfronter = epinglees.filter((u) => u.annonce)
      .map((u) => ({ ...u, depot: depotDe(u.reference), sha: u.reference.slice(-40) }));

    const depots = [...new Set(aConfronter.map((e) => e.depot))];
    const tagsParDepot = new Map(depots.map((d) => [d, tagsDuDepot(d)]));
    const { ecarts, nonVus } = verdict(aConfronter, tagsParDepot);

    if (ecarts.length || muettes.length) return violation([...muettes, ...ecarts], nonVus);

    // ⚠️ UN DÉPÔT INJOIGNABLE N'EST PAS UNE VIOLATION, MAIS CE N'EST PAS RIEN NON PLUS. Tant qu'il
    // en reste à confronter, on confronte et on DIT ce qu'on n'a pas vu (avertissement). Si plus
    // AUCUNE n'a pu l'être, il n'y a plus de vérification du tout : c'est non concluant, et le
    // prétendre vert serait la garde muette que ce dépôt refuse.
    if (aConfronter.length && nonVus.length === aConfronter.length) {
      return inconclusif(`aucun des ${depots.length} dépôts n'a répondu — pas une seule étiquette n'a été confrontée`, nonVus);
    }
    const vues = aConfronter.length - nonVus.length;
    return conforme(
      `étiquettes : ${vues}/${epinglees.length} confrontées à leur SHA sur ${depots.length} dépôts, toutes exactes`
        + (nonVus.length ? ` — ⚠️ ${nonVus.length} NON VÉRIFIÉE(S), voir ci-dessus` : ""),
      nonVus,
    );
  }));
}
