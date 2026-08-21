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
  // ⚠️ ENTRÉE DE REPORT, PAS DE GATE D'ÉCRITURE. Les six ci-dessus sont sondées par les chemins
  // d'écriture (`attendue()`) pour décider s'ils écrivent la colonne. Celle-ci ne l'est que par la
  // carte (`sonderTout`, `?schema=1`) : la présence dégrade sur l'ABSENCE DE LA RPC
  // `player_attendance_bump` (repli sur la boucle, cf. presentations.js), pas sur cette colonne. Mais
  // colonne et fonction voyagent ENSEMBLE dans la 0015 : la colonne est donc le témoin PROBEABLE que
  // la 0015 est appliquée — une RPC, elle, ne se sonde pas proprement en REST sans l'appeler. Sans
  // cette entrée, la carte annonçait « complet » à un hôte sans la 0015, présence dégradée (relevé ADV).
  presenceAtomique: {
    table: "doc_presentation_attendees", colonne: "creator_ip_hash",
    migration: "supabase/migrations/0015-presence-atomique.sql",
    fonction: "écrire la présence atomiquement et plafonner la création de faux participants anonymes",
  },
  // Chat différentiel : la colonne `mod_seq` (bumpée par trigger) est ce que le code sonde AVANT de
  // servir en différentiel. Absente → on sert les 300 derniers comme avant (cf. listMessages). Ici la
  // colonne EST le vrai signal de dégradation (le code la sonde), pas seulement un témoin — cas franc.
  chatDifferentiel: {
    table: "doc_presentation_messages", colonne: "mod_seq",
    migration: "supabase/migrations/0016-chat-differentiel.sql",
    fonction: "relire le chat en différentiel (mod_seq > curseur) au lieu des 300 derniers à chaque signal",
  },
  // Jeton de présence (P1c étape 2). `last_token_at` est sondée AVANT d'écrire les colonnes de
  // transition et de servir le compteur `presence`. `last_no_token_at` voyage avec elle dans 0017 (elle
  // est donc exemptée de sonde séparée, cf. NON_SONDEES du test carteSchemaMigrations). Absentes → on
  // n'écrit pas les colonnes et le compteur n'apparaît pas ; la présence continue de fonctionner.
  jetonPresence: {
    table: "doc_presentation_attendees", colonne: "last_token_at",
    migration: "supabase/migrations/0017-jeton-presence.sql",
    fonction: "mesurer la transition du jeton de présence (avecJeton / sansJeton) pour savoir quand fermer",
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
  const etat = etatDuSchema();
  await ajouterSansRang(etat);
  await ajouterPresence(etat);
  await ajouterDurcissement(etat);
  return etat;
}

/**
 * ⚠️ `mod_seq` NUL EST AMBIGU, ET UN NOMBRE AMBIGU NE MESURE RIEN. Le rattrapage de 0016 laisse
 * DÉLIBÉRÉMENT sans rang les messages des présentations scellées (le scellé refuse de les écrire). Mais
 * rien ne distingue « nul par décision » de « nul parce que le rattrapage n'a jamais tourné » : les
 * deux se lisent « ligne sans rang ». On rend donc les DEUX nombres — total, et la part qui est
 * légitimement scellée. Égaux ⇒ tout nul est un scellé attendu ; divergents ⇒ le rattrapage a laissé
 * des lignes NON scellées derrière lui, anomalie à corriger. C'est la classe « une garde qu'on n'a pas
 * vue refuser ne garde rien » appliquée à un compteur : le compteur devient un verdict. (relevé 2e hôte)
 *
 * Seulement si la colonne est là (sinon la question n'a pas de sens), et JAMAIS bloquant : un
 * diagnostic ne doit pas casser la carte qu'il enrichit — mieux vaut pas de compteur qu'une carte muette.
 */
