# Functional Correctness Review Findings — Taste Filter / Curation System

**Repo:** allocsys/proetsy
**Branch:** feat/frontend-rebuild-tailwind-shadcn
**Found:** functional correctness review, 2026-08-12
**Status:** Open, not yet fixed

Follow-up to `functional-correctness-review-2026-08-11.md`, scoped specifically to
the Taste Filter module (candidate scoring/curation) and its Settings panel controls,
following a targeted review request. Issues #1 and #2 below are regressions introduced
by the frontend rewrite (`SettingsView.jsx` writes settings keys that don't match what
the backend actually reads); issue #3 is a pre-existing backend-only bug in code the
rewrite never touched (`backend/lib/taste-filter/watcher.js`), included here since it's
part of the same subsystem.

---

## 1. Watch Folder settings write to keys the watcher never reads
**Severity:** Critical — auto-import via watched folder cannot be enabled from the UI at all

### Summary
`WatchFolderSection` (Settings → Automation) reads and writes `watch_folder_enabled`
and `watch_folder_path`. The actual watcher only ever reads three different keys:

```js
// backend/lib/taste-filter/watcher.js
export const SETTING_ENABLED = 'taste_filter_watch_enabled';
export const SETTING_FOLDER = 'taste_filter_watch_folder';
export const SETTING_CATEGORY = 'taste_filter_watch_category';
```

None of the frontend's keys match any of these. Toggling the switch or saving a
folder path in Settings has no effect on `syncWatcherFromSettings()` — the watcher
never starts.

The Watch Status panel is also reading the wrong response shape.
`getWatcherStatus()` returns:

```js
{ active, folder, category, pendingCount, lastError }
```

but the frontend reads `watchStatus.watching` (should be `active`), and
`watchStatus.files_found` (should be `pendingCount`); `watchStatus.last_scan` isn't
a field the backend returns at all, so that row never renders. `lastError` — the one
field that would tell a user *why* the watcher isn't running (e.g. a bad folder path)
— isn't read by the UI at all.

### Where it happens
`frontend/src/views/SettingsView.jsx`, `WatchFolderSection`:

```js
const handleToggleWatch = useCallback((checked) => {
  saveTask.run(async () => {
    await api.settings.patch({ watch_folder_enabled: checked });
    ...
const handleSavePath = useCallback(() => {
  saveTask.run(async () => {
    await api.settings.patch({ watch_folder_path: settings.watch_folder_path || null });
    ...
```

```js
<Badge variant={watchStatus.watching ? 'default' : 'outline'} ...>
  {watchStatus.watching ? 'Watching' : 'Idle'}
</Badge>
...
{watchStatus.files_found !== undefined && ( ... )}
```

### Impact
There is currently no way to enable or configure auto-import via a watched folder
from the dashboard. Even a user who correctly toggles the switch and enters a valid
folder path sees no effect — the watcher stays off, and the status panel always
shows "Idle" regardless of the true state, with no error surfaced. There's also no
field for `taste_filter_watch_category` at all, so even once the key names are
fixed, category-scoped watching has no UI.

### Suggested fix
- Rename the settings keys `WatchFolderSection` reads/writes to
  `taste_filter_watch_enabled` / `taste_filter_watch_folder` (and add a field for
  `taste_filter_watch_category`).
- Fix the status panel to read `watchStatus.active` and `watchStatus.pendingCount`,
  drop the `last_scan` field (or add it server-side if that data is wanted), and
  surface `watchStatus.lastError` when present.

---

## 2. "Taste Filter Auto Mode" toggle writes to the wrong settings key
**Severity:** High — the switch has no effect, and misrepresents the real (enabled-by-default) state

### Summary
`TasteFilterAutoSection`'s switch reads/writes `taste_filter_auto`. The backend's
actual key — read by `POST /api/taste-filter/import` to decide whether to
auto-decide keep/discard — is `taste_filter_auto_enabled`, which **defaults to
`'true'`**:

```js
// backend/server.js
const SETTING_AUTO_ENABLED = 'taste_filter_auto_enabled';
const AUTO_SETTING_DEFAULTS = { [SETTING_AUTO_ENABLED]: 'true', ... };
```

Toggling the switch never touches this key, so it has zero effect on real behavior.
Worse, because the UI reads `settings.taste_filter_auto` (undefined, since the
backend never writes that key) instead of `settings.taste_filter_auto_enabled`, the
switch always renders **off** — actively misleading, since auto-decide mode is
actually **on** by default. The threshold field in the same section is correctly
wired (`taste_filter_auto_threshold` matches on both sides) and is not affected.

### Where it happens
`frontend/src/views/SettingsView.jsx`, `TasteFilterAutoSection`:

```js
<Switch
  checked={settings.taste_filter_auto ?? false}
  onCheckedChange={handleToggleAuto}
  ...
const handleToggleAuto = useCallback((checked) => {
  saveTask.run(async () => {
    await api.settings.patch({ taste_filter_auto: checked });
    ...
```

### Impact
A user who explicitly turns the switch off (believing it will stop auto keep/discard
decisions during import) has no effect — auto mode keeps running at whatever the
real `taste_filter_auto_enabled` value is. Conversely the switch's always-off display
gives no indication that auto-decide is silently active.

### Suggested fix
Change both the read (`settings.taste_filter_auto` → `settings.taste_filter_auto_enabled`)
and the write (`{ taste_filter_auto: checked }` → `{ taste_filter_auto_enabled: checked }`)
to match the key `server.js` actually uses.

---

## 3. Watched-folder candidates never receive a category score (pre-existing, backend-only)
**Severity:** Low — degrades a secondary signal, not a hard break; unrelated to the frontend rewrite

### Summary
`handleNewFile()` in the watcher calls `scoreCandidate` with an `orientation` key
instead of `category`:

```js
// backend/lib/taste-filter/watcher.js
const scores = scoreCandidate(embedding, { global: globalCentroids, orientation: categoryCentroids });
```

`scoreCandidate` only destructures `{ global, category }`
(`backend/lib/taste-filter/scoring.js`), so `category` is always `undefined` here and
the `if (category)` branch inside `scoreCandidate` never runs. Compare with the
manual-import path (`POST /api/taste-filter/import` in `server.js`), which correctly
passes `category: categoryCentroids`.

### Where it happens
`backend/lib/taste-filter/watcher.js`, `handleNewFile()` — see snippet above.

### Impact
Every candidate picked up via the auto-watched-folder flow gets only a global taste
score; `categoryScore`/`categoryLabel`/`categoryConfident` are always `null`,
regardless of `taste_filter_watch_category`. Candidates dropped in manually (drag-
and-drop import) are unaffected — this only affects the watcher path. This file
lives entirely in `backend/`, which the frontend redesign didn't touch, so this is a
pre-existing bug, not a regression from the rewrite.

### Suggested fix
Change `orientation: categoryCentroids` to `category: categoryCentroids` in the
`scoreCandidate` call inside `handleNewFile()`.
