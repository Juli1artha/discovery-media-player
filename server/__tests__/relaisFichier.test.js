// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CE QU'ON RELAIE S'OUVRE SUR NOTRE ORIGINE.
//
// Le player ne se contente pas de pointer vers un fichier : il le RELAIE, donc le fichier sort du
// domaine qui sert les documents — avec ses cookies, son `localStorage` et ses jetons de
// présentation. Recopier le `Content-Type` de l'amont revient alors à héberger le script d'un
// autre chez soi : un SVG déposé dans une source autorisée s'ouvre `image/svg+xml` et son
// `<script>` s'exécute avec notre origine. Rien ne le retiendrait — une réponse de streaming ne
// porte aucune CSP, c'est un fichier et pas une page.
//
// ⚠️ Trouvé en établissant la matrice des formats du README, c'est-à-dire en répondant à une
// question de DOCUMENTATION. Retirer `.svg` de la table des types locaux ne réglait que la moitié
// du sujet : l'amont distant annonce le type qu'il veut. La leçon vaut plus que le correctif —
// une garde posée sur la source qu'on maîtrise n'a rien dit de celle qu'on ne maîtrise pas.
//
// Le fichier n'est pas refusé pour autant. Il existe, quelqu'un a le droit de le récupérer, et un
// 502 sur une pièce jointe légitime serait une panne. Il est rendu INERTE.

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
require.cache[ID] = { id: ID, filename: ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => null, listMessages: async () => [] } };

const player = require("../handler.js");

const URL_OK = "https://exemple.supabase.co/storage/v1/object/public/resources/fichier";

/** Un amont qui annonce le type qu'il veut — c'est tout le sujet. */
function amont(type, corps = "contenu") {
  const h = new Map([["content-type", type]]);
  return {
    ok: true, status: 200,
    headers: { get: (k) => (h.has(k.toLowerCase()) ? h.get(k.toLowerCase()) : null) },
    arrayBuffer: async () => Buffer.from(corps, "utf8"),
  };
}

async function servir(type, corps) {
  player.init({
    plugins: {}, has: () => false,
    storage: {
      isAllowedUrl: (u) => String(u || "").startsWith("https://exemple.supabase.co/"),
      async fetchFile() { return amont(type, corps); },
      async put() {},
    },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  });

  const res = {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); },
  };
  await player.handler(
    { method: "GET", headers: {}, socket: {}, query: { preview: "1", url: URL_OK, stream: "1", name: "fichier" } },
    res,
  );
  return res;
}

describe("un fichier relayé ne peut pas s'exécuter sur notre origine", () => {
  // La liste est courte et volontairement large : tout ce qu'un navigateur RENDRAIT plutôt que
  // télécharger. Le XML y est parce qu'une feuille XSLT s'exécute.
  const EXECUTABLES = [
    "image/svg+xml",
    "image/svg+xml; charset=utf-8",
    "text/html",
    "text/html;charset=UTF-8",
    "application/xhtml+xml",
    "application/xml",
    "text/xml",
  ];

  // ⚠️ `attachment` doit ÉCRASER la disposition, pas la compléter : le chemin de streaming pose
  // déjà `inline; filename=…` pour que la visionneuse affiche le document. Un `|| "attachment"`
  // passait donc à côté — le type devenait générique mais le fichier s'ouvrait quand même.
  it.each(EXECUTABLES)("%s est servi inerte, jamais tel quel", async (type) => {
    const res = await servir(type, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    expect(res.statusCode, type).toBe(200);
    expect(res.headers["content-type"], type).toBe("application/octet-stream");
    expect(res.headers["content-disposition"], type).toBe("attachment");
    expect(res.headers["content-disposition"], type).not.toMatch(/inline/);
  });

  // ⚠️ Sans `nosniff`, un `text/plain` contenant du HTML peut être requalifié par le navigateur :
  // la garde porterait alors sur un type qui n'est pas celui qui s'ouvre réellement.
  it("interdit au navigateur de requalifier le type", async () => {
    const res = await servir("text/plain");
    expect(res.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("le fichier reste récupérable — on le neutralise, on ne le refuse pas", async () => {
    const res = await servir("image/svg+xml", "<svg/>");
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("<svg/>");
    expect(res.headers["content-length"]).toBe(String(Buffer.byteLength("<svg/>")));
  });

  it.each(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/avif", "image/gif"])(
    "%s passe intact — les formats affichables ne changent pas",
    async (type) => {
      const res = await servir(type);
      expect(res.headers["content-type"], type).toBe(type);
      // `inline` est ce qui permet à la visionneuse de l'AFFICHER : la garde ne doit pas y toucher.
      expect(res.headers["content-disposition"], type).toMatch(/^inline/);
    },
  );
});
