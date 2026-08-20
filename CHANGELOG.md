# Changelog

Notable changes to this project. Format based on [Keep a Changelog](https://keepachangelog.com/),
versioning follows [Semantic Versioning](https://semver.org/) — newest first.

The **host contract** has its own version, independent of the package version: it appears as
`contract` in `GET /api/doc?contract=1` and changes only on a break. See
[`docs/HOST-CONTRACT.md`](docs/HOST-CONTRACT.md).

Each released version below is also a [GitHub Release](https://github.com/Juli1artha/discovery-media-player/releases);
the notes there are this file's section for that version.

## [0.1.106] — 2026-08-20

### Fixed (the new card field tripped a host guard — renamed, guard untouched)

- **`presenceTokens` → `presenceJetons`.** A host-side guard refuses any identity card containing
  `supabase|secret|key|token`: a diagnostic endpoint that leaks a URL, a hostname or a secret is a gift
  to whoever probes it. The boolean leaks nothing, but that guard is a deliberately blunt text scan —
  and the right response to its refusal is to change the **name**, never to loosen the guard.
  Loosening is exactly what empties a guard, and this one protects something real. The reason is now
  written next to the field, so the next person to reach for an English name hits the explanation
  instead of the wall.

## [0.1.105] — 2026-08-20

### Added (you can now see whether presence tokens are actually being issued)

- **The card carries `presenceJetons`, measured rather than declared.** After setting
  `PLAYER_PRESENCE_SECRET` there was no way to confirm the setting had taken: the card shows
  `presence: {0, 0}` identically whether tokens are being issued, the variable is mistyped, it was set
  on the wrong environment, or the deploy never happened. Confirming it required standing up a
  throwaway presentation against production — which is not a procedure an operator should need.
  A setting you cannot observe is a setting you believe you made. The boolean now answers, and it
  **measures**: the card signs a throwaway token and reports whether one came out, rather than asking
  the host to declare a `config.presenceJetons` — a fact in two copies is a fact that eventually
  diverges, and it is the declared one you would trust. No host has anything to add to benefit from it;
  an older host, or a signer that throws, reads `false` rather than absent, and the card still answers.

## [0.1.104] — 2026-08-20

### Fixed (the one exact floor was justified by another guard — now that condition is checked, not assumed)

- **The exact floor on migration `add column` counts now verifies its own justification.** It is exact
  because no legitimate housekeeping can lower it — migrations are never deleted and `drop column` is
  forbidden. But that monotonicity is not a property of the world: it holds **because another guard
  enforces it**, and a mechanism can empty out, which is this whole family's subject. If that guard ever
  shrank, the exact threshold would silently become an arbitrary one. The test now asserts that the
  `drop column` interdiction still exists, and says what to do if it does not (widen this floor, or
  restore the interdiction). Mutation-tested: removing the interdiction turns this red. A stated
  condition of validity beats an assumed one; a **checked** one beats a stated one — and unlike
  `tronque`'s condition (which would need response headers, out of reach), this one is checkable in
  three lines. Reported by the second host, applying our own doctrine to our exception.

### Note

- The refined rule, worth keeping: **a threshold should be as tight as legitimate housekeeping allows —
  and sometimes legitimate housekeeping is nil.** Neither "always exact" nor "always wide": the question
  is what churn the measured quantity really admits.

## [0.1.103] — 2026-08-20

### Changed (`presence` now states what it measures, next to the numbers)

- **`presence` carries a `couvre` field: it is a migration gauge, not a security metric.** `avecJeton`
  counts self-declared `wantToken` bootstraps too — a bootstrap sets `last_token_at` without any token
  having been verified. That is correct for what the counter answers ("are there still old clients?")
  and even necessary for `sansJeton` to be able to reach zero. But the NAME promises something else:
  someone reading `{avecJeton: 40, sansJeton: 0}` in six months, in a cockpit, without this file in
  front of them, will read "40 proven participants" — and all 40 may have proven nothing. The caveat
  now travels WITH the numbers, the way `couvre` already travels with the schema verdict, rather than
  living only in a source comment that the person at risk never reads. Same remedy as the documented
  overlap of the two sets. Reported by the second host, who saw such a row in their own database.

## [0.1.102] — 2026-08-20

### Fixed (the coverage floors were set to fail on normal housekeeping — which is how a guard dies)

- **Floors are now collapse detectors with a dated witness, not coverage measurements.** 0.1.100 pinned
  each floor to the day's exact reading, which detects the smallest erosion — and also reddens on the
  first legitimate removal. At the third false positive someone lowers it, with no principled place to
  stop, because nothing in the file says what the number protects. That is the exact gesture that
  empties a guard: **a guard that cries wolf gets loosened, and nobody then checks that it still guards
  anything** — this repo has the proof, since the same scan produced seven false positives and the
  correct reflex (tightening it) could just as easily have disarmed it. Thresholds are now wide enough
  that no normal housekeeping reaches them and a collapse crosses them at once, with the dated reading
  written beside them as a witness. Reported and designed by the second host, after applying the same
  remedy to their own guard.
- **Each floor is now reasoned per guard rather than by blanket rule.** The migrations `add column`
  count is **strictly monotonic** — a migration is never deleted, and another guard forbids `drop
  column` — so no legitimate housekeeping can lower it: there the exact value has no false-positive
  cost and maximum sensitivity, and it stays exact, with the reason written down.
- **A per-file floor now backs the global one.** A file that grows must not mask a file that empties.
  This is not theoretical: mutation-testing showed a broken write-pattern draining `routes-liens.js` to
  zero **while the global total stayed above its threshold** — that mutation passes without the
  per-file assertion. Both floors were seen to refuse before committing.

## [0.1.101] — 2026-08-20

### Security (P1c step 2 — a bootstrap can no longer seize a claimed presence; STRICT is now safe to arm)

- **Migration 0018: a `wantToken` bootstrap is refused on a row already claimed by a token holder.**
  `wantToken` is SELF-DECLARED — it is what distinguishes a modern client from a legacy one — so under
  STRICT an attacker could declare it, post a registered participant's key, and overwrite their row:
  exactly the takeover step 2 closes for ordinary heartbeats. The second host EXECUTED it on his own
  production (a participant's name replaced) — this was not hypothetical. A row that has already beaten
  with a valid token (`last_token_at` set) is CLAIMED; a bootstrap, by definition tokenless, has nothing
  to write there. It stays free to create a new row, and to adopt a never-claimed legacy row (the normal
  upgrade path). The check is re-done under the advisory lock, so concurrent bootstraps cannot slip past.
- **The client now persists its token, which is what makes the refusal possible.** Held in memory only,
  the token was lost on every page reload, so the client re-bootstrapped with its usual (persisted) key
  — making "bootstrap on an existing key" routine, and therefore impossible to refuse without breaking
  every reload. Stored beside the attendee key, it has the same lifetime: a reload resumes with its
  token. Token TTL raised to 7 days accordingly (replay stays bounded by the archive seal, which covers
  the attendees table too). **Refused, the client rotates its key** and resumes on a fresh row rather
  than losing its presence in silence.
- **The RPC now RETRIES the older contract instead of inferring it.** 0018 adds no column, so there is
  nothing to probe — the code asks for the hardening and, if the signature does not exist, retries
  without it (the winning contract is memoised per process, so an un-migrated host pays one round trip,
  not two per heartbeat). This is the form the second host preferred: it cannot be wrong, because it
  asks exactly what it depends on. When the hardening is unavailable it is **said**, naming 0018 and the
  consequence: do not arm `PLAYER_PRESENCE_STRICT` without it.

### Note

- The coverage floor added in 0.1.100 **fired on this very release**, the day it was installed: moving
  the RPC body behind a helper dropped the scan from 71 to 61 columns — the identical silent erosion of
  the day before, this time a red test. It also makes the explicit enumeration that fixes it *safe*: a
  list is acceptable when a floor fails the day it goes stale.

## [0.1.100] — 2026-08-20

### Fixed (three scan guards could empty themselves without ever failing)

- **Coverage floors are now asserted at their real level.** Three source-scanning guards declared
  floors of `> 10`, `> 3` and `> 10` while actually covering 71, 10 and 34 items — so coverage could
  fall by two thirds without a single red. That is not hypothetical: one of them silently dropped from
  71 to 61 columns when a request body moved into a variable, and it was caught by a reading habit
  (diffing two test counts while working on that code), not by a mechanism. A month later, on an
  unrelated refactor, nobody compares — and **a guard with zero coverage passes all its tests**: it
  does not lie, it stops saying anything, and silence reads as success. The floors are now the
  measured values, so a refactor that moves the write site fails the guard instead of shrinking it,
  and lowering a floor becomes a deliberate act visible in a diff. This also makes *loosening* visible
  — the very move that empties a guard, and the one we reached for when this scan produced seven false
  positives. Mutation-tested: raising a floor above the real count does turn it red. Reported by the
  second host, who refused to let the episode be treated as an anecdote.

## [0.1.99] — 2026-08-20

### Fixed (code-new-on-old-base lost 0015's cap — and the warning named the wrong file)

- **The RPC call no longer sends `p_has_token` when migration 0017 is absent.** PostgREST resolves an
  RPC by its NAMED ARGUMENT SET: an extra argument does not "take its default", it matches no function
  at all — 404. The `DEFAULT null` in 0017 makes a NEW base compatible with OLD code; it can do nothing
  for the reverse — new code, old base — which is exactly the order a real deployment happens in (code
  ships before the migration). So between 0.1.97 and applying 0017, an up-to-date host fell through to
  the read-modify-write fallback and **lost the anonymous-creation cap that 0015 introduced**: not "the
  presence keeps working", but a guard vanishing silently between two migrations. The code now probes
  the `last_token_at` column (the answer already existed) and calls with 10 arguments when it is
  missing — the old contract, valid on both bases. Degradation is now what we claim: no transition
  counter, nothing else.
- **The fallback warning names the migration actually attempted.** It hard-coded 0015, so an operator
  hitting the 0017 failure verified 0015, found it applied, and concluded false positive. A wrong name
  is worse than no name because it is actionable: "name the file, not the error" only holds while ONE
  file can cause the failure. Both reported by the second host, who measured the intermediate state on
  his base instead of assuming it.
- **The schema guard sees named request bodies again.** Moving the RPC body into a variable made nine
  columns vanish from the guard's enumeration with no red — caught by diffing the test counts (994 →
  985), not by a failure. The scan now follows identifiers passed as `body:` to `PLAYER.db.request`,
  so a guard's coverage no longer shrinks when the code it guards improves.

## [0.1.98] — 2026-08-20

### Added (P1c step 2, increment 3 — the client carries the token; the loop is closed)

- **The audience heartbeat now carries its presence token.** `sendAttend` sends `wantToken: "1"` on the
  first beat (marking a modern BOOTSTRAP, which is what lets `sansJeton` fall to zero rather than
  conflating it with a legacy client), reads the response, stores the issued token, and sends it as `pt`
  on every following beat — so the server derives the row's key from something proven, not from the
  body. A host with no `PLAYER_PRESENCE_SECRET` returns no token and everything continues as before.
  With this, the protocol is complete end to end: a host can set the secret, watch
  `presence: { avecJeton, sansJeton }` on the card until `sansJeton` reaches zero, and only then set
  `PLAYER_PRESENCE_STRICT`. The client half is tested by executing the real template source (not a
  copy): bootstrap, storage-and-resend, no-secret host, and an unreadable response.

## [0.1.97] — 2026-08-20

### Added (P1c step 2, increment 2 — presence-token protocol, migration, transition counter)

- **An anonymous participant's key now comes from a proven token, and a transition counter shows when
  to close the door.** Migration 0017 adds `last_token_at` / `last_no_token_at` to
  `doc_presentation_attendees` and extends the `player_attendance_bump` RPC with an 11th parameter
  `p_has_token boolean DEFAULT null` — a 10-argument call from older code still resolves via the
  default, so the contract is not broken. On `present-attend`: a valid presence token (bound to the
  slug) provides the row's key, so a third party can no longer post someone else's key to overwrite
  their presence; the server re-issues a short-lived token in the response (no anti-replay table — the
  archive seal on attendees and `exp` already bound replay). `PLAYER_PRESENCE_STRICT`, off by default,
  rejects a legacy heartbeat (anonymous, no token, no `wantToken`) once the transition is done. The
  card's `?schema=1` now carries `presence: { avecJeton, sansJeton, tronque }` over 24h (bounded-
  ordered-flagged, like `sansRang`): `sansJeton === 0` means no legacy client is still beating. **The
  two sets deliberately overlap** — a participant who beat both ways counts in both; the measure is in
  max, the decision in *any*, which is why there are two fields, not one. No behaviour change until a
  host sets the secret and clients send tokens (the client is the next increment). A known residual:
  a `wantToken` bootstrap carrying an existing anon key could overwrite it under strict — low
  exploitability (a random, unexposed uid), to be hardened next.

## [0.1.96] — 2026-08-20

### Added (P1c step 2, increment 1 — signed presence-token foundation)

- **Signed presence tokens: `signPresenceToken` / `verifyPresenceToken`, plus `PLAYER_PRESENCE_STRICT`
  and a `presenceStrict` capability.** First rails for P1c step 2: a token binding `slug + key + exp`,
  HMAC-signed with `PLAYER_PRESENCE_SECRET` (per-INSTANCE — shared across a multi-brand instance's
  domains; the real scope is the `slug`, which is inside the signed payload). It proves the host issued
  a `(slug, key)` pair — enough to stop a third party from overwriting an already-registered presence —
  and does NOT prove a real person (the step-1 anonymous-creation cap stays). Same constant-time compare
  and mandatory `exp` as the internal token. `presenceStrict` is exposed in the capabilities so a cockpit
  can see both hosts' transition state alongside the upcoming `presence: { avecJeton, sansJeton }` counter.
  Nothing calls the helpers yet and `PLAYER_PRESENCE_STRICT` is off by default — no behaviour change; the
  protocol, counter, and client follow in the next increments.

## [0.1.95] — 2026-08-20

### Documented (tronque's validity condition)

- **`sansRang.tronque` is only reliable while `PLAFOND_SANS_RANG <= db-max-rows`.** An explicit `limit`
  does not beat the server's implicit cap: PostgREST returns `min(limit, db-max-rows)`. If an operator
  lowers `db-max-rows` below the ceiling, a genuinely-cut list returns fewer rows, `>= PLAFOND` is false,
  and `tronque` silently becomes a false negative again — the mirror of "an absent limit is not all".
  Clean detection needs the Content-Range header, out of reach of `db.request` (body only). Documented
  as a stated validity condition rather than a guard believed unconditional. Reported by the second host.

## [0.1.94] — 2026-08-20

### Fixed (sansRang: the fix removed the bound and lost the order — a lie traded for a crash)

- **`sansRang` is now bounded, ordered, and flags its bound.** 0.1.93 replaced the silent cap with
  `selectAll` — but the worst case a rank-counter exists to diagnose is "the backfill never ran": every
  message null, which passes the presence gate and then paginates the ENTIRE messages table on the card
  route, exhausting maxDuration — and a function timeout kills the whole invocation, not the promise, so
  the try/catch can't degrade. The bound was never the defect; its silence was. And the two `selectAll`
  calls had no `order=` (the three existing ones in the codebase all do): Range pagination without an
  ORDER BY has no stable order, so two pages can double or skip rows on a live base — and a presentation
  in use is a live base. Now each side is one request, `order=slug.asc`, `limit=1000`, and if the bound
  is reached `sansRang` carries `tronque: true` so equality is no longer readable as "all clear". A
  bounded counter must say it's bounded — reported by the second host across three passes.

## [0.1.93] — 2026-08-20

### Fixed (sansRang could lie through its own bounds — one of them backwards)

- **`sansRang` now uses `selectAll` (complete, paginated) instead of bounded lists.** 0.1.92 fetched
  two lists and crossed them in JS, and both were silently bounded — in OPPOSITE directions. The
  null-message list was capped at 1000 with no truncation flag: PostgREST without `order=` returns
  physical order (grouped by presentation), so the first 1000 nulls could all be sealed → total =
  dontScellees → a false "all clear" on a base where non-sealed rows were missed — the exact false
  negative the counter existed to remove. The sealed-slug list had no `limit` at all, which does NOT
  mean "all": PostgREST's implicit `db-max-rows` cap (often 1000) truncates it silently → an
  incomplete sealed set → dontScellees under-counted → a permanent false ALARM on a healthy host with
  >1000 archived presentations. Both fixed by paginating to the end with `selectAll`; transport stays
  bounded to the real problem size (zero on a healthy host), and the counter can no longer lie by
  truncation. Reported by the second host on 0.1.92 — removing an ambiguity of meaning had introduced
  an ambiguity of completeness, which is harder to see because a truncated list has the shape of a
  complete one.

## [0.1.92] — 2026-08-20

### Added (schema card makes the `mod_seq` null-count interpretable)

- **`?contract=1&schema=1` now reports `sansRang: { total, dontScellees }`.** 0.1.91's fix leaves
  `mod_seq` null on the messages of sealed presentations *by decision* — but a null rank is
  indistinguishable from "the backfill never ran", and the column-presence probe cannot tell them
  apart. So the on-demand card now counts the messages without a rank, and how many of those belong to
  a sealed presentation. Equal ⇒ every null is a legitimately-frozen sealed message; divergent ⇒ the
  backfill left non-sealed rows behind, an anomaly to fix. A counter nobody can interpret measures
  nothing; this turns it into a verdict. Two cheap queries on the probe path only, best-effort (a
  missing count never breaks the card). Reported by the second host on 0.1.91.

## [0.1.91] — 2026-08-20

### Fixed (migration 0016 backfill vs the archive seal — cross-migration hazard)

- **0016's one-time backfill now skips messages of sealed presentations.** The backfill runs an
  `UPDATE` on every message row; the archive-seal trigger (0007/0010) raises on any write to a sealed
  presentation (`active = false AND control_hash IS NULL`). A single message in a sealed presentation
  would have made the standalone migration fail entirely. The backfill now excludes those rows — a
  sealed presentation is frozen, including its rank; its messages keep a null `mod_seq` (historical,
  never live-resynced). Two individually-correct guards — the seal and the backfill — whose
  composition would block, which neither file could foresee alone. Reported by the second host, who
  measured it before applying. `init.sql` is unaffected in practice (its backfill runs before the seal
  trigger is created) but carries the same exclusion for consistency. No schema change; hosts that
  already applied 0016 need nothing.

## [0.1.90] — 2026-08-20

### Changed (performance — differential chat, audit CODEX 5.6 "scalable architecture")

- **The chat no longer re-reads its last 300 messages on every resync — only what changed since.**
  Each audience resync re-fetched the 300 most recent messages; for a room of N viewers that is N×300
  rows moved while almost nothing changed between two signals. A chat is mutable (an old message gets
  a reaction, is edited, is deleted), so an `id` cursor would miss those. Migration 0016 adds `mod_seq`
  — a global rank bumped on EVERY write (insert and update) by a trigger from a sequence (the IMAP
  CONDSTORE pattern). The client keeps the highest `mod_seq` it has seen and asks `mod_seq > cursor`:
  it gets new messages AND older ones that changed, nothing else. The client's existing merge
  (`addMsg`/`updateMsg`, by id) already handles both. The 400 ms shared read-cache keys on the cursor,
  so a whole room caught up to the same message still shares one DB read. **Degrades if the migration
  is absent**: the server probes the `mod_seq` column and, when missing, serves the last 300 as before
  (the client stays on full refresh) — no `mod_seq` in the select, so PostgREST never rejects the
  query. Trigger behaviour proven under real Postgres in `base/`.

## [0.1.89] — 2026-08-20

### Fixed (schema health card no longer over-reports "complete")

- **The schema health card now covers migration 0015, and a guard keeps it honest.** `ATTENDUES` in
  `server/schema.js` is a hand-maintained list, and nothing linked it to the migrations folder — so
  0015's conditional column (`creator_ip_hash`) was never added, and `?contract=1&schema=1` reported
  `verdict: complet` to a host that had NOT applied 0015 while its presence ran without the atomic
  path or the anonymous-creation cap. This is the second-source-of-truth class we removed three times
  this cycle. Fixed two ways: (1) 0015 is now in `ATTENDUES` (a report-only entry — presence degrades
  on the RPC being absent, not on probing the column, but column and function ship together in 0015,
  so the probeable column is the witness that 0015 is applied); (2) a new guard
  (`carteSchemaMigrations.test.js`) asserts every `add column if not exists` in a migration is either
  probed (`ATTENDUES`) or explicitly exempted — so the list reddens on a future omission instead of
  being completed from memory. Reported by the second host on 0.1.88.

## [0.1.88] — 2026-08-20

### Changed (presence — atomic upsert + anonymous creation cap, audit CODEX 5.6 P1c step 1)

- **Presence is now written in one atomic gesture, and fake anonymous participants are capped.**
  `recordAttendance` did a read-modify-write with an optimistic lock and up to four retries per
  heartbeat. A new `player_attendance_bump` RPC (migration 0015, same pattern as
  `player_rate_limit_bump`) does the same in ONE gesture — capped time accumulation, page union,
  strictly-increasing `last_seen` — and, in the same atomic statement, enforces a cap on NEW
  anonymous participant rows per `(presentation, IP fingerprint)`. Because an `anon-*` key is chosen
  by the browser, one visitor could otherwise fabricate thousands of fake participants. The cap
  (default `ATTENDEES_PER_EGRESS × 1.3` = 325, host-configurable via `presenceAnonCap`) never blocks
  a heartbeat of an already-registered key, and never counts authenticated members or the presenter.
  Creation and count are serialized by a per-`(slug, IP)` advisory lock so concurrent creations
  cannot overshoot together (proven under real Postgres concurrency in `base/`). The IP is stored
  only as a truncated hash, never in clear. **Degrades if the migration is absent**: the code falls
  back to the read-modify-write loop (still correct, without the creation cap) and says so once,
  naming the file — same doctrine as the rate-limit RPC.

## [0.1.87] — 2026-08-20

### Changed (performance — telemetry quota, audit CODEX 5.6 P1b)

- **External telemetry quota is split into two buckets, and checked before the link is read.** The
  single `sess:${ip}` bucket metered every external event (open, page, session) while its quota was
  derived from SESSION writes alone — so 25 readers behind one IP drained the session budget with
  their open/page events before writing a single session, and the rest was silently dropped. Now the
  session (a rich `upsert`) keeps `SESSION_QUOTA_PER_HOUR` on `sess:`, while the light open/page/
  heartbeat events (a cheap `logView`) get their own `view:` bucket with `VIEW_QUOTA_PER_HOUR`
  (derived from a per-reader budget, generous because `logView` is cheap). And the quota is now
  checked BEFORE `getShareBySlug`: an over-quota request no longer costs a DB read. Over-quota drops
  still return 200 (a measurement must not break a read) and now name the dropped class once per hour
  (`abandon: true`) so an operator can tie a stalled table to a quota. Test-link reads stay exempt
  from writing, not from the quota.

## [0.1.86] — 2026-08-20

### Fixed (reliability — two regressions from this cycle)

- **`recordAttendance(slug, participant)` is callable again at two arguments.** 0.1.84 slipped the
  "presentation already loaded" optimization into the SECOND positional slot, displacing the real
  parameter — an external host calling the published `./presentations` export with the old two-arg
  contract got `TypeError: Cannot destructure property 'key' of 'undefined'`. The optimization now
  lives in an options bag: `recordAttendance(slug, participant, { presentation })`. Two args = the
  old contract (presentation is re-read); the internal route passes `{ presentation }` and still
  avoids the extra read. New test exercises the public two-arg call.
- **Adaptive session net no longer locks a measurement behind a failed send.** 0.1.85 recorded the
  "already sent" signature BEFORE calling the transport, and `post()` swallows exceptions while
  `sendBeacon` can return `false` without throwing. A failed send therefore made the next tick — at
  an identical measurement — skip, losing the last measurement if the reader went idle or closed
  right after. The signature is now retained ONLY when the send actually left (transport returns
  `boolean | void`; an explicit `false` or a thrown error counts as "not sent" and the next tick
  retries). Tests for transport-throws, `sendBeacon === false`, and successful-still-skipped.

## [0.1.85] — 2026-08-20

### Changed (performance — réduction de charge)

- **Local rate limiter is now O(1) per decision.** The in-memory counter kept an ARRAY of
  timestamps per key and re-filtered it on every call — quadratic once a key accumulated (measured
  18.7 s for 100k decisions on one key; now a few ms). And the 5,000-key cap only evicted EXPIRED
  keys, so 5,001 active keys stayed resident. Replaced by a fixed-window `{ start, count }` counter
  with a hard LRU cap (oldest key evicted past the ceiling). A fixed window admits at most 2×max at
  the seam of two windows — acceptable for an anti-flood ceiling.
- **Session persistence is adaptive: 30 s cadence + dirty flag.** The browser net re-emitted an
  identical session on every 12 s tick — a hidden tab, an idle reader, a document left open kept
  writing the same row, one DB write per tick for zero new information. The base cadence is now 30 s
  (2.5× fewer writes even for a fully active reader; the hourly quota still derives from it), and a
  tick now writes ONLY when the signature (`totalSeconds`, `maxPage`, `numPages`) changed since the
  last send. A hidden tab writes once, not every tick. The dirty flag can only fall BELOW the quota
  ceiling — it never raises it, so the quota calculation is unaffected.


### Fixed

- **Chat beyond 300 messages: new messages now reach everyone.** `order=created_at.asc&limit=300`
  returned the 300 OLDEST — past the 301st, a participant re-reading never saw new messages (only
  the author saw them, via the POST response). Now the 300 MOST RECENT (desc), rendered
  chronologically. Test at 301 messages.
- **External telemetry is bounded and rate-limited.** `upsertSession` stored `pages_time` raw
  (unlike the already-bounded internal path): a single call could write an unbounded JSON. Bounding
  is now a shared helper applied to both paths (entry cap, numeric keys/values, capped totals). And
  the external analytics path wrote with NO quota — a public slug allowed unlimited writes; it now
  has a per-IP flood cap (writes are skipped over quota, the reader still gets 200).
- **Presence quota sized for a real audience.** 1,000 beats/h/IP covered only ~6 participants (one
  emits ~144/h); the 7th behind a shared IP got 429s. The quota is now derived from the cadence
  constants targeting 250 participants/IP; `recordAttendance` reuses the presentation the route
  already loaded (one fewer DB round-trip per beat); and the heartbeat is jittered ±15% to avoid
  synchronized bursts.

## [0.1.83] — 2026-08-19

### Fixed

- **The 500-presentation off-by-one is actually applied now** — and guarded by a test that fails
  without it. 0.1.82's changelog and commit claimed this fix, but the edit had been silently lost
  (a script aborted before writing the file) and no test guarded it: the doc promised more than the
  code. The purge now queries `cap + 1` presentations and truncates on `length > cap`, so exactly
  500 expired presentations with no 501st report `tronque: false` instead of a false positive.
  Two dedicated tests: exactly 500 → false, 501 → 500 processed + true.

### Changed

- **Container image builds run in parallel; only the `latest` promotion is serialized.** Workflow-
  level concurrency kept just one queued run, so three tags in quick succession would cancel the
  middle one and its versioned image would never be built. Versioned builds (distinct tags, no
  conflict) now run freely; a separate serialized `promote-latest` job recomputes the highest tag
  and retags `latest` atomically — no versioned image can be lost.

## [0.1.82] — 2026-08-19

### Fixed

- **The retention report's `tronque` now tells the truth for presentations.** It came only from the
  presentation-list length and budget exhaustion, never from the child purges' truncation — a
  presentation kept because its messages or attendees were truncated still reported `tronque:
  false`. Data stayed safe (the parent is not deleted), but supervision was wrong. Now
  `presRapport.tronque ||= msgs.tronque || pres.tronque`, and an off-by-one is fixed (query
  cap+1, truncate when `length > cap`, so exactly-500 presentations with none after no longer
  false-positives).

### Changed

- **Container image publishing is fixed and hardened** (delivery P1): a literal `\n` in the tags
  expression had made a single invalid tag, so the `v0.1.81` image was never published. The build
  now pushes only the immutable versioned tag; `latest` is promoted afterward by an atomic retag
  (`imagetools create`) with the highest git tag recomputed just before promotion; `concurrency`
  serializes publishes; the manifest and both architectures are verified, and `latest` is checked
  to share the versioned tag's digest. The hourly job opens an issue if npm serves a version whose
  image is missing. The `v0.1.81` image was backfilled.
- The accessibility E2E measures the stable overlay state (`reducedMotion`, waits for animations)
  instead of a mid-transition — no more contrast flake.

## [0.1.81] — 2026-08-19

### Fixed

- **The presentation purge cap is now GLOBAL, not per-presentation.** It was applied per
  presentation — 500 × 5,000 = 2.5 M messages possible in one run (serverless timeout, chat
  contention). Messages and attendees each get one shared budget spread across presentations; the
  loop stops when they are exhausted, without deleting the remaining presentations. `plafond: 1`
  over 3 presentations now deletes one message total, not three.
- **The dry-run report is complete for presentations**: `messagesExaminees`, `presencesExaminees`
  and `fichiersCandidats` report what a real purge would do (same selection path, no-op deletes,
  `efface.* = 0`) — an operator no longer under-estimates the real purge.
- **`in.(…)` values are URL-encoded.** A reserved character in an id (`&`, `#`, `"`, `,`) broke the
  filter — quoting handles PostgREST's delimiters, but the URL's (`&`, `#`) need percent-encoding.
  Found by a new **volumetric real-Postgres bench** (multi-batch, exact cap, a >5,000-message
  presentation over two passes, reserved-char ids).

### Changed

- **The container image release is hardened** (after moving it off the npm critical path): `latest`
  is promoted only when the tag is the highest git tag (no more slow old build overwriting it), and
  a deferred check verifies the tag's GHCR manifest is actually served.

## [0.1.80] — 2026-08-19

### Added

- **A single destruction gate, guarded by form AND by execution.** The three recent P1s were the
  same class — an option defined and validated but not honored on every write path. Following the
  second host's refinement (*defined / transmitted / honored* — the last is proven by enumerating
  paths, not by reading one point, and a reading-window guard would fall into the very perimeter
  trap it guards against), retention.js now routes every delete through one `effacerParIds` and
  every file removal through one `retirerFichier`, each short-circuiting `dryRun` on its first
  line. Two guards: a **form** guard (exactly one `method: "DELETE"` and one `.remove(`, each
  dominated by `dryRun` — it grows with the file, so a third write path must pass through the gate)
  and an **execution** guard (a dry-run emits zero destructive calls on any path).
- **`retentionSweep` in the identity card** — whether the automatic purge is *armed*
  (`config.retention.balayage === true`), beside `internalStrict`. The `retention` capability says
  the instance *can* purge; this says whether it *does*. A cockpit can now read if an instance is
  subject to automatic deletion instead of inferring it from a log.

## [0.1.79] — 2026-08-19

### Security / Safety

- **P1: `retention.run` now passes its options through — `dryRun:true` no longer deletes.** The
  route received `dryRun:true` but called `purgerRetention(Date.now())` without the second
  argument, so the purge fell back to `dryRun:false` and deleted for real — the worst case, since
  `dryRun` is what an operator runs first. Options are now validated before any DELETE (`dryRun`
  strict boolean, `taille` 1–500, `plafond` 1–5000, unknown key rejected — never a `Number()` or
  `!!`); an invalid option returns `400`. HTTP-level test plus a mutation (removing the 2nd
  argument) that must fail.

### Fixed

- **The purge never exceeds its cap, counts the dry-run exactly, and leaves no orphans.** Batches
  are clamped to the remaining cap (`min(taille, plafond − examinees)`); dry-run paginates by a
  keyset cursor (`col=gt.…`, portable — no `offset`) so it no longer re-reads the first batch
  (120 rows counted 120, not 300); a one-row probe distinguishes "exactly at the cap, nothing
  left" from "more to do". A presentation is deleted only if its messages AND attendees are fully
  purged — otherwise it is kept inactive for the next pass (no 1,000 orphaned messages). Attachment
  reads are folded into the bounded message batch; DELETE counts the rows it actually returned
  (concurrency-safe); `storage.remove` returning `false` counts as an error.
- The `storage.remove` barrier gets a direct test; the census SQL takes psql window variables
  (custom retention windows now check the same policy); the stale "unknown action → ok:true"
  comment is corrected.

## [0.1.78] — 2026-08-19

### Security

- **P1: an attachment can only name its own presentation's folder — at write AND at delete.**
  `addMessage` accepted the client's `attachment.url` on a bare `startsWith` check; a
  `…/present-attachments/../autre-bucket/secret.pdf` passed. The chain lay inert while the URL was
  only ever read; the retention feature gave it teeth — `storage.remove` concatenated the path
  into a service-role DELETE and `fetch` normalized the `..` out of the bucket. A single canonical
  path validator now guards both barriers (path must start with `<slug>/`, signed-path alphabet,
  rejects `.`/`..`/`%2e`/`%2f`/`%5c`/backslash/null); writes store the validated path and
  reconstruct the URL server-side; deletion re-validates against the purged slug; `storage.remove`
  is whitelisted to its bucket. No live exposure — retention is off everywhere by decision.

### Fixed

- **Retention windows are validated before any DELETE.** Non-integer, out-of-range `[1,120]`,
  negative, zero, `NaN`, `Infinity` or string windows now fail the purge (a negative window
  computed a *future* cutoff — mass deletion). Cutoffs are computed in UTC and clamped to the
  month's last day (`31 Mar − 1 month` = 28 Feb, not 3 Mar).
- **The purge runs in bounded batches** (select a capped id batch, delete by `id=in.(…)`, repeat)
  instead of one `return=representation` delete of the whole history; a per-table report
  (`examinees`/`supprimees`/`tronque`) and a `{ dryRun: true }` mode replace the id list.
  Migration `0014` adds the three retention-filter indexes.
- **An unknown POST `action` is rejected** (`400 unknown-action`) instead of falling through the
  analytics fallback and returning `{"ok":true}` — a typo like `present-pgae` no longer looks
  like a success. `retention` joins the `?contract=1` capabilities; `retention.run` is documented.

## [0.1.77] — 2026-08-19

### Added

- **The package exposes its contract and retention policy as exports** —
  `require.resolve("discovery-media-player/contrat")` and `…/retention`. Two consumers were
  reading our files by hand-written `node_modules` paths, and both broke during one day of
  refactoring — with no way for us to know who else does. An exposed path is a promise that
  survives reorganizations; a found path is a guess about our tree. `docs/RETENTION.md` ships in
  the tarball, and CI holds the promise from a real consumer install.

## [0.1.76] — 2026-08-19

### Changed

- **Refactor lot 3, no behavior change: the POST route families leave `handler.js`** (1,761 →
  908 lines — 4,362 at the start of the day). Soft-wall, live-presentation, sales-agent and
  share-link actions each live in their own `server/routes-*.js` module, plus `appelant.js` for
  caller identity. The dispatch tests each family's RETURN value (false = not mine, anything
  else = responded) — no duplicated action lists, and no reliance on `res.writableEnded`, which
  test doubles and some hosts' response objects do not carry (58 unit tests said so before CI
  did). The source-text surface covers all sixteen server files. Byte-identical blocks;
  858 + 19 tests green.

