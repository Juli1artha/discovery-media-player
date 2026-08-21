# Configuration

Every setting is an environment variable. There is no configuration file, and that is deliberate:
an instance is described entirely by its environment, so two instances differ only in what you can
see in one place.

Copy [`.env.example`](../.env.example) to start.


### `PLAYER_MAX_RELAY_BYTES`

Ceiling, in bytes, for a file relayed through the player (default **60 MB**). Above it the relay
answers **413** *before reading the body* — refusing after allocation protects nothing, since the
allocation is the cost. An upstream that announces no `Content-Length` passes anyway: one cannot
refuse what one cannot measure, and closing by default would cut off perfectly legitimate storages.
This bounds the **large**, not the **unknown**.

## The minimum

| Variable | |
|---|---|
| `PLAYER_LOCAL_ROOT` | a folder of documents. Enough to display, with progressive loading and reading analytics. No database, no account. |
| `PORT`, `HOST` | defaults `3000` / `0.0.0.0` |

## Brand

| Variable | Effect |
|---|---|
| `PLAYER_BRAND_NAME` | tab-title suffix, loader wordmark, default assistant name, re-share email subject |
| `PLAYER_BRAND_POWERED_BY` | "Powered by …" in the footer, and under a client's logo |
| `PLAYER_LOADER_NAME` | the name the **loader** shows — falls back to `PLAYER_BRAND_NAME` |
| `PLAYER_BRAND_LOGO` | the instance's logo (standalone context) |

⚠️ **Empty means neutral, and that is the right default.** A player run on someone else's behalf
must show nobody's brand until asked. Sending a document to a client under another company's name
is a mistake, not a detail.

