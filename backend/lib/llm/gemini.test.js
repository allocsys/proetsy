import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// gemini.js reads GEMINI_API_KEYS / GEMINI_MODELS / GEMINI_IMAGE_MODEL as module-level
// constants at import time, and keeps keyStartIndex as module-level state — so each test
// gets its own fresh module via vi.resetModules() + dynamic import, same pattern as
// queue.test.js/rate-limits.test.js. rate-limits.js and queue.js are mocked out entirely:
// this suite is about the cascade/loop-order/error-shape logic in gemini.js itself, not
// the real cooldown persistence (rate-limits.test.js) or pacing (queue.test.js) behavior,
// which already have their own dedicated suites.
function mockResponse({ ok = true, status = 200, jsonBody, textBody, retryAfterHeader } = {}) {
  const bodyText = textBody !== undefined ? textBody : JSON.stringify(jsonBody ?? {});
  return {
    ok,
    status,
    headers: { get: (name) => (name.toLowerCase() === 'retry-after' ? retryAfterHeader ?? null : null) },
    text: async () => bodyText,
    json: async () => JSON.parse(bodyText),
  };
}

function textResponseBody(text) {
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

function imageResponseBody(base64Data, mimeType = 'image/png') {
  return { candidates: [{ content: { parts: [{ inlineData: { data: base64Data, mimeType } }] } }] };
}

let tmpRoot;
let tmpImagePath;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-gemini-'));
  tmpImagePath = path.join(tmpRoot, 'artwork.png');
  fs.writeFileSync(tmpImagePath, Buffer.from('not a real png, just bytes'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

let isInCooldown;
let getCooldownUntil;
let recordFailure;
let recordSuccess;
let withRequestSlot;

async function freshGemini({ keys = 'key1,key2', models = 'model-a,model-b', imageModel } = {}) {
  vi.resetModules();
  process.env.GEMINI_API_KEYS = keys;
  process.env.GEMINI_MODELS = models;
  if (imageModel) process.env.GEMINI_IMAGE_MODEL = imageModel;
  else delete process.env.GEMINI_IMAGE_MODEL;

  isInCooldown = vi.fn(() => false);
  getCooldownUntil = vi.fn(() => 0);
  recordFailure = vi.fn();
  recordSuccess = vi.fn();
  withRequestSlot = vi.fn((keyIndex, fn) => fn());

  vi.doMock('./rate-limits.js', () => ({ isInCooldown, getCooldownUntil, recordFailure, recordSuccess }));
  vi.doMock('./queue.js', () => ({ withRequestSlot }));

  global.fetch = vi.fn();
  return import('./gemini.js');
}

afterEach(() => {
  vi.doUnmock('./rate-limits.js');
  vi.doUnmock('./queue.js');
  vi.restoreAllMocks();
});

describe('generateText — happy path', () => {
  it('calls the first key/first model and returns { text, provider, model }', async () => {
    const { generateText } = await freshGemini();
    global.fetch.mockResolvedValueOnce(mockResponse({ jsonBody: textResponseBody('hello world') }));

    const result = await generateText('a prompt');

    expect(result).toEqual({ text: 'hello world', provider: 'gemini', model: 'model-a' });
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url] = global.fetch.mock.calls[0];
    expect(url).toContain('/models/model-a:generateContent');
    expect(url).toContain('key=key1');
    expect(recordSuccess).toHaveBeenCalledWith(0, 'model-a');
  });

  it('options.model pins a single model, bypassing the GEMINI_MODELS cascade list', async () => {
    const { generateText } = await freshGemini();
    global.fetch.mockResolvedValueOnce(mockResponse({ jsonBody: textResponseBody('pinned') }));

    const result = await generateText('a prompt', { model: 'gemini-3-pro' });

    expect(result.model).toBe('gemini-3-pro');
    expect(global.fetch.mock.calls[0][0]).toContain('/models/gemini-3-pro:generateContent');
  });
});

describe('cascade loop order — models before keys', () => {
  it('on a 429, retries the next model on the SAME key before moving to the next key', async () => {
    const { generateText } = await freshGemini({ keys: 'key1,key2', models: 'model-a,model-b' });
    global.fetch
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 429, jsonBody: {} })) // key1/model-a
      .mockResolvedValueOnce(mockResponse({ jsonBody: textResponseBody('recovered') })); // key1/model-b

    const result = await generateText('a prompt');

    expect(result).toEqual({ text: 'recovered', provider: 'gemini', model: 'model-b' });
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(global.fetch.mock.calls[0][0]).toContain('key=key1');
    expect(global.fetch.mock.calls[1][0]).toContain('key=key1'); // still key1, model-b
    expect(recordFailure).toHaveBeenCalledWith(0, 'model-a', expect.any(Object));
    expect(recordSuccess).toHaveBeenCalledWith(0, 'model-b');
  });

  it('only moves to the next key once every model on the current key has failed', async () => {
    const { generateText } = await freshGemini({ keys: 'key1,key2', models: 'model-a,model-b' });
    global.fetch
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 429, jsonBody: {} })) // key1/model-a
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 429, jsonBody: {} })) // key1/model-b
      .mockResolvedValueOnce(mockResponse({ jsonBody: textResponseBody('from key2') })); // key2/model-a

    const result = await generateText('a prompt');

    expect(result.text).toBe('from key2');
    expect(global.fetch).toHaveBeenCalledTimes(3);
    expect(global.fetch.mock.calls[0][0]).toContain('key=key1');
    expect(global.fetch.mock.calls[1][0]).toContain('key=key1');
    expect(global.fetch.mock.calls[2][0]).toContain('key=key2');
    expect(global.fetch.mock.calls[2][0]).toContain('/models/model-a:'); // restarts from top of model list
  });

  it('fails clearly once every key x model combination has 429\u2019d', async () => {
    const { generateText } = await freshGemini({ keys: 'key1,key2', models: 'model-a,model-b' });
    global.fetch.mockResolvedValue(mockResponse({ ok: false, status: 429, jsonBody: {} }));

    await expect(generateText('a prompt')).rejects.toThrow(/exhausted/i);
    expect(global.fetch).toHaveBeenCalledTimes(4); // 2 keys x 2 models
  });
});

