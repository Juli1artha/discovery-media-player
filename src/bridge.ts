// SPDX-License-Identifier: MIT
// Copyright © 2026 3D Discovery
//
// ⚠️ CE FICHIER EST SOUS MIT, pas AGPL — délibérément, et c'est le seul.
// C'est le contrat que l'application hôte doit importer pour parler au player. Le placer sous la
// licence du cœur obligerait un hôte à ouvrir son propre code pour avoir le droit d'échanger dix
// messages avec une iframe : la licence deviendrait un péage à l'intégration, ce qui n'est pas ce
// qu'on protège. On protège le player, pas ceux qui s'y branchent.

// Contrat postMessage entre le PLAYER (iframe) et l'APPLICATION HÔTE qui l'affiche.
//
// Le player vit dans une iframe : il possède le document, la barre d'outils et la présentation,
// mais tout ce qui exige le jeton de session de l'hôte (inviter l'équipe, passer la main, ouvrir
// la modale de partage) doit remonter à l'application. Ce fichier est le SEUL endroit où le
// format de ces messages est décrit — les deux côtés l'importent.
//
// Il était auparavant écrit à la main des deux côtés : dix types de messages dupliqués, non
// typés, validés par des `String(d.slug || "")` sans borne. Deux bugs en sont venus (validation
// d'origine trop stricte qui bloquait la réception en production ; fermeture du viewer avant le
// retrait de présence, qui laissait un participant fantôme).
//
// VALIDATION PAR TYPE, PAS PAR ORIGINE — délibéré. Un contrôle strict de `e.origin` bloquait la
// réception en production (l'iframe et l'app ne partagent pas toujours la même origine perçue).
// Les actions transportées sont inoffensives : elles ouvrent une modale ou ferment une vue, et
// tout ce qui touche aux données est revérifié côté serveur avec le JWT. Le `slug` est en
// revanche borné ici (charset + longueur) : c'est la seule donnée qui traverse la frontière.
//
// ⚠️ UNE EXCEPTION DEPUIS `present-attach` : ce message porte un SECRET, le jeton de contrôle d'une
// présentation, de l'hôte vers le player. Il ne passe pas par l'URL (elle finit dans les journaux,
// l'historique, l'en-tête Referer) mais par ce canal — et ce canal doit alors être fermé dans les
// deux sens. À la réception, le player n'accepte que `window.parent`, dont l'origine est déjà bornée
// par `frame-ancestors` avant qu'aucun script ne tourne. À l'émission, `sendToPlayer` vise l'ORIGINE
// de l'iframe au lieu de `"*"` : si le cadre a navigué ailleurs, le navigateur jette le message au
// lieu de remettre le jeton au document qui s'y trouve. Le player, lui, ne renvoie jamais ce jeton.

/** Préfixe historique des messages sur le fil. Neutralisable d'un seul endroit le jour de l'ouverture. */
const WIRE_PREFIX = "3dd-doc-";

/** Slugs de partage et de présentation : `randomBytes(9).toString("base64url")` → 12 caractères. */
const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

/** Jetons de contrôle : `randomBytes(18).toString("base64url")` → 24 caractères. Plancher : un jeton
 *  court n'en est pas un, et l'accepter ferait passer pour une adoption ratée ce qui est un hôte cassé. */
const CONTROL_RE = /^[A-Za-z0-9_-]{16,128}$/;

/** Motifs : bornés et sans surprise — ils traversent une frontière et finissent parfois à l'écran. */
const REASON_RE = /^[a-z-]{1,40}$/;

/** Identifiants d'onglet et d'action déclarés par l'hôte (#596) : ils reviennent dans SON code par
 *  `host-action`, et `share` / `present` / `download` y désignent les actions du player. */
const ID_RE = /^[a-z0-9][a-z0-9:_-]{0,39}$/;
const MAX_ONGLETS = 8;
const MAX_ACTIONS = 6;
const MAX_PAGES = 10_000;

