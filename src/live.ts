// Cœur logique de la présentation en direct : identité des participants, dédoublonnage de la
// présence, échappement et mise en forme des messages, prédicats de modération et de notification.
//
// PÉRIMÈTRE : uniquement ce qui ne touche PAS au DOM. Le rendu (messages, panneau, dialogues,
// vignettes PDF) reste pour l'instant dans le template de api/doc.js — il demandera un harnais
// DOM pour être testé, et c'est un chantier distinct. Ce qui est ici est ce qui a réellement
// cassé par le passé, et donc ce qui mérite des tests en premier :
//
//   - la présence dédoublonnée : sans identité stable, un participant reconnecté apparaissait
//     DEUX fois (« je me vois deux fois ») ;
//   - l'échappement : un titre ou un message contenant du balisage a déjà produit un XSS stocké
//     sur la page audience ;
//   - l'identité persistée : c'est elle qui permet de recoller les statistiques de présence
//     d'un visiteur anonyme d'une session à l'autre.

/** Stockage persistant minimal. `localStorage` lève en navigation privée → tout est en `try`. */
import { PRESENT_WRITE_TIMEOUT_MS } from "./cadence";

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

// ⚠️ Ces clés sont un CONTRAT avec les navigateurs déjà passés sur une présentation : les changer
// fait perdre l'identité anonyme (statistiques de présence recollées) et la propriété des messages
// (le droit de modifier/supprimer les siens). Neutralisation du préfixe = au moment de l'ouverture.
export const STORAGE_KEYS = {
  attendeeKey: "3dd-present-attkey",
  authorToken: "3dd-present-authtoken",
  chatMuted: "3dd-present-mute",
  presenceId: "3dd-present-uid",
} as const;

export interface Participant {
  uid?: string;
  email?: string;
  name?: string;
  avatar?: string;
  role?: string;
}

export interface Me {
  email?: string;
  name?: string;
  role?: string;
  member?: boolean;
  avatar?: string;
}

export interface ChatMessage {
  id?: number | string;
  author_email?: string;
  author_name?: string;
  author_avatar?: string;
  body?: string;
  deleted?: boolean;
}

// ── Échappement et mise en forme ───────────────────────────────────────────────────────────────

