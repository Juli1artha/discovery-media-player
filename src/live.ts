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
 * Clé stable d'un participant pour les statistiques de présence : son email s'il est membre,
 * sinon un identifiant de navigateur persistant. Sans lui, chaque rechargement compterait
 * comme un nouveau participant.
 */
export function attendeeKey(
  me: Me | null | undefined,
  store?: KeyValueStore | null,
  fallbackId = "anon",
  randomId: () => string = () => Math.random().toString(36).slice(2, 10),
): string {
  if (me?.email) return String(me.email).toLowerCase();
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
 * Jeton d'auteur : c'est lui qui prouve « ce message est le mien » pour le modifier ou le
 * supprimer. Persistant, propre au navigateur, jamais envoyé par le serveur.
 */
export function authorToken(
  store?: KeyValueStore | null,
  randomId: () => string = () => Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2),
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
