import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount components between tests (React Testing Library doesn't do this
// automatically outside of a Jest/Vitest global-setup convention).
afterEach(() => {
  cleanup();
});

// navigator.clipboard isn't implemented in jsdom; PromptHelper/TasteFilter call
// navigator.clipboard.writeText, so stub it so those code paths don't throw.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn() },
    configurable: true,
  });
}
