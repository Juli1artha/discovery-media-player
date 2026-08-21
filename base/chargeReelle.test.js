// LA CAMPAGNE DE CHARGE — contre un VRAI PostgREST, avec ce qu'un banc de charge peut honnêtement dire.
//
// ⚠️ CE BANC SÉPARE CE QU'IL AFFIRME DE CE QU'IL RAPPORTE, et c'est sa seule idée.
//
// Un audit externe demandait des percentiles. Le dépôt les avait refusés pour une bonne raison : une
// latence mesurée sur une machine partagée n'est pas reproductible, aucun seuil ne tient, et un seuil
// qui rougit au hasard finit desserré — le mode de panne le plus coûteux d'ici. Mais refuser LE SEUIL
// n'oblige pas à refuser LA MESURE : les deux avaient été confondus.
//
//   • AFFIRMÉ : ce qui est déterministe sous charge — aucune erreur serveur, chaque appelant reçoit
//     une réponse cohérente, le coût en allers-retours reste LINÉAIRE, la mémoire ne suit pas la
//     concurrence, et le retard de boucle ne s'effondre pas (détecteur, pas cible).
//   • RAPPORTÉ : p50 / p95 / p99, débit, comptes par phase. Imprimés dans le journal de la forge,
//     jamais comparés à un seuil. C'est là qu'on verra une dérive AVANT qu'un utilisateur ne la sente.
//
// ⚠️ ET IL REFUSE DE CONCLURE S'IL N'A RIEN CHARGÉ. Un banc de charge qui s'esquive rend le même vert
// qu'un banc qui a tenu 250 appelants — c'est la classe qui a laissé passer deux mutations aujourd'hui.
// Les premières assertions portent donc sur le fait que la charge a EU LIEU.
//
// CE QU'IL FAIT : jusqu'à 250 appelants, 20 présentations simultanées, et le relais de fichiers
// sous concurrence — c'est-à-dire tout ce que la forge actuelle permet d'atteindre.
//
// ⚠️ CE QU'IL NE FAIT PAS, et il faut le dire aussi précisément : pas de 1 000 appelants, pas de base
// RALENTIE artificiellement (+250 ms, +2 s), pas de MULTI-PROCESSUS. Ces trois-là demandent une
// infrastructure que la forge n'a pas, pas seulement plus de temps — et leur absence n'est pas une
// propriété vérifiée. Un banc qui tait ce qu'il ne couvre pas se lit comme s'il couvrait tout.

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";
if (process.env.CI && !(BASE && SECRET)) {
  throw new Error(
    "campagne de charge : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents. "
    + "S'esquiver dans la forge reviendrait à ne rien éprouver.");
}
const decrire = BASE && SECRET ? describe : describe.skip;

function jeton() {
  const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const tete = b64({ alg: "HS256", typ: "JWT" });
  const corps = b64({ role: process.env.PLAYER_TEST_ROLE || "player_test" });
  const sig = crypto.createHmac("sha256", SECRET).update(`${tete}.${corps}`).digest("base64url");
  return `${tete}.${corps}.${sig}`;
}

/** Nombre d'appelants simulés — réglable pour une campagne plus large hors forge. */
const SPECTATEURS = Number(process.env.PLAYER_CHARGE_SPECTATEURS || 50);

const pourcentile = (tries, p) => tries[Math.min(tries.length - 1, Math.floor((p / 100) * tries.length))];

/** Retard de la boucle d'événements : ce que la latence seule ne montre pas. */
function mesureRetardBoucle() {
  let pire = 0, dernier = process.hrtime.bigint(), actif = true;
  const battement = setInterval(() => {
    const t = process.hrtime.bigint();
    const ecart = Number(t - dernier) / 1e6 - 20;      // 20 ms attendus
    if (ecart > pire) pire = ecart;
    dernier = t;
  }, 20);
  battement.unref?.();
  return { arreter() { actif = false; clearInterval(battement); return Math.max(0, Math.round(pire)); }, get actif() { return actif; } };
}

let presentations, player, base, racine, fichierPdf;

