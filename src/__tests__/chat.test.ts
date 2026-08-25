// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// @vitest-environment jsdom
//
// Harnais DOM. Le rendu des messages produit une CHAÎNE : on peut donc l'inspecter à l'œil nu.
// Mais la seule question qui compte n'est pas « que contient la chaîne », c'est « qu'en fait le
// navigateur ». Un `&lt;script&gt;` dans le texte est inoffensif ; un `<script>` créé dans l'arbre
// ne l'est pas. On insère donc pour de vrai et on interroge le DOM obtenu.
import { describe, it, expect, beforeEach } from "vitest";
import { renderMessage, renderReactions, renderAttachment, renderActions, messageClassName, type ChatMessageFull } from "../chat";

// ⚠️ L'identité n'est plus une adresse : c'est la référence opaque dérivée du jeton d'auteur,
// celle-là même qui autorise à modifier et supprimer.
const ME = { ref: "0123456789abcdef", name: "Moi" };
const AUTRE = { author_ref: "fedcba9876543210", author_name: "Léa" };

/** Insère le fragment comme le fait la visionneuse, et rend l'élément réel. */
function mount(html: string): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

beforeEach(() => { document.body.innerHTML = ""; });

describe("chat — ce que le navigateur fabrique vraiment", () => {
  it("un corps hostile ne crée aucun élément exécutable", () => {
    const msg: ChatMessageFull = { ...AUTRE, body: '<img src=x onerror="alert(1)"><script>alert(2)</script>' };
    const el = mount(renderMessage(msg, { me: ME }));

    expect(el.querySelectorAll("script")).toHaveLength(0);
    expect(el.querySelectorAll("img[onerror]")).toHaveLength(0);
    expect(el.querySelector("[onerror]")).toBeNull();
    // Le texte, lui, doit rester lisible — on neutralise, on ne supprime pas.
    expect(el.textContent).toContain("onerror");
  });

  it("un NOM d'auteur hostile ne s'échappe pas de son élément", () => {
    const el = mount(renderMessage({ author_name: '</b><script>alert(1)</script><b>' } as ChatMessageFull, { me: ME }));
    expect(el.querySelectorAll("script")).toHaveLength(0);
    expect(el.querySelector(".who b")?.textContent).toContain("<script>");
  });

  it("une CITATION hostile est neutralisée elle aussi", () => {
    const el = mount(renderMessage(
      { ...AUTRE, reply_to: 1, reply_name: '<img src=x onerror=1>', reply_text: '"><script>alert(1)</script>' } as ChatMessageFull,
      { me: ME },
    ));
    expect(el.querySelectorAll("script, img[onerror]")).toHaveLength(0);
  });

  it("une PIÈCE JOINTE hostile ne peut ni casser l'attribut ni injecter un attribut", () => {
    const el = mount(renderAttachment({ kind: "image", url: 'x" onerror="alert(1)' }));
    const img = el.querySelector("img");
    expect(img?.getAttribute("onerror")).toBeNull();
    expect(img?.getAttribute("src")).toBe('x" onerror="alert(1)');

    const pdf = mount(renderAttachment({ kind: "pdf", url: "https://ok.fr/a.pdf", name: '<script>x</script>' }));
    expect(pdf.querySelectorAll("script")).toHaveLength(0);
    expect(pdf.querySelector(".cm-pdflabel")?.textContent).toBe("<script>x</script>");
  });

  it("un EMOJI de réaction hostile est neutralisé", () => {
    const el = mount(renderReactions({ reactions: { '"><script>alert(1)</script>': ["a@b.fr"] } } as ChatMessageFull, ME));
    expect(el.querySelectorAll("script")).toHaveLength(0);
    expect(el.querySelector(".re-chip")).not.toBeNull();
  });

  it("les liens sortants ne fuitent pas le référent et ne prennent pas la main sur l'onglet", () => {
    const el = mount(renderMessage({ ...AUTRE, body: "voir https://exemple.fr/a" }, { me: ME }));
    const link = el.querySelector("a.cm-link") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://exemple.fr/a");
    expect(link.getAttribute("rel")).toBe("noreferrer");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("un lien à schéma dangereux n'est jamais fabriqué", () => {
    for (const hostile of ["javascript:alert(1)", "data:text/html,<b>x</b>"]) {
      const el = mount(renderMessage({ ...AUTRE, body: hostile }, { me: ME }));
      expect(el.querySelectorAll("a.cm-link"), hostile).toHaveLength(0);
    }
  });
});

describe("chat — contenu et droits", () => {
  it("affiche l'auteur, son texte, sa mention de modification", () => {
    const el = mount(renderMessage({ ...AUTRE, body: "bonjour", edited: true }, { me: ME }));
    expect(el.querySelector(".who b")?.textContent).toBe("Léa");
    expect(el.querySelector(".txt")?.textContent).toContain("bonjour");
    expect(el.querySelector(".cm-ed")?.textContent).toContain("modifié");
  });

  it("le badge présentateur n'apparaît que s'il vient du serveur", () => {
    expect(mount(renderMessage({ ...AUTRE, is_presenter: true }, { me: ME })).querySelector(".tag")).not.toBeNull();
    expect(mount(renderMessage({ ...AUTRE }, { me: ME })).querySelector(".tag")).toBeNull();
  });

  // Un message supprimé est supprimé, pas masqué : rien de son contenu ne doit rester dans l'arbre.
  it("un message supprimé ne laisse filtrer ni corps, ni citation, ni pièce jointe", () => {
    const el = mount(renderMessage(
      { ...AUTRE, deleted: true, body: "secret", reply_text: "secret aussi", attachment: { kind: "image", url: "https://x/y.png" } } as ChatMessageFull,
      { me: ME },
    ));
    expect(el.textContent).toBe("Message supprimé");
    expect(el.querySelector("img")).toBeNull();
    expect(el.innerHTML).not.toContain("secret");
  });

  it("« Modifier » n'existe que sur mes messages", () => {
    const mien = mount(renderActions({ author_ref: ME.ref } as ChatMessageFull, { me: ME }));
    const autre = mount(renderActions(AUTRE as ChatMessageFull, { me: ME }));
    expect(mien.querySelector(".cm-edit")).not.toBeNull();
    expect(autre.querySelector(".cm-edit")).toBeNull();
  });

  it("« Supprimer » existe sur les miens, et sur tous pour le présentateur", () => {
    const q = (html: string) => mount(html).querySelector(".cm-del-btn");
    expect(q(renderActions(AUTRE as ChatMessageFull, { me: ME }))).toBeNull();
    expect(q(renderActions({ author_ref: ME.ref } as ChatMessageFull, { me: ME }))).not.toBeNull();
    expect(q(renderActions(AUTRE as ChatMessageFull, { me: { ...ME, role: "presenter" } }))).not.toBeNull();
  });

  it("marque mes réactions comme miennes", () => {
    // ⚠️ DES RÉFÉRENCES OPAQUES, PLUS DES ADRESSES : cette carte est stockée en base et rendue
    // publique à toute l'audience. Elle portait les adresses des réacteurs, sur un chemin que
    // l'audit n'avait pas relevé.
    const el = mount(renderReactions({ reactions: { "👍": [ME.ref, "fedcba9876543210"], "🎉": ["fedcba9876543210"] } } as ChatMessageFull, ME));
    const chips = [...el.querySelectorAll(".re-chip")];
    expect(chips).toHaveLength(2);
    expect(chips[0].classList.contains("on")).toBe(true);
    expect(chips[0].textContent).toBe("👍 2");
    expect(chips[1].classList.contains("on")).toBe(false);
  });

  it("ignore une réaction sans réacteur", () => {
    expect(renderReactions({ reactions: { "👍": [] } } as ChatMessageFull, ME)).toBe("");
    expect(renderReactions(null, ME)).toBe("");
  });

  it("dérive les classes d'état du conteneur", () => {
    expect(messageClassName({ author_ref: ME.ref } as ChatMessageFull, ME, false)).toBe("cm me");
    expect(messageClassName({ ...AUTRE, deleted: true } as ChatMessageFull, ME, true)).toBe("cm isdel mentioned");
  });
});