/** Messages émis par le player vers l'application hôte. */
export type PlayerMessage =
  | { type: "close" }
  | { type: "share" }
  | { type: "embed-ready" }
  // ⚠️ Le silence ne suffit pas. `embed-ready` absent peut vouloir dire deux choses OPPOSÉES :
  // le player n'est pas là (instance absente, en panne, en cours de déploiement) — ou le player
  // REFUSE d'afficher (partage révoqué, mur d'accès, greffon manquant en fail-closed). Un hôte
  // qui replie sur le lecteur du navigateur transformerait alors un refus en ouverture.
  // Signalé par un hôte en cours d'intégration. `reason` reste indicatif : la décision est déjà prise.
  | { type: "embed-denied"; reason: string }
  | { type: "present-left" }
  | { type: "present-denied" }
  | { type: "present-invite"; slug: string }
  | { type: "present-handover"; slug: string }
  | { type: "present-switch"; slug: string }
  // Démarrée par le bouton « Présenter » du player (ou `autopresent=1`) : sans ce message, l'hôte
  // n'apprenait le slug qu'au premier « Inviter » ou « Passer la main » — souvent jamais.
  | { type: "present-started"; slug: string }
  // Terminée par le bouton « Terminer » du player, et CONFIRMÉE : le serveur a répondu et la relecture
  // la dit close. Une fin décidée ailleurs (propriétaire, administrateur) ou partie par `sendBeacon`
  // quand la page meurt n'a pas de réponse à lire — elle n'est pas annoncée ici.
  | { type: "present-ended"; slug: string }
  // Réponses à `present-attach`. ⚠️ Le silence ne suffit pas, pour la même raison qu'`embed-ready` :
  // sans réponse, l'hôte ne peut pas distinguer « le player pilote » de « le player a refusé ».
  | { type: "present-attached"; slug: string }
  | { type: "present-attach-failed"; slug: string; reason: string }
  // #596 — un clic sur un onglet ou une action que l'HÔTE a déclarés (`chrome`). Jamais émis pour les
  // actions du player : `share` garde son message, `present` et `download` agissent dans la page.
  | { type: "host-action"; id: string }
  // #596 — la page courante, à chaque changement (pas à chaque pixel). L'hôte n'en savait rien.
  | { type: "page"; page: number; total: number };

/** Un onglet de la barre déclarée par l'hôte. */
export type ChromeTab = { id: string; label: string };
/** Une action de la barre déclarée par l'hôte. `share`, `present` et `download` sont celles du player :
 *  l'hôte les place et les renomme, il ne les déclenche pas. Placer n'ouvre aucun droit. */
export type ChromeAction = { id: string; label: string; place: "primary" | "secondary" | "menu" };

/** Messages émis par l'application hôte vers le player. */
export type HostMessage =
  | { type: "handover-done" }
  // L'hôte a démarré côté serveur (`present-start` avec la session du membre) et confie la conduite
  // à la visionneuse. `control` est le jeton rendu par `present-start` ou `present-reclaim`.
  | { type: "present-attach"; slug: string; control: string }
  // #596 — la barre du gabarit « lecture », déclarée par l'hôte. Elle REMPLACE en entier la précédente :
  // le dernier `chrome` reçu l'emporte, et un champ absent est vide, pas « inchangé ».
  | { type: "chrome"; subtitle?: string; tabs?: ChromeTab[]; activeTab?: string; actions?: ChromeAction[] };

/** Les champs que porte chaque type, dans chaque sens. Un type absent de sa table n'existe pas. */
type Champ = "slug" | "reason" | "control" | "id";
// ⚠️ UNE TABLE PAR SENS, ET C'EST UNE CORRECTION. La lecture des motifs vivait dans la fonction
// commune : `parseHostMessage` acceptait donc `embed-denied`, qu'aucun hôte n'émet. Inoffensif tant
// que le player n'en faisait rien — mais un sens qui lit les messages de l'autre est exactement la
// confusion qu'un jeton de contrôle ne doit pas pouvoir emprunter.
// ⚠️ ET UNE `Map`, PAS UN OBJET : `"3dd-doc-constructor"` trouverait sinon une entrée dans le prototype.
const FORMES_PLAYER = new Map<string, readonly Champ[]>([
  ["close", []], ["share", []], ["embed-ready", []], ["present-left", []], ["present-denied", []],
  ["embed-denied", ["reason"]],
  ["present-invite", ["slug"]], ["present-handover", ["slug"]], ["present-switch", ["slug"]],
  ["present-started", ["slug"]], ["present-ended", ["slug"]], ["present-attached", ["slug"]],
  ["present-attach-failed", ["slug", "reason"]],
  ["host-action", ["id"]],
]);
const FORMES_HOTE = new Map<string, readonly Champ[]>([
  ["handover-done", []],
  ["present-attach", ["slug", "control"]],
]);

