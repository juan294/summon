# Publishing Checklist

Publishing checklist and workflow. First published as v0.7.0 on 2026-03-14.

## Setup (completed)

- [x] Package name `summon-ws` chosen (npm)
- [x] `bin` entry for `summon`
- [x] `files: ["dist"]` limits published contents
- [x] `engines: { "node": ">=18" }`
- [x] `os: ["darwin"]` enforces macOS-only
- [x] `prepublishOnly` runs `pnpm run build`
- [x] `license: "MIT"` + LICENSE file
- [x] Zero runtime dependencies
- [x] CI pipeline (typecheck + build + test)
- [x] `keywords` for npm discoverability
- [x] `repository`, `homepage`, `bugs` fields in package.json
- [x] README.md

## Publishing a New Version

### 1. Pre-Publish Verification
```bash
pnpm pack
# Inspect the tarball contents:
tar tzf summon-ws-<version>.tgz
# Should contain: package/dist/index.js, package/package.json,
#                 package/README.md, package/LICENSE
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
- `0.x.y` while pre-stable (see `package.json` for current version)
- `1.0.0` when the CLI is stable and API won't change
- Follow semver: breaking changes = major, features = minor, fixes = patch

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
