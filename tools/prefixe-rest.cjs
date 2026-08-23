// SUPABASE SERT POSTGREST SOUS `/rest/v1`, UN POSTGREST NU LE SERT À LA RACINE.
//
// Le contexte du player appelle `${SUPABASE_URL}/rest/v1/<table>?…` — c'est le chemin de sa
// plateforme d'origine, et il n'a aucune raison d'en changer. Le double en mémoire absorbe ce
// préfixe de lui-même ; un vrai PostgREST, non.
//
// ⚠️ CE RENVOI NE TOUCHE QUE LE CHEMIN, ET C'EST TOUT L'INTÉRÊT. Statut, en-têtes et corps sont
// recopiés tels quels : un 409 d'unicité, un 400 sur colonne inconnue, un tableau vide de PATCH
// conditionnel arrivent au player exactement comme ils sortent de la base. Un banc qui
// réinterpréterait quoi que ce soit ici ne prouverait plus rien de ce qu'il prétend prouver.

const http = require("node:http");

const AMONT = process.env.PREFIXE_REST_AMONT || "http://127.0.0.1:3001";
const PORT = Number(process.env.PREFIXE_REST_PORT || 3002);
const PREFIXE = "/rest/v1/";

/**
 * ⚠️ L'HÔTE VIENT DE `amont`, ET DE NULLE PART AILLEURS — STRUCTURELLEMENT, PAS PAR ARGUMENT.
 *
 * La première version concaténait : `amont + "/" + chemin`. C'était CORRECT — l'autorité de l'URL
 * est close avant que le chemin de l'appelant commence, donc `//evil.com/x`, `@evil.com` et
 * `\evil.com` atterrissent tous dans le chemin — mais correct par un raisonnement, tenu dans un
 * commentaire. CodeQL la classait en SSRF critique (#74), et il avait tort sur le fond ET raison
 * sur la forme : une propriété de sécurité qui ne vit que dans un paragraphe n'est pas gardée.
 *
 * Ici l'hôte est posé par `new URL(amont)` et n'est JAMAIS réécrit. Ce que la requête contrôle —
 * le chemin et la requête, c'est-à-dire très exactement la fonction de ce renvoi — entre par des
 * accesseurs qui ne peuvent pas déplacer l'autorité. Le raisonnement est devenu la structure.
 *
 * ⚠️ ET SURTOUT PAS `new URL(chemin, amont)`. C'est la réécriture qu'on fait spontanément pour
 * faire taire l'alerte, et elle rend `http://evil.com/x` dès que le chemin commence par `//` : on
 * créerait la faille en corrigeant le faux positif. `prefixeRest.test.js` mesure ce piège.
 */
function cibleAmont(urlDemandee, amont = AMONT) {
  const reste = String(urlDemandee).slice(PREFIXE.length);
  const q = reste.indexOf("?");
  const cible = new URL(amont);
  // Un amont peut porter un préfixe de chemin (`http://hôte/base`) : on le garde, on ne l'écrase pas.
  cible.pathname = cible.pathname.replace(/\/+$/, "") + "/" + (q < 0 ? reste : reste.slice(0, q));
  cible.search = q < 0 ? "" : reste.slice(q);
  return cible.toString();
}

/**
 * ⚠️ UNE ERREUR SANS `Content-Type` EST DU HTML POUR QUI LA RENIFLE (alerte #75). Le texte d'une
 * exception peut porter un fragment venu de la requête ; servi sans type, le navigateur devine —
 * et devine parfois `text/html`. On le dit, plutôt que de le laisser deviner.
 */
function refuser(res, statut, texte) {
  res.statusCode = statut;
  res.setHeader("content-type", "text/plain; charset=utf-8");
  res.end(texte);
}

const serveur = http.createServer(async (req, res) => {
  if (!req.url.startsWith(PREFIXE)) {
    refuser(res, 404, `ce renvoi ne sert que ${PREFIXE}`);
    return;
  }
  const morceaux = [];
  for await (const m of req) morceaux.push(m);
  try {
    // ⚠️ On RETIRE ce qui décrit le transport et non la demande. `host` pointerait vers ce renvoi ;
    // `content-length` et `connection` décrivent la connexion entrante, pas celle qu'on ouvre — et
    // une valeur `undefined` passée à `fetch` le fait échouer au lieu d'être ignorée.
    const entetes = { ...req.headers };
    delete entetes.host; delete entetes.connection; delete entetes["content-length"];
    const amont = await fetch(cibleAmont(req.url), {
      method: req.method,
      headers: entetes,
      body: morceaux.length ? Buffer.concat(morceaux) : undefined,
    });
    res.statusCode = amont.status;
    for (const [k, v] of amont.headers) {
      if (k === "content-encoding" || k === "transfer-encoding" || k === "content-length") continue;
      res.setHeader(k, v);
    }
    res.end(Buffer.from(await amont.arrayBuffer()));
  } catch (erreur) {
    refuser(res, 502, "renvoi indisponible : " + String((erreur && erreur.message) || erreur));
  }
});

// ⚠️ UN `require` NE DOIT RIEN OUVRIR. Sans cette garde, le banc qui importe `cibleAmont` pour
// l'éprouver ferait écouter un port en même temps — c'est exactement ce qui est arrivé à
// `install-hooks.mjs`, dont le premier import a installé des hooks dans un dépôt de travail.
if (require.main === module) {
  serveur.listen(PORT, "127.0.0.1", () => {
    process.stdout.write(`renvoi /rest/v1 → ${AMONT} sur ${PORT}\n`);
  });
}

module.exports = { cibleAmont, PREFIXE, AMONT };
