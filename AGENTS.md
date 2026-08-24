# Working on this repository with an AI agent

This file is for coding agents (and the humans driving them). It states the conventions that
are not obvious from the file tree. Most mechanical rules are enforced automatically — by a
test, a CI step, or a hook — and are listed first; the conventions that only review enforces
are listed separately, as such. Neither list is optional: the difference is only *who* catches
the violation.

## Commands

```bash
npm ci
npm test              # 1100+ tests, in-process, no network, no database — seconds
npm run lint
npm run typecheck
npm run build         # regenerates server/*.generated.js + dist/ — see below
npm run test:e2e      # needs a local Chrome; skips locally, REQUIRED in CI
```

Node ≥ 22. `npm test`, lint and typecheck must all be green before a push — CI runs them on
Node 22 and 24 and will not be more forgiving than your machine.

## The one rule

**A behaviour worth keeping is worth a test that fails without it.** Before fixing anything,
write the test that is red for the exact failure you are fixing; the comment above it says what
broke and when. Do not write happy-path tests to raise a number — no test exists here for
coverage's sake, and coverage is deliberately not measured.

## Conventions the guards enforce

- **Generated files are committed, never edited.** `server/browser.generated.js` and
  `server/shared.generated.js` come from `src/` via `npm run build`. Edit the TypeScript source,
  rebuild, commit both. CI rebuilds and fails on any drift.
- **Exact versions everywhere.** GitHub Actions are pinned to a 40-hex commit SHA (tag kept as
  a trailing comment); examples pin one of the **last two published** versions (never one npm does not serve yet); third-party browser
  scripts are version-pinned **and** SRI-fingerprinted in the `TIERS` inventory. CI rejects
  every floating or stale reference.
- **Facts must not exist in two unconfronted copies.** Documented env vars ↔ `.env.example` ↔
  the variables the code reads, the identity card in `docs/HOST-CONTRACT.md` ↔
  `server/handler.js`, the database call count in `docs/API.md` ↔ the code, changelog sections ↔
  their comparison links, `supabase/init.sql` ↔ the migrations: each pair has a CI step that
  compares them. If you change one side, change the other in the same commit.
- **No workflow grants write permission at its root.** A permission declared at the top of a
  workflow file is granted to *every* job in it — including the ones nobody has written yet, whose
  author will inherit it without asking and without seeing it. Writes go on the job that uses them.
  `release.yml` is the worked example: its job that executes a tarball **downloaded from the
  registry** used to run with enough rights to publish to npm, purely because the grants lived at
  the root.
- **No source directory escapes the linter, and a warning stops CI.** `npm run lint` covers
  `bin context server src build tools charge` with `--max-warnings 0`. It used to stop before
  `tools/` — the eleven guards that reject everyone else's PRs were themselves unchecked — and
  `no-unused-vars` was switched off for every test file with no comment saying why. CodeQL had been
  reporting the consequences on `main` for a week: 40 open alerts for a defect the repo's own linter
  sees in two seconds. `tools/__tests__/perimetreDuLinter.test.js` now holds the perimeter.

- **The database surface stays portable.** Core queries are `table?column=eq.value` PostgREST
  syntax only — no embedded joins, no `or=()`/`and=()` trees, no `offset=`. Schema expectations
  are declared once in `server/schema.js`, never probed ad hoc.

## Review conventions (enforced by people, not machines)

- **Code comments are in French** and carry the *reason* for the decision they sit next to.
  Do not translate them, and do not strip them when refactoring — they are the project's memory.
  Issues, PRs and user-facing docs are in English.
- **Conventional commits** (`feat:`, `fix:`, `docs:`, `test:`, `chore:`), body explaining *why*.
- **Do not bump the version or add a CHANGELOG section.** Releasing is a separate, deliberate
  act (`chore(release)` + tag) with its own gated workflow and its own document —
  [`docs/RELEASING.md`](docs/RELEASING.md). A code or docs PR ships without touching either.

## When you edit a file with a script

**Write after each substitution, not once at the end.** A script that applies several replacements
and saves at the end will, on a later failure, discard the earlier ones that succeeded — and the
file looks untouched, so nothing tells you the first fix is gone.

⚠️ The neighbouring trap is worse and has no error at all: a second substitution whose pattern
matches what the first one just inserted. It deletes it silently, and what is left can be perfectly
valid code —

```js
if (ACTIONS_LIEES_A_UNE_SESSION.has(body.action)) {
}
```

— a guard that checks nothing, which `require()` loads without a word. Both of these happened on
this repository on 24/08, in two independent sessions, on the same day. **Re-read the region you
edited.** Neither case was caught by a tool; both were caught by reading.

## An assertion that costs its author is still an assertion

**Nobody re-checks a claim that makes its author look bad.** It reads as expensive, therefore
sincere, therefore already verified. It is not.

⚠️ This happened on 24/08 and cost two sessions. Writing up the release-verification page, one
session stated that no CI check confronted the npm tarball with the archive attached to the Release
— an admission of a hole in our own pipeline. The other session did not re-check it; it built on
it. **The check existed**: the `attester` job compares its rebuilt `sha512` against the registry's
`dist.integrity` and refuses to attach anything if they differ. The false claim was found only
because its own author went to read the workflow before publishing the page.

The correction was not "there is no hole" but a finer statement worth keeping: the hole was not in
the pipeline, it was in **what a reader can conclude on their own** — the refusal happened on our
side, at a moment they did not witness.

So: verify a self-accusation with the same suspicion as a self-congratulation, especially before it
reaches a page someone will act on. And prefer stating where a property is *held* over stating that
it is missing — the first is checkable against a file, the second against nothing.

## Boundaries

- `server/` must keep working with **zero knowledge of its host**: everything external arrives
  through the injected context (`docs/HOST-CONTRACT.md`). A change that reaches around that seam
  is wrong even if every test passes.
- Deny-by-default is the security posture (file proxy, schema probes, retention perimeter).
  When adding an input, the question is never "what should I block" but "what did I decide to
  allow" — and the allow-list belongs next to a comment saying why.
- `src/bridge.ts` is MIT while the rest is AGPL — do not move code across that line casually.

## When a guard rejects you

Read its message: every CI step here names the incident that created it and what to do. The fix
is almost never to weaken the guard — if you believe a guard is wrong, the bar is the one the
repo always uses: show the case, with evidence, in the PR.

**First, read the exit code — the two failures are not the same failure.** The guards in
`tools/` answer with three, defined once in [`tools/resultat-garde.mjs`](tools/resultat-garde.mjs):

| code | meaning | who fixes it |
| --- | --- | --- |
| `0` | the rule was checked, and it holds | — |
| `1` | the rule was checked, and **this repository violates it** | you, in your branch |
| `2` | the rule **could not be checked** — the probe found nothing to read, an input was unparseable, a network call failed | the guard or its environment, **not your branch** |

A `2` prints `GARDE NON CONCLUANTE` and says so in as many words. It still fails CI, and that is
deliberate: nothing was verified, so nothing is proven — a guard that fails quietly is worse than
no guard. What the code buys is not severity but *legibility*. Before this split, both reds were
`1`, and a contributor who once traced a red back to a misfiring probe had learned that this
guard's red is sometimes noise. The next red — the real one — meets a reader who already knows
the gesture for clicking past it.
