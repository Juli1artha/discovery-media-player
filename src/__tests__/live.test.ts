import { describe, it, expect } from "vitest";
import {
  escapeHtml,
  initials,
  avatarHtml,
  formatMessageBody,
  flattenPresence,
  attendeeKey,
  authorToken,
  reactorId,
  isMine,
  canModerate,
  isMentioned,
  shouldNotify,
  unreadLabel,
  STORAGE_KEYS,
  type KeyValueStore,
} from "../live";

function memoryStore(seed: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...seed };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = v; } };
}

const hostileStore: KeyValueStore = {
  getItem() { throw new Error("navigation privée"); },
  setItem() { throw new Error("navigation privée"); },
};

describe("live — présence dédoublonnée", () => {
  // LE bug « je me vois deux fois » : la clé du canal contient un identifiant tiré au sort à chaque
  // chargement, donc un reconnecté occupe deux entrées. Seule l'identité stable les fond.
  it("fond deux entrées du même participant reconnecté", () => {
    const list = flattenPresence({
      "moi@example.fr:aleatoire1": [{ uid: "moi@example.fr", name: "Moi" }],
      "moi@example.fr:aleatoire2": [{ uid: "moi@example.fr", name: "Moi" }],
      "autre:xyz": [{ uid: "autre@example.fr", name: "Autre" }],
    });
    expect(list).toHaveLength(2);
    expect(list.map((p) => p.name)).toEqual(["Moi", "Autre"]);
  });

  it("l'identité est insensible à la casse et retombe sur l'email puis le nom", () => {
    expect(flattenPresence({ a: [{ email: "A@Example.fr" }], b: [{ email: "a@example.fr" }] })).toHaveLength(1);
    expect(flattenPresence({ a: [{ name: "Léa" }], b: [{ name: "léa" }] })).toHaveLength(1);
  });

  // En cas de collision, c'est la métadonnée du présentateur qui porte le rôle : la perdre
  // ferait disparaître le badge « présentateur » de la liste des participants.
  it("le présentateur l'emporte sur son propre doublon spectateur", () => {
    const list = flattenPresence({
      onglet1: [{ uid: "u1", name: "Léa", role: "viewer" }],
      onglet2: [{ uid: "u1", name: "Léa", role: "presenter" }],
    });
    expect(list).toHaveLength(1);
    expect(list[0].role).toBe("presenter");
  });

  // Sans identité, on ne peut PAS dédoublonner : fondre des inconnus distincts en un seul
  // masquerait des participants réels.
  it("garde distincts les participants sans aucune identité", () => {
    expect(flattenPresence({ a: [{}], b: [{}] })).toHaveLength(2);
  });

  it("supporte un état vide, nul ou biscornu", () => {
    expect(flattenPresence(null)).toEqual([]);
    expect(flattenPresence(undefined)).toEqual([]);
    expect(flattenPresence({})).toEqual([]);
    expect(flattenPresence({ a: [] })).toEqual([]);
  });
});

