// CE QUE LES EXEMPLES ONT LE DROIT D'ÉPINGLER — UNE RÈGLE, AU LIEU DE DEUX QUI SE CONTREDISENT.
//
// ⚠️ CETTE GARDE ÉTAIT ROUGE DANS L'ÉTAT NORMAL DU DÉPÔT, ET ÇA LUI A COÛTÉ UNE PR (#273, 21/08).
//
// Elle acceptait « la version de main OU la dernière publiée ». Les deux valent la même chose dès
// que la sortie est faite — donc, à la seconde où la 0.1.126 est partie sur npm, les exemples
// restés sur 0.1.125 n'étaient plus ni l'une ni l'autre. Rouge sur main, rouge sur chaque PR
// ouverte, rouge sur les suivantes. Pas un oubli isolé : L'ÉTAT QUI SUIT CHAQUE SORTIE.
//
// Le commentaire de ci.yml disait pourtant, en toutes lettres, que les exemples « se montent tout
// seuls à la sortie suivante » et que « leur retard d'une version est la propriété recherchée ».
// La garde, elle, refusait exactement ce retard-là. Le texte et le contrôle disaient le contraire,
// et c'est le contrôle qui gagne — deux personnes ont trébuché sur cette marche dans la même heure,
// et chacune l'a réparée dans une PR qui parlait d'autre chose (#273 et #276 portaient le même
// correctif de trois lignes ; l'une est morte vide).
//
// ⚠️ UNE ALERTE QUI SE DÉCLENCHE QUAND TOUT VA BIEN APPREND À PASSER OUTRE, et le jour où elle a
// raison, personne ne la lit. C'est le pire état possible pour une garde — pire que son absence,
// qui est au moins un état connu.
//
// LA RÈGLE, MAINTENANT : UN EXEMPLE ÉPINGLE L'UNE DES DEUX DERNIÈRES VERSIONS PUBLIÉES.
//
// Elle remplace les deux anciennes et les contient toutes les deux :
//
//   1. PR de sortie (main dit N+1, npm sert N, exemples sur N)  → N est la dernière publiée   → vert
//   2. PR de sortie, exemples montés à N+1 (le piège de #269)   → N+1 n'est pas encore servie → ROUGE
//   3. état stable après publication (main = npm = N, ex. = N)  → N est la dernière publiée   → vert
//   4. ⭐ après publication de N, exemples encore sur N-1        → l'avant-dernière            → vert
//   5. exemple oublié loin derrière (N-5)                       → ni l'une ni l'autre         → ROUGE
//
// Le cas 4 est le seul qui change, et c'est celui qui rougissait à chaque sortie. Le retard d'une
// version cesse d'être toléré dans une fenêtre et interdit dans l'autre : il est simplement LÉGAL,
// comme le commentaire l'affirmait déjà. Deux versions de retard restent rouges — ce que la garde
// protège (« un intégrateur qui copie reçoit un player périmé ») est intact.
//
// ⚠️ ON DEMANDE AU REGISTRE, PAS AU DÉPÔT. C'est ce que npm SERT qui compte : un exemple épingle
// ce qu'un copieur peut installer. La version de `package.json` n'entre pas dans la règle — si elle
// n'est pas encore publiée, l'épingler casserait le déploiement de la démo, qui installe depuis npm.
//
// ⚠️ REGISTRE INJOIGNABLE ⇒ ON RESSERRE, ON N'ÉLARGIT PAS. Ne pas savoir ne doit jamais autoriser
// davantage : on retombe sur la seule version que main déclare.
//
// Usage : node tools/exemples-epingles.mjs

import { readFileSync, existsSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/** Compare deux versions x.y.z numériquement — « 0.1.9 » est AVANT « 0.1.10 », pas après. */
export function comparerVersions(a, b) {
  const na = String(a).split(".").map(Number), nb = String(b).split(".").map(Number);
  for (let i = 0; i < Math.max(na.length, nb.length); i++) {
    const d = (na[i] || 0) - (nb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/**
 * Les versions qu'un exemple a le droit d'épingler : les DEUX dernières servies par le registre.
 * Sans registre, la seule que main déclare — ne pas savoir ne doit pas élargir ce qu'on autorise.
 */
export function acceptables(versionDeMain, publiees) {
  if (!publiees || !publiees.length) return [versionDeMain];
  return [...publiees].sort(comparerVersions).slice(-2).reverse();
}

export function ecartsExemples(versionDeMain, publiees, exemples) {
  const permises = acceptables(versionDeMain, publiees);
  const sansRegistre = !publiees || !publiees.length;
  return exemples
    .filter((e) => !permises.includes(e.version))
    .map((e) => sansRegistre
      ? `${e.fichier} épingle ${e.version} — le registre est injoignable, on exige donc la version de main (${versionDeMain}), sans tolérance`
      : `${e.fichier} épingle ${e.version}, qui n'est ni la dernière publiée (${permises[0]}) ni celle d'avant (${permises[1] ?? "—"}). `
        + (comparerVersions(e.version, permises[0]) > 0
          ? "Elle n'est pas encore SERVIE : le déploiement de la démo installe depuis npm et échouerait. Laissez les exemples sur une version publiée."
          : "Un copieur recevrait un player périmé."));
}

export function exemplesDuDepot(racine = ".") {
  const dossier = join(racine, "examples");
  if (!existsSync(dossier)) return [];
  const trouves = [];
  for (const e of readdirSync(dossier, { withFileTypes: true })) {
    const p = join(dossier, e.name, "package.json");
    if (!e.isDirectory() || !existsSync(p)) continue;
    const dep = JSON.parse(readFileSync(p, "utf8")).dependencies?.["discovery-media-player"];
    if (dep) trouves.push({ fichier: `examples/${e.name}/package.json`, version: dep });
  }
  return trouves;
}

export function versionsPubliees(executer = () =>
  execFileSync("npm", ["view", "discovery-media-player", "versions", "--json"], { encoding: "utf8", timeout: 60000 })) {
  try {
    const brut = JSON.parse(executer());
    return Array.isArray(brut) ? brut : [brut];
  } catch {
    return null;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const version = JSON.parse(readFileSync("package.json", "utf8")).version;
  const publiees = versionsPubliees();
  if (!publiees) console.log("::notice::registre injoignable — on exige la version de main, sans tolérance");

  const exemples = exemplesDuDepot();
  if (!exemples.length) {
    console.error("::error::aucun exemple relevé — la sonde vise à côté");
    process.exit(1);
  }
  const soucis = ecartsExemples(version, publiees, exemples);
  if (soucis.length) {
    for (const s of soucis) console.error("::error::" + s);
    process.exit(1);
  }
  // ⚠️ Cette exigence-là vivait aussi dans l'ancienne étape, et elle n'a rien à voir avec la
  // version : un exemple qui ne déclare pas son moteur se copie sur une machine où il ne tourne pas.
  if (!readFileSync("examples/demo/package.json", "utf8").includes('">=22"')) {
    console.error("::error::examples/demo/package.json ne déclare pas node >=22");
    process.exit(1);
  }
  const permises = acceptables(version, publiees);
  console.log(`exemples : ${exemples.length} sur ${permises.join(" ou ")} — servies par le registre, donc installables`);
}
