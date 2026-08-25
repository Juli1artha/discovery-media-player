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
coverage's sake.

Coverage **is measured and published** since 2026-08-25 — a reversal of the sentence that stood
here ("deliberately not measured"), and the reversal carries its reason. What changed is not the
rule above but the audience: the OpenSSF Silver form asks whether the suite provides ≥ 80%
statement coverage, and an outside evaluator cannot verify a number nobody publishes. The figure
was already true before it was claimed (83% measured, then the claim made — in that order), so CI
now prints it on every run, with an 80% floor. ⚠️ The floor defends the **public claim**, not a
quality target: if it ever trips, the honest moves are a test for a real behaviour, or withdrawing
the claim from the badge form — never a test written to make a number go up. A suite padded to
protect a threshold is worth less than the smaller suite it replaced, because nobody can tell the
two apart from the number alone.

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

## A check can only refuse if its two inputs stay distinguishable

**Name both of them in the code, not only in the sentence.** Count the distinct nouns in the
sentence describing your check; count the distinct handles in the code that runs it. If the code
has fewer, the distinction was erased before the comparison and the check can no longer refuse.

⚠️ Two of these landed on 24/08, in two sessions, on the same day — and neither was caught by a
test, because both were green:

| The sentence | Its nouns | The handle in the code |
|---|---|---|
| "compare the registry archive with the Release archive" | two | one — both files are `discovery-media-player-X.tgz`, downloaded into the same directory |
| "count the remaining calls in the code" | two (calls, code) | one — the lines a `grep` returns, where a comment and a call are the same thing |

In both cases the instrument was applied **downstream of the point where the property was still
visible**: a file path carries no notion of provenance, a line carries no notion of being
executable. After that, no amount of care in the comparison can restore it.

**The three-second test:** try to give one of the two inputs a deliberately different value. If you
cannot do it without changing the setup — because they share the handle — that is the proof.

This is not "make sure your check can fail", which says nothing about where to look. It says the
boundary to inspect is the one between your sentence and your wiring.

**And naming both inputs is only the catch-up. The closure is getting both facts from a single
operation** — then there is no window to name, because there is no second moment.

⚠️ A third instance, the same evening, in the file that adds this rule: `statSync(p).isDirectory()`
followed by `readFileSync(p)`. CodeQL caught it; the author did not. The fix was not a more careful
comparison but `readdirSync(dir, { withFileTypes: true })`, where the type arrives **with** the
entry. There is no longer a "we checked, then we acted"; there is only a "we read".

So the order to try things in is: make the assumption impossible to hold wrongly, cheaply, if you
can — and only fall back on naming the two handles when you cannot. The first removes the failure;
the second makes it visible.

⚠️ And note what the three instances have in common about *who* saw them: one was found by the
other party, one by accident, one by a tool. **Zero by the person writing the code**, minutes after
writing this very rule down. That is consistent with the rule rather than an argument against it —
the sign is visible while writing, which is exactly to say it is invisible to the one writing.

## A conclusion never goes red — only a count can drop

**Print what you measured, not what you concluded from it.** A summary line that states a verdict
cannot be wrong out loud: nothing in it moves when the measurement underneath stops covering what
it claims.

⚠️ Measured twice on 25/08, in guards written that same day:

| The line it printed | What was actually true |
|---|---|
| `19 migrations lues, chacune prouvable sur ses effets` | seven of them had no sign at all and were **skipped** by the filter |
| a `docs only` verdict on a release | says nothing about where the boundary of "docs" is drawn, and that boundary is ours |

Both were replaced by counts — `19 lues, 44 signes sondables relevés, aucune muette`, and a table of
zones with added/removed/changed per zone. A probe that stopped seeing one shape makes that number
fall visibly; *"each one provable"* does not move, and neither does a boolean.

This is the two-inputs rule for the case where **there are no two inputs at all**: a sentence that
asserts more than the code measured compares nothing, so nothing can contradict it. The catch is
not a better comparison — it is refusing to print a verdict where a number would do.

⚠️ Both were found by re-reading the guard's own output and asking whether it was *true* — after
the bench was green, after CI was green, after the merge. That is not a place anyone looks by
habit, which is precisely why the rule is to remove the possibility rather than to look harder.

## Record the proof, never the verdict

**A record that states only its conclusion cannot be attacked by anyone.** Write down what was
measured and how, so a second reader has a surface to disagree with. This is the form constraint
that makes review possible at all — not a request to be careful.

⚠️ Measured on 25/08, on a neighbouring repository's migration register. Its line read:

```
0012   comment present on commercial_doc_shares.idem_key
```

That proves nothing — `0011` already comments that column, and `0012` only replaces its text. The
entry happened to be **correct**, and it was correct **by luck**: a right conclusion reached by
reasoning that does not hold is not a verified conclusion, and what survives in a record is the
method. The defect was findable by someone else precisely because the *proof* was written. Had the
line read `8 migrations verified`, there would have been nothing to catch — a verdict is read,
believed, and left alone.

The same holds for every rule in this file: each was found because someone could point at one
precise sentence. *"An assertion that costs its author"* was only catchable because a page said, in
writing, "no guard holds this". Thought and not written, it would have survived — starting with its
own author.

⚠️ **And a fix that repairs nothing must say so.** A commit that closes a door without there having
been an incident — a probe hardened where the measurement showed zero occurrences — reads later as
evidence of a defect that never existed, unless the count is written beside it. `0 occurrences
today; the count is unchanged; this closes a door` is a proof. "Hardened the probe" is a verdict.

⚠️ **Shape the record so a verdict has nowhere to go.** A rule you must remember is held until the
day someone is tired; a form with no cell for "verified" refuses on your behalf. Measured on the two
tables this repository writes — eleven columns between them, and not one where a verdict fits:

```
what was compared | Version | Date | Release .tgz sha256 | Identical to npm | Who looked | Also checked
zones touched     | Zone | What it is | Added | Removed | Changed
```

A row whose "what was compared" cell cannot be filled is a row nobody writes — not out of virtue,
but because there is nowhere to put the void. This is `readdirSync(withFileTypes)` applied to the
medium instead of the code: don't remember to do the thing, make the other option not exist.

⚠️ And it only protects where a table exists. Prose has no columns, which is exactly where a verdict
slips through leaving no trace — so the limit below is real, it is just narrower than it looks: it
bears on prose, not on records.

⚠️ Two readers with different blind spots are the *condition* for any of this to work; a written
proof is what makes them able to act. Over two days, every fix here found the defect in the one
before it, and neither author found their own. Nothing in that is self-sustaining: it held because
both sides kept publishing proofs at a pace, and the day one of them records a verdict out of
fatigue, the other has nothing left to bite on — and will not know it.

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
