# Data retention

This document is the **declared scope** of retention: every column of the schema whose *shape* can
carry personal data has a policy here — *purged after N* or *kept because*. A CI guard enumerates
the columns of the **live** schema (`information_schema`, never our memory of the file) and refuses
any personal-shaped column missing from this page: data without a written policy cannot enter the
schema without turning the build red.

The verification contract has two halves, deliberately **independent** (no shared code — no scope
function, no filter):

1. the **purge** (`server/retention.js`) declares what it erased, count by count;
2. the **census** (`supabase/recensement-retention.sql`, plain SQL) counts what remains inside the
   claimed scope. The two numbers must contradict each other if either one lies.

> ⚠️ **Proposed windows, to be confirmed by the operator.** The durations below are reasoned
> defaults (analytics logs: 13 months, for year-on-year comparison; presentation archives: 12
> months after the end). A host adjusts them through `config.retention` — **whole months in
> [1, 120] only**. Any negative, zero, non-integer, `NaN`, `Infinity` or string value makes the
> purge FAIL before the first `DELETE`, naming the offending key: a configuration mistake never
> deletes anything. Bounds are computed in UTC and clamped to the last day of the target month
> ("31 March − 1 month" = 28 February, not 3 March).
>
> ⚠️ **The automatic sweep is STRICTLY OPT-IN**: it runs only if the host writes
> `config.retention.balayage: true`. A host consuming the standalone context as-is inherits all of
> its capabilities by default — "nothing to wire up because nothing was unwired" — and a deletion is
> a business decision: it acts only where an operator has written it down. The `retention.run`
> action (trusted host or admin) stays available without opt-in: calling it IS the decision.

## Reading logs (external audience)

Purpose: reading statistics for a document that was sent out. **Purge: 13 months** after the event.

| column | contents | fate |
|---|---|---|
| `commercial_doc_views.recipient_email` | who the read is attributed to | purged with the row, 13 months after `at` |
| `commercial_doc_views.session_id` | correlates the views of one session | same |
| `commercial_doc_views.ua` | **emptied, and never written again** | ⚠️ **Nothing is stored here any more** (migration **0027**). The clearest case of the three: unlike the sessions table, this one has no `device`, `os` or `browser` — it derived *nothing* from the string, wrote it, and no query in this player has ever read it back. A browser fingerprint kept for thirteen months with no reader at all, unnoticed because the question had never been asked table by table |
| `commercial_doc_sessions.recipient_email` | session attribution | purged with the row, 13 months after `last_at` |
| `commercial_doc_sessions.session_id` | session identifier | same |
| `commercial_doc_sessions.ip` | **emptied, and never written again** | ⚠️ **Nothing is stored here any more.** It held the reader's IP address in the clear and was the most sensitive datum in this schema. `0.1.146` stopped **serving** it; `0.1.147` stops **writing** it and migration **0026** erases what thirteen months of journal still carried. The column itself survives for now — dropping it would break a host that applies migrations before deploying (see *Purging the reader IP* below); its removal is a later release. The asymmetry this table used to note ends here, upward: a presentation attendee's address is a salted HMAC, a reader's is now nothing at all |
| `commercial_doc_sessions.ua` | **emptied, and never written again** | ⚠️ **Nothing is stored here any more.** `0.1.146` stopped serving it; `0.1.147` stops writing it and migration **0027** erases what was there. `device`, `os` and `browser` are derived from it *at write time* and are what a reading record carries — so the raw string had no reader left, and "we might re-parse it one day" does not justify thirteen months of a fingerprint kept for nobody. Same treatment and same reason as `ip`: emptied now, column removed in a later release |
| `commercial_doc_sessions.num_pages` / `commercial_doc_sessions.pages_time` | page-by-page reading behaviour | same |

## Reading logs (internal team)

Same purpose, internal audience. **Purge: 13 months** after `last_at`.

| column | fate |
|---|---|
| `commercial_doc_internal_sessions.user_email` / `commercial_doc_internal_sessions.user_name` | purged with the row |
| `commercial_doc_internal_sessions.session_id` | same |
| `commercial_doc_internal_sessions.num_pages` / `commercial_doc_internal_sessions.pages_time` | same |

## Sending links (`commercial_doc_shares`)

A **live** link is a business record: its fields stay for as long as the distributed URL must keep
working. A **revoked** link serves nobody: **purged 13 months after revocation** (aligned with the
logs, which reference its slug). Revocation is **dated** by `commercial_doc_shares.revoked_at`
(migration 0013); links revoked before that column existed were given the migration's date — their
clock starts there, counting generously rather than inventing. Without the column, that particular
purge stays silent (schema probe); the others still run.

