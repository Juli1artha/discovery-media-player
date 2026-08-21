# Host contract

> **This document is an export of the package** — resolve it with
> `require.resolve("discovery-media-player/contrat")` (and the retention policy with
> `…/retention`). An exposed path is a promise that survives file reorganizations; reading
> `node_modules` paths by hand is a guess about our tree, and it broke twice in one day.

What a host application may call, what it must implement, and what will not change without a
version bump. If you are integrating the player, this page and [`API.md`](API.md) are the two you
need.

## Five rules

1. **One source of truth.** Fix the player in the player's repository, never in a host — not even
   in a host that once contained it. A fix written host-side is a copy, and copies drift.
2. **Additive by default.** Adding an action, a parameter or a field breaks nobody. **Removing or
   renaming is a break** → a new contract number, both served during the migration.
3. **Deploy order: the player ships before its hosts.** The reverse makes a feature disappear
   everywhere at once, with no error anywhere.
4. **Pin the version you target, and test it.** `GET /api/doc?contract=1` answers without a
   session, without a database and without cache — it must answer when nothing else does.
5. **Anyone may propose, the maintainer releases.** Open an issue or a pull request here; you have
   the context and often the fix. Releasing stays with the maintainer because publishing a version
   decides deploy order. A local workaround is fine when you are blocked, on two conditions: report
   it the same day, and remove it when the release lands.

## Identity card

```json
{
  "product": "discovery-media-player",
  "contract": 1,
  "version": "<the running version>",
  "capabilities": ["docshare", "presentations", "embed-denied", "host-fetch", "brand-reference", "host-auth", "host-share", "host-mail", "retention"],
  "frameAncestors": ["'self'", "https://*.vercel.app", "https://app.example.com"],
  "separateIssuer": true,
  "internalStrict": true,
  "presenceStrict": true,
  "presenceJetons": true,
  "presenceDurcissement": "inconnu",
  "presenceFusion": "inconnu",
  "retentionSweep": false,
  "hostShare": true,
  "hostMail": true,
  "plugins": { "bot": false, "visitors": false, "brandIntro": false, "botBrowser": false, "providerQuotas": false },
  "schema": { "couvre": "colonnes-conditionnelles", "attendues": 4, "sondees": 1, "verdict": "partiel", "manquant": [] }
}
```

**Pin `contract`**, not `version`: it moves only on a break. Test `capabilities` by **presence**,
never by order. `plugins` lets you refuse to start when you depend on an optional module this
instance does not have.

⚠️ **`schema` tells you which migrations this instance is still waiting for.** The player never
applies migrations — it cannot, it only speaks PostgREST — so it *detects* instead, and a missing
column makes the feature that needs it **degrade silently**, by design, so as not to break a host
mid-migration. That silence is the point: an operator whose write ordering and message idempotency
are both switched off sees an instance that looks perfectly healthy. Each entry names the file to
apply and the feature that is asleep.

⚠️ **`manquant: []` has four meanings, so read `verdict`, not the array.** The card **reports**
what this process has already asked; it never probes on its own, because a diagnostic must answer
when the database does not — and on a serverless host that means it is usually empty. Ask a
different question when you want a real answer:

```
GET /api/doc?contract=1&schema=1
```

The three `presence*` fields report what the host has **observed**, not what it is configured to do:

| field | meaning |
|---|---|
| `presenceJetons` | measured — the host actually signed a throwaway token, so `PLAYER_PRESENCE_SECRET` works |
| `presenceStrict` | **effective** — `PLAYER_PRESENCE_STRICT` is set *and* tokens can be issued. A closed door announced over an open one would be the worse failure |
| `presenceDurcissement` | `actif` (a hardened call came back), `degrade` (migration 0018 is missing), `inconnu` (nothing attempted in this process — **not** a green light, and process-local: another instance may have seen otherwise) |
| `presenceFusion` | `actif` (a heartbeat used the fused contract — one round trip instead of two), `degrade` (migration 0019 is missing: heartbeats cost 3 round trips instead of 2, nothing breaks), `inconnu` (no heartbeat served in this process). Same three states, same trap, same reading rule as the row above |

