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
// ── LA BASE D'ESSAI (constat P2-3) ──────────────────────────────────────────────────────────────
// Ce banc ne couvrait d'abord QUE l'aperçu local — la seule page servie sans base. La visionneuse
// tracée et la page d'audience, qui portent chacune leur propre politique et leur propre chemin
// d'authentification, répondaient 404 et n'étaient donc exercées par rien.
//
// `tools/postgrest-en-memoire.cjs` les débloque. Ce qui rend cette doublure honnête, c'est la
// discipline prise ailleurs : la garde de portabilité de la forge interdit depuis longtemps la
// syntaxe exotique, donc toute la surface tient en `table?colonne=eq.valeur`. Une contrainte posée
// pour rendre un portage possible finit par rendre une base d'essai possible.
//
// ⚠️ ET ELLE REFUSE PLUTÔT QUE D'INVENTER : un filtre qu'elle ne comprend pas renvoie un 400 qui
// le NOMME. Une doublure qui répondrait « aucun résultat » à une requête mal comprise ferait passer
// tous les essais en ne mesurant rien.
//
// ── CE QUE CE BANC NE COUVRE TOUJOURS PAS ───────────────────────────────────────────────────────
// Le mur d'accès visiteur : il dépend d'un greffon que le contexte autonome n'a pas, et un document
// « compte requis » y est donc fermé (404) plutôt que dégradé — c'est le bon comportement, mais il
// rend la page inatteignable ici. Trois pages sur quatre.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");
const { pathToFileURL } = require("node:url");
const { creerPostgrestEnMemoire } = require("../tools/postgrest-en-memoire.cjs");
// ⚠️ L'inventaire des tiers vient du CODE, jamais d'une copie tenue ici : une URL recopiée dans un
// banc reste juste jusqu'au jour où on monte une version, et ce jour-là le banc mesure l'ancienne.
const { TIERS } = require("../server/handler.js");

const SLUG_TRACE = "essai-trace";
const SLUG_DIRECT = "essai-direct";
const SLUG_URL_MUETTE = "url-muette";

