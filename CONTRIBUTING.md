# Contributing

Thanks for looking. This project runs two products in production; changes are welcome, and they
are reviewed with that in mind.

## Getting set up

```bash
npm install
npm test          # unit + integration, no network, no database
npm run lint
npm run typecheck
npm run build     # regenerates the browser bundle (committed — see below)
```

Node ≥ 18. There is nothing else to install: the tests spin the player up in-process against a
temporary folder, so they run offline and finish in seconds.

## The one rule

**A behaviour worth keeping is worth a test that fails without it.**

Most of this codebase's tests exist because something broke once, and the comment above each one
says what. That is the format we ask for: not "tests the happy path", but the failure the test
prevents. A test whose name does not tell you what it protects will be asked about in review.

## What review looks for

1. **Does it fail loudly?** Silent degradation is the recurring bug class here — a truncated PDF
   that looks fine, a refusal that looks like an outage, a guard that quietly widens. If your
   change can fail invisibly, make it fail visibly instead.
2. **Does the core still know nothing about its host?** Everything the player borrows arrives
   through the injected context. `player/server/**` must not require anything outside itself —
   a test enforces this.
3. **Can the plugins still be unplugged?** The core must display, track and present with every
   optional module disabled. Also enforced by a test.
4. **Is the boundary documented?** If you change what a host can call, say so in
   [`CONTRAT.md`](CONTRAT.md) — the contract with host applications, and its journal.

## Generated files

`server/*.generated.js` are built from `src/*.ts` by `npm run build` and **committed on purpose**:
they are deployed as-is by serverless platforms, which never run a build step. Change the `.ts`,
run the build, commit both. CI fails if they drift.

## If you run an instance

Hosts are the best source of defects this project has: every one found so far came from someone
integrating it, not from reading the code. The rule is short.

**Fix the player in the player's repository — never in your own.** Open an issue or a pull request
here. You have the context, and often the fix already written.

**Releases stay with the maintainer.** Not hierarchy: publishing a version decides deploy order
(the player ships before its hosts). If everyone publishes, nobody knows which instance runs what.

**A local workaround is fine when you are blocked** — on two conditions: open the report the same
day, and remove the workaround when the release lands. Otherwise it becomes permanent, and two
implementations drift apart. That is the problem this project exists to avoid.

One caution, from experience: a host naturally fixes for its own case. One reported that the
handler reads `req.query`, which their bare HTTP server did not fill, and shimmed it in three
lines. Their fix was right. The *right* fix was in the core, because the defect affected every
host — present and future. Expect the maintainer to move your fix somewhere else, and read that
as the system working.

## Commits and branches

Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`), with a body that
explains *why*. Branch from `main`, open a PR, keep it focused on one thing.

If your change requires a newer player version in a host application, say so in the PR title
("requires player ≥ x.y") — deploy order is the player first, hosts after. The reverse makes a
feature disappear everywhere at once, with no error anywhere.

## Language

Code comments are in French; issues, PRs and user-facing documentation are in English. Both are
fine in discussion — write in whichever you are more precise in.

## Conduct

Be straightforward and assume competence. Technical disagreement is welcome and is settled with
evidence — a failing test, a log, a spec. Personal attacks are not, and get you removed.
