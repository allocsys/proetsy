import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen } from '@testing-library/react';
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

// jsdom has no built-in EventSource -- a minimal stand-in that records every instance
// TasteFilter.jsx constructs (one per mount, via the watched-folder SSE effect) and lets
// a test fire a synthetic message straight at the component's own onmessage handler, the
// same way the real backend stream would. Declared here (not per-describe-block) because
// every test mounts TasteFilter, and TasteFilter always opens this connection on mount --
// not just the tests that exercise it directly.
let sourceInstances;

beforeEach(() => {
  global.fetch = vi.fn();
  // TasteFilter's mount-time effect fires these two GETs first, unconditionally, before
  // any interaction a test below cares about -- neither response needs to be realistic,
  // since centroids/prompts only feed datalist suggestions no test asserts on. Queuing
  // them here (ahead of whatever a test queues next) keeps `fetch` a plain, fully-featured
  // vi.fn() -- every matcher (toHaveBeenCalledWith, toHaveBeenLastCalledWith, etc.) keeps
  // working unmodified -- at the cost of shifting fetch.mock.calls by a constant +2 for
  // any test that indexes into it directly; those few call sites account for the offset
  // explicitly (see MOUNT_TIME_CALLS below).
  fetch.mockResolvedValueOnce({ ok: true, json: async () => [] }); // /api/taste-filter/centroids
  fetch.mockResolvedValueOnce({ ok: true, json: async () => [] }); // /api/prompts

  sourceInstances = [];
  global.EventSource = class {
    constructor(url) {
      this.url = url;
      this.onmessage = null;
      this.closed = false;
      sourceInstances.push(this);
    }
    close() {
      this.closed = true;
    }
  };
});

afterEach(() => {
  delete global.EventSource;
});

function makeFile(name = 'candidate.png') {
  return new File(['fake-image-bytes'], name, { type: 'image/png' });
}

// Every test's fetch.mock.calls[0] and [1] are the mount-time centroids/prompts calls
// pre-queued in beforeEach above; a test's own first real call is at this index.
const MOUNT_TIME_CALLS = 2;

