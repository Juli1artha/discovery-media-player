// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE BOUCLE DE RÉESSAI A TROIS SORTIES, PAS DEUX : réussi, refusé, ET « J'AI RENONCÉ ».
//
// ⚠️ CE N'EST PAS UNE CRAINTE, C'EST UN INCIDENT DATÉ. Le 14/09, la publication de la 0.1.168 a
// laissé le paquet parti et la Release absente. Le test de fumée attendait que le registre serve la
// version fraîche — `for i in $(seq 1 20); do npm view … && break || sleep 6; done`, soit 120 s — et
// la version est devenue installable à 21:39:33, VINGT-CINQ SECONDES après l'abandon de la boucle.
// La boucle est alors sortie EXACTEMENT COMME SI ELLE AVAIT RÉUSSI, et l'installation qui suivait a
// échoué sans un mot (elle portait `--silent`). Résultat : cent vingt-cinq secondes de silence
// complet, une sortie en 1 sans cause nommée, et trois jobs sautés.
//
// ⚠️ LA FORME DU DÉFAUT, NOMMÉE PAR UN HÔTE (ADV, 14/09) : « ce n'est pas un défaut d'attente, c'est
// une garde qui échoue OUVERT : épuiser les tentatives est traité comme un succès ». Le remède n'est
// pas d'attendre plus longtemps — n'importe quelle durée finit par être trop courte un jour — c'est
// que la boucle DISE qu'elle a renoncé. Une durée trop courte coûte une course ; un abandon muet
// coûte une publication dont personne ne sait qu'elle est incomplète.
//
// ⚠️ ET LA RÈGLE ÉTAIT DÉJÀ APPLIQUÉE TRENTE LIGNES PLUS HAUT, dans le même fichier : la fonction
// `attendre()` de `release.yml` a ses trois sorties, dont « ne s'est jamais terminée sur $sha — on ne
// publie pas sans verdict ». Une règle appliquée à un endroit et manquée à l'autre n'est pas une
// règle, c'est une habitude. Celle-ci est désormais tenue par cette garde, pour la CLASSE : toute
// boucle de réessai d'un workflow, présente ou future.
//
// CE QU'ELLE EXIGE : la PREMIÈRE instruction après le `done` d'une boucle de réessai — une boucle
// `for`/`while` qui contient un `sleep` — doit être l'une de deux choses : un `::error::` qui nomme
// ce qui n'est jamais venu, ou le REJEU du test de la boucle, dont l'échec compte alors. Rien
// d'autre : une commande à effet de bord placée là consomme silencieusement un abandon.
//
// ⚠️ « LE BLOC CONTIENT UN `::error::` » NE SUFFIT PAS, ET C'EST LA PREMIÈRE VERSION DE CETTE SONDE.
// Le bloc fautif en portait deux — dans le script Node qu'il lance ensuite, à propos de tout autre
// chose. La sonde trouvait la chaîne et rendait vert sur le défaut même qui l'a fait écrire. Ce que
// l'aveu doit avoir, ce n'est pas d'exister quelque part : c'est d'être ce qui suit l'abandon.

import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { blocsDe, estBash } from "./shell-des-workflows.mjs";
import { workflows } from "./workflows-yaml.mjs";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Une boucle est une boucle de RÉESSAI si elle attend entre deux tours. */
const ATTEND = /\bsleep\b/;

