# Verifying a release

Every release of this project is signed at build time, and you can check that signature yourself
without trusting us, this page, or the registry you downloaded from. This document says which
technology is used, what to run, what you should see, and **which identity to expect** — that last
one is the part that matters, because a valid signature by the wrong signer is not a good outcome.

There is no key to fetch and no keyring to maintain. Publication authenticates through OpenID
Connect at the moment it runs, and the signature is issued by [Sigstore](https://www.sigstore.dev/)
against the workflow's own identity. Nothing is stored on our side that could be stolen and reused.

> **Where to read this from.** If you are verifying because you suspect something, read these
> instructions from a copy you did not get from the same place as the artifact — the repository on
> GitHub, or the copy inside the published package. Instructions and artifact travelling together
> is exactly the single point a verification is supposed to remove.

## The npm package

The package is published with `npm publish --provenance`, which attaches a Sigstore-signed
[SLSA](https://slsa.dev/) provenance attestation naming the tarball's digest and the commit it was
built from.

```bash
npm install discovery-media-player
npm audit signatures
```

Expected output — the count depends on your tree, the important word is **verified**:

```
audited 1 package
1 package has a verified registry signature
1 package has a verified attestation
```

A failure looks like `1 package has an invalid registry signature` or reports a missing
attestation. Either means stop and open a report; do not "try again from another mirror".

You can also read the attestation before installing anything:

```bash
npm view discovery-media-player dist.attestations
```

### The identity to expect

The provenance is signed by a GitHub Actions workflow, not by a person. What must match:

| Field | Expected value |
|---|---|
| Issuer | `https://token.actions.githubusercontent.com` |
| Source repository | `https://github.com/Juli1artha/discovery-media-player` |
| Workflow | `.github/workflows/release.yml` |
| Commit | a commit belonging to `main` — CI refuses to publish a tag that does not |

The npm page for a published version shows the same provenance in readable form, including the
commit and the workflow run that produced it. A signature that verifies but names a different
repository or a different workflow file is **not** this project's release.

## The registry and the Release carry the same bytes

Two attestations exist for every version, and **each one verifies without saying anything about
the other**:

| | Attested subject | Digest |
|---|---|---|
| npm registry | `pkg:npm/discovery-media-player@0.1.134` | `sha512` |
| GitHub Release | `discovery-media-player-0.1.134.tgz` | `sha256` |

Different names, different algorithms. If the two files ever diverged, both attestations would
still verify — each would correctly attest its own file — and a reader who checked one would have
no reason to suspect the other.

### What the release workflow already refuses

That gap is closed at publication. Before anything is attached to a Release, the workflow rebuilds
the package, packs it, and compares its `sha512` with the `dist.integrity` the registry serves for
that version. If they differ it **stops** rather than attaching a file nobody could match to what
people install. The archive the Release carries is therefore the same bytes the registry serves,
and the SLSA attestation is issued over that archive.

So this is not a hole in the pipeline. It is a hole in what *you* can conclude on your own: the
refusal happened on our side, at a moment you did not witness, and nothing you download tells you
it happened.

### Checking it from the outside

```bash
VERSION=0.1.134
mkdir -p registry release
( cd registry && npm pack "discovery-media-player@$VERSION" )
gh release download "v$VERSION" --pattern '*.tgz' --dir release \
  --repo Juli1artha/discovery-media-player
sha256sum registry/*.tgz release/*.tgz
```

The two downloads go to separate directories on purpose: both files carry the same name, and
overwriting one with the other would leave you comparing a file with itself.

Both lines must show the same digest. This is weaker than the workflow's check in one sense — it
trusts nothing about how the files were made — and stronger in another: it is the only one that can
see a change made **after** publication, such as a Release asset replaced later or a registry
substitution. The workflow cannot check that, because by then it has finished.

### Tying it to the copy you actually install

The step above proves two published files match each other. It does not yet prove either of them is
the one **your** project installs — `npm pack` fetches *a* copy of that version, and a version
number is not a digest. If you depend on this package, close that gap with your own lockfile:

```bash
openssl dgst -sha512 -binary registry/discovery-media-player-*.tgz | base64 -w0
grep -A3 '"node_modules/discovery-media-player"' package-lock.json | grep integrity
```

The `sha512-…` you compute must equal the `integrity` your lockfile records. Only then does the
verdict you reached on that archive say anything about the code that runs in your application.

Without this middle link you have proved something about *an* archive, not about yours. The point
was raised by an integrating host that had verified a fix in the published package and realised its
own conclusion rested on an archive it had not tied to its install.

### What was measured, and when

A verification you read is not a verification you ran. This table records what was actually
compared from the outside, so the next reader knows what was true *at that date* rather than
assuming it is still true today — and so a later divergence has a fixed point to be measured
against.

| Version | Date | Release `.tgz` `sha256` | Identical to npm | Who looked | Also checked |
|---|---|---|---|---|---|
| 0.1.135 | 2026-08-25 | `603c1a44a502f2929a3ec806a9ee6886085614a20019d01c4019554ea229991d` | yes — 319 190 bytes on both sides | this repository, by hand | attestation subject and digest, SLSA workflow and ref, SBOM version, `.sha256` sidecar — and the release's own claims re-checked **inside the published tarball**: no `CHANGELOG.md`, no `docs/README.md`, and 0 dead relative links out of 2 (28 out of 34 in 0.1.134) |
| 0.1.134 | 2026-08-24 | `aa56a1d85ef005baa65a065485eacd5462891dce1cb2961036b08af0e2a9c969` | yes — 320 659 bytes on both sides | this repository, by hand | attestation subject and digest, SLSA workflow and ref, SBOM version, `.sha256` sidecar |
| 0.1.134 | 2026-08-24 | same digest | yes — reproduced independently | an integrating host, on another machine — **reported to us, not measured here** | its own lockfile `integrity`, then the fix re-measured on the unpacked archive |

⚠️ The rows are not all the same kind of statement, and the column says so. The first is a
measurement made in this repository; the second is a report we received and could not re-run. The
second is nonetheless the **stronger** of the two for the property this section is about: an
outside check has value precisely because it is not ours, and a table that blurred that distinction
would be the sort of undifferentiated record it exists to prevent.

The 0.1.135 row adds a check the earlier ones did not make: **the release notes' own claims,
re-read inside the published tarball** rather than in the repository. A changelog entry saying a
file no longer ships is a statement about an artefact nobody has opened until someone opens it.

For 0.1.134 the SLSA attestation attached to the Release named that same `sha256`, for the subject
`discovery-media-player-0.1.134.tgz`, built from `refs/tags/v0.1.134` by
`.github/workflows/release.yml` in this repository — and npm's own `sha512`
(`18c88f5eae80f00e…`) is the digest of those same bytes.

That row was produced by hand, after publication, and **an empty row for a version means nobody
looked from the outside — not that nothing was wrong**. The workflow's own refusal covers every
version whether or not a row exists here.

## The container image

The image is built multi-architecture with an SBOM and full provenance
(`provenance: mode=max`), pushed to GHCR with build attestations.

```bash
gh attestation verify \
  oci://ghcr.io/juli1artha/discovery-media-player:v0.1.128 \
  --repo Juli1artha/discovery-media-player
```

Expected: a line confirming the attestation was verified for that repository. Substitute the
version you actually pulled; `latest` is a moving pointer and a verification of it tells you less
than a verification of the versioned tag.

To read what is inside the image rather than where it came from:

```bash
docker buildx imagetools inspect ghcr.io/juli1artha/discovery-media-player:v0.1.128 \
  --format '{{ json .SBOM }}'
docker buildx imagetools inspect ghcr.io/juli1artha/discovery-media-player:v0.1.128 \
  --format '{{ json .Provenance }}'
```

## The software bill of materials

Each GitHub Release carries a CycloneDX SBOM named for its version —
`discovery-media-player-v0.1.128.cdx.json` — listing the production dependency tree of the
published package. It is generated at build time by `npm sbom` from the same installed tree the
tarball is published from, in the release workflow, and the workflow fails if it comes out empty.

```bash
gh release download v0.1.128 --pattern '*.cdx.json' --repo Juli1artha/discovery-media-player
```

Use it to answer "am I affected by this advisory?" without reading our `package.json` version by
version. The image carries its own SBOM, embedded as an attestation, for the same purpose.

## What each check proves

| Check | Proves | Does not prove |
|---|---|---|
| `npm audit signatures` | The tarball you have is byte-for-byte what the workflow published, and the registry has not substituted it | That the code is free of defects |
| Identity fields above | It was built by *this* repository's release workflow, from a commit on `main` | That the commit was reviewed by anyone in particular — see [`../MAINTAINERS.md`](../MAINTAINERS.md) |
| Comparing the two digests | The registry and the Release still serve the same file **today** — the one check that can see a substitution made after publication | That either file is the one you want — verify the identity fields as well |
| `gh attestation verify` | The image was built by this repository's workflow | That the base image is current — check the digest against the Dockerfile |
| The SBOM | What the release declares it contains | That nothing was added outside the package manager — the Dockerfile is the place to read for that |

Being explicit about the second column is deliberate. A verification that is oversold is worse than
none, because it stops people looking further.

## If a check fails

Do not install, and do not work around it. Email **security@3d-discovery.fr** — see
[`../SECURITY.md`](../SECURITY.md) — with the version, the command you ran and its full output. A
failing signature on a published artifact is treated as an incident, not as a support question.
