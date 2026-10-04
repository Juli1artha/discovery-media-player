// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA SURFACE BASE SE DÉRIVE DU CODE — ELLE NE SE RECOPIE PLUS DANS UN DOCUMENT.
//
// ⚠️ TROIS DES CINQ CHIFFRES DE `docs/API.md` AVAIENT DÉRIVÉ, DANS LA MÊME TABLE.
//
// Deux d'entre eux étaient gardés (les sites d'appel, puis les fichiers), et ceux-là étaient justes.
// Les trois autres étaient de la prose : « Tables : 9 » quand le code en touche 10 (la table des
// limites de débit, ajoutée plus tard), « in.(…) : 2 » quand il y en a 3. Personne n'a menti — le
// code a bougé, les chiffres non. Un fait figé posé à côté d'un fait vivant diverge tant que
// personne ne les confronte, et c'est le troisième cas trouvé dans la même journée.
//
// ⚠️ ET LA MOITIÉ GARDÉE RENDAIT L'AUTRE PLUS DANGEREUSE : une table dont deux lignes sont vérifiées
// se lit comme une table vérifiée. Le lecteur qui pèse un portage n'a aucun moyen de savoir quelle
// ligne a un contrôle derrière elle.
//
// ⚠️ CE QUI NE SE RÉSOUT PAS SE COMPTE QUAND MÊME, ET SE DIT. Six appels construisent leur chemin à
// l'exécution (`${table}?…`) : leurs tables sont nommées littéralement par l'appelant, donc elles
// entrent bien dans le décompte — mais l'outil ne peut pas le PROUVER pour un site futur. Il publie
// donc ce nombre à côté du reste, et le document l'annonce : le jour où un septième apparaît, la
// garde rougit et quelqu'un vérifie si une table a échappé au compte. Une sortie de garde doit dire
// où elle a regardé, pas seulement ce qu'elle a trouvé.

import { readFileSync, readdirSync } from "node:fs";
// ⚠️ DEUX ROUGES DIFFÉRENTS. « Le document a dérivé » est une violation : l'auteur corrige sa
// branche. « La sonde ne trouve plus rien » n'est PAS de son fait : le correctif est dans la garde
// ou son environnement. Sortir 1 pour les deux apprend à l'auteur que le rouge de cette garde est
// parfois du bruit — et il a déjà appris le geste le jour où la violation est réelle.
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Le source sans ses lignes de commentaire — une sonde qui lit du commentaire invente des faits. */
export function sourceUtile(texte) {
  return texte.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
}

/** Les helpers qui reçoivent la table en PREMIER argument littéral. */
const HELPERS = /\b(?:purgerParLots|effacerParIds|resteEncore|ecrireSiEncoreVrai)\(\s*[`"']([a-z][a-z0-9_]*)/g;

export function mesurer(fichiers) {
  const tables = new Set();
  const dynamiques = [];
  let appels = 0;
  const avecAppel = new Set();

  for (const { nom, texte } of fichiers) {
    const src = sourceUtile(texte);
    for (const m of src.matchAll(HELPERS)) tables.add(m[1]);

    const n = [...src.matchAll(/\bdb\.(?:request|selectAll)\(/g)].length;
    appels += n;
    if (n) avecAppel.add(nom);

    for (const m of src.matchAll(/\bdb\.(?:request|selectAll)\(\s*([`"'])([^`"'\n]*)/g)) {
      const chemin = m[2];
      if (chemin.startsWith("rpc/")) continue;
      const premier = chemin.split(/[?/]/)[0];
      if (/^[a-z][a-z0-9_]*$/.test(premier)) tables.add(premier);
      else dynamiques.push(`${nom} → « ${chemin.slice(0, 40)} »`);
    }
    for (const m of src.matchAll(/\bdb\.(?:request|selectAll)\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
      dynamiques.push(`${nom} → variable « ${m[1]} »`);
    }
  }
  return { tables: [...tables].sort(), appels, fichiers: avecAppel.size, dynamiques };
}

