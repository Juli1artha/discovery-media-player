// L'HÔTE PEUT CRÉER UN LIEN EN SON NOM PROPRE — ET RIEN D'AUTRE.
//
// Un lien ANONYME (la plaquette publique d'un programme, lue par un prospect sans compte) n'a pas
// de membre derrière lui. Exiger un jeton forcerait l'hôte à inventer une identité : un compte de
// service dont le mot de passe ouvre bien plus que la création d'un lien, ou l'aperçu interne
// détourné — qui rangerait un prospect dans la population INTERNE et ferait mentir la seule
// phrase qui compte ici, « ce client a lu pendant douze minutes ».
//
// ⚠️ CE QUI EST TESTÉ N'EST PAS QUE ÇA MARCHE, MAIS CE QUE ÇA NE PEUT PAS FAIRE. Un chemin
// d'écriture authentifié par un secret partagé se juge sur ses limites, pas sur son cas nominal.

const ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
require.cache[ID] = { id: ID, filename: ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => null, listMessages: async () => [] } };

const player = require("../handler.js");

const SECRET = "un-secret-de-serveur-suffisamment-long-0123456789";
const URL_OK = "https://exemple.supabase.co/storage/v1/object/public/resources/plaquette.pdf";

let requetes = [];
let colonneAbsente = false;
let lignesExistantes = [];

function contexte({ secretConfigure = SECRET } = {}) {
  return {
    plugins: {}, has: () => false,
    storage: {
      isAllowedUrl: (u) => String(u || "").startsWith("https://exemple.supabase.co/"),
      async fetchFile() { return null; }, async put() {}, async signUpload() { return null; },
    },
    db: {
      async request(chemin, options = {}) {
        requetes.push({ chemin, methode: (options.method || "GET").toUpperCase(), body: options.body });
        // La sonde de schéma : PostgREST refuse une colonne inconnue, donc l'échec EST la réponse.
        if (colonneAbsente && String(chemin).includes("select=attested_recipient_email")) {
          throw new Error('column "attested_recipient_email" does not exist');
        }
        if (!options.method || options.method === "GET") return lignesExistantes;
        return [{ slug: "Nouveau-_xYz12" }];
      },
      async selectAll() { return []; },
    },
    mail: { async send() {} },
    identity: {
      async verifyToken() { return null; },              // aucun membre : c'est tout le sujet
      roleOf: () => "", isAdmin: () => false,
      async canManageShares() { return false; },
      isTrustedHostCall(headers) {
        const recu = String((headers && headers["x-player-share-secret"]) || "");
        return !!secretConfigure && recu === secretConfigure;
      },
    },
    limits: { async allow() { return true; } },
    branding: { async logo() { return ""; }, name: "", poweredBy: "", loaderName: "", async forKey() { return null; }, title: (b) => b },
    errors: { async capture() {} },
    legal: { sourceUrl: "", legalUrl: "", privacyUrl: "", trackingNotice: "" },
    config: { supabaseUrl: "https://exemple.supabase.co", supabasePublishableKey: "k", mapsKey: "", extraFrameAncestors: [], hostShare: !!secretConfigure },
  };
}

async function appeler(body, { secret = SECRET, secretConfigure = SECRET } = {}) {
  requetes = [];
  player.init(contexte({ secretConfigure }));
  const res = {
    statusCode: 0, headers: {}, body: "",
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; },
    end(b) { this.body = String(b == null ? "" : b); },
  };
  const headers = { "content-type": "application/json" };
  if (secret !== null) headers["x-player-share-secret"] = secret;
  await player.handler({ method: "POST", headers, socket: {}, query: {}, body }, res);
  return { statut: res.statusCode, corps: (() => { try { return JSON.parse(res.body); } catch { return {}; } })() };
}

const CREATION = { action: "docshare.create", docId: "programme-42", fileUrl: URL_OK, docTitle: "Plaquette", fileName: "plaquette.pdf" };

