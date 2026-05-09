# Security Policy

## Reporting a Vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Report security issues privately via [GitHub Security Advisories](https://github.com/juan294/summon/security/advisories/new).

We will respond within 48 hours and coordinate a fix before any public disclosure.

## Supported Versions

Only the latest published version on npm receives security fixes.

## Security Model

Summon executes commands configured in `.summon` project files. As of v0.8.0+, project `.summon` files require explicit trust (`summon trust .`) before their commands are executed. See the README for details on the trust model.
