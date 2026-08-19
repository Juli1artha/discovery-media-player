// EXTRAIT DE handler.js (refactor lot 3 — routes, 19/08/2026) — blocs déplacés À L'IDENTIQUE.
// Reste à PLAT dans server/ (les gardes de forge ciblent server/*.js).

const { adresseAppelant } = require("./appelant");

const { getShareBySlug } = require("./shares");
let PLAYER = null;
const init = (ctx) => { PLAYER = ctx; };

// Traite les actions de cette famille. Le MARQUEUR est le retour : les blocs répondent puis
// sortent par leurs `return` d'origine (valeur ≠ false) ; si aucune action ne correspond, la
// chute au bout rend `false` et le dispatch continue. Aucune liste d'actions n'est dupliquée
// entre ici et handler (un correctif à deux exemplaires finit par diverger) — et aucun appui
// sur res.writableEnded, absent des `res` postiches des bancs comme de certains hôtes.
async function traiter(req, res, body, _slug) {
      // ── Connexion VISITEUR (soft wall) : demande d'un code par email, puis vérification. ──
      // Émet un jeton signé posé en cookie qui débloque les contenus gatés (require_auth).
      if (body.action === "visitor-request" || body.action === "visitor-verify" || body.action === "visitor-google") {
        const jv = (status, obj, cookie) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); if (cookie) res.setHeader("Set-Cookie", cookie); res.end(JSON.stringify(obj)); };
        const V = PLAYER.plugins.visitors;
        if (!V) return jv(404, { ok: false, error: "disabled" });
        const ip = adresseAppelant(req) || "ip";
        if (body.action === "visitor-request") {
          if (!(await PLAYER.limits.allow(`vcode:${ip}`, 20, 3600))) return jv(429, { ok: false, error: "rate" });
          const sh = await getShareBySlug(String(body.slug || ""));
          return jv(200, await V.requestCode(body.email, { title: sh && sh.doc_title }));
        }
        const recordUnlock = async (visitor, method) => {
          try {
            if (!body.slug || !visitor || !visitor.email) return;
            await PLAYER.db.request("xp_visitor_unlocks", { method: "POST", headers: { Prefer: "return=minimal" }, body: [{ doc_slug: String(body.slug), email: visitor.email, name: visitor.name || null, method }] });
          } catch (e) {
      // ⚠️ TROUVÉ EN VÉRIFIANT LE TARBALL DE 0.1.37, PAS PAR LA GARDE QUI VENAIT DE NAÎTRE.
      //
      // Celle-ci filtrait sur une LISTE DE NOMS de fonctions d'écriture. `recordUnlock` écrit
      // directement par `PLAYER.db.request`, donc elle ne l'a pas vu — exactement le défaut que
      // l'audit reprochait à la garde des prototypes, reproduit dans une garde écrite le même jour
      // pour éviter ce genre de chose.
      //
      // La garde vise désormais la FORME (toute écriture en base rattrapée en silence), pas des
      // noms. Une liste ne voit que ce qu'on y a mis ; une forme voit aussi le prochain.
      try {
        if (await PLAYER.limits.allow("unlock:echec", 1, 3600)) {
          PLAYER.errors.capture(new Error(`déverrouillage visiteur non journalisé : ${e && e.message ? e.message : "cause inconnue"}`), { route: "visitor-unlock" });
        }
      } catch { /* un journal ne doit jamais empêcher une lecture */ }
    }
        };
        if (body.action === "visitor-google") {
          const r = await V.verifyGoogle(body.credential);
          if (r.ok) await recordUnlock(r.visitor, "google");
          return r.ok ? jv(200, { ok: true }, r.setCookie) : jv(400, r);
        }
        const r = await V.verifyCode(body.email, body.code, body.name);
        if (r.ok) await recordUnlock(r.visitor, "email");
        return r.ok ? jv(200, { ok: true }, r.setCookie) : jv(400, r);
      }
      // Mode « Présenter » : démarrage / changement de page / fin. start = public (URL Storage validée) ;
      // page & end exigent le control_token (secret présentateur). L'audience (slug seul) ne peut pas piloter.
  return false;
}

module.exports = { init, traiter };
