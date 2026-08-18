import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import ReviewView from './ReviewView.jsx';

// plan.md Phase 4 — "Reduce manual per-listing editing": the pre-save "contains X,
// will be removed on save" hints were removed from ListingCard, and the server's
// `warnings` (already stripped by enforceConventions — see backend/server.listing-
// routes.test.js) are now surfaced only *after* a save, via a toast description and
// the existing inline amber note. These tests cover that UI behavior; the backend
// stripping itself is already covered by server.listing-routes.test.js.

const CONVENTIONS = {
  listing: {
    maxTitleLength: 140,
    tagsPerListing: 13,
    maxTagLength: 20,
    forbiddenTitleWords: ['framed'],
    aiDisclosurePhrases: ['ai-generated'],
    deliveryDetailPhrases: ['digital download'],
  },
};

const LISTING = {
  id: 101,
  job_id: 7,
  variation: 'square',
  title: 'Original title',
  description: 'Original description.',
  tags: ['abstract', 'wall art'],
  tag_alternates: ['modern art'],
  warnings: [],
};

function makeFetchQueue(map) {
  return vi.fn((url) => {
    const entry = map.find(([matcher]) =>
      typeof matcher === 'string' ? url === matcher : matcher.test(url)
    );
    if (entry) return Promise.resolve(entry[1](url));
    // Unmapped requests (e.g. the mockup-template lookups fired by MockupsTab, which
    // is always mounted alongside ListingsTab per this app's Tabs test mock) get a
    // harmless empty 200 instead of failing the test.
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

beforeEach(() => {
  toast.success.mockClear();
  global.fetch = makeFetchQueue([
    ['/api/config/shop-conventions', () => ({ ok: true, json: async () => CONVENTIONS })],
    ['/api/jobs/7/listings', () => ({ ok: true, json: async () => [LISTING] })],
  ]);
});

// ReviewView's JobPicker only auto-fetches the job when `jobId` changes post-mount
// (navigation case) — passing jobId as the initial prop just seeds `activeJobId`
// directly, so ListingsTab already has a jobId and "Load Listings" is clickable
// without going through JobPicker's own "Load" button first.
async function renderWithListingsLoaded() {
  const user = userEvent.setup();
  render(<ReviewView jobId={7} />);
  await user.click(screen.getByRole('button', { name: /Load Listings/i }));
  await screen.findByDisplayValue('Original title');
  return user;
}

describe('ReviewView — Listings tab (Phase 4: post-save diff notice)', () => {
  it('never shows a pre-save "will be removed on save" hint, even when typed text matches a forbidden phrase', async () => {
    const user = await renderWithListingsLoaded();

    const titleInput = screen.getByDisplayValue('Original title');
    await user.clear(titleInput);
    await user.type(titleInput, 'A framed wall art print');

    const descInput = screen.getByDisplayValue('Original description.');
    await user.clear(descInput);
    await user.type(descInput, 'Made with ai-generated art, digital download only.');

    expect(screen.queryByText(/will be removed on save/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Contains forbidden word/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Contains AI-disclosure phrase/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Contains delivery-detail phrase/i)).not.toBeInTheDocument();
  });

  it('surfaces a post-save diff notice (toast description + inline note) when the server strips content', async () => {
    global.fetch = makeFetchQueue([
      ['/api/config/shop-conventions', () => ({ ok: true, json: async () => CONVENTIONS })],
      ['/api/jobs/7/listings', () => ({ ok: true, json: async () => [LISTING] })],
      [/\/api\/jobs\/7\/listings\/101$/, () => ({
        ok: true,
        json: async () => ({
          ...LISTING,
          title: 'A wall art print',
          description: 'Made with art.',
          warnings: [
            'Removed frame reference(s) from title: framed',
            'Removed AI-disclosure phrase(s): ai-generated',
          ],
        }),
      })],
    ]);
    const user = await renderWithListingsLoaded();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Removed frame reference(s) from title: framed')).toBeInTheDocument();
    expect(screen.getByText('Removed AI-disclosure phrase(s): ai-generated')).toBeInTheDocument();

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Listing saved', {
        description: 'Removed frame reference(s) from title: framed · Removed AI-disclosure phrase(s): ai-generated',
      });
    });
  });

  it('shows a plain "Listing saved" toast and no inline note when nothing needed stripping', async () => {
    global.fetch = makeFetchQueue([
      ['/api/config/shop-conventions', () => ({ ok: true, json: async () => CONVENTIONS })],
      ['/api/jobs/7/listings', () => ({ ok: true, json: async () => [LISTING] })],
      [/\/api\/jobs\/7\/listings\/101$/, () => ({
        ok: true,
        json: async () => ({ ...LISTING, warnings: [] }),
      })],
    ]);
    const user = await renderWithListingsLoaded();

    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Listing saved');
    });
    expect(screen.queryByText(/Removed/i)).not.toBeInTheDocument();
  });
});
