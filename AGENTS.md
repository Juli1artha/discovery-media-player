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
rule above but the audience: the OpenSSF forms ask for thresholds, and an outside evaluator cannot
verify a number nobody publishes. Each figure was true before it was claimed, in that order: 83%
measured, then the Silver claim (≥ 80% statements) with an 80% floor; the same evening, 90.31%
statements and 83.01% branches measured — earned by behaviour tests, none written for the number —
then the Gold claims (≥ 90% statements, ≥ 80% branches), and the floors moved to **90/80** to
match. ⚠️ The floors defend the **public claims**, not a quality target: if one ever trips, the
honest moves are a test for a real behaviour, or withdrawing the claim from the badge form — never
a test written to make a number go up. The statement margin is thin (~0.3 points), and that is the
price of the claim: it is paid in behaviour tests. A suite padded to protect a threshold is worth
less than the smaller suite it replaced, because nobody can tell the two apart from the number
alone.

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

## A value crossing a boundary is re-read by a grammar that is not its own

**Take the value out of the text.** Environment, file, argv array — anywhere there is no grammar,
so there is no special character. The question stops being asked, rather than being answered better.

⚠️ Three defects on 25/08, in two repositories, two shells and a module scope, one effect:

| What crossed | The character | What it did | What was left |
|---|---|---|---|
| a message inside `node -e '…'` | `'` in *d'attestation* | **closed** the string | bash parsed JavaScript and hit `(` |
| `"$TAG:server/handler.js"` in zsh | `:` | **transformed** it — a substitution modifier | `d0bfe3d8…r.js`, a path to nothing |
| `crypto.createHash(…)` after a file move | *(none)* | **rebound** the name — Node has had a global `crypto` since 18 | WebCrypto, which has no `createHash`: a `TypeError` at request time |

Note the second closes nothing, and the third has no special character at all. The rule is not about
quote characters, nor even about characters: **any element the surrounding grammar gives its own
meaning to is a trap**, whether it terminates something, transforms it, or silently denotes
something else.

⚠️ **The gesture is not to check the crossing — it is to remove it.** Take the value out of the
text; bind the module instead of trusting a name the scope hands you; write the check outside the
shell. Each closure deletes the boundary rather than verifying the passage, which is why none of
them needs to be remembered afterwards. (Formulated by an integrating host on 25/08, reading our
three incidents back to us: we had written the boundary and the sign, never the gesture in general.)

⚠️ **And the third case is the limit case, worth its own sentence.** There, the "line" is the
**scope of a module**, and the name in it **is supplied by someone else** — Node, which added
`crypto` to the global object in v18. The boundary does not need to be crossed *by us*: it can move
under our feet between two runtime versions, turning code that was correct where it was written
into code that is wrong where it now lives. `no-undef` cannot help — the variable exists. The
closure is the same as everywhere else: bind it, and there is no boundary left to move.

**The sign, while writing: the value and the syntax share a line.** If you cannot show where the
value ends and the syntax resumes without reading the content, no external parser can either. In
the third case that "line" is a scope rather than a row of characters — the test is the same, and
the answer is the same: you cannot say, from the call site alone, which `crypto` this is.

⚠️ **`bash -n` does not catch this**, and neither would any other syntax check: the second command
was valid. Where the value cannot be taken out of the text, use the **tell** instead — an eaten
argument does not raise an error, it produces *emptiness that looks like a measurement*:

```
e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855   sha256 of the empty string
da39a3ee5e6b4b0d3255bfef95601890afd80709                           sha1 of the empty string
```

Seeing one of those means *"my probe read nothing"* — never *"the two sides are identical"*. Same
family: an empty diff, a zero count, an empty list. A positive control — hash something you know
is not empty — costs one line and catches the whole class, shell or not.

⚠️ **And one storey above: an action that looks like a successful action.** The two first cases
leave a silence one misreads; here the tool *asserts*. On 25/08 a published release body was edited
twice through a web form, saved twice, and changed neither time — the only measurable difference
between the two versions was **124 carriage returns** the editor had normalised. Both saves reported
success, and nothing in what they returned distinguished *done* from *not done*.

The parry is the same gesture, one step further: **read what is served, never what the tool says it
wrote.** Diff the two bodies, re-fetch the page, re-read the row — the banner is not evidence.

| The storey | What it looks like |
|---|---|
| a **value** crossing a grammar | what remains is plausible |
| an **absence** returned as a result | emptiness reads as a measurement |
| an **action** reported as done | the tool says *"saved"* |

(The three-storey reading is an integrating host's, on 25/08, merging three notes we had each
written separately without seeing they described one defect.)

Measured here on 25/08 after the rule was written: **7 expressions still interpolated into `run:`
text, 25 values passed through `env:`**. All seven are GitHub-controlled (`github.repository`); the
two that were ours, written that same day, were closed.

