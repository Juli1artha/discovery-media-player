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

/** Préfixe historique des messages sur le fil. Neutralisable d'un seul endroit le jour de l'ouverture. */
const WIRE_PREFIX = "3dd-doc-";

/** Slugs de partage et de présentation : `randomBytes(9).toString("base64url")` → 12 caractères. */
const SLUG_RE = /^[A-Za-z0-9_-]{1,64}$/;

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
  | { type: "present-switch"; slug: string };

/** Messages émis par l'application hôte vers le player. */
export type HostMessage = { type: "handover-done" };

const PLAYER_PLAIN = ["close", "share", "embed-ready", "present-left", "present-denied"] as const;
const PLAYER_WITH_REASON = ["embed-denied"] as const;
const PLAYER_WITH_SLUG = ["present-invite", "present-handover", "present-switch"] as const;
const HOST_PLAIN = ["handover-done"] as const;

type WireMessage = { type: string; slug?: string; reason?: string };

/** Forme transportée sur le fil (préfixée), pour un message typé. */
export function toWire(msg: PlayerMessage | HostMessage): WireMessage {
  const wire: WireMessage = { type: WIRE_PREFIX + msg.type };
  if ("slug" in msg && msg.slug) wire.slug = msg.slug;
  if ("reason" in msg && msg.reason) wire.reason = String(msg.reason).slice(0, 40);
  return wire;
}

function parse<T extends { type: string }>(
  data: unknown,
  plain: readonly string[],
  withSlug: readonly string[],
): T | null {
  if (!data || typeof data !== "object") return null;
  const raw = (data as { type?: unknown }).type;
  if (typeof raw !== "string" || !raw.startsWith(WIRE_PREFIX)) return null;
  const type = raw.slice(WIRE_PREFIX.length);
  if (plain.includes(type)) return { type } as T;
  if (PLAYER_WITH_REASON.includes(type as never)) {
    const reason = (data as { reason?: unknown }).reason;
    // Motif borné et sans surprise : il traverse une frontière et finit parfois à l'écran.
    return { type, reason: /^[a-z-]{1,40}$/.test(String(reason || "")) ? String(reason) : "unknown" } as unknown as T;
  }
  if (!withSlug.includes(type)) return null;
  const slug = (data as { slug?: unknown }).slug;
  // Un message à slug SANS slug valide est rejeté : mieux vaut ne rien ouvrir qu'ouvrir sur du vide.
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) return null;
  return { type, slug } as unknown as T;
}

/** Côté HÔTE : lit un message reçu du player. `null` si ce n'en est pas un. */
export function parsePlayerMessage(data: unknown): PlayerMessage | null {
  return parse<PlayerMessage>(data, PLAYER_PLAIN, PLAYER_WITH_SLUG);
}

/** Côté PLAYER : lit un message reçu de l'hôte. `null` si ce n'en est pas un. */
export function parseHostMessage(data: unknown): HostMessage | null {
  return parse<HostMessage>(data, HOST_PLAIN, []);
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

/** Côté HÔTE : envoie un message au player. */
export function sendToPlayer(frame: HTMLIFrameElement | null | undefined, msg: HostMessage): void {
  try {
    frame?.contentWindow?.postMessage(toWire(msg), "*");
  } catch { /* iframe déjà détruite */ }
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
