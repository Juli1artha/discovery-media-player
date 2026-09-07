# Working on this repository with an AI agent

This file is for coding agents (and the humans driving them). It states the conventions that
are not obvious from the file tree. Most mechanical rules are enforced automatically — by a
test, a CI step, or a hook — and are listed first; the conventions that only review enforces
are listed separately, as such. Neither list is optional: the difference is only *who* catches
the violation.

## Commands

```bash
npm ci
npm test              # in-process, no network, no database — seconds. It prints its own count
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
- **A correction that removes a form names, in its note, the occurrences that *remain* — and their
  nature.** Not the ones it removed: those are gone, and nobody can confront a number against an
  absence. ⚠️ The measured cost of the old habit, on 27/08: the 0.1.142 note said the pattern was
  *"écrit dix fois à l'identique dans trois fichiers"*, an integrating host's probe found **four**
  remaining, and the two numbers can never meet — one counts what left, the other what stays. A
  remaining count is the only one a host can re-derive on the published tarball, which turns a
  silent absence into a **mismatch between two sources** — the one signal that costs no vigilance.
  Name the traps with it: an occurrence in a file carrying a control byte is invisible to a plain
  `grep`, and saying so is the whole difference between finding four of five and *knowing* you
  found four of five. ⚠️ This is in the list people enforce, not the guards': no check can know
  that a release note *should* have carried a count. So a missing count is not a wrong count — its
  absence must never be read as "nothing to report", here or by a host.
- **A draft written before a discovery is not a neutral draft — it is false, and it is waiting to be
  sent.** Re-read every unsent message against what has been learned since it was written, and say
  explicitly when one crosses another. ⚠️ The measured cost, on 28/08: six messages to hosts were
  drafted, the defect in the diagnostic query they carried was found between drafting and sending,
  and **three went out asserting the disproved query anyway** — one of them to the very host who had
  disproved it, re-posing their own invalidated question. That host named what it costs on the
  receiving end:

  > Un message qui croise n'est pas neutre — il se lit comme une réponse. Si vous ne l'aviez pas
  > signalé, la lecture naturelle aurait été que vous mainteniez votre position après avoir lu la
  > mienne.

  ⚠️ **And a majority of stale messages beats a correct one.** The second host received the
  correction *and* two older messages contradicting it — both claiming the repository had adopted the
  narrow query, which had been true when they were written. Two against one, with the repository
  apparently on the wrong side: the correction could reasonably have read as the mistake. An erratum
  therefore names the superseded messages, and retracts by name the sentences that pointed at the
  repository. ⚠️ This is in the list people enforce for a reason no guard can cover: nothing in a
  repository can know what is sitting unsent in someone's drafts.
- **A probe that asks *"did it fail?"* of a question that is *"what does it return?"* reports on
  itself, not on its subject.** ⚠️ The measured cost, on 29/08: two checks written to prove a SQL
  query was safe on installations lacking the `anon` role tested only the exit code. Both passed —
  on a query returning two wrong rows. The same day, on a genuinely role-free cluster, the real
  behaviour turned out to be worse than either reading: `has_table_privilege('anon', …)` does not
  return false, it **raises**, so the query was not *"less precise"* off Supabase, it was
  **unrunnable**, and three successive writings had all missed it. A host who had made the same
  mistake three times that week gave the sharpest version of the cost — *"j'ai annoncé « 0 échec »
  alors que zéro test avait tourné"*. Assert on the **output**; an exit code is at best a second
  signal, never the only one.
  ⚠️ **And this is one case of a wider displacement, which the same host generalised past what we
  had written:** *"chaque fois qu'un instrument échoue, ce qu'il rend décrit l'instrument"*. This
  repository has catalogued three others without seeing they were the same move — the sha256 of an
  empty file, a 403 read as an absence, a `grep` over a file it cannot read. In each, the probe
  failed and its output was taken as a statement about the subject. **When a probe can fail, its
  result answers "what happened to me", not "what is true of the thing" — so it must say which of
  the two it is returning**, which is why this repository's guards separate INCONCLUSIVE from
  VIOLATION rather than collapsing both into a non-zero exit.
- **Enumerating the values of one variable is not a coverage argument — the next defect arrives on
  an axis the enumeration does not vary.** ⚠️ Measured across the same episode: a bench was built
  over the four values `pg_policies.roles` can take, and the two defects that actually bit came from
  elsewhere — the *gesture's* role list against the *policy's* (nothing to do with which value a
  policy carries), then the **cluster's role inventory**, which is not a property of any policy at
  all. The host who found the second named the rule:

  > Un cinquième profil, s'il existe, ne sera pas une cinquième valeur de `roles` — ce sera une
  > autre dimension. Le vôtre en a déjà trouvé une : le cluster sans les rôles.

  ⚠️ **The failure mode is that an exhaustive axis *reads* as coverage**, and the more complete the
  enumeration, the more it does. So a bench states which dimensions it varies **and which it holds
  fixed** — the fixed ones are where the next report comes from. Naming them is not a disclaimer:
  it is the only thing that keeps a reader from mistaking a full row for a full table.
  ⚠️ **And *"we looked and concluded not"* is not *"this bench does not exercise it"*.** Both land in
  the same "not measured" paragraph, and only the second survives the person reading it in six
  months: a reader can reopen "not exercised", and will not reopen "we concluded not", because
  nothing tells them it is reopenable — the conclusion travels on, detached from the day and the
  judgement that produced it. List a dimension as **held fixed** even when you have reasoned it
  away; the reasoning goes next to it, never in place of it.

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

## A count from one instrument and a verdict from another: the number inherits the blind spot, not the visibility

**When one tool decides *how many* and a second decides *what*, the figure carries the reach of the
first and the authority of the second.** The second cannot recover what the first never handed it,
and nothing in the output says so. The host who named this had already done the hard half — their
probe filtered comments, with a positive control proving the pattern could tell prose from a call —
and was caught anyway, because the *count* came from `grep` and only the *classification* was theirs:

> le décompte et la classification passaient par deux outils différents, et seul le second savait ce
> qu'il regardait. Une sonde qui compte avec `grep` et classe avec du code hérite des angles morts du
> premier sans hériter de sa visibilité.

Our own instance, same day: `grep` over `server/` returned four sites where five existed. The fifth
sits in a bench that deliberately contains a NUL byte, so GNU grep called the file binary and printed
no line at all. Note what makes this worse than a plain miss: **`grep` does have the right to skip a
file — it does not have the right to skip it without the output saying so.** The exclusion is
announced on the same stream as the results, is lost in a pipe, and leaves nothing in the count. The
guard is `tools/greps-sans-angle-mort.mjs`; the mechanical part of the remedy is `-a`, and the
general part is this: **when a probe spans two tools, the weaker one sets what the number can mean.**
Either measure and classify with the same instrument, or state the floor of the weaker one beside
the figure.

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

⚠️ **One more, after those six — and the host who caught it named the class better than this file
did.**
Applying migration 0021 on 27/08, they verified the table's RLS by reading it as `anon` and getting
0 rows — the expected result. Then they stopped: *"il était compatible avec deux explications, « la
RLS refuse » et « la table est vide », qui rendent exactement le même nombre sur une table neuve."*
They redid it with a row in place: `service_role` sees 1, `anon` sees 0. **The zero becomes a
measurement instead of a coincidence.** Their formulation, which is question 2 sharpened to a point:

> **un détecteur d'absence est maximalement confondable avec sa propre panne** — et une table vide
> est le meilleur imitateur d'une RLS qui marche

The practical form is the **positive control**: before believing a zero, make the thing appear once
and check the probe sees it. Our own version of the same failure was worse than theirs and is now
fixed — `enable row level security` was written ten times across `supabase/`, and **no bench and no
step ever asked the database whether it had taken any notice**. A security posture asserted in a
comment and never confronted is an assertion, not a property. The `schema` job now collects what
the sources *declare* and confronts it with what the engine *retained*, policies included — with
the positive control inside it, because "no policy" is itself an absence.

⚠️ **And a positive control can be placed one link too early in the chain, which looks exactly
like having one.** Five guards here already carried an anti-vacuity floor and still went fully
green while blind, measured on 31/08 by blinding each probe in turn: `greps-sans-angle-mort`,
`shell-des-workflows`, `image-documentee`, `liens-des-documents`, `langue-publiee`. Every one of
their floors counted **what had been opened** — blocks read, documents read, files in the tarball —
where the rule turns on **what the probe still recognises**: greps, references, links, prose. The
sieve that sorts them is one sentence, and it sorted all twenty-five sweep-and-assert-absence
guards in a single pass: *does the floor count the files read, or the form recognised?*

⚠️ **The sentence that protected them was not a comment — it was the green line itself.**
`shell : 112 bloc(s) « run: » analysés par bash, aucun refusé` is printed on every green run, and
with `bash -n` never invoked it is literally false. A sentence that *justifies* is under-read; a
sentence that *asserts a measured fact* is read even less, because it carries the authority of a
measurement without carrying its weight — and this one is the last line anybody sees before
concluding the day is fine. Whenever a guard prints a count, make it the count of the form it
recognised. If the two numbers can differ, print the one that can fall.

**Where a positive control cannot be derived, it must be injected — and the test is not taste.**
The correct form has to be something the repository is *supposed to contain*: greps over source,
image references, relative links, English prose. Four of the five had one. The fifth did not —
`shell-des-workflows`' healthy state is zero refused blocks, so a derived control would demand of
the repository the very thing the rule forbids and would refuse a healthy repository. There, the
case is fabricated: hand `bash -n` a script known to be broken and require the refusal.

**A witness must go through the judge's own traversal.** A control that re-walks the text with its
own copy of the pattern tests an intact copy while the original drifts — green, and about nothing.
`appelsDesBlocs`, `referencesLues` and `liensLus` exist for that reason alone: the probe is named
once, and blinding it moves the count and the verdict together.

**And a population floor belongs where the population is the subject.** Putting "at least eight
greps" inside a `verifier()` that takes an arbitrary root made it accuse every fixture smaller than
this repository — caught in one run by the guard's own bench. The rule lives in the guard; the fact
about *this* repository lives in the bench, as it already does for `licence-par-fichier`.

⚠️ **The other twenty were then blinded too, and one of them was worse.** Classifying a guard by
reading its green message is not a measurement — a green message of correct appearance proves no
more than a positive control of correct appearance. So each of the remaining twenty
sweep-and-assert-absence guards had its principal probe blinded and its exit code read: **nineteen
refused or accused** (sixteen exit 2, three exit 1 — blindness that produces accusations rather
than silence is still inside the path to red). One went fully green: `surface-publique`, under
**three separate blindings**, printing the identical line each time.

**Its floor counted a constant.** `3 stable, 4 experimental, 2 document, 1 manifeste` was computed
from `SURFACE`, an object literal written in the guard's own source. A floor placed one link too
early still counts something real and can therefore fall; a floor read off a literal *cannot fall
at all*, whatever breaks. It has the appearance of a measurement and the nature of a signature. If
a printed count cannot go down, it is not evidence — check whether it derives from work done or
from the file it is printed in.

**And the same guard re-implemented its own subject list.** The verdict loop re-derived "status
stable or experimental" inline instead of calling `publics()`, so blinding `publics()` left the
loop intact and the two could drift apart unnoticed — the copy defect again, in the guard rather
than in a witness. The loop now walks `publics()`, and the bench asserts the two lists are equal.

**A bare `catch {}` around the check is a third way to verify nothing.** Tolerating one module that
fails to load outside its context is right; tolerating *all* of them is a probe that no longer
runs. Count what loaded, name what did not, and let a floor decide.

⚠️ **What this sweep does not prove.** One principal probe per guard was blinded, chosen by
reading the code — not every probe of every guard enumerated. It shows the method finds holes; it
does not show there are none left.

### The exhaustive sweep, and what one guard turned out to be hiding

That limit was then removed for the regex-shaped probes: on 01/09 **every regular-expression
literal of every tool with an entry point was blinded, one at a time**, replaced by `/(?!)/` — a
pattern that never matches anything — and the exit code read. 153 mutations over 32 tools, with a
witness before each tool (green before mutation, or its verdicts are worthless — the lesson of the
broken harness, applied from the start this time).

⚠️ **One guard dominated the result: `secrets-en-clair`, 19 of its 20 patterns could go blind
while it stayed green.** It recognises eight distinct secret shapes — PEM private key, AWS key id,
GitHub, npm and Slack tokens, Google API key, Stripe live key, and a Supabase `service_role` JWT —
plus a rule of its own on `.env` names. Its witness planted a single `AKIA` sample. **It proved
one shape out of nine was still seen**, on the guard whose green asserts that no credential is
pushed. Any of the other eight could have stopped matching in silence.

The fix is dictated by the guard's own table: one sample per shape, assembled at runtime (the
guard sweeps its own source, so a literal fake credential in it would be self-flagged), plus a
check that **every** searched shape has a sample — adding a pattern without one would shrink the
coverage on the very day the shape is declared. All eight detection patterns now refuse when
blinded.

⚠️ **Three corrections the measurement forced along the way, each the shape of a defect this page
already names.**

- A single wrapper (`cle = "…"`) around every sample looked economical and left the `.env` rule
  untested: that rule needs an UPPERCASE name at the start of a line. **One envelope for rules
  that do not read the same thing is a witness that only exercises what resembles it.**
- The coupling check (*every shape has a sample*) has the empty list as its healthy state, and
  asserting it only on the healthy repository does not distinguish *nothing is missing* from *the
  function no longer looks*. Silencing it passed the bench — a floor asserted only where it has
  nothing to say. It is now exercised on injected tables where a shape is deliberately orphaned.
- A payload was chosen to make the base64url→base64 normalisation observable, and it did not:
  measured, `Buffer.from(x, "base64")` accepts the base64url alphabet natively under Node, so
  those two replacements **cannot** be made observable by any sample. Written as *what this
  witness does not cover*, rather than left as a comment claiming a coverage it does not have.

⚠️ **What the sweep still does not prove, and the reason is in the tool that ran it.** The
extractor takes any `/…/` for a regex literal, and slashes inside string constants (`".github/"`,
`"…startsWith("../"`) are picked up too. Of the 58 survivors outside `secrets-en-clair`, an
unknown share are that artifact, and **none has been triaged**. The eight remaining survivors *in*
`secrets-en-clair` were triaged and are all benign: two are dead code, five are exclusions and
cleaners whose blinding makes the guard more accusatory rather than less (fail-closed), and one
degrades a reported line number. Probes that are not regex-shaped — an external analyser, an AST
visit, a string predicate — are outside this sweep entirely.

