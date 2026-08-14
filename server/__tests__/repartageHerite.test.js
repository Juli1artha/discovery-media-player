// UNE RESTRICTION NE DOIT PAS DISPARAÎTRE EN ÉTANT TRANSMISE.
//
// Le re-partage énumérait les colonnes à recopier. Une énumération se périme à chaque colonne
// ajoutée, en silence, et DU MAUVAIS CÔTÉ : la nouveauté est oubliée. Or ces colonnes sont
// `not null default` — l'oubli ne produisait donc pas un trou, il produisait la valeur par
// défaut, c'est-à-dire la plus PERMISSIVE.
//
// ⚠️ Le pire n'était pas dans le rapport qui a mené ici : `require_auth`. Un document derrière le
// mur d'accès, une fois re-partagé, s'ouvrait sans mur — un destinataire pouvait donc lever la
// protection en se transmettant le document à lui-même. Le second hôte a vu la marque, qui SE
// VOIT ; il a supposé que le reste suivait, et le reste suivait.
//
// Ces tests portent sur l'HÉRITAGE COMME MÉCANIQUE, pas sur une liste de champs — sinon ils se
// périmeraient exactement comme le code qu'ils remplacent.

const PARENT = {
  slug: "Parent-_xY12",
  doc_id: "programme-42",
  doc_title: "Plaquette",
  file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/p.pdf",
  file_name: "p.pdf",
  recipient_email: "premier@exemple.fr",
  recipient_name: "Premier",
  created_by: "commercial@exemple.fr",
  created_at: "2026-08-10T09:00:00.000Z",
  revoked: false,
  parent_slug: null,
  // Les trois restrictions, et tout ce qui les accompagne.
  require_auth: true,
  allow_download: false,
  brand_key: "valoneuf",
  brand_logo: "https://cdn/valoneuf.png",
  brand_dark: true,
  bot_enabled: true,
  bot_script: "un script",
  bot_guided: false,
  bot_profile_id: "profil-7",
  video_layout: "split",
  is_test: false,
};

let ecrites = [];

const shares = require("../shares.js");
shares.init({
  db: {
    async request(chemin, options = {}) {
      if (!options.method || options.method === "GET") return [{ ...PARENT }];
      ecrites.push(options.body[0]);
      return [];
    },
  },
});

async function repartager(surcharge = {}) {
  ecrites = [];
  Object.assign(PARENT, surcharge);
  await shares.createReshare(PARENT.slug, { email: "second@exemple.fr", name: "Second" });
  return ecrites[0];
}

describe("ce qui restreint suit le document", () => {
  it("⚠️ le mur d'accès survit au re-partage", async () => {
    const enfant = await repartager({ require_auth: true });
    expect(enfant.require_auth, "un document gaté re-partagé s'ouvrait SANS mur").toBe(true);
  });

  it("le téléchargement refusé le reste", async () => {
    const enfant = await repartager({ allow_download: false });
    expect(enfant.allow_download).toBe(false);
  });

  it("la marque suit le document là où il commence à circuler", async () => {
    const enfant = await repartager({ brand_key: "valoneuf" });
    expect(enfant.brand_key).toBe("valoneuf");
    expect(enfant.brand_logo).toBe("https://cdn/valoneuf.png");
    expect(enfant.brand_dark).toBe(true);
  });

  it("l'assistant et sa configuration suivent aussi", async () => {
    const enfant = await repartager();
    expect(enfant.bot_enabled).toBe(true);
    expect(enfant.bot_script).toBe("un script");
    expect(enfant.bot_guided).toBe(false);
    expect(enfant.bot_profile_id).toBe("profil-7");
    expect(enfant.video_layout).toBe("split");
  });
});

describe("ce qui NE suit pas, et c'est une décision", () => {
  it("l'enfant a sa propre identité", async () => {
    const enfant = await repartager();
    expect(enfant.slug).not.toBe(PARENT.slug);
    expect(enfant.recipient_email).toBe("second@exemple.fr");
    expect(enfant.recipient_name).toBe("Second");
    expect(enfant.parent_slug).toBe(PARENT.slug);
  });

  // La chaîne de diffusion : celui qui transmet devient le créateur du lien qu'il crée.
  it("le créateur est celui qui transmet, pas celui d'avant", async () => {
    const enfant = await repartager({ recipient_email: "premier@exemple.fr" });
    expect(enfant.created_by).toBe("premier@exemple.fr");
  });

  it("la date de création est celle de la base, pas celle du parent", async () => {
    const enfant = await repartager();
    expect(enfant.created_at).toBeUndefined();
  });

  it("un enfant naît vivant", async () => {
    const enfant = await repartager();
    expect(enfant.revoked).toBe(false);
  });
});

// ⚠️ LE TEST QUI COMPTE VRAIMENT.
//
// Les précédents vérifient des champs qui existent aujourd'hui ; celui-ci vérifie la MÉCANIQUE.
// Une colonne ajoutée demain doit être héritée sans que personne y pense — parce que le défaut
// sûr, pour une table de configuration d'accès, est de propager la restriction du parent plutôt
// que de retomber sur une valeur par défaut choisie pour les liens neufs.
//
// Si l'héritage redevenait une énumération, ce test tomberait avant qu'un utilisateur ne
// découvre la restriction levée.
describe("l'héritage est une règle, pas une liste", () => {
  it("une colonne inconnue du code est héritée quand même", async () => {
    const enfant = await repartager({ restriction_inventee_demain: true, reglage_futur: "valeur" });
    expect(enfant.restriction_inventee_demain,
      "l'héritage doit être par défaut : une colonne ajoutée plus tard ne doit pas retomber sur le défaut permissif de la base",
    ).toBe(true);
    expect(enfant.reglage_futur).toBe("valeur");
  });
});
