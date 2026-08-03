import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// App.jsx wires five already-independently-tested review/module components
// (JobArtworkAnalysisReview, JobListingReview, JobMockupReview, PromptHelper,
// TasteFilter) into a shell that owns health/setup/pipeline-config state, the
// upload+bulk-run flow, the job history log, and the settings panel. Those five
// components have their own test files; here they're stubbed so these tests only
// exercise App's own orchestration logic, not re-verify children already covered
// elsewhere.
vi.mock('./JobArtworkAnalysisReview.jsx', () => ({
  default: ({ jobId }) => <div data-testid="stub-analysis">analysis:{jobId}</div>,
}));
vi.mock('./JobListingReview.jsx', () => ({
  default: ({ jobId }) => <div data-testid="stub-listings">listings:{jobId}</div>,
}));
vi.mock('./JobMockupReview.jsx', () => ({
  default: ({ jobId }) => <div data-testid="stub-mockups">mockups:{jobId}</div>,
}));
vi.mock('./PromptHelper.jsx', () => ({
  default: () => <div data-testid="stub-prompt-helper">prompt-helper</div>,
}));
vi.mock('./TasteFilter.jsx', () => ({
  default: () => <div data-testid="stub-taste-filter">taste-filter</div>,
}));

import App from './App.jsx';

const PIPELINE_CONFIG = {
  pipeline: [
    { module: 'image_analyzer', enabled: true },
    { module: 'listing_generator', enabled: true, required: true },
    { module: 'mockup_composer', enabled: true },
  ],
};

const SETUP_STATUS_READY = {
  readyToRun: true,
  geminiKeyConfigured: true,
  hasTagLibrary: true,
  hasProductSize: true,
};

const JOB = {
  id: 42,
  overall_status: 'success',
  artwork_file_path: '/data/uploads/fox.png',
  updated_at: '2026-08-01T12:00:00Z',
};

