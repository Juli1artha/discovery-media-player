// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// GED commerciale : liens de partage tracés (un par destinataire) + agrégation des consultations.
// Tables service-role only (cf. migration v12321) → tout passe par le service role ici.
const crypto = require("crypto");
const { signatureAbsente } = require("./erreurs-base.js");
// Tout ce qui vient de l'hôte passe par le contexte injecté — base, email, marque. C'est ce qui
// permettra à ce fichier de partir dans le dépôt du player sans emporter le studio avec lui.
// ⚠️ Le contexte est REÇU, pas construit. Ce module ne doit pas savoir d'où il vient : c'est ce
// qui lui permettra de partir dans le dépôt du player sans emporter le studio avec lui.
let PLAYER = null;
function init(ctx) { PLAYER = ctx; }


const enc = encodeURIComponent;

// ⚠️ LA CLÉ D'IDEMPOTENCE EST UNE EMPREINTE, PAS UNE CONCATÉNATION (sixième audit). La forme
// historique `hote:<docId>|<email>` portait trois défauts : tronquée à 300 caractères à
// l'ÉCRITURE mais relue ENTIÈRE après un 409 — le perdant légitime finissait en 500 faute de
// trouver son gagnant ; deux docId partageant le préfixe se volaient leur lien ; et un `|` dans
// une composante déplaçait la frontière. JSON.stringify fixe les frontières, sha256 fixe la
// longueur (genre + 65 caractères, loin de toute limite). Une seule fonction pour ÉCRIRE et
// RELIRE : les deux exemplaires du fait ne peuvent plus diverger. Les clés ancien format en
// base s'éteignent d'elles-mêmes — le réemploi passe par doc_id et re-pose la clé canonique.
const cleIdempotence = (genre, composants) =>
  genre + ":" + crypto.createHash("sha256").update(JSON.stringify(composants)).digest("hex");
const low = (s) => String(s || "").trim().toLowerCase();
function newSlug() { return crypto.randomBytes(9).toString("base64url"); } // ~12 chars URL-safe

// Crée un lien de partage (un par destinataire). Dénormalise titre/URL/nom pour résilience (le doc vit dans
// un snapshot). Renvoie le slug.
async function createShare({ docId, docTitle, fileUrl, fileName, recipientEmail, recipientName, attestedRecipientEmail, createdBy, bot, botScript, guided, profileId, allowDownload, isTest, videoLayout, logo, logoDark, brandKey, idemKey}) {
  if (!docId || !fileUrl) throw Object.assign(new Error("doc invalide"), { statusCode: 400 });
  const slug = newSlug();
  // ⚠️ LA CLÉ N'EST ÉCRITE QUE LÀ OÙ LA COLONNE EXISTE — PostgREST rejette le POST ENTIER sur une
  // colonne inconnue : chez un hôte non migré, ce n'est pas l'unicité qu'on perdrait, c'est la
  // CRÉATION de liens. Même sonde que la clé des messages (0005).
  const cleDispo = idemKey ? await require("./schema").attendue("liensUniques") : false;
  const row = {
    ...(cleDispo ? { idem_key: String(idemKey) } : {}),
    slug, doc_id: String(docId), doc_title: docTitle || null, file_url: String(fileUrl), file_name: fileName || null,
    recipient_email: low(recipientEmail) || null, recipient_name: (recipientName || "").trim() || null, created_by: low(createdBy) || null,
    // ⚠️ DEUX CHAMPS, DEUX FAITS. `recipient_email` dit qui a le droit d'EXPÉDIER en son nom au
    // repartage — vide quand personne ne l'a. Celui-ci dit seulement à qui le lien est destiné,
    // pour attribuer une lecture et pouvoir la révoquer.
    //
    // Les confondre revenait à donner à un visiteur attesté par un hôte le pouvoir de faire partir
    // un courrier de nos serveurs, signé de son adresse, vers une adresse choisie par quiconque
    // détient le lien. La garde d'envoi et l'héritage du repartage lisent tous deux
    // `recipient_email` : en le laissant vide, ils refusent sans avoir à connaître cette histoire.
    ...(attestedRecipientEmail ? { attested_recipient_email: low(attestedRecipientEmail) } : {}),
    bot_enabled: !!bot, bot_script: (botScript || "").trim() ? String(botScript).slice(0, 2000) : null, bot_guided: guided !== false,
    bot_profile_id: (profileId || "").trim() ? String(profileId).slice(0, 40) : null,
    allow_download: allowDownload !== false, // défaut : autorisé (rétro-compatible)
    video_layout: ["side-r", "side-l", "split-m"].includes(videoLayout) ? videoLayout : null, // présentateur vidéo « en grand »
    is_test: !!isTest, // « répétition générale » : lien de test exclu des stats/notifications
    // Logo de marque (promoteur) du loader — null = logo 3D Discovery global.
    // Référence de marque (registre) : préférée au logo recopié — un logo rectifié se propage
    // alors aux liens DÉJÀ ENVOYÉS. Le logo direct reste accepté (flux des propositions).
    brand_key: (brandKey || "").trim() || null,
    brand_logo: (logo || "").trim() ? String(logo).trim().slice(0, 500) : null,
    brand_dark: !!logoDark, // fond sombre du loader (logo clair/blanc)
  };
  await PLAYER.db.request("commercial_doc_shares", { method: "POST", headers: { Prefer: "return=minimal" }, body: [row] });
  return { slug };
}

// Re-partage depuis la visionneuse publique (forward) : crée un lien ENFANT tracé pour un nouveau
// destinataire, rattaché au lien parent (parent_slug) → chaîne de diffusion. created_by = celui qui forwarde.
async function createReshare(parentSlug, { email, name }) {
  const parent = await getShareBySlug(parentSlug);
  if (!parent) throw Object.assign(new Error("lien introuvable"), { statusCode: 404 });
  const slug = newSlug();

  // ⚠️ ON HÉRITE DE TOUT, ON N'ÉNUMÈRE QUE LES EXCEPTIONS — ET LE SENS DE CETTE INVERSION EST LA
  // CORRECTION ELLE-MÊME.
  //
  // Cette ligne énumérait les colonnes à recopier. Une énumération se périme à chaque colonne
  // ajoutée, en silence, ET DU MAUVAIS CÔTÉ : la nouveauté est oubliée. Les colonnes de cette
  // table sont `not null default`, donc l'oubli ne produisait pas un trou — il produisait une
  // VALEUR PAR DÉFAUT, c'est-à-dire la plus permissive :
  //
  //   • `require_auth` (défaut `false`) — un document derrière le mur d'accès, une fois
  //     re-partagé, s'ouvrait SANS mur. Un destinataire pouvait donc lever la protection en se
  //     transmettant le document à lui-même. C'est le plus grave, et il n'était pas dans le
  //     rapport qui a mené ici.
  //   • `allow_download` (défaut `true`) — le bouton Télécharger revenait sur un document où il
  //     avait été refusé.
  //     ⚠️ À ne pas prendre pour une protection : c'est une PRÉFÉRENCE D'AFFICHAGE. Le lecteur qui
  //     voit le document en a déjà les octets ; masquer le bouton retire une commodité, pas un
  //     accès. Un document qu'on ne veut pas voir sortir ne doit pas être partagé, ou doit l'être
  //     derrière `require_auth` — celui-là, lui, décide de qui obtient les octets.
  //   • `brand_key` — la marque se perdait à l'endroit exact où le document commence à circuler :
  //     le lecteur d'un document VALONEUF transmettait un lien qui s'ouvre sous une autre marque.
  //
  // Aucun de ces trois n'était visible : le lien fonctionne, il est simplement plus permissif que
  // son parent. Signalé par le second hôte, qui a vu la marque — celle qui SE VOIT — et a supposé
  // que le reste suivait. Le reste suivait.
  //
  // Sens de l'inversion : une colonne ajoutée demain sera héritée sans que personne y pense. Si
  // c'est une restriction, elle se propage ; si elle ne doit pas l'être, il faudra l'écrire ici,
  // et ce sera une décision au lieu d'un oubli.
  //
  // `created_at` est retiré : la base le pose. `is_test` est hérité — un lien de répétition dont
  // un enfant compterait dans les vraies statistiques les fausserait.
  const { created_at: _cree, ...herite } = parent;
  const row = {
    ...herite,
    slug,
    recipient_email: low(email) || null,
    recipient_name: (name || "").trim() || null,
    created_by: parent.recipient_email || parent.created_by || null,
    parent_slug: parent.slug,
    revoked: false,
  };
  await PLAYER.db.request("commercial_doc_shares", { method: "POST", headers: { Prefer: "return=minimal" }, body: [row] });
  return { slug, docTitle: parent.doc_title };
}

