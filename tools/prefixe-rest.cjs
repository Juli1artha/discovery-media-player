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

const serveur = http.createServer(async (req, res) => {
  if (!req.url.startsWith(PREFIXE)) {
    res.statusCode = 404;
    res.end(`ce renvoi ne sert que ${PREFIXE}`);
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
    const amont = await fetch(AMONT + "/" + req.url.slice(PREFIXE.length), {
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
    res.statusCode = 502;
    res.end("renvoi indisponible : " + String((erreur && erreur.message) || erreur));
  }
});

serveur.listen(PORT, "127.0.0.1", () => {
  process.stdout.write(`renvoi /rest/v1 → ${AMONT} sur ${PORT}\n`);
});
