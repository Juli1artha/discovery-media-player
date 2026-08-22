# Architecture

One idea holds the whole design: **the core knows nothing about the application hosting it.**
Everything it borrows arrives through a single injected object. That is not architectural
decoration — it is what lets one codebase serve several products without either of them forking
it, and what lets you host an instance whose data never touches ours.

## The layers

```
bin/serve.js          standalone HTTP server — proof the core needs no platform
context/              two ready-made pieces of wiring
  storage.js            where files may be read from (the SSRF guard)
  standalone.js         a working context from environment variables alone
server/               THE PLAYER — requires nothing outside itself
  handler.js            the route: pages, streaming, actions
  shares.js             tracked links
  presentations.js      live presentation
  brands.js             per-client brand resolution
  *.generated.js        browser bundle, built from src/, committed
src/                  browser core, TypeScript, unit-tested
  bridge.ts             ⚠️ MIT — the postMessage contract a host imports
  tracking.ts           reading time, per page
  viewer.ts, live.ts, chat.ts, presentation-*.ts
supabase/init.sql     one replayable file, already hardened
```

`server/**` requiring nothing from outside is enforced by a test, not by discipline. The day it
starts importing its host, extraction becomes a project again.

## Actors and actions

Who can ask the player to do what, and what decides the answer. The column that matters is the
last one: almost nothing in this system is decided by the player itself, and knowing *where* a
decision lives is what tells you where to look when it goes wrong.

| Actor | What they can do | What decides whether it happens |
|---|---|---|
| **Recipient of a tracked link** | Open a document from a link addressed to them; read it page by page | The slug must exist and not be revoked. If the document is behind the access wall, a valid token is required — and if the access-wall plugin is absent, the answer is **404**, never "open anyway" |
| **Internal reader** | The same, from inside the host application | The host's own identity; their reading is stored in a **separate population** and never merged with a recipient's |
| **Presenter** | Start a live presentation, drive the page everyone sees, read attendance | The control token. Without it the presentation can be watched, not steered |
| **Live attendee** | Join a presentation, follow the presenter's page, chat | The presentation must be reachable and not private. Anonymous attendees get browser-chosen `anon-*` keys, capped so one browser cannot invent a crowd |
| **Host application** | Mount the handler, inject the context, decide who its users are and what they may do | Itself. `identity.canManageShares(user, action)` is the host's permission model — **no answer means no** |
| **Operator** | Configure an instance, choose where files may be read from, run migrations | Environment variables only — there is no configuration file, on purpose. `docs/CONFIGURATION.md` is the complete list; a variable absent from it does not exist |
| **Maintainer** | Publish a version | Branch protection, then a tag on a commit belonging to `main`. See [`../MAINTAINERS.md`](../MAINTAINERS.md) |

Three actors are not people, and they are the ones a threat model cares about most:

| System | What it is asked for | What constrains it |
|---|---|---|
| **File source** | The bytes of a document — an object-storage origin, the host's own route, or a local folder | The SSRF guard in `context/storage.js`. A URL outside the allow-listed origins, the configured host route, or the configured local root is refused. This is the highest-value target in the codebase: it takes a URL from a caller and fetches it server-side |
| **Database** (Postgres via PostgREST) | Shares, reading events, presence, chat | Reached **only** from the server, with a service-role key. No table carries an anonymous read policy, and `supabase/init.sql` never creates one |
| **Host route** | Files the host alone can serve | `PLAYER_HOST_FETCH_SECRET`, which must never appear in a URL, a log, or a request to anything but the host's own route |

What the player refuses to decide is as much part of the design as what it does: identity,
permissions, rate limits, branding and logging all arrive through the injected context. That is why
the list above has so few rows owned by the player — and why a host that implements none of the
optional pieces still gets a working, and *closed*, viewer.

Which of these actions are treated as vulnerabilities when a guard fails is enumerated in
[`../SECURITY.md`](../SECURITY.md).

## The injected context

The full list of what a context provides — and which parts are optional — is in
[`API.md`](API.md#what-you-implement). It is **not repeated here**: this page carried a copy that
drifted three capabilities behind the code, which is how a reference stops being one. This page
explains *why* the seam exists; that one says what it is made of.

Two of these carry decisions the player deliberately refuses to make:

- **`identity.canManageShares(user, action)`** — who may send, revoke, or read the analytics of a
  document. That is your permission model, not ours. **No answer means no.** The action is passed
  because hosts separate *sending a document to my own prospect* (ordinary) from *revoking someone
  else's link* (administration). A host without that distinction ignores the argument.
- **`branding.forKey(key)`** — what a client's brand is. The link carries a **reference**, never a
  copy of the logo: a tracked link lives for weeks in an inbox, and a logo frozen at send time
  would not follow a corrected brand.

## Plugins

The AI assistant, brand intro animation and visitor accounts are products of one particular host,
not of the player. They load optionally and every use is guarded. **A test disables all of them
and asserts the core still displays, tracks and presents.** A plugin you cannot unplug is not a
plugin.

One consequence is deliberate and must not be softened: a document requiring authentication whose
access-wall plugin is absent returns **404**. It never degrades into a freely readable document.

## Where files may come from

The file proxy takes a URL from a caller and fetches it server-side. Without a barrier it would be
a universal proxy into the host's private network. It **denies by default** and accepts exactly
three sources:

| Source | Condition |
|---|---|
| Storage object | https, allow-listed origin, canonical **public** object path, no credentials in the URL |
| Your file route | full URL prefix (`PLAYER_HOST_FETCH_BASE`), https, trailing slash enforced |
| Local file | under `PLAYER_LOCAL_ROOT`, symlinks resolved, containment checked on the segment |

The player **never holds a third party's credentials**. If your documents sit behind an API key,
you expose one route and fetch them yourself — allow-listing the third party's origin would hand
the player the right to read anything there, with your key.

## Two populations, never merged

A prospect reading your proposal and a colleague re-reading it in-house are stored separately.
Merged, the second inflates the first and *"this prospect read for 12 minutes"* becomes false —
worse than having no number.

Reading time counts only while the tab is **visible, focused and not idle**. An open tab in the
background is not reading, and a metric that says otherwise is the one people stop trusting first.

## Deploy order

**The player goes out before its hosts, never after.** The reverse makes a feature disappear
everywhere at once, with no error anywhere. A host that needs a newer player says so in its PR
title and cannot merge before the corresponding instance is deployed.

## What the boundary is written down in

[`HOST-CONTRACT.md`](HOST-CONTRACT.md) — the contract with host applications, in French: five rules, the
v1 surface, a dated journal of every change to the boundary, and the requests hosts have made.
It is the file both sides read before touching integration. [`API.md`](API.md) is the English
reference for the same surface; when the two disagree, the contract wins.
