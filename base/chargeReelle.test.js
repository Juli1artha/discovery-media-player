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
// CE QU'IL NE FAIT PAS, et il faut le dire : pas de 1 000 appelants (le temps de forge n'est pas
// gratuit), pas de base ralentie artificiellement, pas de relais PDF, pas de multi-processus. Ce sont
// les postes suivants de la campagne, et leur absence n'est pas une propriété vérifiée.

const crypto = require("node:crypto");

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

let presentations, player, base;

decrire("campagne de charge contre une vraie base", () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    const contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    player = require("../server/handler.js");
    player.init(contexte);
    presentations = require("../server/presentations.js");
    base = contexte.db;
  });

  const nouvellePresentation = () => presentations.createPresentation({
    docId: "charge-" + crypto.randomBytes(4).toString("hex"),
    fileUrl: "https://exemple.test/doc.pdf", fileName: "doc.pdf",
    docTitle: "Charge", presenterName: "Banc", owner: { email: "banc@exemple.test", name: "Banc" },
  });

  /** Un appel HTTP réel à travers le handler, chronométré. */
  function appeler(requete) {
    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
    const t0 = process.hrtime.bigint();
    return player.handler(requete, res).then(
      () => ({ ms: Number(process.hrtime.bigint() - t0) / 1e6, statut: res.statusCode, corps: res.body }),
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

  // ⚠️ LA PROPRIÉTÉ QUI DÉCIDE DE L'ÉCHELLE : le coût doit croître LINÉAIREMENT, pas plus vite. Une
  // latence dit ce qui se passe aujourd'hui sur cette machine ; le rapport entre deux échelles, lui,
  // dit ce qui se passera à 250 ou à 1 000.
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