⚠️ **Before you upgrade, do not read `presenceDurcissement` or `presenceFusion`.** They are *reports
of execution*: on an instance where nothing is running they say `inconnu`, which means *nobody
looked* — not *the migration is there*. A pre-flight check built on one of them silently passes on
every idle host, and the missing migration is then discovered at the first presentation, i.e. at the
worst moment. Ask `GET /api/doc?contract=1&schema=1` and read **`schema.durcissementBase`** and
**`schema.fusionBase`** instead: they ask the database, so they answer a global fact.

⚠️ **And on a serverless host, `inconnu` is not the exception — it is the normal answer, forever.**
This paragraph used to say *"on an instance where nothing is running"*, which reads as a description
of an **idle** deployment. Field data from the second host corrected it: a real presentation ran on
their instance, with a participant, on the very day both fields read `inconnu`. Nothing was idle —
the presentation had simply ended, and the short-lived process answering `/api/doc` was never the one
that served a heartbeat. On a platform where each request may be a fresh process, that is the
**structural** case, not an edge case: a host serving presentations daily can read `inconnu` every
single time you ask.

So the two fields answer *"did this process, right now, see it work?"* — useful to confirm a fix on a
long-lived process, worthless as an inventory anywhere else. The durable signals live in `schema`:
`fusionBase` and `durcissementBase` for the migrations, and `schema.presence.avecJeton` crossed with
`presentationsActives` for actual traffic — those are read from the database and survive the process
that answers.

⚠️ **A corollary worth keeping:** *"our instances are idle"* and *"our instances are lightly used"*
are different claims, and only the second was true here. The distinction matters because a defect
that needs traffic to appear had real opportunities the whole time it was assumed to have none.

| `durcissementBase` | meaning |
|---|---|
| `applique` | migration 0018 is in the database — safe to run with the strict door closed |
| `absente` | 0018 is missing: apply it **before** setting `PLAYER_PRESENCE_STRICT`, or bootstraps will be refused with `503` |
| `indetermine` | the question could not be asked — neither a yes nor a no |

The same answer carries **`schema.fusionBase`**, for migration `0019`, with the same three values.
Both come from **one** call in the normal case: `0019` succeeds `0018` and its argument set *contains*
it, so a call the long contract accepts proves both at once. The short contract is only asked again
when the long one is missing — i.e. exactly on the host that is behind and owes a precise answer.

| `fusionBase` | meaning |
|---|---|
| `applique` | `0019` is in the database — a presence heartbeat costs **2**† database round trips (**20**† ops/s for 250 attendees) |
| `absente` | `0019` is missing: **nothing breaks**, a heartbeat costs **3**† round trips (**30**† ops/s for 250 attendees). Applying it needs no redeploy — the player picks it up within a minute |
| `indetermine` | the question could not be asked — neither a yes nor a no |

⚠️ Unlike `0018`, a missing `0019` is a **cost**, not a risk: read it when you are sizing an
instance, not when you are deciding whether it is safe to run. A host missing it is also logged once
an hour, with the exact figures, so an idle instance still finds out.

† **Recomputed from the code on every CI run** by `charge/coutParGeste.test.js`, which measures both
regimes — the fallback still lives in the code, so the *without-`0019`* figure is a measurement, not
a number remembered from an older release. The build fails when this document and the bench disagree.
⚠️ **A number without † in this repository's documentation is hand-written: it was true once, and
nothing has checked it since.**

The probe writes nothing, for **two independent reasons**: `p_page = null` on a slug that does not
exist leaves through `0019`'s *introuvable* branch before the insert, and `p_anon_cap = 0` already
left through the previous contract's *capped* branch. Two reasons rather than one, because a
diagnostic probe is the worst place to discover a regression. A real-Postgres test asserts that no
row appears. A host missing 0018 is also logged once an hour, so an idle instance still finds out.

That parameter **is** the one part of this card that needs the database, and only when you ask for
it. `verdict` is then one of:

| verdict | meaning |
|---|---|
| `non-sonde` | nothing asked yet — **not** *nothing missing* |
| `partiel` | some expectations checked, none of them missing |
| `complet` | all checked, all present |
| `incomplet` | at least one is missing — `manquant` names the file and the sleeping feature |

Each `manquant` entry has **exactly this shape** — pin your parser to it, not to what a schema
probe "should" return:

```json
{ "migration": "supabase/migrations/0006-reactions-ordonnees.sql",
  "fonction": "empêcher deux réactions simultanées de s'écraser" }
```

