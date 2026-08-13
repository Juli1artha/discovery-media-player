# Security policy

## Reporting a vulnerability

Email **security@3d-discovery.fr** with enough detail to reproduce. Please do not open a public
issue — instances of this player serve commercial documents that are not meant to be read by
strangers, and a public report is a starting pistol.

You will get an acknowledgement within 72 hours and an assessment within 7 days. If the report is
valid we will agree a disclosure date with you, and credit you in the changelog unless you would
rather we did not.

## Supported versions

The latest minor release. This project is young; there is no long-term support branch yet.

## What we consider a vulnerability

- **Reaching a file the guard should refuse** — anything outside an allow-listed storage origin,
  the configured host route, or the configured local root. The file proxy is the highest-value
  target in this codebase: it takes a URL from a caller and fetches it server-side.
- **Reading a document without the right link** — slug guessing, revoked links that still open,
  the access wall opening for a visitor without a valid token.
- **Taking control of a live presentation** without the control token, or reading a private one.
- **Escalation through the host boundary** — making the player act with rights the host never
  granted, or leaking a host secret (`PLAYER_HOST_FETCH_SECRET` must never appear in a URL, a log,
  or a request to anything but the host's own route).
- **XSS in served pages.** They run under a nonce-based CSP; a bypass is a vulnerability.

## What we do not

- Findings that require the operator to have already misconfigured the instance in a way the
  documentation warns against — with one exception: **if a plausible typo widens a guard, that is
  a vulnerability**, and we will fix it by normalising the input rather than by documenting it.
  A trailing slash missing from an environment variable already caused one.
- Rate limiting in the standalone context. It is per-process by design and says so; a shared
  counter belongs in the host's wiring.
- Denial of service by volume against your own instance.

## Design notes worth knowing before you test

- The core **fails closed**. A document requiring authentication whose access-wall plugin is
  absent returns 404 — it never degrades into a freely readable document.
- Refusals are **explicit**: an embedded player emits `embed-denied` with a reason, so a host
  cannot mistake "refused" for "unreachable" and fall back to its own viewer.
- The database is reached with a service-role key from the server only. No table carries an
  anonymous read policy; `supabase/init.sql` never creates one.