### The instrument that measured the sweep was itself an unmeasured probe

The sentence above — *of the 58 survivors outside `secrets-en-clair`, an unknown share are that
artifact, and none has been triaged* — names two debts in one breath, and the second cannot be paid
before the first. A population you know to be inflated is a population nobody triages: every
survivor is answerable with *probably a false literal*, and the count is large enough to make the
work look unreasonable. **An imprecise measurement does not merely mislead; it supplies the excuse
for not acting on itself.**

The extractor was rebuilt on the TypeScript AST — `ts.SyntaxKind.RegularExpressionLiteral`, exact
character offsets — instead of a pattern hunting `/…/`. **143 real literals, against 171 by
pattern: 28 of them were slashes inside string constants** (`"/.github/"`, `startsWith("../")`).
Re-swept at the exact offsets: **131 mutations over 31 tools, 55 leaving the guard green.**

⚠️ **Three tools were measured on nothing, and that is a hole, not a pass.** `release-preflight`,
`verdict-zap` and `zones-du-tarball` are red or usage-refusing before any mutation — they need a
release context or command-line arguments this session cannot supply. The harness records their
witness as failed and skips them, which is the correct behaviour and leaves their patterns
entirely unproven. **A tool absent from a survivor list is not a tool that survived nothing.**

Triage of the survivors then found **four probes blind on a live subject**, each fixed, each mutant
now killed by the bench that names it:

| guard | pattern that could go blind | what nobody was reading |
| --- | --- | --- |
| `images-des-workflows` | `$IMAGE_…` usages | an image used without being declared |
| `outils-servis` | the `import` reader | which tools depend on an installed package |
| `portes-de-reponse` | `/^text\//i` | a `text/…` body served without `nosniff` |
| `migrations-detectables` | three of eight sign detectors | a migration's proof of having run |

⚠️ **The last one is the sieve applied to a number: a floor counts the FORM RECOGNISED, not the
things counted.** That guard prints `63 signes sondables relevés` and its own comment made the
number the protection — *a probe that stopped seeing a form would make this number drop before your
eyes*. Before whose eyes? Measured by blinding its eight detectors one at a time: five turn the
guard red — a migration becomes mute or indistinguishable, and it is **named**. Three left it
green, moving only the printed number: `drop function` 63 → 60, `nullability` 63 → 62, **`add
column` 63 → 52**. Eleven signs out of sixty-three could vanish in silence.

No numeric floor answers that. High, it refuses a healthy corpus; low, it sees neither 60 nor 52 —
and a threshold glued to the day's reading has the appearance of a measurement and the nature of a
signature. What holds is the **genre**: each of the ten kinds of sign attested by a real migration
must still be seen. A blinded detector loses its genre *entire*, whatever the others keep
producing. And the list is stable by construction rather than by luck — this repository's
migrations are immutable, which is written at the top of that file and is why `0010` is declared
rather than corrected; what the probe sees in them today it must see forever. **The only event that
can remove a genre from that list is the probe going blind.**

⚠️ **And the honest state of the remaining survivors, because a triage half-done reads exactly like
a triage done.** Two were verified benign (`permissions-workflows:50`, cosmetic; `actions-epinglees:44`,
no `docker://` subject in the tree). Four remain on `migrations-detectables`, all *cleaners* rather
than detectors, and one of them is measured and left open: blinding the `--` comment stripper
**invents** two signs out of commented-out SQL and **loses four real function signatures on 0022**,
net 63 → 61, no genre lost, guard green. The rest — some fifty — were **not individually
verified**. They are named here as unverified rather than counted as passed, and probes that are
not regex-shaped (an external analyser, an AST visit, a string predicate) remain outside this sweep
entirely.

