// LE CLIENT PORTE LE JETON DE PRÉSENCE — vérifié sur la VRAIE SOURCE du gabarit, pas sur une copie.
//
// ⚠️ P1c étape 2, incrément 3. `sendAttend` (server/gabarit-live.js) doit : demander l'émission au
// premier battement (wantToken), renvoyer le jeton reçu aux suivants (pt), et ranger celui que le
// serveur émet. C'est la moitié client du protocole — sans elle, `avecJeton` reste à zéro pour
// toujours et la porte ne peut jamais se fermer.
//
// On EXTRAIT la fonction du gabarit et on l'EXÉCUTE avec un faux fetch : une garde qui lirait seulement
// le texte dirait « la chaîne wantToken est présente » sans prouver qu'elle part vraiment.

const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "gabarit-live.js"), "utf8");

/** Monte `sendAttend` seule, avec l'état minimal dont elle dépend. */
function monter({ reponse = {}, boite: boitePartagee = null } = {}) {
  const envois = [];
  const corpsDe = (o) => JSON.parse(o.body);
  const faux = {
    fetch: (url, o) => { envois.push(corpsDe(o)); return Promise.resolve({ json: () => Promise.resolve(reponse) }); },
  };
  // Les helpers de persistance ET sendAttend, extraits de la source réelle (0018 : le jeton se range
  // à côté de la clé de participant, et une clé refusée TOURNE).
  const debut = SRC.indexOf("var CLE_PT=");
  const fin = SRC.indexOf("var EMOJIS=", debut);
  const corps = SRC.slice(debut, fin);
  // Faux stockage : c'est lui qui prouve la persistance et la rotation.
  const boite = boitePartagee || new Map();
  const store = { getItem: (k) => (boite.has(k) ? boite.get(k) : null), setItem: (k, v) => boite.set(k, String(v)), removeItem: (k) => boite.delete(k) };
  const fabrique = new Function("fetch", "SLUG", "ME", "CONTROL", "attKey", "accessToken", "_store", `
    var _ptJeton='';
    ${corps}
    return { envoyer: sendAttend, jeton: function(){ return _ptJeton; } };
  `);
  const monte = fabrique(faux.fetch, "s-1", { name: "V", email: "", avatar: "" }, "", () => "anon-k", () => "", () => store);
  return { ...monte, envois, boite };
}

describe("client — le battement porte le jeton de présence", () => {
  it("premier battement : demande l'émission (wantToken), sans pt", async () => {
    const c = monter();
    c.envoyer();
    expect(c.envois[0].wantToken, "sans jeton, on signale un BOOTSTRAP moderne").toBe("1");
    expect(c.envois[0].pt).toBeUndefined();
    expect(c.envois[0].action).toBe("present-attend");
  });

  it("le jeton émis par le serveur est rangé, puis renvoyé au battement suivant", async () => {
    const c = monter({ reponse: { ok: true, pt: "JETON-XYZ" } });
    c.envoyer();
    await new Promise((r) => setTimeout(r, 0));   // laisser la promesse se régler
    expect(c.jeton(), "le jeton reçu est mémorisé").toBe("JETON-XYZ");
    c.envoyer();
    expect(c.envois[1].pt, "le battement suivant le porte").toBe("JETON-XYZ");
    expect(c.envois[1].wantToken, "et ne redemande plus l'émission").toBeUndefined();
  });

  it("hôte sans secret (aucun pt en réponse) : on reste en bootstrap, rien ne casse", async () => {
    const c = monter({ reponse: { ok: true } });
    c.envoyer();
    await new Promise((r) => setTimeout(r, 0));
    c.envoyer();
    expect(c.jeton()).toBe("");
    expect(c.envois[1].wantToken, "legacy/hôte non configuré : le battement continue").toBe("1");
  });

  // ⚠️ 0018 : la persistance est ce qui rend le durcissement possible. Sans elle, un rechargement de
  // page repart en bootstrap avec la clé habituelle — « bootstrap sur clé existante » serait banal et
  // donc irrefusable.
  it("le jeton est PERSISTÉ : un nouveau montage (rechargement) repart avec, pas en bootstrap", async () => {
    const c = monter({ reponse: { ok: true, pt: "JETON-PERSISTE" } });
    c.envoyer();
    await new Promise((r) => setTimeout(r, 0));
    // Un second montage partageant le MÊME stockage = la page rechargée.
    const c2 = monter({ reponse: { ok: true }, boite: c.boite });
    c2.envoyer();
    expect(c2.envois[0].pt, "le rechargement retrouve son jeton dans le stockage").toBe("JETON-PERSISTE");
    expect(c2.envois[0].wantToken, "et ne repart donc PAS en bootstrap").toBeUndefined();
  });

  // ⚠️ Une mesure qui s'arrête sans le dire est le pire des deux côtés de cette porte : refusé, le
  // client repart sur une ligne neuve au lieu de perdre sa présence en silence.
  it("refus d'usurpation : la clé et le jeton sont jetés (rotation), pas la présence", async () => {
    const c = monter({ reponse: { ok: false, usurpe: true } });
    c.boite.set("3dd-present-attkey", "anon-victime");
    c.boite.set("3dd-present-pt:s-1", "VIEUX-JETON");
    c.envoyer();
    await new Promise((r) => setTimeout(r, 0));
    expect(c.boite.has("3dd-present-attkey"), "la clé refusée est jetée → une neuve sera tirée").toBe(false);
    expect(c.boite.has("3dd-present-pt:s-1"), "le jeton qui allait avec aussi").toBe(false);
    expect(c.jeton()).toBe("");
  });

  it("une réponse illisible ne casse pas le battement suivant", async () => {
    const envois = [];
    const debut = SRC.indexOf("var CLE_PT=");
    const fin = SRC.indexOf("var EMOJIS=", debut);
    const f = new Function("fetch", "SLUG", "ME", "CONTROL", "attKey", "accessToken", "_store", `
      var _ptJeton='';
      ${SRC.slice(debut, fin)}
      return sendAttend;
    `)((url, o) => { envois.push(JSON.parse(o.body)); return Promise.reject(new Error("réseau")); },
      "s-1", { name: "V" }, "", () => "k", () => "", () => null);
    expect(() => f()).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    expect(() => f()).not.toThrow();
    expect(envois.length).toBe(2);
  });
});
