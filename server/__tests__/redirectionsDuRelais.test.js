// LES TROIS PROPRIÉTÉS DE LA BOUCLE DE REDIRECTION — copiées du commentaire qui les énonce.
//
// ⚠️ CE FICHIER EXISTE À CAUSE D'UN GESTE, PAS D'UN INCIDENT. Le second hôte l'a formulé ainsi :
// un commentaire qui AUTORISE UNE ABSENCE DE CODE — ou qui justifie du code écrit à la main —
// est déjà l'intitulé d'un test. Il suffit de le retourner ; la propriété, sa condition et son
// résultat attendu sont tous les trois dans la phrase.
//
// Appliqué au dépôt, ce geste a trouvé en trois minutes que `fetchAllowedFile` énumérait TROIS
// propriétés pour justifier de suivre les redirections à la main — dont une de SÉCURITÉ — et
// qu'aucune n'était éprouvée. Le commentaire disait :
//
//   1. chaque saut repasse la garde complète — une redirection n'ouvre rien que l'URL de départ
//      n'aurait pas ouvert ;
//   2. le secret est recalculé À CHAQUE SAUT — il ne part que si CE saut-là est sous la route de
//      l'hôte, jamais parce que le premier l'était ;
//   3. le nombre de sauts est borné, et le protocole ne peut pas changer de nature.
//
// La deuxième est la plus coûteuse si elle est fausse : le secret de relais autorise à lire TOUS
// les documents de l'hôte. Une redirection qui l'emporterait hors de la route de l'hôte n'est pas
// une SSRF, c'est une exfiltration de clé.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const storage = require("../../context/storage.js");

const ORIGINES = ["https://exemple.supabase.co"];
// ⚠️ `hostBase` est un OBJET {origin, path}, pas une chaîne — et la barre finale est obligatoire
// (la comparaison est un préfixe de chaîne). On le fabrique par la fonction du produit plutôt que
// de le recopier : recopier la forme, c'est recopier un contrat qui peut changer.
const HOTE_URL = "https://hote.exemple.fr/api/doc/";
const HOTE = storage.hostFetchBase({ PLAYER_HOST_FETCH_BASE: HOTE_URL });
const SECRET = "secret-de-relais";
const AUTORISE = "https://exemple.supabase.co/storage/v1/object/public/resources/doc.pdf";

/** Un `fetch` de laboratoire : on scénarise les sauts et on ENREGISTRE ce qui part avec chacun. */
function faussefetch(scenario) {
  const vus = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, o) => {
    const u = String(url);
    vus.push({ url: u, secret: (o.headers && o.headers["x-player-fetch-secret"]) || null });
    const etape = scenario[u];
    if (!etape) return { status: 200, headers: { get: () => null } };
    if (etape.vers) return { status: 302, headers: { get: (k) => (String(k).toLowerCase() === "location" ? etape.vers : null) } };
    return { status: 200, headers: { get: () => null } };
  };
  return { vus, rendre: () => { globalThis.fetch = original; } };
}

const lire = (url, opts = {}) =>
  storage.fetchAllowedFile(url, {}, { origins: ORIGINES, hostBase: HOTE, secret: SECRET, ...opts });

describe("1. chaque saut repasse la garde complète", () => {
  it("une redirection vers une origine NON autorisée est refusée", async () => {
    const f = faussefetch({ [AUTORISE]: { vers: "https://ailleurs.example/vole.pdf" } });
    try {
      const r = await lire(AUTORISE);
      expect(r, "la redirection sort de l'allowlist : elle n'ouvre rien de plus que l'URL de départ").toBeNull();
      expect(f.vus.length, "et surtout, on n'a PAS suivi le saut").toBe(1);
    } finally { f.rendre(); }
  });

  it("une redirection vers une origine autorisée est suivie", async () => {
    const suite = "https://exemple.supabase.co/storage/v1/object/public/resources/suite.pdf";
    const f = faussefetch({ [AUTORISE]: { vers: suite } });
    try {
      const r = await lire(AUTORISE);
      expect(r && r.status, "sinon cette garde refuserait tout, ce qui ne prouve rien").toBe(200);
      expect(f.vus.map((v) => v.url)).toEqual([AUTORISE, suite]);
    } finally { f.rendre(); }
  });
});

