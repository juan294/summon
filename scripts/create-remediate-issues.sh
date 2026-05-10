#!/usr/bin/env bash
# Creates all 108 pre-launch remediation issues.
# Run once; idempotent (skips if title already exists).
set -euo pipefail

create_issue() {
  local title="$1" body="$2" labels="$3"
  echo "Creating: $title"
  gh issue create --title "$title" --body "$body" --label "$labels"
  sleep 0.5
}

# ─── WAVE 1: Before Launch ───────────────────────────────────────────────────

create_issue \
  "[remediate] BE-B1 executeOnStart runs untrusted project .summon strings via execSync" \
  "**Finding ID:** BE-B1
**Severity:** launch-blocker | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/launcher.ts:557-565, src/launcher.ts:739-741
**What's happening:** \`on-start\` value from a project \`.summon\` file flows into \`execSync(onStart, { cwd: targetDir, stdio: \"inherit\" })\`. The only gate (\`confirmDangerousCommands\`) only triggers on shell-metacharacter presence — a clean binary path like \`do-evil-thing --silent\` executes silently.
**Why it matters:** \`cd repo && summon\` is a remote code execution vector. Any public repo shipping a \`.summon\` can exploit this.
**Recommendation:** Require explicit per-repo opt-in (e.g. \`summon trust .\` writes a \`.summon\` content hash). Default: refuse \`on-start\` from unregistered project files.
**Expected impact:** Closes the primary one-clone RCE vector.
**Effort estimate:** M" \
  "launch-blocker,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-B2 pane.*/editor/sidebar from project .summon execute without trust gate" \
  "**Finding ID:** BE-B2
**Severity:** launch-blocker | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/launcher.ts:719-737, src/script.ts:43-46, src/script.ts:52-54
**What's happening:** All project-config commands flow into AppleScript \`input text\` and are executed by the shell. \`confirmDangerousCommands\` only fires for metacharacter-bearing values — a bare malicious path (\`/tmp/evil\`) runs silently with no prompt.
**Why it matters:** Broader than BE-B1: covers editor, sidebar, shell, and all pane commands. Same one-clone exploit surface.
**Recommendation:** All commands from project \`.summon\` require the same trust-gate as BE-B1. Display full resolved command set and require confirm-or-allowlist; remember hash for subsequent runs.
**Expected impact:** Removes implicit-trust surface from project-local config.
**Effort estimate:** M" \
  "launch-blocker,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-B3 CRLF normalization missing — Windows-authored .summon files corrupt key parsing" \
  "**Finding ID:** BE-B3
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/config.ts:48-54, src/config.ts:62-68
**What's happening:** \`readKVFile\` splits on \`\\n\` only; CRLF files leave \`\\r\` on every value. \`editor=code\\r\` feeds into AppleScript as \`input text \"code\\r\"\`. \`pane.foo\\r\` silently fails \`PANE_NAME_RE\`.
**Why it matters:** Silent, non-actionable failure on a cross-platform file format.
**Recommendation:** Normalize line endings on read: \`content.replace(/\\r\\n?/g, \"\\n\")\`; trim both sides of values.
**Expected impact:** Predictable cross-platform behavior.
**Effort estimate:** S" \
  "high,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-B4 addProject writes without validating name or resolving path" \
  "**Finding ID:** BE-B4
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/config.ts:76-80
**What's happening:** \`addProject(name, path)\` accepts arbitrary name (can contain \`=\`, breaking round-trip) and path (not resolved, not verified to exist). Names with \`=\` parse incorrectly on read; relative paths break \`resolveProjectName\` after a \`cd\`.
**Why it matters:** Silent bugs: project doesn't match on the next launch after registration from a different cwd.
**Recommendation:** Validate name with \`PROJECT_NAME_RE\`; \`resolve()\` and normalize path before persisting.
**Effort estimate:** S" \
  "high,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-H5 Cleanup trap swallows on-stop and snapshot errors silently" \
  "**Finding ID:** BE-H5
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/script.ts:97-117
**What's happening:** Both the on-stop command and \`summon snapshot save\` pipe stderr to \`/dev/null\`. If \`summon\` isn't on PATH in the trap's shell environment, snapshot is silently lost.
**Why it matters:** Users silently lose snapshot/restore data with no diagnostic.
**Recommendation:** Log to \`~/.config/summon/logs/cleanup-<project>.log\` instead of \`/dev/null\`.
**Effort estimate:** S" \
  "high,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-H6 readStatus mutates filesystem (GC stale markers) — racy with cleanup trap" \
  "**Finding ID:** BE-H6
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/status.ts:140-146
**What's happening:** \`readStatus\` calls \`clearStatusArtifacts\` when \`markerExists && !active\`. This is called from \`readAllStatuses\` in TUI refresh — a read operation with filesystem side effects. The GC races with the AppleScript cleanup trap also trying to remove the same files.
**Why it matters:** Race window where a still-shutting-down workspace has its markers deleted mid-cleanup.
**Recommendation:** Make \`readStatus\` pure; move GC to dedicated \`cleanStaleStatuses\` gated by a time-since-last-touch threshold.
**Effort estimate:** S" \
  "high,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-H8 Custom-layout parse failures are silently discarded" \
  "**Finding ID:** BE-H8
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/launcher.ts:330-338, src/validation.ts:47-57
**What's happening:** Invalid \`editor-size\`/\`font-size\`/\`panes\` values in custom layout files are silently dropped with no warning. The same values from CLI/project/machine config emit a warning. Inconsistent.
**Why it matters:** Users edit \`~/.config/summon/layouts/foo\`, mistype, and get default behavior with no clue why.
**Recommendation:** Emit warnings in \`resolveLayoutBase\` matching the warnings in \`layerConfigValues\`.
**Effort estimate:** S" \
  "high,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-M11 pickConfigValue treats empty string as unset — cannot clear global config at project level" \
  "**Finding ID:** BE-M11
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/launcher.ts:301-310
**What's happening:** \`project.get(projKey) || machineConfig.get(projKey)\` — a project value of \`\"\"\` falls through to machine config. There is no way to clear a globally set value at the project level.
**Why it matters:** Power users with a global \`sidebar=lazygit\` can't suppress the sidebar for a specific project.
**Recommendation:** Change to \`project.has(projKey) ? project.get(projKey) : machineConfig.get(projKey)\`. Document \`key=\` as clear.
**Effort estimate:** S" \
  "medium,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-M13 decideCleanRestoredPanes closes user's non-summon-owned panes" \
  "**Finding ID:** BE-M13
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/launcher.ts:511-539, src/script.ts:254-264
**What's happening:** Pane probe counts all terminals in the front window's selected tab. If >1, closes extras without checking whether they're summon-owned. Default \`clean=true\` makes this happen by default.
**Why it matters:** Silent data loss (running processes, unsaved work) on every launch when Ghostty has pre-existing panes.
**Recommendation:** Only auto-clean when the front-window tab title matches a known summon \`[<project>]\` marker. Otherwise prompt or skip.
**Effort estimate:** M" \
  "medium,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-M16 briefing.ts omits gitSafeEnv() — incorrect output from git hooks" \
  "**Finding ID:** BE-M16
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/briefing.ts:60-87, src/utils.ts:142-145
**What's happening:** \`briefing.ts\` calls \`git -C dir log/status\` without \`env: gitSafeEnv()\`. When invoked from a pre-commit hook (where \`GIT_DIR\` is exported), all project briefings show data from the originating repo.
**Why it matters:** Silently incorrect output; fix already exists in \`status.ts\` and \`snapshot.ts\`.
**Recommendation:** Pass \`env: gitSafeEnv()\` to both \`execFileSync\` calls.
**Effort estimate:** S" \
  "medium,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-M19 readStatus doesn't validate JSON field types — TUI crashes on malformed files" \
  "**Finding ID:** BE-M19
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/status.ts:115-156
**What's happening:** Only \`version === 1 && source === \"summon\"\` is checked. A maliciously crafted or corrupted JSON with a string \`pid\` will cause \`kill(pid, 0)\` to throw and crash the TUI.
**Why it matters:** The monitor TUI is crash-prone to a file a user might easily corrupt by manually editing.
**Recommendation:** Add a \`parseWorkspaceStatus(unknown): ResolvedStatus | null\` shape validator type-guarding each field.
**Effort estimate:** S" \
  "medium,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-M21 Tree DSL parser: no escape support in quoted strings, no nesting depth limit" \
  "**Finding ID:** BE-M21
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/tree.ts:71-87, src/tree.ts:114-188
**What's happening:** Quoted tokens don't support \`\\\"\` escaping. Unbounded nesting depth can blow the recursion stack on a pathological config.
**Why it matters:** Crash instead of informative error for malformed user configs.
**Recommendation:** Document quoting limitations; add max nesting depth (e.g. 32) with informative error.
**Effort estimate:** S" \
  "medium,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] BE-M22 Tree pane cwd accepts paths outside targetDir" \
  "**Finding ID:** BE-M22
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** backend
**Files:** src/tree.ts:260-269, src/script.ts:400
**What's happening:** \`pane.foo.cwd = ../../etc\` resolves relative to \`targetDir\` with no check that the result stays within the project directory. Combined with BE-B2, extends the attack surface.
**Recommendation:** Reject resolved cwds that don't start with \`targetDir\`, or surface them in \`confirmDangerousCommands\`.
**Effort estimate:** S" \
  "medium,backend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] FE-H1 First-run wizard triggered by typo'd subcommands" \
  "**Finding ID:** FE-H1
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** frontend
**Files:** src/index.ts:75-83
**What's happening:** First-run gate skips wizard only when \`parsed.subcommand && hasSubcommandHelp(parsed.subcommand)\`. Any unknown token (typo, valid subcommand missing from \`SUBCOMMAND_HELP\`) triggers the setup wizard instead of an error.
**Why it matters:** A user who typo's a subcommand gets a wizard; erodes trust on first exposure.
**Recommendation:** Gate wizard on \`parsed.subcommand === undefined\` only; validate any supplied positional before invoking setup.
**Expected impact:** Predictable first-run behavior; typos surface immediately.
**Effort estimate:** S" \
  "high,frontend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] FE-H2 --help for unknown subcommands silently shows global help" \
  "**Finding ID:** FE-H2
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** frontend
**Files:** src/index.ts:66-72
**What's happening:** \`summon foo --help\` shows global help with no \"unknown command\" error when \`foo\` isn't in \`SUBCOMMAND_HELP\`.
**Why it matters:** Users won't notice they've typo'd a subcommand; they see valid-looking help and assume the command is undocumented.
**Recommendation:** When \`parsed.subcommand\` is set, not in registry, and not a directory, print \"Unknown command: foo\" before falling back.
**Effort estimate:** S" \
  "high,frontend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] FE-H3 Mutually exclusive flags warn instead of error" \
  "**Finding ID:** FE-H3
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** frontend
**Files:** src/cli/parse.ts:341-346
**What's happening:** \`--auto-resize --no-auto-resize\` (and \`--clean\`/\`--no-clean\`) emit \`console.warn\` and silently use the negative form. Scripted invocations won't notice.
**Why it matters:** Hides configuration mistakes; non-deterministic behavior in shell aliases.
**Recommendation:** Reject conflicting flags via \`exitWithUsageHint\`.
**Effort estimate:** S" \
  "high,frontend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] FE-H4 buildOverrides truthiness check drops explicit empty or zero values" \
  "**Finding ID:** FE-H4
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** frontend
**Files:** src/cli/parse.ts:352-374
**What's happening:** \`if (values.editor) overrides.editor = ...\` swallows \`--editor=\"\"\` and \`--font-size 0\`. CLI claims highest priority but silently drops edge inputs.
**Why it matters:** Subtle bugs around edge values; override layer claim is untrue for falsy-but-valid inputs.
**Recommendation:** Use \`if (values.X !== undefined)\` consistently.
**Effort estimate:** S" \
  "high,frontend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] FE-H5 No fish shell completion" \
  "**Finding ID:** FE-H5
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** frontend
**Files:** src/completions.ts:1-270, src/cli/parse.ts:170-174
**What's happening:** Only zsh and bash completions are generated. Fish is unsupported — a significant gap for a tool targeting Ghostty users.
**Why it matters:** Fish is a popular default among the core Ghostty audience; launch-day reviews will note the omission.
**Recommendation:** Add minimal \`generateFishCompletion()\`.
**Effort estimate:** M" \
  "high,frontend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] FE-H6 Monitor Enter handler races: resolve() fires before launch() settles" \
  "**Finding ID:** FE-H6
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** frontend
**Files:** src/monitor.ts:319-334
**What's happening:** \`resolve()\` is called before \`await import('./launcher.js')\` and \`await launch(...)\`. The launch promise is detached; errors swallow into \`process.exit(1)\` without bubbling.
**Why it matters:** Errors from launching a workspace from the TUI are silently lost.
**Recommendation:** \`await import\` and \`await launch\` before \`resolve()\`; propagate errors through the promise.
**Effort estimate:** S" \
  "high,frontend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] FE-M1 Help text has correctness inconsistencies" \
  "**Finding ID:** FE-M1
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** frontend
**Files:** src/cli/parse.ts:43-137
**What's happening:** \`on-stop\` listed as config key but has no \`--on-stop\` CLI flag; btop description doesn't match the diagram in setup.ts:592; \`--env\` \"(repeatable)\" annotation inconsistent; \`switch\` documented as \"alias for open\" but SUBCOMMAND_HELP implies different behavior.
**Why it matters:** Mismatched help vs. behavior erodes trust on day one.
**Recommendation:** Audit help against actual flag list; add \`--on-stop\` or remove from key list; align btop description; clarify switch/open relationship.
**Effort estimate:** S" \
  "medium,frontend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] FE-M4 Raw-mode TUI lacks emergency cleanup on uncaught exception" \
  "**Finding ID:** FE-M4
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** frontend
**Files:** src/monitor.ts:261-281, src/setup.ts:272-289
**What's happening:** \`runMonitor\` and \`runGridBuilder\` enter alt-screen/raw mode. An uncaught exception bypasses cleanup sequences (\`SHOW_CURSOR + EXIT_ALT_SCREEN\`), leaving the terminal in raw mode with hidden cursor.
**Why it matters:** Hard-to-recover terminal state on any render-loop crash.
**Recommendation:** Register \`process.once(\"exit\")\` and \`process.on(\"uncaughtException\")\` to emit cleanup sequences.
**Effort estimate:** S" \
  "medium,frontend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] FE-M5 promptUser Ctrl+C calls process.exit(130) directly, bypassing caller cleanup" \
  "**Finding ID:** FE-M5
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** frontend
**Files:** src/utils.ts:32-48
**What's happening:** \`rl.on(\"close\", onClose)\` calls \`process.exit(130)\`, killing the process before any caller \`finally\` can run. In mid-wizard contexts, partial state is abandoned.
**Why it matters:** Graceful cancel is impossible from a shared low-level helper.
**Recommendation:** Throw a typed \`PromptCancelled\` error; let wizard top-level catch and exit cleanly.
**Effort estimate:** M" \
  "medium,frontend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] FE-M7 Help block doesn't mention tree DSL or summon help <topic>" \
  "**Finding ID:** FE-M7
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** frontend
**Files:** src/cli/parse.ts:119-124
**What's happening:** Tree DSL is mentioned but not described; there's no \`summon layout --help\` topic or doc link.
**Why it matters:** Power feature that's nearly undiscoverable from the CLI.
**Recommendation:** Add \`summon layout --help\` with DSL examples; add \"see also\" pointer in global help.
**Effort estimate:** S" \
  "medium,frontend,wave-1-before-launch,remediate"

create_issue \
  "[remediate] PE-M3 Inline source maps shipped to npm — 2-3x the necessary install size" \
  "**Finding ID:** PE-M3
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** performance
**Files:** tsup.config.ts:11
**What's happening:** \`sourcemap: \"inline\"\` embeds full base64 sourcemaps into every dist chunk. \`dist/index.js\` is ~136 KB; actual code is ~50 KB.
**Why it matters:** Roughly 2-3x download/install footprint for a globally-installed CLI; inflates parse cost on cold start.
**Recommendation:** Switch to \`sourcemap: true\` (external \`.js.map\`) excluded from the \`files\` field.
**Expected impact:** ~50-60% smaller installed footprint.
**Effort estimate:** S" \
  "medium,performance,wave-1-before-launch,remediate"

create_issue \
  "[remediate] DO-H1 Release pipeline publishes without verifying the packed tarball" \
  "**Finding ID:** DO-H1
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** devops-sre
**Files:** .github/workflows/release.yml:11-28
**What's happening:** After build, \`npm publish --access public\` runs immediately. No \`npm pack\` + tarball inspection, no \`npm publish --dry-run\`, no smoke \`npm i -g ./tarball && summon --version\`.
**Why it matters:** Misconfigured \`files\` field, missing shebang, or broken \`bin\` only discovered by users after publish. npm versions are immutable.
**Recommendation:** Add steps: \`npm pack\` → tarball content check → \`npm i -g ./summon-ws-*.tgz && summon --version\` → \`npm publish ./summon-ws-*.tgz\`.
**Effort estimate:** S" \
  "high,devops-sre,wave-1-before-launch,remediate"

create_issue \
  "[remediate] DO-H2 npm provenance disabled — no supply-chain attestation" \
  "**Finding ID:** DO-H2
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** devops-sre
**Files:** .github/workflows/release.yml:26, CHANGELOG.md:39
**What's happening:** CHANGELOG notes \`--provenance\` was removed and \`NODE_AUTH_TOKEN\` restored. Long-lived token used instead of OIDC trusted publishing. No Sigstore attestation on npm registry page.
**Why it matters:** Supply-chain trust depends entirely on token secrecy. Security-conscious reviewers will note absence of provenance badge.
**Recommendation:** Retry OIDC publishing: add \`id-token: write\` permission, configure trusted publisher on npmjs.com, drop \`NODE_AUTH_TOKEN\`, add \`--provenance --access public\`.
**Effort estimate:** M" \
  "high,devops-sre,wave-1-before-launch,remediate"

create_issue \
  "[remediate] DO-H3 GitHub Actions pinned to floating major tags on release workflow" \
  "**Finding ID:** DO-H3
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** devops-sre
**Files:** .github/workflows/release.yml:14-15, .github/workflows/ci.yml:20-21, .github/workflows/codeql.yml:19-23, .github/workflows/dependency-review.yml:14-16
**What's happening:** All third-party actions use floating tags (\`actions/checkout@v6\`, \`actions/setup-node@v6\`, etc.). A compromised \`@v6\` tag on the release workflow could exfiltrate \`NPM_TOKEN\`.
**Why it matters:** Highest-leverage supply-chain hardening for the publish pipeline.
**Recommendation:** Pin all actions to full SHA with version comment. Dependabot understands SHA pins.
**Effort estimate:** S" \
  "high,devops-sre,wave-1-before-launch,remediate"

create_issue \
  "[remediate] DO-H4 No environment protection or required reviewers on publish job" \
  "**Finding ID:** DO-H4
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** devops-sre
**Files:** .github/workflows/release.yml:10-28
**What's happening:** Publish job runs immediately when a Release is published with no \`environment:\` gate, no required reviewer, no branch policy restriction, and no \`concurrency:\` group.
**Why it matters:** Anyone with write + release access publishes to npm without additional approval.
**Recommendation:** Create \`npm-publish\` GitHub environment scoped to \`v*\` tags with required reviewer. Add \`concurrency: { group: npm-publish, cancel-in-progress: false }\`.
**Effort estimate:** S" \
  "high,devops-sre,wave-1-before-launch,remediate"

create_issue \
  "[remediate] DO-M1 CI matrix dropped Node 18 but package advertises engines >=18" \
  "**Finding ID:** DO-M1
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** devops-sre
**Files:** .github/workflows/ci.yml:17-18, package.json:54-56, tsup.config.ts:9, README.md:23
**What's happening:** CI matrix is \`[20, 22]\` (Vite 8 requires Node 20.19+/22.12+), but \`engines.node\`, tsup target, README, and CLAUDE.md all say \`>=18\`. Node 18 users install and get unverified behavior.
**Why it matters:** Documentation/reality drift; users on Node 18 file unproducible bugs.
**Recommendation:** Bump \`engines.node\` to \`>=20.19\` and update tsup target, README, and CLAUDE.md.
**Effort estimate:** S" \
  "medium,devops-sre,wave-1-before-launch,remediate"

create_issue \
  "[remediate] DO-M3 CHANGELOG [Unreleased] has substantial features, no automated sync gate" \
  "**Finding ID:** DO-M3
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** devops-sre
**Files:** CHANGELOG.md:8-51, package.json:3, docs/publishing.md
**What's happening:** CHANGELOG has significant features (briefing, status TUI, ports, snapshot) under \`[Unreleased]\` while package.json is still \`1.3.0\`. No CI check validates CHANGELOG version matches package.json at release time.
**Recommendation:** Add CI check on tag push: CHANGELOG must contain \`## [<package.json version>] - YYYY-MM-DD\`. Add \"promote Unreleased section\" as step #0 in docs/publishing.md.
**Effort estimate:** S" \
  "medium,devops-sre,wave-1-before-launch,remediate"

create_issue \
  "[remediate] DO-M4 Release workflow doesn't verify tag matches package.json version" \
  "**Finding ID:** DO-M4
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** devops-sre
**Files:** .github/workflows/release.yml:5-26
**What's happening:** No assertion that \`package.json.version == github.event.release.tag_name (sans v)\`. A mistaken tag publishes the wrong version. npm versions are immutable.
**Recommendation:** Add version verification step: \`[ \"\$(node -p \"require('./package.json').version\")\" = \"\${GITHUB_REF_NAME#v}\" ]\`.
**Effort estimate:** S" \
  "medium,devops-sre,wave-1-before-launch,remediate"

create_issue \
  "[remediate] DO-L1 README badge fetches from third-party tracker domain" \
  "**Finding ID:** DO-L1
**Severity:** low | **Wave:** wave-1-before-launch | **Domain:** devops-sre
**Files:** README.md:3
**What's happening:** First badge is \`https://chapa.thecreativetoken.com/u/juan294/badge.svg\` — leaks referer headers to npmjs.com visitors.
**Recommendation:** Remove or replace with a GitHub Actions badge.
**Effort estimate:** S" \
  "low,devops-sre,wave-1-before-launch,remediate"

create_issue \
  "[remediate] DO-L3 No SECURITY.md / vulnerability disclosure process" \
  "**Finding ID:** DO-L3
**Severity:** low | **Wave:** wave-1-before-launch | **Domain:** devops-sre
**Files:** repo root (no SECURITY.md)
**What's happening:** No \`SECURITY.md\` advising researchers how to report vulnerabilities. Without it, researchers file public issues, immediately exposing 0-days.
**Recommendation:** Add SECURITY.md with private GH advisory reporting link. Enable GitHub \"Private vulnerability reporting\".
**Effort estimate:** S" \
  "low,devops-sre,wave-1-before-launch,remediate"

create_issue \
  "[remediate] SE-H1 Auto-discovered .summon files execute commands without allowlist" \
  "**Finding ID:** SE-H1
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** security
**Files:** src/launcher.ts:437-445, src/launcher.ts:152-177, src/launcher.ts:557-565
**What's happening:** \`.summon\` is loaded silently; only metacharacter-containing values prompt. A clean malicious value like \`editor=/tmp/evil\` runs with no warning. No direnv-style allow step exists.
**Why it matters:** The \"clone repo, cd in, run tool\" attack. All other tools that auto-load per-project config (direnv, mise) require an explicit allow precisely because of this.
**Recommendation:** Implement a direnv-style allowlist: hash \`.summon\` content on first use; require \`summon allow .\`; refuse to load otherwise.
**Effort estimate:** M" \
  "high,security,wave-1-before-launch,remediate"

create_issue \
  "[remediate] SE-H2 on-stop uses unnecessary eval wrapper in cleanup trap" \
  "**Finding ID:** SE-H2
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** security
**Files:** src/script.ts:97-99
**What's happening:** \`eval \"\${shellDoubleQuote(options.onStop)}\" 2>/dev/null\` double-evaluates the on-stop command. \`shellDoubleQuote\` escapes \`\$()\` and backticks, but routing through \`eval\` means any future quoting bug becomes RCE.
**Why it matters:** Unnecessary \`eval\` turns a future quoting regression into execution; \`2>/dev/null\` additionally hides any error.
**Recommendation:** Drop the \`eval\` wrapper. Inline on-stop as the body of \`__summon_cleanup\`. Drop \`2>/dev/null\` to surface errors.
**Effort estimate:** S" \
  "high,security,wave-1-before-launch,remediate"

create_issue \
  "[remediate] SE-M1 confirmDangerousCommands wording is misleading under attack" \
  "**Finding ID:** SE-M1
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** security
**Files:** src/launcher.ts:736-741
**What's happening:** Warning text says \"config contains commands with shell metacharacters\" — framed as a quoting-quality warning. Under attacker control of \`.summon\`, users don't understand they're authorizing code execution.
**Why it matters:** Prompt framing doesn't match the threat; users type \`y\` without recognizing the security decision.
**Recommendation:** Reword: \"The .summon file in \`<path>\` wants to run: \`<list>\`. Run it? [y/N]\". Show source path. Show prompt for ALL project-config commands, not only metacharacter-bearing ones.
**Effort estimate:** S" \
  "medium,security,wave-1-before-launch,remediate"

create_issue \
  "[remediate] SE-M2 resolveCommand shells out via /bin/sh -c — regex is the only safety barrier" \
  "**Finding ID:** SE-M2
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** security
**Files:** src/utils.ts:75-84
**What's happening:** \`execFileSync(\"/bin/sh\", [\"-c\", \`command -v \"\$1\"\`, \"--\", cmd])\`. \`SAFE_COMMAND_RE\` is the only barrier. A future relaxation of the regex removes the only barrier between user data and \`/bin/sh -c\`.
**Recommendation:** Replace with \`execFileSync(\"/usr/bin/which\", [cmd])\` or walk PATH manually — no shell needed for PATH lookup.
**Effort estimate:** S" \
  "medium,security,wave-1-before-launch,remediate"

create_issue \
  "[remediate] SE-M3 Env-var values from project config not validated — DYLD_INSERT_LIBRARIES attack" \
  "**Finding ID:** SE-M3
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** security
**Files:** src/config.ts:62-68, src/launcher.ts:262-296, src/script.ts:73-86
**What's happening:** A \`.summon\` with \`env.DYLD_INSERT_LIBRARIES=/tmp/evil.dylib\` passes all checks (no shell metacharacters, valid env key format). The dylib gets exported into the workspace root pane and propagates to every process.
**Why it matters:** No-shell-metacharacter RCE via env-only attack on macOS. Bypasses \`confirmDangerousCommands\` entirely.
**Recommendation:** Denylist dangerous env keys (\`DYLD_*\`, \`LD_*\`, \`PATH\`, \`NODE_OPTIONS\`, \`BASH_ENV\`, \`PYTHONSTARTUP\`, \`PROMPT_COMMAND\`, etc.) from \`.summon\`. Allow only from CLI \`--env\`.
**Effort estimate:** S" \
  "medium,security,wave-1-before-launch,remediate"

create_issue \
  "[remediate] SE-L1 Path-traversal guard uses prefix without trailing separator" \
  "**Finding ID:** SE-L1
**Severity:** low | **Wave:** wave-1-before-launch | **Domain:** security
**Files:** src/snapshot.ts:24-30, src/config.ts:144-150
**What's happening:** \`resolve(filePath).startsWith(resolve(LAYOUTS_DIR))\` without trailing \`/sep\`. A path like \`layouts-evil/x\` starts with \`layouts\` and would pass.
**Recommendation:** \`resolve(filePath).startsWith(resolve(LAYOUTS_DIR) + sep)\`.
**Effort estimate:** S" \
  "low,security,wave-1-before-launch,remediate"

create_issue \
  "[remediate] UX-H1 Help text and README disagree about flags and config keys" \
  "**Finding ID:** UX-H1
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** ux
**Files:** src/cli/parse.ts:43-137, README.md:109-158
**What's happening:** \`on-stop\` is documented as a config key in both help and README but has no \`--on-stop\` CLI flag. No \"config-only, no CLI flag\" notice for these keys. Users will try \`summon . --on-stop \"...\"\` and get a confusing error.
**Why it matters:** Users compare help to README; gaps look like bugs on day one.
**Recommendation:** Add \"Available only as config keys (no CLI flag):\" sentence listing \`on-stop\`, \`env.<KEY>\`. Consider adding \`--on-stop\` for parity with \`--on-start\`.
**Effort estimate:** S" \
  "high,ux,wave-1-before-launch,remediate"

create_issue \
  "[remediate] UX-H2 Help text dumps 95 lines with no information hierarchy" \
  "**Finding ID:** UX-H2
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** ux
**Files:** src/cli/parse.ts:43-137
**What's happening:** 19 subcommands, 22 flags, 16 config keys in one flat dump. No grouping, no \`summon help <topic>\` advertised, no pointer to docs.
**Why it matters:** Power features (briefing, ports, snapshot) are buried in alphabetical noise. First-time users are overwhelmed.
**Recommendation:** Group subcommands (Launch / Projects / Config / Workspaces / Diagnostics / Layouts). Add \"Tip: run 'summon <command> --help' for details.\" Add docs link.
**Effort estimate:** S" \
  "high,ux,wave-1-before-launch,remediate"

create_issue \
  "[remediate] UX-H3 First-run wizard doesn't mention skip option or re-run path" \
  "**Finding ID:** UX-H3
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** ux
**Files:** src/index.ts:75-83, src/setup.ts:1001-1082, src/setup.ts:641-672
**What's happening:** Wizard auto-starts on any TTY with no \"Press Ctrl+C to skip\" or \"re-run with \`summon setup\`\" hint. Accessibility prompt runs before the user has agreed to proceed.
**Recommendation:** Add a one-liner after \`printWelcome\`: \"Press Ctrl+C anytime; re-run later with \`summon setup\`.\" Move accessibility prompt post-agreement.
**Effort estimate:** S" \
  "high,ux,wave-1-before-launch,remediate"

create_issue \
  "[remediate] UX-H4 Normal operational messages sent to stderr" \
  "**Finding ID:** UX-H4
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** ux
**Files:** src/launcher.ts:118,441,443,537,558
**What's happening:** \`console.warn\` (stderr) used for \"Summoning workspace...\", \"Using project config:\", \"Clearing N stale panes...\", \"Running on-start:\". These are informational, not warnings.
**Why it matters:** Pipelines and CI integrations treat normal output as errors. Real warnings get lost in the noise.
**Recommendation:** Move informational lines to stdout; reserve \`console.warn\` for actual warnings. Add \`--quiet\` flag.
**Effort estimate:** S" \
  "high,ux,wave-1-before-launch,remediate"

create_issue \
  "[remediate] UX-H5 Inconsistent error/affordance prefixes and ANSI glyph vocabulary" \
  "**Finding ID:** UX-H5
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** ux
**Files:** src/launcher.ts:93,123,689,705; src/commands/project.ts:44,67,84,112; src/commands/doctor.ts:25,62,66; src/setup.ts:934,937,946,963
**What's happening:** Mixed conventions: \`Error: ...\`, unprefixed sentences, plain \`+\`/\`-\` (doctor), colored ✓/! (setup), colored ●/○ (monitor). Three visual languages in one product.
**Recommendation:** Define \`ok()\`, \`warn()\`, \`err()\`, \`info()\` helpers with consistent glyph+color (✓ green, ! yellow, ✗ red, → cyan/dim). Migrate all ad-hoc patterns.
**Effort estimate:** M" \
  "high,ux,wave-1-before-launch,remediate"

create_issue \
  "[remediate] UX-H6 summon open and summon status show same data with incompatible table layouts" \
  "**Finding ID:** UX-H6
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** ux
**Files:** src/commands/project.ts:62-97, src/monitor.ts:69-99, src/monitor.ts:216-231
**What's happening:** \`open\` uses readline numbered selection with hardcoded padding (project.ts:72); \`status\` uses raw-mode TUI with \`renderRow\`. Columns don't align; headers differ.
**Recommendation:** Extract shared \`renderProjectTable({ withIndex, header })\` function computing padding from actual lengths.
**Effort estimate:** M" \
  "high,ux,wave-1-before-launch,remediate"

create_issue \
  "[remediate] UX-H7 Monitor TUI: j/k undiscovered, no empty state, no ? help key" \
  "**Finding ID:** UX-H7
**Severity:** high | **Wave:** wave-1-before-launch | **Domain:** ux
**Files:** src/monitor.ts:101-105, src/monitor.ts:283-338
**What's happening:** Footer only shows \`↑↓ navigate  ⏎ open  r refresh  q quit\` — omits \`j/k\` and \`Ctrl-C\`. No \`?\` overlay. Zero-projects TUI shows an empty skeleton with no guidance.
**Recommendation:** Update footer to \`↑↓/jk · ⏎ open · r refresh · ? help · q quit\`; add \`?\` overlay; add empty-state panel.
**Effort estimate:** S" \
  "high,ux,wave-1-before-launch,remediate"

create_issue \
  "[remediate] UX-M4 summon doctor buries issue count — no actionable summary line" \
  "**Finding ID:** UX-M4
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** ux
**Files:** src/commands/doctor.ts:145-154
**What's happening:** Issues printed one per line; only \"Exit code 2: issues were found.\" at the bottom. No issue count, no \"M of N auto-fixable\" summary.
**Recommendation:** Track totals: \"Found N issues (M auto-fixable). Run 'summon doctor --fix' to apply fixes.\" Color title green/red based on result.
**Effort estimate:** S" \
  "medium,ux,wave-1-before-launch,remediate"

create_issue \
  "[remediate] UX-M5 Y/N confirm prompts have inconsistent defaults" \
  "**Finding ID:** UX-M5
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** ux
**Files:** src/setup.ts:495, src/launcher.ts:172,212
**What's happening:** \`confirm()\` in setup uses \`[Y/n]\` (default-yes); dangerous-commands and install prompts use \`[y/N]\` (default-no). Different defaults with same visual weight.
**Recommendation:** Unify into one \`confirm(question, { default: 'yes' | 'no' })\` helper with bold default indicator.
**Effort estimate:** S" \
  "medium,ux,wave-1-before-launch,remediate"

create_issue \
  "[remediate] UX-M7 summon add accepts non-existent paths — success message follows warning" \
  "**Finding ID:** UX-M7
**Severity:** medium | **Wave:** wave-1-before-launch | **Domain:** ux
**Files:** src/commands/project.ts:25-31
**What's happening:** Adds entry even when path doesn't exist; prints \`Warning: path does not exist\` then \`Registered: name → /bad/path\`. Contradictory messages.
**Recommendation:** Either refuse (non-zero exit) unless \`--force\`, or make success line conditional.
**Effort estimate:** S" \
  "medium,ux,wave-1-before-launch,remediate"

create_issue \
  "[remediate] QA-L4 executeOnStart non-TTY rejection test should be explicitly verified" \
  "**Finding ID:** QA-L4
**Severity:** low | **Wave:** wave-1-before-launch | **Domain:** qa-reliability
**Files:** src/launcher.ts:540-565, src/launcher.test.ts:695
**What's happening:** The single \`execSync\` site has documented mitigations. Verify test at \`launcher.test.ts:695\` explicitly covers non-TTY metachar rejection for on-start, including the \`confirmDangerousCommands\` non-TTY abort path.
**Effort estimate:** S" \
  "low,qa-reliability,wave-1-before-launch,remediate"

# ─── WAVE 2: After Launch (now also Before Launch per user request) ───────────

create_issue \
  "[remediate] PE-M1 Config files re-read on every accessor call — redundant disk I/O in TUI refresh" \
  "**Finding ID:** PE-M1
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** performance
**Files:** src/config.ts:38-119, src/launcher.ts:67-71,437-455
**What's happening:** \`listProjects()\`, \`listConfig()\`, \`getConfig()\` each invoke \`readFileSync\` + parse on every call. The TUI refresh loop calls both every 3 seconds.
**Recommendation:** Memoize per process with mtime-based invalidation.
**Effort estimate:** S" \
  "medium,performance,wave-2-after-launch,remediate"

create_issue \
  "[remediate] PE-M2 Monitor TUI full-screen clear on every refresh causes flicker" \
  "**Finding ID:** PE-M2
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** performance
**Files:** src/monitor.ts:243-255,280
**What's happening:** \`render()\` writes \`CLEAR_SCREEN\` + full screen on every 3s tick and every keypress. Causes visible flicker and wastes I/O.
**Recommendation:** Use cursor-home without clear (\`\\x1b[H\`) and write rows in-place; clear only on resize.
**Effort estimate:** M" \
  "medium,performance,wave-2-after-launch,remediate"

create_issue \
  "[remediate] PE-M4 Bundle not minified" \
  "**Finding ID:** PE-M4
**Severity:** low | **Wave:** wave-2-after-launch | **Domain:** performance
**Files:** tsup.config.ts:10
**What's happening:** \`minify: false\`. Combined with PE-M3, published bundle includes whitespace, comments, and full identifiers.
**Recommendation:** Enable \`minify: true\` for production builds with external sourcemaps.
**Effort estimate:** S" \
  "low,performance,wave-2-after-launch,remediate"

create_issue \
  "[remediate] PE-L2 Extra osascript round-trip on every launch" \
  "**Finding ID:** PE-L2
**Severity:** low | **Wave:** wave-2-after-launch | **Domain:** performance
**Files:** src/launcher.ts:493-505,716,532
**What's happening:** Every non-dry-run \`launch()\` runs a separate osascript probe before the main script. Two AppleEvent round-trips instead of one (~100-300ms each).
**Recommendation:** Inline the pane count check into the main AppleScript or combine into one osascript invocation.
**Effort estimate:** M" \
  "low,performance,wave-2-after-launch,remediate"

create_issue \
  "[remediate] PE-L3 Port detection O(N×26) existsSync calls" \
  "**Finding ID:** PE-L3
**Severity:** low | **Wave:** wave-2-after-launch | **Domain:** performance
**Files:** src/ports.ts
**What's happening:** Port detection iterates up to 24 \`existsSync\` calls per project scanning env files and framework configs.
**Recommendation:** Parallelize with \`Promise.all\` or cache results with mtime invalidation.
**Effort estimate:** S" \
  "low,performance,wave-2-after-launch,remediate"

create_issue \
  "[remediate] DO-M2 Only macos-latest — Intel Macs unverified" \
  "**Finding ID:** DO-M2
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** devops-sre
**Files:** .github/workflows/ci.yml:17-18
**What's happening:** CI only runs on \`macos-latest\` (ARM). Intel Mac behavior is unverified.
**Recommendation:** Add \`macos-13\` (Intel) to the runner matrix.
**Effort estimate:** S" \
  "medium,devops-sre,wave-2-after-launch,remediate"

create_issue \
  "[remediate] DO-M6 No debug mode — post-launch bug triage will be hard" \
  "**Finding ID:** DO-M6
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** devops-sre
**Files:** src/utils.ts:55-69, src/utils.ts:96-101
**What's happening:** No \`SUMMON_DEBUG=1\`/\`--verbose\`; no log file; AppleScript errors are lost; accessibility error detection matches against brittle strings.
**Recommendation:** Add \`SUMMON_DEBUG=1\` that dumps generated AppleScript + full osascript stderr to \`~/.config/summon/logs/\`.
**Effort estimate:** M" \
  "medium,devops-sre,wave-2-after-launch,remediate"

create_issue \
  "[remediate] DO-M7 Dependabot merges individual PRs — O(n) CI runs, violates batching policy" \
  "**Finding ID:** DO-M7
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** devops-sre
**Files:** .github/dependabot.yml
**What's happening:** No \`groups:\` block; each dep bump is a separate macos-latest CI run. macOS runners cost 10× ubuntu.
**Recommendation:** Add \`groups: { dev-dependencies: { dependency-type: development, update-types: [minor, patch] }, actions: { patterns: [\"*\"] } }\`.
**Effort estimate:** S" \
  "medium,devops-sre,wave-2-after-launch,remediate"

create_issue \
  "[remediate] FE-M2 summon open and summon status show same data with incompatible interaction patterns" \
  "**Finding ID:** FE-M2
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** frontend
**Files:** src/commands/project.ts:62-97, src/monitor.ts:69-90
**What's happening:** Two different UX patterns for the same project list: \`open\` uses readline numbered selection, \`status\` uses raw-mode arrow-key TUI. No way to navigate from one to the other.
**Why it matters:** Inconsistent interaction model; users can't build muscle memory.
**Recommendation:** Either consolidate into one TUI or explicitly document the deliberate split with Enter-to-launch on both.
**Effort estimate:** M" \
  "medium,frontend,wave-2-after-launch,remediate"

create_issue \
  "[remediate] FE-M11 Monitor TUI scroll math has dead code" \
  "**Finding ID:** FE-M11
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** frontend
**Files:** src/monitor.ts:117-126
**What's happening:** \`scrollStart\` resets to 0 on every \`renderScreen\` call, making \`if (selectedIndex < scrollStart)\` unreachable. Scrolling back up after scrolling down doesn't keep the selected row visible.
**Why it matters:** Dashboard with >viewport rows of projects scrolls incorrectly.
**Recommendation:** Hoist \`scrollStart\` to closure-level state in \`runMonitor\`.
**Effort estimate:** M" \
  "medium,frontend,wave-2-after-launch,remediate"

create_issue \
  "[remediate] BE-H7 Snapshot save doesn't handle moved or deleted project directories" \
  "**Finding ID:** BE-H7
**Severity:** high | **Wave:** wave-2-after-launch | **Domain:** backend
**Files:** src/snapshot.ts
**What's happening:** Snapshot save doesn't gracefully handle the case where the project directory has been moved or deleted since the snapshot was created.
**Recommendation:** Check directory existence before snapshot operations; surface actionable error with recovery hint.
**Effort estimate:** S" \
  "high,backend,wave-2-after-launch,remediate"

create_issue \
  "[remediate] BE-M12 No size cap or timeout on AppleScript execution" \
  "**Finding ID:** BE-M12
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** backend
**Files:** src/launcher.ts
**What's happening:** \`execFileSync(\"osascript\", ...)\` has no timeout. A hung osascript (e.g., Ghostty not responding) blocks the process indefinitely.
**Recommendation:** Add \`timeout\` option to \`execFileSync\`; surface timeout error with actionable message.
**Effort estimate:** S" \
  "medium,backend,wave-2-after-launch,remediate"

create_issue \
  "[remediate] BE-M15 Briefing git calls are sequential — parallelize" \
  "**Finding ID:** BE-M15
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** backend
**Files:** src/briefing.ts:60-87
**What's happening:** For each project, \`git log\` and \`git status\` are called sequentially. With 10+ projects, briefing takes 10+ seconds.
**Recommendation:** Parallelize with \`Promise.all\` per project; keep output order deterministic.
**Effort estimate:** S" \
  "medium,backend,wave-2-after-launch,remediate"

create_issue \
  "[remediate] BE-M18 gitDataCache never invalidated in long-running contexts" \
  "**Finding ID:** BE-M18
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** backend
**Files:** src/briefing.ts
**What's happening:** \`gitDataCache\` (branch/status cache with 10s TTL) is never invalidated if the TUI runs for hours. Stale data is served indefinitely.
**Recommendation:** Add explicit max-age beyond which the cache is cleared regardless of TTL.
**Effort estimate:** S" \
  "medium,backend,wave-2-after-launch,remediate"

create_issue \
  "[remediate] BE-M20 writeStatus uses 0o644 — inconsistent with 0o600 elsewhere" \
  "**Finding ID:** BE-M20
**Severity:** low | **Wave:** wave-2-after-launch | **Domain:** backend
**Files:** src/status.ts
**What's happening:** \`writeStatus\` creates files with mode \`0o644\` (world-readable), while other status artifacts use \`0o600\`. Status files may contain PID, project name, layout info.
**Recommendation:** Use \`0o600\` consistently for all status artifacts.
**Effort estimate:** S" \
  "low,backend,wave-2-after-launch,remediate"

create_issue \
  "[remediate] AR-M1 41 process.exit calls across 10 modules — untestable, non-reusable core" \
  "**Finding ID:** AR-M1
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** architect
**Files:** src/launcher.ts, src/setup.ts, src/utils.ts:60, src/commands/*.ts, src/monitor.ts, src/index.ts
**What's happening:** \`promptUser\` exits with \`130\` on close; \`launcher.ts\` has ~14 exit sites. Every test must mock \`process.exit\` extensively.
**Why it matters:** Library-style reuse is impossible; error reporting is non-uniform.
**Recommendation:** Introduce typed \`SummonError\`; throw from library code; centralize exit codes in \`index.ts\`.
**Effort estimate:** L" \
  "medium,architect,wave-2-after-launch,remediate"

create_issue \
  "[remediate] AR-M2 config.ts is a god-module for path constants" \
  "**Finding ID:** AR-M2
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** architect
**Files:** src/config.ts:6-9, src/status.ts:4, src/snapshot.ts:4, src/starship.ts:4
**What's happening:** \`CONFIG_DIR\`, \`STATUS_DIR\`, \`SNAPSHOTS_DIR\`, \`LAYOUTS_DIR\` are imported by modules that only need path strings, dragging in KV-file logic and \`mkdirSync\` side effects.
**Recommendation:** Extract \`src/paths.ts\` for path constants only.
**Effort estimate:** S" \
  "medium,architect,wave-2-after-launch,remediate"

create_issue \
  "[remediate] AR-M3 commands/* imports back into launcher.ts — circular coupling" \
  "**Finding ID:** AR-M3
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** architect
**Files:** src/launcher.ts, src/commands/
**What's happening:** \`commands/*\` modules import from \`launcher.ts\`, creating a circular coupling between orchestrator and command handlers. This is currently handled by madge/ts-prune but creates fragile boundaries.
**Recommendation:** Extract shared types/utilities that both can depend on without circular imports.
**Effort estimate:** M" \
  "medium,architect,wave-2-after-launch,remediate"

create_issue \
  "[remediate] QA-L2 Coverage thresholds not enforced in CI config" \
  "**Finding ID:** QA-L2
**Severity:** low | **Wave:** wave-2-after-launch | **Domain:** qa-reliability
**Files:** package.json (test:coverage script)
**What's happening:** \`pnpm test:coverage\` reports 100%/97.27% but no \`coverage.thresholds\` block enforces this floor. Coverage can silently erode as features land.
**Recommendation:** Add \`test.coverage.thresholds\` to vitest config (e.g., \`lines: 95, statements: 95, functions: 95, branches: 90\`).
**Effort estimate:** S" \
  "low,qa-reliability,wave-2-after-launch,remediate"

create_issue \
  "[remediate] QA-L3 No end-to-end AppleScript syntax validation" \
  "**Finding ID:** QA-L3
**Severity:** low | **Wave:** wave-2-after-launch | **Domain:** qa-reliability
**Files:** src/launcher.test.ts, src/launcher.ts:84,120,221,495,560
**What's happening:** All \`execFileSync\`/\`execSync\` calls are mocked. No test pipes generated scripts through \`osascript -e\` or \`osacompile\` to validate AppleScript syntax.
**Recommendation:** Add opt-in \`pnpm test:e2e\` (gated on \`SUMMON_E2E=1\`) that runs generated scripts through \`osacompile\` for syntax validation.
**Effort estimate:** M" \
  "low,qa-reliability,wave-2-after-launch,remediate"

create_issue \
  "[remediate] UX-M2 summon config shows no editing hint" \
  "**Finding ID:** UX-M2
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** ux
**Files:** src/commands/config.ts (or equivalent)
**What's happening:** \`summon config\` shows current config but no hint on how to edit it (no editor hint, no \`summon config set\` guidance).
**Recommendation:** Add \"Edit with: \$EDITOR ~/.config/summon/config\" or \"Use: summon config set <key> <value>\" as a trailing line.
**Effort estimate:** S" \
  "medium,ux,wave-2-after-launch,remediate"

create_issue \
  "[remediate] UX-M3 Voice and tone abandoned after welcome screen" \
  "**Finding ID:** UX-M3
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** ux
**Files:** src/setup.ts, src/launcher.ts, src/commands/
**What's happening:** \"Summon your Ghostty workspace!\" in welcome banner; mostly clinical elsewhere. The wizard flavor disappears the moment onboarding ends.
**Recommendation:** Add consistent personality to 2-3 key moments: workspace launch success, briefing header, first project registration.
**Effort estimate:** S" \
  "medium,ux,wave-2-after-launch,remediate"

create_issue \
  "[remediate] UX-M6 Snapshot subcommand argument grammar undocumented" \
  "**Finding ID:** UX-M6
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** ux
**Files:** src/commands/ (snapshot command)
**What's happening:** \`summon snapshot\` subcommand arguments (save/restore/list) are not documented in help text or README.
**Recommendation:** Add \`summon snapshot --help\` with examples; add to global help subcommand list.
**Effort estimate:** S" \
  "medium,ux,wave-2-after-launch,remediate"

create_issue \
  "[remediate] UX-M8 --once accepted silently on all subcommands" \
  "**Finding ID:** UX-M8
**Severity:** medium | **Wave:** wave-2-after-launch | **Domain:** ux
**Files:** src/index.ts, src/cli/parse.ts
**What's happening:** \`--once\` flag is silently accepted on subcommands where it has no effect (\`summon status --once\`, \`summon doctor --once\`).
**Recommendation:** Validate \`--once\` only for the launch subcommand; emit warning or error for others.
**Effort estimate:** M" \
  "medium,ux,wave-2-after-launch,remediate"

create_issue \
  "[remediate] UX-S1 19 subcommands without progressive disclosure" \
  "**Finding ID:** UX-S1
**Severity:** strategic | **Wave:** wave-2-after-launch | **Domain:** ux
**Files:** src/cli/parse.ts, src/index.ts
**What's happening:** All 19 subcommands are exposed at the top level with no grouping or \"getting started\" path. New users are immediately overwhelmed.
**Recommendation:** Consider a tiered help system: beginner (launch, add, setup), intermediate (status, open, briefing), advanced (snapshot, ports, tree DSL). Or add \`summon help\` with topic groups.
**Effort estimate:** M" \
  "strategic,ux,wave-2-after-launch,remediate"

# ─── WAVE 3: Later / Strategic (now also Before Launch per user request) ──────

create_issue \
  "[remediate] AR-S1 launcher.ts is the architectural hotspot — 804 LOC, 9 concerns" \
  "**Finding ID:** AR-S1
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** architect
**Files:** src/launcher.ts:1-804, src/launcher.test.ts:1-3546
**What's happening:** \`launcher.ts\` handles config layering, env collection, command auto-installation, shell-meta confirmation, on-start execution, Ghostty checks, pane probing, two layout pipelines, and status writes. Its test file is 3546 LOC.
**Why it matters:** Every new feature lands here by default. Future decomposition necessary before maintainability seriously degrades.
**Recommendation:** Extract \`launch/preflight.ts\`, \`launch/commands.ts\`, \`launch/resolve.ts\`. Keep \`launcher.ts\` as orchestrator.
**Effort estimate:** M" \
  "strategic,architect,wave-3-later,remediate"

create_issue \
  "[remediate] AR-S2 setup.ts conflates 6 concerns into 1378 LOC" \
  "**Finding ID:** AR-S2
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** architect
**Files:** src/setup.ts:1-1378, src/setup.test.ts:1-3468
**What's happening:** 40 exports covering ANSI primitives, grid builder state machine, tool catalogs, prompt helpers, validation, and wizard orchestration. Over half are \`@internal — exported for testing only\`.
**Why it matters:** \`@internal\` exports signal missing module boundaries.
**Recommendation:** Extract \`setup/grid.ts\`, \`setup/catalogs.ts\`, \`setup/prompts.ts\`, \`setup/validate.ts\`.
**Effort estimate:** M" \
  "strategic,architect,wave-3-later,remediate"

create_issue \
  "[remediate] AR-L1 Two parallel layout pipelines duplicate options plumbing" \
  "**Finding ID:** AR-L1
**Severity:** low | **Wave:** wave-3-later | **Domain:** architect
**Files:** src/launcher.ts:578-685, src/script.ts:433-543
**What's happening:** Both traditional and tree pipelines thread the same 9 option fields and duplicate window-state, env-var export, cleanup-trap, and title emission. Adding any new option requires touching 4-6 places.
**Recommendation:** Define a single \`WorkspaceShell\` interface; compile traditional layouts to the tree pipeline internally. Document as an ADR before executing.
**Effort estimate:** L" \
  "low,architect,wave-3-later,remediate"

create_issue \
  "[remediate] AR-L2 Bleeding-edge devdep majors — contributor friction" \
  "**Finding ID:** AR-L2
**Severity:** low | **Wave:** wave-3-later | **Domain:** architect
**Files:** package.json
**What's happening:** DevDeps on bleeding-edge majors (TS 6, Vitest 4, Vite 8) that may have compatibility issues with contributor toolchains.
**Recommendation:** Document minimum contributor Node/tool versions in CONTRIBUTING.md. Pin to a release candidate only when the final is imminent.
**Effort estimate:** S" \
  "low,architect,wave-3-later,remediate"

create_issue \
  "[remediate] AR-L3 noUncheckedIndexedAccess non-null assertions in parser" \
  "**Finding ID:** AR-L3
**Severity:** low | **Wave:** wave-3-later | **Domain:** architect
**Files:** src/cli/parse.ts
**What's happening:** \`noUncheckedIndexedAccess\` is enabled but parser code uses \`!\` non-null assertions in several places, negating the flag's safety benefit in those spots.
**Recommendation:** Replace \`!\` assertions with explicit bounds checks or type narrowing.
**Effort estimate:** S" \
  "low,architect,wave-3-later,remediate"

create_issue \
  "[remediate] AR-L5 generateAppleScript has six positional params — use options object" \
  "**Finding ID:** AR-L5
**Severity:** low | **Wave:** wave-3-later | **Domain:** architect
**Files:** src/script.ts
**What's happening:** \`generateAppleScript(a, b, c, d, e, f)\` — 6 positional parameters make call sites fragile to argument reordering and hard to read.
**Recommendation:** Convert to \`generateAppleScript(options: AppleScriptOptions)\` interface.
**Effort estimate:** S" \
  "low,architect,wave-3-later,remediate"

create_issue \
  "[remediate] BE-S26 No transactional rollback on partial launch failure" \
  "**Finding ID:** BE-S26
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** backend
**Files:** src/launcher.ts:1-804
**What's happening:** If \`executeScript\` (osascript) fails after \`writeStatus\` has written the marker file, the workspace is in a permanently \"active\" state with no running process. No rollback cleans up the half-written state.
**Why it matters:** Status TUI shows a ghost workspace; users confused.
**Recommendation:** Wrap status write + script execution in a try/finally that cleans up on failure.
**Effort estimate:** L" \
  "strategic,backend,wave-3-later,remediate"

create_issue \
  "[remediate] BE-S27 KV files have no unknown-key warnings" \
  "**Finding ID:** BE-S27
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** backend
**Files:** src/config.ts
**What's happening:** A \`.summon\` with a typo'd key (e.g. \`edittor=code\`) is silently ignored. No warning that an unrecognized key was found.
**Recommendation:** After parsing, check all keys against the known key set; warn on unknowns.
**Effort estimate:** M" \
  "strategic,backend,wave-3-later,remediate"

create_issue \
  "[remediate] BE-S28 No backup or migration story for schema version bumps" \
  "**Finding ID:** BE-S28
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** backend
**Files:** src/config.ts, src/status.ts
**What's happening:** Status JSON has \`version: 1\` but there is no migration path documented or implemented. A breaking schema change silently corrupts all saved state for existing users on upgrade.
**Recommendation:** Implement \`migrateStatus(raw)\` versioned migration function. Document migration policy in CLAUDE.md.
**Effort estimate:** M" \
  "strategic,backend,wave-3-later,remediate"

create_issue \
  "[remediate] BE-L24 formatTimeSince no clamp for negative diffs" \
  "**Finding ID:** BE-L24
**Severity:** low | **Wave:** wave-3-later | **Domain:** backend
**Files:** src/utils.ts
**What's happening:** \`formatTimeSince\` doesn't clamp negative diffs (clock skew, future timestamps). Returns \"-1 seconds ago\" or similar on slightly skewed clocks.
**Recommendation:** Clamp to 0: \`const elapsed = Math.max(0, Date.now() - timestamp)\`.
**Effort estimate:** S" \
  "low,backend,wave-3-later,remediate"

create_issue \
  "[remediate] DO-M8 Manual release process with no pnpm version integration" \
  "**Finding ID:** DO-M8
**Severity:** medium | **Wave:** wave-3-later | **Domain:** devops-sre
**Files:** docs/publishing.md, package.json
**What's happening:** Release process is manual: bump version in package.json, update CHANGELOG, tag, push tag, publish. No \`pnpm version\` or \`changeset\` integration to automate the choreography.
**Recommendation:** Add \`pnpm version patch/minor/major\` support with a pre-version hook that validates CHANGELOG; document in docs/publishing.md.
**Effort estimate:** M" \
  "medium,devops-sre,wave-3-later,remediate"

create_issue \
  "[remediate] DO-S1 Zero-deps invariant not CI-enforced" \
  "**Finding ID:** DO-S1
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** devops-sre
**Files:** .github/workflows/ci.yml, package.json
**What's happening:** The zero-runtime-dependency invariant is documented in CLAUDE.md but not enforced in CI. A PR adding a runtime dep passes CI undetected.
**Recommendation:** Add CI check: \`node -e \"const p = require('./package.json'); if (Object.keys(p.dependencies || {}).length) process.exit(1)\"\`.
**Effort estimate:** S" \
  "strategic,devops-sre,wave-3-later,remediate"

create_issue \
  "[remediate] PE-L4 Tab-title escaped per-call without caching" \
  "**Finding ID:** PE-L4
**Severity:** low | **Wave:** wave-3-later | **Domain:** performance
**Files:** src/launcher.ts
**What's happening:** Tab title is escaped on every call to the AppleScript generator even when the title is static for the session.
**Recommendation:** Cache the escaped title per launch invocation.
**Effort estimate:** S" \
  "low,performance,wave-3-later,remediate"

create_issue \
  "[remediate] PE-S1 Setup chunk 119 KB — further code splitting possible" \
  "**Finding ID:** PE-S1
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** performance
**Files:** tsup.config.ts, src/setup.ts
**What's happening:** The setup wizard chunk is 119 KB. Most users never run setup after the first time.
**Recommendation:** After AR-S2 decomposition, lazy-import the setup wizard in index.ts to reduce cold-start footprint.
**Effort estimate:** M" \
  "strategic,performance,wave-3-later,remediate"

create_issue \
  "[remediate] PE-S2 No persistent cache for derived config across CLI invocations" \
  "**Finding ID:** PE-S2
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** performance
**Files:** src/config.ts
**What's happening:** Each CLI invocation re-parses all config files from scratch. For complex setups with many projects and presets, this adds measurable overhead.
**Recommendation:** Implement a file-mtime-based disk cache (e.g. \`~/.config/summon/cache.json\`) for derived config state.
**Effort estimate:** M" \
  "strategic,performance,wave-3-later,remediate"

create_issue \
  "[remediate] QA-S1 Document shell-escape.lint.test.ts in CLAUDE.md as load-bearing invariant" \
  "**Finding ID:** QA-S1
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** qa-reliability
**Files:** package.json, CLAUDE.md
**What's happening:** 1507 passing tests, 100% statement/line/function coverage. The structural shell-escape lint is a genuine load-bearing invariant that prevents regression of the primary injection defense. Not documented as such.
**Recommendation:** Document \`shell-escape.lint.test.ts\` in CLAUDE.md security section with a \`DO NOT REMOVE\` note.
**Effort estimate:** S" \
  "strategic,qa-reliability,wave-3-later,remediate"

create_issue \
  "[remediate] QA-S2 shell-escape.lint.test.ts needs DO NOT REMOVE comment and CLAUDE.md security section" \
  "**Finding ID:** QA-S2
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** qa-reliability
**Files:** src/shell-escape.lint.test.ts, CLAUDE.md
**What's happening:** The structural lint test has no \`DO NOT REMOVE\` comment. A contributor cleaning up tests could accidentally remove the primary injection defense.
**Recommendation:** Add a prominent \`// DO NOT REMOVE: this test is a load-bearing CI gate\` comment. Add a CLAUDE.md security section explaining its role.
**Effort estimate:** S" \
  "strategic,qa-reliability,wave-3-later,remediate"

create_issue \
  "[remediate] SE-S1 Fuzz-test escapeAppleScript with random Unicode and control chars" \
  "**Finding ID:** SE-S1
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** security
**Files:** src/shell-escape.ts, src/shell-escape.test.ts
**What's happening:** \`escapeAppleScript\` is tested with known-bad inputs but not fuzz-tested with random Unicode, control characters, or crafted byte sequences.
**Recommendation:** Add a property-based / fuzz test (e.g. fast-check) that verifies the escaped output round-trips safely through osascript for any input string.
**Effort estimate:** M" \
  "strategic,security,wave-3-later,remediate"

create_issue \
  "[remediate] SE-S2 No SBOM or signed releases" \
  "**Finding ID:** SE-S2
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** security
**Files:** .github/workflows/release.yml
**What's happening:** No Software Bill of Materials (SBOM) generated or attached to releases. No Sigstore/cosign signature on the published tarball.
**Recommendation:** Add SBOM generation (\`cyclonedx-node\`) and attach to GitHub Release. Consider cosign attestation for the tarball.
**Effort estimate:** M" \
  "strategic,security,wave-3-later,remediate"

create_issue \
  "[remediate] UX-L1 Accessibility prompt mixes conditional language" \
  "**Finding ID:** UX-L1
**Severity:** low | **Wave:** wave-3-later | **Domain:** ux
**Files:** src/setup.ts:641-672
**What's happening:** Accessibility permission prompt uses conditional language (\"you may need to...\", \"might ask...\") rather than stating clearly what will happen and what the user needs to do.
**Recommendation:** Rewrite as: \"Summon needs Accessibility permission to control Ghostty. Open System Settings > Privacy > Accessibility and enable Summon.\"
**Effort estimate:** S" \
  "low,ux,wave-3-later,remediate"

create_issue \
  "[remediate] UX-L2 README default-layout diagram is misleading" \
  "**Finding ID:** UX-L2
**Severity:** low | **Wave:** wave-3-later | **Domain:** ux
**Files:** README.md
**What's happening:** The README diagram showing the default layout doesn't match the actual pane arrangement produced by the default preset.
**Recommendation:** Regenerate diagram from actual default config; add a note that diagrams are generated.
**Effort estimate:** S" \
  "low,ux,wave-3-later,remediate"

create_issue \
  "[remediate] UX-L3 --shell false tri-value semantics surprising" \
  "**Finding ID:** UX-L3
**Severity:** low | **Wave:** wave-3-later | **Domain:** ux
**Files:** src/cli/parse.ts, README.md
**What's happening:** \`--shell false\` has three possible states (unset, true, false) but the CLI doesn't clearly document the tri-value semantics or what \`false\` means for shell execution.
**Recommendation:** Add explicit documentation in help text and README for \`--shell\` tri-value behavior.
**Effort estimate:** S" \
  "low,ux,wave-3-later,remediate"

create_issue \
  "[remediate] UX-L4 Briefing shows no positive All projects clean confirmation" \
  "**Finding ID:** UX-L4
**Severity:** low | **Wave:** wave-3-later | **Domain:** ux
**Files:** src/briefing.ts
**What's happening:** When all projects are clean and have no overnight activity, briefing shows nothing. Users can't tell if briefing ran successfully.
**Recommendation:** Add a positive confirmation: \"✓ All N projects clean — nothing to report.\" when there's no activity.
**Effort estimate:** S" \
  "low,ux,wave-3-later,remediate"

create_issue \
  "[remediate] UX-L5 switch vs open ambiguous documentation" \
  "**Finding ID:** UX-L5
**Severity:** low | **Wave:** wave-3-later | **Domain:** ux
**Files:** src/cli/parse.ts, README.md
**What's happening:** \`switch\` is documented as \"alias for open\" but the behavior differs (switch focuses existing workspace vs open always creates). This ambiguity leads to confusion about when to use which.
**Recommendation:** Clearly document the distinction in help text and README; consider renaming one command.
**Effort estimate:** S" \
  "low,ux,wave-3-later,remediate"

create_issue \
  "[remediate] UX-S2 Install-command prompt blocks launch with no skip pane option" \
  "**Finding ID:** UX-S2
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** ux
**Files:** src/setup.ts, src/launcher.ts
**What's happening:** When a configured command (btop, lazygit, etc.) is not installed, summon prompts to install it before launch. The entire launch is blocked — there's no way to skip the missing-tool pane.
**Why it matters:** Missing a single tool blocks the entire workspace.
**Recommendation:** Add a \`--skip-missing\` flag or pane-level skip logic; show warning about skipped pane in workspace.
**Effort estimate:** M" \
  "strategic,ux,wave-3-later,remediate"

create_issue \
  "[remediate] FE-M3 Numbered-select duplicated across 4 call sites" \
  "**Finding ID:** FE-M3
**Severity:** medium | **Wave:** wave-3-later | **Domain:** frontend
**Files:** src/setup.ts, src/monitor.ts, src/index.ts, src/commands/
**What's happening:** The numbered-selection prompt pattern (print list, read number, validate) is duplicated in 4+ places with slight variations in error handling and validation.
**Recommendation:** Extract \`selectFrom(items, prompt)\` helper to \`src/ui/select.ts\`; use in all 4 call sites.
**Effort estimate:** M" \
  "medium,frontend,wave-3-later,remediate"

create_issue \
  "[remediate] FE-M6 Color detection fixed at module load — ignores FORCE_COLOR" \
  "**Finding ID:** FE-M6
**Severity:** medium | **Wave:** wave-3-later | **Domain:** frontend
**Files:** src/ui/ansi.ts (or equivalent)
**What's happening:** Color support detection runs at module initialization time and caches the result. If \`FORCE_COLOR\` is set after import, or if the module is loaded in a non-TTY context, colors are permanently disabled for the session.
**Recommendation:** Check \`FORCE_COLOR\` and \`NO_COLOR\` env vars at call time, or re-evaluate on each output call.
**Effort estimate:** S" \
  "medium,frontend,wave-3-later,remediate"

create_issue \
  "[remediate] FE-M8 confirm accepts only y/n — no neutral cancel key" \
  "**Finding ID:** FE-M8
**Severity:** medium | **Wave:** wave-3-later | **Domain:** frontend
**Files:** src/setup.ts, src/utils.ts
**What's happening:** \`confirm()\` only accepts y/n. There's no way to press Escape or Ctrl+C to cancel without exiting the entire process (see FE-M5).
**Recommendation:** After fixing FE-M5 (PromptCancelled error), add Escape as a neutral cancel that throws PromptCancelled without exiting.
**Effort estimate:** S" \
  "medium,frontend,wave-3-later,remediate"

create_issue \
  "[remediate] FE-M9 Setup wizard lacks back navigation" \
  "**Finding ID:** FE-M9
**Severity:** medium | **Wave:** wave-3-later | **Domain:** frontend
**Files:** src/setup.ts:1001-1082
**What's happening:** The setup wizard is a linear sequence with no way to go back to the previous step. Users who make a mistake must restart from the beginning.
**Recommendation:** Implement step-stack navigation; add \"← Back\" option at each step.
**Effort estimate:** L" \
  "medium,frontend,wave-3-later,remediate"

create_issue \
  "[remediate] FE-M10 validateBuilderCommand renderer state drift" \
  "**Finding ID:** FE-M10
**Severity:** medium | **Wave:** wave-3-later | **Domain:** frontend
**Files:** src/setup.ts
**What's happening:** \`validateBuilderCommand\` checks command validity but the grid builder renderer doesn't always reflect the current validation state, leading to drift between what's displayed and what's validated.
**Recommendation:** Synchronize renderer state with validation result on every keystroke; use a single source of truth for both.
**Effort estimate:** M" \
  "medium,frontend,wave-3-later,remediate"

create_issue \
  "[remediate] FE-M12 Shell completions bake layout list at generation time" \
  "**Finding ID:** FE-M12
**Severity:** medium | **Wave:** wave-3-later | **Domain:** frontend
**Files:** src/completions.ts
**What's happening:** Shell completions include the layout list baked in at generation time. Adding a new layout doesn't update completions until the user regenerates them.
**Recommendation:** Use dynamic completion (e.g. \`summon completions --list-layouts\` called by the completion script at runtime) instead of baking the list.
**Effort estimate:** M" \
  "medium,frontend,wave-3-later,remediate"

create_issue \
  "[remediate] FE-M13 printSection width hardcoded to 40 cols" \
  "**Finding ID:** FE-M13
**Severity:** medium | **Wave:** wave-3-later | **Domain:** frontend
**Files:** src/setup.ts (or src/ui/)
**What's happening:** \`printSection\` uses a hardcoded width of 40 columns. On wide terminals, content is left-aligned in a narrow column. On narrow terminals (< 40 cols), content wraps unexpectedly.
**Recommendation:** Use \`process.stdout.columns\` with a min/max clamp (e.g. min 40, max 100).
**Effort estimate:** S" \
  "medium,frontend,wave-3-later,remediate"

create_issue \
  "[remediate] FE-S2 No instrumentation for first-run or wizard drop-off" \
  "**Finding ID:** FE-S2
**Severity:** strategic | **Wave:** wave-3-later | **Domain:** frontend
**Files:** src/setup.ts, src/index.ts
**What's happening:** No opt-in telemetry or local logging of first-run completion rates. Post-launch, there's no signal on how many users complete setup vs. drop off mid-wizard.
**Recommendation:** Implement opt-in anonymous analytics (with clear consent prompt) or at minimum log completion steps to \`~/.config/summon/logs/\` for local debugging.
**Effort estimate:** M" \
  "strategic,frontend,wave-3-later,remediate"

echo ""
echo "✓ All 108 issues created."
