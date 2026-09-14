# Error Catalog -- Full Index

All 64 documented error patterns, one line each, grouped by domain. Read this
when the Top 20 in `SKILL.md` did not resolve the issue -- it is a condensed
index of every entry, not the full write-up. Full symptom/root-cause/solution
detail for each error lives in `patterns/agent-errors.md` in the cc-rpi
blueprint repository.

## Shell & Tools

- **#1: Sibling tool call errored (parallel verification)** -- Preserve each verification exit status; use && or explicit aggregation.
- **#2: Shell cwd resets to main repo in a worktree** -- use an observed absolute worktree path or explicit per-call workdir; verify branch.
- **#8: Tilde in file paths** -- resolve absolute paths unless the specific file API promises expansion.
- **#16: Dependencies not installed** -- run `pnpm install` / `uv sync` before build/test/lint.
- **#17: jq syntax error from over-escaping** -- use single quotes; `!=` needs no escaping inside them.
- **#22: `rm` fails on stale file list** -- Re-list and delete only known task-owned disposable files.
- **#24: Cross-project `../` paths fail** -- always use absolute paths for cross-project operations.
- **#36: Mega inline shell one-liner zsh can't parse** -- write multi-step logic to a temp script file instead.
- **#45: Fabricated filesystem paths** -- never guess paths; discover with `ls`/Glob first.

## Git

- **#3: Pre-commit hook rejection** -- run typecheck/lint before committing, fix first.
- **#6: Can't delete branch used by a worktree** -- Preserve artifacts and integrate locally before safe worktree removal.
- **#9: Push rejected (non-fast-forward)** -- Reconcile integration history locally, then revalidate before authorized publication.
- **#11: `git worktree remove` fails on untracked files** -- Inspect dirty files and ownership; preserve work instead of forcing removal.
- **#15: `git branch -d` fails on worktree branches** -- Use -d after proving local integration; retain unmerged work.
- **#18: Git commands fail with no commits yet** -- check for commits before `git log`/`diff`; handle the empty-repo case.
- **#25: No upstream tracking** -- Keep working branches local; only authorized completed integration gets pushed.
- **#33: `pull --rebase` fails on dirty tree** -- commit or stash before `git pull --rebase`.
- **#44: `push --tags` pushes ALL tags** -- Push only the explicitly named authorized release tag.
- **#48: Commit/push to wrong branch** -- run `git branch --show-current` before every commit.
- **#54: `git checkout --` fails on unmerged files** -- use `--ours`/`--theirs`, or abort the merge/rebase/cherry-pick.
- **#55: `git merge` blocked by untracked files** -- Preserve and compare conflicting untracked content before merging.

## GitHub CLI

- **#4: Wrong `--json` field names** -- query available fields per subcommand first; don't guess across commands.
- **#10: Multiple PR checks jumbled in one command** -- Inspect each check and workflow; do not discard a check by name.
- **#20: `gh release create --body`** -- wrong flag; releases use `--notes`, not `--body`.
- **#23: Fabricated repo/resource names** -- discover identifiers by querying (`gh repo list`, `gh issue list --search`), never guess.
- **#30: `gh pr create` before pushing** -- Do not publish feature branches merely to create PRs.
- **#31: Guessed CLI flags on unfamiliar tools** -- check `--help` before using a flag on a CLI you haven't verified.
- **#32: `gh pr merge` fails (method/policy/auto-merge)** -- check repo settings via `gh api` before choosing a merge flag.
- **#35: `gh pr checks` exit 0 with pending checks** -- Pending exits 8; inspect bucket and the expected check inventory.
- **#39: "Projects (classic) deprecated" GraphQL error** -- `brew upgrade gh` / your package manager; it's a client version problem.
- **#52: Assumed GitHub labels exist** -- `gh label list` first; create missing labels before using them.
- **#53: `gh pr create` without checking for an existing PR** -- `gh pr list --head --base` first; edit if one already exists.

## CI & Deployment