⚠️ **This rule was already written in the neighbouring repository, and it prevented neither
defect** — it named the apostrophe case verbatim, and its author did not apply it to their own
colon. Third time in two days that a correct sentence existed, served one place, and nobody carried
it a metre further. Writing the rule is necessary and demonstrably not sufficient.

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

## A guard checks the code — never who the code was for

**Every rule in `tools/` compares a file to a property.** A declared type, a pinned digest, a tool
its job can serve, a heading written once. Eleven of them were added between 23 and 26 August. Not
one of them can say that correct work was addressed to nobody.

⚠️ This happened on 26/08, and it cost a release headline. `dumb-init` was the one unpinned input
of the container image; pinning it by checksum was written, then discarded in favour of removing it,
which was the better call and remains one. The graceful shutdown that made the removal possible was
right too, and benched against real signals. **Both integrating hosts run serverless.** Neither
consumes the image. The headline of 0.1.139 serves, today, nobody we know of.

Nothing was wrong with the work. The question *"who runs this?"* was never asked, and no red could
have asked it: **a defect that was hiding and a question that was not asked are not found by the
same means.** The first yields to a probe. The second only yields to someone asking.

The same day, a briefing sent to those hosts spent two of its six sections on Docker. It branched on
*versions* — which it could read — and never on *topology*, which it could not.

⚠️ **And topology is not derivable, which was measured rather than assumed.** The STUDIO session
tried to remove the need instead of remembering it: `lectureSaturee.fenetreS` is `process.uptime()`,
so a function process should stay young while a container ages — the field would betray the topology
with nobody declaring it. They measured before proposing. Five readings, 25 seconds apart, on their
production:

```
224s   249s   274s   300s   325s
```

**+25 for 25, five times.** The same warm lambda answers every call, and its uptime accumulates
exactly like a container's. At that scale the field discriminates nothing; separating the two would
need hours of sampling, and a statistical signal is unusable in a document read once.

So the remedy is not discipline but necessity: **an integrator must declare their topology, because
it cannot be deduced from any field we expose.**

Two rules come out of this, and the second is the cheaper one:

- Before work whose value depends on who runs it, establish who runs it. No guard will do it, and
  finishing it correctly is not the same as it being needed.
- **Send the dead idea, with its numbers.** Three paragraphs now, against half a day for whoever
  re-derives it in three months without knowing it was already tried. That measurement above is in
  this file for exactly that reason.

## A green tells you nothing until you know what could have made it red

**Two questions, before believing any green.** *Was the threshold written down before the
measurement?* And *could the subject have been present in the setup I looked at?* A green says "I
found nothing". Only those two questions separate that from "there was nothing to find" and from "I
decided, afterwards, that this was enough".

⚠️ Six instances in one week — four ours, two from an integrating host, none of them a wrong
measurement. Every one measured correctly, either in a place where the subject could not appear, or
against a bar chosen once the reading was in:

| The green | Why it could not have been red |
|---|---|
| our voice bench — *"une porte « écouter la présentation » qui mène au silence est une promesse cassée"* | it asserted the buttons are absent **with no API key**; with the key they appear and lead nowhere. The one case it existed for was the one case it never entered |
| our migration chain in CI | migrations always replayed on a **clean** base, where a catch-up loop has nothing to catch up — and an already-installed base is its entire reason to exist |
| the host's Sentry query — *"no `createHash` error"* | 4 errors in 90 days, across the whole organisation. A search returning nothing, on an instrument that records almost nothing |
| the host's key check — *"`ELEVENLABS_API_KEY` absent"* | the key was set. The API had answered `403` |
| my CI-outage call | no `pull_request` run for four minutes → outage. They started one minute later. Nothing was wrong with the setup; *how long is too long* was picked after the silence began |
| my tag push | `403`, retried on the network backoff, four times, before reading the code. A policy denial does not become an allowance on the fourth attempt — the retry rule was written for a different failure and applied for its shape |

The first two are closed — the voice bench now runs the key-present case, and CI replays the
migration chain against a deliberately poisoned installed base — but neither was closed by looking
harder at the green. The first fell to a question from outside: an integrating host went looking for
who calls `bot-tts` in this package, and found nobody. The second fell to a setup built for another
purpose — the `0.1.64 → replay` job created the one thing CI had never had, an already-installed
base.

**The split is the point.** The first four fail the second question: the subject was outside the
frame. The last two fail the first: the frame was fine and the bar moved. Either half alone passes
four of the six.

