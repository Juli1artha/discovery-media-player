// Rendu des messages du chat de présentation : d'un message à son fragment HTML.
//
// Ces fonctions produisent une CHAÎNE, pas des nœuds — c'est ce qui les rend testables, et c'est
// aussi ce qui les rend dangereuses : tout ce qui n'est pas échappé ici devient du balisage
// exécutable chez tous les spectateurs. Un message contenant du balisage a déjà produit un XSS
// stocké sur la page audience. Les tests vérifient donc non seulement la chaîne produite, mais ce
// que le NAVIGATEUR en fait réellement une fois insérée (harnais jsdom).
//
// Règle sans exception : **toute** donnée venant d'un participant — nom, corps, citation, nom de
// pièce jointe, URL, emoji de réaction — passe par `escapeHtml` ou `formatMessageBody`.

import { escapeHtml, formatMessageBody, avatarHtml, isMine, canModerate, reactorId, type ChatMessage, type Me } from "./live";

export interface Attachment {
  kind?: string;
  url?: string;
  name?: string;
}

export interface ChatMessageFull extends ChatMessage {
  reply_to?: number | string | null;
  reply_name?: string;
  reply_text?: string;
  edited?: boolean;
  is_presenter?: boolean;
  attachment?: Attachment | null;
  reactions?: Record<string, string[]> | null;
}

export interface ChatRenderContext {
  me: Me | null | undefined;
  /** Balisage de l'icône « réagir » — fourni par l'hôte, jamais construit ici. */
  reactIcon?: string;
}

/** Pastilles de réaction. L'emoji vient du réseau : il est échappé comme le reste. */
export function renderReactions(msg: ChatMessageFull | null | undefined, me: Me | null | undefined): string {
  const reactions = (msg && msg.reactions) || {};
  const mineId = reactorId(me);
  let out = "";
  for (const emoji in reactions) {
    const reactors = reactions[emoji] || [];
    if (!reactors.length) continue;
    const mine = reactors.indexOf(mineId) >= 0;
    out += `<button class="re-chip${mine ? " on" : ""}" data-e="${escapeHtml(emoji)}">${escapeHtml(emoji)} ${reactors.length}</button>`;
  }
  return out;
}

/** Pièce jointe : vignette d'image, ou carte PDF dont la vignette est peinte après coup. */
export function renderAttachment(attachment: Attachment | null | undefined): string {
  if (!attachment || !attachment.url) return "";
  const url = escapeHtml(attachment.url);
  if (attachment.kind === "image") {
    return `<a class=cm-att href="${url}" target=_blank rel=noreferrer><img src="${url}" alt="" loading=lazy></a>`;
  }
  const label = escapeHtml(attachment.name || "Document.pdf");
  return `<a class=cm-att-pdf href="${url}" target=_blank rel=noreferrer data-pdf="${url}"><span class=cm-att-ph></span><span class=cm-pdflabel>${label}</span></a>`;
}

/** Boutons d'action. « Modifier » n'apparaît que sur ses propres messages ; « Supprimer » aussi, sauf pour le présentateur. */
export function renderActions(msg: ChatMessageFull, ctx: ChatRenderContext): string {
  const mine = isMine(msg, ctx.me);
  let actions = `<button class=cm-react title="Réagir">${ctx.reactIcon || ""}</button><button class=cm-reply title="Répondre">↩</button>`;
  if (mine) actions += '<button class=cm-edit title="Modifier">✎</button>';
  if (mine || canModerate(ctx.me)) actions += '<button class=cm-del-btn title="Supprimer">🗑</button>';
  return actions;
}

/** Contenu interne d'un message, prêt à être posé dans son conteneur. */
export function renderMessage(msg: ChatMessageFull, ctx: ChatRenderContext): string {
  // Un message supprimé ne laisse RIEN filtrer de son contenu d'origine — ni corps, ni citation,
  // ni pièce jointe. La suppression est une suppression, pas un masquage visuel.
  if (msg.deleted) {
    return '<span class=a></span><span class=b><div class="txt cm-del">Message supprimé</div></span>';
  }
  const quote = msg.reply_to
    ? `<div class=cm-q><b>${escapeHtml(msg.reply_name || "")}</b> ${escapeHtml(msg.reply_text || "")}</div>`
    : "";
  const edited = msg.edited ? ' <span class=cm-ed>(modifié)</span>' : "";
  const body = msg.body ? `<div class=txt>${formatMessageBody(msg.body)}${edited}</div>` : "";
  const presenterTag = msg.is_presenter ? ' <span class=tag>présentateur</span>' : "";

  return (
    `<span class=a>${avatarHtml(msg.author_avatar, msg.author_name)}</span>` +
    `<span class=b><div class=who><b>${escapeHtml(msg.author_name || "Invité")}</b>${presenterTag}</div>` +
    quote +
    body +
    renderAttachment(msg.attachment) +
    `<div class=cm-re>${renderReactions(msg, ctx.me)}</div></span>` +
    `<span class=cm-act>${renderActions(msg, ctx)}</span>`
  );
}

/** Classes du conteneur d'un message — état visuel dérivé, jamais saisi par l'auteur. */
export function messageClassName(msg: ChatMessageFull, me: Me | null | undefined, mentioned: boolean): string {
  return (
    "cm" +
    (isMine(msg, me) ? " me" : "") +
    (msg.deleted ? " isdel" : "") +
    (mentioned ? " mentioned" : "")
  );
}