/** Les `in.(…)` du CODE — la garde de portabilité voisine les tolère, le document les compte. */
export function compterIn(fichiers) {
  return fichiers.reduce((n, f) => n + [...sourceUtile(f.texte).matchAll(/in\.\(/g)].length, 0);
}

/**
 * Les `or=(…)` du CODE — le document annonçait ZÉRO sans que personne ne le relise.
 *
 * ⚠️ ET CE ZÉRO N'ÉTAIT PAS UN RELEVÉ PÉRIMÉ, C'ÉTAIT UNE POLITIQUE. `ci.yml` refuse `or=(` et
 * `and=(` dans `server/*.js` depuis longtemps : « ce qui coûte, ce sont les jointures imbriquées et
 * les arbres booléens — là, un portage cesse d'être une traduction et devient une réécriture ». La
 * ligne du tableau, elle, ne portait pas le marqueur † : elle énonçait la règle sans que rien ne
 * confronte le chiffre au code, et le lecteur qui pèse un portage ne pouvait pas savoir laquelle
 * des lignes était tenue par une garde et laquelle par une bonne intention.
 *
 * ⚠️ ET J'AI PRIS L'UNE POUR L'AUTRE. En écrivant le curseur de `sessionsByRecipient` j'ai posé un
 * `or=(…)`, corrigé le document pour qu'il dise « 1 », et expliqué dans la même phrase qu'un `or=`
 * n'était pas une faute. La garde de portabilité m'a repris. Le curseur dit maintenant la même
 * chose en deux filtres plats — `last_at=lte.T` et `session_id=not.in.(…)` — et ce compte est ici
 * pour que la règle soit VÉRIFIÉE là où elle est ANNONCÉE : une règle que personne ne compte est
 * une règle qui s'érode.
 */
export function compterOr(fichiers) {
  return fichiers.reduce((n, f) => n + [...sourceUtile(f.texte).matchAll(/[?&]or=\(/g)].length, 0);
}

/**
 * Les `and=(…)` et les `offset=` du CODE — deux règles que `ci.yml` refuse et que PERSONNE NE
 * COMPTAIT.
 *
 * ⚠️ ET LE DÉFAUT QUE CE FICHIER DÉNONCE PLUS HAUT S'EST PRODUIT ICI MÊME. « Une table dont deux
 * lignes sont vérifiées se lit comme une table vérifiée » : `or=(…)` portait son † et son
 * compteur, `and=()` et `offset=` étaient sur la MÊME ligne du tableau, en prose, sans marqueur.
 * La règle vivait dans un `grep` du workflow et nulle part ailleurs — donc invérifiable par
 * quiconque lance les outils du dépôt sur sa machine.
 *
 * ⚠️ CE N'EST PAS UNE HYPOTHÈSE : j'ai écrit un `offset=` dans `server/retention.js`, lancé les
 * trente-trois gardes en vert, et la forge l'a refusé. Le remède était pourtant écrit dans le même
 * fichier trois cent quatre-vingts lignes plus haut — « pagination par CURSEUR KEYSET, pas par
 * offset, la garde de portabilité de la forge interdit `offset=` ». Une règle qu'on ne peut pas
 * exécuter avant de pousser s'apprend en la cassant.
 */
export function compterAnd(fichiers) {
  return fichiers.reduce((n, f) => n + [...sourceUtile(f.texte).matchAll(/[?&]and=\(/g)].length, 0);
}

export function compterOffset(fichiers) {
  return fichiers.reduce((n, f) => n + [...sourceUtile(f.texte).matchAll(/offset=/g)].length, 0);
}

/** Ce que `docs/API.md` ANNONCE, lu à la même place que le lecteur le lit. */
export function annonces(markdown) {
  const nombre = (motif) => {
    const m = markdown.match(motif);
    return m ? Number(m[1]) : null;
  };
  // ⚠️ LE MARQUEUR † EST EXIGÉ, ET C'EST CE QUI L'EMPÊCHE DE MENTIR. Sans lui dans le motif, on
  // pourrait retirer le signe en laissant le chiffre : le lecteur croirait le nombre écrit à la
  // main alors qu'il est dérivé — ou, bien pire, le lecteur d'un AUTRE document croirait le sien
  // dérivé parce que tout se ressemble. Le marqueur devient donc lui-même une chose vérifiée :
  // l'enlever rend cette garde muette, et une garde muette doit refuser, pas conclure au vert.
  return {
    appels: nombre(/\| Call sites \| \*\*(\d+)\*\*†/),
    fichiers: nombre(/\| Call sites \|.*?in \*\*(\d+)\*\*† files/),
    tables: nombre(/\| Tables \| \*\*(\d+)\*\*†/),
    dynamiques: nombre(/\| Tables \|.*?plus \*\*(\d+)\*\*† call sites/),
    in: nombre(/\| `in\.\(…\)` \| \*\*(\d+)\*\*†/),
    or: nombre(/\| `or=\(\)` \| \*\*(\d+)\*\*†/),
    and: nombre(/\| `and=\(\)` \| \*\*(\d+)\*\*†/),
    offset: nombre(/\| `offset=` \| \*\*(\d+)\*\*†/),
    legende: /† \*\*Recomputed from the code/.test(markdown),
  };
}

// ⚠️ LE PLANCHER — CET OUTIL DÉCLARAIT VICTOIRE SUR ZÉRO, ET IL A FALLU UNE REVUE EXTERNE SUR UNE
// GARDE SŒUR POUR QUE J'AILLE LE VÉRIFIER ICI. Sur un corpus vide il mesurait 0 partout et ne
// refusait pas : seule la coïncidence « le document annonce 65 » le sauvait. Une garde sauvée par
// une coïncidence n'est pas une garde — le jour où le répertoire bouge, où l'extension change ou où
// une expression régulière casse, elle rend un zéro qui ressemble à un négatif légitime.
//
// ⚠️ LE PLANCHER EST LARGE ET PAR PARTIE, PAS COLLÉ AU RELEVÉ DU JOUR. Il ne mesure pas la
// couverture, il détecte son EFFONDREMENT : collé aux valeurs actuelles (65, 7, 10) il rougirait sur
// un ménage normal et finirait desserré. Relevé du 22/08 : 65 appels, 7 fichiers, 10 tables.
//
// ⚠️ ET « in.(…) » N'A PAS DE PLANCHER, VOLONTAIREMENT : zéro y est le bon résultat — c'est une
// mesure de couplage qu'on cherche à faire baisser. Un plancher l'y interdirait, et l'exception
// s'écrit ici plutôt que de se déduire d'un oubli.
const PLANCHERS = { appels: 20, fichiers: 3, tables: 4 };

export function effondrement(mesure) {
  const sous = [];
  for (const [cle, mini] of Object.entries(PLANCHERS)) {
    // ⚠️ PAS DE BRANCHE SUR LE NOM DE LA CLÉ. Elle s'écrivait `cle === "tables" ? … .length : …`,
    // et mesuré le 01/09 en aveuglant ce littéral : le plancher ne refusait plus QU'EXACTEMENT zéro
    // table — une, deux ou trois passaient. La raison est une coercition : `[] < 4` vaut `true`
    // (tableau vide → 0) mais `["a"] < 4` compare « a » à 4, donc `NaN < 4`, donc faux. Un plancher
    // qui ne tient que dans le cas parfaitement vide ne tient pas : la panne qu'il existe pour
    // attraper est une sonde qui trouve ENCORE quelque chose, pas une sonde qui ne trouve plus rien.
    const brut = mesure[cle];
    const n = Array.isArray(brut) ? brut.length : brut;
    if (n < mini) sous.push(`${cle} : ${n} trouvé(s), plancher ${mini} — la sonde ne trouve presque plus rien, elle vise à côté`);
  }
  return sous;
}

/**
 * Les chiffres que le document et le code doivent se dire l'un à l'autre.
 *
 * ⚠️ UNE SEULE LISTE, PARCE QUE LE VERT LES COMPTE. La phrase verte annonçait « les cinq chiffres »
 * en toutes lettres, à côté d'une comparaison qui en faisait cinq : ajouter la sixième aurait
 * laissé la phrase mentir dans le commit même qui la dépasse. Le compte descend maintenant de la
 * liste qui décide.
 */
export const COMPAREES = [
  ["appels", (m) => m.appels, "les sites d'appel"],
  ["fichiers", (m) => m.fichiers, "les fichiers qui en portent"],
  ["tables", (m) => m.tables.length, "les tables atteintes"],
  ["dynamiques", (m) => m.dynamiques.length, "les chemins construits à l'exécution"],
  ["in", (m) => m.in, "les « in.(…) »"],
  ["or", (m) => m.or, "les « or=(…) »"],
  ["and", (m) => m.and, "les « and=(…) »"],
  ["offset", (m) => m.offset, "les « offset= »"],
];

export function ecarts(mesure, dit) {
  const out = [];
  const cmp = (cle, reel, libelle) => {
    if (dit[cle] === null) {
      out.push(`docs/API.md n'annonce plus ${libelle} sous une forme lisible — la garde ne peut plus comparer, et une garde qui ne peut pas mesurer doit refuser, pas conclure au vert`);
    } else if (dit[cle] !== reel) {
      out.push(`docs/API.md annonce ${dit[cle]} pour ${libelle}, le code en compte ${reel}`);
    }
  };
  for (const [cle, lire, libelle] of COMPAREES) cmp(cle, lire(mesure), libelle);
  // ⚠️ UN MARQUEUR SANS LÉGENDE NE MARQUE RIEN. Le signe ne vaut que par la phrase qui dit ce
  // qu'il promet — et surtout par celle qui dit ce que son ABSENCE veut dire ailleurs.
  if (!dit.legende) out.push("docs/API.md ne porte plus la légende du marqueur † — le signe ne dit plus ce qu'il promet, ni ce que son absence veut dire dans les autres documents");
  return out;
}

export function fichiersServeur(racine = RACINE) {
  const dir = join(racine, "server");
  return readdirSync(dir)
    .filter((f) => f.endsWith(".js") && !f.includes(".generated."))
    .map((f) => ({ nom: f, texte: readFileSync(join(dir, f), "utf8") }));
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const fichiers = fichiersServeur();
    const mesure = { ...mesurer(fichiers), in: compterIn(fichiers), or: compterOr(fichiers),
      and: compterAnd(fichiers), offset: compterOffset(fichiers) };
    // ⚠️ LE PLANCHER D'ABORD, ET IL REND « NON CONCLUANT » — PAS « VIOLATION ». Comparer un relevé
    // vide à un document ne prouve rien, et un accord fortuit sur zéro serait le seul cas où cette
    // garde se tairait en ayant tout raté. Mais l'auteur d'une branche n'y est pour rien : ce qui
    // est cassé, c'est la sonde.
    const effondre = effondrement(mesure);
    if (effondre.length) return inconclusif(effondre.map((l) => `surface base : ${l}`));
    const dit = annonces(readFileSync(join(RACINE, "docs", "API.md"), "utf8"));
    const pb = ecarts(mesure, dit);
    if (pb.length) return violation(pb);
    // ⚠️ LE NOMBRE DE CHIFFRES SE COMPTE, IL NE S'ÉCRIT PAS. La phrase disait « les cinq chiffres »
    // en toutes lettres ; ajouter une sixième mesure l'aurait laissée mentir dans le commit même qui
    // la dépasse — la forme exacte du défaut que cette garde existe pour empêcher, dans son propre
    // vert. `COMPAREES` est la liste que `ecarts` parcourt : le compte en descend.
    return conforme(`surface base : ${mesure.appels} appels dans ${mesure.fichiers} fichiers, `
      + `${mesure.tables.length} tables, ${mesure.dynamiques.length} chemins dynamiques, `
      + `${mesure.in} « in.(…) », ${mesure.or} « or=(…) », ${mesure.and} « and=(…) », `
      + `${mesure.offset} « offset= » `
      + `— docs/API.md dit ce que le code fait, les ${COMPAREES.length} chiffres et pas quatre sur ${COMPAREES.length}`);
  }));
}

