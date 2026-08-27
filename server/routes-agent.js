// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// EXTRAIT DE handler.js (refactor lot 3 — routes, 19/08/2026) — blocs déplacés À L'IDENTIQUE.
// Reste à PLAT dans server/ (les gardes de forge ciblent server/*.js).

// ⚠️ EXPLICITE, PARCE QUE LE GLOBAL N'EST PAS LE MODULE. L'extraction depuis handler.js (lot 3)
// a déplacé bot-tts sans importer `crypto` : la route s'appuyait sur `globalThis.crypto`, dont la
// forme varie selon le runtime — certains y exposent `createHash`, d'autres (dont l'environnement
// des bancs) n'ont que WebCrypto, et la route rendait alors 500 à la première synthèse. Le banc
// agentVoix.test.js échoue sans cette ligne.
const crypto = require("node:crypto");
const { adresseAppelant } = require("./appelant");
const { jsonPour, etiquetteRoute } = require("./reponses.js");

const { getShareBySlug } = require("./shares");
const { creerCache, CODE_SATURATION } = require("./cache.js");

// ⚠️ TROIS BORNES SUR UN APPEL SORTANT PAYANT, PARCE QU'IL N'EN AVAIT AUCUNE.
//
// `bot-tts` parle à ElevenLabs et écrit dans le stockage. Les trois `fetch` partaient SANS DÉLAI :
// un fournisseur qui répond lentement (ou plus du tout) immobilisait la requête, sa socket et la
// place d'admission du cache jusqu'à ce que la plateforme tue la fonction. C'est la même leçon
// qu'`appelHote` et que le relais de fichiers, qui la portent déjà — celle-ci était la route
// oubliée. Un abandon RÉEL (`AbortSignal`), pas une course de promesses : une course rendrait la
// main sans annuler l'appel, donc sans libérer quoi que ce soit.
//
// Ces valeurs ne sont pas réglables par l'exploitant, et c'est délibéré : ce sont des bornes de
// protocole, pas des réglages de déploiement. Une synthèse de 700 caractères qui met plus de trente
// secondes n'arrivera pas.
const DELAI_TETE_MS = 5000;        // un HEAD sur un CDN : s'il tarde, l'extrait n'est pas en cache
const DELAI_VOIX_MS = 8000;        // ajout d'une voix : accessoire, jamais bloquant
const DELAI_SYNTHESE_MS = 30000;   // la synthèse elle-même, seule opération réellement longue

// ⚠️ LA RÉPONSE VIENT D'UN TIERS : SA TAILLE N'EST PAS LA NÔTRE. `gen.json()` lit tout ce qui
// arrive, sans plafond — audio base64 et tableau d'alignement compris. Le corps est donc lu BORNÉ,
// et refusé au premier octet de trop.
const MAX_REPONSE_OCTETS = 8 * 1024 * 1024;

// ⚠️ UN ÉCHEC DE SYNTHÈSE N'EST PAS UNE ERREUR DE SERVEUR — il ressort en 200 `{ ok:false }`, comme
// avant. Il est typé pour traverser le cache en REJET : une promesse rompue n'est pas mémorisée,
// donc un hoquet d'ElevenLabs ne se sert pas pendant toute la fenêtre.
const ECHEC_SYNTHESE = "tts-echec";
const echecSynthese = () => Object.assign(new Error("synthèse indisponible"), { code: ECHEC_SYNTHESE });

/**
 * Corps lu en TEXTE, borné avant allocation. Rend `null` si la réponse dépasse le plafond —
 * annoncé (`content-length`) ou constaté en cours de lecture.
 */
async function lireBorne(reponse, maxOctets) {
  const annonce = Number(reponse.headers && reponse.headers.get ? reponse.headers.get("content-length") || 0 : 0);
  if (annonce > maxOctets) return null;
  const flux = reponse.body;
  // ⚠️ LE FLUX D'ABORD : c'est le seul chemin qui refuse AVANT d'avoir tout en mémoire. `text()`
  // alloue le corps entier puis mesure — le plafond y arrive trop tard, mais vaut mieux que rien.
  if (!flux || typeof flux.getReader !== "function") {
    if (typeof reponse.text !== "function") return null;
    const t = await reponse.text();
    return Buffer.byteLength(t, "utf8") > maxOctets ? null : t;
  }
  const lecteur = flux.getReader();
  const morceaux = [];
  let taille = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    taille += value.byteLength;
    if (taille > maxOctets) { try { await lecteur.cancel(); } catch { /* déjà clos */ } return null; }
    morceaux.push(Buffer.from(value));
  }
  return Buffer.concat(morceaux).toString("utf8");
}

