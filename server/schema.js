// CE QUE LA BASE PORTE VRAIMENT, ET NON CE QU'ON CROIT LUI AVOIR APPLIQUÉ.
//
// ⚠️ LE PLAYER N'APPLIQUE PAS LES MIGRATIONS, ET NE LE POURRA JAMAIS. Il parle à la base uniquement
// par PostgREST, qui n'exécute pas de DDL. Lui donner ce pouvoir supposerait d'exposer une fonction
// capable d'exécuter du SQL arbitraire — dans un service qui sert des liens publics. C'est l'hôte qui
// applique ; le player doit seulement SAVOIR.
//
// ⚠️ ET IL DEMANDE PLUTÔT QU'IL NE RETIENT. Une table de suivi des migrations aurait dû être créée
// par une migration : le premier pas serait retombé sur le problème qu'elle résout. Et un registre
// dit ce qu'on CROIT avoir appliqué ; une sonde dit ce qui EST. Les deux divergent le jour où
// quelqu'un applique à la main — c'est-à-dire le jour où ça compte.
//
// ⚠️ POURQUOI CE FICHIER EXISTE. PostgREST rejette un `PATCH` portant une colonne inconnue. Un hôte
// qui déploie le code avant la migration voit donc TOUTES ses écritures échouer sur ce chemin, pas
// seulement la fonction nouvelle — et le message parle d'une colonne, pas d'une version. Deux
// chantiers ont été repoussés pour cette seule raison. Avec cette sonde, l'ordre de déploiement
// cesse d'être un piège.

let PLAYER = null;
/**
 * Une question posée une fois, retenue pour le processus.
 *
 * ⚠️ C'EST AUSSI CE QUI DÉDOUBLONNE LE JOURNAL, et il n'y a donc rien d'autre à écrire pour ça. La
 * première version portait un second ensemble « déjà signalé » : vidé exactement quand celui-ci
 * l'est, donc inatteignable. Une mutation qui le retirait ne faisait échouer aucun test — la bonne
 * réponse n'était pas d'ajouter un test pour le justifier, c'était de constater qu'il ne servait à
 * rien. Une garde qu'on ne peut pas voir refuser n'est pas une garde.
 */
const connues = new Map();

function init(ctx) {
  PLAYER = ctx;
  connues.clear();
}

/**
 * La base porte-t-elle cette colonne ?
 *
 * ⚠️ EN CAS DE DOUTE, ABSENTE. Supposer présente ferait échouer l'écriture ENTIÈRE — la nouvelle
 * fonction et tout ce qui l'accompagne. Supposer absente fait attendre la fonction seule. Une
 * fonction qui attend vaut mieux qu'une écriture perdue, et c'est la seule direction où l'erreur se
 * répare toute seule quand la migration arrive.
 *
 * @param {string} table
 * @param {string} colonne
 * @param {string} migration le fichier à appliquer — c'est LUI qu'on nomme dans le journal
 */
function aLaColonne(table, colonne, migration) {
  const cle = `${table}.${colonne}`;
  if (!connues.has(cle)) connues.set(cle, sonder(table, colonne, migration, cle));
  return connues.get(cle);
}

async function sonder(table, colonne, migration, cle) {
  try {
    // `limit=0` : on ne veut aucune ligne, seulement savoir si la colonne se sélectionne. PostgREST
    // répond 400 « column … does not exist » quand elle manque — donc l'échec EST la réponse.
    //
    // ⚠️ LA PART ENCODÉE EST CALCULÉE À PART, ET PAS POUR LA LISIBILITÉ. La garde de portabilité de
    // la CI traque la syntaxe propre à PostgREST — les ressources imbriquées « select=a(b) », les
    // arbres booléens — en cherchant une parenthèse après « select= ». Écrite dans le gabarit,
    // l'appel à encodeURIComponent en produisait une : la garde accusait une requête parfaitement
    // portable. On lève l'ambiguïté du côté du code, pas du côté de la garde.
    //
    // ⚠️ ET CETTE SONDE EST LE SEUL ENDROIT QUI DÉPEND DU COMPORTEMENT D'ERREUR DE PostgREST. Sur
    // une autre base, « la colonne manque » se demanderait autrement. C'est isolé ici exprès : un
    // portage a un fichier à réécrire, pas une habitude à retrouver partout.
    const champ = encodeURIComponent(colonne);
    await PLAYER.db.request(`${table}?select=${champ}&limit=0`);
    return true;
  } catch {
    // ⚠️ ON NE DISTINGUE PAS « COLONNE ABSENTE » DE « BASE INJOIGNABLE », ET C'EST VOULU. Les deux
    // mènent à la même décision — ne pas écrire ce champ — et distinguer supposerait de lire un
    // message d'erreur, c'est-à-dire de dépendre du texte d'un service tiers. Ce qui change entre
    // les deux, c'est la durée : une base injoignable le redevient, et le processus suivant reposera
    // la question.
    signaler(cle, migration);
    return false;
  }
}

/**
 * ⚠️ ON NOMME LE FICHIER, PAS L'ERREUR. « column does not exist » envoie l'exploitant lire du
 * PostgREST ; « appliquez supabase/migrations/0001-…sql » lui dit quoi faire. La différence entre
 * les deux se compte en heures.
 */
function signaler(cle, migration) {
  const quoi = migration ? `Appliquez ${migration}.` : "Une migration est en attente.";
  try {
    console.warn(`[player] la colonne « ${cle} » manque : la fonction qui en dépend reste inactive. ${quoi}`);
  } catch { /* sans console */ }
}

/** Pour les tests et l'exploitation : reposer la question. */
function oublier() { connues.clear(); }

module.exports = { init, aLaColonne, oublier };