describe("le chemin nominal", () => {
  beforeEach(() => { lignesExistantes = []; });

  it("crée un lien sans qu'aucun membre soit présent", async () => {
    const r = await appeler(CREATION);
    expect(r.statut).toBe(200);
    expect(r.corps.ok).toBe(true);
    expect(r.corps.slug).toBeTruthy();
  });

  // ⚠️ Le lien n'appartient à personne, et c'est voulu : le filtre « mes liens » compare
  // `created_by=eq.<email>`, qui exclut les NUL. Il n'apparaît donc dans la liste d'aucun membre,
  // et reste visible en administration. Un email d'emprunt le ferait apparaître dans la liste de
  // quelqu'un qui ne l'a pas créé — le genre de petit mensonge qui coûte cher six mois plus tard.
  it("ne s'attribue à personne", async () => {
    await appeler(CREATION);
    const ecriture = requetes.find((q) => q.methode === "POST" && q.body);
    expect(ecriture, "une création doit avoir eu lieu").toBeTruthy();
    expect(ecriture.body.created_by ?? null).toBeNull();
    expect(ecriture.body.recipient_email ?? null).toBeNull();
  });

  // ⚠️ SANS ÇA : un redéploiement, une reprise sur erreur ou un double clic donnent trois liens
  // pour la même plaquette — donc des statistiques fragmentées en trois, découvertes en les
  // lisant six mois plus tard. La clé n'a demandé aucune colonne : « le lien de l'hôte pour ce
  // document » est la ligne sans créateur ET sans destinataire.
  it("réutilise le lien existant au lieu d'en fabriquer un second", async () => {
    lignesExistantes = [{ slug: "Deja-La-_xY12" }];
    const r = await appeler(CREATION);
    expect(r.statut).toBe(200);
    expect(r.corps.slug).toBe("Deja-La-_xY12");
    expect(r.corps.reused).toBe(true);
    expect(requetes.some((q) => q.methode === "POST"), "aucune création ne doit avoir lieu").toBe(false);
  });

  it("cherche bien la ligne sans créateur ni destinataire", async () => {
    await appeler(CREATION);
    const lecture = requetes.find((q) => q.methode === "GET");
    expect(lecture.chemin).toContain("created_by=is.null");
    expect(lecture.chemin).toContain("recipient_email=is.null");
  });
});

