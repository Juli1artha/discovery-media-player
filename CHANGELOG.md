# Changelog

Notable changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/),
versioning follows [Semantic Versioning](https://semver.org/).

The **host contract** has its own version, independent of the package version: it appears as
`contract` in `GET /api/doc?contract=1` and changes only on a break. See [`CONTRAT.md`](CONTRAT.md).

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
