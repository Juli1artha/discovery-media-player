// ON SIGNALAIT AVANT D'ÉCRIRE, ET LE COMMENTAIRE AFFIRMAIT L'INVERSE.
//
// `pushPage`, `presentContent` et `endPresent` émettaient le signal, PUIS lançaient l'écriture.
// Depuis 0.1.19 ce signal ne dit qu'une chose — « relis » — donc l'audience relisait pendant que la
// base portait encore l'ancien état. Et aucun second signal n'était garanti : la page tournée se
// perdait jusqu'au filet de resynchronisation, 25 s plus tard.
//
// ⚠️ `endPresent` était le pire des trois : il signalait, puis COUPAIT LE CANAL, puis envoyait
// l'avis de fin. Le signal partait sur un état périmé, et la coupure avant l'envoi. Une audience
// pouvait ne jamais apprendre que la présentation était terminée.
//
// Signalé par la seconde passe d'audit (P0-3).
//
// ⚠️ CE TEST PORTE SUR L'ORDRE, PAS SUR UNE CHAÎNE. Un test qui chercherait `.then(` passerait sur
// n'importe quel enchaînement ; celui-ci compare les POSITIONS de l'écriture et du signal dans le
// corps de chaque fonction. C'est la leçon des trois tests qui, aujourd'hui, épinglaient un défaut
// en croyant décrire une propriété.

const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "handler.js"), "utf8");

/** Le corps d'une fonction du gabarit navigateur, de sa déclaration à la suivante. */
function corps(nom) {
  const debut = SRC.indexOf("function " + nom + "(");
  if (debut < 0) return null;
  const suite = SRC.indexOf("\n    function ", debut + 10);
  return SRC.slice(debut, suite > 0 ? suite : debut + 1600);
}

// ⚠️ ON SUIT L'ACTE, PAS LE NOM DE LA FONCTION — TROISIÈME CORRECTION DE CETTE SONDE.
//
// Elle cherchait les corps de `pushPage` et `presentContent`. Le jour où l'envoi a été extrait dans
// `envoyerPage` et `envoyerContenu` — pour que ces deux fonctions passent par la file unique — elle
// a échoué, alors que la propriété qu'elle décrit (écrire AVANT de signaler) n'avait pas bougé d'un
// caractère.
//
// Elle part donc maintenant de l'ACTION ÉCRITE DANS LA REQUÊTE, qui est ce dont on parle vraiment.
// Une sonde qui épingle un nom interdit de renommer ; une sonde qui reconnaît un acte laisse le code
// vivre. C'est la même leçon que pour les motifs de balises et pour la liste des espaces de noms.
function corpsDeLAction(action) {
  const i = SRC.indexOf(`action:'${action}'`);
  if (i < 0) return null;
  const debut = SRC.lastIndexOf("function ", i);
  const suite = SRC.indexOf("\n    function ", i);
  return SRC.slice(debut, suite > 0 ? suite : i + 900);
}

describe("l'écriture précède le signal", () => {
  it.each(["present-page", "present-content"])("%s écrit d'abord, signale ensuite", (action) => {
    const c = corpsDeLAction(action);
    expect(c, action).toBeTruthy();
    // ⚠️ ON CHERCHE L'ACTE, PAS LE NOM DE L'APPEL. Cette ligne cherchait littéralement
    // « fetch('/api/doc' » — et elle est tombée le jour où l'appel est passé par une enveloppe
    // bornée, alors que la propriété testée (écrire AVANT de signaler) n'avait pas bougé d'un
    // caractère. Une sonde qui épingle une écriture interdit de réécrire ; une sonde qui reconnaît
    // un acte laisse le code vivre. Même leçon que pour les motifs de balises.
    const ecriture = c.search(/(?:fetch|fetchBorne)\('\/api\/doc'/);
    const signal = c.indexOf("diffuserEtat()");
    expect(ecriture, "l'appel d'écriture existe").toBeGreaterThan(0);
    expect(signal, "le signal existe").toBeGreaterThan(0);
    expect(signal, "signaler avant d'écrire fait relire un état périmé, et le changement se perd")
      .toBeGreaterThan(ecriture);
  });

  it.each(["present-page", "present-content"])("%s ne signale pas si l'écriture a échoué", (action) => {
    const c = corpsDeLAction(action);
    // Le signal doit être dans la branche de succès, pas au fil du code.
    expect(c, "sans cette garde, un refus serveur produirait quand même une relecture")
      .toMatch(/if\s*\(\s*r\s*&&\s*r\.ok\s*\)\s*diffuserEtat\(\)/);
  });
});

describe("la fin de présentation part avant la coupure", () => {
  const c = corps("endPresent");

  it("l'avis de fin est envoyé avant que le canal soit coupé", () => {
    expect(c).toBeTruthy();
    const envoi = Math.min(
      ...[c.indexOf("sendBeacon"), c.indexOf("keepalive")].filter((i) => i > 0),
    );
    const coupure = c.indexOf("Live.disconnect()");
    expect(envoi).toBeGreaterThan(0);
    expect(coupure).toBeGreaterThan(0);
    expect(coupure, "couper avant d'envoyer, c'est ne jamais dire que c'est fini")
      .toBeGreaterThan(envoi);
  });

  it("et le signal part après l'envoi, pas avant", () => {
    const envoi = Math.min(
      ...[c.indexOf("sendBeacon"), c.indexOf("keepalive")].filter((i) => i > 0),
    );
    const signal = c.indexOf("Live.sendState()");
    expect(signal).toBeGreaterThan(0);
    expect(signal).toBeGreaterThan(envoi);
  });
});

// ⚠️ Le signal d'état ne transporte plus rien. L'audience l'ignorait déjà (relecture, 0.1.19) —
// mais une charge qui part sans servir donne l'illusion qu'elle sert, et invite le suivant à s'en
// resservir. Même raison que pour `map` en 0.1.30 : on coupe le chemin, pas seulement l'usage.
describe("le signal d'état est un signal", () => {
  it("sendState ne prend plus d'argument", () => {
    expect(SRC).toMatch(/function sendState\(\)/);
  });

  it("et diffuserEtat n'en compose plus un", () => {
    expect(SRC).toMatch(/function diffuserEtat\(\)/);
    expect(corps("diffuserEtat"), "plus d'état fabriqué côté client")
      .not.toMatch(/current_page|file_url|updated_at/);
  });
});
