// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LE PLAYER DOIT SAVOIR CE QUE LA BASE PORTE, SANS POUVOIR LE CHANGER.
//
// Il parle à Supabase par PostgREST, qui n'exécute pas de DDL : il n'appliquera donc jamais une
// migration. C'est l'hôte qui applique. Ce qui reste au player, c'est de ne pas casser quand la
// migration n'est pas encore passée — et de nommer le fichier à appliquer plutôt que de renvoyer
// une erreur de base.
//
// ⚠️ ET IL DEMANDE PLUTÔT QU'IL NE RETIENT. Une table de suivi des migrations aurait dû être créée
// par une migration : le premier pas serait retombé sur le problème qu'elle résout. Un registre dit
// ce qu'on CROIT avoir appliqué, une sonde dit ce qui EST — et les deux divergent le jour où
// quelqu'un applique à la main, c'est-à-dire le jour où ça compte.

const schema = require("../schema.js");

function base({ presente = true, injoignable = false } = {}) {
  const appels = [];
  schema.init({ db: { async request(chemin) {
    appels.push(String(chemin));
    if (injoignable) throw new Error("réseau");
    if (!presente) throw new Error('column "x" does not exist');
    return [];
  } } });
  return { appels };
}

describe("la sonde répond sur ce que la base porte", () => {
  it("une colonne présente est reconnue", async () => {
    base({ presente: true });
    expect(await schema.aLaColonne("t", "c", "0001-x.sql")).toBe(true);
  });

  it("une colonne absente aussi, et sans lever", async () => {
    base({ presente: false });
    expect(await schema.aLaColonne("t", "c", "0001-x.sql")).toBe(false);
  });

  // ⚠️ EN CAS DE DOUTE, ABSENTE. Supposer présente ferait échouer l'écriture ENTIÈRE — la fonction
  // nouvelle et tout ce qui l'accompagne. Supposer absente ne fait attendre que la fonction, et
  // l'erreur se répare toute seule quand la migration arrive.
  it("une base injoignable vaut « absente », pas « présente »", async () => {
    base({ injoignable: true });
    expect(await schema.aLaColonne("t", "c", "0001-x.sql"), "un doute ne doit jamais coûter une écriture")
      .toBe(false);
  });

  it("la question n'est posée qu'une fois par processus", async () => {
    const b = base({ presente: true });
    for (let i = 0; i < 50; i++) await schema.aLaColonne("t", "c", "0001-x.sql");
    expect(b.appels.length, "une sonde par écriture ferait payer la détection à chaque requête").toBe(1);
  });

  it("deux colonnes sont deux questions", async () => {
    const b = base({ presente: true });
    await schema.aLaColonne("t", "a", "0001-x.sql");
    await schema.aLaColonne("t", "b", "0001-x.sql");
    expect(b.appels.length).toBe(2);
  });

  // ⚠️ Les réponses valent pour UNE base. Un hôte qui rebranche son contexte sur un autre projet
  // doit reposer la question, pas hériter des réponses du précédent.
  it("réinitialiser le contexte oublie les réponses", async () => {
    base({ presente: false });
    expect(await schema.aLaColonne("t", "c", "0001-x.sql")).toBe(false);
    const b = base({ presente: true });
    expect(await schema.aLaColonne("t", "c", "0001-x.sql")).toBe(true);
    expect(b.appels.length).toBe(1);
  });

  it("elle ne demande aucune ligne : seulement si la colonne se sélectionne", async () => {
    const b = base({ presente: true });
    await schema.aLaColonne("doc_presentations", "write_seq", "0002-x.sql");
    expect(b.appels[0], "ramener des lignes pour une question de schéma coûterait pour rien")
      .toContain("limit=0");
    expect(b.appels[0]).toContain("select=write_seq");
  });
});

// ⚠️ NOMMER LE FICHIER, PAS L'ERREUR. « column does not exist » envoie l'exploitant lire du
// PostgREST ; « appliquez supabase/migrations/0001-….sql » lui dit quoi faire. C'est la même leçon
// que le refus de quota muet : un défaut qui ne nomme pas sa cause coûte des heures.
describe("une colonne manquante se signale, une fois", () => {
  it("le journal nomme la migration à appliquer", async () => {
    const dits = [];
    const vrai = console.warn;
    console.warn = (m) => dits.push(String(m));
    try {
      base({ presente: false });
      await schema.aLaColonne("doc_presentations", "write_seq", "supabase/migrations/0002-ordre.sql");
    } finally { console.warn = vrai; }
    expect(dits.join(" ")).toContain("supabase/migrations/0002-ordre.sql");
    expect(dits.join(" "), "et il dit ce qui dégrade, pas seulement ce qui manque").toMatch(/inactive|manque/i);
  });

  // ⚠️ LE DÉDOUBLONNAGE VIENT DU CACHE, PAS D'UNE GARDE À PART. Une première version portait un
  // ensemble « déjà signalé » — vidé exactement quand le cache l'est, donc inatteignable : le
  // retirer ne faisait échouer aucun test. On l'a supprimé plutôt que d'inventer un test pour le
  // justifier. Ce test-ci vérifie la propriété observable ; c'est le cache qui la produit.
  it("et il ne le répète pas à chaque écriture", async () => {
    const dits = [];
    const vrai = console.warn;
    console.warn = (m) => dits.push(String(m));
    try {
      base({ presente: false });
      for (let i = 0; i < 20; i++) await schema.aLaColonne("t", "c", "0001-x.sql");
    } finally { console.warn = vrai; }
    expect(dits.length, "vingt lignes identiques noient ce qu'il faut lire").toBe(1);
  });
});
