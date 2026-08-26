// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES BOUTONS DE VOIX SONT DU BALISAGE, PAS DU COMPORTEMENT — ET LA DOC DOIT LE DIRE.
//
// ⚠️ CE QUI A ÉTÉ TROUVÉ, ET PAR QUI. Le 26/08, un hôte intégrateur est allé chercher qui appelait
// `bot-tts` chez nous, et n'a trouvé personne. Vérifié depuis au niveau du TARBALL PUBLIÉ : la
// chaîne `bot-tts` y vit dans quatre fichiers — la route elle-même, deux commentaires et un
// document. Aucun appelant. Pendant ce temps `gabarit-agent.js` rend TROIS boutons de voix
// (`botcVoice`, `botpVoice`, `botcVoice2`) conditionnés à `ELEVENLABS_API_KEY`.
//
// ⚠️ ET CE N'EST PAS UNE RÉGRESSION : ÇA N'A JAMAIS ÉTÉ CÂBLÉ. La route et les boutons sont là
// depuis le PREMIER commit ; le gestionnaire, jamais. Chercher le commit fautif ne mènerait nulle
// part — il n'y en a pas.
//
// ⚠️ CE QUE ÇA COÛTAIT, ET POURQUOI C'EST UN BANC ET PAS UN CORRECTIF. `docs/CONFIGURATION.md`
// affirmait « the browser asks this instance » — un hôte qui lit ça pose une clé d'API PAYANTE,
// voit trois boutons apparaître, et en conclut que la voix marche. Le dépôt avait pourtant DÉJÀ
// écrit le principe, dans `gabaritsVisiteur.test.js` : « une porte "écouter la présentation" qui
// mène au silence est une promesse cassée ». Ce banc-là vérifiait que les boutons disparaissent
// SANS clé — il ne pouvait pas voir qu'avec la clé ils ne mènent nulle part.
//
// On ne CÂBLE pas ici : à quoi la voix doit être rattachée est une décision de protocole encore
// ouverte (rien ne lie le texte à une réponse réellement produite). On épingle l'ÉTAT, pour que la
// doc et le paquet ne puissent plus diverger en silence : le jour où un client appellera la route,
// ce banc rougira et forcera la mise à jour du texte qui décrit l'inverse.

const { readFileSync, existsSync } = require("node:fs");
const { join } = require("node:path");

const RACINE = join(__dirname, "..", "..");
const lire = (p) => readFileSync(join(RACINE, p), "utf8");

// Les artefacts que le NAVIGATEUR reçoit. Un appelant de `bot-tts` ne peut vivre que là — ou dans
// un `<script>` d'un gabarit, couvert par la seconde vérification.
const COTE_NAVIGATEUR = [
  "server/browser.generated.js",
  "server/shared.generated.js",
  "dist/bridge.js",
  "src/index.ts",
  "src/viewer.ts",
  "src/chat.ts",
  "src/bridge.ts",
];

// Les gabarits servis, qui pourraient embarquer un script en ligne.
const GABARITS = ["server/gabarit-agent.js", "server/page-visionneuse.js"];

describe("aucun client de ce paquet n'appelle `bot-tts`", () => {
  it("la sonde regarde de VRAIS fichiers, et la route existe bien (anti-vacuité)", () => {
    // ⚠️ Sans ça, un renommage rendrait « zéro appelant » sur zéro fichier lu — ce qui se lit
    // exactement comme « aucun appelant ». Et si la route elle-même disparaissait du champ de
    // recherche, la sonde se féliciterait sur un dépôt qui ne parle plus de voix du tout.
    const presents = COTE_NAVIGATEUR.filter((f) => existsSync(join(RACINE, f)));
    expect(presents.length, "aucun artefact navigateur trouvé — la sonde ne regarde plus au bon endroit").toBeGreaterThanOrEqual(5);
    for (const f of presents) {
      expect(lire(f).length, `${f} est vide ou tronqué`).toBeGreaterThan(500);
    }
    expect(lire("server/routes-agent.js")).toContain("bot-tts");
  });

  it("aucun artefact navigateur ne nomme la route", () => {
    const coupables = COTE_NAVIGATEUR.filter((f) => existsSync(join(RACINE, f)) && lire(f).includes("bot-tts"));
    expect(
      coupables,
      "un client appelle désormais `bot-tts` : mettez à jour docs/CONFIGURATION.md, qui affirme le contraire",
    ).toEqual([]);
  });

  it("aucun gabarit ne câble les boutons de voix", () => {
    // Les trois identifiants ne doivent apparaître que comme BALISAGE et CSS — jamais accrochés à
    // un écouteur. On cherche les formes d'accrochage, pas les identifiants eux-mêmes : c'est la
    // différence entre « le bouton existe » et « le bouton fait quelque chose ».
    const accroches = [];
    for (const f of GABARITS) {
      const texte = lire(f);
      for (const id of ["botcVoice", "botpVoice", "botcVoice2"]) {
        const motifs = [
          new RegExp(`getElementById\\(['"\`]${id}`),
          new RegExp(`querySelector\\([^)]*#${id}`),
          new RegExp(`${id}[^\\n]{0,40}addEventListener`),
          new RegExp(`${id}\\.onclick`),
        ];
        if (motifs.some((m) => m.test(texte))) accroches.push(`${f}:${id}`);
      }
    }
    expect(
      accroches,
      "un bouton de voix est désormais câblé : mettez à jour docs/CONFIGURATION.md, qui dit qu'aucun ne l'est",
    ).toEqual([]);
  });

  it("et la documentation dit exactement ça, plutôt que l'inverse", () => {
    // ⚠️ LES ESPACES SONT APLATIES AVANT COMPARAISON, ET CE N'EST PAS DU CONFORT. Le markdown de ce
    // dépôt est enroulé à ~100 colonnes : « the browser asks this instance » y vit coupé par un
    // retour à la ligne. Une recherche mono-ligne ne l'aurait jamais trouvée — l'assertion serait
    // passée au vert en ne regardant rien, et sa mutation aussi. Constaté en éprouvant ce banc :
    // la mutation qui devait le faire rougir était un no-op silencieux.
    const doc = lire("docs/CONFIGURATION.md").replace(/\s+/g, " ");
    // ⚠️ ON EXIGE L'AFFIRMATION, PAS SON ABSENCE. Vérifier que la vieille phrase a disparu
    // laisserait passer un texte qui ne dit plus rien du tout — et « rien » se lit comme « ça
    // marche » pour qui vient de poser une clé payante.
    expect(doc, "docs/CONFIGURATION.md doit dire que ce paquet ne fournit aucun appelant").toContain(
      "THIS PACKAGE SHIPS NO CLIENT THAT CALLS",
    );
    expect(doc, "docs/CONFIGURATION.md doit nommer les trois boutons concernés").toMatch(/botcVoice.{0,80}botpVoice/);
    // La doc ne doit plus promettre que le navigateur appelle tout seul.
    expect(doc).not.toContain("the browser asks this instance");
  });
});
