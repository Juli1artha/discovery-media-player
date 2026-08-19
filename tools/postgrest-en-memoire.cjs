// UN POSTGREST EN MÉMOIRE — la base d'essai qui manquait (constat P2-3).
//
// Le player ne parle à sa base que par HTTP, et la garde de portabilité de la forge interdit
// depuis longtemps la syntaxe exotique : toutes ses requêtes sont de la forme
// `table?colonne=eq.valeur`. Cette discipline, prise pour rendre un portage possible, rend aussi
// possible ce fichier — la surface est assez petite pour être réimplémentée honnêtement.
//
// Ce qu'il débloque : la visionneuse tracée et la page d'audience, qui exigent une base et
// n'étaient donc exercées par AUCUN essai de bout en bout. Elles portent chacune leur propre
// politique de sécurité, leur propre chemin d'authentification, et c'est là que vit le risque.
//
// ⚠️ IL REFUSE PLUTÔT QUE D'INVENTER. Une doublure qui répond « aucun résultat » à une requête
// qu'elle n'a pas comprise transforme un essai en fiction : tout passe, et ce qui est mesuré n'a
// aucun rapport avec la production. Chaque filtre inconnu, chaque opérateur non implémenté renvoie
// donc un 400 qui NOMME ce qu'il n'a pas su faire. Le jour où le player apprend une nouvelle forme
// de requête, ce fichier le dit au lieu de mentir en silence.
//
// ⚠️ CE N'EST PAS UNE BASE. Pas de transactions, pas de contraintes, pas de types, pas de RLS —
// et surtout PAS un substitut pour vérifier ce qui relève du SGBD (un verrou optimiste concurrent,
// une contrainte d'unicité). Ce qu'il permet de vérifier, c'est le chemin qui va de la requête HTTP
// à la page rendue. Confondre les deux serait la pire façon de s'en servir.

const http = require("node:http");

const OPERATEURS = {
  eq: (valeur, attendu) => String(valeur ?? "") === attendu,
  gte: (valeur, attendu) => String(valeur ?? "") >= attendu,
  lte: (valeur, attendu) => String(valeur ?? "") <= attendu,
  in: (valeur, attendu) => decouperListe(attendu).includes(String(valeur ?? "")),
  // `not.is.true` : « pas vrai », ce qui inclut `null` — la nuance qui distingue un partage
  // d'essai d'un partage ordinaire dont la colonne n'a jamais été renseignée.
  "not.is": (valeur, attendu) => (attendu === "true" ? valeur !== true : valeur !== null),
  is: (valeur, attendu) => (attendu === "null" ? valeur == null : String(valeur) === attendu),
};

function decouperListe(brut) {
  return String(brut).replace(/^\(|\)$/g, "").split(",").map((v) => v.replace(/^"|"$/g, ""));
}

/** `colonne=eq.valeur` → prédicat. Tout ce qui n'est pas reconnu fait échouer la requête. */
function versPredicat(colonne, brut) {
  const texte = String(brut);
  for (const nom of ["not.is", "eq", "gte", "lte", "in", "is"]) {
    if (texte.startsWith(nom + ".")) {
      const attendu = texte.slice(nom.length + 1);
      return (ligne) => OPERATEURS[nom](ligne[colonne], attendu);
    }
  }
  throw new Error(`filtre non implémenté : ${colonne}=${texte}`);
}

/**
 * Serveur d'essai. Rend `{ serveur, tables }` — `tables` étant { nom: [lignes] }, mutable, et
 * c'est voulu : un essai doit pouvoir constater ce que le player a ÉCRIT, pas seulement ce qu'il
 * a lu. C'est bien l'objet RENDU qu'il faut inspecter (cf. ci-dessous).
 */
