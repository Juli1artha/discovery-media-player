// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// TROIS ÉCRITURES DE LA MÊME REQUÊTE, TROIS ANGLES MORTS, AUCUN TROUVÉ PAR SON AUTEUR.
//
// ⚠️ LE COMPTE EXACT, PARCE QU'IL EST LE SEUL ARGUMENT QUI COMPTE ICI. Le 28/08, la requête que ce
// dépôt donne aux hôtes pour vérifier qu'un `revoke select … from anon, authenticated` ne tuera
// aucune politique a été écrite trois fois :
//
//     v1  filtrait `roles::text like '%anon%'`     ← ne regarde qu'un des DEUX rôles du geste
//     v2  `case … then 'anon' else 'authenticated'` ← ne regarde qu'UN rôle par politique
//     v3  déplie CHAQUE rôle, mesure l'état résultant
//
// v1 est de nous. v2 est d'un hôte, écrit dans le message même qui signalait le défaut de v1. Aucune
// des deux n'a été trouvée fautive par son auteur : chacune l'a été par l'autre. Et le second hôte,
// en rejouant v3 chez lui, a relevé la chose qui a motivé ce fichier — sa base ne contient AUCUNE
// politique nommant les deux rôles, donc v2 y aurait rendu le bon résultat, « pour une raison qui
// n'a rien à voir avec sa justesse ». Valider une sonde sur la base qu'on a sous la main, c'est la
// valider sur un profil parmi trois.
//
// ⚠️ D'OÙ CE MODULE, ET CE QU'IL FAIT PLUTÔT QUE CE QU'IL VÉRIFIE. Il n'a pas d'opinion sur le SQL :
// il EXTRAIT la requête du bloc « Accès » de `supabase/init.sql`, entre deux marques, pour que la CI
// exécute CE QUI EST DOCUMENTÉ plutôt qu'une copie. Une copie diverge — et le jour où elle diverge,
// le banc reste vert sur une requête que personne ne lit plus, pendant que les hôtes appliquent
// celle du fichier. C'est le même défaut que « un compte d'un instrument et un verdict d'un autre »,
// appliqué à une requête : le banc hériterait de la visibilité d'un texte, et l'hôte de l'angle mort
// de l'autre.
//
// ⚠️ ET IL REFUSE PLUTÔT QUE DE RENDRE UN SQL VIDE. Une extraction qui rate en silence donnerait au
// banc une requête vide, qui ne rend jamais de ligne, donc ne signale jamais rien — le banc virerait
// au vert pour la raison exacte qu'il existe pour interdire. Marque absente, marques croisées, bloc
// vide, bloc sans `select`, bloc non terminé par `;` : NON CONCLUANT, jamais conforme.

