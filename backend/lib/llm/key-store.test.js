import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// db/init.js reads DB_PATH at first getDb() call and caches a singleton connection, so
// each test gets its own fresh DB file via vi.resetModules() + a new DB_PATH before
// import -- same dynamic-import pattern used by rate-limits.test.js.
let tmpRoot;

beforeAll(() => {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'proetsy-key-store-'));
});

afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

async function freshKeyStore() {
  vi.resetModules();
  process.env.DB_PATH = path.join(tmpRoot, `${Math.random().toString(36).slice(2)}.db`);
  return import('./key-store.js');
}

const VALID_KEY = 'AIzaSyD-fake-key-1234567890';

describe('getKeysForProvider', () => {
  it('returns an empty array for a provider with no DB rows', async () => {
    const { getKeysForProvider } = await freshKeyStore();
    expect(getKeysForProvider('mystery-provider')).toEqual([]);
  });

  it('returns enabled DB-backed keys', async () => {
    const { getKeysForProvider, addKey } = await freshKeyStore();
    addKey({ provider: 'gemini', key_value: VALID_KEY });
    expect(getKeysForProvider('gemini')).toEqual([VALID_KEY]);
  });

  it('returns DB keys oldest-first and excludes disabled rows', async () => {
    const { getKeysForProvider, addKey, setKeyEnabled } = await freshKeyStore();
    const first = addKey({ provider: 'gemini', key_value: `${VALID_KEY}-a` });
    addKey({ provider: 'gemini', key_value: `${VALID_KEY}-b` });
    setKeyEnabled(first.id, false);

    expect(getKeysForProvider('gemini')).toEqual([`${VALID_KEY}-b`]);
  });

  it('returns an empty array once every DB row for that provider is disabled', async () => {
    const { getKeysForProvider, addKey, setKeyEnabled } = await freshKeyStore();
    const key = addKey({ provider: 'gemini', key_value: VALID_KEY });
    setKeyEnabled(key.id, false);

    expect(getKeysForProvider('gemini')).toEqual([]);
  });
});

describe('addKey', () => {
  it('requires provider and key_value', async () => {
    const { addKey } = await freshKeyStore();
    expect(() => addKey({ provider: 'gemini', key_value: '' })).toThrow(/required/);
    expect(() => addKey({ provider: '', key_value: VALID_KEY })).toThrow(/required/);
  });

  it('rejects a key that is too short to be plausible', async () => {
    const { addKey } = await freshKeyStore();
    expect(() => addKey({ provider: 'gemini', key_value: 'short' })).toThrow(/too short/);
  });

  it('rejects a key with leading/trailing whitespace or embedded whitespace', async () => {
    const { addKey } = await freshKeyStore();
    expect(() => addKey({ provider: 'gemini', key_value: ` ${VALID_KEY}` })).toThrow(/whitespace/);
    expect(() => addKey({ provider: 'gemini', key_value: `${VALID_KEY} ` })).toThrow(/whitespace/);
    expect(() => addKey({ provider: 'gemini', key_value: 'abcd efgh ijkl mnop' })).toThrow(/whitespace/);
  });

  it('returns a masked key, never the full value', async () => {
    const { addKey } = await freshKeyStore();
    const key = addKey({ provider: 'gemini', key_value: VALID_KEY, label: 'primary' });

    expect(key.provider).toBe('gemini');
    expect(key.label).toBe('primary');
    expect(key.enabled).toBe(true);
    expect(key.maskedKey.endsWith(VALID_KEY.slice(-4))).toBe(true);
    expect(key.maskedKey).not.toContain(VALID_KEY.slice(0, -4));
    expect(JSON.stringify(key)).not.toContain(VALID_KEY);
  });

  it('defaults label to null when omitted', async () => {
    const { addKey } = await freshKeyStore();
    const key = addKey({ provider: 'gemini', key_value: VALID_KEY });
    expect(key.label).toBeNull();
  });
});

describe('listKeysMasked', () => {
  it('never includes the full key_value anywhere in the response', async () => {
    const { addKey, listKeysMasked } = await freshKeyStore();
    addKey({ provider: 'gemini', key_value: VALID_KEY });
    addKey({ provider: 'claude', key_value: `${VALID_KEY}-claude` });

    const keys = listKeysMasked();
    expect(keys).toHaveLength(2);
    expect(JSON.stringify(keys)).not.toContain(VALID_KEY);
    for (const key of keys) {
      expect(Object.keys(key)).not.toContain('key_value');
    }
  });

  it('orders by provider then id', async () => {
    const { addKey, listKeysMasked } = await freshKeyStore();
    addKey({ provider: 'gemini', key_value: `${VALID_KEY}-1` });
    addKey({ provider: 'claude', key_value: `${VALID_KEY}-2` });
    addKey({ provider: 'gemini', key_value: `${VALID_KEY}-3` });

    const keys = listKeysMasked();
    expect(keys.map((k) => k.provider)).toEqual(['claude', 'gemini', 'gemini']);
  });

  it('returns an empty array when nothing has been added', async () => {
    const { listKeysMasked } = await freshKeyStore();
    expect(listKeysMasked()).toEqual([]);
  });
});

describe('setKeyEnabled', () => {
  it('toggles enabled and is reflected in listKeysMasked', async () => {
    const { addKey, setKeyEnabled, listKeysMasked } = await freshKeyStore();
    const key = addKey({ provider: 'gemini', key_value: VALID_KEY });

    expect(setKeyEnabled(key.id, false)).toBe(true);
    expect(listKeysMasked().find((k) => k.id === key.id).enabled).toBe(false);

    expect(setKeyEnabled(key.id, true)).toBe(true);
    expect(listKeysMasked().find((k) => k.id === key.id).enabled).toBe(true);
  });

  it('returns false for a nonexistent id', async () => {
    const { setKeyEnabled } = await freshKeyStore();
    expect(setKeyEnabled(999, true)).toBe(false);
  });
});

describe('deleteKey', () => {
  it('removes the row so it no longer appears in listKeysMasked', async () => {
    const { addKey, deleteKey, listKeysMasked } = await freshKeyStore();
    const key = addKey({ provider: 'gemini', key_value: VALID_KEY });

    expect(deleteKey(key.id)).toBe(true);
    expect(listKeysMasked()).toEqual([]);
  });

  it('returns false for a nonexistent id', async () => {
    const { deleteKey } = await freshKeyStore();
    expect(deleteKey(999)).toBe(false);
  });
});
