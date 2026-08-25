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
import { conclure, conforme, violation, tenter } from "./resultat-garde.mjs";
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
export function blocsFautifs(blocs, analyser = analyserAvecBash) {
  const soucis = [];
  for (const b of blocs) {
    if (!/^(bash|sh)\b/.test(b.shell)) continue;
    const erreur = analyser(b.run, b.shell);
    if (erreur) soucis.push(`${b.fichier} › ${b.job} › ${b.nom} : ${erreur}`);
  }
  return soucis;
}

export const sautes = (blocs) => blocs.filter((b) => !/^(bash|sh)\b/.test(b.shell));

function analyserAvecBash(script, shell) {
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
    const soucis = blocsFautifs(blocs);
    if (soucis.length) return violation(soucis);
    const ignores = sautes(blocs);
    const mention = ignores.length ? ` — ${ignores.length} bloc(s) sauté(s), shell non bash : ${ignores.map((b) => b.shell).join(", ")}` : "";
    return conforme(`shell : ${blocs.length - ignores.length} bloc(s) « run: » analysés par bash, aucun refusé${mention}`);
  }));
}
