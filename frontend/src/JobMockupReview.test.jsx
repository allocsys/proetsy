import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JobMockupReview from './JobMockupReview.jsx';

const NEEDS_REVIEW_MOCKUP = {
  id: 5,
  job_id: 42,
  size_key: '8x10-portrait',
  dimensions: '8x10',
  needs_review: true,
  smart_crop_url: '/mockup-files/smart-crop-5.png',
  ai_extended_url: '/mockup-files/ai-extended-5.png',
  selected_variant: 'smart_crop',
};

const RESOLVED_MOCKUP = {
  ...NEEDS_REVIEW_MOCKUP,
  needs_review: false,
  file_url: '/mockup-files/smart-crop-5.png',
};

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('JobMockupReview', () => {
  it('disables "Load mockups" when no jobId is given', () => {
    render(<JobMockupReview jobId={null} />);
    expect(screen.getByText('Load mockups')).toBeDisabled();
  });

  it('shows the empty state before anything is loaded', () => {
    render(<JobMockupReview jobId="42" />);
    expect(screen.getByText('No mockups loaded yet.')).toBeInTheDocument();
  });

  it('shows both variants side by side when needs_review is true', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [NEEDS_REVIEW_MOCKUP] });
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);

    await user.click(screen.getByText('Load mockups'));

    expect(await screen.findByText('Needs review — pick a variant:')).toBeInTheDocument();
    expect(screen.getByText('Use smart crop')).toBeInTheDocument();
    expect(screen.getByText('Use AI extended')).toBeInTheDocument();
    expect(screen.getByAltText('Smart crop variant')).toHaveAttribute('src', '/mockup-files/smart-crop-5.png');
  });

  it('shows only the selected variant when needs_review is false', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [RESOLVED_MOCKUP] });
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);

    await user.click(screen.getByText('Load mockups'));

    expect(await screen.findByText('Selected: smart_crop')).toBeInTheDocument();
    expect(screen.queryByText('Needs review — pick a variant:')).not.toBeInTheDocument();
  });

  it('selecting a variant PATCHes the variant route and reloads', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [NEEDS_REVIEW_MOCKUP] });
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);
    await user.click(screen.getByText('Load mockups'));
    await screen.findByText('Use AI extended');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 5, selected_variant: 'ai_extended' }) });
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [{ ...RESOLVED_MOCKUP, selected_variant: 'ai_extended' }] });

    await user.click(screen.getByText('Use AI extended'));

    expect(fetch).toHaveBeenCalledWith(
      '/api/jobs/42/mockups/5/variant',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ variant: 'ai_extended' }),
      })
    );
    expect(await screen.findByText('Selected: ai_extended')).toBeInTheDocument();
  });

  it('shows an inline error if the variant PATCH fails', async () => {
    fetch.mockResolvedValueOnce({ ok: true, json: async () => [NEEDS_REVIEW_MOCKUP] });
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);
    await user.click(screen.getByText('Load mockups'));
    await screen.findByText('Use smart crop');

    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Mockup not found' }) });
    await user.click(screen.getByText('Use smart crop'));

    expect(await screen.findByText('Mockup not found')).toBeInTheDocument();
  });
});
