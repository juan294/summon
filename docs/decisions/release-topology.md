# ADR: Release Topology — Single-Maintainer Publish Path & Rollback Runbook

**Status:** Accepted  
**Date:** 2026-06-14  
**Issues:** #440 (DO-S1), #567

## Context

Summon is maintained by a single developer. The npm package (`summon-ws`) is published
via a GitHub Actions workflow (`release.yml`) triggered by a GitHub Release publication.
There is no secondary maintainer who can publish, approve releases, or perform emergency
rollbacks.

This ADR documents the current publish topology, the bus-factor risks that come with a
single-maintainer model, and the concrete steps to recover from a bad release.

## Decision

### Canonical publish path

The release workflow is the **only** supported path for production releases:

1. All development merges to `develop`.
2. A release PR merges `develop` → `main`.
3. An annotated tag is pushed from `main`: `git tag -a v<version> -m "v<version>"`.
4. A GitHub Release is created from the tag.
5. `release.yml` triggers: typecheck → lint → test → build → tarball validation →
   AppleScript E2E smoke test → `npm publish --provenance` (OIDC trusted publishing) →
   post-publish tarball verification across Node 20.19 and 24.

This path is preferred because it attaches npm provenance attestation (OIDC), making
the published package supply-chain verifiable.

The emergency fallback (`npm publish` from a local machine) is documented in
`docs/publishing.md` but loses provenance. It exists only for cases where GitHub
Actions is unavailable.

### Bus-factor risks

With a single maintainer:

- **Token expiry:** npm granular tokens expire (default 60 days). A stale token causes
  a misleading 404 on publish. Check token age before each release.
- **Account lockout:** If the GitHub account is inaccessible, the OIDC trusted
  publisher cannot issue tokens. Keep a scoped npm token in a secure password manager
  as a break-glass credential for the fallback path.
- **Reviewer gap:** There is no second reviewer for release PRs. CI is the gate —
  do not merge a release PR if any required check is red.
- **Key rotation:** If npm credentials are compromised, immediately rotate the npm
  token, revoke the old one, and audit recent publish events on the npm registry.

## Rollback Runbook

Use this runbook when a bad version has been published and users are being harmed.
Act quickly — npm only permits unpublishing within 72 hours of first publish, and only
if no other package depends on the version.

### Step 1 — Deprecate the bad version immediately

This is the fastest action. It keeps the version on the registry but warns anyone who
tries to install it:

```bash
npm deprecate summon-ws@<bad-version> "Critical bug — please use <previous-version> instead"
```

Do this first, before anything else. It takes effect within seconds.

### Step 2 — Repoint `latest` to the last known-good version

```bash
npm dist-tag add summon-ws@<good-version> latest
```

After this, `npm install -g summon-ws` installs the good version. Users who already
installed the bad version are unaffected until they reinstall, but new installs are
protected.

### Step 3 — Revert and retag in git

```bash
# On develop: revert the bad commit(s)
git revert <bad-commit-sha>
git push origin develop

# PR develop → main as usual, or if the situation is urgent, cherry-pick the revert
# directly to main after CI passes on develop.

# After merging to main, re-tag
git tag -a v<patch-version> -m "v<patch-version>"
git push origin v<patch-version>
```

Then create a GitHub Release from the new tag. The release workflow publishes the
fixed version with provenance attached. Once verified, the deprecation message on the
bad version serves as a permanent historical record.

### Step 4 — Post-incident verification

```bash
npm info summon-ws dist-tags
# Expected: { latest: '<good-version>', ... }

npm info summon-ws@latest version
# Must match the intended good version

npm install -g summon-ws
summon --version
summon --help
summon doctor
```

Also check that the deprecated version still shows its warning:

```bash
npm info summon-ws@<bad-version> deprecated
# Should return the deprecation message
```

## Canary dist-tag (optional for risky releases)

When a release contains substantial changes and you want confidence before promoting
to `latest`, publish under the `next` tag first:

```bash
# In the GitHub Release UI, use a pre-release flag, or publish manually under next:
npm publish --tag next
```

This does **not** affect what `npm install -g summon-ws` installs. Users can
opt in with `npm install -g summon-ws@next`.

Verify the canary on a clean machine:

```bash
npm install -g summon-ws@next
summon --version
summon --help
summon .   # requires Ghostty running
```

Once confident, promote to `latest`:

```bash
npm dist-tag add summon-ws@<version> latest
```

The canary path is most useful before a major version bump or when the AppleScript
integration has changed significantly.

## Consequences

- The release workflow remains the single gate for all npm publishes.
- Rollbacks require two actions (deprecate + retag) and take under five minutes when
  the runbook is followed.
- The bus-factor risk is accepted as a property of single-maintainer open-source.
  Mitigations (break-glass token, CI gate, canary option) reduce the blast radius of
  any individual failure.
- Future contributors who gain push access should be granted `npm publish` access and
  added to the trusted OIDC publisher list in the npm registry settings.
