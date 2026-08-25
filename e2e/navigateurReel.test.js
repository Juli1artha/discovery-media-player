// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
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
const SLUG_PDF = "essai-pdf-reel";
const SLUG_PDF_LONG = "essai-pdf-long";
const SLUG_DIRECT = "essai-direct";
const SLUG_URL_MUETTE = "url-muette";
const SLUG_PRESENT_PDF = "direct-pdf-reel";
const SLUG_SOMBRE = "essai-sombre";
const SLUG_BOT = "essai-bot";

/** Octets réels de chaque dépendance, récupérés une fois et rejoués ensuite. */
const octets = {};

/**
 * Un PDF MINIMAL mais VALIDE — une page, un texte, offsets xref calculés au lieu d'être bricolés.
 * pdf.js refuse une table xref fausse : ce fabriquant est la seule façon d'avoir une fixture
 * qu'on comprend octet par octet, sans dépendance.
 */
function fabriquerPdf(nPages = 1) {
  // Objets : 1 catalogue, 2 arbre de pages, 3 police, puis DEUX objets par page (page + flux).
  const objets = [];
  const idsPages = [];
  for (let i = 0; i < nPages; i++) idsPages.push(4 + i * 2);
  objets.push("<< /Type /Catalog /Pages 2 0 R >>");
  objets.push(`<< /Type /Pages /Kids [${idsPages.map((n) => `${n} 0 R`).join(" ")}] /Count ${nPages} >>`);
  objets.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const flux = [];
  for (let i = 0; i < nPages; i++) {
    objets.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${5 + i * 2} 0 R /Resources << /Font << /F1 3 0 R >> >> >>`);
    const contenu = `BT /F1 24 Tf 72 720 Td (Page ${i + 1}) Tj ET`;
    flux.push(contenu);
    objets.push(null);                       // marque : le flux, écrit à part
  }
  let corps = "%PDF-1.4\n";
  const positions = [];
  let iFlux = 0;
  for (let i = 0; i < objets.length; i++) {
    positions.push(corps.length);
    if (objets[i] === null) {
      const f = flux[iFlux++];
      corps += `${i + 1} 0 obj\n<< /Length ${f.length} >>\nstream\n${f}\nendstream\nendobj\n`;
    } else {
      corps += `${i + 1} 0 obj\n${objets[i]}\nendobj\n`;
    }
  }
  const debutXref = corps.length;
  corps += `xref\n0 ${objets.length + 1}\n0000000000 65535 f \n`;
  for (const pos of positions) corps += String(pos).padStart(10, "0") + " 00000 n \n";
  corps += `trailer\n<< /Size ${objets.length + 1} /Root 1 0 R >>\nstartxref\n${debutXref}\n%%EOF`;
  return Buffer.from(corps, "latin1");
}

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
    fs.writeFileSync(path.join(racine, "essai-reel.pdf"), fabriquerPdf());
    // Un document LONG : c est le seul qui puisse montrer que les canvas ne s accumulent pas.
    fs.writeFileSync(path.join(racine, "essai-long.pdf"), fabriquerPdf(40));
    const graine = {
      commercial_doc_shares: [{
        id: 4, slug: SLUG_PDF_LONG, doc_id: "doc-pdf-long", revoked: false, require_auth: false,
        file_url: pathToFileURL(path.join(racine, "essai-long.pdf")).href, file_name: "essai-long.pdf",
        doc_title: "Document long", allow_download: false, created_by: "moi@exemple.fr",
        recipient_email: "client@exemple.fr",
      }, {
        id: 1, slug: SLUG_TRACE, doc_id: "doc-1", revoked: false, require_auth: false,
        file_url: fichier, file_name: "essai.png", doc_title: "Document d'essai",
        allow_download: true, created_by: "moi@exemple.fr", recipient_email: "client@exemple.fr",
        created_at: "2026-08-17T00:00:00Z",
      }, {
        id: 2, slug: SLUG_PDF, doc_id: "doc-pdf", revoked: false, require_auth: false,
        file_url: pathToFileURL(path.join(racine, "essai-reel.pdf")).href, file_name: "essai-reel.pdf",
        doc_title: "PDF réel", allow_download: true, created_by: "moi@exemple.fr",
        recipient_email: "client@exemple.fr", created_at: "2026-08-17T00:00:00Z",
      }, {
        // Marque sombre : la SEULE différence visuelle est le loader (#load.ldark) — un état
        // TRANSITOIRE, invisible pour un axe lancé après chargement. L'essai dédié le fige.
        id: 3, slug: SLUG_SOMBRE, doc_id: "doc-1", revoked: false, require_auth: false,
        file_url: fichier, file_name: "essai.png", doc_title: "Document d'essai",
        brand_dark: true, allow_download: true, created_by: "moi@exemple.fr",
        recipient_email: "client@exemple.fr", created_at: "2026-08-17T00:00:00Z",
      }, {
        // Lien avec AGENT : les surcouches notation/quiz/au revoir/reprise n'existent que là.
        id: 4, slug: SLUG_BOT, doc_id: "doc-1", revoked: false, require_auth: false,
        file_url: fichier, file_name: "essai.png", doc_title: "Document d'essai",
        bot_enabled: true, bot_guided: true, allow_download: true, created_by: "moi@exemple.fr",
        recipient_email: "client@exemple.fr", created_at: "2026-08-17T00:00:00Z",
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
      }, {
        // ⚠️ SANS CETTE LIGNE, LE CHEMIN CANVAS DE L'AUDIENCE N'EST EXERCÉ PAR RIEN : les deux
        // présentations ci-dessus portent des IMAGES. Une mutation posée sur le nommage du canvas
        // audience (`cv.setAttribute('role','img')` retiré) est restée VERTE — c'est elle qui a
        // exigé cette présentation sur le PDF réel.
        id: 3, slug: SLUG_PRESENT_PDF, doc_id: "doc-pdf", active: true, current_page: 1, write_seq: 0,
        file_url: pathToFileURL(path.join(racine, "essai-reel.pdf")).href, file_name: "essai-reel.pdf",
        doc_title: "PDF réel", presenter_name: "Léa", owner_email: "moi@exemple.fr",
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
    // ⚠️ MESURER L'ÉTAT STABLE, PAS UNE TRANSITION (P2 onzième audit — l'E2E a échoué une fois sur
    // le contraste de `.page` en `reprise`, vert au second passage : une transition d'overlay
    // mesurée à mi-course fabrique un faux contraste). On coupe les animations pour axe.
    await page.emulateMedia({ reducedMotion: "reduce" });
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
  // ⚠️ LE TEST QUE TROIS ANS DE CDN RENDAIENT IMPOSSIBLE. Le chemin PDF n'était jamais éprouvé au
  // banc — la fixture était une image, exprès, pour ne pas dépendre d'un CDN. pdf.js vient
  // désormais de NOTRE origine : un VRAI PDF, rendu par le VRAI worker, dans un VRAI Chromium.
  // (Le test du worker-CDN-trafiqué vivait ici : son modèle de menace a disparu avec le CDN —
  // l'intégrité d'un actif de même origine est celle du serveur, éprouvée octet pour octet en
  // unitaire.)
  // ⚠️ LE LECTEUR NE DOIT PAS GARDER TOUTES LES PAGES (P1 audit externe).
  //
  // `rendered[n]` n'était jamais évincé, les canvas restaient dans le DOM, et le DPR n'était pas
  // plafonné : sur un écran haute densité un seul canvas pèse quelques dizaines de mégaoctets, donc
  // un document long parcouru en entier faisait exploser la mémoire de l'onglet.
  //
  // Ce banc est le SEUL qui puisse le voir : jsdom n'a pas de canvas, et un test unitaire du script
  // ne rendrait rien. On parcourt donc 40 pages dans un vrai Chromium et on compte.
  it("un document long : les canvas restent bornés après un parcours complet", async () => {
    const page = await navigateur.newPage();
    await page.goto(`http://127.0.0.1:${port}/doc/${SLUG_PDF_LONG}`, { waitUntil: "load" });
    await page.waitForFunction(
      () => { const c = document.querySelector("#pages .page canvas"); return !!c && c.width > 0; },
      { timeout: 25_000 });
    const total = await page.evaluate(() => document.querySelectorAll("#pages .page").length);
    expect(total, "la fixture doit bien avoir 40 pages, sinon ce banc ne prouve rien").toBe(40);

    // Parcours complet, page par page, en laissant le rendu se faire.
    let maxVus = 0;
    for (let n = 1; n <= 40; n++) {
      await page.evaluate((i) => {
        const el = document.querySelector(`#pages .page[data-p="${i}"]`);
        if (el) el.scrollIntoView({ block: "start" });
      }, n);
      await new Promise((r) => setTimeout(r, 60));
      const vus = await page.evaluate(() => document.querySelectorAll("#pages .page canvas").length);
      if (vus > maxVus) maxVus = vus;
    }

    // Fenêtre = page courante ± 2, plus quelques rendus en vol : une dizaine est large, quarante ne
    // l'est pas. Seuil LARGE : on détecte l'EFFONDREMENT du principe, pas une consommation exacte.
    expect(maxVus,
      `${maxVus} canvas simultanés sur un document de 40 pages : les pages ne sont plus évincées,\n`
      + "et la mémoire de l'onglet suit la longueur du document.")
      .toBeLessThanOrEqual(12);
    await page.close();
  });

  // ⚠️ LE TAMPON D'UN CANVAS EST BORNÉ EN PIXELS — et c'est CETTE borne qui mord, pas celle du DPR.
  //
  // Le code pose deux plafonds : le DPR effectif (2) puis le nombre de pixels du canvas (4 M). Ma
  // première version de ce test affirmait le rapport tampon/affiché ≤ 2 pour éprouver le DPR — et
  // retirer le plafond de DPR ne la faisait PAS rougir, parce que le budget de pixels ramenait déjà
  // le rapport à 1,41. Deux mécanismes, un seul observable : le test ne distinguait rien.
  //
  // On affirme donc la propriété qui borne vraiment la mémoire — le nombre de pixels — et on note
  // que le plafond de DPR lui est REDONDANT dans cette configuration : il ne sert que là où le
  // budget ne mord pas (petite page, écran très dense).
  // ⚠️ TROIS CHEMINS QUE LA 0.1.123 NE BORNAIT PAS — et qu'aucun essai d'ici ne pouvait voir, parce
  // qu'ils ne parcouraient que le défilement à zoom 100 %. Le jeu d'essai ne pouvait pas produire le
  // phénomène : deuxième fois en deux jours. (Relevé par un audit externe.)
  //
  // ⚠️ ON PILOTE LE LECTEUR PAR UNE COUTURE QUI EXISTE DÉJÀ : `PlayerBot.init(VIEWER)` reçoit la
  // surface du lecteur au démarrage. En déclarant `window.PlayerBot` AVANT le chargement, le banc
  // récupère cette surface sans qu'une seule ligne de production change pour lui.
  async function pageAvecLecteur(ctx) {
    const p = await ctx.newPage();
    await p.addInitScript(() => {
      window.PlayerBot = { init: (v) => { window.__viewerEssai = v; } };
    });
    await p.goto(`http://127.0.0.1:${port}/doc/${SLUG_PDF_LONG}`, { waitUntil: "load" });
    await p.waitForFunction(() => !!window.__viewerEssai && window.__viewerEssai.numPages > 1, { timeout: 25_000 });
    return p;
  }
  const canvasVus = (p) => p.evaluate(() => document.querySelectorAll("#pages .page canvas").length);

  it("mode UNE-PAGE, 40 pages parcourues : les canvas restent bornés", async () => {
    const ctx = await navigateur.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await pageAvecLecteur(ctx);
    await p.evaluate(() => window.__viewerEssai.enterOnePage());
    await p.waitForFunction(() => window.__viewerEssai.onePage === true, { timeout: 10_000 });

    let pire = 0;
    for (let n = 1; n <= 40; n++) {
      await p.evaluate((i) => window.__viewerEssai.showPage(i), n);
      await new Promise((r) => setTimeout(r, 70));
      const vus = await canvasVus(p);
      if (vus > pire) pire = vus;
    }
    // Fenêtre une-page = courante, suivante, précédente — plus ce qui est en vol.
    expect(pire,
      `${pire} canvas simultanés en mode une-page sur 40 pages : les pages précédentes restent dans\n`
      + "le DOM. Une présentation guidée de 100 pages finirait avec près de 100 canvas — c'est le\n"
      + "chemin que la fenêtre glissante du défilement ne couvrait pas.")
      .toBeLessThanOrEqual(6);
    await p.close(); await ctx.close();
  });

  it("une page libérée ne porte jamais de couche texte orpheline", async () => {
    const ctx = await navigateur.newContext({ viewport: { width: 1200, height: 900 } });
    const p = await pageAvecLecteur(ctx);
    await p.evaluate(() => window.__viewerEssai.enterOnePage());
    // Navigation TRÈS rapide : les couches de texte partent et reviennent après la libération.
    for (let n = 1; n <= 25; n++) await p.evaluate((i) => window.__viewerEssai.showPage(i), n);
    await new Promise((r) => setTimeout(r, 900));
    const orphelines = await p.evaluate(() => {
      let n = 0;
      for (const el of document.querySelectorAll("#pages .page")) {
        if (el.querySelector(".textLayer") && !el.querySelector("canvas")) n += 1;
      }
      return n;
    });
    expect(orphelines,
      "une couche texte s'est posée sur une page libérée : elle la ressuscite en bloc de texte\n"
      + "sélectionnable flottant sur un cadre vide.")
      .toBe(0);
    await p.close(); await ctx.close();
  });

  it("zoom poussé au MAXIMUM : aucun canvas ne crève le budget de pixels", async () => {
    const ctx = await navigateur.newContext({ viewport: { width: 1400, height: 1000 }, deviceScaleFactor: 2 });
    const p = await pageAvecLecteur(ctx);
    // On zoome par le VRAI bouton, jusqu'à ce que le libellé cesse de bouger (plafond atteint).
    let libelle = "";
    for (let i = 0; i < 20; i++) {
      await p.click("#zin");
      await new Promise((r) => setTimeout(r, 60));
      const l = await p.evaluate(() => document.getElementById("zlbl").textContent);
      if (l === libelle) break;
      libelle = l;
    }
    await new Promise((r) => setTimeout(r, 600));
    expect(libelle, "le zoom doit avoir atteint son maximum, sinon ce banc n'éprouve rien").toBe("300%");
    const pire = await p.evaluate(() => {
      let m = 0;
      for (const c of document.querySelectorAll("#pages .page canvas")) m = Math.max(m, c.width * c.height);
      return m;
    });
    expect(pire, "aucun canvas rendu au zoom maximal : la mesure ne mesure rien").toBeGreaterThan(0);
    expect(pire,
      `un canvas fait ${(pire / 1e6).toFixed(1)} M pixels au zoom 300 %, soit environ\n`
      + `${Math.round(pire * 4 / 1048576)} Mo pour UNE page — le plancher du facteur de rendu annule\n`
      + "le budget exactement quand il devrait mordre.")
      .toBeLessThanOrEqual(4.2e6);
    await p.close(); await ctx.close();
  });

  it("un canvas ne dépasse jamais son budget de pixels, quelle que soit la densité d'écran", async () => {
    const ctx = await navigateur.newContext({ deviceScaleFactor: 3, viewport: { width: 1400, height: 1000 } });
    const p3 = await ctx.newPage();
    await p3.goto(`http://127.0.0.1:${port}/doc/${SLUG_PDF_LONG}`, { waitUntil: "load" });
    await p3.waitForFunction(
      () => { const c = document.querySelector("#pages .page canvas"); return !!c && c.width > 0; },
      { timeout: 25_000 });
    const mesure = await p3.evaluate(() => {
      let pire = 0;
      for (const c of document.querySelectorAll("#pages .page canvas")) pire = Math.max(pire, c.width * c.height);
      return pire;
    });
    expect(mesure, "aucun canvas rendu : la mesure ne mesure rien").toBeGreaterThan(0);
    // 4 M pixels = ~16 Mo de tampon. Marge de 5 % pour les arrondis de viewport.
    expect(mesure,
      `un canvas fait ${(mesure / 1e6).toFixed(1)} M pixels, soit environ ${Math.round(mesure * 4 / 1048576)} Mo\n`
      + "de tampon pour UNE page. Sur un écran dense et un document long, c'est ce produit qui fait\n"
      + "tomber l'onglet — et le plafond du DPR seul ne le borne pas.")
      .toBeLessThanOrEqual(4.2e6);
    await p3.close(); await ctx.close();
  });

  it("un vrai PDF est rendu par notre pdf.js — et RIEN ne part vers un tiers", async () => {
    const page = await navigateur.newPage();
    const horsOrigine = [];
    page.on("request", (r) => {
      const u = r.url();
      if (!u.startsWith(`http://127.0.0.1:${port}`) && !u.startsWith("data:") && !u.startsWith("blob:")) horsOrigine.push(u);
    });
    await page.goto(`http://127.0.0.1:${port}/doc/${SLUG_PDF}`, { waitUntil: "load" });
    // Le rendu réel : pdf.js pose un canvas dans la page, avec des dimensions non nulles.
    await page.waitForFunction(
      () => { const c = document.querySelector("#pages .page canvas"); return !!c && c.width > 0 && c.height > 0; },
      null, { timeout: 20_000 });
    const nbPages = await page.evaluate(() => document.querySelectorAll("#pages .page").length);
    expect(nbPages).toBe(1);
    expect(horsOrigine, "le viewer PDF a appelé un domaine tiers — le CDN est censé avoir disparu").toEqual([]);
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

    // ⚠️ pdfjsLib arrive par un import() DYNAMIQUE : le lire sans l'attendre est une course —
    // verte en local où l'import gagne toujours, rouge sur la machine plus lente de la forge.
    await page.waitForFunction(() => typeof window.pdfjsLib === "object", null, { timeout: 15_000 });
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

    // ⚠️ pdfjsLib arrive par un import() DYNAMIQUE : le lire sans l'attendre est une course —
    // verte en local où l'import gagne toujours, rouge sur la machine plus lente de la forge.
    await page.waitForFunction(() => typeof window.pdfjsLib === "object", null, { timeout: 15_000 });
    expect(await page.evaluate(() => document.title)).toContain("Document d'essai");
    expect(violations).toEqual([]);

    await page.close();
  }, 60_000);

  // ── ACCESSIBILITÉ : MESURÉE, PAS DÉCLARÉE ─────────────────────────────────────────────────────
  //
  // ⚠️ POURQUOI ICI : l'accessibilité d'une page ne se lit pas dans son gabarit — un `aria-label`
  // peut exister dans la source et être écrasé par le script qui reconstruit le DOM. Seul le DOM
  // FINAL, dans un vrai moteur, dit ce qu'une technologie d'assistance recevra. Même argument que
  // la CSP en tête de ce fichier : relire n'est pas appliquer.
  //
  // L'arbitre est axe-core (celui des outils d'audit du navigateur), injecté par `evaluate` — qui
  // passe par le protocole d'inspection, PAS par une balise : la CSP de la page reste celle de
  // prod, on n'ouvre rien pour mesurer. Le seuil : ZÉRO violation `serious` ou `critical` sur
  // les règles WCAG 2.1 A/AA. Les impacts moindres sont TOLÉRÉS mais IMPRIMÉS : on voit la dette,
  // elle ne casse pas la forge.
  //
  // ⚠️ ET L'ARBITRE DOIT REFUSER AU MOINS UNE FOIS (même règle que le collecteur CSP) : le dernier
  // essai plante une page volontairement infirme et exige de voir axe la refuser. Sans lui, un
  // axe mal injecté qui rendrait zéro violation partout serait indistinguable d'un parc parfait.
  async function mesurerAxe(page) {
    await page.evaluate(require("axe-core").source);
    return page.evaluate(() => window.axe.run(document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] },
      resultTypes: ["violations"],
    }).then((r) => r.violations.map((v) => ({
      regle: v.id, impact: v.impact, aide: v.help,
      noeuds: v.nodes.slice(0, 4).map((n) => n.target.join(" ")),
    }))));
  }
  const graves = (violations) => violations.filter((v) => v.impact === "serious" || v.impact === "critical");
  // Attendre que les transitions/animations en cours soient TERMINÉES avant de mesurer — même avec
  // reducedMotion, une classe qu'on vient d'ajouter peut n'avoir pas encore été peinte.
  const attendreStable = (page) => page.evaluate(() => new Promise((resolve) => {
    const fini = () => Promise.all(document.getAnimations().map((a) => a.finished.catch(() => {})));
    requestAnimationFrame(() => fini().then(() => requestAnimationFrame(() => resolve())));
  }));
  const imprimer = (nom, violations) => {
    for (const v of violations) console.log(`[a11y] ${nom} — ${v.impact} — ${v.regle} : ${v.aide} → ${v.noeuds.join(" | ")}`);
  };

  it("la visionneuse tracée ne porte aucune violation grave WCAG A/AA", async () => {
    const { page } = await ouvrirPageSurveillee(`/doc/${SLUG_TRACE}`);
    await page.waitForFunction(() => document.body && document.body.innerHTML.length > 0, null, { timeout: 15_000 });
    const violations = await mesurerAxe(page);
    imprimer("visionneuse", violations);
    expect(graves(violations), "le DOM final de la visionneuse refuse une technologie d'assistance").toEqual([]);
    await page.close();
  }, 60_000);

  // ⚠️ DEUX ÉTATS, DEUX MESURES — le second hôte a lu ce que notre inventaire cachait : « ouvrir,
  // attendre, mesurer » attrape l'état d'ACCUEIL (la carte Rejoindre) en croyant attraper la page.
  // L'état par défaut d'un écran n'est pas l'état où l'on passe son temps — c'est pourtant celui
  // que tout banc mesure spontanément, puisque ne rien faire est le chemin le plus court. Le
  // régime établi se GAGNE : on rejoint par le vrai geste (nom, bouton), puis l'arbitre repasse.
  // Symétrique des loaders : eux disparaissaient trop vite, celui-ci apparaissait trop tôt.
  it("la page d'audience ne porte aucune violation grave — l'ACCUEIL puis le RÉGIME ÉTABLI", async () => {
    const { page } = await ouvrirPageSurveillee(`/present/${SLUG_DIRECT}`);
    await page.waitForFunction(
      () => typeof window.Player === "object" && typeof window.supabase === "object",
      null, { timeout: 15_000 });
    await page.waitForSelector(".join-card", { timeout: 15_000 });
    const accueil = await mesurerAxe(page);
    imprimer("audience-accueil", accueil);
    expect(graves(accueil), "l'état d'accueil refuse une technologie d'assistance").toEqual([]);

    await page.fill("#jName", "Essai Banc");
    await page.click("#jGo");
    await page.waitForFunction(() => !document.querySelector(".join"), null, { timeout: 15_000 });
    // La carte disparue ne PROUVE pas le régime : on exige le document affiché ET la barre de
    // pagination renseignée — sinon l'arbitre mesurerait un écran vide en le croyant établi.
    await page.waitForFunction(
      () => { const i = document.querySelector("#page img"); return !!i && i.naturalWidth > 0 && document.querySelector("#tot").textContent !== "—"; },
      null, { timeout: 15_000 });
    const etabli = await mesurerAxe(page);
    imprimer("audience-regime", etabli);
    expect(graves(etabli), "l'état où l'audience passe la présentation refuse une technologie d'assistance").toEqual([]);

    // Et le fil OUVERT : fermé il est display:none — un état qu'axe ne voit pas n'est pas mesuré.
    // ⚠️ Le GESTE qui l'ouvre (le fab) ne s'allume qu'à la connexion realtime, que ce banc n'a
    // pas : l'état est inatteignable par l'interface ici, mais ses pixels sont réels. On
    // l'affiche donc directement — mesurer un rendu n'exige pas d'avoir gagné le droit de le
    // voir, et le dire vaut mieux que de ne pas le mesurer (même règle que le mur visiteur).
    await page.evaluate(() => document.querySelector("#chatPanel").classList.remove("hidden"));
    await page.waitForFunction(
      () => { const c = document.querySelector("#chatPanel"); return !!c && getComputedStyle(c).display !== "none"; },
      null, { timeout: 15_000 });
    const fil = await mesurerAxe(page);
    imprimer("audience-chat", fil);
    expect(graves(fil), "le fil ouvert refuse une technologie d'assistance").toEqual([]);
    await page.close();
  }, 60_000);

  // ⚠️ CE QU'AXE NE SAIT PAS EXIGER : une région vivante ABSENTE n'est pas une violation — c'est
  // juste un silence. Ces assertions demandent les sémantiques une à une, dans le DOM FINAL :
  // un refactor du gabarit qui les efface rougit ici, pas chez un utilisateur de lecteur d'écran.
  it("l'audience annonce, journalise et nomme — région vivante, chat en journal, saisies étiquetées", async () => {
    const { page } = await ouvrirPageSurveillee(`/present/${SLUG_DIRECT}`);
    await page.waitForFunction(
      () => typeof window.Player === "object" && typeof window.supabase === "object",
      null, { timeout: 15_000 });
    const sem = await page.evaluate(() => ({
      annonceur: (document.querySelector("#sr") || {}).getAttribute?.("aria-live") || null,
      journal: (document.querySelector("#chatMsgs") || {}).getAttribute?.("role") || null,
      saisie: (document.querySelector("#chatText") || {}).getAttribute?.("aria-label") || null,
      envoi: (document.querySelector("#chatSend") || {}).getAttribute?.("aria-label") || null,
      dialogue: (document.querySelector("#lModal .lmodal-box") || {}).getAttribute?.("role") || null,
    }));
    expect(sem.annonceur, "sans région vivante, un changement de page est un événement muet").toBe("polite");
    expect(sem.journal, "un fil de chat sans role=log n'annonce jamais un message").toBe("log");
    expect(sem.saisie).toBeTruthy();
    expect(sem.envoi).toBeTruthy();
    expect(sem.dialogue, "un dialogue qui ne se déclare pas laisse le lecteur d'écran « dans la page »").toBe("dialog");
    await page.close();
  }, 60_000);

  it("la page rendue de l'AUDIENCE porte un NOM — le chemin canvas, sur le PDF réel", async () => {
    const { page } = await ouvrirPageSurveillee(`/present/${SLUG_PRESENT_PDF}`);
    await page.waitForFunction(
      () => { const c = document.querySelector("#page canvas"); return !!c && c.width > 0; },
      null, { timeout: 20_000 });
    const nom = await page.evaluate(() => {
      const c = document.querySelector("#page canvas");
      return { role: c.getAttribute("role"), label: c.getAttribute("aria-label") };
    });
    expect(nom.role, "le canvas de l'audience est un trou dans l'arbre d'accessibilité").toBe("img");
    expect(nom.label).toContain("Page 1");
    await page.close();
  }, 60_000);

  it("la page rendue de la visionneuse porte un NOM — role=img et son numéro", async () => {
    const page = await navigateur.newPage();
    await page.goto(`http://127.0.0.1:${port}/doc/${SLUG_PDF}`, { waitUntil: "load" });
    await page.waitForFunction(
      () => { const c = document.querySelector("#pages canvas"); return !!c && c.width > 0; },
      null, { timeout: 20_000 });
    const nom = await page.evaluate(() => {
      const c = document.querySelector("#pages canvas");
      return { role: c.getAttribute("role"), label: c.getAttribute("aria-label") };
    });
    expect(nom.role, "un canvas sans rôle est un trou dans l'arbre d'accessibilité").toBe("img");
    expect(nom.label).toContain("Page 1");
    await page.close();
  }, 60_000);

  // ⚠️ QUESTION D'ADV (19/08) : « vos violations ont-elles été mesurées sur le thème clair, le
  // sombre, ou les deux ? » Réponse par une MESURE : le sombre ne change QUE le loader, un état
  // que l'arbitre post-chargement ne voit jamais — on bloque donc le fichier pour le figer, et
  // axe tourne sur le loader SOMBRE affiché. Leurs deux marques sont dark:true : ce chemin-là
  // était exactement le non-mesuré.
  // Et la symétrie a montré le trou jumeau : le loader CLAIR non plus n'était jamais mesuré —
  // l'arbitre passait toujours après sa disparition. Les deux états, figés puis mesurés.
  for (const [nom, slugCible, attente] of [
    ["loader-sombre", SLUG_SOMBRE, "#load.ldark"],
    ["loader-clair", SLUG_TRACE, "#load:not(.ldark)"],
  ]) {
    it(`le ${nom} ne porte aucune violation grave — l'état transitoire, figé puis mesuré`, async () => {
      const page = await navigateur.newPage();
      await page.route("**/*file=1*", () => { /* jamais résolu : le loader reste affiché */ });
      await page.goto(`http://127.0.0.1:${port}/doc/${slugCible}`, { waitUntil: "domcontentloaded" });
      await page.waitForFunction(
        (sel) => { const l = document.querySelector(sel); return !!l && getComputedStyle(l).opacity !== "0"; },
        attente, { timeout: 15_000 });
      const violations = await mesurerAxe(page);
      imprimer(nom, violations);
      expect(graves(violations), "un état transitoire non mesuré est un état non couvert").toEqual([]);
      await page.close();
    }, 60_000);
  }

  // ⚠️ UN role=dialog SANS PIÈGE DE FOCUS EST UNE DÉCLARATION SANS EFFET (septième audit).
  // Piloté au clavier réel : Tab boucle entre les deux boutons, Maj+Tab boucle à rebours,
  // Échap ferme ET rend le focus à l'élément qui l'avait — les cinq exigences du lot.
  it("le dialogue de confirmation piège le focus, boucle, et le REND à la fermeture", async () => {
    const { page } = await ouvrirPageSurveillee(`/present/${SLUG_DIRECT}`);
    await page.waitForFunction(() => typeof window.__confirmDialog === "function", null, { timeout: 15_000 });
    await page.evaluate(() => { document.getElementById("jName").focus(); window.__confirmDialog({ title: "Essai banc", desc: "d" }); });
    const actif = () => page.evaluate(() => (document.activeElement || {}).id || "");
    expect(await actif(), "à l'ouverture, le focus entre dans le dialogue").toBe("lModalYes");
    await page.keyboard.press("Tab");
    expect(await actif(), "Tab reste DANS le dialogue").toBe("lModalNo");
    await page.keyboard.press("Tab");
    expect(await actif(), "Tab boucle").toBe("lModalYes");
    await page.keyboard.press("Shift+Tab");
    expect(await actif(), "Maj+Tab boucle à rebours").toBe("lModalNo");
    await page.keyboard.press("Escape");
    const apres = await page.evaluate(() => ({
      ouvert: document.getElementById("lModal").classList.contains("open"),
      focus: (document.activeElement || {}).id || "",
    }));
    expect(apres.ouvert, "Échap ferme").toBe(false);
    expect(apres.focus, "le focus REVIENT à l'élément qui l'avait — sinon l'utilisateur clavier repart de zéro").toBe("jName");
    await page.close();
  }, 60_000);

  // ⚠️ LES ÉTATS À PROVOQUER — le lot annoncé après la leçon du régime établi : notation, quiz,
  // au revoir, reprise (visionneuse à agent) et « Présentation terminée » + dialogue OUVERT
  // (audience). Tous display:none au repos — un état qu'axe ne voit pas n'est pas mesuré. On les
  // AFFICHE (classe/style, les mêmes gestes que le code de prod) puis l'arbitre passe, état par
  // état, le périmètre imprimé à côté du verdict.
  // ⚠️ Limite dite : le contenu DYNAMIQUE de ces surcouches (étoiles de notation, cartes de
  // quiz) est injecté par le PlayerBot de l'HÔTE (`if(window.PlayerBot)…`) — absent du contexte
  // autonome. Ce banc mesure ce que CE paquet livre ; les pixels de l'hôte se mesurent chez lui.
  it("les surcouches de la visionneuse à agent, affichées une à une, sans violation grave", async () => {
    const { page } = await ouvrirPageSurveillee(`/doc/${SLUG_BOT}`);
    await page.waitForFunction(() => !!document.getElementById("rateov"), null, { timeout: 15_000 });
    const etats = [
      ["reprise", () => document.body.classList.add("deskpaused"), () => document.body.classList.remove("deskpaused")],
      ["notation", () => document.getElementById("rateov").classList.add("on"), () => document.getElementById("rateov").classList.remove("on")],
      ["quiz", () => document.getElementById("qov").classList.add("on"), () => document.getElementById("qov").classList.remove("on")],
      ["au-revoir", () => document.getElementById("byeov").classList.add("on"), () => document.getElementById("byeov").classList.remove("on")],
    ];
    for (const [nom, montrer, cacher] of etats) {
      await page.evaluate(montrer);
      await attendreStable(page);
      const violations = await mesurerAxe(page);
      imprimer(`etat-${nom}`, violations);
      if (graves(violations).length) {   // capture DOM+image à l'échec, pour qu'un flake soit diagnosticable
        try { await page.screenshot({ path: `/tmp/a11y-etat-${nom}.png` }); } catch { /* best effort */ }
        console.log(`[a11y] DOM de l'état « ${nom} » :`, (await page.content()).slice(0, 2000));
      }
      expect(graves(violations), `l'état « ${nom} » refuse une technologie d'assistance`).toEqual([]);
      await page.evaluate(cacher);
    }
    await page.close();
  }, 90_000);

  it("« Présentation terminée » et le dialogue OUVERT de l'audience, sous l'arbitre", async () => {
    const { page } = await ouvrirPageSurveillee(`/present/${SLUG_DIRECT}`);
    await page.waitForFunction(() => typeof window.__confirmDialog === "function", null, { timeout: 15_000 });
    await page.evaluate(() => { document.getElementById("ended").style.display = "flex"; });
    const fin = await mesurerAxe(page);
    imprimer("etat-terminee", fin);
    expect(graves(fin), "l'écran de fin refuse une technologie d'assistance").toEqual([]);
    await page.evaluate(() => { document.getElementById("ended").style.display = ""; window.__confirmDialog({ title: "Essai", desc: "d" }); });
    // L'animation d'entrée part d'opacité 0 : mesurer PENDANT mélange la boîte au fond sombre et
    // fabrique de faux contrastes. L'arbitre attend l'état STABLE — celui que l'utilisateur lit.
    await page.waitForFunction(
      () => getComputedStyle(document.querySelector("#lModal .lmodal-box")).opacity === "1"
        && document.querySelector("#lModal .lmodal-box").getAnimations().length === 0,
      null, { timeout: 5_000 });
    const dialogue = await mesurerAxe(page);
    imprimer("etat-dialogue-ouvert", dialogue);
    expect(graves(dialogue), "le dialogue ouvert refuse une technologie d'assistance").toEqual([]);
    await page.keyboard.press("Escape");
    await page.close();
  }, 90_000);

  it("l'arbitre refuse une page volontairement infirme — sinon ses zéros ne valent rien", async () => {
    const page = await navigateur.newPage();
    await page.goto(`data:text/html,<html><body><img src="x"><input type="text"></body></html>`, { waitUntil: "load" });
    const violations = await mesurerAxe(page);
    expect(graves(violations).length, "axe n'a rien vu sur une page SANS lang, SANS alt, SANS label : il n'est pas branché").toBeGreaterThan(0);
    await page.close();
  }, 60_000);
});
