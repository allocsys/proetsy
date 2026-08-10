import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// ARCHITECTURE.md -> Testing & CI/CD -> "A small set of Playwright end-to-end tests
// covering the critical path only (upload artwork → generate listing → review →
// copy-to-clipboard) rather than exhaustive UI coverage." Runs against the real Module 6
// dashboard and a real backend process (see ../playwright.config.js's webServer entries),
// with the backend's LLM_PROVIDER set to 'fixture' (../backend/lib/llm/fixture.js) so the
// whole pipeline runs with deterministic, offline output — no real Gemini call, no API
// key, no flakiness from model output varying between runs.

// A minimal valid 1x1 PNG (base64). Small enough to inline directly rather than commit
// as a binary fixture file — mirrors the repo's existing binary-fixture convention (the
// PSD test fixture under backend/lib/__fixtures__ is also committed as base64 *text*,
// for the same "this repo's tooling writes plain-text file content, not raw binary"
// reason noted in ARCHITECTURE.md -> Module 3).
const ONE_PX_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

function writeTestArtwork() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-e2e-'));
  const filePath = path.join(dir, 'test-artwork.png');
  fs.writeFileSync(filePath, Buffer.from(ONE_PX_PNG_BASE64, 'base64'));
  return filePath;
}

test.describe('critical path: upload → generate listing → review → copy-to-clipboard', () => {
  test('uploads artwork, runs the pipeline, reviews the generated listing, and copies it for Etsy', async ({
    page,
  }) => {
    // Stub navigator.clipboard with an in-memory implementation rather than relying on
    // headless Chromium's real OS-clipboard integration, which can hang indefinitely on
    // minimal CI runners (no clipboard backend/display service) even with
    // clipboard-read/clipboard-write permissions granted. This test's goal is verifying
    // JobListingReview.jsx's copy-to-Etsy code path (writeText called with the right
    // content, UI reflects success), not Chromium's OS clipboard plumbing -- addInitScript
    // runs before any page script, so copyForEtsy()'s real call still exercises the same
    // code path, just against a stub that always resolves.
    await page.addInitScript(() => {
      let clipboardText = '';
      navigator.clipboard.writeText = async (text) => {
        clipboardText = text;
      };
      navigator.clipboard.readText = async () => clipboardText;
    });

    await page.goto('/');

    // Confirm the backend is actually reachable before doing anything real — a much
    // clearer failure point than the upload step silently hanging if the webServer
    // didn't come up in time.
    await expect(page.getByText('Backend:')).toContainText('ok', { timeout: 15000 });

    const artworkPath = writeTestArtwork();
    // The direct-upload Pipeline lane (including #section-pipeline and its "Done."
    // status text below) lives inside a <details> that's collapsed by default -- expand
    // it first. setInputFiles doesn't require visibility, so skipping this click would
    // let the upload silently succeed while the "Done." text stayed hidden inside the
    // closed disclosure, timing out the later toBeVisible() assertion for the wrong
    // reason.
    await page.getByText('Direct upload (skips curation').click();

    // Drives the dropzone's plain file-input fallback (Module 6 -> "A drop zone (plus a
    // plain file input fallback)") — far more reliable from Playwright than simulating
    // an actual HTML5 drag-and-drop event sequence. Scoped to #section-pipeline: Module
    // 7's TasteFilter importer (frontend/src/TasteFilter.jsx) also renders an
    // `input[type="file"][accept="image/*"]`, so the bare selector is ambiguous
    // (2 matches) now that both exist on the page at once.
    await page.locator('#section-pipeline input[type="file"][accept="image/*"]').setInputFiles(artworkPath);

    // Upload -> job creation -> the full server-side pipeline run (image_analyzer ->
    // listing_generator -> mockup_composer, see backend/lib/pipeline-runner.js) all
    // happen inside one awaited chain in App.jsx's handleFiles(); the "Done." status
    // message only appears once POST /api/jobs/run-batch has actually returned.
    await expect(page.getByText(/^Done\./)).toBeVisible({ timeout: 20000 });

    // Module 2 (Listing Generator) is required/non-skippable — regardless of whether
    // Module 1 or the optional Module 3 (no real mockup templates exist in this test
    // environment, so it's expected to fail) had any trouble, the job's overall_status
    // should never be 'failed' for this run.
    //
    // The Listing History table only mounts once the sidebar's "Listing History" nav
    // item switches App.jsx's activeView to 'history' -- it isn't in the DOM before
    // that, so this has to navigate there rather than just waiting on the locator.
    // Scoped to .sidebar-nav-item: the same label also appears in .mobile-nav-strip
    // (both render at once in this test's default viewport), so the bare text/role
    // selector would match twice.
    await page.locator('.sidebar-nav-item', { hasText: 'Listing History' }).click();
    const historyRow = page.locator('table.data-table tbody tr').first();
    await expect(historyRow).not.toContainText('failed');

    // Navigate back to the review workspace via the history row's own "Review" button —
    // this calls App.jsx's openJob(), which sets activeJobId and switches activeView to
    // 'review'. Clicking into "Listing History" above does NOT do this automatically, so
    // without this click the review workspace never mounts at all.
    await historyRow.getByRole('button', { name: 'Review' }).click();

    // The review workspace defaults to the "Image Analysis" tab; the Listings panel
    // (JobListingReview.jsx) is mounted but display:none until its tab is selected.
    // Note: "Listings" is a workspace-tab-btn label, never an actual heading anywhere in
    // the app, so asserting getByRole('heading', { name: 'Listings' }) here (as before)
    // could never have matched even with the navigation fixed.
    await page.getByRole('button', { name: 'Listings' }).click();

    // JobListingReview.jsx loads listings on demand via its own button.
    await page.getByRole('button', { name: 'Load listings' }).click();

    // Module 2 always produces exactly 3 variations (fine_art/aesthetic/gift — see
    // LISTING_VARIATIONS in backend/config/shop-conventions.js), each its own card.
    await expect(page.getByRole('heading', { name: 'fine art' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'aesthetic' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'gift' })).toBeVisible();

    // The fixture LLM provider's canned title for the fine_art angle — confirms actual
    // generated content made it all the way through the pipeline into the review UI,
    // not just that *some* listing rows happen to exist. Scoped to the fine_art card
    // itself (by its heading text) since all three variation cards share the same
    // "Title" label, and page.getByDisplayValue() isn't a real Playwright API (it's a
    // Testing Library method, not one Playwright's Page/Locator ever exposed).
    const fineArtCard = page.locator('div.dark-panel').filter({ hasText: 'fine art' });
    await expect(fineArtCard.getByLabel('Title')).toHaveValue('fine art fixture title');

    // Copy-to-clipboard: click the fine-art card's own "Copy for Etsy" button and confirm
    // both the button's own visual feedback and the real clipboard contents. Located by
    // data-testid rather than accessible name/role text -- a name-based locator re-queries
    // the DOM for an element matching that name every time it's used, and this button's
    // own name/text changes to "Copied!" the instant the click's state update lands, so
    // asserting on the same name-based locator afterward was racing against the very
    // change it was trying to observe (it would intermittently find no match at all).
    // A stable data-testid isn't affected by the button's text changing. Scoped to
    // fineArtCard (not .first() over the whole page) since the three variation cards'
    // DOM order isn't guaranteed to put fine_art first -- the assertion below expects
    // fine-art-specific content, so it needs the fine-art-specific button.
    const copyButton = fineArtCard.getByTestId('copy-for-etsy');
    await copyButton.click();
    await expect(copyButton).toHaveText('Copied!');

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('fine art fixture title');
    expect(clipboardText).toContain('Tags:');
  });
});
