import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TagsSection from './TagsSection.jsx';

const TAGS = [
  { id: 1, tag_text: 'watercolor art', category: 'style' },
  { id: 2, tag_text: 'botanical print', category: null },
];

function makeFetchQueue(map) {
  return vi.fn((url, opts) => {
    const entry = map.find(([matcher]) =>
      typeof matcher === 'string' ? url === matcher : matcher.test(url)
    );
    if (entry) return Promise.resolve(entry[1](url, opts));
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url === '/api/tags') return Promise.resolve({ ok: true, json: async () => [] });
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
});

describe('TagsSection', () => {
  it('loads and renders the tag library on mount', async () => {
    global.fetch = makeFetchQueue([
      ['/api/tags', () => ({ ok: true, json: async () => TAGS })],
    ]);
    render(<TagsSection />);

    expect(await screen.findByText('watercolor art')).toBeInTheDocument();
    expect(screen.getByText('botanical print')).toBeInTheDocument();
    expect(screen.getByText('style')).toBeInTheDocument();
  });

  it('shows an empty state when there are no tags yet', async () => {
    render(<TagsSection />);

    expect(await screen.findByText('No tags in library yet.')).toBeInTheDocument();
  });

  it('saves newline-separated tags via the bulk endpoint and clears the textarea', async () => {
    const bulkCalls = [];
    global.fetch = makeFetchQueue([
      ['/api/tags', () => ({ ok: true, json: async () => [] })],
      ['/api/tags/bulk', (url, opts) => {
        bulkCalls.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({}) };
      }],
    ]);
    const user = userEvent.setup();
    render(<TagsSection />);
    await screen.findByText('No tags in library yet.');

    await user.type(screen.getByLabelText('Tags (one per line)'), 'mug art{enter}minimalist poster');
    await user.click(screen.getByText('Save Tags'));

    await waitFor(() => expect(bulkCalls).toHaveLength(1));
    expect(bulkCalls[0].tags).toEqual(['mug art', 'minimalist poster']);
    expect(screen.getByLabelText('Tags (one per line)')).toHaveValue('');
  });

  it('notifies the parent via onSetupStatusChange after a successful save', async () => {
    global.fetch = makeFetchQueue([
      ['/api/tags', () => ({ ok: true, json: async () => [] })],
      ['/api/tags/bulk', () => ({ ok: true, json: async () => ({}) })],
    ]);
    const onSetupStatusChange = vi.fn();
    const user = userEvent.setup();
    render(<TagsSection onSetupStatusChange={onSetupStatusChange} />);
    await screen.findByText('No tags in library yet.');

    await user.type(screen.getByLabelText('Tags (one per line)'), 'mug art');
    await user.click(screen.getByText('Save Tags'));

    await waitFor(() => expect(onSetupStatusChange).toHaveBeenCalled());
  });

  it('deletes a tag after confirmation (ConfirmContext is mocked to auto-confirm)', async () => {
    global.fetch = makeFetchQueue([
      ['/api/tags', () => ({ ok: true, json: async () => TAGS })],
      [/\/api\/tags\/1$/, () => ({ ok: true, status: 204, json: async () => ({}) })],
    ]);
    const user = userEvent.setup();
    render(<TagsSection />);
    await screen.findByText('watercolor art');

    await user.click(screen.getByLabelText('Delete watercolor art'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith('/api/tags/1', expect.objectContaining({ method: 'DELETE' }));
    });
  });
});
