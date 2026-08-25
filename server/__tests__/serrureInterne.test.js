// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE VERROU EXISTAIT, LA CLÉ N'AVAIT PAS DE SERRURE.
//
// 0.1.22 a posé `verifyInternalToken`, qui lit `body.it`, et annoncé que `PLAYER_INTERNAL_STRICT=1`
// « ferme la porte entièrement ». C'était vrai du CONTRÔLE et faux du SYSTÈME : aucun chemin ne
// permettait à l'hôte de FOURNIR ce jeton.
//
// La route d'aperçu lisait `uemail`, `docId`, `name`, `title`, `by`, `av`, `resume`, `autopresent` —
// pas de jeton. Et `CFG.internal` ne portait que `{email, name, docId}`. Poser la variable aurait
// donc refusé 100 % des sessions internes de TOUTES les instances, la nôtre comprise.
//
// ⚠️ C'est la raison pour laquelle « analytics strict par défaut » ne pouvait pas être publié :
// ça n'aurait pas durci les hôtes, ça les aurait coupés. Un verrou qu'on ne peut pas fermer n'est
// pas une transition, c'est une annonce.
//
// Trouvé par le second hôte, en préparant le jeton qu'on lui demandait de signer.

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const SRC = require("./sourceDesPages.cjs").SOURCE_PAGES;
const SECRET = "un-secret-partage-de-32-caracteres-minimum";
const signer = (charge) => {
  const c = Buffer.from(JSON.stringify(charge)).toString("base64url");
  return c + "." + crypto.createHmac("sha256", SECRET).update(c).digest("base64url");
};

describe("le jeton peut voyager de l'hôte jusqu'à la page", () => {
  it("la route d'aperçu accepte un paramètre de jeton", () => {
    expect(SRC, "sans ce paramètre, l'hôte n'a aucun moyen de se porter garant")
      .toMatch(/internal_token:\s*String\(q\.it\s*\|\|\s*""\)/);
  });

  it("et la page le reçoit dans sa configuration interne", () => {
    const i = SRC.indexOf("internal: preview && share.internal_email");
    expect(i).toBeGreaterThan(0);
    expect(SRC.slice(i, i + 260), "CFG.internal ne portait que email/name/docId")
      .toMatch(/it:\s*share\.internal_token/);
  });

  it("le traceur le renvoie dans le corps, là où le serveur le lit", () => {
    const t = fs.readFileSync(path.join(__dirname, "..", "..", "src", "tracking.ts"), "utf8");
    expect(t).toMatch(/payload\.it\s*=\s*internal\.it/);
    // ⚠️ Dans le CORPS, pas en en-tête : `sendBeacon` n'en porte pas, et c'est lui qui survit à la
    // fermeture d'un onglet — donc à l'instant où la mesure compte le plus.
    expect(t).toMatch(/sendBeacon/);
  });

  // La chaîne complète, exercée : un jeton posé en aperçu doit ressortir dans la page servie.
  it("bout en bout : le jeton posé en aperçu se retrouve dans la page", async () => {
    const player = require("../handler.js");
    player.init({
      plugins: {}, has: () => false,
      storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
      db: { async request() { return []; }, async selectAll() { return []; } },
      mail: { async send() {} },
      identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
      limits: { async allow() { return true; } },
      branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
      errors: { async capture() {} },
      legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "", trackingNoticeAnonymous: "", publicUrl: "" },
      config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
    });
    const jeton = signer({ email: "membre@exemple.fr", name: "M", docId: "d1", exp: Math.floor(Date.now() / 1000) + 600 });
    const res = { statusCode: 0, headers: {}, body: "", setHeader() {}, end(b) { this.body = String(b || ""); } };
    await player.handler({ method: "GET", headers: {}, socket: {},
      query: { preview: "1", url: "https://x.supabase.co/storage/v1/object/public/r/d.pdf", name: "d.pdf",
        uemail: "membre@exemple.fr", docId: "d1", it: jeton } }, res);
    expect(res.body, "le jeton doit atteindre la page, sinon la serrure n'est toujours pas percée")
      .toContain(jeton);
  });
});

// ⚠️ UN REJET MUET A COÛTÉ DES SEMAINES À UN HÔTE. Il a monté son suivi interne, l'a cru en
// service, et a découvert bien plus tard que la table était vide : son `docId` ne partait pas, et
// chaque battement était jeté en silence. La garde était juste ; c'est son mutisme qui coûtait.
//
// Une mesure qui ne remonte rien est indistinguable d'une mesure qui n'a rien à remonter : personne
// ne va chercher une panne qu'aucun signal n'annonce.
describe("un rejet de session interne se dit", () => {
  const shares = require("../shares.js");
  let alertes = [];
  const contexte = () => ({
    db: { async request() { return []; } },
    limits: { async allow() { return true; } },
    errors: { capture(e) { alertes.push(String(e && e.message)); } },
  });

  beforeEach(() => { alertes = []; });

  it.each([
    ["docId absent", { sessionId: "s1" }, /docId/],
    ["sessionId absent", { docId: "d1" }, /sessionId/],
  ])("%s : rien n'est écrit, et le journal le nomme", async (_nom, charge, motif) => {
    shares.init(contexte());
    await shares.upsertInternalSession(charge, { ip: "", ua: "" });
    expect(alertes.join(" "), "l'exploitant doit pouvoir tomber dessus en ouvrant ses journaux")
      .toMatch(motif);
  });

  it("une session complète ne déclenche aucune alerte", async () => {
    let ecrit = null;
    shares.init({ ...contexte(), db: { async request(_c, o) { ecrit = o && o.body; return []; } } });
    await shares.upsertInternalSession({ sessionId: "s1", docId: "d1" }, { ip: "", ua: "" });
    expect(ecrit, "la ligne part").toBeTruthy();
    expect(alertes, "et rien ne bruite les journaux quand tout va bien").toEqual([]);
  });

  // Une fois par heure : le but est qu'on tombe dessus, pas de compter les rejets.
  it("le signalement est limité, il ne noie pas le journal", async () => {
    let vus = 0;
    shares.init({ ...contexte(), limits: { async allow() { vus++; return vus <= 1; } } });
    for (let i = 0; i < 50; i++) await shares.upsertInternalSession({ sessionId: "s" }, { ip: "", ua: "" });
    expect(alertes).toHaveLength(1);
  });
});
