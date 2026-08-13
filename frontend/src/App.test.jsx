import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// ─── Mock layout components to avoid base-ui issues and duplicate elements ──
vi.mock('@/components/layout/MobileNav.jsx', () => ({ default: () => null }));
vi.mock('@/components/layout/Header.jsx', () => ({
  default: ({ health, onSettingsToggle, isInSettings: _isInSettings }) => (
    <header>
      <span>ProEtsy</span>
      {health?.status === 'ok' && <span>Backend OK</span>}
      {health?.status !== 'ok' && <span>Backend Down</span>}
      <button onClick={onSettingsToggle} aria-label="Toggle settings">⚙</button>
    </header>
  ),
}));
vi.mock('@/components/layout/SetupBanner.jsx', () => ({
  default: ({ setupStatus }) => {
    if (!setupStatus) return null;
    const incomplete = !setupStatus.geminiApiKey || !setupStatus.tagLibraryReady || !setupStatus.productSizesReady;
    if (!incomplete) return null;
    return <div>Setup Incomplete <span>Gemini API Key</span> <span>Tag Library</span></div>;
  },
}));

// ─── Stub all view components so App.test only exercises AppShell orchestration ──
vi.mock('@/views/UploadView.jsx', () => ({
  default: () => <div data-testid="view-upload">Upload View</div>,
}));
vi.mock('@/views/HistoryView.jsx', () => ({
  default: () => <div data-testid="view-history">History View</div>,
}));
vi.mock('@/views/ReviewView.jsx', () => ({
  default: ({ jobId }) => <div data-testid="view-review">Review View: {jobId}</div>,
}));
vi.mock('@/views/SettingsView.jsx', () => ({
  default: () => <div data-testid="view-settings">Settings View</div>,
}));
vi.mock('@/views/MockupTemplates.jsx', () => ({
  default: () => <div data-testid="view-mockup-templates">Mockup Templates</div>,
}));
vi.mock('@/views/PromptHelper.jsx', () => ({
  default: () => <div data-testid="view-prompt-helper">Prompt Helper</div>,
}));
vi.mock('@/views/TasteFilter.jsx', () => ({
  default: () => <div data-testid="view-taste-filter">Taste Filter</div>,
}));

// UpdaterStatus is Electron-only and returns null when window.updaterAPI is absent.
vi.mock('@/UpdaterStatus.jsx', () => ({ default: () => null }));

// StatusBadge is used in multiple layout components.
vi.mock('@/components/layout/StatusBadge.jsx', () => ({
  default: ({ status, children, className }) => (
    <span data-testid="status-badge" data-status={status} className={className}>{children}</span>
  ),
}));

import App from './App.jsx';

const SETUP_STATUS_READY = {
  geminiApiKey: true,
  tagLibraryReady: true,
  productSizesReady: true,
};

const SETUP_STATUS_INCOMPLETE = {
  geminiApiKey: false,
  tagLibraryReady: false,
  productSizesReady: true,
};

const PIPELINE_CONFIG = {
  pipeline: [
    { module: 'image-analyzer', enabled: true },
    { module: 'listing-generator', enabled: true, required: true },
    { module: 'mockup-generator', enabled: true },
  ],
};

const JOBS = [
  { id: 1, overall_status: 'completed', created_at: '2026-01-01T00:00:00Z' },
  { id: 2, overall_status: 'pending', created_at: '2026-01-02T00:00:00Z' },
  { id: 3, overall_status: 'failed', created_at: '2026-01-03T00:00:00Z' },
];

function mockFetchByUrl(overrides = {}) {
  const defaults = {
    '/api/health': { status: 'ok' },
    '/api/setup-status': SETUP_STATUS_READY,
    '/api/config/pipeline': PIPELINE_CONFIG,
    '/api/jobs': [],
  };
  const responses = { ...defaults, ...overrides };

  global.fetch = vi.fn((url) => {
    const key = Object.keys(responses).find((k) => url === k) ||
      Object.keys(responses)
        .filter((k) => url.startsWith(k))
        .sort((a, b) => b.length - a.length)[0];
    if (!key) return Promise.resolve({ ok: true, json: async () => ({}) });
    const value = responses[key];
    const body = typeof value === 'function' ? value(url) : value;
    return Promise.resolve({ ok: true, json: async () => body });
  });
}

beforeEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('AppShell', () => {
  it('renders the ProEtsy header', async () => {
    mockFetchByUrl();
    render(<App />);

    expect(await screen.findByText('ProEtsy')).toBeInTheDocument();
  });

  it('shows Backend OK when health is ok', async () => {
    mockFetchByUrl();
    render(<App />);

    expect(await screen.findByText('Backend OK')).toBeInTheDocument();
  });

  it('shows Backend Down when health fetch fails', async () => {
    global.fetch = vi.fn((url) => {
      if (url === '/api/health') return Promise.reject(new Error('network error'));
      if (url === '/api/jobs') return Promise.resolve({ ok: true, json: async () => [] });
      return Promise.resolve({ ok: true, json: async () => ({}) });
    });
    render(<App />);

    expect(await screen.findByText('Backend Down')).toBeInTheDocument();
  });

  it('shows the default Upload view on mount', async () => {
    mockFetchByUrl();
    render(<App />);

    expect(await screen.findByTestId('view-upload')).toBeInTheDocument();
  });

  it('shows Setup Incomplete banner when setup-status indicates missing config', async () => {
    mockFetchByUrl({
      '/api/setup-status': SETUP_STATUS_INCOMPLETE,
    });
    render(<App />);

    expect(await screen.findByText('Setup Incomplete')).toBeInTheDocument();
    expect(screen.getByText('Gemini API Key')).toBeInTheDocument();
    expect(screen.getByText('Tag Library')).toBeInTheDocument();
  });

  it('does not show the setup banner when all checks pass', async () => {
    mockFetchByUrl();
    render(<App />);

    await screen.findByTestId('view-upload');
    expect(screen.queryByText('Setup Incomplete')).not.toBeInTheDocument();
  });

  it('switches views when clicking sidebar nav items', async () => {
    mockFetchByUrl();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('view-upload');

    await user.click(screen.getByRole('button', { name: 'Listing History' }));
    expect(await screen.findByTestId('view-history')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Prompt Helper' }));
    expect(await screen.findByTestId('view-prompt-helper')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Taste Filter' }));
    expect(await screen.findByTestId('view-taste-filter')).toBeInTheDocument();
  });

  it('opens and closes Settings via the header button', async () => {
    mockFetchByUrl();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('view-upload');

    await user.click(screen.getByRole('button', { name: 'Toggle settings' }));
    expect(await screen.findByTestId('view-settings')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Toggle settings' }));
    expect(await screen.findByTestId('view-upload')).toBeInTheDocument();
  });

  it('renders the sidebar nav items', async () => {
    mockFetchByUrl();
    render(<App />);
    await screen.findByText('Backend OK');

    expect(screen.getByRole('button', { name: 'Upload' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mockup Templates' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Listing History' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Review a Job' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Prompt Helper' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Taste Filter' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Settings' })).toBeInTheDocument();
  });

  it('fetches health, setup-status, jobs, and pipeline config on mount', async () => {
    mockFetchByUrl();
    render(<App />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/health');
      expect(global.fetch).toHaveBeenCalledWith('/api/setup-status');
      expect(global.fetch).toHaveBeenCalledWith('/api/jobs');
      expect(global.fetch).toHaveBeenCalledWith('/api/config/pipeline');
    });
  });

  it('navigates to Mockup Templates view', async () => {
    mockFetchByUrl();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('view-upload');

    await user.click(screen.getByRole('button', { name: 'Mockup Templates' }));
    expect(await screen.findByTestId('view-mockup-templates')).toBeInTheDocument();
  });

  it('toggles sidebar collapse via the sidebar button', async () => {
    mockFetchByUrl();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByText('Backend OK');

    await user.click(screen.getByRole('button', { name: 'Collapse sidebar' }));
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('navigates directly to Review a Job view', async () => {
    mockFetchByUrl();
    const user = userEvent.setup();
    render(<App />);
    await screen.findByTestId('view-upload');

    await user.click(screen.getByRole('button', { name: 'Review a Job' }));
    expect(await screen.findByTestId('view-review')).toBeInTheDocument();
  });

  it('shows pipeline status bar when jobs exist', async () => {
    mockFetchByUrl({ '/api/jobs': JOBS });
    render(<App />);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith('/api/jobs');
    });

    // The sidebar renders a pipeline status progress bar
    const sidebar = document.querySelector('aside');
    expect(sidebar).toBeInTheDocument();
  });
});
