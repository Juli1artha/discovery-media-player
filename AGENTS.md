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
coverage's sake, and coverage is deliberately not measured.

## Conventions the guards enforce

- **Generated files are committed, never edited.** `server/browser.generated.js` and
  `server/shared.generated.js` come from `src/` via `npm run build`. Edit the TypeScript source,
  rebuild, commit both. CI rebuilds and fails on any drift.
- **Exact versions everywhere.** GitHub Actions are pinned to a 40-hex commit SHA (tag kept as
  a trailing comment); examples pin the exact version `main` declares; third-party browser
  scripts are version-pinned **and** SRI-fingerprinted in the `TIERS` inventory. CI rejects
  every floating or stale reference.
- **Facts must not exist in two unconfronted copies.** Documented env vars ↔ `.env.example` ↔
  the variables the code reads, the identity card in `docs/HOST-CONTRACT.md` ↔
  `server/handler.js`, the database call count in `docs/API.md` ↔ the code, changelog sections ↔
  their comparison links, `supabase/init.sql` ↔ the migrations: each pair has a CI step that
  compares them. If you change one side, change the other in the same commit.
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
