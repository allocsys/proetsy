import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TasteFilter from './TasteFilter.jsx';

const CANDIDATE = {
  imagePath: '/data/candidates/img1.png',
  imageUrl: '/taste-filter-files/img1.png',
  embedding: [0.1, 0.2, 0.3],
  category: 'square-canvas',
  promptId: null,
  globalLabel: 'likely-keep',
  globalScore: 0.42,
  globalConfident: true,
  categoryLabel: 'uncertain',
  categoryScore: 0.01,
  categoryConfident: false,
};

beforeEach(() => {
  global.fetch = vi.fn();
});

function makeFile(name = 'candidate.png') {
  return new File(['fake-image-bytes'], name, { type: 'image/png' });
}

describe('TasteFilter', () => {
  it('renders the empty dropzone state with no candidates', () => {
    render(<TasteFilter />);
    expect(screen.getByText('Drag and drop a batch of candidate images here')).toBeInTheDocument();
    expect(screen.queryByText('Keep')).not.toBeInTheDocument();
  });

  it('imports a batch and renders scored candidates', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [CANDIDATE] }) });
    const user = userEvent.setup();
    render(<TasteFilter />);

    // The file input has no associated <label htmlFor>, so query by type instead.
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());

    expect(fetch).toHaveBeenCalledWith('/api/taste-filter/import', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText(/Scored 1 image/)).toBeInTheDocument();
    expect(screen.getByText(/likely-keep \(0.420\)/)).toBeInTheDocument();
    expect(screen.getByText(/uncertain \(0.010\) · cold start/)).toBeInTheDocument();
  });

  it('sends the category and prompt ID fields along with an import', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [] }) });
    const user = userEvent.setup();
    render(<TasteFilter />);

    await user.type(screen.getByPlaceholderText('e.g. square-canvas'), 'square-canvas');
    await user.type(screen.getByPlaceholderText('links to Module 4'), '17');

    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());

    const [, options] = fetch.mock.calls[0];
    const body = options.body;
    expect(body.get('category')).toBe('square-canvas');
    expect(body.get('prompt_id')).toBe('17');
  });

  it('labeling a candidate removes it from the grid', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [CANDIDATE] }) });
    const user = userEvent.setup();
    render(<TasteFilter />);
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());
    await screen.findByText('Keep');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await user.click(screen.getByText('Keep'));

    expect(fetch).toHaveBeenLastCalledWith(
      '/api/taste-filter/label',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          image_path: CANDIDATE.imagePath,
          embedding: CANDIDATE.embedding,
          label: 'keep',
          category: CANDIDATE.category,
          prompt_id: CANDIDATE.promptId,
        }),
      })
    );
    expect(screen.queryByText('Keep')).not.toBeInTheDocument();
  });

  it('recompute now shows updated global counts', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ counts: { global: { keptCount: 12, discardedCount: 4 } } }),
    });
    const user = userEvent.setup();
    render(<TasteFilter />);

    await user.click(screen.getByText('Recompute now'));

    expect(await screen.findByText('Recomputed. Global: 12 kept / 4 discarded.')).toBeInTheDocument();
  });

  it('shows a per-candidate error without blocking the rest of the batch', async () => {
    const errored = { imagePath: '/data/candidates/bad.png', error: 'Not a valid image' };
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [errored, CANDIDATE] }) });
    const user = userEvent.setup();
    render(<TasteFilter />);
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, [makeFile('bad.png'), makeFile('good.png')]);

    expect(await screen.findByText('Not a valid image')).toBeInTheDocument();
    expect(screen.getByText('Keep')).toBeInTheDocument();
  });

  it('"Keep & send to pipeline" labels, promotes, creates a job (in order), and removes the card', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [CANDIDATE] }) });
    const user = userEvent.setup();
    const refreshJobs = vi.fn();
    const overrides = { listing_generator: true, mockup_composer: false };
    render(<TasteFilter overrides={overrides} refreshJobs={refreshJobs} />);

    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());
    await screen.findByText('Keep & send to pipeline');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // /taste-filter/label
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ artwork: { id: 42 } }) }); // /taste-filter/promote
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 99 }) }); // /api/jobs

    await user.click(screen.getByText('Keep & send to pipeline'));

    const calledUrls = fetch.mock.calls.slice(1).map(([url]) => url);
    expect(calledUrls).toEqual(['/api/taste-filter/label', '/api/taste-filter/promote', '/api/jobs']);

    expect(fetch.mock.calls[2][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ image_path: CANDIDATE.imagePath }),
      })
    );
    expect(fetch.mock.calls[3][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ artwork_id: 42, pipeline_overrides: overrides }),
      })
    );

    expect(refreshJobs).toHaveBeenCalled();
    expect(screen.queryByText('Keep & send to pipeline')).not.toBeInTheDocument();
  });

  it('"Keep & send to pipeline" still keeps the label if promote fails, and surfaces an error', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [CANDIDATE] }) });
    const user = userEvent.setup();
    const refreshJobs = vi.fn();
    render(<TasteFilter overrides={{}} refreshJobs={refreshJobs} />);

    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());
    await screen.findByText('Keep & send to pipeline');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // /taste-filter/label
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'image_path must be inside the taste-filter candidates directory' }) }); // /taste-filter/promote fails

    await user.click(screen.getByText('Keep & send to pipeline'));

    expect(await screen.findByText(/Kept, but failed to send to pipeline/)).toBeInTheDocument();
    expect(screen.queryByText('Keep & send to pipeline')).not.toBeInTheDocument();
    expect(refreshJobs).not.toHaveBeenCalled();
  });
});

