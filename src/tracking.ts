// Suivi de lecture d'un document : temps réellement passé PAR PAGE, page la plus loin atteinte,
// durée totale. C'est la matière première de tout ce que l'application affiche ensuite (entonnoir
// de lecture, donut de progression, graphe temps/page, classement des lecteurs).
//
// La règle qui fait la valeur de la mesure : on ne compte QUE le temps « réel à l'écran ».
// L'onglet doit être visible, la fenêtre avoir le focus, et l'utilisateur ne pas être inactif.
// Sans ces trois conditions, un document laissé ouvert dans un onglet oublié accumulerait des
// heures de lecture et rendrait toutes les statistiques mensongères.
//
// DEUX POPULATIONS, JAMAIS MÉLANGÉES :
//   - lien tracé public (`slug`)  → événements `open`/`page` + session prospect
//   - aperçu interne équipe (`internal`) → session interne SEULEMENT, aucun `open`/`page`
// Un aperçu interne qui journaliserait un `open` gonflerait l'entonnoir du prospect et ferait
// croire à une lecture qui n'a pas eu lieu. Cette séparation est testée.

/** Transport d'un événement. Injectable pour les tests ; par défaut `sendBeacon`, repli `fetch`. */
import { SESSION_IDLE_MS, SESSION_INTERVAL_MS } from "./cadence";

// ⚠️ Le transport signale un ÉCHEC en rendant exactement `false` (sendBeacon file pleine, exception).
// Toute autre valeur — `void`, `true`, ou même le retour fortuit d'un `Array.push` — vaut « parti, ou
// on n'en sait rien » → succès. Le type reste donc permissif (`unknown`) pour ne rien imposer aux
// transports existants ; seule la comparaison `=== false` porte le sens.
export type TrackerTransport = (payload: Record<string, unknown>) => unknown;

export interface TrackerOptions {
  /** Lien tracé public. Absent en aperçu interne. */
  slug?: string | null;
  /** Aperçu interne équipe. Exclusif du `slug`. */
  /**
   * Aperçu interne : qui lit, et la PREUVE que l'hôte en donne.
   *
   * ⚠️ `it` est le jeton signé par l'hôte (0.1.22). Sans lui, le serveur retombe sur ce que le
   * navigateur affirme et le signale — et `PLAYER_INTERNAL_STRICT=1` refuse la session. Le verrou
   * existait depuis 0.1.22 ; ce champ est la serrure, qui manquait.
   */
  internal?: { docId?: string; email?: string; name?: string; it?: string } | null;
  /** Route d'ingestion des événements. */
  endpoint?: string;
  /** Sans interaction pendant ce délai, le chrono se met en pause. */
  /**
   * Au bout de combien de temps sans la moindre interaction cesse-t-on de compter ?
   *
   * ⚠️ DEPUIS LE RETRAIT DE `hasFocus()`, CE SEUIL EST SEUL À DISTINGUER un lecteur d'un onglet
   * oublié. Il porte donc plus qu'avant : un document lu passivement — affiché pendant qu'on en
   * parle au téléphone — compte au plus `idleMs`, puisqu'il ne produit aucun événement.
   *
   * ⚠️ TROIS MINUTES, ET LE CHIFFRE VIENT D'UNE ASYMÉTRIE, PAS D'UN CONFORT.
   *
   * 60 s comptait un lecteur attentif comme absent : une page dense — notice, contrat — se lit une
   * à trois minutes sans un mouvement de souris. Le second hôte proposait trois à cinq.
   *
   * On prend le BAS de la fourchette, parce que les deux erreurs ne coûtent pas la même chose :
   *
   *   sous-compter une vraie lecture ⇒ on rappelle un client qui avait lu. Désagréable, sans suite.
   *   sur-compter un onglet abandonné ⇒ on dit « il a lu son contrat vingt minutes » à un
   *   commercial qui s'en servira pour relancer sur le prix. Une décision prise sur une fiction.
   *
   * ⚠️ Et ce seuil n'arbitre plus seul : depuis que tourner une page compte comme une activité,
   * il ne tranche que les SILENCES. Un lecteur réel tourne des pages ; un onglet oublié n'en tourne
   * aucune.
   *
   * ⚠️ NE PAS FONDRE LES DEUX MESURES. La table porte déjà `last_at − started_at` (la PRÉSENCE) et
   * `total_seconds` (l'ACTIVITÉ). Un contrat parcouru trente secondes et un contrat ouvert vingt
   * minutes sur un second écran sont deux faits différents : les ramener à un seul nombre en perd
   * un. Que celui qui lit les statistiques choisisse. (formulation du second hôte)
   */
  idleMs?: number;
  /** Cadence de persistance de la session (filet si l'onglet meurt sans prévenir). */
  sessionEveryMs?: number;
  /** Surface de défilement du document — son scroll compte comme une interaction. */
  scrollElement?: { addEventListener: EventTarget["addEventListener"]; removeEventListener: EventTarget["removeEventListener"] } | null;
  now?: () => number;
  doc?: Document;
  win?: Window;
  send?: TrackerTransport;
  sessionId?: string;
}

