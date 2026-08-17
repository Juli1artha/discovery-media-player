// TOURNER UNE PAGE DEMANDAIT UN JETON DE CONTRÔLE, DÉPLACER LA CARTE DEMANDAIT UNE SESSION.
//
// « present-start » n'exige AUCUNE session — c'est voulu : une présentation peut démarrer sans
// compte, elle ne sera simplement pas reprenable. « present-page » se contente donc du
// « control_token », qui est précisément ce qui prouve « je suis le présentateur de celle-ci ».
//
// Mais « present-content » — ce que la présentation AFFICHE : carte, Street View — avait été rangé
// avec les actions à session. ⚠️ Conséquence : une présentation démarrée sans session tournait ses
// pages et ne déplaçait pas sa carte. L'appel repartait en 401, avalé par un « catch » côté
// navigateur, et le présentateur voyait sa carte ne pas suivre sans qu'aucun message ne le dise.
//
// Les deux actions sont le MÊME acte de pilotage ; elles avaient été groupées par voisinage dans la
// route, pas par autorité. Ce qui reste réservé au propriétaire est « present-switch » : changer le
// DOCUMENT montré n'est pas piloter l'affichage, c'est décider ce qu'on montre.
//
// Signalé par un audit externe (P0-3) : « le comportement actuel est ambigu ».

const crypto = require("node:crypto");
const sha = (s) => crypto.createHash("sha256").update(String(s || "")).digest("hex");

const CONTROL = "jeton-de-controle-du-presentateur";
const LIGNE = { slug: "Ab3-_xYz9012", control_hash: sha(CONTROL), owner_email: "proprio@ex.fr", active: true };

// ── La fonction elle-même ────────────────────────────────────────────────────────────────────────
// ⚠️ MODÉLISE LA CONDITION, PAS SEULEMENT LE SUCCÈS. Le pilotage écrit désormais sous condition
// (`&control_hash=eq.…`, `&active=eq.true`, `&write_seq=lt.…`) et PostgREST répond par les lignes
// TOUCHÉES : zéro ligne = refus. Une doublure qui rendrait toujours une ligne ferait passer les
// essais même si la condition disparaissait du code.
function lignesTouchees(chemin, etat) {
  const cond = String(chemin).split("&").slice(1);
  for (const c of cond) {
    const [champ, valeur] = c.split("=");
    if (champ === "control_hash" && valeur !== "eq." + require("crypto").createHash("sha256").update(String(etat.control_hash_source || "")).digest("hex")) {
      if (valeur !== "eq." + String(etat.control_hash || "")) return [];
    } else if (champ === "active" && valeur === "eq.true" && etat.active === false) {
      return [];
    } else if (champ === "write_seq" && valeur.startsWith("lt.") && Number(etat.write_seq || 0) >= Number(valeur.slice(3))) {
      return [];
    }
  }
  return [{ ...etat }];
}

describe("qui a le droit de changer ce que la présentation affiche", () => {
  const presentations = require("../presentations.js");
  let ecrit = null;

  const armer = (ligne = LIGNE) => {
    ecrit = null;
    presentations.init({
      db: { async request(chemin, o) {
        if (o && o.method === "PATCH") { const t = lignesTouchees(chemin, ligne || {}); if (!t.length) return []; ecrit = o.body; return [{ ...(ligne || {}), ...o.body }]; }
        return ligne ? [{ ...ligne }] : [];
      } },
      limits: { async allow() { return true; } }, errors: { capture() {} },
    });
  };

  const contenu = { kind: "map", lat: 43.5, lon: -1.5, zoom: 14 };

  it("le présentateur qui détient le jeton de contrôle, même sans session", async () => {
    armer();
    const r = await presentations.setPresentationContent(LIGNE.slug, "", false, contenu, CONTROL);
    expect(r.ok, "c'est exactement ce que « present-page » accepte déjà").toBe(true);
    expect(ecrit, "et le contenu est bien écrit").toBeTruthy();
    expect(ecrit.content, "la carte posée doit atteindre la base").toBeTruthy();
  });

  it("le propriétaire, qui pilote depuis l'application sans détenir ce jeton", async () => {
    armer();
    const r = await presentations.setPresentationContent(LIGNE.slug, "proprio@ex.fr", false, contenu, "");
    expect(r.ok, "ce chemin existait avant, il ne doit pas se refermer").toBe(true);
  });

  it("un administrateur", async () => {
    armer();
    expect((await presentations.setPresentationContent(LIGNE.slug, "autre@ex.fr", true, contenu, "")).ok).toBe(true);
  });

  // ⚠️ CE QUI NE DOIT PAS S'OUVRIR. Élargir une autorisation, c'est ouvrir une porte ; le test qui
  // compte est celui qui vérifie qu'on n'a ouvert QUE celle-là.
  it.each([
    ["ni session ni jeton", "", ""],
    ["un jeton faux", "", "pas-le-bon-jeton"],
    ["un jeton vide", "", ""],
    ["une session étrangère, sans jeton", "quelquun@ailleurs.fr", ""],
    ["une session étrangère et un jeton faux", "quelquun@ailleurs.fr", "pas-le-bon-jeton"],
  ])("refuse %s", async (_nom, email, control) => {
    armer();
    const r = await presentations.setPresentationContent(LIGNE.slug, email, false, contenu, control);
    expect(r.ok).toBe(false);
    expect(r.status).toBe(403);
    expect(ecrit, "un refus n'écrit rien").toBeNull();
  });

  it("et une présentation qui n'existe pas reste un 404, jeton ou pas", async () => {
    armer(null);
    expect((await presentations.setPresentationContent("inconnue", "", false, contenu, CONTROL)).status).toBe(404);
  });
});

