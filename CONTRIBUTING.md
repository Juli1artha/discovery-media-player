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

Node ≥ 22. There is nothing else to install: the tests spin the player up in-process against a
temporary folder, so they run offline and finish in seconds.

### The browser bench

```bash
npm run test:e2e  # opens the viewer in a real Chrome
```

`jsdom` does not enforce CSP, and the server tests use a fake `res` that only records headers. A
policy that forbids our own scripts passes all of `npm test` and still gives the visitor a blank
page — only an engine that actually refuses can tell us. This bench uses the Chrome **already on
your machine** (`playwright-core`, no browser download); set `PLAYER_E2E_CHROME` if it lives
somewhere unusual. Without a Chrome it skips locally, and **fails in CI** — where skipping would
leave open exactly the hole it exists to close.

## When the tests run, and what each one is for

Four benches, deliberately separate: each answers a question the others cannot, and knowing which
one went red tells you where to look before you read a single line of output.

| Bench | Command | What it proves | When it runs |
|---|---|---|---|
| Unit + integration | `npm test` | Behaviour, in-process against a temporary folder. 1515 tests, no network, no database | Every push and pull request, on Node 22 **and** 24 |
| Browser | `npm run test:e2e` | That a real engine accepts the pages — CSP is actually enforced, and an axe-core pass checks accessibility | Every push and pull request |
| Real database | `npm run test:base` | Behaviour against a real PostgREST and Postgres, not a stub, including a hardening probe | Every push and pull request |
| Cost under load | `npm run test:charge` | Database round trips **per gesture**, at a thousand viewers and on a deliberately slowed database | Every push and pull request |

Alongside them, on the same trigger: `npm run lint`, `npm run typecheck`, CodeQL, a blocking
dependency-vulnerability check, and the guards in `tools/` — every action pinned to a commit SHA,
base images pinned to a digest, the committed bundles still matching their sources, no plaintext
credential in any tracked file.

**All of it must pass before a pull request can merge**, and pull requests are the only way into
`main`. Nothing here runs only nightly; the weekly CodeQL scan is an addition, not the primary run,
and exists because rules change while code stands still.

**Reading a failure.** A guard that fails prints `::error::` and names the file and the rule. A
guard that could not *look* — no network, an unreadable file — says `GARDE NON CONCLUANTE` instead,
and that distinction is deliberate: it means the fix is in the guard or its environment, not in your
branch. Do not "just re-run" a red that names your branch.

Locally, run `npm test` and `npm run lint` before pushing; the other three benches need a browser or
a database and CI will run them regardless.

## The hooks install themselves

`npm install` puts a `pre-push` hook in place. It refuses two things: a push to a branch whose pull
request is already merged, and a push carrying a plaintext credential. It runs only in a clone of
*this* repository — never when the package is installed as a dependency — and it is idempotent.

⚠️ **Why the credential check runs before the push and not only in CI.** Every other guard here
catches a mistake a later commit can fix. A secret cannot be fixed by a commit: the moment it
reaches a public remote it is disclosed, rewriting history does not recall it, and the only real
remedy is to **revoke** it. CI would tell you a minute too late. The same guard
(`tools/secrets-en-clair.mjs`) runs in CI as well, so a `--no-verify` push does not slip through
unnoticed — but by then the cost is already the revocation.

It reports the file, the line and the *kind* of credential, and never the value itself: a CI log on
a public repository is public, and a guard that echoes what it found discloses it a second time, in
a place that cannot be revoked. It reads the files git tracks at the current commit, so a secret
committed and then removed in a later commit still travels in the history — the remote's push
protection is what covers that case.

⚠️ **Why automatic rather than documented.** The neighbouring repository has had this hook since
5 August, after an identical incident. This one received it on 14 August, once the same thing had
happened here: a fix committed to a branch four minutes after its pull request was merged, a
version published without it, and announced as containing it. A guard that needs a manual step per
clone is a guard that half the clones do not have — and that half is always where the incident
happens. Bypass in full knowledge with `git push --no-verify`.

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
   [`docs/HOST-CONTRACT.md`](docs/HOST-CONTRACT.md) — the contract with host applications, and its journal.

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

## Signing the CLA

Your first pull request gets one comment from a bot, asking you to reply with a single line. That
reply signs the [Contributor License Agreement](CLA.md), once, for every contribution you ever
make here.

**What you are agreeing to, in one paragraph.** You keep the copyright in your work. You grant the
maintainer a licence to use it — including the right to sublicense it. That last part is the whole
point: the core is AGPL-3.0-or-later and stays that way, but the maintainer may also offer the
same code commercially to organisations that cannot operate under the AGPL's network clause. That
second licence needs permission from everyone whose code is in the project, and a single
contribution from someone who later becomes unreachable would make it impossible for good.

**What it is not.** It is not an assignment: nothing is taken from you, and you remain free to use
your own work anywhere else, under any terms. It grants exactly what dual licensing requires and
stops there — read [`CLA.md`](CLA.md), it is two pages and says so in plain words.

If you contribute on behalf of an employer, that organisation signs too — see the last section of
the agreement.

## Commits and branches

Conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`), with a body that
explains *why*. Branch from `main`, open a PR, keep it focused on one thing.

If your change requires a newer player version in a host application, say so in the PR title
("requires player ≥ x.y") — deploy order is the player first, hosts after. The reverse makes a
feature disappear everywhere at once, with no error anywhere.

**Do not bump the version, and do not add a `CHANGELOG.md` section.** Your PR ships without
touching either: publishing is a separate, deliberate act, described in
[`docs/RELEASING.md`](docs/RELEASING.md).

## Language

Code comments are in French; issues, PRs and user-facing documentation are in English. Both are
fine in discussion — write in whichever you are more precise in.

## Conduct

[`CODE_OF_CONDUCT.md`](CODE_OF_CONDUCT.md) — the whole of it fits on one screen. The short
version: be straightforward, assume competence, settle disagreement with evidence. Personal
attacks get you removed.
