# Security policy

## Reporting a vulnerability

Email **security@3d-discovery.fr** with enough detail to reproduce. Please do not open a public
issue — instances of this player serve commercial documents that are not meant to be read by
strangers, and a public report is a starting pistol.

You will get an acknowledgement within 72 hours and an assessment within 7 days. If the report is
valid we will agree a disclosure date with you, and credit you in the changelog unless you would
rather we did not.

## Supported versions

**Only the latest release is supported — for security fixes and for everything else.** This project
is young, releases often, and has one maintainer; there is no long-term support branch, and
pretending otherwise would be a promise nobody here can keep.

| Version | Bug fixes | Security fixes |
|---|---|---|
| Latest release | Yes | Yes |
| Anything earlier | No | **No — a version stops receiving security updates the moment the next release is published** |

That cutoff is abrupt on purpose, and it is workable because of how this project releases: versions
are small, frequent, and upgrading is `npm update` or pulling a new image tag. There is no migration
cost being hidden behind the word "latest". Where a database migration *is* required, it is
documented in [`docs/MIGRATIONS.md`](docs/MIGRATIONS.md) and the running instance says so rather
than degrading silently.

**What that means in practice.** A fix is delivered as a **new release**, never as a patch
backported to an older line. If you are three versions behind when an advisory lands, the remedy is
to upgrade to the current release, not to wait for a fix on yours. The changelog for each version
names the security-relevant changes it carries, so you can see exactly what you gain by moving.

**If this ever changes** — a second maintainer, an operator who needs a supported line — it changes
here first, in this table, before it is promised anywhere else.

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
