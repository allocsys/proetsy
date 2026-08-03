import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
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

const TEMPLATE_BEDROOM = { size_key: '8x10-bedroom', category: 'bedroom' };
const TEMPLATE_BEDROOM_2 = { size_key: '11x14-bedroom', category: 'bedroom' };
const TEMPLATE_MUG = { size_key: 'mug-white', category: 'mug' };
const TEMPLATE_UNCATEGORIZED = { size_key: 'misc-size', category: null };

// URL-dispatch fetch mock (same convention as MockupTemplates.test.jsx's
// makeFetchQueue): the new MockupCategorySelector fetches two endpoints on mount
// (GET /api/mockup-templates/categories, GET /api/mockup-templates) alongside whatever
// a given test cares about (e.g. GET /api/jobs/:id/mockups), so matching by call order
// alone (plain mockResolvedValueOnce) is no longer reliable here.
function makeFetchMock(map) {
  return vi.fn((url, opts) => {
    const entry = map.find(([matcher]) => (typeof matcher === 'string' ? url === matcher : matcher.test(url)));
    if (entry) return Promise.resolve(entry[1](url, opts));
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

// Default: no categories/templates configured yet — MockupCategorySelector renders its
// empty state and does nothing further, so tests that only care about the mockups list
// don't need to think about it.
const NO_CATEGORIES = [
  ['/api/mockup-templates/categories', () => ({ ok: true, json: async () => [] })],
  ['/api/mockup-templates', () => ({ ok: true, json: async () => [] })],
];

beforeEach(() => {
  global.fetch = makeFetchMock(NO_CATEGORIES);
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
    global.fetch = makeFetchMock([
      ...NO_CATEGORIES,
      ['/api/jobs/42/mockups', () => ({ ok: true, json: async () => [NEEDS_REVIEW_MOCKUP] })],
    ]);
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);

    await user.click(screen.getByText('Load mockups'));

    expect(await screen.findByText('Needs review — pick a variant:')).toBeInTheDocument();
    expect(screen.getByText('Use smart crop')).toBeInTheDocument();
    expect(screen.getByText('Use AI extended')).toBeInTheDocument();
    expect(screen.getByAltText('Smart crop variant')).toHaveAttribute('src', '/mockup-files/smart-crop-5.png');
  });

  it('shows only the selected variant when needs_review is false', async () => {
    global.fetch = makeFetchMock([
      ...NO_CATEGORIES,
      ['/api/jobs/42/mockups', () => ({ ok: true, json: async () => [RESOLVED_MOCKUP] })],
    ]);
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);

    await user.click(screen.getByText('Load mockups'));

    expect(await screen.findByText('Selected: smart_crop')).toBeInTheDocument();
    expect(screen.queryByText('Needs review — pick a variant:')).not.toBeInTheDocument();
  });

  it('selecting a variant PATCHes the variant route and reloads', async () => {
    let mockupsCallCount = 0;
    global.fetch = makeFetchMock([
      ...NO_CATEGORIES,
      ['/api/jobs/42/mockups', () => {
        mockupsCallCount += 1;
        const mockup = mockupsCallCount === 1 ? NEEDS_REVIEW_MOCKUP : { ...RESOLVED_MOCKUP, selected_variant: 'ai_extended' };
        return { ok: true, json: async () => [mockup] };
      }],
      [/\/api\/jobs\/42\/mockups\/5\/variant/, () => ({ ok: true, json: async () => ({ id: 5, selected_variant: 'ai_extended' }) })],
    ]);
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);
    await user.click(screen.getByText('Load mockups'));
    await screen.findByText('Use AI extended');

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
    global.fetch = makeFetchMock([
      ...NO_CATEGORIES,
      ['/api/jobs/42/mockups', () => ({ ok: true, json: async () => [NEEDS_REVIEW_MOCKUP] })],
      [/\/api\/jobs\/42\/mockups\/5\/variant/, () => ({ ok: false, json: async () => ({ error: 'Mockup not found' }) })],
    ]);
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);
    await user.click(screen.getByText('Load mockups'));
    await screen.findByText('Use smart crop');

    await user.click(screen.getByText('Use smart crop'));

    expect(await screen.findByText('Mockup not found')).toBeInTheDocument();
  });
});