// ⚠️ REGROUPEMENT PAR EMPREINTE **ET** PLAFOND DE SYNTHÈSES SIMULTANÉES — LE MÊME OUTIL POUR LES
// DEUX. Cent appels concurrents sur le même texte produisaient cent synthèses, cent écritures et
// cent factures pour un seul objet : la vérification de cache est un HEAD, et un HEAD ne voit pas
// ce qui n'est pas encore écrit. `creerCache` fait déjà exactement ça pour les lectures publiques —
// la promesse est partagée, et `maxEnVol` REFUSE la demande de trop (503 réessayable) au lieu de
// l'admettre. C'est le seul endroit d'où puisse sortir un plafond sur les appels sortants payants.
const SYNTHESES_SIMULTANEES = 4;
const cacheSynthese = creerCache({ ttlMs: 60_000, max: 500, maxEnVol: SYNTHESES_SIMULTANEES });

/** Bornes et mémoire de la synthèse, exposées pour les bancs et l'exploitation. */
const _tts = { cache: cacheSynthese, SYNTHESES_SIMULTANEES, MAX_REPONSE_OCTETS, DELAI_SYNTHESE_MS, ditsParAssistant };
let PLAYER = null; let docbot = null;
const init = (ctx) => { PLAYER = ctx; docbot = ctx.plugins.bot; };

// Traite les actions de cette famille. Le MARQUEUR est le retour : les blocs répondent puis
// sortent par leurs `return` d'origine (valeur ≠ false) ; si aucune action ne correspond, la
// chute au bout rend `false` et le dispatch continue. Aucune liste d'actions n'est dupliquée
// entre ici et handler (un correctif à deux exemplaires finit par diverger) — et aucun appui
// sur res.writableEnded, absent des `res` postiches des bancs comme de certains hôtes.

/**
 * Les actions qui AGISSENT SUR UNE SESSION EXISTANTE — c'est-à-dire toutes celles du bloc assistant
 * sauf `bot-start`, qui la crée. La liste vit ici plutôt que dans chaque branche pour que le banc
 * puisse la CONFRONTER à l'aiguillage : une action ajoutée à l'un et pas à l'autre fait rougir.
 */
const ACTIONS_LIEES_A_UNE_SESSION = new Set([
  "bot-say", "bot-history", "bot-nudge", "bot-book", "bot-contact", "bot-rate", "bot-script",
  // ⚠️ `bot-tts` REJOINT LA LISTE LE 26/08, ET ELLE N'EN FAISAIT PARTIE D'AUCUNE MANIÈRE.
  // Elle acceptait `body.text` tel quel : un slug public valide suffisait, aucune session n'était
  // exigée, et rien ne rattachait le texte à une réponse réellement produite. C'est la seule route
  // de ce dépôt qui DÉPENSE DE L'ARGENT — chaque appel non caché est une facture ElevenLabs.
  // Elle est aiguillée plus haut que le bloc assistant, donc elle applique la liaison elle-même ;
  // c'est `gardesAgent.test.js` qui confronte cette liste à l'aiguillage pour qu'un oubli rougisse.
  "bot-tts",
]);

/** Les rôles sous lesquels un hôte peut désigner l'assistant. Ce que le visiteur écrit n'en est pas. */
const ROLES_ASSISTANT = new Set(["bot", "assistant", "ai"]);

/**
 * Les champs où un message d'assistant peut porter son texte, dans l'ordre où on les essaie.
 *
 * ⚠️ `body` A ÉTÉ AJOUTÉ LE 27/08 PARCE QU'UN HÔTE L'A DIT AVANT DE BUTER DESSUS. Ses messages
 * portent leur texte dans `body` — ni `text`, ni `content`. Son `role` valait bien `bot`, donc ce
 * n'était pas le rôle qui cassait : c'était le CHAMP. Notre lecteur aurait rendu une chaîne vide
 * pour chacun de ses messages, l'ensemble aurait été vide, et TOUT aurait été refusé en
 * `400 { error: "texte" }` — le refus par défaut faisant exactement ce qu'il doit faire, sur une
 * intégration parfaitement correcte.
 *
 * ⚠️ ÉLARGIR LE LECTEUR PLUTÔT QUE DEMANDER À L'HÔTE DE PROJETER. Il proposait les deux ; on prend
 * celle-ci. `listMessages` est fourni par l'hôte : lui demander de renommer ses colonnes pour
 * satisfaire une préférence que rien ne documentait déplacerait la transformation chez CHAQUE hôte,
 * pour toujours — et celui qui l'oublierait se ferait refuser en bloc, sans que rien ne dise
 * pourquoi. Le nom du champ ne porte aucune sécurité : c'est le filtre de RÔLE qui fait ce
 * travail-là, et il ne bouge pas.
 */
