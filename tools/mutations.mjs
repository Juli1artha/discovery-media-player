// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// LA CAMPAGNE DE MUTATIONS — CE QUE CE DÉPÔT PROUVAIT À LA MAIN ET NE POUVAIT PAS REJOUER.
//
// ⚠️ NOTRE CRITÈRE D'ACCEPTATION ÉTAIT MANUEL, ET UN AUDIT EXTERNE L'A CORRIGÉ EN DEUX TEMPS.
// Le CHANGELOG porte des dizaines de « N mutations sur N tuées » : chacune était vraie le jour où
// elle a été écrite, produite à la main, sans artefact, non rejouable par quiconque — y compris par
// nous, le lendemain. Nous avions d'abord annoncé « zéro outil de mutation », ce qui était FAUX :
// `tools/fixture-types/eprouver.mjs` en est un, sur trois mutations de contrat TypeScript. La
// formulation juste est celle de l'audit : une campagne automatisée existait sur les TYPES, et les
// preuves portant sur le COMPORTEMENT restaient manuelles.
//
// Ceci est la seconde, et elle porte sur le comportement.
//
// ⚠️ PAS DE MUTATION GÉNÉRIQUE SUR 10 800 LIGNES, ET LE REFUS EST MOTIVÉ. Un outil qui mute tout
// produit des centaines de survivants dont la plupart sont bénins — du code équivalent, des chemins
// morts, des branches défensives. Une garde dont on apprend à ignorer la sortie est pire
// qu'absente : ce dépôt l'a écrit ailleurs, et le tiendrait mal ici. Un MANIFESTE de mutants
// choisis, chacun avec sa cible exacte et son banc, dit quelque chose de vérifiable.
//
// ⚠️ ET CHAQUE MUTANT EST UN DÉFAUT QUI A RÉELLEMENT EXISTÉ. Aucun n'est inventé pour faire nombre :
// tous ont été trouvés, reproduits et corrigés — la plupart par des audits externes. Ce que cette
// campagne garde n'est donc pas « du code bien testé » en général, c'est « ces défauts-là ne
// reviendront pas en silence ».

import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

import { conclure, conforme, violation, inconclusif, tenterAsync } from "./resultat-garde.mjs";
import { estExecuteDirectement } from "./execute-directement.mjs";

/**
 * Le manifeste. Chaque entrée : une cible SYNTAXIQUE EXACTE, UNE seule modification, les bancs qui
 * doivent la tuer, et pourquoi ce défaut comptait.
 *
 * ⚠️ `avant` DOIT APPARAÎTRE EXACTEMENT UNE FOIS. Zéro occurrence = le code a bougé et le mutant ne
 * mute rien : NON CONCLUANT, jamais « tué ». Plusieurs = on ne sait pas laquelle a été touchée, donc
 * le verdict ne désigne rien. C'est le contrôle de stimulus, écrit dans l'outil plutôt que dans la
 * discipline de celui qui s'en sert.
 */