const nu = (mot) => String(mot).replace(/^["']|["']$/g, "");

/**
 * Ce que la boucle ÉPROUVE : la commande qui suit son `do`, jusqu'au premier opérateur. Rend
 * `{ programme, cible }` — la cible étant le premier mot qui désigne quelque chose (une URL, un
 * chemin, un paquet), c'est-à-dire ce qui distingue ce test d'un autre test du même programme.
 */
export function testeDe(tete, corps) {
  const apresDo = `${tete}\n${corps}`.split(/(?:^|\s|;)do\b/).slice(1).join("do");
  // ⚠️ LE PREMIER SEGMENT NON VIDE, pas le premier segment : une boucle multi-lignes met un saut
  // juste après son `do`, et prendre le segment vide rendait « aucun programme testé » — donc aucun
  // rejeu reconnaissable, donc un constat sur une boucle correcte.
  const commande = (apresDo.split(/&&|\|\||;|\n/).map((x) => x.trim()).find(Boolean) || "");
  const mots = commande.split(/\s+/).filter(Boolean);
  const programme = mots[0] || "";
  const cible = mots.slice(1).find((m) => /^["']/.test(m) || /[/:@]/.test(m));
  return { programme, cible: cible ? nu(cible) : "" };
}

/**
 * La première instruction après le `done` : ni vide, ni commentaire.
 *
 * ⚠️ UNE INSTRUCTION N'EST PAS UNE LIGNE, et cette sonde l'a cru. Une première version prenait la
 * première ligne non vide ; or `cmd \` suivi de `|| { echo "::error::…"; exit 1; }` est UNE
 * instruction écrite sur deux lignes — la forme la plus courante ici, puisque c'est celle que la
 * largeur de ces fichiers impose. Elle ne voyait alors que `cmd \`, n'y trouvait pas l'aveu, et
 * REFUSAIT une boucle conforme. Le faux positif n'est pas un détail de confort : une garde qui
 * refuse la forme juste pousse à écrire la forme qu'elle accepte, et on se met à contorsionner le
 * code pour l'outil plutôt que l'inverse — après quoi plus personne ne croit ses refus. Les lignes
 * continuées sont donc recollées avant lecture.
 */
export const premiereInstruction = (lignes, fin) => {
  const suite = lignes.slice(fin + 1).map((l) => l.trim());
  let i = suite.findIndex((l) => l && !l.startsWith("#"));
  if (i < 0) return "";
  const morceaux = [];
  for (; i < suite.length; i += 1) {
    const continuee = suite[i].endsWith("\\");
    morceaux.push(continuee ? suite[i].slice(0, -1).trim() : suite[i]);
    if (!continuee) break;
  }
  return morceaux.join(" ");
};

/**
 * Les boucles de réessai d'un script, avec ce qui les suit. Rend
 * `[{ ligne, tete, aveu }]` — `aveu` : le bloc dit-il `::error::` après le `done` de cette boucle ?
 *
 * ⚠️ LE DÉCOMPTE SUIT L'IMBRICATION. Une boucle qui en contient une autre ferme sur le second
 * `done` ; compter le premier ferait juger la suite de la boucle interne, c'est-à-dire pas la suite.
 */
export function bouclesDe(script) {
  const lignes = String(script || "").split("\n");
  const trouvees = [];
  for (let i = 0; i < lignes.length; i += 1) {
    if (!/^\s*(for|while|until)\b/.test(lignes[i])) continue;
    // ⚠️ UNE BOUCLE TIENT SOUVENT SUR UNE SEULE LIGNE, et c'est justement la forme de l'incident :
    // `for i in $(seq 1 20); do … done` ouvre ET ferme au même endroit. Une première version de cette
    // sonde exigeait que le `done` soit sur une ligne ULTÉRIEURE : elle relevait trois boucles sur
    // sept et rendait VERT sur le défaut qu'elle était écrite pour trouver.
    let profondeur = 0, vuDo = false, fin = -1;
    const corps = [];
    for (let j = i; j < lignes.length; j += 1) {
      const l = lignes[j];
      const ouvre = (l.match(/(^|\s|;)do\b/g) || []).length;
      const ferme = (l.match(/(^|\s|;)done\b/g) || []).length;
      if (ouvre) vuDo = true;
      profondeur += ouvre - ferme;
      corps.push(l);
      if (vuDo && ferme && profondeur <= 0) { fin = j; break; }
    }
    if (fin < 0) continue;
    const texte = corps.join("\n");
    if (!ATTEND.test(texte)) continue;
    // Une boucle imbriquée dans une boucle de réessai déjà relevée n'est pas un second cas.
    if (trouvees.some((b) => i > b.debut && fin <= b.fin)) continue;
    const suivante = premiereInstruction(lignes, fin);
    const { programme, cible } = testeDe(lignes[i], corps.slice(1).join("\n"));
    const rejoue = !!programme && suivante.includes(programme) && (!cible || suivante.includes(cible));
    trouvees.push({
      debut: i, fin, ligne: i + 1,
      tete: lignes[i].trim().slice(0, 120),
      suivante: suivante.slice(0, 100),
      aveu: suivante.includes("::error::") || rejoue,
    });
  }
  return trouvees;
}

export function auditer(racine = RACINE) {
  let fichiers;
  try { fichiers = workflows(join(racine, ".github/workflows")); } catch (e) {
    return inconclusif(`impossible de lire .github/workflows (${e.message}) : rien n'a été vérifié`);
  }
  if (!fichiers.length) return inconclusif("aucun workflow trouvé : la sonde vise à côté");

  const constats = [];
  let blocsLus = 0, bouclesVues = 0;
  for (const f of fichiers) {
    const texte = readFileSync(f, "utf8");
    for (const bloc of blocsDe(f.replace(`${racine}/`, ""), texte)) {
      if (!estBash(bloc.shell)) continue;
      blocsLus += 1;
      for (const b of bouclesDe(bloc.run)) {
        bouclesVues += 1;
        if (b.aveu) continue;
        constats.push(`${bloc.fichier} › ${bloc.job} › ${bloc.nom} : la boucle de réessai « ${b.tete} » `
          + `sort par épuisement EXACTEMENT comme par succès — ce qui la suit est « ${b.suivante} », `
          + "qui ne dit pas qu'elle a renoncé et ne rejoue pas son test. Une boucle de réessai a trois "
          + "sorties : réussi, refusé, et « j'ai renoncé » ; la troisième est un échec. Faites suivre le "
          + "`done` d'un `::error::` qui nomme ce qui n'est jamais venu (modèle : la fonction `attendre` "
          + "de release.yml), ou du rejeu du test, dont l'échec compte alors.");
      }
    }
  }
  // ⚠️ RÈGLE ANTI-VACUITÉ : zéro boucle relevée n'est pas une conformité. Le jour où ce motif
  // s'écrit autrement — un `until`, une fonction, un outil tiers — la sonde viserait à côté et
  // rendrait vert sur rien, ce qui est exactement l'état qu'elle existe pour refuser.
  if (!bouclesVues) {
    return inconclusif(`${blocsLus} bloc(s) « run: » relus dans ${fichiers.length} workflow(s), et AUCUNE `
      + "boucle de réessai reconnue : ce dépôt en portait cinq — la sonde ne les voit plus, ou elles "
      + "se sont écrites autrement. Rien n'a été vérifié.");
  }
  if (constats.length) return violation(constats);
  return conforme(`${bouclesVues} boucle(s) de réessai dans ${blocsLus} bloc(s) « run: » de `
    + `${fichiers.length} workflow(s) : chacune dit ce qui n'est jamais venu quand elle renonce`);
}

if (estExecuteDirectement(import.meta.url)) conclure(tenter(() => auditer()));
