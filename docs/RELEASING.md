# Releasing

How a version leaves this repository, and at what pace.

This document does not replace the release machinery — [`release.yml`](../.github/workflows/release.yml)
and its guards stay exactly as they are, each one written after an incident. What was missing is
the part no workflow can enforce: **deciding when to publish**, and checking the commit *before*
the tag rather than after.

## The pace

**One train per day at most**, while the project stabilises. Weekly once the flow allows it.

Between 13 and 21 August 2026 this repository published **113 releases in eight days** — a stable
version per merged fix. Nothing was broken by it, and it is still the wrong signal: an evaluator
reading the releases page sees churn, not care, and nobody can tell an ordinary fix from the one
that matters. A train groups what is ready; the fixes land on `main` at their own pace, as always.

**Three exceptions, and only these:**

- a **security** fix — it leaves as soon as it is green, alone if necessary;
- a **broken package** on the registry — the same, because every install is affected until it is
  replaced. (0.1.25 is the precedent: an inline script that did not parse, live layer dead.)
- a **release-pipeline repair** — when the previous train's own publication left its artefacts
  missing or wrong (Release, attestation, SBOM), the repair may leave the same day. It changes
  nothing at runtime and its notes say so. *(Added 2026-08-25, the day 0.1.135 and 0.1.136 shipped
  together: 0.1.136 repaired the release tooling after 0.1.135's run died mid-publication. The rule
  said two exceptions; the practice used a third; an external audit read both and asked which one
  was lying. This is the honest reconciliation — the exception was real, so now it is written.)*

Everything else waits for the next train. A fix merged on `main` is already available to anyone
building from source, and no host deploys from the registry within the hour.

## Who decides

The maintainer. There is one, and pretending otherwise would create a ceremony nobody performs.
The decision is: *what is in this train, and is it worth one*. An empty train is not published.

## Freezing the candidate

A release names a **commit**, not a branch. `main` moves — three times on 21 August a version was
cut while `main` advanced underneath.

```bash
git fetch origin main && git checkout origin/main
git rev-parse HEAD          # write this SHA down; it is the artefact
```

Everything below applies to that SHA. If `main` moves while you are checking, you are checking
something you are not about to publish: start again.

## Replaying a release, and what it costs

`workflow_dispatch` replays a tag whose first run failed — npm is skipped when the version is
already published, and everything else is redone. It exists because three releases were lost that
way (0.1.67 → 0.1.69).

⚠️ **Dispatch it on the tag, not on a branch.** An attestation records the commit of the ref the run
was dispatched from, *not* the tag it rebuilds. Replaying 0.1.136 from `main` produced an
attestation naming `4efb5a0b` while the archive was built from `d0bfe3d8` — 32 of the 59 tracked
published files differ between the two. The bytes and the signature are sound; the source → artefact
link is not, and a rebuild from the attested commit fails in a way nobody can distinguish from
tampering.

⚠️ **And dispatching on the tag only works if the tag's workflow is sound** — the dispatch runs the
workflow file *at that ref*. A tag whose workflow is what broke the release cannot be replayed
coherently: choose then between a divergent provenance, stated, and cutting the next version
instead. There is no third option, and pretending otherwise is how the divergence goes unwritten.

Either way the Release says which it is: when the dispatch ref is not the tag, the body carries
both commits and warns that a rebuild from the attested one will not match.

## Before the tag

```bash
node tools/release-preflight.mjs
```

Read-only — it creates nothing, pushes nothing. It refuses when:

- the working tree is dirty (an uncommitted file will not be in the tag, but may have made your
  checks pass);
- `HEAD` is not `origin/main`;
- `package.json` and the newest `CHANGELOG.md` section disagree — *this is the 0.1.121 failure: the
  tag was placed on a commit whose package still declared the previous version*;
- the version has **no changelog section**, or an empty one — the GitHub Release publishes that
  section, so writing it is part of the release, not documentation for afterwards;
- a comparison link is missing or wrong;
- an example pins something other than one of the last two **published** versions — in
  particular the one you are about to publish, which npm does not serve yet and which would
  break the demo deployment;
- the tag already exists, locally or on `origin`.

⚠️ **A "not verified" is never a pass.** Without `gh`, the tool cannot see the forge, so it reports
the CI check as *not verified* and prints the command to run — it does not report green for
something it did not look at. That is the same rule the product's silent guards follow since
0.1.35: an abnormal state nobody states becomes the normal state.

Then, and only then:

```bash
git tag -a v<version> -m "<version>" && git push origin v<version>
```

## After the tag

The [Release workflow](../.github/workflows/release.yml) takes over. It runs as **five jobs whose
permissions are deliberately disjoint** — so if one fails, its name already tells you where you
are:

