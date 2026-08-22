# Maintainers

Who has access to what, and who is answerable for which decision. This file exists so that a
contributor, an operator running an instance, or someone evaluating the project can tell — without
asking — who can merge a change, who can publish a version, and who reads a vulnerability report.

## People

| Person | GitHub | Role | Since |
|---|---|---|---|
| Julien Artha | [@Juli1artha](https://github.com/Juli1artha) | Maintainer (repository admin) | 2026-08 |

There is currently **one** maintainer, and no other account holds write access to this
repository. That is stated plainly rather than left to be inferred, because it is the single most
useful fact about this project's capacity — see [Bus factor](#bus-factor) below.

## Access to sensitive resources

Everything in this list is held by the maintainer above, and by nobody else.

| Resource | What it allows | How it is held |
|---|---|---|
| Repository admin | Change settings, branch protection, and collaborator access | GitHub account, 2FA enforced by the platform |
| `main` branch | Approve and merge pull requests | Branch protection; direct pushes are refused |
| GitHub Actions | Change what runs in CI and with which permissions | Repository admin |
| npm publishing | Publish `discovery-media-player` to the registry | **OIDC trusted publishing** — no long-lived token exists to hold or to leak |
| GHCR image | Push the container image | `GITHUB_TOKEN`, scoped per job, never stored |
| security@3d-discovery.fr | Receive private vulnerability reports | Mailbox, see [`SECURITY.md`](SECURITY.md) |

Two consequences worth stating. First, **no release credential is stored anywhere**: publication
authenticates through OIDC at the moment it runs, so there is no secret whose loss would let
someone else publish, and none to rotate. Second, the CI workflows declare their own permissions —
`release.yml` starts from `permissions: {}` and grants the narrowest scope per job — so access to
the repository is not the same as access to everything the repository can do.

## Responsibilities

**Maintainer.** Reviews and merges pull requests; decides what the host contract may promise and
when it may break; cuts releases and is answerable for what a published version contains; receives
and triages vulnerability reports within the timeline [`SECURITY.md`](SECURITY.md) commits to
(acknowledgement within 72 hours, assessment within 7 days); and keeps the guards in `tools/`
honest, which in this project means a rule is enforced mechanically or it is not a rule.

**Contributors.** Anyone. Open an issue or a pull request; there is no invitation to wait for and
no prior discussion required. What is expected of a contribution is in
[`CONTRIBUTING.md`](CONTRIBUTING.md): a behaviour worth keeping is worth a test that fails without
it. Every contributor signs the CLA ([`CLA.md`](CLA.md)), which a workflow checks automatically on
each pull request — that is where the assertion that you are entitled to contribute the code is
made and recorded.

**Operators.** Anyone running an instance. Not project members and hold no access here, but
[`CONTRIBUTING.md`](CONTRIBUTING.md) asks something of them: an instance that hits a boundary the
documentation did not predict is worth an issue, because the next operator will hit the same one.

## Bus factor

One maintainer is one point of failure, and pretending otherwise would be the kind of claim this
project's guards exist to prevent. Concretely:

- A vulnerability report arriving while that person is unavailable waits. The 72-hour
  acknowledgement in [`SECURITY.md`](SECURITY.md) is a commitment made by one person, not a rota.
- Nothing is lost if that person disappears: the source is AGPL-3.0-or-later, the full history is
  public, releases are reproducible from a clean `npm ci` plus `npm run build`, and every published
  version carries a signed provenance attestation binding it to the commit that built it. A fork
  can be cut and published by anyone, without needing anything held privately here.

The project would take a second maintainer. The path is the ordinary one — contribute, and it
follows from there.

## Changing this file

Access changes land here in the same pull request that makes them, not afterwards. A list of who
can publish that is accurate only until someone forgets to update it is worse than no list: it is
a list people trust.
