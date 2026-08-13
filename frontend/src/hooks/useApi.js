// Shared fetch utilities with friendly error handling
export function friendlyErrorMessage(err) {
  if (err.name === 'AbortError') return 'The request timed out. The server may be slow to respond — please try again.';
  if (err instanceof TypeError) return 'Could not reach the server — check your connection and try again.';
  return err.message;
}

export async function parseJsonResponse(res) {
  // DELETE routes in this app return 204 with an empty body on success (see
  // backend/server.js's res.status(204).end() calls) -- res.json() would throw a
  // SyntaxError on that empty body, so short-circuit before attempting to parse.
  if (res.status === 204) {
    if (!res.ok) throw new Error(`Request failed (HTTP ${res.status})`);
    return null;
  }
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
  health: () => fetch('/api/health').then(parseJsonResponse),
  setupStatus: () => fetch('/api/setup-status').then(parseJsonResponse),
  pipelineConfig: () => fetch('/api/config/pipeline').then(parseJsonResponse),
  settings: {
    get: () => fetch('/api/settings').then(parseJsonResponse),
    patch: (updates) => fetch('/api/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(updates) }).then(parseJsonResponse),
  },
  shopConventions: {
    get: () => fetch('/api/config/shop-conventions').then(parseJsonResponse),
    patch: (payload) => fetch('/api/config/shop-conventions', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
  },
  tags: {
    list: () => fetch('/api/tags').then(parseJsonResponse),
    bulk: (payload) => fetch('/api/tags/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
    csv: (csv) => fetch('/api/tags/csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) }).then(parseJsonResponse),
    delete: (id) => fetch(`/api/tags/${id}`, { method: 'DELETE' }).then(parseJsonResponse),
    backfillPreview: () => fetch('/api/tags/backfill-categories?dry_run=true', { method: 'POST' }).then(parseJsonResponse),
    backfillApply: () => fetch('/api/tags/backfill-categories', { method: 'POST' }).then(parseJsonResponse),
  },
  trends: {
    list: () => fetch('/api/trends').then(parseJsonResponse),
    add: (payload) => fetch('/api/trends', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
    delete: (id) => fetch(`/api/trends/${id}`, { method: 'DELETE' }).then(parseJsonResponse),
    csv: (csv) => fetch('/api/trends/csv', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv }) }).then(parseJsonResponse),
  },
  apiKeys: {
    list: () => fetch('/api/settings/api-keys').then(parseJsonResponse),
    add: (payload) => fetch('/api/settings/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
    toggle: (id, enabled) => fetch(`/api/settings/api-keys/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled }) }).then(parseJsonResponse),
    delete: (id) => fetch(`/api/settings/api-keys/${id}`, { method: 'DELETE' }).then(parseJsonResponse),
  },
  rateLimits: () => fetch('/api/llm/rate-limits').then(parseJsonResponse),
  jobs: {
    list: () => fetch('/api/jobs').then(parseJsonResponse),
    get: (id) => fetch(`/api/jobs/${id}`).then(parseJsonResponse),
    create: (payload) => fetch('/api/jobs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
    createBulk: (payload) => fetch('/api/jobs/bulk', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
    runBatch: (payload) => fetch('/api/jobs/run-batch', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
    runModule: (id, payload) => fetch(`/api/jobs/${id}/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
    runImageAnalyzer: (id) => fetch(`/api/jobs/${id}/run/image-analyzer`, { method: 'POST' }).then(parseJsonResponse),
    patchManualNotes: (id, notes) => fetch(`/api/jobs/${id}/manual-notes`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ notes }) }).then(parseJsonResponse),
  },
  artworks: {
    upload: (formData) => fetch('/api/artworks/upload', { method: 'POST', body: formData }).then(parseJsonResponse),
    get: (id) => fetch(`/api/artworks/${id}`).then(parseJsonResponse),
  },
  listings: {
    get: (jobId) => fetch(`/api/jobs/${jobId}/listings`).then(parseJsonResponse),
    patch: (jobId, listingId, payload) => fetch(`/api/jobs/${jobId}/listings/${listingId}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
  },
  mockups: {
    get: (jobId) => fetch(`/api/jobs/${jobId}/mockups`).then(parseJsonResponse),
    setVariant: (jobId, mockupId, variant) => fetch(`/api/jobs/${jobId}/mockups/${mockupId}/variant`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ variant }) }).then(parseJsonResponse),
    templates: {
      list: () => fetch('/api/mockup-templates').then(parseJsonResponse),
      categories: () => fetch('/api/mockup-templates/categories').then(parseJsonResponse),
      scan: (folder) => fetch(`/api/mockup-templates/scan?folder=${encodeURIComponent(folder)}`).then(parseJsonResponse),
      add: (payload) => fetch('/api/mockup-templates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
      delete: (sizeKey) => fetch(`/api/mockup-templates/${encodeURIComponent(sizeKey)}`, { method: 'DELETE' }).then(parseJsonResponse),
    },
  },
  prompts: {
    list: (orientation) => fetch(orientation ? `/api/prompts?orientation=${encodeURIComponent(orientation)}` : '/api/prompts').then(parseJsonResponse),
    generate: (payload) => fetch('/api/prompts/generate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
  },
  tasteFilter: {
    import: (formData) => fetch('/api/taste-filter/import', { method: 'POST', body: formData }).then(parseJsonResponse),
    label: (payload) => fetch('/api/taste-filter/label', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
    promote: (payload) => fetch('/api/taste-filter/promote', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).then(parseJsonResponse),
    recompute: () => fetch('/api/taste-filter/recompute', { method: 'POST' }).then(parseJsonResponse),
    centroids: () => fetch('/api/taste-filter/centroids').then(parseJsonResponse),
    stats: () => fetch('/api/taste-filter/stats').then(parseJsonResponse),
    watchStatus: () => fetch('/api/taste-filter/watch-status').then(parseJsonResponse),
  },
  config: {
    export: () => fetch('/api/config/export').then(parseJsonResponse),
    import: (bundle) => fetch('/api/config/import', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(bundle) }).then(parseJsonResponse),
  },
};