async function getShareBySlug(slug) {
  const rows = await PLAYER.db.request(`commercial_doc_shares?slug=eq.${enc(String(slug || ""))}&revoked=eq.false&select=*&limit=1`);
  return Array.isArray(rows) && rows[0] ? rows[0] : null;
}

// ⚠️ BORNER CE QUI VIENT DU DEHORS — TOUS les chemins d'écriture publics, et le pluriel a coûté.
//
// Ces bornes ont été posées pour les deux chemins de SESSION (interne et externe) : un objet libre
// sans plafond laisse un seul appel écrire un JSON de la taille qu'il veut. Le troisième chemin —
// `logView`, qui journalise open/page/heartbeat — a été oublié, et il est resté ouvert deux cent
// soixante-quinze lignes plus haut pendant que les bornes vivaient ici (audit CODEX 5.6, 25/08).
//
// ⚠️ CE QUE COÛTAIT L'OUBLI, MESURÉ : un visiteur muni d'un lien valide postait
// `{"event":"page","page":2147483647,"maxPage":2147483647}`. La valeur était stockée telle quelle
// — `integer` PostgreSQL l'accepte — et le funnel de la vue d'ensemble bouclait ensuite de 1 à
// 2 147 483 647. Mesuré par extrapolation linéaire sur cinq échelles : environ quatre minutes de
// CPU et 17 à 40 Go. Une seule ligne suffisait, et elle restait. DoS STOCKÉ, déclenché par
// l'ouverture des statistiques — donc par quelqu'un d'autorisé, plus tard.
//
// ⚠️ ET LE CORRECTIF N'EST PAS « BORNER AUSSI ICI ». Deux chemins qui bornent chacun de leur côté
// divergent — c'est ce qui vient d'arriver. Il y a désormais UNE fonction qui fabrique la mesure
// bornée, appelée par les deux ; il n'y a plus de second endroit à oublier. C'est la règle du jour
// (`AGENTS.md`) appliquée à une frontière interne : on ne vérifie pas le passage, on le supprime.
const BORNES = { pages: 10_000, secondes: 24 * 3600, entreesPagesTime: 2_000 };
const bornerNombre = (v, max) => { const n = Number.isFinite(+v) ? Math.trunc(+v) : null; return n == null ? null : Math.max(0, Math.min(n, max)); };

/**
 * Une page LUE en base, ramenée dans la plage.
 *
 * ⚠️ SYMÉTRIQUE DE L'ÉCRITURE, ET POUR UNE AUTRE RAISON. Borner l'écriture protège les lignes à
 * venir ; celles déjà posées restent. Une agrégation qui suppose la base saine transforme une
 * donnée héritée en panne — c'est cette moitié-là qui déclenchait le DoS, et elle vaut aussi pour
 * les valeurs seulement AFFICHÉES : « ce lecteur a atteint la page 2 147 483 647 » est un chiffre
 * faux servi à un humain qui décide, ce que ce dépôt traite comme un défaut à part entière.
 */
const pageLue = (...valeurs) => Math.min(Math.max(0, ...valeurs.map((v) => Number(v) || 0)), BORNES.pages);

/** La mesure d'un visiteur, bornée — le SEUL endroit où page/maxPage/seconds entrent en base. */
const mesureBornee = ({ page, maxPage, seconds }) => ({
  page: bornerNombre(page, BORNES.pages),
  max_page: bornerNombre(maxPage, BORNES.pages),
  seconds: bornerNombre(seconds, BORNES.secondes),
});

// Journalise un événement de consultation (ouverture / page vue / battement). Best-effort.
async function logView(share, { event, page, maxPage, seconds, sessionId, ua }) {
  const row = {
    slug: share.slug, doc_id: share.doc_id, recipient_email: share.recipient_email,
    event: String(event || "open").slice(0, 16), ...mesureBornee({ page, maxPage, seconds }),
    session_id: String(sessionId || "").slice(0, 64) || null, ua: String(ua || "").slice(0, 300) || null,
  };
  await PLAYER.db.request("commercial_doc_views", { method: "POST", headers: { Prefer: "return=minimal" }, body: [row] });
}

// Liste des liens d'un document + stats par lien + agrégat global. Agrégation en mémoire (volume modéré).
/**
 * Liens d'un document.
 *
 * `owner` restreint la liste aux liens créés par cette personne. C'est ce qui permet à un hôte de
 * distinguer « lister MES liens » (acte commercial ordinaire) de « lister tous les liens » (acte
 * d'administration) : sans restriction, un commercial verrait à qui d'autre le document a été
 * envoyé — donc les prospects de ses collègues.
 */
// ⚠️ UNE SEULE DÉFINITION DE LA FENÊTRE D'ANALYTIQUE, PARCE QU'ELLE ÉTAIT DANS UNE FONCTION SUR DEUX.
// `overview()` bornait sa lecture à 24 mois glissants ; `listSharesForDoc`, quarante lignes plus haut,
// lisait TOUT l'historique d'un document. Deux lectures des mêmes tables d'événements, deux règles —
// et la seconde n'était écrite nulle part : elle se déduisait d'une absence.
//
// ⚠️ ET LE BORNAGE EST TEMPOREL, PAS EN NOMBRE DE LIGNES — la mesure l'impose. PostgREST plafonne à
// 1 000 lignes ici (constaté par un incident, cf. le commentaire d'`overview()` plus bas) : un
// `limit` inférieur mordrait DÉJÀ sur notre pire document (662 lignes), et un `limit` supérieur
// serait silencieusement ramené à 1 000 — donc un drapeau « tronqué » calculé sur la longueur
// MENTIRAIT. C'est `selectAll`, qui pagine par `Range`, qui met à l'abri du plafond ; la fenêtre,
// elle, borne le volume. Le patron « borné-ordonné-parlant » s'applique donc par sa borne TEMPORELLE.
const FENETRE_ANALYTIQUE_MOIS = 24;
const depuisFenetre = () =>
  new Date(Date.now() - FENETRE_ANALYTIQUE_MOIS * 30 * 24 * 60 * 60 * 1000).toISOString();

/**
 * Appelle une fonction d'agrégation en base. Rend `null` — et RIEN d'autre — quand la fonction
 * n'existe pas sur cet hôte.
 *
 * ⚠️ LE REPLI EST ÉTROIT, ET C'EST TOUT CE QUI LE REND SÛR. `PGRST202` veut dire « aucune fonction
 * de ce nom » : la migration 0022 n'est pas appliquée, on agrège en mémoire comme avant. N'importe
 * quelle AUTRE erreur — base injoignable, droits, délai — remonte. Replier dessus rendrait des
 * chiffres calculés sur un sous-ensemble silencieux, et « statistiques fausses » se lit exactement
 * comme « statistiques ». Même règle étroite que le repli de la présence.
 */
async function agregerEnBase(fonction, corps, projeter) {
  try {
    const lignes = await PLAYER.db.request(`rpc/${fonction}`, { method: "POST", body: corps });
    // ⚠️ LA PROJECTION EST UN PARAMÈTRE, PAS UNE POLITESSE. Une aide générique qui rendrait les
    // lignes telles quelles ferait sortir une réponse de base non projetée — ce que
    // `sortieProjetee.test.js` refuse, et il a raison : la forme rendue par PostgREST n'est pas la
    // nôtre, et la laisser traverser, c'est laisser une colonne ajoutée demain traverser aussi.
    // Passée en argument, elle oblige chaque appelant à NOMMER les champs dont il se sert.
    return Array.isArray(lignes) ? lignes.map(projeter) : [];
  } catch (erreur) {
    if (signatureAbsente(erreur)) return null;
    throw erreur;
  }
}

