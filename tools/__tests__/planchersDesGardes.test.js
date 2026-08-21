// AUCUNE GARDE NE DÉCLARE VICTOIRE SUR ZÉRO — VÉRIFIÉ SUR LA FORME, POUR TOUTES À LA FOIS.
//
// ⚠️ LA REVUE EXTERNE A TROUVÉ CE DÉFAUT OUTIL PAR OUTIL, ET C'EST LE COÛT QU'ON RETIRE ICI. La
// garde des images de base exigeait `FROM <image>` et ratait la syntaxe officielle
// `FROM --platform=… <image>` : sur un Dockerfile dont TOUS les FROM la portaient, elle imprimait
// « 0 référence(s), toutes épinglées » et sortait en 0. Verte, vide, muette sur les deux.
//
// Le constat qui accompagnait la correction est le vrai sujet : « mes cinq autres outils refusent
// quand la sonde ne trouve rien ; celui-ci était le seul où je l'avais oublié ». Une propriété tenue
// par la mémoire de son auteur tient jusqu'au jour où il l'oublie — et personne ne peut savoir
// lequel des outils est celui-là sans les essayer tous.
//
// ⚠️ ON L'ESSAIE POUR DE VRAI, ON NE LIT PAS LE SOURCE. Chercher une phrase de refus dans le texte
// serait une garde satisfaite par sa propre prose : le commentaire qui explique le refus la
// contenterait aussi bien que le refus. On monte donc un dépôt VIDE et on lance chaque outil dedans.
//
// ⚠️ ET LA LISTE NE PEUT PAS SE VIDER : tout fichier de `tools/` doit être soit ÉPROUVÉ, soit
// EXEMPTÉ avec une raison qui se vérifie mécaniquement. Un outil ajouté demain sans plancher fait
// rougir ce fichier — c'est ce qui distingue une garde d'une liste tenue à la main.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, cpSync, rmSync, writeFileSync, readFileSync, readdirSync, symlinkSync } from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const RACINE = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// ⚠️ CHAQUE EXEMPTION PORTE SA RAISON *ET* SA VÉRIFICATION. Une exemption qu'on ne peut que croire
// est une liste blanche : elle survit à la disparition de son motif. Ici, si `workflows-yaml` gagne
// un point d'entrée ou si `plus-haut-tag` cesse d'être un filtre, l'exemption rougit d'elle-même.
const EXEMPTES = {
  "workflows-yaml.mjs": {
    pourquoi: "bibliothèque de lecture YAML, sans point d'entrée : elle ne juge rien, elle est appelée",
    tientEncore: (src) => !/import\.meta\.url\s*===/.test(src),
  },
  "plus-haut-tag.mjs": {
    pourquoi: "filtre stdin → stdout : « rien en entrée, rien en sortie » EST son contrat, et c'est l'appelant qui juge une réponse vide",
    tientEncore: (src) => /process\.stdin/.test(src),
  },
  "install-hooks.mjs": {
    pourquoi: "installateur de crochets git : il agit, il ne mesure rien — il n'a pas de sonde qui puisse revenir vide",
    tientEncore: (src) => !/::error::/.test(src),
  },
  "resultat-garde.mjs": {
    pourquoi: "bibliothèque du verdict des gardes (conforme / violation / non concluant), sans point d'entrée : elle ne juge rien, elle est appelée",
    tientEncore: (src) => !/import\.meta\.url\s*===/.test(src),
  },
  "exemples-en-retard.mjs": {
    pourquoi: "sentinelle d'AVERTISSEMENT : elle n'a pas de vote dans la CI des PR et n'émet jamais de violation — sortir 0 EST son contrat",
    tientEncore: (src) => !/\bviolation\s*\(/.test(src),
  },
};

let vide;

beforeAll(() => {
  // Un dépôt qui a la FORME du nôtre et n'a RIEN dedans : c'est exactement l'état où une sonde qui
  // vise à côté est indiscernable d'un dépôt sain, et donc le seul endroit où la question se pose.
  vide = mkdtempSync(join(tmpdir(), "planchers-"));
  for (const d of ["tools", "server", "docs", "examples", "charge", "base", ".github/workflows", "src"]) {
    mkdirSync(join(vide, d), { recursive: true });
  }
  cpSync(join(RACINE, "tools"), join(vide, "tools"), { recursive: true });
  cpSync(join(RACINE, "package.json"), join(vide, "package.json"));
  writeFileSync(join(vide, "CHANGELOG.md"), "# Changelog\n");
  try { symlinkSync(join(RACINE, "node_modules"), join(vide, "node_modules")); } catch { /* déjà là */ }
});

afterAll(() => { try { rmSync(vide, { recursive: true, force: true }); } catch { /* rien */ } });

const outils = () => readdirSync(join(RACINE, "tools")).filter((f) => f.endsWith(".mjs"));

describe("aucune garde ne déclare victoire sur un dépôt vide", () => {
  it("la sonde trouve bien des outils à éprouver", () => {
    // ⚠️ LE PLANCHER DE CE FICHIER LUI-MÊME : sans lui, un `tools/` renommé rendrait ce banc vert en
    // n'éprouvant rien — la vacuité qu'il est écrit pour interdire, dans le fichier qui l'interdit.
    expect(outils().length, "aucun outil relevé : cette garde vise à côté").toBeGreaterThanOrEqual(8);
  });

  it("chaque outil est soit ÉPROUVÉ, soit EXEMPTÉ avec une raison qui tient encore", () => {
    const fautes = [];
    for (const nom of outils()) {
      const ex = EXEMPTES[nom];
      if (!ex) continue;
      const src = readFileSync(join(RACINE, "tools", nom), "utf8");
      if (!ex.tientEncore(src)) fautes.push(`${nom} : l'exemption disait « ${ex.pourquoi} » — ce n'est plus vrai du fichier`);
    }
    expect(fautes, "une exemption a survécu à son motif").toEqual([]);
  });

  const nomme = [];
  for (const nom of readdirSync(join(RACINE, "tools")).filter((f) => f.endsWith(".mjs"))) {
    if (EXEMPTES[nom]) continue;
    it(`${nom} refuse plutôt que de conclure au vert`, () => {
      let code = 0, sortie = "";
      try {
        sortie = execFileSync(process.execPath, [join("tools", nom)], { cwd: vide, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
      } catch (e) {
        code = e.status ?? 1;
        sortie = String(e.stdout || "") + String(e.stderr || "");
      }
      // ⚠️ CE QU'ON AFFIRME EST LE REFUS, PAS SA POLITESSE. Un outil qui plante sur un fichier absent
      // refuse aussi — mal, mais il ne ment pas. Nommer la cause est une qualité SÉPARÉE : l'exiger
      // de tous obligerait à réécrire des outils qui tiennent déjà la propriété qui compte.
      if (/vise à côté|aucun[e]? .*(relevé|trouvé)|plancher/i.test(sortie)) nomme.push(nom);
      expect(code, `${nom} sort en 0 sur un dépôt VIDE : il déclare victoire sur zéro`).not.toBe(0);

      // ⚠️ ET POUR CEUX QUI ONT ADOPTÉ LA TAXONOMIE, LE CODE EXACT — parce qu'un dépôt vide est LE
      // cas qu'elle sépare. `2` dit « la garde n'a pas pu regarder, le correctif n'est pas dans ta
      // branche » ; `1` accuserait l'auteur d'une situation dont il n'est pas responsable, et ce
      // dépôt sait ce que produit un rouge qu'on constate n'être pas de son fait : la fois suivante,
      // celle où la violation est réelle, le geste est déjà appris.
      //
      // La règle ne s'applique qu'aux outils qui IMPORTENT `resultat-garde` : on ne force pas une
      // migration qu'on ne mesure pas, et chaque outil qui l'adopte tombe sous la règle tout seul.
      const src = readFileSync(join(RACINE, "tools", nom), "utf8");
      if (/resultat-garde\.mjs/.test(src)) {
        expect(code, `${nom} a adopté la taxonomie mais rend ${code} sur un dépôt VIDE : « non concluant » vaut 2, et 1 accuserait l'auteur`).toBe(2);
      }
    });
  }

  // ⚠️ PAS DE RELEVÉ IMPRIMÉ ICI, ET C'EST UNE DÉCISION PLUTÔT QU'UN OUBLI. La première écriture
  // affichait « combien de refus nomment leur cause » — et ne s'imprimait JAMAIS : `npm test`
  // intercepte la console, contrairement au banc de coût dont la configuration la libère
  // explicitement (`disableConsoleIntercept`). Un relevé muet est une promesse que le code ne tient
  // pas, la classe même qu'on retire ailleurs — et je venais de la réintroduire dans le fichier
  // écrit pour l'interdire. Reste donc ce qui EST délivré : un plancher.
  //
  // ⚠️ ON AFFIRME LE REFUS, PAS SA POLITESSE. Un outil qui plante sur un fichier absent tient la
  // propriété qui compte — il ne ment pas. Exiger que chacun NOMME sa cause obligerait à réécrire
  // des outils corrects ; on se borne à exiger qu'au moins un le fasse encore, faute de quoi la
  // tournure « la sonde vise à côté » aurait disparu du dépôt sans que personne l'ait décidé.
  it("au moins un refus nomme encore sa cause plutôt que de simplement planter", () => {
    expect(nomme.length, "plus aucun outil ne dit « la sonde vise à côté » : la formule a disparu du dépôt")
      .toBeGreaterThan(0);
  });
});