## [0.1.75] — 2026-08-19

### Changed

- **Refactor lot 2, no behavior change: the page builders leave `handler.js` too** (3,029 →
  1,761 lines — 4,362 this morning). Viewer, audience, soft wall, legal footer, session keys,
  `jsonPourScript` and the pdf.js asset URLs each live in their own flat `server/` module; every
  module's requires were detected from its own text, not listed from memory, and host plugins
  resolve from the context in each module. The source-text test surface (`sourceDesPages.cjs`)
  covers all eleven files, with the completeness test's shape widened to `page-*`. Byte-identical
  templates; 858 + 19 tests green.

## [0.1.74] — 2026-08-19

### Changed

- **Internal refactor, no behavior change: the page templates leave `handler.js`** (4,362 →
  3,029 lines). Live layer, map overlay, sales-agent assets, pinned third parties and text
  helpers now live in their own flat `server/` modules — flat on purpose: several CI guards
  target `server/*.js`, and a subdirectory would have silently emptied them. The source-text
  tests read the concatenation of handler + templates (a completeness test enumerates
  `gabarit-*.js` from disk), so a moved template never leaves their sight. 856 + 19 tests green,
  byte-identical templates.

## [0.1.73] — 2026-08-19

### Fixed

- **The confirm button failed WCAG contrast for real** (`#e5484d` under white = 3.9:1 → `#d13b40`
  = 4.75:1) — found by the "provoked states" accessibility pass: rating, quiz, goodbye, resume
  overlays (agent viewer) and the ended screen + OPEN dialog (audience) are all `display:none`
  at rest, invisible to any post-load audit. The bench now shows each state with the production
  gestures and runs axe on it. Also instructive: measuring DURING the dialog's entry animation
  (opacity < 1) blends the box into the dark backdrop and fabricates false contrast failures —
  the arbiter now waits for the stable state, the one users actually read. Stated limit: dynamic
  overlay content (rating stars, quiz cards) is injected by the HOST's PlayerBot — this bench
  measures what this package ships.