// ⚠️ LA PROPRIÉTÉ DE SÉCURITÉ. Le secret autorise à lire TOUS les documents de l'hôte.
describe("2. le secret est recalculé à chaque saut", () => {
  it("il part sur un saut sous la route de l'hôte", async () => {
    const f = faussefetch({});
    try {
      await lire(HOTE_URL + "x.pdf");
      expect(f.vus[0].secret, "un appel direct à la route de l'hôte doit porter le secret").toBe(SECRET);
    } finally { f.rendre(); }
  });

  it("⚠️ il NE part PAS sur un saut qui quitte la route de l'hôte", async () => {
    const ailleurs = "https://exemple.supabase.co/storage/v1/object/public/resources/doc.pdf";
    const f = faussefetch({ [HOTE_URL + "x.pdf"]: { vers: ailleurs } });
    try {
      await lire(HOTE_URL + "x.pdf");
      expect(f.vus.length, "les deux sauts doivent avoir eu lieu").toBe(2);
      expect(f.vus[0].secret, "premier saut : sous la route de l'hôte").toBe(SECRET);
      expect(f.vus[1].secret,
        "le secret a suivi la redirection : ce n'est pas une SSRF, c'est une EXFILTRATION DE CLÉ —\n"
        + "elle autorise à lire tous les documents de l'hôte.")
        .toBeNull();
    } finally { f.rendre(); }
  });
});

describe("3. les sauts sont bornés, et le protocole ne change pas de nature", () => {
  // ⚠️ CE CAS N'EXISTE QUE SI UNE RACINE LOCALE EST CONFIGURÉE, et ma première version l'ignorait.
  // Sans `root`, l'allowlist refuse déjà `file:` — le contrôle de protocole est alors REDONDANT, et
  // le retirer ne faisait rougir aucun test : deux gardes, un seul observable. Avec `root`, une URL
  // `file:` SOUS la racine est autorisée par l'allowlist : c'est là que le contrôle de protocole est
  // la seule chose qui empêche un amont distant de devenir une lecture de disque.
  it("une redirection vers file: est refusée, MÊME sous une racine locale autorisée", async () => {
    const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "redir-")));
    const cible = path.join(racine, "secret.pdf");
    fs.writeFileSync(cible, "contenu local");
    const f = faussefetch({ [AUTORISE]: { vers: new URL("file://" + cible).href } });
    try {
      const r = await lire(AUTORISE, { root: racine });
      expect(r, "un amont distant vient de se transformer en lecture de disque local").toBeNull();
      expect(f.vus.length, "et le saut n'a pas été suivi").toBe(1);
    } finally { f.rendre(); fs.rmSync(racine, { recursive: true, force: true }); }
  });

  it("témoin : la même racine SERT bien un fichier demandé directement", async () => {
    const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "redir-")));
    const cible = path.join(racine, "ok.pdf");
    fs.writeFileSync(cible, "contenu local");
    try {
      const r = await lire(new URL("file://" + cible).href, { root: racine });
      expect(r && r.status, "sans ce témoin, le test ci-dessus passerait sur une racine inopérante").toBe(200);
      if (r && r.body) await r.body.cancel();
    } finally { fs.rmSync(racine, { recursive: true, force: true }); }
  });

  it("une boucle de redirections est refusée, pas suivie indéfiniment", async () => {
    const a = AUTORISE;
    const b = "https://exemple.supabase.co/storage/v1/object/public/resources/b.pdf";
    const f = faussefetch({ [a]: { vers: b }, [b]: { vers: a } });
    try {
      expect(await lire(a), "une boucle doit être refusée").toBeNull();
      expect(f.vus.length, "et le nombre de sauts est BORNÉ — sinon la fonction tournerait sans fin")
        .toBeLessThanOrEqual(7);
    } finally { f.rendre(); }
  });
});
