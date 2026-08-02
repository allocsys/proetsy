import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount components between tests (React Testing Library doesn't do this
// automatically outside of a Jest/Vitest global-setup convention).
afterEach(() => {
  cleanup();
});

// PromptHelper/JobListingReview/TasteFilter call navigator.clipboard.writeText and
// tests assert on it as a spy. Some jsdom versions ship their own real (non-spy)
// Clipboard implementation, so this must overwrite unconditionally rather than only
// when navigator.clipboard is missing -- otherwise the real implementation wins and
// every clipboard assertion fails with "not a spy or a call to a spy". Redefined
// fresh before each test so a writeText call in one test doesn't leak call history
// into the next.
beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn() },
    configurable: true,
  });
});
