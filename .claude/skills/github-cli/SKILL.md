---
name: "github-cli"
description: "gh CLI patterns, JSON field discovery, PR check interpretation, label management, merge settings verification, CodeQL/GHAS gating."
---

# GitHub CLI

## JSON Field Discovery

Wrong -- guess field names:

```bash
gh pr checks 42 --json conclusion  # Unknown field
```

Right -- discover fields first:

```bash
gh pr checks --help
```

## PR Check Interpretation

Use the documented fields and preserve the command status:

```bash
gh pr checks 42 --json name,state,bucket,workflow
# Or watch existing checks to completion:
gh pr checks 42 --watch
```

Pending checks return exit **8**. Exit 1 can mean failed checks or another
command error; inspect output. `bucket` distinguishes `pass`, `fail`,
`pending`, `skipping`, and `cancel`. Do not discard a check merely because
its name is `review`; inspect its workflow and the repository's requirements.
An empty or incomplete check inventory is not evidence that required CI ran.
These commands inspect existing checks; they do not authorize PR creation.
See the [GitHub CLI manual](https://cli.github.com/manual/gh_pr_checks).

## Release vs PR Flags

Wrong -- --body is for pr/issue create, not release:

```bash
gh release create v1.0.0 --body "notes"
```

Right -- releases use --notes:

```bash
gh release create v1.0.0 --notes "notes"
```

## Label and Merge Settings

Wrong -- assume labels exist and merge method is allowed:

```bash
gh issue create --label "chore" --title "Fix"  # label not found
gh pr merge 42 --merge                         # method not allowed
```

Right -- check or create first:

```bash
gh label list && gh label create "chore" --color "ededed"
gh api repos/{owner}/{repo} --jq '.allow_squash_merge, .allow_merge_commit'
```

When creating multiple issues, create them sequentially, not as parallel
tool calls -- a batch of parallel `gh issue create` calls that all hit the
same missing label fail together instead of surfacing once.

## Deprecated Projects (Classic) API

Wrong -- an older `gh` version queries a removed field and errors:

```bash
gh issue view 42 --json projectCards  # Projects (classic) is deprecated
```

Right -- upgrade `gh` first:

```bash
brew upgrade gh
```

## Code Scanning Availability

Before adding a scanner, inspect repository visibility, the enabled security
product, and the caller's permissions:

```bash
gh api repos/{owner}/{repo} --jq '{visibility, security_and_analysis}'
gh api --include repos/{owner}/{repo}/code-scanning/alerts
```

A successful alerts request proves this caller can read that endpoint. A 403
can mean missing permissions, policy restrictions, rate limits, or disabled
code security; a 404 can hide a private resource. Neither means "enabled".
Inspect the HTTP status, response message, and token permissions together.
Code scanning is available for public repositories and eligible private or
internal repositories with GitHub Code Security enabled. Do not enable a paid
product or trigger a scanner without the owner's authorization. Read-only
inspection of existing alerts is allowed. See [GitHub's code-scanning API](https://docs.github.com/en/rest/code-scanning/code-scanning).

## Duplicate PR Prevention

Apply mutation recipes only within an authorized completed release workflow.
Working branches remain local; do not create feature PRs for implementation.

Wrong -- create PR when one already exists for this branch:

```bash
gh pr create --title "feat: thing"
```

Right -- check first, edit if exists:

```bash
gh pr list --head <branch> --base <base>
# Exists: gh pr edit <number>  |  New: gh pr create
```

## Identifier Discovery

Wrong -- fabricate repo names or issue numbers:

```bash
gh issue view 42 --repo owner/MyProject
```

Right -- discover identifiers:

```bash
gh repo list owner --json name --limit 50
gh issue list --search "bug in login"
```
