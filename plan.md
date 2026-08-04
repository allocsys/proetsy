# Glassmorphism UI Overhaul — Plan

Branch: `feature/glassmorphism`

Goal: apply a consistent glassmorphism style (frosted/translucent surfaces,
backdrop blur, soft borders, layered background) across the whole frontend,
rolled out in small batches per page/component so each change is easy to
review and revert independently.

## Batches

- [x] **1. Foundation** — `frontend/src/styles.css`, `frontend/src/App.jsx`
  - Design tokens (blur/opacity/radius CSS custom properties)
  - Reusable glass utility classes (`.glass-surface`, `.glass-panel`,
    `.glass-card`, `.glass-nav`, `.glass-sidebar`, `.glass-input`)
  - Layered/blurred background so translucency has something to show through
  - Applied to app shell: titlebar nav, sidebar, mobile nav strip

- [x] **2. JobArtworkAnalysisReview.jsx**
  - Apply glass classes to review cards/panels, keep functionality unchanged

- [x] **3. JobListingReview.jsx**
  - Apply glass classes to listing review cards/panels

- [x] **4. JobMockupReview.jsx**
  - Apply glass classes to mockup review cards/panels

- [x] **5. MockupTemplates.jsx**
  - Apply glass classes to template list/grid and detail panels

- [ ] **6. PromptHelper.jsx**
  - Apply glass classes to prompt input/output panels

- [ ] **7. TasteFilter.jsx**
  - Apply glass classes to filter controls and result panels

- [ ] **8. UpdaterStatus.jsx**
  - Apply glass classes to the status widget

## Approach per batch

Each batch is a single `delegate_designer` call scoped to one component
(plus `styles.css` only if new utility classes are needed), so that:

- Diffs stay small and reviewable
- A failure in one batch doesn't block the others
- Functionality/logic is left untouched — styling only

## Notes

- All work happens on `feature/glassmorphism`, never on `main`.
- `delegate_designer` is restricted to `.html/.css/.scss/.jsx/.tsx/.vue`
  files, matching this repo's frontend stack.
- After all batches are complete, open a PR from `feature/glassmorphism`
  into `main` for review.