function creerPostgrestEnMemoire(graine = {}) {
  // ⚠️ UN OBJET SANS PROTOTYPE, et pas seulement un nom de table filtré. Le filtre par la forme
  // (ci-dessous) refuse déjà `__proto__`, mais il protège par ce qu'il RECONNAÎT ; celui-ci
  // protège par ce qui n'existe pas. Sur une table indexée par le réseau, la seconde garantie est
  // la seule qui tienne encore le jour où quelqu'un assouplit la première.
  //
  // ⚠️ Conséquence pour l'appelant : c'est l'objet RENDU qu'il faut inspecter, pas celui qu'il a
  // passé. Une doublure qui écrirait ailleurs que là où l'essai regarde serait une façon très
  // efficace de rendre tous les essais verts.
  // ⚠️ LE JEU DE TABLES EST FIXÉ À LA CONSTRUCTION, et c'est la troisième version de cette
  // ligne. Elle a d'abord indexé un objet par le nom venu de l'URL — le constat C-6, réintroduit
  // deux heures après l'avoir corrigé ailleurs, et repéré par CodeQL, pas par moi. Filtrer le nom
  // par sa forme ne suffisait pas : `__proto__` s'écrit en minuscules et underscore. Supprimer le
  // prototype rendait la chose inoffensive, mais laissait une écriture par clé venue du dehors.
  //
  // La sortie est aussi la plus FIDÈLE : un vrai PostgREST ne crée pas une table parce qu'on l'a
  // nommée, il répond que la relation n'existe pas. Le registre est donc une `Map` close, et un
  // essai doit DÉCLARER les tables où le player écrira — ce qui a le mérite de rendre ce schéma
  // visible, au lieu de le laisser apparaître au fil des requêtes.
  const registre = new Map(Object.entries(graine));
  // Vue sans prototype pour l'appelant : mêmes tableaux, donc un essai constate bien ce qui a été
  // écrit. Sans prototype parce qu'un essai peut, lui aussi, nommer une table `constructor`.
  const tables = Object.create(null);
  for (const [nom, lignes] of registre) tables[nom] = lignes;

  let sequence = 1;

  const serveur = http.createServer(async (req, res) => {
    const repondre = (code, corps) => {
      res.writeHead(code, { "Content-Type": "application/json" });
      res.end(corps === undefined ? "" : JSON.stringify(corps));
    };

    try {
      const url = new URL(req.url, "http://interne");
      if (!url.pathname.startsWith("/rest/v1/")) return repondre(404, { message: "hors /rest/v1" });
      const nom = url.pathname.slice("/rest/v1/".length);
      if (!nom) return repondre(400, { message: "table absente" });
      // ⚠️ LE NOM DE TABLE VIENT DU RÉSEAU, ET IL INDEXE UN OBJET. C'est le constat C-6, corrigé
      // dans `flattenPresence` deux heures plus tôt, réintroduit ici sans y penser — et c'est
      // CodeQL qui l'a vu, pas moi. Une règle qu'on vient d'écrire ne protège pas du geste
      // qu'elle interdit ; seule une machine qui relit chaque ligne le fait.
      //
      // Ici la conséquence dépasse la doublure : `tables["__proto__"]` rend `Object.prototype`,
      // et le `push` qui suit y écrirait des index et une longueur — le prototype de TOUT le
      // processus d'essai, player compris. Un faux serveur corromprait le vrai code qu'il teste.
      //
      // Un nom de table est un identifiant : on le reconnaît par sa FORME plutôt que d'énumérer
      // ce qu'on refuse, et la doublure refuse le reste comme elle refuse un filtre inconnu.
      // Comme PostgREST : une relation qu'on n'a pas déclarée n'existe pas. Le message la nomme —
      // un essai à qui il manque une table doit le lire, pas déduire d'un tableau vide.
      if (!registre.has(nom)) return repondre(404, { message: `relation inexistante : ${nom.slice(0, 60)}` });
      const lignes = registre.get(nom);

      const parametres = url.searchParams;
      const prefer = String(req.headers.prefer || "");
      const filtres = [];
      let colonnes = null, tri = null, limite = null, conflit = null;

      for (const [cle, valeur] of parametres) {
        if (cle === "select") { colonnes = valeur === "*" ? null : valeur.split(","); continue; }
        if (cle === "order") { const [c, sens] = valeur.split("."); tri = { c, desc: sens === "desc" }; continue; }
        if (cle === "limit") { limite = Number(valeur); continue; }
        if (cle === "on_conflict") { conflit = valeur; continue; }
        if (cle === "offset") throw new Error("offset non implémenté (et interdit par la garde de portabilité)");
        filtres.push(versPredicat(cle, valeur));
      }

      // ⚠️ ON PARCOURT LA LIGNE, PAS LA LISTE DEMANDÉE — troisième fois aujourd'hui qu'un nom venu
      // du réseau allait servir de clé d'écriture, et la même correction que pour le nom de table :
      // écrire sous des clés qu'on possède déjà, et se servir de ce qui vient du dehors seulement
      // pour FILTRER. Le sens de la boucle est toute la différence entre les deux.
      //
      // Conséquence assumée : une colonne demandée mais absente de la ligne ne figure pas dans la
      // réponse, là où PostgREST rendrait `null` si la colonne existe au schéma. La doublure n'a
      // pas de schéma — elle ne peut donc pas distinguer « colonne vide » de « colonne inexistante »
      // et ne prétend plus le faire.
      const projeter = (ligne) => {
        if (!colonnes) return { ...ligne };
        const demandees = new Set(colonnes);
        const out = {};
        for (const [cle, valeur] of Object.entries(ligne)) if (demandees.has(cle)) out[cle] = valeur;
        return out;
      };
      const retenues = () => lignes.filter((l) => filtres.every((f) => f(l)));

      if (req.method === "GET") {
        let resultat = retenues();
        if (tri) {
          resultat = [...resultat].sort((a, b) => {
            const x = String(a[tri.c] ?? ""), y = String(b[tri.c] ?? "");
            return (x < y ? -1 : x > y ? 1 : 0) * (tri.desc ? -1 : 1);
          });
        }
        // `Range` : la pagination que `selectAll` utilise pour lire au-delà du lot par défaut.
        const plage = /^(\d+)-(\d+)$/.exec(String(req.headers.range || ""));
        if (plage) resultat = resultat.slice(Number(plage[1]), Number(plage[2]) + 1);
        if (limite != null) resultat = resultat.slice(0, limite);
        return repondre(200, resultat.map(projeter));
      }

      const corps = await lireCorps(req);

      if (req.method === "POST") {
        const entrantes = Array.isArray(corps) ? corps : [corps];
        const ecrites = [];
        for (const brute of entrantes) {
          const ligne = { id: sequence++, ...brute };
          // `on_conflict` + `resolution=merge-duplicates` : le remplacement par clé, tel que le
          // player s'en sert pour les sessions de lecture.
          const existante = conflit && prefer.includes("merge-duplicates")
            ? lignes.find((l) => String(l[conflit] ?? "") === String(brute[conflit] ?? ""))
            : null;
          if (existante) { Object.assign(existante, brute); ecrites.push(existante); }
          else { lignes.push(ligne); ecrites.push(ligne); }
        }
        return prefer.includes("return=representation")
          ? repondre(201, ecrites.map(projeter))
          : repondre(201, undefined);
      }

      if (req.method === "PATCH") {
        const touchees = retenues();
        for (const ligne of touchees) Object.assign(ligne, corps);
        return prefer.includes("return=representation")
          ? repondre(200, touchees.map(projeter))
          : repondre(204, undefined);
      }

      if (req.method === "DELETE") {
        const touchees = new Set(retenues());
        for (let i = lignes.length - 1; i >= 0; i--) if (touchees.has(lignes[i])) lignes.splice(i, 1);
        return repondre(204, undefined);
      }

      return repondre(405, { message: `méthode non implémentée : ${req.method}` });
    } catch (erreur) {
      // ⚠️ 400 EXPLICITE, jamais un tableau vide. Le message part dans la réponse ET dans la
      // console : un essai qui échoue doit dire ce que la doublure n'a pas su faire, sinon on
      // cherche le défaut dans le player alors qu'il est ici.
      //
      // ⚠️ Et ce qu'on journalise vient du réseau : sans nettoyage, un retour chariot dans une URL
      // fabriquerait une SECONDE ligne de journal, d'apparence parfaitement normale. On lit un
      // journal pour comprendre ce qui s'est passé — y laisser écrire une ligne inventée en fait
      // le contraire d'un journal.
      console.error("[postgrest-en-mémoire] " + JSON.stringify(erreur.message) + " — " + JSON.stringify(req.method + " " + req.url));
      repondre(400, { message: erreur.message });
    }
  });

  return { serveur, tables };
}

