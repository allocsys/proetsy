import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShopConventions from './ShopConventions.jsx';

const CONVENTIONS = {
  listing: {
    titleSeparator: '|',
    maxTitleLength: 140,
    tagsPerListing: 13,
    tagAlternates: 5,
    maxTagLength: 20,
    forbiddenTitleWords: ['frame'],
    aiDisclosurePhrases: ['ai'],
    deliveryDetailPhrases: ['digital'],
  },
  midjourney: {
    version: '--v 7',
    style: '--style raw',
    stylizeMin: 50,
    stylizeMax: 150,
    defaultStylize: 100,
    aspectRatioByOrientation: { portrait: '3:4' },
  },
};

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url === '/api/config/shop-conventions') {
      return Promise.resolve({ ok: true, json: async () => CONVENTIONS });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
});

describe('ShopConventions', () => {
  it('loads and renders initial conventions', async () => {
    render(<ShopConventions />);
    expect(await screen.findByDisplayValue('|')).toBeInTheDocument();
    expect(screen.getByDisplayValue('140')).toBeInTheDocument();
    expect(screen.getByDisplayValue('frame')).toBeInTheDocument();
  });

  it('saves edits successfully', async () => {
    global.fetch = vi.fn((url, options) => {
      if (url === '/api/config/shop-conventions' && options?.method === 'PATCH') {
        return Promise.resolve({ ok: true, json: async () => CONVENTIONS });
      }
      return Promise.resolve({ ok: true, json: async () => CONVENTIONS });
    });
    const user = userEvent.setup();
    render(<ShopConventions />);
    await screen.findByDisplayValue('|');

    const input = screen.getByDisplayValue('140');
    await user.clear(input);
    await user.type(input, '150');
    await user.click(screen.getByText('Save shop conventions'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/config/shop-conventions',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"maxTitleLength":150'),
        })
      );
    });
    expect(await screen.findByText('Shop conventions saved successfully.')).toBeInTheDocument();
  });

  it('displays error inline when save fails with 400', async () => {
    global.fetch = vi.fn((url, options) => {
      if (url === '/api/config/shop-conventions' && options?.method === 'PATCH') {
        return Promise.resolve({ ok: false, json: async () => ({ error: 'Invalid config' }) });
      }
      return Promise.resolve({ ok: true, json: async () => CONVENTIONS });
    });
    const user = userEvent.setup();
    render(<ShopConventions />);
    await screen.findByDisplayValue('|');

    await user.click(screen.getByText('Save shop conventions'));

    expect(await screen.findByText(/Error: Invalid config/)).toBeInTheDocument();
  });
});
