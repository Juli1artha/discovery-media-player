// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'ENDURANCE — CE QU'UNE RAFALE NE PEUT PAS MONTRER : LA DURÉE.
//
// ⚠️ CE BANC N'EXISTE PAS PARCE QUE L'AUDIT LE DEMANDE, MAIS PARCE QUE LA COUVERTURE EXISTANTE A UN
// TROU PRÉCIS — et il a fallu le chercher avant d'écrire une ligne. `chargeReelle` éprouve déjà des
// battements concurrents, vingt présentations simultanées, le relais de fichiers, une base ralentie,
// une base à l'agonie et la linéarité du coût ; `coutParGeste` compte les allers-retours ;
// `multiProcessus` tient le verrou consultatif contre un vrai parallélisme système. Tout cela est
// INSTANTANÉ : N appels lancés ensemble, un relevé, fini.
//
// Ce qu'aucun ne peut dire : « et si ça dure ? » Une mémoire qui monte lentement, un cache qui ne
// sature qu'après plusieurs minutes, une boucle qui décroche quand les gestes se MÉLANGENT — trois
// pannes qui ne se voient pas en trois secondes, et qui sont exactement celles qu'un exploitant
// découvre en production.
//
// ⚠️ ET IL TOURNE COURT PAR DÉFAUT, DÉLIBÉRÉMENT. Un banc qui ne s'exécute qu'à la main est un banc
// mort : ce dépôt a laissé une garde de publication morte DIX-NEUF HEURES sans que personne le
// voie, et ce n'est pas une leçon à réapprendre. Vingt-cinq secondes à chaque course de forge
// prouvent que le scénario tient debout ; la vraie campagne se lance avec
// `PLAYER_ENDURANCE_SECONDES=1800 npm run test:endurance`.
//
// ⚠️ Et cette commande est écrite ICI plutôt que dans `docs/` — délibérément. `PLAYER_ENDURANCE_
// SECONDES` n'est pas un réglage de déploiement : aucun exploitant ne le posera jamais sur une
// instance. `docs/CONFIGURATION.md` décrit ce qu'un HÔTE configure, et y ranger un bouton de banc
// le ferait chercher là par ceux qui n'en ont pas besoin, pendant que ceux qui en ont besoin sont
// déjà dans ce fichier. C'est le même choix que `PLAYER_CHARGE_SPECTATEURS`, qui vit dans son banc
// et dans `ci.yml`.
//
// ⚠️ LES SEUILS SONT DES DÉTECTEURS DE DÉRIVE, PAS LA MESURE DU JOUR — même doctrine que
// `coutParGeste` : collés au relevé, ils rougiraient au premier appel légitime ajouté, puis
// seraient desserrés sans réfléchir. Ils sont LARGES ; ce qui est absolu, c'est « aucune 5xx ».

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const BASE = process.env.PLAYER_TEST_POSTGREST_URL || "";
const SECRET = process.env.PLAYER_TEST_JWT_SECRET || "";
if (process.env.CI && !(BASE && SECRET)) {
  throw new Error(
    "endurance : PLAYER_TEST_POSTGREST_URL / PLAYER_TEST_JWT_SECRET absents. "
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

const DUREE_S = Math.max(5, Number(process.env.PLAYER_ENDURANCE_SECONDES || 25));
const APPELANTS = Math.max(2, Number(process.env.PLAYER_ENDURANCE_APPELANTS || 12));

const mio = (o) => Math.round((o / 1048576) * 10) / 10;
const moyenne = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

let player, mesures, presentations, contexte, racine;

decrire("endurance : le scénario mixte, dans la durée", () => {
  beforeAll(async () => {
    console.log(`\n  ENDURANCE — ${DUREE_S} s, ${APPELANTS} appelants simultanés, scénario mixte.`
      + "\n  Campagne longue : PLAYER_ENDURANCE_SECONDES=1800 npm run test:endurance");
    process.env.SUPABASE_URL = BASE;
    process.env.SUPABASE_SERVICE_ROLE_KEY = jeton();
    racine = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "endurance-")));
    process.env.PLAYER_LOCAL_ROOT = racine;
    fs.writeFileSync(path.join(racine, "endurance.pdf"), Buffer.alloc(256 * 1024, 0x25));
    contexte = require("../context/standalone.js").createStandaloneContext(process.env);
    player = require("../server/handler.js");
    player.init(contexte);
    mesures = require("../server/mesures.js");
    presentations = require("../server/presentations.js");
  });

  afterAll(() => { try { fs.rmSync(racine, { recursive: true, force: true }); } catch { /* déjà parti */ } });

  const nouvellePresentation = () => presentations.createPresentation({
    docId: "endur-" + crypto.randomBytes(4).toString("hex"),
    fileUrl: new URL("file://" + path.join(racine, "endurance.pdf")).href, fileName: "endurance.pdf",
    docTitle: "Endurance", presenterName: "Banc", owner: { email: "banc@exemple.test", name: "Banc" },
  });

  /**
   * ⚠️ ON COMPTE LES OCTETS, ON NE LES GARDE PAS. Un banc d'endurance qui retiendrait les corps
   * ferait monter la mémoire qu'il surveille — il mesurerait sa propre présence, et sur une
   * demi-heure il la mesurerait très bien.
   */
  function appeler(requete) {
    let octets = 0;
    const res = new (require("node:stream").Writable)({ write(m, _e, cb) { octets += m.length; cb(); } });
    res.statusCode = 0;
    res.headers = {};
    res.setHeader = function (k, v) { this.headers[String(k).toLowerCase()] = v; };
    res.getHeader = function (k) { return this.headers[String(k).toLowerCase()]; };
    const t0 = process.hrtime.bigint();
    return player.handler(requete, res).then(
      () => ({ ms: Number(process.hrtime.bigint() - t0) / 1e6, statut: res.statusCode, octets, entetes: res.headers }),
      (e) => ({ ms: Number(process.hrtime.bigint() - t0) / 1e6, statut: 599, erreur: String((e && e.message) || e) }),
    );
  }

  // ⚠️ UN SCÉNARIO MÉLANGÉ, PAS UN GESTE RÉPÉTÉ. C'est le mélange qui met les chemins en
  // concurrence — le cache de lecture, le compteur de débit et l'écriture de présence se disputent
  // la même base. Un banc qui ne joue qu'un geste à la fois ne peut pas voir cette contention.
  const GESTES = [
    ["battement", 40, (slug, i) => appeler({
      method: "POST", headers: { "content-type": "application/json" }, socket: { remoteAddress: "10.0.0." + (i % 250) }, query: {},
      body: { action: "present-attend", slug, key: "anon-endur-" + i, name: "V" + i, wantToken: "1" },
    })],
    ["etat", 30, (slug, i) => appeler({
      method: "GET", headers: {}, socket: { remoteAddress: "10.0.1." + (i % 250) }, query: { present: slug, state: "1" },
    })],
    ["chat", 15, (slug, i) => appeler({
      method: "GET", headers: {}, socket: { remoteAddress: "10.0.2." + (i % 250) }, query: { present: slug, chat: "1" },
    })],
    ["carte", 10, () => appeler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } })],
    ["inconnu", 5, () => appeler({ method: "GET", headers: {}, socket: {}, query: {} })],
  ];
  const ROUE = GESTES.flatMap(([nom, poids, faire]) => Array.from({ length: poids }, () => [nom, faire]));

  it("⚠️ le scénario mixte tient la durée : aucune 5xx, et la mémoire ne suit pas le temps", async () => {
    const presents = await Promise.all([nouvellePresentation(), nouvellePresentation(), nouvellePresentation()]);
    const slugs = presents.map((p) => p.slug);

    // Un tour de chauffe HORS mesure : la sonde de schéma et les mémos de contrat se paient une
    // fois par processus, et les compter au début ferait croire à une dégradation quand ils
    // n'existent plus.
    await Promise.all(slugs.map((s, i) => GESTES[0][2](s, i)));
    mesures.vider();

    const parGeste = new Map(GESTES.map(([nom]) => [nom, []]));
    const echantillonsRss = [];
    let n5xx = 0, total = 0, pireRetard = 0;

    const echantillon = setInterval(() => {
      echantillonsRss.push(process.memoryUsage().rss);
    }, 1000);
    echantillon.unref?.();

    // Retard de boucle mesuré par le banc LUI-MÊME : `mesures` publie le sien, et confronter deux
    // mesures indépendantes vaut mieux que de croire celle qu'on vient d'écrire.
    let dernier = process.hrtime.bigint();
    const horloge = setInterval(() => {
      const t = process.hrtime.bigint();
      const ecart = Number(t - dernier) / 1e6 - 20;
      if (ecart > pireRetard) pireRetard = ecart;
      dernier = t;
    }, 20);
    horloge.unref?.();

    const fin = Date.now() + DUREE_S * 1000;
    let tour = 0;
    const appelant = async (id) => {
      while (Date.now() < fin) {
        const [nom, faire] = ROUE[(tour += 1) % ROUE.length];
        const r = await faire(slugs[id % slugs.length], id);
        parGeste.get(nom).push(r);
        total += 1;
        if (r.statut >= 500) n5xx += 1;
        await new Promise((res) => setTimeout(res, 5));
      }
    };
    await Promise.all(Array.from({ length: APPELANTS }, (_, i) => appelant(i)));
    clearInterval(echantillon);
    clearInterval(horloge);

    const releve = mesures.relever();
    const tiers = Math.max(1, Math.floor(echantillonsRss.length / 3));
    const rssDebut = moyenne(echantillonsRss.slice(0, tiers));
    const rssFin = moyenne(echantillonsRss.slice(-tiers));

    const ligne = (n, v) => `    ${String(n).padEnd(30)}${v}`;
    console.log([
      `\n  ── endurance — ${total} appels en ${DUREE_S} s (${Math.round(total / DUREE_S)}/s) ──`,
      ...GESTES.map(([nom]) => {
        const rs = parGeste.get(nom);
        const tries = rs.map((r) => r.ms).sort((a, b) => a - b);
        const p95 = tries.length ? Math.round(tries[Math.floor(0.95 * (tries.length - 1))]) : 0;
        return ligne(nom, `${rs.length} appels, p95 ${p95} ms, 5xx ${rs.filter((r) => r.statut >= 500).length}`);
      }),
      ligne("statuts (relevé du player)", JSON.stringify(releve.statuts)),
      ligne("rss premier tiers → dernier", `${mio(rssDebut)} → ${mio(rssFin)} Mio`),
      ligne("boucle : banc / relevé (ms)", `${Math.round(pireRetard)} pire / ${releve.boucleMs.p99} p99`),
      ligne("saturations du cache", releve.statuts.occupe503),
    ].join("\n"));

    // ── 1. ABSOLU : une 5xx n'est pas un seuil, c'est un défaut ──────────────────────────────
    expect(n5xx, "une erreur serveur sous charge nominale est un défaut, pas une tolérance").toBe(0);

    // ⚠️ ANTI-VACUITÉ AVANT TOUT LE RESTE. Un banc qui n'appelle rien rendrait « aucune 5xx » et
    // « mémoire stable » — deux affirmations parfaitement vraies et parfaitement vides. Même piège
    // que `statut < 400` compté comme succès, déjà payé dans `chargeReelle`.
    expect(total, "le banc n'a rien émis : il ne prouve rien").toBeGreaterThan(APPELANTS * 3);
    for (const [nom] of GESTES) {
      expect(parGeste.get(nom).length, `le geste « ${nom} » n'a jamais été joué : le mélange n'en est pas un`).toBeGreaterThan(0);
    }

    // ── 2. L'INSTRUMENT DOIT S'ACCORDER AVEC LA RÉALITÉ ──────────────────────────────────────
    // ⚠️ Le relevé de `mesures` est né trois heures avant ce banc. Un compteur qui se trompe est
    // pire que pas de compteur : il donne une confiance qu'aucune mesure ne porte. On le confronte
    // donc à un décompte INDÉPENDANT, tenu par le banc lui-même.
    const sommeReleve = Object.values(releve.statuts).reduce((a, b) => a + b, 0);
    expect(sommeReleve, `le player a compté ${sommeReleve} réponses, le banc en a émis ${total}`).toBe(total);

    // ── 3. LA MÉMOIRE NE DOIT PAS SUIVRE LE TEMPS ────────────────────────────────────────────
    // Seuil LARGE et relatif : on détecte une fuite (croissance monotone), pas une variation de
    // ramasse-miettes. Sur une campagne de trente minutes, une vraie fuite dépasse largement +60 %.
    if (echantillonsRss.length >= 6) {
      expect(rssFin, `rss ${mio(rssDebut)} → ${mio(rssFin)} Mio : la mémoire suit la durée`)
        .toBeLessThan(rssDebut * 1.6);
    }

    // ── 4. LA BOUCLE NE DÉCROCHE PAS QUAND LES GESTES SE MÉLANGENT ───────────────────────────
    expect(pireRetard, `pire retard de boucle : ${Math.round(pireRetard)} ms`).toBeLessThan(2000);
  }, 60 * 60 * 1000);

  it("⚠️ au-delà du plafond d'admission, le cache REFUSE proprement — 503 réessayable, jamais 500", async () => {
    // Le plafond ne se voit pas sous charge nominale : il faut une base lente ET beaucoup de clés
    // DISTINCTES en vol. C'est la mesure que les deux hôtes intégrateurs ont dit ne pas pouvoir
    // produire chez eux, et la seule qui répond à « sature-t-on, en vrai ? ».
    const vraie = contexte.db.request.bind(contexte.db);
    contexte.db.request = async (chemin, o) => { await new Promise((r) => setTimeout(r, 400)); return vraie(chemin, o); };
    try {
      mesures.vider();
      // Des slugs DISTINCTS : une clé déjà en vol se partage — c'est le regroupement, et il ne
      // consomme qu'une place. Seules des clés différentes remplissent l'admission.
      const resultats = await Promise.all(Array.from({ length: 200 }, (_, i) => appeler({
        method: "GET", headers: {}, socket: { remoteAddress: "10.9.0." + (i % 250) },
        query: { present: "sature-" + i, state: "1" },
      })));

      const refus = resultats.filter((r) => r.statut === 503);
      const erreurs = resultats.filter((r) => r.statut >= 500 && r.statut !== 503);
      console.log(`\n  ── saturation — 200 clés distinctes, base +400 ms ──\n`
        + `    503 réessayables               ${refus.length}\n`
        + `    autres 5xx                     ${erreurs.length}\n`
        + `    relevé du player               ${JSON.stringify(mesures.relever().statuts)}`);

      expect(erreurs.length, "un refus d'admission n'est PAS une panne : 503, jamais 500").toBe(0);

      // ⚠️ ON EXIGE QUE LA SATURATION AIT EU LIEU, ET CE N'EST PAS UN SEUIL DE MACHINE. Deux cents
      // clés distinctes contre un plafond de cent vingt-huit, sous une base à +400 ms : la marge
      // est structurelle, pas chronométrique. Sans cette ligne, un plafond devenu inatteignable —
      // déplacé, contourné, ou une admission qui n'admet plus rien — rendrait ce banc VERT en
      // n'ayant rien observé, et il affirmerait « les refus sont propres » sans avoir vu un refus.
      // C'est le même piège que « statut < 400 = réussi », déjà payé dans `chargeReelle`.
      expect(refus.length,
        "aucune saturation avec 200 clés distinctes sous une base lente : soit le plafond "
        + "d'admission a changé, soit il n'est plus atteint — dans les deux cas ce banc ne mesure "
        + "plus ce qu'il annonce").toBeGreaterThan(0);

      // Le nombre exact, lui, dépend de la machine : on n'affirme que la PROPRIÉTÉ. Tout refus
      // porte son `Retry-After` — sinon l'appelant abandonne une requête que la seconde d'après
      // aurait servie.
      for (const r of refus) {
        expect(r.entetes["retry-after"], "un 503 sans Retry-After dit « abandonne » au lieu de « attends »").toBeTruthy();
      }
      // Et le compteur du player doit voir exactement les mêmes.
      expect(mesures.relever().statuts.occupe503).toBe(refus.length);
    } finally {
      contexte.db.request = vraie;
    }
  }, 10 * 60 * 1000);
});
