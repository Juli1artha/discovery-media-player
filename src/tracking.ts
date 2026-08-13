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
export type TrackerTransport = (payload: Record<string, unknown>) => void;

export interface TrackerOptions {
  /** Lien tracé public. Absent en aperçu interne. */
  slug?: string | null;
  /** Aperçu interne équipe. Exclusif du `slug`. */
  internal?: { docId?: string; email?: string; name?: string } | null;
  /** Route d'ingestion des événements. */
  endpoint?: string;
  /** Sans interaction pendant ce délai, le chrono se met en pause. */
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
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** `sendBeacon` d'abord : c'est le seul transport qui survive de façon fiable à la fermeture d'un onglet. */
function defaultTransport(endpoint: string, win: Window): TrackerTransport {
  return (payload) => {
    try {
      const body = JSON.stringify(payload);
      const nav = win.navigator;
      if (nav && typeof nav.sendBeacon === "function") {
        nav.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      } else {
        win.fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
          keepalive: true,
        });
      }
    } catch { /* le suivi ne doit jamais empêcher de lire le document */ }
  };
}

export function createTracker(options: TrackerOptions = {}): Tracker {
  const win = options.win || (typeof window !== "undefined" ? window : (null as unknown as Window));
  const doc = options.doc || (win && win.document);
  const now = options.now || (() => Date.now());
  const endpoint = options.endpoint || "/api/doc";
  const idleMs = options.idleMs ?? 60000;
  const sessionEveryMs = options.sessionEveryMs ?? 12000;
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

  const post = (payload: Record<string, unknown>) => {
    if (!canReport()) return;
    // Le suivi ne doit JAMAIS empêcher de lire le document : réseau coupé, `sendBeacon` refusé,
    // transport tiers qui lève — on perd la mesure, jamais la lecture.
    try { send(payload); } catch { /* best-effort */ }
  };

  const viewable = () =>
    !!doc &&
    doc.visibilityState === "visible" &&
    (typeof doc.hasFocus === "function" ? doc.hasFocus() : true) &&
    !idle;

  const commit = () => {
    if (activeSince != null && activePage > 0) {
      pageTimes[activePage] = (pageTimes[activePage] || 0) + (now() - activeSince) / 1000;
    }
    activeSince = viewable() ? now() : null;
  };

  const pause = () => { commit(); activeSince = null; };
  const resume = () => { if (activeSince == null && viewable()) activeSince = now(); };

  const totalSeconds = () => {
    let s = 0;
    for (const k in pageTimes) s += pageTimes[k];
    if (activeSince != null) s += (now() - activeSince) / 1000;
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

  const flush = () => {
    commit();
    const payload: Record<string, unknown> = {
      event: "session",
      sessionId,
      numPages: pageCount,
      maxPage: furthest,
      totalSeconds: totalSeconds(),
      pagesTime: roundedPageTimes(),
    };
    if (internal) {
      payload.internal = true;
      payload.docId = internal.docId;
      payload.email = internal.email;
      payload.name = internal.name;
    } else {
      payload.slug = slug;
    }
    post(payload);
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
      activeSince = now();
      lastActivity = now();

      // Onglet caché → on met en pause ET on persiste : un onglet caché peut ne jamais revenir.
      on(doc, "visibilitychange", () => {
        if (doc.visibilityState === "hidden") { pause(); flush(); }
        else { noteActivity(); resume(); }
      });
      on(win, "blur", pause);
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