describe("live — échappement et mise en forme", () => {
  it("échappe ce qui pourrait sortir du balisage", () => {
    expect(escapeHtml('<b>&"')).toBe("&lt;b&gt;&amp;&quot;");
    expect(escapeHtml(null)).toBe("");
    expect(escapeHtml(undefined)).toBe("");
  });

  // Un message contenant </script> a déjà produit un XSS stocké sur la page audience.
  it("neutralise une tentative de fermeture de balise", () => {
    const out = formatMessageBody("</script><script>alert(1)</script>");
    expect(out).not.toMatch(/<\/script/i);
    expect(out).not.toMatch(/<script/i);
  });

  it("neutralise un gestionnaire d'événement injecté", () => {
    const out = formatMessageBody('<img src=x onerror="alert(1)">');
    expect(out).not.toMatch(/<img/i);
    expect(out).toContain("&lt;img");
  });

  // L'ordre est vital : enrichir AVANT d'échapper rendrait le balisage de l'auteur exécutable.
  it("échappe d'abord, enrichit ensuite", () => {
    const out = formatMessageBody('Voir <b>ici</b> https://exemple.fr/a?x=1&y=2');
    expect(out).toContain("&lt;b&gt;ici&lt;/b&gt;");
    expect(out).toContain('<a href="https://exemple.fr/a?x=1&amp;y=2"');
    expect(out).toContain("rel=noreferrer");
  });

  it("ne transforme en lien QUE http(s) — jamais javascript: ni data:", () => {
    for (const hostile of ["javascript:alert(1)", "data:text/html,<b>x</b>", "vbscript:x"]) {
      expect(formatMessageBody(hostile)).not.toContain("<a href");
    }
  });

  it("met en valeur les mentions, accents compris", () => {
    expect(formatMessageBody("salut @léa ça va")).toContain("<span class=cm-mention>@léa</span>");
    expect(formatMessageBody("email@exemple.fr")).not.toContain("cm-mention"); // pas en début de mot
  });

  it("initiales et avatar de repli", () => {
    expect(initials("Léa Martin")).toBe("LM");
    expect(initials("Solo")).toBe("S");
    expect(initials("")).toBe("?");
    expect(initials(undefined)).toBe("?");
    expect(avatarHtml("", "Léa Martin")).toBe("LM");
    expect(avatarHtml('x" onerror="alert(1)', "n")).toBe('<img src="x&quot; onerror=&quot;alert(1)" alt="">');
  });
});

describe("live — identité persistante", () => {
  it("un membre est identifié par son email, en minuscules", () => {
    expect(attendeeKey({ email: "Lea@Example.FR" }, memoryStore())).toBe("lea@example.fr");
  });

  it("un anonyme reçoit une clé persistante, réutilisée ensuite", () => {
    const store = memoryStore();
    const first = attendeeKey(null, store, "session", () => "abc123");
    expect(first).toBe("anon-abc123");
    expect(store.data[STORAGE_KEYS.attendeeKey]).toBe("anon-abc123");
    expect(attendeeKey(null, store, "session", () => "autre")).toBe("anon-abc123");
  });

  // Sans persistance, le participant comptera pour deux visites : c'est dégradé, pas cassé.
  it("retombe sur l'identifiant de session si le stockage est indisponible", () => {
    expect(attendeeKey(null, hostileStore, "session-42")).toBe("anon-session-42");
    expect(attendeeKey(null, null, "session-42")).toBe("anon-session-42");
  });

  it("le jeton d'auteur est créé une fois puis réutilisé", () => {
    const store = memoryStore();
    const token = authorToken(store, () => "jeton-stable");
    expect(token).toBe("jeton-stable");
    expect(authorToken(store, () => "autre")).toBe("jeton-stable");
  });

  it("le jeton d'auteur survit à un stockage qui lève", () => {
    expect(authorToken(hostileStore, () => "ephemere")).toBe("ephemere");
  });

  it("l'identifiant de réaction retombe sur le nom pour un anonyme", () => {
    expect(reactorId({ email: "A@B.fr" })).toBe("a@b.fr");
    expect(reactorId({ name: "Léa" })).toBe("léa");
    expect(reactorId(null)).toBe("");
  });
});

describe("live — prédicats", () => {
  it("reconnaît mes messages par email, et par nom entre anonymes", () => {
    expect(isMine({ author_email: "a@b.fr" }, { email: "a@b.fr" })).toBe(true);
    expect(isMine({ author_email: "a@b.fr" }, { email: "z@b.fr" })).toBe(false);
    expect(isMine({ author_name: "Léa" }, { name: "Léa" })).toBe(true);
    expect(isMine({ author_name: "Léa" }, { name: "Autre" })).toBe(false);
  });

  // Un membre identifié ne doit pas s'approprier le message d'un anonyme homonyme.
  it("ne mélange pas un auteur identifié et un lecteur anonyme", () => {
    expect(isMine({ author_email: "a@b.fr", author_name: "Léa" }, { name: "Léa" })).toBe(false);
    expect(isMine({ author_name: "Léa" }, { email: "a@b.fr", name: "Léa" })).toBe(false);
  });

  it("seul le présentateur modère", () => {
    expect(canModerate({ role: "presenter" })).toBe(true);
    expect(canModerate({ role: "viewer" })).toBe(false);
    expect(canModerate(null)).toBe(false);
  });

  it("détecte une citation par le prénom, sauf la sienne", () => {
    const me = { name: "Léa Martin", email: "lea@b.fr" };
    expect(isMentioned({ body: "merci @léa" }, me)).toBe(true);
    expect(isMentioned({ body: "MERCI @LÉA" }, me)).toBe(true);
    expect(isMentioned({ body: "merci @thomas" }, me)).toBe(false);
    expect(isMentioned({ body: "@léa je me cite", author_email: "lea@b.fr" }, me)).toBe(false);
    expect(isMentioned({ body: "@léa" }, null)).toBe(false);
  });
});