### Fifty survivors, triaged one by one — and what "untriaged" was hiding

The paragraph above ended on *some fifty were not individually verified*. Written honestly, it was
still an unpaid debt, and paying it is what this section records: **49 survivors on `main`, every
one of them opened.** The result splits three ways, and the split is the finding.

⚠️ **Six were live blind spots, in six different guards, and four of them printed a sentence that
was false while doing it.**

| guard | the green line it printed with the probe blinded | what was not happening |
| --- | --- | --- |
| `shell-des-workflows` | *112 blocks analysed by bash, none refused* | zero blocks analysed |
| `shell-des-workflows` | *0 blocks analysed by bash, none refused* | a guard announcing it verified nothing, exit 0 |
| `changelog` | *144 sections, no repeated title or subtitle* | neither duplicate rule ran |
| `liens-des-documents` | *2 relative links recognised in 0 published documents* | two links in zero documents |
| `documents-publies` | *documents in the tarball: 2, all promised* | `.md` files stopped being documents |
| `images-epinglees` | (green) and then the `docker` job: *tag and digest name the same major* | nothing compared |
| `requete-diagnostic` | *diagnostic query extracted: 24 line(s)* | every line still commented out |

⚠️ **Three of the six are one defect wearing three faces: the same question asked twice, once by
the judge and once by the accountant.** `shell-des-workflows` asked *is this shell analysable?* on
two lines, two lines apart — blind the judge's copy and the count stays at 112 while nothing is
checked; blind the accountant's and the count falls to 0 while the exit stays green.
`liens-des-documents` asked *which files are documents?* once to choose what to open and once to
say in how many it searched. `changelog` wrote its `## […]` boundary once for the duplicate-title
rule and once for the duplicate-subtitle rule. **Two copies of a rule never fall together — that is
the whole reason a repository forbids the second copy — and here the survivor was always the copy
that feeds the number a reader trusts.**

⚠️ **`requete-diagnostic` is the one to remember, because two anti-vacuity floors stood over it and
neither looked.** The guard extracts a SQL query written inside SQL comments and hands it to `psql`
in CI — it is how this repository checks that no role reads a table it should not. Blind the one
line that strips the `--` prefix and every floor still passes: `\bselect\b` matches inside a
comment, and the last line still ends in `;`. The tool then prints on stdout a query whose every
line begins with `--`, the database executes nothing, returns nothing, and the access-control job
goes green. **A floor written over the text of a thing measures the text, not the thing.** The fix
compares before and after — every non-empty line of the block must have *changed* — because a
second recogniser would be a second copy, which is the defect one paragraph up.

⚠️ **Twenty-three survivors are killed by their own bench, and that is the right answer, not a
consolation.** A probe whose property is a module property — `sectionDe`'s boundary, `plusHaut`'s
semver, the issue body's `npm --prefix` — has no business making a guard's exit code move: the
guard judges the repository, the bench judges the module. Counting these as failures would push
toward guards that refuse on things they have no verdict about.

⚠️ **Fifteen were seen by nobody — guard green, bench green — and each is named with its
direction.** Three were then covered (the glob→regex escaping in `codeowners-valide` and
`attributs-des-generes`: blind it and a pattern silently matches *more* than it says, so
`nonCouverts` demands *less* — the wrong direction, even with no live subject today). The
remaining twelve are recorded as measured, not as passed: `secrets-en-clair` ×3 and
`migrations-detectables` ×2 are cleaners whose blinding leaves the reading identical (63 signs
either way); `langue-publiee`, `liaison-de-crypto` and two in `shell-des-workflows` fail *closed*
— blinding them makes the probe accuse more, never less; `permissions-workflows` and `env-lues`
move a line number and an excerpt in a message; `shell-des-workflows`' `sh` branch and
`codeowners-valide`'s glob branch have no subject in this tree at all.

⚠️ **And the harness lied once, in the direction that flatters it.** It located each tool's bench
by naming convention — `tools/foo-bar.mjs` → `tools/__tests__/fooBar.test.js` — and reported
`plus-haut-tag` as covered by nothing. Its bench is real and kills the mutant; it lives under
`server/__tests__/`. One tool in sixteen, found only because the result was surprising enough to
check. **A measuring instrument that assumes a convention reports the convention's exceptions as
findings**, and a survivor list is exactly where such a false finding is least likely to be
questioned — it agrees with what the list is for.

### The three tools "measured on nothing" were measured on the wrong thing

Twice now this page has recorded three tools as a hole: `release-preflight`, `verdict-zap` and
`zones-du-tarball` are red or usage-refusing before any mutation, so the sweep skipped them and
their patterns stayed unproven. Written as a hole it was honest, and it was still wrong about
*what* the hole was. **All three have a bench.** The sweep's exclusion came from its own rule — run
the tool bare, read the exit code — and that rule has no meaning for a tool that takes arguments, a
tool that judges a scan someone else ran, or a tool that compares two tarballs. Re-swept against
their benches instead: **11 literals, 8 already killed, 3 survivors.**

⚠️ **One of the three was a witness that had quietly stopped witnessing.** `verdict-zap`'s
`analyser` takes the list of report files actually on disk and flags any whose surface nobody
announced — its own comment calls this *the one witness independent of the caller*, the only input
that does not come from the process being judged. The bench exercised that rule by **injecting** the
list; the function that **reads** it was tested nowhere. Blind its pattern and the list is empty in
every circumstance, no orphan is ever seen again, and nothing moves — not the guard, not the bench.
**A witness whose own eyes are untested is a witness that reports what you handed it.**

The other two are smaller and were made testable rather than changed. `release-preflight` parsed
`git ls-remote --tags` inside its main function — a function that needs a repository, a network and
a version to ship, which is exactly why the sweep could not reach it. Lifted out, it has a bench:
an annotated tag comes out of `ls-remote` **twice**, once as the tag object and once as
`v0.1.1^{}`, the commit it dereferences, and half this repository's lines carry that suffix.
`zones-du-tarball`'s quote-stripping had no subject at all — no migration here quotes an
identifier — and writing its bench turned up something the code did not say: the pattern requires
the name to *start* with a letter, so `create table "presence"` is not seen at all, and the strip
only ever serves qualified names like `public."presence"`. That is the trade-off the function
declares in its own header (*missing an object costs a round-trip, inventing one would be worse*),
so it stays — **stated in a test instead of rediscovered by whoever assumed otherwise.**

⚠️ **The lesson is about the instrument again, and it is the same one twice in a row.** The sweep
found the bench by naming convention and reported the convention's exception as a finding; then it
defined coverage as *the tool exits non-zero* and reported the definition's exceptions as holes.
Both times the instrument's assumption became a fact about the code, and both times it read as the
kind of fact the exercise was looking for. **When a measurement excludes something, ask whether the
thing is unmeasurable or merely outside what you decided to measure.**

### The probes that are not regex-shaped, and why they held up worse

Three sections of this page have ended on the same admission: *probes that are not regex-shaped —
an external analyser, an AST visit, a string predicate — are outside this sweep entirely.* Written
as a limit it was honest, and it named a tool's assumption as a property of the code. **The operator
was missing, not the method.** Three forms, lifted by the AST and blinded one at a time: a literal
passed to `.includes` / `.startsWith` / `.endsWith` / `.indexOf`, replaced by a string no source
contains; a literal compared with `===`, the same; a type guard `ts.isXxx(...)`, replaced by
`false`.

⚠️ **152 non-regex probes, and they hold up worse than the regexes: 90 left their guard green,
against 55 of 143 for the regular expressions.** The area a repository declares uncovered is the
area where its defects accumulate — not because they are harder to see, but because nothing has
been looking.

Only **five** had a live subject, and the discriminator was cheap: does blinding change the
*sentence the guard prints*? If the summary is identical, nothing in this tree exercises that
probe. That question separated five from twenty-nine in one pass, and it is the first thing to ask
of any survivor list.

⚠️ **The worst of the five came from floors this page told me to set.** `surface-publique` writes
half its subpaths as bare strings and half as condition objects. Blind the `typeof chemin ===
"string"`:

    sain   7 sous-chemin(s) public(s), 7 module(s) chargé(s), 75 symbole(s) relevé(s)
    muté   7 sous-chemin(s) public(s), 3 module(s) chargé(s), 18 symbole(s) relevé(s)   VERT

Four public modules out of seven and fifty-seven symbols out of seventy-five stopped being read for
*no internal leaks*, and the guard exited 0. **The two floors placed there for exactly this case —
three modules, ten symbols — passed three and eighteen.** They had been set to refuse the *empty*,
and a half-blind probe is not empty. The answer is not to raise the floor to seven, which is the
day's reading and which the manifest is allowed to lower; it is to require that a **declared**
subpath have a **readable** target. The `continue` that skipped the others was mute: not loaded, not
counted, not named.

