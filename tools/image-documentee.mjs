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

/**
 * Toutes les références au registre lues dans un fichier, avec leur ligne.
 *
 * ⚠️ UNE SEULE TRAVERSÉE POUR LE JUGE ET POUR LE TÉMOIN. Un témoin qui rouvrirait le texte avec
 * sa propre copie de `REFERENCE` éprouverait un exemplaire intact pendant que l'original dérive :
 * il resterait vert en confirmant une sonde qui ne sert plus à personne.
 */
export function* referencesLues(fichier, texte) {
  const lignes = texte.split("\n");
  for (let i = 0; i < lignes.length; i += 1) {
    for (const m of lignes[i].matchAll(REFERENCE)) {
      const { avant, chemin, tag } = m.groups;
      if (avant) continue; // URL de l'API du registre, pas une image
      yield { fichier, ligne: i + 1, chemin, tag };
    }
  }
}

/** Les références fautives d'un fichier, avec leur ligne. */
export function referencesFautives(fichier, texte) {
  const soucis = [];
  for (const { ligne, chemin, tag } of referencesLues(fichier, texte)) {
    if (tagAcceptable(tag)) continue;
    soucis.push(`${fichier}:${ligne} — « ${REGISTRE}/${chemin}:${tag} » : la forge publie le tag git tel quel, donc « :v${tag} ». Un lecteur qui suit cette ligne reçoit un 404 sur une sortie saine, et ne peut pas le distinguer d'une image réellement absente`);
  }
  return soucis;
}

// ⚠️ UN PLANCHER, PAS LE RELEVÉ DU JOUR. 5 références d'image reconnues le 31/08 dans 32
// documents ; deux est vrai de tout état sain — ce dépôt PUBLIE une image et la documente.
export const PLANCHER_REFERENCES = 2;

/**
 * ⚠️ LE TÉMOIN DE LA RÈGLE — combien de références au registre la sonde RECONNAÎT.
 *
 * Cette garde affirme une absence sur trente-deux documents. Sa panne la plus probable — une
 * expression qui ne reconnaît plus la forme d'une référence — produit elle aussi une absence :
 * trente-deux documents verts sans rien avoir mesuré. Le plancher qui existait comptait les
 * DOCUMENTS OUVERTS, pas la FORME RECONNUE.
 *
 * Mesuré le 31/08 en vidant la boucle de `matchAll` : l'outil imprimait « 32 document(s) lus,
 * chaque référence ghcr.io est sans tag, « latest », ou préfixée « v » » et sortait 0. Il
 * affirmait une propriété de références qu'il n'avait pas vues.
 */