describe('TasteFilter', () => {
  it('renders the empty state with no candidates', async () => {
    render(<TasteFilter />);
    // Flush the mount-time centroids/prompts fetches (see beforeEach) before asserting,
    // so their state updates don't land outside act() after this test has returned.
    await act(async () => {});
    expect(screen.getByText('No candidates yet.')).toBeInTheDocument();
    expect(screen.getByText('Drag & drop candidate images here')).toBeInTheDocument();
    expect(screen.queryByText('Keep')).not.toBeInTheDocument();
  });

  it('imports a batch and renders scored candidates', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [CANDIDATE] }) });
    const user = userEvent.setup();
    render(<TasteFilter />);

    // The file input is hidden; click the dropzone to trigger it, or query directly.
    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());

    expect(fetch).toHaveBeenCalledWith('/api/taste-filter/import', expect.objectContaining({ method: 'POST' }));
    expect(await screen.findByText(/Scored 1 image/)).toBeInTheDocument();
    expect(screen.getByText(/likely-keep \(0.420\)/)).toBeInTheDocument();
    expect(screen.getByText(/uncertain \(0.010\) · cold start/)).toBeInTheDocument();
  });

  it('sends the category and prompt ID fields along with an import', async () => {
    // Override the mount-time centroids/prompts calls queued in beforeEach: the prompt
    // Select is disabled when promptOptions is empty, so this test needs a real option
    // to select rather than the default empty /api/prompts response.
    fetch.mockReset();
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] }); // /api/taste-filter/centroids
    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => [{ id: 17, orientation: null, prompt_text: 'Test prompt text' }],
    }); // /api/prompts
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [] }) }); // import

    const user = userEvent.setup();
    render(<TasteFilter />);

    await user.type(screen.getByPlaceholderText('e.g. square-canvas'), 'square-canvas');
    await user.click(await screen.findByText('Test prompt text'));

    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());

    const [, options] = fetch.mock.calls[MOUNT_TIME_CALLS];
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

    // api.tasteFilter.label() calls fetch internally with the same shape
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

  it('"Keep + Pipeline" labels, promotes, creates a job (in order), and removes the card', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [CANDIDATE] }) });
    const user = userEvent.setup();
    const refreshJobs = vi.fn();
    const overrides = { listing_generator: true, mockup_composer: false };
    render(<TasteFilter overrides={overrides} refreshJobs={refreshJobs} />);

    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());
    await screen.findByText('Keep + Pipeline');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // /taste-filter/label
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ artwork: { id: 42 } }) }); // /taste-filter/promote
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 99 }) }); // /api/jobs

    await user.click(screen.getByText('Keep + Pipeline'));

    const calledUrls = fetch.mock.calls.slice(MOUNT_TIME_CALLS + 1).map(([url]) => url);
    expect(calledUrls).toEqual(['/api/taste-filter/label', '/api/taste-filter/promote', '/api/jobs']);

    expect(fetch.mock.calls[MOUNT_TIME_CALLS + 2][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ image_path: CANDIDATE.imagePath }),
      })
    );
    expect(fetch.mock.calls[MOUNT_TIME_CALLS + 3][1]).toEqual(
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ artwork_id: 42, pipeline_overrides: overrides }),
      })
    );

    expect(refreshJobs).toHaveBeenCalled();
    expect(screen.queryByText('Keep + Pipeline')).not.toBeInTheDocument();
  });

  it('"Keep + Pipeline" still keeps the label if promote fails, and the card is removed', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ candidates: [CANDIDATE] }) });
    const user = userEvent.setup();
    const refreshJobs = vi.fn();
    render(<TasteFilter overrides={{}} refreshJobs={refreshJobs} />);

    const input = document.querySelector('input[type="file"]');
    await user.upload(input, makeFile());
    await screen.findByText('Keep + Pipeline');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) }); // /taste-filter/label succeeds
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'image_path must be inside the taste-filter candidates directory' }) }); // /taste-filter/promote fails

    await user.click(screen.getByText('Keep + Pipeline'));

    // The label was kept (card removed) but the pipeline send failed.
    // The error is surfaced via toast, not inline DOM text.
    expect(screen.queryByText('Keep + Pipeline')).not.toBeInTheDocument();
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

    // The auto-sorted section heading and count badge are separate elements.
    expect(screen.getByText('Auto-sorted')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    // Only the needs-review card's Keep button is visible before expanding.
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
    await screen.findByText('Auto-sorted');

    await user.click(screen.getByText('Auto-sorted'));

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
    await screen.findByText('Auto-sorted');

    await user.click(screen.getByText('Auto-sorted'));
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
    // After removing the only auto-sorted candidate, the section should be gone.
    expect(screen.queryByText('Auto-sorted')).not.toBeInTheDocument();
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

describe('TasteFilter — watched-folder auto-import via SSE (Module 7 -> "Auto-import via watched folder", step 7)', () => {
  // global.EventSource and sourceInstances come from the shared outer beforeEach above --
  // every test mounts TasteFilter, which always opens this connection, not just this block.

  it('opens a stream connection to /api/taste-filter/pending/stream on mount', async () => {
    render(<TasteFilter />);
    await act(async () => {});
    const urls = sourceInstances.map((s) => s.url);
    expect(urls).toContain('/api/taste-filter/pending/stream');
  });

  it('merges a watcher-pushed candidate into the grid when a message event arrives', async () => {
    const watched = { ...CANDIDATE, imagePath: '/data/taste-filter/from-watcher.png', imageUrl: '/taste-filter-files/from-watcher.png' };
    render(<TasteFilter />);
    const [source] = sourceInstances;

    act(() => {
      source.onmessage({ data: JSON.stringify(watched) });
    });

    expect(await screen.findByText('Keep')).toBeInTheDocument();
  });

  it('does not re-add a candidate already merged in from an earlier event', async () => {
    const watched = { ...CANDIDATE, imagePath: '/data/taste-filter/from-watcher.png', imageUrl: '/taste-filter-files/from-watcher.png' };
    render(<TasteFilter />);
    const [source] = sourceInstances;

    act(() => {
      source.onmessage({ data: JSON.stringify(watched) });
    });
    await screen.findByText('Keep');

    act(() => {
      source.onmessage({ data: JSON.stringify(watched) });
    });

    expect(screen.getAllByText('Keep')).toHaveLength(1);
  });

  it('ignores a malformed message instead of throwing', async () => {
    render(<TasteFilter />);
    await act(async () => {});
    const [source] = sourceInstances;

    expect(() => {
      act(() => {
        source.onmessage({ data: 'not json' });
      });
    }).not.toThrow();
    expect(screen.queryByText('Keep')).not.toBeInTheDocument();
  });

  it('closes the stream connection on unmount', () => {
    const { unmount } = render(<TasteFilter />);
    const source = sourceInstances.find((s) => s.url === '/api/taste-filter/pending/stream');

    unmount();

    expect(source.closed).toBe(true);
  });
});

describe('TasteFilter — CLIP model download progress bar', () => {
  // global.EventSource and sourceInstances come from the shared outer beforeEach above.
  function modelStatusSource() {
    return sourceInstances.find((s) => s.url === '/api/taste-filter/model-status/stream');
  }

  it('opens a stream connection to /api/taste-filter/model-status/stream on mount, and closes it on unmount', () => {
    const { unmount } = render(<TasteFilter />);
    const source = modelStatusSource();
    expect(source).toBeDefined();

    unmount();
    expect(source.closed).toBe(true);
  });

  it('renders nothing before the stream delivers a first message', async () => {
    render(<TasteFilter />);
    await act(async () => {});
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('renders nothing once status is ready', async () => {
    render(<TasteFilter />);
    await act(async () => {});
    act(() => {
      modelStatusSource().onmessage({
        data: JSON.stringify({ status: 'ready', bytesDownloaded: 0, totalBytes: null, error: null }),
      });
    });
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  });

  it('renders a determinate progress bar with percentage when Content-Length was known', async () => {
    render(<TasteFilter />);
    act(() => {
      modelStatusSource().onmessage({
        data: JSON.stringify({
          status: 'downloading',
          bytesDownloaded: 175 * 1024 * 1024,
          totalBytes: 350 * 1024 * 1024,
          error: null,
        }),
      });
    });

    // The component renders the percentage in a <p> and the MB values in a separate <span>.
    expect(await screen.findByText(/50%/)).toBeInTheDocument();
    expect(screen.getByText(/175 \/ 350 MB/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '50');
  });

  it('renders an indeterminate bar (MB downloaded only) when totalBytes is null', async () => {
    render(<TasteFilter />);
    act(() => {
      modelStatusSource().onmessage({
        data: JSON.stringify({
          status: 'downloading',
          bytesDownloaded: 40 * 1024 * 1024,
          totalBytes: null,
          error: null,
        }),
      });
    });

    // The component renders "40 / ??? MB" for indeterminate progress.
    expect(await screen.findByText(/40 \/ \?\?\? MB/)).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('aria-valuenow');
  });

  it('surfaces a download error inline', async () => {
    render(<TasteFilter />);
    act(() => {
      modelStatusSource().onmessage({
        data: JSON.stringify({
          status: 'error',
          bytesDownloaded: 0,
          totalBytes: null,
          error: 'HTTP 503 from huggingface.co',
        }),
      });
    });

    expect(await screen.findByText(/HTTP 503 from huggingface\.co/)).toBeInTheDocument();
    expect(screen.getByText(/retry automatically/)).toBeInTheDocument();
  });
});