/**
 * Agrégats par lien et histogramme de l'entonnoir, calculés EN BASE.
 *
 * Rend `null` si la migration 0022 n'est pas appliquée — l'appelant reprend alors le chemin en
 * mémoire, qui reste la définition de référence.
 */
async function agregatsDocEnBase(docId, since) {
  const args = { p_doc_id: String(docId || ""), p_depuis: since };
  const parSlug = await agregerEnBase("player_stats_doc", args, (r) => [String(r.slug), {
    opens: Number(r.opens) || 0,
    sessions: Number(r.sessions) || 0,
    maxPage: Number(r.max_page) || 0,
    seconds: Number(r.seconds) || 0,
    lastAt: r.last_at || null,
  }]);
  if (parSlug === null) return null;
  const histo = await agregerEnBase("player_stats_doc_funnel", args, (r) => [Number(r.page) || 0, Number(r.sessions) || 0]);
  if (histo === null) return null;
  // ⚠️ UNE `Map`, PAS UN OBJET — le slug vient d'une ligne. Voir l'explication complète sur `byDoc`.
  return { bySlug: new Map(parSlug), histo };
}

/**
 * Les mêmes agrégats, calculés EN MÉMOIRE sur les lignes brutes.
 *
 * ⚠️ CE CHEMIN N'EST PAS DU CODE MORT, C'EST LA DÉFINITION DE RÉFÉRENCE. Le banc de base confronte
 * les deux sur les mêmes lignes et exige un résultat identique : deux textes écrits séparément qui
 * ne peuvent pas être faux de la même manière, comme la purge de rétention et son recensement. Et
 * il sert pour de vrai — un hôte n'applique pas forcément la dernière migration.
 */
function agregatsDocEnMemoire(viewList) {
  const bySlug = new Map();
  for (const v of viewList) {
    let s = bySlug.get(v.slug);
    // Le slug est engendré par le serveur, donc celui-ci n'était pas atteignable — on le convertit
    // quand même. Un agrégateur qui doit se justifier au cas par cas finit par se tromper de cas :
    // la règle « toute clé venue d'une ligne va dans une Map » se relit sans réfléchir.
    if (!s) { s = { opens: 0, maxPage: 0, seconds: 0, sessions: new Set(), lastAt: null }; bySlug.set(v.slug, s); }
    if (v.event === "open") s.opens++;
    const mp = pageLue(v.page, v.max_page);
    if (mp > s.maxPage) s.maxPage = mp;
    s.seconds = Math.max(s.seconds, Number(v.seconds) || 0);
    if (v.session_id) s.sessions.add(v.session_id);
    // ⚠️ UN MAXIMUM, PAS « LA DERNIÈRE LIGNE GAGNE ». `s.lastAt = v.at` n'était juste que TANT QUE la
    // requête triait par `at.asc` — un couplage caché entre l'agrégation et l'ORDER BY, à trente
    // lignes de distance. Quiconque aurait inversé le tri (pour garder le récent en cas de coupe)
    // aurait transformé « dernière activité » en « première activité », sans qu'un seul test ne
    // bouge. L'agrégation ne dépend plus de l'ordre : elle le calcule.
    if (!s.lastAt || String(v.at) > String(s.lastAt)) s.lastAt = v.at;
  }
  // Entonnoir de lecture : page max atteinte PAR SESSION → l'histogramme, cumulé plus bas.
  // ⚠️ UNE `Map`, PAS UN OBJET — la clé vient du dehors. Voir l'explication complète sur `byDoc`.
  const sessMax = new Map();
  for (const v of viewList) {
    const sid = v.session_id || v.slug;
    // ⚠️ ON REBORNE À LA LECTURE, PARCE QUE LA BASE N'EST PAS PROPRE. Borner l'écriture protège les
    // lignes à venir ; les lignes déjà posées, elles, restent. Une agrégation qui suppose une base
    // saine transforme une donnée héritée en panne — et c'est cette moitié-là qui déclenchait le
    // DoS, à l'ouverture des statistiques, chez quelqu'un d'autorisé.
    const mp = pageLue(v.page, v.max_page);
    if (mp > 0) sessMax.set(sid, Math.max(sessMax.get(sid) || 0, mp));
  }
  const compte = new Map();
  for (const x of sessMax.values()) compte.set(x, (compte.get(x) || 0) + 1);
  return {
    bySlug: new Map([...bySlug].map(([k, a]) => [k, { ...a, sessions: a.sessions.size }])),
    histo: [...compte],
  };
}

async function listSharesForDoc(docId, owner) {
  const id = enc(String(docId || ""));
  const filtreOwner = owner ? `&created_by=eq.${enc(low(owner))}` : "";
  const since = depuisFenetre();
  // ⚠️ LA LISTE DES LIENS RESTE UNE LECTURE DE LIGNES, et c'est voulu : elle rend UNE ligne par
  // lien, pas une par événement. C'est le journal d'événements qui grandit sans fin, pas elle.
  const shares = await PLAYER.db.request(`commercial_doc_shares?doc_id=eq.${id}&is_test=not.is.true${filtreOwner}&select=*&order=created_at.desc`);
  // ⚠️ AGRÉGER EN BASE D'ABORD, LIRE LES LIGNES EN REPLI. La fenêtre borne le TEMPS, pas le nombre
  // de lignes : sur un document très actif, vingt-quatre mois peuvent faire des millions
  // d'événements transférés pour rendre quelques dizaines de lignes.
  const agregats = await agregatsDocEnBase(docId, since)
    || agregatsDocEnMemoire(await PLAYER.db.selectAll(`commercial_doc_views?doc_id=eq.${id}&select=slug,event,page,max_page,seconds,session_id,at&at=gte.${enc(since)}&order=at.asc`).then((r) => (Array.isArray(r) ? r : [])));

  const shareList = Array.isArray(shares) ? shares : [];
  const VIDE = { opens: 0, maxPage: 0, seconds: 0, sessions: 0, lastAt: null };
  const enriched = shareList.map((sh) => {
    const a = agregats.bySlug.get(sh.slug) || VIDE;
    return { slug: sh.slug, parent_slug: sh.parent_slug || null, recipient_email: sh.recipient_email, recipient_name: sh.recipient_name, created_by: sh.created_by, created_at: sh.created_at, revoked: sh.revoked, opens: a.opens, sessions: a.sessions, maxPage: a.maxPage, seconds: a.seconds, lastAt: a.lastAt };
  });

  // ⚠️ HISTOGRAMME PUIS CUMUL DESCENDANT — O(pages + sessions) au lieu de O(pages × sessions).
  // L'écriture précédente rebalayait TOUTES les sessions à chaque page : avec le rebornage de
  // lecture le pire cas passe de 2,1 milliards d'itérations à 10 000, mais le quadratique restait
  // payé sur des valeurs parfaitement légitimes — 10 000 pages × 500 sessions font cinq millions de
  // comparaisons pour un résultat que deux passes donnent exactement.
  //
  // ⚠️ ET LE CUMUL RESTE ICI, D'UN SEUL CÔTÉ. La base rend l'histogramme (une ligne par page
  // atteinte), le cumul se fait en JavaScript : c'est une passe sur le nombre de PAGES, jamais sur
  // le nombre d'événements. Écrire la définition de l'entonnoir des deux côtés en donnerait deux,
  // qui divergeraient.
  let maxReached = 0, readers = 0;
  for (const [page, n] of agregats.histo) { if (page > maxReached) maxReached = page; readers += n; }
  const parPage = new Array(maxReached + 2).fill(0);
  for (const [page, n] of agregats.histo) parPage[page] += n;
  const funnel = new Array(maxReached);
  let cumul = 0;
  for (let p = maxReached; p >= 1; p--) { cumul += parPage[p]; funnel[p - 1] = cumul; }

  const total = {
    shares: shareList.length,
    opened: enriched.filter((x) => x.opens > 0).length,
    opens: enriched.reduce((s, x) => s + x.opens, 0),
    maxPage: enriched.reduce((m, x) => Math.max(m, x.maxPage), 0),
    readers, // sessions distinctes ayant tourné au moins une page
  };
  // ⚠️ « PARLANT » : la réponse DIT ce qu'elle couvre. Une analytique bornée qui ne l'annonce pas
  // est indiscernable d'une analytique complète — le lecteur y voit des chiffres définitifs. Le champ
  // est présent même quand la fenêtre ne coupe rien (la purge à 13 mois arrive avant), pour que
  // l'appelant n'ait jamais à déduire la couverture de l'ABSENCE d'un drapeau.
  return { shares: enriched, total, funnel, fenetreMois: FENETRE_ANALYTIQUE_MOIS };
}