describe('TasteFilter — Step 2.9: collapsed Auto-sorted section for autoDecision candidates', () => {
  const AUTO_KEEP = {
    ...CANDIDATE,
    imagePath: '/data/candidates/auto-keep.png',
    autoDecision: 'keep',
  };
  const AUTO_DISCARD = {
    ...CANDIDATE,
    imagePath: '/data/candidates/auto-discard.png',
    autoDecision: 'discard',
  };
  const NEEDS_REVIEW = {
    ...CANDIDATE,
    imagePath: '/data/candidates/needs-review.png',
    autoDecision: null,
  };

  it('renders autoDecision candidates in a collapsed Auto-sorted section, not the main grid', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [NEEDS_REVIEW, AUTO_KEEP, AUTO_DISCARD] }),
    });
    const user = userEvent.setup();
    render(<TasteFilter />);
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());

    expect(await screen.findByText('Auto-sorted (2)')).toBeInTheDocument();
    // Only the needs-review card's actions are visible before expanding.
    expect(screen.getAllByText('Keep')).toHaveLength(1);
  });

  it('expands the Auto-sorted section on click, showing each card with its actions', async () => {
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ candidates: [NEEDS_REVIEW, AUTO_KEEP, AUTO_DISCARD] }),
    });
    const user = userEvent.setup();
    render(<TasteFilter />);
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());
    await screen.findByText('Auto-sorted (2)');

    await user.click(screen.getByText('Auto-sorted (2)'));

    // needs-review's card + both auto-sorted cards now all show Keep/Discard actions.
    expect(screen.getAllByText('Keep')).toHaveLength(3);
    expect(screen.getAllByText('Discard')).toHaveLength(3);
  });

  it('correcting an auto-sorted candidate calls the same /taste-filter/label route and removes the card', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [AUTO_KEEP] }) });
    const user = userEvent.setup();
    render(<TasteFilter />);
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());
    await screen.findByText('Auto-sorted (1)');

    await user.click(screen.getByText('Auto-sorted (1)'));
    await screen.findByText('Discard');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    await user.click(screen.getByText('Discard'));

    expect(fetch).toHaveBeenLastCalledWith(
      '/api/taste-filter/label',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({
          image_path: AUTO_KEEP.imagePath,
          embedding: AUTO_KEEP.embedding,
          label: 'discard',
          category: AUTO_KEEP.category,
          prompt_id: AUTO_KEEP.promptId,
        }),
      })
    );
    expect(screen.queryByText('Auto-sorted (1)')).not.toBeInTheDocument();
  });

  it('does not render an Auto-sorted section when no candidate has an autoDecision', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [CANDIDATE] }) });
    const user = userEvent.setup();
    render(<TasteFilter />);
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());
    await screen.findByText('Keep');

    expect(screen.queryByText(/Auto-sorted/)).not.toBeInTheDocument();
  });
});

describe('TasteFilter — watched-folder auto-import polling (Module 7 -> "Auto-import via watched folder", step 7)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('does not poll before the interval elapses', () => {
    render(<TasteFilter />);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('merges a watcher-detected candidate into the grid once the poll interval elapses', async () => {
    const watched = { ...CANDIDATE, imagePath: '/data/taste-filter/from-watcher.png', imageUrl: '/taste-filter-files/from-watcher.png' };
    fetch.mockResolvedValue({ ok: true, json: async () => ({ candidates: [watched] }) });

    render(<TasteFilter />);
    await vi.advanceTimersByTimeAsync(5000);

    expect(fetch).toHaveBeenCalledWith('/api/taste-filter/pending');
    expect(await screen.findByText('Keep')).toBeInTheDocument();
  });

  it('does not re-add a candidate already merged in from an earlier poll', async () => {
    const watched = { ...CANDIDATE, imagePath: '/data/taste-filter/from-watcher.png', imageUrl: '/taste-filter-files/from-watcher.png' };
    fetch.mockResolvedValue({ ok: true, json: async () => ({ candidates: [watched] }) });

    render(<TasteFilter />);
    await vi.advanceTimersByTimeAsync(5000);
    await screen.findByText('Keep');
    await vi.advanceTimersByTimeAsync(5000);

    expect(screen.getAllByText('Keep')).toHaveLength(1);
  });
});
