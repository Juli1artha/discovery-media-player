// LE FICHIER QU'ON S'APPRÊTE À NOMMER « .sigstore.json » EN EST-IL VRAIMENT UN ?
//
// ⚠️ UN NOM AFFIRME UN FORMAT, DONC LE FORMAT SE VÉRIFIE D'ABORD. Le suffixe `.sigstore.json` est
// ce à quoi Scorecard reconnaît une signature de release ; le poser sur autre chose ferait de la
// note un mensonge, et c'est exactement le mensonge d'étiquette que les gardes d'actions refusent
// ailleurs dans ce dépôt.
//
// ⚠️ ET CE CONTRÔLE VIT DANS UN FICHIER, PAS DANS UN `node -e '…'`. Sa première écriture était en
// ligne, entre guillemets simples, et contenait « d'attestation » : l'apostrophe FERMAIT la chaîne
// shell, bash analysait le JavaScript restant et butait sur une parenthèse. Le job `attester` de la
// 0.1.136 est mort là — npm publié, aucune Release, aucune attestation. L'auteur avait écrit
// « nest » au lieu de « n'est » pour éviter ce piège à un endroit, et en avait laissé un autre :
// une discipline qui demande de se rappeler ne tient pas. Sortir le code du shell supprime la
// classe entière plutôt que de la surveiller.
//
// Usage : node tools/bundle-sigstore.mjs <chemin-du-bundle>

import { readFileSync } from "node:fs";

import { conclure, conforme, violation, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const ATTENDU = "application/vnd.dev.sigstore.bundle";

/** Le `mediaType` que le bundle déclare, ou `null` s'il n'en déclare pas. */
export const mediaTypeDe = (json) => {
  const mt = json && typeof json.mediaType === "string" ? json.mediaType : null;
  return mt || null;
};

/** L'écart, avec ce qu'on a trouvé — sans lui, « ce n'est pas un bundle » n'aide personne. */
export function ecart(json) {
  const mt = mediaTypeDe(json);
  if (mt === null) return "le fichier ne déclare aucun mediaType — on ne pose pas un nom « .sigstore.json » qui prétendrait un format absent";
  if (!mt.startsWith(ATTENDU)) return `mediaType « ${mt} » — attendu quelque chose commençant par « ${ATTENDU} ». Un nom affirme un format ; celui-ci ne correspond pas`;
  return null;
}

if (estExecuteDirectement(import.meta.url)) {
  const chemin = process.argv[2];
  if (!chemin) { console.error("usage : node tools/bundle-sigstore.mjs <chemin-du-bundle>"); process.exit(2); }
  conclure(tenter(() => {
    const souci = ecart(JSON.parse(readFileSync(chemin, "utf8")));
    if (souci) return violation([`${chemin} : ${souci}`]);
    return conforme(`bundle Sigstore confirmé : ${mediaTypeDe(JSON.parse(readFileSync(chemin, "utf8")))}`);
  }));
}
