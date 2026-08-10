# Pipeline Runner Attempts Mockup Composition for Sizes With No Template Configured

**Repo:** allocsys/proetsy
**Found:** functional correctness review, 2026-08-11
**Severity:** Low — wasted work and noisy failures, not a correctness break
**Status:** Open, not yet fixed

## Summary
`backend/lib/pipeline-runner.js`'s mockup-composer step defaults to attempting
*every* configured product size, instead of only the sizes that actually have a
mockup template configured. `backend/lib/listing-generator/index.js` already filters
for this correctly elsewhere in the same codebase, so the two modules are
inconsistent.

## Where it happens
`backend/lib/pipeline-runner.js`:

```js
const sizeKeys = options.sizeKeys ?? Object.keys(getProductSizes());
```

Compare with `backend/lib/listing-generator/index.js`:

```js
const availableSizes = Object.entries(productSizesConfig)
  .filter(([, size]) => Boolean(size.mockup_template))
  .map(([size_key, size]) => ({ size_key, ...size }));
```

## Impact
`composeMockup()` in `backend/lib/mockup-generator.js` throws a clear error for a
size with no `mockup_template` configured, and the per-size `try/catch` in
`pipeline-runner.js` handles that gracefully (it doesn't crash the job) — so this is
not a hard functional break. But every job with any untemplated product size
configured will:
- Attempt (and fail) mockup composition for that size on every run
- Produce a `perSize` failure entry with a "no mockup_template configured" error
  that a reviewer has to recognize as expected/ignorable rather than a real problem

## Suggested fix
Filter `Object.keys(getProductSizes())` down to sizes with a truthy
`mockup_template`, mirroring `listing-generator/index.js`'s `availableSizes` filter,
before using it as the default `sizeKeys` list in `pipeline-runner.js`.

## How this was found
Manual review of `backend/lib/pipeline-runner.js` alongside
`backend/lib/listing-generator/index.js` and `backend/lib/mockup-generator.js`,
as part of a broader functional correctness review.
