// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE CŒUR N'OUVRE PAS L'ENVIRONNEMENT.
//
// C'est la règle que le projet affiche partout — « tout ce que le player emprunte arrive par le
// contexte injecté » — et le cœur la violait à huit endroits : six lectures de `SUPABASE_*` et
// une de `DOC_FRAME_ANCESTORS`. Conséquences réelles, pas théoriques :
//
//   • un hôte qui branche SA base était court-circuité, sans que rien ne le signale ;
//   • `SUPABASE_SERVICE_ROLE_KEY` — la clé qui ouvre toute la base — était lue par le cœur, alors
//     que la signature d'une URL d'envoi est une capacité de l'hôte ;
//   • `embedFrameAncestors()` lisait l'environnement pendant que `?contract=1` annonçait
//     `PLAYER.config.extraFrameAncestors`. Deux sources pour une même décision de sécurité : un
//     hôte qui calcule sa liste autrement verrait la carte annoncer autre chose que ce que
//     l'en-tête CSP sert. « Configuré » et « servi » divergents À L'INTÉRIEUR du mécanisme
//     construit pour détecter cette divergence.
//
// ⚠️ Signalé par une relecture externe comme « couplage à Supabase, ajoutez une abstraction ».
// L'abstraction existait déjà (`db`, `storage`, `config` sont injectés) — c'est elle qui fuyait.
// Le diagnostic juste n'était pas « il en manque une » mais « refermez celle qui est là ».

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");

/** Fichiers du CŒUR. `bin/` et `context/` sont les ADAPTATEURS : eux ont le droit de lire l'env. */
function fichiersDuCoeur() {
  return fs.readdirSync(path.join(RACINE, "server"))
    .filter((f) => f.endsWith(".js") && !f.includes(".generated.") && f !== "__tests__")
    .map((f) => path.join(RACINE, "server", f))
    .filter((f) => fs.statSync(f).isFile());
}

/** Les lectures d'environnement, hors commentaires — un commentaire qui NOMME la variable est une explication, pas une lecture. */
function lecturesEnv(src) {
  return src
    .split("\n")
    .map((l, i) => [i + 1, l])
    .filter(([, l]) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .filter(([, l]) => /process\.env\./.test(l))
    .map(([n, l]) => [n, (l.match(/process\.env\.[A-Z0-9_]+/g) || []).join(", ")]);
}

describe("le cœur passe par le contexte, pas par l'environnement", () => {
  it("ne lit aucune configuration de base de données", () => {
    const fautes = [];
    for (const f of fichiersDuCoeur()) {
      for (const [ligne, vars] of lecturesEnv(fs.readFileSync(f, "utf8"))) {
        if (/SUPABASE/.test(vars)) fautes.push(`${path.basename(f)}:${ligne}  ${vars}`);
      }
    }
    expect(fautes, "à lire via PLAYER.config / PLAYER.db / PLAYER.storage :\n" + fautes.join("\n")).toEqual([]);
  });

  // ⚠️ Une clé de service lue par le cœur est le pire cas de la famille : elle ouvre toute la base
  // et elle contourne l'hôte qui devrait la détenir.
  it("ne lit aucun secret", () => {
    const fautes = [];
    for (const f of fichiersDuCoeur()) {
      for (const [ligne, vars] of lecturesEnv(fs.readFileSync(f, "utf8"))) {
        if (/SERVICE_ROLE|SECRET|_KEY\b/.test(vars) && !/ELEVENLABS/.test(vars)) {
          fautes.push(`${path.basename(f)}:${ligne}  ${vars}`);
        }
      }
    }
    expect(fautes, "secret lu par le cœur :\n" + fautes.join("\n")).toEqual([]);
  });

  it("n'a qu'UNE source pour les ancres de framing", () => {
    const src = require("./sourceDesPages.cjs").SOURCE_PAGES;
    const lectures = lecturesEnv(src).filter(([, v]) => /DOC_FRAME_ANCESTORS/.test(v));
    expect(lectures, "la carte d'identité et l'en-tête CSP doivent lire la MÊME chose").toEqual([]);
    expect(src).toContain("PLAYER.config.extraFrameAncestors");
  });

  // Le balayage doit voir quelque chose, sinon il passe au vert pour de mauvaises raisons —
  // il reste des `process.env` légitimes dans le cœur (ELEVENLABS, greffon de l'hôte).
  it("regarde bien quelque part", () => {
    const total = fichiersDuCoeur()
      .map((f) => lecturesEnv(fs.readFileSync(f, "utf8")).length)
      .reduce((a, b) => a + b, 0);
    expect(fichiersDuCoeur().length).toBeGreaterThanOrEqual(4);
    expect(total).toBeGreaterThan(0);
  });
});

// ⚠️ CE QUI RESTE, DIT PLUTÔT QUE TU. `ELEVENLABS_API_KEY`, `_VOICE_ID` et `_MODEL` sont encore
// lues par le cœur. C'est la même faute de forme, sur une capacité différente : la synthèse vocale
// appartient au greffon d'un hôte, pas au cœur. Le test l'admet explicitement, ce qui vaut mieux
// qu'un balayage taillé pour ne pas la voir — une exception nommée se referme un jour, une
// exception invisible jamais.
describe("ce qui n'est pas encore fait", () => {
  it("les clés de synthèse vocale restent à sortir du cœur", () => {
    const src = require("./sourceDesPages.cjs").SOURCE_PAGES;
    const restant = lecturesEnv(src).filter(([, v]) => /ELEVENLABS/.test(v));
    expect(restant.length, "si ce test tombe à 0, retirez ce bloc et l'exception du test ci-dessus").toBeGreaterThan(0);
  });
});
