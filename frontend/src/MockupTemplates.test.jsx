import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MockupTemplates from './MockupTemplates.jsx';

const SCAN_FILE_FLAT = {
  filename: 'frame-8x10.png',
  path: '/templates/frame-8x10.png',
  width: 2400,
  height: 3000,
  kind: 'flat',
  alreadyAssignedTo: null,
};
const SCAN_FILE_PSD = {
  filename: 'mug-white.psd',
  path: '/templates/mug-white.psd',
  width: 1200,
  height: 1200,
  kind: 'psd',
  alreadyAssignedTo: null,
};
const SCAN_FILE_ASSIGNED = {
  filename: 'canvas-12x16.png',
  path: '/templates/canvas-12x16.png',
  width: 3600,
  height: 4800,
  kind: 'flat',
  alreadyAssignedTo: '12x16-portrait',
};

const CONFIGURED_ROW = {
  size_key: '8x10-portrait',
  dimensions: '8x10',
  dpi: 300,
  orientation: 'portrait',
  mockup_template_path: 'frame-8x10.png',
  placement_layer: null,
  category: null,
  preview_url: '/mockup-template-previews/abc123.png',
};

beforeEach(() => {
  global.fetch = vi.fn((url) => {
    if (url === '/api/settings') {
      return Promise.resolve({ ok: true, json: async () => ({ mockup_templates_dir: '/templates' }) });
    }
    if (url === '/api/mockup-templates') {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
    if (url === '/api/mockup-templates/categories') {
      return Promise.resolve({ ok: true, json: async () => [] });
    }
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
});

function makeFetchQueue(map) {
  return vi.fn((url, opts) => {
    const entry = map.find(([matcher]) =>
      typeof matcher === 'string' ? url === matcher : matcher.test(url)
    );
    if (entry) return Promise.resolve(entry[1](url, opts));
    return Promise.resolve({ ok: true, json: async () => ({}) });
  });
}

describe('MockupTemplates — folder field', () => {
  it('loads the saved folder from settings and saves an edit on blur', async () => {
    render(<MockupTemplates />);
    const input = await screen.findByDisplayValue('/templates');

    fetch.mockClear();
    const user = userEvent.setup();
    await user.clear(input);
    await user.type(input, '/new/folder');
    await user.tab();

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/settings',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ mockup_templates_dir: '/new/folder' }),
        })
      );
    });
  });
});

describe('MockupTemplates — scan and select', () => {
  it('scans the folder and renders a card per file, with an already-used badge where set', async () => {
    global.fetch = makeFetchQueue([
      ['/api/settings', () => ({ ok: true, json: async () => ({ mockup_templates_dir: '/templates' }) })],
      ['/api/mockup-templates', () => ({ ok: true, json: async () => [] })],
      [/\/api\/mockup-templates\/scan/, () => ({
        ok: true,
        json: async () => ({ folder: '/templates', files: [SCAN_FILE_FLAT, SCAN_FILE_PSD, SCAN_FILE_ASSIGNED] }),
      })],
    ]);
    const user = userEvent.setup();
    render(<MockupTemplates />);
    await screen.findByDisplayValue('/templates');

    await user.click(screen.getByText('Scan folder'));

    expect(await screen.findByText('frame-8x10.png')).toBeInTheDocument();
    expect(screen.getByText('mug-white.psd')).toBeInTheDocument();
    expect(screen.getByText('canvas-12x16.png')).toBeInTheDocument();
    // The already-used text is in a <span> inside a <p>; just match the value.
    expect(screen.getByText('12x16-portrait')).toBeInTheDocument();
  });

  it('shows a size-key (and, for PSDs, placement-layer) field only once a card is checked', async () => {
    global.fetch = makeFetchQueue([
      ['/api/settings', () => ({ ok: true, json: async () => ({ mockup_templates_dir: '/templates' }) })],
      ['/api/mockup-templates', () => ({ ok: true, json: async () => [] })],
      [/\/api\/mockup-templates\/scan/, () => ({
        ok: true,
        json: async () => ({ folder: '/templates', files: [SCAN_FILE_PSD] }),
      })],
    ]);
    const user = userEvent.setup();
    render(<MockupTemplates />);
    await screen.findByDisplayValue('/templates');
    await user.click(screen.getByText('Scan folder'));
    await screen.findByText('mug-white.psd');

    expect(screen.queryByText('Placement layer')).not.toBeInTheDocument();

    await user.click(screen.getByRole('checkbox'));

    expect(screen.getByText('Placement layer')).toBeInTheDocument();
    expect(screen.getByDisplayValue('mug-white')).toBeInTheDocument(); // slugified default size key
  });
});

describe('MockupTemplates — bulk assign', () => {
  it('submits one POST /api/mockup-templates call per checked file, including the bulk category', async () => {
    global.fetch = makeFetchQueue([
      ['/api/settings', () => ({ ok: true, json: async () => ({ mockup_templates_dir: '/templates' }) })],
      ['/api/mockup-templates', () => ({ ok: true, json: async () => [] })],
      ['/api/mockup-templates/categories', () => ({ ok: true, json: async () => ['mug'] })],
      [/\/api\/mockup-templates\/scan/, () => ({
        ok: true,
        json: async () => ({ folder: '/templates', files: [SCAN_FILE_FLAT, SCAN_FILE_PSD] }),
      })],
    ]);
    const user = userEvent.setup();
    render(<MockupTemplates />);
    await screen.findByDisplayValue('/templates');
    await user.click(screen.getByText('Scan folder'));
    await screen.findByText('frame-8x10.png');

    const checkboxes = screen.getAllByRole('checkbox');
    await user.click(checkboxes[0]);
    await user.click(checkboxes[1]);

    await user.type(screen.getByPlaceholderText('e.g. bedroom'), 'mug');

    const postCalls = [];
    global.fetch = makeFetchQueue([
      ['/api/mockup-templates', (url, opts) => {
        if (opts?.method === 'POST') {
          postCalls.push(JSON.parse(opts.body));
          return { ok: true, json: async () => ({ size_key: 'ok' }) };
        }
        return { ok: true, json: async () => [] };
      }],
      [/\/api\/mockup-templates\/scan/, () => ({
        ok: true,
        json: async () => ({ folder: '/templates', files: [SCAN_FILE_FLAT, SCAN_FILE_PSD] }),
      })],
    ]);

    await user.click(screen.getByRole('button', { name: /Assign 2/ }));

    await waitFor(() => expect(postCalls).toHaveLength(2));
    expect(postCalls.map((c) => c.mockup_template).sort()).toEqual(['frame-8x10.png', 'mug-white.psd'].sort());
    expect(postCalls.every((c) => c.category === 'mug')).toBe(true);
  });
});