⚠️ This shape went **undocumented** for two releases, and the second host typed it from memory as
`{table, colonne, migration}` — their monitoring filter then discarded every real entry and would
have shown an empty table on a database that was actually missing something. **No mutation on
their side could catch it: their test built the card the same wrong way, so the bench validated
the assumption instead of the behaviour.** The only cure was reading data they had not fabricated.
If you consume this card, test your parser against the JSON above, not against a fixture you wrote.

⚠️ **A card without a `schema` field is an alert, not a success**: it signals an instance older
than 0.1.58 — a version that cannot answer the question. (Rule contributed by the second host, for
exactly the monitoring case where "no data" would otherwise read as "all clear".)
| `indetermine` | the database did not answer; this measurement did not happen |

⚠️ **`incomplet` wins over `partiel`**: a missing column is a positive fact and settles the verdict
on its own, even when the rest has not been checked.

⚠️ **`retentionSweep`** says whether the automatic retention purge is *armed*
(`config.retention.balayage === true`). The `retention` capability only says the instance *can*
purge; this boolean says whether it *does*, on its own, once a day. Default `false` — nothing is
deleted unless an operator wrote the policy. A cockpit can read this to know if an instance is
subject to automatic deletion, instead of inferring it from a log.

⚠️ **`internalStrict: false` means internal identity comes from the browser.** In transitional
mode the internal-analytics route accepts `docId`, `email` and `name` as the client declares them —
a caller can fabricate "this colleague read this document". Strict mode (`PLAYER_INTERNAL_STRICT=1`)
only accepts host-signed tokens. The flag exists so monitoring can **refuse** a non-strict instance
instead of discovering it in a log; treat `false` as an alert on any instance whose host already
issues internal tokens. The default will flip to strict at the next announced breaking change.

⚠️ **`couvre` states the scope, because `complet` without a scope overpromises.** The card checks
the **conditional columns** — the ones a feature probes before writing. The rate-limit migrations
(`0003`, `0004`) are deliberately **not** in it: a host may provide its own `limits` capability, and
on such a host their absence is normal, not a defect. `complet` therefore never means *every file
under `supabase/` has been applied* — read it as *every column this code conditions its writes on
is present*.

⚠️ **`indetermine` is not a failure of the card.** A control column — the primary key of the oldest
table — is queried first. If *it* does not answer, nothing is missing: the database is. Without that
control, an unreachable database would make all three probes fail and the card would announce three
missing migrations **that exist**, sending you to apply what you already have. In that state nothing
is cached either, so a passing outage does not switch features off for the life of the process.

⚠️ **`frameAncestors` matters more than it looks.** A host that is not listed will never see the
viewer: the browser blocks the iframe **before any script runs**, so no message can be emitted and
the host sees a silence indistinguishable from an unreachable instance. Check that your domain is
there before you open a document.

## Counting the reads of a visitor you vouch for

A host that identifies its own visitors — one-time code, project area — can have their reads counted,
attributed and revocable, without either an anonymous link or a member's token. Pass
`recipientEmail` on the server-to-server `docshare.create`: **the host vouches, the player stops
believing the caller.**

⚠️ **The address must never come from a browser request.** Read it server-side, from the visitor's
session, at the same place that already decides whether they may see the document. A path that
cannot phrase the request will never phrase it by accident.

⚠️ **An attested link is named, not closed.** It remains forwardable: the reader is attributed, not
verified. A host whose documents are confidential must not rely on it — that closes with an attested
*reader*, which does not exist yet.

The address is stored apart from `recipient_email`, and that separation is the whole point:
`recipient_email` says *who may send in the link's name* when a recipient forwards it, and a vouched
visitor never gained that right. Leaving it empty is what makes the send guard and the re-share
inheritance both refuse — without either of them knowing why.

Requires `supabase/migrations/0001-destinataire-atteste.sql`. Until it is applied the player refuses
the attested creation and names the file; it never falls back to the other column.

## ⚠️ What `limits.allow` promises changed

It used to promise *best effort, per process*. The standalone context now counts in a **shared
table**, so a limit means what it says for the **instance** rather than for one execution.

This matters because nothing announced the difference: on serverless, several executions serve in
parallel and start cold, so a limit of 120/hour allowed 120 **per instance**. It existed, it
reassured, and it bounded a fraction of what it claimed.

