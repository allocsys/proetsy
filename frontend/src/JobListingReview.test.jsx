import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JobListingReview from '../JobListingReview.jsx';

const LISTING = {
  id: 1,
  job_id: 42,
  variation: 'fine_art',
  title: 'Original Title',
  description: 'Original description',
  tags: ['wall art', 'boho'],
  tag_alternates: ['minimalist'],
  warnings: [],
};

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('JobListingReview', () => {
  it('disables "Load listings" when no jobId is given', () => {
    render(<JobListingReview jobId={null} />);
    expect(screen.getByText('Load listings')).toBeDisabled();
  });

  it('shows the empty state before anything is loaded', () => {
    render(<JobListingReview jobId="42" />);
    expect(screen.getByText('No listings loaded yet.')).toBeInTheDocument();
  });

  it('loads and renders listing cards on click', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [LISTING] });
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);

    await user.click(screen.getByText('Load listings'));

    expect(fetch).toHaveBeenCalledWith('/api/jobs/42/listings');
    expect(await screen.findByDisplayValue('Original Title')).toBeInTheDocument();
    expect(screen.getByDisplayValue('wall art, boho')).toBeInTheDocument();
    // "fine_art" -> "fine art" per the variation?.replace('_', ' ') display transform
    expect(screen.getByText('fine art')).toBeInTheDocument();
  });

  it('shows an error message when loading fails', async () => {
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({}) });
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);

    await user.click(screen.getByText('Load listings'));

    expect(await screen.findByText('Failed to load listings')).toBeInTheDocument();
  });

  it('edits a field and saves via PATCH, reflecting the cleaned server response', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [LISTING] });
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);
    await user.click(screen.getByText('Load listings'));
    await screen.findByDisplayValue('Original Title');

    const titleInput = screen.getByDisplayValue('Original Title');
    await user.clear(titleInput);
    await user.type(titleInput, 'Edited Title');

    fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ ...LISTING, title: 'Edited Title', warnings: ['Title trimmed to fit convention'] }),
    });
    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/jobs/42/listings/1',
        expect.objectContaining({ method: 'PATCH' })
      );
    });
    expect(await screen.findByText('Title trimmed to fit convention')).toBeInTheDocument();
  });

  it('copies title/description/tags to the clipboard', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [LISTING] });
    const user = userEvent.setup();
    render(<JobListingReview jobId="42" />);
    await user.click(screen.getByText('Load listings'));
    await screen.findByDisplayValue('Original Title');

    await user.click(screen.getByText('Copy for Etsy'));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'Original Title\n\nOriginal description\n\nTags: wall art, boho'
    );
    expect(await screen.findByText('Copied!')).toBeInTheDocument();
  });
});