// Vue d'ensemble (tous documents) : stats agrégées par doc_id, pour les badges de la grille + le « top ».
// Sépare bien les OUVERTURES CLIENT (liens tracés = commercial_doc_views) des CONSULTATIONS INTERNES
// (équipe 3D Discovery = commercial_doc_internal_sessions) → la liste peut afficher « vu par l'équipe »
// vs « ouvert par le client » sans mélanger la métrique commerciale.
/**
 * Vue d'ensemble agrégée EN BASE. Rend `null` si la migration 0022 n'est pas appliquée.
 */
async function overviewEnBase(since) {
  const vues = await agregerEnBase("player_stats_overview", { p_depuis: since }, (r) => [String(r.doc_id), {
    opens: Number(r.opens) || 0,
    readers: Number(r.readers) || 0,
    maxPage: Number(r.max_page) || 0,
    lastAt: r.last_at || null,
  }]);
  if (vues === null) return null;
  // ⚠️ LES CONSULTATIONS INTERNES PEUVENT MANQUER, ET ÇA NE DOIT PAS TAIRE LE RESTE. Une base
  // ancienne n'a pas forcément la table ; la vue d'ensemble reste juste pour les ouvertures client.
  // Mais un `catch` qui rend `[]` sans rien dire fait disparaître une moitié du tableau de bord
  // sans laisser de trace — c'est la leçon de la session interne jetée en silence, qui a coûté des
  // semaines à un hôte. On replie ET on le dit.
  let internes = [];
  try {
    internes = (await agregerEnBase("player_stats_overview_internes", { p_depuis: since }, (r) => [String(r.doc_id), {
      opens: Number(r.opens) || 0,
      users: Number(r.readers) || 0,
      lastAt: r.last_at || null,
    }])) || [];
  } catch (erreur) {
    try { PLAYER.errors.capture(erreur, { route: "overview", indice: "consultations internes indisponibles — la vue d'ensemble ne montrera que les ouvertures client" }); } catch { /* jamais bloquant */ }
  }
  return { byDoc: new Map(vues), intByDoc: new Map(internes) };
}

/**
 * La même vue d'ensemble, agrégée EN MÉMOIRE — la définition de référence, et le repli d'un hôte
 * qui n'a pas la 0022. Le banc de base confronte les deux sur les mêmes lignes.
 */
function overviewEnMemoire(views, internal) {
  const list = Array.isArray(views) ? views : [];
  // ⚠️ POURQUOI DES `Map` DANS TOUT CE FICHIER, ET PAS DES OBJETS.
  //
  // Ces agrégateurs étaient des `{}` indexés par des identifiants, des e-mails, des sessions —
  // tous venus du dehors. Une clé héritée y a une sémantique spéciale, et `X[k] = X[k] || {…}`
  // suffit à tout casser :
  //
  //   `byDoc["__proto__"]` ne rend pas `undefined`, il rend `Object.prototype` — qui est VRAI.
  //   Le `|| {…}` ne se déclenche donc pas, et `a` DEVIENT le prototype. Ensuite `a.opens++`
  //   écrit `Object.prototype.opens = NaN`, et `a.readers.add(…)` lève sur `undefined`.
  //
  // ⚠️ Reproduit avec une seule ligne : `TypeError` immédiate, ET la propriété reste sur le
  // prototype POUR TOUT LE PROCESSUS. Sur une instance serverless tiède, la pollution survit aux
  // requêtes suivantes : chaque objet du processus porte alors un `opens`, et n'importe quel
  // `if (x.opens)` ailleurs devient faux. Une ligne de table pour empoisonner un processus.
  //
  // `user_email` est atteignable sans authentification tant que `PLAYER_INTERNAL_STRICT` n'est pas
  // posé (cf. 0.1.22), donc ce n'est pas théorique.
  //
  // Une `Map` n'a pas de prototype à traverser : ses clés sont des données, pas des noms de
  // propriétés. C'est la seule forme qui n'a rien à se rappeler. La garde statique, elle, filtrait
  // sur des NOMS DE VARIABLES (`id`, `k`, `sid` en étaient absents) — une alarme, jamais une
  // barrière. (audit P1-2)
  const byDoc = new Map();
  for (const v of list) {
    const id = v.doc_id || "";
    if (!id) continue;
    let a = byDoc.get(id);
    if (!a) { a = { opens: 0, readers: new Set(), maxPage: 0, lastAt: null }; byDoc.set(id, a); }
    if (v.event === "open") a.opens++;
    if (v.session_id) a.readers.add(v.session_id);
    a.maxPage = Math.max(a.maxPage, pageLue(v.page, v.max_page));
    // Même couplage caché que dans `listSharesForDoc`, et corrigé de la même façon : « dernière
    // activité » se calcule, elle ne se déduit pas du tri de la requête.
    if (!a.lastAt || String(v.at) > String(a.lastAt)) a.lastAt = v.at;
  }
  const intByDoc = new Map();
  for (const s of Array.isArray(internal) ? internal : []) {
    const id = s.doc_id || "";
    if (!id) continue;
    let b = intByDoc.get(id);
    if (!b) { b = { opens: 0, users: new Set(), lastAt: null }; intByDoc.set(id, b); }
    b.opens++;
    if (s.user_email) b.users.add(String(s.user_email).toLowerCase());
    b.lastAt = s.last_at;
  }
  return {
    byDoc: new Map([...byDoc].map(([k, a]) => [k, { opens: a.opens, readers: a.readers.size, maxPage: a.maxPage, lastAt: a.lastAt }])),
    intByDoc: new Map([...intByDoc].map(([k, b]) => [k, { opens: b.opens, users: b.users.size, lastAt: b.lastAt }])),
  };
}

async function overview() {
  // Borne glissante généreuse (24 mois) : ces tables d'événements grossissent sans fin ; sans filtre, le
  // scan intégral se dégrade avec le temps. 24 mois couvre tout l'historique utile pour la vue d'ensemble
  // (opens / lecteurs / dernière activité) sans changer les chiffres actuels. Filtre servi par l'index sur `at`.
  const since = depuisFenetre();
  // ⚠️ AGRÉGER EN BASE D'ABORD. La fenêtre borne le TEMPS, pas le nombre de lignes : rapatrier
  // vingt-quatre mois d'événements pour en rendre quelques dizaines de lignes est un coût qui
  // grandit avec l'historique, pas avec la réponse.
  const agregats = await overviewEnBase(since) || overviewEnMemoire(...await Promise.all([
    // PAGINÉ : au-delà de 1 000 lignes, PostgREST tronquait en silence — et comme le tri
    // est ascendant, c'est le RÉCENT qui disparaissait. Les consultations des trois dernières
    // semaines étaient invisibles du tableau de bord (0 ouverture affichée sur des plans lus).
    PLAYER.db.selectAll(`commercial_doc_views?select=doc_id,event,session_id,page,max_page,at&at=gte.${since}&order=at.asc`),
    PLAYER.db.selectAll(`commercial_doc_internal_sessions?select=doc_id,user_email,last_at&last_at=gte.${since}&order=last_at.asc`).catch(() => []),
  ]));
  const { byDoc, intByDoc } = agregats;
  // La sortie est rendue en JSON : un objet SANS prototype, pour qu'une clé héritée y reste une
  // clé ordinaire jusqu'au bout de la chaîne.
  const out = Object.create(null);
  for (const id of new Set([...byDoc.keys(), ...intByDoc.keys()])) {
    // ⚠️ DES NOMBRES DES DEUX CÔTÉS. Les `Set` ne vivent plus que DANS l'agrégation en mémoire, qui
    // les convertit avant de rendre : c'est ce qui permet aux deux chemins — base et mémoire —
    // d'avoir exactement la même forme, donc à un banc de les confronter champ à champ.
    const a = byDoc.get(id) || { opens: 0, readers: 0, maxPage: 0, lastAt: null };
    const b = intByDoc.get(id) || { opens: 0, users: 0, lastAt: null };
    out[id] = { opens: a.opens, readers: a.readers, maxPage: a.maxPage, lastAt: a.lastAt, internalOpens: b.opens, internalReaders: b.users, internalLastAt: b.lastAt };
  }
  return out;
}

