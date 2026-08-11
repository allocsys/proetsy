# Frontend UI Fix Plan

Context: the frontend (`frontend/src/`) works functionally but looks unpolished.
Verified against the repo on 2026-08-11:

- `App.jsx` is 1,795 lines with 51 `useState` hooks and 85 inline `style={{...}}` usages.
- `p-2`, `p-3`, `p-4`, `p-5`, `m-0`, `font-bold`, `items-center`, `justify-between`
  are used as `className` values in `PromptHelper.jsx`, `TasteFilter.jsx`, and
  `JobMockupReview.jsx`, but none of them are defined in `styles.css` — they
  silently do nothing (broken spacing/layout in those three files only).
- No router package in `package.json`; navigation is pure `activeView` state.
- There IS a real hand-rolled design system already (CSS custom properties for
  spacing/color/radius/shadow, `StatusPill` component, consistent `.card` /
  `.btn-primary` / `.btn-secondary` / `.data-table` / `.workspace-tabs` classes,
  focus-visible states, responsive breakpoints). This is not a from-scratch
  rebuild — it's cleanup, consolidation, and componentization on top of an
  existing system.

Goal: sequence the work from highest-visual-impact/lowest-risk to more
structural, so every step ships independently and the app never breaks mid-way.

---

## Step 1 — Kill the phantom utility classes (quick, safe, isolated) ✅ DONE
**Files:** `PromptHelper.jsx`, `TasteFilter.jsx`, `JobMockupReview.jsx`
**Status:** Merged to `main` (branch `fix/phantom-utility-classes`).
- Replace `p-2/p-3/p-4/p-5`, `m-0`, `font-bold`, `items-center`, `justify-between`
  with either (a) the existing spacing scale (`--space-*` vars) via new small
  utility classes added to `styles.css`, or (b) inline equivalents matching
  what's already used elsewhere in the same file.
- No behavior change. Verify visually in the three affected views (Prompt
  Helper, Taste Filter upload lane, Mockup review).
- Risk: near zero. Ship first.

## Step 2 — Add loading skeletons and real empty states ✅ DONE
**Status:** Merged to `main` (branch `feat/skeletons-empty-states`).
- Replace bare "Loading…" text (tags, trends, API keys, rate limits, jobs)
  with a small `<Skeleton />` component (a few CSS-only placeholder bars using
  existing `--studio-*` tokens).
- Replace italic `.empty-state` text-only empty states with icon + message +
  CTA where a CTA makes sense (e.g. "No jobs yet" → link to Upload), matching
  the pattern already used in the Listing History empty state.
- Still no structural change to App.jsx; purely visual/component-level.

## Step 3 — Extract shared UI primitives ✅ DONE
**Status:** Merged to `main` via PR #69 (branch `refactor/shared-ui-primitives`).
- Pull recurring inline patterns into small components in
  `frontend/src/components/`: `Skeleton`, `EmptyState`, `Modal` (generalize the
  existing confirm-dialog markup), `Tabs` (generalize `.workspace-tabs`),
  `FormField` (label + input + saved-flash, used ~15x in Settings).
- Swap these into App.jsx and the Job* review components in place, one
  component at a time, so each swap is independently testable.
- This directly reduces the 85 inline-style usages as a side effect, since the
  new components own their own styling.
- Landed: `Modal` swapped into the confirm dialog; `Tabs` swapped into the
  Settings sub-tabs and Job review tabs; `FormField` swapped into Default
  price, Delivery text, Watched folder path, Watch category, and Auto
  threshold. All CI checks green.

## Step 4 — Break `App.jsx` into route-level view components ✅ DONE
**Status:** Merged to `main` via PR #70 (branch `refactor/split-app-into-views`).
- Shared state lifted into `hooks/useJobs.js`, `hooks/useSettings.js`,
  `hooks/useTagsAndTrends.js`, `hooks/useApiKeys.js` (plus a pre-existing
  `hooks/useAsyncTask.js`); App.jsx now only owns cross-cutting nav/dialog
  state instead of one 51-`useState` blob.
- Split into `views/UploadView.jsx`, `views/HistoryView.jsx`,
  `views/ReviewView.jsx`, `views/SettingsView.jsx` (kept as one file with its
  four sub-tabs switched internally, matching how it already worked — no
  further `views/settings/*` split needed), `views/PromptHelperView.jsx`,
  `views/MockupTemplatesView.jsx`. Each view takes only the hook return
  values/props it needs.
- Remaining before merge: run the full test suite (`App.test.jsx` covers this
  flow end-to-end through the DOM, so it should still pass unchanged since no
  rendered markup was altered) and open a PR.

## Step 5 — Add React Router ✅ DONE (pending CI/merge)
**Status:** Implemented on branch `feat/react-router`, not yet merged to `main`.
- Added `react-router-dom` (^6.26.2) to `frontend/package.json`.
- `main.jsx` now wraps `<App />` in `BrowserRouter`.
- `App.jsx` converted from `activeView`/`goTo()` state to `<Routes>`/`<Route>`
  with `useNavigate`/`useLocation`; NAV_ITEMS ids mapped to `/upload`,
  `/mockup-templates`, `/history`, `/review/:jobId?`, `/prompt-helper`,
  `/settings/:tab?`, with `/` and unknown paths redirecting to `/upload`.
  Settings/review data-refresh side effects reimplemented as route-keyed
  `useEffect`s so deep links trigger them too, not just sidebar clicks.
- `ReviewView.jsx` reads `:jobId` via `useParams()` and navigates to
  `/review/:jobId` on job selection; `SettingsView.jsx` reads `:tab` via
  `useParams()` (defaulting to `tags-trends`) and navigates on sub-tab clicks.
- `App.test.jsx` render calls wrapped in `MemoryRouter` so existing assertions
  still pass.
- Remaining before merge: confirm CI is green on `feat/react-router`, manual
  smoke test of deep links (`/review/:jobId`, `/settings/:tab`), then open a PR.

## Step 6 — Polish pass
- Toast notifications for save/copy/error actions, replacing inline
  `*Message` state where a transient toast reads better than persistent text
  (keep persistent text where the message needs to stay visible, e.g. API key
  add errors).
- Page/view transition animation on route change (Step 5 makes this trivial).
- Keyboard shortcuts for power users (e.g. `g` then a letter for nav, matching
  the existing sidebar groups).
- Light theme: the `--studio-*` variable system already isolates all color
  values, so this is mostly adding a second `:root[data-theme="light"]` block
  and a toggle — no component changes needed if Steps 1–4 kept styling in CSS
  variables rather than hardcoded inline colors.

---

## Explicitly deferred / not recommended as a first move
- A full Tailwind + shadcn/ui rewrite. The existing design system is coherent
  and mostly not broken — the phantom classes are a small, contained bug, not
  evidence the whole styling approach needs replacing. Revisit only if, after
  Steps 1–4, the team still finds the CSS-variable system limiting.

## Suggested order for shipping (smallest safe PRs)
1. Step 1 (phantom classes)
2. Step 2 (skeletons/empty states)
3. Step 3 (shared primitives)
4. Step 4 (split App.jsx)
5. Step 5 (router)
6. Step 6 (polish, pick items independently as time allows)
