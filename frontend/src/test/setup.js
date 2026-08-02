import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
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
// jsdom 25's File implementation doesn't have .text(), a real standard browser API
// that App.jsx's CSV-import flow relies on (file.text()). Polyfill it via FileReader,
// which jsdom does implement, so the production code doesn't need any special-casing
// for the test environment.
if (!('text' in File.prototype)) {
  File.prototype.text = function () {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsText(this);
    });
  };
}

beforeEach(() => {
  if (navigator.clipboard) {
    navigator.clipboard.writeText = vi.fn();
  } else {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: vi.fn() },
      configurable: true,
    });
  }
});