// App fires eight fetches on mount, in this order: health, pipeline config,
// product-sizes, shop-conventions, settings, setup-status, jobs, trends. Rather than
// depend on call order (fragile if App's effect ever gets reordered), route by URL.
function mockFetchByUrl(overrides = {}) {
  const defaults = {
    '/api/health': { status: 'ok' },
    '/api/config/pipeline': PIPELINE_CONFIG,
    '/api/config/product-sizes': {},
    '/api/config/shop-conventions': {
      listing: {
        titleSeparator: '|',
        maxTitleLength: 140,
        tagsPerListing: 13,
        tagAlternates: 5,
        maxTagLength: 20,
        forbiddenTitleWords: ['frame'],
      },
      midjourney: { version: '--v 7', style: '--style raw', stylizeMin: 50, stylizeMax: 150 },
    },
    '/api/settings': {},
    '/api/setup-status': SETUP_STATUS_READY,
    '/api/jobs': [],
    '/api/trends': [],
    '/api/taste-filter/watch-status': { active: false, folder: null, category: null, pendingCount: 0, lastError: null },
  };
  const responses = { ...defaults, ...overrides };

  global.fetch = vi.fn((url, options) => {
    // Prefer an exact match; otherwise the longest matching prefix, so a specific
    // route like '/api/jobs/run-batch' never falls through to the '/api/jobs' handler
    // just because both are present and the shorter one happens to iterate first.
    const keys = Object.keys(responses);
    let key = keys.find((k) => url === k);
    if (!key) {
      const prefixMatches = keys.filter((k) => url.startsWith(k));
      key = prefixMatches.sort((a, b) => b.length - a.length)[0];
    }
    if (!key) {
      return Promise.resolve({ ok: true, json: async () => ({}) });
    }
    const value = responses[key];
    const body = typeof value === 'function' ? value(url, options) : value;
    return Promise.resolve({ ok: true, json: async () => body });
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
});

describe('App', () => {
  it('shows backend status once health resolves', async () => {
    mockFetchByUrl();
    render(<App />);

    expect(await screen.findByText('ok')).toBeInTheDocument();
  });

  it('shows the backend-unreachable banner when health fetch fails', async () => {
    global.fetch = vi.fn((url) => {
      if (url === '/api/health') return Promise.reject(new Error('network error'));
      // Array-returning routes need an array back, or App's jobs.map()/trends.map()
      // crashes on an object.
      if (url === '/api/jobs' || url === '/api/trends') return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(<App />);

    expect(await screen.findByText(/Backend not running/)).toBeInTheDocument();
  });

  it('shows the setup-incomplete alert when setup-status says not ready', async () => {
    mockFetchByUrl({
      '/api/setup-status': { readyToRun: false, geminiKeyConfigured: false, hasTagLibrary: false, hasProductSize: false },
    });
    render(<App />);

    expect(await screen.findByText('Setup incomplete')).toBeInTheDocument();
    expect(screen.getByText(/Gemini API key configured/)).toBeInTheDocument();
  });

  it('does not show the setup alert once everything is ready', async () => {
    mockFetchByUrl();
    render(<App />);

    await screen.findByText('ok');
    expect(screen.queryByText('Setup incomplete')).not.toBeInTheDocument();
  });

  it('renders pipeline module checkboxes, disabling the required one', async () => {
    mockFetchByUrl();
    render(<App />);

    const listingCheckbox = await screen.findByRole('checkbox', { name: /listing_generator/ });
    expect(listingCheckbox).toBeChecked();
    expect(listingCheckbox).toBeDisabled();

    const analyzerCheckbox = screen.getByRole('checkbox', { name: /image_analyzer/ });
    expect(analyzerCheckbox).not.toBeDisabled();
  });

  it('toggling a non-required module flips its override state', async () => {
    mockFetchByUrl();
    const user = userEvent.setup();
    render(<App />);

    const analyzerCheckbox = await screen.findByRole('checkbox', { name: /image_analyzer/ });
    expect(analyzerCheckbox).toBeChecked();

    await user.click(analyzerCheckbox);
    expect(analyzerCheckbox).not.toBeChecked();
  });

  it('clicking a required module checkbox is a no-op', async () => {
    mockFetchByUrl();
    const user = userEvent.setup();
    render(<App />);

    const listingCheckbox = await screen.findByRole('checkbox', { name: /listing_generator/ });
    await user.click(listingCheckbox);
    expect(listingCheckbox).toBeChecked();
  });

  it('shows the empty-history state with no jobs', async () => {
    mockFetchByUrl({ '/api/jobs': [] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    await user.click(screen.getAllByText('Listing History')[0]);

    expect(await screen.findByText(/No jobs yet — drop some artwork/)).toBeInTheDocument();
  });

  it('renders the job history table and loads a job into review on click', async () => {
    mockFetchByUrl({ '/api/jobs': [JOB] });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    await user.click(screen.getAllByText('Listing History')[0]);

    expect(await screen.findByText('#42')).toBeInTheDocument();
    expect(screen.getByText('fox.png')).toBeInTheDocument();

    await user.click(screen.getByText('Review'));

    expect(await screen.findByTestId('stub-analysis')).toHaveTextContent('analysis:42');
    expect(screen.getByTestId('stub-listings')).toHaveTextContent('listings:42');
    expect(screen.getByTestId('stub-mockups')).toHaveTextContent('mockups:42');
  });

  it('loads a job into review by typing its ID directly', async () => {
    mockFetchByUrl();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    await user.click(screen.getAllByText('Review a Job')[0]);
    await user.type(screen.getByPlaceholderText('Job ID'), '7');
    await user.click(screen.getByText('Load job'));

    expect(await screen.findByTestId('stub-listings')).toHaveTextContent('listings:7');
  });

  it('renders the Taste Filter module on the default Upload view, and Prompt Helper on its own nav item', async () => {
    mockFetchByUrl();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    // Taste Filter is merged into the default 'upload' view (Step 1.6) -- no nav
    // click needed to see it.
    expect(await screen.findByTestId('stub-taste-filter')).toBeInTheDocument();
    expect(screen.queryByTestId('stub-prompt-helper')).not.toBeInTheDocument();

    await user.click(screen.getAllByText('Prompt Helper')[0]);
    expect(await screen.findByTestId('stub-prompt-helper')).toBeInTheDocument();
  });

  it('uploads a file, creates a job, runs the batch, and shows single-job status', async () => {
    mockFetchByUrl({
      '/api/artworks/upload': { artworks: [{ id: 5, file_path: '/data/uploads/fox.png' }] },
      '/api/jobs': (url, options) => {
        if (options?.method === 'POST') return { id: 42, overall_status: 'pending' };
        return [];
      },
      '/api/jobs/run-batch': {},
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    const file = new File(['fake-bytes'], 'fox.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"][accept="image/*"]');
    await user.upload(fileInput, file);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/artworks/upload', expect.objectContaining({ method: 'POST' }));
    });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/jobs/run-batch',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ job_ids: [42] }) })
      );
    });
    expect(await screen.findByText(/Done\. 1 job processed/)).toBeInTheDocument();
  });

  it('shows an error message when the upload itself fails', async () => {
    mockFetchByUrl({ '/api/artworks/upload': { error: 'No files received' } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    const file = new File(['fake-bytes'], 'fox.png', { type: 'image/png' });
    const fileInput = document.querySelector('input[type="file"][accept="image/*"]');
    await user.upload(fileInput, file);

    expect(await screen.findByText(/Upload failed: No files received/)).toBeInTheDocument();
  });

  it('opens the settings panel and saves pasted tags with no category', async () => {
    mockFetchByUrl({ '/api/tags/bulk': { inserted: 3, total: 10 } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    await user.click(screen.getByText('⚙ Settings'));
    const textarea = await screen.findByPlaceholderText(/wall art/);
    await user.type(textarea, 'boho decor');
    await user.click(screen.getByText('Save tags'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tags/bulk',
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ tags: 'boho decor', category: null }) })
      );
    });
    expect(await screen.findByText('Saved. 3 new tag(s), 10 total.')).toBeInTheDocument();
  });

  it('saves pasted tags with a category, and offers existing categories as suggestions (plan.md step 2)', async () => {
    mockFetchByUrl({
      '/api/tags': [{ id: 1, tag_text: 'boho decor', category: 'boho' }, { id: 2, tag_text: 'fern print', category: 'botanical' }],
      '/api/tags/bulk': { inserted: 1, total: 11 },
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    await user.click(screen.getByText('⚙ Settings'));
    const textarea = await screen.findByPlaceholderText(/wall art/);
    await user.type(textarea, 'macrame wall hanging');
    const categoryInput = screen.getByPlaceholderText(/e\.g\. botanical, boho, minimalist/);
    await user.type(categoryInput, 'boho');
    await user.click(screen.getByText('Save tags'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tags/bulk',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ tags: 'macrame wall hanging', category: 'boho' }),
        })
      );
    });
    expect(await screen.findByText('Saved. 1 new tag(s), 11 total.')).toBeInTheDocument();

    // Existing distinct categories from the library are offered as <datalist> suggestions.
    const datalistOptions = Array.from(document.querySelectorAll('#tag-category-options option')).map((o) => o.value);
    expect(datalistOptions).toEqual(['boho', 'botanical']);
  });

  it('imports a tag CSV file from the settings panel', async () => {
    mockFetchByUrl({ '/api/tags/csv': { inserted: 4 } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    await user.click(screen.getByText('⚙ Settings'));
    // No <label htmlFor> associates this input with its description text, so query
    // directly by its distinguishing accept attribute instead.
    const input = document.querySelector('input[type="file"][accept=".csv,text/csv"]');
    const csvFile = new File(['tag_text\nboho decor'], 'tags.csv', { type: 'text/csv' });
    await user.upload(input, csvFile);

    expect(await screen.findByText(/Imported 4 new tag\(s\) from tags\.csv\./)).toBeInTheDocument();
  });

  it('adds a trend from the settings panel', async () => {
    mockFetchByUrl({ '/api/trends': (url, options) => (options?.method === 'POST' ? {} : []) });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    await user.click(screen.getByText('⚙ Settings'));
    await user.type(await screen.findByPlaceholderText('Trend term'), 'cottagecore');
    await user.click(screen.getByText('Add trend'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/trends',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ term: 'cottagecore', category: null }),
        })
      );
    });
  });

  it('shows shop conventions read-only in the settings panel', async () => {
    mockFetchByUrl();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    await user.click(screen.getByText('⚙ Settings'));

    expect(await screen.findByText('|')).toBeInTheDocument();
    expect(screen.getByText(/Tags per listing: 13/)).toBeInTheDocument();
  });

  it('shows the watched-folder auto-import status in the settings panel (Module 7 -> step 7)', async () => {
    mockFetchByUrl({
      '/api/taste-filter/watch-status': { active: true, folder: '/home/you/midjourney', category: 'square-canvas', pendingCount: 2, lastError: null },
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    await user.click(screen.getByText('⚙ Settings'));

    expect(await screen.findByText(/Watching \/home\/you\/midjourney/)).toBeInTheDocument();
    expect(screen.getByText(/2 pending/)).toBeInTheDocument();
  });

  it('toggling auto-import on PATCHes settings and re-fetches watch status', async () => {
    mockFetchByUrl({
      '/api/settings': (url, options) => (options?.method === 'PATCH' ? { taste_filter_watch_enabled: 'true' } : {}),
    });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    await user.click(screen.getByText('⚙ Settings'));
    await user.click(await screen.findByLabelText('Auto-import from folder'));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/settings',
        expect.objectContaining({ method: 'PATCH', body: JSON.stringify({ taste_filter_watch_enabled: true }) })
      );
    });
  });
});
