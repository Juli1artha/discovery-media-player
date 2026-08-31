// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN ENVIRONNEMENT CASSÉ N'EST JAMAIS LA FAUTE DE LA BRANCHE — VÉRIFIÉ SUR TOUS LES OUTILS.
//
// ⚠️ CE QUE `planchersDesGardes` NE DEMANDE PAS. Ce banc-là monte un dépôt VIDE et demande « un
// outil qui ne trouve rien déclare-t-il victoire ? ». La question ici est l'autre moitié : l'arbre
// est GARNI, c'est L'ENVIRONNEMENT qui manque — ni `git`, ni `npm`, un PATH qui ne contient que
// node. La taxonomie de `resultat-garde` sépare exactement ces deux rouges : `2` dit « la garde
// n'a pas pu regarder, le correctif n'est pas dans ta branche », `1` dit « corrige ta branche ».
// Rendre 1 pour un binaire absent accuse quelqu'un d'une situation dont il n'est pas responsable,
// et ce dépôt sait ce que produit un rouge dont on constate qu'il n'est pas de son fait : la fois
// suivante, celle où la violation est réelle, le geste de l'ignorer est déjà appris.
//
// ⚠️ CE N'EST PAS THÉORIQUE, C'EST DÉJÀ ARRIVÉ ICI. Le 31/08, `images-epinglees` a vu son calcul de
// périmètre passer d'une constante à une LECTURE DU DISQUE, au-dessus de `tenter` : hors d'un dépôt
// git, l'outil mourait sur une trace de pile et sortait **1**. Ses quatre mutants et ses
// cinquante-trois bancs étaient verts ; seul `planchersDesGardes`, qui lance l'outil pour de vrai,
// l'a dit — et il ne pose pas cette question-là, il en pose une voisine. La propriété tenait donc
// par la vigilance, et la vigilance n'est pas une garde.
//
// ⚠️ ET CE QUE CE BANC N'A PAS PROUVÉ, DIT EN TÊTE PLUTÔT QU'OMIS. Je n'ai pas su construire un
// mutant qu'il tue et que `planchersDesGardes` laisse vivre — quatre essais, tous tués par les
// deux. La raison est nette et je l'avais manquée : un répertoire temporaire N'EST DÉJÀ PAS un
// dépôt git, donc l'arbre vide du banc voisin est LUI AUSSI un environnement dépouillé, et son
// assertion « ne rend jamais 0 » est plus forte que « ne rend jamais 1 ». La dette que ce fichier
// devait solder était donc en grande partie déjà payée.
//
// Ce qu'il ajoute est une CONFIGURATION, pas une prise démontrée : l'arbre est GARNI. Mesuré avec
// un mouchard à la place de git et de npm, trois outils — `licence-par-fichier`, `node-de-l-image`
// et `release-preflight` — n'atteignent leur appel externe QUE dans cet arbre-là ; dans l'arbre
// vide ils refusent avant. Un défaut logé dans leur traitement de l'environnement, et qui ne
// lèverait pas plus tôt, n'a aucun autre endroit où être vu. C'est une couverture énoncée pour ce
// qu'elle est : une place tenue, pas une prise.
//
// ⚠️ ET IL Y A UNE FRONTIÈRE QUE CE BANC NE PEUT PAS DÉPLACER, DONC IL LA NOMME. `tenter` rattrape
// ce qui se produit APRÈS l'import. Un paquet absent fait échouer l'import LUI-MÊME : mesuré le
// 31/08 avec `node_modules` retiré, **19 des 42 outils** sortent en 1 sur `ERR_MODULE_NOT_FOUND`,
// et aucun ne peut faire autrement — leur code n'a jamais tourné. La propriété correspondante est
// tenue AILLEURS, par `outils-servis`, qui refuse qu'un workflow lance un outil à dépendances dans
// un job sans installation. Ce banc éprouve donc ce qui est ATTEIGNABLE : les binaires externes,
// sollicités depuis l'INTÉRIEUR de `tenter`.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, readFileSync, readdirSync, symlinkSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { RACINE, arbre, lancer } from "./aide/arbre-outils.mjs";