| column | contents | fate |
|---|---|---|
| `commercial_doc_shares.recipient_email` | who may forward on re-share | kept while the link lives; row purged 13 months after revocation |
| `commercial_doc_shares.attested_recipient_email` | who the host attests the link to | same |
| `commercial_doc_shares.recipient_name` | recipient's name | same |
| `commercial_doc_shares.created_by` | email of the salesperson who created it | same |
| `commercial_doc_shares.file_name` | file name (may carry a person's name) | business data, purged with the row |

## Live presentations

An **inactive** presentation (finished or abandoned) is an archive: **purged 12 months after
`updated_at`** — the presentation, its messages, its attendance records, and its attachments in the
`present-attachments` bucket (if the host provides `storage.remove`, otherwise the limit is stated
below).

| column | contents | fate |
|---|---|---|
| `doc_presentations.presenter_name` / `doc_presentations.owner_name` | presenter's identity | purged with the row, 12 months after the end |
| `doc_presentations.owner_email` / `doc_presentations.owner_user_id` | owner | same |
| `doc_presentations.owner_avatar` | avatar URL | same |
| `doc_presentations.control_hash` | fingerprint of the control token (not the token) | same |
| `doc_presentations.content` | shared content (cards, media) | same |
| `doc_presentations.file_name` | name of the presented file | same |
| `doc_presentation_messages.author_name` / `doc_presentation_messages.author_email` / `doc_presentation_messages.author_avatar` | author's identity | purged with the presentation |
| `doc_presentation_messages.author_hash` | fingerprint of the author token | same |
| `doc_presentation_messages.body` | message body | same |
| `doc_presentation_messages.reply_name` / `doc_presentation_messages.reply_text` | quotation of another message | same |
| `doc_presentation_messages.attachment` | attachment URL | same — the bucket file included when `storage.remove` exists |
| `doc_presentation_messages.client_key` | idempotency key for sending | same |
| `doc_presentation_attendees.name` / `doc_presentation_attendees.email` / `doc_presentation_attendees.avatar` | attendee's identity | purged with the presentation |
| `doc_presentation_attendees.attendee_key` | presence identifier | same |
| `doc_presentation_attendees.creator_ip_hash` | **truncated fingerprint** of the IP that created the row (never the IP in the clear) — used for the anonymous-creation ceiling (migration 0015). ⚠️ **PSEUDONYMISED data, not anonymous**: a hashed IP remains personal data under the GDPR, and an unsalted SHA-256 can be recomputed exhaustively over the whole IPv4 space. Since 0.1.114 the fingerprint is an HMAC salted with `PLAYER_IP_HASH_SECRET` (failing that `PLAYER_PRESENCE_SECRET`, with domain separation) and bound to the `slug`, which prevents correlating one address across presentations. With no salt configured, the old unsalted fingerprint survives. | purged with the presentation |
| `doc_presentation_attendees.last_token_at` / `doc_presentation_attendees.last_no_token_at` | timestamp of the last heartbeat with / without a presence token — feeds the transition counter (migration 0017), carries no identity | purged with the presentation |
| `doc_presentation_attendees.pages` | pages the attendee viewed | same |

## Agent sessions (`doc_bot_sessions`)

Agent-guided walkthrough: **purged 13 months** after `last_at`.

| column | fate |
|---|---|
| `doc_bot_sessions.rating` / `doc_bot_sessions.rating_comment` | visitor's feedback — purged with the row |
| `doc_bot_sessions.in_tokens` / `doc_bot_sessions.out_tokens` / `doc_bot_sessions.cache_tokens` | AI volume (not personal, but carried by the row) — purged with it |

## Rate limits (`player_rate_limits`)

| column | contents | fate |
|---|---|---|
| `player_rate_limits.key` | may contain an **IP in the clear** (`hshare:<ip>`) or an email | row purged as soon as `expires_at` has passed (opportunistically, on every pass) |

## Voice cache (`doc_tts_objects` + the `tts-cache` bucket)

Every synthesis writes two objects to the **public** `tts-cache` bucket — `<fingerprint>.mp3` and
`<fingerprint>.json` (per-character alignment). The fingerprint is a digest of voice + model +
**spoken** text. They are **purged 13 months** after `created_at`: the two objects first, then the
row — never the other way round, because erasing the trace first would leave the objects
permanently unreachable.

| column | contents | fate |
|---|---|---|
| `doc_tts_objects.hash` | the fingerprint — **never the text** | purged with the row, after both bucket objects |
| `doc_tts_objects.created_at` | when the object was written | the window is measured on it |

⚠️ **Why a table exists at all.** The objects are named by a digest that ties back to no row, and
the host `storage` capability exposes `put` and `remove` — never `list`. Before this table the
bucket could not be swept at all: there was nothing to walk. This is not a policy that was missing,
it is the trace. The row records a fingerprint and a date and nothing else: writing the text here
would recreate, inside the database, whatever personal data the bucket may already hold — and make
it queryable, which is strictly worse than not having it.

⚠️ **A visitor chooses what goes in.** `bot-tts` accepts the caller's text, so a unique text leaves
an MP3 and a JSON in a public bucket. The grouping and ceilings added in 0.1.140 bound the cost per
hour; only this window bounds the **duration**.

## Purging the reader IP and User-Agent (migrations 0026 and 0027)

⚠️ **Read this before upgrading if you have ever queried `commercial_doc_sessions.ip` directly.**
It is now always `NULL`. `0.1.146` had already stopped serving it — no player path reads it back —
and `0.1.147` stops writing it, so nothing in the player changes; a report or dashboard of your own
that reads values from it starts seeing empty ones. This notice exists so that it is announced
*before*, not explained afterwards.

**The column is emptied, not dropped — and emptying is what actually erases.** This is the reverse
of the intuition, so it is worth the measurement. `ALTER TABLE … DROP` of a column marks the
attribute dropped; it does **not** rewrite the rows. Measured on PostgreSQL 16.13 with
`pageinspect`, on rows carrying an address:

| after | addresses still present in the heap |
|---|---|
| dropping the column | **all of them** |
| … then routine `VACUUM` | **all of them** — the rows are *live*, so there is nothing to reclaim |
| … then `VACUUM FULL` | none — but that rewrites the table under an exclusive lock |
| `UPDATE … SET ip = NULL`, then routine `VACUUM` | **none** |

Dropping the column on its own would have left every address on disk indefinitely — invisible to
any query, and therefore never checked by anyone again, while the schema swore it was not there. The
`UPDATE` writes new row versions without the address and makes the old ones dead; **ordinary
autovacuum reclaims them by itself**, with no exclusive lock and no operator action. Verified end to
end on a populated database: 200 rows kept, 200 addresses gone after a routine vacuum, the migration
replayable with no further effect. **The erasure is therefore complete today.** What is deferred is
the shape of the schema, not the data.

**Why the column itself survives, for now.** A migration here must be safe to apply *while the
previous version of the player is running* — that rule is what makes the deployment order harmless,
and it is enforced by a test. `0.1.146` still writes `ip`, and PostgREST rejects a write carrying an
unknown column: dropping it today would fail **every** session write of a host that applies
migrations before deploying, with an error naming a column rather than a version. The column is
removed in a later release, once no supported version writes it. Until then it exists, is always
`NULL`, and carries a comment in the database saying so — `col_description()` on it is how you
attest that 0026 ran.

**What the migration cannot reach, and you can.** Write-ahead logs already written, backups, exports
and migration dumps still carry the addresses; they follow *your* retention policy, not this file.
This is the general rule stated at the end of *Limits stated rather than left unsaid* — a dropped
column is itself a retention act, and earlier copies follow the host's backup policy — in its first
concrete instance. A host that must attest a **complete** purge expires or rewrites its earlier
backups; no migration can do that on its behalf.

**The raw User-Agent goes the same way (0027), on both tables.** `0.1.146` stopped serving it,
`0.1.147` stops writing it, and 0027 erases what was there — same shape, same measurement, same
deferred column removal. `device`, `os` and `browser` are derived from the string *at write time* and
are what a reading record carries, so the raw value had no reader; "we might re-parse it one day" is
not a reason to keep a fingerprint for thirteen months. On `commercial_doc_views` the case is
starker still: that table has no derived columns at all, so it derived nothing from the string and no
query has ever read it back.

**What is not covered.** `player_rate_limits.key` may still hold an address in the clear and expires
on its own. `doc_presentation_attendees.creator_ip_hash` is a salted HMAC, not an address.

## From what date is a purge complete end to end

A question worth answering precisely, because the honest answer has three parts and only one of them
is a number.

**1. The rows.** Reading logs are deleted **13 months** after `at` / `last_at` by default. A host
changes that through `config.retention` — whole months in `[1, 120]`.

⚠️ **But the automatic sweep is strictly opt-in.** It runs only where a host has written
`config.retention.balayage: true`; the `retention.run` action stays available without opt-in, because
calling it *is* the decision. **On a host that has enabled neither, no row has ever been deleted, and
the 13 months describe an intent rather than an event.** Anyone attesting a retention period should
check which of the two is true of the installation in front of them, rather than quoting the default.

**2. The values inside surviving rows.** Erased by 0026 and 0027 as soon as they are applied, and
physically gone from the table once routine autovacuum has passed — no operator action, typically
minutes to hours on an active table. This part does not wait for the 13 months.

**3. Backups, write-ahead logs, exports and migration dumps.** **Outside this player's reach, and we
neither set nor observe them.** They follow the hosting platform's own settings — on a managed
provider, typically a point-in-time-recovery window plus a snapshot schedule, each with its own
retention. A purge is complete end to end at *the later of*: the day 0026/0027 were applied plus the
host's longest backup retention, and — for the rows themselves — whichever purge the host actually
runs. **Ask the platform for two numbers: the PITR window and the oldest retained snapshot.** Until
both have rolled past the migration date, earlier copies still hold the erased values.

## Limits stated rather than left unsaid

- ⚠️ **`fichiersErreur` can be high without any removal having failed.** Each fingerprint has two
  objects, and the alignment `.json` is not always there — the provider does not always return one.
  Measured on an integrating host's bucket on 27/08: **552 `.mp3` for 356 `.json`**, so 196 audio
  files legitimately have no companion to remove. The count is deliberately not masked, but read it
  with that in mind: a first sweep reporting two hundred "errors" may have failed at nothing.
- **If you write to the `tts-cache` bucket yourself, write the trace too**, or your objects are
  invisible to the sweep permanently — see *Voice* in `docs/HOST-CONTRACT.md` for the exact
  fingerprint and the insert. The same host had written **908 objects under the player's exact
  naming**; nothing but the missing row distinguished them.
- **Voice-cache objects written before migration 0021 have no trace, and never will.** The sweep
  can only reach what a row points at, and no row was ever written for them. They stay in the
  bucket until an operator removes them by hand. The census counts rows, so it cannot see them
  either — it can say "no trace past the window survives", never "the bucket is clean".
- **Orphaned attachments**: purging the rows erases the bucket file only if the host context
  provides `storage.remove` (an optional capability). Without it, the URL becomes unreachable from
  the product but the object survives in the bucket — said here rather than simulated.
- **The presentation ceiling is GLOBAL**: messages and attendance records each share one `plafond`
  budget spread across every presentation of a run — not a ceiling per presentation (otherwise
  500 × 5000 = 2.5 M possible rows). The loop stops when the budgets are exhausted, without
  deleting the remaining presentations.
- **The dryRun report is complete for presentations**: `messagesExaminees`, `presencesExaminees`
  and `fichiersCandidats` say what the REAL purge would do — same selection walk, no-op deletion,
  `efface.* = 0`.
- **The purge advances in BOUNDED BATCHES** (200 rows, a ceiling of 5000 per table and 500
  presentations per run): it selects a batch of identifiers, deletes them with `id=in.(…)`, and
  starts again. The report (`r.rapport`) carries, per table: `examinees`, `supprimees`, `tronque`
  (there is more left for the next pass). `retention.run` accepts `{ dryRun: true }`: it counts
  without erasing anything — to be run before the first real purge of a large history.
- **Indexes** (migration 0014): `commercial_doc_sessions(last_at)`, `doc_bot_sessions(last_at)`,
  `commercial_doc_shares(revoked_at) where revoked`. On a LARGE installation already in production,
  create them by hand with `CREATE INDEX CONCURRENTLY` outside the migration (the migration lays
  them down as ordinary indexes, which briefly locks writes — negligible on a young database, to be
  avoided on a large active table).
- **The census does not run by itself in production**: it is a piece of SQL an operator runs (and
  that CI executes on every run against a real, artificially aged database).
- **"What exists" has a depth in time that `information_schema` does not have** (a question from the
  second host, with no mechanical answer): a column dropped from the schema leaves the scope of both
  texts, but its data may survive in a dump, a backup or an archive table. This contract covers the
  LIVE DATABASE; copies (backups, exports, migration dumps) are the operator's scope, named here
  rather than simulated. Operational corollary: dropping a column holding personal data is itself a
  retention act — its row leaves this document in the same commit, and earlier copies follow the
  host's backup policy.
