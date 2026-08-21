/**
 * CE QU'UNE APPLICATION HÔTE FOURNIT AU PLAYER.
 *
 * ⚠️ Le cœur ne sait rien de l'application qui l'héberge : tout ce qu'il emprunte — stockage,
 * base, identité, limites, marque, journalisation — arrive par cet objet, injecté une fois via
 * `init(context)`. C'est la seule frontière, et ces types la DÉCRIVENT ; ils ne la déplacent pas.
 *
 * ⚠️ LA RÉFÉRENCE RESTE `docs/HOST-CONTRACT.md`. Ce fichier est une aide de frappe, pas le
 * contrat : quand les deux divergent, le contrat gagne — et c'est ce fichier qu'il faut corriger.
 * Les champs marqués optionnels le sont RÉELLEMENT : leur absence ferme une fonction en le
 * disant, elle ne casse pas l'instance.
 */

/** Une requête HTTP entrante, telle que le player en a besoin. Volontairement minimale :
 *  le player lit `req.query` quand la plateforme le fournit, et retombe sur `req.url` sinon —
 *  un `http.createServer` nu marche donc sans adaptateur. */
export interface RequeteEntrante {
  url?: string;
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  body?: unknown;
  socket?: { remoteAddress?: string };
  on?(evenement: string, ecouteur: (...args: never[]) => void): unknown;
}

/** La réponse, côté Node. Le player écrit le statut, les en-têtes, puis le corps. */
export interface ReponseSortante {
  statusCode: number;
  setHeader(nom: string, valeur: string | number | readonly string[]): unknown;
  end(corps?: unknown): unknown;
  write?(morceau: unknown): unknown;
  writableEnded?: boolean;
}

export interface Plage { start: number; end?: number }

/** Un flux lisible, décrit STRUCTURELLEMENT : ce paquet ne dépend pas de `@types/node`, et
 *  exiger cette dépendance d'un consommateur pour lire un type serait une taxe déguisée. */
export interface FluxLisible {
  pipe?(destination: unknown): unknown;
  on?(evenement: string, ecouteur: (...args: never[]) => void): unknown;
  [Symbol.asyncIterator]?(): AsyncIterator<unknown>;
}

export interface FichierRelaye {
  body: FluxLisible | Uint8Array | null;
  status?: number;
  headers?: Record<string, string>;
}

export interface Stockage {
  /** Refus par défaut : ce qui n'est pas explicitement permis ne se relaie pas. */
  isAllowedUrl(url: string): boolean;
  fetchFile(url: string, options?: { range?: Plage }): Promise<FichierRelaye | null>;
  put(seau: string, chemin: string, contenu: Uint8Array, type: string): Promise<boolean>;
  /** Optionnel : sans lui, les pièces jointes du chat sont refusées — et le player le dit.
   *  Le cœur ne doit jamais détenir la clé qui signe. */
  signUpload?(seau: string, chemin: string): Promise<{ token: string; publicUrl: string } | null>;
}

export interface BaseDeDonnees {
  /** Forme PostgREST : `table?colonne=eq.valeur`. Volontairement sans jointure imbriquée ni
   *  arbre booléen — c'est ce qui garde un portage à la traduction plutôt qu'à la réécriture. */
  request(chemin: string, options?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<unknown>;
  selectAll(chemin: string): Promise<unknown[]>;
}

export interface Identite {
  verifyToken(entete: string | undefined): Promise<unknown | null>;
  roleOf(utilisateur: unknown): Promise<string | null> | string | null;
  isAdmin(utilisateur: unknown): Promise<boolean> | boolean;
  /**
   * Le player vérifie le jeton ; VOUS décidez des droits. Pas de réponse, ou une règle qui
   * échoue, valent refus. L'action est passée parce que les hôtes séparent l'envoi ordinaire
   * de l'administration.
   */
  canManageShares(utilisateur: unknown, action: string): Promise<boolean> | boolean;
  /** Optionnel : autorise VOTRE serveur à créer un lien en son nom propre. Absent ⇒ ce chemin
   *  n'existe pas. Le cœur ne voit jamais le secret : il demande, vous répondez. */
  isTrustedHostCall?(entetes: Record<string, string | string[] | undefined>): Promise<boolean> | boolean;
}

export interface MarqueResolue { logo: string; name: string; dark?: boolean }

export interface Marque {
  name: string;
  poweredBy: string;
  loaderName: string;
  logo(): Promise<string> | string;
  /** `name` est le repli quand le logo ne charge pas — le champ le plus oublié, et le seul
   *  qui aide quand tout le reste échoue. */
  forKey(cle: string): Promise<MarqueResolue | null>;
  title(base: string, qualificatif?: string): string;
}

export interface Limites {
  /** ⚠️ Fail-open : un limiteur en panne ne doit pas tuer un lecteur. */
  allow(cle: string, max: number, fenetreSecondes: number): Promise<boolean>;
}

export interface Courriel {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  [autre: string]: unknown;
}

export interface Mentions {
  sourceUrl: string;
  legalUrl: string;
  privacyUrl: string;
  trackingNotice: string;
  /** Optionnel : la mention d'un lien que PERSONNE n'a envoyé. Absente ⇒ repli sur la première,
   *  plutôt que de n'en afficher aucune. */
  trackingNoticeAnonymous?: string;
  /** ⚠️ Vide ⇒ AUCUN courriel ne part : la route répond `sendRefused: "public-url-unconfigured"`
   *  et journalise. L'en-tête `Host` ne convient pas — le client le choisit. */
  publicUrl?: string;
}

export interface Reglages {
  /** Consommé tel quel, SANS barre finale : le cœur ne renormalise plus. */
  supabaseUrl: string;
  supabasePublishableKey: string;
  mapsKey: string;
  extraFrameAncestors: string[];
  /** Ce qui est POSÉ, à côté de ce que le code SAIT faire : la carte d'identité publie les deux,
   *  parce qu'une capacité disponible mais non configurée se comporte comme une absence. */
  separateIssuer?: boolean;
  hostShare?: boolean;
  hostMail?: boolean;
  retentionSweep?: boolean;
  hostAuthStorageKey?: string;
  [autre: string]: unknown;
}

export interface ContextePlayer {
  storage: Stockage;
  db: BaseDeDonnees;
  identity: Identite;
  branding: Marque;
  limits: Limites;
  legal: Mentions;
  config: Reglages;
  errors: { capture(erreur: unknown, meta?: Record<string, unknown>): unknown };
  mail: { send(message: Courriel): Promise<{ sent: true } | null> };
  /** Greffons appartenant à l'hôte. Le cœur affiche, trace et présente sans aucun — c'est testé. */
  plugins: Record<string, unknown>;
  /** Dit si un greffon est présent, sans le charger. */
  has(nom: string): boolean;
  schema?: unknown;
}