describe("live — badge de non-lus", () => {
  const me = { email: "moi@b.fr", name: "Moi" };
  const base = { me, historyLoaded: true, chatHidden: true };

  it("compte un message reçu quand le panneau est fermé", () => {
    expect(shouldNotify({ ...base, msg: { author_email: "autre@b.fr", body: "coucou" } })).toBe(true);
  });

  // Sans cette garde, l'historique rechargé au join afficherait un badge de dizaines de messages vus.
  it("ne compte jamais l'historique rejoué", () => {
    expect(shouldNotify({ ...base, historyLoaded: false, msg: { author_email: "autre@b.fr" } })).toBe(false);
  });

  it("ne compte ni mes messages, ni les supprimés, ni panneau ouvert", () => {
    expect(shouldNotify({ ...base, msg: { author_email: "moi@b.fr" } })).toBe(false);
    expect(shouldNotify({ ...base, msg: { author_email: "autre@b.fr", deleted: true } })).toBe(false);
    expect(shouldNotify({ ...base, chatHidden: false, msg: { author_email: "autre@b.fr" } })).toBe(false);
  });

  it("plafonne le libellé à 9+", () => {
    expect([0, 1, 9, 10, 250].map(unreadLabel)).toEqual(["", "1", "9", "9+", "9+"]);
  });
});

// ⚠️ CE JETON AUTORISE — IL NE DÉSIGNE PAS.
//
// C'est lui qui prouve « ce message est le mien » pour le modifier ou le supprimer. Il était tiré
// de `Math.random()`, dont la suite est déterministe à partir de l'état interne du moteur : qui en
// devine un peut réécrire les messages d'un autre participant.
//
// Acceptable pour un identifiant d'analyse, jamais pour un droit. Signalé par l'analyse statique
// et par l'audit externe (P3-1).
describe("le jeton d'auteur est imprévisible", () => {
  const magasin = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); } };
  };

  it("ne vient pas de Math.random", () => {
    const vraiRandom = Math.random;
    Math.random = () => { throw new Error("Math.random ne doit pas servir à autoriser"); };
    try {
      expect(() => authorToken(magasin())).not.toThrow();
    } finally { Math.random = vraiRandom; }
  });

  it("deux navigateurs n'obtiennent pas le même", () => {
    const vus = new Set(Array.from({ length: 200 }, () => authorToken(magasin())));
    expect(vus.size, "aucune collision attendue").toBe(200);
  });

  it("il est assez long pour ne pas se deviner", () => {
    expect(authorToken(magasin()).length).toBeGreaterThanOrEqual(32);
  });

  // Le repli existe pour un environnement sans `crypto`, mais il ne doit pas être silencieux :
  // mieux vaut un jeton faible qu'un chat cassé — à condition que ça se sache.
  it("sans crypto, il prévient au lieu de se taire", () => {
    const vrai = (globalThis as { crypto?: unknown }).crypto;
    const avertis: unknown[] = [];
    const vraiWarn = console.warn;
    console.warn = (...a: unknown[]) => avertis.push(a.join(" "));
    try {
      delete (globalThis as { crypto?: unknown }).crypto;
      const t = authorToken(magasin());
      expect(t.length).toBeGreaterThan(0);
      expect(avertis.join(" ")).toMatch(/crypto/i);
    } finally {
      (globalThis as { crypto?: unknown }).crypto = vrai;
      console.warn = vraiWarn;
    }
  });
});