export interface Tracker {
  /** Journalise l'ouverture et met le suivi en marche. */
  start(): void;
  /** La page à l'écran a changé. */
  setPage(page: number): void;
  /** Le document a fini de charger : nombre total de pages. */
  setPageCount(count: number): void;
  /** Une interaction a eu lieu sur une surface que le suivi n'observe pas lui-même. */
  noteActivity(): void;
  /** Persiste la session immédiatement. */
  flush(): void;
  /** Retire tous les écouteurs et minuteries. */
  stop(): void;
  readonly sessionId: string;
  totalSeconds(): number;
  maxPage(): number;
  /** Temps par page, en secondes entières — la forme envoyée au serveur. */
  pageTimes(): Record<string, number>;
}

const ACTIVITY_EVENTS = ["mousemove", "mousedown", "keydown", "wheel", "touchstart", "pointerdown"] as const;

function defaultSessionId(): string {
  // ⚠️ Cet identifiant est la CLÉ d'upsert de la session côté serveur : qui en devine un écrase la
  // mesure de quelqu'un d'autre. Ce n'est pas un jeton d'autorisation, mais ce n'est pas non plus
  // un simple compteur — et le coût d'une valeur imprévisible est nul.
  const c = typeof globalThis !== "undefined" ? (globalThis as { crypto?: Crypto }).crypto : undefined;
  if (c && typeof c.randomUUID === "function") return c.randomUUID().replace(/-/g, "");
  if (c && typeof c.getRandomValues === "function") {
    const o = c.getRandomValues(new Uint8Array(16));
    return Array.from(o, (v) => v.toString(16).padStart(2, "0")).join("");
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** `sendBeacon` d'abord : c'est le seul transport qui survive de façon fiable à la fermeture d'un onglet. */
function defaultTransport(endpoint: string, win: Window): TrackerTransport {
  return (payload) => {
    try {
      const body = JSON.stringify(payload);
      const nav = win.navigator;
      if (nav && typeof nav.sendBeacon === "function") {
        // sendBeacon rend `false` quand le navigateur REFUSE la mise en file (quota dépassé) : on le
        // propage tel quel pour que le traceur sache qu'il faudra réessayer.
        return nav.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      }
      win.fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        keepalive: true,
      });
      // fetch keepalive : on ne saura de l'échec qu'à la résolution, trop tard pour ce tick. On
      // considère l'envoi parti (best-effort) — c'est le comportement d'avant, préservé.
      return true;
    } catch { return false; /* le suivi ne doit jamais empêcher de lire le document */ }
  };
}

