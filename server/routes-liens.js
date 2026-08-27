// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright © 2026 3D Discovery
// EXTRAIT DE handler.js (refactor lot 3 — routes, 19/08/2026) — blocs déplacés À L'IDENTIQUE.
// Reste à PLAT dans server/ (les gardes de forge ciblent server/*.js).

const { adresseAppelant } = require("./appelant");
const { jsonPour, repondreJson, etiquetteRoute } = require("./reponses.js");
const { estConflit } = require("./erreurs-base.js");
const { createShare, createReshare, sendReshareEmail, revokeShare, setShareAuth, listSharesForDoc, listSessionsForDoc, internalStatsForDoc, cleIdempotence, getShareBySlug, logView, upsertSession, upsertInternalSession, overview: docOverview } = require("./shares");
const { SESSION_QUOTA_PER_HOUR, VIEW_QUOTA_PER_HOUR } = require("./shared.generated.js");

let PLAYER = null;
const init = (ctx) => { PLAYER = ctx; };

// Traite les actions de cette famille. Le MARQUEUR est le retour : les blocs répondent puis
// sortent par leurs `return` d'origine (valeur ≠ false) ; si aucune action ne correspond, la
// chute au bout rend `false` et le dispatch continue. Aucune liste d'actions n'est dupliquée
// entre ici et handler (un correctif à deux exemplaires finit par diverger) — et aucun appui
// sur res.writableEnded, absent des `res` postiches des bancs comme de certains hôtes.
async function traiter(req, res, body, slug) {
      // ── LIENS DE PARTAGE TRACÉS (un par destinataire) ────────────────────────────────────────
      // Ces actions vivaient dans la route de synchronisation du studio, derrière son modèle de
      // droits maison — inappelables par un autre hôte. Elles appartiennent au player : c'est lui
      // qui fabrique les liens, les sert et les trace.
      //
      // ⚠️ QUI a le droit de diffuser un document est en revanche une règle de l'HÔTE, pas du
      // player : elle passe par le contexte (`identity.canManageShares`). Le player se contente de
      // vérifier le jeton. Sans réponse de l'hôte : refus.
      // ── RÉTENTION (docs/RETENTION.md) ────────────────────────────────────────────────────────
      // Déclenchement explicite : hôte de confiance ou admin. Renvoie les comptes DÉCLARÉS —
      // le recensement indépendant (SQL nu) est l'autre moitié du contrat, pas cette route.
      if (body.action === "retention.run") {
        const jd = jsonPour(res);
        try {
          const hote = !!(PLAYER.identity.isTrustedHostCall && PLAYER.identity.isTrustedHostCall(req.headers));
          let admin = false;
          if (!hote) { const u = await PLAYER.identity.verifyToken(req.headers.authorization); admin = !!(u && PLAYER.identity.isAdmin(u)); }
          if (!hote && !admin) return jd(403, { ok: false, error: "retention.run : hôte de confiance ou admin requis" });
          // ⚠️ LES OPTIONS TRAVERSENT LA ROUTE (P1 neuvième audit) — dryRun compris, sinon la
          // purge « à blanc » supprimait pour de vrai. La validation vit dans purgerRetention
          // (avant tout DELETE) ; un refus (ok:false + error) devient un 400, pas un 200.
          // Tout le corps SAUF `action` est passé au validateur : une clé inconnue (faute de
          // frappe d'option) est ainsi refusée, pas ignorée en silence.
          const { action: _a, ...opts } = body;
          const resultat = await require("./retention").purgerRetention(Date.now(), opts);
          return jd(resultat.ok === false ? 400 : 200, resultat);
        } catch (e) { try { PLAYER.errors.capture(e, { route: "retention" }); } catch { /* jamais bloquant */ } return jd(500, { ok: false }); }
      }
      if (String(body.action || "").startsWith("docshare.")) {
        const jd = jsonPour(res);
        // Balayage de rétention opportuniste — au plus un par 24 h, jamais bloquant.
        try { require("./retention").tick(); } catch { /* jamais bloquant */ }
        try {
          // ── L'HÔTE PARLE EN SON NOM PROPRE ────────────────────────────────────────────────
          //
          // Un lien ANONYME — la plaquette publique d'un programme, lue par un prospect sans
          // compte — n'a pas de membre derrière lui. Exiger un JWT forcerait l'hôte à inventer
          // une identité qui n'existe pas : un compte de service dont le mot de passe ouvre bien
          // plus que la création d'un lien, ou pire, l'aperçu interne détourné — ce qui rangerait
          // un prospect dans la population INTERNE et ferait mentir la seule phrase qui compte
          // ici : « ce client a lu pendant douze minutes ».
          //
          // C'est la même nature que `/authz` et `/branding`, que l'hôte sert déjà en serveur à
          // serveur. Demandé par le second hôte, qui avait écarté les trois contournements
          // lui-même avant d'écrire.
          //
          // ⚠️ TROIS VERROUS, et chacun ferme une porte différente :
          //   1. `create` UNIQUEMENT — révoquer, lister, lire des statistiques restent des actes
          //      de membre. Un secret de serveur ne doit pas donner à voir qui a lu quoi.
          //   2. AUCUN destinataire — le nominatif a un membre. L'admettre ici rouvrirait par la
          //      bande ce que le JWT protège.
          //   3. IDEMPOTENT par `docId` — sans ça, un redéploiement, une reprise sur erreur ou un
          //      double clic donnent trois liens pour la même plaquette, donc des statistiques
          //      fragmentées en trois, découvertes en les lisant six mois plus tard.
          if (typeof PLAYER.identity.isTrustedHostCall === "function"
              && PLAYER.identity.isTrustedHostCall(req.headers)) {
            if (body.action !== "docshare.create") {
              return jd(403, { ok: false, error: "L'appel serveur à serveur ne crée que des liens sans destinataire." });
            }
            // ⚠️ LE DESTINATAIRE ATTESTÉ : L'HÔTE SE PORTE GARANT, IL N'AFFIRME PAS.
            //
            // Cette route refusait tout destinataire, au motif qu'un lien nommé appartient à un
            // membre. Le second hôte a montré la limite : il IDENTIFIE lui-même son visiteur — code
            // à usage unique, espace projet — et veut ses lectures comptées, attribuées, révocables.
            // Le lien anonyme est exclu (il serait transmissible à qui n'y a pas droit) et le lien
            // nominatif exige un jeton de membre que ce visiteur n'aura jamais.
            //
            // Ce qui change tout est QUI FOURNIT L'ADRESSE. Dans le cas refusé, elle venait d'un
            // formulaire rempli par un inconnu. Ici elle vient de la base de l'hôte, après
            // vérification, et le visiteur ne la saisit jamais. C'est la forme du jeton interne :
            // l'hôte atteste, le player n'a plus à croire l'appelant.
            //
            // ⚠️ ET ELLE NE VA PAS DANS `recipient_email`, PARCE QUE CE CHAMP PORTE DEUX FAITS.
            // « À qui ce lien est destiné » et « qui a le droit d'expédier en son nom au repartage »
            // y vivaient ensemble. Un visiteur attesté doit avoir le premier sans le second — il n'a
            // jamais engagé sa responsabilité chez nous, et `sendReshareEmail` fait du destinataire
            // du parent l'EXPÉDITEUR (`from`, `replyTo`) d'un message vers une adresse choisie par
            // qui détient le lien. Lui donner ce champ ferait de nos serveurs un relais de courrier
            // signé d'un visiteur.
            //
            // En le rangeant ailleurs, `recipient_email` reste vide sur toute la chaîne : la garde
            // d'envoi refuse, et l'héritage du repartage (`created_by: parent.recipient_email || …`)
            // ne transmet rien. Les deux refusent SANS SAVOIR POURQUOI on les protège — la règle est
            // devenue une conséquence de la donnée, pas une consigne à retenir en deux endroits.
            const atteste = String(body.recipientEmail || "").trim().toLowerCase();
            const docId = String(body.docId || "").trim();
            if (!docId || !body.fileUrl) return jd(400, { ok: false, error: "docId/fileUrl requis" });

            const ipH = adresseAppelant(req) || "hote";
            if (!(await PLAYER.limits.allow(`hshare:${ipH}`, 120, 3600))) return jd(429, { ok: false, error: "rate" });

            // ⚠️ SANS LA COLONNE, ON REFUSE — ON N'ÉCRIT PAS AILLEURS. Un hôte qui n'a pas appliqué
            // la migration verrait sinon son visiteur rangé dans `recipient_email` par défaut, donc
            // capable d'expédier en son nom : le repli silencieux ouvrirait exactement la porte que
            // la séparation ferme. On nomme le fichier à appliquer et on s'arrête.
            if (atteste) {
              const pret = await require("./schema").attendue("destinataireAtteste");
              if (!pret) {
                return jd(409, { ok: false, error: "migration", message: "Destinataire attesté indisponible : appliquez supabase/migrations/0001-destinataire-atteste.sql." });
              }
            }

            // ⚠️ LA CLÉ D'IDEMPOTENCE COMPTE MAINTENANT LE DESTINATAIRE ATTESTÉ. « Le lien de l'hôte
            // pour ce document » ne suffit plus : un lien anonyme et un lien attesté ont tous deux
            // ni créateur ni destinataire au sens de `recipient_email`. Sans cette distinction, le
            // premier visiteur attesté récupérerait le lien anonyme du document — et tous les
            // suivants le même, donc des lectures attribuées à la mauvaise personne.
            const filtreAtteste = atteste
              ? `&attested_recipient_email=eq.${encodeURIComponent(atteste)}`
              : "&attested_recipient_email=is.null";
            const dejaLa = await PLAYER.db.request(
              `commercial_doc_shares?doc_id=eq.${encodeURIComponent(docId)}&created_by=is.null&recipient_email=is.null${filtreAtteste}&select=slug&limit=1`,
            );
            const cleHote = cleIdempotence("hote", [docId, atteste || ""]);
            if (Array.isArray(dejaLa) && dejaLa[0]) {
              // Réemploi d'une ligne historique (sans clé) : on lui POSE la clé au passage — les
              // demandes suivantes la trouveront par l'unicité, et les doublons d'avant 0011
              // s'éteignent d'eux-mêmes faute d'être resservis.
              const cleDispo = await require("./schema").attendue("liensUniques");
              // ⚠️ MÊME RATTRAPAGE QUE LE CHEMIN DE CRÉATION (septième audit : le correctif ne
              // s'était pas appliqué à lui-même). Deux doublons d'avant 0011 en concurrence :
              // l'index refuse la seconde pose de clé — on relit le gagnant au lieu de rendre 500.
              try {
                await PLAYER.db.request(`commercial_doc_shares?slug=eq.${encodeURIComponent(dejaLa[0].slug)}`, {
                  method: "PATCH", headers: { Prefer: "return=minimal" },
                  body: { doc_title: body.docTitle || null, file_url: String(body.fileUrl), file_name: body.fileName || null, revoked: false, ...(cleDispo ? { idem_key: cleHote } : {}) },
                });
              } catch (erreur) {
                if (!estConflit(erreur)) throw erreur;
                try { PLAYER.errors.capture(new Error("backfill hôte : la clé était déjà posée ailleurs — " + docId), { route: "hostshare", benin: true }); } catch { /* jamais bloquant */ }
                const gagnant = await PLAYER.db.request(`commercial_doc_shares?idem_key=eq.${encodeURIComponent(cleHote)}&select=slug&limit=1`);
                if (!Array.isArray(gagnant) || !gagnant[0]) throw erreur;
                return jd(200, { ok: true, slug: gagnant[0].slug, reused: true });
              }
              return jd(200, { ok: true, slug: dejaLa[0].slug, reused: true });
            }
            // `createdBy` reste NUL : personne ne l'a créé. Le filtre « mes liens » compare
            // `created_by=eq.<email>`, qui exclut les NUL — ce lien n'apparaît donc dans la liste
            // de personne, et reste visible en administration (`list.all`, qui ne filtre pas).
            // ⚠️ LA LECTURE-PUIS-ÉCRITURE NE PROMET RIEN : deux demandes dans la même seconde
            // passaient toutes deux le « déjà là ? » et DEUX liens naissaient — les statistiques du
            // document se fragmentent entre eux. La contrainte (0011) promet ; le 409 qu'elle rend
            // est une CONFIRMATION : l'autre demande a gagné, on relit son lien et on le rend
            // `reused` — même règle que le renvoi d'un message (0005).
            try {
              const neuf = await createShare({
                brandKey: body.brandKey, docId, docTitle: body.docTitle, fileUrl: body.fileUrl,
                fileName: body.fileName, createdBy: null, attestedRecipientEmail: atteste || null,
                bot: body.bot, botScript: body.botScript,
                guided: body.guided, profileId: body.profileId, allowDownload: body.allowDownload,
                videoLayout: body.videoLayout, logo: body.logo, logoDark: body.logoDark,
                idemKey: cleHote,
              });
              return jd(200, { ok: true, slug: neuf.slug, reused: false });
            } catch (erreur) {
              if (!estConflit(erreur)) throw erreur;
              try { PLAYER.errors.capture(new Error("lien hôte déjà créé par une demande simultanée : " + docId), { route: "hostshare", benin: true }); } catch { /* jamais bloquant */ }
              const gagnant = await PLAYER.db.request(`commercial_doc_shares?idem_key=eq.${encodeURIComponent(cleHote)}&select=slug&limit=1`);
              if (!Array.isArray(gagnant) || !gagnant[0]) throw erreur;   // 409 d'autre chose : on ne l'invente pas
              return jd(200, { ok: true, slug: gagnant[0].slug, reused: true });
            }
          }

          const u = await PLAYER.identity.verifyToken(req.headers.authorization);
          if (!u || !u.email) return jd(401, { ok: false, error: "auth" });
          // L'action est transmise telle quelle (`create`, `revoke`…) : l'hôte peut séparer
          // l'envoi d'un document — acte commercial ordinaire — de l'administration des liens.
          const acte = String(body.action || "").slice("docshare.".length);
          if (!(await PLAYER.identity.canManageShares(u, acte))) return jd(403, { ok: false, error: "Action non autorisée pour ce rôle." });
        if (body.action === "docshare.setauth") {
          return jd(200, await setShareAuth(String(body.slug || ""), !!body.requireAuth));
        }
        if (body.action === "docshare.overview") {
          return jd(200, { ok: true, byDoc: await docOverview() });
        }
        if (body.action === "docshare.sessions") {
          return jd(200, { ok: true, sessions: await listSessionsForDoc(String(body.docId || "")) });
        }
        if (body.action === "docshare.list") {
          const docId = String(body.docId || "");
          // DEUX portées, et c'est l'hôte qui tranche : « tous les liens » est un acte
          // d'administration, « mes liens » un acte commercial ordinaire. Sans cette distinction,
          // un commercial verrait à qui d'autre le document a été envoyé — les prospects de ses
          // collègues. Un hôte qui ne distingue pas répond oui aux deux et retrouve la liste
          // complète, comme avant.
          const tout = await PLAYER.identity.canManageShares(u, "list.all");
          const [data, internal] = await Promise.all([
            listSharesForDoc(docId, tout ? null : u.email),
            internalStatsForDoc(docId).catch(() => null),
          ]);
          return jd(200, { ok: true, ...data, internal, scope: tout ? "all" : "mine" });
        }
        // « Répétition générale » : UN lien de test par document (réutilisé, re-patché avec le fichier et
        // l'agent ACTUELS à chaque ouverture). Sessions/leads flaggés is_test → exclus stats/notifications.
        if (body.action === "docshare.test") {
          const docId = String(body.docId || "");
          if (!docId || !body.fileUrl) return jd(400, { ok: false, error: "docId/fileUrl requis" });
          const ex = await PLAYER.db.request(`commercial_doc_shares?doc_id=eq.${encodeURIComponent(docId)}&is_test=eq.true&select=slug&limit=1`);
          const cleTest = cleIdempotence("repetition", [docId]);
          if (Array.isArray(ex) && ex[0]) {
            const cleDispo = await require("./schema").attendue("liensUniques");
            // Même rattrapage que ci-dessus : le backfill de la répétition pose la même clé.
            try {
              await PLAYER.db.request(`commercial_doc_shares?slug=eq.${encodeURIComponent(ex[0].slug)}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: { doc_title: body.docTitle || null, file_url: String(body.fileUrl), file_name: body.fileName || null, bot_enabled: true, bot_guided: true, bot_profile_id: (body.profileId || "").trim() || null, revoked: false, ...(cleDispo ? { idem_key: cleTest } : {}) } });
            } catch (erreur) {
              if (!estConflit(erreur)) throw erreur;
              try { PLAYER.errors.capture(new Error("backfill répétition : la clé était déjà posée ailleurs — " + docId), { route: "docshare-test", benin: true }); } catch { /* jamais bloquant */ }
              const gagnant = await PLAYER.db.request(`commercial_doc_shares?idem_key=eq.${encodeURIComponent(cleTest)}&select=slug&limit=1`);
              if (!Array.isArray(gagnant) || !gagnant[0]) throw erreur;
              return jd(200, { ok: true, slug: gagnant[0].slug, reused: true });
            }
            return jd(200, { ok: true, slug: ex[0].slug });
          }
          // Deux ouvertures simultanées de la répétition : la contrainte tranche, le perdant relit.
          try {
            const t = await createShare({ docId, docTitle: body.docTitle, fileUrl: body.fileUrl, fileName: body.fileName, recipientName: "Répétition (test)", createdBy: u.email, bot: true, guided: true, profileId: body.profileId, isTest: true, idemKey: cleTest });
            return jd(200, { ok: true, slug: t.slug });
          } catch (erreur) {
            if (!estConflit(erreur)) throw erreur;
            try { PLAYER.errors.capture(new Error("lien de répétition déjà créé par une demande simultanée : " + docId), { route: "docshare-test", benin: true }); } catch { /* jamais bloquant */ }
            const gagnant = await PLAYER.db.request(`commercial_doc_shares?idem_key=eq.${encodeURIComponent(cleTest)}&select=slug&limit=1`);
            if (!Array.isArray(gagnant) || !gagnant[0]) throw erreur;
            return jd(200, { ok: true, slug: gagnant[0].slug, reused: true });
          }
        }
        if (body.action === "docshare.revoke") {
          await revokeShare(String(body.slug || ""));
          return jd(200, { ok: true });
        }
        const { slug } = await createShare({ brandKey: body.brandKey, docId: body.docId, docTitle: body.docTitle, fileUrl: body.fileUrl, fileName: body.fileName, recipientEmail: body.recipientEmail, recipientName: body.recipientName, createdBy: u.email, bot: body.bot, botScript: body.botScript, guided: body.guided, profileId: body.profileId, allowDownload: body.allowDownload, videoLayout: body.videoLayout, logo: body.logo, logoDark: body.logoDark });
        return jd(200, { ok: true, slug });
        } catch (e) { try { PLAYER.errors.capture(e, { route: etiquetteRoute(body.action) }); } catch { /* jamais bloquant */ } return jd(500, { ok: false }); }
      }

      // Re-partage (forward depuis la visionneuse) : crée un lien enfant tracé, et envoie l'email via 3D
      // Discovery si demandé (body.send). Anti-spam : contenu templé + RATE LIMIT par IP (8/h).
      if (body.action === "reshare") {
        const mail = String(body.email || "").trim().toLowerCase();
        const j = jsonPour(res);
        // ⚠️ LA LONGUEUR AVANT LE MOTIF — et ici ce n'est pas de la prudence, c'est mesuré :
        // `.+@.+\..+` reprend à chaque position de départ, coût 49 ms sur 10 000 caractères,
        // 3 900 ms sur 100 000. Une seule requête, sur une route ouverte au lecteur, bloquait la
        // boucle d'événements quatre secondes — l'instance entière, pas seulement l'appelant.
        // Le débit (8/h par IP) ne protégeait rien : il est vérifié APRÈS, deux lignes plus bas.
        // 254 est le maximum d'une adresse (RFC 5321) : au-delà ce n'est pas « long », c'est faux.
        if (mail.length > 254 || !/.+@.+\..+/.test(mail)) return j(400, { ok: false, error: "email" });
        const ip = adresseAppelant(req) || "anon";
        const allowed = await PLAYER.limits.allow(`reshare:${ip}`, 8, 3600);
        if (!allowed) return j(429, { ok: false, error: "rate", message: "Trop de partages, réessayez plus tard." });
        let out = null;
        try { out = await createReshare(body.slug || slug, { email: mail, name: body.name }); } catch { /* parent introuvable */ }
        if (!out) return j(404, { ok: false });
        let sent = false;
        let refusEnvoi = null;
        if (body.send) {
          try {
            const parent = await getShareBySlug(body.slug || slug);
            // ⚠️ ON N'ENVOIE DE COURRIER QUE POUR UN LIEN QUI A UN DESTINATAIRE.
            //
            // Le lecteur d'un lien ANONYME est un visiteur quelconque : lui laisser demander un
            // envoi ferait des serveurs de l'hôte un relais de courrier non sollicité, avec SON
            // domaine dans l'en-tête. Ce qui coûte cher n'est pas le message parti, c'est la
            // réputation d'expéditeur : elle met des semaines à revenir, et pendant ce temps
            // AUCUN de ses emails n'arrive — factures, relances, notifications d'équipe
            // comprises. Une commodité sur une page publique mettrait en jeu tout son courrier
            // transactionnel.
            //
            // Un lien nominatif, lui, a été créé par quelqu'un qui s'est authentifié et qui
            // engage sa responsabilité. `recipient_email` est nul sur exactement les liens sans
            // membre derrière — c'est déjà la clé d'idempotence du chemin serveur à serveur.
            //
            // ⚠️ La garde est ICI, sur le chemin qui agit, et pas chez l'hôte à l'arrivée. Un
            // filtre à l'arrivée dépend d'une liste à jour ; un chemin qui ne sait pas formuler
            // la demande ne la formulera jamais par accident. Même raison que les trois verrous
            // de `docshare.create`. Demandé par le second hôte, qui l'a réclamée CHEZ NOUS alors
            // qu'il aurait pu la poser chez lui.
            if (!parent || !parent.recipient_email) {
              refusEnvoi = "no-recipient";
              throw new Error("envoi réservé aux liens nominatifs");
            }
            // ⚠️ `Host` EST CHOISI PAR LE CLIENT. Le lien inséré dans un email signé par l'hôte
            // était construit avec cet en-tête : sur le serveur autonome, ou derrière un proxy qui
            // ne le réécrit pas strictement, un lecteur pouvait demander un envoi parfaitement
            // légitime dont le bouton pointe vers SON domaine. L'email part de l'hôte, avec sa
            // marque et sa réputation, vers le destinataire choisi par l'attaquant.
            //
            // ⚠️ UNE ALERTE N'EST PAS UNE INTERDICTION.
            //
            // 0.1.21 posait `PLAYER_PUBLIC_URL`, retombait sur `Host` quand elle manquait, et
            // SIGNALAIT le repli. C'était le bon réflexe de compatibilité et la mauvaise
            // conclusion : le journal ne bloque pas un email d'hameçonnage. Une instance mal
            // configurée continuait d'envoyer, signée de sa marque, avec un bouton pointant où le
            // lecteur voulait — et l'exploitant l'apprenait dans un rapport d'abus.
            //
            // ⚠️ CE QU'ON REFUSE, C'EST L'ENVOI — PAS LE LIEN. Le lien enfant est créé, tracé, et
            // rendu à l'appelant : il peut le transmettre lui-même. Ce qui est retenu est la seule
            // chose qu'on ne peut pas rattraper — un courrier parti de nos serveurs, avec notre
            // domaine dans l'en-tête et notre réputation d'expéditeur derrière.
            //
            // La compatibilité invoquée en 0.1.21 ne tenait donc pas : refuser l'envoi ne casse
            // pas la création du lien, qui est la fonction principale de cette route.
            //
            // Signalé par la seconde passe d'audit (P1-1).
            const publique = String(PLAYER.legal.publicUrl || "").trim();
            if (!publique) {
              try { PLAYER.errors.capture(new Error("PLAYER_PUBLIC_URL non configurée : envoi refusé (le lien de l'email serait construit depuis l'en-tête Host, que le client choisit)"), { route: "reshare" }); } catch { /* jamais bloquant */ }
              refusEnvoi = "public-url-unconfigured";
              throw new Error("URL publique non configurée");
            }
            const origin = publique;
            const r = await sendReshareEmail({ parent, childSlug: out.slug, origin, toEmail: mail, toName: body.name });
            sent = !!(r && r.sent);
          } catch { /* best-effort : le lien existe quand même */ }
        }
        // Le refus se DIT : « rien n'est parti » et « l'envoi n'était pas permis » ne se
        // ressemblent pas, et une interface qui les confond propose un bouton qui ne marchera
        // jamais.
        return j(200, { ok: true, slug: out.slug, sent, ...(refusEnvoi ? { sendRefused: refusEnvoi } : {}) });
      }
      // ⚠️ CE REPLI NE COUVRE QUE LES ÉVÉNEMENTS ANALYTIQUES (P2 huitième audit). Une action POST
      // qu'aucune famille n'a reconnue tombait ici et repartait `{"ok":true}` — une faute de
      // frappe (`present-pgae`) passait pour un succès, parfois même journalisée. Un `action`
      // présent mais inconnu est donc REFUSÉ ; sans action, il faut un `event` autorisé. Jamais un
      // événement absent ou invalide transformé en ouverture.
      const EVENEMENTS = new Set(["open", "page", "heartbeat", "session"]);
      if (typeof body.action === "string" && body.action.trim()) {
        repondreJson(res, 400, { ok: false, error: "unknown-action" });
        return true;
      }
      if (!EVENEMENTS.has(body.event)) {
        repondreJson(res, 400, { ok: false, error: "bad-event" });
        return true;
      }
      const ua0 = req.headers["user-agent"];
      const ip0 = adresseAppelant(req);
      // ⚠️ CONSULTATION INTERNE : L'IDENTITÉ EST AFFIRMÉE PAR LE NAVIGATEUR, PAS PROUVÉE.
      //
      // La population interne est celle que le produit promet de ne jamais mélanger aux prospects.
      // Or cette route acceptait n'importe quel e-mail, n'importe quel document, sans jeton ni
      // limite : on pouvait fabriquer « tel collègue a lu ce document trois heures ».
      //
      // Le suivi part par `sendBeacon`, qui ne sait pas porter d'en-tête — exiger un JWT casserait
      // le seul transport qui survive à la fermeture d'un onglet, c'est-à-dire le moment où la
      // mesure compte le plus. La preuve doit donc voyager dans le CORPS, et venir de l'hôte :
      // lui seul sait qui est son membre.
      //
      // `PLAYER_INTERNAL_STRICT` laisse chaque hôte fermer la porte à son rythme :
      //   • absent  → on accepte, borné et limité, et on le SIGNALE une fois de temps en temps ;
      //   • posé    → sans jeton valide, rien n'est écrit.
      // Une fermeture par défaut casserait les instances en service, dont la nôtre. Une porte
      // qu'on laisse ouverte sans le dire est un défaut ; une porte qu'on laisse ouverte en le
      // disant, avec le verrou fourni, est une transition.
      if (body.internal && body.event === "session") {
        const ipInt = ip0 || "anon";
        // ⚠️ LE QUOTA SE DÉDUIT DE LA CADENCE, IL NE S'ÉCRIT PLUS À LA MAIN.
        //
        // Il valait 120/h alors que le navigateur émet 300/h POUR UN SEUL LECTEUR : la limite ne
        // tenait pas 0,4 lecteur, et refusait tout après 24 minutes de lecture continue. La clé
        // étant l'adresse, une équipe derrière une sortie unique — le cas ordinaire d'une
        // entreprise — se partageait ce que même une personne dépasse.
        //
        // ⚠️ La garde était juste dans sa forme et fausse dans son chiffre : c'est pour ça que
        // personne ne l'a relue. On relit ce qui a l'air douteux, pas ce qui a l'air raisonnable.
        //
        // Détail et arithmétique : src/cadence.ts. Trouvé par le second hôte.
        if (!(await PLAYER.limits.allow(`intsess:${ipInt}`, SESSION_QUOTA_PER_HOUR, 3600))) {
          // ⚠️ UN REFUS MUET EST UNE TABLE VIDE SANS CAUSE NOMMÉE. Le 429 n'apparaît que dans la
          // console du lecteur ; l'exploitant, lui, voyait sa mesure ne pas monter et n'avait rien
          // à quoi le rattacher. C'est la règle des gardes muettes appliquée au quota lui-même —
          // et le signalement passe AVANT le `return`, sans quoi il ne s'exécuterait jamais.
          try {
            if (await PLAYER.limits.allow("intsess:quota-avert", 1, 3600)) {
              PLAYER.errors.capture(new Error(`session interne refusée : quota horaire atteint (${SESSION_QUOTA_PER_HOUR}/h par adresse) — la mesure s'arrête tant qu'il l'est`), { route: "internal-session" });
            }
          } catch { /* un journal ne doit jamais empêcher une lecture */ }
          repondreJson(res, 429, { ok: false, error: "rate" });
          return;
        }
        const jeton = typeof PLAYER.identity.verifyInternalToken === "function"
          ? PLAYER.identity.verifyInternalToken(String(body.it || ""))
          : null;
        const strict = !!(PLAYER.config && PLAYER.config.internalStrict);
        if (strict && !jeton) {
          repondreJson(res, 403, { ok: false, error: "internal-token" });
          return;
        }
        if (!strict && !jeton) {
          // Une fois par heure et par instance : assez pour être vu dans les journaux, pas assez
          // pour les noyer — un avertissement répété à chaque battement ne se lit plus.
          if (await PLAYER.limits.allow("intsess:avert", 1, 3600)) {
            try { PLAYER.errors.capture(new Error("session interne écrite sans jeton : l'identité vient du navigateur. Poser PLAYER_INTERNAL_STRICT=1 une fois l'hôte à jour"), { route: "internal-session" }); } catch { /* ignore */ }
          }
        }
        // Le jeton fait foi quand il est là : c'est l'hôte qui se porte garant, pas l'appelant.
        try {
          await upsertInternalSession({
            sessionId: body.sessionId,
            docId: jeton ? jeton.docId : body.docId,
            userEmail: jeton ? jeton.email : body.email,
            userName: jeton ? (jeton.name || body.name) : body.name,
            numPages: body.numPages, maxPage: body.maxPage, totalSeconds: body.totalSeconds, pagesTime: body.pagesTime,
          }, { ip: ip0, ua: ua0 });
        } catch (e) {
          // ⚠️ CE `catch` A COÛTÉ UNE JOURNÉE À UN HÔTE, ET IL ÉTAIT À TROIS LIGNES DU COMMENTAIRE
          // QUI DIT DE NE PAS FAIRE ÇA.
          //
          // La ligne écrite portait `ua` et `ip` ; la table des sessions internes ne les a pas.
          // PostgREST refusait, ce `catch` avalait le refus, et la route répondait `{"ok":true}`.
          // Ni le second hôte ni nous n'avions une seule ligne mesurée — notre table de production
          // en comptait ZÉRO — et rien, nulle part, ne le disait.
          //
          // « best-effort » est une intention juste : une mesure ne doit jamais empêcher de lire un
          // document. Mais best-effort ne veut pas dire MUET. Ce qu'on rattrape ici, c'est le droit
          // de continuer — pas le droit de ne rien dire.
          //
          // ⚠️ La leçon dépasse ce bloc : une règle écrite dans un commentaire ne protège pas le
          // code qui la suit. C'est pourquoi elle est aussi devenue un test —
          // server/__tests__/ecritureMuette.test.js refuse tout `catch` vide autour d'une écriture
          // de mesure.
          try {
            if (await PLAYER.limits.allow("intsess:echec", 1, 3600)) {
              PLAYER.errors.capture(new Error(`écriture de session interne refusée : ${e && e.message ? e.message : "cause inconnue"} — la mesure ne s'enregistre pas`), { route: "internal-session" });
            }
          } catch { /* un journal ne doit jamais empêcher une lecture */ }
        }
        repondreJson(res, 200, { ok: true });
        return;
      }
      // ⚠️ PLAFOND ANTI-INONDATION PAR IP, EN DEUX SEAUX, ET VÉRIFIÉ AVANT DE LIRE LE LIEN (P1
      // performance + P1b audit 5.6). Deux corrections à l'origine SESSION_QUOTA-pour-tout :
      //   • DEUX SEAUX. La session est un `upsert` riche → `sess:`, quota dérivé des écritures de
      //     session. open/page/heartbeat sont un `logView` bien meilleur marché → `view:`, leur
      //     propre quota. Les garder ensemble faisait vider le quota des sessions par les open/page :
      //     25 lecteurs derrière une IP le dépassaient avant même d'avoir écrit une session.
      //   • QUOTA AVANT LA LECTURE DU LIEN. `getShareBySlug` est une lecture base ; la placer avant
      //     le quota faisait payer une lecture à CHAQUE requête, y compris hors quota — exactement ce
      //     qu'un plafond anti-inondation doit éviter. On tranche d'abord, on lit ensuite.
      // Dépassé : on n'écrit pas, on ne lit pas le lien — mais on répond 200 (une mesure ne casse pas
      // une lecture). La lecture de TEST reste exemptée d'ÉCRITURE, pas de quota (rare, interne).
      const ipTrack = ip0 || "anon";
      const estSession = body.event === "session";
      const cleQuota = estSession ? `sess:${ipTrack}` : `view:${ipTrack}`;
      const quotaTrack = estSession ? SESSION_QUOTA_PER_HOUR : VIEW_QUOTA_PER_HOUR;
      if (!(await PLAYER.limits.allow(cleQuota, quotaTrack, 3600))) {
        // ⚠️ UN REFUS MUET EST UNE TABLE QUI NE MONTE PAS SANS CAUSE NOMMÉE. Une fois par heure et
        // par classe, on NOMME l'abandon (`abandon: true`) — c'est le signal d'abandon de télémétrie
        // que l'exploitant peut relier à un quota, plutôt qu'une mesure qui stagne sans explication.
        try {
          const avert = estSession ? "sess:quota-avert" : "view:quota-avert";
          if (await PLAYER.limits.allow(avert, 1, 3600)) PLAYER.errors.capture(new Error(`télémétrie externe abandonnée (${body.event}) : quota horaire atteint (${quotaTrack}/h par adresse)`), { route: "track", abandon: true });
        } catch { /* jamais bloquant */ }
        repondreJson(res, 200, { ok: true });
        return;
      }
      const share = await getShareBySlug(body.slug || slug);
      if (share && !share.is_test) { // répétition générale : la lecture de test ne compte pas dans les stats
        try {
          // 'session' = résumé riche (temps par page, appareil) → upsert ; open/page/heartbeat → journal léger (funnel/overview).
          if (estSession) await upsertSession(share, { sessionId: body.sessionId, numPages: body.numPages, maxPage: body.maxPage, totalSeconds: body.totalSeconds, pagesTime: body.pagesTime }, { ip: ip0, ua: ua0 });
          else await logView(share, { event: body.event, page: body.page, maxPage: body.maxPage, seconds: body.seconds, sessionId: body.sessionId, ua: ua0 });
        } catch (e) {
          // ⚠️ LE MÊME `catch` MUET, SUR LE CHEMIN EXTERNE. Trouvé par la garde écrite pour
          // l'interne : une fois la règle devenue un test, elle a désigné son jumeau.
          //
          // Celui-ci n'a rien cassé jusqu'ici — la table des sessions externes a bien les colonnes
          // qu'on lui envoie. Mais il aurait avalé le prochain écart de la même façon, et personne
          // n'aurait rien vu : c'est ce qui rend la classe dangereuse, pas l'instance.
          try {
            if (await PLAYER.limits.allow("sess:echec", 1, 3600)) {
              PLAYER.errors.capture(new Error(`écriture de mesure refusée : ${e && e.message ? e.message : "cause inconnue"} — la lecture n'est pas comptée`), { route: "track" });
            }
          } catch { /* un journal ne doit jamais empêcher une lecture */ }
        }
      }
      repondreJson(res, 200, { ok: true });
      return;
  // ⚠️ PAS de `return false` ici : le bloc ci-dessus est le repli ANALYTIQUE (open/page/heartbeat/
  // session). Une action inconnue N'Y ARRIVE PLUS — elle est refusée en 400 unknown-action au
  // début de ce repli (neuvième audit : le commentaire disait encore « finit ok:true », c'était
  // faux depuis le huitième). Cette famille répond donc toujours pour un événement valide, et doit
  // rester la DERNIÈRE du dispatch (handler le dit aussi).
}

module.exports = { init, traiter };
