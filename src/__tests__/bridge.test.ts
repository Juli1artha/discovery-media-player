import { describe, it, expect, vi } from "vitest";
import {
  toWire,
  parsePlayerMessage,
  parseHostMessage,
  sendToHost,
  sendToPlayer,
  onPlayerMessage,
  type PlayerMessage,
} from "../bridge";

describe("bridge — format sur le fil", () => {
  it("préfixe le type et ne transporte le slug que s'il existe", () => {
    expect(toWire({ type: "close" })).toEqual({ type: "3dd-doc-close" });
    expect(toWire({ type: "present-invite", slug: "aZ9_-xyz" })).toEqual({
      type: "3dd-doc-present-invite",
      slug: "aZ9_-xyz",
    });
  });

  // Le fil doit rester compatible avec les onglets déjà ouverts : renommer ces chaînes est un
  // changement de contrat, pas un détail cosmétique.
  it("conserve les noms historiques attendus par l'app déployée", () => {
    const wire = (["close", "share", "present-left", "embed-ready"] as const).map(
      (type) => toWire({ type } as PlayerMessage).type,
    );
    expect(wire).toEqual([
      "3dd-doc-close",
      "3dd-doc-share",
      "3dd-doc-present-left",
      "3dd-doc-embed-ready",
    ]);
  });

  it("fait l'aller-retour sans perte", () => {
    const msg: PlayerMessage = { type: "present-switch", slug: "abc123" };
    expect(parsePlayerMessage(toWire(msg))).toEqual(msg);
  });
});

describe("bridge — lecture défensive", () => {
  it("ignore ce qui n'est pas un message du player", () => {
    for (const junk of [null, undefined, 0, "close", [], {}, { type: 42 }, { type: "close" }]) {
      expect(parsePlayerMessage(junk)).toBeNull();
    }
  });

  it("ignore un type inconnu, même correctement préfixé", () => {
    expect(parsePlayerMessage({ type: "3dd-doc-drop-database" })).toBeNull();
  });

  // Le slug traverse la frontière puis sert de clé d'API : on le borne ici, une fois.
  it("rejette un slug absent, vide, trop long ou hors charset", () => {
    const bad = ["", "a".repeat(65), "abc/../def", "abc def", "<script>", "abc?x=1"];
    for (const slug of bad) {
      expect(parsePlayerMessage({ type: "3dd-doc-present-invite", slug })).toBeNull();
    }
    expect(parsePlayerMessage({ type: "3dd-doc-present-invite" })).toBeNull();
    expect(parsePlayerMessage({ type: "3dd-doc-present-invite", slug: 12 })).toBeNull();
  });

  it("accepte le format réel des slugs (base64url, 12 caractères)", () => {
    expect(parsePlayerMessage({ type: "3dd-doc-present-invite", slug: "Ab3-_xYz9012" })).toEqual({
      type: "present-invite",
      slug: "Ab3-_xYz9012",
    });
  });

  it("ne confond pas les deux sens de circulation", () => {
    expect(parseHostMessage({ type: "3dd-doc-close" })).toBeNull();
    expect(parsePlayerMessage({ type: "3dd-doc-handover-done" })).toBeNull();
    expect(parseHostMessage({ type: "3dd-doc-handover-done" })).toEqual({ type: "handover-done" });
  });
});

describe("bridge — runtime", () => {
  it("poste au parent et n'explose pas si le parent est injoignable", () => {
    const postMessage = vi.fn();
    sendToHost({ type: "close" }, { postMessage } as unknown as Window);
    expect(postMessage).toHaveBeenCalledWith({ type: "3dd-doc-close" }, "*");

    const dead = { get contentWindow(): never { throw new Error("détruite"); } };
    expect(() => sendToPlayer(dead as unknown as HTMLIFrameElement, { type: "handover-done" })).not.toThrow();
  });

  it("s'abonne, filtre le bruit, et se désabonne", () => {
    const listeners: Array<(e: MessageEvent) => void> = [];
    const win = {
      addEventListener: (_: string, h: (e: MessageEvent) => void) => listeners.push(h),
      removeEventListener: (_: string, h: (e: MessageEvent) => void) => {
        const i = listeners.indexOf(h);
        if (i >= 0) listeners.splice(i, 1);
      },
    } as unknown as Window;

    const seen: PlayerMessage[] = [];
    const off = onPlayerMessage((m) => seen.push(m), win);
    const fire = (data: unknown) => listeners.forEach((h) => h({ data } as MessageEvent));

    fire({ type: "3dd-doc-share" });
    fire({ type: "un-autre-widget", payload: "bruit" });
    expect(seen).toEqual([{ type: "share" }]);

    off();
    fire({ type: "3dd-doc-close" });
    expect(seen).toHaveLength(1);
  });
});
