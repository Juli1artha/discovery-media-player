// « SUIS-JE LE PROGRAMME PRINCIPAL ? » SE DEMANDE À UN SEUL ENDROIT.
//
// ⚠️ QUATORZE OUTILS POSAIENT LA QUESTION, EN TROIS ORTHOGRAPHES, ET TOUTES ÉTAIENT FAUSSES SUR
// macOS. Node résout les liens symboliques pour l'URL du module mais PAS pour `process.argv[1]` :
// sur un chemin sous `/var/folders/…` (lien vers `/private/var/folders/…`), les deux côtés désignent
// le même fichier sans se ressembler. Le bloc n'est jamais exécuté — l'outil démarre, ne fait rien,
// et sort en 0. Quatre essais des crochets git échouaient ainsi sur macOS en restant verts en forge,
// `/tmp` sous Linux n'étant pas un lien.
//
// ⚠️ ET LA LEÇON AVAIT DÉJÀ ÉTÉ VÉCUE LE MATIN MÊME, dans ce dépôt : une racine non normalisée,
// `/var/folders` contre `/private/var/folders`, faisait rendre `null` à un autre banc. Vécue,
// corrigée, racontée — et huit heures plus tard la même résolution de lien cassait une autre garde.
// Ce qui manquait n'était pas l'attention : c'est qu'aucun mécanisme ne comparait des chemins
// normalisés à la place de celui qui écrit. D'où ce fichier. (Diagnostic du second hôte.)
//
// ⚠️ LA GARDE PORTE SUR LA FORME, PAS SUR LE COMPORTEMENT — parce que le comportement fautif est
// INVISIBLE : un outil qui ne s'exécute pas rend 0 et se tait. On ne peut pas l'observer en le
// lançant sans savoir d'avance ce qu'il aurait dû faire ; on peut interdire l'écriture qui produit
// le défaut.

const fs = require("node:fs");
const path = require("node:path");

const DOSSIER = path.join(__dirname, "..");
const HELPER = "execute-directement.mjs";

