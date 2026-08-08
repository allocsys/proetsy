import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JobListingReview from './JobListingReview.jsx';

const LISTING = {
  id: 1,
  job_id: 42,
  variation: 'fine_art',
  title: 'Original Title',
  description: 'Original description',
  tags: ['wall art', 'boho'],
  tag_alternates: ['minimalist'],
  warnings: [],
};

const SHOP_CONVENTIONS_RESPONSE = {
  listing: {
    titleSeparator: '|',
    maxTitleLength: 140,
    tagsPerListing: 13,
    tagAlternates: 5,
    maxTagLength: 20,
    forbiddenTitleWords: ['frame', 'framed', 'frames'],
    aiDisclosurePhrases: ['ai generated', 'ai-generated'],
    deliveryDetailPhrases: ['ships in', 'business days'],
  },
  midjourney: { version: '--v 7', style: '--style raw', stylizeMin: 50, stylizeMax: 150 },
};

// URL-dispatch fetch mock (same convention as JobMockupReview.test.jsx's makeFetchMock):
// JobListingReview now fetches GET /api/config/shop-conventions on mount alongside
// whatever a given test cares about, so matching by call order alone (plain
// mockResolvedValueOnce) is no longer reliable here.
function makeFetchMock(map) {
  return vi.fn((url, opts) => {
    const entry = map.find(([matcher]) => (typeof matcher === 'string' ? url === matcher : matcher.test(url)));
    if (entry) return Promise.resolve(entry[1](url, opts));
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

// Default: real shop conventions, so tests that don't care about the live-feedback
// behavior itself still get sane, realistic limits instead of the component's internal
// fallback.
const DEFAULT_CONVENTIONS = [
  ['/api/config/shop-conventions', () => ({ ok: true, json: async () => SHOP_CONVENTIONS_RESPONSE })],
];

beforeEach(() => {
  global.fetch = makeFetchMock(DEFAULT_CONVENTIONS);
});

describe('JobListingReview', () => {
  it('disables "Load listings" when no jobId is given', () => {
    render(<JobListingReview jobId={null} />);
    expect(screen.getByText('Load listings')).toBeDisabled();
  });

  it('shows the empty state before anything is loaded', () => {
    render(<JobListingReview jobId="42" />);
    expect(screen.getByText('No listings loaded yet.')).toBeInTheDocument();
  });

  it('loads and renders listing cards on click', async () => {
    global.fetch = makeFetchMock([
      ...DEFAULT_CONVENTIONS,
      ['/api/jobs/42/listings', () => ({ ok: true, json: async () => [LISTING] })],
    ]);
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);

    await user.click(screen.getByText('Load listings'));

    expect(fetch).toHaveBeenCalledWith('/api/jobs/42/listings');
    expect(await screen.findByDisplayValue('Original Title')).toBeInTheDocument();
    expect(screen.getByDisplayValue('wall art, boho')).toBeInTheDocument();
    // "fine_art" -> "fine art" per the variation?.replace('_', ' ') display transform
    expect(screen.getByText('fine art')).toBeInTheDocument();
  });

  it('shows an error message when loading fails', async () => {
    global.fetch = makeFetchMock([
      ...DEFAULT_CONVENTIONS,
      ['/api/jobs/42/listings', () => ({ ok: false, json: async () => ({}) })],
    ]);
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);

    await user.click(screen.getByText('Load listings'));

    expect(await screen.findByText('Failed to load listings')).toBeInTheDocument();
  });

  it('edits a field and saves via PATCH, reflecting the cleaned server response', async () => {
    global.fetch = makeFetchMock([
      ...DEFAULT_CONVENTIONS,
      ['/api/jobs/42/listings', () => ({ ok: true, json: async () => [LISTING] })],
      [/\/api\/jobs\/42\/listings\/1/, () => ({
        ok: true,
        json: async () => ({ ...LISTING, title: 'Edited Title', warnings: ['Title trimmed to fit convention'] }),
      })],
    ]);
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);
    await user.click(screen.getByText('Load listings'));
    await screen.findByDisplayValue('Original Title');

    const titleInput = screen.getByDisplayValue('Original Title');
    await user.clear(titleInput);
    await user.type(titleInput, 'Edited Title');

    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/jobs/42/listings/1',
        expect.objectContaining({ method: 'PATCH' })
      );
    });
    expect(await screen.findByText('Title trimmed to fit convention')).toBeInTheDocument();
  });

  it('copies title/description/tags to the clipboard', async () => {
    global.fetch = makeFetchMock([
      ...DEFAULT_CONVENTIONS,
      ['/api/jobs/42/listings', () => ({ ok: true, json: async () => [LISTING] })],
    ]);
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);
    await user.click(screen.getByText('Load listings'));
    await screen.findByDisplayValue('Original Title');

    await user.click(screen.getByText('Copy for Etsy'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'Original Title\n\nOriginal description\n\nTags: wall art, boho'
    );
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });
});

