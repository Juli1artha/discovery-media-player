# Getting help

**Question, or integration help** →
[Discussions](https://github.com/Juli1artha/discovery-media-player/discussions). Integration
questions often turn into documentation fixes, so asking one helps the next person too.

**Something is broken** →
[open a bug report](https://github.com/Juli1artha/discovery-media-player/issues/new/choose).
The template asks for the version (`GET /api/doc?contract=1` tells you exactly what is
running), what you did, and what happened instead — with those three, most reports are
reproducible on the first try.

**Security vulnerability** → **not an issue.** Email security@3d-discovery.fr — see
[`SECURITY.md`](SECURITY.md), including which versions are supported.

## Before asking

Most answers live in one of these:

- [`docs/README.md`](docs/README.md) — the map: which document answers what, for integrators,
  operators, and evaluators.
- [`docs/CONFIGURATION.md`](docs/CONFIGURATION.md) — every environment variable. If a setting
  seems to have no effect, check it against this list first: a variable that is not here does
  not exist.
- [`examples/`](examples/) — runnable integrations you can copy: standalone, Express, Vercel.

## What to include

The player version, how it is deployed (Docker, npm package, serverless), the exact URL shape
that misbehaves, and what the server logged. "It doesn't work" costs a round-trip;
"`/doc/abc` returns 403 and the log says X" usually gets an answer in one.
