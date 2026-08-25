// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// @vitest-environment jsdom
//
// LA BASCULE DE DOCUMENT ET LES COURSES DE RENDU — P1 d'audit externe.
//
// ⚠️ TROIS DÉFAUTS, UNE MÊME CAUSE : un état qui se lit comme un TOUT était mis à jour EN PARTIE.
//
// 1. `switchDoc` posait la nouvelle URL mais PAS `fileName` — or c'est `fileName` qui fait foi pour
//    décider image ou PDF. Après une bascule PDF → PNG, le nouveau PNG partait donc dans pdf.js ;
//    après PNG → PDF, le nouveau PDF était chargé avec `new Image()`. Dans les deux cas, le
//    spectateur voyait « Document indisponible » — sur un document parfaitement valide.
// 2. Les callbacks de chargement n'avaient aucune génération : le document ABANDONNÉ pouvait finir
//    de charger après le nouveau et poser ses pages par-dessus.
// 3. `show()` jetait le `RenderTask` et publiait le canvas AVANT la fin du rendu : deux `getPage()`
//    en vol se résolvant dans le désordre laissaient gagner le plus LENT.
//
// ⚠️ ON EXÉCUTE LA PAGE, on ne lit pas sa source. Une garde de texte sur ce fichier serait
// satisfaite par les commentaires qui expliquent le correctif — c'est arrivé la veille sur une
// autre garde. Ici on branche un faux pdf.js et on regarde ce que la page FAIT.

const PRESENTATION_ID = require.resolve("../presentations.js");
const vraies = require("../presentations.js");
const PRESENTATION = {
  slug: "Ab3-_xYz9012", doc_title: "Démo", file_name: "demo.pdf",
  file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/demo.pdf",
  current_page: 1, active: true, updated_at: "2026-08-21T00:00:00.000Z",
};
// ⚠️ LE DOCUMENT DE DÉPART EST RÉGLABLE PAR TEST, et ce n'est pas du confort : le défaut « image →
// PDF » ne peut se produire QUE si la page a d'abord affiché une image. Un test qui part toujours
// d'un PDF resterait vert en présence du défaut — il dépendrait du test précédent pour avoir un
// sens, ce qui n'est pas une garde mais une coïncidence d'ordre.
let depart = { ...PRESENTATION };
require.cache[PRESENTATION_ID] = {
  id: PRESENTATION_ID, filename: PRESENTATION_ID, loaded: true,
  exports: { ...vraies, getPresentation: async () => ({ ...depart }), listMessages: async () => [] },
};
const player = require("../handler.js");

