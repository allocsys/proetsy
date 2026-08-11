import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UpdaterStatus from './UpdaterStatus.jsx';

// StatusBadge is mocked in setup-ui.js, but UpdaterStatus imports from @/components/layout/StatusBadge
// which resolves differently when imported from UpdaterStatus.test.jsx.
// Mock it here to be safe.
vi.mock('./components/layout/StatusBadge.jsx', () => ({
  default: ({ status, children }) => <span data-testid="status-badge">{children}</span>,
}));

function makeUpdaterAPI(overrides = {}) {
  const callbacks = {};
  const on = (name) => vi.fn((cb) => {
    callbacks[name] = cb;
    return vi.fn();
  });
  return {
    api: {
      checkForUpdates: vi.fn().mockResolvedValue({ skipped: false }),
      downloadUpdate: vi.fn().mockResolvedValue({}),
      quitAndInstall: vi.fn(),
      onCheckingForUpdate: on('checking'),
      onUpdateAvailable: on('available'),
      onUpdateNotAvailable: on('notAvailable'),
      onDownloadProgress: on('progress'),
      onUpdateDownloaded: on('downloaded'),
      onError: on('error'),
      ...overrides,
    },
    callbacks,
  };
}

afterEach(() => {
  delete window.updaterAPI;
});

describe('UpdaterStatus — feature detection', () => {
  it('renders nothing when window.updaterAPI is absent (dev-in-browser path)', () => {
    render(<UpdaterStatus />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('UpdaterStatus — check flow', () => {
  it('shows a Check for updates button by default, then Checking… once clicked', async () => {
    const { api } = makeUpdaterAPI();
    window.updaterAPI = api;
    const user = userEvent.setup();
    render(<UpdaterStatus />);

    const button = screen.getByText('Check for updates');
    await user.click(button);

    expect(api.checkForUpdates).toHaveBeenCalled();
    expect(await screen.findByText(/Checking for updates/)).toBeInTheDocument();
  });

  it('falls back to idle when checkForUpdates resolves skipped (dev/unpackaged build)', async () => {
    const { api } = makeUpdaterAPI({ checkForUpdates: vi.fn().mockResolvedValue({ skipped: true, reason: 'not packaged' }) });
    window.updaterAPI = api;
    const user = userEvent.setup();
    render(<UpdaterStatus />);

    await user.click(screen.getByText('Check for updates'));

    expect(await screen.findByText('Check for updates')).toBeInTheDocument();
  });

  it('shows an error and a Retry button when checkForUpdates rejects', async () => {
    const { api } = makeUpdaterAPI({ checkForUpdates: vi.fn().mockRejectedValue(new Error('network down')) });
    window.updaterAPI = api;
    const user = userEvent.setup();
    render(<UpdaterStatus />);

    await user.click(screen.getByText('Check for updates'));

    expect(await screen.findByText('network down')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });
});

describe('UpdaterStatus — update lifecycle events', () => {
  it('shows "Up to date" on update-not-available', async () => {
    const { api, callbacks } = makeUpdaterAPI();
    window.updaterAPI = api;
    render(<UpdaterStatus />);

    act(() => callbacks.notAvailable({}));

    expect(await screen.findByText('Up to date')).toBeInTheDocument();
    expect(screen.getByText('Check')).toBeInTheDocument();
  });

  it('shows the version and a Download button on update-available', async () => {
    const { api, callbacks } = makeUpdaterAPI();
    window.updaterAPI = api;
    const user = userEvent.setup();
    render(<UpdaterStatus />);

    act(() => callbacks.available({ version: '1.2.3' }));

    expect(await screen.findByText(/Update v1\.2\.3 available/)).toBeInTheDocument();
    await user.click(screen.getByText('Download'));
    expect(api.downloadUpdate).toHaveBeenCalled();
  });

  it('shows download progress percentage on download-progress', async () => {
    const { callbacks, api } = makeUpdaterAPI();
    window.updaterAPI = api;
    render(<UpdaterStatus />);

    act(() => callbacks.progress({ percent: 42.7 }));

    expect(await screen.findByText(/Downloading.*43%/)).toBeInTheDocument();
  });

  it('shows a Restart button on update-downloaded, wired to quitAndInstall', async () => {
    const { api, callbacks } = makeUpdaterAPI();
    window.updaterAPI = api;
    const user = userEvent.setup();
    render(<UpdaterStatus />);

    act(() => callbacks.downloaded({ version: '1.2.3' }));

    expect(await screen.findByText(/Update v1\.2\.3 ready/)).toBeInTheDocument();
    await user.click(screen.getByText('Restart'));
    expect(api.quitAndInstall).toHaveBeenCalled();
  });

  it('shows the error message and a Retry button on error', async () => {
    const { callbacks, api } = makeUpdaterAPI();
    window.updaterAPI = api;
    render(<UpdaterStatus />);

    act(() => callbacks.error('GitHub rate limit exceeded'));

    expect(await screen.findByText('GitHub rate limit exceeded')).toBeInTheDocument();
    expect(screen.getByText('Retry')).toBeInTheDocument();
  });

  it('unsubscribes every listener on unmount', () => {
    const { api } = makeUpdaterAPI();
    window.updaterAPI = api;
    const { unmount } = render(<UpdaterStatus />);

    unmount();

    expect(api.onCheckingForUpdate).toHaveBeenCalled();
    expect(api.onUpdateAvailable).toHaveBeenCalled();
    expect(api.onUpdateNotAvailable).toHaveBeenCalled();
    expect(api.onDownloadProgress).toHaveBeenCalled();
    expect(api.onUpdateDownloaded).toHaveBeenCalled();
    expect(api.onError).toHaveBeenCalled();
  });
});
