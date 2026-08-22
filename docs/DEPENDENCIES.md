# Dependencies

How this project chooses what it depends on, where it gets it from, and how it notices when
something changes. Written down because the answers here are deliberate, and because a policy that
lives only in the heads of the people applying it cannot be audited by anyone else.

## What the project depends on at run time

**One package: [`pdfjs-dist`](https://www.npmjs.com/package/pdfjs-dist), pinned to an exact
version.** That is the whole production dependency tree. Everything else in `package.json` is
development tooling, which never reaches a consumer: `files` in `package.json` restricts the
published tarball to `bin`, `context`, `dist`, `server`, `supabase`, `types` and a short list of
documents.

It is pinned exactly — `6.2.108`, not `^6.2.108` — because it is the rendering engine. A minor
release of the component that draws every page is a decision, not a routine bump: it is read,
tested against the browser bench, and merged on purpose.

## Selecting a new dependency

The bar is deliberately high, and the reason is the product. This player is self-hosted so that
commercial documents and their reading data stay on the operator's own infrastructure; every
package added to the runtime tree is code that runs next to those documents, in the operator's
process, under the operator's credentials. A dependency is therefore added only when:

- it does something the platform does not already do — Node's standard library and the Web
  platform are the first place to look, and are why this tree carries no HTTP client and no crypto
  library: `fetch` and `node:crypto` are already there;
- it is FLOSS, and its licence is compatible with AGPL-3.0-or-later distribution;
- it is maintained, and its own dependency tree is small enough to read;
- the work it saves is larger than the work of removing it later.

A dependency that fails any of these is written by hand instead. Several of the guards in `tools/`
exist for exactly that reason.

## Obtaining dependencies

Only from the public npm registry, over HTTPS, and only through `npm ci`:

- **`package-lock.json` is committed.** It resolves the full transitive graph and carries a
  Subresource-Integrity hash for every package. `npm ci` installs that graph exactly and fails
  rather than silently resolving something newer.
- **CI never runs `npm install`.** Every workflow uses `npm ci`, so what CI tests is the tree the
  lockfile describes, and not whatever the registry happened to serve that morning.
- **Build inputs beyond npm are pinned by digest, not by tag.** Container base images carry an
  `@sha256:` digest and GitHub Actions carry 40-character commit SHAs. Both are enforced —
  `tools/images-epinglees.mjs` and `tools/actions-epinglees.mjs` fail CI on a floating reference,
  because a tag is a name its owner can move and a digest is not.
- **`tools/actions-versions.mjs` goes further** and checks that the version comment written beside
  each SHA tells the truth. A pinned SHA labelled `# v3` that actually resolves to v4 is a major
  upgrade of a security tool arriving disguised as a patch; that happened once, and the guard
  exists because of it.

## Tracking updates

[Dependabot](../.github/dependabot.yml) watches three ecosystems — npm, GitHub Actions and Docker
— on a **monthly** schedule, with npm capped at three open pull requests at a time.

Monthly and grouped is a choice. With one runtime dependency and the rest tooling, a pull request
per package per week would bury real contributions under noise, and a review queue nobody reads is
not review. Two rules shape what arrives:

- **Development tooling is grouped**, so a batch of patch and minor bumps is reviewed once.
- **A major upgrade of a GitHub Action arrives alone**, never inside a group, with the action's
  name in the title. Grouped majors are how one hid before.

Two upgrades are deliberately held back, each with the reason recorded beside it in
`dependabot.yml`:

| Held | Why |
|---|---|
| `typescript` major | `typescript-eslint` declares a strict peer range. Proposing TypeScript ahead of the linter that accepts it produces a pull request where `npm ci` fails before the first test — an upstream gap, not a regression here. It is taken when `typescript-eslint` accepts it. |
| `node` major (container base) | Decided on the Node LTS calendar. Dependabot proposed a Current release the day it shipped, two months before it was supported; a green pull request that puts production on a non-LTS base is still green. |

Neither is a blanket freeze on majors elsewhere: freezing them would leave actions and images to
rot without fixes, which trades one supply-chain risk for another.

## Verifying what is there

- **`npm audit`** — currently 0 vulnerabilities across the tree.
- **CodeQL** — every push, every pull request, and weekly on a schedule so that new rules meet old
  code.
- **`tools/secrets-en-clair.mjs`** — refuses a credential in any tracked file, in CI and in the
  `pre-push` hook, so a dependency's example configuration cannot arrive carrying a real key.
- **The examples are pinned to the current release** and `tools/exemples-epingles.mjs` fails CI if
  they fall behind, because an example is code people copy.

## What ships to a consumer

`npm pack` output is checked in CI on every run: the tarball must contain compiled JavaScript and
type declarations, must not contain raw TypeScript, and must not contain tests. The published
package therefore carries `pdfjs-dist` as its only declared dependency, and nothing from the
development tree above.
