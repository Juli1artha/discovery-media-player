// Point d'entrée du code navigateur du player.
//
// esbuild regroupe ce fichier en un IIFE exposé sous `window.Player` (cf. player/build/bundle.mjs).
// La visionneuse — encore écrite en template literal dans api/doc.js — appelle donc
// `Player.bridge.…` et `Player.tracking.…`. Chaque brique reste un espace de noms distinct :
// c'est ce qui permet de les extraire une par une sans renommer les précédentes.

export * as bridge from "./bridge";
export * as tracking from "./tracking";
export * as live from "./live";
export * as chat from "./chat";
export * as presentation from "./presentation-content";
export * as viewer from "./viewer";
export * as presentationState from "./presentation-state";
