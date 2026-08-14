# Host contract

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
  "version": "0.1.8",
  "capabilities": ["docshare", "presentations", "embed-denied", "host-fetch", "brand-reference", "host-auth"],
  "frameAncestors": ["'self'", "https://*.vercel.app", "https://app.example.com"],
  "plugins": { "bot": false, "visitors": false, "brandIntro": false, "botBrowser": false, "providerQuotas": false }
}
```

**Pin `contract`**, not `version`: it moves only on a break. Test `capabilities` by **presence**,
never by order. `plugins` lets you refuse to start when you depend on an optional module this
instance does not have.

⚠️ **`frameAncestors` matters more than it looks.** A host that is not listed will never see the
viewer: the browser blocks the iframe **before any script runs**, so no message can be emitted and
the host sees a silence indistinguishable from an unreachable instance. Check that your domain is
there before you open a document.

## The three things a host implements

Everything the player borrows arrives through one injected object. Two of its entries carry
decisions the player deliberately refuses to make, and both can be answered over HTTP — most hosts
therefore write **no wiring code at all**, only environment variables.

### 1. Who may manage tracked links

```
POST  →  { "email": "…", "role": "…", "action": "create|list|list.all|revoke|setauth|overview|sessions|test" }
      ←  { "allowed": true }
```

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
the player's own project, so a shared deployment changes by not one character. The `host-auth`
capability tells you an instance supports the split.

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
