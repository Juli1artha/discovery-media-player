# API reference

The English reference for what a host application can call, and what it must implement.
The full contract — with the reasoning, the dated journal of every boundary change, and the
requests hosts have made — is [`HOST-CONTRACT.md`](HOST-CONTRACT.md), in French. **When the two disagree,
the contract wins.**

Everything below is served by one handler. Mount it wherever you like; the paths are yours.

---

## Identify an instance

```http
GET /api/doc?contract=1
```

```json
{
  "product": "discovery-media-player",
  "contract": 1,
  "version": "0.1.0",
  "capabilities": ["docshare", "presentations", "embed-denied", "host-fetch", "brand-reference"],
  "plugins": { "bot": false, "visitors": false, "brandIntro": false, "botBrowser": false, "providerQuotas": false }
}
```

No session, no database, no cache — it must answer when nothing else does. It carries no URL,
no secret and no hostname: a diagnostic endpoint that leaks its configuration is a gift to
whoever probes it.

**Pin `contract`.** It changes only on a break; adding an action, a parameter or a refusal reason
does not move it. Test `capabilities` by **presence**, never by order. Use `plugins` to refuse to
start when you depend on something this instance does not have.

---

## Pages

| Request | What it serves |
|---|---|
| `GET /api/doc?slug=<slug>` | the tracked document page (usually behind `/doc/:slug`) |
| `GET /api/doc?slug=<slug>&file=1` | the file itself, `Range`-aware |
| `GET /api/doc?present=<slug>` | the live audience page (usually `/present/:slug`) |
| `GET /api/doc?preview=1&url=<file>&name=<name>` | internal preview — no tracked link, no analytics |
| `GET …&stream=1` | streams the previewed file |

Common parameters: `title`, `docId`, `by` (presenter name), `av` (avatar), `uemail` (a member —
this is what routes the session to *internal* analytics), `autopresent=1`, `resume=<slug>`,
`embed=1`.

**`/doc/:slug` and `/present/:slug` are permanent.** They live in emails sent to other people;
a broken tracked link is a commercial relationship landing on an error page.

---

## Actions

`POST /api/doc` with a JSON body carrying `action`.

**Public** — no authentication:
`open` · `page` · `heartbeat` · `session` (analytics; internal sessions carry `internal: true`)
· `present-start|page|end|touch` · `present-attend` · `present-chat` · `present-react` ·
`present-msg-edit|delete` · `present-chatlock` · `present-upload-url` · `reshare`

**Authenticated** (`Authorization: Bearer <jwt>`, verified through `identity.verifyToken`):
`present-list|reclaim|handover|owner-end|stats|doc-list|switch|content` ·
`docshare.create|list|revoke|setauth|overview|sessions|test`

### Who may manage tracked links

Every `docshare.*` call asks your wiring:

```js
identity.canManageShares(user, action) // → boolean
```

- **The player verifies the token; you decide the rights.** It does not know the business roles of
  an application it does not know. **No answer, or a failing rule, means refusal.**
- **The action is passed** (`create`, `list`, `list.all`, `revoke`, `setauth`, `overview`,
  `sessions`, `test`) because hosts separate ordinary sending from administration. With a single
  boolean, either salespeople cannot send anything, or everyone can revoke everyone's links.
  A host without that distinction ignores the argument.
- **`list.all`** is an extra question asked during a listing. Answering no restricts the response
  to links created by the caller; the response carries `scope: "all" | "mine"`. Without it, a
  salesperson would see who else the document was sent to — their colleagues' prospects.

**Known limit: two scopes, not three.** The player knows *all* and *mine*. A host whose model has
an intermediate scope (team, agency, territory) cannot express it. The shape of the fix is already
clear — `canManageShares` returning a list of emails whose links the caller may see, filtered on
`created_by` — but no host has the population to need it yet, and an unused code path is an
untested one.

---

## The postMessage bridge

Described once, in [`src/bridge.ts`](../src/bridge.ts), imported by both sides. **That file is
MIT** so you can import it rather than copy constants: a `3dd-doc-embed-ready` retyped by hand is
a contract in two copies, and the day the prefix changes only one of them knows.

Messages are validated **by type, not by origin** — a strict origin check broke reception in
production, and everything crossing the boundary is either harmless or re-verified server-side.
`slug` is bounded (`[A-Za-z0-9_-]{1,64}`), `reason` too (`[a-z-]{1,40}`, `unknown` otherwise).