type WireMessage = {
  type: string; slug?: string; reason?: string; control?: string; id?: string;
  page?: number; total?: number;
  subtitle?: string; tabs?: ChromeTab[]; activeTab?: string; actions?: ChromeAction[];
};

/** Un libellé : une chaîne de 1 à `max` caractères une fois les blancs repliés. Rien d'autre n'en sort. */
function libelle(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  const s = v.replace(/\s+/g, " ").trim();
  return s.length >= 1 && s.length <= max ? s : null;
}

/** Une liste bornée d'objets `{id, label, …}` aux id uniques. `null` à la moindre faute : le message entier tombe. */
function liste<T extends { id: string }>(v: unknown, max: number, lire: (o: Record<string, unknown>) => T | null): T[] | null {
  if (!Array.isArray(v) || v.length > max) return null;
  const vus = new Set<string>();
  const sortie: T[] = [];
  for (const brut of v) {
    if (!brut || typeof brut !== "object") return null;
    const lu = lire(brut as Record<string, unknown>);
    if (!lu || vus.has(lu.id)) return null;
    vus.add(lu.id);
    sortie.push(lu);
  }
  return sortie;
}

const PLACES = new Set(["primary", "secondary", "menu"]);

// ⚠️ LES MESSAGES COMPOSÉS SE LISENT CHAMP PAR CHAMP, ET N'EMPORTENT QUE CE QU'ILS NOMMENT. Un champ
// inconnu (`html`, `onclick`) n'est pas recopié : la sortie est construite, jamais filtrée à partir de
// l'entrée. Et la moindre faute fait tomber le message ENTIER — tronquer une liste de neuf onglets à
// huit afficherait une barre que l'hôte n'a pas déclarée.
function lireChrome(d: Record<string, unknown>): HostMessage | null {
  const lu: Extract<HostMessage, { type: "chrome" }> = { type: "chrome" };
  if (d.subtitle !== undefined) { const s = libelle(d.subtitle, 80); if (!s) return null; lu.subtitle = s; }
  if (d.tabs !== undefined) {
    const tabs = liste(d.tabs, MAX_ONGLETS, (o) => {
      const label = libelle(o.label, 40);
      return typeof o.id === "string" && ID_RE.test(o.id) && label ? { id: o.id, label } : null;
    });
    if (!tabs) return null;
    lu.tabs = tabs;
  }
  if (d.activeTab !== undefined) {
    if (typeof d.activeTab !== "string" || !(lu.tabs || []).some((t) => t.id === d.activeTab)) return null;
    lu.activeTab = d.activeTab;
  }
  if (d.actions !== undefined) {
    const actions = liste(d.actions, MAX_ACTIONS, (o) => {
      const label = libelle(o.label, 40);
      return typeof o.id === "string" && ID_RE.test(o.id) && label && typeof o.place === "string" && PLACES.has(o.place)
        ? { id: o.id, label, place: o.place as ChromeAction["place"] } : null;
    });
    if (!actions) return null;
    lu.actions = actions;
  }
  return lu;
}

function lirePage(d: Record<string, unknown>): PlayerMessage | null {
  const { page, total } = d;
  if (!Number.isInteger(total) || (total as number) < 1 || (total as number) > MAX_PAGES) return null;
  if (!Number.isInteger(page) || (page as number) < 1 || (page as number) > (total as number)) return null;
  return { type: "page", page: page as number, total: total as number };
}

const COMPOSES_PLAYER = new Map<string, (d: Record<string, unknown>) => PlayerMessage | null>([["page", lirePage]]);
const COMPOSES_HOTE = new Map<string, (d: Record<string, unknown>) => HostMessage | null>([["chrome", lireChrome]]);