import { readFileSync } from "node:fs";
import { CONFORME, conforme, inconclusif, rendre, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

export const SOURCE = "supabase/init.sql";
export const OUVRANTE = "[banc:requete-diagnostic]";
export const FERMANTE = "[/banc:requete-diagnostic]";

/**
 * Retire le préfixe de commentaire SQL d'une ligne, et rien d'autre : l'indentation interne de la
 * requête est conservée, parce qu'elle est ce qui la rend lisible dans le fichier ET dans le journal
 * de CI quand elle échoue.
 */
export const sansPrefixe = (ligne) => ligne.replace(/^\s*--\s?/, "");

/**
 * @returns {{sql: string} | {raison: string}} — jamais les deux, jamais ni l'un ni l'autre.
 */
export function extraire(texte) {
  const lignes = String(texte).split("\n");
  const ouvertures = lignes.map((l, i) => (l.includes(OUVRANTE) ? i : -1)).filter((i) => i >= 0);
  const fermetures = lignes.map((l, i) => (l.includes(FERMANTE) ? i : -1)).filter((i) => i >= 0);

  // ⚠️ « Exactement une » et pas « au moins une » : deux blocs, et l'extraction rendrait le premier
  // en passant l'autre sous silence — un hôte lirait le second, la CI mesurerait le premier.
  if (ouvertures.length !== 1 || fermetures.length !== 1) {
    return {
      raison:
        `${SOURCE} doit porter EXACTEMENT une marque ${OUVRANTE} et une ${FERMANTE} ; ` +
        `relevé : ${ouvertures.length} ouvrante(s), ${fermetures.length} fermante(s)`,
    };
  }
  const [debut] = ouvertures;
  const [fin] = fermetures;
  if (fin <= debut) return { raison: `${SOURCE} : la marque fermante précède l'ouvrante — bloc croisé` };

  const bloc = lignes.slice(debut + 1, fin);

  // ⚠️ LE DÉPOUILLAGE DOIT AVOIR EU LIEU, ET ÇA SE VÉRIFIE SANS SECONDE EXPRESSION. Le bloc est
  // écrit en COMMENTAIRES SQL : chaque ligne non vide y porte son préfixe, donc `sansPrefixe` doit
  // changer chacune d'elles. Si elle n'en change aucune, la requête rendue est du commentaire de
  // bout en bout.
  //
  // ⚠️ ET LES DEUX PLANCHERS QUI SUIVENT NE LE VOIENT PAS. Mesuré le 01/09 en aveuglant
  // `sansPrefixe` : `\bselect\b` matche dans « -- select … », la dernière ligne finit toujours
  // par « ; », et l'outil imprimait « requête de diagnostic extraite : 24 ligne(s) » puis rendait
  // sur sa sortie standard une requête dont CHAQUE ligne commence par « -- ». La CI redirige cette
  // sortie dans un fichier qu'elle donne à `psql` : la base exécute zéro instruction, ne rend zéro
  // ligne, et le job qui vérifie les politiques d'accès passe au vert sans avoir rien demandé.
  // C'est la forme exacte du défaut que ce dépôt traque — un vert qui affirme un travail non fait —
  // sur la garde dont le sujet est le contrôle d'accès.
  //
  // On compare AVANT et APRÈS plutôt que de reconnaître un préfixe une seconde fois : une règle
  // écrite deux fois ne tombe pas deux fois, et c'est précisément ce qu'on cherche à éviter ici.
  const intactes = bloc.filter((l) => l.trim() && sansPrefixe(l) === l);
  if (intactes.length) {
    return {
      raison: `${SOURCE} : ${intactes.length} ligne(s) du bloc n'ont pas perdu leur préfixe de commentaire — ` +
        `la requête rendue serait du commentaire, que la base exécuterait sans rien faire et sans rien dire ` +
        `(première : « ${intactes[0].trim().slice(0, 60)} »)`,
    };
  }

  const sql = bloc
    .map(sansPrefixe)
    .join("\n")
    .trim();

  if (!sql) return { raison: `${SOURCE} : le bloc entre les marques est vide` };
  // Deux planchers d'anti-vacuité. Sans eux, un bloc réduit à de la prose passerait pour du SQL, et
  // la seule chose que le banc constaterait est qu'elle ne rend aucune ligne.
  if (!/\bselect\b/i.test(sql)) return { raison: `${SOURCE} : le bloc entre les marques ne contient pas de select` };
  if (!sql.endsWith(";")) return { raison: `${SOURCE} : le bloc entre les marques ne se termine pas par « ; » — requête tronquée` };

  return { sql };
}

export function verifier(lire = (c) => readFileSync(c, "utf8"), chemin = SOURCE) {
  return tenter(() => {
    const r = extraire(lire(chemin));
    if (r.raison) return inconclusif(r.raison);
    const lignes = r.sql.split("\n").length;
    // Le SQL voyage À CÔTÉ du verdict, jamais dedans : `resume` est une phrase pour un humain, et
    // les mélanger ferait passer l'un pour l'autre au premier appelant distrait.
    return { ...conforme(`requête de diagnostic extraite de ${chemin} : ${lignes} ligne(s)`), sql: r.sql };
  });
}

/**
 * ⚠️ LE SQL SORT SUR LA SORTIE STANDARD, LE VERDICT SUR L'ERREUR. La CI redirige la première dans un
 * fichier qu'elle donne à `psql` : un résumé mêlé au SQL le rendrait invalide, et l'échec
 * ressemblerait à un défaut de la requête plutôt qu'à un défaut de ce module.
 */
export function principal({
  verifie = verifier,
  ecrire = (s) => process.stdout.write(s),
  alerter = (s) => process.stderr.write(s + "\n"),
} = {}) {
  const resultat = verifie();
  if (resultat.code === CONFORME) ecrire(resultat.sql + "\n");
  return rendre(resultat, { ecrire: alerter, alerter });
}

if (estExecuteDirectement(import.meta.url)) {
  const code = principal();
  // ⚠️ On ne sort PAS sur 0 : `process.exit(0)` tronque les écritures encore en tampon — et ici la
  // sortie tronquée serait une requête SQL amputée, donc un banc qui mesure autre chose.
  if (code !== CONFORME) process.exit(code);
}
