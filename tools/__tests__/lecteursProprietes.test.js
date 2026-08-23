// LES PROPRIÉTÉS DES LECTEURS — SUR DES ENTRÉES QUE PERSONNE N'A ÉCRITES À LA MAIN.
//
// ⚠️ POURQUOI ICI ET PAS AILLEURS. Ce dépôt a vu TROIS lecteurs échouer, et les trois fois de la
// même façon : sur une forme parfaitement valide que leur auteur n'avait pas imaginée.
//
//   1. Le `grep` des actions ratait `uses: "action@v4"` — la valeur entre guillemets, c'est-à-dire
//      la forme la plus courante.
//   2. Le lexer écrit pour le remplacer ratait la clé citée `- "uses":` et le mapping en flow
//      `- { uses: … }`, et prenait un `run: |2-` pour une action.
//   3. La lecture ligne-à-ligne du Dockerfile ratait `FROM --platform=… node:24`, la syntaxe
//      OFFICIELLE, puis `COPY --from=`, puis `RUN --mount=…,from=`.
//
// À chaque fois, un banc écrit à la main l'a laissée passer — parce qu'un banc écrit à la main
// contient les formes auxquelles son auteur a pensé, et le défaut vit dans les autres. C'est
// exactement le vide qu'un test de propriété comble : on ne choisit plus les exemples, on énonce
// l'invariant et on laisse la machine chercher le contre-exemple.
//
// ⚠️ CE N'EST PAS UN TEST DE ROBUSTESSE. On ne jette pas des octets au hasard pour voir si ça
// casse. Chaque propriété ci-dessous dit une chose vraie du DOMAINE : « la forme d'écriture ne
// change pas ce qui est exécuté », « une image sans condensat est refusée quelle que soit la porte
// par laquelle elle entre ». Ce sont les phrases que les trois lecteurs ont violées.

import fc from "fast-check";
import { describe, it, expect } from "vitest";
import { usesDe } from "../workflows-yaml.mjs";
import { ecartsEpinglage, imagesDe } from "../images-epinglees.mjs";
import { analyser } from "../env-lues.mjs";

const CONDENSAT = "sha256:" + "a".repeat(64);

// Des références d'action plausibles, sans caractère qui changerait le sens du YAML environnant :
// on fait varier la FORME d'écriture, pas le contenu.
const segment = fc.stringMatching(/^[a-z][a-z0-9-]{0,11}$/);
const reference = fc.tuple(segment, segment, fc.stringMatching(/^v[0-9]{1,2}(\.[0-9]{1,2}){0,2}$/))
  .map(([o, d, v]) => `${o}/${d}@${v}`);

describe("⚠️ LA FORME D'ÉCRITURE NE CHANGE PAS CE QUI EST EXÉCUTÉ", () => {
  // Le grep ratait la forme 2, le lexer les formes 4 et 5. Les huit désignent la MÊME étape.
  const FORMES = [
    (r) => `      - uses: ${r}`,
    (r) => `      - uses: "${r}"`,
    (r) => `      - uses: '${r}'`,
    (r) => `      - "uses": ${r}`,
    (r) => `      - { uses: ${r} }`,
    (r) => `      - uses:  ${r}`,
    (r) => `      - uses: ${r} # v1`,
    (r) => `      - name: une étape\n        uses: ${r}`,
  ];

  it("les huit écritures d'une même étape rendent la même action", () => {
    fc.assert(fc.property(reference, fc.nat(FORMES.length - 1), (ref, i) => {
      const txt = `jobs:\n  a:\n    steps:\n${FORMES[i](ref)}\n`;
      expect(usesDe(txt, "w.yml").map((u) => u.reference), `forme ${i}`).toEqual([ref]);
    }), { numRuns: 300 });
  });

  it("⚠️ et une SUITE d'étapes rend exactement la suite, quelles que soient leurs formes", () => {
    // Le cas qui compte vraiment : un fichier réel mélange les écritures. Un lecteur peut voir
    // chaque forme isolément et perdre le fil quand elles se suivent.
    fc.assert(fc.property(
      fc.array(fc.tuple(reference, fc.nat(FORMES.length - 1)), { minLength: 1, maxLength: 6 }),
      (etapes) => {
        const txt = `jobs:\n  a:\n    steps:\n${etapes.map(([r, i]) => FORMES[i](r)).join("\n")}\n`;
        expect(usesDe(txt, "w.yml").map((u) => u.reference)).toEqual(etapes.map(([r]) => r));
      },
    ), { numRuns: 200 });
  });
});

