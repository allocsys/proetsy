import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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

// plan.md Phase 5 — "Smart defaults for mockup generation": the last-used mockup
// category selection is persisted to the generic `settings` key/value store (see
// MOCKUP_LAST_CATEGORIES_SETTING in ReviewView.jsx) and pre-checked on mount instead of
// starting from nothing every time; an "All enabled templates" quick-select is available
// alongside the per-category checkboxes.

const MOCKUP_CATEGORIES = ['wall art', 'mugs'];
const MOCKUP_TEMPLATES = [
  { size_key: 'wa-12x16', category: 'wall art' },
  { size_key: 'mug-11oz', category: 'mugs' },
];

function mockupTemplateEndpoints(settingsOverrides = {}) {
  return [
    ['/api/mockup-templates/categories', () => ({ ok: true, json: async () => MOCKUP_CATEGORIES })],
    ['/api/mockup-templates', () => ({ ok: true, json: async () => MOCKUP_TEMPLATES })],
    ['/api/settings', () => ({ ok: true, json: async () => settingsOverrides })],
  ];
}

function checkboxFor(labelText) {
  return within(screen.getByText(labelText).closest('label')).getByRole('checkbox');
}

describe('ReviewView — Mockups tab (Phase 5: smart defaults for mockup generation)', () => {
  it('pre-checks the last-used category selection on mount instead of starting from nothing', async () => {
    global.fetch = makeFetchQueue(
      mockupTemplateEndpoints({ mockup_last_categories: JSON.stringify(['mugs']) })
    );
    render(<ReviewView jobId={7} />);

    await screen.findByText('Select Mockup Categories');
    await waitFor(() => expect(checkboxFor('mugs').checked).toBe(true));
    expect(checkboxFor('wall art').checked).toBe(false);
  });

  it('starts with nothing checked when no last-used selection is saved yet', async () => {
    global.fetch = makeFetchQueue(mockupTemplateEndpoints({}));
    render(<ReviewView jobId={7} />);

    await screen.findByText('Select Mockup Categories');
    expect(checkboxFor('wall art').checked).toBe(false);
    expect(checkboxFor('mugs').checked).toBe(false);
  });

  it('"All enabled templates" checks every category in one click', async () => {
    global.fetch = makeFetchQueue(mockupTemplateEndpoints({}));
    const user = userEvent.setup();
    render(<ReviewView jobId={7} />);

    await screen.findByText('Select Mockup Categories');
    await user.click(screen.getByRole('button', { name: 'All enabled templates' }));

    expect(checkboxFor('wall art').checked).toBe(true);
    expect(checkboxFor('mugs').checked).toBe(true);
  });

  it('persists the checked selection as the new "last used" set after generating', async () => {
    const fetchMock = makeFetchQueue([
      ...mockupTemplateEndpoints({}),
      ['/api/jobs/7/run', () => ({ ok: true, json: async () => ({ job: { id: 7 } }) })],
      ['/api/jobs/7/mockups', () => ({ ok: true, json: async () => [] })],
    ]);
    global.fetch = fetchMock;
    const user = userEvent.setup();
    render(<ReviewView jobId={7} />);

    await screen.findByText('Select Mockup Categories');
    await user.click(checkboxFor('mugs'));
    await user.click(screen.getByRole('button', { name: /Generate Mockups/i }));

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([url, options]) => url === '/api/settings' && options?.method === 'PATCH'
      );
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(patchCall[1].body)).toEqual({
        mockup_last_categories: JSON.stringify(['mugs']),
      });
    });
  });

  it('does not leak an unsaved manual selection across job switches (regression: checked state must be re-derived from settings on every effect run, not left stale when there is no saved last-used selection)', async () => {
    const fetchMock = makeFetchQueue([
      ...mockupTemplateEndpoints({}),
      ['/api/jobs/8', () => ({ ok: true, json: async () => ({ id: 8, overall_status: 'pending' }) })],
    ]);
    global.fetch = fetchMock;
    const user = userEvent.setup();
    const { rerender } = render(<ReviewView jobId={7} />);

    await screen.findByText('Select Mockup Categories');
    await user.click(checkboxFor('mugs'));
    expect(checkboxFor('mugs').checked).toBe(true);

    // Switch to a different job without generating -- e.g. navigating to another job
    // from History. MockupCategorySelector isn't remounted (MockupsTab renders the same
    // instance), so its own effect must re-derive `checked` fresh rather than leaving
    // job 7's unsaved manual check in place.
    rerender(<ReviewView jobId={8} />);
    await screen.findByText(/Job #8/);

    await waitFor(() => expect(checkboxFor('mugs').checked).toBe(false));
    expect(checkboxFor('wall art').checked).toBe(false);
  });
});

