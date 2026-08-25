// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// L'HÔTE DOIT POUVOIR VOIR SUR QUOI LE LECTEUR TOURNE — ET IL NE LE POUVAIT PAS.
//
// ⚠️ MESURÉ LE 25/08 CHEZ UN INTÉGRATEUR. Le réglage de son projet annonçait « nodeVersion: 24.x »
// pendant que le déploiement servant la production tournait en `nodejs 22`. Il l'a constaté en
// lisant sa plateforme, pas le lecteur — et il l'a dit ainsi : « je ne peux pas mesurer son
// correctif de l'extérieur, aucune route ne rend `process.version` ». C'était vrai de ce dépôt
// aussi : rien dans `server/`, `context/` ou `src/` ne lisait `process.versions`.
//
// Un runtime CONFIGURÉ est une intention. Le relire ne dit pas ce qui s'est exécuté — c'est le même
// écart que l'étiquette à côté du condensat, sur un couple que personne ne confrontait.
//
// ⚠️ DEUX NOMBRES, AUCUN VERDICT. La carte ne dit pas « supporté : oui » : ça demanderait un
// évaluateur d'intervalles semver dans le serveur, et ce dépôt a payé deux fois d'avoir analysé un
// format structuré à la main. L'hôte compare, avec son propre semver.

const player = require("../handler.js");
const paquet = require("../../package.json");

function contexteMinimal() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => false, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "", supabasePublishableKey: "", mapsKey: "", extraFrameAncestors: [] },
  };
}

async function carte() {
  player.init(contexteMinimal());
  const res = {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); },
  };
  await player.handler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, res);
  return JSON.parse(res.body);
}

describe("le runtime sur la carte d'identité", () => {
  it("rend la version de node RÉELLEMENT en train de tourner", async () => {
    expect((await carte()).runtime.node).toBe(process.versions.node);
  });

  it("⚠️ jusqu'au correctif — le plancher est de niveau correctif, une majeure.mineure ne répondrait pas", async () => {
    expect((await carte()).runtime.node).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("rend le plancher déclaré, lu là où il est déclaré et non recopié", async () => {
    expect((await carte()).runtime.nodeRequired).toBe(paquet.engines.node);
  });

  it("⚠️ ne rend AUCUN verdict — c'est l'hôte qui compare, avec son propre semver", async () => {
    expect(Object.keys((await carte()).runtime).sort()).toEqual(["node", "nodeRequired"]);
  });

  it("répond sans session ni base, comme le reste de la carte (règle 4 du contrat)", async () => {
    const c = await carte();
    expect(c.contract).toBe(1);
    expect(c.runtime).toBeTruthy();
  });
});
