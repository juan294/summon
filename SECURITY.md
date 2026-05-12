# Security Policy

## Supported Versions

Only the current major release receives security patches.

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
| < 1.0   | No        |

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

### Preferred: GitHub Private Vulnerability Reporting

Use GitHub's built-in private disclosure mechanism:

1. Go to https://github.com/juan294/summon/security/advisories
2. Click "Report a vulnerability"
3. Fill in the details — include steps to reproduce, impact assessment, and any suggested mitigations

### Alternative: Email

Send a report to **juan294@gmail.com** with the subject line:
`[summon] Security vulnerability report`

Include:
- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

## Disclosure Timeline

| Milestone | Target |
|-----------|--------|
| Acknowledge receipt | Within 48 hours |
| Initial assessment | Within 5 days |
| Patch for critical issues | Within 14 days of confirmation |
| Patch for non-critical issues | Within 60 days |
| Public disclosure | After patch is released |

We follow coordinated disclosure. We will notify you before publishing any advisory.

## Injection Defense Gate

`src/shell-escape.lint.test.ts` is the primary injection defense for this project. It is a **load-bearing CI gate** that statically scans all source files and fails if any raw template literal interpolates a user-controlled value into an AppleScript or shell context.

**This test must never be removed or disabled.** Its removal would silently eliminate the primary defense against AppleScript/shell injection in the generated workspace scripts. See `src/shell-escape.ts` for the escape functions it protects.

If you discover that this test can be bypassed — for example, through a code path that constructs AppleScript outside of the tracked escape functions — please report it as a security vulnerability using the process above.

## Security Model

Summon executes commands configured in `.summon` project files. As of v0.8.0+, project `.summon` files require explicit trust (`summon trust .`) before their commands are executed. See the README for details on the trust model.

## Scope

This tool runs on macOS only and invokes `osascript` with generated AppleScript. The main attack surface is:

- **AppleScript injection** via workspace config values (project names, commands, environment variables)
- **Shell injection** via the same config values when constructing shell commands
- **Trust bypass** in the `.summon` file allowlist (`src/trust.ts`)

Out of scope: issues requiring physical access to the machine, issues in development dependencies not affecting the published CLI.