export const MUTANTS = [
  {
    id: "retention-delete-sans-predicat",
    fichier: "server/retention.js",
    avant: "`${table}?${filtre}&${colId}=in.(${ids.map(guill).join(\",\")})&select=${colId}`",
    apres: "`${table}?${colId}=in.(${ids.map(guill).join(\",\")})&select=${colId}`",
    pourquoi: "sans le prédicat de purge, un DELETE efface une ligne redevenue ACTIVE entre le SELECT et lui",
    bancs: ["server/__tests__/retentionPurgeExacte.test.js"],
  },
  {
    id: "retention-trace-au-dessus-d-un-audio-reste",
    fichier: "server/retention.js",
    avant: "if (audioPerdu) { retenues += 1; continue; }",
    apres: "if (false) { retenues += 1; continue; }",
    pourquoi: "effacer la trace d'un objet resté purge le SEUL chemin vers lui : la capacité storage n'expose pas `list`",
    bancs: ["server/__tests__/retentionCacheDeVoix.test.js"],
  },
  {
    id: "retention-alignement-absent-retient",
    fichier: "server/retention.js",
    avant: 'if (suffixe === ".mp3" && issue === false) audioPerdu = true;',
    apres: "if (issue === false) audioPerdu = true;",
    pourquoi: "la régression INVERSE : un tiers des empreintes n'a pas de `.json`, les retenir toutes gèlerait un tiers du cache",
    bancs: ["server/__tests__/retentionCacheDeVoix.test.js"],
  },
  {
    id: "retention-parent-au-dessus-d-un-enfant-retenu",
    fichier: "server/retention.js",
    avant: "&& !msgs.retenues) {",
    apres: ") {",
    pourquoi: "« retenu » est une seconde façon de ne pas être parti : sans elle, l'orphelin parent/enfant rouvre",
    bancs: ["server/__tests__/retentionPurgeExacte.test.js"],
  },
  {
    id: "storage-bucket-des-voix-refuse",
    fichier: "context/standalone.js",
    avant: 'if (bucket !== "present-attachments" && bucket !== "tts-cache") return false;',
    apres: 'if (bucket !== "present-attachments") return false;',
    pourquoi: "la purge du cache de voix n'a JAMAIS rien retiré tant que ce bucket était hors de la liste",
    bancs: ["context/__tests__/appelsBornes.test.js"],
  },
  {
    id: "storage-objet-absent-compte-comme-echec",
    fichier: "context/standalone.js",
    avant: "          return /not[_ ]?found|no such key|does not exist/i.test(corps);",
    apres: "          return false;",
    pourquoi: "un objet déjà absent compté en échec retiendrait des lignes POUR TOUJOURS, en attendant des fichiers inexistants",
    bancs: ["context/__tests__/appelsBornes.test.js"],
  },
  {
    id: "signal-remplace-au-lieu-de-composer",
    fichier: "context/standalone.js",
    avant: "  const signal = composerSignaux(options.signal, delaiMs);",
    apres: "  const signal = options.signal || composerSignaux(undefined, delaiMs);",
    pourquoi: "un signal fourni par l'hôte SUPPRIMAIT le plancher : il croyait ajouter une garantie et en retirait une",
    bancs: ["context/__tests__/appelsBornes.test.js"],
  },
  {
    id: "relais-budget-par-saut",
    fichier: "context/storage.js",
    avant: "...(budget ? { signal: budget } : {})",
    apres: "signal: AbortSignal.timeout(DELAI_MAX_MS)",
    pourquoi: "un délai par SAUT laisse six redirections lentes immobiliser la requête six minutes",
    bancs: ["context/__tests__/redirections.test.js"],
  },
  {
    id: "avatar-toute-origine-rendue",
    fichier: "src/live.ts",
    avant: "  return origineAvatarAutorisee(url, origines)",
    apres: "  return (url ? true : origineAvatarAutorisee(url, origines))",
    pourquoi: "une URL d'avatar quelconque est un pixel de suivi : l'IP de CHAQUE spectateur part chez qui l'a écrite",
    bancs: ["src/__tests__/live.test.ts"],
  },
  {
    id: "avatar-comparaison-par-prefixe",
    fichier: "src/live.ts",
    avant: "    try { return new URL(String(o)).origin === u.origin; } catch { return false; }",
    apres: "    return brut.startsWith(String(o));",
    pourquoi: "« https://<base>.attaquant.net » commence comme ce qu'on reconnaît ; son origine, non",
    bancs: ["src/__tests__/live.test.ts"],
  },
  // ⚠️ DEUX MUTANTS, PAS UN — ET C'EST LA CAMPAGNE ELLE-MÊME QUI L'A EXIGÉ. La cible « avatar: profil
  // ? … » apparaît DEUX fois : présence et chat. Écrite une seule fois, elle a rendu NON CONCLUANT
  // plutôt que « tué », parce qu'un verdict qui ne sait pas laquelle des deux il a touchée ne
  // désigne rien. Chaque cible porte donc le contexte qui la rend unique.
  {
    id: "avatar-anonyme-resservi-presence",
    fichier: "server/routes-direct.js",
    avant: "            avatar: profil ? profil.avatar : null,\n            // ⚠️ ON N'AFFIRME PLUS LE TITRE",
    apres: "            avatar: (profil && profil.avatar) || body.avatar,\n            // ⚠️ ON N'AFFIRME PLUS LE TITRE",
    pourquoi: "présence : une identité prouvée remplace ce qu'on affirme — un anonyme ne prouve rien, et son avatar atteint toute l'audience",
    bancs: ["server/__tests__/titreUsurpe.test.js"],
  },
  {
    id: "avatar-anonyme-resservi-chat",
    fichier: "server/routes-direct.js",
    avant: "            avatar: profil ? profil.avatar : null,\n            isPresenter: validControl,",
    apres: "            avatar: (profil && profil.avatar) || body.avatar,\n            isPresenter: validControl,",
    pourquoi: "chat : le chemin qui atteint le plus de monde, et le même avatar arbitraire",
    bancs: ["server/__tests__/titreUsurpe.test.js"],
  },
  // ⚠️ LA VIRTUALISATION DE LA VISIONNEUSE : quatre façons de la perdre sans qu'aucun pixel ne change
  // pour un lecteur de dix pages. C'est un document de dix MILLE qui les révèle — d'où un banc qui
  // COMPTE des nœuds à cette échelle.
  {
    id: "viewer-fenetre-non-virtuelle",
    fichier: "src/viewer.ts",
    avant: "  return { debut, fin, avant: (debut - 1) * pas, apres: (total - fin) * pas };",
    apres: "  return { debut: 1, fin: total, avant: 0, apres: 0 };",
    pourquoi: "une fenêtre qui couvre tout le document matérialise dix mille gabarits : ~70 000 nœuds mesurés pour 10 000 pages",
    bancs: ["src/__tests__/viewer.test.ts"],
  },
  {
    id: "visionneuse-pages-toutes-materialisees",
    fichier: "server/page-visionneuse.js",
    avant: "      if(!force&&f.debut===pagesFenetre.debut&&f.fin===pagesFenetre.fin)return;\n      pagesFenetre=f;",
    apres: "      f={debut:1,fin:numPages,avant:0,apres:0};\n      if(!force&&f.debut===pagesFenetre.debut&&f.fin===pagesFenetre.fin)return;\n      pagesFenetre=f;",
    pourquoi: "le gabarit ignore la fenêtre calculée et pose un élément par page — l'état d'avant, revenu par une autre porte",
    bancs: ["server/__tests__/visionneuseVirtuelle.test.js"],
  },
  {
    id: "visionneuse-saut-sans-materialiser",
    fichier: "server/page-visionneuse.js",
    avant: "      if(!el){ scrollEl.scrollTop=Player.viewer.positionDe(p,geoPages()); reconcilierPages(true,p); el=pagesEl.querySelector('.page[data-p=\"'+p+'\"]'); }",
    apres: "      if(!el){ scrollEl.scrollTop=Player.viewer.positionDe(p,geoPages()); }",
    pourquoi: "aller à une page qui n'existe pas encore doit la faire naître — sinon le saut vers la page 5 000 tombe dans un espaceur",
    bancs: ["server/__tests__/visionneuseVirtuelle.test.js"],
  },
  {
    id: "visionneuse-vignettes-toutes-materialisees",
    fichier: "server/page-visionneuse.js",
    avant: "      if(!force&&f.debut===vignFenetre.debut&&f.fin===vignFenetre.fin)return;",
    apres: "      f={debut:1,fin:numPages,avant:0,apres:0};\n      if(!force&&f.debut===vignFenetre.debut&&f.fin===vignFenetre.fin)return;",
    pourquoi: "un bouton par vignette pour tout le document : la moitié des nœuds mesurés par l'audit venait de là",
    bancs: ["server/__tests__/visionneuseVirtuelle.test.js"],
  },
  {
    id: "visionneuse-chargement-sans-echeance",
    fichier: "server/page-visionneuse.js",
    avant: "      tChargement=setTimeout(function(){ if(genDoc!==docGen)return;",
    apres: "      tChargement=setTimeout(function(){ if(true)return;",
    pourquoi: "un document qui n'arrive jamais gardait son transfert et son worker ouverts jusqu'à la fermeture de l'onglet",
    bancs: ["server/__tests__/visionneuseVirtuelle.test.js"],
  },
  {
    id: "hook-echec-muet",
    fichier: "tools/install-hooks.mjs",
    avant: "        process.stderr.write(\n          `hooks git : pre-push NON installé",
    apres: "        if (false) process.stderr.write(\n          `hooks git : pre-push NON installé",
    pourquoi: "non bloquant n'est pas muet : un échec silencieux fait croire au développeur qu'il a un garde-fou",
    bancs: ["tools/__tests__/installHooks.test.js"],
  },
];