⚠️ **And a floor can hold in the empty case and nowhere else.** `surface-base` compared its
measurement to its floor through a branch on the key *name* — `cle === "tables" ? mesure.tables.length
: mesure[cle]`. Blinded, the floor refused **exactly zero** tables; one, two and three passed. The
reason is a coercion: `[] < 4` is `true` (empty array → 0) while `["a"] < 4` compares `"a"` to 4,
so `NaN < 4`, so false. **The failure a floor exists to catch is a probe that still finds
something** — one table out of four — not a probe that finds nothing. It held only where it did not
matter.

⚠️ **Three lessons about writing the tests, each found by measurement rather than by reading.**

- A perimeter written as *the list of what to look at* had already been named a defect on this page,
  and `image-documentee` still carried one: blind its `docker-compose.yml` half and a document
  leaves the perimeter — 5 references in 32 documents become 4 in 31, green. Inverted to a list of
  what is *excused*, with a reason each.
- My first witness for that inversion asked `texte.includes(REGISTRE)` — **a second recogniser of
  what `referencesLues` already recognises**, which is the defect being removed, reintroduced while
  removing it. CodeQL flagged it from another angle (a substring does not decide a host:
  `ghcr.io.exemple.com` satisfies it). Both roads lead to the same fix. And making it use the real
  probe showed that **six of the ten exemptions I had just written covered nothing** — the workflows
  name the registry in `${{ }}` expressions and API URLs the probe already skips.
- My first two cases for the alias-binding guards named their variable `env` — and the alias set is
  **seeded with `env`** by repository convention, so the case never reached the binding code it
  claimed to exercise. Measured: the mutants survived the tests written for them. **A witness that
  resembles its subject does not test it.**

⚠️ **Twenty are still seen by nobody, and they are named rather than counted as passed.** Eight are
perimeter exclusions (`__tests__`, `.generated.js`, `node_modules`) whose blinding *widens* the
scan — the safe direction; four are the relative-reference forms of `actions-versions`, which no
workflow here uses; three are `typeof x === "string"` checks on values this tree always supplies as
strings; the rest are internal state strings and message text. Two things remain wholly outside even
this sweep: an **external analyser** (`bash -n`, `npm pack`, `git`), whose failure mode is the
swallowed error rather than a blinded literal, and the **numeric and structural** decisions — an
index, a comparison operator, a boundary — that neither operator touches.

### The last twelve, and the two that no test can kill

The regex sweep left **twelve probes that neither their own guard nor any bench in this tree could
see** — the residue of 143 sites, named on this page rather than counted as passed. Closing them out
was supposed to be bookkeeping. Ten died to a case that names them. The other two cannot die, and
three of the ten took two attempts.

⚠️ **Two probes are unobservable, and the honest move is to measure that rather than assert it.**
`secrets-en-clair` normalises base64url before decoding — `.replace(/-/g, "+").replace(/_/g, "/")`.
Blind either half and nothing changes anywhere, because `Buffer.from(s, "base64")` **already accepts
`-` and `_`**: Node's decoder is base64url-tolerant, and the normalisation has been dead since it
was written. Deleting it would be defensible; keeping it is also defensible, since the day the
decoder is swapped for a strict one it becomes load-bearing again. What is not defensible is a
comment claiming redundancy that no one has checked since. The bench now **computes both decodings
and asserts they are equal** — if a future runtime ever separates them, the claim fails where it is
made instead of rotting into folklore.

⚠️ **Three first drafts passed for a reason other than the one they named, each time because a
SECOND mechanism already covered the fixture.** Blinding is what said so; reading did not.

- `liaison-de-crypto` strips the three string forms before hunting `crypto.` calls, and the
  apostrophe form was unexercised. My fixture glued the call to the quote — `'crypto.createHash(…)'`
  — and `appelsDuModule` **already refuses a `crypto` preceded by a quote character**. Green on both
  sides of the blinding: the assertion measured the call-shape probe, not the stripper.
- `langue-publiee` strips fenced code blocks, then inline backticks. A closed fence carries **six
  backticks — an even number** — so the inline pass alone pairs them off and erases the whole block.
  Every obvious fixture proves the second probe. The two part ways only on an **odd** count inside
  the fence, where the pairing shifts by one and hands fragments of the block back to the prose.
- `migrations-detectables` fingerprints a comment's text through `.replace(/\s+/g, " ").trim()`.
  A fixture folded only at the head exercises `trim`, not the normalisation; the fold has to be
  **internal**, which is how this repository actually writes long comments — concatenated literals
  across three lines, as `0025` does.

The shape is one rule: **a witness must differ from its subject on the axis under test, and on that
axis alone.** A fixture that also differs elsewhere will be caught by whatever handles *elsewhere*,
and the assertion passes without ever reaching what it names. This page already said a witness that
resembles its subject does not test it; this is its neighbour — a witness that differs from its
subject in *more than one way* does not test it either.

⚠️ **And near-redundancy is worth measuring on the real corpus, not asserting from the code.** On
the repository's 31 markdown files, blinding the fence stripper changes `compte()` on **zero** of
them: today's documents contain no fenced block with an odd backtick count, so the probe earns
nothing on the current corpus and everything on the day one does. The bench says both — the case
that discriminates, and a case pinned precisely because it does *not*, so the next reader does not
mistake it for coverage. **A probe that guards a shape the corpus does not yet have is not dead
code; it is a claim whose subject has not arrived.** The two are told apart by measuring, and the
measurement belongs in the bench.

## A version number written by hand is a claim about the registry

Four host-facing documents carried **eighteen statements, in the past tense, about two versions that
had never been published** — the two numbers immediately after the published one — saying what each
had *"stopped serving"* and *"stopped writing"*. The registry served `0.1.145`, which still serves and
still writes both columns and ships migrations only up to `0024`. A host read `docs/RETENTION.md`, believed the change was live, and was then asked by
its compliance function to apply migrations that were in no package. **The host found this by
unpacking the version the registry actually serves. We did not find it at all.**

⚠️ **The failure is a form, not an oversight.** A version number inside a sentence is an assertion
about an external fact — the state of the registry — placed in a file that is connected to that fact
by nothing. It is true when written, and an event outside the repository (or rather its *absence*:
the release that never came) makes it false without the file changing. This page already names the
remedy for the same shape elsewhere — `exemples-epingles` derives the number instead of writing it —
and the remedy is the same here: **derive it, or do not name it.** A guard now refuses any document
naming a version greater than `package.json`'s, which `docs/RELEASING.md` already holds equal to the
tag and to the changelog's top section; the release window closes itself, since the bump lands in the
same commit as the section describing it, with no exception to write and none to lift later.

⚠️ **Writing docs for the version you are about to cut reads, to everyone else, as the present.** A
document has no tense in the reader's hands: "stopped serving" is read as *has stopped*. Everything
unreleased belongs to one future release whose number nobody knows yet, so it is named *"the next
release"* or by something that exists — a migration number, an `[Unreleased]` section. Naming two
different future numbers, as happened here, also produced an internal contradiction nobody caught:
the same version was described as having stopped serving and as still writing.

⚠️ **And the cost lands on whoever believed you.** The statement reached a compliance function as a
plain fact, and an instruction to a host followed from it. When a claim about released state turns
out to be about unreleased state, the correction is owed to everyone who acted on it, not only to the
file. Fixing the document is the smaller half.

⚠️ **A status line that reports an external state must carry its derivation or its date.** The same
day, this session told its user four times that no release could be cut because *"0.1.145 shipped
this morning"* and the repository ships one train per day. It had shipped **the previous day at
12:04**. The rule was real, the fact was stale, and the conclusion drawn from it — *no release
today* — was the one thing blocking every host from getting the fix. **A wrong fact about the past
is survivable; a wrong fact that closes off the action is not.** When a sentence's job is to justify
not doing something, check the fact under it first.

## Erasing a column is not dropping it, and the intuition points the wrong way

An arbitration asked for a stored IP address to be purged, with a stated preference: **drop the
column rather than empty it**. The preference is the natural one — a column that is gone cannot leak
— and it is wrong, in a way that only a measurement shows. On PostgreSQL 16.13, with `pageinspect`,
on rows carrying an address:

    after ALTER TABLE … DROP of the column        every address still in the heap
    after routine VACUUM                          every address still there
    after VACUUM FULL                             none — but it rewrites the table, under a lock

    after UPDATE … SET ip = NULL                  old row versions, now dead
    after routine VACUUM                          none

⚠️ **`DROP` of a column marks the attribute dropped; it does not rewrite a single row.** The bytes
stay in the heap until something rewrites the table — a `VACUUM FULL` or a `pg_repack`, neither of
which a host runs spontaneously on a journal. Routine vacuum does not help: the rows are *live*, so
there is nothing to reclaim. So the "clean" gesture leaves every address on disk **indefinitely**,
invisible to every query — which is the worse of the two states, because the schema now swears the
data is not there and nobody will ever look again. The `UPDATE` is what erases: it writes new row
versions without the value and makes the old ones dead, and ordinary autovacuum collects them on its
own, with no lock and no operator action.

**The general shape: a deletion that is only a change of visibility is not a deletion.** Ask what
physically rewrites the bytes, and whether anything in normal operation will ever do it. If the
answer is "an operation an operator must choose to run", the erasure has not happened — it has been
scheduled for nobody.

