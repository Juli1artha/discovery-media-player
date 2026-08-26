// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES GABARITS VISITEUR — 69 BRANCHES D'AFFICHAGE, ZÉRO ÉPROUVÉE.
//
// ⚠️ `gabarit-agent.js` et `page-mur.js` composent du HTML à partir de CHAMPS DE LA BASE
// (bot_name, doc_title, marque du client…) — c'est-à-dire de texte qu'un compte compromis, ou un
// hôte mal branché, peut choisir. L'échappement y est la frontière entre « afficher un nom » et
// « exécuter du script chez le visiteur » : chaque `esc()` de ces gabarits est une décision de
// sécurité, et aucune n'était éprouvée. Deux branches de PRODUIT s'y ajoutent : le consentement
// audio ne se propose que si une voix existe côté serveur (une porte « écouter » qui mène à un
// silence est une promesse cassée), et le mur d'accès suit la marque du client — thème compris.

const routesGabarit = require("../gabarit-agent.js");
const { softWallHtml, notFoundHtml } = require("../page-mur.js");

// ⚠️ `wiresVoice` EST UNE DÉCLARATION DE L'HÔTE, PAS UNE CAPACITÉ DU SERVEUR. Elle dit « je câble
// les contrôles de voix » — le seul fait que ce paquet ne peut pas constater lui-même, puisqu'il ne
// câble aucun des soixante-quatre contrôles de cet assistant.
const PLAYER = { branding: { name: "Studio" }, plugins: { bot: { wiresVoice: true } } };
routesGabarit.init(PLAYER);
const avecHote = (bot) => routesGabarit.init({ ...PLAYER, plugins: { bot } });
require("../page-mur.js").init(PLAYER);

const PARTAGE = { bot_name: "Léa", bot_tagline: "Votre guide", bot_accent: "#123456" };

afterEach(() => { delete process.env.ELEVENLABS_API_KEY; });

describe("botMarkup : ce qui vient de la base ressort inoffensif", () => {
  it("un bot_name hostile est échappé partout où il s'affiche — y compris dans les title=", () => {
    const html = routesGabarit.botMarkup({ ...PARTAGE, bot_name: '<img src=x onerror=alert(1)>' }, "");
    expect(html).not.toContain("<img src=x onerror");
    expect(html).toContain("&lt;img src=x onerror");
  });

  it("un pitch hostile est échappé, et un pitch absent ne laisse aucun paragraphe vide", () => {
    const avec = routesGabarit.botMarkup(PARTAGE, '<script>alert(1)</script>');
    expect(avec).not.toContain("<script>alert(1)");
    expect(avec).toContain("botw-pitch");
    const sans = routesGabarit.botMarkup(PARTAGE, "");
    expect(sans).not.toContain("botw-pitch");
  });

  it("l'avatar suit la donnée : image si fournie, initiale MAJUSCULE sinon, losange sans nom", () => {
    expect(routesGabarit.botMarkup({ ...PARTAGE, bot_avatar: "https://cdn/a.png" }, "")).toContain('src="https://cdn/a.png"');
    expect(routesGabarit.botMarkup({ ...PARTAGE, bot_name: "léa" }, "")).toContain(">L</span>");
    expect(routesGabarit.botMarkup({ bot_accent: "#000" }, "")).toContain("◆");
  });

  it("sans nom d'assistant, le nom de l'INSTANCE le remplace — jamais un « undefined »", () => {
    const html = routesGabarit.botMarkup({ bot_accent: "#000" }, "");
    expect(html).toContain("Assistant Studio");
    expect(html).not.toContain("undefined");
  });
});

