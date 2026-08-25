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
import { readFileSync, writeFileSync, mkdtempSync, rmSync, readdirSync } from "node:fs";
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
  // ⚠️ `dist/` PORTE DEUX ARTEFACTS QUI N'ONT PAS LE MÊME CONSOMMATEUR, et un seul suffixe les
  // sépare. `dist/bridge.js` est exécuté par la page des visiteurs ; `dist/bridge.d.ts` est lu par
  // le `tsc` de l'hôte. L'un casse à l'exécution, l'autre au build — deux incidents différents,
  // deux gestes différents. Fondus en une zone, « browser : 1 modifié » ne disait pas s'il fallait
  // relire une page ou relancer un build.
  //
  // ⚠️ ET LA LIGNE DE PARTAGE N'EST PAS LE TYPE D'HÔTE. On l'a d'abord cherchée là — « serveur seul »
  // contre « embarque la page ». Un hôte de production est LES DEUX à la fois, et la distinction ne
  // l'aurait pas aidé. Elle est entre les deux artefacts, pas entre les lecteurs.
  //
  // ⚠️ L'ORDRE COMPTE : `.d.ts` d'abord, sinon tout `dist/` tomberait dans `browser`. Le reste de
  // `dist/` — dont son `package.json`, qui déclare le type de module — est bien chargé par la page.
  { nom: "browser-types", quoi: "the declarations the host's tsc reads for « ./bridge » — breaks a build, never a page", est: (f) => f.startsWith("dist/") && f.endsWith(".d.ts") },
  { nom: "browser", quoi: "what the visitors' page executes", est: (f) => f.startsWith("dist/") },
  { nom: "cli", quoi: "the command-line entry point", est: (f) => f.startsWith("bin/") },
  // ⚠️ ZONE À PART, MAIS PAS POUR LA RAISON ÉVIDENTE. Ces déclarations ne changent JAMAIS
  // l'exécution — elles cassent une CI, et un build rouge après fusion est un autre incident qu'une
  // page qui se comporte mal. C'est ce qui justifie la zone, pas une influence sur le produit.
  //
  // ⚠️ ET SON NOM PEUT ÉGARER : « types » SONNE comme « la surface typée », alors qu'un hôte qui
  // consomme le serveur en CommonJS sans `checkJs` ne les lit jamais — les types qu'il vérifie
  // vraiment sont ceux de `dist/`. Mesuré chez un hôte de production : `types/` y est du bruit.
  // C'est la démonstration que découper par répertoire peut égarer, gardée ici comme avertissement.
  { nom: "types", quoi: "declarations for the server and context entry points — breaks a build, never runtime", est: (f) => f.startsWith("types/") },
  // ⚠️ ICI « AJOUTÉ » ET « MODIFIÉ » N'ONT PAS LE MÊME SENS, et les compter côte à côte les aplatit.
  // Le paquet porte dix-neuf migrations que l'hôte applique lui-même. Une migration AJOUTÉE est une
  // action : l'appliquer, dans l'ordre. Une migration MODIFIÉE est une alarme : ce qui a déjà été
  // appliqué ailleurs doit être immuable, et un fichier qui change sous des bases qui l'ont déjà
  // joué n'est pas une ligne de tableau, c'est un arrêt.
  { nom: "database", quoi: "the schema and the migrations the host applies itself", est: (f) => f.startsWith("supabase/"),
    // ⚠️ LE TEXTE NE RENVOIE PLUS VERS UN REGISTRE DE MIGRATIONS, et c'est une correction due à un
    // hôte qui a fait le geste pour de vrai. Sa table `schema_migrations` enregistrait 0001, 0002 et
    // 0005 à 0011 — alors que 0013 et 0016 à 0019 étaient bel et bien appliquées, vérifiées sur
    // leurs effets. Un registre n'enregistre que ce qui est passé par un chemin donné ; le reste
    // n'y laisse aucune trace. Une instruction qui envoie lire une table suppose une fiabilité
    // qu'aucun hôte ne nous a promise. On envoie donc sonder l'OBJET, et on donne son nom.
    alarmeSiModifie: "a migration already applied elsewhere must be immutable. A changed file here is not a count — it is a stop. Check the objects listed below against your live database: a migration registry only records what went through one particular path, so absence from it does not mean the migration was never applied." },
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
export function rapport(avantVersion, apresVersion, avant, apres, contenus = {}) {
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
  // ⚠️ CE QUI DOIT CRIER NE SE COMPTE PAS. Une zone peut déclarer qu'une MODIFICATION y est une
  // alarme et non une ligne : le lecteur qui parcourt une table lit des nombres, et un nombre parmi
  // d'autres nombres ne dit pas « arrête-toi ». On le sort de la table, on nomme les fichiers, et on
  // écrit ce qu'il faut faire — la table reste la table, l'arrêt reste un arrêt.
  for (const z of ZONES.filter((x) => x.alarmeSiModifie)) {
    const touches = parZone.get(z.nom).modifies;
    if (!touches.length) continue;
    l.push("");
    l.push(`> ### ⚠️ \`${z.nom}\` — ${touches.length} file(s) **changed**, not added`);
    l.push(">");
    l.push(`> ${z.alarmeSiModifie}`);
    l.push(">");
    for (const f of touches) {
      l.push(`> - \`${f}\``);
      const textAvant = (contenus.avant || {})[f];
      const textApres = (contenus.apres || {})[f];
      if (textApres === undefined || textAvant === undefined) {
        // ⚠️ On le DIT. « Pas de contenu disponible » et « rien de notable » se ressemblent en silence.
        l.push(">   _(contents not available here, so no diff and no object list)_");
        continue;
      }
      const objets = objetsSQL(textApres);
      if (objets.length) l.push(`>   objects it touches — ${objets.map((o) => `\`${o}\``).join(", ")}`);
      l.push(">", ">   ```diff", ...diffUnifie(textAvant, textApres).split("\n").map((x) => `>   ${x}`), ">   ```");
    }
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

/**
 * LE DIFF UNIFIÉ D'UN FICHIER, parce que « modifié » recouvre deux choses opposées : une faute de
 * frappe dans un commentaire, et une DDL réécrite. La première ne mérite pas d'arrêter un train,
 * la seconde mérite d'arrêter beaucoup plus qu'un train — et rien dans un compte ne les sépare.
 *
 * ⚠️ C'EST GRATUIT ICI ET COÛTEUX AILLEURS. Au moment où ce bloc s'écrit, les deux archives sont
 * ouvertes ; pour l'hôte qui lit les notes, l'obtenir suppose de télécharger et déplier deux
 * tarballs. Le déséquilibre est la raison d'être de cette fonction.
 *
 * ⚠️ ON NE TRONQUE PAS EN SILENCE. Un diff long EST une information — on le dit, avec le nombre de
 * lignes retirées, plutôt que de rendre un extrait qui se lit comme un diff complet.
 */
export function diffUnifie(avant, apres, plafond = 80, executer = executerDiff) {
  // ⚠️ `diff` SORT EN 1 QUAND LES FICHIERS DIFFÈRENT — c'est son contrat, pas une panne. Traiter ce
  // code comme une erreur ferait disparaître le diff exactement quand il y en a un.
  //
  // ⚠️ ET LE RATTRAPAGE EST ICI, PAS DANS LE LANCEUR PAR DÉFAUT. Il y était, et la couture
  // d'injection le CONTOURNAIT : le banc écrit pour l'éprouver ne l'atteignait pas. Ce que
  // j'affirmais éprouver et ce que j'éprouvais n'étaient pas le même objet — le défaut dont ce
  // dépôt tient la règle deux fichiers plus loin.
  let brut;
  try {
    brut = executer(String(avant ?? ""), String(apres ?? ""));
  } catch (erreur) {
    if (erreur && erreur.status === 1 && typeof erreur.stdout === "string") brut = erreur.stdout;
    else throw erreur;
  }
  // Les deux premières lignes de `diff -u` nomment des fichiers temporaires : elles ne veulent
  // rien dire pour le lecteur, et le chemin réel est déjà dans le titre du bloc.
  const lignes = brut.split("\n").filter((l, i) => !(i < 2 && /^(---|\+\+\+) /.test(l)));
  if (lignes.length <= plafond) return lignes.join("\n").trimEnd();
  const retirees = lignes.length - plafond;
  return [...lignes.slice(0, plafond), `… ${retirees} more line(s) not shown — a diff this long is itself the answer`].join("\n");
}

function executerDiff(avant, apres) {
  const dir = mkdtempSync(join(tmpdir(), "diff-"));
  try {
    const a = join(dir, "avant"), b = join(dir, "apres");
    writeFileSync(a, avant); writeFileSync(b, apres);
    return execFileSync("diff", ["-u", a, b], { encoding: "utf8" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * LES OBJETS QU'UNE MIGRATION TOUCHE, tirés de son SQL.
 *
 * ⚠️ C'EST LA CLASSE D'ERREUR ENTIÈRE QUE ÇA SUPPRIME. Répondre « cette migration est-elle
 * appliquée ? » se fait en sondant l'objet — et sans son nom on le DEVINE. Mesuré chez un hôte de
 * production : une sonde cherchant une fonction contenant « presence » a rendu « absente » pour une
 * migration parfaitement appliquée, la fonction s'appelant `player_attendance_bump`. Quatrième
 * accusation à tort du même genre dans la même journée.
 *
 * ⚠️ HEURISTIQUE ASSUMÉE. Elle lit des formes DDL courantes hors chaînes et commentaires ; elle ne
 * comprend pas le SQL. Elle sert à VISER une sonde, jamais à conclure — un objet qu'elle manque
 * coûte un aller-retour, un objet qu'elle invente serait pire, donc on ne retient que ce qui suit
 * immédiatement un verbe connu.
 */
export function objetsSQL(texte) {
  const sansCommentaires = String(texte || "").replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  const VERBES = /\b(create|alter|drop)\s+(?:or\s+replace\s+)?(table|function|index|view|policy|trigger|type|schema)\s+(?:if\s+(?:not\s+)?exists\s+)?([a-zA-Z_][\w.$"]*)/gi;
  // ⚠️ ON GARDE TOUS LES VERBES D'UN MÊME OBJET, PAS LE PREMIER. Une migration qui fait
  // `drop function` puis `create or replace function` sur le même nom n'a pas supprimé la fonction —
  // et n'annoncer que « drop » enverrait sonder une absence là où il faut vérifier une signature.
  // Mesuré sur `0019-presence-lit-la-presentation.sql`, qui fait exactement ça.
  const vus = new Map();
  for (const [, verbe, genre, nom] of sansCommentaires.matchAll(VERBES)) {
    const cle = `${genre.toLowerCase()} ${nom.replace(/"/g, "")}`;
    if (!vus.has(cle)) vus.set(cle, []);
    const verbes = vus.get(cle);
    if (!verbes.includes(verbe.toLowerCase())) verbes.push(verbe.toLowerCase());
  }
  return [...vus.entries()].map(([cle, verbes]) => `${cle} — ${verbes.join(", ")}`);
}

/**
 * UNE SEULE LECTURE DE L'ARCHIVE, DEUX FAITS : les empreintes de tout, et le CONTENU de ce que
 * `contenuSi` réclame.
 *
 * ⚠️ Deux passes auraient donné deux vérités possibles sur la même archive, et c'est exactement
 * la forme que ce dépôt vient d'interdire : obtenir les deux faits d'une seule opération ferme la
 * fenêtre au lieu de la nommer. Le contenu n'est gardé que pour les fichiers demandés — un paquet
 * navigateur entier en mémoire ne servirait personne.
 *
 * ⚠️ LÈVE sur une archive vide : « rien à comparer » et « on n'a pas pu lire » ne se ressemblent
 * que si on les tait.
 */
export function lireTarball(chemin, contenuSi = () => false) {
  const dir = mkdtempSync(join(tmpdir(), "zones-"));
  try {
    execFileSync("tar", ["-xzf", chemin, "-C", dir], { stdio: ["ignore", "ignore", "pipe"] });
    const racine = join(dir, "package");
    const empreintes = {};
    const contenus = {};
    const parcourir = (d) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) { parcourir(p); continue; }
        if (!e.isFile()) continue;
        const nom = relative(racine, p);
        const octets = readFileSync(p);
        empreintes[nom] = createHash("sha256").update(octets).digest("hex");
        if (contenuSi(nom)) contenus[nom] = octets.toString("utf8");
      }
    };
    parcourir(racine);
    if (!Object.keys(empreintes).length) throw new Error(`${chemin} : aucun fichier — on ne compare pas sur un inventaire vide`);
    return { empreintes, contenus };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Les seules empreintes, pour qui n'a pas besoin des contenus. */
export const inventaireDuTarball = (chemin) => lireTarball(chemin).empreintes;

if (estExecuteDirectement(import.meta.url)) {
  const [avantF, apresF, avantV = "previous", apresV = "current"] = process.argv.slice(2);
  if (!avantF || !apresF) { console.error("usage : node tools/zones-du-tarball.mjs <avant.tgz> <apres.tgz> [versionAvant] [versionApres]"); process.exit(2); }
  // Les contenus ne sont gardés que pour les zones qui peuvent CRIER : ailleurs, un compte suffit.
  const aAlarme = (f) => ZONES.some((z) => z.alarmeSiModifie && z.est(f));
  const a = lireTarball(avantF, aAlarme);
  const b = lireTarball(apresF, aAlarme);
  console.log(rapport(avantV, apresV, a.empreintes, b.empreintes, { avant: a.contenus, apres: b.contenus }));
}
