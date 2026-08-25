// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE GARDE A DEUX COUVERTURES : EN SURFACE, ET EN OCCASIONS.
//
// ⚠️ LA SECONDE NE SE VOIT NULLE PART, et c'est le second hôte qui l'a nommée. Nous avions passé la
// semaine sur « cette garde regarde-t-elle encore quelque chose ? » — les planchers, les jeux
// d'essai, les mutations. Il manquait l'autre axe : « se déclenche-t-elle assez souvent ? ».
//
// Rien ne distingue un essai qui tourne à chaque commit d'un essai qui tourne une fois par semaine,
// sinon d'aller lire DANS QUEL DOSSIER il est rangé. Un essai correct, couvrant, vert, mais rangé
// derrière une ressource dont il n'a pas besoin, perd ses occasions en silence — il ne rougit
// jamais pour dire qu'il aurait pu tourner mille fois de plus.
//
// ⚠️ LE CAS RÉEL. `server/__tests__/jetonEntreProcessus.test.js` était d'abord écrit dans `base/`,
// avec le banc multi-processus. Il n'a besoin d'AUCUNE base — c'est une propriété du secret de
// signature, éprouvable sur n'importe quel poste en 200 ms. Rangé là, il n'aurait tourné qu'à une
// étape de forge qui monte un Postgres. Déplacé, il tourne à chaque `npm test`.
//
// ⚠️ CHAQUE DOSSIER A UNE PROPRIÉTÉ QUI JUSTIFIE SA COMMANDE SÉPARÉE, ET ELLE DOIT S'OBSERVER.
// C'est la forme générale, nommée par le second hôte quand j'ai dit vouloir « attendre un cas » pour
// `charge/` : la règle n'attend pas un cas, elle attend une PROPRIÉTÉ OBSERVABLE. « Doit simuler de
// la concurrence » ne se vérifie pas depuis le texte ; « ne chronomètre jamais » si.
//
//   base/    → interroge une base          (sans quoi il n'a rien à faire derrière un Postgres)
//   charge/  → ne mesure jamais le temps   (sans quoi il cesse d'être déterministe)
//
// ⚠️ ET LA VÉRIFICATION PORTE SUR LE BESOIN, PAS SUR L'INTENTION. On ne lit pas un commentaire qui
// annonce « ce banc a besoin d'une base » : on vérifie qu'il en TOUCHE une. Un fichier de `base/`
// qui ne parle jamais à la base est rangé trop haut, quoi qu'il dise de lui-même.

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");

/** Le source sans ses lignes de commentaire — une sonde qui lit du commentaire invente des faits. */
const sourceUtile = (texte) => texte.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