## [0.1.72] — 2026-08-19

### Fixed

- **The retention sweep is strictly opt-in** (`config.retention.balayage: true`). The second host
  consumes the standalone context as-is — "nothing to plug because nothing was unplugged" — and
  its first share action after upgrading would have swept with OUR default windows, decided by
  nobody; only its five-day-old data made that harmless. Retention windows are business
  decisions: deletion only acts where an operator wrote it. `retention.run` stays available
  without the opt-in — calling it IS the decision. `docs/RETENTION.md` also names the temporal
  depth `information_schema` cannot see: dropped columns, dumps and backups are the operator's
  perimeter, stated rather than simulated.

## [0.1.71] — 2026-08-19

### Added

- **Data retention, as a two-sided contract.** `docs/RETENTION.md` declares a policy for every
  personal-data-shaped column — and a CI guard enumerates the LIVE schema (`information_schema`,
  classified by forms: email, ip, ua, name, body, session…) and refuses any column without a
  written policy, deny-by-default. `server/retention.js` purges by windows (13 months for reading
  journals — including the clear-text IP —, 12 months for dead presentations with their messages,
  attendees and bucket attachments, 13 months for revoked links; host-adjustable via
  `config.retention`) and declares its counts from the rows each `DELETE` returned. The other
  half, `supabase/recensement-retention.sql`, recounts in raw SQL what remains in the claimed
  perimeter — sharing no function, filter or transport with the purge: two texts that cannot be
  wrong the same way. CI runs both against a real Postgres: seeded old rows must be declared
  exactly, fresh twins must survive (over-deleting is as wrong as forgetting), and the census
  must find nothing.
- Migration `0013`: `revoked_at` dates a link's revocation — "13 months after revocation" was
  uncomputable without it. Existing revoked links start their clock at the migration. Trigger:
  `retention.run` (trusted host or admin) plus an opportunistic sweep at most once per 24 h.
- First `DELETE` in the product's database surface — every call bounded by an age filter.
  `storage.remove` joins the standalone context as an optional capability (attachments of purged
  presentations); without it the rows still go and the limit is written, not simulated.

## [0.1.70] — 2026-08-19

### Fixed

- **The release chain publishes nothing before its gates.** Three releases in a row (0.1.67 →
  0.1.69) published npm then failed on notes extraction, silently skipping the GitHub Release,
  the GHCR image, SBOM and provenance — and 0.1.68 was published while its CI was red. The
  workflow now requires the exact commit's CI to be entirely green and the changelog section to
  exist BEFORE `npm publish`, and a `workflow_dispatch` replays the release of an existing tag
  (npm skipped, everything else redone). The three missing GitHub Releases and the 0.1.69 GHCR
  image were recovered.
- **Legacy-link backfill catches the 409 like the creation path does.** Two pre-0011 duplicates
  racing: one gets the canonical key, the loser now re-reads the winner instead of surfacing a
  500 — the fix had not applied to itself. The test double learned PATCH uniqueness first
  (the partial index does not distinguish INSERT from UPDATE).
- Migration `0012`: the `idem_key` column comment in the database described the dead concatenated
  format; it now describes the digest. Nominatim coordinates are bounded to [-90,90]/[-180,180].

### Added

- **The confirmation dialog traps and returns focus, keyboard-driven in the bench:** Tab loops
  between the two buttons, Shift+Tab loops backwards, Escape closes and gives focus back to the
  element that had it — a `role=dialog` without a focus trap is a declaration with no effect.
- `build`, `lint` and `typecheck` refuse by name outside a clone, like the three benches.

## [0.1.69] — 2026-08-19

### Fixed

