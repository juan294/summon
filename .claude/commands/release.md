# Release New Version

Model tier: **sonnet** — Sonnet 5 (1M context) session.

Prepare and publish a new version release, adapted to the project type.

## Step 1: Orientation

Gather release context before making any changes.

1. **Detect project type** from manifest files:

   | Check | Type | Version source | Publish action |
   |-------|------|---------------|----------------|
   | `package.json` exists | Node/npm | `version` field in package.json | Advisory: "Ready for `npm publish`" |
   | `Cargo.toml` exists | Rust | `version` field in Cargo.toml | Advisory: "Ready for `cargo publish`" |
   | `pyproject.toml` exists | Python | `version` field in pyproject.toml | Advisory: "Ready for `twine upload`" |
   | `go.mod` exists | Go | Git tags only | Advisory: "Tag pushed, consumers can `go get`" |
   | None of above | Docs/generic | CHANGELOG.md or git tags | No publish step |

2. **Find current version** from the manifest file or latest git tag (`git tag --sort=-v:refname | head -1`).

3. **Find last release tag** and compute changes since then:

   ```bash
   git log <last-tag>..HEAD --oneline
   ```

4. **Identify all version-bearing files** -- scan for the current version string across the project:
   manifests, README badges, install instructions, constants files, docker tags,
   CI configs, documentation site configs.

5. **Detect branching strategy:**
   - Check if current branch is main/master
   - Check for a permanent integration branch:
     `git branch -a --list '*develop' '*dev' '*integration'`
   - Check git log for merge commits from feature/release branches
   - If a long-lived `develop` (or `dev`/`integration`) branch exists and releases
     go `develop` -> `main`: **develop-based**
   - Else if on main AND no merge-branch pattern: **main-only**
   - Otherwise: **feature-branch**

6. **Present findings** to the user:
   - Project type and version source
   - Current version
   - Number of commits since last release, categorized by type
   - All version-bearing files found
   - Detected branching strategy
   - Suggest major/minor/patch bump based on commit types (feat = minor, fix = patch, breaking = major)

7. **Consider related commands:**
   - If there are unreleased changes, remind the user to consider running `/update-docs` first
     to refresh all documentation before tagging.
   - If this is the first release, recommend running `/pre-launch` for a full audit.
   - Run `/status` for a quick orientation if the project state is unclear.

**STOP.** Ask the user for the version number before proceeding.

## Step 2: Preparation

After the user provides a version number, prepare all files for release. Do not publish yet.

1. **Bump version in manifest files** (package.json, Cargo.toml, pyproject.toml, etc.).
   If a lock file tracks the version (package-lock.json), update it too.

2. **Generate CHANGELOG entry** from commits since last tag. Categorize by conventional
   commit prefix into Keep a Changelog format:

   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD

   ### Added
   - feat: commits summarized here

   ### Fixed
   - fix: commits summarized here

   ### Changed
   - refactor/chore commits summarized here
   ```

   Present the draft entry to the user for review. Apply their edits before writing.

3. **Update version references** in all files identified in Step 1:
   README badges, install instructions, constants, docker tags, etc.

4. **Run verification commands** sequentially (chain with `&&` or `;`, never parallel Bash calls):

   ```bash
   $TYPECHECK_CMD; $LINT_CMD; $TEST_CMD; $BUILD_CMD
   ```

   If any fail, fix before proceeding.

5. **Present the full diff** to the user.

**STOP.** Wait for the user to review and approve the changes before publishing.

## Step 3: Publish

After human approval, execute the release. The flow depends on the branching strategy detected in Step 1.

### Main-only flow

Confirm with the user before creating the tag and GitHub release. Present what will be tagged
and published, then proceed only after approval.

1. Create the release commit:

   ```bash
   git add <changed-files>
   git commit -m "release: vX.Y.Z -- [summary from CHANGELOG]"
   ```

2. Create an annotated git tag:

   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z"
   ```

3. Push the commit, then the tag by name:

   ```bash
   git push origin main && git push origin vX.Y.Z
   ```

