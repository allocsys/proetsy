import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OnboardingWizard from './OnboardingWizard.jsx';

// Stub the heavier reused steps so this file only exercises the wizard's own
// step-indicator / navigation / skip / finish logic, not TagsSection's or
// MockupTemplates' internals (those have their own test files).
vi.mock('@/components/TagsSection.jsx', () => ({
  default: () => <div data-testid="tags-section">Tags Section</div>,
}));
vi.mock('@/MockupTemplates.jsx', () => ({
  default: () => <div data-testid="mockup-templates">Mockup Templates</div>,
}));

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
  global.fetch = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
});

const NOTHING_CONFIGURED = { geminiKeyConfigured: false, hasTagLibrary: false, hasProductSize: false };

describe('OnboardingWizard — step 1 (Connect API key)', () => {
  it('shows the Connect Gemini form when no key is configured', () => {
    render(<OnboardingWizard setupStatus={NOTHING_CONFIGURED} />);

    expect(screen.getByText('Connect Gemini')).toBeInTheDocument();
    expect(screen.getByLabelText('Gemini API Key')).toBeInTheDocument();
  });

  it('shows the "already connected" state when geminiKeyConfigured is true', () => {
    render(<OnboardingWizard setupStatus={{ ...NOTHING_CONFIGURED, geminiKeyConfigured: true }} />);

    expect(screen.getByText('Gemini is connected')).toBeInTheDocument();
    expect(screen.queryByLabelText('Gemini API Key')).not.toBeInTheDocument();
  });

  it('connects a key via the API and notifies the parent', async () => {
    const addCalls = [];
    global.fetch = makeFetchQueue([
      ['/api/settings/api-keys', (url, opts) => {
        addCalls.push(JSON.parse(opts.body));
        return { ok: true, json: async () => ({ id: 1 }) };
      }],
    ]);
    const onSetupStatusChange = vi.fn();
    const user = userEvent.setup();
    render(<OnboardingWizard setupStatus={NOTHING_CONFIGURED} onSetupStatusChange={onSetupStatusChange} />);

    await user.type(screen.getByLabelText('Gemini API Key'), 'AIzaTestKey');
    await user.click(screen.getByText('Connect Gemini'));

    await waitFor(() => expect(addCalls).toHaveLength(1));
    expect(addCalls[0]).toEqual({ provider: 'gemini', key_value: 'AIzaTestKey', label: 'Gemini' });
    expect(onSetupStatusChange).toHaveBeenCalled();
    // Flips to the "connected" state immediately, without waiting for setupStatus to refetch.
    expect(await screen.findByText('Gemini is connected')).toBeInTheDocument();
  });
});

describe('OnboardingWizard — step navigation', () => {
  it('Back is disabled on the first step', () => {
    render(<OnboardingWizard setupStatus={NOTHING_CONFIGURED} />);

    expect(screen.getByText('Back')).toBeDisabled();
  });

  it('Next advances through tags and product-size steps, and Back returns', async () => {
    const user = userEvent.setup();
    render(<OnboardingWizard setupStatus={{ ...NOTHING_CONFIGURED, geminiKeyConfigured: true }} />);

    await user.click(screen.getByText('Next'));
    expect(screen.getByTestId('tags-section')).toBeInTheDocument();

    await user.click(screen.getByText('Next'));
    expect(screen.getByTestId('mockup-templates')).toBeInTheDocument();
    // Last step shows Finish instead of Next.
    expect(screen.getByText('Finish')).toBeInTheDocument();

    await user.click(screen.getByText('Back'));
    expect(screen.getByTestId('tags-section')).toBeInTheDocument();
  });
});

describe('OnboardingWizard — skip and finish', () => {
  it('"Skip setup" completes the wizard immediately from any step', async () => {
    const onComplete = vi.fn();
    const onSetupStatusChange = vi.fn();
    const user = userEvent.setup();
    render(
      <OnboardingWizard
        setupStatus={NOTHING_CONFIGURED}
        onComplete={onComplete}
        onSetupStatusChange={onSetupStatusChange}
      />
    );

    await user.click(screen.getByText('Skip setup'));

    expect(onSetupStatusChange).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });

  it('Finish on the last step completes the wizard', async () => {
    const onComplete = vi.fn();
    const onSetupStatusChange = vi.fn();
    const user = userEvent.setup();
    render(
      <OnboardingWizard
        setupStatus={{ ...NOTHING_CONFIGURED, geminiKeyConfigured: true }}
        onComplete={onComplete}
        onSetupStatusChange={onSetupStatusChange}
      />
    );

    await user.click(screen.getByText('Next'));
    await user.click(screen.getByText('Next'));
    await user.click(screen.getByText('Finish'));

    expect(onSetupStatusChange).toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalled();
  });
});
