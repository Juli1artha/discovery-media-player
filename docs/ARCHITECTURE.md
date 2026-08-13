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

## The injected context

```js
player.init({
  storage:  { isAllowedUrl, fetchFile, put },
  db:       { request, selectAll },
  identity: { verifyToken, roleOf, isAdmin, canManageShares },
  branding: { name, poweredBy, loaderName, logo, forKey, title },
  limits:   { allow },
  mail:     { send },
  errors:   { capture },
  legal:    { sourceUrl, legalUrl, privacyUrl, trackingNotice },
  config:   { supabaseUrl, supabasePublishableKey, mapsKey, extraFrameAncestors },
  plugins:  { /* optional, host-owned */ },
});
```

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
