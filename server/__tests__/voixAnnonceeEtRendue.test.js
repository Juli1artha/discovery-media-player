// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QUE LA PAGE DIT AU GREFFON ET CE QU'ELLE REND AU VISITEUR NE PEUVENT PAS SE CONTREDIRE.
//
// ⚠️ LA QUATRIÈME FORME : UN ÉTAT AFFICHÉ DÉRIVÉ DE LA CONFIGURATION, PAS DE L'OBSERVATION.
// `page-visionneuse.js` remet au greffon de l'hôte un objet `cfg` — c'est la poignée que reçoit
// `window.PlayerBot.init(VIEWER)`, et le contrat est clair : « Your `bot` plugin owns the
// assistant's behaviour — all of it ». Le champ `botVoice` y annonçait « la voix est disponible »
// sur la SEULE présence d'`ELEVENLABS_API_KEY`.
//
// ⚠️ ET LE DÉPÔT AVAIT DÉJÀ ÉCRIT LA CORRECTION, EN GRAS, DANS SON PROPRE CONTRAT (26/08) :
// « ELEVENLABS_API_KEY alone no longer shows them: the key proves the *server* can synthesise,
// never that a click leads anywhere, and a button that leads to silence is a broken promise made
// in your name. » Le BALISAGE l'appliquait — `voixProposable()` exige la clé ET `wiresVoice ===
// true`. Le CHAMP, lui, portait encore l'ancienne règle, à quelques lignes de distance.
//
// Mesuré le 31/08, clé posée, greffon sans `wiresVoice` :
//
//     cfg.botVoice  = true      ← ce que la page DIT au greffon
//     balisage voix = absent    ← ce que le lecteur a RENDU
//
// ⚠️ CE QUI EST ÉPROUVÉ ICI EST L'ACCORD, PAS LA VALEUR. Affirmer « botVoice est faux sans
// wiresVoice » figerait un cas ; ce qui doit tenir quelle que soit la configuration, c'est que les
// deux moitiés d'une même page disent la MÊME chose. Une seule d'entre elles peut se tromper sans
// que rien ne le voie — c'est exactement ce qui est arrivé.

const routesGabarit = require("../gabarit-agent.js");
const vis = require("../page-visionneuse.js");
const legal = require("../gabarit-legal.js");

// ⚠️ LE CONTEXTE PORTE `botBrowser`, ET LE PREMIER JET NE LE VOYAIT PAS. Sans lui `botOn` est
// faux, `botMarkup` n'est jamais rendu, et le cas positif — clé posée ET greffon qui câble —
// serait « les deux moitiés disent non », c'est-à-dire vert pour la mauvaise raison, dans le banc
// écrit pour attraper une divergence. L'éprouvette doit atteindre la branche où la divergence
// pouvait exister.
const contexte = (bot) => ({
  branding: { name: "Studio", title: (b) => b },
  legal: { company: "Studio", url: "", email: "" },
  plugins: { bot, botBrowser: { botViewerJs: () => "" } },
});

function poser(bot) {
  const ctx = contexte(bot);
  routesGabarit.init(ctx);
  vis.init(ctx);
  if (legal.init) legal.init(ctx);
}

const PARTAGE = { slug: "s", bot_enabled: true, bot_name: "Lea", file_name: "d.pdf" };

/** Ce que la page ANNONCE au greffon, et ce qu'elle REND au visiteur. */
function lire() {
  const html = vis.viewerHtml(PARTAGE, "nonce", "", "");
  const m = html.match(/"botVoice":(true|false)/);
  return {
    annonce: m ? m[1] === "true" : null,
    // ⚠️ ON CHERCHE DES ÉLÉMENTS, PAS DES CHAÎNES. Premier jet : `/botcVoice|botw-s2/` — trois
    // marqueurs qui vivent AUSSI dans le CSS (un nom d'animation `botcVoicePulse`, un sélecteur
    // `.botw-card.botw-s2`) et qui sont donc présents quoi qu'il arrive. Le banc rougissait sur
    // une divergence qui n'existait pas. Une sonde qui lit la feuille de style invente un
    // coupable, comme celle qui lit du commentaire.
    rendu: /id=(doorVoice|botcVoice2?|botpVoice)\b/.test(html),
  };
}

afterEach(() => { delete process.env.ELEVENLABS_API_KEY; });

describe("⚠️ la voix annoncée au greffon est celle qui est rendue au visiteur", () => {
  // ⚠️ LE CAS QUI DIVERGEAIT, ET LE SEUL OÙ LA DIVERGENCE POUVAIT EXISTER : il faut la clé pour
  // que l'ancienne règle dise « oui », et un greffon muet pour que la nouvelle dise « non ».
  for (const [nom, bot] of [
    ["aucun greffon", null],
    ["un greffon qui ne déclare rien", {}],
    ["une déclaration seulement VÉRIDIQUE, pas `true`", { wiresVoice: "oui" }],
  ]) {
    it(`⚠️ avec la clé mais ${nom} : la page n'annonce pas une voix qu'elle ne rend pas`, () => {
      process.env.ELEVENLABS_API_KEY = "cle-de-test";
      poser(bot);
      const { annonce, rendu } = lire();
      expect(annonce, "le champ remis au greffon promettait la voix").toBe(false);
      expect(rendu, "et le balisage, lui, n'en rendait aucune").toBe(false);
    });
  }

  it("clé posée ET greffon qui câble : la page annonce ET rend", () => {
    process.env.ELEVENLABS_API_KEY = "cle-de-test";
    poser({ wiresVoice: true });
    const { annonce, rendu } = lire();
    expect(annonce).toBe(true);
    expect(rendu).toBe(true);
  });

  it("sans clé, même avec un greffon qui câble : ni annonce ni rendu", () => {
    poser({ wiresVoice: true });
    const { annonce, rendu } = lire();
    expect(annonce).toBe(false);
    expect(rendu).toBe(false);
  });

  // ⚠️ LA PARTITION ÉNONCÉE D'UN SEUL TENANT — vert au milieu, faux des deux bords. Sans elle, un
  // `botVoice: false` en dur passerait les trois cas ci-dessus : ils n'exigent que des « non ».
  it("⚠️ les deux moitiés s'accordent dans les QUATRE configurations, pas seulement là où c'est non", () => {
    const cas = [
      [false, null, false], [false, {}, false], [false, { wiresVoice: true }, false],
      [true, null, false], [true, {}, false], [true, { wiresVoice: "oui" }, false],
      [true, { wiresVoice: true }, true],
    ];
    for (const [avecCle, bot, attendu] of cas) {
      if (avecCle) process.env.ELEVENLABS_API_KEY = "cle-de-test";
      else delete process.env.ELEVENLABS_API_KEY;
      poser(bot);
      const { annonce, rendu } = lire();
      const etiquette = `clé=${avecCle} bot=${JSON.stringify(bot)}`;
      expect(annonce, `${etiquette} : l'annonce au greffon`).toBe(attendu);
      expect(rendu, `${etiquette} : le rendu au visiteur`).toBe(attendu);
      expect(annonce, `${etiquette} : les deux moitiés doivent dire la même chose`).toBe(rendu);
    }
  });
});
