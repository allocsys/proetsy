# Dashboard/Frontend Redesign Plan

## Current State

**Stack:** React 18 + Vite. Plain CSS with custom properties (no Tailwind/UI library). Editorial dark/paper aesthetic (Fraunces + Inter + IBM Plex Mono) that's cohesive in concept but poorly executed in code.

**Core problems:**
1. Invalid CSS selector `button:primary` in `styles.css` — buttons silently fall back to browser defaults instead of getting primary styling.
2. Jarring light-paper vs. dark-panel switching between sections with no consistent surface hierarchy (`.paper-card` vs `.dark-panel`).
3. Rigid fixed-width layouts (`150px` label columns in `JobArtworkAnalysisReview.jsx`, `200px` image widths in `JobMockupReview.jsx`) that break on smaller viewports.
4. Inline styles scattered across every component (`JobArtworkAnalysisReview.jsx`, `JobListingReview.jsx`, `JobMockupReview.jsx`, `PromptHelper.jsx`, `TasteFilter.jsx`) — magic numbers everywhere, no reuse.
5. Accessibility gaps — unlabeled form inputs, color-only status indicators (`.status-dot`/`.status-pill`).
6. No real design token system — spacing/radii/shadows are ad hoc (radii vary arbitrarily between `4px`, `6px`, `8px`, `999px`).

## Multi-Session Fix Plan

### Session 1 — Foundation & tokens
- Fix the `button:primary` bug in `styles.css`.
- Build out a proper token system: spacing scale, radius scale, shadow scale (currently only colors/fonts have variables).
- Decide on ONE surface paradigm (pick paper or dark as primary, use the other only as a deliberate accent) and document the rule.

### Session 2 — Component extraction (part 1)
- Pull inline styles out of `JobArtworkAnalysisReview.jsx` and `JobMockupReview.jsx` into shared CSS classes using the new tokens.
- Fix rigid grids (`150px 1fr`, hardcoded `200px` widths) → responsive `minmax()`/`clamp()`-based layouts.

### Session 3 — Component extraction (part 2) + forms
- Same de-inlining pass for `JobListingReview.jsx`, `PromptHelper.jsx`, `TasteFilter.jsx`.
- Add proper `<label>` associations to all form controls.

### Session 4 — Accessibility & polish
- Add `aria-label`/text alternatives to status pills (not color-only).
- Responsive pass: test at mobile/tablet widths, fix breakpoints.
- Final consistency audit (border radii, spacing) across all components.