Requires `supabase/migrations/0003-limites-partagees.sql` **and**
`0004-limites-atomiques.sql`. **Until they are applied, nothing breaks**: counting falls back —
to memory without the first, to a non-atomic read-modify-write without the second — and the host is
told once, by name.

⚠️ **The second one is what makes the counter hold under load.** Reading, computing and writing as
three steps means that several simultaneous requests read the same count and each write "that count
plus one" — so they cross the ceiling together, precisely when a limit is supposed to matter. The
atomic increment is **not expressible in REST** (`on conflict do update set count = count + 1` has
to name the column on both sides), which is why this one operation, and only this one, goes through
a database function.

Two deliberate exceptions, both written next to the code:

- **The local counter stays in front, as a fast refusal.** It only ever sees what one process served,
  so it under-counts: if *it* is already over the ceiling, the shared one is too. A local refusal is
  therefore always right, and costs no round trip. Abuse is refused for free; legitimate traffic pays.
- **The public read path (`pread:`) is counted locally only.** Those responses already come from a
  per-slug memory cache, put there precisely so they cost the database nothing. Backing their guard
  with a shared counter would make the guard pay the price we had just spared the thing it guards.
  On that path the real protection is the cache, not the counter.

⚠️ **The shared count is not atomic.** PostgREST cannot express "increment": it is a read then a
write. Two instances can read the same value and write one. The counter therefore **under**-estimates
under heavy concurrency — it lets a little more through, never refuses wrongly. Said plainly rather
than implying a precision we do not have.

## The three things a host implements

Everything the player borrows arrives through one injected object. Two of its entries carry
decisions the player deliberately refuses to make, and both can be answered over HTTP — most hosts
therefore write **no wiring code at all**, only environment variables.

### 1. Who may manage tracked links

```
POST  →  { "email": "…", "role": "…", "action": "<one of the names below>" }
      ←  { "allowed": true }
```

| action | what it grants |
|---|---|
| `create` | create a tracked link |
| `list` | list one's own links |
| `list.all` | list everyone's links |
| `revoke` | revoke a link |
| `setauth` | change a link's access wall |
| `overview` | read a document's aggregate figures |
| `sessions` | read individual reading sessions |
| `test` | create a rehearsal link |
| `presentations.list.all` | list presentations **one does not own** (slugs, presenter names, counts) |
| `presentations.stats` | read the **attendees** of a presentation one does not own — names, addresses, dwell time, pages |

⚠️ **This list grows, and a closed table refuses what it has not heard of.** Both
`presentations.*` names arrived in `0.1.46`; a host whose table predates them answers *no* to
everyone, administrators included — not because the right is missing, but because the table is older
than the player. That failure reads exactly like a permission problem, which is what makes it
expensive. **Compare this table against your own at each upgrade**, and prefer a refusal that names
the unknown action over one that looks like a role issue.

⚠️ **`presentations.list.all` and `presentations.stats` are deliberately separate.** Seeing *that* a
presentation happened and seeing *who attended it* are different sensitivities: the first returns
metadata, the second returns people — often prospects. Merging them would take from you the choice of
opening one to the whole team while reserving the other.

Neither is needed to read one's **own** presentations: an owner, and an administrator, are always
served without the player asking you anything.

- **The player verifies the token; you decide the rights.** No answer, or a failing rule, means
  refusal. A right that cannot be granted is not granted.
- **`email` is the authoritative identity.** `role` is what the session token carried; a host whose
  roles live in its own database ignores it and looks them up. That is expected.
- **Only `allowed` is read, and it must be a boolean.** Any other shape means refused.
- The token is already verified before the call: your route does not receive it and must not
  re-verify it.

⚠️ **Verified against whom?** The player's database and your identity provider are two different
things. They are the same project while the player and your application share a deployment — and
different by construction once the instance is separate. Point `PLAYER_AUTH_URL` at the project
that issues your members' tokens (with its own publishable key in `PLAYER_AUTH_KEY`), or every
member action is refused in a way that reads like a missing permission. Unset, it falls back to
the player's own project, so a shared deployment changes by not one character.

Two signals, and you need both: **`host-auth` in `capabilities`** says this instance *can* target
a separate issuer; **`separateIssuer: true`** says one *is configured*. A version that supports
the split with the variable left unset fails exactly like the version before it — members come
back unauthenticated, which reads like a missing permission — and you would conclude the upgrade
changed nothing. The card answers with a boolean and never the issuer itself: you already know
which one is yours.

