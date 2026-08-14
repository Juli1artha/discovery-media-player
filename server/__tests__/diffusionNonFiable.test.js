// UNE DIFFUSION EST UN SIGNAL, PAS UNE VÉRITÉ.
//
// Le canal Realtime d'une présentation est PUBLIC : la clé publiable et le slug sont dans la page,
// donc tout participant peut émettre. Appliquer directement la charge utile reçue revenait à
// laisser n'importe quel spectateur :
//   • annoncer la fin de la présentation (`{active:false}`) ;
//   • changer la page ou le document affichés à toute l'audience ;
//   • verrouiller le chat ;
//   • publier un message signé du nom de quelqu'un d'autre.
//
// ⚠️ DÉPLACER L'ÉMISSION VERS LE SERVEUR N'Y AURAIT RIEN CHANGÉ — c'est la première recommandation
// de l'audit, et elle ne suffit pas. Sur un canal public, un attaquant émet quand même, et le
// client ne distingue pas les deux sources. La seule défense qui tienne est de cesser de croire le
// transport : on relit auprès du serveur, qui était déjà la source de vérité (`state=1`, `chat=1`).
//
// Un attaquant peut donc toujours émettre. Il déclenche une relecture, et n'obtient rien.
//
// ⚠️ `map` et `typing` restent appliqués tels quels, DÉLIBÉRÉMENT : signaux éphémères (mouvements
// de carte, « untel écrit »), sans état serveur à confronter, à fréquence élevée. Les revérifier
// coûterait un aller-retour par déplacement de souris pour protéger un déplacement de souris. Ce
// qui fait autorité passe par `state`, qui est relu.
//
// La couche navigateur est injectée en TEXTE dans la page : elle se vérifie sur le source.

const fs = require("node:fs");
const path = require("node:path");

const SRC = fs.readFileSync(path.join(__dirname, "..", "handler.js"), "utf8");

/** Le corps du gestionnaire d'un événement de diffusion, tel qu'il part dans la page. */
function gestionnaire(evenement) {
  const m = SRC.match(new RegExp("on\\('broadcast',\\{event:'" + evenement + "'\\},([^\\n]*?)\\);\\s*$", "m"));
  return m ? m[1] : null;
}

describe("ce qui fait autorité est relu auprès du serveur", () => {
  it.each(["state"])("%s déclenche une relecture de l'état", (ev) => {
    const g = gestionnaire(ev);
    expect(g, ev).toBeTruthy();
    expect(g, "doit relire, pas appliquer").toContain("relireEtat()");
  });

  it.each(["msg", "msg-upd", "lock"])("%s déclenche une relecture du chat", (ev) => {
    const g = gestionnaire(ev);
    expect(g, ev).toBeTruthy();
    expect(g, "doit relire, pas appliquer").toContain("relireChat()");
  });

  // ⚠️ LE TEST QUI COMPTE : la charge utile ne doit plus JAMAIS atteindre l'application.
  // Un gestionnaire qui reçoit `p` et l'utilise est un gestionnaire qui croit l'émetteur.
  it.each(["state", "msg", "msg-upd", "lock"])("%s n'utilise pas la charge utile reçue", (ev) => {
    const g = gestionnaire(ev);
    expect(g, "aucun paramètre ne doit être lu").not.toMatch(/p\.payload/);
    expect(g).toMatch(/function\(\)/);
  });

  it("les deux routes de vérité sont bien celles du serveur", () => {
    expect(SRC).toContain("'&state=1'");
    expect(SRC).toContain("'&chat=1'");
  });

  // Dix diffusions d'affilée ne doivent pas produire dix requêtes.
  it("les relectures sont groupées", () => {
    expect(SRC).toContain("clearTimeout(_relEtat)");
    expect(SRC).toContain("clearTimeout(_relChat)");
  });
});

describe("ce qui reste un signal, et c'est un choix", () => {
  it.each(["typing", "map"])("%s applique encore la charge utile — éphémère, sans vérité serveur", (ev) => {
    const g = gestionnaire(ev);
    expect(g, ev).toBeTruthy();
    expect(g, "ce sont les seuls qui gardent ce droit").toMatch(/p\.payload|p&&p\.payload/);
  });

  // ⚠️ Si un événement AUTORITAIRE réapparaît un jour en appliquant sa charge utile, ce test
  // tombe. C'est la garde qui survit à ce correctif : elle ne surveille pas les quatre événements
  // d'aujourd'hui, elle surveille la RÈGLE.
  it("aucun autre événement n'applique une charge utile", () => {
    const tous = [...SRC.matchAll(/on\('broadcast',\{event:'([a-z-]+)'\},([^\n]*?)\);\s*$/gm)];
    const croient = tous.filter(([, , corps]) => /p\.payload/.test(corps)).map(([, ev]) => ev).sort();
    expect(croient, "seuls typing et map ont le droit de croire l'émetteur").toEqual(["map", "typing"]);
  });
});
