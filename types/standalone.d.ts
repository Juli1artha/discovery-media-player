/**
 * `discovery-media-player/context/standalone` — un contexte complet, construit depuis
 * l'environnement.
 *
 * C'est le chemin le plus court vers une instance qui marche : un dossier de documents, et rien
 * d'autre. Chaque réglage est une variable d'environnement, décrite dans `docs/CONFIGURATION.md`
 * — il n'y a pas de fichier de configuration, exprès : une instance est décrite entièrement par
 * son environnement.
 */

import type { ContextePlayer, BaseDeDonnees, Limites } from "./context.js";

/**
 * Construit le contexte. `env` vaut `process.env` par défaut ; le passer explicitement permet
 * de servir deux marques depuis un même processus, ou d'éprouver une configuration sans la poser.
 *
 * ⚠️ Ce qui n'est pas configuré est FERMÉ, pas deviné : sans base, les liens tracés n'existent
 * pas ; sans `PLAYER_PUBLIC_URL`, aucun courriel ne part. Un refus nommé vaut mieux qu'un repli
 * silencieux.
 */
export function createStandaloneContext(env?: Record<string, string | undefined>): ContextePlayer;

/**
 * Le limiteur de débit du contexte autonome, exposé pour qui compose son propre contexte.
 *
 * ⚠️ Fail-open, délibérément : un limiteur en panne ne doit pas empêcher un lecteur d'ouvrir son
 * document. Il protège d'un abus, il ne garde pas une porte.
 */
export function creerLimites(db: BaseDeDonnees, journal: { capture(erreur: unknown, meta?: Record<string, unknown>): unknown }): Limites;