function lireCorps(req) {
  return new Promise((resolve) => {
    const morceaux = [];
    req.on("data", (c) => morceaux.push(c));
    req.on("end", () => {
      const texte = Buffer.concat(morceaux).toString("utf8");
      try { resolve(texte ? JSON.parse(texte) : {}); } catch { resolve({}); }
    });
    req.on("error", () => resolve({}));
  });
}

// ⚠️ CE QUE CE DOUBLE NE SIMULE PAS — déclaré, pas seulement sous-entendu (ADV, dixième audit).
//
// « Ce double n'a pas de contraintes » est honnête mais incomplet : personne ne comprend que ça
// inclut « ni délimiteurs d'URL, ni encodage, ni protocole ». Or le bug `in.()` du dixième audit
// vivait exactement là — un `&` non encodé dans une valeur. Un double ne peut pas révéler un
// défaut d'une couche qu'il ne simule pas ; il n'est pas incomplet, il est dans un autre monde.
// Cette liste dit OÙ il ne peut PAS trouver — donc où il faut un banc RÉEL (base/*.test.js). Un
// essai (couchesAbsentes.test.js) exige qu'elle existe et ne soit pas vide.
//
// ⚠️ ELLE EST EN RETARD PAR CONSTRUCTION, ET IL FAUT LE LIRE COMME TEL (second hôte, 11e audit).
// On ne peut pas énumérer automatiquement les mondes où un double n'est pas ; cette liste ne peut
// donc que NOMMER LES COUCHES QUI ONT DÉJÀ COÛTÉ quelque chose — `encodage-url` y figure parce
// qu'un bug l'a désignée. La huitième s'y ajoutera le jour où elle aura mordu, jamais avant. C'est
// un REGISTRE D'ACCIDENTS, pas la carte des risques : sa valeur est rétrospective. La prendre pour
// une garantie de couverture serait l'erreur exacte que la garde de portabilité évite ailleurs.
const COUCHES_ABSENTES = [
  "transactions",            // un verrou optimiste concurrent, un rollback → banc réel
  "contraintes",             // unicité, clés étrangères, NOT NULL → banc réel
  "encodage-url",            // les valeurs mal encodées (`&`, `#`) — le bug in.() du 10e audit
  "delimiteurs-postgrest",   // le guillemetage/échappement des valeurs de filtre
  "types-postgres",          // coercition, comparaisons de dates réelles
  "rls",                     // les politiques de rangée
  "triggers",                // le scellé d'archive, par exemple
];

module.exports = { creerPostgrestEnMemoire, COUCHES_ABSENTES };
