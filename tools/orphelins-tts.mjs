// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LES OBJETS DU CACHE DE VOIX QUE PLUS AUCUNE LIGNE NE DÉSIGNE — ET POURQUOI CET OUTIL EXISTE.
//
// ⚠️ LA PURGE DU CACHE DE VOIX N'A JAMAIS RETIRÉ UN SEUL OBJET. `storage.remove` portait une liste
// blanche de buckets qui ne nommait que `present-attachments` : `tts-cache` était refusé AVANT tout
// appel réseau. Chaque retrait rendait `false`, la trace partait quand même, et l'objet restait dans
// un bucket PUBLIC sans plus aucun chemin vers lui — la capacité expose `put` et `remove`, jamais
// `list`. C'est corrigé ; le STOCK accumulé, lui, ne se répare pas tout seul : par construction, il
// n'est plus atteignable par le produit.
//
// ⚠️ CET OUTIL SORT DONC DU CONTRAT, DÉLIBÉRÉMENT. Il parle directement à l'API Storage, avec la
// clé service_role, pour faire la seule chose que le contrat interdit : LISTER. C'est pour ça qu'il
// n'est pas une garde, qu'il ne tourne dans aucun workflow, et qu'il ne supprime rien sans qu'un
// humain ait lu un rapport et recopié un nombre.
//
// ⚠️ ET IL NE PEUT PAS DISTINGUER NOS ORPHELINS DE CEUX D'UN HÔTE. Un hôte intégrateur a rapporté
// 908 objets écrits par SON propre code, sous notre convention de nommage exacte, sans ligne — le
// contrat en garde la trace parce que s'y conformer les aurait orphelinés définitivement. Un objet
// sans ligne est donc l'un de trois : orphelin de notre purge cassée, vestige d'avant la migration
// 0021, ou fichier d'un hôte qui ne nous a jamais rien demandé. AUCUNE MESURE NE LES SÉPARE. C'est
// la raison du mode rapport par défaut, et de la double confirmation.
//
// Usage :
//   node tools/orphelins-tts.mjs --inspecter [--age-jours=N] [--limite=N]
//   node tools/orphelins-tts.mjs --inspecter --supprimer --confirme=<le compte lu dans le rapport>
//
// SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont lus dans l'environnement.

import { conclure, conforme, inconclusif, violation, tenterAsync } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

export const BUCKET = "tts-cache";
/** La fenêtre de rétention des voix, en jours — `server/retention.js` dit 13 mois. */
export const AGE_DEFAUT_JOURS = 13 * 31;

/**
 * Classe des objets face aux empreintes que la base connaît. FONCTION PURE : c'est elle qui décide,
 * et elle s'éprouve sans réseau ni identifiants.
 *
 * ⚠️ « SUFFISAMMENT VIEUX » N'EST PAS UN DÉTAIL DE CONFORT. Un objet récent sans ligne peut être une
 * synthèse dont l'écriture de trace vient d'échouer : le supprimer effacerait un fichier que le
 * produit s'apprête à utiliser. Seul l'âge sépare « la trace n'est pas encore là » de « la trace ne
 * viendra jamais ».
 */
export function classer(objets, empreintes, { ageJours = AGE_DEFAUT_JOURS, maintenant = Date.now() } = {}) {
  const connues = empreintes instanceof Set ? empreintes : new Set(empreintes || []);
  const borne = maintenant - ageJours * 86400000;
  const tenus = [], recents = [], candidats = [], illisibles = [];
  for (const o of objets || []) {
    const nom = String((o && o.name) || "");
    if (!nom) continue;
    const empreinte = nom.replace(/\.(mp3|json)$/i, "");
    if (empreinte === nom) { illisibles.push(nom); continue; }   // ni .mp3 ni .json : pas à nous
    if (connues.has(empreinte)) { tenus.push(nom); continue; }
    const date = Date.parse((o && (o.created_at || o.updated_at)) || "");
    // ⚠️ UNE DATE ILLISIBLE NE VAUT PAS « VIEUX ». Sans date, on ne sait pas, donc on ne supprime pas.
    if (!Number.isFinite(date)) { illisibles.push(nom); continue; }
    (date < borne ? candidats : recents).push(nom);
  }
  return { tenus, recents, candidats, illisibles };
}

const arg = (nom) => process.argv.find((a) => a.startsWith(`--${nom}=`))?.slice(nom.length + 3);
const drapeau = (nom) => process.argv.includes(`--${nom}`);