- **The light-theme loader failed WCAG contrast (`#lpct`) — found by measuring what only exists
  while loading.** Both loader themes are now frozen on screen (the file request is stalled) and
  passed under axe: a transient state that no post-load audit ever saw. The dark loader — the one
  both external brands use — was already compliant; our light one was not.

### Changed

- **The three bench scripts (`test`, `test:e2e`, `test:base`) refuse by name outside a clone.**
  A published `package.json` describes what the maintainer can do, not what the consumer receives:
  the `scripts` field is not filtered by `files`. From a consumer install these scripts now exit 1
  with the reason and the repository address, instead of a config-not-found error that looks like
  a broken installation. CI installs the real tarball as a consumer and requires the named refusal.

## [0.1.68] — 2026-08-19

### Added

- **Accessibility, measured rather than declared.** axe-core arbitrates inside the real-Chromium
  bench (injected over the inspection protocol — the production CSP stays intact): zero
  serious/critical WCAG 2.1 A/AA violations required on the traced viewer and the audience page,
  and the arbiter is proven against a deliberately broken page (its zeros must mean something).
  First measurement found five real violations (legal strip at 0.42 contrast, keyboard-inaccessible
  scroll region, the presented document image with no name, join card at 4.48:1, loader subtitle) —
  all fixed.
- **What axe cannot demand, the bench asserts one by one in the final DOM:** a live region
  announces page changes and the end of a presentation; the chat feed is a `role=log`; inputs and
  buttons carry names; every rendered canvas is `role=img` + "Page N" (viewer AND audience — the
  audience canvas path required adding a real-PDF presentation to the bench); dialogs declare
  `role=dialog`/`aria-modal`.

## [0.1.67] — 2026-08-19

### Fixed

- **`init.sql` is replayable from an old base again.** The unique index on `idem_key` (line 62)
  ran before the catch-up `ALTER` that adds the column (line 410): a base born from the 0.1.64
  init crashed before reaching what would have saved it. Conditional columns are now ensured
  right before their index, and CI installs the historical init from the `v0.1.64` tag, replays
  the current file, and requires the exact shape of a fresh install.
- **The link idempotency key is a digest — one function writes and re-reads it.** The historical
  `hote:<docId>|<email>` form was truncated to 300 chars at insert but re-read in full after a 409:
  a legitimate loser on a long docId ended as a 500. Keys are now
  `genre:sha256(JSON.stringify(parts))` — fixed length, fixed boundaries, no truncation. Legacy
  keys self-heal: reuse goes through `doc_id` and re-writes the canonical key.

### Changed

- pdf.js assets are read once per process (no more per-request disk read of 1.7 MB); Nominatim
  coordinates are numerically validated before entering attributes; `PLAYER_INTERNAL_STRICT` is
  documented in `.env.example`.

## [0.1.66] — 2026-08-19

### Changed

- **pdf.js is bundled, served from our own origin, and current: 3.11.174-from-CDN → 6.2.108 local
  ESM.** What disappears in one move: the cdnjs third party in two CSPs (plus `blob:` in
  worker-src, plus the preconnects); the worker no `integrity` attribute could ever cover (it does
  not enter through a tag) and the whole fingerprint dance built around it; a pin that hung on
  what cdnjs chose to keep publishing; and the 2026 vulnerability affecting 5.6.83+ (fixed in
  6.2.108 — `isEvalSupported: false` kept on every call). Assets are served by `?asset=pdf` /
  `?asset=pdfworker` — version in the URL, immutable cache, byte-for-byte identical to the pinned
  `pdfjs-dist` package, `nosniff`. ⚠️ **No `enableScripting:false` placebo**: that option belongs
  to Mozilla's viewer, not to `getDocument` — adding it would be a description stronger than the
  implementation. The real guarantee is structural: the scripting sandbox
  (`pdf.sandbox.min.mjs`) is neither served nor loaded anywhere.

- **The bench finally renders a real PDF.** Three years of CDN made the PDF path untestable — the
  e2e fixture was an image, on purpose. The bench now renders a **real PDF** (hand-built with
  computed xref offsets) through the **real 6.2.108 worker** in a **real Chromium**, and asserts
  the claim that matters: **zero requests leave our origin**. The bench drops from 98 s to 4 s —
  nothing left to download.

### Fixed

- ⚠️ **Two sentinels from the tag era nearly sank the whole page** — zero requests, zero errors,
  zero document. Not the import: `if (!window.pdfjsLib) return` at the top of the viewer, and the
  audience boot listening on `script[src*="pdf.min.js"]` — a tag that no longer exists. Both made
  the entire viewer exit **without a word**. Found with an instrumented-Chromium probe, not by
  re-reading — which also caught a real CSP bug of this migration: `'none'` alongside `'self'`
  invalidates the whole directive. The browser-side silent-success class, same family as the
  close-path fixes of 0.1.61.

## [0.1.65] — 2026-08-18

The remaining P2s of the fifth audit.

### Fixed

- **One purpose, one link.** The host link (one per document and attested recipient) and the
  rehearsal link (one per document) read "does it exist?" then inserted: two requests in the same
  second both passed the read — **two links for the same purpose, statistics fragmented between
  them**, discovered reading them six months later. Same remedy as message idempotency (0005):
  migration `0011` adds a **nullable** `idem_key` with a **partial** unique index — ordinary links
  stay unlimited, only system links carry a key (`hote:<doc>|<attested>`, `repetition:<doc>`). The
  constraint's 409 is a **confirmation**: re-read the winner, `reused: true` — and a 409 with
  **no winner raises**, we do not invent a link. Historical duplicates are kept (their URLs are in
  inboxes): the first one reused receives the key on the way, the others die out unused.
  ⚠️ The test harness had to **replay the window, not the sequence** — the route's awaits
  serialized two `Promise.all` requests and the second *found* the row at SELECT time: the harness
  validated the old code. ⚠️ The key is only written where the column exists — the surviving
  mutation showed that on an unmigrated host it is not uniqueness that breaks, it is **link
  creation**. Audit 5, P2.

- **The Maps pin no longer pinned.** Google serves a sliding window of versions (~4 quarters);
  `v=3.58` fell out of it, so the parameter was **ignored** and the weekly channel loaded — the
  pin lied with no error anywhere. Pinned to 3.65, and the comment now carries the **date of the
  last check** — the only possible guard for a window only Google knows. Audit 5, P2.

- **Five texts described a vanished world** — each rewritten first, cited after: the README's
  "visible and focused" (focus is not required — visible and recently active); `tracking.ts`'s
  "60 s" idle default (the constant beside it said 180,000 ms); `MIGRATIONS.md`'s bare "never
  remove" (additive is about the **shape of the data** — the three permitted non-additive gestures
  are named, four shipped migrations already used them); `init.sql`'s "the publication remains
  useful" (contradicting the very next section, and 0009 removes it); `presentation-state.ts`
  describing table reads in the present tense. The 2026-08-14 audit tracker now carries a
  **historical** banner. Audit 5, P2.

## [0.1.64] — 2026-08-18

Every P1 of the fifth audit pass, closed. One of them was a defect in the very migration that
claimed to make the archive atomic — proven on a real database before being fixed.

### Fixed

- **The archive seal now actually locks.** Closing a presentation modifies `active` and
  `control_hash` — **non-key columns** — so its UPDATE takes `FOR NO KEY UPDATE`, which the
  trigger's `FOR KEY SHARE` (0007) does **not** block: the trigger checked "open", the close
  committed underneath it, and the message entered the archive. The window 0007 claimed to shut
  was open, and its comment asserted an atomicity it did not provide. ⚠️ **Seen refusing on a real
  database first**: the forge's two-transaction bench went red — *"the message ENTERED the
  archive"* — then green with measured waits (the write **waited 1444 ms** for the uncommitted
  close, then was refused; the close waited for the in-flight write). Migration `0010`
  (`FOR SHARE`); 0007's comments rewritten, not cited. The CI shape now includes **function and
  trigger bodies** (`pg_get_functiondef`/`pg_get_triggerdef` md5) — it caught two init/migration
  body divergences before even serving its purpose. Audit 5, P1-1.

- **The owner travels in the condition — switch and content too.** `switchPresentationDoc` and
  `setPresentationContent` (owner path) verified the owner at read time, then wrote on
  `slug+active` alone: a transfer between read and write handed the presentation to Bob, and
  Alice's **delayed** request still changed Bob's document, or showed **her** map to Bob's
  audience. Two survivors of the class closed in 0.1.60; `owner_email` in the filter, admin
  unconditional (moderation), pilot path unchanged, zero rows = 409. Audit 5, P1-2.

- **Deletion always wins over content.** Editing and reacting checked "not deleted" at read time,
  then wrote by `id` alone: a deletion in between emptied the message — and the delayed write
  **resurrected** the text or reactions inside a row marked deleted. Erased on screen, alive in
  the JSON. Edits require `author_hash+deleted=false` (zero rows = 409); reactions carry
  `deleted=false` on every attempt and stop with 404 if the message vanishes mid-loop — a replay
  would revive it; author-deletion is **idempotent** and now clears the quote too
  (`reply_text`/`reply_name`). ⚠️ **Belt in the projection**: a deleted row leaves empty whatever
  the database still holds — the only place that also covers the past. ⚠️ Presenter path: the
  token lives in **another table**, no PostgREST filter can carry it — the residual window (an
  ex-presenter moderating in the second his control is reclaimed) is documented and accepted: it
  only grants a right he legitimately held an instant before. No RPC. Audit 5, P1-3.

### Added

- **`internalStrict` on the identity card.** In transitional mode the internal-analytics route
  accepts `docId`/`email`/`name` as the client declares them — a caller can fabricate "this
  colleague read this document". The route already logs unsigned writes, but a log only lets you
  reconstruct; the boolean makes the state **refusable by monitoring**. `false` is never absent —
  a missing field cannot be refused. The strict default will come with an announced breaking
  change. Audit 5, P1-4.

## [0.1.63] — 2026-08-18

### Fixed

- **The last read-modify-rewrite in the repository is closed — without a migration.** Two tabs of
  the same participant heartbeating in the same second: both read the same row, the second rewrite
  swallowed the first — a viewed page vanished from the statistics, no error anywhere. And two
  *first* heartbeats at once: the primary key refused the second with a 409 nobody caught — a 500
  for a heartbeat, benign but wrong (now caught, re-read, and **logged as benign**: the
  silent-write guard refused the quiet first draft, as it did for P10). The lock is free:
  `last_seen` changes on every accepted beat, so the write is conditioned on the value read — zero
  rows means re-read and replay, bounded to four rounds. ⚠️ **The lock was blind within the
  millisecond**: two beats in the same ms write the same `last_seen`, the next condition still
  matches, and the overwrite comes back through the very window just closed — seen at the bench
  (three writes, three true conditions) before being seen anywhere else. An accepted `last_seen`
  is now **strictly increasing** (`max(now, read + 1 ms)`); the mutation removing the `+1`
  **survived** the first round because the test clock was not frozen — frozen, replayed, red.

- **The chat broadcast payload is empty — the strong property became true instead of the
  description becoming weaker.** The second host confronted "a signal, never content" with the
  code: the payload *carried* the projected row — dead weight no receiver consumed (they re-read
  over HTTP), kept alive by a stale comment describing a vanished world. A content nobody consumes
  is not neutral: the day a new receiver reads it "since it is there", the projection becomes
  optional in silence. `payload:{}`, like `sendState` and `sendMap` already did; full
  compatibility (every published receiver already ignores it); the mutation putting content back
  is named by the rule guard.

### Changed

- **The column guard no longer erodes as the code improves.** Its sweep only read `body: {…}`
  literals: every adoption of the conditional-write helper silently removed a site from its
  enumeration — six columns vanished the day attendance took the pattern, seen in a **count diff**
  (813 → 807 tests), never in a red. A guard whose coverage shrinks when the code gets better
  punishes the very gesture it should encourage. It now reads all three write forms: **31 → 71
  columns checked** against `init.sql` and the migrations.

## [0.1.62] — 2026-08-18

Fourth external audit pass, both lots. Surface reduction on the database side, one serialization
rule on the template side — and the afternoon's flaky test, caught and fixed.

### Fixed

- **The database stops offering the channel nothing listens to.** Chat travels as broadcast — an
  invalidation signal, never content — followed by a bounded HTTP re-read serving the **public
  projection**. Yet `init.sql` still published `doc_presentation_messages` into `supabase_realtime`
  with `REPLICA IDENTITY FULL` (0.1.58 had fixed the *comment*, not the install). An unused surface
  is not a neutral surface: the day someone adds a public `SELECT` policy "so live works" — the
  exact mistake the historical host had to climb out of — the publication becomes a channel again,
  delivering the **whole row**, `author_hash` included, bypassing the projection. ⚠️ And
  `REPLICA IDENTITY FULL` costs on every write: each reaction wrote the full row image to WAL —
  measured `relreplident='f'` in our production before applying. Migration `0009` (idempotent;
  refuses **loudly** on a `FOR ALL TABLES` publication instead of pretending success); the CI shape
  now includes **publications and replica identity** — the third blind spot of the same kind, after
  nullability and triggers — and two scenarios run against real databases: an old base cleaned
  twice, a fresh one where the table never enters.

- **One serialization for everything entering a `<script>`.** The HTML parser reads the page before
  JavaScript: a `</script>` inside a JSON string closes the element for it — the nonce CSP blocks
  the injected script's execution, not the page breakage. Protection lived scattered: a `.replace`
  at the interpolation site for `CFG` (the rich data — the only surface carrying user input), and
  **six naked interpolations** beside it (server/operator values: hardening, not an exploitable
  hole). `jsonPourScript` applies the rule **at serialization**, where it cannot be forgotten field
  by field; `undefined` throws instead of silently becoming text. The guard checks the **rule**,
  not a list — a variable added tomorrow goes through the function or the test names it — and
  strips comments before searching, because a probe that reads comments invents culprits. Proven on
  the **rendered page**, not just the function: the audience page rendered with a hostile title
  carries no raw string, the neutralized form, no open executable fragment.