describe('cooldown skipping', () => {
  it('skips a (key, model) pair that isInCooldown reports as limited, with no network call for it', async () => {
    const { generateText } = await freshGemini({ keys: 'key1,key2', models: 'model-a' });
    isInCooldown.mockImplementation((keyIndex, model) => keyIndex === 0 && model === 'model-a');
    global.fetch.mockResolvedValueOnce(mockResponse({ jsonBody: textResponseBody('from key2') }));

    const result = await generateText('a prompt');

    expect(result.text).toBe('from key2');
    expect(global.fetch).toHaveBeenCalledTimes(1); // key1/model-a skipped entirely
    expect(global.fetch.mock.calls[0][0]).toContain('key=key2');
  });

  it('fails with a distinct "in cooldown" message (not the generic exhaustion message) when every pair is already limited', async () => {
    const { generateText } = await freshGemini({ keys: 'key1,key2', models: 'model-a' });
    isInCooldown.mockReturnValue(true);
    getCooldownUntil.mockReturnValue(Date.now() + 45_000);

    await expect(generateText('a prompt')).rejects.toThrow(/currently in.*rate-limit cooldown/i);
    expect(global.fetch).not.toHaveBeenCalled(); // no network calls at all
  });
});

describe('non-retryable errors', () => {
  it('rethrows immediately on a non-429 error without trying other keys/models', async () => {
    const { generateText } = await freshGemini({ keys: 'key1,key2', models: 'model-a,model-b' });
    global.fetch.mockResolvedValueOnce(mockResponse({ ok: false, status: 400, textBody: 'bad request' }));

    await expect(generateText('a prompt')).rejects.toThrow(/400/);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(recordFailure).not.toHaveBeenCalled(); // 400s aren't rate-limit cooldown material
  });
});

describe('retry-delay extraction feeding recordFailure', () => {
  it('passes a Retry-After header (seconds) through as retryDelayMs', async () => {
    const { generateText } = await freshGemini({ keys: 'key1', models: 'model-a,model-b' });
    global.fetch
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 429, jsonBody: {}, retryAfterHeader: '30' }))
      .mockResolvedValueOnce(mockResponse({ jsonBody: textResponseBody('ok') }));

    await generateText('a prompt');

    expect(recordFailure).toHaveBeenCalledWith(0, 'model-a', expect.objectContaining({ retryDelayMs: 30_000 }));
  });

  it('falls back to null retryDelayMs when neither header nor body retryInfo is present', async () => {
    const { generateText } = await freshGemini({ keys: 'key1', models: 'model-a,model-b' });
    global.fetch
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 429, jsonBody: { error: { details: [] } } }))
      .mockResolvedValueOnce(mockResponse({ jsonBody: textResponseBody('ok') }));

    await generateText('a prompt');

    expect(recordFailure).toHaveBeenCalledWith(0, 'model-a', expect.objectContaining({ retryDelayMs: null }));
  });
});