describe("ce que ce chemin ne peut PAS faire", () => {
  beforeEach(() => { lignesExistantes = []; });

  // Un secret de serveur ne doit pas donner à voir qui a lu quoi.
  it.each(["docshare.list", "docshare.revoke", "docshare.overview", "docshare.sessions", "docshare.setauth"])(
    "%s reste un acte de membre",
    async (action) => {
      const r = await appeler({ ...CREATION, action });
      expect(r.statut, action).toBe(403);
      expect(requetes.some((q) => q.methode !== "GET"), action).toBe(false);
    },
  );

  // Le nominatif a un membre : l'admettre ici rouvrirait par la bande ce que le jeton protège.
  // ⚠️ CETTE ROUTE REFUSAIT TOUT DESTINATAIRE, ET LA DÉCISION A CHANGÉ — PAS LA RAISON.
  //
  // Le refus protégeait d'un relais de courrier : sur une carte publique, un lecteur anonyme qui
  // peut nommer le destinataire fait de nos serveurs un expéditeur pour n'importe qui.
  //
  // Le second hôte a montré la limite : il IDENTIFIE son visiteur avant l'accès, et l'adresse vient
  // de sa base — le visiteur ne la saisit jamais. Une attestation n'est pas une affirmation.
  //
  // ⚠️ Mais l'objection tenait quand même, un cran plus loin : `recipient_email` sert d'identité
  // d'EXPÉDITEUR au repartage. Le danger n'était donc pas dans la création, il était dans ce que le
  // champ devient ensuite. C'est pour ça que le destinataire attesté va dans SA colonne — et que ces
  // tests vérifient d'abord ce qui reste fermé.
  describe("le destinataire attesté par l'hôte", () => {
    it("est accepté, et rangé dans sa propre colonne", async () => {
      const r = await appeler({ ...CREATION, recipientEmail: "Visiteur@Exemple.FR" });
      expect(r.statut).toBe(200);
      const creation = requetes.find((q) => q.methode === "POST");
      expect(creation, "le lien doit être créé").toBeTruthy();
      expect(creation.body[0].attested_recipient_email, "minusculée, comme toute adresse chez nous")
        .toBe("visiteur@exemple.fr");
    });

    // ⚠️ LA PROPRIÉTÉ QUI FERME LE RELAIS DE COURRIER, et elle est passive : la garde d'envoi exige
    // `recipient_email`, l'héritage du repartage le recopie. En le laissant vide, les deux refusent
    // sans rien savoir de cette histoire.
    it("ne remplit PAS le champ qui donne le droit d'expédier", async () => {
      await appeler({ ...CREATION, recipientEmail: "visiteur@exemple.fr" });
      const creation = requetes.find((q) => q.methode === "POST");
      expect(creation.body[0].recipient_email,
        "sinon un porteur du lien ferait partir un courrier signé de ce visiteur")
        .toBeFalsy();
      expect(creation.body[0].created_by, "et personne ne s'est authentifié derrière ce lien")
        .toBeFalsy();
    });

    // ⚠️ SANS CETTE DISTINCTION, LE PREMIER VISITEUR ATTESTÉ RÉCUPÈRE LE LIEN ANONYME. Les deux ont
    // ni créateur ni destinataire au sens de `recipient_email` : la clé d'idempotence les
    // confondrait, et toutes les lectures seraient attribuées à la même personne.
    it("l'idempotence distingue un lien attesté du lien anonyme", async () => {
      await appeler({ ...CREATION, recipientEmail: "visiteur@exemple.fr" });
      const lecture = requetes.find((q) => q.methode === "GET" && q.chemin.includes("doc_id="));
      expect(lecture.chemin).toContain("attested_recipient_email=eq.visiteur%40exemple.fr");
    });

    it("et un lien sans destinataire cherche bien l'absence de destinataire attesté", async () => {
      await appeler({ ...CREATION });
      const lecture = requetes.find((q) => q.methode === "GET" && q.chemin.includes("doc_id="));
      expect(lecture.chemin).toContain("attested_recipient_email=is.null");
    });

    // ⚠️ SANS LA COLONNE, ON REFUSE — ON N'ÉCRIT PAS AILLEURS. Un repli sur `recipient_email`
    // rouvrirait très exactement la porte que la séparation ferme, et le ferait en silence.
    it("sans la migration, il refuse en nommant le fichier à appliquer", async () => {
      colonneAbsente = true;
      const r = await appeler({ ...CREATION, recipientEmail: "visiteur@exemple.fr" });
      colonneAbsente = false;
      expect(r.statut).toBe(409);
      expect(String(r.corps.message), "un refus qui ne dit pas quoi faire coûte des heures")
        .toContain("0001-destinataire-atteste.sql");
      expect(requetes.some((q) => q.methode === "POST"), "et rien n'est écrit").toBe(false);
    });
  });

  it("exige un identifiant de document — sans lui, pas d'idempotence possible", async () => {
    expect((await appeler({ ...CREATION, docId: "" })).statut).toBe(400);
  });
});

describe("l'authentification elle-même", () => {
  beforeEach(() => { lignesExistantes = []; });

  it("sans secret, on retombe sur le jeton — donc 401", async () => {
    const r = await appeler(CREATION, { secret: null });
    expect(r.statut).toBe(401);
  });

  it("un mauvais secret ne passe pas", async () => {
    const r = await appeler(CREATION, { secret: "presque-le-bon-secret-0123456789" });
    expect(r.statut).toBe(401);
  });

  // ⚠️ Non configuré ⇒ refusé. Un pouvoir qu'on ne sait pas accorder ne s'accorde pas — et
  // surtout, un secret vide ne doit jamais valoir « tout le monde entre ».
  it("secret non configuré : le chemin n'existe pas, même avec un en-tête vide", async () => {
    expect((await appeler(CREATION, { secret: "", secretConfigure: "" })).statut).toBe(401);
    expect((await appeler(CREATION, { secret: "n-importe-quoi", secretConfigure: "" })).statut).toBe(401);
  });
});

// La carte d'identité dit ce que l'instance SAIT faire et ce qui est POSÉ — deux questions, et
// seule la seconde explique un refus. Même leçon que `separateIssuer` ce matin.
describe("ce que la carte d'identité en dit", () => {
  it("annonce la capacité et son état de configuration", async () => {
    player.init(contexte());
    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b || ""); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, res);
    const carte = JSON.parse(res.body);
    expect(carte.capabilities).toContain("host-share");
    expect(carte.hostShare).toBe(true);
  });

  it("dit non quand le secret n'est pas posé", async () => {
    player.init(contexte({ secretConfigure: "" }));
    const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b || ""); } };
    await player.handler({ method: "GET", headers: {}, socket: {}, query: { contract: "1" } }, res);
    expect(JSON.parse(res.body).hostShare).toBe(false);
  });
});