4. Create the GitHub release:

   ```bash
   gh release create vX.Y.Z --notes "[CHANGELOG entry for this version]"
   ```

5. Verify CI:

   ```bash
   gh run list --branch main --limit 1
   ```

6. Report the result with a link to the GitHub release.
   If the project has a registry publish step, remind the user:
   "Release is published. When ready, run `npm publish` / `cargo publish` / etc."

### Feature-branch flow

1. Create a release branch and commit:

   ```bash
   git checkout -b release/vX.Y.Z
   git add <changed-files>
   git commit -m "release: vX.Y.Z -- [summary from CHANGELOG]"
   ```

2. Push the branch:

   ```bash
   git push -u origin release/vX.Y.Z
   ```

3. Check for an existing PR before creating one:

   ```bash
   gh pr list --head release/vX.Y.Z
   ```

   If no existing PR, create one:

   ```bash
   gh pr create --title "release: vX.Y.Z" --body "[CHANGELOG entry]"
   ```

4. Verify CI on the PR:

   ```bash
   gh run list --branch release/vX.Y.Z --limit 1
   ```

5. **STOP.** Tell the user to review and merge the PR. After merge, provide the commands to
   tag and release:

   ```bash
   git checkout main && git pull
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   gh release create vX.Y.Z --notes "[CHANGELOG entry]"
   ```

6. Report the result with a link to the PR.
   If the project has a registry publish step, remind the user:
   "After PR is merged and tagged, run `npm publish` / `cargo publish` / etc."

### Develop-based flow

Use when `develop` (or `dev`/`integration`) is the **permanent** integration branch and the
release is a PR from `develop` -> `main` directly. There is NO intermediate `release/vX.Y.Z`
branch -- the integration branch already holds the changes.

1. Land the release prep on the integration branch:

   ```bash
   git checkout develop && git pull --rebase
   git add <changed-files>
   git commit -m "release: vX.Y.Z -- [summary from CHANGELOG]"
   git push origin develop
   ```

2. Check for an existing release PR before creating one:

   ```bash
   gh pr list --base main --head develop
   ```

   If none, open the `develop` -> `main` PR:

   ```bash
   gh pr create --base main --head develop --title "release: vX.Y.Z" --body "[CHANGELOG entry]"
   ```

3. Verify CI on the PR:

   ```bash
   gh run list --branch develop --limit 1
   ```

4. Merge with squash + auto-merge. NEVER pass `--delete-branch` -- `develop` is permanent:

   ```bash
   gh pr merge --squash --auto
   ```

   Repos standardized per Rule #76 enable delete-branch-on-merge, but that only removes
   ordinary feature heads; deleting the permanent integration branch would be destructive.

5. **STOP.** Wait for the PR to merge (confirm with `gh pr view --json state`). After it lands,
   tag the squashed release commit on `main`:

   ```bash
   git checkout main && git pull --rebase
   git tag -a vX.Y.Z -m "vX.Y.Z"
   git push origin vX.Y.Z
   gh release create vX.Y.Z --notes "[CHANGELOG entry]"
   ```

6. Report the result with a link to the PR and the GitHub release.
   If the project has a registry publish step, remind the user:
   "After tagging, run `npm publish` / `cargo publish` / etc."

## Rules

- NEVER use `git push --tags` -- push tags by name: `git push origin vX.Y.Z` (Error #44).
- NEVER use `--body` with `gh release create` -- use `--notes` (Error #20).
- ALWAYS check for an existing PR before creating one with `gh pr create` (Error #53).
- NEVER pass `--delete-branch` on a `develop` -> `main` release PR -- `develop` is a permanent
  integration branch (develop-based flow; Rule #76).
- ALWAYS verify CI after push (push accountability).
- ALWAYS present the diff before committing (Step 2 gate).
- ALWAYS ask for the version number -- never guess or auto-increment.
- Registry publish (npm/cargo/twine) is ADVISORY ONLY -- tell the user it is ready, do not run it.
  Reason: most registries require 2FA and publishing cannot be undone.
- Run verification commands sequentially, never as parallel Bash calls.
