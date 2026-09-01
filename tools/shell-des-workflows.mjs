// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// CHAQUE BLOC `run:` DES WORKFLOWS DOIT ÊTRE DU SHELL VALIDE.
//
// ⚠️ UN BLOC `run:` N'EST ANALYSÉ PAR PERSONNE AVANT DE S'EXÉCUTER. Le YAML est valide, l'action
// est épinglée, la CI de la PR est verte — et le script ne sera lu par bash qu'au moment où il
// tourne, c'est-à-dire, pour un workflow de sortie, APRÈS la publication npm.
//
// ⚠️ CE QUI EST ARRIVÉ (0.1.136). Une étape contenait `node -e '…'` entre guillemets simples, avec
// « d'attestation » à l'intérieur : l'apostrophe FERMAIT la chaîne, bash analysait le JavaScript
// restant et butait sur une parenthèse. Le job `attester` est mort là. npm publié, image publiée,
// AUCUNE Release, aucune attestation, aucun SBOM — et rien n'avait pu le voir avant, parce que ce
// bloc ne s'exécute que sur un tag.
//
// L'auteur avait écrit « nest » au lieu de « n'est » pour éviter ce piège à un endroit, et en avait
// laissé un autre. Une discipline qui demande de se rappeler ne tient pas ; `bash -n` ne se
// rappelle de rien.
//
// ⚠️ `bash -n` TOLÈRE LES EXPRESSIONS `${{ … }}` — mesuré avant d'écrire cette garde, sur les
// formes réellement utilisées ici (affectation, argument entre guillemets, test). Il analyse sans
// exécuter : aucun effet de bord, aucun besoin de secrets.
//
// ⚠️ ON NE LIT QUE LES BLOCS QUI SERONT LUS PAR bash. Un `shell:` explicite qui n'est pas bash
// (python, pwsh…) est SAUTÉ, et le compte des sautés est imprimé : une garde qui tait ce qu'elle
// n'a pas regardé affirme une couverture qu'elle n'a pas.
//
// Usage : node tools/shell-des-workflows.mjs

import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "yaml";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const DOSSIER = ".github/workflows";

/** Chaque bloc `run:` d'un workflow, avec de quoi le désigner. */
export function blocsDe(fichier, texte) {
  const w = parse(texte) || {};
  const blocs = [];
  for (const [job, def] of Object.entries(w.jobs || {})) {
    (def.steps || []).forEach((etape, i) => {
      if (typeof etape.run !== "string") return;
      const shell = etape.shell || def.defaults?.run?.shell || w.defaults?.run?.shell || "bash";
      blocs.push({ fichier, job, indice: i + 1, nom: etape.name || `étape ${i + 1}`, shell, run: etape.run });
    });
  }
  return blocs;
}

/**
 * Les blocs que bash refuse d'analyser, nommés `fichier › job › étape`.
 * `analyser` est injectable : le banc n'a pas besoin d'un vrai bash pour éprouver la règle.
 */
/**
 * Le shell d'un bloc est-il de ceux que `bash -n` sait juger ?
 *
 * ⚠️ UNE SEULE SONDE POUR LE JUGE ET POUR LE COMPTABLE. Cette question s'écrivait deux fois, à
 * deux lignes de distance — une fois pour décider ce qu'on analyse, une fois pour compter ce qu'on
 * saute — et deux exemplaires d'une règle ne tombent pas ensemble. Mesuré le 01/09 en aveuglant
 * chacune séparément :
 *
 *     le motif du JUGE aveuglé      « 112 bloc(s) analysés par bash, aucun refusé »   vert
 *     le motif du COMPTABLE aveuglé « 0 bloc(s) analysés par bash, aucun refusé »     vert
 *
 * La première phrase est celle que l'en-tête de `temoinNonVu` dit LITTÉRALEMENT FAUSSE — bash
 * n'avait rien analysé — et elle revenait par une autre porte que celle qu'on avait fermée. La
 * seconde annonce elle-même n'avoir rien vérifié, et sortait 0.
 */
export const estBash = (shell) => /^(bash|sh)\b/.test(String(shell || ""));

export function blocsFautifs(blocs, analyser = analyserAvecBash) {
  const soucis = [];
  for (const b of blocs) {
    if (!estBash(b.shell)) continue;
    const erreur = analyser(b.run, b.shell);
    if (erreur) soucis.push(`${b.fichier} › ${b.job} › ${b.nom} : ${erreur}`);
  }
  return soucis;
}

export const sautes = (blocs) => blocs.filter((b) => !estBash(b.shell));

