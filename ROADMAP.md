# Roadmap

Through **August 2027**. What this project intends to do, and — the half most roadmaps omit — what
it refuses to become. Intent lives here; fact lives in the [CHANGELOG](CHANGELOG.md). When the two
disagree, the CHANGELOG is telling the truth and this file needs a dated edit.

## Where the project stands

The core promise is shipped and enforced: a self-hosted document viewer — per-recipient tracked
links, reading analytics, live presentation — whose core knows nothing about the application
hosting it. Around it, the evidence is public rather than claimed: signed releases with
[verification instructions](docs/VERIFYING-RELEASES.md), an SBOM per release, a
[threat model](docs/THREAT-MODEL.md), and a test suite where every single test names the failure it
prevents — `npm test` prints how many there are.

The number that shapes everything below: **one maintainer**.

## The next twelve months

### 1. A second maintainer — the item that unblocks the others

Four independent scoring systems stall on the same fact: OpenSSF Baseline level 3 (`OSPS-QA-07.01`,
non-author review), Scorecard's Code-Review and Branch-Protection checks, and the Silver badge's
`access_continuity`. None of them is wrong. A single account holds merge, publish and settings
rights, and no guard can substitute for a person.

What we offer is the ordinary path: contribute, and it follows from there. The vetting that would
apply is already written — before anyone was waiting on it — in
[`MAINTAINERS.md`](MAINTAINERS.md#granting-access). The target state: one more person with merge
rights, then required review on `main`.

### 2. SQLite backend — when a third host asks

Scoped and measured in [issue #25](https://github.com/Juli1artha/discovery-media-player/issues/25):
49 call sites, 9 tables, roughly 25 repository methods, zero row-level policies to port. The
trigger is **demand, not a date** — both production hosts run Supabase today, and speculative
generality freezes the shape the third host would actually need. If you are that third host, say so
on the issue and this moves. Live presentation stays realtime-backed either way; whether it gains
an SSE transport is decided then, not now.

### 3. Viewer internationalization

The assistant already speaks fr/en/es, and every visitor-facing notice is injected by the host —
localizable today by whoever runs the instance. What remains is the viewer's own chrome strings.
This follows, rather than precedes, a real non-francophone deployment asking for it.

### 4. Keep the external evidence current

The practices exist; the work is keeping their public measurements honest. Scorecard's `Maintained`
check becomes evaluable around **11 November 2026** (90 days after creation) — the plan is to earn
it with normal activity, not to manufacture commits for it. Statement and branch coverage are
printed by CI on every run, with floors of 90% and 80% defending the published claims (each figure
measured before it was claimed: 83% at the first claim, then 90.31%/83.01% at the Gold claims).
Badges stay linked from the README so a drift is visible, not archived.

### 5. Release rhythm: unchanged, on purpose

Small, frequent releases; only the latest is supported; a fix is always a new release, never a
backport ([`SECURITY.md`](SECURITY.md)). This is what makes the abrupt support cutoff workable, and
nothing in the next year changes it.

## What we will not do

- **No hosted service.** Self-hosting is the point: your commercial documents and your prospects'
  reading data on your infrastructure, not ours. A SaaS offering would invert the product.
- **No document authoring, no CMS.** The player displays and measures. It never edits.
- **No third-party credentials inside the player.** A host that keeps documents behind a
  third-party API exposes one route; the player holds one secret for that route and nothing else
  ([`context/storage.js`](context/storage.js) carries the reasoning). Holding a third party's key
  would let the player read anything that key can — refused by design.
- **No LTS branch.** Stated in [`SECURITY.md`](SECURITY.md) with the reasoning; a promise one
  maintainer cannot keep is not made.
- **No licence drift.** AGPL-3.0-or-later core, MIT bridge (`src/bridge.ts`). The split *is* the
  integration story: the contract a host imports stays toll-free, the core stays copyleft.
- **No merged reading populations.** A prospect reading a proposal and a colleague re-reading it
  are never summed — a metric that flatters is the first one people stop trusting
  ([`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).
- **No coverage-driven tests.** The coverage figure is evidence, never a target. If the CI floor
  ever trips, the honest moves are a test for a real behaviour or withdrawing the public claim —
  never a happy-path test written to raise a number ([`AGENTS.md`](AGENTS.md)).

## How this file changes

Like everything else here: through a pull request, dated, with the reason attached. It is reviewed
when a trigger fires (a third host on #25, a second maintainer arriving) and at least at each
release train. An intention that quietly expired is worse than one withdrawn out loud.

*Last reviewed: 2026-08-25 — horizon through 2027-08.*
