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
    // ReviewView.jsx's copy-to-Etsy code path (writeText called with the right
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
    await expect(page.getByTestId('backend-status')).toContainText('Backend OK', { timeout: 15000 });

    const artworkPath = writeTestArtwork();

    // Drives the dropzone's plain file-input fallback (UploadView.jsx) — far more
    // reliable from Playwright than simulating an actual HTML5 drag-and-drop event
    // sequence. App.jsx routes exactly one view at a time (a switch on activeView), so
    // unlike the pre-rebuild UI there's no risk of this colliding with TasteFilter's own
    // file input -- only UploadView is ever mounted here.
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(artworkPath);

    // Upload -> job creation -> the full server-side pipeline run (image_analyzer ->
    // listing_generator -> mockup_composer, see backend/lib/pipeline-runner.js) all
    // happen inside one awaited chain in UploadView.jsx's handleUpload(); the success
    // message only appears once the run-batch call has actually returned.
    await expect(page.getByText('Pipeline started successfully!')).toBeVisible({ timeout: 20000 });

    // Module 2 (Listing Generator) is required/non-skippable — regardless of whether
    // Module 1 or the optional Module 3 (no real mockup templates exist in this test
    // environment, so it's expected to fail) had any trouble, the job's overall_status
    // should never be 'failed' for this run.
    //
    // The Listing History view only mounts once the sidebar's "Listing History" nav
    // item switches App.jsx's activeView to 'history' -- it isn't in the DOM before
    // that, so this has to navigate there rather than just waiting on the locator.
    // Sidebar.jsx and MobileNav.jsx use distinct labels ("Listing History" vs
    // "History"), so a plain role-based lookup is unambiguous even though both navs
    // render at once in this test's default viewport.
    await page.getByRole('button', { name: 'Listing History' }).click();

    // HistoryView.jsx is a card/list layout (BatchGroup/JobRow), not a table -- with a
    // single job in this run, its own "Review" button is the simplest stable anchor.
    const reviewButton = page.getByRole('button', { name: 'Review' });
    await expect(reviewButton).toBeVisible();
    await expect(page.locator('main')).not.toContainText('Failed');

    // Navigate back to the review workspace via the history row's own "Review" button —
    // this calls App.jsx's handleOpenJob(), which sets activeJobId and switches
    // activeView to 'review'. Clicking into "Listing History" above does NOT do this
    // automatically, so without this click the review workspace never mounts at all.
    await reviewButton.click();

    // The review workspace defaults to the "Analysis" tab; the Listings panel
    // (ReviewView.jsx's ListingsTab) is mounted but hidden until its tab is selected.
    // Shadcn's Tabs (Base UI underneath) render triggers with role="tab", not
    // role="button".
    await page.getByRole('tab', { name: 'Listings' }).click();

    // ListingsTab loads listings on demand via its own button.
    await page.getByRole('button', { name: 'Load Listings' }).click();

    // Module 2 always produces exactly 3 variations (fine_art/aesthetic/gift — see
    // LISTING_VARIATIONS in backend/config/shop-conventions.js), each its own card.
    // Shadcn's CardTitle renders a <div>, not a heading element, so these are matched
    // by exact text rather than role=heading.
    await expect(page.getByText('fine art', { exact: true })).toBeVisible();
    await expect(page.getByText('aesthetic', { exact: true })).toBeVisible();
    await expect(page.getByText('gift', { exact: true })).toBeVisible();

    // The fixture LLM provider's canned title for the fine_art angle — confirms actual
    // generated content made it all the way through the pipeline into the review UI,
    // not just that *some* listing rows happen to exist. Scoped to the fine_art card
    // itself (by its title text) since all three variation cards share the same
    // "Title" label, and page.getByDisplayValue() isn't a real Playwright API (it's a
    // Testing Library method, not one Playwright's Page/Locator ever exposed). Card.jsx
    // exposes a stable [data-slot="card"] hook for the outer card element.
    const fineArtCard = page.locator('[data-slot="card"]').filter({ hasText: 'fine art' });
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
