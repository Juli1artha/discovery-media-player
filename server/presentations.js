// Mode « Présenter » : sessions de présentation live (page synchronisée). Table doc_presentations
// (cf. migration v12324) — écriture service role only. Le présentateur détient un control_token ; on en
// stocke le HASH (sha256) → l'audience peut lire la ligne (Realtime) sans pouvoir piloter.
const crypto = require("crypto");
// Base de données via le contexte injecté (cf. _player-context.js) — aucune adhérence au studio.
// ⚠️ Le contexte est REÇU, pas construit. Ce module ne doit pas savoir d'où il vient : c'est ce
// qui lui permettra de partir dans le dépôt du player sans emporter le studio avec lui.
let PLAYER = null;
function init(ctx) { PLAYER = ctx; _bumpSansDurcissementJusqua = 0; _avertRpcPresence = false; _etatDurcissement = "inconnu"; }

/**
 * L'état OBSERVÉ du durcissement des bootstraps — pas sa configuration.
 *
 * ⚠️ LA CARTE RAPPORTAIT UNE CONFIGURATION, PAS UN COMPORTEMENT, et c'est le second hôte qui l'a
 * nommé : `presenceStrict` pouvait dire « la porte refuse » alors que le contrôle anti-usurpation
 * était désarmé — 0018 absente, ou (avant 0.1.111) un simple hoquet réseau. On a fermé cet écart sur
 * `presenceJetons` en MESURANT plutôt qu'en déclarant, et on l'avait laissé ouvert sur le champ voisin.
 *
 * On ne peut pas sonder la fonction sans l'appeler — elle écrit. Ce qu'on peut rendre, c'est ce que le
 * processus a CONSTATÉ en s'en servant : « degrade » = la dernière tentative a trouvé la signature
 * absente ; « actif » = une tentative a abouti ; « inconnu » = on n'a pas encore essayé, et c'est un
 * état à part entière, pas un feu vert.
 */
function etatDurcissementBootstrap() {
  if (Date.now() < _bumpSansDurcissementJusqua) return "degrade";
  // ⚠️ UN ÉTAT EXPLICITE, PAS UNE COMPARAISON D'INSTANTS. La version précédente comparait le dernier
  // succès au dernier échec — correct sur le fond, mais deux réponses concurrentes qui se terminent
  // dans la MÊME milliseconde rendaient les deux instants égaux, et l'égalité tombait du côté
  // « inconnu » : jamais un faux « actif », mais un faux négatif possible. Le dernier mot observé
  // s'écrit ; il n'a pas à se déduire d'une horloge dont la résolution n'est pas garantie.
  // (Simplification proposée par l'audit externe.)
  //
  // ⚠️ ET L'EXPIRATION NE PROMEUT TOUJOURS PAS. Une preuve NÉGATIVE périmée retombe sur l'ignorance,
  // jamais sur la confiance : c'était le défaut de 0.1.115, et le remède ne doit pas le réintroduire
  // en chemin. Un « oui » n'expire pas — une fonction ne disparaît pas toute seule.
  return _etatDurcissement === "degrade" ? "inconnu" : _etatDurcissement;
}


const enc = encodeURIComponent;
const sha = (s) => crypto.createHash("sha256").update(String(s || "")).digest("hex");
const newToken = (n) => crypto.randomBytes(n).toString("base64url");
// Comparaison CONSTANTE-TEMPS des hashes de jeton (pas de fuite d'information par timing).
const sameHash = (a, b) => {
  const ba = Buffer.from(String(a || ""), "utf8"); const bb = Buffer.from(String(b || ""), "utf8");
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
};
// Le jeton fourni correspond-il au hash stocké ?
const tokenMatches = (token, storedHash) => !!(token && storedHash && sameHash(sha(token), storedHash));

// Crée une session → renvoie { slug (public, dans le lien), control (secret présentateur) }.
// owner = { id, email, name, avatar } (membre authentifié). La CLÉ de propriété est l'EMAIL (issu du JWT
// vérifié) → permet reprise / liste / transfert, y compris vers un membre choisi par email.
const lc = (s) => String(s || "").trim().toLowerCase();
/**
 * ⚠️ LA PURGE NE DOIT PAS DÉPENDRE DE L'OUVERTURE D'UN PANNEAU. Elle ne vivait que dans
 * `listActivePresentations` — c'est-à-dire qu'elle ne tournait que si quelqu'un ouvrait la liste.
 * Le second hôte a eu QUATRE présentations bloquées « actives » pendant TROIS JOURS : personne
 * n'avait ouvert le panneau, donc personne n'avait déclenché le seul mécanisme qui les fermait.
 * Un échec de clôture ne prive de rien qu'on regarde — la purge doit donc s'accrocher à un geste
 * qui arrive de lui-même. Démarrer une présentation en est un : ce sont les présentateurs qui
 * créent les orphelines, et le suivant nettoie celles d'avant.
 *
 * Conditionnée à `active=eq.true&last_seen=lte.seuil` : une session qui vient de battre n'est pas
 * touchée (même garde que la purge du panneau, chantier des écritures conditionnées).
 */
async function purgerPerimees(now) {
  const seuil = new Date(now - STALE_MS).toISOString();
  await PLAYER.db.request(
    `doc_presentations?active=eq.true&last_seen=lte.${enc(seuil)}`,
    { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { active: false, updated_at: new Date(now).toISOString() } },
  ).catch(() => { /* la purge est un service, jamais un préalable */ });
}

async function createPresentation({ docId, fileUrl, fileName, docTitle, presenterName, owner }) {
  if (!fileUrl) throw Object.assign(new Error("doc invalide"), { statusCode: 400 });
  await purgerPerimees(Date.now());
  const slug = newToken(9);     // ~12 chars URL-safe
  const control = newToken(18); // secret pilotage
  const o = owner && typeof owner === "object" ? owner : {};
  const row = {
    slug, control_hash: sha(control), doc_id: docId ? String(docId) : null, file_url: String(fileUrl),
    file_name: fileName || null, doc_title: docTitle || null, presenter_name: (presenterName || "").trim() || null,
    owner_user_id: o.id ? String(o.id) : null, owner_email: lc(o.email) || null, owner_name: (o.name || "").slice(0, 120) || null, owner_avatar: (o.avatar || "").slice(0, 600) || null,
    current_page: 1, active: true, last_seen: new Date().toISOString(),
  };
  await PLAYER.db.request("doc_presentations", { method: "POST", headers: { Prefer: "return=minimal" }, body: [row] });
  return { slug, control };
}

// Reprise : le propriétaire (membre authentifié, email issu du JWT) re-génère un control_token frais →
// il reprend la main depuis n'importe quel onglet/navigateur/appareil ; l'ancien control est invalidé.
async function reclaimPresentation(slug, email) {
  if (!slug || !lc(email)) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!row.owner_email || row.owner_email !== lc(email)) return { ok: false, status: 403 };
  const control = newToken(18);
  // ⚠️ REMETTRE LE RANG À ZÉRO — MAIS SEULEMENT SI LA COLONNE EXISTE. Un jeton de contrôle neuf ouvre
  // un nouveau domaine d'ordre : le compteur du navigateur repart de 1, et sans remise à zéro toutes
  // ses écritures seraient réputées périmées.
  //
  // ⚠️ Et j'ai écrit ce champ sans condition en premier jet, ce qui est exactement le piège que
  // docs/MIGRATIONS.md décrit : PostgREST rejette le PATCH ENTIER si la colonne manque. La reprise
  // aurait cessé de fonctionner chez tout hôte non migré — pas la nouvelle garantie, la reprise.
  const rangDispo = await require("./schema").attendue("rangEcriture");
  // ⚠️ LE PROPRIÉTAIRE DANS LA CONDITION, pas seulement dans la vérification. Entre la lecture et
  // l'écriture, un transfert a pu donner la présentation à quelqu'un d'autre : la reprise de
  // l'ANCIEN propriétaire arrivait quand même, régénérait le jeton, et volait la session au
  // nouveau — précisément ce que le transfert venait d'accorder. Constat du troisième audit.
  const ecrit = await ecrireSiEncoreVrai(
    `doc_presentations?slug=eq.${enc(slug)}&owner_email=eq.${enc(row.owner_email)}`,
    { control_hash: sha(control), active: true, ...(rangDispo ? { write_seq: 0 } : {}), last_seen: new Date().toISOString(), updated_at: new Date().toISOString() },
  );
  if (!ecrit) return { ok: false, status: 409 };
  return { ok: true, slug, control, page: row.current_page || 1, fileUrl: row.file_url, fileName: row.file_name, docTitle: row.doc_title, docId: row.doc_id };
}

// Heartbeat présentateur (control requis) : rafraîchit last_seen → distingue une présentation vivante d'une orpheline.
async function touchPresentation(slug, control) {
  if (!slug) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!tokenMatches(control, row.control_hash)) return { ok: false, status: 403 };
  // ⚠️ LE JETON DANS LA CONDITION : une reprise ailleurs le régénère, une clôture l'annule. Sans
  // ça, le heartbeat d'un ANCIEN onglet maintenait « vivante » une session qui ne lui appartient
  // plus — et l'auto-purge, qui se fie à `last_seen`, ne fermait jamais l'orpheline.
  const ecrit = await ecrireSiEncoreVrai(
    `doc_presentations?slug=eq.${enc(slug)}&control_hash=eq.${sha(control)}`,
    { last_seen: new Date().toISOString() },
  );
  // Un heartbeat refusé dit à l'onglet périmé de s'arrêter — c'est une information, pas une panne.
  return ecrit ? { ok: true } : { ok: false, status: 409 };
}

// Liste des présentations en cours (membre authentifié). Auto-purge : une présentation active dont le
// dernier heartbeat remonte à > STALE_MS (présentateur parti sans clôturer) est marquée inactive.
const STALE_MS = 3 * 60 * 1000;

/**
 * ÉCRIRE SEULEMENT SI LA CONDITION TIENT ENCORE — au moment de l'écriture, pas au moment du contrôle.
 *
 * ⚠️ LE DÉFAUT QUE ÇA FERME. Toutes les écritures de pilotage faisaient : lire la ligne, vérifier le
 * jeton, PATCHER. Entre la vérification et le PATCH, la présentation peut avoir été TERMINÉE — et
 * comme le pilotage écrit « active: true », la requête retardée la ROUVRAIT pour toute l'audience.
 * Le présentateur avait cliqué « Terminer », vu l'écran de fin, et l'audience continuait de suivre.
 * Un second SELECT juste avant le PATCH ne changerait rien : la fenêtre se déplace, elle ne ferme pas.
 *
 * ⚠️ ET LA CONDITION N'EST PAS « active = true », que l'audit prescrivait. Elle casserait un
 * comportement voulu : une présentation devient inactive au bout de trois minutes sans battement
 * (le portable du présentateur a dormi), et sa page suivante DOIT la remettre en ligne — un
 * présentateur anonyme n'a aucun autre moyen de revenir. La bonne condition est celle qui sépare
 * la fin DÉCIDÉE de la péremption CONSTATÉE : terminer ANNULE le jeton de contrôle. On filtre donc
 * sur le jeton, et chaque chemin porte dans sa condition le critère qu'il vérifiait déjà.
 *
 * Zéro ligne touchée = refus. PostgREST le dit en rendant un tableau vide, à condition de demander
 * la représentation — sans quoi on ne saurait pas distinguer « rien à faire » de « rien fait ».
 */
async function ecrireSiEncoreVrai(condition, corps) {
  const lignes = await PLAYER.db.request(condition, {
    method: "PATCH", headers: { Prefer: "return=representation" }, body: corps,
  });
  return Array.isArray(lignes) && lignes.length > 0;
}

