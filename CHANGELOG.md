# Changelog

Notable changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/),
versioning follows [Semantic Versioning](https://semver.org/).

The **host contract** has its own version, independent of the package version: it appears as
`contract` in `GET /api/doc?contract=1` and changes only on a break. See [`CONTRAT.md`](CONTRAT.md).

## [0.1.2] — 2026-08-13

### Security
- **Attachment type whitelist could be bypassed.** `ATT_KINDS["constructor"]` returns a *function* —
  a truthy value — so a public `present-upload-url` call with `type: "constructor"` passed the
  whitelist and got a signed upload URL for a type that was never allowed. The storage bucket
  remained a second barrier, but the first one was open. Every lookup of that shape now goes
  through `Object.hasOwn`, and a static test refuses any that does not.
  *Found after a third-party host reported the same pattern three times in their own code.*

### Added
- **Live chat now travels by broadcast.** It was delivered through table-level realtime, which
  requires a public SELECT on the table — meaning anyone holding the publishable key could read
  the conversations of *every* presentation. This was the last thing requiring that policy;
  `supabase/init.sql` no longer needs one, and instances that had it can drop it.
- **Host-route call formats are documented** (`PLAYER_HOST_AUTHZ_URL`, `PLAYER_HOST_BRAND_URL`).
  They were missing, and a host implemented them from prose: right intention, wrong shape, and
  two of the three mismatches were silent — a wrongly-shaped response reads as a refusal.
- **A broken host route no longer looks like a refusal.** Unreachable, timed out, non-JSON, or a
  wrongly-typed `allowed` are logged with their cause. The player stays fail-closed.

### Fixed
- Unread badge counted each chat message twice while both delivery paths were active.

## [0.1.4] — 2026-08-13

### Fixed
- **A wiring mistake looked like a refusal.** The handler reads `req.query` — the serverless and
  Express convention — which a bare `http.createServer` does not fill. With no parameters, a
  request went looking for a share named *nothing*, found none, and rendered *"this link is no
  longer valid or has been revoked"*. An integrator saw a **refusal** where they had simply not
  wired the platform. It now falls back to parsing `req.url`, so the handler is platform-agnostic
  in fact and not only in the README.
- **A request asking for nothing now says so** (`400`, naming the missing parameters) instead of
  returning the revocation page. A refusal and a missing parameter must not look alike.

### Changed
- **Documentation: most hosts need no wiring file at all.** `context/standalone` already delegates
  both host decisions to `PLAYER_HOST_AUTHZ_URL` and `PLAYER_HOST_BRAND_URL`; an instance whose
  application exposes those routes is four files, one of them ten lines. The custom-context example
  is now presented as the exception — for decisions that cannot travel over HTTP.

  *Both changes come from the first third-party integration. The extraction had gone further than
  its own instructions said.*

## [0.1.5] — 2026-08-13

### Added
- **A warning when embedding is requested with no host allowed to frame it.** With
  `DOC_FRAME_ANCESTORS` empty, only a same-origin page and `*.vercel.app` may frame the viewer;
  any other parent is blocked **by the browser, before the page loads** — so no `embed-denied` can
  be sent, and the host sees a silence indistinguishable from an unreachable instance. This is the
  one failure the player cannot signal to the host, so it now signals it to the operator, at the
  only moment it can know: when serving an embedded page.
- **A live demo** (`examples/demo`): one function, one dependency, no database and no secret.

### Changed
- Contract: the fourth requirement of *"the host serves the file"* gains its corollary — **when
  the reference itself carries a capability, signing is not enough; it must be encrypted.**
  *Signed* means nobody can forge it. It has never meant nobody can read it.
- Contract: the search criteria you use to inventory your document-opening doors decides what you
  find. Search by what the user **obtains**, not by the technique you expect.

  *(All three come from the first host's real switchover.)*

## [0.1.6] — 2026-08-13

### Fixed
- **A separate instance could not be framed by its own host — on the success path only.** The
  internal preview branch had `frame-ancestors 'self'` written as a literal, so
  `DOC_FRAME_ANCESTORS` was never consulted there. True while the application and the player share
  a deployment; false the moment an instance is separate — which is the entire point of a separate
  instance. Nothing signalled it.

  The absurd consequence, spotted by the host: the **refusal** page was framable (fixed the day
  before, on their report) while the **success** page was not. The error path was more portable
  than the nominal one.
- **The audience page passed no ancestors at all**, so `frame-ancestors 'none'` — framable by
  nobody, not even by its own origin. Found while checking the first.

### Added
- **`frameAncestors` in `GET /api/doc?contract=1`.** A boolean would not have been enough: a host
  needs to see that *its own domain* is missing, not merely that embedding is possible. This is
  the one failure a host cannot diagnose — the browser blocks before any script runs, so nothing
  can be emitted to it. Now it can see the mismatch without opening a single document.

## [Unreleased]

### Added
- Standalone server (`bin/serve.js`) and Docker image — the player runs without a platform.
- Local folder as a document source (`PLAYER_LOCAL_ROOT`), with `Range` support, symlink
  containment and traversal tests. Makes the project usable with no database at all.
- `GET /api/doc?contract=1` — version, contract number, capabilities and plugin state. No
  session, no database, no cache: it must answer when nothing else does.
- `embed-denied` on the postMessage bridge, with a reason (`revoked`, `auth-required`,
  `auth-unavailable`, `url-not-allowed`, `ended`). An embedded host can now tell a refusal from
  an outage instead of falling back to its own viewer on a document the player just closed.
- `supabase/init.sql` — brings a fresh database to the expected state in one replayable file,
  already hardened.

### Fixed
- **Truncated documents.** `fetch()` decompresses a body while keeping the upstream headers;
  relaying `Content-Length` announced the compressed size for decompressed bytes. All three
  streaming paths now announce the size of what they actually send, request `identity` encoding,
  and refuse a compressed `206` rather than serve something false.
- **Silent refusals.** Refusal pages were served with `frame-ancestors 'none'`, so an embedded
  host saw a blank frame and no message. They are now framable in embed mode.
- **A widening guard.** `PLAYER_HOST_FETCH_BASE` without a trailing slash matched sibling routes
  (`/api/documents` also allowed `/api/documents-prives/`). Normalised rather than documented.
- `branding.forKey` dropped the `name` it promised — the fallback shown when a logo fails to
  load. It now reaches the page as the image's alternative text.

[Unreleased]: https://github.com/Juli1artha/discovery-media-player/commits/main
