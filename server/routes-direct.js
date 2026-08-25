// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// EXTRAIT DE handler.js (refactor lot 3 — routes, 19/08/2026) — blocs déplacés À L'IDENTIQUE.
// Reste à PLAT dans server/ (les gardes de forge ciblent server/*.js).

const { adresseAppelant, lcMembre, cleAnonyme, profilDuJeton } = require("./appelant");

const { createPresentation, getPresentation, setPage, endPresentation, addMessage, toggleReaction, editMessage, deleteMessage, setChatLock, createUploadUrl, reclaimPresentation, touchPresentation, listActivePresentations, handoverPresentation, endPresentationByOwner, recordAttendance, presentationStats, listPresentationsForDoc, switchPresentationDoc, setPresentationContent } = require("./presentations");
// Cadence de présence et cible de mutualisation par IP (P1 performance). L'intervalle DOIT
// refléter celui du navigateur (gabarit-live.js) ; la cible est un vrai événement en salle.
const ATTENDANCE_INTERVAL_MS = 25_000;
const ATTENDEES_PER_EGRESS = 250;
let PLAYER = null;
const init = (ctx) => { PLAYER = ctx; };
// Même délégation que dans handler : la règle vit chez l'hôte.
const isAllowedStorageUrl = (url) => PLAYER.storage.isAllowedUrl(url);