- **The quadratic-cost demonstration no longer depends on machine load.** The test proving the old
  address pattern's O(n²) cost went red three times in one afternoon, never twice in a row — seven
  takes on 16,000 characters graze the 5 s ceiling under load. Its first stabilization pass (min of
  takes) had fixed the *ratio*; the *total time* was failing. Same square, one-sixteenth the cost
  (2,000 → 8,000), explicit ceiling. *An unstable test has a danger of its own, worse than failure:
  you learn to ignore it, then ignore it the day it is right.*

## [0.1.61] — 2026-08-18

The second host had **four presentations stuck "active" for three days** — and nobody saw it.
*A failed close deprives you of nothing you look at*: its success produces nothing, so neither
does its failure. This release closes that class, four times over — and ships the contract fix
that 0.1.60's release notes were already pointing hosts to.

### Fixed

- **The close route's catch swallowed everything without a trace.** Every "End" failed with 23502
  (0.1.60's archive-marker defect) and that silent 500 left **nothing** — not even a line in the
  error journal. A journal nobody reads is worth little; no journal is worth nothing. The catch
  now captures, with the route named.

- **The stale-presentation purge only ran if somebody opened the panel.** It lived solely in
  `listActivePresentations`: no panel, no purge, eternal orphan. It now also hooks a gesture that
  happens on its own — **starting a presentation purges the orphans before it** (presenters create
  them; the next one cleans). Conditioned (`active=eq.true&last_seen=lte.threshold` — a session
  that just heartbeat is untouched), and **never a prerequisite**: a failing purge does not prevent
  presenting, or we would have traded an invisible orphan for a visible outage.

- **The on-click failure was a tooltip.** "The end was not recorded" lived in a `title` nobody
  hovers. It is a visible banner now — "the presentation is STILL ACTIVE" — cleared on retry. The
  existing test pinned the tooltip; it demands the visible element.

### Added

- **Re-read, don't reuse: a second round-trip after the server's ok.** Reserve raised by the second
  host before merge, and it was right: re-reading the PATCH response would do exactly what the
  negative cache did — the measurement would confirm what the write *believes* it did. After the
  ok, the client re-reads the public state independently; if the database still says *active*, the
  interface **does not close** — closing would convert a failure into visual confirmation, the
  exact interface optimism that lied to the second host's presenter. ⚠️ An **unavailable** re-read
  is not "still active": the server confirmed, verification is a bonus, its absence is neutral —
  a 429 on the read must not trap the presenter in an interface that refuses to close. This is the
  only way to make the whole silent-success class observable, including against a future server
  answering ok without having written.

- **The identity-card contract now states the exact shape of `manquant`** (`{migration, fonction}`),
  with the second host's rule: a card without a `schema` field is an **alert**, not a success — it
  signals a pre-0.1.58 instance, a version that cannot answer the question. They had typed the
  shape from memory (their bench built the card the same wrong way, so no mutation could catch it);
  our share of that defect was a shape written nowhere. Merged in #136, and **published here** —
  0.1.60's notes pointed hosts to a contract the package did not yet carry.

## [0.1.60] — 2026-08-18

Closes every P1 of the third audit pass, plus one defect no report had seen.

### Fixed

- **The reaction intent finally travels the HTTP route.** `toggleReaction` could set a state since
  0.1.56, the browser sent it since 0.1.56 — and the route called the function **without the fifth
  argument**. Three releases long, the real path kept toggling: the double click switched the
  reaction off, the very defect P10 believed closed. ⚠️ The tests exercised the function, never the
  route: the mutation went red, the property was true — **on a path production does not take**. The
  new test plays the same property through `player.handler`. Audit 3, its first finding.

- **A reactor's identity is derived, no longer declared.** The client sent `reactor: MOIREF` — and
  MOIREF is **public**: every participant receives everyone's refs inside the reactions array. Anyone
  could copy another's ref and set or remove **their** reactions. The client now sends its author
  token — the secret that never leaves its browser — and the server derives the ref with the same
  chain as the client (`sha("ref:" + sha(token))`, 16 chars); a test **confronts both engines**
  (Node crypto vs WebCrypto). ⚠️ A "compatibility" fallback to `body.reactor` survived the first
  mutation round: the forgery test sent token *and* forged ref, so the fallback never played — yet
  it is exactly the attacker's path (no token, someone else's ref). Test added, mutation replayed, red.

- **Two simultaneous reactions both survive.** Read-modify-rewrite lost one of them silently. Same
  remedy as steering writes: a **rank** (`reactions_seq`, migration `0006`) — the write carries the
  rank it read, a passed rank touches zero rows, the server re-reads and replays, bounded to four
  rounds (each round, at least one writer wins). On an unmigrated host reactions keep working —
  last writer wins, as before.

- **Six presentation writes carried their check, not their condition.** Reclaim, heartbeat,
  owner-close, handover, chat lock, auto-purge: all read the row, verified, then **PATCHed by slug
  alone**. A stale reclaim stole the session a handover had just granted; a stale heartbeat kept an
  orphan alive forever; a delayed close shut the **new** owner's session; two concurrent handovers
  moved the document twice; the purge switched off a session that had come back to life. Owner or
  token now sits **in the PostgREST filter**, zero rows = 409 — the form `setPage` already had.
  ⚠️ The chat-lock mutation survived the first round: the test mutated too early, and the 403 of
  the *check* played instead of the 409 of the *condition* — red for one reason, silent on the
  property. Harness hook added, replayed, red by the condition, and the test requires it.

- **The archive is sealed by the database, not only by the code.** Seven write paths check
  `estArchive()` then write — into a **different table** than the one holding the state, so no
  PostgREST filter can close the gap. The arbiter can only be the database: a trigger (migration
  `0007`), with **`FOR KEY SHARE`** locking out a concurrent close until the write commits — the
  lock is what makes the refusal atomic, not the test. The code checks remain as the *friendly*
  refusal; unmigrated hosts keep exactly the window they had. Proven at the real-database bench, by
  a POST that bypasses every code check on purpose.

- **Closing a presentation was impossible on a fresh install.** Closing sets `control_hash = null`
  — *the* archive marker — and `init.sql` declared the column **NOT NULL**: violation 23502 on
  every close, presentations never ended, the read-only archive did not exist. ⚠️ **793 tests
  passed**: the in-memory double has no constraints (its header says so), and historical databases
  are nullable — neither the suite nor production could show it. The real-database bench caught it
  on its **first prey**, while refusing the archive seal for an upstream reason. Migration `0008`;
  the CI shape now includes **nullability** and **triggers**, without which init/migrations parity
  covered neither.

- **A schema "no" no longer outlives the outage that caused it** *(shipped in this cycle's
  branches, see 0.1.59 notes for the probe itself)*: a transient database failure during normal use
  cached "absent" for the life of the process — the feature stayed off after recovery, and
  `sonderTout()` re-served the incident dated today. ⚠️ Our recovery test called `init()` between
  failure and recovery — **which empties precisely that cache**: it proved a healing that did not
  exist. A "yes" is stable and kept; a "no" expires (60 s); the on-demand probe drops cached "no"s
  once the control column answers.

- **The local-file relay allocated before checking.** The cap lived in the handler, on
  `Content-Length` — **after** `readLocal` had already `Buffer.alloc`'d the whole range: a local
  file above the cap cost its full allocation on every request before being refused. The cap now
  sits before the allocation; a **range** below the cap of an over-cap file still passes (206) —
  that is what ranges are for. 413/416 are relayed as such instead of melting into 502.

- **Two comments described vanished behaviour** — and a stale comment in an install file is a
  defect: it pushes a maintainer to "repair" toward the exact hole. `init.sql` claimed the chat was
  not live (it rides broadcast + re-read); `viewer.ts` described a main-thread worker fallback (the
  doubt is **fail-closed**). Both confronted with the code before rewriting.

### Added

- **`?contract=1&schema=1` is bounded.** Concurrent calls share **one** probe, the result serves
  for 30 s — a public route was a small database amplifier, and the shared resource paid, never the
  caller. The cache is not eternal: an applied migration must show.

- **`schema.couvre: "colonnes-conditionnelles"`.** "complet" without a scope overpromises: the
  rate-limit migrations (0003/0004) are deliberately not in the card — a host may provide its own
  `limits` capability, where their absence is normal. The field prevents reading "complet" as
  "everything under supabase/ is applied".

- **PostgREST errors carry the response body.** A bare "400" cost a full forge round-trip to learn
  what the database had been saying from the start.

## [0.1.59] — 2026-08-18

### Added

- **`?contract=1&schema=1` — ask, and the instance actually looks.** The card was reporting only
  what the current process happened to have asked, and two hosts measured the same thing from
  opposite traffic profiles: one where presentations are the traffic, one where documents are.
  **Neither has ever read a non-zero value.** It was not *often empty*, it was *never yet observed
  to be otherwise* — so the branch that fills it was code nothing had exercised. The bare card
  keeps its property of answering when the database does not; this parameter is the one part that
  needs it, and only when asked for.

- **A `verdict`, because `manquant: []` has four meanings.** `non-sonde` / `partiel` / `complet` /
  `incomplet` / `indetermine`. Making the reader reconstruct the state by crossing two fields
  leaves them the mistake — and would have recreated, inside the parameter meant to remove the
  ambiguity, the exact ambiguity `sondees` had just killed. ⚠️ `incomplet` **wins over** `partiel`:
  a missing column is a positive fact and settles the verdict alone, even when the rest was not
  checked — the ordinary path only ever probes one expectation at a time, so without that rule a
  column known to be missing would have displayed as *partial*, which reads as reassuring.

- **A control column separates *missing* from *unreachable*.** The probe deliberately does not
  distinguish the two — for *deciding*, both mean the same thing. For *reporting*, conflating them
  is wrong in both directions: an unreachable database makes all three probes fail, so the card
  would have announced **three missing migrations that exist**, sending the operator to apply what
  they already have. The control is the primary key of the oldest table: if *it* stays silent,
  nothing is missing — the database is. Differential measurement, no dependence on a third party's
  error text, which was the very reason the probe refused to distinguish.

### Fixed

- **A diagnostic call could have switched the product off.** The probe caches its answer for the
  life of the process. Called during a database hiccup, `&schema=1` would have cached *absent* for
  all three expectations — disabling write ordering and message idempotency until the next start.
  A control route that breaks production. Silent control ⇒ nothing is probed and **nothing is
  remembered**.

## [0.1.58] — 2026-08-18

### Added

- **The identity card now says which migrations the instance is still waiting for.** A missing
  column was reported by a `console.warn`, **once per process**: on a serverless function, a line
  lost in an output nobody opens while everything *looks* fine — and *everything looks fine* is
  exactly the state of a host whose write ordering and message idempotency are both asleep. The
  trace existed at precisely the place no one looks. `GET /api/doc?contract=1` — the card hosts
  already query to pin their version — now carries a `schema` field naming the file to apply and
  the feature that is waiting. ⚠️ It **reports, it does not probe**: that route must answer when
  the database does not, so probing from it would make a diagnostic that falls together with what
  it diagnoses. ⚠️ Hence **three states, not two**: a process that has asked nothing knows nothing,
  and `manquant: []` would read as *all clear*; `sondees` is there so the two cannot be confused —
  an absence of result looks like a result. ⚠️ The file is **named**, on a public route, for the
  same reason `frameAncestors` names origins ten lines above it: the operator has no other way to
  learn which one is missing, and what it reveals — that a reliability feature is waiting, in a
  repository whose migrations are public — grants no access. Found by the second host, reading our
  probe.

### Changed

- **Schema expectations are declared once, and that declaration is the source.** The
  *(table, column, migration)* triples lived copied across four call sites. Deriving a list from
  them *for display* would have rebuilt, in miniature, the defect that had emptied `init.sql` of
  its five migrations: two copies of the same fact and no one to confront them. Callers now go
  through `attendue(name)` and no longer name a column; a CI step refuses any call that bypasses
  the table, and every file named there must exist.

## [0.1.57] — 2026-08-18

### Fixed

- **A resent message no longer creates a second one.** A network retry, a double click, a resume
  after timeout: the request left **twice** and the database stored two rows. The participant saw
  their message duplicated with nothing to explain it — no error, just one success too many. The
  client now makes an idempotency key **once, before the first send**, and reuses it on retry; a
  key drawn per attempt would prove nothing, since two sends would carry two keys and both would
  pass. ⚠️ A uniqueness refusal is a **confirmation, not an error**: the constraint says *this
  message is already here*, so the row is re-read and returned as a success — but if the re-read
  finds nothing, it is raised, because that 409 came from something else and hiding it would
  report a send that never happened. ⚠️ The column is written **only where it exists**: PostgREST
  rejects the **whole** POST on an unknown column, so on an unmigrated host it would not be
  idempotency that breaks, it would be **sending messages**. Requires migration
  `0005-envoi-unique.sql`. Audit finding **P10**, now closed.

- **The file relay streams instead of loading everything.** The ceiling added in 0.1.56 read
  `Content-Length` and took the upstream at its word — a store that announces nothing, or announces
  1 KB and sends 500, went through unchallenged. The relay now flows, with a counter that breaks.
  ⚠️ That second bound can no longer answer **413**: the headers left with the first byte, and one
  does not take back a header already sent. It cuts — the client sees an interrupted transfer,
  unpleasant and honest, where memory exhaustion took down the **whole** function, and with it
  everyone else's requests. ⚠️ The point is not to stop writing but to stop **reading**: without
  cancelling the upstream it keeps sending the file and memory goes anyway. Same reason on the 413:
  a body never pulled leaves the connection **open**, and the socket pool drains — the very
  resource being protected. ⚠️ And `fetch` **decompresses on its own**: on a gzip upstream,
  `Content-Length` counts compressed bytes while we relay expanded ones, so it is no longer
  announced. A host whose `storage.fetchFile` returns no readable body — the standalone local-file
  path — keeps a buffered path, named and tested: treating that absence as *nothing to send* served
  **empty files** in silence, a worse defect than the one being closed. Audit finding **P8**, now
  closed.