// Parse minimal d'un User-Agent → appareil / OS / navigateur (sans dépendance).
function parseUa(ua) {
  // ⚠️ Bornée AVANT analyse. L'analyse statique signale `Android.*Mobile` comme pouvant revenir en
  // arrière ; mesuré avant de corriger, V8 traite ce motif en temps linéaire même sur 200 000
  // caractères — ce n'était donc pas une lenteur réelle. On borne quand même : la colonne stockée
  // était déjà tronquée à 300, seule l'analyse recevait la chaîne entière. Faire entrer une
  // longueur non bornée dans une expression régulière est une habitude qui finit par coûter.
  const s = String(ua || "").slice(0, 300);
  let device = /Mobile|iPhone|Android.*Mobile/.test(s) ? "Mobile" : /iPad|Tablet/.test(s) ? "Tablette" : "Ordinateur";
  let os = /Windows/.test(s) ? "Windows" : /iPhone|iPad|iOS/.test(s) ? "iOS" : /Mac OS X|Macintosh/.test(s) ? "macOS" : /Android/.test(s) ? "Android" : /Linux/.test(s) ? "Linux" : "—";
  let browser = /Edg\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /Chrome\//.test(s) ? "Chrome" : /Firefox\//.test(s) ? "Firefox" : /Safari\//.test(s) ? "Safari" : "—";
  return { device, os, browser };
}

