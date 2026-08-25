#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// Installe les hooks git de ce dépôt. Appelé par `npm install` via le script `prepare`.
//
// ⚠️ POURQUOI AUTOMATIQUE PLUTÔT QUE DOCUMENTÉ. Le hook `pre-push` existait dans le dépôt voisin
// depuis le 05/08 ; celui-ci ne l'a reçu que le 14/08, après que le même incident s'y soit produit
// et qu'une version ait été publiée sans son correctif. Une garde qui demande une étape manuelle
// par clone est une garde qu'un clone sur deux n'a pas — et ce clone-là est toujours celui où
// l'incident arrive.
//
// ⚠️ MAIS IL ÉCRASAIT UN HOOK QUI N'ÉTAIT PAS LE SIEN (P2, audit du 22/08).
//
// L'ancienne version ne réécrivait pas quand le contenu était IDENTIQUE — son commentaire disait
// « pour ne pas écraser une personnalisation identique ». Elle nommait donc l'inquiétude, et ne
// traitait que le seul cas où l'inquiétude ne s'applique pas : un `pre-push` DIFFÉRENT, écrit à la
// main par quelqu'un, disparaissait sans un mot au premier `npm install`. Un travail qu'on détruit
// en silence est pire qu'un travail qu'on refuse de toucher.
//
// La décision vit dans `decider()`, séparée de l'écriture, parce qu'une décision qu'on ne peut pas
// éprouver est une décision qu'on découvre chez quelqu'un d'autre.
//
// Idempotent, silencieux, et sans effet quand il n'y a rien à installer.