describe("botMarkup : le consentement audio ne se propose que si une voix existe", () => {
  afterEach(() => { delete process.env.ELEVENLABS_API_KEY; avecHote({ wiresVoice: true }); });

  it("sans clé de synthèse côté serveur : ni bouton voix, ni étape de choix audio", () => {
    const html = routesGabarit.botMarkup(PARTAGE, "");
    // Une porte « écouter la présentation » qui mène au silence est une promesse cassée — le
    // consentement audio (botw-s2) n'existe que si le serveur sait réellement parler.
    expect(html).not.toContain("botw-s2");
    expect(html).not.toContain("botcVoice");
  });

  // ⚠️ LA CLÉ SEULE NE SUFFIT PLUS, ET C'EST LE CORRECTIF DU 26/08. Elle prouve que le SERVEUR sait
  // synthétiser ; elle ne prouve rien de ce qui arrive quand on clique. Ce paquet ne câble aucun
  // contrôle de cet assistant : sans déclaration de l'hôte, la porte mène au silence — exactement
  // la promesse cassée que le banc au-dessus interdit, dans le seul cas où il ne regardait pas.
  for (const [nom, bot] of [
    ["aucun greffon", null],
    ["un greffon qui ne déclare rien", {}],
    ["une déclaration seulement VÉRIDIQUE, pas `true`", { wiresVoice: "oui" }],
  ]) {
    it(`avec une clé mais ${nom} : aucun contrôle de voix, aucune étape audio`, () => {
      process.env.ELEVENLABS_API_KEY = "cle";
      avecHote(bot);
      const html = routesGabarit.botMarkup(PARTAGE, "");
      expect(html, "un bouton de voix que rien ne câble est une porte vers le silence").not.toContain("botcVoice");
      expect(html).not.toContain("botpVoice");
      expect(html).not.toContain("botw-s2");
    });
  }

  it("avec une clé ET un hôte qui déclare câbler : l'étape de consentement existe, et la porte vidéo n'apparaît qu'avec des clips", () => {
    process.env.ELEVENLABS_API_KEY = "cle";
    avecHote({ wiresVoice: true });
    const sansClips = routesGabarit.botMarkup(PARTAGE, "");
    expect(sansClips).toContain("botw-s2");
    expect(sansClips).not.toContain("doorVideo");
    const avecClips = routesGabarit.botMarkup({ ...PARTAGE, bot_vclips: true }, "");
    expect(avecClips).toContain("doorVideo");
    // Un layout vidéo déclaré SANS clips prêts : on l'annonce, on ne promet pas une porte morte.
    const bientot = routesGabarit.botMarkup({ ...PARTAGE, video_layout: "face" }, "");
    expect(bientot).toContain("arrive bientôt");
    expect(bientot).not.toContain("doorVideo");
    // Témoin : sans ces trois-là, les refus ci-dessus seraient satisfaits par un gabarit qui ne
    // rend JAMAIS de voix — c'est-à-dire par la suppression de la fonctionnalité.
    expect(sansClips).toContain("botcVoice");
    expect(sansClips).toContain("botpVoice");
    expect(sansClips).toContain("botcVoice2");
  });
});

describe("le mur d'accès : la marque du client, sans jamais lui faire confiance", () => {
  const LIEN = { doc_title: "Proposition 2026", brand_logo: "", brand_name: "", brand_dark: false };

  it("un titre de document hostile est échappé — le mur est la PREMIÈRE page qu'un inconnu voit", () => {
    const html = softWallHtml({ ...LIEN, doc_title: '"><script>alert(1)</script>' }, "nonce", "", "");
    expect(html).not.toContain("<script>alert(1)");
  });

  it("le logo du CLIENT prime sur celui de l'instance, et déclenche la mention « powered by » dessous", () => {
    const marque = softWallHtml({ ...LIEN, brand_logo: "https://cdn/client.svg", brand_name: "Acme & Fils" }, "n", "https://cdn/studio.svg", "");
    expect(marque).toContain('src="https://cdn/client.svg"');
    expect(marque).toContain("Acme &amp; Fils");
    const instance = softWallHtml(LIEN, "n", "https://cdn/studio.svg", "");
    expect(instance).toContain('src="https://cdn/studio.svg"');
  });

  it("brand_dark bascule le fond — la charte du client se respecte jusqu'au mur", () => {
    expect(softWallHtml({ ...LIEN, brand_dark: true }, "n", "", "")).toContain("#16181d");
    expect(softWallHtml(LIEN, "n", "", "")).not.toContain("#16181d");
  });

  it("la page indisponible ne dit RIEN du document — un lien révoqué ne confirme pas ce qu'il protégeait", () => {
    // La propriété est STRUCTURELLE : la fonction ne reçoit rien du document, elle ne peut donc
    // rien en fuir. Si une signature apparaît un jour, ce test demande de re-poser la question.
    expect(notFoundHtml.length).toBe(0);
    const html = notFoundHtml();
    expect(html).toContain("Document indisponible");
    expect(html).toContain("révoqué");
  });
});