// Upsert d'une session de consultation (résumé envoyé périodiquement par la visionneuse). Stocke le temps
// PAR page (cumulatif côté client → on remplace), totaux, appareil. Conserve started_at (insert) via merge.
async function upsertSession(share, p, { ip, ua }) {
  const sessionId = String(p.sessionId || "").slice(0, 64);
  if (!sessionId) return;
  const { device, os, browser } = parseUa(ua);
  const row = {
    session_id: sessionId, slug: share.slug, doc_id: share.doc_id, recipient_email: share.recipient_email,
    // Bornées comme la session INTERNE : plafond d'entrées, clés/valeurs numériques, totaux capés.
    num_pages: bornerNombre(p.numPages, BORNES.pages), max_page: mesureBornee({ maxPage: p.maxPage }).max_page,
    total_seconds: bornerNombre(p.totalSeconds, BORNES.secondes) || 0, pages_time: bornerPagesTime(p.pagesTime),
    ua: String(ua || "").slice(0, 300), ip: String(ip || "").slice(0, 60), device, os, browser, last_at: new Date().toISOString(),
  };
  // started_at non touché par l'upsert (default à l'insert ; merge ne l'écrase pas car absent du body).
  await PLAYER.db.request("commercial_doc_sessions?on_conflict=session_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: [row] });
}

/**
 * Le lien RACINE d'une chaîne de re-partages, en remontant `parent_slug`.
 *
 * ⚠️ `created_by` CHANGE À CHAQUE SAUT, et c'est ce qui rend la remontée nécessaire. `createReshare`
 * pose `created_by: parent.recipient_email` — le lien que Paul reçoit de Dana est donc « créé par »
 * Dana, pas par le commercial qui a envoyé le document à Dana. Un filtre naïf sur
 * `created_by = moi` cacherait au commercial les lectures de sa PROPRE descendance : celles qu'il a
 * causées. La portée suit la chaîne d'origine, pas le dernier maillon.
 *
 * ⚠️ ET ELLE ÉCHOUE FERMÉE. Un maillon dont le lien n'existe pas (dérive de données), une chaîne
 * qui boucle : on rend `null` plutôt que d'attribuer au hasard. Un appelant restreint ne verra pas
 * cette session ; `list.all`, qui ne filtre pas, la verra comme avant.
 */
function racineDuLien(slug, parParent, profondeurMax = 64) {
  if (!slug || !parParent.has(slug)) return null;   // lien inconnu — inattribuable
  const vus = new Set();
  let courant = slug;
  for (let saut = 0; saut < profondeurMax; saut += 1) {
    if (vus.has(courant)) return null;              // chaîne qui boucle — inattribuable
    vus.add(courant);
    const parent = parParent.get(courant);
    if (!parent) return courant;                    // pas de parent : c'est la racine
    if (!parParent.has(parent)) return null;        // maillon manquant — inattribuable
    courant = parent;
  }
  return null;                                      // chaîne plus longue que tout re-partage réel
}

/**
 * Sessions de consultation d'un document (détail riche par session) + nom du destinataire.
 *
 * ⚠️ `owner` BORNE CE QUE L'APPELANT VOIT, ET SON ABSENCE ÉTAIT UNE FUITE. Cette lecture rendait
 * `select=*` sur `commercial_doc_sessions` sans aucun filtre — or cette table porte
 * `recipient_email` ET `ip`. Tout membre autorisé à appeler `docshare.sessions` obtenait donc, pour
 * n'importe quel document, l'adresse et l'adresse IP de chaque destinataire, y compris les
 * prospects de ses collègues. C'est exactement ce que `docshare.list` empêche depuis qu'un hôte
 * l'a demandé, avec le commentaire qui l'explique quarante lignes plus haut ; la porte stricte
 * avait une porte large à côté d'elle, et deux appels suffisaient à passer par la seconde.
 *
 * `null` = toutes les sessions (le rôle qui a `list.all`), une adresse = celles dont la chaîne
 * d'origine part d'un lien que cette personne a créé.
 */
async function listSessionsForDoc(docId, owner = null) {
  const id = enc(String(docId || ""));
  const [sessions, shares] = await Promise.all([
    PLAYER.db.request(`commercial_doc_sessions?doc_id=eq.${id}&select=${SELECT_SESSION}&order=last_at.desc&limit=500`),
    // ⚠️ TOUS LES LIENS, RÉPÉTITIONS COMPRISES. La chaîne se remonte par `parent_slug` : un maillon
    // absent de cette lecture casse la remontée et fait échouer fermé une session légitime. Le
    // filtre `is_test` d'avant ne servait qu'à nommer le destinataire ; il ne peut pas servir à
    // reconstruire une filiation.
    PLAYER.db.request(`commercial_doc_shares?doc_id=eq.${id}&select=slug,parent_slug,created_by,recipient_email,recipient_name`),
  ]);
  const liste = Array.isArray(shares) ? shares : [];
  const parSlug = new Map(liste.map((sh) => [sh.slug, sh]));
  const parParent = new Map(liste.map((sh) => [sh.slug, sh.parent_slug || null]));
  const proprietaire = low(owner || "");

  const sortie = [];
  for (const s of (Array.isArray(sessions) ? sessions : [])) {
    const lien = parSlug.get(s.slug) || null;
    const racine = racineDuLien(s.slug, parParent);
    const createurRacine = racine ? low(parSlug.get(racine)?.created_by || "") : "";
    if (proprietaire && createurRacine !== proprietaire) continue;
    const parent = lien && lien.parent_slug ? parSlug.get(lien.parent_slug) || null : null;
    sortie.push({
      ...sessionServie(s),
      recipient_name: (lien && lien.recipient_name) || null,
      // La filiation voyage avec la session : « une session, un lecteur, visible par sa chaîne
      // d'origine » ne se lit pas si la chaîne n'est pas dans la charge utile.
      parent_slug: (lien && lien.parent_slug) || null,
      parent_recipient_email: parent ? parent.recipient_email || null : null,
      parent_recipient_name: parent ? parent.recipient_name || null : null,
    });
  }
  return sortie;
}

/**
 * Ce qu'une session laisse sortir, et ce qu'elle ne laisse pas sortir.
 *
 * ⚠️ UNE LISTE DE CE QUI EST PERMIS, PAS DE CE QU'ON RETIRE. Les deux lectures de sessions
 * demandaient `select=*` et rendaient la ligne entière : ce que la table contient partait par
 * défaut, et une colonne ajoutée demain serait partie sans que personne y pense. Dans ce sens-là
 * l'oubli est une FUITE. Dans l'autre — une colonne neuve qui n'est pas servie — l'oubli est une
 * absence, que le premier lecteur signale. C'est la même inversion que le périmètre de
 * `image-documentee`, appliquée à ce qui SORT.
 *
 * ⚠️ ET L'IP N'EN EST PLUS. `docs/RETENTION.md` l'appelle en toutes lettres « the most sensitive
 * datum in the schema », et rien dans ce dépôt ne la LIT : elle était écrite par `upsertSession` et
 * ne servait qu'à être rendue. Une fiche commerciale n'a pas à porter l'adresse d'un lecteur pour
 * dire qu'il a lu quatre pages en six minutes.
 *
 * ⚠️ ET LE MÊME PRODUIT A DÉJÀ TRANCHÉ AILLEURS. Les participants d'une présentation n'ont pas leur
 * IP mais un `creator_ip_hash` — un HMAC salé, lié au slug pour qu'on ne puisse pas corréler une
 * adresse d'une présentation à l'autre (0.1.114). Deux décisions opposées sur la même donnée dans
 * le même produit ; celle-ci était la permissive, et personne ne les avait confrontées.
 */
const CHAMPS_SERVIS = [
  "session_id", "slug", "doc_id", "recipient_email",
  "num_pages", "max_page", "total_seconds", "pages_time",
  "device", "os", "browser",
  "started_at", "last_at",
];

/**
 * Les colonnes qu'on NE sert PAS, avec la raison — pour qu'une absence soit une décision.
 *
 * ⚠️ ET C'EST BIEN UNE LISTE DE RAISONS, PAS DE CASES COCHÉES. Une colonne retirée sans motif écrit
 * revient au bout de six mois, parce que personne ne sait pourquoi elle n'était pas là.
 */
const CHAMPS_RETENUS = {
  ip: "adresse IP en clair — « the most sensitive datum in the schema » selon docs/RETENTION.md, "
    + "que rien ne lit et dont une fiche de lecture n'a pas besoin ; les participants d'une "
    + "présentation n'ont, eux, qu'un HMAC salé de la leur",
  ua: "User-Agent brut — un vecteur d'empreinte, et surtout REDONDANT : `parseUa` en tire "
    + "`device`, `os` et `browser` à l'écriture, et ces trois-là sont servis. La chaîne complète "
    + "ne porte rien de plus qu'un lecteur de fiche lise ; elle porte seulement de quoi "
    + "reconnaître un appareil d'une session à l'autre. Elle reste STOCKÉE (docs/RETENTION.md la "
    + "purge à treize mois) : ne plus la servir et ne plus la garder sont deux décisions",
};

/** La projection d'une ligne de session : ce qui sort, et rien d'autre. */
const sessionServie = (s) => Object.fromEntries(CHAMPS_SERVIS.filter((c) => c in s).map((c) => [c, s[c]]));

/** Le `select=` qui descend dans la requête — la MÊME liste, pas une seconde écriture. */
const SELECT_SESSION = CHAMPS_SERVIS.join(",");

/**
 * Les liens nommés, plus TOUS leurs ancêtres, en remontant `parent_slug` par vagues.
 *
 * ⚠️ LA CHAÎNE NE TIENT PAS DANS UNE SEULE LECTURE. Pour un document, `listSessionsForDoc` lit tous
 * ses liens d'un coup et la remontée est locale. Ici les sessions viennent de documents quelconques :
 * on ne connaît au départ que les liens qui les portent, et leurs parents sont ailleurs. On remonte
 * donc par vagues, en ne redemandant jamais un `slug` déjà lu.
 *
 * ⚠️ ET LE NOMBRE DE VAGUES EST BORNÉ. Une chaîne de re-partages réelle fait un ou deux sauts ; huit
 * vagues couvrent très large. Au-delà, on rend ce qu'on a : la remontée qui s'appuie dessus échoue
 * alors fermée, ce qui est le bon sens de l'erreur — on ne montre pas une session qu'on n'a pas su
 * rattacher.
 */
async function liensEtAncetres(slugs, vaguesMax = 8) {
  const parSlug = new Map();
  let aLire = [...new Set(slugs.filter(Boolean))];
  for (let vague = 0; vague < vaguesMax && aLire.length; vague += 1) {
    const liste = aLire.map((x) => `"${String(x).replace(/[",()]/g, "")}"`).join(",");
    const lus = await PLAYER.db.request(`commercial_doc_shares?slug=in.(${enc(liste)})&select=slug,parent_slug,created_by,recipient_email,recipient_name,doc_id,doc_title`);
    const vus = Array.isArray(lus) ? lus : [];
    if (!vus.length) break;
    for (const sh of vus) parSlug.set(sh.slug, sh);
    aLire = [...new Set(vus.map((sh) => sh.parent_slug).filter((x) => x && !parSlug.has(x)))];
  }
  return parSlug;
}

/**
 * Le curseur d'une page : l'horodatage de la dernière ligne examinée, ET les sessions déjà rendues
 * à CET horodatage.
 *
 * ⚠️ `last_at` NE SUFFIT PAS. Deux sessions peuvent porter le même horodatage — deux battements
 * dans la même milliseconde — et un curseur qui ne retiendrait que le temps sauterait l'une des
 * deux (`lt`) ou la rendrait deux fois (`lte`).
 *
 * ⚠️ ET LA FORME ÉVIDENTE EST INTERDITE ICI, POUR UNE RAISON ÉCRITE. La façon habituelle
 * d'écrire ça est un `or=(last_at.lt.T,and(last_at.eq.T,session_id.lt.ID))` — et `ci.yml` refuse
 * `or=(` et `and=(` dans `server/*.js` : « ce qui coûte, ce sont les jointures imbriquées et les
 * arbres booléens — là, un portage cesse d'être une traduction et devient une réécriture ». Le
 * zéro qu'annonçait `docs/API.md` n'était pas un nombre périmé, c'était une POLITIQUE, et je l'ai
 * pris pour l'autre avant que la garde ne me reprenne.
 *
 * La forme portable dit la même chose sans arbre booléen : « au plus tard que T, et pas l'une de
 * celles-ci » — `last_at=lte.T & session_id=not.in.(…)`, qui se traduit mot pour mot en
 * `WHERE last_at <= T AND session_id NOT IN (…)`. La liste ne grandit que pour les ex æquo de
 * l'horodatage de bord, et chaque page ajoute au moins une exclusion ou avance le temps : la
 * progression est garantie, sans quoi une page d'ex æquo tournerait en rond.
 */
const curseurDe = (at, ids) => (at ? `${at}|${[...ids].join(",")}` : null);

function curseurLu(brut) {
  const texte = String(brut || "");
  const coupe = texte.indexOf("|");
  if (coupe <= 0) return null;
  const at = texte.slice(0, coupe);
  const ids = texte.slice(coupe + 1).split(",").filter(Boolean);
  // Un curseur qu'on ne sait pas lire n'est pas « le début » : ce serait rendre la première page à
  // qui demandait la troisième, en silence. On le REFUSE, et l'appelant le saura.
  if (!ids.length || Number.isNaN(Date.parse(at))) return null;
  return { at, ids };
}

/**
 * Toutes les sessions d'un DESTINATAIRE, tous documents confondus.
 *
 * ⚠️ LA PORTÉE EST CELLE DE `listSessionsForDoc`, POUR LA MÊME RAISON — et elle ne peut pas être
 * poussée dans la requête. « La chaîne d'origine part d'un lien que j'ai créé » est récursif :
 * `created_by` change à chaque saut de re-partage. On lit donc une page de CANDIDATS, on résout
 * leurs chaînes, et on ne rend que ce qui appartient à l'appelant.
 *
 * ⚠️ CONSÉQUENCE ASSUMÉE, ET ÉCRITE PLUTÔT QUE MASQUÉE : une page peut être PLUS COURTE que
 * `limite` sans être la dernière. Le curseur rendu est la position de la dernière ligne EXAMINÉE,
 * pas de la dernière rendue — donc rien n'est sauté ni rendu deux fois, et la fin se lit à
 * `curseur: null`, jamais à la longueur de la page. Boucler jusqu'à remplir la page ferait payer à
 * un appelant restreint un balayage dont il ne verrait rien, et le nombre de requêtes deviendrait
 * une fonction de ce que ses collègues ont envoyé.
 *
 * `depuis` borne le temps (défaut : la fenêtre analytique). L'appelant peut remonter plus loin en
 * la passant explicitement — la fiche promet « tout l'historique », vingt-quatre mois n'en sont que
 * le défaut raisonnable.
 */
async function listSessionsForRecipient(email, { owner = null, depuis = null, apres = null, limite = 100 } = {}) {
  const destinataire = low(email);
  if (!destinataire) return { sessions: [], curseur: null };
  const borne = depuis || depuisFenetre();
  const taille = Math.min(Math.max(Number(limite) || 100, 1), 500);
  const position = curseurLu(apres);

  // ⚠️ « AU PLUS TARD QUE T, ET PAS L'UNE DE CELLES-CI » — deux filtres plats, pas un arbre booléen.
  // `not.in.(…)` se traduit en `NOT IN (…)`, que toute base sait faire ; c'est ce qui distingue une
  // traduction d'une réécriture, et c'est la règle que `ci.yml` fait respecter.
  const apresQuoi = position
    ? `&last_at=lte.${enc(position.at)}&session_id=not.in.(${enc(position.ids.map((x) => `"${String(x).replace(/[",()]/g, "")}"`).join(","))})`
    : "";
  const candidats = await PLAYER.db.request(
    `commercial_doc_sessions?recipient_email=eq.${enc(destinataire)}&last_at=gte.${enc(borne)}${apresQuoi}`
    + `&select=${SELECT_SESSION}&order=last_at.desc,session_id.desc&limit=${taille}`);
  const lignes = Array.isArray(candidats) ? candidats : [];
  if (!lignes.length) return { sessions: [], curseur: null };

  const parSlug = await liensEtAncetres(lignes.map((s) => s.slug));
  const parParent = new Map([...parSlug].map(([slug, sh]) => [slug, sh.parent_slug || null]));
  const proprietaire = low(owner || "");

  const sessions = [];
  for (const s of lignes) {
    const lien = parSlug.get(s.slug) || null;
    const racine = racineDuLien(s.slug, parParent);
    const createurRacine = racine ? low(parSlug.get(racine)?.created_by || "") : "";
    if (proprietaire && createurRacine !== proprietaire) continue;
    const parent = lien && lien.parent_slug ? parSlug.get(lien.parent_slug) || null : null;
    sessions.push({
      ...sessionServie(s),
      doc_title: (lien && lien.doc_title) || null,
      recipient_name: (lien && lien.recipient_name) || null,
      parent_slug: (lien && lien.parent_slug) || null,
      parent_recipient_email: parent ? parent.recipient_email || null : null,
      parent_recipient_name: parent ? parent.recipient_name || null : null,
    });
  }
  // La page est pleine ⇒ il reste peut-être quelque chose : on rend l'horodatage de la dernière
  // ligne EXAMINÉE, et les sessions déjà servies à cet horodatage. Elle ne l'est pas ⇒ la source
  // est épuisée, et `null` le dit sans ambiguïté.
  if (lignes.length < taille) return { sessions, curseur: null };
  const bord = lignes[lignes.length - 1].last_at;
  const dejaVues = lignes.filter((s) => s.last_at === bord).map((s) => s.session_id);
  // Le curseur entrant portait le MÊME horodatage de bord ⇒ ses exclusions valent encore, sinon
  // les ex æquo déjà servis reviendraient. Il en portait un autre ⇒ elles sont sans objet.
  const exclues = position && position.at === bord ? [...new Set([...position.ids, ...dejaVues])] : dejaVues;
  return { sessions, curseur: curseurDe(bord, exclues) };
}