decrire("campagne de charge contre une vraie base", () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    // ⚠️ Une racine locale RÉELLE : c'est le seul moyen d'éprouver le relais de fichiers sans
    // dépendre d'un amont distant. `realpathSync` parce que `resolveLocal` compare des chemins
    // réels des deux côtés (sur macOS, /var mène à /private/var) — une racine non normalisée fait
    // tout refuser, et le banc passerait alors sans rien relayer.
    racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "charge-")));
    process.env.PLAYER_LOCAL_ROOT = racine;
    fichierPdf = path.join(racine, "charge.pdf");
    // ⚠️ QUATRE MÉGA-OCTETS, ET LA TAILLE EST LE TEST. À 512 Kio, l'assertion mémoire ne
    // DISCRIMINAIT PAS : 23 Mo en flux contre 30 Mo en tampon, les deux sous le seuil — le surcoût
    // de découpage de Node écrasait la différence. Vingt lectures de 4 Mio font 80 Mio si l'on
    // alloue, et presque rien si l'on diffuse : là, aucune ambiguïté. Un jeu d'essai doit produire
    // un ÉCART, pas seulement le phénomène.
    fs.writeFileSync(fichierPdf, Buffer.alloc(4 * 1024 * 1024, 0x25));
    const contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    player = require("../server/handler.js");
    player.init(contexte);
    presentations = require("../server/presentations.js");
    base = contexte.db;
  });

  afterAll(() => { try { fs.rmSync(racine, { recursive: true, force: true }); } catch { /* déjà parti */ } });

  const nouvellePresentation = () => presentations.createPresentation({
    docId: "charge-" + crypto.randomBytes(4).toString("hex"),
    fileUrl: new URL("file://" + fichierPdf).href, fileName: "charge.pdf",
    docTitle: "Charge", presenterName: "Banc", owner: { email: "banc@exemple.test", name: "Banc" },
  });

  /**
   * Un appel HTTP réel à travers le handler, chronométré.
   *
   * ⚠️ LA RÉPONSE EST UN VRAI FLUX INSCRIPTIBLE, et ce n'est pas du zèle. Ma première version ne
   * savait que `end(corps)` — or une réponse DIFFUSÉE (le relais de fichiers) passe par `res.write`,
   * qui était donc jeté : les vingt relais rendaient un corps vide, comptés comme des succès. Un
   * double qui ignore la moitié du contrat de son sujet ne mesure pas ce sujet.
   */
  function appeler(requete) {
    // ⚠️ ON COMPTE LES OCTETS, ON NE LES GARDE PAS — parce que le mesureur consommait ce qu'il
    // mesure. En retenant les vingt corps pour pouvoir les affirmer, le banc réservait lui-même
    // 10 Mio, et le relevé annonçait 50 Mo là où le relais n'en gardait presque aucun. Un banc qui
    // s'ajoute à la grandeur qu'il surveille mesure sa propre présence.
    // On garde une TÊTE, assez pour les assertions sur du JSON, jamais assez pour peser.
    const TETE_MAX = 8 * 1024;
    const tete = [];
    let octetsVus = 0, tailleTete = 0;
    const res = new (require("node:stream").Writable)({
      write(m, _e, cb) {
        octetsVus += m.length;
        if (tailleTete < TETE_MAX) { tete.push(Buffer.from(m)); tailleTete += m.length; }
        cb();
      },
    });
    res.statusCode = 0;
    res.headers = {};
    res.setHeader = function (k, v) { this.headers[String(k).toLowerCase()] = v; };
    res.getHeader = function (k) { return this.headers[String(k).toLowerCase()]; };
    Object.defineProperty(res, "body", { get: () => Buffer.concat(tete).toString("latin1") });
    const t0 = process.hrtime.bigint();
    return player.handler(requete, res).then(
      () => ({ ms: Number(process.hrtime.bigint() - t0) / 1e6, statut: res.statusCode, corps: res.body, octets: octetsVus }),
      (e) => ({ ms: Number(process.hrtime.bigint() - t0) / 1e6, statut: 599, erreur: String((e && e.message) || e) }),
    );
  }

  const battement = (slug, i) => appeler({
    method: "POST", headers: { "content-type": "application/json" }, socket: { remoteAddress: "10.0.0." + (i % 250) }, query: {},
    body: { action: "present-attend", slug, key: "anon-charge-" + i, name: "V" + i, wantToken: "1" },
  });
  const lireEtat = (slug, i) => appeler({
    method: "GET", headers: {}, socket: { remoteAddress: "10.0.1." + (i % 250) }, query: { present: slug, state: "1" },
  });

  function relever(nom, resultats, retard) {
    // ⚠️ `statut < 400` N'EST PAS « a réussi » : un statut de 0 — c'est-à-dire aucune réponse du
    // tout — y passait. Vérifié par mutation : un banc qui n'appelle RIEN rendait alors 20/20
    // réussis et des percentiles à 0 ms. On exige donc une plage de succès RÉELLE.
    const ok = resultats.filter((r) => r.statut >= 200 && r.statut < 400);
    const tries = ok.map((r) => r.ms).sort((a, b) => a - b);
    const erreurs = resultats.filter((r) => r.statut >= 500);
    const ligne = (n, v) => `    ${String(n).padEnd(28)}${v}`;
    // eslint-disable-next-line no-console
    console.log([
      `\n  ── ${nom} — ${resultats.length} appels, ${SPECTATEURS} appelants ──`,
      ligne("réussis", `${ok.length}/${resultats.length}`),
      ligne("erreurs serveur (5xx)", erreurs.length),
      ligne("p50 / p95 / p99 (ms)", tries.length ? `${Math.round(pourcentile(tries, 50))} / ${Math.round(pourcentile(tries, 95))} / ${Math.round(pourcentile(tries, 99))}` : "—"),
      ligne("pire retard de boucle (ms)", retard),
    ].join("\n"));
    return { ok, tries, erreurs };
  }

  it("battements concurrents : aucune erreur serveur, et le relevé est publié", async () => {
    const p = await nouvellePresentation();
    const horloge = mesureRetardBoucle();
    const resultats = await Promise.all(Array.from({ length: SPECTATEURS }, (_, i) => battement(p.slug, i)));
    const retard = horloge.arreter();
    const { ok, tries, erreurs } = relever("battements de présence", resultats, retard);

    // ⚠️ D'ABORD : la charge a-t-elle EU LIEU ? Sans ces deux lignes, un banc qui n'appelle rien rend
    // le même vert qu'un banc qui a tenu 50 appelants.
    expect(resultats.length, "aucun appel émis : ce banc ne mesure rien").toBe(SPECTATEURS);
    expect(tries.length, "aucune réponse aboutie : les percentiles seraient vides").toBeGreaterThan(0);
    expect(resultats.every((r) => r.statut >= 200),
      "un appel n'a produit AUCUN statut : le banc n'a pas traversé le handler").toBe(true);

    expect(erreurs.map((e) => e.erreur || e.statut),
      "une erreur serveur sous charge : c'est le seul verdict non négociable de ce banc").toEqual([]);
    expect(ok.length, "des appels ont été refusés — attendu sous plafond, à regarder si massif")
      .toBeGreaterThan(SPECTATEURS * 0.5);
    // Détecteur d'effondrement, PAS une cible de performance : une boucle bloquée une seconde entière
    // veut dire qu'un travail synchrone s'est glissé sur le chemin, pas que la machine est lente.
    expect(retard, `retard de boucle de ${retard} ms — un travail synchrone bloque le chemin public`)
      .toBeLessThan(2000);
  });

  it("lectures d'état concurrentes : le cache tient, et la mémoire ne suit pas la concurrence", async () => {
    const p = await nouvellePresentation();
    global.gc?.();
    const avant = process.memoryUsage();
    const horloge = mesureRetardBoucle();
    const resultats = await Promise.all(Array.from({ length: SPECTATEURS }, (_, i) => lireEtat(p.slug, i)));
    const retard = horloge.arreter();
    const apres = process.memoryUsage();
    const { ok, tries } = relever("lectures d'état", resultats, retard);
    // eslint-disable-next-line no-console
    console.log(`    ${"croissance mémoire (Mo)".padEnd(28)}${Math.round((apres.arrayBuffers - avant.arrayBuffers + apres.heapUsed - avant.heapUsed) / 1048576)}`);

    expect(tries.length, "aucune lecture aboutie").toBeGreaterThan(0);
    expect(ok.length, "les lectures d'état sont mutualisées : elles doivent toutes aboutir").toBe(SPECTATEURS);
    expect(ok.every((r) => r.corps && r.corps.length > 2),
      "des réponses vides comptées comme des succès : le banc mesurerait du néant").toBe(true);
    const corps = new Set(ok.map((r) => r.corps));
    expect(corps.size, "des spectateurs simultanés ont reçu des états DIFFÉRENTS du même instant").toBe(1);
    expect(retard, `retard de boucle de ${retard} ms`).toBeLessThan(2000);
  });

  // ⚠️ VINGT PRÉSENTATIONS SIMULTANÉES — et ce que ça éprouve n'est PAS la charge.
  //
  // Le cache de lecture est mutualisé par clé, et la clé contient le slug. Vingt présentations qui
  // tournent ensemble, chacune sur une page différente, c'est le seul scénario où une confusion de
  // clé se verrait : un spectateur recevrait l'état d'une AUTRE présentation. Ce n'est pas une
  // hypothèse gratuite — le curseur du chat est entré dans cette clé récemment, et une clé qui
  // oublie une dimension ne se signale jamais autrement que par un contenu qui vient d'ailleurs.
  it("20 présentations simultanées : chacune rend SON état, jamais celui d'une autre", async () => {
    const N = 20;
    const pres = [];
    for (let i = 0; i < N; i++) {
      const p = await nouvellePresentation();
      await presentations.setPage(p.slug, p.control, i + 1);        // une page DIFFÉRENTE par XP
      pres.push(p);
    }
    const horloge = mesureRetardBoucle();
    // Chaque présentation reçoit plusieurs lecteurs, tous mêlés.
    const taches = [];
    for (let tour = 0; tour < 5; tour++) for (let i = 0; i < N; i++) taches.push(lireEtat(pres[i].slug, i).then((r) => ({ i, r })));
    const resultats = await Promise.all(taches);
    const retard = horloge.arreter();
    relever("20 présentations × 5 lecteurs", resultats.map((x) => x.r), retard);

    expect(resultats.length, "aucun appel : ce banc ne mesure rien").toBe(N * 5);
    const mauvais = [];
    for (const { i, r } of resultats) {
      if (r.statut !== 200) { mauvais.push(`XP ${i} : statut ${r.statut}`); continue; }
      let corps; try { corps = JSON.parse(r.corps); } catch { mauvais.push(`XP ${i} : corps illisible`); continue; }
      const vue = corps.state && corps.state.current_page;
      if (vue !== i + 1) mauvais.push(`XP ${i} attendait la page ${i + 1}, a reçu ${vue}`);
    }
    expect(mauvais,
      "un spectateur a reçu l'état d'une AUTRE présentation : la clé de cache confond deux slugs")
      .toEqual([]);
    expect(retard, `retard de boucle de ${retard} ms sur 20 présentations`).toBeLessThan(2000);
  });

  // ⚠️ LE RELAIS DE FICHIERS SOUS CONCURRENCE — le chemin corrigé en 0.1.122 et 0.1.125, jamais
  // éprouvé sous charge. C'est celui où la mémoire suivait taille × concurrence avant le passage au
  // flux : vingt lectures d'un fichier de 512 Kio ne doivent pas réserver vingt fois sa taille.
  it("relais de fichiers : 20 lectures concurrentes, diffusées et non allouées", async () => {
    const p = await nouvellePresentation();
    global.gc?.();
    const avant = process.memoryUsage();
    const horloge = mesureRetardBoucle();
    const resultats = await Promise.all(Array.from({ length: 20 }, (_, i) => appeler({
      method: "GET", headers: {}, socket: { remoteAddress: "10.0.2." + i }, query: { present: p.slug, file: "1" },
    })));
    const retard = horloge.arreter();
    const croissance = process.memoryUsage().arrayBuffers - avant.arrayBuffers;
    relever("relais de fichiers", resultats, retard);
    // eslint-disable-next-line no-console
    console.log(`    ${"réservé (Mo)".padEnd(28)}${Math.round(croissance / 1048576)}`);

    const ok = resultats.filter((r) => r.statut >= 200 && r.statut < 400);
    expect(ok.length, "les vingt relais doivent aboutir").toBe(20);
    expect(resultats.every((r) => r.octets > 0),
      "des relais vides comptés comme des succès : le banc mesurerait du néant").toBe(true);
    expect(Math.min(...resultats.map((r) => r.octets)),
      "un relais a rendu moins que le fichier : le flux a été tronqué").toBe(4 * 1024 * 1024);
    // RELEVÉS DATÉS, les deux mesurés le 2026-08-21 sur ce banc :
    //   flux    →  52 Mo      tampon (mutation) → 168 Mo
    // Le seuil se pose ENTRE les deux, large des deux côtés — c'est un détecteur d'effondrement, pas
    // une cible de consommation. Ma première valeur (40 Mo) était sous la mesure du flux : elle
    // rougissait sur du code CORRECT, ce qui est la façon la plus sûre de faire desserrer un seuil.
    expect(croissance,
      `${Math.round(croissance / 1048576)} Mo réservés pour 20 relais de 4 Mio : la plage est de\n`
      + "nouveau allouée d'avance, et la mémoire suit taille × concurrence.")
      .toBeLessThan(100 * 1024 * 1024);
  });

  // ⚠️ LA PROPRIÉTÉ QUI DÉCIDE DE L'ÉCHELLE : le coût doit croître LINÉAIREMENT, pas plus vite. Une
  // latence dit ce qui se passe aujourd'hui sur cette machine ; le rapport entre deux échelles, lui,
  // dit ce qui se passera à 250 ou à 1 000.
  // ══════════════════════════════════════════════════════════════════════════════════════════════
  // UNE BASE LENTE — LE RÉGIME QU'ON DISAIT HORS DE PORTÉE DE LA FORGE.
  //
  // ⚠️ NOUS L'AVIONS CLASSÉ « demande de l'infrastructure », À CÔTÉ DE 1 000 SPECTATEURS ET DU
  // MULTI-PROCESSUS. C'était faux, et l'erreur a coûté des semaines de « non mesuré » : ralentir la
  // base ne demande pas une autre base, seulement d'intercaler une attente sur la couture que le
  // player utilise déjà. Trois choses classées ensemble parce qu'elles se ressemblaient ; une seule
  // avait la difficulté qu'on leur prêtait à toutes.
  //
  // ⚠️ ET CE QU'ON AFFIRME N'EST PAS UNE LATENCE — c'est qu'elle ne se MULTIPLIE pas. Un seuil de
  // temps rougit au hasard et finit desserré ; le NOMBRE d'allers-retours, lui, est déterministe.
  // La panne qu'on redoute a un nom : quand la base ralentit, un client qui réessaie transforme une
  // lenteur en effondrement. On mesure donc le coût à froid, puis sous +250 ms, et on exige qu'il
  // soit IDENTIQUE. C'est la propriété qui décide si une instance survit à une base fatiguée.
  function ralentir(ms) {
    const vraie = base.request.bind(base);
    let appels = 0;
    base.request = async (chemin, o) => {
      appels += 1;
      if (ms) await new Promise((r) => setTimeout(r, ms));
      return vraie(chemin, o);
    };
    return { compte: () => appels, rendre() { base.request = vraie; return appels; } };
  }

  async function sousLenteur(slug, ms, combien) {
    const sonde = ralentir(ms);
    const retard = mesureRetardBoucle();
    const resultats = await Promise.all(Array.from({ length: combien }, (_, i) => battement(slug, i)));
    return { resultats, appels: sonde.rendre(), retard: retard.arreter() };
  }

  it("une base ralentie ne fait pas monter le nombre d'allers-retours — pas de réessai en cascade", async () => {
    const { slug } = await nouvellePresentation();
    const combien = Math.min(SPECTATEURS, 60);

    // ⚠️ UN TOUR DE CHAUFFE HORS MESURE : la sonde de schéma et les mémos de contrat se paient une
    // fois par processus. Les compter dans le premier régime et pas dans le second ferait apparaître
    // une différence qui ne dit rien de la lenteur.
    await sousLenteur(slug, 0, 5);

    const froid = await sousLenteur(slug, 0, combien);
    const lent = await sousLenteur(slug, 250, combien);

    relever("battements, base normale", froid.resultats, froid.retard);
    relever("battements, base +250 ms", lent.resultats, lent.retard);

    expect(froid.resultats.filter((r) => r.statut >= 500).length, "5xx à froid").toBe(0);
    expect(lent.resultats.filter((r) => r.statut >= 500).length, "une base lente n'est pas une panne du player").toBe(0);
    expect(lent.appels,
      `la base lente a coûté ${lent.appels} allers-retours contre ${froid.appels} à froid — un réessai transforme une lenteur en effondrement`)
      .toBe(froid.appels);

    // ⚠️ ET L'ATTENTE DOIT ÊTRE ASYNCHRONE. Si un seul appel bloquait la boucle, 250 ms × N
    // s'accumuleraient et le retard de boucle exploserait ; il reste borné parce que le player
    // attend sans occuper le processus. Le plafond est LARGE — on détecte un blocage, pas une
    // milliseconde.
    expect(lent.retard, `retard de boucle sous lenteur : ${lent.retard} ms`).toBeLessThan(2000);
  });

  it("une base TRÈS lente (+2 s) : les appels aboutissent encore, et toujours sans réessai", async () => {
    const { slug } = await nouvellePresentation();
    // Moins d'appelants : ce qu'on éprouve ici est la RÉSISTANCE à une base à l'agonie, pas le
    // volume — et un banc qui dure trois minutes finit par être coupé, donc par ne rien mesurer.
    const combien = Math.min(SPECTATEURS, 12);
    await sousLenteur(slug, 0, 3);
    const froid = await sousLenteur(slug, 0, combien);
    const agonie = await sousLenteur(slug, 2000, combien);

    relever("battements, base +2 s", agonie.resultats, agonie.retard);

    expect(agonie.resultats.filter((r) => r.statut >= 500).length, "aucune erreur serveur, même à +2 s").toBe(0);
    expect(agonie.resultats.filter((r) => r.statut >= 200 && r.statut < 400).length,
      "tous les appels aboutissent : rien n'abandonne en silence").toBe(combien);
    expect(agonie.appels, "toujours aucun réessai, même quand la base est à l'agonie").toBe(froid.appels);
  });

  it("doubler les appelants ne quadruple pas le coût : la croissance reste linéaire", async () => {
    const p = await nouvellePresentation();
    const compter = async (n, decalage) => {
      const avant = await base.request("doc_presentation_attendees?slug=eq." + encodeURIComponent(p.slug) + "&select=attendee_key");
      await Promise.all(Array.from({ length: n }, (_, i) => battement(p.slug, decalage + i)));
      const apres = await base.request("doc_presentation_attendees?slug=eq." + encodeURIComponent(p.slug) + "&select=attendee_key");
      return apres.length - avant.length;
    };
    const petits = await compter(10, 1000);
    const grands = await compter(20, 2000);
    // eslint-disable-next-line no-console
    console.log(`\n  ── croissance ──\n    ${"10 appelants → lignes".padEnd(28)}${petits}\n    ${"20 appelants → lignes".padEnd(28)}${grands}`);
    expect(petits, "aucune ligne créée : la mesure de croissance ne mesure rien").toBeGreaterThan(0);
    expect(grands / Math.max(1, petits),
      "le coût croît plus vite que le nombre d'appelants — c'est le signe d'un quadratique")
      .toBeLessThanOrEqual(3);
  });
});