export function temoinsDeForme(fichiers, lire) {
  return fichiers.reduce((n, f) => n + [...referencesLues(f, lire(f))].length, 0);
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

/**
 * Les fichiers qui CITENT le registre sans être au périmètre, et pourquoi c'est légitime.
 *
 * ⚠️ UN PÉRIMÈTRE EST UNE LISTE DE CE QU'IL FAUT REGARDER, ET CE DÉPÔT SAIT CE QUE ÇA COÛTE : une
 * telle liste cesse de couvrir dès qu'un fichier apparaît, et personne ne la relit en ajoutant un
 * fichier. Mesuré le 01/09 en aveuglant la moitié « docker-compose.yml » de `AU_PERIMETRE` :
 *
 *     sain   5 référence(s) ghcr.io reconnue(s) dans 32 document(s)
 *     muté   4 référence(s) ghcr.io reconnue(s) dans 31 document(s)      VERT
 *
 * Un document sortait du périmètre, sa référence cessait d'être relue, et le plancher — deux
 * références, posé contre le vide — ne voyait rien passer.
 *
 * Ce qui suit renverse la charge : tout fichier suivi qui NOMME le registre est au périmètre, ou
 * bien il est inscrit ici avec sa raison. Un fichier qui apparaît force une décision au lieu de
 * tomber dehors en silence.
 */
export const DISPENSES = {
  ".zap/Dockerfile": "épingle une image TIERCE (zaproxy) au condensat — la forge n'en décide pas le tag, et `images-epinglees` la garde déjà",
  "tools/images-epinglees.mjs": "la garde voisine, qui CITE la forme qu'elle cherche : la lire reviendrait à s'accuser de la connaître",
  "tools/__tests__/imageDocumentee.test.js": "le banc de cette garde : ses cas FABRIQUENT des références fautives, c'est leur travail",
  "tools/__tests__/imagesEpinglees.test.js": "le banc de la garde voisine, même raison",
  "tools/__tests__/nodeDeLImage.test.js": "un banc qui cite l'image pour éprouver une autre règle",
};

/** Les fichiers suivis qui nomment le registre sans être ni au périmètre ni dispensés. */
export function citationsSansDecision(suivis, lire, dispenses = DISPENSES) {
  const soucis = [];
  for (const f of suivis) {
    if (AU_PERIMETRE(f) || Object.hasOwn(dispenses, f)) continue;
    let texte;
    try { texte = lire(f); } catch { continue; }
    // ⚠️ LA MÊME SONDE QUE LE JUGE, PAS UNE SECONDE RECONNAISSANCE. La première écriture demandait
    // `texte.includes(REGISTRE)` : un deuxième exemplaire de « qu'est-ce qu'une référence », qui
    // aurait dérivé de `referencesLues` sans que rien ne les confronte — le défaut exact que ce
    // dépôt retire partout. CodeQL l'a signalé sous un autre angle (une appartenance de chaîne ne
    // décide pas d'un hôte : `ghcr.io.exemple.com` la satisfait) ; les deux raisons mènent ici.
    const references = [...referencesLues(f, texte)];
    if (references.length) {
      soucis.push(`${f} porte ${references.length} référence(s) « ${REGISTRE}/… » sans être au périmètre de cette garde ni dispensé — soit un lecteur y recopie un tag et il doit être relu, soit ce n'en est pas un et il s'inscrit dans DISPENSES avec sa raison`);
    }
  }
  // ⚠️ UNE DISPENSE QUI NE CORRESPOND PLUS À RIEN EST UN MENSONGE QUI DORT — et « ne correspond
  // plus » ne veut pas seulement dire « le fichier a disparu ». Une dispense pour un fichier que la
  // sonde ne signalerait pas donne à la liste l'air de faire un travail qu'elle ne fait pas. Six
  // des dix premières entrées écrites ici étaient dans ce cas : les workflows nomment le registre
  // dans des expressions `${{ }}` ou des URL d'API, que `referencesLues` écarte déjà.
  const presents = new Set(suivis);
  for (const f of Object.keys(dispenses)) {
    if (!presents.has(f)) { soucis.push(`« ${f} » est dispensé et n'existe plus — retirez la dispense`); continue; }
    let texte;
    try { texte = lire(f); } catch { continue; }
    if (![...referencesLues(f, texte)].length) {
      soucis.push(`« ${f} » est dispensé et ne porte aucune référence « ${REGISTRE}/… » — la dispense ne couvre plus rien, retirez-la`);
    }
  }
  return soucis;
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const passes = process.argv.slice(2);
    const suivis = passes.length ? [] : execFileSync("git", ["ls-files"], { encoding: "utf8" }).split("\n").filter(Boolean);
    const fichiers = passes.length ? passes : suivis.filter(AU_PERIMETRE);
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
    const lire = (f) => readFileSync(f, "utf8");
    // ⚠️ LE PLANCHER DE FORME, AVANT LE VERDICT. Il compte ce que la sonde RECONNAÎT ; celui du
    // dessus ne compte que ce que le lecteur a OUVERT.
    const vues = temoinsDeForme(fichiers, lire);
    if (vues < PLANCHER_REFERENCES) {
      return inconclusif(`${vues} référence(s) « ${REGISTRE}/… » reconnue(s) dans ${fichiers.length} document(s), moins que ${PLANCHER_REFERENCES} — ce n'est pas une absence de référence fautive, c'est une sonde qui ne lit plus la forme d'une référence`);
    }
    // ⚠️ ET LE PÉRIMÈTRE LUI-MÊME EST CONFRONTÉ À CE QUE LE DÉPÔT CONTIENT. Une liste de ce qu'il
    // faut regarder cesse de couvrir dès qu'un fichier apparaît ; celle-ci force une décision.
    const sansDecision = suivis.length ? citationsSansDecision(suivis, lire) : [];
    if (sansDecision.length) return violation(sansDecision);
    const soucis = fichiers.flatMap((f) => referencesFautives(f, lire(f)));
    if (soucis.length) return violation(soucis);
    return conforme(`image documentée : ${vues} référence(s) ${REGISTRE} reconnue(s) dans ${fichiers.length} document(s), chacune sans tag, « latest », ou préfixée « v » comme ${OU_LE_TAG_EST_DECIDE} la publie`);
  }));
}