/**
 * ⚠️ ET LE NOMBRE ANALYSÉ EST PLANCHÉRISÉ, PARCE QUE LE VERT LE PRONONCE. 112 blocs le 01/09, tous
 * en `bash`, aucun en `sh`. Quarante laisse la place à un dépôt qui allégerait ses workflows et
 * refuse le seul état qui compte ici : celui où la sonde a cessé de reconnaître le shell qu'elle
 * lit. Ce plancher ne prétend pas voir la perte d'un bloc ou deux — il voit l'effondrement.
 */
export const PLANCHER_BLOCS = 40;

/**
 * ⚠️ LE TÉMOIN — INJECTÉ, PARCE QUE L'ÉTAT SAIN DE CETTE RÈGLE EST ZÉRO BLOC REFUSÉ.
 *
 * Cette garde affirme une absence, et sa panne la plus probable produit la même absence : un
 * `bash -n` qui n'est plus lancé — binaire absent, exception avalée, chemin court-circuité — rend
 * zéro erreur, donc zéro faute, donc VERT. Le plancher qui existait comptait les blocs LUS.
 *
 * Mesuré le 31/08 en remplaçant l'appel à `execFileSync` par `return null` : l'outil imprimait
 * « 112 bloc(s) « run: » ANALYSÉS PAR BASH, aucun refusé » et sortait 0. La phrase était
 * littéralement fausse — bash n'avait rien analysé — et c'est celle que la forge affiche à
 * chaque course verte.
 *
 * ⚠️ ET LE TÉMOIN NE PEUT PAS ÊTRE DÉRIVÉ. Un témoin dérivé compterait « au moins un bloc que
 * bash refuse », c'est-à-dire exigerait du dépôt la chose même que la règle interdit : il
 * refuserait un dépôt sain. La forme correcte n'étant pas quelque chose que ce dépôt doit
 * CONTENIR, il faut la fabriquer — on tend à bash un script qu'on sait cassé, et on exige le refus.
 */
export function temoinNonVu(analyser = analyserAvecBash) {
  // `then` sans son `fi` : refusé par bash comme par sh, et par toute version des deux.
  const casse = "if [ -z ]; then\n";
  return analyser(casse, "bash")
    ? null
    : "bash n'a pas refusé un script qu'on sait cassé — il n'est pas lancé, ou son refus n'arrive plus jusqu'ici ; les blocs de ce dépôt n'ont donc été analysés par personne";
}

export function analyserAvecBash(script, shell) {
  const dir = mkdtempSync(join(tmpdir(), "shellwf-"));
  try {
    const f = join(dir, "bloc.sh");
    writeFileSync(f, script);
    try {
      execFileSync(/^sh\b/.test(shell) ? "sh" : "bash", ["-n", f], { stdio: ["ignore", "pipe", "pipe"] });
      return null;
    } catch (erreur) {
      const sortie = String(erreur.stderr || erreur.stdout || erreur.message);
      // On garde la ligne qui NOMME l'erreur, pas l'écho du script entier.
      return sortie.split("\n").find((l) => /syntax error|unexpected/i.test(l))?.replace(/^[^:]*:\s*/, "") || sortie.trim().split("\n")[0];
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

export const lireDossier = (dossier = DOSSIER) =>
  readdirSync(dossier).filter((f) => /\.ya?ml$/.test(f)).sort()
    .flatMap((f) => blocsDe(f, readFileSync(join(dossier, f), "utf8")));

if (estExecuteDirectement(import.meta.url)) {
  conclure(tenter(() => {
    const blocs = lireDossier();
    if (!blocs.length) throw new Error(`aucun bloc « run: » sous ${DOSSIER} — la sonde vise à côté`);
    // ⚠️ LE TÉMOIN AVANT LE JUGEMENT. Un analyseur muet rendrait zéro faute sur cent douze blocs,
    // et le message vert dirait « analysés par bash » sans que bash ait été appelé.
    const aveugle = temoinNonVu();
    if (aveugle) return inconclusif(aveugle);
    const soucis = blocsFautifs(blocs);
    if (soucis.length) return violation(soucis);
    const ignores = sautes(blocs);
    const analyses = blocs.length - ignores.length;
    if (analyses < PLANCHER_BLOCS) {
      return inconclusif(`${analyses} bloc(s) « run: » analysés par bash sur ${blocs.length} lus, moins que ${PLANCHER_BLOCS} — ce n'est pas que le dépôt a perdu ses scripts, c'est la sonde qui ne reconnaît plus le shell qu'ils déclarent`);
    }
    const mention = ignores.length ? ` — ${ignores.length} bloc(s) sauté(s), shell non bash : ${ignores.map((b) => b.shell).join(", ")}` : "";
    return conforme(`shell : ${analyses} bloc(s) « run: » analysés par bash, sonde confirmée par un témoin posé, aucun refusé${mention}`);
  }));
}
