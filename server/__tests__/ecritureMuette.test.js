// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE RÈGLE ÉCRITE DANS UN COMMENTAIRE NE PROTÈGE PAS LE CODE QUI LA SUIT.
//
// En 0.1.35 nous avons écrit, dans `upsertInternalSession` : « ce n'est pas la garde qui était en
// cause, c'est son mutisme ». Trois lignes plus bas, dans la fonction appelante, un
// `catch { /* best-effort */ }` avalait l'échec de l'écriture elle-même.
//
// La ligne construite portait `ua` et `ip` ; la table des sessions internes ne les a pas. PostgREST
// refusait (« column "ua" ... does not exist »), le catch avalait, la route répondait
// `{"ok":true}`. ⚠️ Résultat : le suivi interne n'a JAMAIS rien écrit — ni chez le second hôte, ni
// chez nous. Notre table de production comptait ZÉRO ligne, et rien nulle part ne le disait.
//
// Le second hôte l'a formulé mieux que nous :
//
//   « ça montre qu'une règle écrite dans un commentaire ne protège pas le code qui la suit »
//
// D'où ce fichier. La règle devient une barrière : « best-effort » donne le droit de CONTINUER,
// jamais celui de NE RIEN DIRE.

const fs = require("node:fs");
const path = require("node:path");

const RACINE = path.join(__dirname, "..", "..");

function fichiersServeur() {
  return fs.readdirSync(path.join(RACINE, "server"))
    .filter((f) => f.endsWith(".js") && !f.includes(".generated.") && !f.startsWith("__"))
    .map((f) => path.join(RACINE, "server", f));
}

