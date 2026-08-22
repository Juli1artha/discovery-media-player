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
| `gh attestation verify` | The image was built by this repository's workflow | That the base image is current — check the digest against the Dockerfile |
| The SBOM | What the release declares it contains | That nothing was added outside the package manager — the Dockerfile is the place to read for that |

Being explicit about the second column is deliberate. A verification that is oversold is worse than
none, because it stops people looking further.

## If a check fails

Do not install, and do not work around it. Email **security@3d-discovery.fr** — see
[`../SECURITY.md`](../SECURITY.md) — with the version, the command you ran and its full output. A
failing signature on a published artifact is treated as an incident, not as a support question.
