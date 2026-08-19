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

/**
 * CE QUE CE CODE ATTEND DE LA BASE — DÉCLARÉ UNE FOIS, ET C'EST LA SOURCE.
 *
 * ⚠️ UN INVENTAIRE QUI N'EST PAS LA SOURCE DÉRIVE. Ces couples vivaient recopiés sur quatre
 * appels ; en tirer une simple liste « pour l'affichage » aurait refait, en plus petit, le défaut
 * qui a vidé supabase/init.sql de ses cinq migrations : deux exemplaires du même fait, personne
 * pour les confronter. Les appelants passent donc par `attendue(nom)` et ne nomment plus de
 * colonne — il n'existe plus qu'un endroit où se tromper. Une étape de la forge vérifie en outre
 * que chaque fichier nommé ici existe, et qu'aucun appel ne contourne cette table.
 */
const ATTENDUES = {
  destinataireAtteste: {
    table: "commercial_doc_shares", colonne: "attested_recipient_email",
    migration: "supabase/migrations/0001-destinataire-atteste.sql",
    fonction: "attribuer une lecture au destinataire attesté par l'hôte",
  },
  rangEcriture: {
    table: "doc_presentations", colonne: "write_seq",
    migration: "supabase/migrations/0002-ordre-des-ecritures.sql",
    fonction: "refuser une écriture de pilotage doublée en vol",
  },
  envoiUnique: {
    table: "doc_presentation_messages", colonne: "client_key",
    migration: "supabase/migrations/0005-envoi-unique.sql",
    fonction: "empêcher qu'un renvoi crée un second message",
  },
  liensUniques: {
    table: "commercial_doc_shares", colonne: "idem_key",
    migration: "supabase/migrations/0011-liens-uniques.sql",
    fonction: "empêcher deux demandes simultanées de créer deux liens système pour le même usage",
  },
  revocationDatee: {
    table: "commercial_doc_shares", colonne: "revoked_at",
    migration: "supabase/migrations/0013-revocation-datee.sql",
    fonction: "dater la révocation pour borner la rétention des liens révoqués",
  },
  reactionsOrdonnees: {
    table: "doc_presentation_messages", colonne: "reactions_seq",
    migration: "supabase/migrations/0006-reactions-ordonnees.sql",
    fonction: "empêcher deux réactions simultanées de s'écraser",
  },
};

/**
 * LE TÉMOIN — une colonne dont l'absence est impossible.
 *
 * ⚠️ IL DISTINGUE « ABSENTE » DE « INJOIGNABLE » SANS LIRE UN MESSAGE D'ERREUR. La sonde ne fait
 * pas cette différence, et c'est juste pour DÉCIDER (les deux mènent à ne pas écrire le champ).
 * Pour RAPPORTER, les confondre serait faux dans les deux sens : une base momentanément muette
 * ferait annoncer trois migrations manquantes qui existent — une fausse alerte qui envoie
 * l'exploitant appliquer ce qu'il a déjà.
 *
 * Le témoin est la clé primaire de la plus ancienne table : si LUI ne répond pas, ce n'est pas une
 * migration qui manque, c'est la base. Mesure différentielle, aucune dépendance au texte d'un
 * service tiers — la raison même pour laquelle la sonde refusait de distinguer.
 */
const TEMOIN = { table: "doc_presentations", colonne: "slug" };

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

/**
 * ⚠️ UN « NON » N'A PAS LA MÊME DURÉE DE VIE QU'UN « OUI » — et les confondre a fait qu'une panne
 * passagère ÉTEIGNAIT des fonctions pour la vie du processus.
 *
 * Un « oui » est stable : une colonne présente ne disparaît pas (les migrations sont additives, et
 * personne ne supprime une colonne sous un processus qui tourne). Un « non », lui, recouvre deux
 * réalités que la sonde ne distingue pas — colonne absente, base injoignable — dont la seconde se
 * répare TOUTE SEULE. Retenir ce « non » pour toujours transformait un hoquet de base pendant un
 * envoi de message en idempotence morte jusqu'au redémarrage, sans un mot.
 *
 * D'où : un « oui » est retenu pour le processus ; un « non » expire. Le délai borne le coût chez
 * un hôte réellement non migré (une sonde ratée par minute et par attente, pas une par écriture)
 * tout en rendant la guérison automatique — la seule direction où l'erreur se répare toute seule.
 * Trouvé par le troisième audit, qui a aussi montré que notre essai de récupération appelait
 * `init()` — lequel vide précisément ce cache : il prouvait une guérison qui n'existait pas.
 */
const TTL_NEGATIF_MS = 60 * 1000;
const quandNegatif = new Map();      // cle → instant du « non », pour le faire expirer

