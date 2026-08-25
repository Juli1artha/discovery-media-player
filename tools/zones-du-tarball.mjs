// CE QUI A CHANGÉ ENTRE DEUX PAQUETS PUBLIÉS, PAR ZONE — PRODUIT PAR LE TRAIN, PAS À LA MAIN.
//
// ⚠️ « AUCUN FICHIER D'EXÉCUTION NE DIFFÈRE » EST LA PHRASE QUI DÉCIDE D'UNE MONTÉE, et elle était
// calculée après coup, par l'hôte, deux fois (0.1.134 puis 0.1.135). C'est le fait qui transforme
// « sept commits » en « risque nul » — et c'est aussi celui qui dit s'il faut aller vérifier un
// câblage chez soi. Il se calcule au moment où les notes s'écrivent ; il n'y a aucune raison de le
// laisser à la charge de celui qui lit.
//
// ⚠️ ET LA VALEUR N'EST PAS LA PHRASE, C'EST QU'ELLE SOIT MÉCANIQUE. Une mention « docs seulement »
// écrite à la main dans les notes se revérifie — l'hôte l'a dit et l'a fait. Une mention produite
// par la chaîne se recoupe une fois, puis on s'appuie dessus. C'est toute la différence entre une
// affirmation et une mesure, et elle tient au fait que personne ne l'a tapée.
//
// ⚠️ ON IMPRIME LES ZONES ET LEURS COMPTES, JAMAIS UN BOOLÉEN. « Zéro fichier d'exécution » n'a de
// sens pour un intégrateur que s'il sait ce que NOUS rangeons dans « exécution » — et cette
// frontière est ici, pas chez lui. Un « docs seulement » lui demanderait de nous croire sur la
// définition ; une table de zones lui laisse tirer sa propre conclusion.
//
// ⚠️ ET UN CHEMIN QUI N'ENTRE DANS AUCUNE ZONE EST NOMMÉ, PAS AVALÉ. Sans ça, ajouter un répertoire
// au paquet le ferait voyager hors de toute comptabilité, et la table dirait « rien n'a changé »
// d'un fichier qu'elle n'a pas su ranger — une couverture affirmée plus large qu'elle n'est.
//
// Usage : node tools/zones-du-tarball.mjs <avant.tgz> <apres.tgz>

import { execFileSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { createHash } from "node:crypto";

import { estExecuteDirectement } from "./execute-directement.mjs";

/**
 * Les zones, dans l'ordre où on les essaie, chacune avec ce qu'elle veut dire pour un intégrateur.
 * ⚠️ L'ordre compte : un `.md` sous `docs/` est un document, pas du code.
 */
export const ZONES = [
  { nom: "documents", quoi: "what a human reads", est: (f) => /\.md$/i.test(f) || /(^|\/)LICEN[CS]E/i.test(f) },
  { nom: "manifest", quoi: "package.json — version, exports, dependencies", est: (f) => f === "package.json" },
  { nom: "server", quoi: "the code the host executes", est: (f) => f.startsWith("server/") },
  { nom: "context", quoi: "the injected-context implementations", est: (f) => f.startsWith("context/") },
  { nom: "browser", quoi: "the bundle the page loads", est: (f) => f.startsWith("dist/") },
  { nom: "cli", quoi: "the command-line entry point", est: (f) => f.startsWith("bin/") },
  { nom: "types", quoi: "the TypeScript declarations", est: (f) => f.startsWith("types/") },
  { nom: "database", quoi: "the schema and its migrations", est: (f) => f.startsWith("supabase/") },
];

export const zoneDe = (fichier) => (ZONES.find((z) => z.est(fichier)) || { nom: null }).nom;

/**
 * Les écarts entre deux inventaires `chemin → empreinte`, rangés par zone.
 * ⚠️ Rend AUSSI ce qu'aucune zone ne réclame : `horsZone`. Un défaut de rangement n'est pas un
 * silence, c'est une ligne à lire.
 */
export function ecarts(avant, apres) {
  const chemins = [...new Set([...Object.keys(avant), ...Object.keys(apres)])].sort();
  const parZone = new Map(ZONES.map((z) => [z.nom, { ajoutes: [], retires: [], modifies: [] }]));
  const horsZone = [];
  for (const f of chemins) {
    const etat = !(f in avant) ? "ajoutes" : !(f in apres) ? "retires" : avant[f] !== apres[f] ? "modifies" : null;
    const zone = zoneDe(f);
    if (zone === null) { horsZone.push(f); continue; }
    if (etat) parZone.get(zone)[etat].push(f);
  }
  return { parZone, horsZone };
}

/**
 * Le bloc Markdown qui rejoint les notes de la Release.
 * ⚠️ SON TEXTE EST EN ANGLAIS, commentaires exceptés : il est lu par des intégrateurs, comme tout
 * ce que ce dépôt tourne vers l'extérieur. Les NOMS de zones aussi — ce ne sont pas des
 * identifiants du produit qu'on tape, ce sont des libellés qu'on lit, et ils portent le nom du
 * répertoire qu'ils recouvrent pour qu'on puisse aller vérifier.
 */
export function rapport(avantVersion, apresVersion, avant, apres) {
  const { parZone, horsZone } = ecarts(avant, apres);
  const l = [];
  l.push(`### What changed in the package, by zone — \`${avantVersion}\` → \`${apresVersion}\``);
  l.push("");
  l.push("Measured on the two tarballs, by the release workflow. Not written by hand.");
  l.push("");
  l.push("| Zone | What it is | Added | Removed | Changed |");
  l.push("|---|---|---:|---:|---:|");
  for (const z of ZONES) {
    const e = parZone.get(z.nom);
    const n = (xs) => (xs.length ? `**${xs.length}**` : "0");
    l.push(`| \`${z.nom}\` | ${z.quoi} | ${n(e.ajoutes)} | ${n(e.retires)} | ${n(e.modifies)} |`);
  }
  l.push("");
  const nommes = ZONES.flatMap((z) => {
    const e = parZone.get(z.nom);
    return [...e.ajoutes.map((f) => `+ ${f}`), ...e.retires.map((f) => `− ${f}`), ...e.modifies.map((f) => `~ ${f}`)];
  });
  if (nommes.length) {
    l.push("<details><summary>The files themselves</summary>", "", "```", ...nommes, "```", "", "</details>");
  } else {
    l.push("No file differs between the two packages.");
  }
  if (horsZone.length) {
    l.push("");
    l.push(`⚠️ ${horsZone.length} path(s) belong to no declared zone and are therefore **not counted above** — ` +
      `\`${horsZone.join("`, `")}\`. The table is narrower than the package until they are classified.`);
  }
  return l.join("\n");
}

/**
 * La version publiée juste avant celle-ci.
 *
 * ⚠️ ON TRIE SUR LE FAIT, PAS SUR LE LIBELLÉ : un tri lexical met « 0.1.9 » après « 0.1.10 », et
 * la table comparerait alors deux versions qui ne se suivent pas — en silence, avec des chiffres
 * d'apparence normale. On compare donc les trois nombres.
 *
 * ⚠️ Et on ne retient QUE les versions stables : une préversion n'est pas ce que quelqu'un a
 * installé avant, donc pas ce dont il veut l'écart.
 */
export function versionPrecedente(versions, courante) {
  const n = (v) => v.split(".").map(Number);
  const stable = (v) => /^\d+\.\d+\.\d+$/.test(v);
  const avant = (a, b) => { const [x, y, z] = n(a), [p, q, r] = n(b); return x !== p ? x < p : y !== q ? y < q : z < r; };
  const candidates = (versions || []).filter((v) => stable(v) && avant(v, courante));
  if (!candidates.length) return null;
  return candidates.reduce((meilleure, v) => (avant(meilleure, v) ? v : meilleure));
}

/** L'inventaire d'un tarball : chemin (sans le `package/` de tête) → sha256. */
export function inventaireDuTarball(chemin) {
  const dir = mkdtempSync(join(tmpdir(), "zones-"));
  try {
    execFileSync("tar", ["-xzf", chemin, "-C", dir], { stdio: ["ignore", "ignore", "pipe"] });
    const racine = join(dir, "package");
    const out = {};
    // ⚠️ `withFileTypes` PLUTÔT QU'UN `statSync` SÉPARÉ. Interroger le type par un second appel
    // ouvre une fenêtre entre le contrôle et l'usage — CodeQL l'a refusé, à raison sur la forme
    // même si le répertoire vient d'être créé ici. Le type arrive avec l'entrée, donc il n'y a
    // plus de « on a vérifié, puis on a fait » : il n'y a qu'un « on a lu ».
    const parcourir = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) parcourir(p);
        else if (e.isFile()) out[relative(racine, p)] = createHash("sha256").update(readFileSync(p)).digest("hex");
      }
    };
    parcourir(racine);
    if (!Object.keys(out).length) throw new Error(`${chemin} : aucun fichier — on ne compare pas sur un inventaire vide`);
    return out;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (estExecuteDirectement(import.meta.url)) {
  const [avantF, apresF, avantV = "previous", apresV = "current"] = process.argv.slice(2);
  if (!avantF || !apresF) { console.error("usage : node tools/zones-du-tarball.mjs <avant.tgz> <apres.tgz> [versionAvant] [versionApres]"); process.exit(2); }
  console.log(rapport(avantV, apresV, inventaireDuTarball(avantF), inventaireDuTarball(apresF)));
}