**player → host:** `close` · `share` · `embed-ready` · `embed-denied {reason}` · `present-left` ·
`present-denied` · `present-invite {slug}` · `present-handover {slug}` · `present-switch {slug}`

**host → player:** `handover-done`

### Refusals: `embed-denied`

An embedded host waiting for `embed-ready` is tempted to treat silence as a timeout and fall back
to the browser's own viewer. **That is a security hole**, because silence covers two opposite
cases: the player is absent, or the player *refuses*. Falling back in the second case opens the
document the player just closed.

| `reason` | What happened | **Host behaviour** |
|---|---|---|
| `revoked` | unknown or revoked link | do not open |
| `auth-required` | restricted document, visitor not signed in | do not open (the wall stays up; they can sign in there) |
| `auth-unavailable` | restricted document, access wall missing from the instance | do not open |
| `ended` | presentation over or unknown | do not open |
| `url-not-allowed` | the file URL is not covered by the guard | **open**, and report the configuration |

The rule underneath, safer than the list: **never fall back on a refusal of *access*; you may fall
back on an inability to *reach*.** And "do not fall back" applies to what you **offer**, not only
to what you do automatically — an "Open ↗" button left in place is falling back one second later.

`url-not-allowed` is only ever emitted by the internal preview, whose reader is already
authenticated on your side. If it ever appeared on a public path, that row would have to change
first.

---

## What you implement

```js
player.init(context)
```

