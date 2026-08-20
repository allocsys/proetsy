# Fix Plan: Issue #97 - Silent Startup Failure on Windows

**Status:** Ready to implement  
**Priority:** High (v0.11.8 release is blocked)  
**Root Cause:** `better-sqlite3@11.10.0` has no prebuilt binary for Electron 33/win32-x64

---

## Problem Summary

v0.11.7 and v0.11.8 CI verification caught that the packaged app spawns 3 background processes but never shows a window. The new runtime verification step (`verify better-sqlite3 loads under Electron's Node ABI`) failed with:

```
TypeError: Database is not a constructor
    at verify-better-sqlite3.cjs:4:12
  Node.js v20.18.3
```

This is running under `ELECTRON_RUN_AS_NODE=1` (Electron's bundled Node 20.18.3), the exact same execution path the packaged backend uses.

### Root Cause

1. `npm ci` installed `better-sqlite3@11.10.0` with a prebuilt for **Node 22** (because Node 24 has no prebuilt on win32-x64 for v11.x)
2. `@electron/rebuild` tried to swap it for the Electron 33 version but **no such prebuilt exists**
3. With `buildFromSource: false` in config, it silently no-op'd instead of erroring
4. Result: packaged app contains Node 22-built binary, but backend runs under Electron's Node 20.18.3 → ABI mismatch

### Why This Wasn't Caught Before

- v0.11.7 release CI only verified the `.node` file **existed** in the asar, not that it **loaded**
- Runtime verification was added **as part of** fixing #97, which is why v0.11.8 caught it

---

## Solution: Upgrade to better-sqlite3@^13.0.0

**Why this fix:**
- `better-sqlite3 v13.0.0` uses N-API, making prebuilts ABI-compatible across Node/Electron versions
- Works with Electron 33, 34, 35, 36, 37+ without recompilation
- No need to fight `buildFromSource: true` or Visual Studio Build Tools on Windows CI
- Stable and battle-tested (released July 2026)

**Alternative considered:** Setting `buildFromSource: true` to force compilation on every build
- ❌ Requires Visual Studio Build Tools on windows-latest CI (flaky)
- ❌ Slower packaging builds
- ❌ electron-builder's `npmRebuild` doesn't expose a way to force compilation

---

## Implementation Plan

### Phase 1: Local Testing (1-2 hours)

**Goal:** Verify v13 has no API-breaking changes for proetsy's usage

```bash
# 1. Update backend dependency
npm install --save better-sqlite3@^13.0.0

# 2. Run backend tests to confirm no API breaks
npm run test -w backend

# 3. Rebuild Electron native module locally
npm run electron:rebuild

# 4. Test Electron dev mode
npm run electron:dev
  # Manually: start app, verify it loads, query the DB, check tags/mockups work

# 5. Run full test suite
npm run lint
npm run test
npm run test:electron
npm run test -w frontend
```

**Expected:** All tests pass. v13 API is backward-compatible for our use cases (new Database, .prepare, .run, .get, .all).

---

### Phase 2: Packaging Build (30 mins)

**Goal:** Verify Windows packaging with better-sqlite3@^13.0.0

```bash
# Build the Windows installer locally or in a throwaway CI run
npm run electron:build

# This will:
# - npm ci with v13.0.0
# - @electron/rebuild against Electron 33
# - electron-builder package
# - Run the same verification steps the release CI runs:
#   1. Asar contents check
#   2. Native module load test (require + query under ELECTRON_RUN_AS_NODE)
#   3. Full app launch test (health check + window appearance)

# Inspect the output
# Expected: all three steps pass
# - ✓ better-sqlite3 found in asar
# - ✓ better-sqlite3 loads and runs a query under Electron 33's Node ABI
# - ✓ App launches, backend becomes healthy, window appears
```

**If any step fails:**
- Re-read the CI logs (DEBUG=electron-builder is already set in release.yml)
- Check that v13 was actually used: `ls -la release-builds/win-unpacked/resources/app.asar.unpacked/node_modules/better-sqlite3/`
- Verify no other native modules have similar ABI issues

---

### Phase 3: Prepare Release Branch

**Goal:** Create a v0.11.9 release ready to ship

```bash
# 1. Create a branch
git checkout -b fix/97-better-sqlite3-v13

# 2. Commit the package.json change
git add package.json package-lock.json
git commit -m "fix(#97): upgrade better-sqlite3 to v13 for Electron 33 N-API compatibility

- better-sqlite3@11.10.0 had no prebuilt for Electron 33/win32-x64, causing
  @electron/rebuild to silently no-op and leave a Node 22 binary in the package
- Electron 33's bundled Node 20.18.3 couldn't load the mismatched binary
- better-sqlite3@13.0.0 uses N-API for cross-version ABI compatibility
- Verified locally: backend tests pass, app packages and launches correctly"

# 3. Update CHANGELOG.md
# Add to [Unreleased] section:
#   ### Fixed
#   - Windows packaged builds now load better-sqlite3 correctly on Electron 33 by upgrading to v13.0.0 (N-API compatible) (#97)

# 4. Bump version
npm version patch --no-git-tag-version
# This updates package.json version to 0.11.9

git add CHANGELOG.md package.json
git commit -m "bump version to 0.11.9"

# 5. Push branch and open PR for review
git push origin fix/97-better-sqlite3-v13
```

---

### Phase 4: CI Verification

**Goal:** Run release.yml against the fix

The release workflow will:
1. ✅ Run linting, tests, builds (should all pass)
2. ✅ Build Windows installer
3. ✅ **Verify asar contents** (better-sqlite3 present)
4. ✅ **Load test** (require better-sqlite3 under Electron 33's Node ABI)
5. ✅ **Launch test** (spawn real packaged app, health check, window appearance)

All five steps must pass before merging.

**If CI fails:**
- Check the `release-build-summary.txt` artifact for which step broke
- Re-read the native module load test output: if it still says "Database is not a constructor", v13 didn't actually get used
- Verify `package-lock.json` is committed and reflects v13 pinning

---

### Phase 5: Merge and Release

**After PR is approved:**

```bash
# 1. Merge fix branch
git checkout main
git merge --squash fix/97-better-sqlite3-v13
git commit -m "Merge #99: fix issue #97 - upgrade better-sqlite3 to v13 for Electron 33 support"

# 2. Tag release
git tag v0.11.9

# 3. Push to trigger release.yml
git push origin main
git push origin v0.11.9

# 4. Wait for release.yml to complete
# - It will build the installer
# - Run all three verification layers
# - Publish to GitHub Releases (installer + blockmap + latest.yml for auto-update)
```

**Release notes (auto-generated from CHANGELOG):**
```
## [0.11.9] - 2026-08-21
### Fixed
- Windows packaged builds now load better-sqlite3 correctly on Electron 33 (#97). 
  Upgraded to v13.0.0 which uses N-API for cross-version compatibility instead of 
  platform-specific prebuilts. Resolves "Database is not a constructor" crashes 
  and silent startup failures on v0.11.7–0.11.8.
```

---

## Verification Strategy

### Before Shipping (CI)
- ✅ All backend/frontend tests pass
- ✅ Asar contains better-sqlite3 native binary
- ✅ Native module loads and runs a query under Electron 33's Node ABI
- ✅ Real packaged app launches, health check passes, window appears

### After Shipping (Real User Hardware)
- Download v0.11.9 installer from GitHub Releases
- Run on clean Windows machine (preferably same config as reporter of #97)
- Verify:
  - ✅ Installer completes
  - ✅ Start menu shortcut appears
  - ✅ Double-click launches the app
  - ✅ Window opens (no "3 processes, no window" symptom)
  - ✅ Setup wizard works (Gemini key entry, tags, product sizes)
  - ✅ Can upload an image and run the pipeline

**If any step fails:** Issue a v0.11.10 hotfix immediately. Do not rely on #97 being truly fixed until end-user confirmation.

---

## Risk Assessment

**Low Risk:**
- better-sqlite3 v13 is stable (released July 2026, 1+ month in production)
- API changes are backward-compatible for our usage (no deprecated methods)
- N-API guarantee means binary compatibility across Node/Electron versions
- CI will catch any packaging issues before release

**Medium Risk:**
- First time deploying a major version bump of a critical native module
- If there's an undiscovered API change, backend crashes on startup
- Mitigation: Full test suite runs before packaging; new launch verification test catches it

**Fallback:**
- If v13 has an unexpected issue, revert to v11 and use `buildFromSource: true` (slower builds, but reliable)
- Rollback is a one-line change to package.json and a re-release cycle

---

## Timeline

| Phase | Owner | Duration | Blocker For |
|-------|-------|----------|-------------|
| Local testing | (you) | 1-2 hrs | Phase 2 |
| Packaging build | (you) | 30 min | Phase 3 |
| Prepare release branch | (you) | 15 min | Phase 4 |
| CI verification | (automated) | 10-15 min | Phase 5 |
| Merge & release | (you) | 5 min | v0.11.9 shipping |
| Real user testing | (end user) | 1-2 hrs | Close #97 |

**Estimated total:** 3-4 hours from now until v0.11.9 is published to Releases.

---

## Success Criteria

✅ **Fix is successful when:**
1. v0.11.9 release CI passes all three verification layers
2. Packaged installer launches and shows a window on real Windows hardware
3. App is fully functional (setup, UI, backend, DB queries)
4. #97 can be closed with a note: "Fixed in v0.11.9 by upgrading better-sqlite3 to v13.0.0"

❌ **Fix failed if:**
- Any CI verification step reports the native module doesn't load
- Real user reports "3 processes, no window" symptom persists
- Backend crashes with any variant of "Database is not a constructor"

---

## Post-Fix: Preventing Recurrence

The CI layers added for #97 are now permanent safeguards:
1. **Asar contents verification** — catches missing files
2. **Native module load test** — catches ABI mismatches (this is what caught v0.11.8)
3. **Full app launch test** — catches window/renderer failures

These should prevent shipping a similar broken build again. **Do not disable or skip any of these steps in future releases.**

Additional recommendations:
- Keep better-sqlite3 updated (N-API means new versions are low-risk)
- Monitor upstream releases for any deprecation warnings
- Run `npm audit` as part of CI to catch security issues early

---

## Questions to Answer Before Starting

- [ ] Have you verified locally that `npm install better-sqlite3@^13.0.0` works on your dev machine?
- [ ] Does `npm test -w backend` pass after the upgrade?
- [ ] Is the release.yml workflow accessible and up-to-date?
- [ ] Do you have push access to create tags and trigger releases?

If any are "no", resolve them before starting Phase 1.

---

## References

- **Issue:** https://github.com/allocsys/proetsy/issues/97
- **better-sqlite3 v13 release:** https://github.com/WiseLibs/better-sqlite3/releases/tag/v13.0.0
- **N-API explanation:** https://nodejs.org/api/n_api.html
- **CI verification steps:** `.github/workflows/release.yml` (lines ~200–400)