describe('generateVision', () => {
  it('reads the image file and sends it as inlineData base64 alongside the prompt', async () => {
    const { generateVision } = await freshGemini();
    global.fetch.mockResolvedValueOnce(mockResponse({ jsonBody: textResponseBody('a fox') }));

    const result = await generateVision('describe this', tmpImagePath);

    expect(result.text).toBe('a fox');
    const [, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    const imagePart = body.contents[0].parts.find((p) => p.inlineData);
    expect(imagePart.inlineData.mimeType).toBe('image/png');
    expect(Buffer.from(imagePart.inlineData.data, 'base64').toString()).toBe('not a real png, just bytes');
  });

  it('throws when the model response has no text content (e.g. blocked by safety filters)', async () => {
    const { generateVision } = await freshGemini({ keys: 'key1', models: 'model-a' });
    global.fetch.mockResolvedValue(
      mockResponse({ jsonBody: { candidates: [{ content: { parts: [] } }], promptFeedback: { blockReason: 'SAFETY' } } })
    );

    await expect(generateVision('describe this', tmpImagePath)).rejects.toThrow(/no text content/i);
  });
});

describe('generateImage', () => {
  it('pins DEFAULT_IMAGE_MODEL rather than walking the text GEMINI_MODELS cascade', async () => {
    const { generateImage } = await freshGemini({ keys: 'key1', models: 'text-model-a,text-model-b' });
    global.fetch.mockResolvedValueOnce(mockResponse({ jsonBody: imageResponseBody('YmFzZTY0') }));

    const result = await generateImage('extend this canvas', tmpImagePath);

    expect(result).toEqual({ data: 'YmFzZTY0', mimeType: 'image/png', provider: 'gemini', model: 'gemini-3.1-flash-image' });
    expect(global.fetch.mock.calls[0][0]).toContain('/models/gemini-3.1-flash-image:generateContent');
  });

  it('honors GEMINI_IMAGE_MODEL as an override for the pinned default', async () => {
    const { generateImage } = await freshGemini({ keys: 'key1', models: 'text-model-a', imageModel: 'gemini-3-pro-image' });
    global.fetch.mockResolvedValueOnce(mockResponse({ jsonBody: imageResponseBody('YWJj') }));

    const result = await generateImage('extend this canvas', tmpImagePath);
    expect(result.model).toBe('gemini-3-pro-image');
  });

  it('works without an imagePath (pure text-to-image)', async () => {
    const { generateImage } = await freshGemini({ keys: 'key1', models: 'text-model-a' });
    global.fetch.mockResolvedValueOnce(mockResponse({ jsonBody: imageResponseBody('eHl6') }));

    const result = await generateImage('a plain generated image');

    const [, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.contents[0].parts).toEqual([{ text: 'a plain generated image' }]);
    expect(result.data).toBe('eHl6');
  });

  it('sets responseModalities: [IMAGE] on the request', async () => {
    const { generateImage } = await freshGemini({ keys: 'key1', models: 'text-model-a' });
    global.fetch.mockResolvedValueOnce(mockResponse({ jsonBody: imageResponseBody('eHl6') }));

    await generateImage('a plain generated image');

    const [, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.generationConfig.responseModalities).toEqual(['IMAGE']);
  });

  it('throws when the model response has no image content', async () => {
    const { generateImage } = await freshGemini({ keys: 'key1', models: 'text-model-a' });
    global.fetch.mockResolvedValue(
      mockResponse({ jsonBody: { candidates: [{ content: { parts: [] } }], promptFeedback: {} } })
    );

    await expect(generateImage('extend this canvas', tmpImagePath)).rejects.toThrow(/no image content/i);
  });
});

describe('no keys / no models configured', () => {
  it('throws a clear setup error when GEMINI_API_KEYS is empty', async () => {
    const { generateText } = await freshGemini({ keys: '' });
    await expect(generateText('a prompt')).rejects.toThrow(/No Gemini API keys configured/);
  });

  it('throws a clear setup error when GEMINI_MODELS resolves to zero models and no options.model is given', async () => {
    // A blank env var falls back to gemini.js's own built-in default list (`|| '...'`),
    // so to actually exercise the "zero models" branch the var must be non-empty but
    // filter(Boolean)-out to nothing — e.g. stray commas/whitespace only.
    const { generateText } = await freshGemini({ keys: 'key1', models: ' , ,' });
    await expect(generateText('a prompt')).rejects.toThrow(/No Gemini models configured/);
  });
});

describe('structured JSON output option', () => {
  it('sets responseMimeType when options.json is true', async () => {
    const { generateText } = await freshGemini({ keys: 'key1', models: 'model-a' });
    global.fetch.mockResolvedValueOnce(mockResponse({ jsonBody: textResponseBody('{"ok":true}') }));

    await generateText('a prompt', { json: true });

    const [, init] = global.fetch.mock.calls[0];
    const body = JSON.parse(init.body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
  });
});