| | |
|---|---|
| `storage.isAllowedUrl(url)` · `fetchFile(url, {range})` · `put(...)` | where files may be read from — see [ARCHITECTURE](ARCHITECTURE.md#where-files-may-come-from) |
| `storage.signUpload(bucket, path)` → `{token, publicUrl}` | signs a chat-attachment upload. **Optional**: absent ⇒ attachments are refused, and the player says so. The core must not hold the key that signs. |
| `db.request(path, opts)` · `selectAll(path)` | PostgREST-shaped — see [what is portable](#what-is-portable-and-what-is-not) |
| `identity.verifyToken(header)` · `roleOf` · `isAdmin` · `canManageShares(user, action)` | your permission model |
| `identity.isTrustedHostCall(headers)` → `boolean` | **Optional**: lets *your server* create links in its own name. Absent ⇒ that path does not exist. The core never sees the secret; it asks, you answer. |
| `branding.name` · `poweredBy` · `loaderName` · `logo()` · `forKey(key)` · `title(base, qualifier)` | three identities, see below |
| `limits.allow(key, max, windowSeconds)` | fail-open: a rate limiter that is down must not kill a viewer |
| `mail.send(message)` → `{sent: true}` \| `null` | see [the message shape](#mailsendmessage) |
| `errors.capture(error, meta)` | |
| `legal.sourceUrl` · `legalUrl` · `privacyUrl` · `trackingNotice` | shown to readers |
| `legal.trackingNoticeAnonymous` | **Optional**: the notice for a link nobody sent. Absent ⇒ falls back to the first, rather than showing none. |
| `config.supabaseUrl` · `supabasePublishableKey` · `mapsKey` · `extraFrameAncestors` | consumed as given — `supabaseUrl` **without a trailing slash**, the core no longer re-normalises |
| `config.separateIssuer` · `hostShare` · `hostMail` | booleans echoed by the identity card: what is *configured*, next to what the code *can* do |
| `schema` | migrations this instance still waits for — reported from what was already asked; `&schema=1` probes on demand, with a control column separating *missing* from *unreachable* |
| `plugins` | optional, host-owned |

`context/standalone.js` implements all of it from environment variables — start there and replace
only what is yours. See [`examples/vercel/player-context.js`](../examples/vercel/player-context.js).

### `branding.forKey(key) → { logo, name, dark } | null`

| Field | Role |
|---|---|
| `logo` | URL shown by the loader and the access wall |
| `name` | **the fallback when the logo fails to load** — the most-forgotten field, and the only one that helps when everything else fails |
| `dark` | loader on a dark background |

`null` (unknown key, deleted client) falls back to the instance's brand. That is expected
behaviour, not an error.

**Three identities meet on a document page and must not be confused:** the *product* serving the
page (tab title, "Powered by"), the *operator* running the instance (the loader — the first thing
a reader sees), and the *client* whose document is shown (`brand_logo` / `brand_key` on the link,
which takes the loader's place). Mixing them puts a product name where a reader expects a brand.

---

## What is portable, and what is not

The handler is genuinely framework-agnostic: serverless, Express, a bare `http.createServer`, the
bundled standalone server. That claim is tested, not asserted.

**The database is not.** `db.request(path, opts)` takes PostgREST paths — `commercial_doc_shares?slug=eq.X&select=*`,
`Prefer: return=representation`, `Range` headers for pagination. A host on Prisma or raw SQL would
have to *emulate PostgREST*, which is not an integration point, it is a chore. Today the realistic
options are Supabase or a PostgREST in front of your Postgres.

**Two browser-side pieces are Supabase-shaped too**: presentation chat and presence use
`supabase-js` realtime, and a chat attachment is uploaded with `uploadToSignedUrl`. Moving
`storage.signUpload` into the context took the *secret* out of the core; it did not make the
feature portable.

None of this affects the part most instances use: **displaying a document, tracking reading, and
serving files from a folder, a storage origin or your own route needs no database at all.**

We would rather write this down than let you discover it. A seam that exists in three places and
leaks in a fourth is worth more, stated plainly, than an "agnostic" that has to be qualified after
you have built on it.

### The size of the database surface, measured

If you are weighing a port, the useful number is not "is it coupled" but "how much". Counted, not
estimated:

| | |
|---|---|
| Call sites | **50**, in four files |
| Tables | **9** |
| Verbs | `GET`, `POST`, `PATCH`, one `HEAD` — no `DELETE` |
| Embedded selects (`select=*,other(*)`) | **0** |
| `or=()`, `and=()`, `offset=` | **0** |
| `in.(…)` | **2** — translates to `WHERE column IN (…)`, so it costs a port nothing |
| Used beyond plain filters | `order=`, `Prefer: return=…`, `Range` for pagination |

Every query is of the shape `table?column=eq.value&select=*&limit=1`. **Nothing needs PostgREST
semantics** — the coupling is syntactic, not semantic, and a guard keeps it that way: CI refuses
the advanced syntax above, so the porting cost cannot quietly grow.

⚠️ **What a repository layer would and would not buy.** Moving those 49 sites behind ~25 named
methods is a real but bounded refactor. It would *not* make the product portable on its own: live
presentation chat uses `supabase-js` realtime in the **browser**, and a chat attachment is
uploaded with `uploadToSignedUrl`. A host implementing 25 methods and then discovering that would
be worse served than one who read this table first. Displaying, tracking and tracked links —
the part most instances use — is where a port would actually land.

We have not done that refactor, because both hosts today run Supabase and speculative generality
has a way of freezing the wrong shape. If you are the third host and you want it, open an issue —
the number above is what it costs.

## Your file route

If your documents live behind an API key, the player must **never** hold it. You expose one route
(`PLAYER_HOST_FETCH_BASE`), fetch the file yourself, and the player is allowed to call only that.

⚠️ **The four requirements are in the [host contract](HOST-CONTRACT.md#3-serving-a-file-the-player-cannot-reach)**,
and they are not repeated here on purpose: this page said *three* while the contract said *four*
for a while, and the missing one was the only one that opens your data rather than degrading the
experience. Two copies of a rule are two rules, and the one you read is the one you follow.

Working implementation: [`examples/express/server.js`](../examples/express/server.js).

## `mail.send(message)`

Called only for a re-share of a link that **has a recipient**. A link nobody sent is read by any
passing visitor; letting them trigger a send would make your servers a relay for unsolicited mail,
with your domain in the header — and a lost sender reputation takes weeks to recover, during which
none of your mail arrives. The guard sits on the path that acts, not in your route on arrival.

```json
{ "to": "…", "subject": "…", "html": "…", "replyTo": "…",
  "kind": "reshare",
  "doc":  { "title": "…", "url": "https://…/doc/<slug>" },
  "from": { "name": "…", "email": "…" },
  "untrusted": { "toName": "…" } }
```

The structured fields sit next to the HTML so a host composing with its own template borrows
nothing from ours. ⚠️ **Everything supplied by the caller is under `untrusted`** — isolated so you
can ignore it in one gesture, rather than remembering which field is doubtful. Our own HTML does
interpolate that name: escaped, but chosen by whoever holds the link, inside a message signed with
your name.

Answer `{"sent": true}`. Any other shape means not sent, and the player says so instead of
pretending. Unconfigured ⇒ `null`, and the viewer offers "copy link" only.
