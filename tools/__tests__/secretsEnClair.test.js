// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA GARDE DES SECRETS — ÉPROUVÉE SUR CE QU'ELLE ATTRAPE *ET* SUR CE QU'ELLE LAISSE PASSER.
//
// ⚠️ CE BANC N'ÉCRIT AUCUN SECRET, MÊME FAUX. Il les FABRIQUE par concaténation à l'exécution.
// La raison n'est pas la coquetterie : un fichier de test qui contient `AKIA` suivi de seize
// majuscules EST un fichier que la garde doit refuser, et le dépôt se retrouverait à devoir
// exempter son propre banc — l'exemption devenant le trou par lequel un vrai secret entre. Le
// banc se termine d'ailleurs par la vérification que ni lui ni la garde ne se déclenchent
// eux-mêmes : c'est la propriété qui rend toute exemption inutile.
//
// ⚠️ ET LA MOITIÉ DES CAS SONT DES NON-DÉCLENCHEMENTS. Une garde de sécurité qu'on n'éprouve que
// sur ses vrais positifs se règle naturellement vers « sonner plus », jusqu'à ce que ses lecteurs
// apprennent à passer outre — et ce jour-là elle ne protège plus rien tout en paraissant intacte.
// La clé publiable de Supabase, le gabarit `<votre-clé>` et la variable vide sont donc éprouvés
// avec autant de soin que la clé `service_role`.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { secretsDeTexte, secretsDeEnv, inspecter, estJetonServiceRole, ESPECES, ECHANTILLONS, especesSansEchantillon, temoinNonVu, fichiersSuivis } from "../secrets-en-clair.mjs";

const ICI = dirname(fileURLToPath(import.meta.url));

/** Un JWT de la forme exacte qu'émet Supabase, dont on choisit le rôle. */
const jeton = (role) =>
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9" +
  "." + Buffer.from(JSON.stringify({ iss: "supabase", role, iat: 1 })).toString("base64url") +
  "." + "c2lnbmF0dXJlLWRlLXRlc3Q";

// Chaque faux secret est assemblé, jamais écrit. Le commentaire dit ce qu'il imite.
const FAUX = {
  "clé privée PEM": "-".repeat(5) + "BEGIN RSA PRIVATE KEY" + "-".repeat(5),
  "identifiant de clé AWS": "AKIA" + "QRSTUVWX2345YZ67",
  "jeton GitHub": "ghp_" + "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6q7r8",
  "jeton npm": "npm_" + "z9y8x7w6v5u4t3s2r1q0p9o8n7m6l5k4j3i2",
  "jeton Slack": "xoxb-" + "123456789012-abcdefghijkl",
  "clé d'API Google": "AIza" + "SyD-1234567890abcdefghijklmnopqrstu",
  "clé secrète Stripe (live)": "sk_live_" + "51AbCdEfGhIjKlMnOpQrStUv",
};

describe("les espèces reconnaissables à leur forme", () => {
  for (const [espece] of ESPECES) {
    it(`refuse un ${espece}`, () => {
      const trouves = secretsDeTexte(`const jeton = "${FAUX[espece]}";`);
      expect(trouves.map((t) => t.espece), `${espece} n'a pas été reconnu`).toContain(espece);
      expect(trouves[0].ligne).toBe(1);
    });
  }

  it("nomme la ligne, pas seulement le fichier", () => {
    const texte = ["// rien", "// rien non plus", `const k = "${FAUX["jeton GitHub"]}";`].join("\n");
    expect(secretsDeTexte(texte)[0].ligne).toBe(3);
  });

  it("laisse passer ce qui ressemble à de l'aléatoire sans en être", () => {
    // ⚠️ LES TROIS FAUX POSITIFS QUI AURAIENT COÛTÉ LA GARDE. Ce dépôt épingle ses actions sur des
    // SHA de 40 caractères, sert ses pages sous un nonce CSP, et verrouille ses images sur un
    // condensat sha256. Les trois sont des chaînes opaques et longues ; aucune n'est un secret.
    const texte = [
      "uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7",
      "FROM node:24-alpine@sha256:" + "b".repeat(64),
      "script-src 'nonce-r4nd0mB4s3SixtyFourValue=='",
      "const empreinte = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';",
    ].join("\n");
    expect(secretsDeTexte(texte)).toEqual([]);
  });
});