// Envoi AUTO du re-partage via 3D Discovery (Resend). Contenu 100% templé (pas de texte libre → anti-spam),
// attribué au recommandeur (destinataire du lien parent), reply-to vers lui. Best-effort.
async function sendReshareEmail({ parent, childSlug, origin, toEmail, toName }) {
  const e = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const url = `${origin.replace(/\/$/, "")}/doc/${childSlug}`;
  const forwarder = parent.recipient_name || parent.recipient_email || "Un contact 3D Discovery";
  const title = parent.doc_title || parent.file_name || "Document";
  let logoUrl = ""; try { logoUrl = await PLAYER.branding.logo(); } catch { /* sans logo */ }
  const hello = toName && toName.trim() ? `Bonjour ${e(toName.trim())},` : "Bonjour,";
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;color:#1c1c1c">
    ${logoUrl ? `<div style="text-align:center;padding:8px 0 18px"><img src="${e(logoUrl)}" alt="3D Discovery" style="height:34px"></div>` : `<div style="text-align:center;font-weight:800;font-size:18px;padding:8px 0 18px">3D Discovery</div>`}
    <p style="font-size:15px">${hello}</p>
    <p style="font-size:15px"><b>${e(forwarder)}</b> vous recommande ce document&nbsp;:</p>
    <div style="border:1px solid #e7e3db;border-radius:12px;padding:16px 18px;margin:14px 0">
      <div style="font-weight:700;font-size:16px;margin-bottom:12px">${e(title)}</div>
      <a href="${e(url)}" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;padding:11px 18px;border-radius:9px">Ouvrir le document</a>
    </div>
    <p style="font-size:13px;color:#777">Vous pouvez répondre directement à cet email pour échanger avec ${e(forwarder)}.</p>
    <p style="font-size:11px;color:#999;margin-top:22px">Propulsé par 3D Discovery — visualisation 3D &amp; visites immersives.</p>
  </div>`;
  // ⚠️ LES CHAMPS STRUCTURÉS ACCOMPAGNENT LE HTML, ILS NE LE REMPLACENT PAS.
  //
  // Un hôte qui envoie avec sa propre identité voudra composer avec son gabarit — et surtout
  // n'y laisser entrer AUCUN texte fourni par l'appelant. Notre HTML, lui, insère `toName` : un
  // champ libre, échappé mais choisi par qui détient le lien, dans un message signé par l'hôte.
  // Lui donner les éléments séparés, c'est lui permettre de n'en reprendre aucun.
  //
  // Le HTML reste là pour un hôte qui ne veut pas composer : rien ne casse pour l'existant.
  return PLAYER.mail.send({
    to: toEmail,
    subject: `${forwarder} vous recommande : ${title}`,
    html,
    replyTo: parent.recipient_email || undefined,
    kind: "reshare",
    doc: { title, url },
    from: { name: parent.recipient_name || null, email: parent.recipient_email || null },
    // Fourni par l'appelant, donc à traiter comme tel : un hôte prudent l'ignore.
    untrusted: { toName: (toName || "").trim() || null },
  });
}

async function revokeShare(slug) {
  // La date borne la rétention (RETENTION.md) — écrite seulement là où la colonne existe (0013).
  const dateDispo = await require("./schema").attendue("revocationDatee");
  await PLAYER.db.request(`commercial_doc_shares?slug=eq.${enc(String(slug || ""))}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { revoked: true, ...(dateDispo ? { revoked_at: new Date().toISOString() } : {}) } });
}

