// L'INSTALLATEUR DE HOOKS — ET LE TRAVAIL DE QUELQU'UN D'AUTRE QU'IL DÉTRUISAIT.
//
// ⚠️ P2 de l'audit du 22/08 : il ne réécrivait pas quand le contenu était IDENTIQUE, et son
// commentaire disait « pour ne pas écraser une personnalisation identique ». Il nommait donc
// l'inquiétude, et ne traitait que le seul cas où elle ne s'applique pas — un `pre-push` DIFFÉRENT,
// écrit à la main, disparaissait sans un mot au premier `npm install`.
//
// La distinction qui manquait n'est pas « identique ou non » : c'est « le nôtre, plus vieux » face
// à « celui de quelqu'un d'autre ». Les deux ont un contenu différent du nôtre, et ils appellent
// l'inverse l'un de l'autre.

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { decider, SIGNATURE, estLeNotre } from "../install-hooks.mjs";

const NOTRE_HOOK = readFileSync("tools/git-hooks/pre-push", "utf8");

describe("⚠️ LA DISTINCTION QUI MANQUAIT", () => {
  it("le hook du dépôt porte sa signature — sans elle, rien de tout ceci ne tient", () => {
    expect(NOTRE_HOOK).toContain(SIGNATURE);
  });

  it("rien en place → on installe", () => {
    expect(decider({ existant: null, source: NOTRE_HOOK, aSauvegarde: false }).action).toBe("installer");
  });

  it("exactement le nôtre → on ne touche à rien", () => {
    expect(decider({ existant: NOTRE_HOOK, source: NOTRE_HOOK, aSauvegarde: false }).action).toBe("rien");
  });

  it("⚠️ le nôtre dans une version ANTÉRIEURE → on remplace, c'est la mise à jour attendue", () => {
    const vieux = `#!/bin/sh\n# ${SIGNATURE}\nexit 0\n`;
    expect(decider({ existant: vieux, source: NOTRE_HOOK, aSauvegarde: false }).action).toBe("installer");
  });

  it("⚠️ LE HOOK DE QUELQU'UN D'AUTRE → on le préserve, on ne l'écrase pas", () => {
    // Le défaut : ceci était détruit en silence, parce qu'il n'est simplement « pas identique ».
    const etranger = "#!/bin/sh\nnpm run lint || exit 1\n";
    const d = decider({ existant: etranger, source: NOTRE_HOOK, aSauvegarde: false });
    expect(d.action).toBe("chainer");
    expect(d.raison).toMatch(/pre-push\.local/);
  });

  it("⚠️ étranger ET sauvegarde déjà présente → on ne touche à RIEN et on le dit", () => {
    // Écraser `pre-push.local` détruirait le premier hook pour sauver le second. On ne choisit
    // pas à sa place.
    const d = decider({ existant: "#!/bin/sh\nautre chose\n", source: NOTRE_HOOK, aSauvegarde: true });
    expect(d.action).toBe("refuser");
    expect(d.raison).toMatch(/à la main/);
  });
});

