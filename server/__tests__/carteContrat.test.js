// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA CARTE PUBLIÉE ET LE CONTRAT ÉCRIT DOIVENT PORTER LES MÊMES CHAMPS.
//
// ⚠️ La garde qui existait ÉNUMÉRAIT quatre noms (`separateIssuer`, `hostShare`, `hostMail`,
// `retentionSweep`) et vérifiait qu'ils figuraient dans le code ET dans la doc. Elle ne pouvait donc
// pas voir ce qu'elle ne nommait pas : les trois champs de présence ajoutés cette semaine
// (`presenceStrict`, `presenceJetons`, `presenceDurcissement`) étaient publiés depuis des jours sans
// figurer au contrat, et rien ne rougissait. C'est la classe « une garde qui énumère se vide » —
// d'autant plus verte qu'elle sert moins. (Relevé par un audit externe.)
//
// On ne nomme donc plus rien : on REND une vraie carte et on compare l'ensemble de ses clés de
// premier niveau à l'exemple du contrat. Un champ ajouté demain rougit sans que personne y pense.

const fs = require("node:fs");
const path = require("node:path");
const RACINE = path.join(__dirname, "..", "..");
const CONTRAT = fs.readFileSync(path.join(RACINE, "docs", "HOST-CONTRACT.md"), "utf8");
const player = require("../handler.js");

function contexte() {
  return {
    plugins: {}, has: () => false,
    storage: { isAllowedUrl: () => true, async fetchFile() { return null; }, async put() {} },
    db: { async request() { return []; }, async selectAll() { return []; } },
    mail: { async send() {} },
    identity: { async verifyToken() { return null; }, roleOf: () => "", isAdmin: () => false, async canManageShares() { return false; } },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://x.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [] },
  };
}

async function carteReelle() {
  player.init(contexte());
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  await player.handler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, res);
  return JSON.parse(res.body);
}

/** L'exemple JSON sous « ## Identity card » du contrat. */
function exempleDuContrat() {
  const i = CONTRAT.indexOf("## Identity card");
  const bloc = CONTRAT.slice(i, CONTRAT.indexOf("```", CONTRAT.indexOf("```json", i) + 7));
  return bloc.slice(bloc.indexOf("```json") + 7);
}

describe("le contrat écrit décrit la carte réellement publiée", () => {
  // RELEVÉ DU JOUR — témoin daté : 15 clés de premier niveau le 2026-08-21. Seuil LARGE : ce n'est
  // pas une mesure de couverture mais un détecteur d'effondrement (un champ retiré est légitime,
  // la moitié de la carte qui disparaît ne l'est pas).
  const PLANCHER_CLES = 10;

  it("la carte rend bien des champs — sans quoi la comparaison serait vide et toujours verte", async () => {
    const cles = Object.keys(await carteReelle());
    expect(cles.length,
      `la carte ne rend plus que ${cles.length} champs (relevé 15 le 2026-08-21). Le rendu a\n`
      + "probablement changé de forme : cette garde comparerait alors deux ensembles vides.")
      .toBeGreaterThanOrEqual(PLANCHER_CLES);
  });

  it("CHAQUE champ publié figure dans l'exemple du contrat", async () => {
    const exemple = exempleDuContrat();
    const manquants = Object.keys(await carteReelle()).filter((k) => !exemple.includes(`"${k}"`));
    expect(manquants,
      `des champs sont publiés sans figurer au contrat : ${manquants.join(", ")}.\n`
      + "Un hôte qui lit docs/HOST-CONTRACT.md ne saura pas qu'ils existent — et ceux d'entre eux qui\n"
      + "disent l'état d'une garde ne seront lus par personne. Ajoutez-les à l'exemple de la carte.")
      .toEqual([]);
  });

  it("et l'exemple ne promet pas de champ que la carte ne rend pas", async () => {
    const reelle = new Set(Object.keys(await carteReelle()));
    const promis = [...exempleDuContrat().matchAll(/^\s*"([A-Za-z]\w*)":/gm)].map((m) => m[1]);
    const fantomes = promis.filter((k) => !reelle.has(k));
    expect(fantomes,
      `le contrat annonce des champs que la carte ne rend pas : ${fantomes.join(", ")}.\n`
      + "Un hôte qui s'y fie lira `undefined` — une promesse est plus coûteuse qu'un silence.")
      .toEqual([]);
  });
});

