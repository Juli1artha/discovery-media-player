// LA VÉRIFICATION ÉTAIT FAITE, PUIS L'ÉCRITURE PARTAIT SANS ELLE.
//
// Six chemins lisaient la ligne, vérifiaient (jeton ou propriétaire), puis PATCHaient par slug
// seul. Entre la vérification et l'écriture, le monde peut changer : transfert, reprise, clôture,
// heartbeat. L'écriture s'appliquait alors à une session qui n'était plus celle qu'on avait
// vérifiée. `setPage` et `endPresentation` avaient déjà la forme juste — la condition DANS le
// filtre, la comparaison et l'écriture en un seul geste ; ces essais l'exigent des six autres.
// Constat du troisième audit.
//
// ⚠️ LE HARNAIS ÉVALUE LES CONDITIONS CONTRE LA LIGNE COURANTE, PAS CONTRE CELLE QUI A ÉTÉ LUE.
// C'est toute la différence : un harnais qui rend toujours « une ligne modifiée » ne peut pas
// distinguer un PATCH conditionné d'un PATCH aveugle.

const presentations = require("../presentations.js");
const crypto = require("node:crypto");
const sha = (t) => crypto.createHash("sha256").update(String(t)).digest("hex");

/** Une table d'une ligne, qui évalue les filtres du PATCH contre son état COURANT. */
function table(ligne) {
  const etat = { ligne: { ...ligne }, patches: [], lectures: 0, surLecture: null };
  function correspond(condition) {
    // Ne comprend que ce que le produit émet — tout le reste est un défaut du produit, pas du harnais.
    for (const partie of condition.split("?")[1].split("&")) {
      const [colonne, reste] = partie.split("=", 2);
      if (colonne === "select" || colonne === "limit") continue;
      const [op, ...v] = reste.split(".");
      const valeur = decodeURIComponent(v.join("."));
      const actuel = etat.ligne[colonne];
      if (op === "eq" && String(actuel) !== valeur) return false;
      if (op === "lte" && !(String(actuel) <= valeur)) return false;
      if (op === "in" && !valeur.replace(/^\(|\)$/g, "").split(",").includes(String(actuel))) return false;
    }
    return true;
  }
  presentations.init({
    errors: { capture() {} },
    db: {
      async request(chemin, o) {
        if (!o || !o.method) {
          // La copie est prise AVANT le crochet : la lecture voit l'état d'avant, la mutation ne
          // frappe qu'ensuite — c'est ce qui place la course là où elle vit, entre lecture et PATCH.
          const resultat = correspond(chemin) ? [{ ...etat.ligne }] : [];
          etat.lectures += 1;
          if (etat.surLecture) etat.surLecture(etat);
          return resultat;
        }
        if (o.method === "PATCH") {
          etat.patches.push(chemin);
          if (!correspond(chemin)) return [];               // zéro ligne : le refus de PostgREST
          Object.assign(etat.ligne, o.body);
          return [{ ...etat.ligne }];
        }
        return [];
      },
    },
  });
  return etat;
}

const CONTROL = "jeton-du-presentateur";
const LIGNE = {
  slug: "Ab3-_xYz9012", active: true, control_hash: sha(CONTROL), chat_locked: false,
  owner_email: "alice@exemple.fr", current_page: 3, last_seen: new Date().toISOString(),
  file_url: "https://exemple.fr/d.pdf", file_name: "d.pdf", doc_title: "Doc", doc_id: "d1",
};