// Soft wall : (dé)verrouille l'accès d'un lien /doc — require_auth=true → connexion visiteur exigée.
async function setShareAuth(slug, requireAuth) {
  await PLAYER.db.request(`commercial_doc_shares?slug=eq.${enc(String(slug || ""))}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { require_auth: !!requireAuth } });
  return { ok: true };
}

// — Consultations INTERNES (équipe), table dédiée → n'affecte PAS les stats prospects. —
// Upsert d'une session interne (depuis l'aperçu interne de la visionneuse).
// ⚠️ CES CHAMPS VIENNENT DU NAVIGATEUR, DONC ILS SONT DES AFFIRMATIONS, PAS DES MESURES.
//
// La population INTERNE est celle dont le produit dit qu'elle ne doit jamais être mélangée aux
// prospects : « ce client a lu douze minutes » ne vaut que si un collègue relisant le document
// n'entre pas dans le même compte. Or n'importe qui pouvait écrire une session interne avec
// n'importe quel e-mail et n'importe quelle durée.
//
// Les bornes ci-dessous ne rendent pas la donnée authentique — elles empêchent qu'elle soit
// ABSURDE, et qu'un appel répété fasse grossir la base sans limite. L'authenticité, elle, demande
// que l'hôte se porte garant de l'identité (jeton signé) : c'est le second volet, et il est
// signalé au point d'entrée plutôt qu'ici.
function bornerPagesTime(brut) {
  const src = (brut && typeof brut === "object" && !Array.isArray(brut)) ? brut : {};
  const out = {};
  let n = 0;
  for (const k in src) {
    if (++n > BORNES.entreesPagesTime) break;
    const page = Number.isFinite(+k) ? Math.trunc(+k) : null;
    if (page == null || page < 0 || page > BORNES.pages) continue;
    out[String(page)] = bornerNombre(src[k], BORNES.secondes) || 0;
  }
  return out;
}

// ⚠️ `ip` N'EST PLUS LU, ET LA SIGNATURE LE DIT. L'appelant continue de le passer — il ne sait pas
// ce que chaque table conserve, et ce n'est pas à lui de le savoir. Mais le garder en paramètre
// nommé laisserait croire qu'il sert : c'est comme ça qu'une donnée revient dans une ligne où elle
// n'a rien à faire. Une lecture interne, c'est un collègue ; on ne conserve pas son adresse.
async function upsertInternalSession(p, { ip: _ip, ua }) {
  const sessionId = String(p.sessionId || "").slice(0, 64);
  // ⚠️ UN REJET MUET A COÛTÉ DES SEMAINES À UN HÔTE.
  //
  // Cette garde est juste — une session sans document ne mesure rien — mais elle ne DISAIT rien.
  // Le second hôte a monté son suivi interne, l'a cru en service, et a découvert bien plus tard que
  // la table était vide : son `docId` ne partait pas, et chaque battement était jeté ici en silence.
  //
  // ⚠️ Ce n'est pas la garde qui était en cause, c'est son mutisme. Une mesure qui ne remonte rien
  // est indistinguable d'une mesure qui n'a rien à remonter : personne ne va chercher une panne
  // qu'aucun signal n'annonce. La même leçon que le trou de session interne signalé une fois par
  // heure en 0.1.22 — un état anormal qu'on ne dit pas devient l'état normal.
  //
  // Une fois par heure suffit : le but est qu'un exploitant qui ouvre ses journaux tombe dessus,
  // pas de compter les rejets. Demandé par le second hôte, à qui ça aurait fait gagner des semaines.
  if (!sessionId || !p.docId) {
    try {
      if (await PLAYER.limits.allow("intsess:jetee", 1, 3600)) {
        const manque = !sessionId ? "sessionId" : "docId";
        PLAYER.errors.capture(new Error(`session interne jetée : ${manque} absent — rien ne sera mesuré tant qu'il manque`), { route: "internal-session" });
      }
    } catch { /* un journal ne doit jamais empêcher une lecture */ }
    return;
  }
  const { device, os, browser } = parseUa(ua);
  const row = {
    session_id: sessionId, doc_id: String(p.docId).slice(0, 200), user_email: low(p.userEmail).slice(0, 160) || null,
    user_name: (p.userName || "").trim().slice(0, 120) || null,
    // ⚠️ LES MÊMES BORNES QUE `upsertSession`, PAS UNE SECONDE ÉCRITURE DES MÊMES BORNES. Cette
    // fonction redéfinissait `num`, `borne` et la boucle de `pages_time` en tête de son corps,
    // alors que `bornerNombre` et `bornerPagesTime` vivaient quarante lignes plus haut et faisaient
    // caractère pour caractère la même chose. Le comportement était le même — c'est précisément ce
    // qui rend ce doublon dangereux : rien ne le signalait, et rien n'aurait signalé le jour où
    // l'une des deux copies aurait bougé. Un fait écrit à deux endroits diverge tant que personne
    // ne les confronte, et ici personne ne pouvait. (Audit CODEX du 26/08, P3.)
    num_pages: bornerNombre(p.numPages, BORNES.pages), max_page: bornerNombre(p.maxPage, BORNES.pages),
    total_seconds: bornerNombre(p.totalSeconds, BORNES.secondes) || 0,
    // ⚠️ Un objet libre venu du dehors : sans plafond, un seul appel peut écrire un JSON de la
    // taille qu'il veut, autant de fois qu'il veut. On garde la forme, bornée.
    pages_time: bornerPagesTime(p.pagesTime),
    // ⚠️ NI `ua` NI `ip` ICI, ET C'EST LE CORRECTIF — PAS UNE COLONNE À AJOUTER.
    //
    // Ces deux champs partaient vers une table qui ne les a pas. PostgREST refusait l'insertion
    // (« column "ua" ... does not exist »), le `catch` de l'appelant avalait le refus, et la route
    // répondait `{"ok":true}`. Le suivi interne n'a donc JAMAIS rien écrit — ni chez le second
    // hôte, ni chez nous : notre table de production comptait zéro ligne.
    //
    // ⚠️ Le schéma avait raison, c'est le code qui mentait. Une lecture INTERNE, c'est un collègue :
    // `device`, `os` et `browser` — dérivés — suffisent, et on ne conserve pas l'agent complet ni
    // l'adresse de ses propres équipes. La table des sessions EXTERNES les porte, elle, parce que
    // ce n'est ni la même population ni la même promesse.
    //
    // Corriger en AJOUTANT les colonnes aurait fait l'inverse : mettre le schéma au niveau du code
    // au lieu du code au niveau de l'intention. Ce qu'on garde sur ses propres équipes ne se décide
    // pas par un message d'erreur PostgREST.
    //
    // Trouvé par le second hôte, vérifié en rejouant l'insertion.
    device, os, browser, last_at: new Date().toISOString(),
  };
  await PLAYER.db.request("commercial_doc_internal_sessions?on_conflict=session_id", { method: "POST", headers: { Prefer: "resolution=merge-duplicates,return=minimal" }, body: [row] });
}

// Agrégat interne d'un document : nb de consultations (sessions), lecteurs distincts, détail par membre.
async function internalStatsForDoc(docId) {
  const rows = await PLAYER.db.request(`commercial_doc_internal_sessions?doc_id=eq.${enc(String(docId || ""))}&select=user_email,user_name,max_page,total_seconds,last_at&order=last_at.desc&limit=500`);
  const list = Array.isArray(rows) ? rows : [];
  // ⚠️ La clé est un e-mail que l'appelant choisit — c'est le cas atteignable sans authentification.
  const byUser = new Map();
  for (const r of list) {
    const k = low(r.user_email) || (r.user_name || "?");
    let u = byUser.get(k);
    if (!u) { u = { email: r.user_email || null, name: r.user_name || null, opens: 0, maxPage: 0, seconds: 0, lastAt: null }; byUser.set(k, u); }
    u.opens++;
    u.maxPage = Math.max(u.maxPage, pageLue(r.max_page));
    u.seconds += Number(r.total_seconds) || 0;
    if (!u.lastAt || r.last_at > u.lastAt) u.lastAt = r.last_at;
    if (!u.name && r.user_name) u.name = r.user_name;
  }
  const users = [...byUser.values()].sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));
  return { opens: list.length, readers: users.length, lastAt: list[0]?.last_at || null, users };
}

module.exports = {
  cleIdempotence, init, createShare, createReshare, sendReshareEmail, getShareBySlug, logView, upsertSession, listSharesForDoc, listSessionsForDoc, listSessionsForRecipient, racineDuLien, curseurDe, curseurLu, sessionServie, CHAMPS_SERVIS, CHAMPS_RETENUS, revokeShare, setShareAuth, overview, upsertInternalSession, internalStatsForDoc };
