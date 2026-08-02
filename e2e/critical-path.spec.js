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
  test.use({ permissions: ['clipboard-read', 'clipboard-write'] });

  test('uploads artwork, runs the pipeline, reviews the generated listing, and copies it for Etsy', async ({
    page,
  }) => {
    await page.goto('/');

    // Confirm the backend is actually reachable before doing anything real — a much
    // clearer failure point than the upload step silently hanging if the webServer
    // didn't come up in time.
    await expect(page.getByText('Backend:')).toContainText('ok', { timeout: 15000 });

    const artworkPath = writeTestArtwork();
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
    const historyRow = page.locator('table.data-table tbody tr').first();
    await expect(historyRow).not.toContainText('failed');

    // Exactly one artwork was uploaded, so App.jsx auto-selects it as the active job
    // (handleFiles: "if (jobIds.length === 1) setActiveJobId(...)") — the review section
    // should already be showing, no need to type a job id in manually.
    await expect(page.getByRole('heading', { name: 'Listings' })).toBeVisible();

    // JobListingReview.jsx loads listings on demand via its own button.
    await page.getByRole('button', { name: 'Load listings' }).click();

    // Module 2 always produces exactly 3 variations (fine_art/aesthetic/gift — see
    // LISTING_VARIATIONS in backend/config/shop-conventions.js), each its own card.
    await expect(page.getByRole('heading', { name: 'fine art' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'aesthetic' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'gift' })).toBeVisible();

    // The fixture LLM provider's canned title for the fine_art angle — confirms actual
    // generated content made it all the way through the pipeline into the review UI,
    // not just that *some* listing rows happen to exist.
    await expect(page.getByDisplayValue('fine art fixture title')).toBeVisible();

    // Copy-to-clipboard: click the first "Copy for Etsy" button and confirm both the
    // button's own visual feedback and the real clipboard contents.
    const copyButton = page.getByRole('button', { name: 'Copy for Etsy' }).first();
    await copyButton.click();
    await expect(copyButton).toHaveText('Copied!');

    const clipboardText = await page.evaluate(() => navigator.clipboard.readText());
    expect(clipboardText).toContain('fine art fixture title');
    expect(clipboardText).toContain('Tags:');
  });
});