describe("l'écriture porte sa condition — le monde a pu changer depuis la vérification", () => {
  it("une reprise de l'ANCIEN propriétaire, après transfert, ne vole pas la session", async () => {
    const t = table(LIGNE);
    const lecture = presentations.reclaimPresentation(LIGNE.slug, "alice@exemple.fr");
    t.ligne.owner_email = "bob@exemple.fr";               // le transfert passe ENTRE la lecture et l'écriture
    const r = await lecture;
    expect(r.ok, "l'ancien propriétaire a régénéré le jeton du nouveau").toBe(false);
    expect(r.status).toBe(409);
    expect(t.ligne.control_hash, "le jeton de Bob a été écrasé").toBe(sha(CONTROL));
  });

  it("le heartbeat d'un onglet périmé ne maintient pas en vie une session reprise ailleurs", async () => {
    const t = table({ ...LIGNE, last_seen: "2020-01-01T00:00:00.000Z" });
    const enVol = presentations.touchPresentation(LIGNE.slug, CONTROL);
    t.ligne.control_hash = sha("jeton-regenere-par-la-reprise");
    const r = await enVol;
    expect(r.ok).toBe(false);
    expect(r.status, "l'onglet périmé doit apprendre qu'il ne pilote plus").toBe(409);
    expect(t.ligne.last_seen, "le heartbeat périmé a rafraîchi last_seen").toBe("2020-01-01T00:00:00.000Z");
  });

  it("une clôture retardée de l'ancien propriétaire ne ferme pas la session du nouveau", async () => {
    const t = table(LIGNE);
    const enVol = presentations.endPresentationByOwner(LIGNE.slug, "alice@exemple.fr", false);
    t.ligne.owner_email = "bob@exemple.fr";
    const r = await enVol;
    expect(r.ok).toBe(false);
    expect(t.ligne.active, "la présentation de Bob a été fermée par Alice").toBe(true);
  });

  it("l'admin, lui, ferme ce qu'il veut — la modération ne dépend pas d'une course", async () => {
    const t = table(LIGNE);
    const r = await presentations.endPresentationByOwner(LIGNE.slug, "", true);
    expect(r.ok).toBe(true);
    expect(t.ligne.active).toBe(false);
  });

  it("deux transferts concurrents : le second ne change pas le document de mains une seconde fois", async () => {
    const t = table(LIGNE);
    const enVol = presentations.handoverPresentation(LIGNE.slug, "alice@exemple.fr", { email: "carol@exemple.fr" });
    t.ligne.owner_email = "bob@exemple.fr";               // le premier transfert a gagné
    const r = await enVol;
    expect(r.ok).toBe(false);
    expect(t.ligne.owner_email, "le transfert perdant a quand même changé le propriétaire").toBe("bob@exemple.fr");
  });

  it("un verrou de chat posé après une reprise ailleurs ne s'applique pas", async () => {
    // ⚠️ La rotation du jeton doit frapper APRÈS la dernière lecture — `setChatLock` relit la ligne
    // (archive, puis jeton) et une mutation trop précoce est vue par la VÉRIFICATION, pas par la
    // course. Première version de cet essai : mutée trop tôt, elle laissait passer un PATCH
    // inconditionnel — le 403 du contrôle jouait à la place du 409 de la condition.
    const t = table(LIGNE);
    t.surLecture = (etat) => { if (etat.lectures === 2) etat.ligne.control_hash = sha("jeton-regenere"); };
    const r = await presentations.setChatLock(LIGNE.slug, CONTROL, true);
    expect(r.ok).toBe(false);
    expect(r.status, "la course doit être refusée par la CONDITION, pas par la vérification").toBe(409);
    expect(t.ligne.chat_locked, "le verrou d'une session périmée s'est appliqué").toBe(false);
  });

  // ⚠️ La moitié qui manque à la plupart des gardes : le chemin LÉGITIME doit encore passer.
  it("quand rien n'a bougé, chacune des cinq écritures passe", async () => {
    table(LIGNE);
    expect((await presentations.reclaimPresentation(LIGNE.slug, "alice@exemple.fr")).ok).toBe(true);
    table(LIGNE);
    expect((await presentations.touchPresentation(LIGNE.slug, CONTROL)).ok).toBe(true);
    let t = table(LIGNE);
    expect((await presentations.endPresentationByOwner(LIGNE.slug, "alice@exemple.fr", false)).ok).toBe(true);
    expect(t.ligne.active).toBe(false);
    t = table(LIGNE);
    expect((await presentations.handoverPresentation(LIGNE.slug, "alice@exemple.fr", { email: "bob@exemple.fr" })).ok).toBe(true);
    expect(t.ligne.owner_email).toBe("bob@exemple.fr");
    t = table(LIGNE);
    expect((await presentations.setChatLock(LIGNE.slug, CONTROL, true)).ok).toBe(true);
    expect(t.ligne.chat_locked).toBe(true);
  });
});