- **A fresh host was installing a truncated database, and nothing said so.** `supabase/init.sql`
  announces *one file, replayable, with nothing to read elsewhere*. **None of the five migrations
  were in it**: no write ordering, no shared rate limits, no idempotency key. ⚠️ And the host never
  found out — the schema probes degrade **silently** by design, so as not to break a host
  mid-migration; on a fresh database that same silence means four protections switched off, for
  good, without a word. A CI job now installs a **virgin Postgres** from `init.sql`, records the
  shape the database itself reports, replays every migration on top, and requires that nothing
  moved. It also tests the word *replayable*, which had never been checked.

- **Migration 0004 required Supabase roles.** `revoke all … from public, anon, authenticated`:
  `anon` and `authenticated` do not exist outside Supabase, so the migration stopped on a bare
  Postgres — every self-hosted host, the very audience this repository opens itself to. The `grant`
  six lines below was already guarded by an `if exists`, with ten lines explaining why: **caution
  had stopped halfway, in the same file**. Found by the schema guard on its first run.

### Added

- **The three properties the in-memory PostgREST double cannot simulate are now tested against a
  real one.** The double says so itself: *no constraints, no transactions… not a substitute for
  checking what belongs to the DBMS*. Yet message idempotency rests on a **unique constraint**,
  steering-write ordering on the **atomicity** of a conditional PATCH, and the whole schema probe
  on PostgREST rejecting the **entire** POST for an unknown column — three properties inferred from
  documentation and never observed. A CI job runs a real Postgres behind a real PostgREST and the
  player connects to it **the same way it connects to the double**: one URL and one key in the
  environment. ⚠️ The bench **refuses to skip** under `CI`: a bench that quietly skips goes green
  having exercised nothing. `npm run test:base`. Audit finding **P12**, now closed.

## [0.1.56] — 2026-08-18

### Fixed

- **A network retry no longer cancels the reaction you just added.** Toggling only makes sense
  once: a double click, a retried request, a resend after timeout — and the emoji the participant
  had just lit goes out. They see **no error**; they see it blink, so they click again, which
  toggles again. The caller now sends what it **wants**, not what to invert: replaying the same
  intent twice gives the same result as once. An older client keeps the toggle rather than losing
  the feature, and a test pins that inherited behaviour. Audit finding **P10** — message
  idempotency, which needs a key and a unique index, is still open.

- **Disconnecting now stops everything connecting started.** The state and chat schedulers and the
  safety-net interval were declared *inside* `connect()`; `disconnect()`, one level up, could not
  reach them. After connect → disconnect → connect, the old session's re-reads kept running: a
  viewer who reopened the page **doubled the traffic**. No amount of good will in the stop path
  would have helped — it was a matter of **scope**. The global re-read hook, which kept the whole
  closure alive, is removed too. Audit finding **P9**.

- **The file relay refuses before allocating.** It loaded the entire file into memory with no
  upper bound: an 80 MB PDF plus three concurrent range requests takes down a serverless function
  — not for one document, for the sum. The refusal happens **before the body is read**, and the
  test checks exactly that. ⚠️ An upstream that announces no size still passes: one cannot refuse
  what one cannot measure. **This bounds the large, not the unknown** — streaming will close the
  unknown, so P8 is not closed. Configurable via `PLAYER_MAX_RELAY_BYTES` (default 60 MB).

### ⚠️ The forge was broken for twelve hours, by us

Every CI run since the previous evening failed with **zero jobs**, and I blamed an ongoing GitHub
incident — real, visible on their status page, and **not the cause**. The Actions page had been
naming the file and the line the whole time.

The cause: a guard added in 0.1.51 contains a shell fragment ending in a dollar sign followed by a
quote. Passed as a replacement **string** to a text substitution, that pair means *everything after
the match* — so it re-inserted the entire tail of the workflow file, declaring three jobs twice.

⚠️ **I reproduced it twice while repairing it** — once in the workflow file, once in this very
entry, whose first draft duplicated the whole changelog. The fix is a replacement **function**.

It stayed invisible because every PR opened after 0.1.51 branched from a `main` predating it, and
so carried the old, valid file. Two true causes at the same moment, and I attributed ours to
theirs — the costliest variant of a diagnosis dressed as an observation, because the context
supplied a plausible culprit for free.

### Evidence, by strength

| | this release |
|---|---|
| **Seen refusing** | the mutation ignoring the reaction intent (two tests); the net removed from disconnect, and the handles made local again (one each); the relay ceiling removed (the 413 test) |
| **Seen falling** | nothing |
| **Never failed in front of anyone** | 752 unit tests, 8 browser tests, lint, typecheck, build |

## [0.1.55] — 2026-08-17

### Fixed

- **When the URL says nothing, the file name decides.** The audience view decided whether a document
  was an image from the URL alone. A storage URL carrying no extension therefore answered "not an
  image", and the audience got "Document unavailable" again — the defect 0.1.54 had just closed,
  coming back through the side door.

  ⚠️ **0.1.54 had kept the derived field and thrown away the authoritative one.** Two fixes had been
  written for one symptom; since either sufficed, **no mutation could turn the bench red**. Removing
  one left the other working — so I removed the one that decides, and kept the one the bench already
  knew how to see. **The bench chose the fix instead of verifying it.**

  The rule "a fix made of two changes cannot be proven" does not say *which* one to keep — and the
  answer is never "the one the bench can see". Keep the field that decides, then make the bench able
  to tell them apart.

  Measured by the second host on their own instance: **4,287** presentable documents, **23** whose
  URL carries no extension, **none of them images**. Reachable, unpopulated. The bench now populates
  the case.

### ⚠️ Evidence, by strength — and a correction to 0.1.54

Counting "734 tests" reads as if all 734 weighed the same. They do not, and the difference is the one
a hurried reader makes on our behalf, in whichever direction suits them. Three groups, borrowed from
the second host:

| | this release |
|---|---|
| **Seen refusing** — a guard replayed inverted, red observed | the mutation deciding on the URL alone: the new bench test falls, and it alone |
| **Seen falling** — a behaviour replayed, red observed | the audience page displaying an image whose URL has no extension |
| **Never failed in front of anyone** — typing, build, tests that already passed | everything else: 734 unit tests, 8 browser tests, lint, typecheck, build |

The third group is not worthless — it attests that **nothing was broken**, never that something was
repaired.

⚠️ **Which makes one line of 0.1.54 false.** It announced the image fix as "verified by mutation".
The mutation did *not* turn red — I found that out afterwards, and it was the second host who
explained why. That claim belonged to the third group, dressed as the first.

## [0.1.54] — 2026-08-17

### Fixed

- **A presentation carrying an image now displays for the audience.** The *Present* button appears
  with no condition on the document type: a presenter looking at a PNG could present it, and the
  audience got "Document unavailable" — pdf.js called on an image.

  ⚠️ **This path had always been silent.** Not a regression from the worker refusal: nobody had seen
  it because images are rarely presented. Found by the **second host, by asking** where we would have
  asserted — their own view serves images, so they asked whether ours could receive one.

  ⚠️ The first attempt at the fix **did not work, and nothing said so**: it decided on `CFG.fileUrl`,
  which is `/api/doc?present=…&file=1` — no extension, so "not an image", always. A `try/catch`
  added out of caution swallowed the cause; reading the loader's subtitle was what exposed it. A
  defensive guard that returns false on error does not protect, it **hides**.

  ⚠️ And there had been **two fixes for one symptom** — the file name added to the config as well.
  Either one sufficed, so **no mutation could turn the bench red**: removing one left the other
  working. A test never seen refusing guards nothing. One remains, and putting the proxy URL back
  does make the bench fail.

## [0.1.53] — 2026-08-17

### Fixed

- **An unverifiable pdf.js worker no longer stops an image from being displayed.** 0.1.52 gated
  `start()` — the whole reader's boot — on the worker's fingerprint. But `start()` also serves the
  **image** path, which never calls pdf.js: a worker that could not be verified therefore refused to
  show a PNG. A door closed on a room the rejected code could not reach.

  The refusal stays **whole for a PDF**, where the worker actually runs. Only the image path stops
  being gated on something it never used.

  ⚠️ Found by the **host's test harness**, not ours: its assistant stopped booting, and the first
  diagnosis was "a jsdom artefact". Fixing the harness would have hidden the defect — the harness was
  right and the diagnosis was incomplete.

## [0.1.52] — 2026-08-17

### ⚠️ One migration to apply — the player degrades without it, it does not break

`0004-limites-atomiques.sql` makes the shared rate limit count in **one atomic step**. Until it is
applied, counting stays as before — read, compute, write — so several simultaneous requests can
cross the cap together, and the player says so once, naming the file. Nothing closes: a missed 429
costs less than a dead viewer.

The atomic increment is **not expressible in REST** (`on conflict do update set count = count + 1`
has to name the column on both sides). This is the one operation in the product that needs a
database function; the portability guard still holds, an `rpc/` adding neither join nor boolean tree.

### Security

- **No email leaves the presentation any more — and four paths carried one, not two.** The audit
  reported `author_email` in the chat's public fields and `email` in the presence payload. Two more
  carried the same data: the **reactions map**, stored in the database with `email || name` as the
  reactor's identity, and the **presence channel key** itself, readable by every participant
  regardless of what `track()` sends. Our audiences are anonymous external visitors: opening the
  chat history was enough to walk away with the team's addresses.

  ⚠️ What replaces it is not a random pseudonym but the fingerprint of the **author token** — the one
  that already authorises editing and deleting. No instance secret is needed (hashing an address
  without salt protects nothing: the domain is known, first names are guessable), and **"this is my
  message" now says the same thing as "I am allowed to touch it"**: `isMine` compared addresses while
  editing has only ever checked the token, so a member on a second browser was offered an *Edit*
  button that answered 403.

- **A delayed write can no longer reopen a presentation that was ended.** Steering did: read the row,
  check the token, PATCH. Between the check and the PATCH the presentation may have been **ended** —
  and since steering writes `active: true`, the late request **reopened it for the whole audience**.
  The presenter had clicked *End*, seen the closing screen, and viewers kept following the pages.

  ⚠️ The condition is **not** `active = true`: a presentation goes inactive after three minutes
  without a heartbeat, and the next page must bring it back — an anonymous presenter has no other way
  to return. What separates a *decided* end from an *observed* expiry already exists: ending revokes
  the control token. So the token travels in the write's own condition, and each path carries the
  criterion it was already checking. Zero rows touched means refused.

- **An ended presentation becomes a read-only archive.** Seven routes still wrote after closing —
  messages, reactions, chat lock, attendance, and even a **signed upload URL** into the bucket of a
  closed session. The thread was no longer watched by anyone, which is exactly when something gets
  dropped into it. Reading stays open: what was said during a presentation has value afterwards.

- **An unverified pdf.js worker is never executed — the reader stops instead.** The previous
  behaviour fell back to the remote URL when the fingerprint refused, and **pdf.js wraps that URL in
  a same-origin blob itself**, so the unverified code ran: the worker's fingerprint bought nothing.
  Leaving the value empty does not close it either — pdf.js then derives a default address from its
  own position on the CDN. Both cancelled the check **in silence**; measuring the workers actually
  created was the only way to see it. A document that is not rendered is visible; a document rendered
  by unverified code is not.

- **Third-party supply chain, pinned where it decided for us.** 18 GitHub actions referenced by
  **tag** — which the author, or whoever takes their account, can move to another tree — are now
  pinned to a commit, with the tag kept as a comment. Leaflet's **stylesheet** had never been
  counted: third-party CSS moves, resizes and hides any element, so the button you think you are
  clicking may not be the one you click. Google Maps moves from `v=weekly` — a *channel* — to a
  version. A CI guard fails on any unpinned action.

## [0.1.51] — 2026-08-17

### Security

- **Third-party scripts are pinned to an exact version and carry an integrity fingerprint.** The
  serious part was not the missing fingerprint, it was `@2`: that jsdelivr tag follows the latest
  2.x, so the page served visitors whatever Supabase had published that morning — no deployment, no
  review, no way back. On the day of the fix it resolved to `2.112.3`, now pinned.

  The two go together: a fingerprint on a moving URL would break the page at the third party's next
  release. **Pinning makes the fingerprint possible; the fingerprint makes the pinning useful** — an
  exact version says which file you *ask for*, never which one you *receive*.

  | | before | after |
  |---|---|---|
  | `pdf.min.js` | exact version, no fingerprint | fingerprint |
  | `pdf.worker.min.js` (1 MB) | exact version, **out of reach of `integrity`** | verified in code |
  | `supabase-js` | **moving `@2`**, no fingerprint | `2.112.3` + fingerprint |
  | `leaflet` | exact version, no fingerprint | fingerprint on the injected tag |

  ⚠️ **The worker has no tag** — pdf.js loads it, so no `integrity` attribute can apply. It weighs
  three times the main script and sees every page of the document: protecting the tag and letting
  the worker through would be locking the door and leaving the window open. Its bytes already passed
  through our code (a cross-origin worker is refused by the browser, so it is fetched as text and
  turned into a same-origin blob), and that detour is now the checkpoint. Any doubt refuses, and
  refusing falls back on pdf.js's own backup worker — the path a broken network already took.

  ⚠️ A CI guard now refuses a third-party script that is unpinned, unfingerprinted, or absent from
  the inventory. It found a fourth dependency on its first run — the Google identity loader on the
  access wall, which a hand-written inventory had missed. Loaders that cannot carry a fingerprint
  are named **with their reason**, so adding one tomorrow is a visible choice.

  Audit finding **P2-4**.

