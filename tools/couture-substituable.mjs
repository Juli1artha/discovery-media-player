// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE AIDE QU'ON NE PEUT PAS DOUBLER EST UNE AIDE QU'ON N'ADOPTE PAS — ET ON RENONCE EN SILENCE.
//
// ⚠️ CETTE GARDE EST VERTE LE JOUR OÙ ELLE EST ÉCRITE, ET C'EST LE SUJET. Nos 70 appels au contexte
// injecté passent déjà par l'objet au moment de l'appel ; aucun ne capture une liaison locale. Elle
// ne corrige donc rien : elle protège le PROCHAIN, écrit par quelqu'un qui trouvera naturel
// d'extraire `const db = PLAYER.db` en tête de module pour raccourcir vingt lignes.
//
// ⚠️ CE QUI LA MOTIVE EST LE CONSTAT D'UN HÔTE, PAYÉ CHEZ LUI. Il avait écrit un utilitaire de
// pagination après un incident, avec sa raison en tête — et cet utilitaire n'était appelé NULLE
// PART. Il en a trouvé la cause en essayant de l'employer : l'utilitaire appelait la liaison LOCALE
// de son client de base, alors que ses bancs remplacent l'EXPORT. Basculer un appel vers lui CASSAIT
// donc le banc censé le couvrir.
//
// Le défaut n'est pas que l'aide soit fausse : elle est juste. Le défaut est qu'elle coûte un banc à
// adopter, et « personne n'écrit *je ne l'utilise pas parce qu'il casse mes doubles* — on renonce en
// silence ». Une aide non substituable ne produit donc aucun rouge, aucune plainte, aucune trace :
// elle produit une absence d'usage, que rien ne distingue d'un besoin qui n'existait pas.
//
// ⚠️ ET CHEZ NOUS LA COUTURE EST LE CONTEXTE INJECTÉ, PAS NOS EXPORTS. C'est la promesse que ce
// dépôt fait à ses hôtes : ils fournissent `db`, `storage`, `mail`, `log`, et NOUS appelons à
// travers. Un double d'hôte n'est utilisé que si l'appel relit `PLAYER.db` à l'instant où il tire —
// pas s'il a été photographié au chargement du module, AVANT que l'hôte n'ait injecté quoi que ce
// soit. La capture locale est donc l'exacte forme du défaut de l'hôte, transposée à notre frontière.
//
// La sévérité est ici celle du silence : une capture ne casse aucun banc chez nous, puisque nos
// propres bancs injectent avant d'appeler. Elle casse le double de l'hôte, chez l'hôte, sans que
// rien ici ne rougisse.

import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..");
const ZONES = ["server", "context"];

/**
 * ⚠️ LE SOURCE SANS SES COMMENTAIRES — même orthographe que dans `filtre-avant-ecriture.mjs`,
 * délibérément. Un motif qui cherche une FORME dans du texte non classé accuse la prose qui
 * documente la règle : ce fichier-ci en contient plusieurs exemples, à commencer par son en-tête.
 */
export function sourceUtile(texte) {
  return texte.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
}

/** Les membres du contexte injecté : ce que l'hôte fournit, et donc ce qu'il double. */
const MEMBRES = ["db", "storage", "mail", "log", "config", "branding"];

/**
 * Une capture est une liaison qui photographie un membre du contexte pour s'en servir plus tard —
 * `const db = PLAYER.db`, une déstructuration `const { db } = PLAYER`, un alias de l'objet entier.
 *
 * ⚠️ CE QUI N'EN EST PAS UNE, et la distinction porte tout : lire une VALEUR de configuration
 * (`PLAYER.config.presenceStrict`) n'est pas capturer un service. Une valeur est un scalaire dont
 * personne n'installe de double ; un service est ce que l'hôte remplace. On ne signale donc que la
 * capture d'un membre ou de la racine, jamais celle d'un champ terminal.
 */
export function capturesDansSource(source) {
  const trouvailles = [];
  const membres = MEMBRES.join("|");
  const motifs = [
    // const db = PLAYER.db  /  let storage = PLAYER.storage
    { re: new RegExp(`(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*PLAYER\\.(${membres})\\s*[;,\\n]`, "g"), quoi: (m) => `PLAYER.${m[2]}` },
    // const { db, storage } = PLAYER
    { re: /(?:const|let|var)\s*\{([^}]*)\}\s*=\s*PLAYER\s*[;,\n]/g, quoi: (m) => `{ ${m[1].trim()} } depuis PLAYER` },
    // const p = PLAYER  (l'objet entier, photographié)
    { re: /(?:const|let|var)\s+([\w$]+)\s*=\s*PLAYER\s*[;,\n]/g, quoi: () => "PLAYER lui-même" },
  ];
  for (const { re, quoi } of motifs) {
    let m;
    while ((m = re.exec(source)) !== null) {
      trouvailles.push({ quoi: quoi(m), index: m.index });
    }
  }
  return trouvailles;
}

/**
 * Les appels qui relisent le contexte à l'instant où ils tirent — la forme saine, et le DÉNOMINATEUR
 * de cette garde. On les compte pour la même raison que `filtre-avant-ecriture.mjs` compte ses sites
 * d'écriture : sans dénominateur, une sonde qui cesse de reconnaître nos appels devient verte en ne
 * regardant plus rien.
 */
export function appelsTraversants(source) {
  const re = new RegExp(`PLAYER\\.(${MEMBRES.join("|")})\\.`, "g");
  return (source.match(re) || []).length;
}

function fichiersJs(dossier) {
  const out = [];
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "__tests__") continue;
    const p = join(dossier, e.name);
    if (e.isDirectory()) out.push(...fichiersJs(p));
    else if (e.name.endsWith(".js")) out.push(p);
  }
  return out;
}

export function auditer(racine = RACINE) {
  const constats = [];
  let traversants = 0;
  for (const zone of ZONES) {
    for (const fichier of fichiersJs(join(racine, zone))) {
      const source = sourceUtile(readFileSync(fichier, "utf8"));
      traversants += appelsTraversants(source);
      for (const c of capturesDansSource(source)) {
        const ligne = source.slice(0, c.index).split("\n").length;
        constats.push(`${fichier.slice(racine.length + 1)}:${ligne} — ${c.quoi} est CAPTURÉ dans une `
          + "liaison locale. Le double d'un hôte ne sera pas utilisé : la liaison photographie le "
          + "contexte au chargement, avant l'injection. Appelez `PLAYER.<membre>.<methode>(…)` au "
          + "point d'usage.");
      }
    }
  }
  // ⚠️ ZÉRO APPEL TRAVERSANT N'EST PAS UNE CONFORMITÉ. Règle anti-vacuité : ce qui autorise à
  // conclure est la FORME RECONNUE, pas l'absence de trouvailles. Si `PLAYER` était renommé ou
  // enrobé, cette garde deviendrait verte en ne regardant plus rien — et la couture pourrait se
  // rompre sans un seul rouge.
  if (!traversants) {
    return inconclusif("aucun appel `PLAYER.<membre>.…` reconnu dans " + ZONES.join(", ")
      + " — la sonde vise à côté, ou la forme du contexte a changé : rien n'a été vérifié");
  }
  if (constats.length) return violation(constats);
  return conforme(`${traversants} appel(s) au contexte injecté, tous relus au point d'usage `
    + "— le double d'un hôte est donc utilisé");
}

if (estExecuteDirectement(import.meta.url)) conclure(tenter(() => auditer()));
