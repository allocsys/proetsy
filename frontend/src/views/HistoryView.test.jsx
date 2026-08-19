import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
import HistoryView from './HistoryView.jsx';

// plan.md Phase 6 — "HistoryView.jsx: add row multi-select + bulk action bar (Approve
// all, Regenerate all flagged, Re-run pipeline)". This file covers the UI gap flagged
// during Phase 6 verification: the multi-select checkboxes and bulk action bar had no
// automated coverage of their own (only the backend run-batch endpoint they call did,
// via server.pipeline-runner-routes.test.js). "Approve all" jobs is intentionally
// UI-disabled (no "approved" state on jobs in the schema) — that's covered here too.

const JOBS = [
  { id: 1, batch_id: 'batch-1', artwork_file_path: '/uploads/cat.png', overall_status: 'failed', created_at: '2026-08-18T10:00:00Z' },
  { id: 2, batch_id: 'batch-1', artwork_file_path: '/uploads/dog.png', overall_status: 'success', created_at: '2026-08-18T09:00:00Z' },
  { id: 3, batch_id: null, artwork_file_path: '/uploads/solo.png', overall_status: 'pending', created_at: '2026-08-17T09:00:00Z' },
];

function makeFetchQueue(map) {
  return vi.fn((url, options) => {
    const entry = map.find(([matcher]) =>
      typeof matcher === 'string' ? url === matcher : matcher.test(url)
    );
    if (entry) return Promise.resolve(entry[1](url, options));
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

beforeEach(() => {
  toast.success.mockClear();
  toast.warning.mockClear();
  toast.info.mockClear();
  global.fetch = makeFetchQueue([
    ['/api/jobs', () => ({ ok: true, json: async () => JOBS })],
  ]);
});

async function renderLoaded() {
  const user = userEvent.setup();
  render(<HistoryView onOpenJob={vi.fn()} />);
  await screen.findByText('cat.png');
  return user;
}

describe('HistoryView — Phase 6 bulk actions', () => {
  it('shows no bulk action bar until at least one row is selected', async () => {
    await renderLoaded();
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
  });

  it('selecting a row shows the bulk action bar with the correct count', async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole('checkbox', { name: /Select job cat\.png/i }));
    expect(await screen.findByText(/1 selected/)).toBeInTheDocument();
  });

  it('"select all in batch" checks every job row in that batch only, not rows in other batches', async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole('checkbox', { name: /Select all jobs in batch batch-1/i }));

    expect(screen.getByRole('checkbox', { name: /Select job cat\.png/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Select job dog\.png/i })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /Select job solo\.png/i })).not.toBeChecked();
    expect(await screen.findByText(/2 selected/)).toBeInTheDocument();
  });

  it('page-level "Select all" selects every job across batches and solo rows', async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole('checkbox', { name: 'Select all jobs' }));

    expect(await screen.findByText(/3 selected/)).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Select job solo\.png/i })).toBeChecked();
  });

  it('"Approve all" stays disabled with the explanatory tooltip regardless of selection', async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole('checkbox', { name: /Select job cat\.png/i }));

    const approveAll = await screen.findByRole('button', { name: /Approve all/i });
    expect(approveAll).toBeDisabled();
    expect(approveAll).toHaveAttribute('title', expect.stringContaining("no 'approved' state"));
  });

  it('"Clear" empties the selection, hides the bulk bar, and unchecks the rows', async () => {
    const user = await renderLoaded();
    await user.click(screen.getByRole('checkbox', { name: /Select job cat\.png/i }));
    await screen.findByText(/1 selected/);

    await user.click(screen.getByRole('button', { name: 'Clear' }));

    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Select job cat\.png/i })).not.toBeChecked();
  });

  it('"Regenerate flagged" is disabled with no count when nothing failed is in the selection', async () => {
    const user = await renderLoaded();
    // dog.png is 'success', not 'failed'.
    await user.click(screen.getByRole('checkbox', { name: /Select job dog\.png/i }));

    const regenButton = await screen.findByRole('button', { name: 'Regenerate flagged' });
    expect(regenButton).toBeDisabled();
  });

  it('"Re-run pipeline" sends every selected job id to run-batch, toasts success, clears selection, and refetches', async () => {
    const fetchMock = makeFetchQueue([
      ['/api/jobs', () => ({ ok: true, json: async () => JOBS })],
      ['/api/jobs/run-batch', () => ({
        ok: true,
        json: async () => ({ outcomes: [{ job_id: 1, ok: true }, { job_id: 2, ok: true }] }),
      })],
    ]);
    global.fetch = fetchMock;
    const user = userEvent.setup();
    render(<HistoryView onOpenJob={vi.fn()} />);
    await screen.findByText('cat.png');

    await user.click(screen.getByRole('checkbox', { name: /Select all jobs in batch batch-1/i }));
    await screen.findByText(/2 selected/);
    await user.click(screen.getByRole('button', { name: 'Re-run pipeline' }));

    await waitFor(() => {
      const runBatchCall = fetchMock.mock.calls.find(([url]) => url === '/api/jobs/run-batch');
      expect(runBatchCall).toBeTruthy();
      expect(JSON.parse(runBatchCall[1].body)).toEqual({ job_ids: [1, 2] });
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Re-ran 2 jobs');
    });

    // Selection is cleared after the bulk action runs.
    expect(screen.queryByText(/selected/i)).not.toBeInTheDocument();

    // Job list is refetched after the bulk action.
    const getCalls = fetchMock.mock.calls.filter(([url]) => url === '/api/jobs');
    expect(getCalls.length).toBeGreaterThanOrEqual(2);
  });

  it('"Regenerate flagged" only sends the failed job ids from the current selection', async () => {
    const fetchMock = makeFetchQueue([
      ['/api/jobs', () => ({ ok: true, json: async () => JOBS })],
      ['/api/jobs/run-batch', () => ({
        ok: true,
        json: async () => ({ outcomes: [{ job_id: 1, ok: true }] }),
      })],
    ]);
    global.fetch = fetchMock;
    const user = userEvent.setup();
    render(<HistoryView onOpenJob={vi.fn()} />);
    await screen.findByText('cat.png');

    // batch-1 has one failed (cat.png, id 1) and one success (dog.png, id 2).
    await user.click(screen.getByRole('checkbox', { name: /Select all jobs in batch batch-1/i }));
    await user.click(screen.getByRole('button', { name: /Regenerate flagged \(1\)/i }));

    await waitFor(() => {
      const runBatchCall = fetchMock.mock.calls.find(([url]) => url === '/api/jobs/run-batch');
      expect(runBatchCall).toBeTruthy();
      expect(JSON.parse(runBatchCall[1].body)).toEqual({ job_ids: [1] });
    });
    await waitFor(() => {
      expect(toast.success).toHaveBeenCalledWith('Re-ran 1 job');
    });
  });

  it('shows a warning toast summarizing partial failures on a mixed-outcome run', async () => {
    const fetchMock = makeFetchQueue([
      ['/api/jobs', () => ({ ok: true, json: async () => JOBS })],
      ['/api/jobs/run-batch', () => ({
        ok: true,
        json: async () => ({ outcomes: [{ job_id: 1, ok: true }, { job_id: 2, ok: false }] }),
      })],
    ]);
    global.fetch = fetchMock;
    const user = userEvent.setup();
    render(<HistoryView onOpenJob={vi.fn()} />);
    await screen.findByText('cat.png');

    await user.click(screen.getByRole('checkbox', { name: /Select all jobs in batch batch-1/i }));
    await user.click(screen.getByRole('button', { name: 'Re-run pipeline' }));

    await waitFor(() => {
      expect(toast.warning).toHaveBeenCalledWith('Re-ran 2 job(s) — 1 succeeded, 1 failed');
    });
  });
});