describe("le JWT, où la forme ne suffit pas", () => {
  it("refuse la clé service_role, qui contourne toute politique de ligne", () => {
    const trouves = secretsDeTexte(`SUPABASE_SERVICE_ROLE_KEY=${jeton("service_role")}`);
    expect(trouves.map((t) => t.espece)).toContain("jeton Supabase service_role");
  });

  it("laisse passer la clé publiable, qui a vocation à partir dans un navigateur", () => {
    // Sonner ici rendrait la garde fausse le jour où une documentation montre l'intégration
    // côté client — exactement le faux positif qui apprend à cliquer à côté.
    expect(secretsDeTexte(`SUPABASE_PUBLISHABLE_KEY=${jeton("anon")}`)).toEqual([]);
  });

  it("ne prend pas pour un JWT ce qui n'en est pas un", () => {
    expect(estJetonServiceRole("eyJ.pas-du-base64-valide.xx")).toBe(false);
    expect(estJetonServiceRole("sans-le-moindre-point")).toBe(false);
  });
});

describe("la règle des .env : le NOM trahit ce que la forme ne dit pas", () => {
  it("refuse une valeur écrite en face d'un nom qui annonce un secret", () => {
    // Le cas réel : quelqu'un remplit `.env.example` pour faire tourner la démo chez lui, et le
    // commite avec le reste. La valeur n'a aucune forme reconnaissable — seul le nom la trahit.
    const trouves = secretsDeEnv("PLAYER_HOST_FETCH_SECRET=une-phrase-de-passe-quelconque");
    expect(trouves).toHaveLength(1);
    expect(trouves[0].espece).toMatch(/PLAYER_HOST_FETCH_SECRET/);
  });

  it("refuse aussi quand la valeur est citée", () => {
    expect(secretsDeEnv('SUPABASE_SERVICE_ROLE_KEY="une-valeur"')).toHaveLength(1);
    expect(secretsDeEnv("PLAYER_IP_HASH_SECRET='une-valeur'")).toHaveLength(1);
  });

  it("accepte le vide — c'est la convention tenue par .env.example", () => {
    expect(secretsDeEnv("SUPABASE_SERVICE_ROLE_KEY=\nPLAYER_PRESENCE_SECRET=  ")).toEqual([]);
  });

  it("accepte un gabarit qui se désigne comme tel", () => {
    const texte = [
      "PLAYER_HOST_SHARE_SECRET=<votre-secret>",
      "PLAYER_AUTH_KEY=changeme",
      "PLAYER_HOST_MAIL_SECRET=xxx",
      "ELEVENLABS_API_KEY=your-api-key",
    ].join("\n");
    expect(secretsDeEnv(texte)).toEqual([]);
  });

  it("ne dit rien des variables dont le nom n'annonce pas un secret", () => {
    const texte = "PLAYER_SOURCE_URL=https://github.com/Juli1artha/discovery-media-player\nPLAYER_LOCAL_ROOT=./documents";
    expect(secretsDeEnv(texte)).toEqual([]);
  });

  it("ne s'applique qu'aux fichiers .env — ailleurs, un nom pareil est du code", () => {
    // `server/` lit ces variables ; une ligne `const PLAYER_HOST_FETCH_SECRET = lire(...)` ne doit
    // pas sonner. La règle du nom est réservée aux fichiers qui STOCKENT des valeurs.
    const lire = () => "PLAYER_HOST_FETCH_SECRET=une-valeur-quelconque";
    expect(inspecter(["server/config.js"], lire)).toEqual([]);
    expect(inspecter([".env.example"], lire)).toHaveLength(1);
  });
});

describe("ce que la garde délivre", () => {
  it("ne recopie JAMAIS le secret dans son constat", () => {
    // ⚠️ LA PROPRIÉTÉ LA PLUS IMPORTANTE DE CE FICHIER. Un journal de CI est public sur un dépôt
    // public : une garde qui imprime ce qu'elle a trouvé divulgue le secret une seconde fois, à un
    // endroit qui ne se révoque pas. Le constat doit suffire à le RETROUVER, jamais à l'utiliser.
    const secret = FAUX["jeton GitHub"];
    const constats = inspecter(["src/quelque-chose.ts"], () => `const t = "${secret}";`);
    expect(constats).toHaveLength(1);
    expect(constats[0], "le secret a été recopié dans le message d'erreur").not.toContain(secret);
    expect(constats[0]).toContain("src/quelque-chose.ts:1");
    expect(constats[0]).toMatch(/RÉVOQUEZ/);
  });

  it("n'analyse pas un binaire", () => {
    // Le PDF de démonstration produirait des correspondances au hasard de ses octets.
    const constats = inspecter(["examples/demo/documents/sample.pdf"], () => `%PDF-1.4\0${FAUX["identifiant de clé AWS"]}`);
    expect(constats).toEqual([]);
  });

  it("ne se déclenche ni sur la garde, ni sur ce banc", () => {
    // ⚠️ C'EST CETTE PROPRIÉTÉ QUI REND TOUTE EXEMPTION INUTILE — et une exemption est toujours le
    // trou par lequel un vrai secret finit par entrer. Si quelqu'un écrit un jour un motif en
    // clair plutôt qu'en classe de caractères, ou colle un faux secret littéral ici, ce test
    // rougit avant que l'exemption soit envisagée.
    for (const f of ["../secrets-en-clair.mjs", "./secretsEnClair.test.js"]) {
      expect(secretsDeTexte(readFileSync(join(ICI, f), "utf8")), `${f} se déclenche lui-même`).toEqual([]);
    }
  });
});

