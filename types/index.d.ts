// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
/**
 * `discovery-media-player` — le point d'entrée.
 *
 * Le player est un GESTIONNAIRE DE REQUÊTES, pas un cadriciel : vous le montez où vous voulez,
 * les chemins sont les vôtres. Tout ce qu'il emprunte arrive par `init(context)`.
 *
 *     const player = require("discovery-media-player");
 *     const { createStandaloneContext } = require("discovery-media-player/context/standalone");
 *     player.init(createStandaloneContext(process.env));
 *     app.use("/api/doc", (req, res) => player.handler(req, res));
 */

import type { ContextePlayer, RequeteEntrante, ReponseSortante } from "./context.js";

export type { ContextePlayer, RequeteEntrante, ReponseSortante };
export * from "./context.js";

/**
 * Injecte le contexte. À appeler UNE FOIS, avant la première requête.
 *
 * ⚠️ Le cœur garde ce contexte dans un état de module : deux instances chargées dans le même
 * processus partagent donc ce qu'on leur injecte. Une fabrique multi-instances est un chantier
 * ouvert ; jusque-là, une instance par processus.
 */
export function init(contexte: ContextePlayer): void;

/**
 * Sert une requête. Lit `req.query` quand la plateforme le fournit (serverless, Express) et
 * retombe sur `req.url` sinon — un `http.createServer` nu marche sans adaptateur.
 */
export function handler(requete: RequeteEntrante, reponse: ReponseSortante): Promise<void>;

/** Un script tiers épinglé : version exacte dans l'URL, empreinte SRI à côté. */
export interface Tiers { url: string; sri: string }

/**
 * ⚠️ EXPORTÉ POUR ÊTRE CONFRONTÉ, PAS POUR ÊTRE UTILISÉ. Le banc navigateur et la garde de forge
 * partent de cet inventaire pour vérifier qu'aucune URL de script du gabarit ne lui échappe.
 * Un hôte n'a rien à en faire — s'il en dépend, c'est le signe d'un manque ailleurs.
 */
export const TIERS: Record<string, Tiers>;
