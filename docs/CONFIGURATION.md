# Configuration

Every setting is an environment variable. There is no configuration file, and that is deliberate:
an instance is described entirely by its environment, so two instances differ only in what you can
see in one place.

Copy [`.env.example`](../.env.example) to start.

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
| `PLAYER_SOURCE_URL` | where readers obtain the source of **this** instance |
| `PLAYER_LEGAL_URL`, `PLAYER_PRIVACY_URL` | your own pages |
| `PLAYER_TRACKING_NOTICE` | overrides the default measurement notice |

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

## Decisions that are yours

| Variable | |
|---|---|
| `PLAYER_HOST_AUTHZ_URL` | who may send, revoke, or read analytics |
| `PLAYER_HOST_BRAND_URL` | resolves a client's brand from the key carried by a link |

Both are called server-to-server with the same shared secret. **Unset means refusal** — a right
that cannot be granted is not granted. Both must answer fast or not at all: a decision that hangs
is a decision that is missing, and the player will never let either of them stop a document from
opening.

## Embedding and plugins

| Variable | |
|---|---|
| `DOC_FRAME_ANCESTORS` | extra domains allowed to frame the viewer (`?embed=1`) |
| `PLAYER_PLUGINS_OFF` | disable optional modules: `bot`, `botBrowser`, `avatarClips`, `brandIntro`, `visitors`, `providerQuotas` |
| `GOOGLE_MAPS_API_KEY` | map and Street View in presentations (restrict it by referrer) |

⚠️ Turning off `visitors` removes the access wall. Documents marked "sign-in required" then return
**404** — they never become freely readable. That fail-closed default is not to be softened.