// Plafond du diagnostic : borné, ET qui le dit. Voir ci-dessous — la borne n'était jamais le défaut,
// son SILENCE l'était.
//
// ⚠️ CONDITION DE VALIDITÉ DE `tronque` : elle ne tient que tant que `PLAFOND_SANS_RANG <= db-max-rows`.
// Un `limit` explicite NE BAT PAS le plafond implicite du serveur : PostgREST rend `min(limit,
// db-max-rows)`. Si un exploitant abaisse `db-max-rows` sous ce plafond — durcissement légitime — une
// liste réellement coupée reviendrait à moins de PLAFOND, `>= PLAFOND` serait faux, et `tronque`
// redeviendrait un faux négatif SILENCIEUX. C'est le miroir de la leçon des bornes : la PRÉSENCE d'un
// `limit` n'est pas plus la borne réelle que son ABSENCE n'était « tout ». La détection propre passe par
// l'en-tête Content-Range, hors de portée de `db.request` (corps seul) — d'où un garde-fou dont on
// DÉCLARE la condition de validité, plutôt qu'un qu'on croirait inconditionnel. (relevé 2e hôte)
const PLAFOND_SANS_RANG = 1000;

// ⚠️ 0018 EST UNE PROPRIÉTÉ DE LA BASE — ELLE DOIT SE DEMANDER À LA BASE.
//
// `presenceDurcissement` (carte) est un RAPPORT D'EXÉCUTION : il dit ce que CE processus a constaté
// en servant des bootstraps. Sur une instance au repos il rend « inconnu », et c'est juste — mais
// inutilisable comme contrôle avant déploiement, où la question est « la migration est-elle là ? ».
// Nous avions même écrit une consigne de pré-vol qui l'exigeait : un hôte la suivant à la lettre
// aurait lu « pas degrade, donc j'y vais » et découvert le refus à la première présentation, c'est-
// à-dire au pire moment. On avait bâti un champ qui refuse de se prononcer sans observation, puis
// placé ce champ au centre d'une procédure qui exige une réponse. (Relevé par le second hôte.)
//
// ⚠️ LA SONDE N'ÉCRIT RIEN, ET CE N'EST PAS UN ESPOIR : avec `p_anon_cap = 0`, une ligne inexistante
// part par la branche « capped » de 0018 (`if v_count >= p_anon_cap then return ... ; return; end if;`)
// et la fonction rend AVANT son `insert`. Le slug de sonde porte une espace — donc il ne peut jamais
// être un slug réel (contrat `^[A-Za-z0-9_-]{1,64}$`), et ne peut pas heurter une vraie présence.
// Un test de base (Postgres réel) vérifie qu'aucune ligne n'apparaît.
const SLUG_SONDE_DURCISSEMENT = "sonde durcissement";

async function ajouterDurcissement(etat) {
  const corps = {
    p_slug: SLUG_SONDE_DURCISSEMENT, p_key: "sonde", p_ip_hash: null, p_page: 1,
    p_name: "", p_avatar: "", p_is_member: false, p_is_presenter: false,
    p_max_gap_ms: 0, p_anon_cap: 0, p_has_token: null, p_only_if_unclaimed: true,
  };
  try {
    await PLAYER.db.request("rpc/player_attendance_bump", { method: "POST", body: corps });
    etat.durcissementBase = "applique";
  } catch (erreur) {
    // ⚠️ TROIS ISSUES, ET LA TROISIÈME N'EST PAS UNE DES DEUX AUTRES. Seule la signature absente
    // prouve que 0018 manque ; une panne réseau ou un 500 ne prouvent RIEN, et les compter comme
    // « absente » serait le défaut qu'on a mis trois versions à retirer d'ailleurs.
    let absente = false;
    try { absente = require("./presentations.js").signatureAbsente(erreur); } catch { /* module absent */ }
    etat.durcissementBase = absente ? "absente" : "indetermine";
    // ⚠️ ET ON LE DIT, PAS SEULEMENT DANS LA CARTE. Une garde de ce dépôt refuse qu'une écriture soit
    // rattrapée en silence, et elle a raison ici pour une raison qu'elle ne pouvait pas connaître :
    // c'est ce journal qui prévient un hôte à qui 0018 manque SANS qu'aucune présentation ne tourne
    // — exactement le cas où le rapport d'exécution reste muet, et où l'exploitant ne saura rien
    // avant la première présentation. Une fois par heure : la carte est publique, donc appelable en
    // boucle, et un journal sans frein deviendrait une arme.
    try {
      if (await PLAYER.limits.allow("schema:durcissement-absent", 1, 3600)) {
        PLAYER.errors.capture(new Error(
          absente
            ? "migration 0018-bootstrap-non-usurpable.sql ABSENTE : les bootstraps de présence ne "
              + "sont pas contrôlés. N'armez pas PLAYER_PRESENCE_STRICT avant de l'appliquer — il "
              + "refuserait alors les bootstraps en 503."
            : "sonde de durcissement (0018) sans réponse exploitable : ni confirmée, ni infirmée — "
              + ((erreur && erreur.message) || erreur),
        ), { route: "schema" });
      }
    } catch { /* jamais bloquant */ }
  }
  etat.durcissementBaseCouvre =
    "propriété de la BASE (migration 0018), globale à toutes les instances — à ne pas confondre avec "
    + "presenceDurcissement, qui est ce que CE processus a constaté en servant des bootstraps. "
    + "C'est ce champ-ci qu'on lit AVANT un déploiement ; « indetermine » = la question n'a pas pu "
    + "être posée, ce n'est ni un oui ni un non.";
}