/** Le rang, seulement là où la colonne existe — sinon PostgREST rejette le PATCH ENTIER. */
const filtreRang = (rang) => (rang && rang.controle ? `&write_seq=lt.${rang.rang}` : "");
async function listActivePresentations(email) {
  const me = lc(email);
  const rows = await PLAYER.db.request("doc_presentations?active=eq.true&select=slug,doc_id,file_url,file_name,doc_title,presenter_name,owner_email,owner_name,owner_avatar,current_page,last_seen,created_at,updated_at&order=updated_at.desc&limit=100");
  const list = Array.isArray(rows) ? rows : [];
  const now = Date.now();
  const stale = list.filter((r) => now - new Date(r.last_seen || r.updated_at || 0).getTime() > STALE_MS).map((r) => r.slug);
  if (stale.length) {
    // ⚠️ L'INACTIVITÉ DANS LA CONDITION, pas seulement dans le calcul. Entre la lecture de la liste
    // et cette écriture, une présentation « orpheline » a pu envoyer son heartbeat : la purger
    // quand même désactivait une session redevenue vivante, sous les pieds de son présentateur.
    // `lte` sur le seuil : seule une ligne dont last_seen n'a PAS bougé est purgée.
    const seuil = new Date(now - STALE_MS).toISOString();
    await PLAYER.db.request(`doc_presentations?slug=in.(${stale.map((s) => enc(s)).join(",")})&active=eq.true&last_seen=lte.${enc(seuil)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { active: false, updated_at: new Date().toISOString() } }).catch(() => {});
  }
  const live = list.filter((r) => !stale.includes(r.slug));
  return live.map((r) => ({ slug: r.slug, docId: r.doc_id, fileUrl: r.file_url, fileName: r.file_name, docTitle: r.doc_title, presenterName: r.presenter_name, ownerName: r.owner_name, ownerAvatar: r.owner_avatar, currentPage: r.current_page || 1, mine: !!(me && r.owner_email && r.owner_email === me), updatedAt: r.updated_at }));
}

/**
 * Terminer une présentation RÉVOQUE son jeton de contrôle.
 *
 * ⚠️ SANS ÇA, « terminer » ne terminait rien de définitif. Les fonctions de pilotage écrivent
 * « active: true » — c'est voulu, on y revient — et le jeton de contrôle survivait à la clôture. Un
 * second onglet resté ouvert, ou une écriture encore en vol, remettait donc la présentation en ligne
 * pour l'audience alors que le présentateur la croyait close. Le jeton est persisté en localStorage :
 * ce n'était pas une course étroite, c'était une porte ouverte à volonté.
 *
 * ⚠️ POURQUOI RÉVOQUER LE JETON PLUTÔT QUE REFUSER TOUTE ÉCRITURE SUR « active=false » — la règle
 * générale que l'audit proposait. Parce que « active:false » recouvre DEUX situations qui n'ont rien
 * à voir :
 *
 *   1. une fin DÉCIDÉE (ces deux chemins) — plus rien ne doit piloter ;
 *   2. une péremption CONSTATÉE (listActivePresentations, 3 min sans battement) — le portable du
 *      présentateur a dormi, et sa page suivante doit le remettre en ligne. La « résurrection » EST
 *      la reprise.
 *
 * Une règle qui refuse les deux condamnerait un présentateur ANONYME à ne jamais revenir : la
 * reprise exige la propriété, et « present-start » n'exige aucune session. On distingue donc les
 * deux cas par ce qui les sépare vraiment — la décision — plutôt que par l'état qu'ils partagent.
 *
 * Le propriétaire garde « present-reclaim » : reprendre une présentation close est une décision, et
 * elle regénère un jeton frais.
 */
const CLOTURE = { active: false, control_hash: null };

// Clôture sans control_token → utilisée par le panneau « Présentations en direct » pour terminer à distance
// une présentation dont on a perdu l'onglet. Autorisée au PROPRIÉTAIRE (email du JWT) OU à un ADMIN (modération).
async function endPresentationByOwner(slug, email, isAdmin) {
  if (!slug || (!lc(email) && !isAdmin)) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!isAdmin && (!row.owner_email || row.owner_email !== lc(email))) return { ok: false, status: 403 };
  // ⚠️ LE PROPRIÉTAIRE DANS LA CONDITION (l'admin, lui, ferme ce qu'il veut : modération). Une
  // clôture retardée émise par l'ANCIEN propriétaire après un transfert fermait la session du
  // nouveau — le contraire de ce que le transfert venait d'accorder.
  if (isAdmin) {
    await PLAYER.db.request(`doc_presentations?slug=eq.${enc(slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { ...CLOTURE, updated_at: new Date().toISOString() } });
    return { ok: true };
  }
  const ecrit = await ecrireSiEncoreVrai(
    `doc_presentations?slug=eq.${enc(slug)}&owner_email=eq.${enc(row.owner_email)}`,
    { ...CLOTURE, updated_at: new Date().toISOString() },
  );
  return ecrit ? { ok: true } : { ok: false, status: 409 };
}

// Transfert de contrôle : le propriétaire actuel (JWT) désigne un nouveau membre propriétaire (par email).
// Le nouvel owner reprendra la main via reclaimPresentation (control frais) → l'ancien control reste valide
// jusque-là (l'ancien présentateur cesse volontairement de piloter).
async function handoverPresentation(slug, currentEmail, newOwner) {
  const o = newOwner && typeof newOwner === "object" ? newOwner : {};
  if (!slug || !lc(currentEmail) || !lc(o.email)) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!row.owner_email || row.owner_email !== lc(currentEmail)) return { ok: false, status: 403 };
  // ⚠️ Deux transferts concurrents depuis le même propriétaire : le premier écrit gagne, le second
  // ne trouve plus sa ligne — sans condition, il ÉCRASAIT le premier et le document changeait de
  // mains deux fois, dans un ordre que personne n'avait choisi.
  const ecrit = await ecrireSiEncoreVrai(
    `doc_presentations?slug=eq.${enc(slug)}&owner_email=eq.${enc(lc(currentEmail))}`,
    { owner_user_id: o.id ? String(o.id) : null, owner_email: lc(o.email), owner_name: (o.name || "").slice(0, 120) || null, owner_avatar: (o.avatar || "").slice(0, 600) || null, updated_at: new Date().toISOString() },
  );
  return ecrit ? { ok: true, slug } : { ok: false, status: 409 };
}

