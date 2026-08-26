// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE SERVEUR AUTONOME — la preuve que le cœur ne dépend d'aucune plateforme.
//
// Le player est un gestionnaire `(req, res)` : Vercel, Next.js, Express et le serveur HTTP de Node
// l'acceptent tel quel. Ce test tient cette promesse — si un jour le cœur se met à exiger un objet
// de requête particulier, c'est ici que ça casse, pas chez celui qui essaie de l'héberger.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "player-serve-")));
fs.writeFileSync(path.join(racine, "rapport.pdf"), "%PDF-1.4 " + "x".repeat(400));
process.env.PLAYER_LOCAL_ROOT = racine;

const { versParametres } = require("../serve.js");

const params = (chemin) => versParametres(new URL("http://localhost:3000" + chemin));

describe("traduction des chemins publics", () => {
  // ⚠️ Ces deux formes vivent dans des courriels envoyés à des tiers. Elles ne changent jamais.
  it("garde /doc/:slug et /present/:slug", () => {
    expect(params("/doc/Ab3-_xYz9012")).toMatchObject({ slug: "Ab3-_xYz9012" });
    expect(params("/present/Ab3-_xYz9012")).toMatchObject({ present: "Ab3-_xYz9012" });
  });

  it("refuse un slug qui n'en est pas un", () => {
    expect(params("/doc/../../etc/passwd").slug).toBeUndefined();
  });

  it("ouvre un document du dossier local par son nom", () => {
    const q = params("/preview/rapport.pdf");
    expect(q.preview).toBe("1");
    expect(q.url).toBe("file://" + path.join(racine, "rapport.pdf"));
    expect(q.name).toBe("rapport.pdf");
  });
});

describe("le player répond sans plateforme", () => {
  const player = require("../../server/handler.js");
  const { createStandaloneContext } = require("../../context/standalone.js");
  player.init(createStandaloneContext(process.env));

  async function appel(query, headers = {}) {
    const res = {
      statusCode: 0, headers: {}, body: "",
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
      end(b) { this.body = b == null ? "" : b; },
    };
    await player.handler({ method: "GET", headers, socket: {}, query }, res);
    return res;
  }

  it("affiche un document du dossier local, sans base ni Storage", async () => {
    const res = await appel(params("/preview/rapport.pdf"));
    expect(res.statusCode).toBe(200);
    expect(String(res.body)).toMatch(/Player\.tracking\.createTracker\(/);
    // ⚠️ Ce que la page n'utilise pas est refusé PAR ÉCRIT (Permissions-Policy) : sans la ligne,
    // un script tiers compromis hérite de tout ce que le navigateur sait faire. Relevé par le
    // premier passage CI du scan ZAP (règle 10063, 24/08) — le passage local, scanners par
    // défaut, ne l'avait pas vu. Le plein écran n'y est PAS refusé : la présentation s'en sert.
    expect(res.headers["permissions-policy"]).toContain("camera=()");
    expect(res.headers["permissions-policy"]).toContain("geolocation=()");
  });

  it("sert le fichier avec sa vraie taille et accepte un Range", async () => {
    const q = { ...params("/preview/rapport.pdf"), stream: "1" };
    const entier = await appel(q);
    expect(entier.statusCode).toBe(200);
    expect(entier.headers["content-length"]).toBe("409");

    const bout = await appel(q, { range: "bytes=0-8" });
    expect(bout.statusCode).toBe(206);
    expect(bout.headers["content-range"]).toBe("bytes 0-8/409");
  });

  it("dit qui il est sans configuration", async () => {
    const carte = JSON.parse(await appel({ contract: "1" }).then((r) => r.body));
    expect(carte.contract).toBe(1);
    // Aucun greffon : le cœur affiche, trace et présente tout seul.
    expect(Object.values(carte.plugins).every((v) => v === false)).toBe(true);
  });

  // ⚠️ Le défaut qui compte : sans câblage, le player ne SAIT PAS qui a le droit de diffuser.
  // Il refuse. Un droit qu'on ne sait pas accorder ne s'accorde pas.
  it("refuse la diffusion tant que l'hôte n'a pas répondu", async () => {
    const ctx = createStandaloneContext({ ...process.env, PLAYER_HOST_AUTHZ_URL: "" });
    expect(await ctx.identity.canManageShares({ email: "a@b.fr" }, "create")).toBe(false);
    expect(await ctx.identity.canManageShares(null, "create")).toBe(false);
  });
});

// LA PREMIÈRE MINUTE DE QUELQU'UN QUI DÉCOUVRE LE PROJET.
//
// Écrit après avoir regardé un premier utilisateur suivre le README : dossier vide, nom d'exemple
// tapé tel quel, et un « Impossible d'afficher ce document » rouge — le même message qu'un fichier
// absent, qu'un dossier vide et qu'un format non géré. Trois causes, une phrase, aucune piste.
// La racine du serveur montre désormais ce qu'il y a à lire.
describe("page d'accueil du mode dossier", () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const p = require("node:path");

  it("liste ce qui est affichable, et rien d'autre", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(), "player-home-")));
    fs.writeFileSync(p.join(dir, "rapport.pdf"), "%PDF-1.4");
    fs.writeFileSync(p.join(dir, "plan.png"), "x");
    fs.writeFileSync(p.join(dir, "notes.docx"), "x");   // format non géré : ne pas le proposer
    fs.writeFileSync(p.join(dir, ".cache"), "x");        // fichier caché
    fs.mkdirSync(p.join(dir, "archives"));               // dossier

    const { pageAccueil } = require("../serve.js");
    const html = await pageAccueil(dir);
    expect(html).toContain('href="/preview/rapport.pdf"');
    expect(html).toContain('href="/preview/plan.png"');
    expect(html).not.toContain("notes.docx");
    expect(html).not.toContain(".cache");
    expect(html).not.toContain("archives");
  });

  it("dit qu'il est vide plutôt que de laisser deviner", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(), "player-vide-")));
    const { pageAccueil } = require("../serve.js");
    expect(await pageAccueil(dir)).toContain("Aucun document affichable");
  });

  // Un nom de fichier est écrit par quelqu'un d'autre — ici l'exploitant, mais la règle ne se
  // relâche pas selon la confiance qu'on a dans la source.
  it("échappe les noms de fichiers", async () => {
    const dir = fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(), "player-xss-")));
    fs.writeFileSync(p.join(dir, '<img src=x onerror=alert(1)>.pdf'), "%PDF");
    const { pageAccueil } = require("../serve.js");
    const html = await pageAccueil(dir);
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;img");
  });
});

