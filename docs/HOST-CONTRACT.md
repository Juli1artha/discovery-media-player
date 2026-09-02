# Host contract

> **This document is an export of the package** — resolve it with
> `require.resolve("discovery-media-player/contrat")` (and the retention policy with
> `…/retention`). An exposed path is a promise that survives file reorganizations; reading
> `node_modules` paths by hand is a guess about our tree, and it broke twice in one day.

What a host application may call, what it must implement, and what will not change without a
version bump. If you are integrating the player, this page and [`API.md`](https://github.com/Juli1artha/discovery-media-player/blob/main/docs/API.md) are the two you
need.

## Six rules

1. **One source of truth.** Fix the player in the player's repository, never in a host — not even
   in a host that once contained it. A fix written host-side is a copy, and copies drift.
2. **Additive by default.** Adding an action, a parameter or a field breaks nobody. **Removing or
   renaming is a break** → a new contract number, both served during the migration.
3. **Deploy order: the player ships before its hosts.** The reverse makes a feature disappear
   everywhere at once, with no error anywhere.
4. **Pin the version you target, and test it.** `GET /api/doc?contract=1` answers without a
   session, without a database and without cache — it must answer when nothing else does.
5. **Anyone may propose, the maintainer releases.** Open an issue or a pull request here; you have
   the context and often the fix. Releasing stays with the maintainer because publishing a version
   decides deploy order. A local workaround is fine when you are blocked, on two conditions: report
   it the same day, and remove it when the release lands.
6. **Describe what you do — including what you think is trivial.** Not *"report deviations"*: you
   cannot know what one is, because that would mean knowing this page better than we do. ⚠️ The
   over-specified sentence in [the `tts-cache` section](#four-things-that-will-bite) stood for
   weeks, and it took a host mentioning its own naming **as a curiosity** for anyone to look. Its
   own account of it, on 27/08: *"je ne l'ai décrite que parce que je citais `preview-fr-v2` comme
   une curiosité, sans savoir que c'était un écart. Si j'avais su que votre page l'interdisait, je
   me serais probablement conformé."* Complying would have orphaned **908 objects, permanently**.
   A rule that asks you to spot the deviation cannot work; a rule that asks you to describe your
   integration asks for nothing you do not already have. Boring descriptions are the useful ones.

## Identity card

```json
{
  "product": "discovery-media-player",
  "contract": 1,
  "version": "<the running version>",
  "runtime": { "node": "<what this instance runs on>", "nodeRequired": ">=22.13.0" },
  "capabilities": ["docshare", "presentations", "embed-denied", "host-fetch", "brand-reference", "host-auth", "host-share", "host-mail", "retention"],
  "frameAncestors": ["'self'", "https://*.vercel.app", "https://app.example.com"],
  "separateIssuer": true,
  "internalStrict": true,
  "presenceStrict": true,
  "presenceJetons": true,
  "presenceDurcissement": "inconnu",
  "presenceFusion": "inconnu",
  "lectureSaturee": { "total": 0, "fenetreS": 0, "derniereIlYaS": null },
  "mesures": { "fenetreS": 0, "seauxMs": [1, 2, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000], "routes": {}, "base": { "n": 0 }, "statuts": { "ok": 0, "refus4xx": 0, "debit429": 0, "occupe503": 0, "erreur5xx": 0 }, "memoireMio": { "rss": 0, "heap": 0, "tampons": 0 }, "boucleMs": { "n": 0, "moyen": null, "p99": null, "resolutionMs": 20 } },
  "retentionSweep": false,
  "hostShare": true,
  "hostMail": true,
  "plugins": { "bot": false, "visitors": false, "brandIntro": false, "botBrowser": false, "providerQuotas": false },
  "schema": { "couvre": "colonnes-conditionnelles", "attendues": 4, "sondees": 1, "verdict": "partiel", "manquant": [] }
}
```

**Pin `contract`**, not `version`: it moves only on a break. Test `capabilities` by **presence**,
never by order. `plugins` lets you refuse to start when you depend on an optional module this
instance does not have.

⚠️ **`ctx.has(name)` is that same question in code — and it is documented here because it was, until
27/08, an accident.** The injected context carries it: `has(name)` answers whether the named plugin
is present, the same truth the `plugins` field above reports over HTTP. Supply it as
`has: (name) => !!plugins[name]`; the standalone context returns `false` for everything, having no
plugins at all.

**As measured on 27/08, nothing in `server/` called it** — that is a reading, not an omission of
this paragraph, and it is why implementing it buys you nothing immediately and skipping it costs
you nothing. It is written down for the opposite reason: on that day one host was found to
implement it *correctly and without knowing*, because the type declared it, while the shape lived
in 57 test fixtures and, **until this paragraph existed**, in no document at all. A seam that
exists, works, and is written nowhere is one rename away from being deleted as dead — and it would
not have been dead. If a future feature needs to ask *"does this host have that plugin?"*, this is
the spelling, and there should not be a second one.

⚠️ **`runtime` is the only way to see what the player is actually running on.** `nodeRequired` is
the floor the package declares, `node` is what the process reports — two numbers, no verdict:
compare them with your own semver rather than trusting a field we compute for you.

The floor is **Node ≥ 22.13.0**, and it is not ours: it is what `pdfjs-dist` — the one production
dependency, the one that renders your documents — requires. npm will not stop you below it. It
prints an `EBADENGINE` line in the noise of an install and installs anyway, so an instance can run
for months on a Node its rendering engine calls unsupported, and nothing says so.

⚠️ **Read `node` rather than your platform's setting; they are not the same fact.** Measured on
25/08 at an integrating host: the project setting said `24.x` while the deployment serving
production ran `nodejs 22`. A configured runtime is an intention, and no amount of reading it back
tells you what executed. This field is the only place the two can be confronted.

⚠️ **`schema` tells you which migrations this instance is still waiting for.** The player never
applies migrations — it cannot, it only speaks PostgREST — so it *detects* instead, and a missing
column makes the feature that needs it **degrade silently**, by design, so as not to break a host
mid-migration. That silence is the point: an operator whose write ordering and message idempotency
are both switched off sees an instance that looks perfectly healthy. Each entry names the file to
apply and the feature that is asleep.

⚠️ **`manquant: []` has four meanings, so read `verdict`, not the array.** The card **reports**
what this process has already asked; it never probes on its own, because a diagnostic must answer
when the database does not — and on a serverless host that means it is usually empty. Ask a
different question when you want a real answer:

```
GET /api/doc?contract=1&schema=1
```

⚠️ **And if that is what you poll, the lazy verdicts are ones you will never see — which is the
whole point, and worth knowing before you read a warning aimed at somebody else.** `&schema=1`
probes every expectation *before answering*, then keeps the answers for the life of the process. So
its verdict is `complet`, or `indetermine` when the witness row itself does not answer — **never**
`non-sonde`, and `partiel` only in the window where two of them race. A plain `?contract=1` on that
same process reports `complet` afterwards too, because the probing already happened.

The consequence is a split an integrating host measured on 28/08, having read `complet` for a week
from a daily cron and put it down to luck: **the readers who need the "do not mistake this for a
regression" warning and the readers who ever meet it are disjoint.** Poll with `&schema=1` and you
cannot observe the degradation the warning describes; read `?contract=1` alone and you meet it
without having asked for a probe. Neither is a defect. But if you are checking that warning against
what you see, and you poll with `&schema=1`, **your instance is not the one it is about**.

⚠️ **`complet` means complete *for the code you are running*, never complete for the repository —
and `connues` is there so you do not have to take that on trust.** The expectation list is compiled
into the player. A migration published after your version does not appear in it, is never probed,
and can therefore never turn `manquant` red. So a host who applies the schema **before** upgrading
the code — the safe order, the one we recommend — is exactly the host this green does not inform.

The STUDIO host measured it on both sides on 30/08: on `0.1.142` they applied migration 0024, re-read
the card, and got `attendues: 9 · sondees: 9 · complet · manquant: []` — word for word what they had
read *before* applying it. They could not watch 0024 leave a list it had never entered.

No version of this server can know a migration that postdates it. What it can do, and now does, is
say what it knows:

```
"schema": {
  "couvre": "colonnes-conditionnelles",
  "attendues": 10, "sondees": 10, "verdict": "complet", "manquant": [],
  "connues": ["0001-destinataire-atteste.sql", "…", "0024-rotation-en-direct.sql"]
}
```

Read it this way, in this order:

1. **Is the migration you care about in `connues`?** If not, this card cannot speak about it, whatever
   `verdict` says. Upgrade the player, or check the database directly (below).
2. **Only then** does `verdict` answer for it. `manquant` names its files in the same strings as
   `connues`, so membership is a plain comparison and not an inference about our release history.

⚠️ **To check a migration this player does not know about, ask the database, not the card.** The
query does not depend on which version you are running, which is the only case where you need an
answer:

```sql
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_name = 'doc_presentations' and column_name = 'view_rotation';
```

The three `presence*` fields report what the host has **observed**, not what it is configured to do:

| field | meaning |
|---|---|
| `presenceJetons` | measured — the host actually signed a throwaway token, so `PLAYER_PRESENCE_SECRET` works |
| `presenceStrict` | **effective** — `PLAYER_PRESENCE_STRICT` is set *and* tokens can be issued. A closed door announced over an open one would be the worse failure |
| `presenceDurcissement` | `actif` (a hardened call came back), `degrade` (migration 0018 is missing), `inconnu` (nothing attempted in this process — **not** a green light, and process-local: another instance may have seen otherwise) |
| `presenceFusion` | `actif` (a heartbeat used the fused contract — one round trip instead of two), `degrade` (migration 0019 is missing: heartbeats cost 3 round trips instead of 2, nothing breaks), `inconnu` (no heartbeat served in this process). Same three states, same trap, same reading rule as the row above |

### `mesures` — what this instance has actually lived through

`lectureSaturee` (below) answers exactly one question. *Is a route slow? which ones? us or the
database? how many 5xx? is the event loop slipping?* had **no observable answer at all** — and
deciding to optimise without them is guessing. Both integrating hosts confirmed they cannot produce
these numbers from their side.

| key | meaning |
|---|---|
| `fenetreS` | seconds this process has been running — **the window every total below was counted over** |
| `seauxMs` | the bucket ladder the percentiles are read off, published **with** the numbers |
| `routes` | one entry per family of work — `document`, `presentation`, `action`, `fichier`, `carte`, `autre`. Families absent from the object were never exercised in this process |
| `base` | the same shape, for calls through the `db` capability **you** supply — measured at the seam, so it covers every call, including ones nobody has written yet |
| `statuts` | responses by class: `ok` (<400), `refus4xx`, `debit429`, `occupe503`, `erreur5xx` |
| `memoireMio` | `rss`, `heap` (heap used), `tampons` (`arrayBuffers`) in MiB, read at the moment of the request |
| `boucleMs` | event-loop **delay** — `moyen` and `p99` in ms, with `n` samples and the sampler's `resolutionMs` |

⚠️ **A percentile over buckets is a bound, not a value.** `p95sousMs: 250` reads *"95% of calls
under 250 ms"* — never *"the 95th is 250 ms"*. That is why the key is named `sousMs`, and why
`seauxMs` ships alongside: without the ladder you cannot judge how precise the number you are
reading is. `null` means *past the top of the ladder* (over 10 s), which is itself the answer.

⚠️ **`n: 0` is not `0 ms`.** A family that was never exercised reports `{ "n": 0 }` and nothing
else, and `boucleMs` with no samples reports `moyen: null` — not a zero that would read as *healthy*.

⚠️ **`boucleMs` is the delay, not the interval.** The sampler observes how long its own timer
actually took, which at rest equals its resolution; the resolution is subtracted, so an idle
instance reports about `0` rather than a permanent `20` that would send you hunting a fault that
does not exist.

⚠️ **No slug, no address, no text.** These are counters and durations. Nothing here names a visitor,
a document or a presentation — which is what makes it publishable on a card you read without
ceremony.

⚠️ **Process-local, and reset by every deployment**, exactly like `lectureSaturee` below. Behind a
load balancer this is the instance that answered, not your deployment. Aggregating is your job.

### `lectureSaturee` — what this instance actually refused

The read cache groups concurrent requests for the same presentation state and admits a bounded
number of them in flight. Past that ceiling it answers **`503` with `Retry-After: 1`** — a refusal,
not a failure, and deliberately distinguishable from a `500`. That ceiling has existed for a long
time; **nothing counted how often it was reached**, so the question *"do we actually saturate?"* had
no observable answer.

| key | meaning |
|---|---|
| `total` | refusals since this process started |
| `fenetreS` | how long this process has been running, in seconds — **the window `total` was counted over** |
| `derniereIlYaS` | seconds since the most recent refusal, or `null` if there has been none |

⚠️ **`total` and `fenetreS` only mean anything together.** `total: 0` does not say *we do not
saturate*; on a process that started four seconds ago it says *nobody has looked yet*. That is the
same trap as `inconnu` in the two rows above, and the reason the three keys are returned as one
object rather than as separate fields you could read apart.

⚠️ **It is process-local.** Behind a load balancer this is the count of the instance that answered,
not of your deployment. Aggregating is your job — and letting you believe otherwise would be worse
than returning nothing.

⚠️ **Before you upgrade, do not read `presenceDurcissement` or `presenceFusion`.** They are *reports
of execution*: on an instance where nothing is running they say `inconnu`, which means *nobody
looked* — not *the migration is there*. A pre-flight check built on one of them silently passes on
every idle host, and the missing migration is then discovered at the first presentation, i.e. at the
worst moment. Ask `GET /api/doc?contract=1&schema=1` and read **`schema.durcissementBase`** and
**`schema.fusionBase`** instead: they ask the database, so they answer a global fact.

⚠️ **And on a serverless host, `inconnu` is not the exception — it is the normal answer, forever.**
This paragraph used to say *"on an instance where nothing is running"*, which reads as a description
of an **idle** deployment. Field data from the second host corrected it: a real presentation ran on
their instance, with a participant, on the very day both fields read `inconnu`. Nothing was idle —
the presentation had simply ended, and the short-lived process answering `/api/doc` was never the one
that served a heartbeat. On a platform where each request may be a fresh process, that is the
**structural** case, not an edge case: a host serving presentations daily can read `inconnu` every
single time you ask.

So the two fields answer *"did this process, right now, see it work?"* — useful to confirm a fix on a
long-lived process, worthless as an inventory anywhere else. The durable signals live in `schema`:
`fusionBase` and `durcissementBase` for the migrations, and `schema.presence.avecJeton` crossed with
`presentationsActives` for actual traffic — those are read from the database and survive the process
that answers.

⚠️ **A corollary worth keeping:** *"our instances are idle"* and *"our instances are lightly used"*
are different claims, and only the second was true here. The distinction matters because a defect
that needs traffic to appear had real opportunities the whole time it was assumed to have none.

| `durcissementBase` | meaning |
|---|---|
| `applique` | migration 0018 is in the database — safe to run with the strict door closed |
| `absente` | 0018 is missing: apply it **before** setting `PLAYER_PRESENCE_STRICT`, or bootstraps will be refused with `503` |
| `indetermine` | the question could not be asked — neither a yes nor a no |

The same answer carries **`schema.fusionBase`**, for migration `0019`, with the same three values.
Both come from **one** call in the normal case: `0019` succeeds `0018` and its argument set *contains*
it, so a call the long contract accepts proves both at once. The short contract is only asked again
when the long one is missing — i.e. exactly on the host that is behind and owes a precise answer.

| `fusionBase` | meaning |
|---|---|
| `applique` | `0019` is in the database — a presence heartbeat costs **2**† database round trips (**20**† ops/s for 250 attendees) |
| `absente` | `0019` is missing: **nothing breaks**, a heartbeat costs **3**† round trips (**30**† ops/s for 250 attendees). Applying it needs no redeploy — the player picks it up within a minute |
| `indetermine` | the question could not be asked — neither a yes nor a no |

⚠️ Unlike `0018`, a missing `0019` is a **cost**, not a risk: read it when you are sizing an
instance, not when you are deciding whether it is safe to run. A host missing it is also logged once
an hour, with the exact figures, so an idle instance still finds out.

† **Recomputed from the code on every CI run** by `charge/coutParGeste.test.js`, which measures both
regimes — the fallback still lives in the code, so the *without-`0019`* figure is a measurement, not
a number remembered from an older release. The build fails when this document and the bench disagree.
⚠️ **A number without † in this repository's documentation is hand-written: it was true once, and
nothing has checked it since.**

The probe writes nothing, for **two independent reasons**: `p_page = null` on a slug that does not
exist leaves through `0019`'s *introuvable* branch before the insert, and `p_anon_cap = 0` already
left through the previous contract's *capped* branch. Two reasons rather than one, because a
diagnostic probe is the worst place to discover a regression. A real-Postgres test asserts that no
row appears. A host missing 0018 is also logged once an hour, so an idle instance still finds out.

That parameter **is** the one part of this card that needs the database, and only when you ask for
it. `verdict` is then one of:

| verdict | meaning |
|---|---|
| `non-sonde` | nothing asked yet — **not** *nothing missing*, and **process-local**: this process has looked at nothing; another instance may have looked at everything |
| `partiel` | some checked, none of them missing — the probe is **lazy**: a column is inspected only once something touches it, so this is *how much has been exercised*, never *how much exists* |
| `complet` | all checked, all present |
| `incomplet` | at least one is missing — `manquant` names the file and the sleeping feature |
| `indetermine` | the database did not answer; this measurement did not happen |

⚠️ **The first two rows are one trap, and it fires on every deploy.** Because the probe is lazy and
lives in the process, a fresh instance answers `non-sonde`, then `partiel`, then `complet` as
traffic exercises columns — on a database that never changed. Measured at an integrating host on
27/08, on one unchanged base: `sondees=9 complet` on the old instance, `sondees=0 non-sonde` right
after the deploy, `sondees=1 partiel` sixty-seven minutes later. They looked three times before
concluding, because a neighbouring field had already taught them to distrust that zero — and they
were about to report a regression that did not exist. Read these two verdicts as *what this
process has asked so far*, never as a statement about the schema.

Each `manquant` entry has **exactly this shape** — pin your parser to it, not to what a schema
probe "should" return:

```json
{ "migration": "0006-reactions-ordonnees.sql",
  "fonction": "empêcher deux réactions simultanées de s'écraser" }
```

⚠️ **`migration` is a FILE NAME, not a path — it lives in `supabase/migrations/` in this
repository.** It used to carry that prefix. A host's own guard refuses any identity card containing
`supabase|secret|key|token` — a deliberately coarse text sweep, protecting a public response against
leaking a project URL, a key or a token — and the prefix made it fire on every migration named. The
prefix is gone from what the card publishes; the directory is stated here, once, and the operator
log still prints the full path because that message is for the person reading it, not for a sweep.

⚠️ **You do not need an exception in such a guard, and you should not add one.** Nothing this card
publishes matches that pattern, and a bench renders the real card and sweeps it — keys included —
on every change. If you carry an exception for the old prefix, remove it: an exception whose subject
can no longer appear is a pre-authorised widening nobody watches. A second bench sweeps the
migration directory itself, so a future file named `0031-refresh-token-rotation.sql` is refused
here, when it is written, rather than months later at your end.

⚠️ This shape went **undocumented** for two releases, and the second host typed it from memory as
`{table, colonne, migration}` — their monitoring filter then discarded every real entry and would
have shown an empty table on a database that was actually missing something. **No mutation on
their side could catch it: their test built the card the same wrong way, so the bench validated
the assumption instead of the behaviour.** The only cure was reading data they had not fabricated.
If you consume this card, test your parser against the JSON above, not against a fixture you wrote.

⚠️ **A card without a `schema` field is an alert, not a success**: it signals an instance older
than 0.1.58 — a version that cannot answer the question. (Rule contributed by the second host, for
exactly the monitoring case where "no data" would otherwise read as "all clear".)

⚠️ **`incomplet` wins over `partiel`**: a missing column is a positive fact and settles the verdict
on its own, even when the rest has not been checked.

⚠️ **`retentionSweep`** says whether the automatic retention purge is *armed*
(`config.retention.balayage === true`). The `retention` capability only says the instance *can*
purge; this boolean says whether it *does*, on its own, once a day. Default `false` — nothing is
deleted unless an operator wrote the policy. A cockpit can read this to know if an instance is
subject to automatic deletion, instead of inferring it from a log.

⚠️ **`internalStrict: false` means internal identity comes from the browser.** In transitional
mode the internal-analytics route accepts `docId`, `email` and `name` as the client declares them —
a caller can fabricate "this colleague read this document". Strict mode (`PLAYER_INTERNAL_STRICT=1`)
only accepts host-signed tokens. The flag exists so monitoring can **refuse** a non-strict instance
instead of discovering it in a log; treat `false` as an alert on any instance whose host already
issues internal tokens. The default will flip to strict at the next announced breaking change.

⚠️ **`couvre` states the scope, because `complet` without a scope overpromises.** The card checks
the **conditional columns** — the ones a feature probes before writing. The rate-limit migrations
(`0003`, `0004`) are deliberately **not** in it: a host may provide its own `limits` capability, and
on such a host their absence is normal, not a defect. `complet` therefore never means *every file
under `supabase/` has been applied* — read it as *every column this code conditions its writes on
is present*.

⚠️ **`indetermine` is not a failure of the card.** A control column — the primary key of the oldest
table — is queried first. If *it* does not answer, nothing is missing: the database is. Without that
control, an unreachable database would make all three probes fail and the card would announce three
missing migrations **that exist**, sending you to apply what you already have. In that state nothing
is cached either, so a passing outage does not switch features off for the life of the process.

⚠️ **`frameAncestors` matters more than it looks.** A host that is not listed will never see the
viewer: the browser blocks the iframe **before any script runs**, so no message can be emitted and
the host sees a silence indistinguishable from an unreachable instance. Check that your domain is
there before you open a document.

## Counting the reads of a visitor you vouch for

A host that identifies its own visitors — one-time code, project area — can have their reads counted,
attributed and revocable, without either an anonymous link or a member's token. Pass
`recipientEmail` on the server-to-server `docshare.create`: **the host vouches, the player stops
believing the caller.**

⚠️ **The address must never come from a browser request.** Read it server-side, from the visitor's
session, at the same place that already decides whether they may see the document. A path that
cannot phrase the request will never phrase it by accident.

⚠️ **An attested link is named, not closed.** It remains forwardable: the reader is attributed, not
verified. A host whose documents are confidential must not rely on it — that closes with an attested
*reader*, which does not exist yet.

The address is stored apart from `recipient_email`, and that separation is the whole point:
`recipient_email` says *who may send in the link's name* when a recipient forwards it, and a vouched
visitor never gained that right. Leaving it empty is what makes the send guard and the re-share
inheritance both refuse — without either of them knowing why.

Requires `supabase/migrations/0001-destinataire-atteste.sql`. Until it is applied the player refuses
the attested creation and names the file; it never falls back to the other column.

## ⚠️ What `limits.allow` promises changed

It used to promise *best effort, per process*. The standalone context now counts in a **shared
table**, so a limit means what it says for the **instance** rather than for one execution.

This matters because nothing announced the difference: on serverless, several executions serve in
parallel and start cold, so a limit of 120/hour allowed 120 **per instance**. It existed, it
reassured, and it bounded a fraction of what it claimed.

Requires `supabase/migrations/0003-limites-partagees.sql` **and**
`0004-limites-atomiques.sql`. **Until they are applied, nothing breaks**: counting falls back —
to memory without the first, to a non-atomic read-modify-write without the second — and the host is
told once, by name.

⚠️ **The second one is what makes the counter hold under load.** Reading, computing and writing as
three steps means that several simultaneous requests read the same count and each write "that count
plus one" — so they cross the ceiling together, precisely when a limit is supposed to matter. The
atomic increment is **not expressible in REST** (`on conflict do update set count = count + 1` has
to name the column on both sides), which is why this one operation, and only this one, goes through
a database function.

Two deliberate exceptions, both written next to the code:

- **The local counter stays in front, as a fast refusal.** It only ever sees what one process served,
  so it under-counts: if *it* is already over the ceiling, the shared one is too. A local refusal is
  therefore always right, and costs no round trip. Abuse is refused for free; legitimate traffic pays.
- **The public read path (`pread:`) is counted locally only.** Those responses already come from a
  per-slug memory cache, put there precisely so they cost the database nothing. Backing their guard
  with a shared counter would make the guard pay the price we had just spared the thing it guards.
  On that path the real protection is the cache, not the counter.

⚠️ **The shared count is not atomic.** PostgREST cannot express "increment": it is a read then a
write. Two instances can read the same value and write one. The counter therefore **under**-estimates
under heavy concurrency — it lets a little more through, never refuses wrongly. Said plainly rather
than implying a precision we do not have.

## The three things a host implements

Everything the player borrows arrives through one injected object. Two of its entries carry
decisions the player deliberately refuses to make, and both can be answered over HTTP — most hosts
therefore write **no wiring code at all**, only environment variables.

### 1. Who may manage tracked links

```
POST  →  { "email": "…", "role": "…", "action": "<one of the names below>" }
      ←  { "allowed": true }
```

| action | what it grants |
|---|---|
| `create` | create a tracked link |
| `list` | list one's own links |
| `list.all` | list everyone's links **and everyone's reading sessions** |
| `revoke` | revoke a link |
| `setauth` | change a link's access wall |
| `overview` | read a document's aggregate figures |
| `sessions` | read individual reading sessions — of one document, or of one recipient across all of them |
| `test` | create a rehearsal link |
| `presentations.list.all` | list presentations **one does not own** (slugs, presenter names, counts) |
| `presentations.stats` | read the **attendees** of a presentation one does not own — names, addresses, dwell time, pages |

⚠️ **This list grows, and a closed table refuses what it has not heard of.** Both
`presentations.*` names arrived in `0.1.46`; a host whose table predates them answers *no* to
everyone, administrators included — not because the right is missing, but because the table is older
than the player. That failure reads exactly like a permission problem, which is what makes it
expensive. **Compare this table against your own at each upgrade**, and prefer a refusal that names
the unknown action over one that looks like a role issue.

⚠️ **`list.all` widens `sessions` as well from `0.1.147`, and until it nothing did.** `docshare.list`
has always asked you two questions — *may they list?* then *may they list everything?* — and
narrowed to the caller's own links when the second answer was no. `docshare.sessions` asked only the
first, and returned every session of the document: the reading sessions table carries the
recipient's **address and IP**, so any member allowed to call it read the prospects of their
colleagues. A strict door with a wide door beside it protects nothing.

`sessions` now asks the same second question, and answers with a `scope` field (`"mine"` or
`"all"`) exactly as `list` does — and so does `docshare.sessionsByRecipient`, which reads one
person's sessions across every document and is therefore the call where the scope matters most. **What changes for you:** a member to whom you answer *no* on
`list.all` now sees only the sessions of links whose chain starts with a link they created —
forwarded re-shares of their own links included, because they caused those readings. Nothing
changes for a role you already answer *yes* to. If your table predates `list.all`, see the warning
above: an unheard-of action answered *no* narrows this view rather than breaking it.

⚠️ **`?contract=1&schema=1` now tells you what is still stored, not only what you may purge.**
`retentionSweep` says the instance *can* purge; it says nothing about what has piled up. The card
gains a `purge` block counting the rows that still carry a reader IP or a raw User-Agent:

    "purge": { "borne": 5000, "tronque": false, "lignes": { "sessions": 1908, "vues": 3200 },
               "sessionsIp": 0, "sessionsUa": 0, "vuesUa": 0, "vide": true }

`vide` is the reading that matters: `true` means nothing of that legacy is left **on this
instance's live rows** — the condition under which those columns can eventually be dropped —
`false` means rows remain, and **`null` means at least one probe did not answer**. A count is
`null` for the same reason: a failed probe must never read as a zero, because zero is the answer
that authorises a deletion.

`lignes` is what the counter **looked at**, per table. A bare `0` cannot tell "purged" from "never
written" from "the probe is aimed wrong"; the denominator separates them — *0 of 1908* means there
was something to look at, *0 of 0* means the table is empty or out of reach and the zero proves
nothing. It is `null` on the same terms as the counts.

The counts are **bounded** at `borne` rows and read one small column. ⚠️ **`tronque` says whether
anything was cut off**: when it is `true`, every number in the block is a *lower bound*, not a
count. Without it a saturated `5000` would be indistinguishable from an exact five thousand — a
wrong number that reads as right, which is worse than an absent one, because an absence makes you
look and a number makes you conclude. `vide` stays correct either way: saturation can only make it
`false`, never wrongly `true`.

⚠️ **And `tronque` does not assume our bound is the only ceiling** — it did, for one release, and a
host measured what that cost. PostgREST has a ceiling of its own, `db-max-rows`, set to **1000** by
default on Supabase: the server returns 1000 rows however many you ask for. Comparing the received
length against `borne` then compares against the wrong number, and a table of 1651 rows was
published as `1000` **with `tronque: false`** — asserting an exactness it did not have.

So the question asked is not *did I hit my bound* but **is there anything after what I received**:
one row is requested past the last one received, by keyset cursor (`col=gt.<last>`, never by
offset — a cursor is stable under concurrent writes, and it is this repository's pagination rule). A row returned proves more remain; none proves the lot was
the whole — whichever ceiling produced it, without having to know it. **What this does not cover,
stated rather than glossed:** a server ceiling of *zero* stays indistinguishable from an empty table
by the response body alone. Reading the count from `Content-Range` under `Prefer: count=exact` has
no ceiling to guess and transports nothing; it is strictly better, and it needs the `db` capability
to expose response headers, which today it does not.

⚠️ **The two alternatives were measured at a host, not assumed here** — recorded so nobody proposes
them again in six months believing they were never tried. **`?select=count()` is dead**:
`db-aggregates-enabled` is `false` by default, verified on two distinct Supabase projects, and the
measurement is solid for a reason worth stating — the `PGRST123` error arrives *before* the
permission check, where the same table queried without an aggregate answers `42501 permission
denied`. The answer therefore depends on neither grants nor any `revoke`: it is a property of the
**configuration**, not of authorization. That was the route we would have preferred, since it bound
no one to a contract. **`Prefer: count=exact` with `Range: 0-0` works**: the exact count travels in
the header and the body carries nothing. It is the only one of the two that exists, and its only
obstacle is this contract.

⚠️ **And the same ceiling applies to every read you make through your own client, not just to
ours.** `limit=20000` does not return twenty thousand rows: PostgREST caps the response at
`db-max-rows` — **1000** on a default Supabase project — and says so nowhere in the body. A read
that asks for more than that ceiling is not a large read, it is a **false belief**, and it stays
invisible while your tables are small. So the question is worth asking of your own code as well as
of ours: *does my client paginate, or do I believe that `limit=20000` returns 20 000 rows?*

One host asked it of itself the day it found this in our counter, and the answer was not
hypothetical: a statistics read ordered `created_at.asc` with no `limit` was seeing the **1000
oldest** rows of 6424, so a "last opened" date read months stale for a link opened the day before,
and every breakdown described the beginning of the history. They also count **32** reads asking for
more than the ceiling — all latent on their volumes today, all live on an older installation.

⚠️ **The sort direction decides how bad it gets.** A read that saturates while ordered `desc` loses
the oldest rows; ordered `asc` it loses the newest — that is, the ones anyone is looking at. Same
ceiling, same silence, opposite severity. Counting is indifferent to it, but anything that reads
*content* under a ceiling should prefer `desc`.

They run only under `&schema=1`, the mode where you have asked for the database.

⚠️ **The purge attestation is a commitment, not a convenience.** Every column this player empties
carries a `comment on column` whose text **begins with the exact marker**:

    VIDE ET PLUS JAMAIS ECRITE depuis la <migration number>.

Read it through `col_description()`. It is what *proves* a purge was applied — a count of zero does
not, since it cannot tell "purged" from "never written". **We commit to two things**: to post it on
every column a future migration empties, and not to reword that prefix. It is deliberately plain
ASCII, without accent or apostrophe, so it survives encodings and needs no escaping.

This used to be a convenience, designed for a person proving a purge. A host told us its inventory
now reads it **mechanically**, crossing it with the residual counts to raise an alarm when values
reappear beside an attestation. That is the moment an artefact becomes an interface — and the reason
to commit is the failure mode: if we quietly stopped posting it, that alarm would go **silent
without saying so**, a failure caused here and invisible there. A guard in this repository refuses
any migration that empties a column without the marker, so undoing the commitment turns something
red rather than turning something quiet.

⚠️ **Why this exists at all:** our tables live in *your* database, and your audit enumerates *your*
tables — a dependency's schema occupies a zone nobody's inventory visits. Two integrating hosts
found 2361 rows still carrying these columns, and they found them because a third party asked a
question about its own database, not because anything told them.

⚠️ **The reader IP is erased, and a direct query of your own will start seeing nothing.** The
sessions table carried `ip` in the clear. `0.1.147` stops serving it — no player path reads it back,
so nothing in this contract changes — stops writing it, and ships migration **0026**, which erases
what thirteen months of journal still hold. ⚠️ **This lands in `0.1.147` and not before**: on `0.1.145`
and earlier the column is still written and still served. `npm view discovery-media-player version`
tells you which one you are about to install. **What changes for you:** nothing, unless you
read that column yourself in a report or dashboard outside the player, in which case its values are
empty from the day you apply 0026. The column itself stays for now: dropping it would fail every
session write of a host that applies migrations before deploying, so its removal is a later release.
[`docs/RETENTION.md`](RETENTION.md) sets out what the migration erases, why emptying — not
dropping — is what actually removes the bytes, and what it cannot reach: your backups. The raw `ua`
is erased too, on this table and on `commercial_doc_views`, by migration **0027** and for the same
reason: `device`, `os` and `browser` are derived from it at write time and are what a reading record
carries, so the raw string had no reader left. On the views table it had none at all — that table has
no derived columns.

⚠️ **`presentations.list.all` and `presentations.stats` are deliberately separate.** Seeing *that* a
presentation happened and seeing *who attended it* are different sensitivities: the first returns
metadata, the second returns people — often prospects. Merging them would take from you the choice of
opening one to the whole team while reserving the other.

Neither is needed to read one's **own** presentations: an owner, and an administrator, are always
served without the player asking you anything.

- **The player verifies the token; you decide the rights.** No answer, or a failing rule, means
  refusal. A right that cannot be granted is not granted.
- **`email` is the authoritative identity.** `role` is what the session token carried; a host whose
  roles live in its own database ignores it and looks them up. That is expected.
- **Only `allowed` is read, and it must be a boolean.** Any other shape means refused.
- The token is already verified before the call: your route does not receive it and must not
  re-verify it.

⚠️ **Verified against whom?** The player's database and your identity provider are two different
things. They are the same project while the player and your application share a deployment — and
different by construction once the instance is separate. Point `PLAYER_AUTH_URL` at the project
that issues your members' tokens (with its own publishable key in `PLAYER_AUTH_KEY`), or every
member action is refused in a way that reads like a missing permission. Unset, it falls back to
the player's own project, so a shared deployment changes by not one character.

Two signals, and you need both: **`host-auth` in `capabilities`** says this instance *can* target
a separate issuer; **`separateIssuer: true`** says one *is configured*. A version that supports
the split with the variable left unset fails exactly like the version before it — members come
back unauthenticated, which reads like a missing permission — and you would conclude the upgrade
changed nothing. The card answers with a boolean and never the issuer itself: you already know
which one is yours.

### 2. What a client's brand is

```
POST  →  { "key": "…" }
      ←  { "logo": "https://…", "name": "…", "dark": false }    or {} / null when unknown
```

The link carries a **reference**, never a copy of the logo: a tracked link lives for weeks in an
inbox, and a logo frozen at send time would not follow a corrected brand. `name` is not decorative
— it is what shows when the logo fails to load.

### 3. Serving a file the player cannot reach

If your documents sit behind an API key, the player must **never** hold it. Expose one route
(`PLAYER_HOST_FETCH_BASE`), fetch the file yourself, and the player is allowed to call only that.
Four requirements, in order of what they cost when missed:

1. **Never relay the upstream `Content-Length`.** `fetch()` decompresses the body and keeps the
   upstream headers; relaying the announced size serves a **truncated PDF**, with no error
   anywhere. Announce the length of what you send, request `Accept-Encoding: identity`, and refuse
   a compressed `206` — range bounds refer to compressed bytes.
2. **Relay `Range`** (`206` + `Accept-Ranges: bytes`). Progressive loading depends on it.
3. **Accept a server-to-server call.** A tracked link is opened by someone with no session on your
   side. Authenticate the player with the shared secret in the `x-player-fetch-secret` **header** —
   header only, never a query string: logs keep URLs.
4. ⚠️ **Never sign a path supplied by the client.** The first three are about transport; this one
   is about what you transport, and it is the only one whose omission does not degrade the
   experience but **opens your data**.

   Your route serves with *your* credentials — the player has no session to present, by design.
   An action that signs a client-supplied path becomes an oracle: a user signs a path their own
   rights would refuse, and the player reads it back with yours. The anti-SSRF guard sees nothing:
   the origin is legitimate, it is yours.

   The shape that holds: the caller supplies a **source from a closed set and a row identifier,
   never a path**. You re-read the path with the caller's session and your own row-level rules
   decide. **Corollary:** when the reference itself carries a capability, signing is not enough —
   it must be encrypted. *Signed* means nobody can forge it; it has never meant nobody can read it.

## The postMessage bridge

Described once in [`src/bridge.ts`](https://github.com/Juli1artha/discovery-media-player/blob/main/src/bridge.ts) and published as `discovery-media-player/bridge`
— **compiled JavaScript with type declarations, under MIT** rather than the core's AGPL, so that
importing it is not a toll. Import it rather than copying constants: a message name retyped by hand
is a contract in two copies, and the day it changes only one of them knows.

**player → host:** `close` · `share` · `embed-ready` · `embed-denied {reason}` · `present-left` ·
`present-denied` · `present-invite {slug}` · `present-handover {slug}` · `present-switch {slug}`

**host → player:** `handover-done`

### Refusals

A host waiting for `embed-ready` is tempted to treat silence as a timeout and fall back to the
browser's own viewer. **That is a security hole**: silence covers two opposite cases — the player is
absent, or the player *refuses*. Falling back in the second case opens the document the player just
closed.

| `reason` | What happened | Host behaviour |
|---|---|---|
| `revoked` | unknown or revoked link | do not open |
| `auth-required` | restricted document, visitor not signed in | do not open — the wall stays up |
| `auth-unavailable` | restricted document, access wall missing from this instance | do not open |
| `ended` | presentation over or unknown | do not open |
| `url-not-allowed` | the file URL is not covered by the guard | **open**, and report the configuration |

The rule underneath, safer than the list: **never fall back on a refusal of *access*; you may fall
back on an inability to *reach*.** And "do not fall back" applies to what you **offer** — an
"Open ↗" button left in place is falling back one second later.

## Four things that will bite

**Your document-opening doors reappear.** A host has more than one place that opens a file, and new
ones get written. Keep the list and hunt it periodically — and note that **your search criteria
decide what you find**: search by what the user *obtains* (a document opens), not by the technique
you expect to see.

**A row written on behalf of a session also carries the document.** The player hands every bot
plugin call both the `sessionId` and the `share`. If your plugin stores only the session, then the
day a session-binding defect is found — one was in 0.1.131, and four more actions in 0.1.133 — you
cannot say whether anything crossed. The honest answer is not *"nothing found"*, it is **"not
measurable"**, and those are different sentences to give a client.

Measured on a production host the day the second defect was fixed:

| table | what it records beside the session | verdict |
| --- | --- | --- |
| leads (`bot-contact`, `bot-book`) | the share **and** the document | 46 leads, 21 carrying contact details — **none crossed** |
| messages (`bot-say`) | the session alone | 1 693 messages — **not measurable** |

Same incident, same instance, two verdicts — decided months earlier by one column. It costs nothing
at write time, and it decides what you are able to say afterwards.

⚠️ **The expectation is answerability, not a column name** — and this paragraph earned that sentence
the hard way, one day after it was written. The same host then swept all eight of their tables
carrying a session: seven already recorded the document, under four different names (`doc_id`,
`share_slug`, `link_id`, `xp_id`). **One** did not. The discipline was everywhere and written
nowhere, which is exactly why it gave way at the single place nobody thought about.

Their first sweep looked for the two names this page happens to use, and would have accused three
correct tables. So when you check your own schema, write the check from **what your code stores**,
not from a list of column names borrowed from someone else's — a coarse check has no false
positives to excuse, it has a pattern to derive. The question each row must be able to answer is
*which document was this written for*; the key that answers it is yours to name.

**Your `bot` plugin owns the assistant's behaviour — all of it.** The player ships the assistant's
markup and wires **none** of its sixty-four controls: no browser bundle, no inline script. That has
been true since the first commit, and until 26/08 it was undocumented while `docs/CONFIGURATION.md`
claimed the opposite. Two consequences you must act on:

- **Declare `wiresVoice: true`** on the object you pass as `ctx.plugins.bot` if you wire the voice
  controls. Without it — or with a merely truthy value rather than exactly `true` — the three voice
  buttons and the audio-consent step are not rendered at all. `ELEVENLABS_API_KEY` alone no longer
  shows them: the key proves the *server* can synthesise, never that a click leads anywhere, and a
  button that leads to silence is a broken promise made in your name.
- **`bot-tts` now requires a `sessionId`**, bound to the requested `slug`, and the text must match
  something the assistant said in that session. The player reads `listMessages(sessionId)` and
  treats a message as the assistant's when its `role` is `bot`, `assistant` or `ai`, taking the text
  from `text` or `content`. **Anything it cannot read counts as "not said"** — an unrecognised shape
  yields an empty set and every request is refused. On the one route that spends money, *"I could
  not verify"* must read as **no**, never as *go ahead*.

⚠️ **The player does not delegate that check to your plugin**, for the reason already stated above
about session binding: a security property of the player cannot depend on code the player does not
contain. It reads the messages and decides itself.

The message text is read from `text`, `content` or `body`, first non-empty wins. `body` is there
because a host said so **before** hitting it: its messages carry `body` and nothing else, its `role`
was a correct `bot`, and the reader would have returned an empty string for every message — an empty
set, so every request refused, on a perfectly correct integration. If your field is none of those
three, tell us and we widen the list. The field name carries no security; the **role** filter does.

**If you write to the `tts-cache` bucket yourself, write the trace too.** Retention removes an object
only when its fingerprint has a row in `doc_tts_objects`, and only the player's own route writes that
row. Anything your code puts in that bucket is therefore invisible to the sweep — **permanently**,
not just for the objects already there.

This is not hypothetical: an integrating host reported 908 objects it had written itself, under
**exactly** the player's naming — same digest, same two files, same bucket root. Its own comment says
the parity was deliberate, so that one clip serves both surfaces. Nothing about the name distinguishes
its objects from the player's; only the missing row does.

So `doc_tts_objects` is a **host write point**, not an internal table. What the sweep needs from
you is **one property, and only this one**:

> the `hash` you write in the row **is** the object's base name — the file is `<hash>.mp3`, its
> alignment is `<hash>.json`, and nothing else has to be true.

⚠️ **How you compute that digest is yours, and this page used to say otherwise.** It read *"write
it with the same fingerprint the player computes, and nothing else"*, which made a perfectly safe
host non-compliant on paper — and the obvious fix, realigning the formula, is the one thing that
would break: the objects already in the bucket carry the **old** digest in their names, so a row
written with a new one points at nothing, and the real name loses its only row. Reported on 27/08
by a host whose third writer uses `preview-fr-v2` where the player uses `v2`. Their five write
sites are correct as they stand.

The sweep never recomputes anything: it reads `hash` from the row and removes `hash + ".mp3"` and
`hash + ".json"` (`server/retention.js`). A bench holds that property rather than a comment —
`retentionCacheDeVoix.test.js` builds its rows with `hash: "aaa"`, which is the sha256 of nothing,
and requires `tts-cache/aaa.mp3` to be the file removed.

**The player's own formula matters for one thing only, and it is not retention** — sharing. Its
route recomputes this digest to find a clip it already paid for, so match it *if* you want one clip
to serve both surfaces (as one host deliberately does, for 908 objects). If you don't, the player
simply synthesises its own, and nothing else changes:

```
hash = sha256(voiceId + "|" + modelId + "|v2|" + spokenText)   -- hex, lowercase
```

| requirement | mandatory? | if you don't |
|---|---|---|
| the row's `hash` is the object's base name | **yes, always** | the object is invisible to the sweep, permanently |
| the digest matches the player's formula | no — only to share a clip | the player synthesises its own, and pays for it |

```sql
insert into public.doc_tts_objects (hash) values ($1)
on conflict (hash) do nothing;
```

⚠️ **Never write the text**, in any column. The table holds a fingerprint and a date on purpose: the
bucket may already hold personal data, and writing the text would recreate it in the database — this
time queryable. `hash` is the primary key, so the insert is idempotent; a clip regenerated under a new
voice yields a new fingerprint and a new row, which is correct.

RLS is on with **no policy**, so nothing reaches it except a role that bypasses RLS — the
`service_role` key the `db` capability already uses. No grant, no schema change, no new migration:
apply `0021` and write.

Objects written before you start writing the trace stay untraceable for good. The sweep counts rows,
so it can say *"no trace outside the window survives"* — never *"the bucket is clean"*.

**A database error carries its status as a number, not inside its message.** Set `statusCode` (or
`status`) on whatever `db.request` throws. Both contexts shipped here already do; a host that
implements the seam itself may not, and the player then has to guess from the text.

Guessing was the state until 24/08, at six call sites: `message.includes("409")` — the digits
anywhere in the string. But the message carries the **path**, so it carries the slug, the id, the
page number. Measured on the real shapes:

```
Supabase POST  /doc_presentation_attendees                  → 409   conflict   ✅
Supabase POST  /doc_presentation_attendees?slug=eq.demo409  → 500   conflict   ❌
Supabase PATCH /doc_bot_sessions?id=eq.sess-409abc          → 500   conflict   ❌
Supabase GET   /doc_pages?page=eq.409                       → 503   conflict   ❌
```

Three in four. And every site reads `if (!conflict) throw`, so a genuine 500 was **swallowed** and
the code carried on as though the row already existed. One document whose slug contains `409` —
a reference number, a date — was enough.

The fallback that remains accepts `409` only **after the arrow**, where a status lives and a slug
cannot. Setting the number spares you that reasoning entirely.

**Configured is not served.** When a diagnosis is disputed, the useful question is not who is right
but *did you measure exactly what fails*. Two true statements about the same instance can describe
different responses.

## Versioning

Semantic versioning on the package, independent of the `contract` number. Pin an **exact** version:
the player and its hosts deploy separately, and a range brings in a version nobody decided to
deploy, on a day someone ran `npm install` for another reason.
