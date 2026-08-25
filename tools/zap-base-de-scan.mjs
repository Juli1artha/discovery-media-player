// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA BASE D'ESSAI DU SCAN ZAP — les routes authentifiées, servies pour de vrai.
//
// Le scan baseline (zap.yml) n'éprouvait que le mode dossier : la visionneuse tracée
// (`/doc/:slug`) et la présentation (`/present/:slug`) exigent une base, répondaient 404, et
// leurs politiques de sécurité — chacune la sienne — n'étaient donc regardées par personne.
// C'est le même trou que le banc navigateur avait comblé pour les essais (constat P2-3), et la
// même doublure le comble ici : `tools/postgrest-en-memoire.cjs`, qui refuse plutôt qu'inventer.
//
// Ce script sème UN lien tracé et UNE présentation, et écoute. Rien de plus : la graine vit ici,
// versionnée et relue, plutôt qu'inline dans un `run:` de workflow où aucun linter ne la voit.
//
//   node tools/zap-base-de-scan.mjs <port> <url-file-du-document>
//   → base de scan : port 54321, /doc/zap-doc et /present/zap-direct
//
// ⚠️ L'URL DU DOCUMENT EST UN PARAMÈTRE, PAS UNE CONSTANTE. Le player tourne dans l'image Docker
// où le document vit sous `/data/…` ; ce script tourne sur l'hôte où le même fichier a un autre
// chemin. Seul l'appelant sait lequel des deux mondes le player verra — c'est donc lui qui nomme
// l'URL, et le workflow passe `file:///data/sample.pdf`.

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { creerPostgrestEnMemoire } = require("./postgrest-en-memoire.cjs");

export const SLUG_DOC = "zap-doc";
export const SLUG_PRESENT = "zap-direct";

export function graineDeScan(urlFichier) {
  const nom = path.basename(new URL(urlFichier).pathname);
  return {
    commercial_doc_shares: [{
      id: 1, slug: SLUG_DOC, doc_id: "doc-zap", revoked: false, require_auth: false,
      file_url: urlFichier, file_name: nom, doc_title: "Document du scan",
      allow_download: false, created_by: "scan@exemple.fr", recipient_email: "scan@exemple.fr",
      created_at: "2026-08-24T00:00:00Z",
    }],
    doc_presentations: [{
      id: 1, slug: SLUG_PRESENT, doc_id: "doc-zap", active: true, current_page: 1, write_seq: 0,
      file_url: urlFichier, file_name: nom, doc_title: "Document du scan",
      presenter_name: "Scan", owner_email: "scan@exemple.fr",
      last_seen: new Date(0).toISOString(),
      created_at: "2026-08-24T00:00:00Z", updated_at: "2026-08-24T00:00:00Z",
    }],
    // ⚠️ Déclarées vides, comme au banc navigateur : la doublure répond « relation inexistante »
    // sur une table absente, donc ce que le player ÉCRIT pendant le scan doit figurer ici.
    commercial_doc_views: [],
    commercial_doc_sessions: [],
    doc_presentation_attendees: [],
    doc_presentation_messages: [],
  };
}

import { estExecuteDirectement } from "./execute-directement.mjs";

if (estExecuteDirectement(import.meta.url)) {
  const [port, urlFichier] = process.argv.slice(2);
  if (!port || !urlFichier) {
    console.error("usage : node tools/zap-base-de-scan.mjs <port> <url-file-du-document>");
    process.exit(2);
  }
  const { serveur } = creerPostgrestEnMemoire(graineDeScan(urlFichier));
  serveur.listen(Number(port), "127.0.0.1", () => {
    console.log(`base de scan : port ${port}, /doc/${SLUG_DOC} et /present/${SLUG_PRESENT}`);
  });
}
