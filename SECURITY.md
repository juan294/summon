# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | Yes       |
| < 1.0   | No        |

## Reporting a Vulnerability

If you discover a security vulnerability in summon, please report it responsibly. **Do not open a public issue.**

### How to Report

1. **Email**: Send details to `support@chapa.thecreativetoken.com`
2. **GitHub**: Use [GitHub's private vulnerability reporting](https://github.com/juan294/summon/security/advisories/new)

Please include:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

### What to Expect

- Acknowledgment within 48 hours
- Status update within 7 days
- We aim to release a fix within 14 days of confirmed vulnerabilities

## Security Considerations for Users

- **AppleScript execution**: Summon generates and executes AppleScript to control Ghostty. The generated script only contains the commands and paths you configure — no network access, no credential handling.
- **Config files**: Stored at `~/.config/summon/`. These are plain text key=value files with no sensitive data.
- **macOS Automation permissions**: On first use, macOS will prompt you to grant your terminal permission to control Ghostty. This is required for AppleScript to work.

## Security Considerations for Contributors

- Never commit tokens, credentials, or secrets
- Do not add dependencies — this project maintains zero runtime dependencies
- Be cautious with user input handling in CLI argument parsing and path resolution
- Ensure any shell commands executed via `execSync` are properly sanitized

## Disclosure Policy

We follow coordinated disclosure. After a fix is released, we will:

1. Publish a GitHub Security Advisory
2. Release a patched version to npm
3. Credit the reporter (unless they prefer anonymity)