describe("⚠️ LE CONTENU D'UN `run:` N'EST JAMAIS UNE ACTION", () => {
  // Le lexer reconnaissait `|-2` et pas `|2-` — les deux sont valides — et lisait donc un SCRIPT
  // comme du YAML. Ici on énumère les indicateurs plutôt que d'en choisir trois.
  const INDICATEURS = ["|", "|-", "|+", ">", ">-", ">+", "|2", "|3", "|-2", "|2-", ">2-", ">-2"];

  // ⚠️ LE PREMIER CONTRE-EXEMPLE TROUVÉ PAR CE BANC ÉTAIT LE BANC LUI-MÊME, et c'est instructif.
  //
  // Un indicateur numéroté (`|2`) compte l'indentation du bloc depuis le NŒUD PARENT, pas depuis
  // le début de ligne. Ma première fixture posait le contenu à la même colonne pour tous les
  // indicateurs : valide pour `|`, hors du bloc pour `|2`. Le lecteur a REFUSÉ en nommant la
  // ligne — « YAML illisible » — au lieu de deviner. C'est exactement ce qu'on lui demande, et
  // c'est ce que les deux lecteurs précédents ne faisaient pas : ils lisaient quand même, et
  // rendaient une action là où il y avait un script.
  const indentationDuBloc = (indicateur, colonneDeLaCle) => {
    const n = /(\d)/.exec(indicateur);
    return colonneDeLaCle + (n ? Number(n[1]) : 2);
  };

  it("aucun indicateur de bloc ne laisse fuir une action", () => {
    fc.assert(fc.property(
      fc.constantFrom(...INDICATEURS),
      reference,
      (indicateur, ref) => {
        const marge = " ".repeat(indentationDuBloc(indicateur, 8));
        const txt = `jobs:\n  a:\n    steps:\n      - run: ${indicateur}\n${marge}uses: ${ref}\n${marge}echo ok\n`;
        expect(usesDe(txt, "w.yml"), indicateur).toEqual([]);
      },
    ), { numRuns: 300 });
  });

  it("un `uses` en position de valeur ou de commentaire n'en est pas un non plus", () => {
    fc.assert(fc.property(reference, (ref) => {
      const txt = `jobs:\n  a:\n    steps:\n      # uses: ${ref}\n      - name: uses\n        run: echo uses ${ref}\n`;
      expect(usesDe(txt, "w.yml")).toEqual([]);
    }), { numRuns: 200 });
  });
});

describe("⚠️ UNE IMAGE SANS CONDENSAT EST REFUSÉE, QUELLE QUE SOIT LA PORTE", () => {
  // Trois portes, découvertes une par une et chaque fois après coup : `FROM`, puis `COPY --from`,
  // puis `RUN --mount=…,from=`. La propriété les couvre ensemble, y compris celles qu'on
  // ajouterait demain à la liste des placements.
  const image = fc.tuple(segment, fc.stringMatching(/^[0-9]{1,2}(\.[0-9]{1,2})?$/))
    .map(([nom, tag]) => `${nom}:${tag}`);

  const PLACEMENTS = [
    (i) => `FROM ${i}`,
    (i) => `FROM --platform=$BUILDPLATFORM ${i}`,
    (i) => `FROM \\\n  ${i}`,
    (i) => `FROM node:24@${CONDENSAT} AS b\nCOPY --from=${i} /a /a`,
    (i) => `FROM node:24@${CONDENSAT} AS b\nRUN --mount=type=bind,from=${i},target=/s true`,
    (i) => `FROM node:24@${CONDENSAT} AS b\nRUN --mount=from=${i},target=/s true`,
  ];

  it("non épinglée ⇒ exactement un écart, à chaque placement", () => {
    fc.assert(fc.property(image, fc.nat(PLACEMENTS.length - 1), (img, i) => {
      expect(ecartsEpinglage(PLACEMENTS[i](img) + "\n"), `placement ${i}`).toHaveLength(1);
    }), { numRuns: 300 });
  });

  it("⚠️ épinglée ⇒ zéro écart, aux mêmes placements", () => {
    // La contrepartie, sans laquelle une garde qui refuse tout satisferait la première propriété.
    fc.assert(fc.property(image, fc.nat(PLACEMENTS.length - 1), (img, i) => {
      expect(ecartsEpinglage(PLACEMENTS[i](`${img}@${CONDENSAT}`) + "\n"), `placement ${i}`).toEqual([]);
    }), { numRuns: 300 });
  });

  it("une étape interne n'est jamais prise pour une image du registre", () => {
    fc.assert(fc.property(segment, (alias) => {
      const txt = `FROM node:24@${CONDENSAT} AS ${alias}\nCOPY --from=${alias} /a /a\nRUN --mount=from=${alias},target=/s true\n`;
      expect(ecartsEpinglage(txt)).toEqual([]);
      expect(imagesDe(txt).filter((x) => !x.interne).map((x) => x.reference)).toEqual([`node:24@${CONDENSAT}`]);
    }), { numRuns: 200 });
  });
});