| job | what it does | what it may do |
| --- | --- | --- |
| `verifier` | checks the tagged commit **belongs to `main`**, demands its CI be entirely green (0.1.68 was published on red), runs the tests again, checks the tag matches `package.json`, extracts the changelog section | read only |
| `publier` | `npm publish --provenance` — nothing else | mint the npm identity (OIDC) |
| `eprouver` | installs the **published** package from the registry, renders a page, compiles every inline script (0.1.25 was published and broken); summarises what actually changed in the tarball | read only |
| `attester` | packs the tarball, **confronts it with what the registry actually serves**, and produces a SLSA provenance for that exact file | mint an OIDC identity, write attestations |
| `annoncer` | creates the GitHub Release from the notes `verifier` extracted, and attaches the tarball, its digest and its provenance | write to the repo |

The split is not cosmetic: `eprouver` executes code downloaded from the registry, and it is the
job with the fewest rights. Before it existed, those same lines ran with both `contents: write`
and `id-token: write`.

⚠️ **A green CI does not mean the commit is in `main`.** An open PR branch has exactly that: green
CI, unmerged. Nothing stopped you from tagging one by mistake and publishing it — an artefact
carrying the project's name, holding code nobody approved, and which tag protection then makes
awkward to withdraw. `verifier` now refuses a commit that is not an ancestor of `origin/main`.
Replaying an old release by dispatch still works: a legitimate tag *is* an ancestor.

⚠️ **The Release now carries a verifiable artefact.** npm provenance has been in place for a long
time and it is excellent — but it is only visible *from npm*. Someone arriving at the Releases page,
or through the container image, had nothing: the source archives GitHub attaches automatically are
neither the published artefact nor signed. They were left with trust, which is what this repository
refuses everywhere else.

What is attached is **not a second, unconfronted copy**. `npm pack` is reproducible, so the tarball
is rebuilt and its `sha512` compared to the registry's own `dist.integrity`; if they differ, the
release fails rather than publish two artefacts of the same name whose bytes disagree.

```bash
gh attestation verify discovery-media-player-<version>.tgz --repo Juli1artha/discovery-media-player
```

The container image is **not** built here — [`image.yml`](../.github/workflows/image.yml) builds it
from the same tag, in parallel, off the critical path of the npm publication.

**Check that it finished.** Three releases in a row (0.1.67 → 0.1.69) published to npm and then
failed on the notes: GitHub Release, image, SBOM and provenance skipped, three times, without
anyone noticing — the person publishing was watching `npm view`, one artefact out of five.

```bash
npm view discovery-media-player version            # the registry serves it
gh release view v<version>                         # the release exists, with its notes
docker manifest inspect ghcr.io/juli1artha/discovery-media-player:<version>
```

An hourly guard ([`publication.yml`](../.github/workflows/publication.yml)) opens an issue when
`main` declares a version the registry does not serve for more than an hour, and closes it by
itself when the registry catches up. It is a safety net, not the check: it fires **after** the
window in which someone was still watching.

## When a tag points at the wrong commit

It happened on 0.1.121. The Release and Image guards refused, which is what they are for.

1. **Do not** move the tag on a version already served by the registry. A tag that names two
   different trees over time makes every provenance attestation a lie.
2. If **npm already served it**: the version is spent. Publish the fix as the next version, and say
   in its changelog section what the previous one was. **This is the path to prefer** — it costs a
   version number and nothing else.
3. If **nothing was published** under that tag and you want the number back, the tag has to go.
   `git push origin :v<version>` **will be refused**: the ruleset protects `v*` tags against
   deletion, which is the point — a tag is the name of an artefact, and names that can vanish are
   not names. Removing one is an administrative act, deliberately:

   1. GitHub → *Settings* → *Rules* → the ruleset covering `refs/tags/v*` → disable it (or add
      yourself to the bypass list);
   2. `git push origin :v<version>` and `git tag -d v<version>` locally;
   3. **re-enable the rule immediately** — a protection left off is a protection nobody will
      remember to switch back on;
   4. fix the commit, run the preflight, tag again.

⚠️ **This document used to say "delete it" as if it were a one-liner** — advice the repository's
own ruleset refuses, so the first person to follow it would have hit a wall with no explanation
(P2, audit of 22/08). A procedure that cannot be carried out is worse than no procedure: it costs
the reader their confidence in the rest of the page.

## What a release does not do

- **It does not bump the version as a side effect.** A code or docs PR never touches
  `package.json` or adds a changelog section; releasing is its own deliberate act
  (`chore(release)` + tag).
- **It does not skip the notes.** No section, no release — the workflow enforces it, and the
  preflight tells you before you tag rather than after.
