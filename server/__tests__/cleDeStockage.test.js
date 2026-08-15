// LA CLÉ D'UN SEUL HÔTE, ÉCRITE EN DUR POUR TOUS LES AUTRES.
//
// `3dd-supabase-auth` — la clé de session du studio 3D Discovery — figurait à cinq endroits de ce
// paquet open source. Chez tout autre hôte, `detectMember()` et `accessToken()` ne trouvaient donc
// jamais rien : AUCUN de ses membres n'était reconnu comme tel, et la séparation des populations
// interne/externe que ce produit vend ne fonctionnait que chez nous.
//
// ⚠️ Depuis 0.1.25 cette clé porte en plus une propriété de SÉCURITÉ : c'est par elle que
// l'appartenance se prouve. Une constante d'un hôte devenue porteuse pour tous.
//
// ⚠️ Signalé par le second hôte, dont l'instance est sur `doc.adnfamily.com` et l'application sur
// `app.adnfamily.com`. Ce qui donne le point suivant, plus important que le réglage lui-même :
// deux origines, ce sont deux `localStorage`, et AUCUNE valeur de configuration n'y changera quoi
// que ce soit. Rendre la clé réglable est une transition, pas une solution.

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");

function fichiersDuPaquet() {
  const sortie = [];
  for (const dossier of ["server", "context", "src", "bin"]) {
    const d = path.join(RACINE, dossier);
    if (!fs.existsSync(d)) continue;
    for (const f of fs.readdirSync(d)) {
      if (!/\.(js|ts|mjs|cjs)$/.test(f)) continue;
      if (f.includes(".generated.")) continue;
      sortie.push(path.join(d, f));
    }
  }
  return sortie;
}

describe("aucune clé de stockage propre à un hôte", () => {
  // On vise la FORME — un identifiant de marque suivi d'un usage d'auth — plutôt qu'une valeur
  // précise : interdire seulement `3dd-supabase-auth` laisserait passer le prochain.
  const SUSPECT = /localStorage\.(get|set)Item\(\s*['"][^'"]*(auth|session|supabase)[^'"]*['"]/i;

  it("aucun appel à localStorage avec un nom littéral de session", () => {
    const trouves = [];
    for (const f of fichiersDuPaquet()) {
      fs.readFileSync(f, "utf8").split("\n").forEach((ligne, i) => {
        if (/^\s*(\/\/|\*)/.test(ligne)) return;                     // les commentaires en parlent
        if (SUSPECT.test(ligne)) trouves.push(`${path.basename(f)}:${i + 1}`);
      });
    }
    expect(trouves, "une clé de session en dur :\n" + trouves.join("\n")).toEqual([]);
  });

  it("plus aucune trace de la clé du studio dans le paquet", () => {
    const porteurs = fichiersDuPaquet().filter((f) => {
      const src = fs.readFileSync(f, "utf8");
      // Les commentaires ont le droit de la nommer : c'est même là qu'elle doit être expliquée.
      return src.split("\n").some((l) => l.includes("3dd-supabase-auth") && !/^\s*(\/\/|\*)/.test(l));
    });
    expect(porteurs.map((f) => path.basename(f))).toEqual([]);
  });

  it("le balayage regarde bien quelque part", () => {
    expect(fichiersDuPaquet().length).toBeGreaterThanOrEqual(6);
  });
});

describe("le défaut est fermé, pas pratique", () => {
  const { createStandaloneContext } = require("../../context/standalone.js");

  it("sans variable, aucune clé — donc aucun membre, donc aucune usurpation", () => {
    const c = createStandaloneContext({ SUPABASE_URL: "https://x.supabase.co" });
    expect(c.config.hostAuthStorageKey,
      "un défaut à `3dd-supabase-auth` aurait gardé NOTRE instance en marche en laissant le défaut de conception intact")
      .toBe("");
  });

  it("l'hôte la déclare, et elle est reprise telle quelle", () => {
    const c = createStandaloneContext({ SUPABASE_URL: "https://x.supabase.co", PLAYER_HOST_AUTH_STORAGE_KEY: "  ma-cle-a-moi  " });
    expect(c.config.hostAuthStorageKey).toBe("ma-cle-a-moi");
  });
});

// ⚠️ La session du CLIENT REALTIME du player doit avoir un nom déclaré, pas celui par défaut.
// Ce client vivra un jour une session anonyme (canal privé). S'il écrit sous la clé par défaut et
// que l'application de l'hôte l'utilise aussi sur la même origine, la session anonyme ÉCRASE celle
// du membre connecté. Chez nous les deux diffèrent déjà — mais par heureux hasard, et une topologie
// peut changer.
describe("le client Realtime range sa session sous son propre nom", () => {
  const SRC = fs.readFileSync(path.join(__dirname, "..", "handler.js"), "utf8");

  it("createClient déclare un storageKey", () => {
    const i = SRC.indexOf("supabase.createClient(LIVECFG.supaUrl");
    expect(i, "l'appel existe").toBeGreaterThan(0);
    expect(SRC.slice(i, i + 700)).toMatch(/storageKey\s*:/);
  });

  it("et ce nom n'est pas celui d'un hôte", () => {
    expect(SRC).toContain('const CLE_SESSION_PLAYER = "dmp-live-auth"');
  });
});