⚠️ **And the same change ran into the rule that makes deployment order harmless.** Migrations here
must be safe to apply *while the previous version of the code is running*; PostgREST rejects a write
carrying an unknown column, so dropping one fails **every** write on that path for a host that
migrates before deploying — with an error naming a column, not a version. That rule is a test, it
caught the drop, and it was right to. The sequence is therefore: stop serving, stop writing, erase,
and drop the column a release later once nothing supported writes it. The measurement is what makes
the deferral free rather than a compromise — **the erasure is complete on day one; only the shape of
the schema waits.**

⚠️ **A migration that only erases leaves no trace in `information_schema`** — no column, no index,
no constraint — so the repository's own detectability guard called it unprovable. That is the right
verdict on the wrong-looking file: a purge is precisely the migration a host is most likely to be
asked to *prove* to a regulator. It carries a `comment on column` for that, which `col_description()`
answers. **The record of a deletion has to be something that exists.**

⚠️ **A table nothing serves has no guardian, and that is where the oldest data hides.** The same
arbitration went on to ask for the raw User-Agent, on the sessions table and on the *views* table.
The sessions column had a defence — it is the source of `device`, `os` and `browser` — and it did not
survive contact with its own premise: those three are derived **at write time** and are what a
reading record carries, so the raw string has no reader, and *"we might re-parse it one day"* does
not buy thirteen months of a fingerprint kept for nobody. But the views table was worse and nobody
had looked: it has no derived columns at all, so it derived *nothing* from the string, wrote it, and
none of the six queries touching these tables has ever read it back.

The reason it hid is structural, not careless. **The coverage that existed asked what a session
*hands out*** — a bench that reads the schema and refuses a column that is neither served nor
withheld with a written reason. The views table is never handed out, so no such bench existed for it,
and nothing ever asked what it merely *keeps*. Every audit of that area had been an audit of egress.
**A column nothing serves is not a column without a question; it is a column whose question has no
guardian.** Ask of each table both halves — what leaves it, and what it holds — because only the
first has an obvious place to be asked.

