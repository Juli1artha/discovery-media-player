// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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

// ── `present-attach` : l'hôte démarre côté serveur et confie la conduite à l'iframe ───────────────
//
// Demandé par un hôte (26/10) dont l'application et le player ne partagent pas d'origine : la page du
// présentateur ne pouvait reprendre que par la session du membre, illisible depuis `doc.` quand elle
// vit sur `app.`, et le jeton rendu par `present-start` n'avait aucun chemin pour entrer dans l'iframe.
// Ce message est le seul du pont à porter un SECRET : ce qui suit tient ce que ça lui coûte.
describe("bridge — présenter depuis l'hôte", () => {
  const JETON = "Q1w2E3r4T5y6U7i8O9p0-_aZ";

  it("le jeton voyage sur le fil, et seulement pour le message qui le porte", () => {
    expect(toWire({ type: "present-attach", slug: "Ab3-_xYz9012", control: JETON })).toEqual({
      type: "3dd-doc-present-attach", slug: "Ab3-_xYz9012", control: JETON,
    });
    expect(parseHostMessage(toWire({ type: "present-attach", slug: "Ab3-_xYz9012", control: JETON })))
      .toEqual({ type: "present-attach", slug: "Ab3-_xYz9012", control: JETON });
  });

  it("un attachement sans jeton valide n'est pas un attachement", () => {
    const base = { type: "3dd-doc-present-attach", slug: "Ab3-_xYz9012" };
    for (const control of [undefined, "", "court", "a".repeat(129), "jeton avec espaces 0123", "<script>0123456789", 1234567890123456]) {
      expect(parseHostMessage({ ...base, control }), String(control)).toBeNull();
    }
    expect(parseHostMessage({ type: "3dd-doc-present-attach", slug: "../x", control: JETON })).toBeNull();
    expect(parseHostMessage({ type: "3dd-doc-present-attach", control: JETON })).toBeNull();
  });

  // ⚠️ Avant la table par sens, `parseHostMessage` lisait `embed-denied` — un message du player.
  it("chaque sens ne lit que ses propres messages", () => {
    expect(parsePlayerMessage({ type: "3dd-doc-present-attach", slug: "Ab3-_xYz9012", control: JETON })).toBeNull();
    expect(parseHostMessage({ type: "3dd-doc-present-attached", slug: "Ab3-_xYz9012" })).toBeNull();
    expect(parseHostMessage({ type: "3dd-doc-embed-denied", reason: "revoked" })).toBeNull();
  });

  // Une table en objet littéral trouverait `constructor` dans son prototype — et itérerait une fonction.
  it("un nom tiré du prototype n'est pas un type de message", () => {
    for (const type of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
      expect(parsePlayerMessage({ type: "3dd-doc-" + type, slug: "abc" }), type).toBeNull();
      expect(parseHostMessage({ type: "3dd-doc-" + type, slug: "abc" }), type).toBeNull();
    }
  });

  it("les annonces du player portent le slug, et l'échec son motif", () => {
    for (const type of ["present-started", "present-ended", "present-attached"] as const) {
      expect(parsePlayerMessage(toWire({ type, slug: "Ab3-_xYz9012" }))).toEqual({ type, slug: "Ab3-_xYz9012" });
      expect(parsePlayerMessage({ type: "3dd-doc-" + type }), "sans slug, l'hôte ne saurait pas de quoi on parle").toBeNull();
    }
    expect(parsePlayerMessage(toWire({ type: "present-attach-failed", slug: "Ab3-_xYz9012", reason: "denied" })))
      .toEqual({ type: "present-attach-failed", slug: "Ab3-_xYz9012", reason: "denied" });
    expect(parsePlayerMessage({ type: "3dd-doc-present-attach-failed", slug: "Ab3-_xYz9012", reason: "<b>" }))
      .toEqual({ type: "present-attach-failed", slug: "Ab3-_xYz9012", reason: "unknown" });
  });

  function cadre(src: string) {
    const postMessage = vi.fn();
    return { frame: { src, contentWindow: { postMessage } } as unknown as HTMLIFrameElement, postMessage };
  }

  it("le jeton est posté à l'ORIGINE du player, jamais à « * »", () => {
    const { frame, postMessage } = cadre("https://doc.exemple.fr/api/doc?preview=1&embed=1&url=x");
    expect(sendToPlayer(frame, { type: "present-attach", slug: "Ab3-_xYz9012", control: JETON })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith(
      { type: "3dd-doc-present-attach", slug: "Ab3-_xYz9012", control: JETON },
      "https://doc.exemple.fr",
    );
  });

  it("sans origine connue, le jeton ne part pas — et l'hôte le sait", () => {
    for (const src of ["", "about:blank", "data:text/html,x"]) {
      const { frame, postMessage } = cadre(src);
      expect(sendToPlayer(frame, { type: "present-attach", slug: "Ab3-_xYz9012", control: JETON }), src).toBe(false);
      expect(postMessage, src).not.toHaveBeenCalled();
    }
    const { frame, postMessage } = cadre("https://doc.exemple.fr/api/doc");
    expect(sendToPlayer(frame, { type: "present-attach", slug: "Ab3-_xYz9012", control: JETON }, "*"),
      "« * » demandé explicitement reste refusé pour un secret").toBe(false);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("les messages sans secret partent comme avant, à « * »", () => {
    const { frame, postMessage } = cadre("");
    expect(sendToPlayer(frame, { type: "handover-done" })).toBe(true);
    expect(postMessage).toHaveBeenCalledWith({ type: "3dd-doc-handover-done" }, "*");
  });
});

// ── #596 : l'hôte déclare la barre, le player lui dit la page et le clic ─────────────────────────────
//
// ⚠️ CE QUE CES MESSAGES TRANSPORTENT FINIT À L'ÉCRAN (libellés) ou DANS LE CODE DE L'HÔTE (id). Ils sont
// donc bornés ici, une fois, comme le slug : forme stricte, ou le message est ignoré EN ENTIER — un
// onglet de trop ne tronque pas la liste, il la refuse.
describe("bridge — chrome (hôte → player, #596)", () => {
  const OK = {
    type: "3dd-doc-chrome",
    subtitle: "Clos Belharra · Anglet",
    tabs: [{ id: "doc:plaquette", label: "Plaquette" }, { id: "doc:notice", label: "Notice" }],
    activeTab: "doc:plaquette",
    actions: [{ id: "share", label: "Envoyer au client", place: "primary" }, { id: "fiche-lot", label: "Fiche du lot", place: "secondary" }],
  };

  it("lit un chrome bien formé, champ par champ", () => {
    expect(parseHostMessage(OK)).toEqual({
      type: "chrome",
      subtitle: "Clos Belharra · Anglet",
      tabs: [{ id: "doc:plaquette", label: "Plaquette" }, { id: "doc:notice", label: "Notice" }],
      activeTab: "doc:plaquette",
      actions: [{ id: "share", label: "Envoyer au client", place: "primary" }, { id: "fiche-lot", label: "Fiche du lot", place: "secondary" }],
    });
    expect(parseHostMessage({ type: "3dd-doc-chrome" }), "tout est facultatif : un chrome vide remet la barre à nu").toEqual({ type: "chrome" });
  });

  it("fait l'aller-retour sans perte", () => {
    const msg = parseHostMessage(OK)!;
    expect(parseHostMessage(toWire(msg))).toEqual(msg);
  });

  it("lit les gestes du présentateur que l'hôte sait traiter (13/11)", () => {
    const lu = parseHostMessage({ type: "3dd-doc-chrome", presenter: ["start", "switch", "handover"] });
    expect(lu).toEqual({ type: "chrome", presenter: ["start", "switch", "handover"] });
    expect(parsePlayerMessage({ type: "3dd-doc-present-request" }), "« Présenter » demandé à l'hôte").toEqual({ type: "present-request" });
    expect(parseHostMessage(toWire(lu!))).toEqual(lu);
    expect(parseHostMessage({ type: "3dd-doc-chrome", presenter: [] }), "une liste vide : aucun geste").toEqual({ type: "chrome", presenter: [] });
  });

  it("refuse le message entier sur la moindre faute", () => {
    const fautes: Record<string, unknown>[] = [
      { tabs: Array.from({ length: 9 }, (_, i) => ({ id: `t${i}`, label: "x" })) },
      { actions: Array.from({ length: 7 }, (_, i) => ({ id: `a${i}`, label: "x", place: "menu" })) },
      { tabs: [{ id: "Majuscule", label: "x" }] },
      { tabs: [{ id: "a", label: "x".repeat(41) }] },
      { tabs: [{ id: "a", label: "   " }] },
      { tabs: [{ id: "a", label: "x" }, { id: "a", label: "y" }] },
      { tabs: [{ id: "a", label: "x" }], activeTab: "b" },
      { activeTab: "a" },
      { actions: [{ id: "a", label: "x", place: "center" }] },
      { actions: [{ id: "a", label: 3, place: "menu" }] },
      { subtitle: "x".repeat(81) },
      { subtitle: 42 },
      { tabs: "Plaquette" },
      { tabs: [null] },
      { presenter: ["switch", "switch"] },
      { presenter: ["dance"] },
      { presenter: "switch" },
      { presenter: ["start", "switch", "invite", "handover", "switch"] },
    ];
    for (const f of fautes) expect(parseHostMessage({ type: "3dd-doc-chrome", ...f }), JSON.stringify(f).slice(0, 80)).toBeNull();
  });

  it("n'emporte pas de champ inconnu", () => {
    const lu = parseHostMessage({ type: "3dd-doc-chrome", subtitle: "a", html: "<b>x</b>", tabs: [{ id: "a", label: "x", onclick: "y" }] });
    expect(lu).toEqual({ type: "chrome", subtitle: "a", tabs: [{ id: "a", label: "x" }] });
  });
});

describe("bridge — host-action et page (player → hôte, #596)", () => {
  it("host-action porte un id borné", () => {
    expect(parsePlayerMessage({ type: "3dd-doc-host-action", id: "doc:notice" })).toEqual({ type: "host-action", id: "doc:notice" });
    for (const id of ["", "A", "a b", "x".repeat(41), "<x>", 3]) expect(parsePlayerMessage({ type: "3dd-doc-host-action", id })).toBeNull();
    expect(parsePlayerMessage(toWire({ type: "host-action", id: "fiche-lot" }))).toEqual({ type: "host-action", id: "fiche-lot" });
  });

  it("page porte deux entiers cohérents", () => {
    expect(parsePlayerMessage({ type: "3dd-doc-page", page: 3, total: 21 })).toEqual({ type: "page", page: 3, total: 21 });
    for (const [page, total] of [[0, 21], [22, 21], [1.5, 21], [1, 10001], ["3", 21], [3, null]]) {
      expect(parsePlayerMessage({ type: "3dd-doc-page", page, total }), `${page}/${total}`).toBeNull();
    }
    expect(parsePlayerMessage(toWire({ type: "page", page: 21, total: 21 }))).toEqual({ type: "page", page: 21, total: 21 });
  });
});