/** Échappe pour insertion dans du HTML. Tout texte venant d'un participant passe par ici. */
export function escapeHtml(value: unknown): string {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Initiales d'un nom, pour l'avatar de repli. */
export function initials(name?: string): string {
  const parts = (name || "?").trim().split(/\s+/);
  return (((parts[0] || "")[0] || "?") + ((parts[1] || "")[0] || "")).toUpperCase();
}

/** Avatar : l'image si elle existe, sinon les initiales. Les deux sont échappées. */
export function avatarHtml(url?: string, name?: string): string {
  return url ? `<img src="${escapeHtml(url)}" alt="">` : escapeHtml(initials(name));
}

/**
 * Corps d'un message, prêt à insérer : échappé D'ABORD, puis enrichi de liens et de mentions.
 * L'ordre est vital — enrichir avant d'échapper rendrait le balisage de l'auteur exécutable.
 * Seuls `http(s)://` sont transformés en liens : pas de `javascript:` ni de `data:`.
 */
export function formatMessageBody(body: unknown): string {
  let out = escapeHtml(body);
  out = out.replace(
    /(https?:\/\/[^\s<]+)/g,
    (url) => `<a href="${url}" target=_blank rel=noreferrer class=cm-link>${url}</a>`,
  );
  out = out.replace(
    /(^|\s)@([\p{L}0-9_'.-]+)/gu,
    (_all, before: string, handle: string) => `${before}<span class=cm-mention>@${handle}</span>`,
  );
  return out;
}

// ── Présence ───────────────────────────────────────────────────────────────────────────────────

/**
 * Aplatit l'état de présence Realtime en une liste SANS DOUBLON.
 *
 * La clé de présence du canal contient un identifiant tiré au sort à chaque chargement de page :
 * un participant qui se reconnecte y apparaît donc deux fois. On collapse sur une identité
 * STABLE (`uid`, sinon email, sinon nom) — c'est ce qui a corrigé « je me vois deux fois ».
 * En cas de collision, la métadonnée du présentateur l'emporte : c'est elle qui porte le rôle.
 */
export function flattenPresence(state: Record<string, Participant[]> | null | undefined): Participant[] {
  const byIdentity: Record<string, Participant> = {};
  const order: string[] = [];
  for (const key in state || {}) {
    for (const member of (state || {})[key] || []) {
      // Participant sans aucune identité : on ne peut pas le dédoublonner, on le garde tel quel
      // plutôt que de fondre des inconnus distincts en un seul.
      const identity = String(member.uid || member.email || member.name || "").toLowerCase()
        || `_${key}_${order.length}`;
      if (!byIdentity[identity]) { byIdentity[identity] = member; order.push(identity); }
      else if (member.role === "presenter") byIdentity[identity] = member;
    }
  }
  return order.map((id) => byIdentity[id]);
}

// ── Identité ───────────────────────────────────────────────────────────────────────────────────

function readStore(store: KeyValueStore | null | undefined, key: string): string | null {
  try { return store ? store.getItem(key) : null; } catch { return null; }
}

function writeStore(store: KeyValueStore | null | undefined, key: string, value: string): void {
  try { store?.setItem(key, value); } catch { /* navigation privée, quota : sans effet */ }
}

/**
 * Clé stable de CE NAVIGATEUR pour les statistiques de présence. Sans elle, chaque rechargement
 * compterait comme un nouveau participant.
 *
 * ⚠️ ELLE NE PORTE PLUS L'ADRESSE E-MAIL D'UN MEMBRE, ET C'EST LE CORRECTIF. Elle la renvoyait,
 * et le serveur acceptait la clé telle quelle : n'importe quel participant anonyme pouvait poster
 * la clé d'un collègue — c'est-à-dire son adresse — pour écraser sa ligne, changer le nom et
 * l'avatar affichés, et gonfler son temps de présence. Ce sont les statistiques de présentation,
 * c'est-à-dire ce que ce produit vend.
 *
 * La clé d'un membre se dérive désormais SERVEUR, depuis le jeton d'accès vérifié. Le navigateur
 * n'a donc plus aucune raison d'envoyer une adresse ici, et cette fonction n'a plus besoin de
 * savoir qui est le lecteur : elle répond « ce navigateur-ci », rien de plus.
 *
 * ⚠️ ET ELLE EST TIRÉE AU SORT SÉRIEUSEMENT. C'était `Math.random()` — acceptable tant que la clé
 * n'était qu'un identifiant d'analyse. Elle est maintenant la seule chose qui sépare deux
 * participants anonymes : la même correction qu'en 0.1.23 pour le jeton d'auteur du chat, dont
 * l'aide vit vingt lignes plus bas et n'avait pas été rapportée ici.
 */
export function attendeeKey(
  store?: KeyValueStore | null,
  fallbackId = "anon",
  randomId: () => string = valeurImprevisible,
): string {
  try {
    if (!store) return `anon-${fallbackId}`;
    const existing = store.getItem(STORAGE_KEYS.attendeeKey);
    if (existing) return existing;
    const created = `anon-${randomId()}`;
    store.setItem(STORAGE_KEYS.attendeeKey, created);
    return created;
  } catch {
    // Stockage indisponible (navigation privée, quota) : la clé ne survivra pas au rechargement,
    // le participant comptera pour deux visites. Dégradation acceptée, jamais une erreur.
    return `anon-${fallbackId}`;
  }
}

/**
 * Valeur imprévisible, pour ce qui AUTORISE.
 *
 * ⚠️ `Math.random()` n'est pas fait pour ça : la suite est déterministe à partir de l'état interne
 * du moteur, et deux exécutions voisines produisent des valeurs voisines. Acceptable pour un
 * identifiant d'analyse, jamais pour un jeton qui décide d'un droit.
 *
 * Le repli existe pour les environnements sans `crypto` — un très vieux navigateur, ou un test.
 * Il n'est PAS silencieux : mieux vaut un jeton faible qu'un chat qui ne fonctionne pas, mais on
 * ne veut pas que ce cas devienne le cas normal sans que personne ne le sache.
 */
function valeurImprevisible(): string {
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "");
  if (c && typeof c.getRandomValues === "function") {
    const octets = c.getRandomValues(new Uint8Array(24));
    return Array.from(octets, (o) => o.toString(16).padStart(2, "0")).join("");
  }
  try { console.warn("[player] crypto indisponible : jeton d'auteur affaibli"); } catch { /* sans console */ }
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

/**
 * Jeton d'auteur : c'est lui qui prouve « ce message est le mien » pour le modifier ou le
 * supprimer. Persistant, propre au navigateur, jamais envoyé par le serveur.
 *
 * ⚠️ C'est un jeton D'AUTORISATION, pas un identifiant : qui le devine peut modifier et supprimer
 * les messages d'un autre participant. Il était tiré de `Math.random()`.
 */
export function authorToken(
  store?: KeyValueStore | null,
  randomId: () => string = valeurImprevisible,
): string {
  const existing = readStore(store, STORAGE_KEYS.authorToken);
  if (existing) return existing;
  const created = randomId();
  writeStore(store, STORAGE_KEYS.authorToken, created);
  return created;
}

/** Identifiant utilisé pour marquer ses propres réactions emoji. */
export function reactorId(me: Me | null | undefined): string {
  return String((me && (me.email || me.name)) || "").toLowerCase();
}

// ── Prédicats ──────────────────────────────────────────────────────────────────────────────────

/** Ce message est-il de moi ? Par email si connu, sinon par nom entre anonymes. */
export function isMine(msg: ChatMessage | null | undefined, me: Me | null | undefined): boolean {
  if (!msg || !me) return false;
  if (msg.author_email && me.email) return msg.author_email === me.email;
  if (!msg.author_email && !me.email) return msg.author_name === me.name;
  return false;
}

/** Seul le présentateur modère. Le rôle vient du serveur (control_token valide), pas du client. */
export function canModerate(me: Me | null | undefined): boolean {
  return !!(me && me.role === "presenter");
}

/** Suis-je cité ? On compare au PRÉNOM, comme dans le chat de l'application. */
export function isMentioned(msg: ChatMessage | null | undefined, me: Me | null | undefined): boolean {
  if (!me || !me.name) return false;
  const firstName = (me.name.split(/\s+/)[0] || "").toLowerCase();
  if (!firstName) return false;
  return String((msg && msg.body) || "").toLowerCase().includes(`@${firstName}`) && !isMine(msg, me);
}

// ── Notifications de chat ──────────────────────────────────────────────────────────────────────

/**
 * Faut-il compter ce message comme non lu ?
 * `historyLoaded` est la garde décisive : sans elle, l'historique rechargé au join ferait
 * apparaître un badge de dizaines de messages déjà vus.
 */
export function shouldNotify(input: {
  msg: ChatMessage | null | undefined;
  me: Me | null | undefined;
  historyLoaded: boolean;
  chatHidden: boolean;
}): boolean {
  const { msg, me, historyLoaded, chatHidden } = input;
  if (!historyLoaded) return false;
  if (!msg || msg.deleted) return false;
  if (isMine(msg, me)) return false;
  return chatHidden;
}

/** Libellé du badge de non-lus : au-delà de 9, on écrit « 9+ ». */
export function unreadLabel(count: number): string {
  if (!count || count <= 0) return "";
  return count > 9 ? "9+" : String(count);
}

// ── Ordonnanceur borné pour les relectures ────────────────────────────────────────────────────
//
// ⚠️ CE QUI ÉTAIT ÉCRIT AVANT, ET POURQUOI C'ÉTAIT FAUX.
//
//     function relireEtat(){ clearTimeout(t); t = setTimeout(relire, 120); }
//
// Le commentaire disait « groupé : dix diffusions d'affilée ne doivent pas produire dix requêtes ».
// L'intention est bonne, la forme la retourne : `clearTimeout` REPOUSSE l'échéance. Un participant
// qui diffuse toutes les 100 ms repousse donc la relecture indéfiniment — elle n'arrive JAMAIS.
//
// Or depuis 0.1.19 toute la défense du canal public repose sur cette relecture : on cesse de croire
// le transport, on relit la source de vérité. Affamer la relecture ne falsifie rien — ça empêche
// simplement l'audience d'apprendre quoi que ce soit. Les pages ne tournent plus, le chat se fige,
// et aucune erreur ne le dit.
//
// ⚠️ Et l'inverse est vrai aussi : des signaux espacés d'un peu plus que le délai déclenchent une
// requête par signal, POUR CHAQUE SPECTATEUR. Le canal public devient un amplificateur vers l'API.
//
// Signalé par la seconde passe d'audit (P0-2). Quatre propriétés, chacune testée :
//
//   1. un signal en attente ne se repousse pas — la première échéance tient ;
//   2. une seule requête en vol à la fois ;
//   3. jamais plus d'une exécution par `minMs`, quelle que soit la cadence des signaux ;
//   4. le DERNIER signal est toujours servi : ce qui arrive pendant une exécution en déclenche
//      une autre. Sans ça, borner reviendrait à perdre le signal qui comptait.

export interface Ordonnanceur {
  /** Un événement est arrivé : il faut relire, tôt ou tard, mais une seule fois de trop jamais. */
  signaler(): void;
  /** Relit maintenant si la cadence le permet — pour le filet périodique. */
  maintenant(): void;
  /** Arrête tout (démontage de la page). */
  arreter(): void;
}

export function createScheduler(
  executer: (fini: () => void) => void,
  options: {
    minMs?: number;
    now?: () => number;
    // ⚠️ Les minuteurs sont injectables pour que les tests puissent avancer le temps eux-mêmes :
    // une propriété de cadence ne se vérifie pas en attendant vraiment 300 ms.
    setTimer?: (f: () => void, d: number) => unknown;
    clearTimer?: (h: unknown) => void;
  } = {},
): Ordonnanceur {
  const minMs = options.minMs ?? 300;
  const now = options.now || (() => Date.now());
  const poser: (f: () => void, d: number) => unknown = options.setTimer || ((f, d) => setTimeout(f, d));
  const retirer: (h: unknown) => void = options.clearTimer || ((h) => clearTimeout(h as ReturnType<typeof setTimeout>));

  let enVol = false;
  let sale = false;
  let dernier = -Infinity;
  let minuteur: unknown = null;
  let arrete = false;

  function lancer(): void {
    if (arrete || enVol) { sale = true; return; }
    const attente = minMs - (now() - dernier);
    if (attente > 0) { programmer(attente); return; }
    enVol = true;
    sale = false;
    dernier = now();
    let repris = false;
    executer(() => {
      // ⚠️ Idempotent : un `fini()` appelé deux fois ne doit pas ouvrir deux exécutions.
      if (repris) return;
      repris = true;
      enVol = false;
      if (sale && !arrete) lancer();
    });
  }

  // ⚠️ LE CORRECTIF EST DANS LE CALCUL DE `delai`, PAS ICI.
  //
  // `attente` se calcule depuis `dernier` — l'instant de la dernière exécution — et non depuis
  // maintenant. L'échéance est donc ABSOLUE : reprogrammer retombe au même instant, et repousser
  // devient impossible par construction. C'est exactement ce que le debounce d'origine ne faisait
  // pas : son délai repartait de l'instant du signal, donc chaque signal décalait l'échéance.
  //
  // Le garde `minuteur !== null` évite de jeter et reposer un minuteur à chaque signal. C'est de
  // l'économie, pas la sûreté — vérifié par mutation : le retirer ne change aucun comportement.
  function programmer(delai: number): void {
    if (arrete || minuteur !== null) return;
    minuteur = poser(() => { minuteur = null; lancer(); }, Math.max(0, delai));
  }

  return {
    signaler() { if (!arrete) lancer(); },
    maintenant() { if (!arrete) { dernier = -Infinity; lancer(); } },
    arreter() { arrete = true; if (minuteur !== null) { retirer(minuteur); minuteur = null; } },
  };
}

/**
 * Un `fetch` dont on est sûr de reprendre la main.
 *
 * ⚠️ CE RISQUE EST NÉ D'UN CORRECTIF, et cette fonction vit à côté de `createScheduler` parce
 * qu'elle en est la contrepartie. Avant 0.1.41 l'ordonnanceur appelait `fini()` immédiatement : les
 * écritures partaient dans le désordre, mais rien ne pouvait se bloquer. En les rendant
 * séquentielles — la requête est attendue — on a échangé un défaut de correction contre un risque de
 * DISPONIBILITÉ : une requête qui reste suspendue ne règle jamais sa promesse, `fini()` n'est jamais
 * appelé, et plus aucune écriture ne part. Le présentateur pilote alors dans le vide, en silence.
 *
 * Un navigateur ne garantit aucun délai de son côté : sur un réseau qui bascule, une requête peut
 * rester en vol indéfiniment. C'est donc à l'appelant de se donner une limite.
 *
 * ⚠️ CE QUE ÇA RESTAURE, ET CE QUE ÇA NE RESTAURE PAS. La **vivacité** : la file repart. Pas
 * l'**ordre** — une requête abandonnée peut très bien être arrivée au serveur et y atterrir après
 * celle qui l'a remplacée. Garantir l'ordre malgré un abandon demande un numéro de version porté par
 * l'écriture ; c'est le chantier de la file unique, pas celui-ci. Mieux vaut le dire que laisser
 * croire que ce délai règle les deux.
 *
 * L'abandon est BEST-EFFORT : sans `AbortController`, on laisse la requête vivre et on cesse
 * seulement de l'attendre. Rendre la main compte plus que couper le fil.
 */
export function fetchBorne(
  url: string,
  options?: RequestInit,
  ms: number = PRESENT_WRITE_TIMEOUT_MS,
  deps: {
    fetch?: typeof fetch;
    setTimer?: (f: () => void, d: number) => unknown;
    clearTimer?: (id: unknown) => void;
  } = {},
): Promise<Response> {
  const appel = deps.fetch || (typeof fetch === "function" ? fetch : undefined);
  if (!appel) return Promise.reject(new Error("fetch indisponible"));
  const poser = deps.setTimer || ((f, d) => setTimeout(f, d));
  const retirer = deps.clearTimer || ((id) => clearTimeout(id as ReturnType<typeof setTimeout>));

  let ctl: AbortController | null = null;
  try { ctl = new AbortController(); } catch { /* environnement sans AbortController */ }
  const o: RequestInit = ctl ? { ...(options || {}), signal: ctl.signal } : { ...(options || {}) };

  let minuteur: unknown = null;
  const expiration = new Promise<never>((_, ko) => {
    minuteur = poser(() => {
      try { ctl?.abort(); } catch { /* déjà partie */ }
      ko(new Error("delai"));
    }, ms);
  });

  const rendre = () => { try { retirer(minuteur); } catch { /* déjà retirée */ } };
  return Promise.race([appel(url, o), expiration]).then(
    (r) => { rendre(); return r as Response; },
    (e) => { rendre(); throw e; },
  );
}

/**
 * Un budget qui se recharge : ce qu'on s'autorise à faire, quoi qu'on nous demande.
 *
 * ⚠️ IL EXISTE PARCE QUE LA DEMANDE VIENT D'AILLEURS. L'ordonnanceur regroupe les relectures, donc
 * il borne leur FRÉQUENCE INSTANTANÉE — pas leur total. Or ce qui déclenche une relecture est un
 * signal émis par le canal, c'est-à-dire par n'importe quel participant. Un ordonnanceur seul
 * transforme donc une diffusion soutenue en relectures soutenues, et c'est ce qui a permis de faire
 * dépasser à toute une salle le quota calculé pour elle.
 *
 * Le seau se vide à l'usage et se remplit au temps. Refuser ici ne perd rien : la relecture suivante
 * lira l'état le plus récent, et le filet périodique — qui ne passe pas par ce budget — garantit la
 * resynchronisation de toute façon. On arrive en retard, jamais à côté.
 */
export function createBudget(options: {
  parHeure: number;
  rafale: number;
  now?: () => number;
}): { prendre: () => boolean; restants: () => number } {
  const now = options.now || (() => Date.now());
  const rafale = Math.max(1, options.rafale);
  let jetons = rafale;
  let dernier = now();
  return {
    prendre() {
      const t = now();
      // Recharge continue plutôt que par paliers : un palier ferait passer d'un coup une salve que
      // le budget est justement là pour étaler.
      jetons = Math.min(rafale, jetons + ((t - dernier) * options.parHeure) / 3_600_000);
      dernier = t;
      if (jetons < 1) return false;
      jetons -= 1;
      return true;
    },
    restants: () => jetons,
  };
}

/**
 * Une file unique pour toutes les écritures d'une présentation.
 *
 * ⚠️ ELLE EXISTE PARCE QUE LA DISCIPLINE D'APPEL NE TIENT PAS. Deux ordonnanceurs couvraient une
 * partie des écritures de carte ; `pushPage`, `showMap`, `hideMap`, `toMap` et la recherche Street
 * View écrivaient directement. Six appelants, deux protégés — et le correctif de 0.1.41, qui
 * séquençait « les écritures de carte », n'en séquençait qu'un chemin sur trois.
 *
 * Demander à chaque appelant de passer par la bonne porte, c'est une liste : le prochain l'oubliera,
 * et rien ne le dira. On rend donc les FONCTIONS D'ÉCRITURE elles-mêmes ordonnées — il n'existe plus
 * de chemin direct, donc plus rien à oublier.
 *
 * Trois propriétés, et elles répondent à trois défauts distincts :
 *
 *  • UNE SEULE ÉCRITURE EN VOL. Sans ça, deux `PATCH` partent ensemble et c'est le réseau qui décide
 *    laquelle arrive en dernier — une page ancienne peut écraser une plus récente.
 *
 *  • REGROUPEMENT PAR GENRE. Tourner trois pages pendant qu'une écriture est en vol ne doit produire
 *    qu'une écriture : la dernière. Mais une page et une carte sont deux faits différents — les
 *    regrouper ensemble en perdrait un. Le genre est donc la clé, et la position dans la file reste
 *    celle de la PREMIÈRE demande de ce genre : l'ordre entre genres est conservé.
 *
 *  • UN RYTHME MINIMUM. Un déplacement de carte à la souris produirait sinon une écriture par
 *    image. Ce rythme remplace les deux ordonnanceurs qu'elle absorbe.
 *
 * ⚠️ CE QU'ELLE NE FAIT TOUJOURS PAS, ET IL FAUT LE DIRE. Une requête ABANDONNÉE par le délai maximal
 * peut être arrivée au serveur et y atterrir après celle qui l'a remplacée. La file supprime le
 * désordre qu'on cause ; elle ne peut rien contre celui qu'on subit. Fermer ce dernier cas demande
 * un numéro de version porté par l'écriture et refusé côté serveur — donc une colonne de plus, donc
 * un chemin de migration pour les instances existantes, qui n'existe pas encore.
 */
export function createFileEcritures(options: {
  minMs?: number;
  now?: () => number;
  setTimer?: (f: () => void, d: number) => unknown;
  clearTimer?: (id: unknown) => void;
} = {}): {
  poser: (genre: string, tache: () => Promise<unknown>) => Promise<unknown>;
  enAttente: () => number;
} {
  const minMs = options.minMs ?? 0;
  const now = options.now || (() => Date.now());
  const poser_ = options.setTimer || ((f, d) => setTimeout(f, d));

  /** ⚠️ Une Map : elle conserve l'ordre d'INSERTION, et réécrire une clé ne la déplace pas. */
  const attente = new Map<string, { tache: () => Promise<unknown>; regler: (v: unknown) => void }>();
  let enVol = false;
  let dernier = -Infinity;
  let programme = false;

  function pomper() {
    if (enVol || attente.size === 0) return;
    const reste = minMs - (now() - dernier);
    if (reste > 0) {
      if (programme) return;
      programme = true;
      poser_(() => { programme = false; pomper(); }, reste);
      return;
    }
    const genre = attente.keys().next().value as string;
    const entree = attente.get(genre)!;
    attente.delete(genre);
    enVol = true;
    dernier = now();
    Promise.resolve()
      .then(entree.tache)
      .then((v) => entree.regler(v), () => entree.regler(null))
      .then(() => { enVol = false; pomper(); });
  }

  return {
    /**
     * Range une écriture. Une écriture du même genre déjà en attente est REMPLACÉE — sa promesse se
     * règle avec le résultat de celle qui la remplace, parce qu'elle a été superposée, pas perdue.
     */
    poser(genre, tache) {
      return new Promise((resolve) => {
        const precedente = attente.get(genre);
        attente.set(genre, {
          tache,
          regler: (v) => { if (precedente) precedente.regler(v); resolve(v); },
        });
        pomper();
      });
    },
    enAttente: () => attente.size,
  };
}


/**
 * L'identifiant de PRÉSENCE : celui qu'on diffuse, et lui seul.
 *
 * ⚠️ IL ÉTAIT LA CLÉ DES STATISTIQUES, ET CETTE CLÉ EST DIFFUSÉE À TOUTE L'AUDIENCE. La présence
 * Realtime transporte un `uid` pour dédoublonner l'affichage (« je me vois deux fois » après une
 * reconnexion). En 0.1.42 nous y avons mis `attendeeKey()` — c'est-à-dire l'identité de la LIGNE DE
 * PRÉSENCE d'un participant anonyme. N'importe quel participant pouvait donc lire celle d'un voisin
 * dans le canal, la reposter, et écraser son temps de présence.
 *
 * À décharge, l'état d'avant était pire : `uid` valait l'ADRESSE E-MAIL des membres, servie à tout
 * visiteur du lien public. On a fermé une fuite et laissé un rejeu.
 *
 * ⚠️ DEUX BESOINS, DEUX VALEURS. Dédoublonner un affichage demande une valeur STABLE et PUBLIQUE ;
 * identifier une ligne de mesure demande une valeur stable et NON DIVULGUÉE. Une seule valeur pour
 * les deux finit toujours par trahir l'un des deux usages — c'est le motif que le second hôte
 * résume ainsi : « une valeur qui recouvre deux faits finit toujours par en trahir un ».
 *
 * ⚠️ CE QUE ÇA NE FERME PAS. La clé d'un participant anonyme reste CHOISIE par son navigateur : le
 * serveur ne peut pas la lui contester, faute de quoi que ce soit à vérifier. Ce correctif retire la
 * DIVULGATION, pas la propriété. Deviner une valeur tirée par `crypto` reste hors de portée ; fermer
 * le dernier cas demanderait un billet de participant signé par le serveur.
 */
export function presenceId(
  store?: KeyValueStore | null,
  randomId: () => string = valeurImprevisible,
): string {
  try {
    if (store) {
      const existant = store.getItem(STORAGE_KEYS.presenceId);
      if (existant) return existant;
      const cree = `p-${randomId()}`;
      store.setItem(STORAGE_KEYS.presenceId, cree);
      return cree;
    }
  } catch { /* stockage indisponible : on continue en dessous */ }
  // ⚠️ PAS DE GRAINE PARTAGÉE AVEC LA CLÉ DE MESURE, ET C'EST LE PIÈGE QUI A ÉTÉ ÉVITÉ DE JUSTESSE.
  //
  // La première version rendait ici `p-${fallbackId}` — le même `fallbackId` que `attendeeKey`
  // utilise pour son repli `anon-${fallbackId}`. Sans stockage (navigation privée, quota, stockage
  // bloqué), lire l'identifiant de présence d'un voisin donnait donc sa clé de participation : la
  // séparation était COSMÉTIQUE exactement là où le lecteur est le plus dégradé.
  //
  // ⚠️ Et le test qui affirme « l'un ne contient pas l'autre » passait quand même : il fournissait
  // toujours un stockage. Un banc qui n'exerce pas le chemin dégradé décrit un monde où le défaut
  // n'existe pas.
  //
  // Sans stockage, l'identifiant n'est donc plus stable d'un appel à l'autre : c'est à l'appelant de
  // le mémoriser pour la durée de sa page. La liste des participants peut alors montrer un doublon
  // après une reconnexion — dégradation d'AFFICHAGE, jamais une clé divulguée.
  return `p-${randomId()}`;
}