The remedy for the second question has a house form, and the count is worth writing down rather
than the impression: **three test files carry an explicit anti-vacuity
case** — `gardesAgent`, `voixNonCablee`, `etiquetteBornee`, added 24, 27 and 27 August — where the
probe fails when it finds nothing to read (fewer than five browser artefacts, fewer than ten captures). In
`tools/`, exit code `2` is the same idea given a name: *checked nothing* is not *found nothing*.
Everywhere else it is still a thing to remember, which is to say it is not yet held. And it is only
half: the other half — **run the probe in the configuration where the defect would live** — no
anti-vacuity case can supply, because a probe that reads plenty and still cannot meet the subject
looks exactly like one that read plenty and found it absent.

The remedy for the first is one sentence written before the reading: *what value would make me
conclude the opposite?* If you cannot state it in advance, you are not measuring, you are narrating
what happened to arrive.

⚠️ And in all six the reasoning was sound. That is why "be more careful" is not available as a
remedy here: nothing in the moment feels like an error, because nothing is one — the mistake is
entirely in what the setup was able to show, and the setup is the part nobody re-reads. It is also
why an absence-of-evidence green is the single kind of result whose author has nothing to hold: a
count that drops can be argued with, a "found nothing" cannot. Prefer, here as in the rule above,
saying **where a property is held** over saying that nothing contradicted it.

## Ask who reads an output, and when — no probe answers this one

**A third question, and it is the one no tool can hold.** *Was the threshold written in advance?*
and *could the subject have been there?* both get answered by reading the repository. **Who reads
this output, and at what moment?** is answered only by naming someone, or by finding there is
nobody. It came from an integrating host, who put it this way after two of their own cases and two
of ours.

⚠️ Four cases, two theirs and two ours, and none of them is a wrong measurement:

| The output | Who read it |
|---|---|
| our examples sentinel — issue #412, opened 26/08 13:18, then 4 comments identical to the character | **nobody.** It named the exact command, ten hours before the red it predicted |
| `release.yml`'s demo-lag notice, fired 26/08 11:52 and 27/08 06:43:56 | **nobody** — and the second one landed eleven seconds before CI went red on the same subject |
| the host's `dumb-init` pinning, and our removal that replaced it | nobody who runs this image: both integrating hosts are serverless |
| the host's two SQL probes, headed *"nothing runs this for you"* | nobody, and the header said so — a limit they filed as assumed, therefore as handled |

**Writing that an output has no reader does not give it one.** That is the host's own verdict on
their case, and it is the sharpest form of the rule.

⚠️ **And ours is worse than theirs, because it denies the limit instead of assuming it.**
`release.yml`'s own comment, three lines apart:

> […] and **nobody looks at a demo that works**: it stayed three versions behind with nothing to
> signal it. […] But it is written in the release summary, **where it gets read**.

The first half diagnoses the defect exactly. The second routes the remedy into the summary of a
**successful** run — and asserts, with no measurement and nobody named, that this is read. Three
paragraphs into `publication.yml`, the repository had already written the opposite: *"a warning in
a summary is only seen IF SOMEONE OPENS THE RUN"*. It knew, it had written it down, and it put the
next warning in a summary.

**The corollary is what makes the question usable, and it cut cleanly across all eleven automatic
outputs of this repository, without exception:**

> **An output is read only if it prevents something.**

**Four of the eleven are read**, and only one of those four is a fact this file can hold: the
`pre-push` hook, which blocks the push because a file in this repository says so. The other three —
CI, the CLA check, ZAP — are read because a **ruleset** requires them, and that ruleset is a
repository setting, not a file. A snapshot, read on 27/08 and **not a specification**: eight
required checks (`check (22)`, `check (24)`, `navigateur`, `schema`, `docker`, `cla`, `CodeQL`,
`zap`), a pull request before merging, conversation resolution, branches up to date, no force
pushes, zero required approvals — that last one deliberate, since a lone maintainer cannot approve
their own work and `MAINTAINERS.md` says so. **Go and read it; do not trust this paragraph**
(`Settings → Rules → Rulesets`, *not* `Settings → Branches`, which shows only the classic
mechanism and reads *"Classic branch protections have not been configured"* on this repository —
which has eight).

⚠️ This snapshot was **already incomplete before it merged**: conversation resolution was switched
on while this very correction sat in review. That is the second drift in three hours, and it is not
a reason to write the list more carefully — it is the reason the list is dated, hedged, and followed
by an address.

The remaining **seven have no established reader**: `publication.yml`'s four issue alarms, the three
run summaries (`release.yml` twice, `ci.yml` once), two external dashboards (CodeQL's Security tab,
OSSF Scorecard) and one weekly scheduled repair. Those seven are facts about files, so they hold
until a file changes. So the useful question about a silent alarm is never *"which channel would be
better?"* but *"what does it prevent?"*. If the answer is *nothing*, changing the channel moves the
silence without closing it.

