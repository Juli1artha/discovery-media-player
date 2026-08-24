// CE QUE LE PAQUET PROMET DE PORTER, CONFRONTÉ À CE QU'IL PORTE.
//
// ⚠️ LE CHANGELOG NE VOYAGEAIT PAS, ET PERSONNE NE L'AVAIT DÉCIDÉ (constaté en publiant la
// 0.1.134). `package.json#files` est une liste choisie — elle nomme le README, les deux licences,
// et DEUX documents précis tirés de `docs/`, ajoutés par #176 avec leur raison écrite. Le
// CHANGELOG, lui, n'apparaissait dans aucune de ces discussions : pas de refus, pas de trace, un
// silence. Un intégrateur qui installe une nouvelle version et se demande ce qui a changé n'avait
// aucun moyen de le savoir hors ligne, alors que le paquet embarque déjà son contrat d'hôte et sa
// politique de rétention POUR CETTE RAISON-LÀ EXACTEMENT.
//
// ⚠️ ET UNE ABSENCE RESSEMBLE À UNE DÉCISION. C'est ce qui rend ce défaut coûteux : rien ne
// distinguait « on a choisi de ne pas l'envoyer » de « personne n'y a pensé ». Retirer une ligne
// de `files` reste aujourd'hui indolore ; la garde de langue rendrait quatre documents au lieu de
// cinq et resterait verte. La promesse s'évaporerait sans bruit.
//
// ⚠️ CE QUE CETTE PROMESSE COÛTE, MESURÉ PLUTÔT QU'ESTIMÉ. Le CHANGELOG pèse 257 Ko et 134
// sections : l'ajouter fait passer le tarball de 320 660 à 414 680 octets compressés (+29 %) et
// lui donne 21,5 % du paquet déballé. C'est le prix de la lecture hors ligne, et il est payé à
// CHAQUE installation. Il est accepté, mais il CROÎT d'une section par version : le jour où ce
// fichier dominera le paquet, la décision devra être reprise, et ces chiffres sont là pour qu'on
// compare à une mesure plutôt qu'à un souvenir. Aucune garde ne surveille ce seuil — une alarme
// qui sonnerait fatalement, un jour, sur une croissance normale n'apprendrait qu'à cliquer à côté.
//
// ⚠️ LA CONFRONTATION EST À SENS UNIQUE, ET C'EST VOULU. On refuse un document PROMIS QUI MANQUE ;
// on ne refuse pas un document qui voyage sans être promis. `docs/README.md` part parce que npm
// développe `docs/`, il n'engage rien, et il est déjà couvert : la garde de langue lit TOUT ce que
// le tarball porte. Exiger ici la liste exacte serait un second exemplaire de `files`, que rien ne
// confronterait — la faute même que ce fichier corrige.
//
// Usage : node tools/documents-publies.mjs

import { fichiersDuTarball } from "./inventaire-tarball.mjs";
import { conclure, conforme, violation, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/**
 * Les documents dont le paquet répond, et pourquoi. Une entrée n'est pas un fichier qu'on trouve
 * pratique : c'est une chose qu'un intégrateur peut lire dans `node_modules` sans réseau.
 */
export const PROMIS = {
  "README.md": "ce que fait le produit, et comment le brancher",
  "CHANGELOG.md": "ce qui a changé depuis la version qu'on remplace — lisible hors ligne, au moment de la mise à jour",
  "LICENSE": "les conditions sous lesquelles le paquet est utilisé",
  "LICENSE-MIT": "la seconde licence, celle du noyau",
  "docs/HOST-CONTRACT.md": "le contrat d'hôte, aussi résolvable par le sous-chemin « ./contrat »",
  "docs/RETENTION.md": "le périmètre déclaré de la rétention, aussi résolvable par « ./retention »",
};

/** Les promesses que l'inventaire ne tient pas, avec leur raison — pour qu'on lise ce qu'on perd. */
export const promessesRompues = (inventaire) =>
  Object.entries(PROMIS)
    .filter(([chemin]) => !inventaire.includes(chemin))
    .map(([chemin, pourquoi]) => `${chemin} ne part pas dans le tarball — le paquet le promet pour : ${pourquoi}`);

if (estExecuteDirectement(import.meta.url)) {
  // ⚠️ `tenter` : `npm pack` peut échouer et `fichiersDuTarball` lève sur un inventaire vide.
  // Ni l'un ni l'autre ne dit qu'une promesse est rompue — ils disent qu'on n'a pas pu regarder.
  conclure(tenter(() => {
    const inventaire = fichiersDuTarball();
    const soucis = promessesRompues(inventaire);
    if (soucis.length) return violation(soucis);
    return conforme(`documents promis : ${Object.keys(PROMIS).length} sur ${Object.keys(PROMIS).length} présents dans le tarball (${inventaire.length} fichiers au total)`);
  }));
}
