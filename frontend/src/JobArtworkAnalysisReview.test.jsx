import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import JobArtworkAnalysisReview from '../JobArtworkAnalysisReview.jsx';

const JOB = { id: 42, artwork_id: 7, manual_notes: '' };
const ANALYSIS = {
  subject: 'A red fox in snow',
  style: 'watercolor',
  mood: 'serene',
  palette: ['crimson', 'white', 'slate'],
  themes: ['winter', 'wildlife'],
  notable_elements: [],
  suggested_categories: ['square-canvas'],
};

beforeEach(() => {
  global.fetch = vi.fn();
});

describe('JobArtworkAnalysisReview', () => {
  it('disables both action buttons when no jobId is given', () => {
    render(<JobArtworkAnalysisReview jobId={null} />);
    expect(screen.getByText('Load analysis')).toBeDisabled();
    expect(screen.getByText('Run image analyzer')).toBeDisabled();
  });

  it('loads the job and renders a completed analysis', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => JOB })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ image_analysis: ANALYSIS }) });
    const user = userEvent.setup();
    render(<JobArtworkAnalysisReview jobId="42" />);

    await user.click(screen.getByText('Load analysis'));

    expect(fetch).toHaveBeenNthCalledWith(1, '/api/jobs/42');
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/artworks/7');
    expect(await screen.findByText('A red fox in snow')).toBeInTheDocument();
    expect(screen.getByText('crimson, white, slate')).toBeInTheDocument();
    // notable_elements is an empty array -> listOrDash() renders an em dash
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('shows the no-analysis-yet message and manual-notes fallback once a job loads with no analysis', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => JOB })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ image_analysis: null }) });
    const user = userEvent.setup();
    render(<JobArtworkAnalysisReview jobId="42" />);

    await user.click(screen.getByText('Load analysis'));

    expect(await screen.findByText(/No analysis yet for this artwork/)).toBeInTheDocument();
    expect(screen.getByText(/Manual notes/)).toBeInTheDocument();
  });

  it('running the analyzer surfaces its optional-module failure inline, not as a blocking error', async () => {
    fetch.mockResolvedValueOnce({ ok: false, json: async () => ({ error: 'Gemini key exhausted' }) });
    const user = userEvent.setup();
    render(<JobArtworkAnalysisReview jobId="42" />);

    await user.click(screen.getByText('Run image analyzer'));

    expect(await screen.findByText('Gemini key exhausted')).toBeInTheDocument();
  });

  it('saves manual notes via PATCH', async () => {
    fetch
      .mockResolvedValueOnce({ ok: true, json: async () => JOB })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ image_analysis: null }) });
    const user = userEvent.setup();
    render(<JobArtworkAnalysisReview jobId="42" />);
    await user.click(screen.getByText('Load analysis'));
    await screen.findByText(/Manual notes/);

    const textarea = screen.getByRole('textbox');
    await user.type(textarea, 'Looks like a fox print');

    fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ ...JOB, manual_notes: 'Looks like a fox print' }) });
    await user.click(screen.getByText('Save manual notes'));

    expect(fetch).toHaveBeenLastCalledWith(
      '/api/jobs/42/manual-notes',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ notes: 'Looks like a fox print' }),
      })
    );
  });
});