describe("⚠️ LA RÈGLE DE NOM, APRÈS RELECTURE", () => {
  // Deux défauts opposés, trouvés à la relecture de la PR qui a introduit cette garde.

  it("⚠️ un commentaire dotenv en fin de ligne n'est pas une valeur", () => {
    // `SECRET=   # openssl rand -base64 48` est l'idiome standard : valeur VIDE, plus la manière
    // de l'engendrer. La garde y voyait un secret en clair et bloquait `pre-push` ET la CI. Une
    // garde qui sonne quand tout va bien apprend à passer outre.
    expect(secretsDeEnv("PLAYER_IP_HASH_SECRET=   # openssl rand -base64 48")).toEqual([]);
    expect(secretsDeEnv("PLAYER_IP_HASH_SECRET=# sans espace avant")).toEqual([]);
  });

  it("⚠️ mais une VRAIE valeur suivie d'un commentaire reste refusée", () => {
    // La contrepartie : on pourrait faire taire la garde en ajoutant « # » après le secret.
    expect(secretsDeEnv("PLAYER_HOST_FETCH_SECRET=vrai-secret # posé pour la démo")).toHaveLength(1);
    // Et un « # » sans espace devant fait partie de la valeur, comme pour dotenv.
    expect(secretsDeEnv("PLAYER_HOST_FETCH_SECRET=abc#def")).toHaveLength(1);
    // Cité, le « # » appartient au secret : le tronquer ne jugerait qu'un morceau.
    expect(secretsDeEnv('PLAYER_HOST_FETCH_SECRET="abc # def"')).toHaveLength(1);
  });

  it("⚠️ le mot n'a pas à être en FIN de nom", () => {
    // La première version était ancrée en `…$` : elle voyait `…_SECRET` et ratait ceux-ci, qui
    // sont pourtant des noms courants — et c'est exactement la classe de secrets que cette règle
    // existe pour attraper, puisqu'elle n'a aucune forme reconnaissable.
    for (const nom of ["SECRET_KEY_BASE", "API_TOKEN_VALUE", "PRIVATE_KEY_PATH", "SIGNING_KEYS", "PASSWORD_FILE"]) {
      expect(secretsDeEnv(`${nom}=une-valeur-reelle`), nom).toHaveLength(1);
    }
  });

  it("⚠️ sans refuser ce qui n'est pas un secret", () => {
    // L'excès inverse use la garde aussi sûrement que le manque.
    for (const ligne of ["KEYCLOAK_URL=https://kc.example", "TOKENIZER_MODE=fast", "MONKEY_PATCH=1"]) {
      expect(secretsDeEnv(ligne), ligne).toEqual([]);
    }
  });

  it("⚠️ et une clé PUBLIABLE porte sa valeur, c'est sa raison d'être", () => {
    // `SUPABASE_PUBLISHABLE_KEY` est FAITE pour atteindre un navigateur. C'est la distinction que
    // ce fichier fait déjà plus haut en décodant les JWT pour ne refuser que `service_role`.
    for (const ligne of ["SUPABASE_PUBLISHABLE_KEY=sb_publishable_abc", "SUPABASE_ANON_KEY=ey.abc", "PLAYER_PUBLIC_TOKEN=abc"]) {
      expect(secretsDeEnv(ligne), ligne).toEqual([]);
    }
  });
});