export const empreinte = (texte) => createHash("sha256").update(texte).digest("hex").slice(0, 16);

/** Applique `avant → apres` UNE fois. Rend le texte muté, ou une raison de ne pas conclure. */
export function muter(source, { avant, apres }) {
  const n = source.split(avant).length - 1;
  if (n === 0) return { raison: "cible absente — le code a bougé, ce mutant ne mute rien" };
  if (n > 1) return { raison: `cible présente ${n} fois — le verdict ne désignerait aucune des deux` };
  const mute = source.replace(avant, apres);
  if (mute === source) return { raison: "la mutation ne change rien — `apres` est identique à `avant`" };
  return { mute };
}

/** Les bornes du rapport. Une grandeur qui en sort dit que la DÉFINITION a dérapé, pas la mesure. */
export function bornes(r) {
  const fautes = [];
  const total = r.tues + r.survivants + r.nonConcluants;
  if (total !== r.poses) fautes.push(`posés ${r.poses} ≠ tués ${r.tues} + survivants ${r.survivants} + non concluants ${r.nonConcluants}`);
  if (r.tues > r.poses) fautes.push(`tués ${r.tues} > posés ${r.poses}`);
  for (const [nom, v] of Object.entries(r)) if (typeof v === "number" && v < 0) fautes.push(`${nom} est négatif (${v})`);
  return fautes;
}