### Internal

- **A test database, so the pages that matter are finally exercised.** The browser bench only
  covered the local preview: the tracked viewer and the audience page need a database, answered 404,
  and **their policies were exercised by nothing** — yet those are the pages a client and a viewer
  actually open. `tools/postgrest-en-memoire.cjs` unlocks them in ~150 lines, with no dependency and
  no account to create.

  What makes the double honest is a discipline taken elsewhere: the CI portability guard has long
  banned exotic query syntax, keeping the whole surface at `table?column=eq.value`. A constraint
  taken to make *porting* possible ended up making a *test database* possible.

  ⚠️ It refuses rather than invents: an unknown filter returns a 400 that names it, and an undeclared
  relation returns 404 like real PostgREST. A double answering "no rows" to a query it misunderstood
  would turn every test into fiction. It is **not** a database — no transactions, constraints, types
  or RLS; what belongs to the DBMS is verified on a real DBMS.

  The bench now covers three pages of four (the visitor access wall needs a plugin the standalone
  context does not have) and, on the tracked page, **asserts the read is recorded in the database**:
  the browser → server → database loop was closed nowhere.

  Audit finding **P2-3**.

## [0.1.50] — 2026-08-17

### Fixed

- **A participant could make their neighbours vanish from the attendee list.** The presence
  de-duplication table was a plain object indexed by identities **each participant composes
  themselves**, `uid` included.

  Measured before the fix: a participant whose identity is `constructor` **disappears** — the object
  answered "already seen" before anything had been written. And writing to `__proto__` does not
  create an entry, it **changes the prototype of the table**: an intruder announcing
  `uid: "__proto__"`, the presenter role, and their neighbours' addresses as extra keys made those
  neighbours disappear **from everyone's list**. Four participants, two erased.

  `Object.prototype` was never reached — the pollution stayed inside that table. But *local* does not
  mean *harmless*: the table **is** the attendee list.

  ⚠️ Why it lasted: `toString`, `valueOf` and `hasOwnProperty` were never a problem, because the
  identity is lowercased and `tostring` is inherited from nobody. **Two keys only** got through —
  `constructor` and `__proto__`. A defect that fires only there is never met by accident.

  A `Map` inherits no key, and it preserves insertion order even when an existing key is rewritten —
  exactly the "the presenter wins, at its position" rule, so the order array kept alongside became
  unnecessary. Audit finding **C-6**, the last one open.

### Internal

- **The viewer is now exercised in a real browser.** `jsdom` does not enforce CSP, and the server
  tests use a fake `res` that only records headers: a policy forbidding our own scripts passed every
  test and still gave the visitor a blank page. `npm run test:e2e` opens the local preview in the
  Chrome **already installed** (`playwright-core`, no browser download) and requires both that the
  page starts *and* that the policy **refuses** — an unnonced script, a foreign origin. Separate
  command and separate CI step: `npm test` must stay runnable in a bare container. Audit finding
  **C-10**.

## [0.1.49] — 2026-08-17

### ⚠️ Three migrations to apply — the player degrades without them, it does not break

| file | what it unlocks | until applied |
|---|---|---|
| `0001-destinataire-atteste.sql` | counting the reads of a visitor **you** vouch for | attested creation is refused, by name |
| `0002-ordre-des-ecritures.sql` | a stale write can no longer overwrite a fresher one | no order control — last arrival wins, as before |
| `0003-limites-partagees.sql` | rate limits count for the **instance**, not the process | counting falls back to memory, as before |

None is required for the version to run. Each is **additive** and safe to apply while the previous
code is running, so the deployment order never matters: migrate first and nobody writes the column
yet; deploy first and the player detects its absence, degrades, and names the file to apply.

The player will never apply them itself — it speaks to the database through PostgREST, which does not
execute DDL. See `docs/MIGRATIONS.md`.

### Added

- **A host can now vouch for a visitor it identified itself.** Pass `recipientEmail` on the
  server-to-server `docshare.create`: reads are counted, attributed and revocable, without an
  anonymous link or a member's token. What makes it safe is **who supplies the address** — the host's
  database after verification, never a form.

  ⚠️ It is stored **apart from `recipient_email`**, because that field carried two facts. At re-share
  time the parent's recipient becomes the **sender** (`from`, `replyTo`) of a message to an address
  chosen by whoever holds the link. Filing a vouched visitor there would have made our servers a
  relay signed by them — the second host's own objection, one step further along, which they had not
  seen. Left empty, the send guard *and* the re-share inheritance both refuse **without knowing why**.

  ⚠️ **An attested link is named, not closed.** It remains forwardable; a host whose documents are
  confidential must not rely on it.

- **Write order now survives an abandoned request.** The browser queue guarantees one write in
  flight — it removes the disorder we *cause*. But a request abandoned by the timeout may have
  reached the server and land after the one that replaced it: that disorder we *suffer*. Each write
  now carries a rank, and the server refuses a rank it has already passed.

  A rank, not a timestamp: a clock says *when*, and two tabs disagree; a counter says *after what*.

### Changed

- ⚠️ **`limits.allow` promises something different, and it is written in the contract.** It used to
  count per **process** — so on serverless a limit of 120/hour allowed 120 *per instance*. It
  existed, it reassured, and it bounded a fraction of what it claimed. The standalone context now
  counts in a shared table.

  The local counter stays in front as a **fast refusal**: it only ever under-counts, so if *it* is
  over the ceiling the shared one is too. Abuse is refused for free. The public read path stays local
  — its answers already come from a per-slug cache, and backing that guard with a shared counter
  would make the guard pay the price we had just spared the thing it guards.

  ⚠️ The shared count is **not atomic** (PostgREST cannot express "increment"): it under-estimates
  under heavy concurrency — letting a little more through, never refusing wrongly.

### Testing

- **A column belonging to a migration can no longer be written unconditionally.** `docs/MIGRATIONS.md`
  says PostgREST rejects the *whole* PATCH on an unknown column; two hours after writing that, I put
  `write_seq: 0` in the reclaim path without a condition — which would have broken **reclaiming**, not
  the new guarantee, on every un-migrated host. The probe existed; I had not called it there.

  ⚠️ What was missing was not the knowledge, it was the guard. A rule you remember is a rule you will
  forget.

## [0.1.48] — 2026-08-17

### Fixed

- ⚠️ **0.1.47 carried the brand key but not its consequence: the loader was blocked.** The key was
  fed, `brandForShare` resolved it, the right `src` was written into the page — and the logo's origin
  was **not** added to `img-src` on the preview route. The browser asked for the image and refused
  it. The file answered 200.

  The tracked-link path derived its three origins and had done so from the start. Two policies, on
  the same instance, at the same minute.

  ⚠️ **No server-side probe can see this.** The rendered HTML is perfect, the script compiles, the
  package is conform. Neither the post-publish smoke step, nor the artifact guard, nor a test that
  executes the page bites — **only a browser shows it**, and only to the eye. The second host found
  it at one of their clients.

  This is the fourth field of the same family and the first of a different nature: `internal_token`,
  the brand and the action names were all missing **from** the page. This one is *in* the page —
  what was missing is what the page is allowed to do next. The "no field by accident" guard therefore
  could not catch it: the field was provided.

  **The form, as they put it:** *any value that produces a URL destined for the browser must, by
  construction, add its origin to the policy.* One list, every route, and a guard that recognises
  image-bearing fields **by their nature** rather than from an inventory.

- **Two more cases the new guard found on its first run.** `bot_vphoto` worked **by accident** — the
  presenter's photo and the assistant's avatar usually come from the same storage, hence the same
  origin; the day a host files one elsewhere it disappears with nothing having changed on their side.
  And `presenter_avatar`, which does not travel in the HTML but in the configuration: the live layer
  turns it into an image at runtime, in the participants list.

### Known limit, written next to the code

The **audience** page shows participants' avatars, which arrive through presence — from as many
origins as the host has members. No list set at render time can anticipate them. Pre-authorising them
would mean widening the policy to an entire host origin: **a decision to take, not an oversight to
fix in passing.**

## [0.1.47] — 2026-08-17

### Fixed

- ⚠️ **A multi-brand host served one client's loader on another client's domain.** In preview mode —
  the mode a host uses for its *own* documents, with no tracked link — nothing carried the brand key,
  and `brandForShare` was never called on that path. A visitor opening a document therefore saw the
  name of a company they had never heard of, on the domain of the one they were dealing with.

  The machinery was already complete: the host answers `PLAYER_HOST_BRAND_URL`, `branding.forKey`
  resolves, tracked links display correctly. **What was missing was a transport, on one route.**
  `&brand=<key>` now feeds `brand_key`, and the same resolution runs.

  Reported by the second host, on a document opened at one of their clients.

### Testing

- ⚠️ **The family the bug belonged to is now closed — but not the way it was proposed.** Preview mode
  was built as *"a share without a share"*, so every field has to be rewired one at a time:
  `internal_token` was missing, `brand_key` was missing, **a third one would be**. The second host
  suggested letting preview accept the same fields as a share.

  Measured, that would open too far. The page reads **34** fields; **20** are absent from the preview
  object and **17 of those are deliberate** — the whole assistant plugin (which does not run in
  preview, and whose 116 KB a test already checks are not even embedded), `is_test`,
  `recipient_email`, `created_by`. Importing them wholesale would switch on features preview does not
  have.

  The closure is therefore *no field by accident*: everything the page reads must be **provided**, or
  **declared absent with its reason**. Adding a line to that table is a decision; forgetting one fails
  the build. The table is itself guarded against **relics** — a reason left for a field the page no
  longer reads would make it look current while describing a world that is gone.

## [0.1.46] — 2026-08-17

One thread runs through all of it: **what used to be protected by discipline is now protected by
construction.** Every fix here replaces a rule someone had to remember with a mechanism nobody can
bypass.

### ⚠️ Host action required before upgrading

Two new authorization action names are asked of `identity.canManageShares`:

| action | what it grants |
|---|---|
| `presentations.list.all` | list presentations one does **not** own — slugs, presenter names, counts |
| `presentations.stats` | read the **attendees** of a presentation one does not own — names, addresses, dwell time, pages |

If your authorization table is a **closed list**, add them before upgrading: an unknown action means
refusal, so every member — administrators included — loses access, and the refusal reads exactly like
a role problem. The second host saw this coming from the release note rather than from us writing it;
`docs/HOST-CONTRACT.md` now carries the full table, says the list grows, and a guard fails the build
if the code ever asks for a name the contract does not document.

Neither right is needed to read one's **own** presentations: an owner, and an administrator, are
always served without the player asking the host anything.

### Fixed

- ⚠️ **A hostile broadcaster could silence a whole meeting room.** The public-channel quota is keyed
  on the address, but the re-read cadence is chosen by **whoever broadcasts** — three spectators
  behind one office egress could be pushed past the quota, collect 429s, and **their pages stopped
  turning**. Before the limit such a participant was expensive; after it, they could silence. The
  cause is now bounded rather than the effect: a spectator gives itself a budget and never re-reads
  more than a presenter's actions justify. **The resynchronisation net is never rationed** — doing so
  would have replaced an outside denial of service with a home-made one.

- **Ending a presentation could be undone by a tab left open.** The control token survived the
  closure, and it is persisted in localStorage — so a second tab put the presentation back online for
  the audience. Ending now **revokes** the token. ⚠️ Staleness (three minutes without a heartbeat)
  deliberately does **not** revoke: there, "resurrection" is how a presenter whose laptop slept comes
  back, and an anonymous presenter has no other way in.

- **Attendance rows could be overwritten by any participant.** The presence channel broadcast the
  *measurement key* — so anyone could read a neighbour's and repost it. Presence now carries its own
  public identifier; the measurement key never leaves the browser except toward the server.

- **A member who knew a slug read the attendees of someone else's presentation** — names, addresses,
  dwell time, pages. The player now grants what is obvious (owner, administrator) and asks the host
  for the rest.

### Changed

- **Public reads are cached per slug** (`state=1`, `chat=1`), collapsing any cadence — legitimate or
  hostile — to one database read per window per instance. The window is derived from the audience
  scheduler's existing coalescing, so **no latency is added beyond what a spectator already accepts**.
  ⚠️ The idea came from the second host; the window did not: they proposed one second, citing our
  0.1.19 doctrine — which is about *authority*, not latency. Since that same doctrine emptied
  broadcast payloads, the re-read is now **the only path the page number travels**, so a one-second
  cache would delay every page turn.

  The rule is structural, not a list: *any response identical for all spectators of one slug is
  cached*, served by a single path. A guard rejects any branch that answers without it.

- **All presentation writes go through one queue.** Six paths wrote, two were guarded — 0.1.41's
  "map writes are sequential" was true of one path in three. The **write functions themselves** now
  queue: there is no direct path left, so nothing to forget. ⚠️ What it does not close, and it is
  written next to the code: a request **abandoned** by the timeout may have reached the server and
  land after the one that replaced it. The queue removes the disorder we cause, not the disorder we
  suffer.

## [0.1.45] — 2026-08-16

⚠️ **The limit shipped in 0.1.42 turned an amplification into a denial of service against the
audience — and we opened that door ourselves.**

### Fixed