- **#12: Push and forget, CI breaks silently** -- Inspect expected workflows on the authorized pushed commit; no remote debugging loop.
- **#50: Test suite skipped after config changes** -- run the full suite immediately after any config/infra change.
- **#51: CI explosion from parallel agent pushes** -- Keep agents local and publish completed verified integration once.
- **#56: Merge to `main` without deployment topology** -- confirm whether `main` deploys to production before merging (e.g. Dependabot PRs).
- **#57: Sequential merge cascade (O(n^2) rebase storm)** -- Batch verified changes in local integration, without a hosted merge loop.
- **#58: Deploy without preview verification** -- Verify locally, including runtime and platform packaging; never create Previews.
- **#59: Improvised production recovery** -- roll back immediately; investigate separately; never deploy to diagnose.
- **#60: All dependency updates treated as equal risk** -- classify risk by dep type/bump/scope before choosing verification depth.

## Python/macOS

- **#21: `pip3 install` externally-managed-environment** -- use `brew`, `pipx`, or a venv instead of system `pip3` on macOS.
- **#26: Complex shell regex fails in zsh** -- Separate shell quoting from unsupported flags; macOS grep lacks -P.
- **#29: `uv sync` picks a Python too new for packages** -- pin `.python-version` or pass `--python <version>`.
- **#37: Scheduled agent silently fails under launchd** -- inspect actual limits, environment and supported non-interactive auth; no universal four-fix requirement.
- **#38: Claude CLI crashes ("Unexpected") from plist script** -- reproduce the version-bound failure before applying the historical exec wrapper.
- **#40: `python3` used instead of `uv run python`** -- always invoke Python through the project's dependency manager.
- **#41: Over-escaped `!=` as `\!=` in inline Python** -- use single-quoted shell strings; don't escape operators inside them.
- **#42: Package-relative import fails without `-m`** -- run as a module (`python -m pkg.mod`) or install the package with `-e .`.

## Supabase

- **#61: Silent fallback masks production data failure** -- add error-level logging, a real health check, and alerting to any fallback path.
- **#62: Supabase migration pushed without local test** -- test grants/RLS with `supabase db reset --local`; remote application is separate.

## Multi-Agent

- **#19: API content filter blocks parallel file creation** -- inspect each result and isolate an observed blocked write; no universal filename restriction.
- **#49: Sub-agent git conflicts from parallel work** -- each sub-agent owns distinct files; only the main agent commits/pushes.
- **#63: Parallel agents exhaust local resources running full test suites** -- scope tests to changed files; keep at most three implementers in the current phase, with lower resource limits as needed.

## Process

- **#5: ESM CLI run with `node dist/index.js`** -- Node supports ESM hashbangs; inspect module format and malformed generated bytes.
- **#7: `execSync(...).trim is not a function`** -- pass `{ encoding: 'utf-8' }` or call `.toString()`; exec output is a Buffer.
- **#13: Skipping TDD** -- write the failing test first; Red-Green-Refactor.
- **#14: Suggesting manual steps instead of using tools** -- exhaust CLI, browser automation, and MCP tools before asking the user.
- **#27: Linter runs on wrong file types or fights intentional patterns** -- filter by extension; don't "fix" documented intentional formatting.
- **#28: Manually fixing auto-fixable linter issues** -- run the linter with `--fix` first; only hand-edit what it can't auto-fix.
- **#34: WebFetch 403, agent retries same domain** -- 403 refuses this request; inspect the cause rather than infer domain-wide blocking.
- **#43: JSON list indexed with a string key** -- inspect `type(data)` and a sample before assuming dict vs list shape.
- **#46: Scaffolding tool fails on non-empty directory** -- scaffold first in a clean directory, add config files after.
- **#47: API response piped to JSON parser unchecked** -- Check transport and HTTP status; curl pipelines need pipefail.
- **#64: Finding's recommendation implemented literally, breaking an unchecked invariant** -- verify the recommendation's assumptions in real code, guard the invariant not the symptom, halt and escalate on an unsafe trade.
