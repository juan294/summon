---
name: "GitHub CLI"
description: "gh CLI patterns, JSON field discovery, PR check interpretation, label management, merge settings verification."
---

# GitHub CLI

## JSON Field Discovery

Wrong -- guess field names:

```bash
gh pr checks 42 --json conclusion  # Unknown field
```

Right -- discover fields first:

```bash
gh pr checks 42 --json 2>&1 | head -5
```

## PR Check Interpretation

Wrong -- exit code 0 means passed, raw output is readable:

```bash
gh pr checks 42  # exit 0 but checks still pending; "review: fail" looks like CI
```

Right -- use structured JSON, filter review, or --watch:

```bash
gh pr checks 42 --json name,state,conclusion | jq '.[] | select(.name != "review")'
gh pr checks 42 --watch
```

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

## Duplicate PR Prevention

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

Wrong -- fabricate repo names or issue numbers (case-sensitive):

```bash
gh issue view 42 --repo owner/MyProject
```

Right -- discover identifiers:

```bash
gh repo list owner --json name --limit 50
gh issue list --search "bug in login"
```