async function getPresentation(slug) {
  const rows = await PLAYER.db.request(`doc_presentations?slug=eq.${enc(String(slug || ""))}&select=*&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// Pilotage : change la page courante (présentateur uniquement, via control_token).
/**
 * Le rang d'écriture : ce qui fait qu'une écriture périmée n'écrase pas une plus récente.
 *
 * ⚠️ LA FILE DU NAVIGATEUR NE SUFFIT PAS, ET ON L'A ÉCRIT EN LA LIVRANT. Elle garantit UNE seule
 * écriture en vol : elle supprime le désordre qu'on CAUSE. Mais une requête abandonnée par le délai
 * maximal peut très bien être arrivée au serveur — le navigateur cesse de l'attendre, il ne
 * l'annule pas chez nous — et y atterrir APRÈS celle qui l'a remplacée. Ce désordre-là, on le SUBIT.
 *
 * Le rang le ferme : chaque écriture porte le sien, et le serveur refuse un rang qu'il a déjà
 * dépassé. L'ordre ne dépend plus de l'ordre d'arrivée.
 *
 * ⚠️ UN RANG, PAS UN HORODATAGE. Une heure vient d'une horloge, et deux onglets n'ont pas la même.
 * Un rang vient d'un compteur : il ne dit pas QUAND, il dit APRÈS QUOI — la question réellement
 * posée.
 *
 * ⚠️ CE QU'IL COÛTE, ET QUI EST ASSUMÉ. Deux onglets du même présentateur partagent le jeton de
 * contrôle (il est persisté) mais pas le compteur : celui qui a le rang le plus haut gagne, l'autre
 * est refusé en silence. Deux onglets pilotant la même présentation sont déjà incohérents — ils se
 * disputeraient la page de toute façon — mais le refus est désormais net plutôt qu'aléatoire.
 *
 * ⚠️ SANS LA COLONNE, ON NE CONTRÔLE PLUS RIEN — ET C'EST LE BON REPLI. Refuser toutes les écritures
 * ferait d'une migration non appliquée une panne totale de pilotage. On revient au comportement
 * d'avant (dernier arrivé gagne), en le signalant une fois.
 */
async function rangAccepte(row, seq) {
  const rang = Number(seq);
  if (!Number.isFinite(rang) || rang <= 0) return { controle: false };   // client plus ancien : pas de rang
  const dispo = await require("./schema").attendue("rangEcriture");
  if (!dispo) return { controle: false };
  if (rang <= Number(row.write_seq || 0)) return { controle: true, perime: true };
  // ⚠️ ON REND LE RANG, PAS UN OBJET TOUT FAIT. La première version rendait « { write_seq: rang } »,
  // répandu plus loin par « ...(rang.champ || {}) » : c'était sûr, et illisible — le lecteur du PATCH
  // ne voyait pas que ce champ est conditionnel. La garde des colonnes migrées l'a signalé, et elle
  // avait raison sur le fond même si le code était correct : une condition qui ne se voit pas au
  // point d'écriture finit par être recopiée sans elle.
  return { controle: true, perime: false, rang };
}

async function setPage(slug, control, page, seq) {
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!tokenMatches(control, row.control_hash)) return { ok: false, status: 403 };
  const rang = await rangAccepte(row, seq);
  // ⚠️ « Périmé » n'est pas une erreur : c'est le système qui fonctionne. On répond ok pour que le
  // navigateur n'affiche rien — la page qu'il voulait écrire est déjà dépassée par une plus récente.
  if (rang.perime) return { ok: true, perime: true };
  const p = Math.max(1, Math.trunc(Number(page) || 1));
  // Le jeton DANS la condition : si la présentation a été terminée entre-temps, il a été annulé
  // et cette écriture ne trouve plus sa ligne. Le rang aussi, pour que deux écritures concurrentes
  // ne puissent pas s'inverser — la comparaison et l'écriture deviennent le même geste.
  const ecrit = await ecrireSiEncoreVrai(
    `doc_presentations?slug=eq.${enc(slug)}&control_hash=eq.${sha(control)}${filtreRang(rang)}`,
    { current_page: p, active: true, last_seen: new Date().toISOString(), updated_at: new Date().toISOString(), ...(rang.controle ? { write_seq: rang.rang } : {}) },
  );
  // Refus SILENCIEUX, comme un rang périmé : le navigateur n'a rien à afficher, la page qu'il
  // voulait écrire n'a simplement plus de présentation où aller.
  return ecrit ? { ok: true } : { ok: true, perime: true };
}

// Fin de présentation → l'audience voit « terminée ».
async function endPresentation(slug, control) {
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (!tokenMatches(control, row.control_hash)) return { ok: false, status: 403 };
  // ⚠️ CONDITIONNÉ AU JETON LUI AUSSI, et pas seulement par symétrie : entre la vérification et
  // l'écriture, le propriétaire a pu REPRENDRE la main depuis un autre appareil, ce qui régénère
  // le jeton. Une fin retardée émise avec l'ancien fermerait alors la session neuve — le contraire
  // de ce que la reprise vient d'obtenir.
  await ecrireSiEncoreVrai(
    `doc_presentations?slug=eq.${enc(slug)}&control_hash=eq.${sha(control)}`,
    { ...CLOTURE, updated_at: new Date().toISOString() },
  );
  // Terminer est IDEMPOTENT : ne pas trouver de ligne veut dire « déjà terminée, ou reprise
  // ailleurs ». Dans les deux cas l'appelant n'a plus rien à faire, et un échec l'inviterait à
  // réessayer une action qui n'a plus d'objet.
  return { ok: true };
}

// Chat de présentation (historisé) : ajout d'un message (+ réponse citée) + liste de l'historique.
// Pièce jointe : URL d'upload SIGNÉE (service role) → le client PUT directement dans le bucket. Type/taille
// validés par le bucket (image/*+pdf, ≤10 Mo). L'URL publique finale est renvoyée pour attacher au message.
const ATT_KINDS = { "image/png": "image", "image/jpeg": "image", "image/webp": "image", "image/gif": "image", "application/pdf": "pdf" };
const BUCKET_PIECES = "present-attachments";

// ⚠️ LE CHEMIN CANONIQUE D'UNE PIÈCE JOINTE — UNE SEULE FONCTION POUR L'ÉCRITURE ET LA
// SUPPRESSION (P1 du huitième audit). Rend le chemin RELATIF au bucket (« <slug>/fichier ») si,
// et seulement si, l'URL publique désigne EXACTEMENT le dossier du slug courant, sans traversée.
// Refuse tout le reste — `null`. La barrière est la même des deux côtés : un `startsWith` laissait
// passer `…/present-attachments/../autre-bucket/x`, inerte tant que l'URL n'était que lue, devenu
// une primitive de suppression avec la rétention.
//
// Refusés : `.`/`..` en segment, leurs formes encodées (%2e), les slash/antislash encodés
// (%2f/%5c), l'antislash brut, l'octet nul — et tout premier segment différent du slug.
function cheminPieceJointe(url, slug, base) {
  const prefixe = `${String(base || "")}/storage/v1/object/public/${BUCKET_PIECES}/`;
  const brut = String(url || "");
  if (!brut.startsWith(prefixe)) return null;
  const chemin = brut.slice(prefixe.length).split("?")[0];
  if (/%2e|%2f|%5c|\\|\0/i.test(chemin)) return null;          // formes encodées + antislash + nul
  if (chemin.includes("\u0000")) return null;
  const segments = chemin.split("/");
  if (segments.length < 2) return null;                          // il faut « <slug>/<fichier> »
  if (segments[0] !== String(slug)) return null;                 // premier segment = slug courant
  for (const seg of segments) {
    if (seg === "" || seg === "." || seg === "..") return null;  // pas de segment vide ni de point
    if (!/^[A-Za-z0-9._-]+$/.test(seg)) return null;             // même alphabet que createUploadUrl
  }
  return chemin;
}
/**
 * UNE PRÉSENTATION TERMINÉE DEVIENT UNE ARCHIVE : on la relit, on ne l'écrit plus.
 *
 * ⚠️ « TERMINÉE » VEUT DIRE DÉCIDÉE, PAS PÉRIMÉE — la distinction qui traverse tout ce module.
 * Une présentation devient inactive après trois minutes sans battement, et son présentateur doit
 * pouvoir revenir ; refuser le chat dans ce cas couperait la parole à une salle pendant que
 * l'orateur rebranche son portable. Terminer, en revanche, ANNULE le jeton de contrôle : c'est
 * cette trace-là qui distingue une fin d'une somnolence, et c'est elle qu'on lit.
 *
 * ⚠️ LA LECTURE RESTE OUVERTE, et c'est un choix de produit, pas un oubli. Ce qui s'est dit
 * pendant une présentation a de la valeur après : on relit une question, on retrouve un lien.
 * Le risque n'est pas dans la lecture, il est dans l'écriture — un message ajouté après coup dans
 * un fil que plus personne ne surveille, une pièce jointe déposée dans le bucket d'une session
 * close. On ferme donc les sept portes qui ÉCRIVENT, et aucune de celles qui lisent.
 */
async function estArchive(slug) {
  const row = await getPresentation(slug);
  // Pas de présentation du tout : ce n'est pas une archive, et l'appelant a ses propres 404.
  if (!row) return false;
  // ⚠️ LES DEUX FAITS, PAS UN SEUL — et le premier jet ne prenait que le jeton annulé. Une ligne
  // dont la colonne n'est simplement pas remontée aurait alors été prise pour une session close :
  // un champ ABSENT et un champ NUL sont la même chose une fois passés par JSON, et cette
  // confusion aurait fermé le chat de présentations parfaitement vivantes. Six essais l'ont dit
  // tout de suite, ce qui est exactement leur métier.
  //
  // Terminer écrit les deux ensemble (active: false ET jeton annulé) ; une péremption n'écrit que
  // le premier. Exiger les deux distingue donc la fin décidée de la somnolence, sans dépendre
  // d'une absence.
  return row.active === false && row.control_hash == null;
}

/** Refus commun, pour que les sept routes répondent la même chose. */
const REFUS_ARCHIVE = { ok: false, status: 409, error: "ended" };

async function createUploadUrl(slug, name, type) {
  if (await estArchive(slug)) return REFUS_ARCHIVE;

  // ⚠️ `Object.hasOwn` et pas une simple lecture : un objet littéral hérite de `constructor`,
  // `toString`, `valueOf`, `__proto__`… `ATT_KINDS["constructor"]` rend une FONCTION, donc une
  // valeur vraie — la garde juste en dessous laissait alors passer un type qui n'a jamais été
  // autorisé, et signait une URL d'envoi pour lui. Le type est fourni par l'appelant, sur une
  // action publique. Signalé par un hôte tiers qui venait de trouver la même forme chez lui.
  const demande = String(type || "").toLowerCase();
  const kind = Object.hasOwn(ATT_KINDS, demande) ? ATT_KINDS[demande] : null;
  if (!kind || !slug) return { ok: false, status: 400 };
  const safe = (String(name || "fichier").replace(/[^a-zA-Z0-9._-]/g, "_").slice(-60)) || "fichier";
  const path = `${String(slug).replace(/[^a-zA-Z0-9._-]/g, "")}/${Date.now()}-${crypto.randomBytes(4).toString("hex")}-${safe}`;

  // ⚠️ La signature appartient à l'HÔTE : c'est lui qui détient la clé, pas le cœur. Un hôte qui
  // ne fournit pas cette capacité voit la pièce jointe refusée — et prévenue. Le refus silencieux
  // serait pire : une pièce jointe qui ne part jamais, sans que personne sache que la capacité
  // manque.
  if (!PLAYER.storage || typeof PLAYER.storage.signUpload !== "function") {
    try { PLAYER.errors.capture(new Error("storage.signUpload absent du contexte : les pièces jointes de chat sont indisponibles"), {}); } catch { /* jamais bloquant */ }
    return { ok: false, status: 501 };
  }
  const signe = await PLAYER.storage.signUpload("present-attachments", path);
  if (!signe || !signe.token) return { ok: false, status: 502 };
  return { ok: true, path, token: signe.token, kind, publicUrl: signe.publicUrl };
}

/**
 * Les champs d'un message qui ont le droit de sortir du serveur.
 *
 * ⚠️ LISTE BLANCHE, jamais une liste noire. `author_hash` est l'empreinte du jeton qui autorise
 * à éditer et supprimer ce message : le diffuser à toute l'audience donnerait à chacun le droit
 * de réécrire les messages des autres. Une ligne de table renvoyée telle quelle emporterait ce
 * champ sans que personne ne le remarque — d'où la projection explicite, ici et nulle part
 * ailleurs. C'est le même jeu de champs que celui servi à l'historique.
 */
const CHAMPS_PUBLICS = [
  "id", "author_name", "author_avatar", "is_presenter", "is_member",
  "body", "attachment", "reactions", "reply_to", "reply_name", "reply_text",
  "deleted", "edited", "created_at",
  // Rang de changement (migration 0016) : le client garde le plus grand vu et le renvoie pour relire
  // en différentiel. Absent chez un hôte non migré → le client reste en relecture complète.
  "mod_seq",
];

/**
 * IDENTITÉ PUBLIQUE D'UN AUTEUR — opaque, stable, et dérivée de ce qui AUTORISE déjà.
 *
 * ⚠️ `author_email` ÉTAIT DANS CETTE LISTE. Chaque message rendu à n'importe quel participant
 * portait donc l'adresse de son auteur, et nos audiences sont des visiteurs anonymes externes :
 * il suffisait d'ouvrir l'historique du chat pour repartir avec les adresses de toute l'équipe.
 *
 * ⚠️ CE QUI REMPLACE N'EST PAS UN PSEUDONYME TIRÉ AU SORT, mais l'empreinte du JETON D'AUTEUR —
 * celui-là même qui autorise à modifier et supprimer. Deux conséquences, toutes deux voulues :
 *
 *   • aucun secret d'instance n'est nécessaire. Hacher une adresse sans sel ne protège rien (le
 *     domaine est connu, les prénoms se devinent) ; ici l'entrée est un jeton tiré au sort ;
 *   • « c'est mon message » DIT ENFIN LA MÊME CHOSE QUE « j'ai le droit d'y toucher ». L'ancien
 *     `isMine` comparait les adresses alors que l'édition n'a jamais regardé que le jeton : un
 *     membre sur un second navigateur voyait un bouton « Modifier » qui lui répondait 403.
 *
 * Un tour de hachage de plus que la valeur stockée : ce qui sort n'est jamais le matériel gardé
 * en base, même si le connaître ne suffirait pas à usurper.
 */
const refAuteur = (hash) => (hash ? sha("ref:" + hash).slice(0, 16) : null);

/**
 * ⚠️ L'IDENTITÉ D'UN RÉACTEUR SE DÉRIVE D'UN SECRET, ELLE NE SE DÉCLARE PAS.
 *
 * Le client envoyait `reactor: MOIREF` — or MOIREF est PUBLIC : chaque participant reçoit les refs
 * de tous les autres dans le tableau des réactions (il en a besoin pour dessiner « j'ai réagi »).
 * N'importe qui pouvait donc copier le ref d'un autre et poser ou retirer SES réactions. Constat
 * du troisième audit, vérifié : les refs transitent en clair dans `reactionsPubliques`.
 *
 * Le jeton d'auteur, lui, ne quitte jamais le navigateur qui l'a tiré. La dérivation est la même
 * que côté client (`referenceAuteur` dans src/live.ts) : sha("ref:" + sha(jeton)), tronqué à 16 —
 * si les deux divergent, « mes » réactions cessent de s'afficher comme miennes, et l'essai qui
 * confronte les deux moteurs le dira.
 */
const reacteurDepuisJeton = (jeton) => (jeton ? refAuteur(sha(String(jeton))) : null);

/**
 * ⚠️ LES ANCIENNES RÉACTIONS PORTENT DES ADRESSES, et aucune migration ne les réécrira : le
 * client stockait `email || nom` comme identité de réacteur. On garde le COMPTE — la pastille
 * affiche toujours « 👍 3 » — en remplaçant chaque identité illisible par un jeton de place qui
 * ne correspond à personne. Un participant ne se reconnaît plus dans ses vieilles réactions ;
 * personne ne lit celles des autres. Le stockage n'est pas touché : les valeurs héritées
 * disparaissent d'elles-mêmes au premier basculement.
 */
function reactionsPubliques(brut) {
  if (!brut || typeof brut !== "object" || Array.isArray(brut)) return brut;
  const out = Object.create(null);
  for (const [emoji, liste] of Object.entries(brut)) {
    if (!Array.isArray(liste)) continue;
    out[emoji] = liste.map((v, i) => (/^[0-9a-f]{16}$/.test(String(v)) ? String(v) : `ancien-${i}`));
  }
  return out;
}

function messagePublic(row) {
  if (!row || typeof row !== "object") return null;
  // Les clés viennent d'une liste blanche interne, mais l'objet est nu quand même : la règle se
  // relit sans avoir à vérifier d'où vient chaque clé.
  const out = Object.create(null);
  for (const c of CHAMPS_PUBLICS) if (c in row) out[c] = row[c];
  // ⚠️ LA CEINTURE : une ligne supprimée sort VIDE, quoi que porte encore la base. Les courses
  // d'avant ce correctif — et les lignes historiques qu'elles ont laissées — peuvent avoir gardé
  // un corps, une pièce jointe ou une citation sous deleted=true : la projection est le dernier
  // endroit qui peut refuser de les resservir, et le seul qui couvre AUSSI le passé.
  if (out.deleted) { out.body = ""; out.attachment = null; out.reactions = {}; out.reply_text = null; out.reply_name = null; }
  if ("reactions" in out) out.reactions = reactionsPubliques(out.reactions);
  // Dérivé, jamais recopié : `author_hash` est lu pour ça et ne sort jamais tel quel.
  if ("author_hash" in row) out.author_ref = refAuteur(row.author_hash);
  // ⚠️ LA GARDE CATÉGORIELLE N'EST PAS ICI, ET LA RAISON EST STRUCTURELLE.
  //
  // La liste blanche s'exécute AVANT : elle a déjà retiré tout champ inconnu. `publier()` n'y
  // verrait donc qu'un jeu de champs connus, et aucune mutation ne peut la faire tomber à cet
  // endroit — la redondance n'est pas une ceinture, c'est une garde qu'on ne peut pas éprouver.
  //
  // ⚠️ Et le cas qu'on écrirait pour forcer le rouge serait faux : `author_name` est CHOISI par le
  // participant. Quelqu'un qui se nomme « lea@exemple.fr » verrait le chat tomber — le piège de
  // `body`, rencontré une seconde fois au même endroit.
  //
  // Sa place est aux sorties SANS liste blanche : charge de présence, statistiques, aperçu d'un
  // partage — là où un champ ajouté demain sort sans que personne ne l'ait décidé. C'est là qu'une
  // mutation pourra rougir, et donc là qu'elle sera branchée.
  return out;
}

/** Renvoie la ligne telle qu'elle est après écriture — sans jamais renvoyer plus que le public. */
function premierPublic(reponse) {
  const row = Array.isArray(reponse) ? reponse[0] : reponse;
  return messagePublic(row);
}

async function addMessage(slug, { name, email, avatar, isPresenter, isMember, body, replyTo, replyName, replyText, authorToken, attachment, clientKey }) {
  if (await estArchive(slug)) return REFUS_ARCHIVE;
  const b = String(body || "").trim().slice(0, 2000);
  // ⚠️ Pas de normalisation ici : `config.supabaseUrl` arrive SANS barre finale, c'est le
  // contrat de l'adaptateur. En rajouter une deuxième couche, c'est deux endroits qui décident —
  // et c'est comme ça que `.replace(/\/+$/, "")` s'est retrouvé à cinq exemplaires dans ce dépôt.
  const base = String((PLAYER.config && PLAYER.config.supabaseUrl) || "");
  let att = null;
  if (attachment && typeof attachment === "object" && attachment.url) {
    const chemin = cheminPieceJointe(attachment.url, slug, base);
    if (chemin) {
      // On stocke le CHEMIN validé et on RECONSTRUIT l'URL publique depuis lui — jamais l'URL
      // telle que le client l'a envoyée. Deux barrières : ce chemin est revalidé à la suppression.
      att = {
        path: chemin,
        url: `${base}/storage/v1/object/public/${BUCKET_PIECES}/${chemin}`,
        name: String(attachment.name || "").slice(0, 120),
        type: String(attachment.type || "").slice(0, 60),
        kind: attachment.kind === "pdf" ? "pdf" : "image",
      };
    }
  }
  if ((!b && !att) || !slug) return { ok: false, status: 400 };
  const rt = Number.isFinite(+replyTo) ? Math.trunc(+replyTo) : null;
  const row = {
    slug: String(slug), author_name: (name || "").trim().slice(0, 80) || null,
    author_email: (email || "").trim().toLowerCase().slice(0, 160) || null,
    author_avatar: (avatar || "").slice(0, 600) || null,
    is_presenter: !!isPresenter, is_member: !!isMember, body: b, attachment: att,
    author_hash: authorToken ? sha(authorToken) : null,
    reply_to: rt, reply_name: rt ? ((replyName || "").slice(0, 80) || null) : null, reply_text: rt ? ((replyText || "").slice(0, 140) || null) : null,
  };
  // ⚠️ LA CLÉ N'EST ÉCRITE QUE SI LA COLONNE EXISTE. PostgREST rejette le POST ENTIER sur une
  // colonne inconnue : chez un hôte non migré, ce n'est pas l'idempotence qu'on perdrait, c'est
  // l'envoi de messages. Même piège que le rang d'écriture, même sonde.
  const cle = String(clientKey || "").slice(0, 80);
  if (cle && await require("./schema").attendue("envoiUnique")) {
    row.client_key = cle;
  }

  // `return=representation` : c'est la ligne écrite qui part ensuite en diffusion vers l'audience.
  // Sans elle, l'émetteur devrait deviner l'`id` et la date attribués par la base.
  // ⚠️ UN REFUS D'UNICITÉ N'EST PAS UNE ERREUR, C'EST UNE CONFIRMATION. La contrainte dit « ce
  // message est déjà là » : le remonter au participant remplacerait « deux messages » par « une
  // erreur », ce qui n'est pas mieux. On relit donc la ligne déjà écrite et on la rend comme si
  // l'envoi venait de réussir — ce qu'il a fait, la première fois.
  try {
    const cree = await PLAYER.db.request("doc_presentation_messages?select=*", { method: "POST", headers: { Prefer: "return=representation" }, body: [row] });
    return { ok: true, message: premierPublic(cree) };
  } catch (erreur) {
    // ⚠️ LA GARDE DES ÉCRITURES MUETTES A REFUSÉ CE BLOC, et elle avait raison de le faire : un
    // `try` autour d'une écriture doit dire quelque chose. Ici le silence était volontaire — un 409
    // attendu n'est pas un incident — mais rien ne distinguait « je sais ce que je rattrape » de
    // « j'avale tout ». On le dit donc : ce qui n'est pas le conflit attendu remonte, et le conflit
    // attendu est journalisé une fois, en clair, parce qu'un renvoi fréquent est une information.
    const conflit = cle && String((erreur && erreur.message) || "").includes("409");
    if (!conflit) throw erreur;
    try { PLAYER.errors.capture(new Error("message déjà enregistré (renvoi) : " + String(slug)), { route: "present-chat", benin: true }); } catch { /* jamais bloquant */ }
    const deja = await PLAYER.db.request(
      `doc_presentation_messages?slug=eq.${enc(String(slug))}&client_key=eq.${enc(cle)}&select=*&limit=1`);
    const ligne = Array.isArray(deja) && deja[0];
    // ⚠️ Si la relecture ne trouve rien, on ne prétend pas : le 409 venait d'autre chose, et le
    // taire ferait croire à un envoi réussi qui n'a pas eu lieu.
    if (!ligne) throw erreur;
    return { ok: true, message: messagePublic(ligne), deja: true };
  }
}

/**
 * ⚠️ L'HISTORIQUE PASSE MAINTENANT PAR LA PROJECTION, et il ne le faisait pas. Il rendait les
 * lignes TELLES QUELLES, en comptant sur la seule liste du `select` pour ne rien laisser filer.
 * Ça tenait tant que la liste ne contenait que du public — puis la référence d'auteur a exigé de
 * lire `author_hash`, et cette lecture serait ressortie intacte vers toute l'audience.
 *
 * Trouvé par l'essai écrit pour le correctif, avant le premier envoi : deux protections pour la
 * même chose — un `select` étroit et une projection — dont une seule était appliquée ici. Une
 * garde qui dépend de ce qu'on n'a pas demandé cède au premier champ qu'on demande.
 */
const CHAMPS_MSG = "id,author_name,author_avatar,author_hash,is_presenter,is_member,body,attachment,reactions,reply_to,reply_name,reply_text,deleted,edited,created_at";

async function listMessages(slug, { after } = {}) {
  const s = enc(String(slug || ""));
  // Le chat différentiel repose sur la colonne `seq` (migration 0016), bumpée à CHAQUE écriture. On la
  // sonde : présente → différentiel possible ; absente (hôte non migré) → on sert les 300 derniers et
  // on n'ajoute pas `seq` au select (PostgREST rejetterait la requête ENTIÈRE sur une colonne inconnue).
  const seqDispo = await require("./schema").attendue("chatDifferentiel");

  // ⚠️ DIFFÉRENTIEL : le client donne le plus grand `mod_seq` déjà vu ; on ne rend QUE ce qui a changé
  // depuis — nouveaux messages ET anciens mutés (réaction, édition, suppression), le trigger ayant
  // avancé leur `mod_seq`. En ordre de `mod_seq` : le client fusionne par id (addMsg/updateMsg), l'ordre
  // d'affichage tenant à created_at qu'il porte déjà. `limit=300` borne un rattrapage après longue
  // coupure — le curseur avance, le signal suivant prend la suite.
  if (after != null && seqDispo) {
    const curseur = Math.max(0, Math.trunc(Number(after)) || 0);
    const rows = await PLAYER.db.request(`doc_presentation_messages?slug=eq.${s}&mod_seq=gt.${curseur}&select=${CHAMPS_MSG},mod_seq&order=mod_seq.asc&limit=300`);
    return Array.isArray(rows) ? rows.map(messagePublic) : [];
  }

  // ⚠️ CHARGE INITIALE (ou hôte non migré) : LES 300 PLUS RÉCENTS, PAS LES 300 PLUS ANCIENS (P1). Avec
  // `asc&limit=300`, au 301e message les nouveaux ne revenaient JAMAIS à ceux qui relisaient — seul
  // l'auteur, par la réponse du POST. On trie `desc` (id départage created_at à la ms) puis on REND en
  // ordre chronologique. On renvoie `mod_seq` quand il est là : c'est ce qui amorce le curseur du client.
  const select = seqDispo ? `${CHAMPS_MSG},mod_seq` : CHAMPS_MSG;
  const rows = await PLAYER.db.request(`doc_presentation_messages?slug=eq.${s}&select=${select}&order=created_at.desc,id.desc&limit=300`);
  return Array.isArray(rows) ? rows.slice().reverse().map(messagePublic) : [];
}

// Éditer son message (jeton d'auteur requis). Ne touche pas aux messages supprimés.
async function editMessage(slug, msgId, authorToken, body) {
  if (await estArchive(slug)) return REFUS_ARCHIVE;
  const id = Math.trunc(+msgId); const b = String(body || "").trim().slice(0, 2000);
  if (!id || !b || !authorToken) return { ok: false, status: 400 };
  const rows = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&slug=eq.${enc(String(slug || ""))}&select=author_hash,deleted&limit=1`);
  const m = Array.isArray(rows) && rows[0]; if (!m || m.deleted) return { ok: false, status: 404 };
  if (!m.author_hash || m.author_hash !== sha(authorToken)) return { ok: false, status: 403 };
  // ⚠️ CE QUI A ÉTÉ VÉRIFIÉ VOYAGE DANS LA CONDITION. Une suppression entre la lecture et
  // l'écriture vidait le message — et l'édition retardée RÉÉCRIVAIT le texte dans une ligne
  // marquée supprimée : effacé à l'écran, ressuscité dans le JSON. Cinquième audit, P1-3.
  // `deleted=eq.false` fait de « pas supprimé » une propriété de l'ÉCRITURE ; `author_hash` et
  // `slug` par cohérence — l'écriture ne repose plus sur rien qu'elle n'exige elle-même.
  const maj = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&slug=eq.${enc(String(slug || ""))}&author_hash=eq.${sha(authorToken)}&deleted=eq.false&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { body: b, edited: true } });
  if (!Array.isArray(maj) || !maj.length) return { ok: false, status: 409 };
  return { ok: true, message: premierPublic(maj) };
}

