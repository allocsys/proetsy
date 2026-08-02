import { describe, it, expect, vi, beforeEach } from 'vitest';
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
});
