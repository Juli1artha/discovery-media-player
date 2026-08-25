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
const { jsonPour } = require("./reponses.js");

const { getShareBySlug } = require("./shares");
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
]);

async function traiter(req, res, body, _slug) {
      if (body.action === "bot-tts") {
        const jp = jsonPour(res);
        if (!docbot) return jp(404, { ok: false, error: "disabled" });
        try {
          const apiKey = process.env.ELEVENLABS_API_KEY;
          if (!apiKey) return jp(200, { ok: false, disabled: true });
          const share = await getShareBySlug(String(body.slug || ""));
          if (!share || !share.bot_enabled) return jp(404, { ok: false, error: "bot" });
          const text = String(body.text || "").replace(/\s+/g, " ").trim().slice(0, 700);
          if (!text) return jp(400, { ok: false, error: "empty" });
          const ip = adresseAppelant(req) || "anon";
          if (!(await PLAYER.limits.allow(`doctts:${ip}`, 400, 3600))) return jp(429, { ok: false, error: "rate" });
          const defaultVoiceId = process.env.ELEVENLABS_VOICE_ID || "21m00Tcm4TlvDq8ikWAM";
          let voiceId = defaultVoiceId;
          // Voix PAR AGENT : le profil du lien peut porter sa propre voix ElevenLabs (behavior.voice.id).
          // Le cache est déjà haché par voix → changer la voix d'un agent régénère proprement ses extraits.
          let voiceOwner = "", voiceName = "", pron = null;
          try { const bp = await docbot.getProfile(share.bot_profile_id); const bv = bp && bp.behavior && bp.behavior.voice; if (bv && bv.id) { voiceId = String(bv.id); voiceOwner = String(bv.owner || ""); voiceName = String(bv.name || ""); } pron = docbot.pronFix(bp); } catch { /* voix par défaut, sans prononciation */ }
          // DIRE ≠ MONTRER : la prononciation (behavior.voice.pron) s'applique ICI, côté serveur — le client
          // envoie et affiche l'ORTHOGRAPHE, la synthèse (et son cache) travaille sur la version phonétique.
          // `spoken` est renvoyé quand il diffère → le viewer aligne le karaoké dessus (mapping mot à mot).
          const spoken = (() => { if (!pron) return text; try { const s = pron(text).replace(/\s+/g, " ").trim().slice(0, 700); return s || text; } catch { return text; } })();
          const modelId = process.env.ELEVENLABS_MODEL || "eleven_multilingual_v2";
          const base = (PLAYER.config && PLAYER.config.supabaseUrl) || "";
          // « v2 » = version du format de cache : les extraits v1 (sans alignement timestamps) sont ignorés
          // d'office et tout se régénère AVEC l'horodatage par caractère (karaoké exact). Anciens fichiers = poids mort minime.
          const keyFor = (vid) => crypto.createHash("sha256").update(vid + "|" + modelId + "|v2|" + spoken).digest("hex");
          let hash = keyFor(voiceId);
          let objPath = hash + ".mp3";
          let pub = base + "/storage/v1/object/public/tts-cache/" + objPath;
          let pubAlign = base + "/storage/v1/object/public/tts-cache/" + hash + ".json";
          // Cache hit ? On sert directement l'URL CDN (coût ElevenLabs = 0). align : les anciens extraits
          // n'ont pas de JSON (404) → le client retombe sur la synchro estimée, rien ne casse.
          try { const head = await fetch(pub, { method: "HEAD" }); if (head.ok) return jp(200, { ok: true, url: pub, align: pubAlign, cached: true, spoken: spoken !== text ? spoken : undefined }); } catch { /* miss */ }
          // WITH-TIMESTAMPS : audio + horodatage PAR CARACTÈRE → surlignage karaoké EXACT côté client.
          const synth = (vid) => fetch("https://api.elevenlabs.io/v1/text-to-speech/" + encodeURIComponent(vid) + "/with-timestamps", {
            method: "POST",
            headers: { "xi-api-key": apiKey, "Content-Type": "application/json", accept: "application/json" },
            body: JSON.stringify({ text: spoken, model_id: modelId, voice_settings: { stability: 0.5, similarity_boost: 0.75, style: 0, use_speaker_boost: true } }),
          });
          let gen = await synth(voiceId);
          // Voix de la BIBLIOTHÈQUE pas encore dans le compte → ajout automatique puis nouvel essai ;
          // si l'ajout échoue (quota de slots), on REPLIE sur la voix par défaut : jamais de présentation muette.
          if (!gen.ok && voiceOwner && /^[A-Za-z0-9_-]{8,80}$/.test(voiceOwner)) {
            try {
              await fetch("https://api.elevenlabs.io/v1/voices/add/" + encodeURIComponent(voiceOwner) + "/" + encodeURIComponent(voiceId), {
                method: "POST", headers: { "xi-api-key": apiKey, "Content-Type": "application/json" },
                body: JSON.stringify({ new_name: (voiceName || `Voix ${PLAYER.branding.name || "player"}`).slice(0, 80) }),
              });
            } catch { /* repli défaut ci-dessous */ }
            gen = await synth(voiceId);
          }
          if (!gen.ok && voiceId !== defaultVoiceId) {
            voiceId = defaultVoiceId; gen = await synth(voiceId);
            // Le repli se met en cache SOUS SA PROPRE clé (voix par défaut) — souvent déjà présente.
            hash = keyFor(voiceId); objPath = hash + ".mp3";
            pub = base + "/storage/v1/object/public/tts-cache/" + objPath;
            pubAlign = base + "/storage/v1/object/public/tts-cache/" + hash + ".json";
          }
          if (!gen.ok) { try { await PLAYER.errors.capture(new Error("elevenlabs " + gen.status), { where: "bot-tts" }); } catch { /* noop */ } return jp(200, { ok: false }); }
          const data = await gen.json().catch(() => null);
          const buf = data && data.audio_base64 ? Buffer.from(data.audio_base64, "base64") : Buffer.alloc(0);
          if (!buf.length) return jp(200, { ok: false });
          const up = await PLAYER.storage.put("tts-cache", objPath, buf, "audio/mpeg");
          // Surveillance du réservoir ElevenLabs (throttlée 1×/h) — cf. _provider-quotas.js.
          try { await PLAYER.plugins.providerQuotas?.tick("elevenlabs"); } catch { /* jamais bloquant */ }
          if (!up) return jp(200, { ok: false });
          // Alignement compact : instants de DÉBUT par caractère (ms) — mêmes index que le texte envoyé.
          let hasAlign = false;
          try {
            const al = data.alignment || data.normalized_alignment;
            if (al && Array.isArray(al.character_start_times_seconds)) {
              const tms = al.character_start_times_seconds.map((x) => Math.round(Number(x) * 1000));
              hasAlign = await PLAYER.storage.put("tts-cache", hash + ".json", Buffer.from(JSON.stringify({ t: tms })), "application/json");
            }
          } catch { /* sans alignement → synchro estimée côté client */ }
          return jp(200, { ok: true, url: pub, align: hasAlign ? pubAlign : null, spoken: spoken !== text ? spoken : undefined });
        } catch (e) { try { PLAYER.errors.capture(e, { route: String(body.action || "(sans action)") }); } catch { /* jamais bloquant */ } return jp(500, { ok: false }); }
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
            const liee = await docbot.getSession(String(body.sessionId || ""));
            if (!liee || liee.share_slug !== share.slug) return jp(400, { ok: false, error: "session" });
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
        } catch (e) { try { PLAYER.errors.capture(e, { route: String(body.action || "(sans action)") }); } catch { /* jamais bloquant */ } return jp(500, { ok: false }); }
      }
      // Assistance (heartbeat) : PUBLIC (l'audience est anonyme). Journalise qui suit / combien de temps / pages vues.
      // Rate-limit généreux par IP (heartbeat ≈ 145/h/participant) : bloque le spam d'assistants factices sans
      // gêner un usage normal ; fail-open, et un 429 ici ne dégrade que les stats (pas la présentation).
  return false;
}

module.exports = { init, traiter };
