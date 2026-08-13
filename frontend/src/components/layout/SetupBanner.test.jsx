import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SetupBanner from './SetupBanner.jsx';

// Field names below intentionally mirror GET /api/setup-status's real response
// shape (backend/server.js / server.core-routes.test.js) -- geminiKeyConfigured,
// hasTagLibrary, hasProductSize -- not display-friendly guesses. This is the
// contract SetupBanner must read from; see the regression this file guards
// against (checks were previously reading geminiApiKey/tagLibraryReady/
// productSizesReady, none of which the backend has ever sent).
const READY = {
  geminiKeyConfigured: true,
  hasTagLibrary: true,
  hasProductSize: true,
};

describe('SetupBanner', () => {
  it('treats a null setupStatus (not yet loaded) as incomplete', () => {
    // isSetupIncomplete() explicitly returns true for a falsy setupStatus --
    // an unknown state is treated as "show the banner", not hidden.
    render(<SetupBanner setupStatus={null} />);
    expect(screen.getByText('Setup Incomplete')).toBeInTheDocument();
    expect(screen.getAllByText('Action Required')).toHaveLength(3);
  });

  it('renders nothing once every real backend field is true', () => {
    const { container } = render(<SetupBanner setupStatus={READY} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('shows all three items as Action Required on a fresh setup-status response', () => {
    render(
      <SetupBanner
        setupStatus={{ geminiKeyConfigured: false, hasTagLibrary: false, hasProductSize: false }}
      />
    );

    expect(screen.getByText('Setup Incomplete')).toBeInTheDocument();
    expect(screen.getByText('3 items need action')).toBeInTheDocument();
    expect(screen.getByText('Gemini API Key')).toBeInTheDocument();
    expect(screen.getByText('Tag Library')).toBeInTheDocument();
    expect(screen.getByText('Product Sizes')).toBeInTheDocument();
    expect(screen.getAllByText('Action Required')).toHaveLength(3);
  });

  it('marks only the still-incomplete items once some checks pass', () => {
    render(
      <SetupBanner
        setupStatus={{ ...READY, hasProductSize: false }}
      />
    );

    expect(screen.getByText('1 item need action')).toBeInTheDocument();
    expect(screen.getAllByText('Ready')).toHaveLength(2);
    expect(screen.getAllByText('Action Required')).toHaveLength(1);
  });

  it('does not regress to the old (wrong) field names', () => {
    // If SetupBanner ever reads geminiApiKey/tagLibraryReady/productSizesReady
    // again instead of the real backend fields, this setupStatus -- which is
    // fully "ready" under the real contract but would be all-false under the
    // old one -- would incorrectly render as incomplete.
    render(<SetupBanner setupStatus={READY} />);
    expect(screen.queryByText('Setup Incomplete')).not.toBeInTheDocument();
  });
});
