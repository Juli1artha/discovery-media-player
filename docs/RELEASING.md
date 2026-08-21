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

**Two exceptions, and only these:**

- a **security** fix — it leaves as soon as it is green, alone if necessary;
- a **broken package** on the registry — the same, because every install is affected until it is
  replaced. (0.1.25 is the precedent: an inline script that did not parse, live layer dead.)

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

The [Release workflow](../.github/workflows/release.yml) takes over: it demands the exact commit's
CI be entirely green (0.1.68 was published on red), runs the tests again, extracts the changelog
section, publishes to npm with provenance, and builds the container image.

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
2. If **nothing was published** under that tag: delete it (`git push origin :v<version>`), fix the
   commit, run the preflight, tag again.
3. If **npm already served it**: the version is spent. Publish the fix as the next version, and say
   in its changelog section what the previous one was.

## What a release does not do

- **It does not bump the version as a side effect.** A code or docs PR never touches
  `package.json` or adds a changelog section; releasing is its own deliberate act
  (`chore(release)` + tag).
- **It does not skip the notes.** No section, no release — the workflow enforces it, and the
  preflight tells you before you tag rather than after.
