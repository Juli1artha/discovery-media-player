## What this changes, and why

<!-- The why matters more than the what: the diff already says what. -->

## The failure it prevents

<!-- If this is a fix: what broke, and how it showed up (or did not). If it is a feature: what
     was impossible before. This paragraph usually becomes the test's comment. -->

## Checklist

- [ ] `npm test`, `npm run lint`, `npm run typecheck` pass
- [ ] A test fails without this change
- [ ] `npm run build` run and generated bundles committed, if `src/` changed
- [ ] `docs/HOST-CONTRACT.md` updated (+ journal entry) if the host boundary changed
- [ ] `CHANGELOG.md` updated under Unreleased

<!-- If a host application needs a newer player, put "requires player >= x.y" in the PR title:
     the player deploys before its hosts, never after. -->