// ⚠️ LA FORME, PAS UNE LISTE DE NOMS.
//
// La première version listait `upsertInternalSession|upsertSession|logView|…`. Elle a manqué
// `recordUnlock`, qui écrit directement par `PLAYER.db.request` — trouvé en vérifiant le tarball de
// 0.1.37, pas par la garde. C'est exactement le reproche que l'audit faisait à la garde des
// prototypes (« elle filtrait sur des NOMS DE VARIABLES »), reproduit le jour même dans une garde
// écrite pour éviter ce genre de chose.
//
// Une liste ne voit que ce qu'on y a mis. Une forme voit aussi le prochain.
//
// ⚠️ MAIS SEULEMENT LES ÉCRITURES, et la distinction n'est pas cosmétique : une ÉCRITURE perdue
// l'est pour toujours, une LECTURE ratée sera refaite au prochain appel. Un `catch` qui ramène un
// compteur d'affichage à zéro est un choix légitime ; un `catch` qui perd une mesure ne l'est
// jamais. La première version de cette forme accusait les deux — trop large dans un sens après
// avoir été trop étroite dans l'autre.
const APPEL_BASE = /(PLAYER\.)?db\.request\(/;
const VERBE_ECRITURE = /method:\s*"(POST|PATCH|PUT|DELETE)"/;
const HELPERS_ECRITURE = /\b(upsertInternalSession|upsertSession|logView|logShareEvent|recordAttendance)\s*\(/;
const estEcriture = (ligne, suite) =>
  HELPERS_ECRITURE.test(ligne) || (APPEL_BASE.test(ligne) && VERBE_ECRITURE.test(suite));

describe("aucune écriture de mesure n'est rattrapée en silence", () => {
  it("chaque try qui enveloppe une écriture a un catch qui parle", () => {
    const muets = [];
    for (const f of fichiersServeur()) {
      const lignes = fs.readFileSync(f, "utf8").split("\n");
      lignes.forEach((ligne, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(ligne)) return;                       // un commentaire la cite
        if (/^\s*(async\s+)?function\s/.test(ligne)) return;           // sa déclaration
        // Le verbe peut être sur la ligne suivante quand l'appel est réparti.
        if (!estEcriture(ligne, lignes.slice(i, i + 3).join("\n"))) return;
        // ⚠️ ON COMPTE EN LIGNES, PAS EN CARACTÈRES. La première version bornait la fenêtre à
        // 400 caractères : un `catch` dont le corps commence par un long commentaire — c'est-à-dire
        // exactement celui qu'on venait d'écrire pour expliquer la règle — sortait de la fenêtre
        // avant son `capture(`, et la garde accusait le code corrigé. Une sonde qui se trompe de
        // fenêtre invente des coupables et masque les vrais.
        // ⚠️ ET ON S'ARRÊTE À LA FRONTIÈRE DE FONCTION. Sans ça, une écriture qui n'est PAS dans
        // un try/catch — l'erreur remonte, c'est correct — se voyait attribuer le `catch` de la
        // fonction SUIVANTE. La garde accusait alors du code irréprochable.
        //
        // Troisième correction de cette sonde, et c'est le sujet : une garde vaut ce que vaut sa
        // lecture. Les trois erreurs ont été trouvées en la faisant tourner, jamais en la relisant.
        const brut = lignes.slice(i, i + 40);
        const finFonction = brut.findIndex((l, n) => n > 0 && /^(async\s+)?function\s/.test(l));
        const fenetre = finFonction > 0 ? brut.slice(0, finFonction) : brut;
        const iCatch = fenetre.findIndex((l) => /}\s*catch\s*(\([^)]*\))?\s*\{/.test(l));
        if (iCatch < 0) return;                                        // pas de try/catch : rien à dire

        // ⚠️ ET ON S'ARRÊTE À LA FIN DU `catch`, PAS N LIGNES PLUS LOIN. Deuxième correction de
        // cette sonde : en prenant 30 lignes fixes, elle débordait sur le bloc SUIVANT et y
        // trouvait un `capture(` qui n'était pas le sien. Une mutation l'a montré — en remettant le
        // catch muet, la garde restait verte. Une garde qui lit à côté ne garde rien.
        // ⚠️ On compte À PARTIR du mot `catch`. La ligne est `} catch (e) {` : l'accolade
        // FERMANTE du `try` la précède, et compter depuis le début du texte refermait le bloc
        // immédiatement — la sonde ne lisait alors qu'une ligne, et accusait même le code corrigé.
        // Troisième version de cette extraction ; les deux premières lisaient à côté.
        const corps = (() => {
          const lignesCatch = fenetre.slice(iCatch);
          let profondeur = 0, sortie = [], commence = false;
          for (let n = 0; n < lignesCatch.length; n++) {
            const l = lignesCatch[n];
            const texte = n === 0 ? l.slice(l.indexOf("catch")) : l;
            sortie.push(texte);
            for (const c of texte) { if (c === "{") { profondeur++; commence = true; } else if (c === "}") profondeur--; }
            if (commence && profondeur <= 0) break;
          }
          return sortie.join("\n");
        })();
        // Parler, c'est journaliser OU répondre une erreur à l'appelant. Se taire ET répondre 200,
        // c'est ce qui fait disparaître une mesure sans laisser de trace.
        //
        // ⚠️ ET ON SUIT UN SAUT, PARCE QUE LA GARDE N'EN SUIVAIT AUCUN. Un `catch` qui appelle un
        // helper de journalisation du même fichier PARLE — mais cette sonde ne lisait que les
        // formes directes, et accusait donc le code qui factorise. Quatrième correction de cette
        // sonde, et la même à chaque fois : elle vaut ce que vaut sa lecture.
        //
        // ⚠️ ON RÉSOUT LE CORPS, ON N'ACCEPTE PAS LE NOM. Ajouter « journaliser » à la liste des
        // formes qui parlent aurait suffi à passer — et aurait vidé la garde le jour où quelqu'un
        // écrit un `journaliser` muet : elle aurait été satisfaite par un identifiant. On va donc
        // LIRE la fonction appelée. Un seul saut : deux niveaux d'indirection dans un catch de
        // rattrapage sont un problème en soi, et une garde qui suit tout finit par tout excuser.
        const corpsDe = (nom) => {
          const debut = lignes.findIndex((l) => new RegExp(`^\\s*(async\\s+)?function\\s+${nom}\\s*\\(`).test(l));
          if (debut < 0) return "";
          const suite = lignes.slice(debut, debut + 40);
          const fin = suite.findIndex((l, n) => n > 0 && /^(async\s+)?function\s/.test(l));
          return (fin > 0 ? suite.slice(0, fin) : suite).join("\n");
        };
        // ⚠️ RELANCER, C'EST PARLER — et la règle écrite dix lignes plus haut le disait déjà :
        // « parler, c'est journaliser OU répondre une erreur à l'appelant ». Un `throw` dans un
        // `catch` est la forme la plus directe de la seconde branche, et elle manquait au motif :
        // la garde accusait donc un rattrapage qui trie (« ce cas-ci je le connais, tout le reste
        // remonte ») — c'est-à-dire le contraire d'un silence. Cinquième correction de cette
        // sonde, et toujours la même : elle vaut ce que vaut sa lecture.
        const DIT = /capture\s*\(|console\.(warn|error)|statusCode\s*=\s*5|\b\w+\(5\d\d\s*,|\bthrow\b/;
        const appeles = [...corps.matchAll(/(?:await\s+)?([A-Za-z_$][\w$]*)\s*\(/g)].map((m) => m[1]);
        const parle = DIT.test(corps) || appeles.some((nom) => DIT.test(corpsDe(nom)));
        if (!parle) muets.push(`${path.basename(f)}:${i + 1}  ${ligne.trim().slice(0, 70)}`);
      });
    }
    expect(muets, "écriture de mesure rattrapée en silence :\n" + muets.join("\n")).toEqual([]);
  });

  it("le balayage regarde bien quelque part", () => {
    expect(fichiersServeur().length).toBeGreaterThanOrEqual(4);
  });
});

// ⚠️ LE SCHÉMA AVAIT RAISON, C'EST LE CODE QUI MENTAIT.
//
// La correction n'était PAS d'ajouter les colonnes : une lecture interne, c'est un collègue, et
// `device`/`os`/`browser` — dérivés — suffisent. On ne conserve pas l'agent complet ni l'adresse de
// ses propres équipes. La table des sessions EXTERNES les porte, elle, parce que ce n'est ni la
// même population ni la même promesse.
//
// Mettre le schéma au niveau du code aurait fait l'inverse du bon sens : ce qu'on garde sur ses
// propres équipes ne se décide pas par un message d'erreur PostgREST.
describe("ce qu'une session interne conserve, et ce qu'elle ne conserve pas", () => {
  const shares = require("../shares.js");
  let ligne = null;

  beforeEach(() => {
    ligne = null;
    shares.init({ db: { async request(_c, o) { ligne = o && o.body && o.body[0]; return []; } },
      limits: { async allow() { return true; } }, errors: { capture() {} } });
  });

  it("elle ne porte ni agent complet ni adresse", async () => {
    await shares.upsertInternalSession(
      { sessionId: "s1", docId: "d1" },
      { ip: "203.0.113.9", ua: "Mozilla/5.0 (Macintosh) Chrome/120" },
    );
    expect(ligne, "la ligne doit être construite").toBeTruthy();
    expect(Object.keys(ligne), "la table n'a pas ces colonnes, et c'est voulu")
      .not.toContain("ua");
    expect(Object.keys(ligne)).not.toContain("ip");
    expect(JSON.stringify(ligne), "aucune adresse ne doit s'y retrouver, sous quelque clé que ce soit")
      .not.toContain("203.0.113.9");
  });

  it("mais elle porte bien ce qui décrit la lecture", async () => {
    await shares.upsertInternalSession(
      { sessionId: "s1", docId: "d1" },
      { ip: "203.0.113.9", ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X) Chrome/120 Safari/537" },
    );
    for (const c of ["device", "os", "browser"]) expect(Object.keys(ligne), c).toContain(c);
    expect(ligne.os, "les champs dérivés restent renseignés").toBeTruthy();
  });

  // La population externe garde `ua` — la distinction est le produit, pas un détail. Elle ne garde
  // PLUS l'adresse : la colonne a été purgée puis supprimée par la 0026 (arbitrage ADV du
  // 01/09/2026), après que la 0.1.146 eut cessé de la servir.
  it("la session EXTERNE conserve l'agent, source des champs dérivés", async () => {
    await shares.upsertSession(
      { slug: "s", doc_id: "d1" }, { sessionId: "s1" },
      { ip: "203.0.113.9", ua: "Mozilla/5.0 Chrome/120" },
    );
    expect(Object.keys(ligne), "deux populations, deux promesses").toContain("ua");
  });

  // ⚠️ ET L'ADRESSE N'EST PLUS ÉCRITE NON PLUS — LA MOITIÉ QUE LE CODE NE POUVAIT PAS RÉGLER SEUL.
  // Ne plus la SERVIR (0.1.146) laissait treize mois de journal la porter en clair. La colonne
  // n'existe plus : si cette écriture la posait encore, chaque battement de chaque lecteur partirait
  // en erreur PostgREST — ce cas est donc autant une garde de rétention qu'une garde de service.
  it("⚠️ mais elle n'écrit plus l'adresse — la colonne n'existe plus", async () => {
    await shares.upsertSession(
      { slug: "s", doc_id: "d1" }, { sessionId: "s1" },
      { ip: "203.0.113.9", ua: "Mozilla/5.0 Chrome/120" },
    );
    expect(Object.keys(ligne), "la 0026 a supprimé la colonne : l'écrire ferait échouer l'upsert")
      .not.toContain("ip");
    expect(JSON.stringify(ligne), "aucune adresse, sous quelque clé que ce soit")
      .not.toContain("203.0.113.9");
  });

  // ⚠️ ET L'APPELANT CONTINUE DE LA PASSER, exprès : il ne sait pas ce que chaque table conserve.
  // Ce qui vaut d'être éprouvé, c'est que la lui passer ne casse RIEN — sinon la prochaine personne
  // « nettoierait » les appelants et l'adresse ressortirait par la porte du refactoring.
  it("⚠️ passer l'adresse reste sans effet et sans erreur, des deux côtés", async () => {
    await expect(shares.upsertSession({ slug: "s", doc_id: "d1" }, { sessionId: "s1" },
      { ip: "198.51.100.4", ua: "x" })).resolves.toBeUndefined();
    expect(JSON.stringify(ligne)).not.toContain("198.51.100.4");
    await expect(shares.upsertSession({ slug: "s", doc_id: "d1" }, { sessionId: "s2" }, { ua: "x" }))
      .resolves.toBeUndefined();
    expect(ligne.session_id, "sans adresse du tout, l'écriture se fait pareil").toBe("s2");
  });
});
