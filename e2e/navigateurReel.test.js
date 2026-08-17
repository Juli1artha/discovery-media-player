// LA PAGE, DANS UN VRAI NAVIGATEUR.
//
// ⚠️ POURQUOI CE BANC EXISTE : `jsdom` N'APPLIQUE PAS LA CSP. Nos 690 essais couvrent le serveur
// avec un `res` postiche qui se contente d'ENREGISTRER les en-têtes, et la page avec `jsdom` qui
// exécute tout script qu'on lui donne, nonce ou pas. Les deux moitiés sont vertes même quand la
// politique servie interdit exactement le script que la page a besoin d'exécuter — c'est-à-dire
// même quand la visionneuse est un écran blanc chez le visiteur.
//
// Le second hôte l'a formulé pour nous : un en-tête qu'on RELIT n'est pas un en-tête qu'on
// APPLIQUE. Seul un moteur qui refuse pour de vrai peut nous dire si nos règles laissent passer
// nos propres scripts. C'est la seule chose que ce banc apporte, et c'est pour ça qu'il coûte un
// navigateur.
//
// ⚠️ ET IL DOIT REFUSER AU MOINS UNE FOIS. Un collecteur de violations qui reste vide ne prouve
// rien : il est vide aussi quand on a oublié de le brancher. Le second essai plante donc deux
// scripts que la politique DOIT refuser, et exige de les voir refusés. Sans lui, le premier essai
// serait vert sur une page qui n'a jamais été surveillée.
//
// ── CE QUE LES MUTATIONS ONT APPRIS ─────────────────────────────────────────────────────────────
// Deux défauts posés à la main, pour savoir si ce banc sert à quelque chose :
//
//   • le nonce retiré de la balise du paquet navigateur → LES DEUX ESSAIS ROUGES. C'est le défaut
//     qu'aucun de nos 690 autres essais ne peut voir, et celui qui donne un écran blanc.
//
//   • une origine retirée de `script-src` → VERT, et le banc avait raison : la balise concernée
//     PORTE LE NONCE, et un nonce autorise aussi un script EXTERNE. L'entrée d'hôte lui est
//     redondante. Elle ne sert qu'aux scripts injetés par d'autres scripts, qui n'héritent
//     d'aucun nonce (le chargeur de cartes, par exemple) — les retirer casserait ceux-là.
//
// La seconde mutation avait d'abord été posée sur la balise de la page d'AUDIENCE en croyant
// toucher l'aperçu : elle ne mesurait rien. Une mutation dont on ne vérifie pas qu'elle a atterri
// raconte n'importe quoi — dans les deux sens.
//
// ── CE QUE CE BANC NE COUVRE PAS ────────────────────────────────────────────────────────────────
// L'aperçu local est la seule page qu'on sait servir SANS base : la visionneuse tracée
// (`/doc/:slug`), le mur d'accès et la page d'audience ont chacun leur propre politique, et
// aucune n'est exercée ici. Ce banc couvre une page sur quatre — le dire est plus utile que de
// laisser croire qu'il les couvre toutes.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

// PNG 4×4 valide. Une IMAGE et pas un PDF : le chemin image ne demande pas pdf.js, donc le banc
// prouve le démarrage de la page sans dépendre du rendu d'une bibliothèque tierce.
const PNG_4x4 =
  "iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAF0lEQVR4nGP8z8Dwn4GKgImaho0aOGwMBADSlwHhSSSXfwAAAABJRU5ErkJggg==";

/**
 * Le navigateur du système, jamais un téléchargement.
 *
 * On dépend de `playwright-core` — le pilote SANS les navigateurs. Un contributeur qui clone le
 * dépôt installe quelques mégaoctets, pas quelques centaines, et le banc se sert du Chrome qu'il
 * a déjà. Les images d'Ubuntu de la forge en embarquent un.
 */
