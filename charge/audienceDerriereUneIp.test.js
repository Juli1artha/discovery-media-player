// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// UNE SALLE DE MILLE PERSONNES DERRIÈRE UNE SEULE SORTIE — SIMULÉE CONTRE LE VRAI LIMITEUR.
//
// ⚠️ LA CAMPAGNE DE CHARGE EXISTANTE NE POSE PAS CETTE QUESTION, et c'est un audit externe qui l'a
// dit : elle distribue mille clients sur 250 adresses, donc quarante par sortie. Or le quota est
// PAR ADRESSE. Un amphithéâtre, un bâtiment d'entreprise, un salon derrière un NAT unique sont
// exactement le cas qu'elle ne couvre pas — et c'est le cas le plus courant d'une présentation.
//
// ⚠️ CE N'EST PAS UNE CAMPAGNE DE CHARGE, ET IL NE FAUT PAS LA LIRE COMME TELLE. Rien ici ne mesure
// des millisecondes, un serveur, ni une base. On simule la seule chose qui décide de ce refus : la
// DÉCISION du limiteur, prise avec les constantes réelles du produit et le vrai code du compteur, à
// la cadence réelle de l'audience. Ce qu'on obtient est un nombre de spectateurs et une minute —
// pas une latence.
//
// ⚠️ ET LA GARDE PASSE AVANT LE CACHE, DÉLIBÉRÉMENT (voir `handler.js`) : « écrite après, elle
// aurait laissé passer très exactement la requête qu'elle est censée épargner ». Donc CHAQUE
// sondage compte, servi par le cache mémoire ou non. C'est ce qui rend cette simulation fidèle.

const { creerLimites } = require("../context/standalone.js");
const {
  PRESENT_QUOTA_PER_HOUR, READERS_PER_EGRESS, PRESENT_RESYNC_MS, RESYNC_READS_PER_HOUR,
} = require("../server/shared.generated.js");

const HEURE_MS = 3600000;

/**
 * Fait tourner une heure simulée : `spectateurs` derrière UNE adresse, chacun relisant toutes les
 * `PRESENT_RESYNC_MS`, plus les relectures déclenchées par les gestes du présentateur.
 *
 * ⚠️ ON PILOTE `Date.now`, PAS UN MODÈLE DU COMPTEUR. Le limiteur utilisé est celui du contexte
 * autonome, avec sa vraie fenêtre fixe : ce qui est simulé est le temps, pas la décision.
 */
async function heureSimulee({ spectateurs, gestesPresentateurParHeure = 0, quota = PRESENT_QUOTA_PER_HOUR }) {
  let instant = 1_700_000_000_000;
  {
    // ⚠️ L'HORLOGE EST PASSÉE EN ARGUMENT, ELLE NE REMPLACE PLUS `Date.now`. La première écriture
    // rustinait le global et restaurait dans un `finally` posé AU RETOUR d'une promesse : la boucle
    // tournait donc contre le temps réel, et une borne l'a attrapée (88 401 pour un plafond de
    // 88 400). Une horloge injectée ne peut pas fuir, et `couvertureEnOccasions` — qui refuse qu'un
    // banc de `charge/` lise une horloge — n'a plus rien à voir ici : ce fichier ne chronomètre
    // rien, il COMPTE des décisions, et le temps qu'il fait avancer est un paramètre.
    const limites = creerLimites(null, { warn() {} }, () => instant);
    const instants = [];
    for (let t = 0; t < HEURE_MS; t += PRESENT_RESYNC_MS) instants.push({ t, par: spectateurs });
    if (gestesPresentateurParHeure > 0) {
      const pas = Math.floor(HEURE_MS / gestesPresentateurParHeure);
      for (let t = 0; t < HEURE_MS; t += pas) instants.push({ t, par: spectateurs });
    }
    instants.sort((a, b) => a.t - b.t);

    let acceptees = 0, refusees = 0, premierRefusMs = null;
    for (const { t, par } of instants) {
      instant = 1_700_000_000_000 + t;
      for (let i = 0; i < par; i += 1) {
        if (await limites.allow("pread:203.0.113.7", quota, 3600)) acceptees += 1;
        else { refusees += 1; if (premierRefusMs === null) premierRefusMs = t; }
      }
    }
    return { acceptees, refusees, premierRefusMs, demandes: acceptees + refusees };
  }
}

/** Combien de spectateurs une sortie unique porte, à la cadence de repos seule. */
const capaciteAuRepos = () => Math.floor(PRESENT_QUOTA_PER_HOUR / RESYNC_READS_PER_HOUR);

