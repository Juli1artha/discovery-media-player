// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA CARTE PUBLIÉE ET LE CONTRAT ÉCRIT DOIVENT PORTER LES MÊMES CHAMPS.
//
// ⚠️ La garde qui existait ÉNUMÉRAIT quatre noms (`separateIssuer`, `hostShare`, `hostMail`,
// `retentionSweep`) et vérifiait qu'ils figuraient dans le code ET dans la doc. Elle ne pouvait donc
// pas voir ce qu'elle ne nommait pas : les trois champs de présence ajoutés cette semaine
// (`presenceStrict`, `presenceJetons`, `presenceDurcissement`) étaient publiés depuis des jours sans
// figurer au contrat, et rien ne rougissait. C'est la classe « une garde qui énumère se vide » —
// d'autant plus verte qu'elle sert moins. (Relevé par un audit externe.)
//
// On ne nomme donc plus rien : on REND une vraie carte et on compare l'ensemble de ses clés de
// premier niveau à l'exemple du contrat. Un champ ajouté demain rougit sans que personne y pense.

const fs = require("node:fs");
const path = require("node:path");
const RACINE = path.join(__dirname, "..", "..");
const CONTRAT = fs.readFileSync(path.join(RACINE, "docs", "HOST-CONTRACT.md"), "utf8");
const player = require("../handler.js");

function contexte() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
}

async function carteReelle() {
  player.init(contexte());
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  await player.handler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, res);
  return JSON.parse(res.body);
}

/** L'exemple JSON sous « ## Identity card » du contrat. */
function exempleDuContrat() {
  const i = CONTRAT.indexOf("## Identity card");
  const bloc = CONTRAT.slice(i, CONTRAT.indexOf("```", CONTRAT.indexOf("```json", i) + 7));
  return bloc.slice(bloc.indexOf("```json") + 7);
}

describe("le contrat écrit décrit la carte réellement publiée", () => {
  // RELEVÉ DU JOUR — témoin daté : 15 clés de premier niveau le 2026-08-21. Seuil LARGE : ce n'est
  // pas une mesure de couverture mais un détecteur d'effondrement (un champ retiré est légitime,
  // la moitié de la carte qui disparaît ne l'est pas).
  const PLANCHER_CLES = 10;

  it("la carte rend bien des champs — sans quoi la comparaison serait vide et toujours verte", async () => {
    const cles = Object.keys(await carteReelle());
    expect(cles.length,
      `la carte ne rend plus que ${cles.length} champs (relevé 15 le 2026-08-21). Le rendu a\n`
      + "probablement changé de forme : cette garde comparerait alors deux ensembles vides.")
      .toBeGreaterThanOrEqual(PLANCHER_CLES);
  });

  it("CHAQUE champ publié figure dans l'exemple du contrat", async () => {
    const exemple = exempleDuContrat();
    const manquants = Object.keys(await carteReelle()).filter((k) => !exemple.includes(`"${k}"`));
    expect(manquants,
      `des champs sont publiés sans figurer au contrat : ${manquants.join(", ")}.\n`
      + "Un hôte qui lit docs/HOST-CONTRACT.md ne saura pas qu'ils existent — et ceux d'entre eux qui\n"
      + "disent l'état d'une garde ne seront lus par personne. Ajoutez-les à l'exemple de la carte.")
      .toEqual([]);
  });

  it("et l'exemple ne promet pas de champ que la carte ne rend pas", async () => {
    const reelle = new Set(Object.keys(await carteReelle()));
    const promis = [...exempleDuContrat().matchAll(/^\s*"([A-Za-z]\w*)":/gm)].map((m) => m[1]);
    const fantomes = promis.filter((k) => !reelle.has(k));
    expect(fantomes,
      `le contrat annonce des champs que la carte ne rend pas : ${fantomes.join(", ")}.\n`
      + "Un hôte qui s'y fie lira `undefined` — une promesse est plus coûteuse qu'un silence.")
      .toEqual([]);
  });
});
