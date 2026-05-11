# Publishing Checklist

Publishing checklist and workflow. First published as v0.7.0 on 2026-03-14.

## Build Output Notes

Code splitting is enabled in `tsup.config.ts`. The `dist/` directory now produces
multiple chunk files (e.g. `index.js`, `chunk-*.js`) rather than a single monolith.
All chunks are required at runtime — the `files: ["dist"]` field in `package.json`
already ensures the full `dist/` directory is included in the published tarball.

When verifying a tarball with `tar tzf summon-ws-<version>.tgz`, expect to see
`package/dist/index.js` plus one or more `package/dist/chunk-*.js` files.

## Setup (completed)

- [x] Package name `summon-ws` chosen (npm)
- [x] `bin` entry for `summon`
- [x] `files: ["dist"]` limits published contents
- [x] `engines: { "node": ">=20.19" }`
- [x] `os: ["darwin"]` enforces macOS-only
- [x] `prepublishOnly` runs `pnpm run build`
- [x] `license: "MIT"` + LICENSE file
- [x] Zero runtime dependencies
- [x] CI pipeline (typecheck + build + test)
- [x] `keywords` for npm discoverability
- [x] `repository`, `homepage`, `bugs` fields in package.json
- [x] README.md

## Version Bumping

Use `pnpm version patch|minor|major` to bump the version. This automatically:
- Updates package.json version
- Creates a git tag

After running, also update CHANGELOG.md (Step 0 above).

## Publishing a New Version

### 0. Prepare CHANGELOG.md

Promote the `[Unreleased]` section to the new version number and add today's date:

1. Replace `## [Unreleased]` with `## [X.Y.Z] - YYYY-MM-DD`
2. Add a new empty `## [Unreleased]` section above it
3. Update the comparison links at the bottom of CHANGELOG.md

Verify the package version matches the intended release:
```bash
node -p "require('./package.json').version"
```

### 1. Pre-Publish Verification
```bash
pnpm pack
# Inspect the tarball contents:
tar tzf summon-ws-<version>.tgz
# Should contain: package/dist/index.js, package/dist/chunk-*.js,
#                 package/package.json, package/README.md, package/LICENSE
# Should NOT contain: docs/, src/, node_modules/

# Install globally from the tarball:
npm i -g ./summon-ws-<version>.tgz

# Verify command works:
summon --version
summon --help

# Test a real launch (requires Ghostty running):
summon .

# Clean up:
npm uninstall -g summon-ws
rm summon-ws-<version>.tgz
```

### 3. Real Ghostty Test
- [ ] Test on a Mac with Ghostty 1.3.1+
- [ ] Verify AppleScript permission prompt appears and works
- [ ] Verify all presets create correct layouts
- [ ] Verify commands run in correct panes

### 4. Version Strategy
- Follow semver: breaking changes = major, features = minor, fixes = patch
- The project is stable (1.x). Minor releases add features, patch releases fix bugs.

### 5. Publish
```bash
# Dry run first:
npm publish --dry-run

# If everything looks good:
npm publish

# Verify it's live:
npm info summon-ws
```

### 6. Post-Publish Verification
```bash
# Install from npm:
npm i -g summon-ws
summon --version
summon --help
summon .
```

### 7. GitHub Release
- [ ] Tag the commit: `git tag v<version>`
- [ ] Push the tag: `git push origin v<version>`
- [ ] Create a GitHub release from the tag

## Rollback

If a bad version is published, act quickly — npm does not allow unpublishing versions older than 72 hours.

### 1. Deprecate the bad version

This keeps the package installable but warns users away:

```bash
npm deprecate summon-ws@<bad-version> "Critical bug — use <previous-version> instead"
```

### 2. Repoint the `latest` dist-tag to the last good version

```bash
npm dist-tag add summon-ws@<good-version> latest
```

After this, `npm install -g summon-ws` will install the good version again.

### 3. Publish a canary fix before promoting to `latest`

If you have a fix ready but want to test it before making it the default:

```bash
# Publish under the `next` tag — does NOT affect `latest`
npm publish --tag next

# Verify it works:
npm install -g summon-ws@next
summon --version
summon --help
summon doctor

# Promote to latest once verified:
npm dist-tag add summon-ws@<fixed-version> latest
```

### 4. Post-incident verification

Confirm dist-tags are pointing at the right versions:

```bash
npm info summon-ws dist-tags
# Should show: { latest: '<good-version>', ... }

npm info summon-ws@latest version
# Must match the intended good version
```

## Supply Chain

Consider adding SBOM generation (`cyclonedx-node`) to the release workflow for future releases.