⚠️ **And answer "when is it purged" with the mechanism, not the number.** A retention window of
thirteen months is easy to quote and, on its own, misleading here: this player's automatic sweep is
**opt-in**, so on an installation that enabled neither it nor a manual run, no row has ever been
deleted and the window describes an intention rather than an event. The honest answer has three
parts — the rows (a policy someone must have switched on), the values inside surviving rows (erased
by the migration, physically gone once routine autovacuum passes), and the copies nobody here
controls (backups, WAL, exports, on the platform's own schedule). **When a compliance question asks
for a date, the number that ends the sentence is usually the one you do not set.**

⚠️ **A list of decisions rots in two directions, and only one was checked.** The session columns are
covered by a list of what is *served* and a list of what is *withheld with a written reason*, and a
bench read the schema to refuse a column present in neither. Nothing refused the mirror image: an
entry motivating a column that no longer exists. Had the drop shipped, the reason for withholding
`ip` would have stayed there indefinitely — prose about a thing that is not, which the next reader
takes for the state of the world. **Any list that mirrors an external fact needs both directions
checked, or it decays into a description of the past.**

## A derived perimeter is proven by a file that appears, not by a count

**Most guards here take their perimeter from the disk** (`git ls-files`, `readdirSync`,
`npm pack`) rather than from a written list. ⚠️ **This sentence used to open with a count, and the
count rotted** — "eight" from memory, corrected to "twenty-three" by measurement, true when written
and twenty-five a week later. Both were wrong to be here at all: the section argues that a count is
not the proof, and then led with one. Deriving a perimeter was never the claim worth checking. **Deriving it
*correctly* is**, and there is exactly one probe for that: *put a new file of the kind the rule
judges into the repository, and see whether the guard turns red on it.*

Eighteen of the twenty were probed that way on 31/08 (a violating file dropped, `git add -N`,
guard run, file removed). **Seventeen saw it. One was blind.**

⚠️ **`renvois-par-position` had a written list hiding inside a derived perimeter.** `markdowns()`
walks the whole tree; the scope filter then enumerated four root names plus `docs/`. Measured by
placing the same reference twice, word for word, changing only the path:

```
docs/zz-sonde.md   a positional reference to a numbered line   → exit 1, seen
GOUVERNANCE.md     the same sentence, same wording             → exit 0, INVISIBLE
```

⚠️ The two probe files carried the offending phrase verbatim; **this page does not**, and that is
not squeamishness. `renvois-par-position` now sweeps every Markdown outside its permitted list,
this file included: writing the literal here would make the guard red on the prose that documents
it, one would exempt the file, and the exemption would be the hole. `secrets-en-clair` assembles
its own sample at runtime for exactly this reason.

Five documents of this repository were already outside it with no decision having said so —
`CLA.md`, `CODE_OF_CONDUCT.md`, `MAINTAINERS.md`, `ROADMAP.md`, `SUPPORT.md`. **A list of what to
LOOK AT stops covering the moment a file appears; a list of what is PERMITTED turns red on every
file that is not in it.** The scope is now the second kind, with `CHANGELOG.md` as its one written
exception (a reference in a log records a past state; correcting it would rewrite history) and a
bench asserting that exception still has a subject.

Two guards cannot be probed this way and it is worth saying why rather than counting them as
passes: `codeowners-valide` (a new file cannot create a violation — its rule is that each pattern
designates something) and `verdict-zap` (its subject is produced by a scan, not by the tree).

⚠️ **Three times the probe was wrong and the guard was right**, which is the same discipline
pointed the other way: a tool with no package dependencies launched without `npm ci` is not a
violation of `outils-servis`; a malformed workflow makes `images-des-workflows` refuse rather than
accuse; and `surface-base` recognises `db.request(`, not any database call. **A probe that does
not actually violate proves as little as a green that measured nothing.** Check that the probe is
a real violation before reading the guard's silence as blindness.

## A state shown to someone, derived from configuration rather than observation

**The fourth form, and this repository had already named it — in its own host contract, in bold.**
`docs/HOST-CONTRACT.md` has said since 26/08: *"`ELEVENLABS_API_KEY` alone no longer shows them:
the key proves the **server** can synthesise, never that a click leads anywhere, and a button that
leads to silence is a broken promise made in your name."* The markup obeys that rule —
`voixProposable()` requires the key **and** `wiresVoice === true`, a declaration only the host can
make.

The **config object** did not. `page-visionneuse.js` computed `cfg.botVoice` — the field handed to
`window.PlayerBot.init(VIEWER)`, i.e. to the host's own bot runtime — from the key alone. Measured
on 31/08 with the key set and a plugin that declares nothing:

```
cfg.botVoice  = true      ← what the page TELLS the host's plugin
voice markup  = absent    ← what the page RENDERS to the visitor
```

**Two halves of one page contradicting each other, and the half that was wrong was the half derived
from configuration.** The one predicate is now exported and called from both, so the question is
written once.

⚠️ **What is asserted is the agreement, not the value.** *"`botVoice` is false without
`wiresVoice`"* pins one case; what must hold under every configuration is that both halves say the
**same thing**. Only one of them can be wrong without anything noticing — which is precisely what
happened, for as long as the field existed.

⚠️ **And the probe that found it was wrong twice before it was right**, which is the same
discipline pointed inward. It first matched `botcVoice` and `botw-s2` anywhere in the page — both
live in the **stylesheet** too (`botcVoicePulse`, `.botw-card.botw-s2`), so it saw a divergence
that did not exist. A probe that reads CSS invents a culprit exactly as one that reads comments
does. And the first test context omitted `plugins.botBrowser`, without which no bot markup is
rendered at all: the positive case would have been *"both halves say no"* — green for the wrong
reason, in the bench written to catch a divergence.

## The taxonomy has a boundary above `tenter`, and nothing said where

`tenter()` maps everything that happens *after* the import to exit `2` — *the guard could not
look, the fix is not in your branch*. **An absent package fails the import itself.** Measured on
31/08 with `node_modules` removed: **19 of the 42 tools exit 1** on an `ERR_MODULE_NOT_FOUND`
stack trace, and none of them can do otherwise — their code never ran. That is the taxonomy's own
forbidden red (accusing a branch for an environment fault), produced at a place the taxonomy
cannot reach.

The corresponding property is held **elsewhere**: `outils-servis` refuses a workflow that launches
a dependency-carrying tool in a job without `npm ci`. Nothing holds it for a person running a tool
by hand in a fresh clone; the answer there is `npm ci`, and the boundary is now written down
rather than rediscovered.

⚠️ **And the "stripped environment" debt was largely already paid — the sweep that went looking
found that out about itself.** `planchersDesGardes` builds its empty tree in a temp directory,
which **is not a git repository**, so `git ls-files` and `npm pack` fail there exactly as they do
with the binaries absent. Its assertion (*never exit 0*) is strictly stronger than *never exit 1*.
Four mutants built to separate the two — a perimeter hoisted above `tenter`, a swallowed git
failure falling back to a plausible list — were killed by both benches every time.

⚠️ **And that verdict was itself produced by a broken harness — corrected here on 31/08.** The
mutation runner passed `--reporter=basic`, which vitest 4 rejects: *every* invocation exited 1, so
it reported **KILLED whatever happened**, including for surviving mutants. It was a detector
maximally confusable with its own failure — the exact defect this page spends its length on — built
and used all day by the person writing about it. Re-measured with a runner that reads the failing-
test count and refuses a verdict when the bench is not green before mutation: eleven of the twelve
claims stand, and one was wrong. **A swallowed git failure with a plausible fallback survives all
three benches** — it was reported as killed by all three. That gap is open.

The lesson is not "be careful with harnesses". It is the one already written above, applied one
level up: **a tool that reports on other tools needs its own positive control.** Before believing a
campaign of KILLED, make one mutant that must survive and check the runner says so.

⚠️ **And that bench's own central property did not bite — corrected the same evening.** Its
garnished tree was not a git repository, so `git ls-files` failed there **with git as without it**:
"equipped" and "stripped" were the same environment for exactly the tools the bench existed to
protect, and comparing the two compared nothing. The tree is now a real repository (`git init`,
`git add`), and the difference is visible: blinding `licence-par-fichier` gives 102 files with git
and 1 without.

**Comparing verdicts was not enough either.** A guard that swallows the git failure and falls back
to a plausible list exits 0 on both sides — same code, same absence of faults — having read a
hundred and two files on one side and **one** on the other. The only place the difference shows is
the summary line, the very thing this repository spent the day making load-bearing. The property is
now: *a tool green in both environments must print the **same** summary, or say it concluded
nothing.* The single legitimate divergence — `exemples-en-retard`, whose contract is to report an
indeterminate result when the registry is unreachable — is recognised by **what it says**, never by
its name.

That mutant, reported on 31/08 as killed by all three benches and in fact surviving all three, is
now killed by this one alone and still survives the other two. **The bench earns its place on
evidence rather than on configuration** — which is what the earlier note in this section could not
claim. Scope, stated: the property is demonstrated on `licence-par-fichier`, where the branch is
reachable in a synthetic tree; on `liaison-de-crypto` the same mutant could not be exercised at all,
because that guard's own witness refuses first on a fixture that thin. That is neither proof of a
hole nor proof of protection.

What remained genuinely untested was one **configuration**, not a property: a **garnished** tree
with the environment absent. Measured with a decoy in place of `git` and `npm`, three tools —
`licence-par-fichier`, `node-de-l-image`, `release-preflight` — reach their external call *only*
there; in an empty tree they refuse earlier. `environnementDepouille` holds that position and says
in its own header that no mutant is known to be killed by it alone. **A coverage claimed wider
than it is, is worth less than no coverage** — so it is claimed exactly as wide as it is.

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
what the reader *knows about the domain*. Meanwhile the `indetermine` row of the verdict table in
`docs/HOST-CONTRACT.md` was swallowed into an unrelated paragraph **from 18/08 to 27/08** — nine days, from 0.1.64
to 0.1.140, past every reader of that page including its own author — because a stray pipe attacks
only the **typography**, and a reader forgives a typo without thinking. **An inconsistency is seen
without looking only when it bears on the meaning, never on the form.**

## The mirror of that corollary, on the way in

**An inherited capability is found only when something forces you to look for it.** The same host
caught themselves three times in a week proposing to add what their code already had, and named
why: *"I look for the capability in the code I have just written, never in the code I inherited"*.

⚠️ Measured here on **27/08** — the wiring below is from the 26th, the counting is from the
day after, and mixing the two is exactly the kind of slip a date is supposed to prevent. The
numbers are the argument:

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
values, the code returns five"* — while the paragraph opening *"`indetermine` is not a failure of
the card"* explains the fifth at length. Fifth occurrence in
one week of a rule broken by the hand writing it. Not a coincidence: **the rule you have just
formulated is the one you are most certain you already hold**, so it is the only one you do not
re-apply to yourself.

⚠️ **Last, and it is the least intuitive result of that week: the value of a report does not lie in
its being right.** Two of the three defects then found in `docs/HOST-CONTRACT.md` exist only
because that host reported something **false** and it had to be refuted — with the file open.
A report obliges someone to open the file; a correct one does that no better than a wrong one.
So send what you are only half sure of, **saying which half** — the worst case is being corrected,
and that correction happens with someone looking.

## A number in the present tense rots; a number in the past tense is a fact

**The test is grammatical, and it takes a second.** Read the sentence with the verb moved to the
past. If it still reads true in six months that way, it is a record and needs nothing. If only the
present tense makes it worth writing, it is a description of a live state, and it will be wrong
without anyone touching it — so it needs a date, an address, or removal.

⚠️ Four catches on 27/08, in one morning, in this repository:

| what it said | what was true |
|---|---|
| `npm test  # 1100+ tests` | 2206 — a **floor**, so never false, and understating by half |
| `ROADMAP.md`: *a suite of ~1 800 tests* | 2206 — an **approximation**, same trap under another notation |
| `AGENTS.md`: *Measured here on 26/08* | the counting was done on the **27th**; the date came from the subject, not the measurement |
| `docs/HOST-CONTRACT.md`: *nothing in `server/` calls it today — that is measured* | present tense, undated, in the **published** page — written an hour before the date above was fixed, and left alone because the fix had been applied to the file that was pointed at rather than to the class |

⚠️ **And the rule rotted inside its own rulebook — three times, found by looking rather than by an
incident.** A host's rule sent us looking for present-tense numbers in prose; the sweep came back
with three, all in files that carry this very section:

| where | said | was |
|---|---|---|
| `AGENTS.md`, the derived-perimeter section | twenty-three guards | 25 |
| `AGENTS.md`, twice in one section | thirty-three guards | 42 |
| `docs/HOST-CONTRACT.md`, written that hour | thirty-nine guards | 42 — and *thirty-nine* was not even a guard count, it was how many **concluded conforming on one run** |

⚠️ The sharpest of the three is the first: **it opens the section that argues a count is not the
proof.** A rule stated correctly, in a paragraph disproving the practice, illustrated by the
practice. Note also that the last one conflates a population with a measurement of it — "guards" and
"guards green today" are different subjects, and only one of them is stable.

None had a mechanical counter-measure available. Counting guards and grepping prose for a spelled
number is the vocabulary problem again, and the fallback is the one named above: **the subject, not
the wording**. So the numbers were removed rather than corrected. A magnitude that carries an
argument survives as *most*, *every*, or a dated measurement; a magnitude that carries only
impressiveness is rot with no upside.

⚠️ **And the rule has a constructive half, which a host supplied after running our own sweep on
their files.** Ours came back with three rotted numbers; theirs came back with **one** — and the
interesting part was why the rest were sound. Not care. **Form.** Three shapes cannot rot, and
between them they cover most of what a number is ever written for:

| shape | their example | why it holds |
|---|---|---|
| a reading in the **past tense** | *"Verified: 1739 tests green (148 files)"* | it records an event; an event does not change |
| anchored to an **artefact** | *"30 migrations, v12321 → v12417"* | bounded by two identifiers, so it re-verifies itself |
| a **dated citation** of the defect | the four *"255 tests"* documenting its own removal | it quotes rather than claims |

**Removal is the fourth, and the only one left when none of the three applies** — which is what the
three cases above needed. A magnitude carrying an argument survives as *most*, *every*, or one of
these three shapes; a magnitude carrying only impressiveness has no shape that saves it.

⚠️ Their single rotted case is worth its own line, because it is this section's own failure at a
larger scale: a present-tense sentence about a file that **had been deleted from the repository** —
with the correction sitting six hundred and fifty lines above it, in the same file. Ours put a
count in the paragraph disproving counts; theirs put the warning and the claim so far apart that
neither reader ever holds both. **A warning in one place does not protect a claim in another**, and
distance is what decides that, not intent.

⚠️ **A *position* is one of these numbers too — and neither this repository nor the host who caught
it had read that into the rule.** Every catch above is a count or a date, so the rule reads as being
about counts, and a cross-reference by line number slips underneath it. Two did, **in this very
file**, pointing into `docs/HOST-CONTRACT.md`; both were stale within hours of being written, and
both survived the morning that produced the four catches above. The host who found them named the
miss better than the catch:

> je cherchais des COMPTES, pas des POSITIONS. La règle était juste, ma lecture de son périmètre
> était trop étroite.

They then found two of their own, one written the previous day against a release four versions back
and already false. **A position is the most perishable present-tense number there is**: a count
survives an edit that adds nothing to count, while a position survives no insertion above it, in a
file nobody is editing. And it rots on the *reader's* side, silently — a stale pointer returns no
error, it returns other content, plausible, and manufactures a finding of absence. The remedy in
prose is to designate the **object**: quote the sentence, name the table row, give the section
title. `tools/renvois-par-position.mjs` now refuses positions in the documents people navigate by.

**A floor and an approximation are not precautions.** `1100+` and `~1 800` announce *imprecision*,
never *perishability*: they protect against being false and leave the rotting untouched, which is
worse, because a false number eventually hits someone and a surviving floor misinforms quietly and
forever. Prefer the command that prints the number to any way of writing it down.

⚠️ **But the test must also say what to leave alone, or it does damage.** An integrating host ran
it across their own files and found two survivors worth naming, both of which they would have
"fixed" without the check:

- *"a few hundred lines"*, describing the wiring a host writes. Measured: 552 lines, 248 of real
  code. **Replacing it with 552 would have turned a characterisation that never rots into a number
  that does.** An approximation that *characterises* is not an approximate measurement.
- *"≈ 1 in 26 000"*, a collision odds. Recomputed: 10 windows / 64³ = 1 in 26 214 — a constant
  **derived** from the slug alphabet, not a reading of any mutable state.

**The two-bounds test tells them apart in ten seconds**, and both halves are needed: *an
approximation whose two plausible bounds carry the same message is a characterisation; one that
stands in for a number you could have counted is a degraded measurement.* "A few hundred lines"
says the same thing at 400 and at 700 — that is the information. "~1 800 tests" also survives 1 700
and 1 900, but an exact count would say strictly more, so it fails the second half. The first
belongs; the second is a measurement someone rounded.

The same sort was run here and cleared three: the audit reports' `236 tests` and `329 tests`
(dated records of a past measurement), and a quoted verdict line inside an example. Nothing to
touch. **A probe that only says *fix this* is worth half a probe that also says *leave this
alone*** — the second protects against corrections that quietly degrade a document.

⚠️ **A first version of this paragraph claimed the rule existed "nowhere in this file". That was
false, and the way it was reached is the point.** The idea was already here, twice, merged the same
morning: *"the list is dated, hedged, and followed by an address"*, and *"a second source that rots
by design"*. What was missing is narrower and worse: the rule was never stated **as a rule**, only
inside an incident about a GitHub setting — filed under *why this paragraph is dated*, never under
*how to write a number*. Nobody about to write one has any reason to open the section explaining a
past correction.

⚠️ **And the search that concluded "nowhere" was its own failure.** It looked for `present.*past`,
`grammatical`, `tense` — the words of the formulation being written, not the words of the idea as
it had actually been recorded. A probe built from the phrasing you have in mind returns a negative
about the phrasing, never about the subject; the same trap caught an integrating host an hour
earlier, on a difference of case. **When a search says nothing is there, search again for the
thing, not for your name for it.**

The workable form of that, proposed by the same host and measured here on the very case:
**search the object the rule is about, or two independent phrasings — never one name you just
invented.** On this file, before the section existed:

```
grammatical|tense|present.*past   → 0 hits      the name being coined
date                              → 5 hits, 3 of them the rule itself
```

A case difference is repaired by `-i`. A vocabulary difference has no mechanical counter-measure
at all — which is why the fallback has to be the subject rather than the wording. The two cases
are the same failure at two depths, and only the deeper one is invisible to tooling.

## Present in the file, absent for the reader

**Two ways a true sentence does no work.** Both were measured on 27/08, both are ours, and
neither is a matter of care — the text is correct in each case, and lands nowhere.

⚠️ **Distance is a form of absence, and it is measurable.** `docs/HOST-CONTRACT.md` warned that
the schema probe is lazy and process-local. The warning was exact. It sat 140 lines from the
verdict table it governs, while its neighbour `presenceDurcissement` carried the same caveat
**inside its own cell**. That day two integrating hosts, independently, came within one message of
reporting the same regression that did not exist — one read three verdicts in a day on an unchanged
database, the other says they would have filed at the first `partiel`.

The test is the incident: **when two attentive readers miss a written warning on the same day, the
warning is not written where it is read.** Moving it into the cell was not cosmetic; it was the
only available fix, because nothing about the sentence was wrong.

⚠️ **A conditional is honest only if it names who lifts the doubt.** Writing to a host about a
bucket, this repository said *"if you write to `tts-cache`, do not realign your formula"*. That
reads as a precaution and functions as an undeclared assumption: it had not been established that
they wrote there at all — they do not — and the shape of the sentence transfers the burden without
saying so. **The reader believes their case was considered, when it was merely left open.**

The honest form names the gap and its owner: *"I do not know whether you write to this bucket; if
you do, here is what must not be done — tell me and I will stop guessing."* Same content, and the
doubt now has an address. The host who received the first version put it best: a conditional that
does not say who resolves it transfers the charge silently.

Both cases have the same shape as the corollary two sections up, applied to a sentence rather than
an output: **being present is not the same as being read.** A warning too far from its subject, and
an assumption dressed as a precaution, are two ways of being present and doing nothing.

## A timing guard buys its margin on the subject, never on the threshold

The archive-seal step went red on `main` on a product that worked. The write **was** refused,
refused **by the seal**, and it **did** block — 1137 ms, unblocking at the exact instant the
concurrent transaction committed. Only the threshold refused.

The arithmetic: the concurrent transaction holds the lock `pg_sleep(2)` seconds **from its own
start**, and the write begins `sleep 0.6` later. The expected wait is 1.4 s against a 1200 ms
floor — **200 ms of slack** — and any scheduling delay between the two *shortens* it, since the
countdown has already begun. The runner's jitter that day was **315 ms**.

**The fix is not to lower the floor.** Lowering it makes the bench green by making it less capable;
lengthening the concurrent transaction makes it green while staying exactly as severe. The
integrating host that read the fix put the rule better than the case: *the threshold is what you
measure — moving it changes the question in order to get the answer.* Margin is bought on the
**subject**, never on the **threshold**.

Verified both ways before pushing, against a real PostgreSQL rather than reasoned about: at
`pg_sleep(2)` with the observed jitter → 1123 ms, red (the forge's failure, reproduced); at
`pg_sleep(4)` → green even under 2.5 s of jitter. And a positive control, because a bench made
robust must be shown still to bite: with the seal trigger dropped, the write enters and it turns
red.

⚠️ **Why this matters past this one step.** A bench whose margin sits under its machine's jitter
does not measure what it thinks it measures — it measures the runner's load. Worse, it *teaches its
own red to read as noise*, which is the worst state a guard can reach: the day it is right, nobody
believes it.

## Every guard here measures this repository, and the defect lived at the host

Three defects shipped in one day, each found by an integrating host within hours, none seen by any
guard here: a counter saturating at our own bound; then, in its fix, a *server* ceiling passing
under that bound (`db-max-rows`, 1000 by default on Supabase) so that a 1651-row table published
`1000` **with `tronque: false`** — asserting an exactness it did not have.

The reflex is to read that as a failure of the guards. A host read it better: **all three lived at
the frontier between this code and an installation we cannot see.** PostgREST's ceiling is a fact
of *their* database. The saturation only manifests at *their* volumes. And our test double, by
construction, could not host that frontier at all.

Guards that run here measure this repository. **None of them can measure what only exists at the
host** — that is structural, not an oversight, and it is why these exchanges are worth their cost:
not that the other party looks harder, but that they are not looking at the same object.

The symmetry holds in the other direction, and the host said so first: their own defect of the same
day — a statistics read truncated to the 1000 *oldest* rows of 6424 — lived entirely in their
repository, in a file their own guards did not watch either. It took our counter for
them to go and look.

## A double that does not simulate a layer cannot be fixed by any dataset

We already had the rule that a fixture must be able to **produce** the phenomenon. This is the rung
below it, and it was missing.

The counter's test double returned a *constant array*: it ignored `limit`, ignored the cursor, and
had no ceiling of its own. So the ceiling defect was not *missed* in the bench — it was
**unreachable** there. The fixture written with a real host's own volumes (257 and 1651) could
change nothing, and not because those numbers are too small: because **the ceiling did not exist in
the double's world**.

A missing case is recovered by writing it. A missing **layer** is not.

⚠️ And the reason it stays invisible: a database double that does not cap never announces *"I do
not cap."* It behaves like a perfect database — which is indistinguishable, from the inside, from a
correct one. So when a defect lives in a layer, ask what the double *is silently perfect at*, not
what data you fed it.

## A control that separates two mechanisms must rest on what only one of them can do

An integrating host wired an optional seam of ours, then wrote a script to check it was actually
being used. The script compared the published number against a value:

```
→ vues : 1655 | réel en base : 1651
⇒ repli sur la voie par lignes — db.count n'a pas répondu
```

It was wrong, and the seam was working. Two faults stacked, and the second is the one worth
keeping.

The first is the section above this one: `1651` was a number they had measured *the day before* and
written into the control by hand. Four rows arrived in between. A number in the present tense rots,
and this time it rotted **inside the tool whose job was to check something else** — which is the
placement that costs the most, because a rotted control does not fail loudly, it accuses the
subject.

The second is new. **They wrote a value control for a mechanism question.** The question was *which
of two routes produced this number*; the assertion was *is this number 1651*. But both routes can
return 1651. The property that actually separates them is that one of them **cannot exceed a
ceiling** — the bounded route is structurally incapable of returning more than the server's
`db-max-rows`, so `> 1000` is true of one mechanism and impossible for the other, whatever the table
grows to. `= 1651` was true of both and expired at the next write.

⚠️ So: **to distinguish two mechanisms, assert on something one can do and the other cannot** — a
capability, a ceiling crossed, a call made or not made — never on a value both could produce. A
value control over a mechanism question is green for the wrong reason, and it holds that green
until the value drifts.

Applied to ourselves the same hour, and it found something. Our own benches for those two routes
are sound: they assert on the *calls recorded* — `vus.every(c => c.startsWith("count:"))` — which is
a mechanism, not a value. But they are sound **only because a bench can see inside**. The host
cannot see our calls, and the two routes published an identical card. The rule held on our side of
the line and failed on theirs, which is the shape this repository already knows: a guard that is
correct, and does not run on the perimeter you think. The card now carries `voie`, so the
distinction they had to infer from luck of volume is one they can read.

## A small installation does not merely lack occasions — it loses discriminating power

An integrating host stated this about themselves, and it is the sharpest thing anyone said this
week:

> Nos faibles volumes nous protègent des défauts. Ici ils nous privent d'un signal que le volume
> produisait gratuitement chez l'autre. **Un hôte plus chargé est mieux instrumenté sans avoir rien
> instrumenté.**

The case. Our purge card publishes a count. Two routes can produce it, and for a while the card did
not say which. At the other host — 1655 rows — an exact count *is its own proof*: it exceeds the
server's 1000-row ceiling, which the bounded route structurally cannot. At this host — 99 sessions,
354 views — **no value can ever separate the two**. Same code, same card, and one of them is blind
to a failure mode the other detects for free.

⚠️ **So: a field whose value is its own witness at scale needs an explicit witness at small scale.**
Not because small installations matter less, but because the free evidence large ones enjoy is an
accident of their size and it silently disappears below a threshold nobody wrote down.

Applied to our own card within the hour, and it found one. `mesures.relever()` omits any route
family with no samples — correctly, since a `0 ms` would read as *instantaneous*. But the omission
left `routes: {}` meaning either *no traffic* or *measurement is not running*, and a loaded host
never meets the question because its entries are always there. The two sibling fields in the very
same object already knew better — `statuts` publishes its five keys at zero, `boucleMs` publishes
`n: 0` with explicit `null`s "rather than a zero that would read as: the loop is healthy". Three
siblings, two carrying their denominator and one that had forgotten. That is what makes the rule
measurable rather than arguable: the inconsistency was already inside the file.

## Is there a state of the world where this value is false?

The same host wrote *"this is not a defect; it is something a host cannot verify"*, and then
retracted it themselves with the reason:

> Ces deux propositions m'avaient l'air équivalentes. Elles ne le sont pas : **une chose
> invérifiable devient un défaut dès qu'elle peut être fausse sans bruit.**

⚠️ The question that separates a *limit of observation* from a *silent failure mode* is one line:
**is there a state of the world in which this value is false?** If yes, the unverifiability is the
defect, not its mitigation — because the reader will act on a value that nothing contradicts.

Classifying a silent failure as an observation limit is comfortable in exactly the wrong direction:
it converts something to fix into something to accept.

## A binary is an assumption that no transition exists

Stated by the other host, on a field of ours they had not thought to question:

> Le cas où deux réponses coexistent n'est pas un cas limite, c'est un état normal du système
> pendant une transition. **Un binaire est une hypothèse sur le fait qu'aucune transition
> n'existe.**

The card's `voie` says which route produced its numbers, and it has three states, not two. The third
is not politeness about edge cases: a host **mid-purge**, with the column already dropped, makes
`count` throw on the filtered paths and answer on the same table's totals — both routes serve the
same read. A boolean would have had to round that, that is, lie about one of its halves, at the
precise moment someone is reading those numbers to decide whether anything is left to erase.

It is the same reasoning that gave `vide` three states, and the generalisation is worth keeping:
before choosing a boolean, name the transition it assumes away. If you can name one, it is not a
boolean.

## The visibility of a defect is distributed inversely to its cost

An integrating host has `safeupdate` preloaded, so an unrestricted `DELETE` or `UPDATE` is refused
outright — even under `service_role`. They reported it as an obstacle they had paid for. It is the
opposite: it is the **net**, and nothing in our host contract requires it.

⚠️ Run that backwards and the shape appears. At a host that has the protection, the bad line fails
loudly and someone learns the problem exists. At a host that does not, **the same line succeeds and
empties the table** — silently, and nobody learns anything. So the host who is protected is the one
who finds out, and the host who is exposed is the one who never does. They stated the general form,
and it is worth more than the case:

> the protection that makes a defect noisy is not guaranteed by the contract, so the protected host
> learns the problem exists and the exposed host never does — **the visibility of a defect is
> distributed inversely to its cost.**

The practical consequence is a rule about where to put the fix. When a defect is only noisy where
something optional catches it, **close it on the side you control** rather than requiring the
catcher. We did not add "you must enable `safeupdate`" to the contract; we added a guard that
refuses an unfiltered write in our own repository. Requiring the net asks every host to rescue us
from a line we could simply not write.

⚠️ And the corollary for reading reports: a host telling you about a defect is evidence they had the
protection, not evidence they are the affected one. The affected ones are silent by construction.

⚠️ **Which makes the whole channel biased, not just one report.** A host drew out the consequence
after reading the rule back to us, and it is sharper than what we had written:

> what you receive as field reports is filtered by the ability to see, so it is systematically biased
> toward the best-instrumented installations. **The reports you will never get come from where it
> breaks the most.**

This is survivorship bias applied to a host contract, and it says what to do with a quiet channel:
silence from an installation is not evidence that it is healthy, it is an absence of evidence
weighted toward the installations least able to produce any. So do not rank a defect by how many
hosts reported it — that count measures instrumentation, not incidence. And when a report arrives
from a well-instrumented host, ask what the *unequipped* version of that installation would have
experienced instead, because that version exists and will not write.

⚠️ It also bounds what our own "What you can see and we cannot" section can achieve. Asking hosts
what they cannot verify improves the answers from those who can already answer; it does nothing for
the ones whose whole problem is that nothing at their installation would notice. Those are reached by
closing defects on our side, never by asking better questions.

⚠️ **And a host sharpened even that, in a way that changes what the section is for.** We had written
the bound as a limit on reach. They put it as a statement about direction:

> It is useful — our four replies are the proof — but it does not correct the bias, it exploits it
> better. The only action that reaches the silent hosts is the one that does not depend on them.

Keep both halves. The section is worth having: it produced the ceiling, the platform timeout, the
substitution seam. But it is a *yield* improvement on the population that already answers, and
counting its successes as evidence the channel is healthy is the same error one layer up. When
choosing between one more question to hosts and one more defect closed here, the second is the only
one that touches the installations we never hear from.

## Two identical messages are one reading — the relay copies, the authors do not

⚠️ **Measured in both directions, at two hosts, independently — so it is a property of the channel
and not an anecdote.** Two host replies reached us byte-for-byte identical. Rather than count them
as two independent readings, we asked both hosts whether they had written twice. Both said no: one
message each, never resent. One of them added the reciprocal measurement, which is what settles it —
*our* announcement of the 0024 gestures reached them **three times**, and our relayed message from
the other host **twice**, each time the same text.

> Between two parties communicating through a human relay, the identity of two messages does not
> prove two readings — it proves a copy-paste.

The failure mode is the same shape as the instrumentation bias one section above, and just as
comfortable: **it inflates the signal without inflating the information, in the direction that
reassures.** A fact measured at one host is an anecdote; at two independently, a property — and a
duplicated relay manufactures the *appearance* of the second host at no cost, which is precisely the
evidence this repository upgrades a claim on.

So, operationally: **before counting a second host as corroboration, establish that it is a second
author.** Identical wording is disqualifying on its own, and near-identical wording deserves the
question asked out loud. The channel has no way to see this from the inside, so the check has to be
explicit — asking costs one sentence, and being wrong costs a rule written on one host's word while
believing it rests on two.

## A guard that only serves when another has failed is the least exercised and the most needed

The same week, a host pointed out that the timeout we had just corrected sits on a path their
installation does not use: they take the exact-count route, so those timers only ever apply if
`db.count` stops answering. Which is to say — the correction matters precisely when something else
has already broken, and never before.

> A guard that only serves in case of another's failure is the one you exercise least and need most.

It is worth naming because the usual instinct runs the other way: a path that never executes in
normal operation looks like a candidate for less care, not more. It deserves more, for the same
reason a fallback deserves a bench — the first time it runs, everything else is already wrong, and
nobody is in a position to notice that it ran badly.

## Distance decides whether a warning protects a claim — and it is not linear

Recorded above: a warning in one place does not protect a claim in another. A host sharpened it after
comparing their case with ours, and the sharpening is the useful part.

| | distance | what happened |
|---|---|---|
| theirs | 650 lines, same file | a present-tense claim about a deleted file; the correction sat far above and nobody joined them |
| ours | one paragraph | a count opening the section arguing that a count is not the proof |

⚠️ **Ours was the worse of the two, and its closeness is why.** Their formulation:

> very far, one does not make the link; very close, one believes it has already been made.

So proximity is not a defence and can be the opposite of one. A contradiction a paragraph apart
reads as deliberate — as if the author had already reconciled the two — while the same contradiction
across a file at least looks like an oversight someone might check. When a correction and the thing
it corrects sit close together, neither distance nor good faith does the work: only stating the
contradiction outright does.

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
