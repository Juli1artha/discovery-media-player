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

  // ⚠️ CE TEST ÉPINGLAIT LE DÉFAUT COMME UNE FONCTIONNALITÉ.
  //
  // Il exigeait `clearTimeout(_relEtat)` — c'est-à-dire exactement la ligne qui permettait
  // d'affamer la relecture indéfiniment. Il vérifiait une FORME (« un debounce est écrit ») en
  // croyant vérifier une PROPRIÉTÉ (« les relectures sont groupées »), et il aurait refusé le
  // correctif. C'est la démonstration du reproche « tests trop proches du source » : une chaîne
  // trouvée dans un fichier ne dit rien de ce que le code fait.
  //
  // Les vraies propriétés — pas d'affamement, une requête en vol, cadence bornée, dernier signal
  // toujours servi — sont exercées sur du code exécuté, dans src/__tests__/ordonnanceur.test.ts.
  // Ici on se contente de vérifier que la page utilise bien cet ordonnanceur-là.
  it("les relectures passent par l'ordonnanceur borné, pas par un debounce", () => {
    expect(SRC, "un debounce sur la relecture est affamable : c'est le P0-2").not.toMatch(/clearTimeout\(_rel/);
    expect(SRC).toContain("Player.live.createScheduler");
    expect(SRC, "et le filet qui rattrape un signal perdu").toMatch(/_ordEtat\.maintenant\(\)/);
  });
});

describe("ce qui reste un signal, et c'est un choix", () => {
  // ⚠️ `map` A PERDU CETTE EXCEPTION EN 0.1.30, ET CE TEST L'AVAIT ENTÉRINÉE.
  //
  // Il affirmait que `map` « applique encore la charge utile — éphémère, sans vérité serveur ».
  // L'argument ne tenait pas : PENDANT UN MODE CARTE, CE SIGNAL EST L'IMAGE QUE VOIT L'AUDIENCE.
  // N'importe quel participant déplaçait donc l'écran de tout le monde. (audit P0-1)
  //
  // ⚠️ Et le test serait resté vert après le correctif : il lisait le gestionnaire de la couche
  // Live, qui transmettait toujours `p.payload` — ignoré en aval. Une défense par accident. Le
  // chemin lui-même est coupé, et c'est ça qu'on vérifie.
  it("typing reste cosmétique — pas de vérité serveur à confronter, et une fréquence élevée", () => {
    const g = gestionnaire("typing");
    expect(g).toBeTruthy();
    expect(g, "c'est le seul qui garde ce droit").toMatch(/p\.payload|p&&p\.payload/);
  });

  it("map ne transporte plus rien : ni charge émise, ni charge reçue", () => {
    const g = gestionnaire("map");
    expect(g, "le gestionnaire existe").toBeTruthy();
    expect(g, "aucune charge ne doit atteindre l'aval").not.toMatch(/payload/);
    expect(SRC, "et l'émission ne compose plus de position")
      .toMatch(/function sendMap\(\)/);
  });

  it("l'audience relit au lieu d'appliquer", () => {
    const i = SRC.indexOf("Live.onMap(");
    expect(i).toBeGreaterThan(0);
    const appel = SRC.slice(i, i + 160);
    expect(appel, "Map3DD.apply sur une charge publique, c'était le défaut").not.toContain("Map3DD.apply");
    expect(appel).toContain("__presRelireEtat");
  });

  // ⚠️ Si un événement AUTORITAIRE réapparaît un jour en appliquant sa charge utile, ce test
  // tombe. C'est la garde qui survit à ce correctif : elle ne surveille pas les quatre événements
  // d'aujourd'hui, elle surveille la RÈGLE.
  // ⚠️ LA LISTE EXHAUSTIVE, ET ELLE SE RÉDUIT. Ce balayage vaut mieux qu'un test par événement :
  // il attrape le PROCHAIN gestionnaire qu'on ajoutera sans y penser. `map` en est sorti en 0.1.30 ;
  // `typing` est le dernier, et il devra le justifier à chaque relecture de ce fichier.
  it("un seul événement croit encore son émetteur, et c'est typing", () => {
    const tous = [...SRC.matchAll(/on\('broadcast',\{event:'([a-z-]+)'\},([^\n]*?)\);\s*$/gm)];
    const croient = tous.filter(([, , corps]) => /p\.payload/.test(corps)).map(([, ev]) => ev).sort();
    expect(croient, "tout ce qui est ici pilote l'écran de l'audience sans preuve").toEqual(["typing"]);
  });
});

// ⚠️ LA RELECTURE DOIT NOTIFIER CE QU'ELLE AJOUTE — ET SEULEMENT ÇA.
//
// La première version de ce correctif ajoutait les messages relus sans jamais appeler
// `notifyMsg` : la pastille de non-lus ne montait plus. Personne ici ne l'a vu — c'est le test
// d'un HÔTE, qui lit le source de ce paquet une fois installé, qui l'a attrapé à travers la
// frontière de deux dépôts.
//
// Et la condition compte autant que l'appel : la relecture ramène tout l'historique, donc notifier
// sans vérifier l'ajout réel ferait recompter chaque message à chaque relecture. C'est exactement
// le défaut « la pastille monte de 2 » corrigé en 0.1.2, qui reviendrait par une autre porte.
describe("la relecture notifie ce qui est neuf, sans recompter le reste", () => {
  it("notifie uniquement les messages réellement ajoutés", () => {
    expect(SRC, "sans cet appel, la pastille ne monte plus").toContain("if(addMsg(m))notifyMsg(m);else updateMsg(m);");
  });

  it("ne notifie jamais sans condition", () => {
    expect(SRC).not.toMatch(/addMsg\(m\);\s*notifyMsg/);
    expect(SRC).not.toMatch(/forEach\(function\(m\)\{notifyMsg/);
  });
});
