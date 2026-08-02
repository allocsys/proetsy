import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PromptHelper from '../PromptHelper.jsx';

const TREND = { id: 3, term: 'cottagecore', category: 'portrait' };

// PromptHelper fetches trends + history on mount (two effects), so every test needs
// those two initial calls satisfied before asserting on anything else.
function mockInitialLoad({ trends = [], history = [] } = {}) {
  fetch
    .mockResolvedValueOnce({ ok: true, json: async () => trends })
    .mockResolvedValueOnce({ ok: true, json: async () => history });
}

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('PromptHelper', () => {
  it('loads trends and category history on mount', async () => {
    mockInitialLoad({ trends: [TREND] });
    render(<PromptHelper />);

    expect(await screen.findByText('cottagecore (portrait)')).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/trends');
    expect(fetch).toHaveBeenCalledWith('/api/prompts?category=portrait');
  });

  it('re-fetches history when the category changes', async () => {
    mockInitialLoad();
    const user = userEvent.setup();
    render(<PromptHelper />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });
    await user.selectOptions(screen.getByLabelText('Category:'), 'landscape');

    await waitFor(() => {
      expect(fetch).toHaveBeenLastCalledWith('/api/prompts?category=landscape');
    });
  });

  it('adds a new trend and selects it', async () => {
    mockInitialLoad();
    const user = userEvent.setup();
    render(<PromptHelper />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 9, term: 'cozy autumn' }) });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [TREND, { id: 9, term: 'cozy autumn' }] });

    await user.type(screen.getByPlaceholderText('Add a new trend'), 'cozy autumn');
    await user.click(screen.getByText('Add trend'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/trends',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('generates prompts and displays warnings', async () => {
    mockInitialLoad();
    const user = userEvent.setup();
    render(<PromptHelper />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        prompts: [{ id: 1, prompt_text: 'a cozy cottage, warm light --v 7 --style raw', warnings: ['stylize value adjusted to fit range'] }],
      }),
    });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [] });

    await user.click(screen.getByText('Generate prompts'));

    expect(await screen.findByText('a cozy cottage, warm light --v 7 --style raw')).toBeInTheDocument();
    expect(screen.getByText('stylize value adjusted to fit range')).toBeInTheDocument();
  });

  it('shows an error if generation fails', async () => {
    mockInitialLoad();
    const user = userEvent.setup();
    render(<PromptHelper />);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));

    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'All Gemini keys/models rate-limited' }) });
    await user.click(screen.getByText('Generate prompts'));

    expect(await screen.findByText('All Gemini keys/models rate-limited')).toBeInTheDocument();
  });

  it('copies a prompt to the clipboard', async () => {
    mockInitialLoad({ history: [{ id: 2, prompt_text: 'existing prompt text' }] });
    render(<PromptHelper />);
    await screen.findByText('existing prompt text');

    const user = userEvent.setup();
    await user.click(screen.getByText('Copy'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('existing prompt text');
  });
});
