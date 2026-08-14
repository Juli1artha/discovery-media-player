import { describe, it, expect, vi } from "vitest";
import { toWire, parsePlayerMessage, parseHostMessage, sendToHost, sendToPlayer, onPlayerMessage, type PlayerMessage, onHostMessage } from "../bridge";

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

// ⚠️ UNE RÉFÉRENCE DE FENÊTRE SUFFIT POUR SE FAIRE PASSER POUR L'HÔTE.
//
// Un contrôle d'ORIGINE est impossible ici : le player est encadré par des hôtes sur des domaines
// quelconques, et il ne connaît pas celui de son hôte au moment où il écoute. C'est pour ça que le
// contrôle avait été écarté — à raison sur l'origine, à tort sur la source.
//
// Comparer `e.source` ne demande aucune origine : soit c'est la fenêtre attendue, soit non. Sans
// ce test, n'importe quel onglet ou cadre détenant une référence pouvait envoyer `close`, `share`
// ou `handover-done`, et la page les traitait comme venant de son hôte.
//
// Signalé par l'analyse statique et par l'audit externe (P3-2).
describe("d'où un message a le droit de venir", () => {
  function fausseFenetre() {
    const ecouteurs: Array<(e: unknown) => void> = [];
    return {
      w: {
        addEventListener: (_t: string, h: (e: unknown) => void) => ecouteurs.push(h),
        removeEventListener: () => {},
      } as unknown as Window,
      emettre: (data: unknown, source: unknown) => ecouteurs.forEach((h) => h({ data, source })),
    };
  }

  it("côté PLAYER : un message qui ne vient pas du parent est ignoré", () => {
    const { w, emettre } = fausseFenetre();
    const parent = { nom: "hote" };
    (w as unknown as { parent: unknown }).parent = parent;
    const recus: unknown[] = [];
    onHostMessage((m) => recus.push(m), w);

    emettre({ type: "3dd-doc-handover-done" }, { nom: "un-autre-onglet" });
    expect(recus, "un cadre tiers ne doit pas piloter la visionneuse").toHaveLength(0);

    emettre({ type: "3dd-doc-handover-done" }, parent);
    expect(recus, "le parent, lui, reste écouté").toHaveLength(1);
  });

  // Page non encadrée : `parent === window`. Il n'y a pas d'hôte, donc rien à accepter — et
  // surtout pas un message que la page se serait envoyé à elle-même.
  it("côté PLAYER : une page non encadrée n'écoute personne", () => {
    const { w, emettre } = fausseFenetre();
    (w as unknown as { parent: unknown }).parent = w;
    const recus: unknown[] = [];
    onHostMessage((m) => recus.push(m), w);
    emettre({ type: "3dd-doc-handover-done" }, w);
    expect(recus).toHaveLength(0);
  });

  it("côté HÔTE : sans source attendue, rien ne change — aucun hôte ne devient muet", () => {
    const { w, emettre } = fausseFenetre();
    const recus: unknown[] = [];
    onPlayerMessage((m) => recus.push(m), w);
    emettre({ type: "3dd-doc-close" }, { nom: "quiconque" });
    expect(recus).toHaveLength(1);
  });

  it("côté HÔTE : avec l'iframe attendue, les autres sont ignorés", () => {
    const { w, emettre } = fausseFenetre();
    const contentWindow = { nom: "player" };
    const iframe = { contentWindow } as unknown as HTMLIFrameElement;
    const recus: unknown[] = [];
    onPlayerMessage((m) => recus.push(m), w, iframe);

    emettre({ type: "3dd-doc-close" }, { nom: "autre-cadre" });
    expect(recus).toHaveLength(0);

    emettre({ type: "3dd-doc-close" }, contentWindow);
    expect(recus, "l'iframe attendue passe").toHaveLength(1);
  });

  it("côté HÔTE : une fenêtre peut être donnée directement", () => {
    const { w, emettre } = fausseFenetre();
    const player = { nom: "player" };
    const recus: unknown[] = [];
    onPlayerMessage((m) => recus.push(m), w, player as unknown as Window);
    emettre({ type: "3dd-doc-share" }, player);
    expect(recus).toHaveLength(1);
  });
});
