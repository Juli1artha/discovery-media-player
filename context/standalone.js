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
// REFUSE — jamais il n'accorde par défaut. Cf. CONTRAT.md, « Le câblage d'une instance ».

const storage = require("./storage");

/** Client REST minimal (PostgREST). Absent de configuration ⇒ chaque appel échoue franchement. */
function creerDb(env) {
  const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
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
    },

    db: { request: db.request, selectAll: db.selectAll },

    // Sans expéditeur configuré, le re-partage et le code du mur d'accès sont indisponibles — et
    // le disent. Ils ne prétendent pas avoir envoyé.
    mail: { async send() { return null; } },

    identity: {
      /** Vérifie un jeton auprès de Supabase Auth. Sans base : personne n'est authentifié. */
      async verifyToken(authorization) {
        const jeton = String(authorization || "").replace(/^Bearer\s+/i, "").trim();
        const url = String(env.SUPABASE_URL || "").replace(/\/+$/, "");
        const cle = String(env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_SERVICE_ROLE_KEY || "");
        if (!jeton || !url || !cle) return null;
        try {
          const r = await fetch(`${url}/auth/v1/user`, {
            headers: { apikey: cle, Authorization: `Bearer ${jeton}` },
          });
          return r.ok ? await r.json() : null;
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
      get sourceUrl() { return String(env.PLAYER_SOURCE_URL || "https://github.com/Juli1artha/discovery-media-player").trim(); },
      get legalUrl() { return String(env.PLAYER_LEGAL_URL || "").trim(); },
      get privacyUrl() { return String(env.PLAYER_PRIVACY_URL || "").trim(); },
      get trackingNotice() {
        const perso = String(env.PLAYER_TRACKING_NOTICE || "").trim();
        return perso || "La consultation de ce document est mesurée (pages vues, temps de lecture) et transmise à son expéditeur.";
      },
    },

    config: {
      supabaseUrl: env.SUPABASE_URL || "",
      supabasePublishableKey: env.SUPABASE_PUBLISHABLE_KEY || "",
      mapsKey: env.GOOGLE_MAPS_API_KEY || "",
      extraFrameAncestors: String(env.DOC_FRAME_ANCESTORS || "").split(/\s+/).filter(Boolean),
    },
  };
}

module.exports = { createStandaloneContext };