const CHAMPS_TEXTE = ["text", "content", "body"];

/** La normalisation d'un texte à synthétiser — une seule définition, deux côtés de la confrontation. */
const normaliserTexte = (t) => String(t == null ? "" : t).replace(/\s+/g, " ").trim().slice(0, 700);

/**
 * Ce que l'assistant a RÉELLEMENT dit dans cette session, sous sa forme PRONONCÉE.
 *
 * ⚠️ ON COMPARE LE PRONONCÉ, PAS L'ÉCRIT, ET C'EST PLUS FORT. `pronFix` peut envoyer deux
 * orthographes différentes sur la même prononciation ; or c'est le prononcé qui fait l'empreinte du
 * cache. Un texte accepté est donc SOIT un message réel, SOIT un texte dont l'extrait est déjà en
 * cache — dans les deux cas, aucune facture nouvelle. Comparer l'écrit refuserait des cas légitimes
 * ET laisserait passer des cas payants. Suggestion d'un hôte intégrateur, meilleure que la nôtre.
 *
 * ⚠️ ET ON REFUSE PAR DÉFAUT. La forme d'un message vient du greffon de l'hôte, qu'aucun contrat
 * n'écrit aujourd'hui. Un message sans rôle reconnu n'est PAS traité comme venant de l'assistant :
 * un jeu de messages illisible rend un ensemble vide, donc tout est refusé. Sur une route qui
 * dépense, « je n'ai pas su vérifier » doit se lire « non », jamais « d'accord ».
 */
function ditsParAssistant(messages, prononcer) {
  const dits = new Set();
  for (const m of Array.isArray(messages) ? messages : []) {
    if (!m || typeof m !== "object") continue;
    if (!ROLES_ASSISTANT.has(String(m.role || "").toLowerCase())) continue;
    let brut = "";
    for (const champ of CHAMPS_TEXTE) { if (typeof m[champ] === "string" && m[champ]) { brut = m[champ]; break; } }
    const t = normaliserTexte(brut);
    if (t) dits.add(prononcer(t));
  }
  return dits;
}

/**
 * Une session appartient-elle au document demandé ? UNE définition, deux appelants — c'est la leçon
 * déjà tirée dans le bloc assistant : une garde recopiée est une garde qu'on oublie quelque part.
 */
async function sessionDuDocument(sessionId, share) {
  const liee = await docbot.getSession(String(sessionId || ""));
  return !!(liee && liee.share_slug === share.slug);
}

