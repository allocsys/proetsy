import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
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
  };
  const responses = { ...defaults, ...overrides };

  global.fetch = vi.fn((url, options) => {
    const key = Object.keys(responses).find((k) => url === k || url.startsWith(k));
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
    render(<App />);

    expect(await screen.findByText(/No jobs yet/)).toBeInTheDocument();
  });

  it('renders the job history table and loads a job into review on click', async () => {
    mockFetchByUrl({ '/api/jobs': [JOB] });
    const user = userEvent.setup();
    render(<App />);

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

    await user.type(screen.getByPlaceholderText('Job ID'), '7');
    await user.click(screen.getByText('Load job'));

    expect(await screen.findByTestId('stub-listings')).toHaveTextContent('listings:7');
  });

  it('always renders the Prompt Helper and Taste Filter modules regardless of job state', async () => {
    mockFetchByUrl();
    render(<App />);

    expect(await screen.findByTestId('stub-prompt-helper')).toBeInTheDocument();
    expect(screen.getByTestId('stub-taste-filter')).toBeInTheDocument();
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

  it('opens the settings panel and saves pasted tags', async () => {
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
        expect.objectContaining({ method: 'POST', body: JSON.stringify({ tags: 'boho decor' }) })
      );
    });
    expect(await screen.findByText('Saved. 3 new tag(s), 10 total.')).toBeInTheDocument();
  });

  it('imports a tag CSV file from the settings panel', async () => {
    mockFetchByUrl({ '/api/tags/csv': { inserted: 4 } });
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('ok');

    await user.click(screen.getByText('⚙ Settings'));
    const csvInput = await screen.findByLabelText(/import a CSV export/i, { selector: 'input[type="file"]' }).catch(() => null);
    const input = csvInput || document.querySelector('input[type="file"][accept=".csv,text/csv"]');
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
});
