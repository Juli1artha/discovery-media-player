#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA SECTION DU CHANGELOG D'UNE VERSION — UN SEUL EXTRACTEUR, DEUX APPELANTS.
//
// ⚠️ CE QUI EST ARRIVÉ (15/09, SORTIE 0.1.169). Les notes voyageaient de `verifier` à `annoncer`
// par une SORTIE DE JOB. La forge les a supprimées en chemin :
//
//     ##[warning]Skip output 'notes' since it may contain secret.
//
// Le runner confronte chaque sortie de job aux valeurs masquées, et jette la sortie ENTIÈRE au
// moindre soupçon. La section 0.1.169 décrivait le correctif de caviardage des messages d'échec et
// citait, pour l'illustrer, une chaîne en forme de clé d'API. Un texte qui PARLE d'un secret a donc
// été traité COMME un secret. La Release publique est partie avec son tarball, ses preuves et sa
// mesure — et sans une ligne de ses notes.
//
// ⚠️ ET LES CINQ JOBS ÉTAIENT VERTS. La garde d'alors — `test -s /tmp/notes.md || exit 1` — tenait
// le côté PRODUCTEUR : la section avait bien été extraite. Rien ne tenait le côté CONSOMMATEUR,
// c'est-à-dire la seule question qui compte : les notes sont-elles ARRIVÉES dans le corps ? C'est le
// défaut du 22/08 dans une autre matière — une promesse tenue à moitié, sans un mot.
//
// Le correctif est de forme, pas de vigilance : les notes descendent désormais dans le PAQUET,
// comme `zones.md`, où aucun masqueur ne les voit et où une garde `-s` les attend. Et parce que
// deux jobs en ont besoin — `verifier` pour refuser la sortie AVANT la publication npm, `attester`
// pour les déposer dans le paquet — l'extraction vit ICI plutôt qu'en double dans le YAML : « un
// fait qui existe en deux exemplaires non confrontés dérive ».
//
// Usage : node tools/notes-de-version.mjs --version=0.1.169 [--sortie=fichier] [--changelog=…]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = process.cwd();

/**
 * La section d'une version, sans son titre : tout ce qui suit `## [x.y.z]` jusqu'au `## [` suivant.
 *
 * ⚠️ LE TITRE EST EXCLU ET LA SUITE S'ARRÊTE AU SUIVANT. Une section qui emporterait la version
 * d'après publierait les notes de deux sorties sous le nom d'une seule — et personne ne le verrait,
 * puisque le texte serait plausible.
 */
export function sectionDe(changelog, version) {
  const lignes = String(changelog).split("\n");
  const debut = lignes.findIndex((l) => l.startsWith(`## [${version}]`));
  if (debut < 0) return "";
  const reste = lignes.slice(debut + 1);
  const fin = reste.findIndex((l) => l.startsWith("## ["));
  return (fin < 0 ? reste : reste.slice(0, fin)).join("\n").replace(/^\n+|\n+$/g, "");
}

export function auditerNotes({ racine = RACINE, version, changelog, sortie } = {}) {
  if (!version) return inconclusif("aucune version demandée : il n'y a pas de section à extraire");
  return tenter(() => {
    const texte = changelog === undefined ? readFileSync(join(racine, "CHANGELOG.md"), "utf8") : changelog;
    const section = sectionDe(texte, version);
    // ⚠️ UNE SECTION VIDE EST UN REFUS, PAS UN VIDE. Publier sans notes, c'est publier sans dire ce
    // qui a changé : la sortie s'arrête ici plutôt que de partir muette, comme la 0.1.169 l'a fait.
    if (!section) return violation(`aucune section « ## [${version}] » dans le CHANGELOG, ou elle est vide — pas de notes, pas de sortie`);
    // ⚠️ LA SECTION NE PART JAMAIS SUR LA SORTIE STANDARD, elle va dans un FICHIER. `conclure` y
    // écrit déjà le résumé de la garde : les mélanger ferait entrer « section 0.1.169 : 120 lignes »
    // dans le corps de la Release, et personne ne le remarquerait avant de lire la page publiée.
    // Sans `--sortie`, cet outil ne fait que juger — c'est ainsi que `verifier` s'en sert.
    if (sortie) writeFileSync(sortie, `${section}\n`);
    return conforme(`section ${version} : ${section.split("\n").length} ligne(s), ${Buffer.byteLength(section)} octet(s)${sortie ? ` → ${sortie}` : " (jugée, non écrite)"}`);
  });
}

if (estExecuteDirectement(import.meta.url)) {
  const argv = process.argv.slice(2);
  const option = (nom) => { const a = argv.find((x) => x.startsWith(`--${nom}=`)); return a ? a.slice(nom.length + 3) : undefined; };
  conclure(auditerNotes({ version: option("version"), sortie: option("sortie") }), (code) => process.exit(code));
}
