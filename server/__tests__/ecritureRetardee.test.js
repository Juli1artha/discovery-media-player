// UNE ÉCRITURE AUTORISÉE SUR UN ÉTAT ANCIEN NE DOIT PAS ARRIVER SUR UN ÉTAT NEUF.
//
// Le pilotage faisait : lire la ligne, vérifier le jeton, PATCHER. Entre la vérification et le
// PATCH, la présentation peut avoir été TERMINÉE — et comme le pilotage écrit « active: true », la
// requête retardée la ROUVRAIT pour toute l'audience. Le présentateur avait cliqué « Terminer », vu
// son écran de fin, et les spectateurs continuaient de suivre les pages.
//
// ⚠️ CE QUI NE SUFFIT PAS : relire juste avant d'écrire. La fenêtre se déplace de quelques
// millisecondes, elle ne se ferme pas. La condition doit voyager AVEC l'écriture.
//
// ⚠️ ET LA CONDITION N'EST PAS « active = true », que l'audit prescrivait. Une présentation devient
// inactive après trois minutes sans battement — le portable du présentateur a dormi — et sa page
// suivante DOIT la remettre en ligne, faute de quoi un présentateur anonyme ne revient jamais.
// Ce qui sépare la fin DÉCIDÉE de la péremption CONSTATÉE, c'est que terminer ANNULE le jeton.
// C'est donc le jeton qu'on met dans la condition ; le reste suit.

const crypto = require("node:crypto");
const presentations = require("../presentations.js");

const sha = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const CONTROL = "jeton-de-pilotage";

/**
 * Une base qui applique VRAIMENT les conditions du chemin — sans quoi cet essai ne prouverait
 * rien : une doublure qui écrit toujours répond « écrit » même si la condition disparaît du code.
 */
function base(etat, vuALaLecture) {
  const ecritures = [];
  // ⚠️ LES DEUX MODULES, COMME EN PRODUCTION. La sonde de schéma a son propre contexte : sans lui
  // elle échoue, « doute = absent », et le rang n'est jamais écrit — l'essai mesurerait alors une
  // absence de garde là où il n'y a qu'une absence de câblage.
  const ctx = {
    db: {
      async request(chemin, o) {
        // ⚠️ CE QUE LA LECTURE A VU N'EST PAS CE QUI EST VRAI À L'ÉCRITURE : c'est toute la course.
        // Modéliser un seul état ferait refuser dès le contrôle, et l'essai serait vert pour une
        // raison qui n'a rien à voir avec le correctif.
        if (!o || !o.method) return [{ ...(vuALaLecture || etat) }];
        if (o.method !== "PATCH") return [];
        for (const cond of String(chemin).split("&").slice(1)) {
          const [champ, valeur] = cond.split("=");
          if (champ === "control_hash" && valeur !== "eq." + String(etat.control_hash)) return [];
          if (champ === "active" && valeur === "eq.true" && etat.active === false) return [];
          if (champ === "write_seq" && valeur.startsWith("lt.") && Number(etat.write_seq || 0) >= Number(valeur.slice(3))) return [];
        }
        ecritures.push(o.body);
        Object.assign(etat, o.body);
        return [{ ...etat }];
      },
    },
    limits: { async allow() { return true; } },
    errors: { capture() {} },
  };
  presentations.init(ctx);
  require("../schema.js").init(ctx);
  return { ecritures, etat };
}

const vivante = () => ({
  slug: "s", control_hash: sha(CONTROL), active: true, current_page: 1, write_seq: 0,
  owner_email: "moi@exemple.fr",
});

describe("une écriture retardée ne rouvre pas une présentation terminée", () => {
  // LE scénario : le contrôle a lu une ligne vivante, la fin est passée entre-temps.
  it("la page qui arrive après la fin ne trouve plus sa présentation", async () => {
    const ancien = vivante();                    // ce que le contrôle a lu
    const etat = { ...vivante(), active: false, control_hash: null };  // la fin est passée depuis
    const { ecritures } = base(etat, ancien);

    const r = await presentations.setPage("s", CONTROL, 7, 5);

    expect(ecritures).toHaveLength(0);          // rien n'a été écrit
    expect(etat.active).toBe(false);            // la présentation reste close
    expect(etat.current_page).toBe(1);          // et l'audience ne saute pas à la page 7
    expect(r.perime).toBe(true);                // refus silencieux : le navigateur n'a rien à dire
  });

  // ⚠️ LE COMPORTEMENT QU'IL NE FALLAIT PAS CASSER EN FERMANT L'AUTRE. Sans lui, un présentateur
  // anonyme dont le portable a dormi ne peut plus jamais revenir : la reprise exige la propriété,
  // et démarrer une présentation n'exige aucune session.
  it("mais une présentation seulement PÉRIMÉE se remet en ligne", async () => {
    const etat = { ...vivante(), active: false }; // périmée : inactive, jeton INTACT
    const { ecritures } = base(etat);

    const r = await presentations.setPage("s", CONTROL, 4, 5);

    expect(ecritures).toHaveLength(1);
    expect(etat.active).toBe(true);
    expect(etat.current_page).toBe(4);
    expect(r.perime).toBeUndefined();
  });

  it("un changement de contenu retardé ne rouvre rien non plus", async () => {
    const ancien = vivante();
    const etat = { ...vivante(), active: false, control_hash: null };
    base(etat, ancien);

    const r = await presentations.setPresentationContent("s", "", false, { kind: "map", center: [1, 2] }, CONTROL);

    expect(r.ok).toBe(false);
    expect(r.error).toBe("ended");
    expect(etat.active).toBe(false);
  });

  it("un changement de document retardé ne rouvre rien non plus", async () => {
    const ancien = vivante();
    const etat = { ...vivante(), active: false };
    base(etat, ancien);

    const r = await presentations.switchPresentationDoc("s", "moi@exemple.fr", false, { fileUrl: "https://x/y.pdf" });

    expect(r.ok).toBe(false);
    expect(r.error).toBe("ended");
  });
});

describe("deux écritures concurrentes ne peuvent pas s'inverser", () => {
  // Le rang était comparé à la lecture puis écrit plus tard : deux requêtes pouvaient lire le même
  // rang ancien et écrire dans le désordre. La comparaison voyage désormais avec l'écriture.
  it("le rang 1 n'écrase pas le rang 2, même s'il a été autorisé avant", async () => {
    const etat = vivante();
    const { ecritures } = base(etat);

    await presentations.setPage("s", CONTROL, 2, 2);   // la plus récente arrive d'abord
    expect(etat.current_page).toBe(2);
    expect(etat.write_seq).toBe(2);

    const r = await presentations.setPage("s", CONTROL, 1, 1); // la retardataire

    expect(ecritures).toHaveLength(1);
    expect(etat.current_page).toBe(2);   // l'état reste celui du rang le plus élevé
    expect(r.perime).toBe(true);
  });

  // ⚠️ Une fin émise avec un jeton PÉRIMÉ par une reprise ne doit pas fermer la session neuve :
  // entre le contrôle et l'écriture, le propriétaire a pu reprendre la main depuis un autre
  // appareil — et fermer serait le contraire exact de ce que la reprise vient d'obtenir.
  it("une fin retardée ne ferme pas la présentation reprise ailleurs", async () => {
    const ancien = vivante();
    const etat = { ...vivante(), control_hash: sha("jeton-neuf-apres-reprise") };
    const { ecritures } = base(etat, ancien);

    await presentations.endPresentation("s", CONTROL);

    expect(ecritures).toHaveLength(0);
    expect(etat.active).toBe(true);
  });
});
