// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE IMAGE CITÉE DANS LA DOCUMENTATION PORTE LE NOM QUE LA FORGE PUBLIE.
//
// ⚠️ CE QUI EST ARRIVÉ (0.1.138). `docs/RELEASING.md` listait
// `docker manifest inspect ghcr.io/…:<version>` dans sa liste de vérification d'après-sortie.
// `image.yml` pousse le tag git TEL QUEL : l'image est `:v0.1.138`, jamais `:0.1.138`. Le
// `gh release view v<version>` deux lignes plus haut portait déjà le `v` — l'incohérence vivait à
// quatre lignes d'écart, dans le même bloc, depuis des mois.
//
// ⚠️ ET ELLE NE POUVAIT SE VOIR QUE COMME ÇA : EN LA SUIVANT. Un registre répond `404` pour
// « n'existe pas » et pour « tu as demandé le mauvais nom » avec les mêmes trois chiffres. Le
// lecteur ne distingue donc pas « le pipeline a sauté l'image » de « la doc m'a donné le mauvais
// nom » — or le premier cas est EXACTEMENT ce que cette liste existe pour attraper : trois sorties
// d'affilée (0.1.67 → 0.1.69) ont publié sur npm en sautant Release, image, SBOM et provenance.
// Une ligne de contrôle qui rend 404 sur une sortie SAINE apprend à son lecteur à l'ignorer.
//
// ⚠️ LA RÈGLE EST DÉLIBÉRÉMENT PERMISSIVE — un tag sans `v` est la faute, pas un tag inattendu.
// Une garde qui exige la forme EXACTE d'une version accuserait `latest`, un exemple, une variable
// de shell. Ce qu'on refuse est la seule chose qui a réellement fui : un tag qui n'est ni `latest`
// ni préfixé `v`.
//
// ⚠️ ON NE TIENT PAS UNE SECONDE COPIE DU FAIT. C'est `image.yml` qui décide de la forme du tag ;
// cette garde ne la redéclare pas, elle la CONFRONTE — si le workflow cesse d'exiger un `^v…`, la
// sonde rend NON CONCLUANTE au lieu d'appliquer une règle que la forge n'applique plus. Un motif
// littéral suffit pour ça : on ne relit pas la grammaire du shell, on cherche une chaîne.
//
// Usage : node tools/image-documentee.mjs [fichiers…]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/** Le registre dont ce dépôt publie ses images. */
export const REGISTRE = "ghcr.io";

/** Le workflow qui décide du tag, et le motif par lequel il l'exige. */
export const OU_LE_TAG_EST_DECIDE = ".github/workflows/image.yml";
export const MOTIF_DU_WORKFLOW = "^v[0-9]+\\.[0-9]+\\.[0-9]+$";

/**
 * Une référence d'image citée en clair.
 *
 * ⚠️ TROIS FORMES RESSEMBLENT À UNE IMAGE ET N'EN SONT PAS, et les écarter nommément est ce qui
 * évite d'accuser du texte juste :
 *   - une URL de l'API du registre (`https://ghcr.io/v2/…`, `https://ghcr.io/token?…`) — elle est
 *     précédée de `://`, jamais une image ;
 *   - un chemin construit par le shell (`ghcr.io/$depot`, `ghcr.io/$(echo …`) — `$` et `(` ne sont
 *     pas des caractères de nom OCI, donc le motif s'arrête avant ;
 *   - une ELLIPSE, `ghcr.io/…:<version>` — c'est ainsi que le CHANGELOG CITE la faute qu'il
 *     rapporte. Un journal décrit ce qui était faux ; lui interdire de le nommer serait absurde,
 *     et l'exclure par son nom de fichier serait une exception à retenir. Le caractère « … »
 *     n'appartient pas au jeu OCI : la citation s'écarte d'elle-même.
 */
