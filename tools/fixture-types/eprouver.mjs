// LES TYPES PUBLIÉS, ÉPROUVÉS CONTRE LE TARBALL — ET ÉPROUVÉS COMME TYPES.
//
// ⚠️ UN `.d.ts` PARFAIT DANS LE CLONE PEUT ÊTRE ABSENT DU PAQUET PUBLIÉ : il suffit que `files`
// ne l'embarque pas, et c'est exactement ce qui était arrivé au contrat et à la rétention. On
// compile donc un consommateur RÉEL depuis une installation, jamais depuis l'arbre source.
//
// ⚠️ ET COMPILER NE SUFFIT PAS. Des types trop permissifs compilent aussi — ils accepteraient un
// contexte amputé, une signature fausse, et l'hôte ne l'apprendrait qu'à l'exécution. On MUTE
// donc la fixture et on EXIGE le rouge : une vérification qui passe sur n'importe quoi ne
// vérifie rien. Même règle que partout ici — une garde qu'on n'a pas vue échouer n'est pas une
// garde, c'est une décoration.
//
// Usage : node tools/fixture-types/eprouver.mjs <dossier-fixture>   (dossier créé par l'appelant)

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// ⚠️ AUCUN CHEMIN PAR DÉFAUT SOUS /tmp, ET C'EST UN VRAI CORRECTIF. Ce script écrivait dans
// « /tmp/fixture » quand on ne lui disait rien : un nom PRÉVISIBLE dans un dossier partagé, donc
// un lien symbolique pré-posé par n'importe qui suffit à détourner l'écriture ailleurs (CodeQL,
// « insecure temporary file », deux alertes hautes sur cette PR). Le risque est théorique sur un
// runner jetable ; l'habitude, elle, ne l'est pas — c'est ainsi qu'un jour on écrit le même
// motif dans du code qui compte. L'appelant fournit donc le dossier, et il le crée avec
// `mktemp -d` : nom imprévisible, permissions restreintes, nettoyé avec le runner.
const dossier = process.argv[2];
if (!dossier) {
  console.error("usage : node tools/fixture-types/eprouver.mjs <dossier>\n" +
    "  Le dossier doit être créé par l'appelant (mktemp -d), jamais deviné ici.");
  process.exit(2);
}
const source = join(dossier, "consommateur.ts");
const original = readFileSync(source, "utf8");

const compile = () => {
  try {
    execFileSync("npx", ["tsc", "-p", "tsconfig.json"], { cwd: dossier, stdio: "pipe" });
    return null;
  } catch (e) {
    return String(e.stdout || e.message).trim();
  }
};

// 1. L'état normal doit compiler. S'il échoue, le reste n'a aucun sens.
const echec = compile();
if (echec) {
  console.error("::error::le consommateur TypeScript ne compile pas contre le tarball\n" + echec);
  process.exit(1);
}
console.log("consommateur TypeScript : compile en mode strict, sans @types/node");

// 2. Chaque mutation doit être REFUSÉE. Le libellé dit ce qu'on prétend attraper.
const MUTATIONS = [
  ["un champ obligatoire retiré du contexte", "  has: () => false,\n", ""],
  ["une signature d'autorisation fausse",
    'canManageShares: (_utilisateur: unknown, action: string) => action === "create",',
    "canManageShares: (n: number) => n,"],
  // ⚠️ Pas de `as never` ici : il est assignable à TOUT, donc une telle mutation compile et ne
  // prouve rien — écrite ainsi au premier jet, elle a été rejetée par ce banc même. Une requête
  // à qui il manque `headers` est le vrai cas : c'est ce qu'un hôte se trompe à passer.
  ["une requête sans ses en-têtes", "await handler(req, res);", "await handler({ url: \"/\" }, res);"],
];

let survivantes = [];
for (const [nom, avant, apres] of MUTATIONS) {
  const mute = original.replace(avant, apres);
  if (mute === original) { survivantes.push(`${nom} — le motif n'existe plus dans la fixture`); continue; }
  writeFileSync(source, mute);
  if (!compile()) survivantes.push(nom);
  else console.log(`  mutation « ${nom} » : refusée, comme il se doit`);
  writeFileSync(source, original);
}

if (survivantes.length) {
  for (const s of survivantes) console.error(`::error::mutation acceptée par le compilateur : ${s} — les types ne vérifient rien`);
  process.exit(1);
}
console.log(`types éprouvés : ${MUTATIONS.length} mutations, toutes refusées`);