// plan.md Phase 6 — "Approve all non-flagged": bulk-confirms every loaded mockup that
// doesn't need review (needs_review === 0) by re-PATCHing its current selected_variant
// via the same endpoint the per-mockup picker already uses. Flagged mockups (still
// awaiting a smart-crop-vs-AI-extended choice) are left untouched by the bulk action.

const MOCKUPS = [
  { id: 1, job_id: 7, size_key: 'wa-12x16', needs_review: 0, selected_variant: 'smart_crop', file_url: '/m1.png' },
  {
    id: 2,
    job_id: 7,
    size_key: 'mug-11oz',
    needs_review: 1,
    selected_variant: 'smart_crop',
    smart_crop_url: '/m2-crop.png',
    ai_extended_url: '/m2-ext.png',
  },
  { id: 3, job_id: 7, size_key: 'tote', needs_review: 0, selected_variant: 'ai_extended', file_url: '/m3.png' },
];

describe('ReviewView — Mockups tab (Phase 6: Approve all non-flagged)', () => {
  it('PATCHes the current variant for every non-flagged mockup only, then shows a success toast and reloads', async () => {
    const fetchMock = makeFetchQueue([
      ...mockupTemplateEndpoints({}),
      ['/api/jobs/7/mockups', () => ({ ok: true, json: async () => MOCKUPS })],
      [/\/api\/jobs\/7\/mockups\/1\/variant$/, () => ({ ok: true, json: async () => ({ ...MOCKUPS[0] }) })],
      [/\/api\/jobs\/7\/mockups\/3\/variant$/, () => ({ ok: true, json: async () => ({ ...MOCKUPS[2] }) })],
    ]);
    global.fetch = fetchMock;
    const user = userEvent.setup();
    render(<ReviewView jobId={7} />);

    await user.click(screen.getByRole('button', { name: /Load Mockups/i }));
    const approveButton = await screen.findByRole('button', { name: /Approve all non-flagged \(2\)/i });
    await user.click(approveButton);

    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Approved 2 mockups');
    });

    const variantPatchCalls = fetchMock.mock.calls.filter(([url]) => /\/variant$/.test(url));
    expect(variantPatchCalls).toHaveLength(2);
    const patchedIds = variantPatchCalls.map(([url]) => url.match(/mockups\/(\d+)\/variant/)[1]).sort();
    expect(patchedIds).toEqual(['1', '3']);

    const call1 = variantPatchCalls.find(([url]) => url.includes('/1/variant'));
    expect(JSON.parse(call1[1].body)).toEqual({ variant: 'smart_crop' });
    const call3 = variantPatchCalls.find(([url]) => url.includes('/3/variant'));
    expect(JSON.parse(call3[1].body)).toEqual({ variant: 'ai_extended' });

    // Reloads after approving -- GET .../mockups is called again beyond the initial load.
    const mockupGetCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/jobs/7/mockups');
    expect(mockupGetCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('does not show the bulk approve button when every loaded mockup needs review', async () => {
    global.fetch = makeFetchQueue([
      ...mockupTemplateEndpoints({}),
      ['/api/jobs/7/mockups', () => ({ ok: true, json: async () => [MOCKUPS[1]] })],
    ]);
    const user = userEvent.setup();
    render(<ReviewView jobId={7} />);

    await user.click(screen.getByRole('button', { name: /Load Mockups/i }));
    await screen.findByText(/1 mockup/);

    expect(screen.queryByRole('button', { name: /Approve all non-flagged/i })).not.toBeInTheDocument();
  });
});