/**
 * Les réponses DÉJÀ OBTENUES, pour qui veut les lire — la carte d'identité, essentiellement.
 *
 * ⚠️ CE N'EST PAS UN DOUBLON DE `connues`. Celle-ci porte des promesses, dont on ne peut rien dire
 * sans les attendre ; celle-là porte des réponses. La distinction compte parce que la carte
 * d'identité ne doit RIEN demander à la base — elle doit répondre quand la base ne répond plus.
 */
const reponses = new Map();

function init(ctx) {
  PLAYER = ctx;
  connues.clear();
  reponses.clear();
  quandNegatif.clear();
  sondeEnCours = null;
  sondePrise = 0;
}

/** La sonde d'une attente déclarée. C'est la seule forme d'appel que les appelants utilisent. */
function attendue(nom) {
  const a = ATTENDUES[nom];
  // Un nom inconnu est une faute de frappe, pas une dégradation : la taire ferait passer la
  // fonction pour « en attente de migration » alors qu'elle est simplement mal câblée.
  if (!a) throw new Error(`attente de schéma inconnue : ${nom}`);
  return aLaColonne(a.table, a.colonne, a.migration);
}

/**
 * ⚠️ CE QUE LE JOURNAL NE DIRA JAMAIS À PERSONNE.
 *
 * La sonde signale une colonne absente par un `console.warn`, une fois par processus. Sur une
 * fonction serverless, c'est une ligne perdue dans une sortie que personne n'ouvre quand tout a
 * l'air de marcher — et « tout a l'air de marcher » est précisément l'état d'un hôte dont trois
 * protections dorment. Remarque du second hôte, et elle est juste : la trace existait à l'endroit
 * exact où on ne regarde pas.
 *
 * ⚠️ ON NE SONDE PAS ICI, ON RAPPORTE. La carte d'identité doit répondre quand la base ne répond
 * plus ; sonder depuis elle en ferait un diagnostic qui tombe en même temps que ce qu'il diagnostique.
 *
 * ⚠️ D'OÙ TROIS ÉTATS, ET PAS DEUX. Un processus qui n'a encore rien demandé ne sait rien — et
 * « rien de manquant » se lirait « tout va bien ». Une absence de résultat ressemble à un
 * résultat ; `sondees` est là pour qu'on ne puisse pas les confondre.
 */
function etatDuSchema() {
  const manquant = [];
  for (const [, r] of reponses) if (!r.present) manquant.push({ migration: r.migration, fonction: r.fonction });
  const attendues = Object.keys(ATTENDUES).length;
  return {
    attendues,
    sondees: reponses.size,
    // ⚠️ UN MOT, PAS UN TABLEAU VIDE À INTERPRÉTER. `manquant: []` a quatre sens selon ce qu'on
    // sait par ailleurs — rien demandé, tout vérifié, vérifié en partie, base muette — et forcer
    // le lecteur à les reconstituer en croisant deux champs, c'est lui laisser la faute. Le second
    // hôte l'a posé comme condition à ce paramètre, et il avait raison avant même de le voir.
    verdict: verdict(manquant.length, reponses.size, attendues),
    // ⚠️ ON NOMME LE FICHIER, alors que cette route est publique. Même raison que `frameAncestors`
    // juste au-dessus d'elle : l'exploitant n'a AUCUN autre moyen d'apprendre laquelle manque, et
    // un compte nu le laisserait deviner. Ce qu'on révèle en échange — qu'une fonction de
    // fiabilité est en attente, dans un dépôt dont les migrations sont publiques — n'ouvre aucun
    // accès : il faut déjà détenir un jeton de pilotage pour tirer parti d'un rang absent.
    manquant,
  };
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
  // Un « non » périmé n'est plus une réponse : on repose la question. Un « oui » ne périme pas.
  const depuis = quandNegatif.get(cle);
  if (depuis !== undefined && Date.now() - depuis > TTL_NEGATIF_MS) {
    connues.delete(cle);
    quandNegatif.delete(cle);
  }
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
    quandNegatif.delete(cle);
    noter(cle, true, migration);
    return true;
  } catch {
    // ⚠️ ON NE DISTINGUE PAS « COLONNE ABSENTE » DE « BASE INJOIGNABLE », ET C'EST VOULU. Les deux
    // mènent à la même décision — ne pas écrire ce champ — et distinguer supposerait de lire un
    // message d'erreur, c'est-à-dire de dépendre du texte d'un service tiers. Ce qui change entre
    // les deux, c'est la durée : une base injoignable le redevient, et le processus suivant reposera
    // la question.
    quandNegatif.set(cle, Date.now());
    noter(cle, false, migration);
    signaler(cle, migration);
    return false;
  }
}

