# Contributing to summon

Thanks for your interest in contributing! Whether it's a bug fix, a new layout preset, or better documentation, all contributions are welcome.

## Ways to Contribute

- Report bugs or suggest features via [GitHub Issues](https://github.com/juan294/summon/issues)
- Fix bugs or implement features via pull requests
- Improve documentation
- Share your Ghostty workspace configurations

### Contributions We'd Love

- Layout presets for specific workflows
- Better error messages and edge case handling
- AppleScript improvements for Ghostty integration
- Documentation and examples

## Toolchain & Versions

Summon targets specific toolchain versions. Using older versions may produce type
errors, build failures, or subtly wrong test results.

| Tool | Required version | Notes |
|------|-----------------|-------|
| Node.js | `>=20.19` | ESM `require()` interop landed in 20.19 |
| pnpm | `10.29.2` | Pinned via `packageManager` in package.json |
| TypeScript | `^6.0` | Strict mode + `noUncheckedIndexedAccess` |
| Vitest | `^4.x` | Dev dep; do not downgrade to v3 |
| tsup / esbuild | `^8.x` | Build tool; see `tsup.config.ts` |

### Checking your versions

```bash
node --version      # must be >= 20.19
pnpm --version      # must be 10.29.2
```

### Staying current with Node

Use a version manager (nvm, fnm, or Volta). The project targets Node 20.19 as the
minimum; CI also runs on Node 22 and 24. To match the minimum locally:

```bash
# with nvm:
nvm install 20.19
nvm use 20.19

# .nvmrc snippet (place in your local clone root if desired):
# lts/iron
```

> Note: a `.nvmrc` file is intentionally not committed to the repository — it would
> pin contributors to the minimum and prevent easy testing on newer Node versions.
> Pick the LTS release that matches `>=20.19` for your workflow.

### pnpm

Install or update pnpm globally:

```bash
npm install -g pnpm@10.29.2
# or via corepack:
corepack enable
corepack prepare pnpm@10.29.2 --activate
```

The `packageManager` field in `package.json` causes corepack to enforce this version
automatically if corepack is active.

## Development Setup

1. Fork and clone the repository:

   ```bash
   git clone https://github.com/<your-username>/summon.git
   cd summon
   ```

2. Install dependencies:

   ```bash
   pnpm install
   ```

3. Run tests to verify everything works:

   ```bash
   pnpm test
   ```

## Development Workflow

1. Create a feature branch from `develop`:

   ```bash
   git checkout develop
   git pull origin develop
   git checkout -b feat/your-feature
   ```

2. Make your changes and write tests.

3. Ensure all checks pass:

   ```bash
   pnpm test          # unit tests
   pnpm run typecheck # type checking
   pnpm run lint      # linting
   pnpm run build     # production build
   ```

4. Open a pull request targeting the `develop` branch.

### Testing Against Real Ghostty

Manual testing requires macOS with [Ghostty](https://ghostty.org) 1.3.1+ installed:

```bash
pnpm run build
chmod +x dist/index.js
./dist/index.js .                    # launch default workspace
./dist/index.js . --layout minimal   # test minimal preset
```

## Commit Format

Use lowercase [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add proxy support
fix: handle expired tokens gracefully
docs: update contributing guide
chore: bump dependencies
test: add coverage for auth module
refactor: simplify AppleScript generation
```

## Pull Request Guidelines

- Target the `develop` branch (not `main`)
- Keep PRs focused — one feature or fix per PR
- Include tests for new functionality
- Update documentation if behavior changes
- Ensure CI passes before requesting review

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](CODE_OF_CONDUCT.md). By participating, you are expected to uphold this code.

## Security

If you discover a security vulnerability, please follow the [Security Policy](SECURITY.md) instead of opening a public issue.