/** Octets réels de chaque dépendance, récupérés une fois et rejoués ensuite. */
const octets = {};

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
  let serveur, port, navigateur, racine, base, tables;

  beforeAll(async () => {
    racine = fs.mkdtempSync(path.join(os.tmpdir(), "player-e2e-"));
    fs.writeFileSync(path.join(racine, "essai.png"), Buffer.from(PNG_4x4, "base64"));
    // ⚠️ LE MÊME PNG, SOUS UN NOM SANS EXTENSION. C'est le cas que le second hôte a compté chez lui :
    // 23 documents dont l'URL ne porte aucune extension. Seul le nom déclaré en base dit la vérité.
    fs.writeFileSync(path.join(racine, "sans-extension"), Buffer.from(PNG_4x4, "base64"));
    const fichier = pathToFileURL(path.join(racine, "essai.png")).href;

    // La base d'essai (constat P2-3) : sans elle, la visionneuse tracée et la page d'audience
    // répondent 404, et deux des trois politiques de sécurité du produit restent inexercées.
    const graine = {
      commercial_doc_shares: [{
        id: 1, slug: SLUG_TRACE, doc_id: "doc-1", revoked: false, require_auth: false,
        file_url: fichier, file_name: "essai.png", doc_title: "Document d'essai",
        allow_download: true, created_by: "moi@exemple.fr", recipient_email: "client@exemple.fr",
        created_at: "2026-08-17T00:00:00Z",
      }],
      doc_presentations: [{
        id: 1, slug: SLUG_DIRECT, doc_id: "doc-1", active: true, current_page: 1, write_seq: 0,
        file_url: fichier, file_name: "essai.png", doc_title: "Document d'essai",
        presenter_name: "Léa", owner_email: "moi@exemple.fr",
        last_seen: new Date(0).toISOString(),
        created_at: "2026-08-17T00:00:00Z", updated_at: "2026-08-17T00:00:00Z",
      }, {
        // ⚠️ L'URL MENT : elle ne porte aucune extension. Seul `file_name` dit que c'est une image.
        id: 2, slug: SLUG_URL_MUETTE, doc_id: "doc-2", active: true, current_page: 1, write_seq: 0,
        file_url: pathToFileURL(path.join(racine, "sans-extension")).href,
        file_name: "plan.png", doc_title: "Plan",
        presenter_name: "Léa", owner_email: "moi@exemple.fr",
        last_seen: new Date(0).toISOString(),
        created_at: "2026-08-17T00:00:00Z", updated_at: "2026-08-17T00:00:00Z",
      }],
      // ⚠️ DÉCLARÉES VIDES, ET C'EST LE SUJET. La doublure répond « relation inexistante » sur une
      // table non déclarée, comme un vrai PostgREST : ce que le player ÉCRIT doit donc figurer ici.
      // Le schéma que ces pages touchent cesse d'être implicite — et une écriture vers une table
      // oubliée se voit tout de suite, au lieu de disparaître dans un tableau vide.
      commercial_doc_views: [],
      commercial_doc_sessions: [],
      doc_presentation_attendees: [],
      doc_presentation_messages: [],
    };
    // ⚠️ On garde l'objet RENDU : la doublure travaille sur une table sans prototype, distincte
    // de la graine. Inspecter la graine reviendrait à regarder là où personne n'écrit.
    ({ serveur: base, tables } = creerPostgrestEnMemoire(graine));
    await new Promise((resolve) => base.listen(0, "127.0.0.1", resolve));

    // ⚠️ AVANT le `require` : le serveur autonome fabrique son contexte à l'import, à partir de
    // l'environnement. Régler quoi que ce soit après ne servirait à rien.
    process.env.SUPABASE_URL = `http://127.0.0.1:${base.address().port}`;
    process.env.SUPABASE_SERVICE_ROLE_KEY = "cle-d-essai-sans-valeur";
    process.env.PLAYER_LOCAL_ROOT = racine;
    ({ serveur } = require("../bin/serve.js"));
    await new Promise((resolve) => serveur.listen(0, "127.0.0.1", resolve));
    port = serveur.address().port;

    // ⚠️ LES VRAIS OCTETS, DÉSORMAIS — les empreintes l'exigent (P2-4). Une doublure inventée est
    // refusée par le navigateur avant d'être exécutée, ce qui est exactement le comportement
    // recherché en production : le banc ne peut donc plus servir n'importe quoi sous ces URL. On
    // les récupère UNE fois, ici, et on les rejoue ensuite depuis la mémoire.
    //
    // Ce que ça achète en plus : ces octets sont ceux que les CDN servent AUJOURD'HUI. Les hacher
    // et comparer aux empreintes du code confronte les deux exemplaires du même fait — sans quoi
    // une empreinte périmée ne se verrait que chez un visiteur, sous la forme d'une page morte.
    for (const [cle, tiers] of Object.entries(TIERS)) {
      let reponse;
      try { reponse = await fetch(tiers.url); } catch (erreur) {
        throw new Error(`CDN injoignable pour ${cle} (${tiers.url}) : ${erreur.message}\n`
          + "Ce banc a besoin des octets réels depuis que les empreintes sont posées. "
          + "Si le réseau est en cause, ce n'est PAS une régression du player.");
      }
      if (!reponse.ok) throw new Error(`${cle} : le CDN répond ${reponse.status} sur ${tiers.url}`);
      octets[cle] = Buffer.from(await reponse.arrayBuffer());
    }

    if (!chrome) throw new Error("aucun navigateur : installez Chrome ou renseignez PLAYER_E2E_CHROME");
    const { chromium } = require("playwright-core");
    navigateur = await chromium.launch({ executablePath: chrome });
  }, 120_000);

  afterAll(async () => {
    if (navigateur) await navigateur.close();
    if (serveur) await new Promise((resolve) => serveur.close(resolve));
    if (base) await new Promise((resolve) => base.close(resolve));
    if (racine) fs.rmSync(racine, { recursive: true, force: true });
  });

  /**
   * Une page surveillée : toute violation de la politique remonte ici.
   *
   * ⚠️ `addInitScript` et pas un script d'après-chargement : l'écoute doit être en place AVANT le
   * premier script de la page, sinon on rate précisément les refus du démarrage.
   *
   * ⚠️ LES CDN SONT REJOUÉS DEPUIS LA MÉMOIRE, avec leurs octets réels récupérés une fois plus
   * haut. Une seule requête par fichier et par exécution, quel que soit le nombre de pages
   * ouvertes — et surtout des octets qui satisfont les empreintes, condition sans laquelle le
   * navigateur refuserait les scripts avant de les exécuter.
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
    // Chaque URL de l'inventaire est rejouée avec SES octets. On route par URL exacte plutôt que
    // par joker : deux fichiers vivent sous cdnjs, et servir l'un pour l'autre ferait échouer une
    // empreinte parfaitement juste.
    for (const [cle, tiers] of Object.entries(TIERS)) {
      await page.route(tiers.url, (route) => route.fulfill({
        status: 200, contentType: "application/javascript", body: octets[cle],
      }));
    }
    const erreurs = [];
    page.on("pageerror", (e) => erreurs.push(String(e)));
    const reponse = await page.goto(`http://127.0.0.1:${port}${chemin}`, { waitUntil: "load" });
    return { page, violations, erreurs, reponse };
  }

  // ⚠️ DEUX EXEMPLAIRES DU MÊME FAIT, CONFRONTÉS UNE FOIS. L'empreinte écrite dans le code dit ce
  // qu'on CROIT que le CDN sert ; les octets récupérés plus haut disent ce qu'il sert. Tant que
  // personne ne les met côte à côte, une empreinte périmée ne se manifeste que chez un visiteur,
  // sous la forme d'une page morte — et rien, dans nos essais, ne l'aurait annoncée.
  //
  // Ce n'est pas un contrôle de sécurité : quiconque intercepterait le CDN nous tromperait ici
  // comme ailleurs. C'est un contrôle d'ENTRETIEN — il attrape la montée de version dont on a
  // oublié de recalculer l'empreinte, qui est le seul scénario réaliste.
  it("les empreintes du code sont celles des octets que les CDN servent", () => {
    for (const [cle, tiers] of Object.entries(TIERS)) {
      const reelle = "sha384-" + crypto.createHash("sha384").update(octets[cle]).digest("base64");
      expect(`${cle} → ${reelle}`).toBe(`${cle} → ${tiers.sri}`);
    }
  });

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
      pdfjs: typeof window.pdfjsLib,
      supabase: typeof window.supabase,
    }));

    expect(etat.player).toBe("object");          // le paquet navigateur est là
    expect(etat.pages).toBe("Page 1 / 1");       // il a lu le document
    expect(etat.image).toEqual([4, 4]);          // et le fichier a traversé le serveur, décodé

    // ⚠️ ET LES DÉPENDANCES TIERCES SONT ARRIVÉES. Sans ces deux lignes, une empreinte fausse
    // passait inaperçue ici : un refus d'intégrité ne déclenche AUCUN événement de violation —
    // il n'écrit qu'une ligne dans la console. Un document image se serait affiché sans supabase,
    // donc sans présence, sans chat et sans présentation en direct, et le banc aurait dit « vert ».
    // Mesuré : la mutation d'une empreinte ne rougissait qu'un seul essai avant cet ajout.
    expect(etat.pdfjs).toBe("object");
    expect(etat.supabase).toBe("object");

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

  /**
   * LE WORKER DE pdf.js, QUAND LE CDN NE SERT PAS CE QU'ON ATTEND.
   *
   * ⚠️ CE N'EST PAS UNE EMPREINTE MUTÉE, C'EST LE CDN QUI CHANGE — la menace réelle. On rejoue le
   * worker avec des octets altérés : l'empreinte du code reste juste, c'est la réponse qui ment.
   *
   * ⚠️ ET LES DEUX REPLIS PLUS DOUX ONT ÉTÉ MESURÉS AVANT D'ÊTRE ÉCARTÉS. Rendre l'URL distante :
   * pdf.js l'enveloppe lui-même dans un blob de même origine et exécute le code non vérifié —
   * c'était le comportement livré. Laisser la valeur vide : pdf.js déduit une adresse par défaut
   * depuis sa propre position sur le CDN et le charge quand même. Les deux annulaient l'empreinte
   * en silence, et aucun raisonnement ne l'aurait dit : il a fallu regarder les workers créés.
   */
  it("un worker que le CDN a modifié n'est jamais exécuté", async () => {
    const page = await navigateur.newPage();
    const distant = [];
    // Tout chargement du worker AUTRE qu'une récupération pour vérification est un échec : c'est
    // exactement ce que pdf.js faisait dans notre dos.
    page.on("requestfinished", (r) => {
      if (r.url().includes("pdf.worker") && r.resourceType() !== "fetch") distant.push(r.resourceType());
    });
    for (const [cle, tiers] of Object.entries(TIERS)) {
      await page.route(tiers.url, (route) => route.fulfill({
        status: 200, contentType: "application/javascript",
        // Un octet de plus sur le worker : l'empreinte ne correspond plus.
        body: cle === "pdfWorker" ? Buffer.concat([octets[cle], Buffer.from(" ")]) : octets[cle],
      }));
    }
    await page.goto(`http://127.0.0.1:${port}/doc/${SLUG_TRACE}`, { waitUntil: "load" });
    await page.waitForFunction(() => window.__workerRefuse === 1, null, { timeout: 15_000 });
    expect(distant).toEqual([]);

    // ⚠️ ET LE DOCUMENT S'AFFICHE QUAND MÊME, parce que c'est une IMAGE. Le premier correctif gatait
    // la mise en route du lecteur entier : un worker invérifiable empêchait d'afficher un PNG, qui
    // n'appelle pdf.js à aucun moment. Une porte fermée sur une pièce que le code refusé ne pouvait
    // pas atteindre — trouvé par le harnais de l'hôte, pas ici.
    await page.waitForFunction(
      () => { const i = document.querySelector("#pages .page img"); return !!i && i.naturalWidth > 0; },
      null, { timeout: 15_000 });
    await page.close();
  }, 60_000);

  // ── Les deux pages que la base d'essai débloque ───────────────────────────────────────────────

  /**
   * LA VISIONNEUSE TRACÉE — celle qu'un client reçoit par courriel.
   *
   * ⚠️ SA POLITIQUE N'EST PAS CELLE DE L'APERÇU, et c'est tout l'intérêt : elle est PLUS stricte
   * (pas de framing, pas de jsdelivr, pas de Realtime). Une page peut donc parfaitement démarrer en
   * aperçu et rester blanche ici — c'est même le scénario le plus probable, puisque l'aperçu est ce
   * qu'on regarde en développant et la page tracée ce que voit le client.
   */
  it("la visionneuse tracée démarre, et sa politique plus stricte ne refuse rien d'utile", async () => {
    const { page, violations, erreurs, reponse } = await ouvrirPageSurveillee(`/doc/${SLUG_TRACE}`);
    expect(reponse.status()).toBe(200);
    const csp = reponse.headers()["content-security-policy"];
    // ⚠️ `'self'`, PAS `'none'` — et ce banc a servi à corriger un commentaire qui prétendait
    // l'inverse. Un lien tracé sans `embed` n'accepte l'encadrement que par une page de MÊME
    // ORIGINE : un détournement de clic suppose une page étrangère, et une page hostile sur notre
    // propre origine serait déjà une compromission plus grave. Ce qui serait un vrai défaut, c'est
    // une origine tierce ici sans que le partage l'ait demandé — c'est ce que la seconde ligne
    // vérifie, en constatant qu'aucun hôte n'y figure.
    expect(csp).toContain("frame-ancestors 'self'");
    expect(csp).not.toMatch(/frame-ancestors[^;]*https?:/);
    expect(csp).not.toContain("jsdelivr");             // le direct n'a rien à faire sur un lien tracé

    await page.waitForFunction(() => window.__n === 1, null, { timeout: 15_000 });
    await page.waitForFunction(
      () => { const i = document.querySelector("#pages .page img"); return !!i && i.naturalWidth > 0; },
      null, { timeout: 15_000 });

    expect(await page.evaluate(() => typeof window.pdfjsLib)).toBe("object");
    expect(violations).toEqual([]);
    expect(erreurs).toEqual([]);

    // ⚠️ ET LA LECTURE EST COMPTÉE. C'est ce que ce produit vend : une page qui s'affiche sans rien
    // journaliser est une régression invisible à l'œil, et aucun essai ne la voyait — la boucle
    // navigateur → serveur → base n'était refermée nulle part. On la referme ici, sur la base
    // d'essai, en constatant la ligne écrite plutôt que l'appel émis.
    await expect.poll(
      () => (tables.commercial_doc_views || []).filter((v) => v.slug === SLUG_TRACE).length,
      { timeout: 15_000 },
    ).toBeGreaterThan(0);
    const ouverture = tables.commercial_doc_views.find((v) => v.event === "open");
    expect(ouverture).toBeTruthy();
    expect(ouverture.session_id).toBeTruthy();

    await page.close();
  }, 60_000);

  /**
   * LA PAGE D'AUDIENCE — celle qu'un spectateur ouvre pendant une présentation.
   *
   * Sa politique est la plus large des trois (Realtime, cartes, supabase-js) : c'est donc celle où
   * une origine oubliée coûte le plus cher, et la seule où l'on peut vérifier que la présence et le
   * chat ont de quoi fonctionner.
   *
   * ⚠️ Le canal Realtime ne se connecte PAS ici — la base d'essai n'en sert pas. C'est voulu : ce
   * qu'on mesure, c'est que la page se construit et que ses dépendances arrivent, pas que Supabase
   * fonctionne. Une page qui exigerait le canal pour s'afficher serait d'ailleurs un défaut : un
   * spectateur au réseau capricieux doit voir le document.
   */
  /**
   * ⚠️ UNE PRÉSENTATION PEUT PORTER UNE IMAGE, ET CETTE VUE NE LE SAVAIT PAS.
   *
   * Le bouton « Présenter » apparaît sans condition sur le type de document : un présentateur qui
   * regarde un PNG pouvait le présenter, et son audience recevait « Document indisponible » —
   * pdf.js appelé sur une image. Ce chemin était muet DEPUIS TOUJOURS ; ce n'est pas une régression.
   *
   * Trouvé par le second hôte, en POSANT LA QUESTION là où nous aurions affirmé : sa vue à lui sert
   * des images, il a demandé si la nôtre pouvait en recevoir.
   *
   * ⚠️ ET LE PREMIER CORRECTIF NE MARCHAIT PAS, sans que rien ne le dise : il décidait sur
   * `CFG.fileUrl`, qui vaut `/api/doc?present=…&file=1` — aucune extension, donc « ce n'est pas une
   * image », toujours. Un `try/catch` posé par prudence avalait le reste. Il a fallu lire le
   * sous-titre du loader pour voir la cause. Cet essai existe pour que ça ne se reproduise pas.
   */
  it("une présentation qui porte une image l'affiche à l'audience", async () => {
    const { page, violations } = await ouvrirPageSurveillee(`/present/${SLUG_DIRECT}`);
    await page.waitForFunction(
      () => { const i = document.querySelector("#page img"); return !!i && i.naturalWidth > 0; },
      null, { timeout: 15_000 });
    // Une image tient sur une page, et le compteur doit le dire — sinon la barre de navigation
    // proposerait des pages qui n'existent pas.
    expect(await page.evaluate(() => document.getElementById("tot").textContent)).toBe("1");
    // ⚠️ ET LE LOADER S'EFFACE — mais on l'ATTEND au lieu de le constater : il disparaît une frame
    // après que l'image est décodée, et l'assertion tombait sur cette poignée de millisecondes.
    // C'est lui qui portait « Document indisponible » ; qu'il parte est la moitié qui compte.
    await page.waitForFunction(() => !document.getElementById("load"), null, { timeout: 10_000 });
    expect(violations).toEqual([]);
    await page.close();
  }, 60_000);

  /**
   * ⚠️ QUAND L'URL MENT, C'EST LE NOM QUI FAIT FOI — et le banc ne savait pas le distinguer.
   *
   * Le correctif d'origine décidait sur l'URL seule, et l'essai précédent le laissait passer parce
   * que son URL portait `.png`. Deux correctifs avaient été écrits pour un symptôme ; en n'en
   * gardant qu'un, j'ai gardé le champ DÉRIVÉ et jeté le champ AUTORITAIRE — le banc a choisi le
   * correctif au lieu de le vérifier.
   *
   * Le second hôte a compté chez lui : 4 287 documents présentables, 23 dont l'URL ne porte aucune
   * extension, aucune image parmi ces 23. Atteignable, non peuplé. Cet essai peuple le cas.
   *
   * Il ne peut être satisfait QUE par la décision sur `file_name` : la mutation redevient
   * discriminante, ce qu'elle avait cessé d'être.
   */
  it("une présentation dont l'URL ne dit rien s'affiche quand même, parce que le nom dit vrai", async () => {
    const { page } = await ouvrirPageSurveillee(`/present/${SLUG_URL_MUETTE}`);
    await page.waitForFunction(
      () => { const i = document.querySelector("#page img"); return !!i && i.naturalWidth > 0; },
      null, { timeout: 15_000 });
    await page.close();
  }, 60_000);

  it("la page d'audience démarre, avec de quoi tenir la présence et le chat", async () => {
    const { page, violations, reponse } = await ouvrirPageSurveillee(`/present/${SLUG_DIRECT}`);
    expect(reponse.status()).toBe(200);

    await page.waitForFunction(
      () => document.body && document.body.innerHTML.length > 0, null, { timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.Player === "object" && typeof window.supabase === "object",
      null, { timeout: 15_000 });

    expect(await page.evaluate(() => typeof window.pdfjsLib)).toBe("object");
    expect(await page.evaluate(() => document.title)).toContain("Document d'essai");
    expect(violations).toEqual([]);

    await page.close();
  }, 60_000);
});