function contexteMinimal() {
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

async function htmlAudience() {
  player.init(contexteMinimal());
  const res = { statusCode: 0, headers: {}, body: "", setHeader(k, v) { this.headers[k.toLowerCase()] = v; }, end(b) { this.body = String(b == null ? "" : b); } };
  await player.handler({ method: "GET", headers: {}, socket: {}, query: { present: PRESENTATION.slug } }, res);
  return res.body;
}

/** Un pdf.js de laboratoire : chaque page rend une promesse qu'on résout à la main. */
function fauxPdfjs() {
  // ⚠️ LE RENDU DOIT ABOUTIR, sinon le banc ne mesure rien. Première version : `render()` rendait une
  // promesse que personne ne résolvait — aucun canvas n'était donc JAMAIS publié, l'assertion sur le
  // canvas était sautée, et deux mutations du code de production passaient au vert. Un faux qui ne
  // va pas au bout du geste transforme la garde en décor.
  const journal = { documents: 0, pagesDemandees: [], rendus: [], annulations: 0, detruits: 0 };
  const attentes = new Map();          // n° de page → fonction de livraison
  const rendusEnCours = new Map();     // n° de page → fin du rendu, déclenchée à la main
  const pdf = {
    numPages: 5,
    destroy() { journal.detruits += 1; },
    getPage(n) {
      journal.pagesDemandees.push(n);
      return new Promise((resoudre) => {
        attentes.set(n, () => resoudre({
          getViewport: () => ({ width: 800, height: 600, scale: 1 }),
          render() {
            journal.rendus.push(n);          // ← l'observable propre à la garde du getPage
            let fini;
            const promesse = new Promise((r) => { fini = r; });
            rendusEnCours.set(n, fini);
            return { promise: promesse, cancel() { journal.annulations += 1; } };
          },
        }));
      });
    },
  };
  // ⚠️ LE CHARGEMENT AUSSI SE CONTRÔLE. Avec un `getDocument` qui résout tout de suite, on ne peut
  // pas mettre DEUX documents en vol — donc pas tester ce qui arrive quand l'abandonné répond après
  // le nouveau. Une garde qu'aucun scénario ne peut atteindre n'est pas prouvée.
  const docsEnAttente = [];
  const lib = {
    GlobalWorkerOptions: {},
    getDocument() {
      journal.documents += 1;
      const nPages = 4 + journal.documents;      // chaque document a un nombre de pages DIFFÉRENT
      let livrer;
      const promesse = new Promise((r) => { livrer = () => r({ ...pdf, numPages: nPages }); });
      docsEnAttente.push({ livrer, nPages });
      return { promise: promesse, destroy() { journal.detruits += 1; } };
    },
  };
  return {
    lib, journal,
    /** Résout le `getPage(n)` en attente : le rendu DÉMARRE mais ne s'achève pas seul. */
    livrerPage: (n) => { const f = attentes.get(n); if (f) { attentes.delete(n); f(); } },
    /** Achève le rendu de la page n — c'est lui qui autorise la publication du canvas. */
    terminerRendu: (n) => { const f = rendusEnCours.get(n); if (f) { rendusEnCours.delete(n); f(); } },
    /** Livre le i-ème `getDocument` demandé (0 = le premier). */
    livrerDocument: (i) => { const d = docsEnAttente[i]; if (d) d.livrer(); return d ? d.nPages : 0; },
    docsEnAttente,
  };
}

async function montrerLaPage() {
  const html = await htmlAudience();
  document.documentElement.innerHTML = html.replace(/^[\s\S]*?<body[^>]*>/i, "").replace(/<\/body>[\s\S]*$/i, "");
  const blocs = [...new window.DOMParser().parseFromString(html, "text/html").querySelectorAll("script")]
    .map((s) => s.textContent || "").filter((c) => c.trim());
  const faux = fauxPdfjs();
  window.pdfjsLib = faux.lib;                    // le script lit la globale : on la pose AVANT
  const images = [];
  const VraieImage = window.Image;
  window.Image = function () { const im = new VraieImage(); images.push(im); return im; };
  // ⚠️ Le bundle commence par "use strict" : un eval INDIRECT en mode strict garde ses `var` pour
  // lui, donc `Player` n'atteindrait jamais la portée globale que le script de page interroge. On
  // exporte la liaison depuis l'INTÉRIEUR du même eval — sans modifier une ligne du code testé.
  const exporter = ";try{if(typeof Player!=='undefined')window.Player=Player;}catch(e){}";
  const echecs = [];
  for (const code of blocs) {
    try { window.eval(code + exporter); } catch (e) { echecs.push(String((e && e.message) || e)); }
  }
  // Les blocs qui échouent le font pour une dépendance absente (pdf.js importé dynamiquement), pas
  // pour une erreur de syntaxe — et on le VÉRIFIE plutôt que de l'avaler en silence.
  for (const m of echecs) {
    expect(m, `un bloc de la page a échoué pour autre chose qu'une dépendance : ${m}`)
      .not.toMatch(/is not defined|Unexpected|SyntaxError/);
  }
  await new Promise((r) => setTimeout(r, 0));
  return { faux, images };
}

const ligne = (over) => ({ ...depart, ...over });

beforeEach(() => { depart = { ...PRESENTATION }; });

describe("bascule de document : le type est relu sur le NOUVEAU document", () => {
  it("PDF → image : le PNG ne part pas dans pdf.js", async () => {
    const { faux, images } = await montrerLaPage();
    expect(typeof window.__presAppliquerEtat, "le point d'entrée d'état doit exister").toBe("function");
    const avant = faux.journal.documents;
    window.__presAppliquerEtat(ligne({
      file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/photo.png",
      file_name: "photo.png", updated_at: "2026-08-21T10:00:00.000Z",
    }));
    await new Promise((r) => setTimeout(r, 0));
    expect(faux.journal.documents, "un PNG envoyé à pdf.js : c'est le défaut").toBe(avant);
    expect(images.length, "il doit être chargé comme une image").toBeGreaterThan(0);
  });

  it("image → PDF : le PDF ne part pas dans new Image()", async () => {
    // On PART d'une image : c'est la seule situation où ce défaut peut se manifester.
    depart = { ...PRESENTATION, file_name: "photo.png", file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/photo.png" };
    const { faux, images } = await montrerLaPage();
    const imagesApresPng = images.length;
    const docsAvant = faux.journal.documents;
    window.__presAppliquerEtat(ligne({
      file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/autre.pdf",
      file_name: "autre.pdf", updated_at: "2026-08-21T11:00:00.000Z",
    }));
    await new Promise((r) => setTimeout(r, 0));
    expect(faux.journal.documents, "le PDF doit repasser par pdf.js").toBe(docsAvant + 1);
    expect(images.length, "et surtout pas par new Image()").toBe(imagesApresPng);
  });
});

// ⚠️ LA COURSE DE RENDU. pdf.js ne garantit AUCUN ordre entre deux `getPage()` : un changement de
// page rapide (ou un redimensionnement) en met deux en vol, et c'est le plus LENT qui gagnait —
// l'audience restait sur une page que le présentateur avait quittée. Le symptôme est intermittent,
// donc invisible au banc tant qu'on ne force pas l'ordre inverse à la main.
async function pageAvecPdfCharge() {
  const ctx = await montrerLaPage();
  // Une bascule amène un vrai document dans la page (le chargement initial passe par boot(),
  // qui ne s'exécute pas hors navigateur : c'est la bascule qui nous donne la prise).
  window.__presAppliquerEtat(ligne({
    file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/second.pdf",
    file_name: "second.pdf", updated_at: "2026-08-21T12:00:00.000Z", current_page: 1,
  }));
  await new Promise((r) => setTimeout(r, 0));
  ctx.faux.livrerDocument(0);
  await new Promise((r) => setTimeout(r, 0));
  return ctx;
}

const allerA = async (n) => {
  window.__presAppliquerEtat(ligne({
    file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/second.pdf",
    file_name: "second.pdf", updated_at: "2026-08-21T12:00:00.000Z", current_page: n,
  }));
  await new Promise((r) => setTimeout(r, 0));
};


describe("courses de rendu : le dernier demandé gagne, pas le dernier arrivé", () => {
  it("deux pages en vol résolues DANS LE DÉSORDRE : la plus ancienne ne s'affiche pas", async () => {
    const { faux } = await pageAvecPdfCharge();
    faux.livrerPage(1);
    await new Promise((r) => setTimeout(r, 0));

    await allerA(2);
    await allerA(3);
    expect(faux.journal.pagesDemandees, "les deux pages doivent bien avoir été demandées")
      .toEqual(expect.arrayContaining([2, 3]));

    // On livre la page 3 (la plus récente) PUIS la page 2 (l'ancienne, plus lente).
    // ⚠️ Un tick ENTRE la livraison et la fin du rendu : `render()` n'est appelé qu'après la
    // résolution de `getPage`, qui est une microtâche. Terminer trop tôt ne terminait rien.
    faux.livrerPage(3);
    await new Promise((r) => setTimeout(r, 0));
    faux.terminerRendu(3);
    await new Promise((r) => setTimeout(r, 0));
    faux.livrerPage(2);
    await new Promise((r) => setTimeout(r, 0));
    faux.terminerRendu(2);
    await new Promise((r) => setTimeout(r, 0));

    // ⚠️ PAS DE `if (canvas)`. Une assertion sous condition ne rougit jamais quand la condition est
    // fausse — et elle l'était, faute de rendu abouti. On exige donc qu'un canvas SOIT là, puis on
    // regarde lequel.
    const canvas = document.getElementById("page").querySelector("canvas");
    expect(canvas, "aucun canvas publié : le banc ne peut rien conclure").not.toBeNull();
    expect(canvas.getAttribute("aria-label"),
      "la page 2, arrivée en dernier, a écrasé la page 3 que le présentateur affiche")
      .toMatch(/Page 3\b/);
  });

  // ⚠️ L'ANNULATION EST UNE AUTRE SITUATION, et ma première version la testait au mauvais endroit :
  // quand deux `getPage()` sont encore EN VOL, aucun rendu n'a démarré, donc il n'y a rien à
  // annuler — l'assertion échouait sur un code correct. Il faut un rendu réellement EN COURS.
  it("un rendu EN COURS est annulé quand un autre le remplace", async () => {
    const { faux } = await pageAvecPdfCharge();
    faux.livrerPage(1);                       // le rendu de la page 1 démarre…
    await new Promise((r) => setTimeout(r, 0));
    expect(faux.journal.rendus, "un rendu doit être en cours pour qu'il y ait quelque chose à annuler")
      .toContain(1);
    await allerA(2);                          // …et il est remplacé avant de s'achever
    expect(faux.journal.annulations,
      "le RenderTask était jeté : deux rendus peignaient alors en parallèle sur des canvas différents")
      .toBeGreaterThan(0);
  });

  it("un rendu périmé ne publie pas son canvas", async () => {
    const { faux } = await pageAvecPdfCharge();
    faux.livrerPage(1);
    await new Promise((r) => setTimeout(r, 0));
    const avant = document.getElementById("page").innerHTML;
    await allerA(4);
    await allerA(5);
    const rendusAvant = faux.journal.rendus.length;
    faux.livrerPage(4);                       // la périmée arrive : elle ne doit rien poser
    await new Promise((r) => setTimeout(r, 0));
    const apres = document.getElementById("page").innerHTML;
    expect(apres, "le canvas d'un rendu périmé a été publié").toBe(avant);
    // ⚠️ OBSERVABLE PROPRE À LA GARDE DU `getPage` : une page périmée ne doit même pas déclencher
    // de rendu. Sans cette assertion, la garde d'après-rendu masquerait celle-ci et aucune mutation
    // ne pourrait les distinguer — un correctif à deux changements ne se prouve pas.
    expect(faux.journal.rendus.length,
      "une page périmée a lancé un rendu : travail inutile, et une occasion de plus d'écraser")
      .toBe(rendusAvant);
  });
});

// ⚠️ DEUX GARDES QUE LES SCÉNARIOS PRÉCÉDENTS NE POUVAIENT PAS ATTEINDRE — donc que rien ne prouvait.
// Les retirer laissait le banc VERT : elles étaient masquées par leurs voisines. Un correctif dont
// aucune mutation ne rougit n'est pas vérifié, il est seulement présent.
describe("les callbacks périmés ne s'imposent pas, même quand la garde voisine les laisse passer", () => {
  it("un rendu qui se périme PENDANT qu'il peint ne publie pas son canvas", async () => {
    const { faux } = await pageAvecPdfCharge();
    faux.livrerPage(1);
    await new Promise((r) => setTimeout(r, 0));      // le rendu de la page 1 est EN COURS
    const avant = document.getElementById("page").innerHTML;
    await allerA(2);                                 // la page 1 devient périmée pendant son rendu
    faux.terminerRendu(1);                           // …et son rendu s'achève quand même
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("page").innerHTML,
      "un rendu devenu périmé pendant qu'il peignait a tout de même publié son canvas")
      .toBe(avant);
  });

  it("un document ABANDONNÉ qui finit de charger ne remplace pas le document courant", async () => {
    const { faux } = await montrerLaPage();
    // Deux bascules coup sur coup : deux chargements en vol.
    window.__presAppliquerEtat(ligne({ file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/a.pdf", file_name: "a.pdf", updated_at: "2026-08-21T13:00:00.000Z" }));
    await new Promise((r) => setTimeout(r, 0));
    window.__presAppliquerEtat(ligne({ file_url: "https://exemple.supabase.co/storage/v1/object/public/resources/b.pdf", file_name: "b.pdf", updated_at: "2026-08-21T14:00:00.000Z" }));
    await new Promise((r) => setTimeout(r, 0));
    expect(faux.docsEnAttente.length, "deux chargements doivent être en vol").toBe(2);

    const pagesDeB = faux.livrerDocument(1);         // le NOUVEAU répond d'abord
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("tot").textContent).toBe(String(pagesDeB));

    faux.livrerDocument(0);                          // puis l'ABANDONNÉ arrive en retard
    await new Promise((r) => setTimeout(r, 0));
    expect(document.getElementById("tot").textContent,
      "le document abandonné a remplacé celui que le présentateur affiche")
      .toBe(String(pagesDeB));
  });
});