describe("l'auto-purge n'éteint pas une session redevenue vivante", () => {
  function tableListe(lignes) {
    const etat = { lignes: lignes.map((l) => ({ ...l })), patches: [] };
    presentations.init({
      errors: { capture() {} },
      db: {
        async request(chemin, o) {
          if (!o || !o.method) return etat.lignes.map((l) => ({ ...l }));
          if (o.method === "PATCH") {
            etat.patches.push(chemin);
            const q = Object.fromEntries(chemin.split("?")[1].split("&").map((p) => {
              const [c, r] = p.split("=", 2); return [c, r];
            }));
            for (const l of etat.lignes) {
              const dansIn = !q.slug || q.slug.replace(/^in\.\(|\)$/g, "").split(",").map(decodeURIComponent).includes(l.slug);
              const actif = !q.active || String(l.active) === q.active.slice(3);
              const assezVieux = !q.last_seen || String(l.last_seen) <= decodeURIComponent(q.last_seen.slice(4));
              if (dansIn && actif && assezVieux) Object.assign(l, o.body);
            }
            return [];
          }
          return [];
        },
      },
    });
    return etat;
  }

  it("la ligne qui a heartbeaté entre la lecture et la purge reste active", async () => {
    const vieux = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const t = tableListe([
      { slug: "morte-000001", active: true, last_seen: vieux, updated_at: vieux, owner_email: "a@x.fr" },
      { slug: "vivante-0001", active: true, last_seen: vieux, updated_at: vieux, owner_email: "b@x.fr" },
    ]);
    // Le heartbeat arrive APRÈS la lecture de la liste : on le simule en rafraîchissant la ligne
    // avant que la purge n'écrive — la condition `last_seen=lte.seuil` doit l'épargner.
    const enVol = presentations.listActivePresentations("a@x.fr");
    t.lignes[1].last_seen = new Date().toISOString();
    await enVol;
    expect(t.lignes[0].active, "l'orpheline doit être purgée").toBe(false);
    expect(t.lignes[1].active, "une session redevenue vivante a été éteinte sous son présentateur").toBe(true);
  });
});

// ⚠️ DEUX SURVIVANTS DE LA MÊME CLASSE, trouvés par le cinquième audit : le changement de document
// et le contenu (carte) vérifiaient le propriétaire à la LECTURE, puis écrivaient sur
// `slug+active` seuls — la requête retardée d'Alice modifiait encore la présentation que le
// transfert venait de donner à Bob.
describe("le propriétaire voyage dans la condition — switch et contenu aussi", () => {
  it("un changement de document retardé, après transfert, ne touche pas la présentation de Bob", async () => {
    const t = table({ ...LIGNE, file_url: "https://exemple.fr/ancien.pdf" });
    t.surLecture = (etat) => { if (etat.lectures === 1) etat.ligne.owner_email = "bob@exemple.fr"; };
    const r = await presentations.switchPresentationDoc(LIGNE.slug, "alice@exemple.fr", false, { fileUrl: "https://exemple.fr/nouveau.pdf" });
    expect(r.ok).toBe(false);
    expect(r.status).toBe(409);
    expect(t.ligne.file_url, "Alice a changé le document de Bob").toBe("https://exemple.fr/ancien.pdf");
  });

  it("un contenu (carte) retardé, après transfert, ne s'applique pas — voie propriétaire", async () => {
    const t = table({ ...LIGNE, content: null });
    t.surLecture = (etat) => { if (etat.lectures === 1) etat.ligne.owner_email = "bob@exemple.fr"; };
    const r = await presentations.setPresentationContent(LIGNE.slug, "alice@exemple.fr", false, { kind: "map", center: [46, 2], zoom: 6 }, null);
    expect(r.ok).toBe(false);
    expect(t.ligne.content, "la carte d'Alice s'est affichée chez l'audience de Bob").toBe(null);
  });

  it("l'admin écrit sans condition de propriétaire — modération", async () => {
    const t = table({ ...LIGNE, content: null });
    const r = await presentations.setPresentationContent(LIGNE.slug, "", true, { kind: "map", center: [46, 2], zoom: 6 }, null);
    expect(r.ok).toBe(true);
    expect(t.ligne.content).toBeTruthy();
  });

  it("et le chemin légitime passe : le vrai propriétaire change le document", async () => {
    const t = table({ ...LIGNE, file_url: "https://exemple.fr/ancien.pdf" });
    const r = await presentations.switchPresentationDoc(LIGNE.slug, "alice@exemple.fr", false, { fileUrl: "https://exemple.fr/nouveau.pdf" });
    expect(r.ok).toBe(true);
    expect(t.ligne.file_url).toBe("https://exemple.fr/nouveau.pdf");
  });
});