describe('JobListingReview — live shop-conventions feedback', () => {
  it('fetches shop conventions on mount and uses them (not a hardcoded copy) for the title/tag limits', async () => {
    global.fetch = makeFetchMock([
      ['/api/config/shop-conventions', () => ({
        ok: true,
        json: async () => ({
          listing: { ...SHOP_CONVENTIONS_RESPONSE.listing, maxTitleLength: 50, tagsPerListing: 3, maxTagLength: 10 },
          midjourney: SHOP_CONVENTIONS_RESPONSE.midjourney,
        }),
      })],
      ['/api/jobs/42/listings', () => ({ ok: true, json: async () => [LISTING] })],
    ]);
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);
    await user.click(screen.getByText('Load listings'));
    await screen.findByDisplayValue('Original Title');

    expect(screen.getByText('Title (max 50 chars)')).toBeInTheDocument();
    expect(screen.getByText(/\/50/)).toBeInTheDocument();
    expect(screen.getByText('Tags (comma-separated, max 3)')).toBeInTheDocument();
    expect(screen.getByText(/2\/3 tags/)).toBeInTheDocument();
  });

  it('warns live when the title contains a forbidden word, before Save is clicked', async () => {
    global.fetch = makeFetchMock([
      ...DEFAULT_CONVENTIONS,
      ['/api/jobs/42/listings', () => ({ ok: true, json: async () => [LISTING] })],
    ]);
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);
    await user.click(screen.getByText('Load listings'));
    const titleInput = await screen.findByDisplayValue('Original Title');

    expect(screen.queryByText(/Contains forbidden word/)).not.toBeInTheDocument();

    await user.clear(titleInput);
    await user.type(titleInput, 'Framed wall art');

    expect(await screen.findByText(/Contains forbidden word\(s\), will be removed on save: frame/)).toBeInTheDocument();
  });

  it('warns live when the description contains an AI-disclosure phrase', async () => {
    global.fetch = makeFetchMock([
      ...DEFAULT_CONVENTIONS,
      ['/api/jobs/42/listings', () => ({ ok: true, json: async () => [LISTING] })],
    ]);
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);
    await user.click(screen.getByText('Load listings'));
    const descInput = await screen.findByDisplayValue('Original description');

    await user.clear(descInput);
    await user.type(descInput, 'This print is AI generated art');

    expect(await screen.findByText(/Contains AI-disclosure phrase\(s\), will be removed on save: ai generated/)).toBeInTheDocument();
  });

  it('warns live when the description contains a delivery-detail phrase', async () => {
    global.fetch = makeFetchMock([
      ...DEFAULT_CONVENTIONS,
      ['/api/jobs/42/listings', () => ({ ok: true, json: async () => [LISTING] })],
    ]);
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);
    await user.click(screen.getByText('Load listings'));
    const descInput = await screen.findByDisplayValue('Original description');

    await user.clear(descInput);
    await user.type(descInput, 'Ships in 3 business days');

    expect(await screen.findByText(/Contains delivery-detail phrase\(s\), will be removed on save: ships in, business days/)).toBeInTheDocument();
  });

  it('falls back to sane default limits, with no phrase warnings, if the shop-conventions fetch fails', async () => {
    global.fetch = makeFetchMock([
      ['/api/config/shop-conventions', () => ({ ok: false, json: async () => ({}) })],
      ['/api/jobs/42/listings', () => ({ ok: true, json: async () => [{ ...LISTING, title: 'Framed wall art' }] })],
    ]);
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);
    await user.click(screen.getByText('Load listings'));
    await screen.findByDisplayValue('Framed wall art');

    expect(screen.getByText('Title (max 140 chars)')).toBeInTheDocument();
    expect(screen.queryByText(/Contains forbidden word/)).not.toBeInTheDocument();
  });
});