function verdict(manque, sondees, attendues) {
  if (manque) return "incomplet";          // un manque est un fait positif : il tranche seul
  if (!sondees) return "non-sonde";
  return sondees < attendues ? "partiel" : "complet";
}

/**
 * SONDER TOUT, À LA DEMANDE — `?contract=1&schema=1`.
 *
 * ⚠️ LE COÛT EST SUR L'APPELANT QUI VEUT LA RÉPONSE. Sonder au démarrage mettrait un aller-retour
 * base sur chaque démarrage à froid, donc sur le chemin critique de la première vraie requête,
 * pour un diagnostic que presque personne ne lit — et ferait dépendre le contenu de la carte de ce
 * que la base a répondu, c'est-à-dire déplacerait le couplage que sa doctrine interdit au lieu de
 * le supprimer. Arbitrage tranché avec le second hôte, sur ses trois raisons.
 *
 * ⚠️ ET UN DIAGNOSTIC NE DOIT PAS ÉTEINDRE CE QU'IL DIAGNOSTIQUE. `aLaColonne` retient sa réponse
 * pour la vie du processus : appelé pendant un hoquet de la base, ce paramètre aurait mis en cache
 * « absente » pour les trois attentes — désactivant l'ordre des écritures et l'idempotence des
 * messages jusqu'au prochain démarrage. Une route de contrôle qui casse la production. Si le
 * témoin ne répond pas, on ne sonde RIEN et on ne retient RIEN.
 */
/**
 * ⚠️ LA SONDE EST PUBLIQUE : chaque appel coûtait des requêtes base, autant de fois qu'on veut.
 * Une boucle sur `?contract=1&schema=1` faisait de la carte un petit amplificateur — la ressource
 * PARTAGÉE paie, pas l'appelant. Deux bornes : les appels simultanés partagent UNE sonde, et le
 * résultat sert pendant 30 s — un état de schéma ne change pas plus vite qu'une migration.
 */
const CACHE_SONDE_MS = 30 * 1000;
let sondeEnCours = null;
let sondePrise = 0;

function sonderTout() {
  if (sondeEnCours && Date.now() - sondePrise < CACHE_SONDE_MS) return sondeEnCours;
  sondePrise = Date.now();
  sondeEnCours = vraimentSonderTout();
  return sondeEnCours;
}

async function vraimentSonderTout() {
  // ⚠️ LA PART ENCODÉE EST CALCULÉE À PART, comme dans `sonder()` dix lignes plus haut, et pour la
  // même raison : la garde de portabilité traque une parenthèse après « select= », et un appel de
  // fonction écrit dans le gabarit en produit une. J'ai reproduit ici le défaut dont le correctif
  // était commenté juste au-dessus — la forme exacte de la migration 0004, où dix lignes
  // expliquaient la prudence qu'un revoke six lignes plus haut n'appliquait pas.
  const champTemoin = encodeURIComponent(TEMOIN.colonne);
  try {
    await PLAYER.db.request(`${TEMOIN.table}?select=${champTemoin}&limit=0`);
  } catch {
    // On rend ce qu'on savait déjà — un manque constaté plus tôt reste un fait — mais le verdict
    // dit que cette mesure-ci n'a pas eu lieu. Taire l'un ou l'autre serait mentir d'un côté.
    return { ...etatDuSchema(), verdict: "indetermine" };
  }
  // ⚠️ LE TÉMOIN VIENT DE RÉPONDRE : tout « non » encore en cache est SUSPECT — il peut dater
  // d'une panne guérie. On le jette et on repose la question, sinon ce diagnostic rendrait la
  // valeur d'un incident passé en la datant d'aujourd'hui. Les « oui » restent : ils sont stables.
  for (const [cle] of quandNegatif) { connues.delete(cle); reponses.delete(cle); }
  quandNegatif.clear();
  for (const nom of Object.keys(ATTENDUES)) await attendue(nom);
  return etatDuSchema();
}

/** La réponse, retenue pour qui la demandera — sans repasser par la base. */
function noter(cle, present, migration) {
  const a = Object.values(ATTENDUES).find((x) => `${x.table}.${x.colonne}` === cle);
  reponses.set(cle, { present, migration, fonction: a ? a.fonction : "" });
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
function oublier() { connues.clear(); reponses.clear(); quandNegatif.clear(); sondeEnCours = null; sondePrise = 0; }

module.exports = { init, aLaColonne, attendue, etatDuSchema, sonderTout, oublier, ATTENDUES, TEMOIN };