// ── La route, qui est l'autre moitié ─────────────────────────────────────────────────────────────
//
// ⚠️ La fonction peut accepter le jeton pendant que la route continue de renvoyer 401 avant même de
// l'appeler : c'est la garde d'entrée qui refusait, pas l'autorisation. Corriger l'une sans l'autre
// ne change rien de visible — la leçon du jeton interne, où vérifier sans émettre refusait tout.
describe("la route laisse passer le pilote sans session", () => {
  const ID = require.resolve("../presentations.js");
  const vraies = require("../presentations.js");
  let recu = null;
  require.cache[ID] = { id: ID, filename: ID, loaded: true, exports: {
    ...vraies,
    getPresentation: async () => ({ ...LIGNE }), listMessages: async () => [],
    setPresentationContent: async (slug, email, isAdmin, content, control) => {
      recu = { slug, email, isAdmin, content, control };
      return { ok: true };
    },
  } };
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
      config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "cle", mapsKey: "", extraFrameAncestors: [] },
    };
  }

  async function poster(corps) {
    recu = null;
    player.init(contexte());
    const res = { statusCode: 0, headers: {}, body: "",
      setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
    const req = { method: "POST", headers: { "content-type": "application/json" }, socket: {}, query: {}, body: corps };
    await player.handler(req, res);
    return { statut: res.statusCode, corps: (() => { try { return JSON.parse(res.body); } catch { return {}; } })() };
  }

  const CONTENU = { kind: "map", lat: 43.5, lon: -1.5, zoom: 14 };

  it("un « present-content » porteur du jeton n'est plus refusé à l'entrée", async () => {
    const r = await poster({ action: "present-content", slug: LIGNE.slug, control: CONTROL, content: CONTENU });
    expect(r.statut, "c'est le 401 qui faisait échouer la carte en silence").not.toBe(401);
    expect(r.statut).toBe(200);
    expect(recu, "et l'action est bien exécutée").toBeTruthy();
    expect(recu.control, "le jeton doit être transmis à l'autorisation, pas seulement à la garde")
      .toBe(CONTROL);
    expect(recu.isAdmin, "sans session, personne n'est administrateur").toBe(false);
  });

  it("sans jeton ET sans session, c'est toujours 401", async () => {
    const r = await poster({ action: "present-content", slug: LIGNE.slug, content: CONTENU });
    expect(r.statut, "l'exception ne vaut que pour un porteur de jeton").toBe(401);
    expect(recu, "et rien n'est exécuté").toBeNull();
  });

  // ⚠️ L'EXCEPTION NE DOIT PAS DÉBORDER SUR SES VOISINES. Elles partagent la même garde d'entrée :
  // une exception écrite trop large les ouvrirait toutes d'un coup.
  it.each([
    "present-list", "present-reclaim", "present-handover", "present-owner-end",
    "present-stats", "present-doc-list", "present-switch",
  ])("%s reste réservée à une session, jeton de contrôle ou pas", async (action) => {
    const r = await poster({ action, slug: LIGNE.slug, control: CONTROL });
    expect(r.statut, "changer le DOCUMENT ou lire les statistiques n'est pas piloter l'affichage")
      .toBe(401);
  });
});

// ── Et le navigateur, qui est la troisième moitié ────────────────────────────────────────────────
describe("le navigateur envoie effectivement le jeton", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const SRC = fs.readFileSync(path.join(__dirname, "..", "handler.js"), "utf8");

  it("l'appel « present-content » porte le control_token", () => {
    const i = SRC.indexOf("action:'present-content'");
    expect(i, "l'appel existe").toBeGreaterThan(0);
    expect(SRC.slice(i, i + 120), "une route qui accepte le jeton ne sert à rien si personne ne l'envoie")
      .toContain("control:PRES.control");
  });
});
