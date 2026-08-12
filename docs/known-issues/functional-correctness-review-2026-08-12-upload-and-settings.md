# Functional Correctness Review Findings — Upload Flow / API Key Settings

**Repo:** allocsys/proetsy
**Branch:** feat/frontend-rebuild-tailwind-shadcn
**Found:** functional correctness review, 2026-08-12
**Status:** Open, not yet fixed

Follow-up to `functional-correctness-review-2026-08-12.md` (Taste Filter / Curation
review). This pass audited the frontend rewrite for API calls that don't match
backend route definitions, across the upload flow and the Settings API Keys panel.
Both issues below are regressions introduced by the frontend rewrite: the backend
routes are unchanged and correct, but `UploadView.jsx` and `SettingsView.jsx` send
payloads that don't match what the backend expects.

---

## 1. Artwork upload sends the wrong multipart field name
**Severity:** Critical — no artwork can be uploaded via the dashboard at all

### Summary
`UploadView.jsx` appends files to `FormData` under the field name `artworks`. The
backend's `multer` middleware for the upload route is configured to only accept a
field named `files`:

```js
// frontend/src/views/UploadView.jsx (line 108)
formData.append('artworks', file);
```

```js
// backend/server.js (line 214)
app.post('/api/artworks/upload', upload.array('files', 50), ...)
```

Because the field names don't match, `multer` populates an empty file array, which
trips the `if (!files.length)` guard at `backend/server.js:216` and returns a
`400 Bad Request` ("No files uploaded (expected multipart field \"files\")") for
every upload attempt.

### Where it happens
`frontend/src/views/UploadView.jsx:108`

### Impact
This blocks the pipeline's entry point entirely — no artwork can be uploaded through
the UI, so no downstream analysis, listing generation, or mockup composition can run
until this is fixed.

### Suggested fix
Change `formData.append('artworks', file)` to `formData.append('files', file)` in
`UploadView.jsx:108` to match the backend's `multer` field name.

---

## 2. API key creation sends the wrong payload key
**Severity:** High — adding a new API key from Settings fails

### Summary
`SettingsView.jsx` submits new API keys with a `key` field, but the backend route
requires `key_value` and explicitly validates its presence:

```js
// frontend/src/views/SettingsView.jsx (line 697)
await api.apiKeys.add({ provider, key: newKeyValue, label: newLabel });
```

```js
// backend/server.js (line 334-335)
app.post('/api/keys', (req, res) => {
  const { provider, key_value, label } = req.body;
  if (!key_value) { ... }
```

Since the frontend never sends `key_value`, the backend's required-field check
fails and the request is rejected.

### Where it happens
`frontend/src/views/SettingsView.jsx:697`

### Impact
Users cannot add new API keys from the Settings → API Keys panel; the form appears
functional (masked key list loads correctly via `api.apiKeys.list()`) but submission
fails.

### Suggested fix
Change the payload in `SettingsView.jsx:697` from `{ provider, key: newKeyValue,
label: newLabel }` to `{ provider, key_value: newKeyValue, label: newLabel }` to
match the backend's expected field name.
