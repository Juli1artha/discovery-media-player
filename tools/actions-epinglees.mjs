// LES ACTIONS ÉPINGLÉES — SUR UN ARBRE YAML, PLUS SUR DU TEXTE.
//
// ⚠️ CETTE GARDE A ÉTÉ AVEUGLE DEUX FOIS, DE DEUX FAÇONS DIFFÉRENTES.
//
//   1. En `grep` d'abord : son motif exigeait `uses: ` suivi d'un nom NON QUOTÉ, donc
//      `- uses: "actions/checkout@v4"` passait sans un mot. Trois formes flottantes invisibles,
//      sur la garde la plus sensible du dépôt — une action s'exécute avec les droits d'une forge
//      qui PUBLIE sur npm.
//
//   2. Puis en lexer écrit à la main, qui corrigeait (1) et échouait autrement (revue externe,
//      21/08) : clé citée `- "uses": …` et mapping en flow `- { uses: … }` rendaient tous deux
//      `[]`, et l'indicateur `|2-` (valide, ordre inverse de `|-2`) faisait prendre un SCRIPT
//      pour une action.
//
// Écrire un troisième lexer aurait été la troisième fois. La lecture vit maintenant dans
// `tools/workflows-yaml.mjs`, sur un vrai analyseur YAML 1.2, et ce fichier ne garde que ce qu'il
// sait faire : DÉCIDER. C'est la même correction que celle d'`env-lues.mjs`, pour la même raison —
// on ne lit pas un format structuré avec une expression régulière.
//
// Usage : node tools/actions-epinglees.mjs [.github/workflows]

import { usesDuDepot, horsPositionDuDepot } from "./workflows-yaml.mjs";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { pathToFileURL } from "node:url";

const SHA = /^[0-9a-f]{40}$/;

/**
 * ⚠️ CE QUI DOIT ÊTRE ÉPINGLÉ, ET CE QUI N'A PAS À L'ÊTRE.
 *   - une action LOCALE (`./.github/actions/x`) vit dans ce dépôt, au commit courant : rien à
 *     épingler, et exiger un SHA serait impossible à satisfaire ;
 *   - une action distante (`owner/repo@ref`, `owner/repo/chemin@ref`, y compris un workflow
 *     réutilisable) doit porter un SHA de 40 caractères — une étiquette se redéplace ;
 *   - une image (`docker://…`) doit porter un condensat, pour la raison du Dockerfile ;
 *   - une référence distante SANS `@` pointe la branche par défaut : c'est le pire cas, elle
 *     change sous nos pieds sans que rien ne bouge chez nous.
 */
export function ecartEpinglage(reference) {
  if (reference.startsWith("./") || reference.startsWith("../")) return null;
  if (reference.startsWith("docker://")) {
    return /@sha256:[0-9a-f]{64}$/.test(reference)
      ? null
      : `« ${reference} » n'est pas épinglée sur un condensat — ajoutez @sha256:…`;
  }
  const at = reference.lastIndexOf("@");
  if (at <= 0) return `« ${reference} » n'a pas de référence — elle suit la branche par défaut, qui change sans nous`;
  const ref = reference.slice(at + 1);
  if (!SHA.test(ref)) return `« ${reference} » est épinglée sur « ${ref} », pas sur un commit — une étiquette se redéplace, un SHA ne désigne qu'un arbre`;
  return null;
}

export const ecarts = (references, fichier) =>
  references.map((r) => ecartEpinglage(typeof r === "string" ? r : r.reference))
    .map((e, i) => e && `${fichier || references[i]?.fichier || ""}${references[i]?.ligne ? ":" + references[i].ligne : ""} : ${e}`)
    .filter(Boolean);

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dossier = process.argv[2] || ".github/workflows";
  // ⚠️ `tenter` parce que la lecture LÈVE sur un YAML illisible ou un `uses:` en alias — un refus
  // prudent de la garde, pas une faute du dépôt. Il sortait 1 comme une violation (voir
  // tools/resultat-garde.mjs).
  conclure(tenter(() => {
    const toutes = usesDuDepot(dossier);
    if (!toutes.length) return inconclusif(`aucun « uses » relevé dans ${dossier} — la sonde vise à côté`);
    // ⚠️ CE QUE LE RESSERREMENT DE PORTÉE A ÉCARTÉ, ON LE DIT. La lecture ne retient plus que
    // `jobs.<id>.steps[*].uses` et `jobs.<id>.uses` — les deux seuls endroits où GitHub exécute une
    // action. Un `uses:` ailleurs (dans un `env:`, par exemple) n'en est pas une, et le compter
    // était un faux positif. Mais rétrécir une garde de sécurité en silence est exactement ce qui
    // a coûté trois lecteurs à ce dépôt : ce qui est écarté est nommé, à charge d'un humain de dire
    // si l'un d'eux est une action mal placée.
    const ecartes = horsPositionDuDepot(dossier).map(
      (h) => `${h.fichier}:${h.ligne} : « uses: ${h.valeur} » n'est pas à une position d'exécution — non vérifié par cette garde`);

    const soucis = ecarts(toutes);
    if (soucis.length) return violation(soucis, ecartes);
    const fichiers = new Set(toutes.map((u) => u.fichier));
    return conforme(`actions : ${toutes.length} référence(s) dans ${fichiers.size} workflows, toutes épinglées sur un commit`, ecartes);
  }));
}
