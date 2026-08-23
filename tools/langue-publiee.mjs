// CE QUI VOYAGE DANS LE TARBALL SE LIT PARTOUT — DONC EN ANGLAIS.
//
// ⚠️ `docs/RETENTION.md` était en français, et il partait dans le paquet publié (P1, audit externe
// du 21/08). Ce n'était pas un oubli isolé : c'est le document qu'un service juridique ou un DPO
// consulte, exposé en plus comme sous-chemin `discovery-media-player/retention` — donc résolvable
// par `require.resolve` chez n'importe quel intégrateur. Tout ce qu'il lit d'autre (README,
// contrat d'hôte, API, configuration) est en anglais ; celui-là, non.
//
// La règle du dépôt existait, mais seulement dans les têtes : les documents TOURNÉS VERS
// L'EXTÉRIEUR sont en anglais, les traces INTERNES (audits, migrations, spécifications) restent en
// français, langue dans laquelle elles ont été pensées. Une règle qui ne vit que dans les têtes est
// respectée jusqu'au jour où elle ne l'est plus, et personne ne le voit.
//
// ⚠️ LE PÉRIMÈTRE SE DÉRIVE, IL NE SE LISTE PAS. Une liste de fichiers écrite ici serait un SECOND
// EXEMPLAIRE de `package.json#files`, et ce dépôt sait ce que deviennent les exemplaires que rien
// ne confronte : ajouter un document au tarball sans penser à cette liste le ferait passer sans
// bruit. Le périmètre EST `files` : ce qui voyage, se lit ; ce qui ne voyage pas, ne regarde que
// nous.
//
// ⚠️ ET C'EST UNE HEURISTIQUE, ASSUMÉE COMME TELLE. On compte des mots-outils exclusifs à chaque
// langue, hors code (les identifiants du produit sont français — `plafond`, `supprimees`,
// `fichiersCandidats` — et ne prouvent rien sur la langue de la prose). Elle ne tranche PAS les cas
// serrés : elle ne rougit que si le français atteint l'anglais. La marge réelle mesurée sur ce
// dépôt est de deux ordres de grandeur (RETENTION.md avant traduction : 163 contre 0 ; API.md :
// 0 contre 345), donc un document honnêtement anglais ne peut pas la déclencher.
//
// Usage : node tools/langue-publiee.mjs

import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { conclure, conforme, violation, inconclusif, tenter } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

// Des mots-outils SANS RECOUVREMENT entre les deux langues : « on », « a », « as » ou « sur »
// existent des deux côtés ou dans du code, ils ne comptent pas.
const FR = ["le", "la", "les", "une", "des", "qui", "pour", "dans", "est", "pas", "nous", "avec",
  "cette", "sont", "mais", "donc", "leur", "elle", "ils", "ce", "cela", "aux", "du", "au"];
const EN = ["the", "and", "of", "that", "with", "which", "this", "for", "are", "not", "from",
  "have", "its", "was", "been", "they", "their", "there", "when", "what"];

/**
 * La prose seule : sans blocs de code ni portions entre accents graves.
 * ⚠️ Sans ça, `fichiersCandidats` et `efface.* = 0` compteraient comme du français — et ce sont
 * des identifiants du produit, pas de la prose. Un contrôle qui se trompe de matière conclut juste
 * par accident.
 */
export const prose = (txt) =>
  txt.replace(/```[\s\S]*?```/g, " ").replace(/`[^`]*`/g, " ");

export function compte(txt) {
  const mots = prose(txt).toLowerCase().match(/[a-zàâçéèêëîïôûùüÿœæ]+/g) || [];
  const n = (liste) => mots.filter((m) => liste.includes(m)).length;
  return { fr: n(FR), en: n(EN) };
}

/**
 * ⚠️ NE TRANCHE PAS LES CAS SERRÉS. Rouge seulement si le français ATTEINT l'anglais : c'est un
 * document écrit en français, pas un document anglais qui cite du français. Un document sans aucun
 * mot-outil (une table nue) ne conclut rien non plus — refuser là-dessus serait inventer un fait.
 */
export function ecartLangue(fichier, txt) {
  const { fr, en } = compte(txt);
  if (fr === 0 && en === 0) return null;
  if (fr >= en) {
    return `${fichier} voyage dans le paquet publié et n'est pas en anglais (${fr} mots-outils français contre ${en} anglais) — c'est un intégrateur qui le lira, pas nous`;
  }
  return null;
}

/**
 * ⚠️ LE PÉRIMÈTRE SE DEMANDE À npm, PAS À `package.json#files` (revue externe, 21/08).
 *
 * `files` n'est pas la liste de ce qui part : npm AJOUTE des fichiers de lui-même et DÉVELOPPE les
 * dossiers et les motifs. Constaté sur la 0.1.127 : le tarball contenait QUATRE Markdown —
 * README.md, docs/HOST-CONTRACT.md, docs/RETENTION.md, et `docs/README.md` que `files` ne nomme
 * pas. Ce quatrième voyageait sans être contrôlé.
 *
 * Il se trouve qu'il était en anglais, donc il n'y avait pas de violation. LE DÉFAUT ÉTAIT
 * AILLEURS : la garde annonçait « 3 documents publiés, tous en anglais » alors qu'elle en
 * regardait trois sur quatre. Une couverture affirmée plus large qu'elle n'est vaut moins que pas
 * de couverture du tout — on cesse de vérifier ce qu'on croit déjà tenu.
 *
 * `npm pack --dry-run --json` dit exactement ce que le registre servira. C'est la source de
 * vérité, et npm le recommande comme telle.
 */
export function markdownsDuTarball(executer = () =>
  execFileSync("npm", ["pack", "--dry-run", "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 120000 })) {
  const brut = JSON.parse(executer());
  const entree = Array.isArray(brut) ? brut[0] : brut;
  const fichiers = (entree?.files || []).map((f) => f.path).filter((p) => typeof p === "string");
  if (!fichiers.length) throw new Error("npm pack n'a rendu aucun fichier — on ne conclut pas sur un inventaire vide");
  return fichiers.filter((f) => f.toLowerCase().endsWith(".md")).sort();
}

if (estExecuteDirectement(import.meta.url)) {
  // ⚠️ `tenter` : `npm pack` peut échouer (npm absent, manifeste cassé, disque plein) et
  // `markdownsDuTarball` LÈVE sur un inventaire vide — « on ne conclut pas sur un inventaire vide ».
  // Aucun de ces cas ne dit quoi que ce soit de la langue des documents.
  conclure(tenter(() => {
    const fichiers = markdownsDuTarball();
    if (!fichiers.length) {
      return inconclusif("aucun Markdown dans le tarball — la sonde vise à côté, ou le README a cessé d'être publié");
    }
    const soucis = fichiers.map((f) => ecartLangue(f, readFileSync(f, "utf8"))).filter(Boolean);
    if (soucis.length) return violation(soucis);
    return conforme(`langue : ${fichiers.length} document(s) DU TARBALL, aucun majoritairement français — ${fichiers.join(", ")}`);
  }));
}