/** Un PATH qui ne contient QUE node : ni `git`, ni `npm`, ni rien d'autre. */
function pathNu() {
  const d = mkdtempSync(join(tmpdir(), "path-nu-"));
  symlinkSync(process.execPath, join(d, "node"));
  return d;
}

// ⚠️ LES COMMENTAIRES PARTENT AVANT QU'ON LISE LE SOURCE. Première écriture de ce banc :
// `exemples-en-retard` était classé « soumis à la taxonomie » parce que son en-tête CITE
// `tools/resultat-garde.mjs` pour expliquer pourquoi il s'en écarte. Une sonde qui lit du
// commentaire invente un coupable — quatrième fois que ce dépôt le paie, et la première dans un
// banc écrit le jour même où il l'a payée ailleurs.
const sansCommentaires = (src) =>
  src.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

/**
 * ⚠️ AUCUNE LISTE D'EXEMPTION, ET C'EST DÉLIBÉRÉ. Un outil relève de la règle du code `2` s'il a
 * ADOPTÉ la taxonomie — il importe `resultat-garde` — et s'il a un point d'entrée. Les deux se
 * lisent dans son source, commentaires retirés. Une liste écrite cesserait de couvrir dès qu'un
 * outil s'ajoute ; ce prédicat attrape le nouveau venu tout seul.
 */
const soumisALaTaxonomie = (src) => {
  const nu = sansCommentaires(src);
  return /resultat-garde\.mjs/.test(nu) && /estExecuteDirectement\(import\.meta\.url\)/.test(nu);
};

// ⚠️ UN PLANCHER, PAS LE RELEVÉ DU JOUR. 34 outils rendent 2 le 31/08 dans cet environnement ;
// vingt est vrai de tout état sain, et le resterait si l'on en retirait un tiers.
const PLANCHER_AFFECTES = 20;

let plein;
let nu;
let sansOutils;
/** Les deux relevés, faits UNE fois : nom d'outil → { code, sortie }. */
const depouille = new Map();
const equipe = new Map();

beforeAll(() => {
  // ⚠️ L'ARBRE EST GARNI, LUI, ET C'EST TOUTE LA DIFFÉRENCE AVEC LE BANC VOISIN. Un arbre vide
  // ferait refuser les outils pour l'AUTRE raison — rien à lire — et ce banc serait vert sans
  // avoir éprouvé sa question une seule fois.
  plein = arbre((d) => {
    symlinkSync(join(RACINE, "package.json"), join(d, "package.json"));
    symlinkSync(join(RACINE, "CHANGELOG.md"), join(d, "CHANGELOG.md"));
  });
  nu = pathNu();
  sansOutils = { ...process.env, PATH: nu };
  // ⚠️ UNE SEULE MESURE POUR TOUT LE FICHIER. Le premier jet lançait chaque outil DEUX fois — une
  // pour le témoin, une pour son propre cas — et les deux relevés pouvaient différer sans que rien
  // ne le dise. Ils lisent maintenant le même.
  for (const nom of readdirSync(join(RACINE, "tools")).filter((f) => f.endsWith(".mjs"))) {
    const r = lancer(nom, plein, sansOutils);
    depouille.set(nom, r);
    // ⚠️ ON NE RELANCE ÉQUIPÉ QUE CE QUI EST SORTI VERT. La comparaison ne sert qu'à distinguer
    // « il rend 0 parce qu'il n'a besoin de rien » de « il rend 0 parce qu'il s'est replié » ;
    // pour tout ce qui a déjà refusé, la question ne se pose pas et la mesure serait du temps
    // dépensé à confirmer ce qu'on sait.
    if (r.code === 0) equipe.set(nom, lancer(nom, plein));
  }
}, 240000);

afterAll(() => {
  for (const d of [plein, nu]) { try { rmSync(d, { recursive: true, force: true }); } catch { /* rien */ } }
});

