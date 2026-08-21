# Documentation

Three readers, one section each. Start with the one that matches what you are trying to do —
no document assumes you have read the others.

## You are integrating the player into an application

| Document | What it gives you |
|---|---|
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | The one idea that holds the design: the core knows nothing about its host. Read this first. |
| [`API.md`](API.md) | What a host can call, and what it must implement. |
| [`HOST-CONTRACT.md`](HOST-CONTRACT.md) | The binding contract, with the dated journal of every boundary change. It ships **inside the package**: `require.resolve("discovery-media-player/contrat")`. |

## You are running an instance

| Document | What it gives you |
|---|---|
| [`CONFIGURATION.md`](CONFIGURATION.md) | Every environment variable. An instance is described entirely by its environment — there is no configuration file, on purpose. |
| [`MIGRATIONS.md`](MIGRATIONS.md) | What happens to a database **already in service** when the player expects a newer schema. (French.) |
| [`RETENTION.md`](RETENTION.md) | The declared perimeter of data retention: every personal-data column has a written policy, and CI enforces that the list is complete. Also an export of the package: `require.resolve("discovery-media-player/retention")`. |

## You are contributing, or publishing a version

| Document | What it gives you |
|---|---|
| [`../CONTRIBUTING.md`](../CONTRIBUTING.md) | how to run the benches, what review looks for, and the one rule: a behaviour worth keeping is worth a test that fails without it. |
| [`../AGENTS.md`](../AGENTS.md) | the conventions that are not obvious from the file tree — which ones a guard enforces, and which ones only review does. |
| [`RELEASING.md`](RELEASING.md) | the release train, freezing the candidate SHA, the read-only preflight to run **before** the tag, and what to do when a tag lands on the wrong commit. |

## You are evaluating the project

The external audit trail is public, unedited, and kept in the state it was received —
an audit rewritten after the fact is no longer a trace. Findings and their fixes are
tracked version by version in the [CHANGELOG](../CHANGELOG.md).

| Document | What it is |
|---|---|
| [`AUDIT-2026-08-14-RAPPORT.md`](AUDIT-2026-08-14-RAPPORT.md) | First external audit, on `0.1.17`. Historical. (French.) |
| [`AUDIT-2026-08-14-SUIVI.md`](AUDIT-2026-08-14-SUIVI.md) | The follow-up ledger: done, decided-but-not-done, and rejected-with-reason. Historical. (French.) |
| [`AUDIT-2026-08-15-SECONDE-PASSE.md`](AUDIT-2026-08-15-SECONDE-PASSE.md) | Second pass, on `0.1.26` — including what the first follow-up had marked too optimistically. Historical. (French.) |

## Work in progress

| Document | What it is |
|---|---|
| [`SPEC-MEMBRE-INJECTE.md`](SPEC-MEMBRE-INJECTE.md) | A specification sent to a host for agreement **before** the contract moves. Nothing in it is implemented. (French.) |

Public entry points are in English. Documents that remain in French — audit traces, and the
operational documents marked *(French)* above — are labelled explicitly, so nobody discovers
the language after clicking. The reasoning behind the split is at the end of the
[README](../README.md#contributing).