async function traiter(req, res, body, _slug) {
      if (body.action === "bot-tts") {
        const jp = jsonPour(res);
        if (!docbot) return jp(404, { ok: false, error: "disabled" });
        try {
          const apiKey = process.env.ELEVENLABS_API_KEY;
          if (!apiKey) return jp(200, { ok: false, disabled: true });
          const share = await getShareBySlug(String(body.slug || ""));
          if (!share || !share.bot_enabled) return jp(404, { ok: false, error: "bot" });
          const text = normaliserTexte(body.text);
          if (!text) return jp(400, { ok: false, error: "empty" });
          const ip = adresseAppelant(req) || "anon";
          if (!(await PLAYER.limits.allow(`doctts:${ip}`, 400, 3600))) return jp(429, { ok: false, error: "rate" });
          // ⚠️ LA LIAISON VIENT APRÈS LE PLAFOND DE DÉBIT, ET L'ORDRE EST UNE PROPRIÉTÉ.
          // Posée avant, elle offrait une LECTURE EN BASE par requête à qui n'a même pas de session
          // — un travail non borné déclenché sous le limiteur, c'est-à-dire exactement ce que le
          // limiteur existe pour empêcher. Trouvé par le banc du plafond, qui exigeait 429 « avant
          // tout appel » et a reçu 500 : il gardait déjà cette propriété sans que je la voie.
          //
          // C'est la même liaison que les sept autres actions du bloc assistant, appliquée ici parce
          // que cette route est aiguillée avant lui. Sans elle, un `sessionId` d'un AUTRE document
          // ferait l'affaire, et la confrontation plus bas perdrait tout son sens.
          if (!(await sessionDuDocument(body.sessionId, share))) return jp(400, { ok: false, error: "session" });
          const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
          let voiceId = defaultVoiceId;
          // Voix PAR AGENT : le profil du lien peut porter sa propre voix ElevenLabs (behavior.voice.id).
          // Le cache est déjà haché par voix → changer la voix d'un agent régénère proprement ses extraits.
          let voiceOwner = "", voiceName = "", pron = null;
          try { const bp = await docbot.getProfile(share.bot_profile_id); const bv = bp && bp.behavior && bp.behavior.voice; if (bv && bv.id) { voiceId = String(bv.id); voiceOwner = String(bv.owner || ""); voiceName = String(bv.name || ""); } pron = docbot.pronFix(bp); } catch { /* voix par défaut, sans prononciation */ }
          // DIRE ≠ MONTRER : la prononciation (behavior.voice.pron) s'applique ICI, côté serveur — le client
          // envoie et affiche l'ORTHOGRAPHE, la synthèse (et son cache) travaille sur la version phonétique.
          // `spoken` est renvoyé quand il diffère → le viewer aligne le karaoké dessus (mapping mot à mot).
          const prononcer = (t) => { if (!pron) return t; try { const p2 = normaliserTexte(pron(t)); return p2 || t; } catch { return t; } };
          const spoken = prononcer(text);

          // ⚠️ LE TEXTE DOIT AVOIR ÉTÉ DIT PAR L'ASSISTANT — C'EST TOUTE LA SÉCURITÉ DE CETTE ROUTE.
          // Jusqu'au 26/08, n'importe qui muni d'un lien public pouvait faire synthétiser n'importe
          // quoi aux frais de l'hôte. Les bornes posées le même jour (regroupement, 4 synthèses
          // simultanées, 8 Mio, délais) bornaient le DÉBIT du dégât, pas sa NATURE.
          //
          // ⚠️ ON NE DÉLÈGUE PAS CETTE VÉRIFICATION AU GREFFON, pour la raison déjà écrite plus bas
          // à propos de `bot-history` : `docbot` est fourni par l'hôte, et une propriété de sécurité
          // du player ne peut pas dépendre d'un code qu'il ne contient pas. On lit les messages, on
          // décide ici.
          //
          // ⚠️ UNE LECTURE DE PLUS PAR SYNTHÈSE, ASSUMÉE. Elle a lieu AVANT le cache : servir un
          // extrait déjà payé resterait un moyen d'énumérer ce que d'autres sessions ont fait dire.
          let dits;
          try {
            dits = ditsParAssistant(await docbot.listMessages(String(body.sessionId || "")), prononcer);
          } catch (e) {
            // Une lecture qui échoue n'est pas un texte invalide : le dire au bon code, et le dire
            // tout court — un refus muet ici serait indistinguable d'un texte refusé.
            try { await PLAYER.errors.capture(e, { where: "bot-tts", quoi: "listMessages" }); } catch { /* noop */ }
            return jp(503, { ok: false, error: "indisponible" });
          }
          if (!dits.has(spoken)) return jp(400, { ok: false, error: "texte" });
          const modelId = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
          const base = (PLAYER.config && PLAYER.config.supabaseUrl) || "";
          // « v2 » = version du format de cache : les extraits v1 (sans alignement timestamps) sont ignorés
          // d'office et tout se régénère AVEC l'horodatage par caractère (karaoké exact). Anciens fichiers = poids mort minime.
          const keyFor = (vid) => crypto.createHash("sha256").update(vid + "|" + modelId + "|v2|" + spoken).digest("hex");
          const empreinte = keyFor(voiceId);

          // ⚠️ CE QUI EST MÉMORISÉ EST CE QUI SE PARTAGE, ET RIEN DE PLUS. `spoken` se compose
          // DEHORS, par appelant. Deux textes différents peuvent donner la même prononciation —
          // c'est précisément le travail de `pronFix` —, donc la même empreinte ; mais
          // `spoken !== text` n'est vrai que pour l'un des deux. Mémoriser la réponse entière aurait
          // renvoyé au second l'orthographe du premier, et le karaoké se serait aligné sur la
          // mauvaise chaîne, servi depuis la mémoire, sans jamais repasser par la synthèse.
          let extrait;
          try {
            extrait = await cacheSynthese.lire(empreinte, async () => {
              let hash = empreinte;
              let objPath = hash + ".mp3";
              let pub = base + "/storage/v1/object/public/tts-cache/" + objPath;
              let pubAlign = base + "/storage/v1/object/public/tts-cache/" + hash + ".json";
              // Cache hit ? On sert directement l'URL CDN (coût ElevenLabs = 0). align : les anciens extraits
              // n'ont pas de JSON (404) → le client retombe sur la synchro estimée, rien ne casse.
              try {
                const head = await fetch(pub, { method: "HEAD", signal: AbortSignal.timeout(DELAI_TETE_MS) });
                if (head.ok) return { url: pub, align: pubAlign, cached: true };
              } catch { /* miss, ou HEAD trop lent : on synthétise */ }
              // WITH-TIMESTAMPS : audio + horodatage PAR CARACTÈRE → surlignage karaoké EXACT côté client.
              const synth = (vid) => fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(vid) + "/with-timestamps", {
                method: "POST",
                headers: { "xi-api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
                body: JSON.stringify({ text: spoken, model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }),
                signal: AbortSignal.timeout(DELAI_SYNTHESE_MS),
              });
              // ⚠️ UN ABANDON EST UN ÉCHEC DE SYNTHÈSE, PAS UNE PANNE DU PLAYER. Sans ce rattrapage,
              // le rejet d'`AbortSignal` remonterait en 500 et ferait perdre le repli sur la voix
              // par défaut — le pire des deux mondes : muet ET bruyant.
              const essayer = async (vid) => { try { return await synth(vid); } catch { return { ok: false, status: 0 }; } };
              let gen = await essayer(voiceId);
              // Voix de la BIBLIOTHÈQUE pas encore dans le compte → ajout automatique puis nouvel essai ;
              // si l'ajout échoue (quota de slots), on REPLIE sur la voix par défaut : jamais de présentation muette.
              if (!gen.ok && voiceOwner && /^[A-Za-z0-9_-]{8,80}$/.test(voiceOwner)) {
                try {
                  await fetch("https://api.elevenlabs.io/v1/voices/add/" + encodeURIComponent(voiceOwner) + "/" + encodeURIComponent(voiceId), {
                    method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
                    body: JSON.stringify({ new_name: (voiceName || `Voix ${PLAYER.branding.name || "player"}`).slice(0, 80) }),
                    signal: AbortSignal.timeout(DELAI_VOIX_MS),
                  });
                } catch { /* repli défaut ci-dessous */ }
                gen = await essayer(voiceId);
              }
              if (!gen.ok && voiceId !== defaultVoiceId) {
                voiceId = defaultVoiceId; gen = await essayer(voiceId);
                // Le repli se met en cache SOUS SA PROPRE clé (voix par défaut) — souvent déjà présente.
                hash = keyFor(voiceId); objPath = hash + ".mp3";
                pub = base + "/storage/v1/object/public/tts-cache/" + objPath;
                pubAlign = base + "/storage/v1/object/public/tts-cache/" + hash + ".json";
              }
              if (!gen.ok) { try { await PLAYER.errors.capture(new Error("elevenlabs " + gen.status), { where: "bot-tts" }); } catch { /* noop */ } throw echecSynthese(); }
              // ⚠️ BORNÉ AVANT ALLOCATION. Le corps est écrit par un tiers : sa taille n'est pas la
              // nôtre, et `gen.json()` l'aurait pris en entier quelle qu'elle soit.
              const corpsBrut = await lireBorne(gen, MAX_REPONSE_OCTETS);
              if (corpsBrut == null) {
                try { await PLAYER.errors.capture(new Error("elevenlabs : réponse au-delà de " + MAX_REPONSE_OCTETS + " octets"), { where: "bot-tts" }); } catch { /* noop */ }
                throw echecSynthese();
              }
              let data = null;
              try { data = JSON.parse(corpsBrut); } catch { /* corps illisible : traité comme un échec */ }
              const buf = data && typeof data.audio_base64 === "string" && data.audio_base64
                ? Buffer.from(data.audio_base64, "base64") : Buffer.alloc(0);
              if (!buf.length) throw echecSynthese();
              const up = await PLAYER.storage.put("tts-cache", objPath, buf, "audio/mpeg");
              // Surveillance du réservoir ElevenLabs (throttlée 1×/h) — cf. _provider-quotas.js.
              try { await PLAYER.plugins.providerQuotas?.tick("elevenlabs"); } catch { /* jamais bloquant */ }
              if (!up) throw echecSynthese();
              // ⚠️ LA TRACE, SINON LE BUCKET EST IMPURGEABLE. Rien d'autre ne note qu'un objet a été
              // écrit : l'empreinte ne se rattache à aucune ligne, et la capacité `storage` du
              // contrat expose `put` et `remove`, jamais `list`. Sans cette écriture, le balayage de
              // rétention n'a littéralement rien à parcourir et le cache de voix grossit sans
              // fenêtre, dans un bucket PUBLIC dont un visiteur choisit le contenu.
              //
              // L'EMPREINTE ET LA DATE, JAMAIS LE TEXTE : l'écrire recréerait dans la base la donnée
              // personnelle que le bucket contient peut-être déjà, en la rendant interrogeable.
              //
              // ⚠️ JAMAIS BLOQUANT, MAIS JAMAIS MUET. Une trace qui échoue ne doit pas rendre une
              // présentation muette — on perd la purge de cet objet-là, pas la voix. Mais un rejet
              // silencieux est indistinguable d'un cache vide : c'est la leçon de la session interne
              // jetée sans rien dire, qui a coûté des semaines à un hôte. Dit une fois par heure,
              // pour qu'un exploitant qui ouvre ses journaux tombe dessus.
              try {
                await PLAYER.db.request("doc_tts_objects", {
                  method: "POST",
                  headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
                  body: [{ hash }],
                });
              } catch (eTrace) {
                try {
                  if (await PLAYER.limits.allow("ttstrace:jetee", 1, 3600)) {
                    await PLAYER.errors.capture(
                      new Error(`trace du cache de voix non écrite (${eTrace && eTrace.message}) — ces objets resteront hors de toute fenêtre de rétention`),
                      { route: "bot-tts" },
                    );
                  }
                } catch { /* un journal ne doit jamais empêcher une voix */ }
              }
              // Alignement compact : instants de DÉBUT par caractère (ms) — mêmes index que le texte envoyé.
              let hasAlign = false;
              try {
                const al = data.alignment || data.normalized_alignment;
                if (al && Array.isArray(al.character_start_times_seconds)) {
                  const tms = al.character_start_times_seconds.map((x) => Math.round(Number(x) * 1000));
                  hasAlign = await PLAYER.storage.put("tts-cache", hash + ".json", Buffer.from(JSON.stringify({ t: tms })), "application/json");
                }
              } catch { /* sans alignement → synchro estimée côté client */ }
              return { url: pub, align: hasAlign ? pubAlign : null };
            });
          } catch (e) {
            // ⚠️ « NOUS REFUSONS UNE SYNTHÈSE DE PLUS » N'EST PAS « LA SYNTHÈSE A ÉCHOUÉ ». Le 503
            // réessayable dit au client d'attendre une seconde ; le 200 `{ ok:false }` lui dit de
            // se passer de voix. Les confondre rendrait muette une présentation que la seconde
            // d'après aurait servie.
            if (e && e.code === CODE_SATURATION) {
              return jp(503, { ok: false, error: "busy" }, { "Retry-After": String(e.retryAfter || 1) });
            }
            if (e && e.code === ECHEC_SYNTHESE) return jp(200, { ok: false });
            throw e;
          }
          return jp(200, {
            ok: true, url: extrait.url, align: extrait.align || null,
            cached: extrait.cached || undefined,
            spoken: spoken !== text ? spoken : undefined,
          });
        } catch (e) { try { PLAYER.errors.capture(e, { route: etiquetteRoute(body.action) }); } catch { /* jamais bloquant */ } return jp(500, { ok: false }); }
      }
      if (body.action === "bot-start" || body.action === "bot-say" || body.action === "bot-history" || body.action === "bot-nudge" || body.action === "bot-book" || body.action === "bot-contact" || body.action === "bot-rate" || body.action === "bot-script") {
        const jp = jsonPour(res);
        if (!docbot) return jp(404, { ok: false, error: "disabled" });
        try {
          const ip = adresseAppelant(req) || "anon";
          const allowed = await PLAYER.limits.allow(`docbot:${ip}`, 120, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          const share = await getShareBySlug(String(body.slug || ""));
          if (!share || !share.bot_enabled) return jp(404, { ok: false, error: "bot" });
          // ⚠️ UNE SESSION EST LIÉE À SON DOCUMENT — VÉRIFIÉ ICI, POUR TOUTES LES ACTIONS À LA FOIS.
          //
          // Cette vérification vivait DANS chaque action, et trois seulement sur sept la faisaient :
          // `bot-rate`, `bot-script` et `bot-history` (celle-ci ajoutée après coup, en 0.1.131).
          // `bot-say`, `bot-nudge`, `bot-book` et `bot-contact` prenaient le même `sessionId` venu du
          // client sans jamais le rattacher au document demandé.
          //
          // ⚠️ CE QUE ÇA OUVRAIT EST PIRE QUE CE QU'ON VENAIT DE FERMER. `bot-history` LISAIT la
          // conversation d'un autre document ; `bot-say` y ÉCRIT et se fait répondre, `bot-contact`
          // attache un nom, un e-mail et un téléphone à la session d'un autre client. Une porte en
          // lecture et quatre en écriture, dans le même bloc.
          //
          // ⚠️ ET LA LEÇON N'EST PAS « IL EN MANQUAIT QUATRE ». Écrite sept fois, cette garde serait
          // oubliée une huitième au prochain ajout — le défaut n'est pas la ligne absente, c'est que
          // sa présence dépende de la mémoire de celui qui écrit l'action. Elle est donc hissée : une
          // action qui porte une session la prouve, sans que son auteur ait à y penser.
          //
          // Le relevé qui a mené ici vient d'un exploitant : « une vérification que plusieurs actions
          // font chacune pour son compte — il faut compter les ACTIONS, pas les implémentations ».
          // La duplication était homogène, donc invisible à un balayage des variantes ; c'est la
          // COUVERTURE qui divergeait, et rien ne la mesurait. `gardesAgent.test.js` la mesure
          // désormais, en lisant la liste d'actions dans ce fichier même.
          //
          // ⚠️ `bot-start` EST EXCLUE, ET C'EST LA SEULE. Elle CRÉE la session : exiger qu'elle en
          // prouve une fermerait l'assistant à tout le monde.
          if (ACTIONS_LIEES_A_UNE_SESSION.has(body.action)) {
            if (!(await sessionDuDocument(body.sessionId, share))) return jp(400, { ok: false, error: "session" });
          }
          const pages = Math.max(0, Math.min(500, Number(body.pages) || 0));
          const mobile = body.mobile === 1 || body.mobile === true; // téléphone → messages courts + autoplay steps
          if (body.action === "bot-rate") { // satisfaction (1-5 étoiles) posée depuis le bloc central du viewer
            // ⚠️ CE REFUS ÉTAIT INATTEIGNABLE, ET C'EST LA MESURE QUI EN PAYAIT LE PRIX.
            //
            //     const note = Math.max(1, Math.min(5, Number(body.rating) || 0));
            //     if (!note) return jp(400, { ok: false, error: "rating" });
            //
            // `Math.max(1, …)` posait un PLANCHER à 1 : `note` valait toujours au moins 1, donc
            // `!note` n'était jamais vrai et la ligne suivante ne s'exécutait jamais. Une notation
            // SANS note — champ absent, `null`, `"abc"`, un double envoi du client — n'était pas
            // refusée : elle enregistrait **1 étoile**, la pire du barème. La satisfaction mesurée
            // baissait donc d'elle-même à chaque appel malformé, et rien dans le chiffre ne
            // permettait de le voir.
            //
            // C'est la règle que ce dépôt applique déjà au temps de lecture, une couche plus haut :
            // « une métrique qui dit le contraire est la première que les gens cessent de croire ».
            // Une note absente n'est pas une mauvaise note, c'est une absence — et elle se refuse.
            //
            // ⚠️ TROUVÉ EN CHERCHANT À EXERCER LA BRANCHE, pas en lisant le code. Le refus était
            // écrit, donc il avait l'air tenu ; il a fallu écrire le test qui l'atteint pour
            // constater qu'aucune entrée n'y arrivait.
            //
            // ⚠️ `Math.round` PARCE QUE LA COLONNE EST `smallint`. `3.7` traversait la garde intact
            // et partait tel quel vers PostgREST : l'arrondi se décidait en aval, hors de vue. Le
            // plafond à 5 reste, lui — un clic sur une sixième étoile est un défaut d'interface,
            // pas une tentative, et le ramener à 5 est ce que l'appelant voulait dire.
            //
            // `!(note >= 1)` plutôt que `!note` : la forme rend faux pour `NaN` sans s'en remettre
            // au `|| 0` qui le précède, donc elle survit à un changement de la ligne d'au-dessus.
            const note = Math.min(5, Math.round(Number(body.rating) || 0));
            if (!(note >= 1)) return jp(400, { ok: false, error: "rating" });
            const cmt = String(body.comment || "").trim().slice(0, 500); // mot facultatif (2e temps du bloc)
            await PLAYER.db.request("doc_bot_sessions?id=eq." + encodeURIComponent(String(body.sessionId)), { method: "PATCH", headers: { Prefer: "return=minimal" }, body: cmt ? { rating: note, rating_comment: cmt } : { rating: note } });
            return jp(200, { ok: true });
          }
          if (body.action === "bot-history") {
            // ⚠️ MÊME LIAISON QUE `bot-rate` ET `bot-script`, ET ELLE MANQUAIT ICI.
            //
            // Cette action rendait le transcript de N'IMPORTE QUELLE session à qui en connaissait
            // l'identifiant — et cet identifiant voyage côté client. Il suffisait d'un slug avec
            // assistant activé (le refus juste au-dessus) et d'un `sessionId` récupéré ailleurs
            // pour lire la conversation tenue sur un autre document : des questions de prospect,
            // c'est-à-dire de la donnée commerciale sur un client, pas un compteur d'usage.
            //
            // ⚠️ ON NE PEUT PAS DÉLÉGUER CE FILTRAGE AU GREFFON. `docbot` est `ctx.plugins.bot`,
            // fourni par l'hôte : supposer qu'il recoupe la session et le document reviendrait à
            // faire dépendre une propriété de sécurité du player d'un code qu'il ne contient pas.
            // C'est exactement pourquoi les deux actions voisines le vérifient elles-mêmes.
            //
            // Les deux voisines avaient la garde ET leur banc ; celle-ci n'avait ni l'une ni
            // l'autre, et la relecture qui a ajouté les bancs a couvert deux actions sur trois.
            return jp(200, { ok: true, messages: await docbot.listMessages(String(body.sessionId || "")) });
          }
          // ⚠️ Même piège : un objet littéral répond à `constructor`. Sans `Object.hasOwn`, une
          // langue « constructor » passait la garde et finissait interpolée dans le prompt du
          // modèle sous la forme « function Object() { [native code] } ».
          const langueDemandee = String(body.lang || "").toLowerCase();
          const blang = Object.hasOwn(docbot.I18N_LANGS, langueDemandee) ? langueDemandee : null; // fr/inconnu → null (langue source)
          if (body.action === "bot-start") return jp(200, { ok: true, ...(await docbot.botStart(share, pages, mobile, String(body.intent || ""), blang)) });
          // Bascule de langue EN COURS de présentation : renvoie le script (traduit ou FR) — le client
          // remplace sa liste d'étapes et rejoue le message courant dans la nouvelle langue.
          if (body.action === "bot-script") {
            const sp = docbot.applyPron(await docbot.scriptedPayload(share.doc_id, blang, String(body.sessionId)), await docbot.getProfile(share.bot_profile_id));
            if (!sp) return jp(400, { ok: false, error: "script" });
            return jp(200, { ok: true, steps: sp.steps, voiceScript: sp.voice, message: sp.hook, closing: sp.closing, messageSay: sp.hookSay, closingSay: sp.closingSay });
          }
          if (body.action === "bot-nudge") { const rn = await docbot.botNudge(String(body.sessionId || ""), share, pages, mobile); if (rn.error) return jp(400, { ok: false, error: rn.error }); return jp(200, { ok: true, ...rn }); }
          if (body.action === "bot-book") { const rb = await docbot.bookSlot(String(body.sessionId || ""), share, String(body.book || "")); if (rb.error) return jp(400, { ok: false, error: rb.error }); return jp(200, { ok: true, ...rb }); }
          // Formulaire de coordonnées : parcours DÉTERMINISTE (zéro appel IA → réponse immédiate).
          if (body.action === "bot-contact") { const rc = await docbot.contactLead(String(body.sessionId || ""), share, { name: body.name, email: body.email, phone: body.phone }); if (rc.error) return jp(400, { ok: false, error: rc.error }); return jp(200, { ok: true, ...rc }); }
          const text = String(body.text || "").slice(0, 1000).trim();
          if (!text) return jp(400, { ok: false, error: "empty" });
          const r = await docbot.botSay(String(body.sessionId || ""), share, text, pages, mobile, blang);
          if (r.error) return jp(400, { ok: false, error: r.error });
          return jp(200, { ok: true, ...r });
        } catch (e) { try { PLAYER.errors.capture(e, { route: etiquetteRoute(body.action) }); } catch { /* jamais bloquant */ } return jp(500, { ok: false }); }
      }
      // Assistance (heartbeat) : PUBLIC (l'audience est anonyme). Journalise qui suit / combien de temps / pages vues.
      // Rate-limit généreux par IP (heartbeat ≈ 145/h/participant) : bloque le spam d'assistants factices sans
      // gêner un usage normal ; fail-open, et un 429 ici ne dégrade que les stats (pas la présentation).
  return false;
}

module.exports = { init, traiter, _tts };