### 2. What a client's brand is

```
POST  →  { "key": "…" }
      ←  { "logo": "https://…", "name": "…", "dark": false }    or {} / null when unknown
```

The link carries a **reference**, never a copy of the logo: a tracked link lives for weeks in an
inbox, and a logo frozen at send time would not follow a corrected brand. `name` is not decorative
— it is what shows when the logo fails to load.

### 3. Serving a file the player cannot reach

If your documents sit behind an API key, the player must **never** hold it. Expose one route
(`PLAYER_HOST_FETCH_BASE`), fetch the file yourself, and the player is allowed to call only that.
Four requirements, in order of what they cost when missed:

1. **Never relay the upstream `Content-Length`.** `fetch()` decompresses the body and keeps the
   upstream headers; relaying the announced size serves a **truncated PDF**, with no error
   anywhere. Announce the length of what you send, request `Accept-Encoding: identity`, and refuse
   a compressed `206` — range bounds refer to compressed bytes.
2. **Relay `Range`** (`206` + `Accept-Ranges: bytes`). Progressive loading depends on it.
3. **Accept a server-to-server call.** A tracked link is opened by someone with no session on your
   side. Authenticate the player with the shared secret in the `x-player-fetch-secret` **header** —
   header only, never a query string: logs keep URLs.
4. ⚠️ **Never sign a path supplied by the client.** The first three are about transport; this one
   is about what you transport, and it is the only one whose omission does not degrade the
   experience but **opens your data**.

   Your route serves with *your* credentials — the player has no session to present, by design.
   An action that signs a client-supplied path becomes an oracle: a user signs a path their own
   rights would refuse, and the player reads it back with yours. The anti-SSRF guard sees nothing:
   the origin is legitimate, it is yours.

   The shape that holds: the caller supplies a **source from a closed set and a row identifier,
   never a path**. You re-read the path with the caller's session and your own row-level rules
   decide. **Corollary:** when the reference itself carries a capability, signing is not enough —
   it must be encrypted. *Signed* means nobody can forge it; it has never meant nobody can read it.

## The postMessage bridge

Described once in [`src/bridge.ts`](../src/bridge.ts) and published as `discovery-media-player/bridge`
— **compiled JavaScript with type declarations, under MIT** rather than the core's AGPL, so that
importing it is not a toll. Import it rather than copying constants: a message name retyped by hand
is a contract in two copies, and the day it changes only one of them knows.

**player → host:** `close` · `share` · `embed-ready` · `embed-denied {reason}` · `present-left` ·
`present-denied` · `present-invite {slug}` · `present-handover {slug}` · `present-switch {slug}`

**host → player:** `handover-done`

### Refusals

A host waiting for `embed-ready` is tempted to treat silence as a timeout and fall back to the
browser's own viewer. **That is a security hole**: silence covers two opposite cases — the player is
absent, or the player *refuses*. Falling back in the second case opens the document the player just
closed.

| `reason` | What happened | Host behaviour |
|---|---|---|
| `revoked` | unknown or revoked link | do not open |
| `auth-required` | restricted document, visitor not signed in | do not open — the wall stays up |
| `auth-unavailable` | restricted document, access wall missing from this instance | do not open |
| `ended` | presentation over or unknown | do not open |
| `url-not-allowed` | the file URL is not covered by the guard | **open**, and report the configuration |

The rule underneath, safer than the list: **never fall back on a refusal of *access*; you may fall
back on an inability to *reach*.** And "do not fall back" applies to what you **offer** — an
"Open ↗" button left in place is falling back one second later.

## Two things that will bite

**Your document-opening doors reappear.** A host has more than one place that opens a file, and new
ones get written. Keep the list and hunt it periodically — and note that **your search criteria
decide what you find**: search by what the user *obtains* (a document opens), not by the technique
you expect to see.

**Configured is not served.** When a diagnosis is disputed, the useful question is not who is right
but *did you measure exactly what fails*. Two true statements about the same instance can describe
different responses.

## Versioning

Semantic versioning on the package, independent of the `contract` number. Pin an **exact** version:
the player and its hosts deploy separately, and a range brings in a version nobody decided to
deploy, on a day someone ran `npm install` for another reason.
