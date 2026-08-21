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
| `commercial_doc_views.ua` | browser (raw User-Agent) | same |
| `commercial_doc_sessions.recipient_email` | session attribution | purged with the row, 13 months after `last_at` |
| `commercial_doc_sessions.session_id` | session identifier | same |
| `commercial_doc_sessions.ip` | **IP address in the clear** | same — the most sensitive datum in the schema |
| `commercial_doc_sessions.ua` | raw User-Agent | same |
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

## Limits stated rather than left unsaid

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