`PLAYER_LOADER_NAME` exists because the product name once ended up on the loader, where readers
expect a brand. Three identities meet on that page — see [API.md](API.md#brandingforkeykey--logo-name-dark--null).

## Legal notices

| Variable | |
|---|---|
| `PLAYER_PUBLIC_URL` | this instance's public URL, as **you** write it |
| `PLAYER_SOURCE_URL` | where readers obtain the source of **this** instance |
| `PLAYER_LEGAL_URL`, `PLAYER_PRIVACY_URL` | your own pages |
| `PLAYER_TRACKING_NOTICE` | overrides the default measurement notice |
| `PLAYER_TRACKING_NOTICE_ANON` | the same, for a link **nobody sent** — a public brochure opened from a map. Saying "passed on to its sender" there would be false, and this is the one sentence in the product whose whole job is to be exact. The player picks by the link itself: no recipient, no creator. |

⚠️ **`PLAYER_PUBLIC_URL` is a security setting, not a convenience.** Links that leave by email are
built from it. The `Host` header will not do: the client chooses it, so a reader could have a
message sent — signed by you, carrying your brand and your sender reputation — whose button points
at their own domain.

⚠️ **Unset, no mail goes out.** The re-share route answers `sendRefused: "public-url-unconfigured"`
and logs the reason; the tracked link itself is still created and returned, so you can pass it on
yourself. Version 0.1.21 did fall back to `Host` and merely logged it — a log does not stop a
phishing mail, and the operator learned about it from an abuse report. The fallback was removed;
what is refused is the **send**, never the link, so nothing that matters breaks.

Two obligations, different in nature. **The source**: AGPL makes it owed to whoever *uses* the
software over a network, not only to whoever distributes it — a reader of `/doc/:slug` qualifies.
If you modified the player, point at *your* source. **The measurement**: a tracked link records
who opened, which pages, for how long, on what device. That is personal-data processing, and the
notice about it is the only one displayed **by default** — missing the others is a choice, missing
this one is a risk.

## Where files may come from

| Variable | |
|---|---|
| `PLAYER_LOCAL_ROOT` | a folder. Symlinks are resolved and containment is checked on the path segment. |
| `PLAYER_STORAGE_ORIGINS` | extra storage origins (spaces or commas). Only canonical **public** object paths pass. |
| `PLAYER_HOST_FETCH_BASE` | a route of **your** application. A full URL prefix, https. |
| `PLAYER_HOST_FETCH_SECRET` | shared secret, sent as the `x-player-fetch-secret` header. |

⚠️ **`PLAYER_HOST_FETCH_BASE` is a prefix, not an origin.** Allowing a whole domain would let the
player call any of your routes. The trailing slash is enforced (a missing one made
`/api/documents` also match `/api/documents-prives/` — normalised rather than documented).

⚠️ **The secret travels in the header only, never in a query string** — logs keep URLs, and it
would leak in clear on both sides. It is sent **only** to your route, never to a public storage
where it has no business being. Absent on your side ⇒ nobody gets through. Compare it in constant
time; use at least 32 characters.

## Tracked links, analytics, presentations

| Variable | |
|---|---|
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | server-side database access |
| `SUPABASE_PUBLISHABLE_KEY` | live chat in presentations (browser side) |

Run [`supabase/init.sql`](../supabase/init.sql) on a **fresh** database first. One replayable
file, and it installs **already hardened**: no table gets an anonymous read policy. Presentation
state travels by broadcast precisely so that no such policy is needed — do not add one "to make
live work".

### Who issues the tokens (separate instances)

| Variable | |
|---|---|
| `PLAYER_AUTH_URL` | the Supabase project that **issues your members' tokens** |
| `PLAYER_AUTH_KEY` | its publishable key |

⚠️ **The player's database and your identity provider are two different things.** They are the
same project when the player and your application share a deployment — and different by
construction when the instance is separate: the database belongs to the player, identity belongs
to you. Leave these unset and token verification falls back to `SUPABASE_URL`, so an instance
where they coincide changes by not one character.

Set them and your members can sign in; leave them unset on a separate instance and every member
action — sending, revoking, analytics, authenticated presentations — is refused, in a way that
reads like a missing permission rather than a misconfiguration.

Point `PLAYER_AUTH_URL` at the **Supabase project**, not at your application: the player calls
`<PLAYER_AUTH_URL>/auth/v1/user`.

⚠️ **`PLAYER_AUTH_KEY` has no fallback, on purpose.** The key sent to the issuer used to fall back
as far as `SUPABASE_SERVICE_ROLE_KEY` — harmless while the issuer was the player's own project,
and a way to hand a third party the master key to your database the day it is not. A distinct
issuer requires its own key; without one, the player refuses and says so instead of improvising.

### Detecting a signed-in member on a shared origin

| Variable | |
|---|---|
| `PLAYER_HOST_AUTH_STORAGE_KEY` | the `localStorage` key under which **your** application stores its members' session |

Unset by default, and member detection is simply off — no member is recognised, so none can be
impersonated. This package used to hardcode one host's key: it found nothing on every other host,
and since the session key became the way membership is *proven*, a wrong key is a security
question, not a cosmetic one. Name yours explicitly or leave the door closed.

⚠️ **It only works when your application and the player share an origin.** Two subdomains are two
`localStorage`s; no value here changes that. This is a transition mechanism — the proper channel
is the host injecting its member when the page is rendered.

### Links the host owns

| Variable | |
|---|---|
| `PLAYER_HOST_SHARE_SECRET` | lets your **server** create tracked links in its own name |

For a link nobody sends: the public brochure of a listing, opened by a prospect who has no account
and should not need one. No member is present, so there is no token to require — and requiring one
would force you to invent an identity that does not exist (a service account whose password opens
far more than link creation, or the internal preview diverted, which would file a prospect among
your colleagues and make "this client read for twelve minutes" a lie).

⚠️ **A different secret from `PLAYER_HOST_FETCH_SECRET`, on purpose.** That one only ever travels
*outward* — the player sends it to you on every file fetch, so it sits in your access logs, your
proxies, your error tracker. Today whoever obtains it can impersonate the player *to you*.
Accepting it inbound would additionally grant write access *here*. One more variable against a
blast radius that does not grow.

Sent as the `x-player-share-secret` **header**, compared in constant time. Not configured ⇒ the
path does not exist.

**Three locks, each closing a different door:**

1. **`docshare.create` only.** Revoking, listing and reading analytics stay member actions — a
   server secret must not reveal who read what.
2. **No recipient.** A named link belongs to a member and requires their token.
3. **Idempotent by `docId`.** Without it, a redeploy, a retry or a double click gives you three
   links for the same brochure — and analytics split three ways, discovered six months later while
   reading them. The link carries no creator (`created_by` null), so it never appears in any
   member's "my links" and stays visible under `list.all`.

Check both without opening a document, in `GET /api/doc?contract=1`: `host-auth` in
`capabilities` means the instance **can** do this, and `separateIssuer: true` means one **is
configured**. Same pair for host-owned links: `host-share` and `hostShare`. The first without the second is the failure this whole section exists to prevent —
a supported split that nobody switched on behaves exactly like no support at all.

## Decisions that are yours

⚠️ **You probably do not need to write a wiring file at all.** `context/standalone` already
delegates both host decisions to the two routes below. If your application exposes them in the
documented shape, your instance is four files, and the only one with any content is a ten-line
entry point:

```js
const player = require("discovery-media-player");
const { createStandaloneContext } = require("discovery-media-player/context/standalone");
player.init(createStandaloneContext(process.env));
module.exports = player.handler;
```

Write a custom context only when a decision cannot travel over HTTP — an in-process permission
model, a database you already hold a connection to. *(The first host to integrate discovered this:
we had told them to write a file they did not need. Code you don't write cannot drift.)*

| Variable | |
|---|---|
| `PLAYER_HOST_AUTHZ_URL` | who may send, revoke, or read analytics |
| `PLAYER_HOST_BRAND_URL` | resolves a client's brand from the key carried by a link |
| `PLAYER_HOST_MAIL_URL` + `PLAYER_HOST_MAIL_SECRET` | your route that **sends** the re-share email |
| `PLAYER_INTERNAL_STRICT` | `1` ⇒ an internal reading session is written **only** with a token your server signed |
| `PLAYER_IP_HASH_SECRET` | salts the attendance IP fingerprint — falls back to `PLAYER_PRESENCE_SECRET` |
| `PLAYER_PRESENCE_SECRET` | signs **presence tokens** — set it to start issuing them (see below) |
| `PLAYER_PRESENCE_STRICT` | `1` ⇒ a presence heartbeat is recorded **only** with a proven token |
| `PLAYER_TRUSTED_PROXY_HOPS` | how many **trusted** proxies sit in front of this instance |

### Presence tokens, and how to close the door safely

An anonymous participant's presence row is keyed by a value **their browser chooses**. Without a
token, anyone who learns that key can post it and overwrite that participant's row — their name,
their time, their pages. A presence token binds `slug + key + expiry`, signed with
`PLAYER_PRESENCE_SECRET`: the server then derives the row's key from what it **proved**, not from
what the caller claims.

Generate the secret yourself:

```
openssl rand -base64 48
```

**It is per INSTANCE, not per brand.** One instance serving several domains shares one secret, and a
token issued on one domain validates on another. That is harmless — the real scope is the `slug`,
which is inside the signed payload and checked on use — but it should not be a surprise, so it is
written here rather than left to be inferred.

**What the token proves, and what it does not.** It proves this instance issued that `(slug, key)`
pair, which is enough to stop a third party from taking over a registered presence. It does **not**
prove a real person is behind it — a visitor can ask for several. That is why the anonymous-creation
cap stays on regardless.

**Closing the door is a three-step move, and the middle step is not optional:**

1. Set `PLAYER_PRESENCE_SECRET` and redeploy. The server starts issuing tokens; nothing breaks, and
   clients that do not understand them simply ignore them. **Check it took effect**: the card carries
   `presenceJetons: true` once tokens are actually being issued. It is *measured*, not declared — the
   card signs a throwaway token and reports whether one came out — so `presence: {0, 0}` alone never
   has to be read as proof: a mistyped variable, the wrong environment, or a missing redeploy all look
   identical without it.
2. **Watch the counter.** `GET /api/doc?contract=1&schema=1` carries
   `presence: { avecJeton, sansJeton }` over a 24-hour window. `sansJeton` is how many participants
   still beat **without** a token — old clients, cached bundles. Wait for it to reach zero. ⚠️ Read it
   **twice, more than 30 seconds apart**: the whole card is cached for 30 s.
   ⚠️ The two sets **overlap on purpose** (a participant who beat both ways counts in both), so their
   sum is not the number of participants. And `avecJeton` counts self-declared bootstraps too — it is
   a migration gauge, not a security metric; the response says so in its own `couvre` field.
3. Only then set `PLAYER_PRESENCE_STRICT=1`. From that point a heartbeat with no proven token is
   refused (`403 presence-token`) instead of being recorded.

⚠️ **The card reports what it observed, not what is configured.** Alongside `presenceStrict` (the door
refuses) sits `presenceDurcissement`, the *observed* state of the anti-takeover check on bootstraps:
`actif` — an attempt succeeded; `degrade` — the last attempt found migration 0018 missing, so bootstraps
are currently unchecked; `inconnu` — nothing has been attempted yet in this process, which is a state of
its own and **not** a green light. The check cannot be probed without calling the function (it writes),
so what is reported is what using it revealed. A transient network failure does not move it to
`degrade`: it proves nothing about 0018.

⚠️ **Next to it, `presenceFusion` reports the *cost* of a heartbeat.** Same three values, same reading
rule — `actif`, `degrade` (migration `0019` is missing), `inconnu` (no heartbeat served yet in this
process). A missing `0019` breaks nothing: a heartbeat simply costs **3**† database round trips
(**30**† ops/s for 250 attendees) where a migrated host costs **2**† (**20**† ops/s). It is the one
number worth knowing before
you size an instance, and it used to be invisible: a host without the migration paid double on the
hottest path of the product with nothing to say so. Applying it needs no redeploy; the player picks it
up within a minute. For the question *"is it applied?"* — asked before a deployment, when no heartbeat
has run — read `schema.fusionBase` from `GET /api/doc?contract=1&schema=1` instead: it asks the
database rather than this process.

† **Recomputed from the code on every CI run** by `charge/coutParGeste.test.js`, which measures both
regimes and fails the build when this document and the bench disagree. ⚠️ **A number without † in
this repository's documentation is hand-written: it was true once, and nothing has checked it since.**

⚠️ **On a serverless host, `inconnu` is the normal answer — not a sign that nothing is happening.**
The second host measured it: a real presentation ran on their instance, with a participant, on the
very day both `presence*` observation fields read `inconnu`. The presentation had ended, and the
short-lived process answering `/api/doc` was never the one that served a heartbeat. Read the `schema`
fields for facts that outlive a process, and treat *"lightly used"* and *"idle"* as the different
claims they are — a defect that needs traffic to appear had real opportunities the whole time the
instance was assumed to have none.

⚠️ **`PLAYER_PRESENCE_STRICT` is inert without `PLAYER_PRESENCE_SECRET`, on purpose.** With no secret
nobody *can* obtain a token, so enforcing it would refuse 100% of anonymous participants — a
self-inflicted outage. The card therefore reports the **effective** value: `presenceStrict` reads
`false` while the instance cannot issue tokens, and `presenceJetons` says why. The player also logs it
once an hour. Announcing a closed door that is wide open would be the worse of the two failures.

⚠️ **Rotating the secret** costs each participant **two** refused heartbeats and **a new attendance
row**. The exact sequence, since the first version of this paragraph got it wrong by claiming one
refused beat:

1. the token signed with the previous secret gets `403 presence-token`; the client discards the
   token but **keeps its key** — the key is still legitimately its own, only the proof expired;
2. the next beat asks for a new token with that same key. The row is already *claimed* (it has a
   `last_token_at` from before the rotation), so the anti-takeover check refuses it: `409 usurpe`;
3. the client then rotates its key and starts a fresh row on the third beat, ~50 s after the first
   refusal.

**The consequence that matters is step 3, not the beat count**: the participant's accumulated
presence time restarts from zero, and the operator sees the same person as two attendees. Rotate the
secret when nobody is presenting.

Discarding the key at step 1 instead would save one beat, and it is deliberately not done: the
attendee key is shared across presentations (`3dd-present-attkey` is a single storage entry), so
rotating it on one presentation's refusal would also change the viewer's identity on any other
presentation they have open — and a 403 is precisely the situation in which we cannot tell whether
the row is theirs.

There is deliberately no `kid` / current+previous list: it would add a payload field and a two-secret
configuration, and the self-healing path has to exist anyway — for expiry, which no key list can
prevent.

⚠️ **`sansJeton` is an instrument of transition, and it expires.** The audience page is served
`no-store` and the client code is interpolated into the HTML, so there is no stale bundle anywhere:
every new visitor is modern by construction, and the only old population is tabs opened before the
client shipped. Once those are gone, `sansJeton` can never be non-zero again — it will read 0 whether
the mechanism works or is completely broken. **A counter that can no longer vary has stopped
measuring, even while it still shows the right value**, and it is *time* that does this, not a defect:
no commit to blame, no mutation to catch. After closing, read `sansJeton: 0` as "the transition is
over", never as "all is well" — those are different statements. **What takes over as the sign of life
is `avecJeton`** — but never read alone: it is legitimately zero outside a presentation, which is the
resting state of any instance. So the card carries `presentationsActives` beside it, and the pair is
decidable on its own: *N live and 0 `avecJeton` is an anomaly; 0 live and 0 `avecJeton` is rest.*
⚠️ It counts presentations that are **live**, not merely flagged active: a presenter who closes their
tab without ending the session leaves `active = true` behind, and counting those would report an
anomaly with nobody having gone anywhere — the number's reliability would depend on closure
discipline. It therefore reuses the same staleness threshold the rest of the code already uses to
decide "live" (the presenter beats every 30 s), rather than inventing a second one.
Without that second number the reader has to remember the word "during", and "during" is exactly the
word a hurried reader skips. The card says which of the two regimes it is in, in its own `couvre` field,
so the caveat travels with the numbers rather than living here alone.

Setting the flag before `sansJeton` reaches zero closes the door on audiences that are still in the
room, and the failure is silent on the wrong side: their presence simply stops being recorded, and
the presentation merely looks poorly attended.

⚠️ **Apply `supabase/migrations/0018-bootstrap-non-usurpable.sql` before arming step 3.** A client
with no token yet announces itself as a bootstrap — a self-declared marker. Without 0018, an attacker
can declare it too, post a registered participant's key, and overwrite their row: the door would be
shut on old clients while staying open to the takeover it exists to prevent. With 0018, a bootstrap
on a row already claimed by a token holder is refused, and the client rotates its own key rather than
losing its presence in silence. The player says so in its logs if the migration is missing.

### Internal reading sessions

The **internal** population is the one this product promises never to mix with prospects: "this
client read for twelve minutes" is worth something only if a colleague re-reading the document does
not land in the same count. That route used to accept any email, any document, any duration, with
no token — so anyone could manufacture "this colleague read this document for three hours".

⚠️ **Why not a JWT.** Reading analytics leave through `sendBeacon`, the only transport that
survives a closing tab — and it cannot carry a header. Requiring a JWT would lose the measurement
at the exact moment it matters most. The proof therefore travels in the **body**, and comes from
you: only you know who your member is.

```
token = base64url(JSON) + "." + HMAC-SHA256(base64url(JSON), PLAYER_HOST_FETCH_SECRET)
JSON  = { "email": "…", "name": "…", "docId": "…", "exp": <unix seconds> }
```

Pass it as `it` in the tracking body. `exp` is **required**: a signature without expiry would
still be valid after that member left the company. When a valid token is present, its claims win —
the caller's `email` and `docId` are ignored.

Set `PLAYER_INTERNAL_STRICT=1` once your application mints it, and the door closes: no token, no
write. It is not closed by default because that would break every instance already running,
including ours. **An open door nobody mentions is a defect; an open door stated, with the lock
supplied, is a transition.**

### Who is calling

⚠️ **`X-Forwarded-For` is a header, therefore a claim.** Every rate limit used to key on its first
value, so a caller reaching the server directly — the standalone case, and any instance whose proxy
does not rewrite it — changed it per request and was never limited. The limit existed; it limited
nothing.

Unset, the header is ignored and the socket address identifies the caller. **An instance without a
proxy is protected without doing anything.** Set `PLAYER_TRUSTED_PROXY_HOPS=1` when exactly one
trusted proxy sits in front: the value is then read from the **end** of the chain, not the
beginning — the beginning is what the client wrote, the end is what the proxies observed. Reading
the first element is the classic mistake with this header, and it is the one the code made.

### Sending mail

⚠️ **The player calls your mail route only for a link that has a recipient.** The reader of an
anonymous link is any passing visitor; letting them request a send would turn your servers into a
relay for unsolicited mail, with your domain in the header. What that costs is not the message
sent — it is your sender reputation, which takes weeks to recover, and during which *none* of your
mail arrives: invoices, reminders, team notifications included. A convenience on a public page
would put your whole transactional mail at stake.

The guard is here, on the path that acts, rather than in your route on arrival. A filter on
arrival depends on a list staying current; a path that cannot phrase the request will never phrase
it by accident.

The payload carries **structured fields** next to the HTML — `kind`, `doc {title, url}`,
`from {name, email}` — so a host composing with its own template needs to borrow nothing from
ours. Anything supplied by the caller sits under `untrusted`, isolated so you can ignore it in one
gesture rather than remembering which field is doubtful. Answer `{"sent": true}`; anything else
means not sent, and the player says so instead of pretending.

⚠️ **A third secret, and it is a deliberate trade.** `PLAYER_HOST_FETCH_SECRET` travels to you on
every file opened — several entries per document in your access logs. Adding "send mail in your
name" to what a log leak permits is a much larger power than answering a question, even in the
same direction.

Both are called **POST JSON, server-to-server**, with the shared secret in the
`x-player-fetch-secret` header. Timeout: 4 seconds.

```
PLAYER_HOST_AUTHZ_URL
→  { "email": "…", "role": "…", "action": "create|list|list.all|revoke|setauth|overview|sessions|test" }
←  { "allowed": true }        // strict boolean — anything else means refused

PLAYER_HOST_BRAND_URL
→  { "key": "…" }
←  { "logo": "https://…", "name": "…", "dark": false }   or {} / null when unknown
```

⚠️ **Only `allowed` is read, and it must be a boolean.** `{"canManageShares": true}` means
refused. The `email` is the authoritative identity — `role` is what the session token carried
(`app_metadata.role`); a host whose roles live in its own database ignores it and looks them up
from the email. That is expected, not a workaround. The token is already verified by the player
before the call: your route does not receive it and must not re-verify it.

**Unset means refusal** — a right that cannot be granted is not granted. Unreachable, timed out,
non-JSON, or a wrongly-typed `allowed`: the player stays fail-closed **and logs the cause**.
Without that, "my route answers badly" and "the right is denied" look identical from the outside,
which has already cost one host half a day.

## Embedding and plugins

| Variable | |
|---|---|
| `DOC_FRAME_ANCESTORS` | domains allowed to frame the viewer (`?embed=1`) — **see the warning below** |
| `PLAYER_PLUGINS_OFF` | disable optional modules: `bot`, `botBrowser`, `avatarClips`, `brandIntro`, `visitors`, `providerQuotas` |
| `GOOGLE_MAPS_API_KEY` | map and Street View in presentations (restrict it by referrer) |
| `ELEVENLABS_API_KEY` | gives the `bot` module a voice (ElevenLabs text-to-speech). Absent ⇒ the voice controls disappear and the assistant stays written |
| `ELEVENLABS_VOICE_ID` | default voice, used when an agent profile does not carry its own. Empty ⇒ a stock ElevenLabs voice |
| `ELEVENLABS_MODEL` | synthesis model. Empty ⇒ `eleven_multilingual_v2` |

⚠️ **`ELEVENLABS_API_KEY` is a server secret against a paid API.** It never reaches the page: the
browser asks this instance, which synthesises server-side, stores the clip in the public
`tts-cache` storage bucket, and returns that URL — a sentence already spoken costs ElevenLabs
nothing, whoever replays it. The route is rate-limited per caller, and with no key it declines
quietly (the interface hides its voice buttons rather than erroring). An agent profile may carry
its own voice; a library voice not yet in your account is added automatically, and if that fails
the default voice speaks — never a silent presentation.

⚠️ **Without `DOC_FRAME_ANCESTORS`, nobody can display the viewer in an iframe** — and the failure
is the worst kind. Only a same-origin page and `*.vercel.app` may frame it by default; any other
parent is blocked **by the browser, before the page loads**. So no `embed-denied` can be sent, and
the host sees a silence indistinguishable from an unreachable instance. A host that falls back
after a timeout will open the document in the browser's own viewer, untracked.

This is the exact counterpart of `PLAYER_HOST_AUTHZ_URL`: without that one, nobody can **send**;
without this one, nobody can **display**. The player logs a warning the first time an embedded page
is served with no configured ancestor — it is the only moment at which it can know.

⚠️ Turning off `visitors` removes the access wall. Documents marked "sign-in required" then return
**404** — they never become freely readable. That fail-closed default is not to be softened.
