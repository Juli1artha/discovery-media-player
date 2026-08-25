// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// Le point d'entrée. Il ne fait rien d'autre que brancher le player sur votre câblage — toute la
// logique est d'un côté, toutes vos décisions de l'autre.
//
// ⚠️ Une seule initialisation par processus, et TOUTE route qui touche au player doit passer par
// ce module. Un fichier voisin qui requerrait le player directement l'obtiendrait non initialisé :
// pas d'erreur au chargement, pas d'erreur aux tests, un plantage au premier partage — en
// production uniquement. C'est arrivé.
const player = require("discovery-media-player");
const contexte = require("../player-context");

player.init(contexte);

module.exports = player.handler;
