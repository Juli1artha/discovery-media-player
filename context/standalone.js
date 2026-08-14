// CONTEXTE PAR DÉFAUT — de quoi faire tourner une instance sans écrire une ligne.
//
// L'architecture veut qu'un hôte écrive son câblage : c'est ce qui lui permet de brancher SON
// modèle de droits, SA base, SA marque. Mais exiger ce fichier avant le premier document rendrait
// le projet inessayable — et « inessayable » est la façon la plus sûre de n'être jamais essayé.
//
// Ce contexte-ci couvre le cas courant à partir de variables d'environnement seules :
//   • un dossier de documents (`PLAYER_LOCAL_ROOT`) ou un Storage Supabase ;
//   • une base Supabase pour les liens tracés et les présentations — FACULTATIVE ;
//   • les décisions propres à l'hôte (qui a le droit de diffuser, quelle marque pour quel client)
//     déléguées à des routes de l'hôte, ou refusées si elles ne sont pas configurées.
//
// ⚠️ Il ne remplace pas un câblage : il ne sait rien de vos rôles. Ce qu'il ne sait pas, il le
// REFUSE — jamais il n'accorde par défaut. Cf. docs/CONFIGURATION.md, « Decisions that are yours ».

const crypto = require("node:crypto");
const storage = require("./storage");

/**
 * Retire les barres finales d'une base d'URL.
 *
 * Sans expression régulière. L'analyse statique a signalé `.replace(/\/+$/, "")` dès son premier
 * passage, sur les deux lignes que je venais d'écrire.
 *
 * Mesuré avant de corriger : V8 traite ce motif en temps linéaire (200 000 barres, moins d'une
 * milliseconde), et l'entrée vient de toute façon d'une variable d'environnement — donc de
 * l'exploitant, pas d'un visiteur. Ce n'était donc PAS une lenteur réelle ici.
 *
 * ⚠️ On change quand même, pour une raison qui n'est pas celle de l'alerte : cette forme se
 * recopie. Elle est déjà à cinq endroits du dépôt, et la prochaine copie tombera peut-être sur
 * une entrée venue du dehors, dans un moteur moins clément. Une boucle qui ne peut pas revenir en
 * arrière retire la classe, pas l'occurrence — et évite d'apprendre à ignorer l'alerte.
 */
function sansBarreFinale(valeur) {
  const s = String(valeur || "");
  let fin = s.length;
  while (fin > 0 && s.charCodeAt(fin - 1) === 47) fin--;
  return s.slice(0, fin);
}

/** Client REST minimal (PostgREST). Absent de configuration ⇒ chaque appel échoue franchement. */
function creerDb(env) {
  const url = sansBarreFinale(env.SUPABASE_URL);
  const cle = String(env.SUPABASE_SERVICE_ROLE_KEY || "");

  async function request(chemin, options = {}) {
    if (!url || !cle) {
      // Message explicite plutôt que `undefined` plus loin : sans base, ce sont les liens tracés
      // et les présentations qui sont indisponibles — pas l'affichage d'un document.
      throw new Error(
        "Base non configurée : SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis pour les " +
        "liens tracés et les présentations. L'aperçu de documents fonctionne sans.",
      );
    }
    const methode = String(options.method || "GET").toUpperCase();
    const r = await fetch(`${url}/rest/v1/${chemin}`, {
      method: methode,
      headers: {
        apikey: cle,
        Authorization: `Bearer ${cle}`,
        "Content-Type": "application/json",
        ...(options.headers || {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
    });
    if (!r.ok) throw new Error(`Supabase ${methode} ${chemin} → ${r.status}`);
    const texte = await r.text();
    return texte ? JSON.parse(texte) : null;
  }

  /** Lecture paginée complète : un document très partagé dépasse la pagination par défaut. */
  async function selectAll(chemin, taille = 1000) {
    const tout = [];
    for (let debut = 0; ; debut += taille) {
      const lot = await request(chemin, { headers: { Range: `${debut}-${debut + taille - 1}` } });
      if (!Array.isArray(lot) || !lot.length) return tout;
      tout.push(...lot);
      if (lot.length < taille) return tout;
    }
  }

  return { request, selectAll, configuree: !!(url && cle) };
}

/**
 * Appel d'une route de l'HÔTE (autorisation, marque). Authentifié par le même secret partagé que
 * la route de fichiers, et **jamais en query** : les journaux gardent les URL.
 */
async function appelHote(url, secret, corps, errors) {
  if (!url) return null;
  // ⚠️ UN REFUS ET UNE PANNE NE DOIVENT PAS SE RESSEMBLER. Le player reste fail-closed — hôte
  // injoignable ⇒ personne ne diffuse — mais sans trace, « ma route répond mal » est
  // indiscernable de « le droit est refusé », et on cherche pendant une demi-journée du côté des
  // rôles. Un hôte qui a écrit sa route sur la description du contrat plutôt que sur le code a
  // perdu exactement ce temps-là.
  const signaler = (quoi) => { try { errors && errors.capture(new Error(`route hôte : ${quoi}`), { url }); } catch { /* jamais bloquant */ } };
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(secret ? { "x-player-fetch-secret": secret } : {}),
      },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(4000), // une décision qui tarde est une décision absente
    });
    if (!r.ok) { signaler(`réponse ${r.status}`); return null; }
    const d = await r.json().catch(() => null);
    if (!d || typeof d !== "object") { signaler("réponse illisible (JSON attendu)"); return null; }
    return d;
  } catch (e) {
    signaler(e && e.name === "TimeoutError" ? "délai dépassé" : "injoignable");
    return null;
  }
}

