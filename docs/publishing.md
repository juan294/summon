# Publishing Checklist

Tracking what's done and what's left before the first `npm publish`.

## Already Done

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

## TODO Before First Publish

### 1. npm Account
- [ ] Verify existing npm account or create one
- [ ] Run `npm login`
- [ ] Verify `summon-ws` is available: `npm view summon-ws`

### 2. Local Tarball Test
```bash
pnpm pack
# Inspect the tarball contents:
tar tzf summon-ws-0.1.0.tgz
# Should contain: package/dist/index.js, package/package.json,
#                 package/README.md, package/LICENSE
# Should NOT contain: docs/, src/, node_modules/

# Install globally from the tarball:
npm i -g ./summon-ws-0.1.0.tgz

# Verify command works:
summon --version
summon --help

# Test a real launch (requires Ghostty running):
summon .

# Clean up:
npm uninstall -g summon-ws
rm summon-ws-0.1.0.tgz
```

### 3. Real Ghostty Test
- [ ] Test on a Mac with Ghostty 1.3.0+
- [ ] Verify AppleScript permission prompt appears and works
- [ ] Verify all presets create correct layouts
- [ ] Verify commands run in correct panes

### 4. Version Strategy
- `0.x.y` while pre-stable (current: `0.1.0`)
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
- [ ] Tag the commit: `git tag v0.1.0`
- [ ] Push the tag: `git push origin v0.1.0`
- [ ] Create a GitHub release from the tag
