# Changelog

Notable changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/),
versioning follows [Semantic Versioning](https://semver.org/) — newest first.

The **host contract** has its own version, independent of the package version: it appears as
`contract` in `GET /api/doc?contract=1` and changes only on a break. See
[`docs/HOST-CONTRACT.md`](docs/HOST-CONTRACT.md).

Each released version below is also a [GitHub Release](https://github.com/Juli1artha/discovery-media-player/releases);
the notes there are this file's section for that version.

## [0.1.10] — 2026-08-14

### Changed
- **The core no longer opens the environment; it goes through the injected context.** Eleven direct
  `process.env` reads were bypassing the very boundary this project documents everywhere else —
  six for the database, two for the maps key, one for frame ancestors, and one for the **service
  role key**, which opens the whole database. A host wiring its own storage or database was
  silently short-circuited. Nothing changes for a host whose context mirrors its environment,
  which is both hosts today; what changes is that a host that does not is now actually obeyed.
- **Signing an upload URL is a host capability** (`storage.signUpload`). The core asked the
  environment for a service-role key to sign chat-attachment uploads; it now asks the host, which
  is where the key lives. A host that does not provide it gets a clean refusal that says so,
  rather than an attachment that never leaves. *Honest about what remains: the returned page still
  calls supabase-js `uploadToSignedUrl`, so the feature is not portable yet — only the secret has
  moved out of the core.*
- **One source of truth for frame ancestors.** `embedFrameAncestors()` read the environment while
  `?contract=1` announced `PLAYER.config.extraFrameAncestors`. They agree only as long as a host
  fills its config from that same variable. A host computing it otherwise would have the card
  announce one list and the CSP header serve another — configured and served diverging *inside*
  the mechanism built to detect exactly that.

  *Raised by an external review as "you are coupled to Supabase, add an abstraction layer". The
  abstraction already existed — it was leaking. A static test now refuses any new leak, and it
  found two the manual inventory had missed.*

## [0.1.9] — 2026-08-14

### Added
- **`separateIssuer` in `GET /api/doc?contract=1`.** `host-auth` says an instance *can* verify
  tokens against an issuer separate from its database; this says one *is configured*. Without the
  second signal, a host that upgrades and forgets the variable sees exactly the failure 0.1.8
  removed — members come back unauthenticated, which reads like a missing permission — and
  concludes the upgrade changed nothing. A boolean, never the issuer: the host already knows which
  one is theirs, and naming it would only inform whoever probes.

### Changed
- **The container image moves to Node 24 (active LTS).** It stays on the **active LTS**, never on
  Current: Current ships every six weeks and carries breaking changes, and self-hosters should not
  inherit that. Node 26 exists since August 2026 but is not supported long-term until October.
  `engines` stays `>=22` — what the *package* accepts and what the *image* embeds are different
  questions, and 22 is maintained until April 2027.
- Dependabot no longer proposes Node **major** bumps for the image. It cannot know that a release
  is Current, and proposed 26 the day it appeared. A green PR that puts production on an
  unsupported base is still a green PR — review catches that, not CI, so the proposal stops.

## [0.1.8] — 2026-08-14

### Fixed
- **A third-party instance could not authenticate its own members.** `SUPABASE_URL` served two
  roles at once: the player's database, and the issuer of the tokens it accepts. True — and
  necessary — while the player and its application share a deployment; false by construction once
  an instance is separate, because the database belongs to the player and identity belongs to the
  host. Members were issued tokens by one project and verified against another, which put the
  entire *member* half of the surface out of reach: sending, revoking, analytics, authenticated
  presentations. `PLAYER_AUTH_URL` (+ `PLAYER_AUTH_KEY`) now names the issuer; unset, it falls back
  to `SUPABASE_URL`, so an instance where both coincide changes by not one character.

  *Reported by the second host, who had checked both sides before writing. It is the third
  assumption of this shape in two days — after `'self'` for framing and "same origin" for the
  internal preview. They only become visible by exercising the separation.*

### Security
- **The key sent to the issuer no longer falls back to the service role.** That fallback was
  harmless while the issuer was the player's own project; toward a third-party issuer it would
  hand over the master key to the player's database on a single configuration mistake. A distinct
  issuer requires its own publishable key, and its absence is reported instead of improvised —
  a silent refusal here reads like a missing permission, which is the failure this release exists
  to remove.

### Added
- `host-auth` in `GET /api/doc?contract=1` capabilities: a host can tell whether an instance
  supports a separate issuer without opening a document.

## [0.1.7] — 2026-08-13

### Security
- **A relayed file could execute on the player's own origin.** The relay copied the upstream
  `Content-Type` verbatim, so a file announced as `image/svg+xml` or `text/html` — from a public
  bucket, or from a host's own file route — opened *inline* on the domain that serves the
  documents, next to its sessions, its presentation tokens and its analytics. A streaming response
  carries no CSP: it is a file, not a page. Anything a browser would render rather than download is
  now served inert (generic type, forced download, `nosniff`); it stays retrievable and cannot
  execute. The displayable formats are untouched.

  *Found while writing the README's format matrix — a documentation question. Dropping `.svg` from
  the local type table had closed only the half we control; the remote upstream announces whatever
  it likes.*

### Changed
- **Node.js 22 or newer** is now required. 20 reached end of life; the image, the CI matrix and the
  declared `engines` say the same thing, which was not the case before.
- **The published package ships compiled JavaScript and type declarations**, not TypeScript source.
  `discovery-media-player/bridge` was published as `.ts`, so a host without a build step could not
  import the very thing meant to spare it from copying constants by hand. The package is also 4×
  smaller. A CI check refuses a package containing `src/`.
- **The host contract is documented in English, in the open** ([`docs/HOST-CONTRACT.md`](docs/HOST-CONTRACT.md)).
  It used to be a working document written for two known teams, in French, mixing the contract with
  internal deploy history. The rules are unchanged; what left is the part that was true only for us.

### Removed
- **`.svg` is no longer served.** An SVG is a document that executes script: served inline it runs
  in the instance's origin, and the viewer's own type detection did not treat it as an image
  anyway — so it was never displayed as one. Nothing regresses that worked.

### Added
- Multi-architecture image (`linux/amd64`, `linux/arm64`) with SBOM and build provenance.
- Automated GitHub Releases on `vX.Y.Z` tags, with this file's section as the notes.
- CodeQL analysis and grouped monthly Dependabot updates.

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

## [0.1.3] — 2026-08-13

### Fixed
- **The audience stopped following the presenter.** The page's state handler was registered from a
  script block that could not see the function it named — a silent `ReferenceError` at wiring time,
  after which slide changes simply never arrived. Covered by a test that *executes* the generated
  page rather than reading its source, which is the only way this class of fault shows up.

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

## [0.1.1] — 2026-08-13

### Added
- The standalone server's root page lists what there is to read, instead of answering `404` to
  someone who just started the container and has no slug yet.

### Changed
- Published from CI by OIDC, with provenance — no long-lived token stored anywhere.
- Dependency tree cleaned: no vulnerability reported at install.

## [0.1.0] — 2026-08-13

First public release: the viewer extracted from the 3D Discovery studio into a project that runs on
its own.

### Added
- Framework-agnostic `(req, res)` handler — serverless, Express, or the bundled standalone server.
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

[Unreleased]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.10...HEAD
[0.1.10]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.9...v0.1.10
[0.1.9]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/Juli1artha/discovery-media-player/releases/tag/v0.1.0