export function createTracker(options: TrackerOptions = {}): Tracker {
  const win = options.win || (typeof window !== "undefined" ? window : (null as unknown as Window));
  const doc = options.doc || (win && win.document);
  const now = options.now || (() => Date.now());
  const endpoint = options.endpoint || "/api/doc";
  const idleMs = options.idleMs ?? SESSION_IDLE_MS;
  const sessionEveryMs = options.sessionEveryMs ?? SESSION_INTERVAL_MS;
  const slug = options.slug || "";
  const internal = options.internal || null;
  const sessionId = options.sessionId || defaultSessionId();
  const send = options.send || defaultTransport(endpoint, win);

  const pageTimes: Record<number, number> = {};
  let activePage = 0;
  let current = 0;
  let furthest = 0;
  let pageCount = 0;
  // `activeSince === null` ⇒ chrono en pause.
  let activeSince: number | null = null;
  let lastActivity = now();
  let idle = false;
  let started = false;

  const cleanups: Array<() => void> = [];

  // Ni slug ni contexte interne : rien à rattacher, on n'envoie rien (aperçu d'un membre non identifié).
  const canReport = () => !!slug || !!internal;

  // Rend `true` si l'envoi est PARTI (ou supposé parti), `false` s'il a explicitement échoué. Le
  // suivi ne doit JAMAIS empêcher de lire le document : réseau coupé, `sendBeacon` refusé, transport
  // tiers qui lève — on perd la mesure de ce tick, jamais la lecture, et l'appelant décidera de
  // réessayer. Un `send` qui ne renvoie rien (`void`) est traité comme un succès (compat).
  const post = (payload: Record<string, unknown>): boolean => {
    if (!canReport()) return false;
    try { return send(payload) !== false; } catch { return false; }
  };

  /**
   * Le document est-il en train d'être LU ?
   *
   * ⚠️ `hasFocus()` A ÉTÉ RETIRÉ, ET C'EST LE FOND. Il mesure « l'utilisateur tape ici », pas
   * « l'utilisateur regarde ». Un lecteur sur double écran — document visible pendant quarante
   * secondes, mains sur l'autre écran — était compté DEUX SECONDES : la fenêtre n'était pas au
   * premier plan, donc `hasFocus()` faux, cadre ou pas cadre.
   *
   * ⚠️ Et ça ne touchait pas que la population interne : un prospect qui garde une plaquette
   * ouverte pendant qu'on lui en parle au téléphone est le cas d'usage CENTRAL d'un lien de
   * présentation, et il se mesurait comme une absence.
   *
   * `visibilityState` valait `visible` pendant tout ce temps. Le signal juste était disponible,
   * écrasé par une condition plus stricte qui répondait à une autre question.
   *
   * ⚠️ CE QUI RESTE, ET QUI EST VOULU : le seuil d'inactivité. C'est lui qui distingue un lecteur
   * d'un onglet oublié, et il est maintenant SEUL à le faire. Un document affiché sans aucune
   * interaction compte donc `idleMs` au plus — 3 minutes par défaut (SESSION_IDLE_MS ; ce commentaire a dit « 60 s » pendant que la constante disait 180 000 ms — cinquième audit). Mieux que zéro, moins qu'une
   * lecture réelle de dix minutes : voir la note d'`idleMs`, c'est une décision de mesure et pas
   * un défaut.
   *
   * Signalé par le second hôte, sur une lecture réelle : 26 s de présence pour 2 s comptées.
   */
  const viewable = () => !!doc && doc.visibilityState === "visible" && !idle;

  /**
   * Durée réellement lue depuis `activeSince`, PLAFONNÉE.
   *
   * ⚠️ LE TEMPS PEUT SAUTER SANS QU'AUCUN ÉVÉNEMENT NE PRÉVIENNE. Machine en veille, capot
   * rabattu, processus gelé : l'onglet reste `visible`, la fenêtre garde le focus, aucun
   * `visibilitychange` ni `blur` ne part — et les minuteries ne tournent pas non plus. Au réveil,
   * un delta brut versait la totalité du sommeil dans la page courante. Mesuré avant de corriger :
   * huit heures de veille rendaient **28 805 secondes de lecture**.
   *
   * C'est la même règle que la boucle d'inactivité, appliquée au cas où elle N'A PAS PU tourner :
   * on compte jusqu'à la dernière activité, plus le délai de grâce. Ni plus. Un utilisateur qui
   * lit vraiment produit des événements ; une machine endormie n'en produit aucun.
   *
   * Le suivi mesure une intention de lecture, pas une durée d'horloge. La confondre avec la
   * seconde rend le produit menteur exactement là où il prétend être exact.
   */
  const dureeLue = (depuis: number) => {
    const brut = now() - depuis;
    const plafond = Math.max(0, lastActivity - depuis) + idleMs;
    return Math.max(0, Math.min(brut, plafond));
  };

  const commit = () => {
    if (activeSince != null && activePage > 0) {
      pageTimes[activePage] = (pageTimes[activePage] || 0) + dureeLue(activeSince) / 1000;
    }
    activeSince = viewable() ? now() : null;
  };

  const pause = () => { commit(); activeSince = null; };
  const resume = () => { if (activeSince == null && viewable()) activeSince = now(); };

  const totalSeconds = () => {
    let s = 0;
    for (const k in pageTimes) s += pageTimes[k];
    if (activeSince != null) s += dureeLue(activeSince) / 1000;
    return Math.round(s);
  };

  const roundedPageTimes = () => {
    const out: Record<string, number> = {};
    for (const k in pageTimes) out[k] = Math.round(pageTimes[k]);
    return out;
  };

  const noteActivity = () => {
    lastActivity = now();
    if (idle) { idle = false; resume(); }
  };

  /** Événement léger (`open`/`page`) — prospects uniquement. */
  const track = (event: string, page?: number) => {
    if (internal) return;
    post({ slug, event, page: page || current, maxPage: furthest, seconds: totalSeconds(), sessionId });
  };

  // ⚠️ DRAPEAU « DIRTY » (P1 réduction de charge). Le filet périodique appelait `flush` à cadence
  // fixe et RÉÉMETTAIT une session identique à chaque tick — même pour un onglet caché ou un lecteur
  // inactif, dont la mesure ne bouge pas. Autant d'écritures base pour zéro information nouvelle.
  // La signature (temps total, page la plus loin, nombre de pages) capture TOUT changement réel :
  // le temps lu ne fait qu'augmenter, `furthest` ne fait que croître, `pageCount` est posé une fois.
  // Un simple retour en arrière sans temps écoulé laisse la signature inchangée — et il n'y a alors
  // rien de neuf à persister. On mémorise la dernière signature ENVOYÉE (pas seulement calculée) :
  // c'est l'écriture qu'on veut éviter de répéter.
  let derniereSignatureEnvoyee = "";
  const flush = () => {
    commit();
    const totalActuel = totalSeconds();
    const signature = `${totalActuel}|${furthest}|${pageCount}`;
    // Rien n'a changé depuis le dernier envoi → le filet ne paie pas une écriture pour rien.
    if (signature === derniereSignatureEnvoyee) return;
    const payload: Record<string, unknown> = {
      event: "session",
      sessionId,
      numPages: pageCount,
      maxPage: furthest,
      totalSeconds: totalActuel,
      pagesTime: roundedPageTimes(),
    };
    if (internal) {
      payload.internal = true;
      payload.docId = internal.docId;
      payload.email = internal.email;
      payload.name = internal.name;
      // La preuve voyage dans le CORPS : `sendBeacon` ne porte pas d'en-tête, et c'est lui qui
      // survit à la fermeture d'un onglet — donc à l'instant où la mesure compte le plus.
      if (internal.it) payload.it = internal.it;
    } else {
      payload.slug = slug;
    }
    // ⚠️ SIGNATURE RETENUE SEULEMENT SI L'ENVOI EST PARTI (P2 audit 5.6, ma régression de 0.1.85).
    // La retenir avant l'envoi verrouillait la mesure : un `post` raté (sendBeacon refusé, exception
    // avalée) faisait sauter le tick suivant à mesure identique — dernière mesure perdue si le
    // lecteur ferme après. Ratée → signature inchangée → le prochain tick réessaie.
    if (post(payload)) derniereSignatureEnvoyee = signature;
  };

  const on = (
    target: { addEventListener: (...a: never[]) => void; removeEventListener: (...a: never[]) => void } | null | undefined,
    type: string,
    handler: () => void,
    opts?: AddEventListenerOptions,
  ) => {
    // Environnement partiel (surface absente, contexte de test, navigateur bridé) : on se prive de
    // ce signal, on ne casse pas le reste. Même règle que partout ici — la mesure cède, pas la lecture.
    if (!target || typeof target.addEventListener !== "function") return;
    (target.addEventListener as unknown as (t: string, h: () => void, o?: AddEventListenerOptions) => void)(type, handler, opts);
    cleanups.push(() => {
      (target.removeEventListener as unknown as (t: string, h: () => void, o?: AddEventListenerOptions) => void)(type, handler, opts);
    });
  };

  return {
    sessionId,
    totalSeconds,
    maxPage: () => furthest,
    pageTimes: roundedPageTimes,

    start() {
      if (started) return;
      started = true;
      track("open", 1);
      activePage = 1;
      lastActivity = now();
      // ⚠️ ON N'AMORCE QUE SI C'EST VISIBLE. `start()` posait `activeSince` sans condition : un
      // document ouvert dans un onglet d'ARRIÈRE-PLAN — un lien cliqué avec Cmd, une restauration
      // de session — commençait à compter avant d'avoir été vu une seule fois, et le plafond
      // d'inactivité lui accordait quand même `idleMs`. Une minute de lecture pour un onglet
      // jamais regardé.
      //
      // `commit()` faisait déjà ce test ; `start()` ne le faisait pas. Trouvé par le test écrit
      // pour le cas du second écran — il cherchait autre chose.
      activeSince = viewable() ? now() : null;

      // Onglet caché → on met en pause ET on persiste : un onglet caché peut ne jamais revenir.
      on(doc, "visibilitychange", () => {
        if (doc.visibilityState === "hidden") { pause(); flush(); }
        else { noteActivity(); resume(); }
      });
      // ⚠️ PAS DE `blur` → `pause`, ET C'EST LA MOITIÉ MANQUANTE DE 0.1.39.
      //
      // 0.1.39 a retiré `hasFocus()` de `viewable()` pour qu'un document affiché sur un second
      // écran compte. Mais cette ligne-ci est restée, 170 lignes plus loin : cliquer sur la fenêtre
      // de l'autre écran déclenche `blur`, donc `pause()`, donc `activeSince = null`. Le correctif
      // était donc largement INOPÉRANT dans le cas exact qu'il visait.
      //
      // ⚠️ Et le test ne l'a pas vu parce que le banc ne déclenche jamais `blur` — troisième fois
      // dans la journée qu'un banc n'exerce pas la propriété qu'il décrit. Une garde vaut ce que
      // vaut son environnement d'exécution.
      //
      // Perdre le focus veut dire « une autre fenêtre est au premier plan », pas « ce document
      // n'est plus lu ». Ce qui dit qu'un document n'est plus regardé, c'est `visibilitychange` —
      // il est câblé juste au-dessus, et lui seul a cette autorité.
      //
      // Retrouver le focus reste une ACTIVITÉ : c'est un signe de vie, pas une condition de lecture.
      on(win, "focus", () => { noteActivity(); resume(); });
      for (const ev of ACTIVITY_EVENTS) on(win, ev, noteActivity, { passive: true });
      on(options.scrollElement, "scroll", noteActivity, { passive: true });
      on(win, "beforeunload", flush);

      const idleTimer = win.setInterval(() => {
        if (!idle && now() - lastActivity > idleMs) { idle = true; pause(); }
      }, 5000);
      const sessionTimer = win.setInterval(flush, sessionEveryMs);
      cleanups.push(() => { win.clearInterval(idleTimer); win.clearInterval(sessionTimer); });
    },

    setPage(page: number) {
      if (!page || page === current) return;
      // ⚠️ TOURNER UNE PAGE EST LA MEILLEURE PREUVE DE LECTURE QUI SOIT, et elle ne comptait pas.
      //
      // L'inactivité se mesurait sur des événements d'ENTRÉE — souris, clavier, molette, tactile.
      // Or un spectateur qui suit une présentation en direct ne touche rien : les pages tournent
      // devant lui, poussées par le présentateur. Il devenait inactif au bout d'une minute, alors
      // que la seule chose qui prouve qu'il regarde était en train de se produire.
      //
      // C'est aussi ce qui rend le seuil moins critique : un lecteur réel tourne des pages, un
      // onglet oublié n'en tourne aucune. Le seuil arbitre les silences, la page tranche le reste.
      //
      // Vu par le second hôte : « ce qui distingue vraiment une lecture d'un onglet oublié n'est
      // pas la durée, mais le fait de tourner une page ».
      lastActivity = now();
      commit();
      activePage = page;
      current = page;
      // Un `page` n'est journalisé qu'à la PREMIÈRE visite : l'entonnoir mesure la progression
      // dans le document, pas les allers-retours.
      if (page > furthest) { furthest = page; track("page", page); }
    },

    setPageCount(count: number) { pageCount = count || 0; },
    noteActivity,
    flush,

    stop() {
      while (cleanups.length) {
        const off = cleanups.pop();
        try { off?.(); } catch { /* cible déjà détruite */ }
      }
      started = false;
    },
  };
}