// ⚠️ LE TÉMOIN DE LA RÈGLE — INJECTÉ, PARCE QUE L'ÉTAT SAIN EST ZÉRO OCCURRENCE.
//
// Cette garde affirme une ABSENCE. Sa panne la plus probable produit elle aussi une absence : tout
// le périmètre vert sans rien avoir mesuré. Mesuré le 31/08 en aveuglant la sonde — l'outil
// imprimait « 429 fichier(s) inspecté(s), aucun identifiant » et sortait 0.
describe("le témoin posé : la sonde voit-elle encore un identifiant ?", () => {
  it("ne dit rien quand la sonde voit", () => {
    expect(temoinNonVu()).toBeNull();
  });

  it("⚠️ nomme le refus quand la sonde est aveugle", () => {
    expect(temoinNonVu(() => [])).toMatch(/n'a pas vu 9 forme\(s\) qu'on venait de poser/);
  });

  // ⚠️ LA PROPRIÉTÉ NEUVE, ET CELLE QUI MANQUAIT : UNE SEULE FORME AVEUGLE DOIT ÊTRE NOMMÉE.
  // Le témoin d'avant plantait un unique échantillon `AKIA` — il prouvait qu'UNE espèce sur huit
  // était encore vue. Mesuré le 01/09 par un balayage qui aveugle chaque expression du fichier :
  // dix-neuf motifs sur vingt pouvaient cesser de reconnaître quoi que ce soit sans que la garde
  // cesse d'être verte. Un test qui n'éprouve qu'une sonde TOTALEMENT muette ne voit pas ça.
  it("⚠️ une sonde aveugle à UNE SEULE forme est nommée, pas seulement une sonde muette", () => {
    for (const [nom, , faire] of ECHANTILLONS) {
      // Une sonde BORGNE : elle voit tout, sauf l'échantillon de cette espèce-là. C'est la panne
      // réelle — un motif qui cesse de reconnaître SA forme — et non une sonde muette.
      const attendu = `${faire()}\n`;
      const borgne = (fichiers, lire) => (lire(fichiers[0]) === attendu ? [] : inspecter(fichiers, lire));
      const dit = temoinNonVu(borgne);
      expect(dit, `${nom} peut devenir invisible sans que le témoin le dise`).toBeTypeOf("string");
      expect(dit).toContain(nom);
    }
  });

  // ⚠️ UNE ESPÈCE SANS ÉCHANTILLON RÉDUIRAIT LA COUVERTURE EN SILENCE. Ajouter un motif à
  // `ESPECES` sans son échantillon rendrait la forme invisible au témoin le jour même où on la
  // déclare chercher — et personne ne relit un témoin en ajoutant un motif.
  // ⚠️ ET LE CONTRÔLE DE COUPLAGE EST ÉPROUVÉ DANS LES DEUX SENS. Son état sain est la liste
  // VIDE : l'affirmer sur le dépôt tel quel ne distingue pas « rien ne manque » de « la fonction
  // ne cherche plus rien ». Mesuré le 01/09 — la museler passait le banc. On lui donne donc des
  // tables où une espèce N'A PAS d'échantillon, et on exige qu'elle la nomme.
  it("⚠️ il NOMME une espèce sans échantillon — sinon son vide ne prouve rien", () => {
    const especes = [["forme éprouvée", /a/], ["forme orpheline", /b/]];
    const echantillons = [["forme éprouvée", "__t", () => "a"]];
    expect(especesSansEchantillon(especes, echantillons)).toEqual(["forme orpheline"]);
  });

  it("⚠️ chaque espèce cherchée a son échantillon au témoin", () => {
    expect(especesSansEchantillon(), "une forme est cherchée sans être éprouvée").toEqual([]);
    expect(ECHANTILLONS.length, "sept espèces de forme, le JWT et la règle des .env")
      .toBeGreaterThanOrEqual(ESPECES.length + 2);
  });

  // ⚠️ ET LE TÉMOIN N'EST PAS ÉCRIT DANS LE SOURCE. Cette garde balaie `tools/`, le sien compris :
  // un faux identifiant en clair y serait signalé par elle-même, on l'exempterait, et l'exemption
  // deviendrait le trou que son en-tête décrit. Il est donc assemblé à l'exécution.
  it("⚠️ le faux identifiant du témoin n'apparaît nulle part en clair dans le dépôt suivi", () => {
    const litteral = "AKIA" + "Z".repeat(16);
    const suivis = fichiersSuivis([]);
    const porteurs = suivis.filter((f) => {
      try { return readFileSync(f, "utf8").includes(litteral); } catch { return false; }
    });
    expect(porteurs, "le témoin est écrit en clair quelque part : la garde finira par s'accuser").toEqual([]);
  });
});