describe("⚠️ une audience derrière une sortie unique", () => {
  it("⚠️ le quota est dimensionné pour 25 lecteurs par sortie, et le DIT dans sa formule", () => {
    expect(READERS_PER_EGRESS, "le nombre est une hypothèse sur la topologie du client").toBe(25);
    expect(PRESENT_QUOTA_PER_HOUR % READERS_PER_EGRESS, "le quota se DÉRIVE de cette hypothèse").toBe(0);
  });

  it("⚠️ au repos, une sortie unique porte environ 613 spectateurs — pas 1000", () => {
    const n = capaciteAuRepos();
    // Une salle de 1000 personnes dépasse donc le quota SANS QUE PERSONNE NE FASSE RIEN : le seul
    // battement de relecture suffit. Ce n'est pas un contournement, c'est un décrochage collectif.
    expect(n).toBeLessThan(1000);
    expect(n).toBeGreaterThan(READERS_PER_EGRESS);
  });

  it("⚠️ 1000 spectateurs AU REPOS : la salle décroche avant la fin de l'heure", async () => {
    const r = await heureSimulee({ spectateurs: 1000 });
    expect(r.refusees, "au repos, sans un geste du présentateur").toBeGreaterThan(0);
    expect(r.premierRefusMs, "et le refus tombe pendant la présentation, pas à la 59e minute")
      .toBeLessThan(HEURE_MS);
  });

  it("250 spectateurs au repos : la salle tient l'heure entière", async () => {
    const r = await heureSimulee({ spectateurs: 250 });
    expect(r.refusees, "dix fois l'hypothèse de 25, et ça passe encore").toBe(0);
  });

  // ⚠️ LE PRÉSENTATEUR COMPTE DOUBLE : chacun de ses gestes déclenche une relecture chez CHAQUE
  // spectateur. Une présentation vivante — une page par minute — n'est pas le cas au repos.
  it("⚠️ un présentateur actif rapproche le décrochage, et c'est le cas RÉEL", async () => {
    const repos = await heureSimulee({ spectateurs: 500 });
    const actif = await heureSimulee({ spectateurs: 500, gestesPresentateurParHeure: 60 });
    expect(repos.refusees, "500 au repos passe").toBe(0);
    expect(actif.demandes, "un geste par minute ajoute une relecture par spectateur")
      .toBeGreaterThan(repos.demandes);
  });

  // ⚠️ BORNES. Une grandeur bornée qui sort de ses bornes est le seul témoin gratuit d'une
  // définition : ici, qu'aucune demande n'est perdue ni comptée deux fois, et qu'on n'accepte
  // jamais plus que le quota dans une fenêtre.
  it("⚠️ bornes : acceptées + refusées = demandes, et acceptées ≤ quota par fenêtre", async () => {
    const r = await heureSimulee({ spectateurs: 1000 });
    expect(r.acceptees + r.refusees).toBe(r.demandes);
    expect(r.acceptees, "la fenêtre est d'une heure : on ne peut pas dépasser le plafond")
      .toBeLessThanOrEqual(PRESENT_QUOTA_PER_HOUR);
  });
});

// ⚠️ LE RELEVÉ EST IMPRIMÉ, PARCE QUE LE CHIFFRE EST UNE DÉCISION D'EXPLOITATION, PAS UN VERDICT.
// Ce que ce fichier ne fait PAS : choisir `READERS_PER_EGRESS`. Il donne à qui déploie le nombre de
// spectateurs qu'une sortie porte, et à quelle minute une salle donnée décroche. Le reste — élargir
// le quota, le rendre configurable, ou assumer la limite — appartient à l'exploitant.
afterAll(async () => {
  const lignes = [];
  for (const n of [25, 100, 250, 500, 613, 700, 1000]) {
    const r = await heureSimulee({ spectateurs: n });
    const minute = r.premierRefusMs === null ? "—" : `${Math.round(r.premierRefusMs / 60000)} min`;
    lignes.push(`    ${String(n).padStart(5)} spectateurs  ${String(r.demandes).padStart(7)} demandes  ${String(r.refusees).padStart(7)} refusées  premier refus : ${minute}`);
  }
  console.log(`\n  UNE SORTIE UNIQUE, UNE HEURE, quota ${PRESENT_QUOTA_PER_HOUR}/h (dimensionné pour ${READERS_PER_EGRESS} lecteurs) :`);
  for (const l of lignes) console.log(l);
  console.log(`    capacité au repos : ${capaciteAuRepos()} spectateurs par sortie\n`);
});