const outils = () => readdirSync(join(RACINE, "tools")).filter((f) => f.endsWith(".mjs"));
const source = (nom) => readFileSync(join(RACINE, "tools", nom), "utf8");

describe("sans git ni npm, aucun outil n'accuse la branche", () => {
  it("la sonde trouve bien des outils à éprouver", () => {
    // ⚠️ LE PLANCHER DE CE BANC LUI-MÊME : `tools/` renommé et il serait vert en n'éprouvant rien.
    expect(outils().length, "aucun outil relevé : ce banc vise à côté").toBeGreaterThanOrEqual(8);
  });

  // ⚠️ LE TÉMOIN DE L'ENVIRONNEMENT, ET IL EST LA CONDITION DE TOUT LE RESTE. Un `pathNu()` qui
  // laisserait fuir le PATH du système rendrait ce fichier ENTIÈREMENT VERT en n'éprouvant rien :
  // les outils trouveraient git, conclueraient normalement, et chaque assertion « ne rend jamais
  // 1 » passerait sans qu'aucun dépouillement n'ait eu lieu. C'est exactement « rien trouvé » qu'on
  // prendrait pour « rien regardé », dans le banc écrit pour cette distinction.
  it("⚠️ le PATH dépouillé l'est pour de bon — git et npm y sont introuvables", () => {
    for (const binaire of ["git", "npm", "npx", "sh"]) {
      expect(existsSync(join(nu, binaire)), `${binaire} ne doit pas exister dans le PATH dépouillé`).toBe(false);
    }
    expect(existsSync(join(nu, "node")), "node doit y être, sinon rien ne se lance").toBe(true);
  });

  it(`⚠️ le dépouillement CHANGE quelque chose — au moins ${PLANCHER_AFFECTES} outils refusent`, () => {
    const refusent = [...depouille].filter(([, r]) => r.code === 2);
    expect(refusent.length, "34 le 31/08 — si ce compte s'effondre, l'environnement n'est plus dépouillé, ou les outils ne sollicitent plus rien")
      .toBeGreaterThanOrEqual(PLANCHER_AFFECTES);
  });

  for (const nom of readdirSync(join(RACINE, "tools")).filter((f) => f.endsWith(".mjs"))) {
    it(`${nom} ne rend jamais 1 quand l'environnement manque`, () => {
      const { code, sortie } = depouille.get(nom);
      expect(code, `${nom} rend 1 sans git ni npm : il accuse une branche d'une panne d'environnement\n${sortie.slice(0, 400)}`).not.toBe(1);

      // ⚠️ UN 0 EST LÉGITIME ICI, ET LE PREMIER JET NE LE VOYAIT PAS. `changelog` n'a besoin ni de
      // git ni de npm : dans un arbre garni il LIT, il conclut, il rend 0 — à juste titre. Ce
      // qu'on exige n'est pas « refuse », c'est « si tu refuses, refuse avec le bon code ».
      if (code !== 0 && soumisALaTaxonomie(source(nom))) {
        expect(code, `${nom} a adopté la taxonomie : « non concluant » vaut 2, jamais ${code}\n${sortie.slice(0, 400)}`).toBe(2);
      }

      // ⚠️ ET LA PROPRIÉTÉ QUI PORTE VRAIMENT CE BANC : DÉPOUILLER NE DOIT JAMAIS FABRIQUER UN VERT.
      // Le premier jet ne l'affirmait pas, et c'est une mutation qui l'a montré : un outil qui
      // AVALE la panne de git et se replie sur un relevé bidon rend 0 — il ne rend pas 1, il ne
      // rend pas un mauvais code, il rend un SUCCÈS sur un environnement où il n'a rien pu voir.
      // « Ne rend jamais 1 » ne dit rien de ce cas-là ; il faut comparer aux deux environnements.
      if (code === 0) {
        expect(equipe.get(nom).code, `${nom} rend 0 SANS git ni npm, alors qu'avec eux il rend ${equipe.get(nom).code} : l'environnement absent lui a fabriqué un vert\n${sortie.slice(0, 400)}`).toBe(0);
      }
    });
  }
});
