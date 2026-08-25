// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN CONSOMMATEUR TYPESCRIPT, COMPILÉ CONTRE LE TARBALL.
//
// ⚠️ CE FICHIER N'EST PAS UN TEST DE PLUS : c'est la seule preuve que les types VOYAGENT. Un
// `.d.ts` peut être parfait dans le clone et absent du paquet publié — il suffit que `files`
// ne l'embarque pas, et c'est exactement ce qui était arrivé au contrat et à la rétention.
// La CI l'installe depuis `npm pack` dans un projet vide, puis le compile en mode STRICT :
// ce qui échoue ici échoue chez l'intégrateur, avant lui.
//
// Il n'est pas publié (le champ `files` ne contient pas `tools/`), et il n'appelle rien : la
// compilation suffit à répondre à la question posée. Exécuter demanderait une base, un stockage
// et un réseau — trois choses que ce banc n'a pas à connaître pour vérifier des types.

import player, { init, handler, TIERS } from "discovery-media-player";
import type { ContextePlayer, RequeteEntrante, ReponseSortante } from "discovery-media-player";
import { createStandaloneContext } from "discovery-media-player/context/standalone";

// 1. Le chemin le plus court : l'environnement décrit l'instance, rien d'autre.
//    ⚠️ On passe un objet explicite plutôt que `process.env` : ce banc compile SANS `@types/node`,
//    et c'est délibéré — il prouve du même coup que lire ces types n'oblige personne à installer
//    les types de Node. Un `.d.ts` qui traîne une dépendance derrière lui est une taxe déguisée.
const contexte: ContextePlayer = createStandaloneContext({ PLAYER_LOCAL_ROOT: "./documents" });
init(contexte);

// 2. Le montage : un gestionnaire (req, res), rien à adapter.
export async function monter(req: RequeteEntrante, res: ReponseSortante): Promise<void> {
  await handler(req, res);
  await player.handler(req, res);
}

// 3. Un contexte écrit à la main : c'est CE type que l'hôte doit satisfaire, et le compilateur
//    doit le lui dire champ par champ plutôt que de tout accepter.
export const contexteMinimal: ContextePlayer = {
  storage: {
    isAllowedUrl: (url: string) => url.startsWith("https://exemple.test/"),
    fetchFile: async () => null,
    put: async () => false,
  },
  db: { request: async () => null, selectAll: async () => [] },
  identity: {
    verifyToken: async () => null,
    roleOf: () => null,
    isAdmin: () => false,
    // Le player vérifie le jeton ; l'hôte décide des droits — et reçoit l'action pour distinguer
    // l'envoi ordinaire de l'administration.
    canManageShares: (_utilisateur: unknown, action: string) => action === "create",
  },
  branding: {
    name: "Exemple",
    poweredBy: "",
    loaderName: "Exemple",
    logo: () => "",
    forKey: async () => null,
    title: (base: string) => base,
  },
  limits: { allow: async () => true },
  legal: { sourceUrl: "https://exemple.test/src", legalUrl: "", privacyUrl: "", trackingNotice: "" },
  config: { supabaseUrl: "", supabasePublishableKey: "", mapsKey: "", extraFrameAncestors: [] },
  errors: { capture: () => undefined },
  mail: { send: async () => null },
  plugins: {},
  has: () => false,
};

// 4. L'inventaire des tiers se LIT (il est exporté pour être confronté).
export const empreintes: string[] = Object.values(TIERS).map((t) => t.sri);