async function ajouterSansRang(etat) {
  const r = reponses.get("doc_presentation_messages.mod_seq");
  if (!r || !r.present) return;
  try {
    // ⚠️ BORNÉ, ORDONNÉ, ET QUI DIT QU'IL EST BORNÉ — trois défauts corrigés en un (relevé 2e hôte,
    // trois passes). (1) `selectAll` sans borne (0.1.93) : sur un hôte dont le backfill n'a JAMAIS
    // tourné, toutes les lignes sont nulles → il paginait la table ENTIÈRE sur la route de la carte,
    // épuisant maxDuration — que le try/catch NE rattrape PAS (un dépassement tue la fonction, pas la
    // promesse). La carte TOMBE au lieu de dégrader, ce que la ligne d'à côté interdit. La borne
    // n'était pas le défaut ; son silence l'était. (2) Sans `order=`, la pagination par Range n'a
    // aucune stabilité — deux pages doublent ou sautent des lignes sur une base vivante (une
    // présentation en cours EST une base vivante). Les trois autres selectAll du dépôt ont toutes un
    // `order=` ; ce code était le seul à y déroger. (3) On rend donc en UNE requête bornée à PLAFOND,
    // triée, et si la borne est atteinte on pose `tronque: true` : l'égalité total/dontScellees n'est
    // alors plus lisible comme « tout va bien ». Un compteur borné DOIT dire qu'il l'est.
    const bornee = `&order=slug.asc&limit=${PLAFOND_SANS_RANG}`;
    const scellees = await PLAYER.db.request(`doc_presentations?active=eq.false&control_hash=is.null&select=slug${bornee}`);
    const listeScellees = Array.isArray(scellees) ? scellees : [];
    const setScellees = new Set(listeScellees.map((p) => p.slug));
    const nuls = await PLAYER.db.request(`doc_presentation_messages?mod_seq=is.null&select=slug${bornee}`);
    const liste = Array.isArray(nuls) ? nuls : [];
    const tronque = liste.length >= PLAFOND_SANS_RANG || listeScellees.length >= PLAFOND_SANS_RANG;
    etat.sansRang = { total: liste.length, dontScellees: liste.filter((m) => setScellees.has(m.slug)).length, tronque };
  } catch { /* best-effort : un compteur absent vaut mieux qu'une carte en échec */ }
}

/**
 * ⚠️ COMPTEUR DE TRANSITION DU JETON DE PRÉSENCE (P1c étape 2). `presence: { avecJeton, sansJeton }`
 * sur 24 h : `sansJeton === 0` ⇒ plus aucun client legacy ne bat → on peut poser PLAYER_PRESENCE_STRICT.
 * Sans ce compteur, poser le drapeau reviendrait à fermer la porte sans regarder qui est derrière.
 *
 * ⚠️ LES DEUX ENSEMBLES SE RECOUVRENT VOLONTAIREMENT. Un participant qui a envoyé les DEUX sortes de
 * battements dans la fenêtre (deux onglets, l'un en cache legacy, l'autre à jour) compte dans les DEUX
 * — c'est le cœur du correctif à deux champs. Donc `avecJeton + sansJeton ≠ nombre de participants` :
 * quelqu'un qui « corrigerait » l'apparente incohérence en rendant les deux exclusifs ferait revenir le
 * défaut d'origine (un seul battement moderne effacerait la trace legacy). Le critère est en ANY :
 * `sansJeton` = « a battu sans jeton dans les 24 h », vrai quoi qu'aient fait ses autres battements.
 *
 * Même patron borné-ordonné-parlant que `sansRang`, et pour les mêmes raisons — `doc_presentation_attendees`
 * est la plus grosse table et la seule écrite pendant qu'on la lit.
 */