/** Forme transportée sur le fil (préfixée), pour un message typé. */
export function toWire(msg: PlayerMessage | HostMessage): WireMessage {
  const wire: WireMessage = { type: WIRE_PREFIX + msg.type };
  if ("slug" in msg && msg.slug) wire.slug = msg.slug;
  if ("reason" in msg && msg.reason) wire.reason = String(msg.reason).slice(0, 40);
  if ("control" in msg && msg.control) wire.control = msg.control;
  if ("id" in msg && msg.id) wire.id = msg.id;
  if (msg.type === "page") { wire.page = msg.page; wire.total = msg.total; }
  if (msg.type === "chrome") {
    if (msg.subtitle !== undefined) wire.subtitle = msg.subtitle;
    if (msg.tabs) wire.tabs = msg.tabs.map((t) => ({ id: t.id, label: t.label }));
    if (msg.activeTab !== undefined) wire.activeTab = msg.activeTab;
    if (msg.actions) wire.actions = msg.actions.map((a) => ({ id: a.id, label: a.label, place: a.place }));
  }
  return wire;
}

function parse<T extends { type: string }>(
  data: unknown,
  formes: ReadonlyMap<string, readonly Champ[]>,
  composes: ReadonlyMap<string, (d: Record<string, unknown>) => T | null>,
): T | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as { type?: unknown }).type;
  if (typeof raw !== "string" || !raw.startsWith(WIRE_PREFIX)) return null;
  const type = raw.slice(WIRE_PREFIX.length);
  const compose = composes.get(type);
  if (compose) return compose(data as Record<string, unknown>);
  const champs = formes.get(type);
  if (!champs) return null;
  const lu: Record<string, string> = { type };
  for (const champ of champs) {
    const valeur = (data as Record<string, unknown>)[champ];
    if (champ === "reason") {
      // Un motif illisible n'annule pas le message : la décision est déjà prise, seul son libellé se perd.
      lu.reason = REASON_RE.test(String(valeur || "")) ? String(valeur) : "unknown";
      continue;
    }
    // Un message à slug (ou à jeton) SANS valeur valide est rejeté : mieux vaut ne rien ouvrir
    // qu'ouvrir sur du vide.
    const motif = champ === "slug" ? SLUG_RE : champ === "id" ? ID_RE : CONTROL_RE;
    if (typeof valeur !== "string" || !motif.test(valeur)) return null;
    lu[champ] = valeur;
  }
  return lu as unknown as T;
}

/** Côté HÔTE : lit un message reçu du player. `null` si ce n'en est pas un. */
export function parsePlayerMessage(data: unknown): PlayerMessage | null {
  return parse<PlayerMessage>(data, FORMES_PLAYER, COMPOSES_PLAYER);
}

/** Côté PLAYER : lit un message reçu de l'hôte. `null` si ce n'en est pas un. */
export function parseHostMessage(data: unknown): HostMessage | null {
  return parse<HostMessage>(data, FORMES_HOTE, COMPOSES_HOTE);
}

// ── Runtime ────────────────────────────────────────────────────────────────────────────────────
// Tout est en `try` : un player qui ne parvient pas à parler à son hôte doit continuer à afficher
// le document. Perdre le bouton « Partager » est ennuyeux, perdre le document est inacceptable.

/** Côté PLAYER : envoie un message à l'application hôte. */
export function sendToHost(msg: PlayerMessage, target?: Window | null): void {
  try {
    const win = target || (typeof window !== "undefined" ? window.parent : null);
    if (win) win.postMessage(toWire(msg), "*");
  } catch { /* l'hôte est peut-être absent (page publique) : sans effet */ }
}

/**
 * L'origine du document que l'iframe a reçu l'ordre de charger — `null` si elle ne se dit pas.
 * `about:`, `data:` et `blob:` opaques rendent la chaîne « null » : ce n'est pas une origine.
 */
function origineDuCadre(frame: HTMLIFrameElement): string | null {
  try {
    const base = typeof location !== "undefined" ? location.href : undefined;
    const o = new URL(String(frame.src || ""), base).origin;
    return o && o !== "null" ? o : null;
  } catch { return null; }
}