function chercherChrome() {
  const candidats = [
    process.env.PLAYER_E2E_CHROME,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter(Boolean);
  return candidats.find((c) => { try { fs.accessSync(c, fs.constants.X_OK); return true; } catch { return false; } }) || "";
}

const chrome = chercherChrome();

// ⚠️ SUR LA FORGE, L'ABSENCE DE NAVIGATEUR EST UNE PANNE, PAS UNE DISPENSE. Un banc qui s'esquive
// tout seul le jour où l'image change de contenu laisserait exactement le trou qu'il est censé
// fermer — et personne ne lirait la ligne « ignoré ». En local, on passe notre chemin en le disant.
if (!chrome && !process.env.CI) {
  console.warn("\n⚠️  navigateur réel : ignoré — aucun Chrome trouvé.\n" +
    "   Installez Google Chrome, ou donnez le chemin dans PLAYER_E2E_CHROME.\n");
}

describe.skipIf(!chrome && !process.env.CI)("la page démarre dans un vrai navigateur", () => {
  let serveur, port, navigateur, racine;

  beforeAll(async () => {
    racine = fs.mkdtempSync(path.join(os.tmpdir(), "player-e2e-"));
    fs.writeFileSync(path.join(racine, "essai.png"), Buffer.from(PNG_4x4, "base64"));

    // ⚠️ AVANT le `require` : le serveur autonome fabrique son contexte à l'import, à partir de
    // l'environnement. Régler la racine après ne servirait à rien.
    process.env.PLAYER_LOCAL_ROOT = racine;
    ({ serveur } = require("../bin/serve.js"));
    await new Promise((resolve) => serveur.listen(0, "127.0.0.1", resolve));
    port = serveur.address().port;

    if (!chrome) throw new Error("aucun navigateur : installez Chrome ou renseignez PLAYER_E2E_CHROME");
    const { chromium } = require("playwright-core");
    navigateur = await chromium.launch({ executablePath: chrome });
  }, 60_000);

  afterAll(async () => {
    if (navigateur) await navigateur.close();
    if (serveur) await new Promise((resolve) => serveur.close(resolve));
    if (racine) fs.rmSync(racine, { recursive: true, force: true });
  });

  /**
   * Une page surveillée : toute violation de la politique remonte ici.
   *
   * ⚠️ `addInitScript` et pas un script d'après-chargement : l'écoute doit être en place AVANT le
   * premier script de la page, sinon on rate précisément les refus du démarrage.
   *
   * ⚠️ LES DEUX CDN SONT SUBSTITUÉS. Pas pour éviter le réseau — pour que le banc mesure NOTRE
   * politique et pas la disponibilité de cdnjs. Un CDN en panne rendrait la forge rouge pour une
   * raison qui ne nous regarde pas, et c'est ainsi qu'on apprend à ignorer le rouge.
   *
   * La substitution ne dispense de rien, et ça a été VÉRIFIÉ plutôt que supposé : en retirant à la
   * fois le nonce de la balise et l'origine de la politique, le script est refusé — la doublure
   * n'est jamais appelée, la violation remonte. Le navigateur confronte la CSP à l'URL demandée
   * avant de savoir qui répondra ; l'interception vient après le refus, pas avant.
   */
  async function ouvrirPageSurveillee(chemin) {
    const page = await navigateur.newPage();
    const violations = [];
    await page.exposeFunction("__violation", (d) => { violations.push(d); });
    await page.addInitScript(() => {
      document.addEventListener("securitypolicyviolation", (e) => {
        window.__violation({ directive: e.violatedDirective, bloque: String(e.blockedURI).slice(0, 120) });
      });
    });
    const stub = (corps) => (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: corps });
    // ⚠️ `GlobalWorkerOptions` fait partie du contrat : la page l'écrit avant tout rendu, et un
    // doublure qui l'oublie fait tomber le démarrage — pour une raison qui n'a rien à voir avec ce
    // qu'on mesure. Une doublure trop maigre invente une panne.
    await page.route("https://cdnjs.cloudflare.com/**", stub("window.pdfjsLib={GlobalWorkerOptions:{},getDocument:function(){return{promise:Promise.reject(new Error('banc'))}}};"));
    await page.route("https://cdn.jsdelivr.net/**", stub("window.supabase={createClient:function(){return{channel:function(){return{on:function(){return this},subscribe:function(){return this},unsubscribe:function(){}}},removeChannel:function(){},from:function(){return this}}}};"));
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(String(e)));
    const reponse = await page.goto(`http://127.0.0.1:${port}${chemin}`, { waitUntil: "load" });
    return { page, violations, erreurs, reponse };
  }

  it("la visionneuse s'exécute et affiche le document, sans qu'une seule règle la refuse", async () => {
    const { page, violations, erreurs, reponse } = await ouvrirPageSurveillee("/preview/essai.png");
    expect(reponse.status()).toBe(200);
    expect(reponse.headers()["content-security-policy"]).toContain("default-src 'none'");

    // Le compteur de pages n'est posé que par le script embarqué : s'il vaut 1, le script a tourné.
    await page.waitForFunction(() => window.__n === 1, null, { timeout: 15_000 });
    // ⚠️ ET LE DESSIN VIENT APRÈS. La page est construite par un `IntersectionObserver` : au moment
    // où le compteur passe à 1, l'image n'existe pas encore dans le document. Attendre le compteur
    // puis lire l'image tout de suite, c'est mesurer un instant où il n'y a rien à voir.
    await page.waitForFunction(
      () => { const i = document.querySelector("#pages .page img"); return !!i && i.naturalWidth > 0; },
      null, { timeout: 15_000 });

    const etat = await page.evaluate(() => ({
      player: typeof window.Player,
      pages: document.getElementById("pg") && document.getElementById("pg").textContent,
      image: (() => { const i = document.querySelector("#pages .page img"); return i ? [i.naturalWidth, i.naturalHeight] : null; })(),
    }));

    expect(etat.player).toBe("object");          // le paquet navigateur est là
    expect(etat.pages).toBe("Page 1 / 1");       // il a lu le document
    expect(etat.image).toEqual([4, 4]);          // et le fichier a traversé le serveur, décodé

    expect(violations).toEqual([]);
    expect(erreurs).toEqual([]);
    await page.close();
  }, 60_000);

  it("la politique refuse pour de vrai — un script sans nonce, et une origine étrangère", async () => {
    const { page, violations } = await ouvrirPageSurveillee("/preview/essai.png");
    await page.waitForFunction(() => window.__n === 1, null, { timeout: 15_000 });

    // Exactement le défaut qu'on redoute : une balise de script qui perdrait son nonce.
    await page.evaluate(() => {
      const s = document.createElement("script");
      s.textContent = "window.__intrus = 1;";
      document.head.appendChild(s);
      const t = document.createElement("script");
      t.src = "https://exemple-non-autorise.invalid/x.js";
      document.head.appendChild(t);
    });
    await page.waitForFunction(() => window.__violation && document.readyState === "complete", null, { timeout: 5_000 });
    await page.waitForTimeout(300);

    // Le script sans nonce n'a pas tourné…
    expect(await page.evaluate(() => window.__intrus)).toBeUndefined();
    // …et les DEUX refus sont remontés jusqu'ici. C'est ce qui rend le vert du premier essai
    // signifiant : l'instrument sait dire non.
    expect(violations.length).toBeGreaterThanOrEqual(2);
    expect(violations.every((v) => v.directive.startsWith("script-src"))).toBe(true);
    expect(violations.some((v) => v.bloque === "inline")).toBe(true);
    expect(violations.some((v) => v.bloque.includes("exemple-non-autorise.invalid"))).toBe(true);
    await page.close();
  }, 60_000);
});
