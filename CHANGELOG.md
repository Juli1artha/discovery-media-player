# Changelog

Notable changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/),
versioning follows [Semantic Versioning](https://semver.org/) — newest first.

The **host contract** has its own version, independent of the package version: it appears as
`contract` in `GET /api/doc?contract=1` and changes only on a break. See
[`docs/HOST-CONTRACT.md`](docs/HOST-CONTRACT.md).

Each released version below is also a [GitHub Release](https://github.com/Juli1artha/discovery-media-player/releases);
the notes there are this file's section for that version.

## [0.1.39] — 2026-08-16

### Fixed
- ⚠️ **A document displayed on a second screen was counted as an absence.** `viewable()` required
  `doc.hasFocus()` — and `hasFocus()` answers *"the user is typing here"*, not *"the user is
  looking"*. A reader with the document visible for forty seconds while working on the other screen
  was credited **two seconds**.

  ⚠️ This never was an internal-population problem. A prospect keeping a brochure open while it is
  discussed over the phone is the **central** use of a shared link, and it measured as absence. The
  function promised *reading time* and returned *typing time*.

  `visibilityState` read `visible` throughout: the right signal was available, overridden by a
  stricter condition answering a different question.

  ⚠️ **What remains is deliberate.** The idle threshold is now the *sole* thing separating a reader
  from a forgotten tab, so a document read with no interaction at all counts at most `idleMs` — 60 s
  by default. Better than zero, less than a real ten-minute reading. Raising it would measure
  passive reading better *and* credit an abandoned tab for longer: that is a decision about what
  "reading" means, and it is written next to the option rather than taken alone.

  *Found by the second host on a real reading — 26 s of presence, 2 s counted — after a first
  diagnosis ("the frame had no focus") that the reader themselves corrected.*

- **`start()` began counting without checking visibility.** A document opened in a background tab —
  a link clicked with Cmd, a session restore — started counting before ever being seen, and the
  idle cap still credited it `idleMs`. One minute of reading for a tab nobody looked at. `commit()`
  already made that check; `start()` did not.

  *Found by the test written for the second-screen case, which was looking for something else.*

### Note
- ⚠️ **`main` had been failing CI since 0.1.36**, and three versions shipped on top of it: a test
  in the browser suite read files through `node:fs`, which vitest runs happily and `tsc` refuses.

  I did not see it because **I was counting passes instead of looking for failures** — `gh pr checks
  | grep -c pass` returns 6 whether or not something else failed beside it. A count of successes
  says nothing about failures. It is the same mistake this repository has been documenting in its
  own guards for two days, made on the tool meant to watch them.

  Disk-reading assertions now live in the server suite, where they belong. I put one back in the
  browser suite ten minutes after fixing the first — the rule is simple, and writing it down did not
  stop me breaking it twice.

## [0.1.38] — 2026-08-16

### Fixed
- ⚠️ **The guard written in 0.1.37 missed a case, and it missed it the same way the guard it
  replaced did.** It filtered on a **list of names** of write helpers; `recordUnlock` writes
  straight through `PLAYER.db.request`, so it went unseen — a silent catch swallowing a visitor
  unlock journal entry. That is exactly what the audit held against the prototype guard (*"it
  filtered on variable names"*), reproduced the same day in a guard written to prevent this class
  of thing.

  Found by checking the **published tarball** of 0.1.37, not by the guard.

  The rule now targets the **form** — any database write caught in silence — rather than names. A
  list only sees what was put in it; a form also sees the next one.

  ⚠️ **Writes only.** A lost write is lost forever; a failed read is retried on the next call. A
  catch that drops a display counter to zero is a legitimate choice; a catch that loses a
  measurement never is. The first version of the form accused both — too broad in one direction
  after being too narrow in the other.

### Note
- **This probe was wrong three times before it bit**, and every error was found by running it, never
  by re-reading it: bounded by characters (a long comment pushed `capture(` out of view, and it
  accused the corrected code); by a fixed number of lines (it spilled into the *next* block and
  found a `capture(` that was not its own); and without a function boundary (a write that is
  correctly *not* wrapped had the following function's catch attributed to it).

  A guard is worth exactly what its reading is worth. That is the whole lesson of this version, and
  it applies to the guard as much as to the code it watches.

## [0.1.37] — 2026-08-16

### Fixed
- ⚠️ **Internal reading tracking had never written a single row — on either instance.** The row
  carried `ua` and `ip`; the internal-sessions table has neither. PostgREST refused
  (`column "ua" ... does not exist`), the caller's `catch { /* best-effort */ }` swallowed the
  refusal, and the route answered `{"ok":true}`. **Our own production table held zero rows.**

  ⚠️ **The schema was right and the code was lying.** An *internal* reading is a colleague:
  `device`, `os` and `browser` — derived — describe it well enough, and one does not keep the full
  user-agent or the address of one's own team. The *external* sessions table carries them, because
  that is neither the same population nor the same promise.

  Fixing it by **adding the columns** would have done the opposite: raising the schema to the level
  of the code instead of the code to the level of the intent. What you keep about your own teams is
  not decided by a PostgREST error message.

- ⚠️ **A rule written in a comment does not protect the code that follows it.** In 0.1.35 we wrote,
  inside `upsertInternalSession`: *"the guard was not the problem; its muteness was."* Three lines
  below, in the calling function, `catch { /* best-effort */ }` swallowed the failure of the write
  itself.

  "Best-effort" is a sound intention — a measurement must never stop someone reading a document.
  But best-effort does not mean **mute**: what is caught there is the right to *continue*, never the
  right to *say nothing*. Both catches now report, once an hour, naming the cause.

  The rule became a **test** rather than a comment: `ecritureMuette.test.js` refuses any silent
  catch around a measurement write. It immediately found the twin on the external path — harmless
  so far, since that table does have the columns, but it would have swallowed the next mismatch the
  same way. **What makes the class dangerous is not the instance.**

  *Found by the second host, reproduced by replaying the insert.*

### Note
- The guard's own probe was wrong twice before it bit: it bounded the catch body by characters
  (a long comment pushed the `capture(` out of view, and it accused the corrected code), then by a
  fixed number of lines (it spilled into the *next* block and found a `capture(` that was not its
  own). A guard that reads beside the point guards nothing — established by mutation, not by
  reading.

## [0.1.36] — 2026-08-16

### Fixed
- ⚠️ **The internal-session quota could not hold a single reader.** The browser writes one session
  every 12 s — **300 per hour for one person** — and the server allowed **120 per hour per address**.
  The limit therefore sat *below* what one legitimate reader consumes: after 24 minutes of
  continuous reading, everything was refused. And since the key is the address, a team behind a
  single internet egress — the *ordinary* case for a company, not the edge case — shared a quota
  that one person alone exceeds.

  ⚠️ **The guard was right in its shape and wrong in its number**, which is exactly why nobody
  re-read it: we re-read what looks doubtful, not what looks reasonable.

  ⚠️ **And the refusal was silent.** The 429 appears only in the reader's console; the hourly log
  named the missing field, never the quota. An operator saw a table that would not fill, with no
  cause attached — the very symptom we had just fixed elsewhere. It is now reported once an hour,
  naming the quota, **before** the `return` rather than after it (the linter caught that one:
  `Unreachable code`).

  The cadence and the quota were two halves of one contract written in two places. They now live in
  `src/cadence.ts`, inside the **shared** module whose own generated header already said why: *"two
  implementations of one contract always end up diverging in silence."* The quota is **derived**
  from the cadence — changing one moves the other.

  ⚠️ **The key stays the address**, and that is not an oversight. A session id is chosen by the
  browser; a quota keyed on it is bypassed by rotating it — the `X-Forwarded-For` lesson of 0.1.22,
  where the limit existed and limited nothing. **A limit can only rest on what the caller does not
  choose.** It was the number that was wrong, not the key.

  *Found by the second host, on their instance, while looking for why their table stayed empty.*

### Changed
- The shared bundle takes an explicit entry point. `SHARED_SOURCES` and the esbuild entry were the
  same list, so adding a file made it count toward the cache-busting hash **without being bundled**:
  the file would exist, the hash would change, and the import would fail only at runtime.

## [0.1.35] — 2026-08-15

### Fixed
- ⚠️ **The lock had no keyhole.** 0.1.22 added `verifyInternalToken`, which reads `body.it`, and
  announced that `PLAYER_INTERNAL_STRICT=1` "closes the door entirely". That was true of the
  **check** and false of the **system**: no path allowed a host to *supply* that token. The preview
  route read `uemail`, `docId`, `name`, `title`, `by`, `av`, `resume`, `autopresent` — no token —
  and `CFG.internal` carried only `{email, name, docId}`.

  Setting the variable would therefore have refused **100% of internal sessions on every
  instance**, ours included. And that is why "strict analytics by default" — the next item on the
  audit's list — could not be shipped: it would not have hardened hosts, it would have cut them off.
  A lock nobody can close is not a transition, it is an announcement.

  A host can now pass `it` on the preview route; it travels through `CFG.internal` and comes back
  in the body, where the check has been waiting since 0.1.22.

  *Found by the second host, while preparing the very token we had asked them to sign.*
- **A silent rejection cost a host weeks.** An internal session without a `docId` is dropped — the
  guard is right, a session with no document measures nothing — but it said nothing. That host
  brought up their internal tracking, believed it live, and found out much later that the table was
  empty: their `docId` never left, and every heartbeat was discarded in silence.

  ⚠️ The guard was not the problem; its muteness was. **A measurement that reports nothing is
  indistinguishable from a measurement with nothing to report** — nobody goes looking for a failure
  no signal announces. It is now reported once an hour, naming the missing field, exactly like the
  unsigned-session gap of 0.1.22. An abnormal state left unsaid becomes the normal state.

## [0.1.34] — 2026-08-15

### Security
- **A proven identity now replaces the claimed one instead of sitting beside it.** `isPresenter` and
  `isMember` have been verified since 0.1.25/0.1.28, but `name`, `email` and `avatar` still came
  from the request body — **even when a valid token accompanied the call**. An authenticated member
  could therefore post under a colleague's name and address, *with the member badge*: the visible
  attribution said someone else.

  ⚠️ It granted no rights — editing and deleting are authorised by `author_hash`, not by the email
  (`editMessage`), so a spoofed address never took control of anyone's message. The damage is
  attribution, not takeover. That is enough: in a conversation, a message signed with someone
  else's name **is** the problem.

  A host can supply `identity.profileOf(user)` to say how to read *its* user; without it the core
  reads the usual shapes, and the email — which is universal — is always taken from the token.

  A visitor with no token keeps the name they typed. That is the intended mode: they are announcing
  themselves, not proving anything, and the badges stay off.

  *Reported by the second audit pass (P1-6).*

### Note
- The opaque author id the report also suggests — so that author emails stop being broadcast to the
  whole audience when the interface never displays them — needs a column and a migration path for
  existing messages. Tracked, not done here: `author_email` currently carries `isMine()`, which
  decides whether the edit and delete controls appear.

## [0.1.33] — 2026-08-15

### Security
- ⚠️ **An alert is not a prohibition.** 0.1.21 introduced `PLAYER_PUBLIC_URL`, fell back to the
  `Host` header when it was missing, and *logged* the fallback. That was the right compatibility
  reflex and the wrong conclusion: a log entry does not stop a phishing email. A misconfigured
  instance kept sending — signed with its brand, with a button pointing wherever the reader chose —
  and the operator found out from an abuse report.

  The send is now **refused**: `sent: false`, `sendRefused: "public-url-unconfigured"`.

  ⚠️ **What is refused is the send, not the link.** The child link is still created, tracked and
  returned, so the caller can forward it themselves. What is withheld is the only part that cannot
  be taken back — mail leaving our servers with our domain in the header and our sender reputation
  behind it. The compatibility argument from 0.1.21 therefore did not hold: refusing the send does
  not break link creation, which is this route's main function.

  *Reported by the second audit pass (P1-1).*

### Fixed
- **The test had encoded the fallback**, and so protected the hole: it required "no public URL:
  falls back to Host, but logged" — that is, it required the email to go out anyway. It is the
  fourth test today found pinning a defect while believing it described a property.

## [0.1.32] — 2026-08-15

### Security
- ⚠️ **One table row could poison a whole process.** The aggregators were plain objects indexed by
  data from outside — document ids, emails, session ids — and the shape `X[k] = X[k] || {…}` is
  enough:

  `byDoc["__proto__"]` does not return `undefined`, it returns `Object.prototype`, which is
  **truthy**. The `|| {…}` therefore never fires, `a` *becomes* the prototype, `a.opens++` writes
  `Object.prototype.opens = NaN`, and `a.readers.add(…)` throws on `undefined`.

  The `TypeError` is visible. **The property left on the prototype is not**, and it survives the
  request: on a warm serverless instance every object in the process then carries an `opens`, and
  any `if (x.opens)` elsewhere silently changes meaning.

  ⚠️ `user_email` is reachable **without authentication** as long as `PLAYER_INTERNAL_STRICT` is
  unset (0.1.22), and `session_id` is written by the reader. Not theoretical.

  Every aggregator is now a `Map` — keys are data, not property names — and every browser-side
  dictionary is built with `Object.create(null)`, including `typers`, which is fed by `typing`, the
  one event that still trusts its sender. Uniformly, including the sites that were not reachable:
  an aggregator that has to justify itself case by case eventually gets a case wrong.

  *Reproduced and reported by the second audit pass (P1-2).*

### Fixed
- **The static guard that missed it.** It filtered on a **list of variable names** — `body`, `q`,
  `emoji`, `name` — and `id`, `k`, `sid` were not in it, so all of `shares.js` went through. It now
  excludes only what is certainly internal (loop counters) rather than listing what comes from
  outside, and it looks for the object's **declaration** instead of scanning 25 lines back: a window
  approximates scope, a name is exact. It found nine further sites, all fixed here.

  ⚠️ It remains an alarm. The barrier is `clefsHeritees.test.js`, which exercises the five inherited
  keys against running code — as the report put it, a regular expression over variable names can
  only ever be a complementary alarm.

## [0.1.31] — 2026-08-15

### Fixed
- ⚠️ **The signal went out before the write, and the comment claimed the opposite.** `pushPage`,
  `presentContent` and `endPresent` broadcast first, then started the write. Since 0.1.19 that
  signal says only one thing — "re-read" — so the audience re-read while the database still held
  the old state, and **no second signal was guaranteed**: the page turn was lost until the 25 s
  resynchronisation.

  `endPresent` was the worst of the three: it signalled, then **cut the channel**, then sent the
  end notice. The signal left on a stale state and the disconnect preceded the send — an audience
  could simply never learn the presentation had ended. `sendBeacon` cannot be awaited, but it
  returns once the request is *queued*; signalling right after it, then disconnecting, respects the
  order as far as that transport allows.

  Delaying the signal by one round-trip costs nothing, since it only ever meant "re-read". Sending
  it too early cost both a pointless re-read **and** the change itself.

  *Reported by the second audit pass (P0-3).*

### Changed
- **The state signal no longer carries a state.** The audience ignored it already (it re-reads), but
  a payload that travels without serving gives the impression that it serves, and invites the next
  person to use it. Same reasoning as `map` in 0.1.30: cut the path, not just the use.

### Note
- The tests here compare **positions** — where the write sits relative to the signal in each
  function — rather than searching for a string. Three tests today had pinned a defect while
  believing they described a property; this one fails when the original order is restored, which is
  the only thing that makes it worth writing.

## [0.1.30] — 2026-08-15

### Security
- ⚠️ **The map position no longer travels in the broadcast.** It did, and the audience applied it
  as-is. The channel being public, **any participant could move everyone's map**, with coordinates
  of their choosing. 0.1.19 granted that exception on the grounds that the signal is "ephemeral,
  with no server truth to check against". The argument does not hold: **during map mode, that
  signal is the image the audience sees.** `typing` can stay cosmetic; `map` cannot.

  The presenter now persists its position through the JWT-gated route and emits an **empty**
  signal. The audience re-reads the state and applies what the server gives it. A hostile
  participant can still emit: they trigger a bounded re-read and obtain nothing.

  ⚠️ **The obstacle was that persistence was a debounce**, not the broadcast. `schedPersist` pushed
  the write back 700 ms on every movement, so during *continuous* panning it never fired — which is
  precisely why the position had to travel in the broadcast. It now uses the same bounded scheduler
  as the re-read: at most one write per 500 ms, and **always the last position**, so the audience
  follows during the movement and not only once it stops.

  **Live map following becomes stepped rather than continuous** — about twice a second. That is the
  price of nobody but the presenter driving the audience's screen, and it is the right price.

  The payload path is removed rather than merely ignored: leaving it would be defence by accident,
  and the day someone reconnects a parameter the public payload would be trusted again with nothing
  to say so.

  *Reported by the second audit pass (P0-1).*

### Fixed
- **A test had endorsed the exception.** It asserted that `map` "still applies the payload —
  ephemeral, no server truth", and it would have stayed green after the fix: it read the Live
  layer's handler, which forwarded `p.payload` regardless. The sweep now names the events that
  trust their sender, and `typing` is the only one left — it will have to justify itself on every
  reading of that file.

## [0.1.29] — 2026-08-15

### Security
- ⚠️ **The re-read could be starved indefinitely.** Since 0.1.19 the whole defence of the public
  Realtime channel rests on one move: stop believing the transport, re-read the source of truth.
  That re-read was a debounce — `clearTimeout` then `setTimeout(…, 120)` — so **every signal pushed
  the deadline back**. A participant broadcasting every 100 ms postponed it forever.

  Starving the re-read falsifies nothing; it simply stops the audience learning anything. Pages
  stop turning, the chat freezes, and **no error says so** — the hardest kind of failure, because
  everything looks like it is working. The comment above it read "grouped: ten broadcasts in a row
  must not produce ten requests". The intent was right; the shape inverted it.

  The opposite direction was open too: signals spaced slightly wider than the delay produced one
  HTTP request each, **per connected viewer**. The public channel became an amplifier aimed at the
  API.

  It is now a bounded scheduler with four properties, each exercised on running code: a pending
  deadline is never pushed back, one request in flight at a time, never more than one run per
  interval, and **the last signal is always served** — bounding without that would drop the signal
  that mattered.

  ⚠️ The fix is in how the delay is computed, not in removing `clearTimeout`: the wait is measured
  from the last *run*, not from the incoming signal, so the deadline is **absolute** and
  rescheduling cannot postpone it. Established by mutation — reintroducing the original shape fails
  five tests.

  A slow resynchronisation (25 s) now catches a lost signal. Bounding the rate makes losing one
  possible; the safety net is the price of the bound, not an optimisation.

  *Reported by the second audit pass (P0-2).*

### Fixed
- **A test was pinning the defect as a feature.** It asserted that `clearTimeout(_relEtat)` appeared
  in the source — the exact line that allowed the starvation — believing it checked "re-reads are
  grouped". It checked a *shape* and would have rejected the fix. The properties are now exercised
  on executed code; the source-level test only confirms the page uses that scheduler.

## [0.1.28] — 2026-08-15

### Security
- ⚠️ **The state route published the presenter's email address.** 0.1.25 added `presenter_key` to
  `GET ?state=1` — a public route, read by every anonymous viewer of a share link. That key comes
  from `attendeeKey()`, which returns **the email address** whenever the participant has one. The
  field had a technical name and nobody, myself included, went to look at what it contained — on
  the very route whose comment promises "only what the audience must know".

  ⚠️ **And it was not a proof either.** The badge compared that key to the `uid` in the *presence*
  payload, which the client composes. Read the public key, announce yourself with it, wear the
  title. 0.1.25 had replaced "the client declares its role" with "the client declares a value the
  server handed it" — more laborious to exploit, no more true.

  The participant list now carries **no badge at all**. The presenter is displayed separately, from
  `presenter_name` — set by the host, compared to nothing.

  *The false proof was reported by the second audit pass (P0-4). The leak was not in it: it was
  found by following the value rather than the name.*

### Note
- The methodological line this version pays for, in the auditor's words: **a value coming from the
  server is not automatically a proof if the client can choose what it will be compared against.**
- The `vm.Script` guard added in 0.1.26 caught the removal itself — deleting the badge expression
  left a `++` in the template. Second catch in a day, on the day it was written.

## [0.1.27] — 2026-08-15

### Security
- **One host's `localStorage` key was hard-coded for every other host.** `3dd-supabase-auth` — the
  3D Discovery studio's session key — appeared in five places in this package. On any other host,
  `detectMember()` and `accessToken()` therefore found nothing: **none of its members were
  recognised as members**, and the separation of internal from external populations that this
  product sells worked only on ours.

  ⚠️ Since 0.1.25 that key also carries a **security** property — it is how membership is proven.
  One host's constant had become load-bearing for all of them.

  It is now `config.hostAuthStorageKey` (`PLAYER_HOST_AUTH_STORAGE_KEY`), and the default is
  **empty**: no key declared, no member detected, therefore nothing to impersonate. Defaulting to
  `3dd-supabase-auth` would have kept *our* instance running while leaving the design flaw intact,
  and the next host would have discovered it the way the second one did — by noticing that its
  statistics separate nothing.

  ⚠️ **This is a transition, not a solution.** Reading another application's `localStorage` cannot
  work across origins: the second instance lives on `doc.…` and its application on `app.…` — two
  storages, and no configuration value will bridge them. The right mechanism is for the host to
  *inject* its member when the page is rendered, the way it already injects its brand. Tracked in
  [`docs/AUDIT-2026-08-14-SUIVI.md`](docs/AUDIT-2026-08-14-SUIVI.md).

  *Found by the second host, from its own instance.*

### Changed
- **The player's Realtime client now declares its own `storageKey`** (`dmp-live-auth`) instead of
  taking the default. That client will one day hold an anonymous session (private channel); if it
  wrote under the default key and the host's application used it too on the same origin, the
  anonymous session would **overwrite the signed-in member's**. The two already differ on our
  instance — by happy accident. Declaring it makes intentional what was only a consequence, and a
  topology can change.
- The guest identity moves from `3dd-present-me` to `dmp-present-me`. It belongs to the player, so
  it now carries the player's name rather than someone else's. A guest who had entered their name
  will be asked once more.

## [0.1.26] — 2026-08-15

### Fixed
- ⚠️ **0.1.25 shipped an inline script that does not parse.** An edit produced `return var h2={…}`,
  and the whole block stopped compiling — no chat, no presence, no state re-read. The live layer was
  dead in that version. **Upgrade past it.**

  This repository already had a test that *executes* the rendered page, and it swallowed the error:
  its `catch` exists for scripts whose dependencies (pdf.js) are missing outside a browser, and a
  `SyntaxError` came through the same door. Parsing and executing are now separate questions —
  **compiling must never throw**, executing is allowed to. `new vm.Script` answers "is this valid
  JavaScript" without needing a single dependency.
- **A missing presenter key no longer costs the whole state.** `presenterKey` added a query to a
  route the audience depends on to know which page is displayed. One more query is one more reason
  to answer 500 — and losing the entire state because we could not say who wears a badge is a bad
  trade. No answer now means no key, therefore no title, and everything else still goes through.

  *Both found by the **host's** tests, rendering the page from the installed package — not by this
  repository. The same imbalance as 0.1.20. Both guards have been brought back here, at the source.*

## [0.1.25] — 2026-08-15

> ⚠️ **Ne pas utiliser cette version.** Elle publie aussi l'e-mail du présentateur sur une route
> publique (corrigé en 0.1.28). Son script en ligne ne se parse pas : la couche live
> (chat, présence, relecture d'état) est morte. Corrigé en 0.1.26.

### Security
- **The presenter title was claimed, not proven.** The audit names the attacker precisely: *any
  participant who knows the slug*. ⚠️ That wording disqualifies the fix that looked obvious —
  making the Realtime channel private. A private channel excludes whoever has no right to be
  there; this attacker **has** the right, they hold the link. What separates them from the
  presenter is not channel access, it is the `control_token`.

  Three places granted status without checking it:

  - **`present-attend` took `isPresenter` *and* `isMember` straight from the request body.** A
    prospect could count themselves as a colleague — polluting the very separation of populations
    this product sells — and take the presenter title in the attendance table.
  - **`present-chat` verified `isPresenter` against the control token but left `isMember` to the
    caller.** Two weights on one line: the presenter badge had to be earned, the colleague badge
    could be asked for.
  - **The participant list rendered "presenter" from the *presence* payload**, which each
    participant composes: `track({role:'presenter'})` was enough to appear as the presenter to the
    whole audience, with the name and avatar of one's choosing.

  ⚠️ That third one cannot be fixed at the channel level — a legitimate participant is entitled to
  write *their own* presence. The title now comes from the server, which alone knows who proved the
  control token, and the audience compares a key rather than believing a claim. **No key, no
  title**: better none than a stolen one.

  Membership is now proven by the session's access token. This route is a `fetch`, so it can carry
  a header — unlike reading analytics, which leave through `sendBeacon` and therefore sign in the
  body (0.1.22). No fallback to what the caller asserts: a check that yields to the claim it was
  meant to replace only ever protects the honest.

  The two attendance flags also stop being frozen at the first heartbeat. Frozen, they described
  the moment someone arrived rather than the truth — a handover changed who held the title and the
  record did not follow, and the first to arrive was right forever.

  *Closes the remaining half of P1-2 (presence) and the part of P0-2 that a private channel would
  not have closed.*

### Note
- A page open from before this version keeps sending the old body: it will simply lose the badge
  until it reloads. Degrading toward "no title" is the intended direction.

## [0.1.24] — 2026-08-14

### Security
- **One long address froze the whole instance.** Re-sharing validated the recipient with
  `/.+@.+\..+/`. That pattern restarts at every position, so its cost grows with the *square* of
  the length — measured before fixing: 49 ms at 10 000 characters, **3 900 ms at 100 000**. Node has
  one event loop and a regular expression does not yield: one request, four seconds of frozen
  instance, for every reader — not only the caller.

  ⚠️ The rate limit did not help: 8/h per IP is checked **after** the pattern, two lines below. A
  guard placed behind what it is meant to guard guards nothing. The length is now checked first, at
  254 — the maximum length of an address (RFC 5321), past which it is not "long", it is invalid.

### Fixed
- **A local read could describe one file while sending another.** `readLocal` did `stat(path)` and
  then, further down, `open(path)` — two resolutions of the same *name* at two moments. Between
  them the file can be replaced (a sync, a deployment `mv`, a client rewriting their document), and
  we would then send the bytes of the **new** file with the size of the **old** one. Not a crash —
  worse: a `Content-Range` that does not describe what it carries, so the viewer assembles a wrong
  document and nothing reports it. A descriptor designates an object, not a name: `fh.stat()` now
  speaks about the same file `fh.read()` does.

### Documentation
- `allow_download` is stated for what it is: a **display preference**, not a protection. A reader
  looking at the document already has its bytes; hiding the button removes a convenience, not an
  access. A document that must not leave should not be shared, or should be shared behind
  `require_auth` — that one decides who gets the bytes. (P3-3)
- The Express example says why there is **no rate limiter** in front of the player routes, rather
  than leaving the absence to be read as an oversight: the player already limits per action, and
  limiting a shared link by IP shuts the document to nineteen people out of twenty behind one
  office NAT. What must be limited is what the host adds around it.

  *The first two reported by static analysis; neither appeared in the external audit.*

## [0.1.23] — 2026-08-14

### Security
- **The postMessage bridge accepted messages from any window.** An origin check is impossible here
  — the player is framed by hosts on arbitrary domains and does not know its host's origin when it
  starts listening, which is why the check had been dropped. But comparing the **source window**
  needs no origin: either it is the window you expect, or it is not. Without it, any tab or frame
  holding a reference could send `close`, `share` or `handover-done`, and the page treated them as
  coming from its host.

  Player side, it is closed **by default** — the only legitimate sender is `window.parent`, and no
  host has code to change. Host side the parameter is optional: forcing it would silence messages
  for every host that has not passed it yet, and a message that stops arriving is the worst way to
  announce hardening.
- **The chat author token came from `Math.random()`.** That token *authorises* — it proves "this
  message is mine" for editing and deleting. `Math.random` is deterministic from the engine's
  internal state, so guessing another participant's token means rewriting their messages. Now from
  `crypto`, with a fallback that **warns** rather than degrading in silence. The analytics session
  id follows the same rule: it is the upsert key, so guessing one overwrites someone else's
  measurement.

### Changed
- The user-agent string is bounded before parsing. Static analysis flagged `Android.*Mobile` as
  backtracking-prone; measured first, V8 handles it linearly even at 200 000 characters, so this
  was not a real slowdown. Bounded anyway — the stored column was already truncated to 300, only
  the parsing saw the whole string, and feeding an unbounded length into a regular expression is a
  habit that eventually costs.

  *All three reported by static analysis; the first two also by the external audit (P3-1, P3-2).*

## [0.1.22] — 2026-08-14

### Security
- **The internal reading population was open to anyone.** It is the population this product
  promises never to mix with prospects — "this client read for twelve minutes" is worth something
  only if a colleague re-reading the document does not land in the same count. Yet the route
  accepted any email, any document, any duration, with no token and no limit: "this colleague read
  this document for three hours" could be manufactured with one request.

  ⚠️ **A JWT was not an option.** Reading analytics leave through `sendBeacon`, the only transport
  that survives a closing tab, and it cannot carry a header — requiring one would lose the
  measurement at the exact moment it matters most. The proof therefore travels in the **body** and
  comes from the host, who alone knows who its member is: an HMAC over `{email, name, docId, exp}`
  signed with the secret the host already holds. When it is present, its claims win and the
  caller's are ignored. `exp` is required — a signature without expiry would outlive the member.

  `PLAYER_INTERNAL_STRICT=1` closes the door entirely. It is **not** the default, because that
  would break every instance already running, including ours; without it the write is still
  accepted, but bounded, rate-limited, and **reported once an hour** so the gap is visible in the
  logs. An open door nobody mentions is a defect; an open door stated, with the lock supplied, is
  a transition.

  Client-asserted numbers are now bounded regardless: page counts, durations, and the free-form
  per-page object — which had no ceiling at all, so a single call could write a JSON of any size,
  as often as it liked.

  *Reported by an external audit (P1-2). The presence claims `isMember` / `isPresenter` remain and
  are tracked separately.*
- **A property name written from client input** (`toggleReaction`). In 0.1.2 a whitelist indexed by
  outside data let `constructor` through, because an object literal answers for its prototype; the
  fix put `Object.hasOwn` everywhere and a static test refused any unguarded **read**. It covered
  half the shape: `Object.hasOwn` stops you *reading* `constructor`, and nothing stopped you
  *writing* it.

  What saved us from the worst was an accident — the 8-character cap truncates `__proto__` (9) and
  `constructor` (11) into harmless keys. But `toString` (8) and `valueOf` (7) got through and
  became own properties of the stored object, shadowing the prototype's for every consumer,
  browser included. ⚠️ That accidental protection is fragile: composed emoji (family, ZWJ
  sequences) exceed 8 characters, so raising the cap to accept them — an innocuous cosmetic change
  — would let the real keys in.

  Two barriers now: identifier-shaped keys are refused outright, and the object is built with no
  prototype at all, so there is nothing left to shadow or reach whatever the cap becomes. **And the
  static guard now sweeps writes, not only reads** — without it, the next `obj[outsideValue] = …`
  passes exactly as this one did.

  *Found by static analysis. Neither the external audit nor we had seen it.*
- **Rate limits keyed on a header the caller writes.** Eleven places took the first value of
  `X-Forwarded-For` to identify the caller. A client reaching the server directly — the standalone
  case, and any instance whose proxy does not rewrite that header — changed it per request and was
  never limited. **The limit existed; it limited nothing**, which is worse than no limit because it
  gives assurance.

  The caller's address is now a host decision (`identity.clientIp`), since only the host knows
  whether a proxy sits in front. Unset, the header is ignored entirely and the socket address is
  used — **an instance without a proxy is protected without doing anything**.
  `PLAYER_TRUSTED_PROXY_HOPS=1` reads from the **end** of the chain, not the beginning: the
  beginning is what the client wrote, the end is what the proxies observed. Reading the first
  element is the classic mistake with this header, and it is the one the code made.

  *This also makes the new limit above real: without it, the internal-session throttle would have
  been bypassable by the same trick it was meant to stop.* (P1-6)

## [0.1.21] — 2026-08-14

### Security
- **Email links no longer come from the `Host` header** (`PLAYER_PUBLIC_URL`). The client chooses
  that header: on the standalone server, or behind a proxy that does not rewrite it strictly, a
  reader could request a perfectly legitimate send — signed by the host, carrying its brand and its
  sender reputation — **whose button points at their own domain**. Phishing supplied turn-key, to a
  recipient the attacker picks, and the victim has no reason to suspect it. Unset, the player falls
  back to `Host` so no running instance breaks, and **says so**: an instance sending mail without a
  public URL should learn it before a phishing report teaches it.
- **`isEvalSupported: false` forced on every PDF render.** The pinned pdf.js is within the range of
  CVE-2024-4367 (script execution when opening a crafted PDF). Our CSP does not allow
  `unsafe-eval`, which blocks the path today — but that mitigation was **implicit**, and one CSP
  edit would have reopened it without a word. The protection no longer depends on a header written
  somewhere else.

  *Upgrading pdf.js is not a version bump: cdnjs ships only ES modules from 4.0, while we load a
  classic script and configure the worker by hand. That migration is tracked separately, together
  with bundling the library — which also settles the CDN-without-integrity finding.*

  *Both reported by an external audit (P1-1, P1-3).*

## [0.1.20] — 2026-08-14

### Fixed
- **The unread badge stopped counting.** 0.1.19 routed chat broadcasts through a re-read, and the
  re-read added the messages without ever notifying — so a new message arrived silently. The
  condition matters as much as the call: a re-read returns the whole history, so notifying without
  checking what was *actually* added would recount every message on every re-read, which is the
  "badge goes up by 2" defect fixed back in 0.1.2 returning through another door.

  *Nobody here saw it. **A host's test caught it**, by reading this package's source once installed
  — across the boundary of two repositories. That guard was written for a different reason and
  still did its job.*

## [0.1.19] — 2026-08-14

### Security
- **A presentation broadcast is now a signal, not a truth.** The Realtime channel is **public**:
  the publishable key and the slug are both in the page, so any participant can emit on it. The
  audience applied the received payload directly, which let any viewer announce the end of the
  presentation, change the page or document shown to everyone, lock the chat, or post a message
  signed with someone else's name.

  ⚠️ **Moving emission to the server would not have fixed this** — that was the audit's first
  suggestion. On a public channel an attacker still emits, and the client cannot tell the two
  sources apart. The only defence that holds is to stop believing the transport: authoritative
  events now trigger a **re-read from the server**, which was already the source of truth
  (`state=1`, `chat=1` — both routes already existed). An attacker can still emit; they trigger a
  re-read and obtain nothing. That property also survives a future flaw in the transport itself.

  `map` and `typing` still apply their payload, deliberately: ephemeral signals (live map
  movement, "someone is typing") with no server state to check against and a high rate.
  Re-verifying them would cost a round-trip per mouse move to protect a mouse move. Everything
  authoritative goes through `state`, which is re-read. A test enforces that **no other event**
  may trust its sender.

  *Reported by an external audit. A private channel with row-level policies remains the cleaner
  end state and is tracked in [`docs/AUDIT-2026-08-14-SUIVI.md`](docs/AUDIT-2026-08-14-SUIVI.md);
  it needs short-lived tokens for an anonymous audience, which is infrastructure rather than a
  fix — hence this first.*

## [0.1.18] — 2026-08-14

### Security
- **The file proxy followed redirects, and the host secret followed with it.** `isAllowedStorageUrl`
  validated only the *initial* URL; `fetch` then followed redirects by default, so the final
  destination faced no origin list, no route prefix and no `https:` check. An allowed upstream —
  the host's own file route, or any listed storage origin — answering `302` took the call wherever
  it wanted: `localhost`, a private address, a cloud metadata endpoint. The invariant this project
  documents ("no redirect following into your private network") was false.

  ⚠️ **And `x-player-fetch-secret` travelled.** `fetch` strips only `Authorization`, `Cookie` and
  `Proxy-Authorization` across a cross-origin redirect; a custom header is forwarded as-is.
  Measured with two local servers before fixing: the destination received the host's shared secret
  in clear. That is not only an SSRF — it is exfiltration of the key that authorises reading
  **every** document the host serves.

  Redirects are now followed by hand, with three properties: every hop re-passes the full guard, so
  a redirect opens nothing the starting URL could not; **the secret is recomputed per hop**, so it
  travels only where *that* hop is under the host's route; and the chain is bounded, with protocol
  changes refused — a redirect to `file:` would have turned a remote upstream into a local disk
  read. `AbortSignal.timeout` added: an upstream that never answers used to hold the request
  forever.

  *Reported by an external audit, confirmed by measurement rather than by reading.*

## [0.1.17] — 2026-08-14

### Security
- **`form-action 'self'` added to every page.** `form-action` is one of the few CSP directives
  that does **not** fall back to `default-src`: a page served with `default-src 'none'` could still
  post a form to any domain. No page here contains a `<form>` — submissions go through `fetch`, so
  `connect-src` governs them — but an injected script could build one to exfiltrate, and nothing
  stopped it. `'self'` rather than `'none'`: the access wall and visitor sign-in may need a
  same-origin post, and breaking authentication to close a door nobody walked through would be a
  poor trade. `'self'` closes exfiltration, which is the real risk.

  *Found while checking an external review that recommended `object-src 'none'` — that one **is**
  covered by `default-src 'none'`, so the recommendation was redundant. The directive that was
  genuinely missing was not on its list.*

## [0.1.16] — 2026-08-14

### Fixed
- **An embedded preview never said it was there** — *announced in 0.1.15 and not actually in it;
  see below.* `embed-ready` tells a host "I am alive". A host waiting for it and hearing nothing
  cannot tell an **absent** player from a **living** one, and a prudent startup watchdog replaces
  the second with the browser's own viewer a few seconds in, in front of the reader.

  One variable answered two questions: *should the embedded close button be drawn?* (no in
  preview — it already has its own, and drawing both would show two crosses) and *is this page
  served inside a frame?*. Only the second governs the handshake. The server already knew — it
  derives the response's `frame-ancestors` from it — and the page already spoke to its host
  (`share`, `close`); it simply never announced itself. Preview is precisely the mode a host uses
  for its **own** documents. The chrome is unchanged.

### Fixed (release process)
- ⚠️ **0.1.15 was published without the fix above, and announced as containing it.** The commit
  landed on a branch whose pull request had already been merged, so it never reached `main`. Every
  check passed, because every check looks at the working tree or the branch — never at the
  artifact. **The host found it**, by diffing the two npm tarballs.

  Two guards now exist, and the second is the one that generalises:
  - a `pre-push` hook refuses to push to a branch whose pull request is already merged (the
    neighbouring repository has had one since a similar incident on 5 August; this one did not);
  - the release summary lists **what actually changed inside the published package** since the
    previous version. Release notes promising a fix in a file that is absent from that list are
    visibly wrong, at the moment of publishing rather than days later.

  *A mutation test cannot catch this: it runs on the working tree, not on the tarball. The lesson
  is the host's, and it is exact — verify the published artifact, not the sources.*

## [0.1.15] — 2026-08-14

### Fixed
- **An embedded preview never said it was there.** `embed-ready` tells a host "I am alive". A host
  waiting for it and hearing nothing cannot tell an **absent** player from a **living** one — and
  a prudent startup watchdog replaces the second with the browser's own viewer a few seconds in,
  in front of the reader. That is what happened: the second host removed their watchdog until
  silence became information again.

  One variable was answering two questions: *should the embedded close button be drawn?* (no in
  preview — it already has its own, and drawing both would show two crosses) and *is this page
  served inside a frame?*. Only the second governs the handshake. The server already knew — it
  derives the response's `frame-ancestors` from it — and the page already spoke to its host
  (`share`, `close`); it simply never announced itself.

  Preview is precisely the mode a host uses for **its own** documents: no tracked link, no
  recipient. The chrome is unchanged.
- **The folder-mode home page offered a format the viewer no longer opens.** It kept its own list
  of displayable extensions, and that list still contained `.svg` after it was dropped from the
  type table in 0.1.7. The file appeared, the click produced a download, and a first-time visitor
  concluded the project does not work — on the one screen that never gets a second run. The list
  is now **derived** from the type table rather than copied.

  *Found while checking an external review about MIME sniffing. Its recommendation — `nosniff`, a
  generic type, forced download — has been in place since 0.1.7, and measurement confirms it: a
  `.png` containing HTML is served `image/png` with `nosniff`, so the browser will not sniff it
  into a script. The defect was next door: a list promising a format that had been removed.*

## [0.1.14] — 2026-08-14

### Security
- **Re-sharing a document stripped its restrictions.** `createReshare` enumerated the columns to
  copy, so every column added since was silently left out — and because these columns are
  `not null default`, the omission did not leave a hole, it wrote the **most permissive value**:

  - **`require_auth`** (default `false`) — a document behind the access wall, once forwarded,
    opened **without the wall**. A recipient could therefore lift the protection by forwarding the
    document to themselves. This was the worst of the three, and it was not in the report that led
    here.
  - **`allow_download`** (default `true`) — the Download button came back on a document where it
    had been refused.
  - **`brand_key`** — the brand was lost exactly where the document starts to travel.

  Inheritance is now the rule and the exceptions are enumerated: a column added tomorrow is
  inherited without anyone thinking about it. If it is a restriction, it propagates. A test covers
  the *mechanism* — an unknown column must survive a re-share — rather than a list that would go
  stale the same way the code did.

  *Reported by the second host, who saw the brand — the one that **shows** — and assumed the rest
  followed. The rest followed.*

### Added
- **Sending the re-share email can be delegated to the host** (`PLAYER_HOST_MAIL_URL` +
  `PLAYER_HOST_MAIL_SECRET`), which is what a host with its own provider and templates wants.

  ⚠️ **The player calls it only for a link that has a recipient.** The reader of an anonymous link
  is any passing visitor; letting them request a send would turn the host's servers into a relay
  for unsolicited mail, with the host's domain in the header. What that costs is not the message —
  it is a sender reputation that takes weeks to recover, during which *none* of their mail arrives.
  The guard sits on the path that acts, not in the host's route on arrival: a filter on arrival
  depends on a list staying current, a path that cannot phrase the request never phrases it by
  accident. *Requested by the host in our code rather than kept in theirs.*

  The payload carries structured fields (`kind`, `doc`, `from`) next to the HTML, and isolates
  caller-supplied text under `untrusted` — a host composing its own message can ignore it in one
  gesture instead of remembering which field is doubtful.

  A third secret, deliberately: the file secret travels on every document opened and lives in the
  host's logs; adding "send mail in your name" to what a log leak permits is a different power.

## [0.1.13] — 2026-08-14

### Fixed
- **The tracking notice invented a sender.** "…passed on to its sender" is right for a named link
  and false for a public brochure opened from a map by someone who received no message. This is
  the one sentence in the product whose whole job is to be exact. The player now picks by the link
  itself — no recipient and no creator means nobody sent it — which needed no new data: that is
  already the idempotency key for host-owned links. `PLAYER_TRACKING_NOTICE_ANON` overrides it; a
  context that provides no second text falls back to the first rather than showing none.
- **The tab title showed the operator instead of the brand the visitor clicked.** Someone arriving
  on a client's brand read the name of the company that runs the tool. The link's brand was
  *already* resolved for the loader and sitting on the share — the title simply did not consult it.
  No new configuration. "Powered by" stays the instance's, deliberately: saying who operates the
  tool is honest disclosure, not a brand leak.

  *Both reported by the second host looking at their own screen — which no test does. Both were
  true while an instance served one audience, and false the moment it served two.*

## [0.1.12] — 2026-08-14

### Fixed
- **A sleeping machine reported hours of reading.** The tab stays `visible`, the window keeps
  focus, no `visibilitychange` or `blur` fires — and the timers do not run either, so the idle
  loop cannot do its job. On wake, a raw timestamp delta poured the entire sleep into the current
  page: **eight hours of a closed laptop measured as 28 805 seconds read.**

  Accumulated time is now capped at "up to the last activity, plus the idle grace" — the same rule
  the idle loop applies, extended to the case where it could not run. An active reader produces
  events, so a real reading session is untouched; a sleeping machine produces none.

  *This is not an exotic case: it is how a laptop closes in the evening. And it is the number the
  whole product rests on — "this client read for twelve minutes" is only worth something if the
  number is honest when it is large as well as when it is small.*

  *Found while checking an external review that pointed at the right place with the wrong
  diagnosis: it recommended cutting on `visibilitychange`, which has been done since day one,
  alongside `blur`/`focus` and a 60-second idle timeout. The hole was where no event fires at all.*

## [0.1.11] — 2026-08-14

### Added
- **The host can create a tracked link in its own name** (`PLAYER_HOST_SHARE_SECRET`). Some links
  have no sender: the public brochure of a listing, opened by a prospect who has no account and
  should not need one. No member is present, so there is no token to require — and requiring one
  forces the host to invent an identity that does not exist. Same nature as `/authz` and
  `/branding`, which the host already answers server to server.

  ⚠️ **A different secret from `PLAYER_HOST_FETCH_SECRET`, deliberately.** That one only ever
  travels *outward* — the player sends it on every file fetch, so it sits in the host's access
  logs, proxies and error tracker. Whoever holds it can impersonate the player *to the host*;
  accepting it inbound would additionally grant write access *here*. One more variable against a
  blast radius that does not grow. The core never sees the secret: it asks the context a question,
  the adapter answers yes or no.

  **Three locks:** `docshare.create` only (revoking, listing and analytics stay member actions — a
  server secret must not reveal who read what); no recipient (a named link belongs to a member);
  idempotent by `docId`, which needed no new column — "the host's link for this document" is the
  row with no creator *and* no recipient, so an instance already in service migrates nothing.
  Without idempotence, a redeploy or a double click yields three links for one brochure, and
  analytics split three ways that nobody notices until they read them six months later.

  The link carries no creator, so it appears in no member's "my links" and stays visible under
  `list.all` — the existing filter already did the right thing. *Requested by the second host,
  who had ruled out all three workarounds themselves before writing, including the one that would
  have filed a prospect among internal readers.*
- `host-share` in `capabilities`, and `hostShare` alongside `separateIssuer`: what the instance
  *can* do, and what is *configured*.

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

[Unreleased]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.39...HEAD
[0.1.39]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.38...v0.1.39
[0.1.38]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.37...v0.1.38
[0.1.37]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.36...v0.1.37
[0.1.36]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.35...v0.1.36
[0.1.35]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.34...v0.1.35
[0.1.34]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.33...v0.1.34
[0.1.33]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.32...v0.1.33
[0.1.32]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.31...v0.1.32
[0.1.31]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.30...v0.1.31
[0.1.30]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.29...v0.1.30
[0.1.29]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.28...v0.1.29
[0.1.28]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.27...v0.1.28
[0.1.27]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.26...v0.1.27
[0.1.26]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.25...v0.1.26
[0.1.25]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.24...v0.1.25
[0.1.24]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.23...v0.1.24
[0.1.23]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.22...v0.1.23
[0.1.22]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.21...v0.1.22
[0.1.21]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.20...v0.1.21
[0.1.20]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.19...v0.1.20
[0.1.19]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.18...v0.1.19
[0.1.18]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.17...v0.1.18
[0.1.17]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.16...v0.1.17
[0.1.16]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.15...v0.1.16
[0.1.15]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.14...v0.1.15
[0.1.14]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.13...v0.1.14
[0.1.13]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.12...v0.1.13
[0.1.12]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.11...v0.1.12
[0.1.11]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.10...v0.1.11
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
