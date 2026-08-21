// DEUX ROUGES DIFFÉRENTS, UN SEUL CODE DE SORTIE — ET PERSONNE NE POUVAIT LES DISTINGUER.
//
// ⚠️ CE DÉPÔT A SIX GARDES, ET TOUTES SORTAIENT 1 POUR DEUX CHOSES QUI N'ONT RIEN À VOIR
// (P1, revue externe du 21/08) :
//
//     process.exit(1)   ← « le dépôt viole la règle »          → l'auteur doit corriger SA branche
//     process.exit(1)   ← « la sonde n'a rien trouvé à lire »  → l'auteur n'y est pour RIEN
//
// Le second cas n'est pas rare : il est arrivé trois fois en une soirée. La garde Docker rendait
// « 0 référence » sur un Dockerfile qu'elle ne savait pas lire ; la garde des actions visait un
// dossier vide ; le lecteur YAML refusait un document illisible. À chaque fois, un rouge qui dit
// à l'auteur « tu as cassé quelque chose » alors que c'est la GARDE qui est cassée.
//
// ⚠️ ET C'EST EXACTEMENT LE MÉCANISME QUE LA DOCTRINE DE CE DÉPÔT INTERDIT. « Une alerte qui sonne
// quand tout va bien apprend aux gens à cliquer à côté. » Un rouge que l'auteur constate n'être pas
// de son fait lui enseigne, une fois, que le rouge de cette garde est parfois du bruit. La fois
// suivante, celle où la violation est réelle, il a déjà appris le geste.
//
// ⚠️ 2 ÉCHOUE AUSSI, ET CE N'EST PAS NÉGOCIABLE. Un résultat non concluant n'est pas un succès :
// la garde n'a rien pu affirmer, donc rien n'est prouvé. 1 et 2 sont tous deux non nuls et font
// rougir la CI. Ce qui change n'est pas la sévérité, c'est CE QUE LE ROUGE VEUT DIRE — et donc à
// qui il s'adresse. Rendre 2 tolérant fabriquerait la garde muette que ce dépôt refuse depuis la
// 0.1.35 : « une garde qui échoue en silence est pire que pas de garde ».
//
// Usage : voir `conclure()` en bas de chaque outil de `tools/`.

/** La règle est vérifiée, et elle est tenue. */
export const CONFORME = 0;

/** La règle est vérifiée, et le DÉPÔT la viole. Le correctif est dans la branche de l'auteur. */
export const VIOLATION = 1;

/**
 * La règle n'a PAS pu être vérifiée. Le correctif est dans la garde, son environnement, ou son
 * réseau — pas dans la branche. Non nul quand même : rien n'a été prouvé.
 */
export const INCONCLUSIF = 2;

/**
 * Un avertissement accompagne n'importe lequel des trois verdicts : c'est ce qu'on a constaté sans
 * pouvoir en tirer un échec. `actions-versions.mjs` s'en sert déjà pour les dépôts injoignables —
 * il vérifie ce qu'il peut, et DIT ce qu'il n'a pas vu plutôt que de le passer sous silence.
 */
const avec = (base, avertissements) => ({ ...base, avertissements: avertissements || [] });

export const conforme = (resume, avertissements) =>
  avec({ code: CONFORME, resume }, avertissements);

/** @param constats une ligne par violation, chacune nommant le fichier et ce qui cloche. */
export const violation = (constats, avertissements) =>
  avec({ code: VIOLATION, constats: [].concat(constats) }, avertissements);

/** @param raisons pourquoi la garde n'a pas pu conclure — jamais un motif vague. */
export const inconclusif = (raisons, avertissements) =>
  avec({ code: INCONCLUSIF, raisons: [].concat(raisons) }, avertissements);

/**
 * ⚠️ UNE EXCEPTION EST UN RÉSULTAT NON CONCLUANT, PAS UNE VIOLATION.
 *
 * C'est le cas qui motivait le plus cette séparation. `workflows-yaml.mjs` LÈVE délibérément sur un
 * document illisible ou un `uses:` qui vaut un alias — « on refuse plutôt que de deviner », et cette
 * exigence est juste. Mais elle remontait jusqu'à Node, qui sortait 1 : le refus prudent de la garde
 * prenait l'apparence d'une violation du dépôt, avec une trace de pile en guise d'explication.
 *
 * Ce qui vaut pour le YAML vaut pour un `Dockerfile` absent, un `npm pack` qui échoue, un `git`
 * indisponible. Aucun de ces événements ne dit quoi que ce soit de la règle surveillée.
 */
export function tenter(travail) {
  try {
    return travail();
  } catch (e) {
    return inconclusif(e?.message ? String(e.message) : String(e));
  }
}

/**
 * Écrit le verdict et rend le code. ⚠️ SÉPARÉE DE `conclure()` POUR QUE LE BANC PUISSE L'ÉPROUVER :
 * un module qui appelle `process.exit` n'est pas testable, et une garde dont on ne teste pas la
 * sortie est précisément ce qui a permis les trois défauts ci-dessus.
 */
export function rendre(resultat, { ecrire = console.log, alerter = console.error } = {}) {
  for (const a of resultat.avertissements || []) alerter("::warning::" + a);

  if (resultat.code === VIOLATION) {
    for (const c of resultat.constats) alerter("::error::" + c);
    return VIOLATION;
  }
  if (resultat.code === INCONCLUSIF) {
    // ⚠️ LE PRÉFIXE EST LE TOUT. C'est la seule chose qui, dans un journal de CI, distingue
    // « corrige ta branche » de « cette garde n'a pas pu regarder ». Sans lui, les deux rouges se
    // ressemblent — et c'est l'état qu'on corrige ici.
    for (const r of resultat.raisons) alerter("::error::GARDE NON CONCLUANTE — " + r);
    alerter("::error::GARDE NON CONCLUANTE — rien n'a été vérifié, donc rien n'est prouvé ; le correctif est dans la garde ou son environnement, pas dans la branche");
    return INCONCLUSIF;
  }
  ecrire(resultat.resume);
  return CONFORME;
}

/** Le point de sortie des outils en ligne de commande. */
export function conclure(resultat, sortir = (c) => process.exit(c)) {
  const code = rendre(resultat);
  // ⚠️ On ne sort PAS sur 0 : `process.exit(0)` tronque les écritures encore en tampon sur
  // certains flux. On laisse Node terminer, ce qui rend 0 de lui-même.
  if (code !== CONFORME) sortir(code);
  return code;
}
