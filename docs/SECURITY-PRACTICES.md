# Security practices

Two standing policies: how secrets are handled, and what happens when a security tool reports
something. Both are written here rather than lived by habit, because a threshold that exists only in
the maintainer's judgement cannot be checked by anyone else — including by the maintainer, six
months later.

Dependency findings have their own thresholds, in
[`DEPENDENCIES.md`](DEPENDENCIES.md#vulnerability-and-licence-thresholds). The threats these
practices answer to are in [`THREAT-MODEL.md`](THREAT-MODEL.md).

## Secrets and credentials

### The rule

**This project holds no long-lived secret, and does not want one.** Everything below follows from
that. Where a credential is unavoidable, it is issued at the moment of use and expires by itself.

### What exists, and where it lives

| Secret | Held by | Lifetime |
|---|---|---|
| npm publishing | Nobody — OIDC trusted publishing issues an identity token per run | The workflow run |
| GHCR push | `GITHUB_TOKEN`, scoped per job by the workflow | The job |
| Signing keys | None. Sigstore signs against the workflow identity | n/a |
| security@3d-discovery.fr | The maintainer's mailbox | Ongoing |
| **Operator** secrets (`SUPABASE_SERVICE_ROLE_KEY`, `PLAYER_HOST_FETCH_SECRET`, the HMAC secrets) | The operator's own environment. **Never ours** | The operator's choice |

The last row is the important one: this is self-hosted software. The secrets that protect an
instance belong to whoever runs it, and never transit through this project. That is a property of
the product, not a courtesy.

### Storing

- **Never in version control.** `.gitignore` excludes `.env` and `.env.*`, and
  `tools/secrets-en-clair.mjs` refuses seven classes of credential by form, plus Supabase
  `service_role` tokens decoded from their payload, plus any variable in a `.env*` file whose name
  denotes a secret and which carries a value. It runs in CI **and** in the `pre-push` hook.
- **In `.env.example`, names only.** Twenty-one variables denote secrets there; all carry an empty
  value. A filled example is the most common way a real key gets committed, and it is a build
  failure here.
- **In CI, as repository secrets read through `env:`,** never interpolated into a shell line.

### Accessing

Access follows the list in [`../MAINTAINERS.md`](../MAINTAINERS.md#access-to-sensitive-resources),
which names every sensitive resource and who holds it. Granting anyone new access follows the
vetting policy in the same file. Workflows get the narrowest scope that works: `release.yml` starts
from `permissions: {}` and each job asks for what it needs and nothing more.

### Rotating

| Trigger | Action |
|---|---|
| A credential appears in any tracked file, log, or issue | **Revoke first, then remove.** A pushed secret is disclosed; rewriting history does not recall it |
| A person loses access to the project | Their access is removed the same day; anything they could read that is not per-run is rotated |
| Routine | Nothing to rotate — no long-lived credential exists to expire. This is the point of the OIDC design |
| The security mailbox | Rotated only on compromise; it is an address, not a credential |

Operators are told the same thing for their own secrets in
[`CONFIGURATION.md`](CONFIGURATION.md): a secret that has been in a log is spent.

### If a secret leaks anyway

1. **Revoke it at the issuer.** Immediately, before anything else, and before deciding how bad it is.
2. Remove it from the branch and set the variable back to empty.
3. If it was an operator-facing secret in a released artifact, treat it as a vulnerability under
   [`../SECURITY.md`](../SECURITY.md) and tell affected operators — they cannot rotate what they do
   not know about.
4. Record it in the changelog for the version that fixes it.

## Static analysis findings

### The tools, and when they run

| Tool | Scope | When |
|---|---|---|
| **CodeQL** | `javascript-typescript`, security query suites | Every push to `main`, every pull request, and weekly |
| **ESLint** (+ `typescript-eslint`) | `bin`, `context`, `server`, `src`, `build` | Every push and pull request |
| **`tsc --strict`** | `src`, `types` | Every push and pull request |
| **Repository guards** (`tools/`) | Workflows, Dockerfile, examples, published surface, tracked files | Every push and pull request |

The weekly CodeQL run is not redundant with the per-commit one: rules change while code stands
still, and a scheduled scan is how old code meets new rules.

### Remediation thresholds

The threshold is what makes this a policy rather than an intention.

| Severity | Must be resolved | Blocks |
|---|---|---|
| **Critical / High** | Before the pull request merges | The merge, and any release |
| **Medium** | Before the next release; a fix or a written suppression, never silence | The release |
| **Low / Note** | Triaged within the release cycle; may be accepted with a recorded reason | Nothing |
| **Any severity, in a security-critical path** — the file proxy, the access wall, share revocation, the presentation control token, CSP handling | Before the pull request merges, regardless of the tool's own rating | The merge |

That last row exists because severity ratings are generic and this codebase is not: a "medium" in
the component that fetches a caller-supplied URL server-side is not a medium here.

### Suppressing a finding

A finding may be dismissed only as **not exploitable**, never as *won't fix* or *too noisy*, and the
dismissal carries:

- why the code path cannot be reached, or why the pattern is safe in this context;
- who decided, and when;
- the CodeQL dismissal comment, or a scoped inline suppression next to the code — never a
  repository-wide rule disablement, which would hide the next instance too.

The current state is zero outstanding findings: CodeQL clean, ESLint 0 errors and 0 warnings,
`tsc --noEmit` clean, `npm audit` 0 vulnerabilities.

### Before a release

No release goes out with an unresolved Critical, High, or Medium finding, from any of the tools
above. CodeQL is a blocking check on the publication path, so this is enforced rather than
remembered.
