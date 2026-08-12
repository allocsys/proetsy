// Shared fetch utilities with friendly error handling
export function friendlyErrorMessage(err) {
  if (err.name === 'AbortError') return 'The request timed out. The server may be slow to respond — please try again.';
  if (err instanceof TypeError) return 'Could not reach the server — check your connection and try again.';
  return err.message;
}

export async function parseJsonResponse(res) {
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      res.ok
        ? 'The connection dropped before the server finished responding. Please try again.'
        : `Server error (HTTP ${res.status}). Please try again.`
    );
  }
  if (!res.ok) throw new Error(data.error || `Request failed (HTTP ${res.status})`);
  return data;
}

// API client functions
export const api = {
  health: () => fetch('/api/health').then(r => r.json()),
  setupStatus: () => fetch('/api/setup-status').then(r => r.json()),
  pipelineConfig: () => fetch('/api/config/pipeline').then(r => r.json()),
  settings: {
    get: () => fetch('/api/settings').then(r => r.json()),
    patch: (updates) => fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) }).then(r => r.json()),
  },
  shopConventions: {
    get: () => fetch('/api/config/shop-conventions').then(r => r.json()),
    patch: (payload) => fetch('/api/config/shop-conventions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
  },
  tags: {
    list: () => fetch('/api/tags').then(r => r.json()),
    bulk: (payload) => fetch('/api/tags/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
    csv: (csv) => fetch('/api/tags/csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) }).then(r => r.json()),
    delete: (id) => fetch(`/api/tags/${id}`, { method: 'DELETE' }),
    backfillPreview: () => fetch('/api/tags/backfill-categories?dry_run=true', { method: 'POST' }).then(r => r.json()),
    backfillApply: () => fetch('/api/tags/backfill-categories', { method: 'POST' }).then(r => r.json()),
  },
  trends: {
    list: () => fetch('/api/trends').then(r => r.json()),
    add: (payload) => fetch('/api/trends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
    delete: (id) => fetch(`/api/trends/${id}`, { method: 'DELETE' }),
    csv: (csv) => fetch('/api/trends/csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) }).then(r => r.json()),
  },
  apiKeys: {
    list: () => fetch('/api/settings/api-keys').then(r => r.json()),
    add: (payload) => fetch('/api/settings/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
    toggle: (id, enabled) => fetch(`/api/settings/api-keys/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }),
    delete: (id) => fetch(`/api/settings/api-keys/${id}`, { method: 'DELETE' }),
  },
  rateLimits: () => fetch('/api/llm/rate-limits').then(r => r.json()),
  jobs: {
    list: () => fetch('/api/jobs').then(r => r.json()),
    get: (id) => fetch(`/api/jobs/${id}`).then(r => r.json()),
    create: (payload) => fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
    createBulk: (payload) => fetch('/api/jobs/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
    runBatch: (payload) => fetch('/api/jobs/run-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    runModule: (id, payload) => fetch(`/api/jobs/${id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
    runImageAnalyzer: (id) => fetch(`/api/jobs/${id}/run/image-analyzer`, { method: 'POST' }).then(r => r.json()),
    patchManualNotes: (id, notes) => fetch(`/api/jobs/${id}/manual-notes`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) }).then(r => r.json()),
  },
  artworks: {
    upload: (formData) => fetch('/api/artworks/upload', { method: 'POST', body: formData }).then(r => r.json()),
    get: (id) => fetch(`/api/artworks/${id}`).then(r => r.json()),
  },
  listings: {
    get: (jobId) => fetch(`/api/jobs/${jobId}/listings`).then(r => r.json()),
    patch: (jobId, listingId, payload) => fetch(`/api/jobs/${jobId}/listings/${listingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
  },
  mockups: {
    get: (jobId) => fetch(`/api/jobs/${jobId}/mockups`).then(r => r.json()),
    setVariant: (jobId, mockupId, variant) => fetch(`/api/jobs/${jobId}/mockups/${mockupId}/variant`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant }) }).then(r => r.json()),
    templates: {
      list: () => fetch('/api/mockup-templates').then(r => r.json()),
      categories: () => fetch('/api/mockup-templates/categories').then(r => r.json()),
      scan: (folder) => fetch(`/api/mockup-templates/scan?folder=${encodeURIComponent(folder)}`).then(r => r.json()),
      add: (payload) => fetch('/api/mockup-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
      delete: (sizeKey) => fetch(`/api/mockup-templates/${encodeURIComponent(sizeKey)}`, { method: 'DELETE' }),
    },
  },
  prompts: {
    list: (orientation) => fetch(`/api/prompts?orientation=${encodeURIComponent(orientation)}`).then(r => r.json()),
    generate: (payload) => fetch('/api/prompts/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
  },
  tasteFilter: {
    import: (formData) => fetch('/api/taste-filter/import', { method: 'POST', body: formData }).then(r => r.json()),
    label: (payload) => fetch('/api/taste-filter/label', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }),
    promote: (payload) => fetch('/api/taste-filter/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(r => r.json()),
    recompute: () => fetch('/api/taste-filter/recompute', { method: 'POST' }).then(r => r.json()),
    centroids: () => fetch('/api/taste-filter/centroids').then(r => r.json()),
    stats: () => fetch('/api/taste-filter/stats').then(r => r.json()),
    watchStatus: () => fetch('/api/taste-filter/watch-status').then(r => r.json()),
  },
  config: {
    export: () => fetch('/api/config/export').then(r => r.json()),
    import: (bundle) => fetch('/api/config/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) }).then(r => r.json()),
  },
};