async function ajouterPresence(etat) {
  const r = reponses.get("doc_presentation_attendees.last_token_at");
  if (!r || !r.present) return;
  try {
    const depuis = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    const bornee = `&order=slug.asc&limit=${PLAFOND_SANS_RANG}`;
    const avec = await PLAYER.db.request(`doc_presentation_attendees?last_token_at=gt.${encodeURIComponent(depuis)}&select=slug${bornee}`);
    const sans = await PLAYER.db.request(`doc_presentation_attendees?last_no_token_at=gt.${encodeURIComponent(depuis)}&select=slug${bornee}`);
    const nAvec = Array.isArray(avec) ? avec.length : 0;
    const nSans = Array.isArray(sans) ? sans.length : 0;
    // ⚠️ LE RELAIS NE SE LIT PAS SEUL — ET C'EST CE NOMBRE-LÀ QUI LE REND LISIBLE. Une fois la porte
    // fermée, `avecJeton` devient le signe de vie… mais il vaut ZÉRO LÉGITIMEMENT hors présentation,
    // ce qui est l'état permanent d'une instance au repos. « avecJeton: 0 » est donc ambigu tant qu'on
    // ne sait pas si quelque chose tourne — et la carte ne portait pas cette information : il fallait
    // aller la chercher ailleurs, c'est-à-dire ne pas la chercher. Le texte disait bien « nul PENDANT
    // une présentation », mais « pendant » est exactement le mot qu'un lecteur pressé saute — et ce
    // lecteur, dans six mois, c'est nous. On adjoint donc le nombre qui désambiguïse, comme
    // `dontScellees` l'a fait pour `sansRang` : 0 actives + 0 avecJeton = repos ; N actives + 0
    // avecJeton = ANOMALIE. (Précision du second hôte.)
    // ⚠️ « ACTIVE » N'EST PAS « VIVANTE », ET LE DÉNOMINATEUR A BESOIN DE LA SECONDE. Une présentation
    // dont le présentateur a fermé l'onglet sans clôturer reste `active = true` : la compter ferait
    // annoncer « N actives et 0 avecJeton = ANOMALIE » alors que personne n'est parti nulle part. La
    // fiabilité de ce nombre dépendrait alors de la DISCIPLINE DE CLÔTURE — et le second hôte, dont la
    // clôture a été impossible trois jours durant (0008), est bien placé pour le dire : ses sept
    // présentations sont inactives mais gardent toutes leur control_hash, donc aucune n'a été close
    // proprement. Un dénominateur qui dépend d'une discipline humaine produit des anomalies fantômes.
    //
    // On réutilise donc LE seuil qui définit déjà « vivante » ailleurs dans le code — `STALE_MS`, le
    // même que celui du balayage des présentations orphelines — plutôt que d'inventer un second
    // nombre qui divergerait. Le présentateur bat toutes les 30 s (`present-touch`) : une présentation
    // sans battement depuis trois minutes est abandonnée, pas silencieuse. (Relevé du second hôte.)
    const vivantDepuis = new Date(Date.now() - require("./presentations").STALE_MS).toISOString();
    const actives = await PLAYER.db.request(`doc_presentations?active=eq.true&last_seen=gt.${encodeURIComponent(vivantDepuis)}&select=slug${bornee}`);
    const nActives = Array.isArray(actives) ? actives.length : 0;
    // ⚠️ `couvre` VOYAGE AVEC LES NOMBRES, ET C'EST LE POINT. Le commentaire ci-dessus protège celui
    // qui lit la SOURCE ; celui qui court un risque, lui, lit le JSON — dans six mois, dans un cockpit,
    // sans ce fichier sous les yeux. `avecJeton: 40, sansJeton: 0` se lira alors « 40 participants
    // prouvés », alors que les 40 peuvent n'avoir RIEN prouvé : un bootstrap auto-déclaré (`wantToken`)
    // pose `last_token_at` sans qu'aucun jeton n'ait été vérifié — c'est voulu, et même NÉCESSAIRE pour
    // que `sansJeton` puisse atteindre zéro. Le mot est donc collé au nombre, comme `couvre` l'est déjà
    // au verdict du schéma : c'est une JAUGE DE MIGRATION, pas une métrique de sécurité. (relevé 2e hôte)
    etat.presence = {
      // ⚠️ CE QUE CES NOMBRES MESURENT CHANGE AVEC L'ÉTAT DE LA PORTE — et la carte, elle, le SAIT.
      //
      // La page d'audience part en `no-store` et le code client est interpolé DANS le HTML : il n'existe
      // donc aucun bundle périmé, et tout nouveau visiteur est moderne par construction. Conséquence que
      // personne n'avait écrite : une fois les vieux onglets éteints, `sansJeton` ne peut PLUS jamais
      // être non nul. Il vaudra 0 pour toujours — que le mécanisme marche ou qu'il soit entièrement
      // cassé. **Un compteur qui ne peut plus varier a cessé de mesurer, même s'il continue d'afficher
      // la bonne valeur.** Et c'est le TEMPS qui le périme, pas un défaut : aucun commit à blâmer,
      // aucune mutation à détecter, aucun refactor coupable — il devient simplement vrai pour la
      // mauvaise raison. (Relevé du second hôte ; cinquième variante de la famille.)
      //
      // Le texte suit donc l'état plutôt que de laisser le lecteur le déduire : avant fermeture,
      // `sansJeton` est l'instrument de transition ; après, il est structurellement nul et c'est
      // `avecJeton` qui prend le relais comme SIGNE DE VIE — nul pendant une présentation en cours
      // veut alors dire que quelque chose est cassé.
      couvre: (PLAYER.config && PLAYER.config.presenceStrict)
        // ⚠️ LA RÈGLE PORTE SUR LE CAS PRÉSENT, PAS SUR UN GABARIT. Une première version injectait
        // `nActives` dans une phrase écrite pour N > 0 et rendait, à N = 0 : « 0 active et 0 avecJeton
        // = ANOMALIE ; 0 active et 0 avecJeton = repos normal » — une contradiction dans la même ligne.
        // Formellement construite, fausse dans le cas du moment : exactement le défaut que ce champ
        // existe pour éviter. On BRANCHE donc sur l'état réel plutôt que d'interpoler un nombre dans un
        // texte générique — et au repos on annonce ce que le nombre voudra dire quand ça tournera.
        ? "jauge de transition PÉRIMÉE — porte fermée : sansJeton est structurellement nul et ne mesure "
          + "plus rien. Le signe de vie est avecJeton, à croiser avec presentationsActives. "
          + (nActives > 0
            ? nActives + " présentation(s) en cours : avecJeton DOIT être non nul — " + nAvec + " observé"
              + (nAvec > 0 ? ", donc les présences s'enregistrent." : " : ANOMALIE, les présences ne s'enregistrent plus.")
            : "aucune présentation en cours : avecJeton nul est le repos NORMAL. Le jour où une "
              + "présentation tournera, un avecJeton nul voudra dire que les présences ne s'enregistrent plus.")
          + " avecJeton inclut les bootstraps auto-déclarés — pas une preuve d'identité."
        : "jauge-de-migration — sansJeton dit combien de clients ANCIENS battent encore (0 = on peut "
          + "fermer). Instrument de TRANSITION : après fermeture il vaudra 0 quoi qu'il arrive, et le "
          + "relais sera avecJeton croisé avec presentationsActives. "
          + "avecJeton inclut les bootstraps auto-déclarés — pas une preuve d'identité.",
      presentationsActives: nActives,
      avecJeton: nAvec,
      sansJeton: nSans,
      tronque: nAvec >= PLAFOND_SANS_RANG || nSans >= PLAFOND_SANS_RANG || nActives >= PLAFOND_SANS_RANG,
    };
  } catch { /* best-effort */ }
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