describe("⚠️ DANS UN VRAI DÉPÔT GIT, PARCE QUE LE CHAÎNAGE NE SE DÉDUIT PAS", () => {
  // `decider` peut être juste et le hook chaîné ne rien exécuter. Ces cas montent un dépôt, y
  // posent un hook étranger, lancent l'installateur, puis EXÉCUTENT le résultat.
  const depotAvecHookEtranger = (corpsEtranger) => {
    const racine = mkdtempSync(join(tmpdir(), "hooks-"));
    execFileSync("git", ["init", "-q", racine]);
    const hooks = join(racine, ".git", "hooks");
    mkdirSync(hooks, { recursive: true });
    writeFileSync(join(hooks, "pre-push"), corpsEtranger);
    chmodSync(join(hooks, "pre-push"), 0o755);

    // L'installateur s'exécute depuis `tools/`, relativement à son propre emplacement.
    const outils = join(racine, "tools");
    mkdirSync(join(outils, "git-hooks"), { recursive: true });
    writeFileSync(join(outils, "install-hooks.mjs"), readFileSync("tools/install-hooks.mjs", "utf8"));
    writeFileSync(join(outils, "git-hooks", "pre-push"), NOTRE_HOOK);
    execFileSync(process.execPath, [join(outils, "install-hooks.mjs")], { cwd: racine, stdio: "ignore" });
    return { racine, hooks };
  };

  it("le hook étranger survit, déplacé en pre-push.local", () => {
    const { hooks } = depotAvecHookEtranger("#!/bin/sh\necho ETRANGER\nexit 0\n");
    expect(existsSync(join(hooks, "pre-push.local"))).toBe(true);
    expect(readFileSync(join(hooks, "pre-push.local"), "utf8")).toContain("echo ETRANGER");
    expect(readFileSync(join(hooks, "pre-push"), "utf8")).toContain(SIGNATURE);
  });

  it("⚠️ et il est RÉELLEMENT exécuté par le nôtre", () => {
    // Le préserver sur le disque sans jamais l'appeler serait une demi-mesure : le contributeur
    // croirait son garde-fou actif alors qu'il ne tourne plus.
    const { hooks } = depotAvecHookEtranger("#!/bin/sh\necho ETRANGER-A-TOURNE\nexit 0\n");
    const sortie = execFileSync(join(hooks, "pre-push"), { encoding: "utf8", input: "" });
    expect(sortie).toContain("ETRANGER-A-TOURNE");
  });

  it("⚠️ s'il REFUSE, on refuse — sa décision était là avant la nôtre", () => {
    const { hooks } = depotAvecHookEtranger("#!/bin/sh\necho NON\nexit 3\n");
    let code = 0;
    try {
      execFileSync(join(hooks, "pre-push"), { encoding: "utf8", input: "", stdio: "pipe" });
    } catch (e) { code = e.status; }
    expect(code).toBe(3);
  });

  it("relancer l'installateur ne fabrique pas une seconde sauvegarde", () => {
    // Idempotence : le second passage voit son propre hook et ne touche plus à rien.
    const { racine, hooks } = depotAvecHookEtranger("#!/bin/sh\necho ETRANGER\nexit 0\n");
    execFileSync(process.execPath, [join(racine, "tools", "install-hooks.mjs")], { cwd: racine, stdio: "ignore" });
    expect(readFileSync(join(hooks, "pre-push.local"), "utf8")).toContain("echo ETRANGER");
  });
});

describe("⚠️ LA TRANSITION : LES CLONES DÉJÀ FAITS N'ONT PAS LA SIGNATURE", () => {
  // Elle n'existe que depuis cette correction. Reconnaître par elle seule aurait conclu « hook
  // étranger » sur tous les clones existants, fabriqué une sauvegarde inutile et chaîné notre
  // propre hook sur lui-même — deux fois le même refus, pour rien. Une correction dont le premier
  // effet est de déranger tout le monde ne survit pas à sa première semaine.
  const HISTORIQUE = "#!/bin/sh\n# Hook pre-push du player. Un seul garde-fou.\nexit 0\n";

  it("reconnaît le hook du dépôt d'AVANT la signature", () => {
    expect(estLeNotre(HISTORIQUE)).toBe(true);
    expect(decider({ existant: HISTORIQUE, source: NOTRE_HOOK, aSauvegarde: false }).action).toBe("installer");
  });

  it("ne reconnaît pas pour autant n'importe quoi", () => {
    expect(estLeNotre("#!/bin/sh\nnpm run lint\n")).toBe(false);
    expect(estLeNotre("")).toBe(false);
  });
});