// ⚠️ CE MOTIF A ÉTÉ ÉCRIT DEUX FOIS, ET LE PREMIER ACCUSAIT UN FICHIER CORRECT. Il exigeait
// `<qqch>.db.request(`, alors que tous les bancs d'ici rangent le handle dans une variable et
// appellent `base.request(`. `sondeDurcissement` s'est retrouvé accusé de ne pas parler à la base
// qu'il interroge à chaque essai. Une garde grossière n'a pas de faux positif à excuser : elle a un
// coût de nommage, et il se paie dans le motif — qu'on écrit alors depuis le CODE, en énumérant les
// formes réellement employées, jamais de mémoire.
//
// Les deux signaux, mesurés sur les huit bancs : tous ont `.request(` ET `.db` ; l'essai des jetons
// qui était mal rangé n'avait NI l'un NI l'autre. La séparation est nette, donc l'un ou l'autre
// suffit — et exiger les deux fragiliserait la garde au premier banc qui n'en emploie qu'un.
const TOUCHE_LA_BASE = /\.request\(|\.db\b/;

/** Le garde-fou qui empêche un banc de `base/` de tourner sans sa ressource. */
const EXIGE_LA_RESSOURCE = /PLAYER_TEST_POSTGREST_URL/;

const bancsDeBase = () => fs.readdirSync(path.join(RACINE, "base"))
  .filter((f) => f.endsWith(".test.js"))
  .map((f) => ({ nom: f, texte: fs.readFileSync(path.join(RACINE, "base", f), "utf8") }));

describe("un banc rangé derrière une ressource doit en avoir besoin", () => {
  it("la sonde trouve bien des bancs à examiner", () => {
    // ⚠️ Le plancher de ce fichier : `base/` renommé rendrait cette garde verte en n'examinant rien.
    expect(bancsDeBase().length, "aucun banc relevé dans base/ : cette garde vise à côté")
      .toBeGreaterThanOrEqual(4);
  });

  it("chaque banc de base/ TOUCHE une base — sinon il perd ses occasions pour rien", () => {
    const malRanges = bancsDeBase()
      .filter((b) => !TOUCHE_LA_BASE.test(sourceUtile(b.texte)))
      .map((b) => `base/${b.nom} ne parle jamais à la base : il ne tournera qu'à l'étape de forge qui monte un Postgres, `
        + "alors qu'il pourrait tourner à chaque npm test. Descendez-le dans server/__tests__ ou tools/__tests__.");
    expect(malRanges, "un banc est rangé plus haut que son besoin — sa couverture en OCCASIONS est perdue en silence")
      .toEqual([]);
  });

  it("et chaque banc de base/ refuse de tourner sans sa ressource", () => {
    // Le pendant : rangé au bon endroit, il doit quand même s'esquiver proprement hors de la forge —
    // sinon `npm run test:base` casserait sur un poste nu au lieu de se taire.
    const sansGarde = bancsDeBase()
      .filter((b) => !EXIGE_LA_RESSOURCE.test(b.texte))
      .map((b) => `base/${b.nom} ne mentionne pas PLAYER_TEST_POSTGREST_URL : il ne peut ni s'esquiver ni refuser`);
    expect(sansGarde, "un banc de base/ sans garde-fou de ressource").toEqual([]);
  });
});

// ⚠️ LA PROPRIÉTÉ DE `charge/` : IL COMPTE, IL NE CHRONOMÈTRE PAS — et son en-tête l'affirmait sans
// que rien ne le vérifie. C'est la raison d'être du banc : un percentile mesuré contre une machine
// mutualisée donne deux nombres pour le même geste, aucun seuil ne tient, et un seuil qui rougit au
// hasard finit desserré. Le jour où quelqu'un ajoute une assertion de durée ici, le banc perd le
// déterminisme qui fait sa valeur — et il le perdra en restant vert.
describe("le banc de coût compte, il ne chronomètre pas", () => {
  const HORLOGES = /Date\.now|performance\.now|process\.hrtime|process\.uptime/;
  const bancsDeCharge = () => fs.readdirSync(path.join(RACINE, "charge"))
    .filter((f) => f.endsWith(".test.js"))
    .map((f) => ({ nom: f, texte: fs.readFileSync(path.join(RACINE, "charge", f), "utf8") }));

  // ⚠️ CONTRÔLE POSITIF DE LA SONDE, ET IL EST OBLIGATOIRE ICI. Cette garde affirme une ABSENCE :
  // sa panne la plus probable — une expression régulière qui ne correspond à rien — produit elle
  // aussi une absence, donc un vert. Un détecteur d'absence est confondable avec sa propre panne
  // (règle du second hôte, apprise en croyant tenir une régression qui était mon harnais). On exige
  // donc que le motif trouve des horloges LÀ OÙ IL DOIT Y EN AVOIR avant de conclure qu'il n'y en a
  // pas ici.
  it("la sonde reconnaît bien une horloge — sinon son silence ne vaut rien", () => {
    const ailleurs = fs.readdirSync(path.join(RACINE, "base"))
      .filter((f) => f.endsWith(".test.js"))
      .filter((f) => HORLOGES.test(fs.readFileSync(path.join(RACINE, "base", f), "utf8")));
    expect(ailleurs.length, "le motif ne trouve aucune horloge dans base/, où il y en a : il vise à côté")
      .toBeGreaterThan(0);
  });

  it("aucun banc de charge/ ne mesure le temps", () => {
    const bancs = bancsDeCharge();
    expect(bancs.length, "aucun banc relevé dans charge/ : cette garde vise à côté").toBeGreaterThan(0);
    const chronometres = bancs
      .filter((b) => HORLOGES.test(sourceUtile(b.texte)))
      .map((b) => `charge/${b.nom} lit une horloge : ce banc tire sa valeur d'être DÉTERMINISTE. `
        + "Un nombre qu'on ne peut pas reproduire n'a rien à faire dans un test — la latence se mesure en supervision.");
    expect(chronometres, "le banc de coût s'est mis à chronométrer : il perdra son déterminisme en restant vert")
      .toEqual([]);
  });
});