describe("⚠️ LA MISE EN FORME D'UN SOURCE NE CHANGE PAS LES VARIABLES QU'IL LIT", () => {
  // Le premier lecteur d'environnement était une expression régulière, et il a été remplacé par un
  // AST pour cette raison exacte : un commentaire, un espace ou un point-virgule ne changent rien à
  // ce que le code LIT, et changeaient tout à ce que le motif VOYAIT.
  //
  // ⚠️ ET ON N'ÉCRIT PAS ICI « il ne lève jamais ». `analyser` REFUSE délibérément un fichier que
  // le parseur ne comprend pas — « on refuse plutôt que de deviner », et `resultat-garde.mjs` en
  // fait un code 2. Exiger qu'il avale n'importe quoi demanderait d'affaiblir ce refus : la
  // propriété juste porte sur du JavaScript VALIDE.
  const nomDeVariable = fc.stringMatching(/^[A-Z][A-Z0-9_]{2,15}$/);

  const HABILLAGES = [
    (n) => `const a = process.env.${n};`,
    (n) => `const a = process.env.${n}`,
    (n) => `  const   a   =   process.env.${n} ;`,
    (n) => `// un commentaire\nconst a = process.env.${n};\n// un autre`,
    (n) => `/* bloc */ const a = process.env.${n}; /* fin */`,
    (n) => `const a = process.env["${n}"];`,
    (n) => `const a = process.env['${n}'];`,
    (n) => `function f() {\n  return process.env.${n};\n}`,
  ];

  it("les huit habillages rendent la même variable", () => {
    fc.assert(fc.property(nomDeVariable, fc.nat(HABILLAGES.length - 1), (nom, i) => {
      expect([...analyser(HABILLAGES[i](nom), "x.js").lues], `habillage ${i}`).toEqual([nom]);
    }), { numRuns: 300 });
  });

  it("⚠️ un nom que la garde ne peut pas LIRE est signalé, pas ignoré", () => {
    // `process.env[variable]` ne nomme rien de statique. Le passer sous silence laisserait une
    // variable non documentée invisible ; c'est le contraire du contrat de cette garde.
    // ⚠️ Le préfixe évite les mots réservés — DEUXIÈME contre-exemple trouvé dans ma fixture, pas
    // dans le lecteur : `process.env[if]` n'est pas du JavaScript, et `analyser` a refusé en le
    // disant. Deux fois de suite, le premier contre-exemple a désigné le banc, et deux fois le
    // lecteur a refusé au lieu de deviner. C'est la propriété que ce fichier défend, démontrée
    // en passant.
    fc.assert(fc.property(fc.stringMatching(/^[a-z][a-zA-Z0-9]{1,10}$/).map((v) => "cle" + v), (v) => {
      const { lues, interdits } = analyser(`const a = process.env[${v}];`, "x.js");
      expect(lues.size).toBe(0);
      expect(interdits.length).toBeGreaterThan(0);
    }), { numRuns: 200 });
  });
});