// ⚠️ LE CHEVRON FAIT PARTIE DU JEU, ET L'OUBLIER A COÛTÉ LA PREMIÈRE VERSION DE CETTE GARDE. Un
// tag OCI réel ne contient jamais « < » — mais la ligne qui a réellement fui n'était pas un tag
// réel, c'était le GABARIT `:<version>` d'une page de documentation. Sans le chevron, le motif s'y
// arrêtait avant le « : », lisait « aucun tag », et rendait vert sur le défaut exact qui l'avait
// fait naître. Le banc l'a montré ; c'est la troisième fois cette semaine qu'un motif écrit trop
// serré ne voit pas ce qu'il vient chercher.
const REFERENCE = new RegExp(`(?<avant>://)?${REGISTRE.replace(".", "\\.")}/(?<chemin>[a-z0-9][a-z0-9._/-]*)(?::(?<tag>[A-Za-z0-9._$<-][^\\s"'\`),]*))?`, "g");

/** Un tag acceptable : absent, `latest`, ou préfixé `v` comme la forge le publie. */
export const tagAcceptable = (tag) => tag === undefined || tag === "latest" || tag.startsWith("v");

/** Les références fautives d'un fichier, avec leur ligne. */
export function referencesFautives(fichier, texte) {
  const soucis = [];
  texte.split("\n").forEach((ligne, i) => {
    for (const m of ligne.matchAll(REFERENCE)) {
      const { avant, chemin, tag } = m.groups;
      if (avant) continue; // URL de l'API du registre, pas une image
      if (tagAcceptable(tag)) continue;
      soucis.push(`${fichier}:${i + 1} — « ${REGISTRE}/${chemin}:${tag} » : la forge publie le tag git tel quel, donc « :v${tag} ». Un lecteur qui suit cette ligne reçoit un 404 sur une sortie saine, et ne peut pas le distinguer d'une image réellement absente`);
    }
  });
  return soucis;
}

/** Ce que la forge exige encore — sinon la règle appliquée ici n'est plus la sienne. */
export const forgeExigeEncoreLeV = (source) => source.includes(MOTIF_DU_WORKFLOW);

/**
 * Les fichiers que la règle vise : ceux qu'un humain LIT et RECOPIE.
 *
 * ⚠️ LES WORKFLOWS SONT HORS PÉRIMÈTRE, et c'est dit plutôt qu'à moitié couvert : ils PRODUISENT
 * le tag, ils ne le documentent pas, et ils l'écrivent dans des variables de shell que cette sonde
 * ne saurait pas suivre sans redevenir un analyseur de commandes — l'échec payé deux fois cette
 * semaine. `image.yml` tient sa propre garde, en ligne, sur le tag qu'il pousse.
 */
export const AU_PERIMETRE = (f) => /\.md$/.test(f) || f === "docker-compose.yml";

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const fichiers = process.argv.slice(2).length ? process.argv.slice(2)
      : execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(AU_PERIMETRE);
    if (!fichiers.length) {
      return inconclusif("aucun document à lire — la sonde vise à côté, et un vert ne prouverait rien");
    }
    // ⚠️ LA CONFRONTATION AVANT LE VERDICT. Si `image.yml` cesse d'exiger un tag `vX.Y.Z`, la règle
    // appliquée ici devient une opinion : on le DIT au lieu de continuer à accuser en son nom.
    let workflow = "";
    try { workflow = readFileSync(OU_LE_TAG_EST_DECIDE, "utf8"); } catch { /* absent */ }
    if (!forgeExigeEncoreLeV(workflow)) {
      return inconclusif(`${OU_LE_TAG_EST_DECIDE} n'exige plus « ${MOTIF_DU_WORKFLOW} » — la forme du tag a changé ou le fichier a bougé, et cette garde appliquerait une règle qui n'est plus celle de la forge`);
    }
    const soucis = fichiers.flatMap((f) => referencesFautives(f, readFileSync(f, "utf8")));
    if (soucis.length) return violation(soucis);
    return conforme(`image documentée : ${fichiers.length} document(s) lus, chaque référence ${REGISTRE} est sans tag, « latest », ou préfixée « v » comme ${OU_LE_TAG_EST_DECIDE} la publie`);
  }));
}