// ⚠️ LA PAGE D'ACCUEIL ÉTAIT LA SEULE PAGE HTML SERVIE SANS LES EN-TÊTES QUE LA VISIONNEUSE POSE
// PARTOUT — pas de CSP, pas de `nosniff`, encadrable par n'importe qui. Relevé par le premier
// scan ZAP baseline (règles 10038, 10021, 10020 — 24/08) : la visionneuse, elle, était déjà
// irréprochable, parce que ses en-têtes passent par des aides dédiées. Cette route-ci écrivait
// les siens à la main, et la règle ne l'avait pas suivie.
describe("les en-têtes de la page d'accueil", () => {
  const { serveur } = require("../serve.js");
  // Le serveur n'écoute pas pendant les tests (garde dans serve.js) : on appelle son gestionnaire
  // de requêtes directement, comme les tests du player appellent `handler`.
  const repondre = serveur.listeners("request")[0];

  it("pose CSP, nosniff et interdit l'encadrement", async () => {
    const res = { entetes: null, corps: "", writeHead(_c, h) { this.entetes = h; }, end(b) { this.corps = String(b || ""); } };
    await repondre({ url: "/", headers: {}, method: "GET" }, res);
    expect(res.entetes["X-Content-Type-Options"]).toBe("nosniff");
    expect(res.entetes["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    const csp = res.entetes["Content-Security-Policy"] || "";
    expect(csp, "sans default-src 'none', tout ce qui n'est pas nommé est permis").toContain("default-src 'none'");
    expect(csp, "personne n'a de raison d'encadrer la page d'accueil").toContain("frame-ancestors 'none'");
    // La page n'a qu'un bloc <style> à elle : c'est la SEULE chose que la CSP doit permettre.
    expect(csp).toContain("style-src 'unsafe-inline'");
    expect(res.entetes["Permissions-Policy"], "même refus écrit que les pages de la visionneuse").toContain("camera=()");
    expect(res.corps).toContain("Discovery Media Player");
  });
});

// ⚠️ LES DEUX RÉPONSES EN TEXTE DE CE FICHIER POSAIENT LEUR TYPE, MAIS PAS `nosniff` — la moitié
// de la règle. Elles la réécrivaient à la main dans le seul fichier où le player ne pouvait pas la
// poser lui-même (audit CODEX 5.6, 25/08). Elles appellent maintenant la MÊME fonction que les
// refus du player, comme POLITIQUE_PERMISSIONS l'est déjà : deux exemplaires d'un fait divergent.
describe("les refus en texte du serveur autonome", () => {
  const { serveur } = require("../serve.js");
  const repondre = serveur.listeners("request")[0];

  const resTexte = () => ({
    statusCode: 0, entetes: {}, corps: null, headersSent: false,
    setHeader(k, v) { this.entetes[k] = v; },
    writeHead(c, h) { this.statusCode = c; Object.assign(this.entetes, h || {}); },
    end(b) { if (b !== undefined) this.corps = String(b); this.headersSent = true; },
  });

  it("⚠️ une route inconnue : 404, type ET nosniff", async () => {
    const res = resTexte();
    await repondre({ url: "/rien-du-tout", headers: {}, method: "GET" }, res);
    expect(res.statusCode).toBe(404);
    expect(res.entetes["Content-Type"]).toBe("text/plain; charset=utf-8");
    expect(res.entetes["X-Content-Type-Options"], "un corps en texte que le navigateur peut requalifier").toBe("nosniff");
  });
});

// ⚠️ LA PAGE DE PREMIER CONTACT NE DOIT PROMETTRE QUE CE QUE LA VISIONNEUSE SAIT OUVRIR.
//
// Elle tenait sa propre liste d'extensions, qui contenait encore `.svg` après son retrait de la
// table des types en 0.1.7. Résultat : le fichier apparaissait dans la liste, le clic rendait un
// téléchargement, et le visiteur en concluait que le projet ne marche pas — sur l'écran qui ne se
// rejoue pas. La liste est désormais DÉRIVÉE de la table des types.
//
// Trouvé en vérifiant une relecture externe sur le reniflage de type MIME. Sa recommandation
// (`nosniff`, type générique, téléchargement forcé) était en place depuis 0.1.7 ; mesuré :
// un `.png` contenant du HTML sort en `image/png` + `nosniff`, donc inerte. Le défaut était à
// côté — une liste qui promettait un format retiré.
describe("ce que la page d'accueil propose", () => {
  const { EXTENSIONS_AFFICHABLES } = require("../../context/storage");

  it("ne propose aucun format que la table des types ignore", () => {
    const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "serve.js"), "utf8");
    expect(src, "la liste doit être dérivée, pas recopiée").toContain("EXTENSIONS_AFFICHABLES");
    expect(src).not.toMatch(/new Set\(\[".pdf"/);
  });

  it("le SVG n'y est plus — il a été retiré des types servis", () => {
    expect(EXTENSIONS_AFFICHABLES).not.toContain(".svg");
  });

  it("les formats affichables y sont tous", () => {
    for (const ext of [".pdf", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif"]) {
      expect(EXTENSIONS_AFFICHABLES, ext).toContain(ext);
    }
  });
});

// ⚠️ AUCUN SIGNAL N'ÉTAIT ÉCOUTÉ : le choix était entre LENT et BRUTAL. Sans gestionnaire, Node
// PID 1 ignore `SIGTERM` et `docker stop` attend dix secondes puis tue ; avec `dumb-init`, le signal
// relayé déclenche l'action par défaut sur un processus qui n'est plus PID 1 — terminaison
// immédiate, requêtes en vol tranchées, à chaque déploiement. Ce banc tient la troisième voie.
describe("l'arrêt gracieux du serveur autonome", () => {
  const { spawn } = require("node:child_process");
  const path = require("node:path");

  /** Lance le VRAI serveur, dans un vrai processus : un signal ne se simule pas. */
  function lancer(env = {}) {
    const p = spawn(process.execPath, [path.join(__dirname, "..", "serve.js")], {
      env: { ...process.env, PORT: "0", PLAYER_LOCAL_ROOT: racine, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let sortie = "";
    p.stdout.on("data", (d) => { sortie += String(d); });
    p.stderr.on("data", (d) => { sortie += String(d); });
    const pret = new Promise((resolve) => {
      const voir = () => { const m = /http:\/\/localhost:(\d+)/.exec(sortie); if (m) resolve(Number(m[1])); else setTimeout(voir, 20); };
      voir();
    });
    return { p, pret, lu: () => sortie };
  }

  const fin = (p) => new Promise((resolve) => p.on("exit", (code, sig) => resolve({ code, sig })));

  it("⚠️ SIGTERM fait sortir le processus au lieu d'attendre le couperet de l'orchestrateur", async () => {
    const { p, pret, lu } = lancer();
    await pret;
    p.kill("SIGTERM");
    const { code } = await fin(p);
    expect(code, "un arrêt sans rien en vol doit être immédiat et propre").toBe(0);
    expect(lu()).toContain("SIGTERM reçu");
    expect(lu(), "l'opérateur doit savoir que le serveur draine, pas qu'il est mort").toContain("plus de nouvelle connexion");
  }, 20000);

  it("⚠️ une connexion keep-alive OISIVE ne retient pas l'arrêt — sinon `close()` n'arrive jamais au bout", async () => {
    const { p, pret } = lancer();
    const port = await pret;
    // Une requête aboutie laisse la socket ouverte : c'est exactement ce qui bloquait `close()`.
    const r = await fetch(`http://127.0.0.1:${port}/healthz`);
    expect(r.status).toBe(200);
    p.kill("SIGTERM");
    const { code } = await fin(p);
    expect(code, "l'oisive doit être fermée, pas attendue").toBe(0);
  }, 20000);

  it("⚠️ le délai est BORNÉ : ce qui ne finit pas est coupé, et le processus le DIT", async () => {
    // Délai minuscule : on ne teste pas la durée, on teste que le couperet existe et parle.
    const { p, pret, lu } = lancer({ PLAYER_SHUTDOWN_GRACE_MS: "1" });
    const port = await pret;
    // Une socket ouverte SANS requête complète : le serveur ne peut pas savoir qu'elle a fini.
    const net = require("node:net");
    const prise = net.connect(port, "127.0.0.1");
    await new Promise((r) => prise.on("connect", r));
    prise.write("GET /healthz HTTP/1.1\r\nHost: x\r\n");   // en-têtes incomplets, volontairement
    await new Promise((r) => setTimeout(r, 50));
    p.kill("SIGTERM");
    const { code } = await fin(p);
    prise.destroy();
    expect(code, "passé le délai, on coupe — c'est l'ancien comportement, mais borné et annoncé").toBe(1);
    expect(lu()).toContain("délai");
  }, 20000);

  it("⚠️ un SECOND signal sort tout de suite — deux Ctrl-C demandent l'arrêt, pas une explication", async () => {
    const { p, pret } = lancer({ PLAYER_SHUTDOWN_GRACE_MS: "9000" });
    const port = await pret;
    const net = require("node:net");
    const prise = net.connect(port, "127.0.0.1");
    await new Promise((r) => prise.on("connect", r));
    prise.write("GET /healthz HTTP/1.1\r\nHost: x\r\n");
    await new Promise((r) => setTimeout(r, 50));
    p.kill("SIGTERM");
    await new Promise((r) => setTimeout(r, 100));
    p.kill("SIGTERM");                       // le second, avant l'échéance de 9 s
    const { code } = await fin(p);
    prise.destroy();
    expect(code, "sans ce chemin, l'opérateur attendrait le délai entier ou tuerait à la main").toBe(130);
  }, 20000);

  it("importer le module n'installe AUCUN gestionnaire — il vivrait dans le processus de qui importe", () => {
    // Ce banc importe `serve.js` depuis sa première ligne : si les gestionnaires étaient posés à
    // l'import, ils détourneraient le Ctrl-C de vitest lui-même.
    const nôtres = process.listeners("SIGTERM").filter((f) => String(f).includes("arreterProprement"));
    expect(nôtres, "les signaux suivent la même garde que `listen` : uniquement en exécution directe").toEqual([]);
  });
});