// ⚠️ LE CHAMP EXISTE POUR RÉPONDRE À UNE QUESTION QUI N'EN AVAIT PAS. Le plafond d'admission du
// cache de lecture rend un 503 réessayable depuis longtemps ; rien ne comptait combien de fois. La
// décision d'optimiser le chemin chaud du battement se tranchait donc au flair.
describe("lectureSaturee — un compte, et la fenêtre qui le rend lisible", () => {
  const champ = async () => (await carteReelle()).lectureSaturee;

  it("rend les trois clés, jamais l'une sans les autres", async () => {
    expect(Object.keys(await champ()).sort()).toEqual(["derniereIlYaS", "fenetreS", "total"]);
  });

  it("⚠️ `fenetreS` accompagne TOUJOURS `total` — sans elle, « 0 refus » se lit « on ne sature pas »", async () => {
    const c = await champ();
    // Le piège exact : un processus qui vient de démarrer n'a rien observé. Le total ne dit alors
    // rien du système, seulement de la durée pendant laquelle on a regardé. Même règle que
    // `presenceFusion: "inconnu"`, qui veut dire « personne n'a regardé » et non « tout va bien ».
    expect(typeof c.fenetreS, "un total sans sa fenêtre ment par omission").toBe("number");
    expect(c.fenetreS).toBeGreaterThanOrEqual(0);
  });

  it("`derniereIlYaS` vaut `null` quand rien n'a été refusé — pas 0, qui se lirait « à l'instant »", async () => {
    expect((await champ()).derniereIlYaS).toBeNull();
  });

  it("le contrat DÉCRIT le piège, il ne se contente pas de nommer les clés", () => {
    // `CONTRAT` est déjà lu en tête de fichier, sur un chemin ABSOLU : le relire ici avec un chemin
    // relatif ferait dépendre le banc du répertoire d'où on le lance.
    expect(CONTRAT).toContain("lectureSaturee");
    expect(CONTRAT, "un hôte qui lit `total` seul en tirera une conclusion fausse").toContain("only mean anything together");
    expect(CONTRAT, "derrière un répartiteur, ce compte est celui de l'instance qui a répondu").toContain("process-local");
  });
});

// ⚠️ LA CARTE ENTIÈRE PASSE LA GARDE DE L'HÔTE, OU ELLE NE SORT PAS — ET LE BALAYAGE EST LE SIEN.
//
// Une garde d'hôte refuse toute carte d'identité contenant `supabase|secret|key|token`. Elle
// protège une réponse PUBLIQUE contre la fuite d'une URL de projet, d'une clé ou d'un jeton, et
// c'est un balayage de TEXTE : elle ne distingue pas un nom de champ d'une valeur, ni un mot
// innocent d'un secret. Notre doctrine face à elle est écrite depuis `presenceTokens` →
// `presenceJetons` : ON CHANGE CE QU'ON ÉMET, ON NE DEMANDE PAS DE DESSERRER.
//
// Cette doctrine vivait en prose, et elle a été tenue deux fois par vigilance humaine — puis ratée
// la troisième, quand `connues` a publié des chemins préfixés `supabase/migrations/`. Une règle
// tenue par habitude a un taux de couverture que personne ne mesure : celui-ci le mesure, sur ce
// que la carte rend RÉELLEMENT, clés comprises.
//
// ⚠️ ET IL BALAIE LE JSON SÉRIALISÉ, pas l'objet. C'est ce que fait la garde d'en face, et un
// balayage de l'objet raterait exactement ce qu'un balayage de texte attrape.
describe("la carte publiée ne contient aucun mot que la garde d'un hôte refuse", () => {
  const MOTIF_HOTE = /supabase|secret|key|token/i;

  it("rien dans la carte rendue ne déclenche le motif", async () => {
    const texte = JSON.stringify(await carteReelle());
    const trouve = texte.match(new RegExp(MOTIF_HOTE.source, "gi")) || [];
    expect(trouve,
      `la carte contient ${trouve.length} occurrence(s) de mots que la garde d'un hôte refuse : `
      + `${[...new Set(trouve)].join(", ")}.\n`
      + "Cette garde balaie la carte ENTIÈRE et la refuse en bloc — pas seulement le champ fautif,\n"
      + "donc un mot de trop prive l'hôte de TOUTE la carte, y compris des champs qui disent l'état\n"
      + "de ses migrations.\n\n"
      + "Changez ce que nous émettons : renommez le champ, ou retirez le mot de la valeur. Ne\n"
      + "demandez pas à l'hôte d'assouplir sa garde — desserrer est ce qui vide une garde, et à ce\n"
      + "compte-là chaque hôte devrait tailler la sienne. (Vue tirer sur `presenceTokens`, puis sur\n"
      + "les chemins de migration de `connues`.)")
      .toEqual([]);
  });

  // ⚠️ CONTRÔLE POSITIF. Sans lui, ce banc passerait aussi bien sur une carte vide ou un motif mort.
  it("et le balayage mord vraiment — sur une carte à laquelle on ajoute le mot", async () => {
    const carte = await carteReelle();
    const empoisonnee = JSON.stringify({ ...carte, exemple: "https://abcdefgh.supabase.co" });
    expect(MOTIF_HOTE.test(empoisonnee),
      "le motif ne mord pas sur une URL de projet : le banc du dessus ne prouverait rien").toBe(true);
  });
});
