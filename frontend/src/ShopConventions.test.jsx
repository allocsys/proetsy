import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

// Mock the api module so the component's api.shopConventions calls work.
// vi.mock is hoisted, so the factory cannot reference outer variables.
vi.mock('./hooks/useApi.js', () => ({
  api: {
    shopConventions: {
      get: vi.fn().mockResolvedValue({
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
      }),
      patch: vi.fn().mockResolvedValue({}),
    },
  },
  friendlyErrorMessage: (err) => err.message,
  parseJsonResponse: async (res) => {
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
    return data;
  },
}));

import { api } from './hooks/useApi.js';
import ShopConventions from './ShopConventions.jsx';

describe('ShopConventions', () => {
  it('loads and renders initial conventions', async () => {
    render(<ShopConventions />);
    expect(await screen.findByDisplayValue('|')).toBeInTheDocument();
    expect(screen.getByDisplayValue('140')).toBeInTheDocument();
    expect(screen.getByDisplayValue('frame')).toBeInTheDocument();
  });

  it('saves edits successfully', async () => {
    const user = userEvent.setup();
    render(<ShopConventions />);
    await screen.findByDisplayValue('|');

    const input = screen.getByDisplayValue('140');
    await user.clear(input);
    await user.type(input, '150');
    await user.click(screen.getByText('Save shop conventions'));

    await waitFor(() => {
      expect(api.shopConventions.patch).toHaveBeenCalledWith(
        expect.objectContaining({
          listing: expect.objectContaining({ maxTitleLength: 150 }),
        })
      );
    });
    expect(await screen.findByText('Shop conventions saved successfully.')).toBeInTheDocument();
  });

  it('displays error inline when save fails', async () => {
    api.shopConventions.patch.mockRejectedValueOnce(new Error('Invalid config'));
    const user = userEvent.setup();
    render(<ShopConventions />);
    await screen.findByDisplayValue('|');

    await user.click(screen.getByText('Save shop conventions'));

    expect(await screen.findByText('Invalid config')).toBeInTheDocument();
  });
});
