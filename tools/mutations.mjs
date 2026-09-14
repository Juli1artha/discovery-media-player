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
  // ── 13/09 — les deux défauts que les HÔTES ont rendus sur la 0.1.164 ─────────────────────────
  {
    id: "retention-sans-remove-ligne-part",
    fichier: "server/retention.js",
    avant: "    return opts.dryRun ? null : false;\n  }\n  if (opts.dryRun) return null;",
    apres: "    return null;\n  }\n  if (opts.dryRun) return null;",
    pourquoi: "troisième état : sans storage.remove la ligne partait au-dessus d'un objet que rien ne pouvait retirer (relevé STUDIO)",
    bancs: ["server/__tests__/retention.test.js", "server/__tests__/retentionCacheDeVoix.test.js"],
  },
  {
    id: "reshare-motif-hote-jete",
    fichier: "server/routes-liens.js",
    avant: "              motifHote = motifDeclare(r);",
    apres: "              motifHote = null;",
    pourquoi: "l'hôte déclarait le motif de son refus et on ne lisait que `sent` (relevé ADV)",
    bancs: ["server/__tests__/envoiDelegue.test.js"],
  },
  // ── 13/09 — troisième audit externe ──────────────────────────────────────────────────────────
  {
    id: "pread-une-cle-pour-deux-points",
    fichier: "server/handler.js",
    avant: "        if (!(await PLAYER.limits.allow(`pread:${point}:${ipSondage}`, PRESENT_QUOTA_PER_HOUR, 3600))) {",
    apres: "        if (!(await PLAYER.limits.allow(`pread:${ipSondage}`, PRESENT_QUOTA_PER_HOUR, 3600))) {",
    pourquoi: "l'état et le chat payaient le même budget : 306 spectateurs par sortie au lieu de 613, et un chat saturé coupait l'état",
    bancs: ["server/__tests__/canalPublicLimite.test.js"],
  },
  {
    id: "visionneuse-saut-au-dela-du-plafond",
    fichier: "server/page-visionneuse.js",
    avant: "      if(!onePage&&atteignables&&p>atteignables) p=atteignables;",
    apres: "      if(false) p=atteignables;",
    pourquoi: "un saut vers une page au-delà du plafond de défilement n'arrive jamais : Chrome sature à 33 554 432 px",
    bancs: ["server/__tests__/visionneuseVirtuelle.test.js"],
  },
  {
    id: "visionneuse-plafond-muet",
    fichier: "server/page-visionneuse.js",
    avant: "      if(atteignables<numPages){\n        var auMin=atteignablesAuZoom(Player.viewer.MIN_ZOOM);",
    apres: "      if(false){\n        var auMin=atteignablesAuZoom(Player.viewer.MIN_ZOOM);",
    pourquoi: "un plafond silencieux laisse le lecteur défiler vers une page qui n'arrive jamais sans un mot",
    bancs: ["server/__tests__/visionneuseVirtuelle.test.js"],
  },
  {
    id: "visiteur-verification-sans-plafond-par-identite",
    fichier: "server/routes-visiteur.js",
    avant: "        if (!(await PLAYER.limits.allow(`vverif:id:${await cleIdentite(V, body.email)}`, VERIF_PAR_IDENTITE, VERIF_FENETRE_IDENTITE_S))) return jv(429, { ok: false, error: \"rate\" });",
    apres: "        if (false) return jv(429, { ok: false, error: \"rate\" });",
    pourquoi: "plusieurs adresses forçaient un même email : la vérification n'avait aucun plafond (audit externe, 13/09)",
    bancs: ["server/__tests__/murVisiteur.test.js"],
  },
  {
    id: "relais-sans-admission",
    fichier: "server/handler.js",
    avant: "  if (relaisEnCours >= plafondRelais) {",
    apres: "  if (false) {",
    pourquoi: "le flux bornait les octets, rien ne bornait le nombre de flux : 200 demandes lentes, 200 connexions amont (audit externe, 13/09)",
    bancs: ["server/__tests__/relaisAdmission.test.js"],
  },
  // ── 13/09 — quatrième passe de l'audit externe : « les deux P1 ne sont pas fermés » ─────────────
  {
    id: "relais-sans-delai-de-progression",
    fichier: "server/handler.js",
    // La cible cite un gabarit de handler.js ; ce fichier exporte une fonction `bornes`, et CodeQL lit
    // « ${bornes.stallMs} » dans un littéral simple comme une référence oubliée. La chaîne est coupée
    // avant le « { » : même octets une fois concaténée, plus d'ambiguïté.
    avant: "  const rearmer = () => { clearTimeout(stall); stall = setTimeout(() => abandon.abort(new Error(`relais abandonné : aucune progression depuis $" + "{bornes.stallMs} ms`)), bornes.stallMs); };",
    apres: "  const rearmer = () => { clearTimeout(stall); };",
    pourquoi: "un client qui cesse de lire gardait sa place pour toujours : requestTimeout ne borne pas l'émission d'une réponse",
    bancs: ["server/__tests__/relaisAdmission.test.js"],
  },
  {
    id: "visionneuse-une-page-avec-espaceurs",
    fichier: "server/page-visionneuse.js",
    avant: "      if(onePage){ var c=autour||cur||1; var d0=Math.max(1,c-1), f0=Math.min(numPages,c+1); f={debut:d0,fin:f0,avant:0,apres:0}; }",
    apres: "      if(onePage){ var c=autour||cur||1; var pas=Player.viewer.pasVertical(g.hauteurElement,g.ecart); var d0=Math.max(1,c-1), f0=Math.min(numPages,c+1); f={debut:d0,fin:f0,avant:(d0-1)*pas,apres:(numPages-f0)*pas}; }",
    pourquoi: "en mode une page, un espaceur portant les pages précédentes poussait la 10 000e à 8 339 242 px : présente, courante, invisible",
    bancs: ["server/__tests__/visionneuseVirtuelle.test.js"],
  },
  {
    id: "visiteur-cle-du-greffon-ignoree",
    fichier: "server/routes-visiteur.js",
    avant: "      if (typeof k === \"string\" && k.trim()) return \"h:\" + k.trim().slice(0, 64);",
    apres: "      if (typeof k === \"string\" && k.trim()) return \"e:\" + empreinteIdentite(norm);",
    pourquoi: "une empreinte SHA-256 d'email se renverse par dictionnaire : la clé d'identité doit venir du greffon quand il sait la produire",
    bancs: ["server/__tests__/murVisiteur.test.js"],
  },
  // ── 13/09 — cinquième passe de l'audit externe, sur le tag v0.1.165 ─────────────────────────────
  {
    id: "relais-compteur-remis-a-zero-par-init",
    fichier: "server/handler.js",
    avant: "  relaisMaxMs = bornes.maxMs;",
    apres: "  relaisMaxMs = bornes.maxMs; relaisEnCours = 0;",
    pourquoi: "init() remettait le compteur de relais en vol à zéro : un relais ouvert avant la réinitialisation ne comptait plus, le plafond était désarmé et le compteur finissait négatif",
    bancs: ["server/__tests__/relaisAdmission.test.js"],
  },
  {
    id: "relais-bornes-relues-pendant-le-transfert",
    fichier: "server/handler.js",
    avant: "  const bornes = { stallMs: relaisStallMs, maxMs: relaisMaxMs };\n  relaisEnCours += 1;\n  try { await travail(bornes); } finally { relaisEnCours -= 1; }",
    apres: "  relaisEnCours += 1;\n  try { await travail({ get stallMs() { return relaisStallMs; }, get maxMs() { return relaisMaxMs; } }); } finally { relaisEnCours -= 1; }",
    pourquoi: "les bornes d'un relais doivent être celles de son admission : un init pendant le transfert ne relit la configuration que pour les suivants",
    bancs: ["server/__tests__/relaisAdmission.test.js"],
  },
  {
    id: "relais-delai-hors-plage-accepte",
    fichier: "server/bornes.js",
    avant: "  const valide = Number.isSafeInteger(n) && n >= min && n <= max;",
    apres: "  const valide = Number.isFinite(n) && n > 0;",
    pourquoi: "« tout nombre fini positif » laissait passer 2 147 483 648 ms jusqu'à setTimeout, qui le ramène à 1 ms : le transfert était abandonné en 6 ms",
    bancs: ["server/__tests__/bornesRelais.test.js", "server/__tests__/relaisAdmission.test.js"],
  },
  {
    id: "affirmation-secret-serveur-hors-liste",
    fichier: "tools/affirmations-retirees.mjs",
    // ⚠️ cette phrase est la CIBLE du mutant : citée ici, pas affirmée — la garde des affirmations
    // retirées lit ce fichier, et sans ce marqueur elle relèverait sa propre définition.
    avant: "    motif: /(?:le cœur n'a (?:pas|aucun) (?:de )?secrets? (?:de )?serveur|(?:the )?(?:core|player) (?:has|holds) no server secret|aucun secret serveur|pas de secret de serveur)/i,",
    apres: "    motif: /(?:le cœur n'a (?:pas|aucun) (?:de )?secrets? (?:de )?serveur qui n'existe pas)/i,",
    pourquoi: "une affirmation annoncée retirée dans le CHANGELOG mais absente de la liste laissait la garde verte sur une phrase encore écrite comme vraie",
    bancs: ["tools/__tests__/affirmationsRetirees.test.js"],
  },
  // ── 14/09 — sixième passe de l'audit externe, sur le tag v0.1.166 ──────────────────────────────
  {
    id: "capture-rejet-asynchrone-non-attrape",
    fichier: "server/capture.js",
    avant: "    if (r && typeof r.then === \"function\") r.then(undefined, () => { /* un journal qui échoue ne doit rien arrêter */ });",
    apres: "    void r;",
    pourquoi: "« jamais bloquant » sous un try/catch n'attrapait qu'une exception synchrone : un capture qui rejette arrêtait le processus en unhandledRejection",
    bancs: ["server/__tests__/captureSansBloquer.test.js"],
  },
  {
    id: "autonome-valeur-d-environnement-convertie",
    fichier: "context/standalone.js",
    avant: "      relayStallMs: env.PLAYER_RELAY_STALL_MS,",
    apres: "      relayStallMs: env.PLAYER_RELAY_STALL_MS ? Number(env.PLAYER_RELAY_STALL_MS) : 30_000,",
    pourquoi: "« transmis tel quel » convertissait encore : abc arrivait en NaN et l'exploitant ne retrouvait pas ce qu'il avait saisi",
    bancs: ["server/__tests__/captureSansBloquer.test.js"],
  },
  // ── 14/09 — septième passe de l'audit externe ────────────────────────────────────────────────
  {
    id: "autonome-journal-rejet-non-attrape",
    fichier: "context/standalone.js",
    avant: "    if (resultat && typeof resultat.then === \"function\") resultat.then(undefined, () => { /* un journal ne doit jamais interrompre le traitement */ });",
    apres: "    void resultat;",
    pourquoi: "ctx.errors et le journal des capacités autonomes sont le même objet : un capture qui rejette tuait le processus à mail.send sans secret, avant tout réseau",
    bancs: ["server/__tests__/captureSansBloquer.test.js"],
  },
  {
    id: "ordre-rejeu-classe-par-le-code-de-sortie-seul",
    fichier: "tools/ordre-des-bancs.mjs",
    // ⚠️ Recible : depuis `confronterExecution`, la dernière ligne de `classerRejeu` ne voit plus que des
    // exécutions concordantes — muter là était ÉQUIVALENT (survivant à la huitième passe, à raison).
    // La propriété vit dans le renvoi du non-concluant : l'ignorer fait retomber un rapport vert + code 1
    // dans « rouge préalable », exactement le cas de l'audit.
    avant: "  if (e.etat === \"non-concluant\") return { classe: \"non-concluant\", raison: `${fichier} : ${e.raison}` };",
    apres: "  if (e.etat === \"non-concluant\" && !rapport) return { classe: \"non-concluant\", raison: `${fichier} : ${e.raison}` };",
    pourquoi: "le rejeu individuel concluait sur le code de sortie seul : un harnais qui sort en non-zéro après un rapport vert devenait un rouge préalable, et la garde rendait non concluant sur du code sain",
    bancs: ["tools/__tests__/ordreDesBancs.test.js"],
  },
  // ── 14/09 — huitième passe de l'audit externe ────────────────────────────────────────────────
  {
    id: "ordre-suite-melangee-non-confrontee",
    fichier: "tools/ordre-des-bancs.mjs",
    avant: "  if (!rouges.length && code === 0) return { etat: \"vert\", rouges: [] };",
    apres: "  if (!rouges.length) return { etat: \"vert\", rouges: [] };",
    pourquoi: "la suite mélangée initiale ne confrontait pas le processus au rapport : un rapport vert écrit puis un processus en 1 rendait « conforme »",
    bancs: ["tools/__tests__/ordreDesBancs.test.js"],
  },
  {
    id: "ordre-signal-assimile-a-un-code",
    fichier: "tools/ordre-des-bancs.mjs",
    avant: "  if (rouges.length && Number.isInteger(code) && code !== 0) return { etat: \"rouge\", rouges };",
    apres: "  if (rouges.length && code !== 0) return { etat: \"rouge\", rouges };",
    pourquoi: "status: null (processus tué) passait pour un code non nul concordant, parce que null !== 0",
    bancs: ["tools/__tests__/ordreDesBancs.test.js"],
  },
  // ── 14/09 — neuvième passe de l'audit externe : les pièces de diagnostic ────────────────────
  {
    id: "inventaire-stderr-de-npm-pack-jete",
    fichier: "tools/inventaire-tarball.mjs",
    avant: "    return execFileSync(commande, args, { encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"pipe\"], timeout: 120000 });",
    apres: "    return execFileSync(commande, args, { encoding: \"utf8\", stdio: [\"ignore\", \"pipe\", \"ignore\"], timeout: 120000 });",
    pourquoi: "le stderr de npm pack était jeté : sur une forge au cache non inscriptible, la seule pièce était « code 255 », sans l'EPERM",
    bancs: ["tools/__tests__/inventaireTarball.test.js"],
  },
  {
    id: "ordre-premiere-ligne-au-lieu-de-la-premiere-informative",
    fichier: "tools/ordre-des-bancs.mjs",
    avant: "export const premiereLigneInformative = (texte) => (String(texte || \"\").split(\"\\n\").map((l) => l.trim()).find((l) => l && !LIGNE_VIDE_DE_SENS.test(l) && !/^at /.test(l)) || \"\").slice(0, 200);",
    apres: "export const premiereLigneInformative = (texte) => (String(texte || \"\").split(\"\\n\").map((l) => l.trim()).find((l) => l) || \"\").slice(0, 200);",
    pourquoi: "« Error: STACK_TRACE_ERROR » n'est pas une cause : la première ligne d'un failureMessages de vitest est parfois ce libellé, la cause étant plus bas",
    bancs: ["tools/__tests__/ordreDesBancs.test.js"],
  },
  {
    id: "ordre-cause-reclamee-a-une-execution-verte",
    fichier: "tools/ordre-des-bancs.mjs",
    avant: "const manqueCause = !executionVerte && !messages.length && !messageFichier && !stderr;",
    apres: "const manqueCause = !messages.length && !messageFichier && !stderr;",
    pourquoi: "la confirmation isolée verte d'un rouge recevait « aucune cause exploitable — rejouer en verbose » : un succès n'a pas de cause à donner (audit, dixième passe)",
    bancs: ["tools/__tests__/ordreDesBancs.test.js"],
  },
  {
    id: "artefact-schema-non-compile-par-ajv",
    fichier: "tools/artefact-de-charge.mjs",
    avant: "    valider = new Ajv2020({ strict: true, strictRequired: false, allErrors: true, verbose: true }).compile(schema);",
    apres: "    valider = new Ajv2020({ strict: false, strictRequired: false, allErrors: true, verbose: true, validateSchema: false }).compile(schema);",
    pourquoi: "sans le mode strict ni la validation contre le méta-schéma, un `required` en chaîne, un `enum` mal formé, un `type` inconnu passent la compilation : le schéma n'est pas lu en entier (audit, onzième passe)",
    bancs: ["tools/__tests__/artefactDeCharge.test.js"],
  },
  {
    id: "artefact-reference-non-resolue-sans-chemin",
    fichier: "tools/artefact-de-charge.mjs",
    avant: "      if (k === \"$ref\" && !resoluble(v)) problemes.push(",
    apres: "      if (false) problemes.push(",
    pourquoi: "un $ref externe dans une branche optionnelle qu'aucun artefact ne matérialise ne se voit qu'au parcours préalable, avec son chemin ; ajv le refuse aussi mais sans dire où (audit, onzième passe)",
    bancs: ["tools/__tests__/artefactDeCharge.test.js"],
  },
  {
    id: "artefact-mot-cle-inconnu-sans-chemin",
    fichier: "tools/artefact-de-charge.mjs",
    avant: "      if (!MOTS_CLES.has(k)) { problemes.push(",
    apres: "      if (false) { problemes.push(",
    pourquoi: "un mot-clé inconnu dans une branche optionnelle absente du corpus n'a de chemin que par le parcours préalable ; sans lui, la garde ne dit pas où (audit, dixième et onzième passes)",
    bancs: ["tools/__tests__/artefactDeCharge.test.js"],
  },
  {
    id: "artefact-relay-exige-meme-incomplet",
    fichier: "charge/artefact.schema-1.json",
    avant: "\"if\": {\n        \"required\": [\n          \"complete\",\n          \"scenario\"\n        ],\n        \"properties\": {\n          \"complete\": {\n            \"const\": true\n          },",
    apres: "\"if\": {\n        \"required\": [\n          \"scenario\"\n        ],\n        \"properties\": {",
    pourquoi: "relay est un bloc de MESURE (octets, admis, refusés) : l'exiger d'un artefact complete: false contredit « aucun bloc de mesure n'est exigé » et refuse l'artefact d'une course relais qui a échoué",
    bancs: ["tools/__tests__/artefactDeCharge.test.js"],
  },
  {
    id: "artefact-quantiles-desordonnes-acceptes",
    fichier: "tools/artefact-de-charge.mjs",
    avant: "    if (o[a] > o[b]) c.push(`${ou} : ${a} (${o[a]}) > ${b} (${o[b]}) — les quantiles ne sont pas ordonnés`);",
    apres: "    if (false) c.push(`${ou} : ${a} (${o[a]}) > ${b} (${o[b]}) — les quantiles ne sont pas ordonnés`);",
    pourquoi: "min=100, p50=4, p95=3, p99=2, max=1 passait pour une mesure : un artefact contradictoire entrerait dans la série",
    bancs: ["tools/__tests__/artefactDeCharge.test.js"],
  },
  {
    id: "artefact-delta-non-confronte",
    fichier: "tools/artefact-de-charge.mjs",
    avant: "if (k.delta[cle] !== k.after[cle] - k.before[cle]) c.push(",
    apres: "if (false) c.push(",
    pourquoi: "les compteurs du processus se lisent en deltas parce que init ne les remet pas à zéro ; un delta qui n'est pas after − before est un chiffre inventé",
    bancs: ["tools/__tests__/artefactDeCharge.test.js"],
  },
  {
    id: "artefact-cohorte-unicite-au-lieu-de-couverture",
    fichier: "tools/artefact-de-charge.mjs",
    avant: "  if (Array.isArray(sequence) && positions.size === membres.length) {",
    apres: "  if (false) {",
    pourquoi: "deux artefacts sur trois, positions uniques, étaient « confrontés en cohorte » et conformes : l'unicité n'est pas la couverture, une campagne tient toutes ses positions ou s'arrête sur un échec dit (audit, onzième passe)",
    bancs: ["tools/__tests__/artefactDeCharge.test.js"],
  },
  {
    id: "artefact-2xx-non-inspectees-acceptees",
    fichier: "tools/artefact-de-charge.mjs",
    avant: "    if (total !== st[\"2xx\"]) c.push(`artefact.correctness : ${total} réponse(s) jugée(s) pour ${st[\"2xx\"]} réponse(s) 2xx",
    apres: "    if (total > st[\"2xx\"]) c.push(`artefact.correctness : ${total} réponse(s) jugée(s) pour ${st[\"2xx\"]} réponse(s) 2xx",
    pourquoi: "mille réponses 2xx dont aucune inspectée passaient : « ≤ » laisse un rapport déclarer exact ce qu'il n'a pas regardé (audit, onzième passe)",
    bancs: ["tools/__tests__/artefactDeCharge.test.js"],
  },
  {
    id: "artefact-binsetid-non-derive-des-bornes",
    fichier: "tools/artefact-de-charge.mjs",
    avant: "    if (typeof h.binSetId === \"string\" && h.binSetId !== attendu) c.push(",
    apres: "    if (false) c.push(",
    pourquoi: "un binSetId en chaîne libre laissait deux rapports porter le même identifiant avec des bornes différentes ; dérivé des bornes et recalculé, c'est impossible (audit, onzième passe)",
    bancs: ["tools/__tests__/artefactDeCharge.test.js"],
  },
  {
    id: "artefact-ancre-de-publication-ignoree",
    fichier: "tools/artefact-de-charge.mjs",
    avant: "    if (attendue !== present.empreinte) constats.push(",
    apres: "    if (false) constats.push(",
    pourquoi: "l'immuabilité d'un schéma publié se prouve contre le tag qui l'a publié, pas contre un littéral modifiable dans le même commit ; sans la confrontation, l'ancre ne tient rien (audit, onzième passe)",
    bancs: ["tools/__tests__/artefactDeCharge.test.js"],
  },
  {
    id: "rapport-borne-d-histogramme-inclusive-en-haut",
    fichier: "charge/rapport.js",
    avant: "    while (i > 0 && v < edges[i]) i -= 1;",
    apres: "    while (i > 0 && v <= edges[i]) i -= 1;",
    pourquoi: "une valeur égale à une borne tombait dans la classe d'en dessous : la sémantique écrite dans le schéma est [a, b), et deux producteurs qui ne la lisent pas pareil rendent des histogrammes incomparables sous le même binSetId",
    bancs: ["charge/__tests__/rapport.test.js"],
  },
  {
    id: "rapport-429-comptee-dans-other4xx",
    fichier: "charge/rapport.js",
    avant: "    else if (s === 429) c[\"429\"] += 1;\n    else if (s >= 400 && s < 500) c.other4xx += 1;",
    apres: "    else if (s >= 400 && s < 500) c.other4xx += 1;",
    pourquoi: "les catégories sont disjointes : une 429 comptée dans other4xx rend deux artefacts incompatibles tout en sommant juste — la somme ne trahit rien, seule la classification le peut",
    bancs: ["charge/__tests__/rapport.test.js"],
  },
  {
    id: "rapport-toute-2xx-jugee-correcte",
    fichier: "charge/rapport.js",
    avant: "  return corps.state.current_page === pageAttendue ? \"correct\" : \"autre\";",
    apres: "  return \"correct\";",
    pourquoi: "un état venu d'une AUTRE présentation (clé de cache confondue) passerait pour correct : wrongPresentation ne compterait jamais, et l'exactitude serait une phrase",
    bancs: ["charge/__tests__/rapport.test.js"],
  },
  {
    id: "cache-regroupee-comptee-comme-servie",
    fichier: "server/cache.js",
    avant: "        if (vue.enVol) nRegroupees += 1; else nServies += 1;",
    apres: "        nServies += 1;",
    pourquoi: "servie de la mémoire et regroupée sur une production en vol ne disent pas la même chose du cache : la première dit qu'il retient, la seconde qu'il mutualise — confondues, « le cache tient » redevient une phrase",
    bancs: ["server/__tests__/cacheCompteurs.test.js"],
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