describe("⚠️ IMPORTER CE MODULE NE DOIT RIEN TOUCHER", () => {
  // Défaut introduit puis trouvé pendant cette correction elle-même. Le fichier n'exportait rien,
  // donc personne ne l'importait, donc ses effets de bord au niveau racine étaient sans
  // conséquence. En sortant `decider()` pour pouvoir l'éprouver, je l'ai rendu IMPORTABLE — et le
  // premier `import` du banc a installé des hooks dans le dépôt de travail et y a déplacé le
  // pre-push existant. Ça s'est vu à la trace laissée sur le disque, pas dans un test.
  //
  // Rendre un module testable ne doit pas le rendre agissant.
  it("un import dans un dépôt git ne crée ni ne déplace aucun hook", () => {
    const racine = mkdtempSync(join(tmpdir(), "import-inerte-"));
    execFileSync("git", ["init", "-q", racine]);
    const outils = join(racine, "tools");
    mkdirSync(join(outils, "git-hooks"), { recursive: true });
    writeFileSync(join(outils, "install-hooks.mjs"), readFileSync("tools/install-hooks.mjs", "utf8"));
    writeFileSync(join(outils, "git-hooks", "pre-push"), NOTRE_HOOK);

    // Un IMPORT, pas une exécution : `process.argv[1]` désigne le script appelant, pas le module.
    const script = join(racine, "importe.mjs");
    writeFileSync(script, `import "./tools/install-hooks.mjs";\n`);
    execFileSync(process.execPath, [script], { cwd: racine, stdio: "ignore" });

    expect(existsSync(join(racine, ".git", "hooks", "pre-push"))).toBe(false);
    expect(existsSync(join(racine, ".git", "hooks", "pre-push.local"))).toBe(false);
  });

  it("mais l'exécution directe, elle, installe bien", () => {
    // La contrepartie : la garde ne doit pas rendre l'outil inerte pour de bon.
    const racine = mkdtempSync(join(tmpdir(), "execution-"));
    execFileSync("git", ["init", "-q", racine]);
    const outils = join(racine, "tools");
    mkdirSync(join(outils, "git-hooks"), { recursive: true });
    writeFileSync(join(outils, "install-hooks.mjs"), readFileSync("tools/install-hooks.mjs", "utf8"));
    writeFileSync(join(outils, "git-hooks", "pre-push"), NOTRE_HOOK);
    execFileSync(process.execPath, [join(outils, "install-hooks.mjs")], { cwd: racine, stdio: "ignore" });

    expect(readFileSync(join(racine, ".git", "hooks", "pre-push"), "utf8")).toContain(SIGNATURE);
  });
});

describe("⚠️ IL N'ÉCRIT RIEN SUR stdout — LE CANAL DES DONNÉES N'EST PAS LE SIEN", () => {
  // Constaté en direct pendant cette correction. `prepare` s'exécute AUSSI pendant
  // `npm pack --dry-run --json`, dont `langue-publiee.mjs` parse la sortie standard. Un
  // « hooks git : pre-push installé » écrit sur stdout se retrouve devant le JSON, qui cesse d'en
  // être un : la garde de langue sortait alors 2 avec « Unexpected token 'h' » — un message qui ne
  // désigne rien de ce qui cloche.
  //
  // En CI c'était masqué : `npm ci` installe le hook avant, donc le `npm pack` qui suit n'a plus
  // rien à dire. Un défaut que seule la première exécution d'un clone frais révèle est un défaut
  // qui attend le nouvel arrivant.
  const lancerDansUnDepotNeuf = () => {
    const racine = mkdtempSync(join(tmpdir(), "canaux-"));
    execFileSync("git", ["init", "-q", racine]);
    const outils = join(racine, "tools");
    mkdirSync(join(outils, "git-hooks"), { recursive: true });
    writeFileSync(join(outils, "install-hooks.mjs"), readFileSync("tools/install-hooks.mjs", "utf8"));
    writeFileSync(join(outils, "git-hooks", "pre-push"), NOTRE_HOOK);
    const r = spawnSync(process.execPath, [join(outils, "install-hooks.mjs")], { cwd: racine, encoding: "utf8" });
    return { ...r, racine };
  };

  it("installe bien, mais sans un octet sur stdout", () => {
    const r = lancerDansUnDepotNeuf();
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/pre-push/);
    expect(existsSync(join(r.racine, ".git", "hooks", "pre-push"))).toBe(true);
  });

  it("⚠️ et le JSON qui l'entoure reste parsable", () => {
    // La propriété qui compte vraiment : ce n'est pas « stdout est vide », c'est « ce que le
    // parseur d'à côté reçoit est encore du JSON ».
    const r = lancerDansUnDepotNeuf();
    const melange = r.stdout + JSON.stringify([{ id: "x", files: [{ path: "README.md" }] }]);
    expect(() => JSON.parse(melange)).not.toThrow();
  });
});
