# Threat model

What an attacker would go after in this system, what stands in the way, and what is deliberately
left standing. Written as an attacker would read it — asset first, then the path to it — because a
threat model organised by feature reassures its author and finds nothing.

The actors and their permitted actions are in [`ARCHITECTURE.md`](ARCHITECTURE.md#actors-and-actions);
this page assumes them. [`../SECURITY.md`](../SECURITY.md) states what is in scope for a report and
what is not. When the two disagree, `SECURITY.md` wins — it is the promise made to reporters.

## What is worth stealing

Three things, in descending order of what their loss would cost the operator:

1. **The documents themselves.** Commercial proposals, sent to named recipients, not meant to be
   read by strangers. Reading one you were not sent is the whole game.
2. **The reading data.** Who opened what, for how long, on which page. A competitor learning that a
   prospect spent eleven minutes on the pricing page is a real loss even if the document itself
   never leaks.
3. **The host's credentials.** `PLAYER_HOST_FETCH_SECRET`, the service-role database key, the HMAC
   secrets. These do not just breach the player — they breach the application hosting it.

## The attack surface

Everything an unauthenticated stranger can reach, which is the only surface that matters for the
first two assets above:

| Entry point | Reachable by | What it can be asked for |
|---|---|---|
| `/doc/<slug>` and the viewer pages | Anyone with the URL | A document, its pages, its brand |
| The file proxy | Anyone who can reach the viewer | Bytes from a URL the caller influences |
| Tracking endpoints | Any open viewer | To record a reading event |
| Presentation join / chat | Anyone with the presentation link | To join, to follow, to post |
| The identity card (`/api/doc?contract=1`) | Anyone | Version and capability flags |

## Threats, by path to the asset

### T1 — Read a document without being its recipient

*Attacker: anyone on the internet.*

- **Guess a slug.** Slugs are generated with `crypto.randomBytes`, not a counter or a hash of the
  filename. Enumeration is the intended cost.
- **Reuse a revoked link.** Revocation is checked on every open, not cached in the link.
- **Walk past the access wall.** A document requiring authentication is served only against a valid
  token. If the access-wall plugin is *absent*, the answer is **404** — the core fails closed and
  never degrades into a freely readable document. This is the single most important property in the
  system, and it is the one a refactor is most likely to break quietly.
- **Reach the file directly, bypassing the player.** Storage is not publicly readable; the player
  fetches server-side. See T2.

**Residual risk:** a link forwarded by its legitimate recipient. This is by design — a tracked link
is a URL, and a URL can be forwarded. The product's answer is that the reading then shows up as a
separate reader, not that it is prevented.

### T2 — Make the server fetch something it should not (SSRF)

*Attacker: anyone who can reach the viewer. **Highest-value target in the codebase.***

The file proxy takes a URL and fetches it server-side, which means it runs with the instance's
network position — inside the operator's VPC, next to their metadata service.

- **Constraint:** `context/storage.js` confines fetches to allow-listed storage origins, the
  configured host route, or the configured local root. Anything else is refused.
- **Known failure mode, already realised once:** a *plausible typo* that widens the guard — a
  trailing slash missing from an environment variable. The policy is to fix these by **normalising
  the input**, not by documenting the correct spelling. `SECURITY.md` names this explicitly, and it
  is why "the operator misconfigured it" is not an accepted answer here.
- **Not mitigated by the player:** egress filtering. An operator who exposes a metadata endpoint to
  the instance is relying on the allow-list alone.

### T3 — Take or spy on a live presentation

*Attacker: anyone with the presentation link.*

- Driving the presentation requires the **control token**; the link alone grants watching, not
  steering.
- A private presentation is not readable without its token.
- Anonymous attendees choose their own `anon-*` key, which means a browser can claim to be several
  people. The count is therefore **capped**, because an uncapped anonymous identifier is an
  attendance figure an attacker writes.

### T4 — Cross the host boundary

*Attacker: anyone who can influence what the player sends to the host.*

The player asks the host for files and for permission decisions. The threat is making it act with
rights the host never granted.

- `identity.canManageShares(user, action)` is the host's decision, and **no answer means no** —
  absence is denial, not a default-allow.
- `PLAYER_HOST_FETCH_SECRET` authenticates the player to the host's own route. It must never appear
  in a URL, a log, or a request to anything but that route; leaking it is a vulnerability by itself,
  independent of any document being read.
- The player never authenticates an end user itself, so there is no session of its own to steal.

### T5 — Execute script in a reader's browser (XSS)

Served pages run under a **nonce-based CSP**. A bypass is a vulnerability, stated as such in
`SECURITY.md`. The browser bench exists specifically because `jsdom` does not enforce CSP: a policy
that forbids our own scripts passes every unit test and still hands the visitor a blank page, so
only a real engine can tell us. That bench **fails in CI** when no browser is available, rather than
skipping — skipping would leave open exactly the hole it exists to close.

### T6 — Reach the database directly

The database is reached **only from the server**, with a service-role key. No table carries an
anonymous read policy, and `supabase/init.sql` never creates one. A browser holding the publishable
key can therefore read nothing: there is no row-level policy for it to satisfy.

**Residual risk:** an operator who adds an anonymous policy to their own instance. Nothing in the
player can prevent that; `docs/RETENTION.md` and the schema are written to make it obviously wrong.

### T7 — Compromise the supply chain

*Attacker: someone targeting consumers rather than one instance.* The most valuable attack against
this project, because it reaches every instance at once.

| Path | What stands in the way |
|---|---|
| Malicious dependency | One production dependency, pinned exactly; committed lockfile with integrity hashes; `npm ci` only; blocking `npm audit` gate — see [`DEPENDENCIES.md`](DEPENDENCIES.md) |
| Moved action or image tag | Actions pinned to 40-character SHAs, base images to `sha256` digests, both enforced by CI guards — plus a guard that checks the version comment beside each SHA is not lying |
| Untrusted code in a privileged job | `ci.yml` is `contents: read`; `cla.yml` uses `pull_request_target` but checks out the **base** branch, never the PR head; `release.yml` starts from `permissions: {}` |
| Stolen publishing credential | None exists — OIDC trusted publishing, no stored token |
| Tag pointing at unreviewed code | CI refuses to publish a tag whose commit is not an ancestor of `main` |
| Committed secret | `tools/secrets-en-clair.mjs`, in CI **and** pre-push, because a pushed secret is disclosed and can only be revoked |

**Residual risk, stated plainly:** with a single maintainer, compromise of that one account is
compromise of the project. Branch protection and required checks do not stop someone who can change
branch protection. See [`../MAINTAINERS.md`](../MAINTAINERS.md#bus-factor).

### T8 — Denial of service

Out of scope for reports, and the reason is honest rather than dismissive: rate limiting in the
standalone context is **per-process by design**, and says so. A shared counter belongs in the host's
wiring, where the host already knows its own topology. Volume against your own instance is your
capacity problem, not a defect.

## What this model does not cover

- **The host application.** Identity, authorisation, session handling and rate limits are the
  host's; the player's threat surface stops at the injected context.
- **The operator's infrastructure.** Egress rules, TLS termination, database network exposure.
- **Physical and social attacks** on the maintainer.

## Keeping it honest

This model is reviewed when a feature changes what an actor can do or adds an entry point, and when
a release breaks the host contract — the same trigger as a `HOST-CONTRACT.md` journal entry. Three
external assessments (August 2026) are published unedited in this directory alongside the ledger of
what was fixed, what was declined, and why; findings from any future assessment land here as new
threats or as revised residual risk, not as a rewrite of the past.
