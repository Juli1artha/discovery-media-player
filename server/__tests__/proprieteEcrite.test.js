// LA GARDE DE 0.1.2 NE COUVRAIT QUE LES LECTURES.
//
// En 0.1.2, une liste blanche indexée par une donnée du dehors laissait passer `constructor` —
// parce qu'un objet littéral répond pour son prototype. La correction a mis `Object.hasOwn`
// partout et un test statique refusait toute LECTURE non gardée. Le commentaire disait « la forme
// elle-même est piégeuse ».
//
// ⚠️ Il en manquait la moitié. `Object.hasOwn` empêche de LIRE `constructor` ; rien n'empêchait de
// l'ÉCRIRE. `toggleReaction` écrivait `cur[emoji] = …` avec un emoji choisi par le participant.
//
// Ce qui nous a sauvés du pire est un ACCIDENT : le plafond de 8 caractères tronque `__proto__`
// (9) et `constructor` (11) en clés inoffensives. Mais `toString` (8) et `valueOf` (7) passaient,
// et devenaient des propriétés propres de l'objet stocké — masquant celles du prototype pour tout
// consommateur, navigateur compris.
//
// ⚠️ Et cette protection accidentelle est fragile : les emojis composés (famille, séquences ZWJ)
// dépassent 8 caractères. Le jour où quelqu'un lève le plafond pour les accepter — un changement
// d'apparence anodin — `__proto__` et `constructor` passent avec.
//
// Trouvé par l'analyse statique, pas par l'audit externe ni par nous.

const fs = require("node:fs");
const path = require("node:path");

const presentations = require("../presentations.js");

const PIEGES = ["toString", "valueOf", "__proto__", "constructor", "hasOwnProperty"];

describe("une clé écrite ne peut pas atteindre le prototype", () => {
  let ecrite = null;
  beforeEach(() => {
    ecrite = null;
    presentations.init({
      db: {
        async request(chemin, options = {}) {
          if (!options.method || options.method === "GET") return [{ reactions: {} }];
          ecrite = options.body;
          return [{ id: 1, reactions: options.body.reactions }];
        },
      },
    });
  });

  it.each(PIEGES)("%s est refusé comme réaction", async (piege) => {
    const r = await presentations.toggleReaction("Ab3-_xYz9012", 1, piege, "a@b.fr");
    expect(r.ok, piege).toBe(false);
    expect(r.status, piege).toBe(400);
    expect(ecrite, "rien ne doit être écrit").toBeNull();
  });

  it("un vrai emoji passe toujours", async () => {
    const r = await presentations.toggleReaction("Ab3-_xYz9012", 1, "👍", "a@b.fr");
    expect(r.ok).toBe(true);
    expect(Object.keys(ecrite.reactions)).toEqual(["👍"]);
  });

  // ⚠️ La seconde barrière : même si le filtre de forme sautait un jour, l'objet n'a plus de
  // prototype — il n'y a plus rien à masquer ni à atteindre, quelle que soit la clé.
  it("l'objet des réactions est construit sans prototype", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "presentations.js"), "utf8");
    expect(src, "deux barrières, parce que la première dépend d'un plafond de longueur")
      .toContain("const cur = Object.create(null)");   // déclaré NU tel quel — la forme que la garde statique reconnaît
  });
});

// ⚠️ LA GARDE QUI MANQUAIT. Celle de 0.1.2 balaye les LECTURES ; celle-ci balaye les ÉCRITURES.
// Sans elle, la prochaine `obj[valeurDuDehors] = …` passera exactement comme celle-ci est passée.
// ⚠️ CETTE GARDE A LAISSÉ PASSER LE DÉFAUT QU'ELLE DEVAIT ATTRAPER.
//
// Elle filtrait sur une LISTE DE NOMS DE VARIABLES — `body`, `q`, `emoji`, `name`… — et `id`, `k`,
// `sid` n'y étaient pas. Les agrégateurs de `shares.js` sont donc passés entiers : `byDoc[id]`,
// `byUser[k]`, `sessMax[sid]`, tous indexés par des données du dehors, tous en clair.
//
// Le rapport le dit mieux que je ne l'aurais fait : une expression régulière sur des noms de
// variables ne peut servir que d'alarme complémentaire. Elle est donc élargie — toute clé qui n'est
// ni un littéral ni un compteur de boucle est suspecte — et surtout, elle n'est plus seule : les
// propriétés sont exercées sur du code exécuté dans `clefsHeritees.test.js`, avec les cinq clés
// héritées. C'est ce test-là qui protège ; celui-ci ne fait que signaler la forme. (audit P1-2)
describe("aucune écriture indexée par une donnée du dehors", () => {
  const RACINE = path.join(__dirname, "..", "..");
  // Élargi : on ne liste plus ce qui vient du dehors, on exclut ce qui n'en vient certainement pas.
  const SUREMENT_INTERNE = /^(i|j|n|k2|idx|index|len|pos|ligne|col)$/;

  function fichiersDuCoeur() {
    return fs.readdirSync(path.join(RACINE, "server"))
      .filter((f) => f.endsWith(".js") && !f.includes(".generated."))
      .map((f) => path.join(RACINE, "server", f))
      .filter((f) => fs.statSync(f).isFile());
  }

  it("il n'en existe aucune sans objet nu ni validation de forme", () => {
    const suspects = [];
    for (const f of fichiersDuCoeur()) {
      const src = fs.readFileSync(f, "utf8");
      const lignes = src.split("\n");
      lignes.forEach((ligne, i) => {
        if (/^\s*(\/\/|\*)/.test(ligne)) return;
        // `quelquechose[cle] = …` où `cle` n'est ni un littéral ni un nombre.
        for (const m of ligne.matchAll(/(\w+)\[([A-Za-z_$][\w$.]*)\]\s*=[^=]/g)) {
          const [, objet, cle] = m;
          if (SUREMENT_INTERNE.test(cle)) continue;                        // compteurs de boucle
          // ⚠️ ON CHERCHE LA DÉCLARATION DE L'OBJET, PAS UN VOISINAGE. La première version regardait
          // 25 lignes en arrière : elle ratait tout dictionnaire déclaré en tête de module et
          // utilisé cent lignes plus bas — c'est-à-dire tous ceux du gabarit navigateur. Une
          // fenêtre est une approximation de portée ; le nom, lui, est exact.
          const declare = new RegExp(objet + "\\s*[=:]\\s*(Object\\.create\\(null\\)|new Map\\()");
          if (declare.test(src)) continue;
          // Ou la clé validée juste avant l'écriture.
          const contexte = lignes.slice(Math.max(0, i - 25), i + 1).join("\n");
          if (/Object\.hasOwn|test\(\s*e\s*\)|allowlist/.test(contexte)) continue;
          suspects.push(`${path.basename(f)}:${i + 1}  ${objet}[${cle}] = …`);
        }
      });
    }
    expect(suspects, "écriture indexée par une donnée du dehors :\n" + suspects.join("\n")).toEqual([]);
  });

  it("le balayage regarde bien quelque part", () => {
    expect(fichiersDuCoeur().length).toBeGreaterThanOrEqual(4);
  });
});