describe('MockupCategorySelector (Rollout step 5)', () => {
  it('shows an empty state when no categories are configured yet', async () => {
    render(<JobMockupReview jobId="42" />);

    expect(await screen.findByText(/No mockup categories configured yet/)).toBeInTheDocument();
  });

  it('renders a checkbox per distinct configured category', async () => {
    global.fetch = makeFetchMock([
      ['/api/mockup-templates/categories', () => ({ ok: true, json: async () => ['bedroom', 'mug'] })],
      ['/api/mockup-templates', () => ({ ok: true, json: async () => [TEMPLATE_BEDROOM, TEMPLATE_MUG] })],
    ]);
    render(<JobMockupReview jobId="42" />);

    expect(await screen.findByText('bedroom')).toBeInTheDocument();
    expect(screen.getByText('mug')).toBeInTheDocument();
  });

  it('disables the generate button until at least one category is checked', async () => {
    global.fetch = makeFetchMock([
      ['/api/mockup-templates/categories', () => ({ ok: true, json: async () => ['bedroom'] })],
      ['/api/mockup-templates', () => ({ ok: true, json: async () => [TEMPLATE_BEDROOM] })],
    ]);
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);
    await screen.findByText('bedroom');

    const button = screen.getByText('Generate mockups for selected categories');
    expect(button).toBeDisabled();

    await user.click(screen.getByRole('checkbox'));
    expect(button).not.toBeDisabled();
  });

  it('resolves every checked category to its underlying size_keys and calls POST /api/jobs/:id/run, excluding uncategorized templates', async () => {
    const postCalls = [];
    global.fetch = makeFetchMock([
      ['/api/mockup-templates/categories', () => ({ ok: true, json: async () => ['bedroom', 'mug'] })],
      ['/api/mockup-templates', () => ({
        ok: true,
        json: async () => [TEMPLATE_BEDROOM, TEMPLATE_BEDROOM_2, TEMPLATE_MUG, TEMPLATE_UNCATEGORIZED],
      })],
      ['/api/jobs/42/run', (url, opts) => {
        postCalls.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({ job: {}, results: {} }) };
      }],
      // onGenerated reloads the mockups list after a successful run.
      ['/api/jobs/42/mockups', () => ({ ok: true, json: async () => [] })],
    ]);
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);
    await screen.findByText('bedroom');

    // Only check "bedroom" — "mug" and the uncategorized template should be excluded.
    await user.click(screen.getByRole('checkbox', { name: /bedroom/ }));
    await user.click(screen.getByText('Generate mockups for selected categories'));

    await waitFor(() => expect(postCalls).toHaveLength(1));
    expect(postCalls[0].size_keys.sort()).toEqual(['11x14-bedroom', '8x10-bedroom'].sort());

    expect(await screen.findByText('Generated mockups for 2 templates.')).toBeInTheDocument();
  });

  it('reloads mockups after a successful generate', async () => {
    let mockupsCallCount = 0;
    global.fetch = makeFetchMock([
      ['/api/mockup-templates/categories', () => ({ ok: true, json: async () => ['bedroom'] })],
      ['/api/mockup-templates', () => ({ ok: true, json: async () => [TEMPLATE_BEDROOM] })],
      ['/api/jobs/42/run', () => ({ ok: true, json: async () => ({ job: {}, results: {} }) })],
      ['/api/jobs/42/mockups', () => {
        mockupsCallCount += 1;
        return { ok: true, json: async () => [] };
      }],
    ]);
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);
    await screen.findByText('bedroom');

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByText('Generate mockups for selected categories'));

    await waitFor(() => expect(mockupsCallCount).toBeGreaterThan(0));
  });

  it('shows an inline error if the generate call fails', async () => {
    global.fetch = makeFetchMock([
      ['/api/mockup-templates/categories', () => ({ ok: true, json: async () => ['bedroom'] })],
      ['/api/mockup-templates', () => ({ ok: true, json: async () => [TEMPLATE_BEDROOM] })],
      ['/api/jobs/42/run', () => ({ ok: false, json: async () => ({ error: 'Job not found' }) })],
    ]);
    const user = userEvent.setup();
    render(<JobMockupReview jobId="42" />);
    await screen.findByText('bedroom');

    await user.click(screen.getByRole('checkbox'));
    await user.click(screen.getByText('Generate mockups for selected categories'));

    expect(await screen.findByText('Job not found')).toBeInTheDocument();
  });
});