/**
 * Limites en mémoire, PAR PROCESSUS.
 *
 * ⚠️ Honnête sur ce que c'est : derrière plusieurs instances, chacune compte les siennes — la
 * limite réelle est donc N fois celle annoncée. C'est suffisant pour freiner une boucle, pas pour
 * contenir un attaquant déterminé. Un hôte sérieux branche un compteur partagé dans son câblage.
 */
function creerLimites() {
  const seaux = new Map();
  return {
    async allow(cle, max, fenetreSecondes) {
      const maintenant = Date.now();
      const debut = maintenant - fenetreSecondes * 1000;
      const vus = (seaux.get(cle) || []).filter((t) => t > debut);
      if (vus.length >= max) { seaux.set(cle, vus); return false; }
      vus.push(maintenant);
      seaux.set(cle, vus);
      if (seaux.size > 5000) for (const [k, v] of seaux) if (!v.some((t) => t > debut)) seaux.delete(k);
      return true;
    },
  };
}

/** Construit le contexte d'une instance autonome à partir de l'environnement. */
function createStandaloneContext(env = process.env) {
  const db = creerDb(env);
  const journal = {
    async capture(error, meta) {
      console.error("[player]", (meta && meta.route) || "", (error && error.message) || error, meta && meta.url ? `→ ${meta.url}` : "");
    },
  };
  const secret = String(env.PLAYER_HOST_FETCH_SECRET || "");
  const origins = () => storage.storageOrigins(env);
  const hostBase = () => storage.hostFetchBase(env);
  const root = () => storage.localRoot(env);

  return {
    // Aucun greffon : l'assistant IA, l'intro de marque et les comptes visiteurs sont des produits
    // d'un hôte particulier. Le cœur affiche, trace et présente sans eux — c'est testé.
    plugins: {},
    has() { return false; },

    storage: {
      get allowedOrigins() { return origins(); },
      get hostFetchBase() { return hostBase(); },
      isAllowedUrl: (url) => storage.isAllowedStorageUrl(url, origins(), hostBase(), root()),
      fetchFile: (url, options) => storage.fetchAllowedFile(url, options, {
        origins: origins(), hostBase: hostBase(), root: root(), secret,
      }),
      // Écriture de fichier : hors périmètre d'une instance autonome (elle sert, elle ne range pas).
      async put() { throw new Error("storage.put n'est pas disponible sans câblage d'hôte"); },

      /**
       * URL d'envoi signée, pour une pièce jointe de chat. **Capacité de l'HÔTE**, pas du cœur.
       *
       * ⚠️ Le cœur lisait `SUPABASE_SERVICE_ROLE_KEY` directement dans l'environnement — la clé
       * qui ouvre toute la base, lue en contournant le contexte injecté, c'est-à-dire en violant
       * la règle que le projet affiche partout ailleurs. Un hôte qui branche SA base se faisait
       * court-circuiter ici sans que rien ne le signale.
       *
       * ⚠️ Honnête sur ce qui reste : la page renvoyée appelle `uploadToSignedUrl` de supabase-js.
       * Cette capacité retire le secret du cœur ; elle ne rend pas la fonction portable pour
       * autant. Un hôte sur une autre pile devra aussi remplacer la moitié navigateur.
       */
      async signUpload(bucket, chemin) {
        const base = sansBarreFinale(env.SUPABASE_URL);
        const cle = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
        if (!base || !cle || !bucket || !chemin) return null;
        try {
          const r = await fetch(`${base}/storage/v1/object/upload/sign/${bucket}/${chemin}`, {
            method: "POST",
            headers: { apikey: cle, Authorization: `Bearer ${cle}`, "Content-Type": "application/json" },
            body: "{}",
          });
          if (!r.ok) return null;
          const d = await r.json().catch(() => null);
          const url = d && d.url;
          if (!url) return null;
          return {
            token: (String(url).split("token=")[1] || "").split("&")[0],
            publicUrl: `${base}/storage/v1/object/public/${bucket}/${chemin}`,
          };
        } catch { return null; }
      },
    },

    db: { request: db.request, selectAll: db.selectAll },

    // Sans expéditeur configuré, le re-partage et le code du mur d'accès sont indisponibles — et
    // le disent. Ils ne prétendent pas avoir envoyé.
    /**
     * Envoi d'email : capacité de l'HÔTE. Sans route configurée, le player ne prétend pas avoir
     * envoyé — il rend `null`, et l'interface dit « envoi indisponible ».
     *
     * ⚠️ UN SECRET À LUI, ET C'EST UN ARBITRAGE ASSUMÉ. Le troisième, donc l'inflation est réelle.
     * Mais `PLAYER_HOST_FETCH_SECRET` part vers l'hôte à CHAQUE fichier ouvert : il vit dans ses
     * journaux d'accès à raison de plusieurs entrées par lecture. Lui ajouter le pouvoir de faire
     * partir du courrier au nom de l'hôte élargirait énormément ce qu'une fuite de journaux
     * permettrait — et une réputation d'expéditeur perdue met des semaines à revenir. Répondre à
     * une question et agir vers le dehors ne sont pas le même pouvoir, même dans la même
     * direction.
     *
     * La charge utile porte les champs STRUCTURÉS en plus du HTML : un hôte qui compose lui-même
     * (gabarit à sa marque, aucun texte venu de l'appelant) a tout ce qu'il lui faut sans avoir à
     * découper le nôtre.
     */
    mail: {
      async send(message) {
        const url = String(env.PLAYER_HOST_MAIL_URL || "").trim();
        const secret = String(env.PLAYER_HOST_MAIL_SECRET || "");
        if (!url) return null;
        if (!secret) {
          try { journal.capture(new Error("PLAYER_HOST_MAIL_URL est configurée sans PLAYER_HOST_MAIL_SECRET : aucun envoi ne partira"), {}); } catch { /* ignore */ }
          return null;
        }
        const reponse = await appelHote(url, secret, message, journal);
        return reponse && reponse.sent === true ? { sent: true } : null;
      },
    },

    identity: {
      /**
       * Vérifie un jeton auprès de Supabase Auth. Sans émetteur : personne n'est authentifié.
       *
       * ⚠️ LA BASE DU PLAYER ET L'ÉMETTEUR DES JETONS SONT DEUX CHOSES DIFFÉRENTES.
       *
       * `SUPABASE_URL` servait les deux rôles. Vrai tant que le player et son application
       * partagent un déploiement — et faux par construction dès qu'une instance est séparée : la
       * base appartient au player, l'identité appartient à l'hôte. Les membres de l'hôte
       * recevaient donc des jetons émis par un projet, vérifiés contre un autre : toute la moitié
       * « membre » de la surface (diffusion, statistiques, présentations authentifiées) était
       * hors d'atteinte. Signalé par le second hôte, c'est la troisième hypothèse de cette forme
       * en deux jours — elles ne se voient qu'en exerçant la séparation.
       *
       * `PLAYER_AUTH_URL` désigne donc l'émetteur, et `SUPABASE_URL` reste la base. Absente, on
       * retombe sur `SUPABASE_URL` : une instance où les deux coïncident ne change pas d'un
       * caractère.
       *
       * ⚠️ ET LA CLÉ NE RETOMBE PAS, ELLE. Le repli historique allait jusqu'à
       * `SUPABASE_SERVICE_ROLE_KEY` — la clé maîtresse de NOTRE base. Tant que l'émetteur était
       * notre propre projet, c'était sans conséquence ; vers un émetteur tiers, ce serait
       * l'envoyer à un serveur qui n'a rien à en faire. Un émetteur distinct exige donc sa propre
       * clé publiable, et son absence se dit au lieu de se replier.
       */
      async verifyToken(authorization) {
        const jeton = String(authorization || "").replace(/^Bearer\s+/i, "").trim();
        const emetteur = sansBarreFinale(env.PLAYER_AUTH_URL);
        const base = sansBarreFinale(env.SUPABASE_URL);

        const url = emetteur || base;
        const cle = emetteur
          ? String(env.PLAYER_AUTH_KEY || "")
          : String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");

        if (emetteur && !cle) {
          // Le refus silencieux est le piège de cette configuration : sans clé, chaque membre est
          // simplement « non authentifié », ce qui ressemble à un droit manquant. On le dit.
          try { journal.capture(new Error("PLAYER_AUTH_URL est configurée sans PLAYER_AUTH_KEY : aucun jeton ne peut être vérifié"), {}); } catch { /* ignore */ }
        }
        if (!jeton || !url || !cle) return null;
        try {
          const r = await fetch(`${url}/auth/v1/user`, {
            headers: { apikey: cle, Authorization: `Bearer ${jeton}` },
          });
          return r.ok ? await r.json() : null;
        } catch { return null; }
      },
      /**
       * Cet appel vient-il de l'HÔTE lui-même, et non d'un de ses membres ?
       *
       * ⚠️ UN SECRET DISTINCT DE `PLAYER_HOST_FETCH_SECRET`, ET C'EST LE POINT. Celui-là ne
       * circule QUE dans un sens — le player l'envoie à l'hôte, à chaque fichier. Il traîne donc
       * dans les journaux d'accès de l'hôte, ses proxys, son traceur d'erreurs. Aujourd'hui, qui
       * l'obtient peut se faire passer pour le player AUPRÈS de l'hôte. L'accepter en entrée lui
       * ajouterait le droit d'écrire ICI — créer des liens tracés qui collecteront des lectures.
       * Une variable de plus contre un rayon d'explosion qui ne grandit pas : un secret ne suit
       * ni un changement de destinataire, ni un changement de direction.
       *
       * ⚠️ Le cœur ne voit jamais le secret : il pose une QUESTION, l'adaptateur répond oui ou
       * non. Non configuré ⇒ non — un pouvoir qu'on ne sait pas accorder ne s'accorde pas.
       */
      isTrustedHostCall(headers) {
        const attendu = String(env.PLAYER_HOST_SHARE_SECRET || "");
        const recu = String((headers && (headers["x-player-share-secret"] || headers["X-Player-Share-Secret"])) || "");
        if (!attendu || !recu) return false;
        // Comparaison à temps constant : une comparaison naïve fuit la longueur du préfixe commun.
        const a = Buffer.from(attendu, "utf8"); const b = Buffer.from(recu, "utf8");
        return a.length === b.length && crypto.timingSafeEqual(a, b);
      },

      /**
       * Qui appelle ? **La socket, pas l'en-tête** — sauf si l'exploitant déclare son proxy.
       *
       * ⚠️ `X-Forwarded-For` est une affirmation du client. Toutes les limites de débit s'y
       * appuyaient : un appelant direct — le cas du serveur autonome — en changeait à chaque
       * requête et n'était jamais limité. La limite existait, elle ne limitait rien.
       *
       * `PLAYER_TRUSTED_PROXY_HOPS=1` dit « il y a UN proxy devant moi, sa dernière valeur ajoutée
       * est l'IP réelle ». On lit alors depuis la FIN de la chaîne, pas depuis le début : le début
       * est ce que le client a écrit, la fin est ce que les proxys ont constaté. C'est l'inverse
       * de ce que faisait le code, et c'est l'erreur classique sur cet en-tête.
       *
       * Non configuré ⇒ l'en-tête est ignoré. Un hôte sans proxy est protégé sans rien faire.
       */
      clientIp(req) {
        const sauts = Math.max(0, Math.min(10, Number(env.PLAYER_TRUSTED_PROXY_HOPS || 0) || 0));
        const socket = String((req && req.socket && req.socket.remoteAddress) || "");
        if (!sauts) return socket;
        const chaine = String((req && req.headers && req.headers["x-forwarded-for"]) || "")
          .split(",").map((v) => v.trim()).filter(Boolean);
        if (!chaine.length) return socket;
        // Le proxy le plus proche a ajouté la dernière valeur : on remonte de `sauts` depuis la fin.
        const i = chaine.length - sauts;
        return chaine[i >= 0 ? i : 0] || socket;
      },

      /**
       * Vérifie un jeton de session INTERNE, émis par l'hôte pour son propre membre.
       *
       * ⚠️ POURQUOI DANS LE CORPS ET PAS EN EN-TÊTE. Le suivi de lecture part par `sendBeacon`,
       * seul transport qui survive à la fermeture d'un onglet — et il ne sait pas porter
       * d'en-tête. Exiger un JWT reviendrait à perdre la mesure au moment où elle compte le plus.
       *
       * Format : base64url(JSON) + "." + HMAC-SHA256 du même JSON, signé avec le secret que
       * l'hôte détient déjà. Charge utile : { email, name, docId, exp }.
       *
       * ⚠️ Comparaison à temps constant, et `exp` obligatoire : un jeton sans expiration signé une
       * fois vaudrait pour toujours, y compris après le départ du membre de l'entreprise.
       */
      verifyInternalToken(jeton) {
        const secret = String(env.PLAYER_HOST_FETCH_SECRET || "");
        const brut = String(jeton || "");
        if (!secret || !brut) return null;
        const sep = brut.lastIndexOf(".");
        if (sep <= 0) return null;
        const corps = brut.slice(0, sep);
        const signature = brut.slice(sep + 1);
        try {
          const attendue = crypto.createHmac("sha256", secret).update(corps).digest("base64url");
          const a = Buffer.from(attendue, "utf8"); const b = Buffer.from(signature, "utf8");
          if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
          const d = JSON.parse(Buffer.from(corps, "base64url").toString("utf8"));
          if (!d || typeof d !== "object") return null;
          if (!Number.isFinite(d.exp) || d.exp * 1000 < Date.now()) return null;
          if (!d.email || !d.docId) return null;
          return { email: String(d.email), name: d.name ? String(d.name) : "", docId: String(d.docId) };
        } catch { return null; }
      },

      // ⚠️ Le rôle vient d'`app_metadata`, JAMAIS d'`user_metadata` : ce dernier est modifiable par
      // l'utilisateur lui-même. S'y fier revient à laisser chacun choisir ses droits.
      roleOf: (user) => String(((user || {}).app_metadata || {}).role || "").trim().toLowerCase(),
      isAdmin: (user) => String(((user || {}).app_metadata || {}).role || "").toLowerCase() === "admin",

      /**
       * Qui a le droit de diffuser un document ? **Question de l'hôte, pas du player.**
       * Sans `PLAYER_HOST_AUTHZ_URL`, la réponse est non. Un droit qu'on ne sait pas accorder ne
       * s'accorde pas — c'est la seule position tenable pour un défaut.
       */
      async canManageShares(user, action) {
        if (!user || !user.email) return false;
        const reponse = await appelHote(env.PLAYER_HOST_AUTHZ_URL, secret, {
          email: user.email, role: ((user.app_metadata || {}).role) || "", action: String(action || ""),
        }, journal);
        // ⚠️ `allowed` doit être présent ET booléen. Une réponse d'une autre forme — même
        // parfaitement intentionnée — vaut refus, et le dit. C'est le cas le plus courant au
        // branchement d'un nouvel hôte.
        if (reponse && typeof reponse.allowed !== "boolean") {
          try { journal.capture(new Error("route d'autorisation : champ `allowed` booléen attendu"), { recu: Object.keys(reponse).join(",") }); } catch { /* ignore */ }
        }
        return reponse ? reponse.allowed === true : false;
      },
    },

    limits: creerLimites(),

    branding: {
      async logo() { return String(env.PLAYER_BRAND_LOGO || "").trim(); },
      get name() { return String(env.PLAYER_BRAND_NAME || "").trim(); },
      get poweredBy() { return String(env.PLAYER_BRAND_POWERED_BY || "").trim(); },
      get loaderName() { return String(env.PLAYER_LOADER_NAME || env.PLAYER_BRAND_NAME || "").trim(); },

      /**
       * Marque d'un CLIENT, résolue à l'affichage à partir d'une clé portée par le lien — jamais
       * recopiée dans le lien. Un lien tracé vit des semaines dans une boîte mail : un logo figé à
       * l'envoi ne suivrait pas une charte corrigée.
       *
       * `name` n'est pas décoratif : c'est ce qui s'affiche quand le logo ne charge pas.
       */
      async forKey(key) {
        if (!key) return null;
        const b = await appelHote(env.PLAYER_HOST_BRAND_URL, secret, { key: String(key) }, journal);
        return b && b.logo ? { logo: String(b.logo), name: String(b.name || ""), dark: !!b.dark } : null;
      },

      title(base, qualificatif) {
        const suffixe = [String(qualificatif || "").trim(), String(env.PLAYER_BRAND_NAME || "").trim()]
          .filter(Boolean).join(" ");
        return suffixe ? `${base} — ${suffixe}` : base;
      },
    },

    errors: journal,

    legal: {
      /**
       * L'URL PUBLIQUE de cette instance, telle que l'exploitant l'a écrite.
       *
       * ⚠️ Sert à fabriquer les liens qui partent par email. L'en-tête `Host` ne convient pas :
       * il est choisi par le client, donc un lecteur pouvait faire envoyer un message signé de
       * l'hôte dont le bouton pointe ailleurs. Vide ⇒ repli sur `Host`, mais signalé.
       */
      get publicUrl() {
        const v = sansBarreFinale(env.PLAYER_PUBLIC_URL).trim();
        return v.startsWith("https://") ? v : "";
      },

      get sourceUrl() { return String(env.PLAYER_SOURCE_URL || "https://github.com/Juli1artha/discovery-media-player").trim(); },
      get legalUrl() { return String(env.PLAYER_LEGAL_URL || "").trim(); },
      get privacyUrl() { return String(env.PLAYER_PRIVACY_URL || "").trim(); },
      /**
       * ⚠️ Mention d'un lien que PERSONNE n'a envoyé — plaquette publique ouverte depuis une carte.
       * Parler d'« expéditeur » y serait faux, et c'est la seule phrase du produit dont l'objet
       * est d'être exacte. Le player choisit d'après le lien lui-même : ni destinataire, ni
       * créateur.
       */
      get trackingNoticeAnonymous() {
        const perso = String(env.PLAYER_TRACKING_NOTICE_ANON || "").trim();
        return perso || "La consultation de ce document est mesurée (pages vues, temps de lecture).";
      },

      get trackingNotice() {
        const perso = String(env.PLAYER_TRACKING_NOTICE || "").trim();
        return perso || "La consultation de ce document est mesurée (pages vues, temps de lecture) et transmise à son expéditeur.";
      },
    },

    config: {
      // Sans barre finale : le cœur consomme cette valeur telle quelle. Un seul endroit décide.
      supabaseUrl: sansBarreFinale(env.SUPABASE_URL),
      supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || "",
      mapsKey: env.GOOGLE_MAPS_API_KEY || "",
      extraFrameAncestors: String(env.DOC_FRAME_ANCESTORS || "").split(/\s+/).filter(Boolean),
      // ⚠️ Un BOOLÉEN, jamais l'URL. La carte d'identité doit pouvoir dire « un émetteur distinct
      // est configuré » sans dire lequel : c'est le dernier endroit où un hôte devait deviner.
      // `host-auth` dit que le code SAIT faire la séparation ; ceci dit qu'elle est POSÉE. Sans
      // les deux, une variable oubliée redonne exactement le symptôme que 0.1.8 a retiré — des
      // membres « non authentifiés », ce qui ressemble à un droit manquant.
      separateIssuer: !!sansBarreFinale(env.PLAYER_AUTH_URL),
      // Même raison que ci-dessus : « la capacité existe » et « elle est configurée »
      // sont deux questions, et seule la seconde explique un refus.
      hostShare: !!String(env.PLAYER_HOST_SHARE_SECRET || ""),
      hostMail: !!String(env.PLAYER_HOST_MAIL_URL || "").trim(),
      // Porte fermée : sans jeton de l'hôte, aucune session interne n'est écrite.
      internalStrict: String(env.PLAYER_INTERNAL_STRICT || "") === "1",
    },
  };
}

module.exports = { createStandaloneContext };