- ⚠️ **A hostile broadcaster could silence a whole meeting room.** The public-channel quota is keyed
  on the **address**, and it was sized on what legitimate use consumes. But the re-read cadence is
  not chosen by the spectator — **it is chosen by whoever broadcasts.** The scheduler coalesces at
  400 ms, so a spectator can be made to re-read ~9 000 times an hour; three spectators behind one
  office egress therefore blow past the 21 600/h quota, collect 429s, and **their pages stop
  turning**.

  Before the limit, such a participant was expensive. After it, they could **silence**. That is the
  `X-Forwarded-For` lesson inverted: the limit does not rest on what the *caller* chooses — but it
  was *paid for* by someone who does not choose either.

  **The cause is bounded, not the effect** — lowering the quota would have punished the victim
  further. A spectator now gives itself a budget and never re-reads more than a presenter's actions
  justify: under hammering, ~9 000/h drops to 720/h.

  ⚠️ **The budget gates the signal, never the net.** `signaler()` is triggered by a broadcast, so by
  any participant — that is the door to ration. `maintenant()` is our own 25 s resynchronisation net:
  rationing it would leave an audience with an empty budget **permanently mute**, which would have
  closed one door by opening a smaller, more reliable one. The net is the floor.

  **The two numbers are one contract**: signal budget + net = a spectator's share, and the server
  quota = that share × `READERS_PER_EGRESS`. ⚠️ A test forced the quota derivation to be corrected: it
  counted only the *sustained* share, so a full room exceeded the quota by 475 re-reads — exactly
  everyone's burst. **The server must cover what the client allows itself, not its average.**

- **A dead copy of `fetchBorne` shipped in 0.1.44.** Moving the helper into the bundle removed
  nothing: a second implementation still lived in the template, and it was *that one* the audience
  used — a path covered by none of the tests written for the other. Two implementations of one
  contract, exactly what this repository keeps warning about. Removed; one entry point for all four
  paths.

### Testing

- ⚠️ **The test for the central property did not bite on the first try.** It hammered, then watched a
  lull — and a rationed net passed anyway, because the budget refills a token every 5 s while the net
  only runs every 25 s, so it always finds one after a pause. The condition that separates the two
  worlds is **continuous** hammering. The threshold was then **measured, not guessed**: 884 re-reads
  with the net free (720 budget + 20 burst + 144 net), exactly 740 when it is rationed. The assertion
  compares against the signal budget — the real boundary — rather than a hand-written number.

- **First end-to-end on the audience side**: the test renders the audience page, runs it, connects the
  live layer, and drives broadcasts through it.

## [0.1.44] — 2026-08-16

Two findings from the audit re-review that followed 0.1.43. ⚠️ **One of them was created by our own
0.1.41 fix** — the review is reading a movement, not a state.

### Fixed

- ⚠️ **"End" did not end anything final.** Piloting functions write `active: true`, and the control
  token **survived the closure**. A second tab left open therefore put the presentation back online
  for the audience while the presenter believed it closed. The token is persisted in localStorage:
  this was not a narrow race, it was a door left open at will.

  ⚠️ **The rule the audit proposed — "refuse every write when `active=false`" — would have broken a
  real recovery.** `active:false` covers two unrelated situations: a **decided** end, and an
  **observed** staleness (3 minutes without a heartbeat), where "resurrection" *is* how a presenter
  whose laptop slept comes back. Refusing both would strand an **anonymous** presenter forever —
  `present-reclaim` requires ownership, and `present-start` requires no session at all.

  The two are therefore separated by what actually distinguishes them — the decision. **Ending
  revokes the control token**; staleness leaves it intact. Owner paths, which need no token, are
  closed separately on `active=false`. No schema change. A mutation that makes the staleness sweep
  revoke — i.e. that applies the general rule — is rejected by the bench.

- ⚠️ **A hung request froze the write queue, and that risk came from our own fix.** Before 0.1.41 the
  scheduler called `fini()` immediately: writes could land out of order, but nothing could block. By
  making them sequential we traded a correctness defect for an **availability** risk — a suspended
  request never settles its promise, the queue never resumes, and the presenter drives into the void,
  silently. A browser guarantees no timeout of its own.

  `fetchBorne` lives next to `createScheduler` because it is its counterpart. It bounds the four
  paths that can wedge: audience re-reads, `pushPage`, `presentContent`, `endPresent`. The `pagehide`
  beacon stays deliberately unbounded — it is never awaited.

  ⚠️ **What the timeout restores, and what it does not.** **Liveness**: the queue resumes. Not
  **order** — an abandoned request may well have reached the server and land after the one that
  replaced it. Order despite abandonment needs a version number carried by the write; that belongs to
  the single-queue work, not here. Better said than left implied.

### Testing

- ⚠️ **A textual probe fell over, and the property had not moved.** A test looked literally for
  `fetch('/api/doc'` and failed once the call went through the bounded wrapper — while what it
  asserts (write *before* broadcasting) was unchanged. It now recognises the **act**, not the name of
  the call. Same lesson as the tag-filter patterns two versions earlier.

## [0.1.43] — 2026-08-16

### Fixed

- ⚠️ **A case detail is an attendance row.** 0.1.42 moved the member attendance key from the client
  to the verified token — but the client key was lowercased (`me.email.toLowerCase()`) and the
  derived one was not. Rows are found by `attendee_key=eq.` — an **exact** match. On a host whose
  identity returns the address as typed, the same member would therefore get a **second row**:
  accumulated time back to zero, and the colleague listed twice among participants.

  No effect where addresses are already normalised — which is the case for both current hosts, and
  exactly why nothing would have reported it. *An open contract does not rest on what its first two
  hosts happen to do.* Found while re-reading 0.1.42 before announcing it.

## [0.1.42] — 2026-08-16

Four findings from a third external audit (CODEX 5.6), and the first browser end-to-end test.

⚠️ **All four defects were already half-fixed.** In each case the right rule was written next to the
place where it was missing — a comment three lines above, a sibling action, twelve guarded writes
beside two unguarded reads. That is the pattern worth keeping from this release: *a rule stated in
one branch does not travel to the branch beside it.*

### Fixed

- ⚠️ **Ending a presentation announced the end before obtaining it.** `endPresent()` sent
  `sendBeacon` — which returns **no response at all**, neither "recorded" nor "refused" — then
  cleared the UI, erased the control token and closed the channel. If the call failed, the
  presentation stayed **live for the audience** while the presenter believed it closed; and with
  `clearCtl` having already discarded the token, they no longer had the means to close it. Only the
  3-minute staleness sweep remained.

  ⚠️ **The beacon bought nothing here.** It exists to get a request out while the page is *dying* —
  and the only caller was a **button**, which can afford to wait. It now lives on `pagehide`, and
  only there. The button waits for a 2xx before broadcasting, disconnecting, or erasing anything;
  on failure the presenter keeps everything needed to retry, and the button says so.

- ⚠️ **The anonymous presenter could turn pages but not move the map.** `present-start` requires no
  session — deliberately — and `present-page` therefore accepts the `control_token`. But
  `present-content`, which drives what the presentation *displays*, had been filed with the
  session-only actions. The call returned 401, swallowed by a browser-side `catch`, and the map
  simply did not follow. The two are the same act of piloting; they had been grouped by **proximity
  in the route, not by authority**. What stays owner-only is `present-switch`: changing the
  *document* shown is not driving the display.

- ⚠️ **A participant could overwrite a colleague's attendance row — using their email address.**
  `present-attend` identifies its row by a client-chosen `key`, and for a member `attendeeKey()`
  returned their **email**. Any anonymous visitor to the public link could post
  `key: "colleague@company.com"` and rewrite that row: the name and avatar shown in the participant
  list, and the accumulated reading time.

  ⚠️ Three lines above, the same route already said *"a proven identity **replaces** a claimed one"*.
  Name, email and avatar had indeed been replaced by the token's. The **key** slipped through —
  though it is the one value that decides *which row is written*. A member's key is now derived from
  the verified token; an anonymous keeps theirs, confined to an `anon-…` namespace it cannot leave.
  It is also drawn with `valeurImprevisible` instead of `Math.random()`: acceptable for an analytics
  id, not for the only thing separating two anonymous participants — the same fix made in 0.1.23 for
  the chat author token, twenty lines below in the same file, never carried up.

- ⚠️ **The public channel was an unbounded amplifier.** `state=1` and `chat=1` are served without a
  session, on a public link, and each call costs a database query. Twelve write actions passed
  through a limit; these two **reads** did not. And the **shared** resource pays — the database is
  the same for every document on the instance — so the cost of abuse does not fall on whoever causes
  it.

  ⚠️ **Where the guard sits *is* the fix.** `getPresentation()` ran *before* the `state`/`chat`
  branches: a limit written where the refusal is phrased would have refused correctly, with the
  right status code, **after spending exactly what it protects**. The tests therefore count database
  queries, not response codes. The quota is *derived* from the audience's cadence (25 s resync net
  + one presenter action every 5 s, times `READERS_PER_EGRESS` — the sessions constant reused, not
  reinvented), and a refusal is logged hourly: otherwise a whole meeting room would drop off with no
  named cause.

### Testing

- **First real browser end-to-end.** `finDePresentation.test.js` renders the presenter page, installs
  it in jsdom, runs its scripts, clicks *Present*, then clicks *End* with a server response held open
  by hand.

  ⚠️ This is what separates it from a textual probe. *"After the response"* and *"in the failure
  branch"* both place the broadcast after the call — only a provoked failure tells them apart. Four
  mutations restoring the defect are refused.

- ⚠️ **Two benches were fixed rather than worked around.** Static analysis was right three times
  about a hand-rolled `<script>` filter (it missed `<SCRIPT>`, then `</script >`, then
  `</script\t\n bar>`): the regex was **removed** — the benches run in jsdom, and `DOMParser` sees
  what the browser sees by construction. And a test that passed on Node 22 while failing on Node 24
  was not flaky: benches share one window, therefore share its timers, and a previous bench's
  500 ms-deferred write landed on the current bench's spy.

- ⚠️ **An artifact guard that read instead of running.** Its first version scanned the minified
  bundle for `.email`; a mutation reintroducing the defect under another name walked straight past.
  It now **executes** the shipped bundle and offers it identity five ways, old signature included.

## [0.1.41] — 2026-08-16

### Fixed
- ⚠️ **0.1.39 removed `hasFocus()` from the reading condition — and left `on(win,"blur",pause)` 170
  lines below.** The project therefore said two things at once: *"a visible document counts"* and
  *"a window without focus does not"*. Clicking the other screen's window fired `blur`, which
  paused counting.

  ⚠️ **Measured rather than assumed, and the audit's framing was too dark**: the periodic flush
  (12 s) calls `commit()`, which ends with `activeSince = viewable() ? now() : null` — so counting
  restarted by itself at the next flush. The leftover handler cost **at most one interval**, not the
  session: 58 s counted for 65 s elapsed in the bench. Real, bounded, and silent — every trip
  between screens shaved a few seconds.

  The contract is settled: losing focus means *another window is in front*, not *this document is
  no longer read*. Only `visibilitychange` carries that authority. The old test that demanded the
  opposite has been flipped, and a second one pins what must **not** change — a hidden tab still
  does not count.

  ⚠️ **Our bench never fired `blur`.** Third time in a day that a bench failed to exercise the
  property its test described, and the assertion was loose enough (`> 50` on 65 s) to pass with the
  defect anyway. *A test that tolerates twelve seconds of loss cannot see twelve seconds of loss.*

- **Map writes were not actually sequential.** The scheduler called `fini()` immediately while
  `presentContent()` was fire-and-forget, so its "one in flight, last one wins" guarantee applied to
  the order of *calls*, never to the order of *writes*. Several `PATCH` could fly together and an
  older position land after a newer one. `presentContent()` now returns its promise, and both
  schedulers wait for it.

  *Both reported by an external audit pass on 0.1.40.*

## [0.1.40] — 2026-08-16

### Fixed
- ⚠️ **Turning a page did not count as reading.** Idleness was measured from *input* events — mouse,
  keyboard, wheel, touch. But someone following a live presentation touches nothing: the pages turn
  in front of them, pushed by the presenter. They went idle after a minute, while **the one thing
  that proves they are watching was happening**.

  A page turn now counts as activity. It also puts the threshold back in its place: it arbitrates
  **silences** only. A real reader turns pages; a forgotten tab turns none.

  *Seen by the second host: "what really separates a reading from a forgotten tab is not duration,
  it is turning a page."*

### Changed
- **The idle threshold goes from 60 s to 3 minutes**, and the number comes from an asymmetry rather
  than a preference. A dense page — a spec sheet, a contract — takes one to three minutes to read
  without a single mouse movement, so 60 s counted an attentive reader as absent.

  The two errors do not cost the same:

  - *under-counting a real reading* → you call back a client who had read. Unpleasant, no consequence.
  - *over-counting an abandoned tab* → you tell a salesperson "they read their contract for twenty
    minutes", and they use it to push on price. **A decision taken on a fiction.**

  Hence the low end of the range the second host proposed (3–5 minutes).

  ⚠️ **The two measures stay separate**, and that is the point: `last_at − started_at` is *presence*,
  `total_seconds` is *activity*. A contract skimmed for thirty seconds and a contract left open for
  twenty minutes on a second screen are two different facts; collapsing them into one number loses
  one. Whoever reads the statistics chooses.

### Note
- ⚠️ **Three of our own tests pinned `70` instead of the threshold**, so they broke when the value
  moved although the property had not. They now derive from `SESSION_IDLE_MS`, which joins the
  shared contract: *a test that fixes a number forbids changing the number; a test that fixes the
  relation lets the number live.*
- ⚠️ **And the bench neutralised the very mechanism under test.** It returned `setInterval: () => 0`,
  so the idle loop never ran, `idle` stayed false forever, and removing the page-turn rule left the
  tests **green**. The mutation revealed it, not a re-reading. *A bench that disables what it tests
  is a test that cannot say no.*

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

[Unreleased]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.41...HEAD
[0.1.41]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.40...v0.1.41
[0.1.40]: https://github.com/Juli1artha/discovery-media-player/compare/v0.1.39...v0.1.40
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