// Traite les actions de cette famille. Le MARQUEUR est le retour : les blocs répondent puis
// sortent par leurs `return` d'origine (valeur ≠ false) ; si aucune action ne correspond, la
// chute au bout rend `false` et le dispatch continue. Aucune liste d'actions n'est dupliquée
// entre ici et handler (un correctif à deux exemplaires finit par diverger) — et aucun appui
// sur res.writableEnded, absent des `res` postiches des bancs comme de certains hôtes.
async function traiter(req, res, body, _slug) {
      if (body.action === "present-start" || body.action === "present-page" || body.action === "present-end" || body.action === "present-touch") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          if (body.action === "present-start") {
            if (!isAllowedStorageUrl(String(body.fileUrl || ""))) return jp(400, { ok: false, error: "url" });
            const ip = adresseAppelant(req) || "anon";
            const allowed = await PLAYER.limits.allow(`pstart:${ip}`, 60, 3600);
            if (!allowed) return jp(429, { ok: false, error: "rate" });
            // On rattache la présentation au membre (JWT) → reprise / liste / transfert. Best-effort : sans
            // session valide la présentation démarre quand même mais ne sera pas reprenable.
            let owner = null;
            const u = await PLAYER.identity.verifyToken(req.headers.authorization);
            if (u && u.email) { const m = u.user_metadata || {}; owner = { id: u.id, email: u.email, name: body.presenterName || m.name || u.email || "", avatar: body.presenterAvatar || m.avatarUrl || "" }; }
            const out = await createPresentation({ docId: body.docId, fileUrl: body.fileUrl, fileName: body.fileName, docTitle: body.docTitle, presenterName: body.presenterName, owner });
            return jp(200, { ok: true, slug: out.slug, control: out.control });
          }
          const r = body.action === "present-page"
            ? await setPage(String(body.slug || ""), String(body.control || ""), body.page, body.seq)
            : body.action === "present-touch"
            ? await touchPresentation(String(body.slug || ""), String(body.control || ""))
            : await endPresentation(String(body.slug || ""), String(body.control || ""));
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch (erreur) {
          // ⚠️ CE CATCH A AVALÉ TROIS JOURS DE CLÔTURES IMPOSSIBLES SANS UNE TRACE. Chez le second
          // hôte, chaque « Terminer » échouait en 23502 (marqueur d'archive NOT NULL) — et ce 500
          // muet ne laissait RIEN, même pas une ligne dans le journal d'erreurs. Un journal que
          // personne ne lit vaut peu ; aucun journal ne vaut rien du tout.
          try { PLAYER.errors.capture(erreur instanceof Error ? erreur : new Error(String(erreur)), { route: "present-" + String(body.action || "").replace(/^present-/, "") }); } catch { /* jamais bloquant */ }
          return jp(500, { ok: false });
        }
      }
      // Assistant IA « présentateur » (bot) sur un lien tracé bot_enabled. PUBLIC (prospect anonyme) → rate-limit IP.
      // Synthèse vocale (ElevenLabs) : Léa lit ses messages. PUBLIC (audience anonyme), mais gated : la clé
      // reste côté serveur, le slug doit être un lien-bot valide, et l'audio est mis en CACHE dans le bucket
      // « tts-cache » (nom = hash voix+modèle+texte) → un message identique n'est synthétisé qu'une fois.

      if (body.action === "present-attend") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const ip = adresseAppelant(req) || "anon";
          // ⚠️ QUOTA DÉRIVÉ DE LA CADENCE, PAS 1000 EN DUR (P1 performance). Un participant émet un
          // battement toutes les ATTENDANCE_INTERVAL_MS ; le quota vise ATTENDEES_PER_EGRESS
          // participants derrière une même IP (bureau, Wi-Fi d'événement partagent une sortie).
          // 1000/h ne couvrait que ~6 participants — le 7e prenait des 429. Marge ×1,3 pour les
          // battements immédiats (arrivée, changement de page, pagehide).
          const battementsParH = Math.ceil(3_600_000 / ATTENDANCE_INTERVAL_MS);
          const quotaPresence = Math.ceil(battementsParH * ATTENDEES_PER_EGRESS * 1.3);
          const allowed = await PLAYER.limits.allow(`patt:${ip}`, quotaPresence, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          // ⚠️ CES DEUX BOOLÉENS ÉTAIENT CEUX DE L'APPELANT. `isMember` sépare la population interne
          // de celle des prospects — c'est la promesse même du produit — et `isPresenter` accorde le
          // titre dans la liste des participants. Les deux venaient du corps de la requête : un
          // prospect pouvait se compter comme collègue, et se donner le titre de présentateur.
          //
          // Ce qui distingue un présentateur d'un participant n'est pas ce qu'il affirme, c'est le
          // `control_token` — `present-chat` le vérifiait déjà pour le badge des messages, cette
          // route ne le faisait pas. Et l'appartenance se prouve par le jeton d'accès de la session :
          // cette route est un `fetch`, elle peut porter un en-tête (contrairement au suivi de
          // lecture, qui part par `sendBeacon` et signe donc dans le corps).
          // ⚠️ CETTE ROUTE NE LIT PLUS LA PRÉSENTATION (0019). Elle la lisait pour trois choses —
          // existe-t-elle, est-elle close, et l'appelant porte-t-il le jeton de contrôle — et les
          // trois se décident maintenant dans la transaction d'écriture. Le battement passe de trois
          // allers-retours à deux. Ce qui monte est l'EMPREINTE du jeton, jamais le jeton : la
          // comparaison est la même qu'ici, faite sur la même donnée, un cran plus bas.
          //
          // ⚠️ Le 404 et le refus d'archive n'ont pas disparu, ils REMONTENT : `recordAttendance`
          // rend { status: 404 } et REFUS_ARCHIVE à partir de ce que la base répond. Un déplacement
          // de décision est l'endroit où une garde se perd — celles-ci sont mesurées, des deux côtés.
          const controlHash = body.control
            ? require("crypto").createHash("sha256").update(String(body.control)).digest("hex")
            : null;
          // ⚠️ Une identité prouvée REMPLACE celle qu'on affirme — elle ne s'y ajoute pas. Sinon la
          // vérification ne servirait qu'à décorer une affirmation qu'on croit toujours.
          const profil = await profilDuJeton(req);
          // ⚠️ ET LA CLÉ EN FAIT PARTIE — C'EST MÊME LA SEULE QUI COMPTE. Le correctif ci-dessus a
          // remplacé le nom, l'e-mail et l'avatar par ceux du jeton, et laissé passer `key`, qui est
          // pourtant l'IDENTITÉ DE LA LIGNE. Or pour un membre cette clé EST son e-mail : un
          // participant anonyme n'avait qu'à poster la vôtre pour écraser votre ligne — nom, avatar —
          // et gonfler votre temps de présence. Ce sont les statistiques de présentation, c'est-à-dire
          // ce que ce produit vend.
          //
          // On dérive donc la clé de ce qui est prouvé, et jamais de ce qui est affirmé. Un anonyme,
          // lui, ne peut rien prouver : sa clé reste la sienne, mais enfermée dans un espace de noms
          // dont elle ne peut pas sortir — elle ne pourra jamais ressembler à l'e-mail d'un membre.
          const anonCap = (PLAYER.config && Number(PLAYER.config.presenceAnonCap) > 0)
            ? Math.trunc(Number(PLAYER.config.presenceAnonCap))
            : Math.ceil(ATTENDEES_PER_EGRESS * 1.3);
          // ⚠️ JETON DE PRÉSENCE (P1c étape 2). Pour un ANONYME, la clé de sa ligne ne vient plus du
          // corps quand il porte un jeton VALIDE : elle vient du jeton PROUVÉ (que l'hôte a émis pour
          // lui), donc un tiers ne peut plus poster sa clé pour écraser sa présence. `wantToken` =
          // premier battement d'un client moderne (pas encore de jeton) — le distinguer d'un client
          // legacy est ce qui permet à `sansJeton` de retomber à zéro. Un MEMBRE est prouvé par son JWT.
          const slug = String(body.slug || "");
          const jetonEntrant = (typeof PLAYER.identity.verifyPresenceToken === "function")
            ? PLAYER.identity.verifyPresenceToken(String(body.pt || "")) : null;
          const jetonValide = !!(jetonEntrant && jetonEntrant.slug === slug && jetonEntrant.key);
          const cleAnon = jetonValide ? String(jetonEntrant.key) : cleAnonyme(body.key);
          // ⚠️ L'IP NE PART PAS EN CLAIR VERS LA BASE — mais NE PRÉTENDONS PAS QUE C'EST ANONYME.
          //
          // Ce commentaire disait « sans conserver de donnée personnelle », et c'était FAUX : un
          // SHA-256 d'adresse IPv4 se recalcule intégralement (quatre milliards de valeurs, quelques
          // minutes), donc l'empreinte se remonte à l'adresse par qui obtient la base. La CNIL est
          // explicite : une IP hachée reste une donnée PSEUDONYMISÉE, soumise au RGPD. La description
          // était plus forte que l'implémentation — la classe même qu'on traque ailleurs.
          //
          // Avec un SEL SECRET, la table cesse d'être recalculable sans lui. Le `slug` entre dans
          // l'empreinte pour qu'on ne puisse pas CORRÉLER la présence d'une même adresse d'une
          // présentation à l'autre — le plafond, lui, compte déjà par (slug, empreinte), donc rien ne
          // change pour lui. Le préfixe de domaine sépare cet usage de toute autre signature faite
          // avec le même secret. Sans sel (hôte qui n'en pose aucun), on retombe sur l'ancienne
          // empreinte : la fonction marche, la protection est moindre, et c'est écrit ici plutôt que
          // découvert plus tard. Le plafond reste configurable, défaut ATTENDEES_PER_EGRESS × 1,3.
          const sel = String((PLAYER.config && PLAYER.config.ipHashSecret) || "");
          const ipHash = sel
            ? require("crypto").createHmac("sha256", sel).update("attendance-ip\0" + slug + "\0" + ip).digest("hex").slice(0, 32)
            : require("crypto").createHash("sha256").update("att:" + ip).digest("hex").slice(0, 32);

          // ⚠️ ON SIGNE AVANT D'ÉCRIRE, ET C'EST CE QUI FERMAIT UNE BOUCLE. Le jeton était fabriqué
          // APRÈS l'écriture : on déclarait donc un bootstrap « moderne » sans savoir si un jeton
          // pourrait seulement sortir. Sans `PLAYER_PRESENCE_SECRET`, la ligne était marquée réclamée
          // et AUCUN jeton n'était renvoyé — le battement suivant repartait en bootstrap, tombait sur
          // sa propre ligne réclamée (409), et le client faisait tourner sa clé. Chaque battement
          // créait alors un participant de plus, jusqu'au plafond de 325. Une protection qui produit
          // exactement ce qu'elle interdit. (Relevé par un audit externe.)
          const jetonCandidat = (!profil && typeof PLAYER.identity.signPresenceToken === "function")
            ? PLAYER.identity.signPresenceToken(slug, cleAnon, 7 * 24 * 3600) : "";
          const peutEmettre = !!jetonCandidat;
          // Un bootstrap n'est un bootstrap que si l'hôte peut RÉELLEMENT émettre. Sinon ce battement
          // ne porte aucune preuve et n'en portera jamais : c'est un battement sans jeton, et le
          // compteur doit le dire — c'est même ce qui empêche d'armer STRICT sur un hôte sans secret,
          // puisque `sansJeton` n'y retombera jamais à zéro.
          const bootstrap = !profil && !jetonValide && String(body.wantToken || "") === "1" && peutEmettre;
          // ⚠️ TROIS ÉTATS, PAS DEUX. true = PROUVÉ (membre ou jeton valide) → last_token_at, la ligne
          // devient réclamée. false = sans preuve (legacy, ou moderne sur un hôte sans secret) →
          // last_no_token_at. null = BOOTSTRAP : ni l'un ni l'autre. Un bootstrap ne prouve rien — il
          // ne doit donc pas réclamer la ligne (sinon un client qui perd son jeton se refuse lui-même)
          // ni compter comme legacy (sinon `sansJeton` ne retomberait jamais à zéro, chaque nouveau
          // visiteur en produisant un). La ligne est créée LIBRE ; elle sera réclamée au battement
          // suivant, celui qui portera le jeton.
          const hasToken = (profil || jetonValide) ? true : (bootstrap ? null : false);
          // ⚠️ PORTE STRICTE : une fois la transition finie (sansJeton===0) et PLAYER_PRESENCE_STRICT
          // posé, un battement LEGACY (anonyme, sans jeton ni bootstrap) n'est plus enregistré. Off par
          // défaut → aucun effet pendant la transition. ⚠️ RÉSIDU CONNU (à durcir en suivant) : un
          // bootstrap `wantToken` portant la clé d'un anonyme EXISTANT pourrait l'écraser sous strict —
          // exploitabilité faible (l'attaquant doit connaître un uid anonyme aléatoire, jamais exposé) ;
          // le fermer proprement demande à la RPC de refuser un bootstrap sur une clé déjà existante.
          // ⚠️ STRICT EST INERTE SANS CAPACITÉ D'ÉMETTRE — sinon il refuserait 100 % des participants
          // anonymes, une panne auto-infligée : sans secret, personne ne PEUT obtenir de jeton. On
          // dégrade donc, et on le DIT (la carte rend `presenceStrict` effectif, pas déclaré).
          if (PLAYER.config && PLAYER.config.presenceStrict && !peutEmettre && !profil) {
            try {
              if (await PLAYER.limits.allow("presence:strict-inerte", 1, 3600)) {
                PLAYER.errors.capture(new Error(
                  "PLAYER_PRESENCE_STRICT est posé mais AUCUN jeton ne peut être émis "
                  + "(PLAYER_PRESENCE_SECRET absent) : la porte reste OUVERTE. Armé tel quel, elle "
                  + "refuserait tous les participants anonymes.",
                ), { route: "present-attend" });
              }
            } catch { /* jamais bloquant */ }
          }
          if (PLAYER.config && PLAYER.config.presenceStrict && peutEmettre && !profil && !jetonValide && !bootstrap) {
            return jp(403, { ok: false, error: "presence-token" });
          }
          const r = await recordAttendance(slug, {
            // ⚠️ MINUSCULÉE, ET CE DÉTAIL EST UNE LIGNE DE PRÉSENCE. La clé cliente que 0.1.42 a
            // remplacée l'était (`me.email.toLowerCase()`) ; la clé dérivée ne l'était pas, et la
            // ligne se retrouve par `attendee_key=eq.` — une correspondance EXACTE. Un hôte dont
            // l'identité rend l'adresse telle qu'elle a été saisie aurait donc vu, pour un même
            // membre, une SECONDE ligne apparaître : temps cumulé reparti de zéro, et le collègue
            // affiché deux fois dans la liste des participants.
            //
            // Sans effet là où les adresses sont déjà normalisées — c'est le cas des deux hôtes
            // actuels, et c'est pour ça que rien ne l'aurait signalé. Un contrat ouvert ne se
            // repose pas sur ce que ses deux premiers hôtes font.
            key: profil ? lcMembre(profil.email) : cleAnon,
            name: (profil && profil.name) || body.name,
            email: profil ? profil.email : body.email,
            avatar: (profil && profil.avatar) || body.avatar,
            // ⚠️ ON N'AFFIRME PLUS LE TITRE, ON FOURNIT LA PREUVE (`controlHash`, plus bas) : c'est
            // la base qui compare. Affirmer `false` ici n'enlève donc rien — le titre vient du jeton.
            isMember: !!profil, isPresenter: false,
            // ⚠️ UN BOOTSTRAP NE PEUT PAS S'EMPARER D'UNE PRÉSENCE DÉJÀ RÉCLAMÉE (0018). `wantToken`
            // est AUTO-DÉCLARÉ : sans ce verrou, un attaquant le déclarait, posait la clé d'un
            // participant enregistré, et écrasait sa ligne — l'usurpation même que l'étape 2 ferme
            // pour les battements ordinaires. Le second hôte l'a EXÉCUTÉE sur sa prod. Le contrôle ne
            // vaut que pour un bootstrap : un porteur de jeton est déjà prouvé, un membre aussi.
          }, { ipHash, anonCap, hasToken, onlyIfUnclaimed: bootstrap, controlHash });
          // On ÉMET (ou ré-émet) un jeton pour l'anonyme dont l'écriture a réussi : le client le garde
          // et le renvoie aux battements suivants. `exp` court (6 h), ré-émis à chaque battement — pas
          // de table anti-rejeu (le scellé d'archive et l'exp bornent déjà le rejeu, cf. 0007). Un
          // membre n'en a pas besoin (son JWT le prouve). Sans PLAYER_PRESENCE_SECRET, `signPresenceToken`
          // rend "" → aucun champ `pt`, le client reste en mode legacy. Rien ne casse.
          // ⚠️ SEPT JOURS, ET C'EST LA PERSISTANCE QUI FIXE LE CHIFFRE. Le jeton vit maintenant dans le
          // stockage du visiteur, à côté de sa clé de participant : sa durée de vie doit couvrir un
          // RETOUR, sinon l'expiration relance un bootstrap sur une ligne réclamée, qui sera refusé, et
          // le visiteur repart sur une ligne neuve — une présence coupée en deux dans les statistiques
          // pour rien. Le rejeu reste borné par le scellé d'archive (0007, il porte aussi sur la table
          // des présences) : une présentation close refuse toute écriture, jeton valide ou non.
          const pt = (r.ok && jetonCandidat) ? jetonCandidat : "";
          return jp(r.ok ? 200 : (r.status || 400), pt ? { ...r, pt } : r);
        } catch (e) { try { PLAYER.errors.capture(e, { route: "present-attend" }); } catch { /* jamais bloquant */ } return jp(500, { ok: false }); }
      }
      // Gestion des présentations (membre AUTHENTIFIÉ requis) : liste / reprise / transfert / stats / historique doc.
      if (body.action === "present-list" || body.action === "present-reclaim" || body.action === "present-handover" || body.action === "present-owner-end" || body.action === "present-stats" || body.action === "present-doc-list" || body.action === "present-switch" || body.action === "present-content") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const u = await PLAYER.identity.verifyToken(req.headers.authorization);
          // ⚠️ UNE EXCEPTION, ET UNE SEULE. `present-content` pilote ce que la présentation AFFICHE,
          // exactement comme `present-page` tourne les pages — et `present-page` se contente du
          // `control_token`, sans session. Exiger un JWT ici cassait les présentations démarrées
          // sans session, que `present-start` autorise pourtant : la carte ne suivait pas, en
          // silence. Le jeton de contrôle est vérifié plus bas, contre la ligne de la présentation.
          //
          // ⚠️ Les autres actions de ce groupe restent réservées à une session, et `present-switch`
          // — changer le DOCUMENT montré — au propriétaire : décider ce qu'on montre n'est pas
          // piloter l'affichage.
          const pilotage = body.action === "present-content" && !!body.control;
          if ((!u || !u.email) && !pilotage) return jp(401, { ok: false, error: "auth" });
          const isAdmin = !!u && PLAYER.identity.isAdmin(u);
          let r;
          if (body.action === "present-list") r = { ok: true, presentations: await listActivePresentations(u.email) };
          else if (body.action === "present-reclaim") r = await reclaimPresentation(String(body.slug || ""), u.email);
          else if (body.action === "present-owner-end") r = await endPresentationByOwner(String(body.slug || ""), u.email, isAdmin);
          // ⚠️ DEUX DROITS, PAS UN — ET LEUR NOM EST UN ÉLÉMENT DE CONTRAT.
          //
          // Voir qu'une présentation a eu lieu et voir QUI y était sont deux sensibilités
          // différentes : l'historique rend des slugs, des noms de présentateurs et des compteurs ;
          // les statistiques rendent les NOMS, les ADRESSES et le temps de présence de participants
          // qui sont souvent des prospects. Un hôte peut vouloir ouvrir le premier à toute l'équipe
          // et réserver le second — les fondre en un seul droit lui retirerait ce choix.
          //
          // ⚠️ Les noms suivent la convention existante : `list` / `list.all`, où le suffixe dit
          // « au-delà des miennes ». Ils sont documentés dans docs/HOST-CONTRACT.md, et une garde
          // vérifie que tout nom demandé ici y figure — une action inconnue vaut refus chez un hôte
          // prudent, donc l'introduire en silence casserait son instance sans rien dire.
          //
          // Le droit est demandé PARESSEUSEMENT : un propriétaire n'a pas à payer un aller-retour
          // pour lire ce qui lui appartient déjà.
          else if (body.action === "present-stats") {
            r = await presentationStats(String(body.slug || ""), u.email, isAdmin,
              () => PLAYER.identity.canManageShares(u, "presentations.stats"));
          }
          else if (body.action === "present-doc-list") {
            r = { ok: true, presentations: await listPresentationsForDoc(String(body.docId || ""), u.email, isAdmin,
              () => PLAYER.identity.canManageShares(u, "presentations.list.all")) };
          }
          else if (body.action === "present-switch") {
            if (!isAllowedStorageUrl(String(body.fileUrl || ""))) return jp(400, { ok: false, error: "url" });
            r = await switchPresentationDoc(String(body.slug || ""), u.email, isAdmin, { fileUrl: body.fileUrl, fileName: body.fileName, docTitle: body.docTitle, docId: body.docId });
          }
          else if (body.action === "present-content") r = await setPresentationContent(String(body.slug || ""), (u && u.email) || "", isAdmin, body.content, String(body.control || ""));
          else r = await handoverPresentation(String(body.slug || ""), u.email, body.newOwner);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch (e) { try { PLAYER.errors.capture(e, { route: "present-content" }); } catch { /* jamais bloquant */ } return jp(500, { ok: false }); }
      }
      // Chat de présentation (historisé) : n'importe quel participant (présentateur ou audience) poste un
      // message. Écriture via service role ; anti-spam par IP (60/h). La présentation doit exister.
      if (body.action === "present-chat") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const pres = await getPresentation(String(body.slug || ""));
          if (!pres) return jp(404, { ok: false });
          const ip = adresseAppelant(req) || "anon";
          const allowed = await PLAYER.limits.allow(`pchat:${ip}`, 60, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          // Le badge « présentateur » n'est accordé QUE si le control_token est valide (sinon n'importe quel
          // participant pourrait poster un message usurpant le présentateur). Sert aussi au chat verrouillé.
          const validControl = !!(body.control && require("crypto").createHash("sha256").update(String(body.control)).digest("hex") === pres.control_hash);
          if (pres.chat_locked && !validControl) return jp(423, { ok: false, error: "locked" });
          // `isMember` restait l'affirmation du client, alors que `isPresenter` était vérifié juste
          // au-dessus. Deux poids sur la même ligne : le badge « présentateur » se méritait, celui
          // de collègue se réclamait.
          const profil = await profilDuJeton(req);
          const r = await addMessage(String(body.slug || ""), {
            name: (profil && profil.name) || body.name,
            email: profil ? profil.email : body.email,
            avatar: (profil && profil.avatar) || body.avatar,
            isPresenter: validControl, isMember: !!profil, body: body.body, replyTo: body.replyTo, replyName: body.replyName, replyText: body.replyText, authorToken: body.authorToken, attachment: body.attachment , clientKey: body.clientKey });
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch (e) { try { PLAYER.errors.capture(e, { route: "present-chat" }); } catch { /* jamais bloquant */ } return jp(500, { ok: false }); }
      }
      // Pièce jointe : URL d'upload signée (la présentation doit exister ; rate-limit).
      if (body.action === "present-upload-url") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const pres = await getPresentation(String(body.slug || ""));
          if (!pres) return jp(404, { ok: false });
          const ip = adresseAppelant(req) || "anon";
          const allowed = await PLAYER.limits.allow(`pup:${ip}`, 30, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          const r = await createUploadUrl(String(body.slug || ""), body.name, body.type);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch (e) { try { PLAYER.errors.capture(e, { route: "present-upload-url" }); } catch { /* jamais bloquant */ } return jp(500, { ok: false }); }
      }
      // Chat : éditer / supprimer un message, verrouiller le chat.
      if (body.action === "present-msg-edit" || body.action === "present-msg-delete" || body.action === "present-chatlock") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          let r;
          if (body.action === "present-msg-edit") r = await editMessage(String(body.slug || ""), body.msgId, String(body.authorToken || ""), body.body);
          else if (body.action === "present-msg-delete") r = await deleteMessage(String(body.slug || ""), body.msgId, { authorToken: body.authorToken, control: body.control });
          else r = await setChatLock(String(body.slug || ""), String(body.control || ""), !!body.locked);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch (e) { try { PLAYER.errors.capture(e, { route: "present-msg-delete" }); } catch { /* jamais bloquant */ } return jp(500, { ok: false }); }
      }
      // Réaction emoji (toggle) sur un message du chat de présentation.
      if (body.action === "present-react") {
        const jp = (status, obj) => { res.statusCode = status; res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(obj)); };
        try {
          const ip = adresseAppelant(req) || "anon";
          const allowed = await PLAYER.limits.allow(`preact:${ip}`, 200, 3600);
          if (!allowed) return jp(429, { ok: false, error: "rate" });
          // ⚠️ LE CINQUIÈME ARGUMENT A MANQUÉ ICI PENDANT TROIS VERSIONS. `toggleReaction` sait
          // poser un état depuis 0.1.56, le client l'envoie depuis 0.1.56 — et cette ligne le
          // jetait. Les essais éprouvaient la FONCTION, jamais la route : le correctif était vu
          // refuser en mutation et inactif en production. Trouvé par le troisième audit.
          // ⚠️ `body.reactor` N'EST PLUS LU. C'est un champ que le client CHOISIT, et les refs des
          // autres participants sont publics (le tableau des réactions les porte) : s'y fier
          // laissait n'importe qui poser ou retirer les réactions d'un autre. L'identité se
          // dérive du jeton d'auteur — le secret qui ne quitte pas le navigateur qui l'a tiré.
          const reacteur = require("./presentations").reacteurDepuisJeton(body.authorToken);
          const r = await toggleReaction(String(body.slug || ""), body.msgId, body.emoji, reacteur, body.etat);
          return jp(r.ok ? 200 : (r.status || 400), r);
        } catch (e) { try { PLAYER.errors.capture(e, { route: "present-react" }); } catch { /* jamais bloquant */ } return jp(500, { ok: false }); }
      }
  return false;
}

module.exports = { init, traiter };