import { existsSync, copyFileSync, chmodSync, mkdirSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { estExecuteDirectement } from "./execute-directement.mjs";

/**
 * ⚠️ CE QUI DISTINGUE « NOTRE HOOK, PLUS VIEUX » DE « LE HOOK DE QUELQU'UN D'AUTRE ».
 *
 * Sans ce repère, les deux cas se ressemblent : un contenu différent du nôtre. Or ils appellent
 * l'inverse l'un de l'autre — le premier DOIT être remplacé (c'est la mise à jour normale), le
 * second ne doit surtout pas l'être. Comparer les contenus ne répond qu'à « est-ce exactement le
 * nôtre », ce qui est la mauvaise question.
 */
export const SIGNATURE = "discovery-media-player:pre-push";

/**
 * ⚠️ ET LA SIGNATURE N'EXISTE QUE DEPUIS AUJOURD'HUI.
 *
 * Tous les clones déjà faits portent le hook du dépôt SANS elle. Sur eux, la reconnaissance par
 * signature seule conclurait « hook étranger », fabriquerait une sauvegarde inutile et chaînerait
 * notre propre hook sur lui-même — deux fois le même refus, pour rien. Une correction dont le
 * premier effet est de déranger tout le monde ne survit pas à sa première semaine.
 *
 * La ligne d'en-tête historique le désigne aussi sûrement, et elle est là depuis le 14/08.
 */
const EMPREINTES = [SIGNATURE, "Hook pre-push du player"];

export const estLeNotre = (contenu) => EMPREINTES.some((e) => String(contenu).includes(e));

/**
 * Que faire, sachant ce qui est déjà en place. Rend une action et sa raison — jamais un booléen,
 * parce que le message est la moitié du travail : un hook déplacé sans qu'on le dise se retrouve
 * découvert des semaines plus tard.
 *
 * @param existant  le contenu du hook installé, ou null s'il n'y en a pas
 * @param source    le contenu de notre hook
 * @param aSauvegarde  une sauvegarde `pre-push.local` est-elle déjà là
 */
export function decider({ existant, source, aSauvegarde }) {
  if (existant === null || existant === undefined) {
    return { action: "installer", raison: "hooks git : pre-push installé" };
  }
  if (existant === source) {
    return { action: "rien", raison: "déjà à jour" };
  }
  if (estLeNotre(existant)) {
    // Notre hook, dans une version antérieure : le remplacer est la mise à jour attendue.
    return { action: "installer", raison: "hooks git : pre-push mis à jour" };
  }
  // ⚠️ UN HOOK ÉTRANGER. On le déplace en `pre-push.local`, que le nôtre exécute en premier :
  // les deux tournent, rien n'est perdu, et sa décision prime puisqu'elle était là avant nous.
  if (aSauvegarde) {
    // Une sauvegarde existe DÉJÀ et le hook courant n'est toujours pas le nôtre : quelqu'un a
    // re-personnalisé par-dessus le chaînage. Écraser `pre-push.local` détruirait le premier
    // hook pour sauver le second. On ne choisit pas à sa place — on ne touche à rien et on le dit.
    return {
      action: "refuser",
      raison: "hooks git : un pre-push personnalisé est en place ET une sauvegarde pre-push.local existe déjà — rien n'a été touché. Fusionnez-les à la main, puis relancez `npm install`.",
    };
  }
  return {
    action: "chainer",
    raison: "hooks git : votre pre-push a été déplacé en pre-push.local et reste exécuté en premier ; celui du dépôt est installé par-dessus",
  };
}

// ⚠️ TOUT CE QUI SUIT N'ARRIVE QU'EN EXÉCUTION DIRECTE, ET CETTE GARDE-LÀ A ÉTÉ APPRISE ICI MÊME.
//
// Ce fichier n'exportait rien, donc personne ne l'importait, donc ses effets de bord au niveau
// racine étaient sans conséquence. En sortant `decider()` pour pouvoir l'éprouver, je l'ai rendu
// IMPORTABLE — et le premier `import` l'a exécuté : le banc a installé des hooks dans le dépôt de
// travail et y a déplacé le pre-push existant. Ça s'est vu à la trace laissée sur le disque, pas
// dans un test.
//
// C'est l'idiome que les six autres outils de `tools/` utilisent déjà. Rendre un module testable
// ne doit pas le rendre agissant : un `import` ne touche à rien.
if (estExecuteDirectement(import.meta.url)) {
  const ICI = dirname(fileURLToPath(import.meta.url));

  // ⚠️ `prepare` s'exécute AUSSI quand le paquet est installé comme dépendance. On ne touche jamais
  // au dépôt de quelqu'un d'autre : ni depuis node_modules, ni hors d'un dépôt git.
  if (!ICI.includes("node_modules")) {
    let dossierGit;
    try {
      dossierGit = execFileSync("git", ["rev-parse", "--git-common-dir"], {
        cwd: join(ICI, ".."), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
      }).trim();
    } catch {
      dossierGit = null; // pas un dépôt git (tarball, archive) : rien à faire
    }

    const source = join(ICI, "git-hooks", "pre-push");
    if (dossierGit && existsSync(dossierGit) && existsSync(source)) {
      const cible = join(dossierGit, "hooks", "pre-push");
      const sauvegarde = join(dossierGit, "hooks", "pre-push.local");
      try {
        const { action, raison } = decider({
          existant: existsSync(cible) ? readFileSync(cible, "utf8") : null,
          source: readFileSync(source, "utf8"),
          aSauvegarde: existsSync(sauvegarde),
        });
        // ⚠️ SUR stderr, JAMAIS stdout — ET CE N'EST PAS UN DÉTAIL DE STYLE.
        //
        // `prepare` s'exécute aussi pendant `npm pack --dry-run --json`, dont `langue-publiee.mjs`
        // PARSE la sortie standard. Un « hooks git : pre-push installé » écrit sur stdout se
        // retrouve donc devant le JSON, qui cesse d'en être un — la garde de langue sort alors 2
        // avec « Unexpected token 'h' », un message qui ne désigne rien de ce qui cloche.
        //
        // Constaté en direct pendant cette correction, sur un clone dont le hook n'était pas à
        // jour. En CI c'était masqué : `npm ci` installe le hook avant, donc le `npm pack` qui
        // suit n'a plus rien à dire. Un défaut que seule la première exécution d'un clone frais
        // révèle est un défaut qui attend le nouvel arrivant.
        //
        // Un message de diagnostic n'a rien à faire dans le canal des données.
        if (action === "refuser") {
          process.stderr.write(raison + "\n");
        } else if (action !== "rien") {
          mkdirSync(dirname(cible), { recursive: true });
          if (action === "chainer") {
            copyFileSync(cible, sauvegarde);
            chmodSync(sauvegarde, 0o755);
          }
          copyFileSync(source, cible);
          chmodSync(cible, 0o755);
          process.stderr.write(raison + "\n");
        }
      } catch {
        // Un hook non installé ne doit jamais empêcher d'installer le projet.
      }
    }
  }
}