⚠️ **This paragraph was false within the hour, and how it happened is the lesson.** It first said
ZAP *"is seen and stops nothing — not a required check, so a merge can land beside it"*. That was
true when written at 09:11 on 27/08. The maintainer added `zap` to the ruleset before 10:00, and
the sentence became false without anyone touching the repository. Nothing could have gone red: the
claim lives in prose here, the fact lives in a GitHub setting, and **no guard in `tools/` can reach
across that boundary** — a merged document quietly describing a configuration someone else can
change is a second source that rots by design. Hence the shape above: the count and the principle
stay, the enumeration carries the date it was read, and the sentence sends you to the setting
instead of standing in for it.

⚠️ **The answer is almost never "nobody" — it is "someone, at a moment when it no longer helps".**
A release summary has a reader: whoever comes to investigate afterwards. An issue has a reader:
whoever opens the tab, one day. A health page has a reader — the host measured exactly that, a
week late, and it was themselves. That is why the question carries *and at what moment*: what
blocks is read when it counts, **because the blocking imposes the moment**. Everything else is
read when someone has time, which is to say after.

⚠️ **Two other things get read without a reader being scheduled, and they bound the rule:**

| what | why it lands |
|---|---|
| what blocks | the moment is imposed, not chosen |
| what contradicts itself **in its meaning** | it cannot be read without being resolved |

The second has a threshold, and the host found it by hitting it: a grep of theirs returned
twenty-eight supposedly missing context fields including `method`, `query`, `to` and `subject` —
fields of a request and of a message, not of a context. They saw it instantly, because it attacks
what the reader *knows about the domain*. Meanwhile line 243 of `docs/HOST-CONTRACT.md` was a
table row swallowed into an unrelated paragraph **from 18/08 to 27/08** — nine days, from 0.1.64
to 0.1.140, past every reader of that page including its own author — because a stray pipe attacks
only the **typography**, and a reader forgives a typo without thinking. **An inconsistency is seen
without looking only when it bears on the meaning, never on the form.**

## The mirror of that corollary, on the way in

**An inherited capability is found only when something forces you to look for it.** The same host
caught themselves three times in a week proposing to add what their code already had, and named
why: *"I look for the capability in the code I have just written, never in the code I inherited"*.

⚠️ Measured here on 26/08, and the numbers are the argument:

```
context/standalone.js:293      has() { return false; }      a capability probe

calls in server/                0
lines in docs/HOST-CONTRACT.md  0      (until 27/08)
copies in test fixtures        57      across 45 files
```

Wiring `wiresVoice` that day meant inventing a declaration mechanism while an undocumented one sat
in the injected context. `wiresVoice` is probably still the right call — `has()` returns `false` in
the only context we ship, and no key vocabulary is defined anywhere. But it was never weighed and
rejected: **its existence was unknown**, on a field that 45 test files carry.

Which is the point of the count. `has()` was not hidden; it was in front of every author who ever
wrote a test fixture, this one included. **Copying is not looking.** The difference is not
attention — code you just wrote is in your head, inherited code is reached only by a query you must
think to run — and that is exactly what makes this a question to ask rather than a rule to follow.

⚠️ And the same host, reading this, found they *implement* `has()` correctly — because a type
declared it, and nobody ever asked who called it. Neither side knew: we did not know it existed,
they did not know they were supplying it. **A mechanism carrying a requirement alone eventually
produces exactly that: something correct that nobody knows they have.**

## A rule without its case is approved, not transmitted

**Write the incident, not only the maxim.** Every rule above carries the day, the file and the
number that produced it, and that is not decoration.

⚠️ The host stated why, about themselves: *"I distrusted the zero because you taught me to. I did
not distrust an absence in a document, because nothing had made me."* They had the case *a zero can
mean no observation*, and they applied it, carefully, three times. They did not have the case *an
absence in a document can mean I am reading the wrong section* — and asserted that a trap was
undocumented when it was written, in bold, in the cell where it mattered, 140 lines from where they
were looking. **The two are the same thing. Knowing one does not give you the other.**

So: **distrust transmits by case, never by class.** A rule stated alone is agreed with; a rule
carrying its incident is the only kind that arrives.

⚠️ **And the moment you are least likely to apply a rule is while you are applying it to someone
else.** Correcting that host on an unverified absence, in the same message, with the file open, this
repository asserted a consequence it had not measured — *"a host reading the table finds four
values, the code returns five"* — while line 268 explains the fifth at length. Fifth occurrence in
one week of a rule broken by the hand writing it. Not a coincidence: **the rule you have just
formulated is the one you are most certain you already hold**, so it is the only one you do not
re-apply to yourself.

⚠️ **Last, and it is the least intuitive result of that week: the value of a report does not lie in
its being right.** Two of the three defects then found in `docs/HOST-CONTRACT.md` exist only
because that host reported something **false** and it had to be refuted — with the file open.
A report obliges someone to open the file; a correct one does that no better than a wrong one.
So send what you are only half sure of, **saying which half** — the worst case is being corrected,
and that correction happens with someone looking.

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