describe('MockupTemplates — Electron Browse button (Rollout step 5)', () => {
  afterEach(() => {
    delete window.mockupTemplatesAPI;
  });

  it('does not render a Browse button when window.mockupTemplatesAPI is absent (browser path)', async () => {
    render(<MockupTemplates />);
    await screen.findByDisplayValue('/templates');

    expect(screen.queryByText('Browse…')).not.toBeInTheDocument();
  });

  it('renders a Browse button that fills and saves the folder field when window.mockupTemplatesAPI is present (Electron path)', async () => {
    window.mockupTemplatesAPI = { selectFolder: vi.fn().mockResolvedValue('/Users/me/mockup-packs') };
    const user = userEvent.setup();
    render(<MockupTemplates />);
    await screen.findByDisplayValue('/templates');

    await user.click(screen.getByText('Browse…'));

    expect(window.mockupTemplatesAPI.selectFolder).toHaveBeenCalled();
    expect(await screen.findByDisplayValue('/Users/me/mockup-packs')).toBeInTheDocument();
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/settings',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ mockup_templates_dir: '/Users/me/mockup-packs' }),
        })
      );
    });
  });

  it('leaves the folder field untouched when the user cancels the native dialog', async () => {
    window.mockupTemplatesAPI = { selectFolder: vi.fn().mockResolvedValue(null) };
    const user = userEvent.setup();
    render(<MockupTemplates />);
    await screen.findByDisplayValue('/templates');

    fetch.mockClear();
    await user.click(screen.getByText('Browse…'));

    expect(window.mockupTemplatesAPI.selectFolder).toHaveBeenCalled();
    expect(screen.getByDisplayValue('/templates')).toBeInTheDocument();
    expect(fetch).not.toHaveBeenCalledWith('/api/settings', expect.objectContaining({ method: 'PATCH' }));
  });
});

describe('MockupTemplates — configured templates', () => {
  it('renders configured templates and removes one on click', async () => {
    global.fetch = makeFetchQueue([
      ['/api/settings', () => ({ ok: true, json: async () => ({ mockup_templates_dir: '/templates' }) })],
      ['/api/mockup-templates', () => ({ ok: true, json: async () => [CONFIGURED_ROW] })],
      [/\/api\/mockup-templates\/8x10-portrait/, () => ({ ok: true, status: 204, json: async () => ({}) })],
    ]);
    const user = userEvent.setup();
    render(<MockupTemplates />);

    expect(await screen.findByText('8x10-portrait')).toBeInTheDocument();

    await user.click(screen.getByText('Remove'));

    // Removal feedback is via toast, not inline DOM text.
    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/mockup-templates/8x10-portrait',
        expect.objectContaining({ method: 'DELETE' })
      );
    });
  });

  it('saves an inline edit to a configured template via the upsert route', async () => {
    global.fetch = makeFetchQueue([
      ['/api/settings', () => ({ ok: true, json: async () => ({ mockup_templates_dir: '/templates' }) })],
      ['/api/mockup-templates', (url, opts) => {
        if (opts?.method === 'POST') return { ok: true, json: async () => ({ ...CONFIGURED_ROW, dpi: 150 }) };
        return { ok: true, json: async () => [CONFIGURED_ROW] };
      }],
    ]);
    const user = userEvent.setup();
    render(<MockupTemplates />);
    await screen.findByText('8x10-portrait');

    const dpiInput = screen.getByDisplayValue('300');
    await user.clear(dpiInput);
    await user.type(dpiInput, '150');
    await user.click(screen.getByText('Save'));

    await waitFor(() => {
      expect(fetch).toHaveBeenCalledWith(
        '/api/mockup-templates',
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('renders a Category field for a configured template and includes it in the save payload', async () => {
    const postCalls = [];
    global.fetch = makeFetchQueue([
      ['/api/settings', () => ({ ok: true, json: async () => ({ mockup_templates_dir: '/templates' }) })],
      ['/api/mockup-templates', (url, opts) => {
        if (opts?.method === 'POST') {
          postCalls.push(JSON.parse(opts.body));
          return { ok: true, json: async () => ({ ...CONFIGURED_ROW, category: 'bedroom' }) };
        }
        return { ok: true, json: async () => [CONFIGURED_ROW] };
      }],
      ['/api/mockup-templates/categories', () => ({ ok: true, json: async () => ['bedroom'] })],
    ]);
    const user = userEvent.setup();
    render(<MockupTemplates />);
    await screen.findByText('8x10-portrait');

    const categoryInput = screen.getAllByDisplayValue('')[0];
    await user.type(categoryInput, 'bedroom');
    await user.click(screen.getByText('Save'));

    await waitFor(() => expect(postCalls).toHaveLength(1));
    expect(postCalls[0].category).toBe('bedroom');
  });
});
