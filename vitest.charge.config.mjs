// BANC DE CHARGE — séparé, et pour une raison de MESURE, pas d'organisation.
//
// ⚠️ CE BANC COMPTE, IL NE CHRONOMÈTRE PAS. Un banc qui rendrait des percentiles contre une base
// mutualisée produirait du BRUIT : le même geste mesuré deux fois donnerait deux nombres, aucun seuil
// ne tiendrait, et un seuil qui rougit au hasard finit desserré — c'est la leçon la plus chère de ce
// dépôt. Ce qu'on peut mesurer de façon DÉTERMINISTE, en revanche, c'est le COÛT STRUCTUREL : combien
// d'allers-retours base coûte un battement, un changement de page, une resynchronisation de chat.
//
// C'est aussi exactement ce qu'un audit externe demandait avant toute fusion d'appels — « ou au
// minimum mesurer avant de fusionner ». On ne fusionne pas ce qu'on n'a pas compté.
//
// La latence réelle se mesure ailleurs (supervision de production, pas banc de forge) : un chiffre
// qu'on ne peut pas reproduire n'a rien à faire dans un test.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["charge/**/*.test.js"],
    // Un seul processus : les essais partagent un compteur et, quand elle existe, une base.
    fileParallelism: false,
    // ⚠️ LA SORTIE EST LE PRODUIT DE CE BANC. Vitest intercepte la console et n'affiche pas ce qu'un
    // crochet de fin écrit : le relevé de coût — la seule chose qu'on vient chercher ici — restait
    // invisible, et le banc se réduisait à « ça ne rougit pas ». Un banc de mesure qui ne montre pas
    // sa mesure ne mesure rien pour son lecteur.
    disableConsoleIntercept: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