/**
 * Côté HÔTE : envoie un message au player. Rend `false` si rien n'est parti.
 *
 * `targetOrigin` — l'origine du player. Facultative pour les messages sans secret (`"*"`, comme
 * toujours). ⚠️ Pour `present-attach`, qui porte un jeton de contrôle, elle est DÉDUITE de `frame.src`
 * à défaut d'être donnée, et l'envoi est REFUSÉ si aucune n'est connue : un jeton posté à `"*"` serait
 * remis à n'importe quel document que le cadre aurait chargé entre-temps.
 */
export function sendToPlayer(
  frame: HTMLIFrameElement | null | undefined,
  msg: HostMessage,
  targetOrigin?: string,
): boolean {
  try {
    const win = frame?.contentWindow;
    if (!frame || !win) return false;
    const secret = msg.type === "present-attach";
    const cible = targetOrigin || (secret ? origineDuCadre(frame) : "*");
    if (!cible || (secret && cible === "*")) return false;
    win.postMessage(toWire(msg), cible);
    return true;
  } catch { return false; /* iframe déjà détruite */ }
}

/**
 * ⚠️ POURQUOI ON NE VÉRIFIE PAS L'ORIGINE, ET CE QU'ON VÉRIFIE À LA PLACE.
 *
 * Un contrôle d'origine est impossible ici : le player est encadré par des hôtes sur des domaines
 * quelconques, déclarés à l'exploitation (`DOC_FRAME_ANCESTORS`), et il ne connaît pas celui de son
 * hôte au moment où il écoute. C'est pour cette raison que le contrôle avait été écarté.
 *
 * Mais comparer la FENÊTRE SOURCE ne demande aucune origine. `e.source` est une référence : soit
 * elle est celle qu'on attend, soit elle vient d'ailleurs. Sans ce test, n'importe quel onglet ou
 * cadre détenant une référence à la fenêtre pouvait envoyer `close`, `share` ou `handover-done` —
 * et la page les traitait comme venant de son hôte.
 *
 * Côté player, la fermeture est PAR DÉFAUT : le seul émetteur légitime est `window.parent`, aucun
 * hôte n'a de code à changer. Côté hôte, le paramètre est optionnel — imposer une fermeture par
 * défaut ferait taire les messages chez tous ceux qui ne l'auraient pas encore passé, et un
 * message qui n'arrive plus est la pire façon d'annoncer un durcissement.
 */
function memeFenetre(attendue: unknown, source: unknown): boolean {
  if (!attendue) return true;                                   // rien d'attendu : on n'exclut rien
  const w = (attendue as HTMLIFrameElement).contentWindow ?? attendue;
  return source === w;
}

/**
 * Côté HÔTE : écoute les messages du player. Renvoie la fonction de désabonnement.
 *
 * `expected` — l'iframe du player, ou sa fenêtre. **Recommandé** : sans lui, un autre cadre peut
 * se faire passer pour le player.
 */
export function onPlayerMessage(
  cb: (msg: PlayerMessage) => void,
  win?: Window,
  expected?: HTMLIFrameElement | Window | null,
): () => void {
  const target = win || (typeof window !== "undefined" ? window : null);
  if (!target) return () => {};
  const handler = (e: MessageEvent) => {
    if (!memeFenetre(expected, e.source)) return;
    const msg = parsePlayerMessage(e.data);
    if (msg) cb(msg);
  };
  target.addEventListener("message", handler);
  return () => target.removeEventListener("message", handler);
}

/**
 * Côté PLAYER : écoute les messages de l'hôte. Renvoie la fonction de désabonnement.
 *
 * N'accepte que `window.parent` — le seul émetteur qui ait un sens dans un cadre.
 */
export function onHostMessage(cb: (msg: HostMessage) => void, win?: Window): () => void {
  const target = win || (typeof window !== "undefined" ? window : null);
  if (!target) return () => {};
  const parent = (target as Window).parent ?? null;
  const handler = (e: MessageEvent) => {
    // ⚠️ `parent === target` quand la page n'est PAS encadrée : il n'y a alors pas d'hôte, donc
    // rien à accepter — et surtout pas ses propres messages renvoyés par un script de la page.
    if (!parent || parent === target || e.source !== parent) return;
    const msg = parseHostMessage(e.data);
    if (msg) cb(msg);
  };
  target.addEventListener("message", handler);
  return () => target.removeEventListener("message", handler);
}