/** Les trois écritures constatées, dont une n'encodait même pas les caractères spéciaux. */
const FORMES = [
  /import\.meta\.url\s*===\s*pathToFileURL\(/,
  /import\.meta\.url\s*===\s*`file:\/\//,
  /import\.meta\.url\s*===\s*[A-Za-z_$][\w$]*\(process\.argv/,
];

/** Sans les commentaires : ce fichier et le helper CITENT les formes interdites pour les expliquer. */
const sourceUtile = (t) => t.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");

const outils = () => fs.readdirSync(DOSSIER).filter((f) => f.endsWith(".mjs") && f !== HELPER);

// ⚠️ L'AXE QUE LA MATRICE DE FORGE NE COUVRE JAMAIS : LES DONNÉES.
//
// Une matrice multiplie les SYSTÈMES — trois plateformes, deux versions de Node — et jamais les
// données. Trois plateformes sur une seule éprouvette, c'est UN test, pas trois. Elle donne pourtant
// l'impression contraire, et c'est ce qui la rend coûteuse : on croit avoir élargi la couverture
// alors qu'on a élargi la dimension qui n'était pas en cause. (Formulé par le second hôte.)
//
// Les deux incidents de ce dépôt le disent. La forme `import.meta.url === \`file://${argv}\`` était
// fausse sur les TROIS plateformes depuis toujours — il manquait une ESPACE dans un chemin, pas un
// système d'exploitation. Et un `check (22)` rouge avec `check (24)` vert a ressemblé trois fois à
// une différence de version de Node : c'était un caractère, un CHANGELOG, un compte périmé. Une
// matrice ne se contente pas de ne pas trouver — elle propose une explication plausible et fausse,
// parce qu'elle est le seul axe visible du tableau.
//
// Ce cas ajoute donc la donnée manquante, et rien d'autre : un chemin qui porte une espace et des
// accents. C'est exactement ce que l'ancienne orthographe ratait, et ce qu'aucune plateforme
// n'aurait révélé.
describe("le chemin peut porter une espace et des accents", () => {
  const { execFileSync } = require("node:child_process");
  const { mkdtempSync, mkdirSync, writeFileSync, copyFileSync, rmSync } = require("node:fs");
  const { tmpdir } = require("node:os");

  const SONDE = [
    'import { estExecuteDirectement } from "./execute-directement.mjs";',
    'process.stdout.write(String(estExecuteDirectement(import.meta.url)));',
  ].join("\n");

  const IMPORTATEUR = [
    'import { estExecuteDirectement } from "./execute-directement.mjs";',
    'import "./sonde.mjs";',
    'process.stdout.write("|importé:" + String(estExecuteDirectement(import.meta.url)));',
  ].join("\n");

  let dossier;
  beforeAll(() => {
    // Une espace ET des accents : deux caractères que `file://` + concaténation n'encode pas.
    dossier = path.join(mkdtempSync(path.join(tmpdir(), "axe-")), "un dossier accentué ÉÀ");
    mkdirSync(dossier, { recursive: true });
    copyFileSync(path.join(DOSSIER, HELPER), path.join(dossier, HELPER));
    writeFileSync(path.join(dossier, "sonde.mjs"), SONDE);
    writeFileSync(path.join(dossier, "importateur.mjs"), IMPORTATEUR);
  });
  afterAll(() => { try { rmSync(path.dirname(dossier), { recursive: true, force: true }); } catch { /* rien */ } });

  it("lancé directement depuis un tel chemin, le module se reconnaît", () => {
    const sortie = execFileSync(process.execPath, [path.join(dossier, "sonde.mjs")], { encoding: "utf8" });
    expect(sortie.trim(), "l'ancienne orthographe rendait `false` ici, sur TOUTE plateforme").toBe("true");
  });

  // ⚠️ CONTRÔLE NÉGATIF : sans lui, un helper qui rendrait TOUJOURS vrai passerait le cas ci-dessus.
  // C'est la moitié qui dit que la réponse dépend bien de la question posée.
  it("et importé depuis un autre module, il ne se reconnaît pas", () => {
    const sortie = execFileSync(process.execPath, [path.join(dossier, "importateur.mjs")], { encoding: "utf8" });
    expect(sortie, "la sonde importée doit dire false, l'importateur true").toBe("false|importé:true");
  });
});

describe("un seul endroit décide si un module est lancé directement", () => {
  it("la sonde trouve bien des outils à examiner", () => {
    expect(outils().length, "aucun outil relevé : cette garde vise à côté").toBeGreaterThanOrEqual(8);
  });

  // ⚠️ CONTRÔLE POSITIF : cette garde affirme une ABSENCE, donc sa panne la plus probable — un motif
  // qui ne correspond à rien — produit elle aussi une absence, c'est-à-dire un vert. On vérifie donc
  // que les motifs reconnaissent les formes qu'ils prétendent interdire avant de conclure au silence.
  it("les motifs reconnaissent bien les trois écritures fautives", () => {
    const echantillons = [
      "if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {",
      "if (import.meta.url === `file://${process.argv[1]}`) {",
      "if (import.meta.url === pathToFileURLSafe(process.argv[1])) {",
    ];
    for (const e of echantillons) {
      expect(FORMES.some((f) => f.test(e)), `forme non reconnue : ${e}`).toBe(true);
    }
  });

  it("aucun outil ne compare lui-même l'URL du module à argv[1]", () => {
    const fautes = [];
    for (const nom of outils()) {
      const src = sourceUtile(fs.readFileSync(path.join(DOSSIER, nom), "utf8"));
      if (FORMES.some((f) => f.test(src))) {
        fautes.push(`tools/${nom} compare lui-même l'URL du module à argv[1] — Node normalise l'une et pas l'autre. `
          + `Importez \`estExecuteDirectement\` depuis ./${HELPER}, qui compare des chemins RÉELS.`);
      }
    }
    expect(fautes, "une comparaison de chemins non normalisés est revenue").toEqual([]);
  });

  it("et le helper existe, avec la normalisation qui le justifie", () => {
    const src = fs.readFileSync(path.join(DOSSIER, HELPER), "utf8");
    // Sans `realpathSync` des DEUX côtés, le helper ne vaut pas mieux que ce qu'il remplace.
    expect((src.match(/realpathSync\(/g) || []).length,
      "le helper doit normaliser les deux chemins, sinon il déplace le défaut sans le corriger")
      .toBeGreaterThanOrEqual(2);
  });
});