const lancerBancs = (bancs) => spawnSync("npx", ["vitest", "run", ...bancs], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const estVert = (r) => r.status === 0;

if (estExecuteDirectement(import.meta.url)) {
  conclure(await tenterAsync(async () => {
    // ⚠️ ELLE LANCE DES BANCS : la lancer DEPUIS les bancs l'imbriquerait dans elle-même. Même
    // raison, même garde-fou que `ordre-des-bancs.mjs`, et il a été écrit après que l'imbrication
    // eut laissé 391 processus résiduels sur cette machine.
    if (process.env.VITEST) return inconclusif([
      "lancée DEPUIS une exécution de bancs : cette campagne lance des bancs, elle s'imbriquerait dans elle-même.",
    ]);
    if (!MUTANTS.length) return inconclusif(["manifeste vide : rien n'a été posé, donc rien n'est prouvé"]);

    const seul = process.argv.find((a) => a.startsWith("--mutant="))?.slice("--mutant=".length);
    const choisis = seul ? MUTANTS.filter((m) => m.id === seul) : MUTANTS;
    if (!choisis.length) return inconclusif([`aucun mutant nommé « ${seul} »`]);

    const r = { poses: 0, tues: 0, survivants: 0, nonConcluants: 0 };
    const constats = [], avertissements = [], lignes = [];

    for (const m of choisis) {
      const source = readFileSync(m.fichier, "utf8");
      const avantEmpreinte = empreinte(source);
      const { mute, raison } = muter(source, m);
      if (raison) {
        r.poses += 1; r.nonConcluants += 1;
        avertissements.push(`${m.id} : ${raison}`);
        lignes.push(`  ${m.id.padEnd(44)} NON CONCLUANT — ${raison}`);
        continue;
      }

      // ⚠️ LA BASE DOIT ÊTRE VERTE AVANT LA MUTATION. Sans ce contrôle, un banc déjà rouge ferait
      // passer TOUS les mutants qui le touchent pour « tués » — la campagne serait d'autant plus
      // verte que le dépôt est cassé.
      if (!estVert(lancerBancs(m.bancs))) {
        r.poses += 1; r.nonConcluants += 1;
        avertissements.push(`${m.id} : base ROUGE avant mutation — un mutant ne se juge pas sur des bancs déjà cassés`);
        lignes.push(`  ${m.id.padEnd(44)} NON CONCLUANT — base rouge`);
        continue;
      }

      let verdict;
      try {
        writeFileSync(m.fichier, mute);
        verdict = estVert(lancerBancs(m.bancs)) ? "SURVIVANT" : "TUÉ";
      } finally {
        // ⚠️ ON RESTAURE, PUIS ON VÉRIFIE L'EMPREINTE. Une campagne interrompue a déjà laissé un
        // fichier muté sur disque, et l'exécution suivante l'a pris pour sa référence : tous les
        // « restauré, identique » d'après comparaient la corruption à elle-même et disaient VRAI.
        writeFileSync(m.fichier, source);
      }
      if (empreinte(readFileSync(m.fichier, "utf8")) !== avantEmpreinte) {
        return violation([`${m.fichier} n'a PAS été restauré à l'identique après « ${m.id} » — arrêt immédiat, le dépôt est dans un état inconnu`]);
      }

      r.poses += 1;
      if (verdict === "TUÉ") { r.tues += 1; lignes.push(`  ${m.id.padEnd(44)} tué`); }
      else {
        r.survivants += 1;
        lignes.push(`  ${m.id.padEnd(44)} ⚠️ SURVIVANT`);
        constats.push(`${m.id} SURVIT : ${m.pourquoi}. Les bancs ${m.bancs.join(", ")} restent verts alors que la propriété est retirée — ils ne la gardent pas.`);
      }
    }

    for (const l of lignes) console.log(l);
    const horsBornes = bornes(r);
    if (horsBornes.length) return inconclusif(horsBornes.map((f) => `borne violée : ${f} — le compte lui-même ne tient pas, donc aucun verdict ne tient`));
    if (constats.length) return violation(constats, avertissements);
    return conforme(`${r.tues} mutant(s) tué(s) sur ${r.poses} posé(s), ${r.nonConcluants} non concluant(s)`, avertissements);
  }));
}