// Supprimer (soft) : l'auteur (jeton) OU le présentateur (control_token de la présentation).
async function deleteMessage(slug, msgId, { authorToken, control }) {
  if (await estArchive(slug)) return REFUS_ARCHIVE;
  const id = Math.trunc(+msgId);
  if (!id) return { ok: false, status: 400 };
  const rows = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&slug=eq.${enc(String(slug || ""))}&select=author_hash&limit=1`);
  const m = Array.isArray(rows) && rows[0]; if (!m) return { ok: false, status: 404 };
  const byAuthor = tokenMatches(authorToken, m.author_hash);
  let byPresenter = false;
  if (!byAuthor && control) { const pres = await getPresentation(slug); byPresenter = !!(pres && tokenMatches(control, pres.control_hash)); }
  if (!byAuthor && !byPresenter) return { ok: false, status: 403 };
  // ⚠️ Par l'AUTEUR : son hash dans la condition — l'écriture n'exige que ce qu'elle a vérifié.
  // Par le PRÉSENTATEUR : le jeton vit dans une AUTRE table, aucun filtre PostgREST ne peut le
  // porter — la fenêtre résiduelle (un ex-présentateur modère dans la seconde où on lui reprend
  // la main) est assumée : elle ne rend qu'un droit qu'il avait légitimement l'instant d'avant.
  // `deleted=eq.false` partout : supprimer deux fois est IDEMPOTENT — zéro ligne veut dire
  // « déjà supprimé », et c'est l'état que l'appelant voulait. `reply_text`/`reply_name` partent
  // aussi : un message supprimé ne doit pas continuer de citer ce qu'il citait.
  const cond = byAuthor ? `&author_hash=eq.${sha(authorToken)}` : "";
  const maj = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&slug=eq.${enc(String(slug || ""))}${cond}&deleted=eq.false&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { deleted: true, body: "", reactions: {}, attachment: null, reply_text: null, reply_name: null } });
  if (!Array.isArray(maj) || !maj.length) return { ok: true, deja: true };
  return { ok: true, message: premierPublic(maj) };
}

// Verrouiller / déverrouiller le chat (présentateur uniquement).
async function setChatLock(slug, control, locked) {
  if (await estArchive(slug)) return REFUS_ARCHIVE;
  const pres = await getPresentation(slug);
  if (!pres) return { ok: false, status: 404 };
  if (!tokenMatches(control, pres.control_hash)) return { ok: false, status: 403 };
  // Le jeton dans la condition : un verrou posé APRÈS une clôture ou une reprise ailleurs ne
  // trouve plus sa ligne — il ne s'applique pas à une session qui n'est plus la sienne.
  const ecrit = await ecrireSiEncoreVrai(
    `doc_presentations?slug=eq.${enc(String(slug || ""))}&control_hash=eq.${sha(control)}`,
    { chat_locked: !!locked },
  );
  return ecrit ? { ok: true } : { ok: false, status: 409 };
}

// Réaction emoji (toggle) : le participant (identifié par email ou nom) ajoute/retire un emoji sur un message.
/**
 * ⚠️ ON POSE UN ÉTAT, ON NE BASCULE PLUS — et la différence est ce qui rend l'opération IDEMPOTENTE.
 *
 * « Basculer » n'a de sens qu'une fois : un renvoi réseau, un double-clic, une reprise de requête,
 * et la réaction que le participant vient d'ajouter disparaît. Il ne voit aucune erreur — il voit
 * son émoji s'allumer puis s'éteindre, et il recommence, ce qui rebascule encore.
 *
 * L'appelant sait ce qu'il VEUT (`etat`), pas ce qu'il faut inverser. Rejouer la même intention
 * deux fois donne le même résultat qu'une fois, ce qui est exactement la propriété qu'un réseau
 * peu fiable exige. Constat P10 de l'audit.
 *
 * ⚠️ Compatibilité : `etat` absent = ancien client, on bascule comme avant. Un client à jour ne
 * repasse jamais par là ; un ancien garde son comportement plutôt que de perdre la fonction.
 */
async function toggleReaction(slug, msgId, emoji, reactor, etat) {
  if (await estArchive(slug)) return REFUS_ARCHIVE;
  const id = Math.trunc(+msgId); const e = String(emoji || "").slice(0, 8); const who = String(reactor || "").slice(0, 160).toLowerCase();
  if (!id || !e || !who) return { ok: false, status: 400 };
  // ⚠️ Une réaction est un EMOJI. Refuser tout ce qui ressemble à un identifiant ferme la porte à
  // la source, en plus de l'objet sans prototype : `toString` stocké resterait affiché aux
  // participants comme une réaction, ce qui est absurde même sans être dangereux. Deux barrières,
  // parce que la seconde protège le jour où quelqu'un lève le plafond de longueur.
  if (/[A-Za-z_$]/.test(e)) return { ok: false, status: 400 };
  // ⚠️ LE RANG N'EST DEMANDÉ QUE LÀ OÙ IL EXISTE — sélectionner une colonne absente fait échouer
  // la LECTURE entière chez un hôte non migré, et ce serait les réactions qu'on casserait.
  const ordonne = await require("./schema").attendue("reactionsOrdonnees");
  const rows = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&slug=eq.${enc(String(slug || ""))}&select=${ordonne ? "reactions,reactions_seq,deleted" : "reactions,deleted"}&limit=1`);
  // ⚠️ LE NOM DE PROPRIÉTÉ ÉCRIT ICI VIENT DU CLIENT — et la garde posée en 0.1.2 ne couvrait que
  // les LECTURES. `Object.hasOwn` empêchait de LIRE `constructor` ; rien n'empêchait de l'ÉCRIRE.
  //
  // Le plafond de 8 caractères bloquait le pire par accident : `__proto__` (9) et `constructor`
  // (11) sont tronqués en clés inoffensives. Mais `toString` (8) et `valueOf` (7) passaient, et
  // devenaient des propriétés PROPRES de l'objet stocké — masquant celles du prototype pour tout
  // consommateur, y compris le navigateur qui itère cet objet pour dessiner les réactions.
  //
  // ⚠️ Et cette protection accidentelle est fragile : les emojis composés (famille, drapeaux
  // régionaux, séquences ZWJ) dépassent 8 caractères. Le jour où quelqu'un lèvera le plafond pour
  // les accepter — un changement d'apparence anodin — `__proto__` et `constructor` passeront avec.
  //
  // Un objet SANS prototype retire la classe entière : il n'y a plus rien à masquer ni à
  // atteindre, quelle que soit la clé et quel que soit le plafond.
  // ⚠️ LIRE-MODIFIER-RÉÉCRIRE PERD DES ÉCRITURES : deux participants qui réagissent dans la même
  // seconde lisent le même JSON, et la seconde réécriture emporte la première — une réaction
  // disparaît, sans erreur nulle part. Même remède que le pilotage (0002) : l'écriture porte le
  // rang qu'elle a LU, la base ne l'accepte que s'il n'a pas bougé, sinon on relit et on rejoue.
  // Trois rejeux suffisent : chaque tour, au moins UN écrivain gagne — l'attente est bornée par le
  // nombre de concurrents réels, pas par la malchance.
  let lu = rows;
  for (let essai = 0; essai < 4; essai += 1) {
    // ⚠️ Un message supprimé PENDANT la boucle : on s'arrête — réagir à un message effacé le
    // ferait revivre dans le tableau des réactions. Et `deleted=eq.false` dans la condition
    // d'écriture ferme la course entre cette lecture et le PATCH.
    if (Array.isArray(lu) && lu[0] && lu[0].deleted) return { ok: false, status: 404 };
    const brut = (Array.isArray(lu) && lu[0] && lu[0].reactions && typeof lu[0].reactions === "object" && !Array.isArray(lu[0].reactions)) ? lu[0].reactions : {};
    const rang = ordonne ? Math.trunc(Number((Array.isArray(lu) && lu[0] && lu[0].reactions_seq) || 0)) : 0;
    // Objet NU déclaré tel quel : la garde statique des écritures indexées reconnaît la
    // déclaration, pas un voisinage — et c'est elle qui a refusé la première forme de cette boucle.
    const cur = Object.create(null);
    Object.assign(cur, brut);
    const arr = Array.isArray(cur[e]) ? cur[e] : [];
    const i = arr.indexOf(who);
    const veut = etat === undefined || etat === null ? (i < 0) : !!etat;
    if (veut && i < 0) arr.push(who);
    if (!veut && i >= 0) arr.splice(i, 1);
    if (arr.length) cur[e] = arr; else delete cur[e];
    const condition = (ordonne ? `&reactions_seq=eq.${rang}` : "") + "&deleted=eq.false";
    const maj = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}${condition}&select=*`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: { reactions: cur, ...(ordonne ? { reactions_seq: rang + 1 } : {}) } });
    if (Array.isArray(maj) && maj.length) return { ok: true, message: premierPublic(maj) };
    // Hôte non migré (pas de rang) : zéro ligne ne peut venir que de `deleted` — le message est
    // parti pendant qu'on écrivait. Pas de rejeu qui le ferait revivre.
    if (!ordonne) return { ok: false, status: 404 };
    // Rang dépassé : quelqu'un a écrit entre notre lecture et notre écriture. On relit, on rejoue.
    lu = await PLAYER.db.request(`doc_presentation_messages?id=eq.${id}&slug=eq.${enc(String(slug || ""))}&select=reactions,reactions_seq,deleted&limit=1`);
  }
  // Quatre tours perdus : plus de concurrents que de raisons d'attendre. Un refus net vaut mieux
  // qu'une écriture qui écraserait ce que les gagnants viennent de poser.
  return { ok: false, status: 409 };
}

// ── Statistiques de présentation (assistance) ────────────────────────────────────────────────────────────
// Heartbeat d'un participant : upsert de sa ligne d'assistance. On accumule le temps de présence (intervalles
// < 60 s → un aller-retour ne gonfle pas total_ms) et l'ensemble des pages vues (page courante de la présentation).
const ATTEND_MAX_GAP_MS = 60 * 1000;
// Plafond de création de participants ANONYMES par (présentation, IP). Défaut = ATTENDEES_PER_EGRESS
// (250, la cible de mutualisation par sortie internet) × 1,3 = 325 ; l'hôte peut le passer autrement.
// Ne borne QUE les nouvelles clés anon — jamais l'actualisation d'une clé déjà enregistrée, ni les
// membres/le présentateur (identité prouvée). Appliqué atomiquement par le RPC `player_attendance_bump`.
const PLAFOND_CREATION_ANON_DEFAUT = 325;
// L'avertissement « RPC de présence absente » ne se dit qu'UNE fois par processus : répété à chaque
// battement, il noierait le journal (un battement toutes les 25 s par participant).
let _avertRpcPresence = false;
// ⚠️ SIGNATURE : `(slug, participant, { presentation })`. Le participant reste en 2e position — c'est
// le contrat d'export PUBLIC (`./presentations`), un hôte tiers appelle `recordAttendance(slug,
// participant)` à DEUX arguments. L'optimisation « présentation déjà chargée » vit dans un SAC
// D'OPTIONS, pas dans un slot positionnel : la ranger en 2e position (ce que faisait 0.1.84) déplaçait
// le vrai paramètre et faisait jeter `Cannot destructure property 'key'` sur un appel à deux arguments
// (P1a audit CODEX 5.6). `participant || {}` : un appel sans participant tombe en 400, jamais en throw.
/**
 * Appelle la RPC de présence en RÉESSAYANT le contrat plus ancien si la signature n'existe pas.
 *
 * ⚠️ POURQUOI UN RÉESSAI PLUTÔT QU'UNE SONDE. Une sonde de colonne est un indice INDIRECT de ce qu'on
 * veut savoir (la signature de la fonction) ; ici on interroge exactement ce dont on dépend. C'est
 * indispensable pour 0018, qui n'ajoute AUCUNE colonne — il n'y aurait rien à sonder.
 *
 * ⚠️ ET LE VERDICT SE MÉMORISE. Sans mémo, chaque battement d'un hôte non migré paierait un
 * aller-retour perdu ; le chemin de la présence est chaud (un battement toutes les 25 s par
 * participant). On retient donc l'ensemble d'arguments qui a marché, pour le processus.
 */
/**
 * Cette erreur dit-elle « CETTE SIGNATURE N'EXISTE PAS », et rien d'autre ?
 *
 * ⚠️ C'EST LA QUESTION QUI MANQUAIT, ET SON ABSENCE RETIRAIT UNE PROTECTION. Le repli vers l'ancien
 * contrat se déclenchait sur N'IMPORTE QUELLE exception : un `ECONNRESET`, un 500, un délai dépassé
 * valaient « migration 0018 absente », et le processus restait dégradé — sans contrôle anti-usurpation
 * — jusqu'à son redémarrage. Une panne réseau d'une seconde désarmait une garde de sécurité sur une
 * base pourtant entièrement migrée.
 *
 * C'est la règle du jour appliquée au code de production : **un mécanisme qui ne peut pas mesurer doit
 * refuser de conclure, pas conclure par défaut.** Ici, ne pas savoir distinguer PGRST202 d'un timeout
 * ne rendait pas le repli prudent — il le rendait automatique.
 *
 * PostgREST rend `PGRST202` quand aucune fonction ne correspond au jeu d'arguments nommés. On accepte
 * les DEUX formes que nos contextes produisent (code analysé, ou message contenant le code / la phrase
 * de PostgREST) — et RIEN d'autre : un statut 404 seul ne suffit pas, il peut venir d'ailleurs.
 */
function signatureAbsente(erreur) {
  if (!erreur) return false;
  const code = erreur.details && (erreur.details.code || (erreur.details.error && erreur.details.error.code));
  if (code === "PGRST202") return true;
  const texte = String((erreur && erreur.message) || "");
  return texte.includes("PGRST202") || /Could not find the function/i.test(texte);
}

// ⚠️ LE MÉMO EXPIRE — UN « NON » N'A PAS LA DURÉE DE VIE D'UN « OUI ». C'est la doctrine que schema.js
// applique déjà à ses sondes, et elle vaut ici pour la même raison : « 0018 absente » est un état que
// l'exploitant peut RÉPARER pendant que le processus tourne. Mémorisé pour toujours, il aurait exigé un
// redémarrage pour que le durcissement reprenne — une migration appliquée serait restée sans effet, en
// silence. Un « oui » (la signature existe) n'a pas besoin d'expirer : une fonction ne disparaît pas.
let _bumpSansDurcissementJusqua = 0;
const MEMO_SANS_DURCISSEMENT_MS = 60 * 1000;
// ⚠️ LE DERNIER MOT OBSERVÉ, ÉCRIT — pas déduit. Un booléen « on a essayé » ne pouvait pas dire si
// ce mot fut un succès ou un échec, et c'est lui qui décide. Comparer deux instants le disait, au
// prix d'une égalité possible à la milliseconde. On écrit donc l'état : « actif » (un appel durci
// est revenu), « degrade » (la signature manquait), « inconnu » (rien constaté dans ce processus).
let _etatDurcissement = "inconnu";
// ⚠️ A-T-ON SEULEMENT ESSAYÉ ? « Pas dégradé » n'est pas « vérifié » : un processus qui vient de
// démarrer n'a rien tenté, et rendre « actif » reviendrait à annoncer une garde active sur la foi
// d'une absence d'observation. Trois états, donc — la même règle que le verdict du schéma, où « rien
// de manquant » se lisait « tout va bien » tant qu'on ne distinguait pas « rien demandé ».
async function appelerBump(corps, durcissementVoulu) {
  const appel = (b) => PLAYER.db.request("rpc/player_attendance_bump", { method: "POST", body: b });
  if (durcissementVoulu && Date.now() < _bumpSansDurcissementJusqua) {
    const { p_only_if_unclaimed: _retire, ...sansDurcissement } = corps;
    return appel(sansDurcissement);
  }
  try {
    const r = await appel(corps);
    // ⚠️ ON NE MARQUE LE SUCCÈS QU'ICI — l'appel est REVENU, donc la signature à 12 arguments existe.
    // Un rendu `{ok:false, usurpe:true}` compte : seule 0018 sait répondre ça. Ce qui se mesure est
    // le RETOUR, jamais l'intention de partir.
    if (durcissementVoulu) _etatDurcissement = "actif";
    return r;
  } catch (erreur) {
    if (!durcissementVoulu) throw erreur;   // rien à retirer : l'échec est réel
    // ⚠️ ON NE SE REPLIE QUE SUR LA PREUVE. Toute autre erreur remonte telle quelle : l'appelant
    // refusera le battement plutôt que de l'écrire sans le contrôle qu'il avait demandé.
    if (!signatureAbsente(erreur)) throw erreur;
    // La signature à 12 arguments n'existe pas (0018 non appliquée) : on retire l'argument et on
    // réessaie. Le durcissement n'est alors PAS appliqué — et ça se dit, une fois, plus bas.
    _etatDurcissement = "degrade";
    _bumpSansDurcissementJusqua = Date.now() + MEMO_SANS_DURCISSEMENT_MS;
    // ⚠️ CE QUI DISPARAÎT SE DIT. Le durcissement demandé n'est pas appliqué : sous
    // PLAYER_PRESENCE_STRICT, la porte se fermerait sur les battements legacy tout en laissant un
    // bootstrap auto-déclaré s'emparer d'une présence réclamée — c'est-à-dire une fermeture qui
    // rassure sans protéger. On nomme donc le fichier ET la conséquence.
    try {
      PLAYER.errors.capture(new Error(
        "bootstrap de présence NON durci : appliquez supabase/migrations/0018-bootstrap-non-usurpable.sql. "
        + "Sans elle, un bootstrap auto-déclaré peut écraser une présence déjà réclamée par un porteur "
        + "de jeton — n'armez pas PLAYER_PRESENCE_STRICT avant de l'avoir appliquée.",
      ), { route: "present-attend" });
    } catch { /* jamais bloquant */ }
    // ⚠️ SOUS PORTE FERMÉE, ON NE SE REPLIE PAS — ON REFUSE. Le repli retire le contrôle
    // anti-usurpation et écrit quand même : acceptable pendant la TRANSITION (mieux vaut une
    // présence enregistrée sans contrôle qu'une présentation cassée), inacceptable une fois
    // PLAYER_PRESENCE_STRICT posé. À ce moment-là l'exploitant a déclaré que seule une identité
    // prouvée entre ; laisser un bootstrap auto-déclaré s'emparer d'une ligne réclamée serait une
    // fermeture qui rassure sans protéger — précisément ce que la porte prétend empêcher.
    //
    // On lève, et l'appelant rend 503 : « je n'ai pas pu vérifier », pas « c'est refusé » ni « c'est
    // écrit ». ⚠️ Seuls les BOOTSTRAPS sont concernés (durcissementVoulu) : un battement prouvé n'a
    // jamais emprunté ce chemin, donc une présentation en cours ne s'arrête pas. (Audit externe.)
    if (PLAYER && PLAYER.config && PLAYER.config.presenceStrict) {
      const refus = new Error(
        "bootstrap de présence NON durci alors que PLAYER_PRESENCE_STRICT est posé : appliquez "
        + "supabase/migrations/0018-bootstrap-non-usurpable.sql, ou retirez le mode strict le temps "
        + "de la migration. Aucune écriture non protégée n'a été faite.",
      );
      refus.code = "durcissement-absent";
      throw refus;
    }
    const { p_only_if_unclaimed: _retire, ...sansDurcissement } = corps;
    return appel(sansDurcissement);
  }
}

async function recordAttendance(slug, participant, { presentation = null, ipHash = null, anonCap = null, hasToken = null, onlyIfUnclaimed = false } = {}) {
  const { key, name, email, avatar, isMember, isPresenter } = participant || {};
  if (!slug || !key) return { ok: false, status: 400 };
  // La route vient DÉJÀ de charger la présentation (contrôle présentateur) : elle la fournit dans les
  // options plutôt que de la faire relire par battement (un battement = un aller-retour DB de moins).
  // Repli sur une lecture si l'appelant ne la fournit pas — c'est le cas de l'appel public à 2 args.
  const pres = presentation || await getPresentation(slug);
  if (!pres) return { ok: false, status: 404 };
  // ⚠️ La lecture est DÉJÀ faite ici : on s'en sert plutôt que d'en refaire une. Un battement de
  // présence sur une session close n'a rien à mettre à jour — et il en arrive à chaque onglet
  // resté ouvert, longtemps après la fin.
  if (pres.active === false && pres.control_hash == null) return REFUS_ARCHIVE;
  const page = Math.max(1, Math.trunc(Number(pres.current_page) || 1));

  // ⚠️ CHEMIN ATOMIQUE (migration 0015) : upsert ET plafond de création anonyme en UN geste, à l'abri
  // des créations concurrentes. Absent (404, migration non appliquée) → on retombe sur la boucle
  // lire-modifier-réécrire ci-dessous — toujours correcte, mais SANS le plafond — et on le dit une
  // fois. Même patron que player_rate_limit_bump : dégrader, jamais casser, jamais en silence.
  const capAnon = Number(anonCap) > 0 ? Math.trunc(Number(anonCap)) : PLAFOND_CREATION_ANON_DEFAUT;
  // ⚠️ ON N'ENVOIE `p_has_token` QUE SI 0017 EST LÀ — ET C'EST LA MOITIÉ MANQUANTE DE LA COMPATIBILITÉ.
  //
  // PostgREST résout une RPC par JEU D'ARGUMENTS NOMMÉS : un argument en trop ne « prend pas son
  // défaut », il ne correspond à AUCUNE fonction → 404. Le `DEFAULT null` de 0017 rend donc la base
  // NEUVE compatible avec du CODE ANCIEN ; il ne peut rien pour le sens INVERSE — code neuf, base
  // ancienne — qui est précisément l'ordre d'un déploiement réel : le code part avant la migration.
  //
  // Sans cette garde, un hôte à jour mais pas encore migré tombait dans le repli lire-modifier-
  // réécrire, c'est-à-dire PERDAIT LE PLAFOND de création de faux participants apporté par 0015 : une
  // garde disparaissait en silence entre deux migrations. On sonde donc la colonne (la réponse existe
  // déjà) et on appelle à 10 arguments quand elle manque — l'ancien contrat, valide sur les DEUX bases.
  // La dégradation redevient alors ce qu'on annonce : pas de compteur de transition, rien d'autre.
  // (relevé du second hôte, qui l'a MESURÉ sur sa base au lieu de le supposer)
  const transitionDispo = await require("./schema").attendue("jetonPresence");
  const corpsRpc = {
    p_slug: String(slug), p_key: String(key), p_ip_hash: ipHash || null, p_page: page,
    p_name: (name || "").slice(0, 120), p_avatar: (avatar || "").slice(0, 600),
    p_is_member: !!isMember, p_is_presenter: !!isPresenter,
    p_max_gap_ms: ATTEND_MAX_GAP_MS, p_anon_cap: capAnon,
  };
  // true → last_token_at, false → last_no_token_at, null → ni l'un ni l'autre. 0017 seulement.
  if (transitionDispo) corpsRpc.p_has_token = hasToken == null ? null : !!hasToken;
  // ⚠️ LE DURCISSEMENT DU BOOTSTRAP (0018) N'A PAS DE COLONNE À SONDER — il est fonction-seule. On ne
  // peut donc pas le déduire d'un indice : on le DEMANDE et on RÉESSAIE le contrat plus ancien si la
  // signature n'existe pas. C'est la forme que le second hôte préférait (« elle ne peut pas se
  // tromper, parce qu'elle interroge exactement ce dont elle dépend ») — l'indice indirect de 0017,
  // lui, resterait vrai si colonne et fonction se désynchronisaient. Le contrat retenu est mémorisé
  // pour le processus : un hôte non migré ne paie pas deux allers-retours par battement, un seul.
  const durcissementVoulu = !!onlyIfUnclaimed;
  if (durcissementVoulu) corpsRpc.p_only_if_unclaimed = true;
  try {
    const r = await appelerBump(corpsRpc, durcissementVoulu);
    const ligne = Array.isArray(r) ? r[0] : r;
    if (ligne && typeof ligne.ok === "boolean") {
      // Plafond de création atteint : on ne crée pas ce faux participant. 429 = « trop », pas une panne.
      if (ligne.capped) return { ok: false, status: 429 };
      // Bootstrap sur une ligne DÉJÀ RÉCLAMÉE par un porteur de jeton : rien n'a été écrit. 409 = « ce
      // n'est pas à toi » — le client fera tourner sa clé plutôt que de perdre sa présence en silence.
      if (ligne.usurpe) return { ok: false, status: 409, usurpe: true };
      return { ok: true };
    }
    // Forme inattendue : on n'invente pas de verdict, on laisse la boucle de repli faire l'écriture.
  } catch (erreur) {
    // ⚠️ UN DURCISSEMENT DEMANDÉ QUI N'A PAS PU S'EXÉCUTER NE SE CONTOURNE PAS. Le repli en boucle
    // lire-modifier-réécrire écrit SANS le contrôle anti-usurpation : l'emprunter ici reviendrait à
    // faire par la porte de service ce que le chemin principal vient de refuser. On rend 503 — « je
    // n'ai pas pu vérifier », pas « c'est refusé » ni « c'est écrit » — et le battement suivant
    // réessaiera dans quelques secondes. Fail-closed sur le contrôle, jamais sur la disponibilité des
    // battements ORDINAIRES, qui continuent de se replier normalement.
    if (onlyIfUnclaimed) {
      try {
        PLAYER.errors.capture(new Error(
          "bootstrap de présence refusé : le contrôle anti-usurpation n'a pas pu s'exécuter — "
          + ((erreur && erreur.message) || erreur),
        ), { route: "present-attend" });
      } catch { /* jamais bloquant */ }
      return { ok: false, status: 503 };
    }
    if (!_avertRpcPresence) {
      _avertRpcPresence = true;
      try {
        // ⚠️ ON NOMME LE FICHIER QU'ON VIENT VRAIMENT D'ESSAYER — un nom FAUX est pire qu'un nom
        // absent, parce qu'il est ACTIONNABLE : l'exploitant vérifie la migration nommée, la trouve
        // appliquée, et conclut au faux positif. C'est ce qui arrivait quand ce message accusait 0015
        // alors que l'échec venait de l'argument `p_has_token` de 0017 (relevé du second hôte). La
        // règle « on nomme le fichier, pas l'erreur » ne tient que tant qu'UN SEUL fichier peut causer
        // l'échec ; dès qu'un second emprunte le même chemin, le nom doit se DÉDUIRE de la tentative.
        const fichier = transitionDispo
          ? "supabase/migrations/0017-jeton-presence.sql (ou 0015-presence-atomique.sql)"
          : "supabase/migrations/0015-presence-atomique.sql";
        PLAYER.errors.capture(new Error(
          "présence non atomique : appliquez " + fichier + ". "
          + "Sans elle, la présence est écrite par lire-modifier-réécrire (correct) mais le plafond "
          + "de création de faux participants anonymes n'est pas appliqué. "
          + "(" + ((erreur && erreur.message) || erreur) + ")",
        ), { route: "present-attend" });
      } catch { /* jamais bloquant */ }
    }
    // On continue vers la boucle de repli.
  }
  // ⚠️ LE DERNIER LIRE-MODIFIER-RÉÉCRIRE DU DÉPÔT, fermé comme les autres — mais SANS migration :
  // `last_seen` change à chaque battement accepté, c'est un verrou optimiste gratuit. L'écriture
  // est conditionnée à la valeur LUE ; zéro ligne = quelqu'un d'autre a battu entre-temps (l'autre
  // onglet du même participant) — on relit et on rejoue. Sans ça, deux onglets qui battent dans la
  // même seconde perdaient une page vue : la seconde réécriture emportait la première.
  let cur = null;
  for (let essai = 0; essai < 4; essai += 1) {
    if (cur === null) {
      const rows = await PLAYER.db.request(`doc_presentation_attendees?slug=eq.${enc(slug)}&attendee_key=eq.${enc(String(key))}&select=*&limit=1`);
      cur = (Array.isArray(rows) && rows[0]) || false;
    }
    if (!cur) {
      const now = Date.now();
      const row = { slug: String(slug), attendee_key: String(key).slice(0, 200), name: (name || "").slice(0, 120) || null, email: lc(email) || null, avatar: (avatar || "").slice(0, 600) || null, is_member: !!isMember, is_presenter: !!isPresenter, first_seen: new Date(now).toISOString(), last_seen: new Date(now).toISOString(), total_ms: 0, pages: [page] };
      try {
        await PLAYER.db.request("doc_presentation_attendees", { method: "POST", headers: { Prefer: "return=minimal" }, body: [row] });
        return { ok: true };
      } catch (erreur) {
        // ⚠️ La clé primaire (slug, attendee_key) fait son travail : deux PREMIERS battements
        // simultanés (deux onglets ouverts ensemble), et le second recevait un 409 que personne ne
        // rattrapait — un 500 pour un battement, bénin mais faux. Le conflit dit « la ligne existe
        // maintenant » : on la relit et on continue en mise à jour. Tout autre échec remonte.
        if (!String((erreur && erreur.message) || "").includes("409")) throw erreur;
        // Journalisé comme bénin : deux onglets qui arrivent ensemble sont une information, pas
        // une panne — et la garde des écritures muettes exige que tout rattrapage parle.
        try { PLAYER.errors.capture(new Error("présence déjà ouverte (second onglet) : " + String(slug)), { route: "present-attend", benin: true }); } catch { /* jamais bloquant */ }
        cur = null;
        continue;
      }
    }
    // ⚠️ UN `last_seen` ACCEPTÉ EST STRICTEMENT CROISSANT — sans ça, la serrure est aveugle dans
    // la milliseconde : deux battements dans la même ms écrivent la MÊME valeur, la condition du
    // suivant matche encore, et l'écrasement revient par la fenêtre qu'on venait de fermer. Vu au
    // banc (trois écritures, trois conditions vraies) avant d'être vu nulle part ailleurs. Le prix :
    // une milliseconde d'avance sur l'horloge dans les rafales, invisible pour des statistiques.
    const lu = new Date(cur.last_seen || 0).getTime();
    const now = Math.max(Date.now(), lu + 1);
    const gap = now - lu;
    const addMs = gap > 0 && gap <= ATTEND_MAX_GAP_MS ? gap : 0;
    const pages = Array.isArray(cur.pages) ? cur.pages.slice() : [];
    if (!pages.includes(page)) pages.push(page);
    const ecrit = await ecrireSiEncoreVrai(
      `doc_presentation_attendees?slug=eq.${enc(slug)}&attendee_key=eq.${enc(String(key))}&last_seen=eq.${enc(String(cur.last_seen))}`,
      { last_seen: new Date(now).toISOString(), total_ms: Number(cur.total_ms || 0) + addMs, pages, name: (name || cur.name || "").slice(0, 120) || null, avatar: (avatar || cur.avatar || "").slice(0, 600) || null,
        // ⚠️ Les deux drapeaux se remettent à jour à chaque battement, ils ne sont plus figés à la
        // première ligne : un transfert de présentation change qui porte le titre, et une session qui
        // s'authentifie en cours de route devient un membre. Figés, ils décriraient l'instant de
        // l'arrivée et non la réalité — et le premier arrivé aurait raison pour toujours.
        is_member: !!isMember, is_presenter: !!isPresenter },
    );
    if (ecrit) return { ok: true };
    cur = null;   // battu en vol : on relira l'état frais au tour suivant
  }
  // Quatre tours perdus : un battement de présence se reperd sans conséquence — le suivant arrive
  // dans quelques secondes. Refuser net plutôt qu'écraser ce que les gagnants viennent d'écrire.
  return { ok: false, status: 409 };
}

// Détail d'une présentation : entête + participants + nombre de messages par participant.
/**
 * Les statistiques d'une présentation : qui a suivi, combien de temps, quelles pages.
 *
 * ⚠️ UNE SESSION NE SUFFIT PAS, ET C'EST LE CORRECTIF. Cette route exigeait un jeton et rien de plus :
 * tout membre connaissant un slug lisait donc les participants d'une présentation qui n'était pas la
 * sienne — leurs NOMS, leurs ADRESSES, leur temps de présence et les pages qu'ils ont vues. Ces
 * participants sont souvent des prospects : ce sont des données commerciales sur des clients, pas un
 * compteur d'usage.
 *
 * ⚠️ QUI Y A DROIT AU-DELÀ DU PROPRIÉTAIRE EST UNE RÈGLE DE L'HÔTE, PAS DU PLAYER. Une petite équipe
 * où chacun voit tout est un choix parfaitement défendable ; une instance à plusieurs populations ne
 * peut pas se le permettre. Le player ne tranche donc pas : il accorde ce qui est manifeste — le
 * propriétaire, l'administrateur — et demande le reste à l'hôte, par le même crochet qui décide déjà
 * qui peut diffuser un document.
 *
 * `autoriseLarge` est une FONCTION, pas un booléen : sans elle on paierait un aller-retour
 * d'autorisation pour un propriétaire qui n'en a pas besoin.
 *
 * Signalé par deux audits (C-8, V-6).
 */
async function presentationStats(slug, email, isAdmin, autoriseLarge) {
  if (!slug) return { ok: false, status: 400 };
  const pres = await getPresentation(slug);
  if (!pres) return { ok: false, status: 404 };
  const proprietaire = !!isAdmin || !!(pres.owner_email && pres.owner_email === lc(email));
  if (!proprietaire) {
    let large = false;
    // Une autorisation qui LÈVE vaut refus : « large » garde sa valeur initiale, et c'est la bonne.
    try { large = typeof autoriseLarge === "function" ? !!(await autoriseLarge()) : !!autoriseLarge; } catch { /* hôte injoignable : refus */ }
    if (!large) return { ok: false, status: 403 };
  }
  const [attRows, msgRows] = await Promise.all([
    PLAYER.db.request(`doc_presentation_attendees?slug=eq.${enc(slug)}&select=*&order=first_seen.asc&limit=500`),
    PLAYER.db.request(`doc_presentation_messages?slug=eq.${enc(slug)}&deleted=eq.false&select=author_email,author_name&limit=1000`),
  ]);
  const msgs = Array.isArray(msgRows) ? msgRows : [];
  // ⚠️ Une `Map` : la clé est l'e-mail ou le nom d'un participant, donc une donnée du dehors.
  // Avec un objet, `msgByKey["__proto__"]` traverse le prototype au lieu de compter. (audit P1-2)
  const msgByKey = new Map();
  msgs.forEach((m) => { const k = lc(m.author_email) || ("name:" + (m.author_name || "")); msgByKey.set(k, (msgByKey.get(k) || 0) + 1); });
  const attendees = (Array.isArray(attRows) ? attRows : []).map((a) => {
    const k = lc(a.email) || ("name:" + (a.name || ""));
    const pages = Array.isArray(a.pages) ? a.pages : [];
    return { name: a.name, email: a.email, avatar: a.avatar, isMember: !!a.is_member, isPresenter: !!a.is_presenter, firstSeen: a.first_seen, lastSeen: a.last_seen, totalMs: Number(a.total_ms || 0), pages, pagesCount: pages.length, msgCount: msgByKey.get(k) || 0 };
  });
  const viewers = attendees.filter((a) => !a.isPresenter);
  const start = new Date(pres.created_at || 0).getTime();
  const lastActivity = Math.max(new Date(pres.updated_at || 0).getTime(), ...attendees.map((a) => new Date(a.lastSeen || 0).getTime()), start);
  return {
    ok: true,
    presentation: { slug: pres.slug, docId: pres.doc_id, docTitle: pres.doc_title, fileName: pres.file_name, presenterName: pres.presenter_name, ownerName: pres.owner_name, currentPage: pres.current_page || 1, active: !!pres.active, createdAt: pres.created_at, endedAt: pres.active ? null : pres.updated_at, durationMs: Math.max(0, lastActivity - start) },
    summary: { total: viewers.length, members: viewers.filter((a) => a.isMember).length, externals: viewers.filter((a) => !a.isMember).length, messages: msgs.length, pagesReached: Math.max(1, pres.current_page || 1) },
    attendees,
  };
}

// Changer le document présenté SANS interrompre la session (même slug → chat/présence/participants conservés).
// Autorisé au propriétaire (email du JWT) OU à un admin. L'URL est validée en amont (isAllowedStorageUrl, doc.js).
async function switchPresentationDoc(slug, email, isAdmin, { fileUrl, fileName, docTitle, docId }) {
  if (!slug || !fileUrl) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  if (estClose(row)) return { ok: false, status: 409, error: "ended" };
  if (!isAdmin && (!row.owner_email || row.owner_email !== lc(email))) return { ok: false, status: 403 };
  // ⚠️ LE PROPRIÉTAIRE VÉRIFIÉ VOYAGE DANS LA CONDITION — un transfert entre la lecture et
  // l'écriture donnait la présentation à Bob, et la requête retardée d'Alice changeait ENCORE le
  // document de Bob. Même classe que reprise/clôture/transfert (#130), deux survivants trouvés par
  // le cinquième audit. L'admin, lui, écrit sur la présentation active telle quelle : modération.
  const ecrit = await ecrireSiEncoreVrai(
    `doc_presentations?slug=eq.${enc(slug)}&active=eq.true${isAdmin ? "" : `&owner_email=eq.${enc(row.owner_email)}`}`, {
    file_url: String(fileUrl), file_name: fileName || null, doc_title: docTitle || null, doc_id: docId ? String(docId) : null,
    content: null, current_page: 1, active: true, last_seen: new Date().toISOString(), updated_at: new Date().toISOString(),
  });
  // Une présentation terminée entre le contrôle et l'écriture n'est pas rouverte par un
  // changement de document : le refus arrive tard, mais il arrive.
  if (!ecrit) return { ok: false, status: 409, error: "ended" };
  return { ok: true };
}

// Contenu courant de la présentation : bascule PDF ↔ carte live (Leaflet). Réservé propriétaire/admin.
// content = { kind:'map', center:[lat,lng], zoom, marker:[lat,lng]|null, label } ; kind 'pdf'/null → le document.
// Contrat de contenu partagé avec le navigateur — UN seul exemplaire, testé sous player/src/.
// Il traverse trois frontières (présentateur → serveur → audience) : deux implémentations
// finissaient par diverger, et une audience qui ne voit pas la bonne carte n'émet aucune erreur.
const { sanitizeContent } = require("./shared.generated.js");

/**
 * Une présentation close ne se pilote plus par le chemin PROPRIÉTAIRE.
 *
 * ⚠️ La révocation du jeton ferme le pilotage de qui détient un « control_token ». Elle ne ferme pas
 * les deux actions qu'un propriétaire exerce avec sa seule session — changer le contenu affiché, et
 * changer le document montré. Sans cette garde, celui qui vient de terminer sa présentation la
 * remettrait en ligne en déplaçant une carte.
 *
 * ⚠️ Ici, et pas sur les chemins à jeton : un propriétaire dispose de « present-reclaim » pour
 * rouvrir délibérément, ce qui n'est pas le cas d'un présentateur anonyme dont la présentation a
 * simplement été marquée périmée.
 */
function estClose(row) {
  return row && row.active === false;
}

/**
 * Ce que la présentation AFFICHE : carte, Street View, ou rien.
 *
 * ⚠️ DEUX AUTORITÉS, ET C'EST LE CORRECTIF. Cette fonction n'acceptait que le PROPRIÉTAIRE, alors
 * que `setPage` — qui pilote exactement de la même façon — accepte le `control_token`. Conséquence :
 * une présentation démarrée SANS session (c'est permis, `present-start` ne l'exige pas) pouvait
 * tourner les pages mais pas déplacer sa carte. L'appel repartait en 401, avalé côté navigateur, et
 * le présentateur voyait sa carte ne pas suivre sans qu'aucun message ne le dise.
 *
 * Piloter ce qui s'affiche et tourner une page sont le même acte : le `control_token` suffit aux
 * deux. Le propriétaire garde son chemin — il pilote sa présentation depuis l'application sans
 * détenir le jeton de contrôle du navigateur qui la présente.
 *
 * ⚠️ Ce qui reste réservé au propriétaire est `switchPresentationDoc` : changer le DOCUMENT n'est
 * pas piloter l'affichage, c'est décider ce qui est montré. Les deux étaient groupés par voisinage
 * dans la route, pas par autorité.
 *
 * Signalé par un audit externe : « le comportement actuel est ambigu ».
 */
async function setPresentationContent(slug, email, isAdmin, content, control) {
  if (!slug) return { ok: false, status: 400 };
  const row = await getPresentation(slug);
  if (!row) return { ok: false, status: 404 };
  const pilote = control && tokenMatches(control, row.control_hash);
  const proprietaire = isAdmin || (row.owner_email && row.owner_email === lc(email));
  if (!pilote && !proprietaire) return { ok: false, status: 403 };
  // Le pilote a déjà été filtré par la révocation du jeton ; c'est le propriétaire qu'on arrête ici.
  if (!pilote && estClose(row)) return { ok: false, status: 409, error: "ended" };
  // ⚠️ DEUX AUTORISATIONS, DONC DEUX CONDITIONS — et c'est la seule façon de ne pas retirer un
  // droit en fermant une porte. Le PILOTE écrit tant que son jeton vaut : une carte affichée
  // pendant que le portable dormait doit encore partir, comme une page. Le PROPRIÉTAIRE, lui,
  // n'écrit que sur une présentation vivante : c'est déjà ce que le contrôle au-dessus exige.
  // ⚠️ Et le PROPRIÉTAIRE (non-admin) voyage dans la condition, comme partout : sans ça, sa
  // requête retardée écrivait encore sur la présentation qu'un transfert venait de donner.
  const ecrit = await ecrireSiEncoreVrai(
    pilote
      ? `doc_presentations?slug=eq.${enc(slug)}&control_hash=eq.${sha(control)}`
      : `doc_presentations?slug=eq.${enc(slug)}&active=eq.true${isAdmin ? "" : `&owner_email=eq.${enc(row.owner_email)}`}`,
    { content: sanitizeContent(content), active: true, last_seen: new Date().toISOString(), updated_at: new Date().toISOString() },
  );
  if (!ecrit) return { ok: false, status: 409, error: "ended" };
  return { ok: true };
}

// Historique des présentations d'un document (pour l'onglet Suivi) : la plus récente d'abord, avec le nb de participants.
/**
 * L'historique des présentations d'un document.
 *
 * ⚠️ ON FILTRE, ON NE REFUSE PAS — et la nuance est un choix. Refuser en bloc priverait un membre de
 * SA propre liste dès qu'il n'a pas le droit élargi ; filtrer lui rend exactement ce qui lui revient.
 * Une liste qui montre moins n'est pas une panne, une liste qui refuse tout en est une.
 *
 * Même règle que pour les statistiques : le propriétaire et l'administrateur toujours, le reste sur
 * décision de l'hôte.
 */
async function listPresentationsForDoc(docId, email, isAdmin, autoriseLarge) {
  if (!docId) return [];
  const rows = await PLAYER.db.request(`doc_presentations?doc_id=eq.${enc(String(docId))}&select=slug,presenter_name,owner_name,owner_email,current_page,active,created_at,updated_at&order=created_at.desc&limit=50`);
  let list = Array.isArray(rows) ? rows : [];
  if (!isAdmin) {
    let large = false;
    // Une autorisation qui LÈVE vaut refus : « large » garde sa valeur initiale, et c'est la bonne.
    try { large = typeof autoriseLarge === "function" ? !!(await autoriseLarge()) : !!autoriseLarge; } catch { /* hôte injoignable : refus */ }
    if (!large) list = list.filter((p) => p.owner_email && p.owner_email === lc(email));
  }
  // UNE requête groupée (in.(…)) au lieu d'une par présentation (N+1, jusqu'à 50) ; agrégation en mémoire.
  const counts = new Map();
  if (list.length) {
    try {
      const slugs = list.map((p) => enc(p.slug)).join(",");
      const att = await PLAYER.db.request(`doc_presentation_attendees?slug=in.(${slugs})&is_presenter=eq.false&select=slug&limit=5000`);
      for (const a of Array.isArray(att) ? att : []) counts.set(a.slug, (counts.get(a.slug) || 0) + 1);
    } catch { /* best-effort : compteurs à 0 */ }
  }
  return list.map((p) => ({ slug: p.slug, presenterName: p.presenter_name, ownerName: p.owner_name, currentPage: p.current_page || 1, active: !!p.active, createdAt: p.created_at, endedAt: p.active ? null : p.updated_at, attendees: counts.get(p.slug) || 0 }));
}

module.exports = {
  reacteurDepuisJeton,
  purgerPerimees,
  messagePublic, CHAMPS_PUBLICS, etatDurcissementBootstrap, signatureAbsente, cheminPieceJointe, init, createPresentation, getPresentation, setPage, endPresentation, addMessage, listMessages, toggleReaction, editMessage, deleteMessage, setChatLock, createUploadUrl, reclaimPresentation, touchPresentation, listActivePresentations, handoverPresentation, endPresentationByOwner, recordAttendance, presentationStats, listPresentationsForDoc, switchPresentationDoc, setPresentationContent , STALE_MS};