async function lister(base, cle) {
  const tout = [];
  for (let depart = 0; ; depart += 1000) {
    const r = await fetch(`${base}/storage/v1/object/list/${BUCKET}`, {
      method: "POST",
      headers: { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prefix: "", limit: 1000, offset: depart, sortBy: { column: "name", order: "asc" } }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`list ${BUCKET} : ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
    const lot = await r.json();
    if (!Array.isArray(lot) || !lot.length) return tout;
    tout.push(...lot);
    if (lot.length < 1000) return tout;
  }
}

async function empreintesConnues(base, cle) {
  const vues = new Set();
  let curseur = null;
  for (;;) {
    const borne = curseur ? `&hash=gt.${encodeURIComponent(`"${curseur}"`)}` : "";
    const r = await fetch(`${base}/rest/v1/doc_tts_objects?select=hash&order=hash.asc&limit=1000${borne}`, {
      headers: { apikey: cle, Authorization: `Bearer ${cle}` },
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`doc_tts_objects : ${r.status} ${(await r.text().catch(() => "")).slice(0, 200)}`);
    const lot = await r.json();
    if (!Array.isArray(lot) || !lot.length) return vues;
    for (const l of lot) if (l && l.hash) vues.add(String(l.hash));
    curseur = lot[lot.length - 1].hash;
    if (lot.length < 1000) return vues;
  }
}

async function retirer(base, cle, noms) {
  const echecs = [];
  let retires = 0;
  for (const nom of noms) {
    const r = await fetch(`${base}/storage/v1/object/${BUCKET}/${encodeURIComponent(nom)}`, {
      method: "DELETE",
      headers: { apikey: cle, Authorization: `Bearer ${cle}` },
      signal: AbortSignal.timeout(30000),
    }).catch((e) => ({ ok: false, status: 0, text: async () => String(e && e.message) }));
    if (r.ok || r.status === 404) { retires += 1; continue; }
    const corps = await r.text().catch(() => "");
    if (/not[_ ]?found|does not exist/i.test(corps)) { retires += 1; continue; }
    echecs.push(`${nom} : ${r.status} ${corps.slice(0, 120)}`);
  }
  return { retires, echecs };
}

if (estExecuteDirectement(import.meta.url)) {
  conclure(await tenterAsync(async () => {
    // ⚠️ SANS ARGUMENT, ON NE FAIT RIEN — ET CE N'EST PAS UNE COMMODITÉ. Cet outil vit dans `tools/`,
    // où `planchersDesGardes` lance CHAQUE fichier sur un dépôt vide. Un outil qui joindrait le
    // réseau dès son lancement ferait de ce banc un client de production. Il faut le demander.
    if (!drapeau("inspecter")) return inconclusif([
      "rien n'a été demandé : `--inspecter` pour un rapport, puis `--inspecter --supprimer --confirme=<compte>` pour agir.",
    ]);

    const base = String(process.env.SUPABASE_URL || "").replace(/\/+$/, "");
    const cle = String(process.env.SUPABASE_SERVICE_ROLE_KEY || "");
    if (!base || !cle) return inconclusif(["SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis — rien n'a pu être lu"]);

    const ageJours = Number(arg("age-jours") || AGE_DEFAUT_JOURS);
    if (!Number.isFinite(ageJours) || ageJours < 1) return inconclusif([`--age-jours illisible : ${arg("age-jours")}`]);

    const objets = await lister(base, cle);
    if (!objets.length) return inconclusif([`le bucket ${BUCKET} est vide, ou la liste n'a rien rendu — rien n'a été confronté`]);
    const connues = await empreintesConnues(base, cle);
    const { tenus, recents, candidats, illisibles } = classer(objets, connues, { ageJours });

    const rapport = [
      `objets dans ${BUCKET} : ${objets.length}`,
      `  désignés par une ligne (la purge s'en occupe) : ${tenus.length}`,
      `  sans ligne, plus récents que ${ageJours} j (INTOUCHÉS)  : ${recents.length}`,
      `  sans ligne et illisibles (ni .mp3/.json, ou sans date) : ${illisibles.length}`,
      `  sans ligne et plus vieux que ${ageJours} j — CANDIDATS   : ${candidats.length}`,
      "",
      "⚠️ UN CANDIDAT N'EST PAS FORCÉMENT À NOUS. Il peut être un orphelin de la purge cassée, un",
      "   vestige d'avant la migration 0021, ou un fichier écrit par l'hôte lui-même sous notre",
      "   convention de nommage — un intégrateur en a rapporté 908. Rien ne les sépare.",
    ];
    for (const l of rapport) console.log(l);

    if (!drapeau("supprimer")) {
      return conforme(`${candidats.length} candidat(s) sur ${objets.length} objet(s) — rapport seul, rien n'a été touché`,
        candidats.length ? [`pour agir : --inspecter --supprimer --confirme=${candidats.length}`] : []);
    }

    // ⚠️ LE NOMBRE SE RECOPIE À LA MAIN, et c'est la barrière qui compte. Il oblige à avoir LU un
    // rapport produit sur l'état courant : un `--supprimer` seul serait une destruction à l'aveugle,
    // et un `--oui` suffirait à l'automatiser, ce qui revient au même.
    const confirme = Number(arg("confirme"));
    if (confirme !== candidats.length) {
      return violation([
        `--confirme=${arg("confirme") ?? "(absent)"} ne correspond pas aux ${candidats.length} candidat(s) mesurés à l'instant.`,
        "Relisez le rapport ci-dessus et recopiez son nombre. S'il a changé depuis votre inspection, c'est que le bucket a bougé — et c'est exactement ce que cette barrière existe pour vous dire.",
      ]);
    }
    const limite = Number(arg("limite") || candidats.length);
    const lot = candidats.slice(0, Math.max(0, limite));
    const { retires, echecs } = await retirer(base, cle, lot);
    for (const e of echecs) console.log(`  échec : ${e}`);
    if (echecs.length) return violation([`${retires} retiré(s), ${echecs.length} échec(s) — voir ci-dessus`]);
    return conforme(`${retires} objet(s) retiré(s) sur ${candidats.length} candidat(s)`);
  }));
}
