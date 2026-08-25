// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UN JETON DE PRÉSENCE SIGNÉ DANS UN PROCESSUS DOIT ÊTRE ACCEPTÉ DANS UN AUTRE.
//
// ⚠️ SUR UN HÔTE SERVERLESS, CE N'EST PRESQUE JAMAIS LE MÊME PROCESSUS. Le participant reçoit son
// jeton du processus qui a servi son premier battement, et le présente au suivant — 25 secondes
// plus tard, ailleurs. Si le secret était mis en cache au démarrage, ou pire engendré faute de
// variable d'environnement, chaque bascule invaliderait tous les jetons en vol : les participants
// perdraient leur présence sans qu'aucun test ne bouge et sans qu'aucune erreur ne soit levée.
//
// ⚠️ ET CE FICHIER NE VIT PAS DANS `base/`, PARCE QU'IL N'A PAS BESOIN D'UNE BASE. C'est une
// propriété du SECRET, pas du SGBD. Il était d'abord écrit avec le banc multi-processus, derrière
// un Postgres — donc il n'aurait tourné que sur une étape de forge, pour une propriété que
// n'importe quel poste peut éprouver. Une garde placée trop haut coûte sa couverture.
//
// La mesure est faite dans de VRAIS processus enfants : signer et vérifier dans le même processus
// prouverait seulement que la fonction est sa propre réciproque, ce qui resterait vrai d'un secret
// engendré en mémoire — c'est-à-dire dans le cas précis qu'on veut interdire.

const { execFileSync } = require("node:child_process");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");
const contexte = JSON.stringify(path.join(RACINE, "context/standalone.js"));

const SIGNER = `
  const { createStandaloneContext } = require(${contexte});
  process.stdout.write(createStandaloneContext(process.env).identity.signPresenceToken("slug-mp", "cle-mp", 3600) || "");
`;
// ⚠️ `process.argv[1]`, PAS `[2]` — ET CE PIÈGE A FABRIQUÉ UNE FAUSSE DÉCOUVERTE. Avec `node -e`,
// il n'y a pas de chemin de script dans argv : le premier argument utilisateur est en position 1,
// pas 2. Écrit `[2]`, le vérificateur recevait `undefined` et rendait `null` — c'est-à-dire
// exactement le symptôme du défaut qu'on cherche, « un jeton signé ailleurs est refusé ». J'ai cru
// une seconde avoir trouvé une régression inter-processus ; c'était mon harnais.
const VERIFIER = `
  const { createStandaloneContext } = require(${contexte});
  process.stdout.write(JSON.stringify(createStandaloneContext(process.env).identity.verifyPresenceToken(process.argv[1])));
`;

const dans = (programme, ...args) => execFileSync(
  process.execPath, ["-e", programme, ...args],
  { env: { ...process.env, PLAYER_PRESENCE_SECRET: "secret-partage-entre-processus" }, encoding: "utf8" },
);

// ⚠️ L'ORDRE DE SUSPICION, ET IL VIENT D'UNE ERREUR COMMISE ICI MÊME.
//
// En écrivant ces essais, mon harnais lisait `process.argv[2]` alors que l'option -e de node place
// le premier argument en position 1. Le vérificateur recevait `undefined` et rendait `null` —
// c'est-à-dire EXACTEMENT le symptôme du défaut que je cherchais : « un jeton signé ailleurs est
// refusé ». J'ai cru une seconde tenir une régression inter-processus.
//
// Ce n'est pas de la malchance, c'est structurel (nommé par le second hôte) : QUAND ON CONSTRUIT UN
// INSTRUMENT POUR DÉTECTER UNE ABSENCE — un refus, un rejet, un rien — SA PANNE LA PLUS PROBABLE
// PRODUIT ELLE AUSSI UN RIEN. Un détecteur d'absence est maximalement confondable avec sa propre
// panne.
//
// D'où la règle, qui s'applique à tout couple de contrôles :
//
//   • le contrôle NÉGATIF échoue (il passe alors qu'il devrait refuser) → suspectez LE SUJET ;
//   • le contrôle POSITIF échoue (il refuse alors qu'il devrait passer)  → suspectez L'INSTRUMENT.
//
// Il n'y a qu'une façon de réussir et mille de ne rien renvoyer. Ici c'est le positif qui a échoué,
// et j'ai accusé le sujet — l'ordre inverse aurait trouvé le défaut en trente secondes.
describe("un jeton de présence traverse les processus", () => {
  it("signé dans un processus, accepté dans un AUTRE", () => {
    const jeton = dans(SIGNER).trim();
    // ⚠️ ANTI-VACUITÉ : sans secret, `signPresenceToken` rend une chaîne vide — et « vide vérifie
    // vide » passerait pour un succès. On exige donc un jeton AVANT de le vérifier.
    expect(jeton.length, "le premier processus n'a signé aucun jeton : il n'y a rien à vérifier").toBeGreaterThan(10);

    const vu = JSON.parse(dans(VERIFIER, jeton));
    expect(vu, "un jeton signé ailleurs doit être reconnu — sinon la présence se perd à chaque bascule")
      .toMatchObject({ slug: "slug-mp", key: "cle-mp" });
  });

  it("et un jeton ALTÉRÉ est refusé — sinon la vérification ne vérifie rien", () => {
    const jeton = dans(SIGNER).trim();
    expect(JSON.parse(dans(VERIFIER, jeton + "x"))).toBeNull();
    expect(JSON.parse(dans(VERIFIER, "n'importe quoi"))).toBeNull();
  });

  // ⚠️ LE CONTRÔLE QUI NOMME LA CAUSE. Les deux essais ci-dessus resteraient verts si le secret
  // était engendré au démarrage ET que les deux enfants héritaient du même — ce qui n'arrive pas
  // ici, mais qu'on ne veut pas devoir déduire. Deux secrets DIFFÉRENTS doivent se refuser : c'est
  // ce qui prouve que la vérification dépend bien du secret, et donc que le partage est ce qui fait
  // marcher les deux premiers.
  it("deux processus aux secrets DIFFÉRENTS se refusent", () => {
    const jeton = dans(SIGNER).trim();
    const autre = execFileSync(process.execPath, ["-e", VERIFIER, jeton],
      { env: { ...process.env, PLAYER_PRESENCE_SECRET: "un-autre-secret" }, encoding: "utf8" });
    expect(JSON.parse(autre), "la vérification ne dépend pas du secret : elle ne prouve rien").toBeNull();
  });
});
