import { useNavigate, useParams } from 'react-router-dom';
import Tabs from '../components/Tabs.jsx';
import Skeleton from '../components/Skeleton.jsx';
import EmptyState from '../components/EmptyState.jsx';
import FormField from '../components/FormField.jsx';
import StatusPill from '../components/StatusPill.jsx';
import ShopConventions from '../ShopConventions.jsx';

const SETTINGS_TABS = [
  { id: 'tags-trends', label: 'Tags & Trends' },
  { id: 'general', label: 'Shop & Pipeline' },
  { id: 'api-keys', label: 'API Keys' },
  { id: 'automation', label: 'Automation & Diagnostics' },
];

export default function SettingsView({ settingsApi, apiKeysApi, tagsAndTrendsApi }) {
  const navigate = useNavigate();
  const { tab } = useParams();
  const settingsTab = tab || 'tags-trends';

  function handleTabChange(newTab) {
    navigate(`/settings/${newTab}`);
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Shop Settings & Tags</h2>

      <Tabs
        tabs={SETTINGS_TABS}
        activeId={settingsTab}
        onChange={handleTabChange}
        className="settings-tabs-nav"
      />

      <div className="settings-dashboard-grid">

      {settingsTab === 'tags-trends' && (
      <div className="settings-section-card card settings-card-tags">
        <h3 className="settings-section-title">Tags & Trends</h3>

        <div className="settings-subsection">
          <h4 className="settings-sub-heading">Tag library</h4>
          <label htmlFor="settings-tags-textarea" className="settings-field-label" style={{ display: 'block', marginBottom: '0.25rem' }}>Add tags (one per line)</label>
          <textarea
            id="settings-tags-textarea"
            rows={5}
            className="mono input"
            style={{ width: '100%', marginBottom: '0.75rem' }}
            value={tagsAndTrendsApi.tagsText}
            onChange={(e) => tagsAndTrendsApi.setTagsText(e.target.value)}
            placeholder={'wall art\nboho decor\nminimalist print\n...'}
          />
          <div className="settings-field-row">
            <div className="settings-field">
              <label htmlFor="settings-tags-category" className="settings-field-label">Category (optional, applies to all)</label>
              <input
                id="settings-tags-category"
                list="tag-category-options"
                value={tagsAndTrendsApi.tagsCategory}
                onChange={(e) => tagsAndTrendsApi.setTagsCategory(e.target.value)}
                placeholder="e.g. botanical, boho, minimalist"
              />
              <datalist id="tag-category-options">
                {tagsAndTrendsApi.tagCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <button className="btn-primary" onClick={tagsAndTrendsApi.saveTags} disabled={!tagsAndTrendsApi.tagsText.trim()}>Save tags</button>
          </div>

          <h4 className="settings-sub-heading" style={{ marginTop: '1rem' }}>Current tags</h4>
          {tagsAndTrendsApi.tagsLoading ? (
            <Skeleton count={4} />
          ) : tagsAndTrendsApi.tags.length ? (
            <ul className="settings-compact-list">
              {tagsAndTrendsApi.tags.map((t) => (
                <li key={t.id || t.tag_text} className="settings-list-item">
                  <span>{t.tag_text}{t.category ? ` (${t.category})` : ''}</span>
                  <button
                    className="btn-secondary btn-xs"
                    onClick={() => tagsAndTrendsApi.deleteTag(t.id, t.tag_text)}
                    title="Delete tag"
                    aria-label={`Delete tag ${t.tag_text}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No tags added yet — add some above to get started." />
          )}
        </div>

        <div className="settings-subsection">
          <h4 className="settings-sub-heading">Bulk tools</h4>
          <div className="settings-actions-row">
            <label className="settings-inline-action">
              Import CSV
              <input type="file" accept=".csv,text/csv" onChange={(e) => tagsAndTrendsApi.importTagsCsv(e.target.files?.[0])} />
            </label>
            <button className="btn-secondary btn-sm" onClick={tagsAndTrendsApi.previewBackfillTagCategories} disabled={tagsAndTrendsApi.tagsBackfillPreviewLoading || tagsAndTrendsApi.tagsBackfillRunning}>
              {tagsAndTrendsApi.tagsBackfillPreviewLoading ? 'Checking…' : 'Suggest categories for uncategorized tags'}
            </button>
          </div>

          {tagsAndTrendsApi.tagsBackfillPreview && (
            <div className="settings-readonly-box" style={{ marginTop: '0.75rem' }}>
              <div className="settings-readonly-header">
                <h4 className="settings-readonly-title">Preview — nothing saved yet</h4>
              </div>
              {tagsAndTrendsApi.tagsBackfillPreview.updates.length ? (
                <>
                  <p className="text-muted mono-sm" style={{ marginTop: 0 }}>
                    {tagsAndTrendsApi.tagsBackfillPreview.updates.length} of {tagsAndTrendsApi.tagsBackfillPreview.checked} uncategorized tag(s) would be updated:
                  </p>
                  <ul className="settings-compact-list" style={{ maxHeight: '220px', overflowY: 'auto' }}>
                    {tagsAndTrendsApi.tagsBackfillPreview.updates.map((u) => (
                      <li key={u.tagText} className="settings-list-item">
                        <span>{u.tagText} → <strong>{u.category}</strong></span>
                      </li>
                    ))}
                  </ul>
                  <div className="flex-row" style={{ gap: '0.5rem', marginTop: '0.5rem' }}>
                    <button className="btn-primary btn-sm" onClick={tagsAndTrendsApi.applyBackfillTagCategories} disabled={tagsAndTrendsApi.tagsBackfillRunning}>
                      Apply {tagsAndTrendsApi.tagsBackfillPreview.updates.length} change{tagsAndTrendsApi.tagsBackfillPreview.updates.length > 1 ? 's' : ''}
                    </button>
                    <button className="btn-secondary btn-sm" onClick={() => tagsAndTrendsApi.setTagsBackfillPreview(null)} disabled={tagsAndTrendsApi.tagsBackfillRunning}>
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <p className="empty-state" style={{ margin: 0 }}>
                    No matches found among {tagsAndTrendsApi.tagsBackfillPreview.checked} uncategorized tag(s) — nothing to apply.
                  </p>
                  <button className="btn-secondary btn-sm" style={{ marginTop: '0.5rem' }} onClick={() => tagsAndTrendsApi.setTagsBackfillPreview(null)}>
                    Close
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        <div className="settings-subsection" style={{ marginBottom: 0 }}>
          <h4 className="settings-sub-heading">Trend list</h4>
          {tagsAndTrendsApi.trendsLoading ? (
            <Skeleton count={4} />
          ) : tagsAndTrendsApi.trends.length ? (
            <ul className="settings-compact-list">
              {tagsAndTrendsApi.trends.map((t) => (
                <li key={t.id} className="settings-list-item">
                  <span>{t.term}{t.category ? ` (${t.category})` : ''}</span>
                  <button
                    className="btn-secondary btn-xs"
                    onClick={() => tagsAndTrendsApi.deleteTrend(t.id, t.term)}
                    title="Delete trend"
                    aria-label={`Delete trend ${t.term}`}
                  >
                    ×
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState message="No trends added yet — add one below." />
          )}
          <div className="flex-row flex-wrap mt-2">
            <div className="settings-field" style={{ flex: 1, minWidth: '140px' }}>
              <label htmlFor="settings-trend-term" className="settings-field-label">Trend term</label>
              <input
                id="settings-trend-term"
                value={tagsAndTrendsApi.newTrendTerm}
                onChange={(e) => tagsAndTrendsApi.setNewTrendTerm(e.target.value)}
                placeholder="Trend term"
              />
            </div>
            <div className="settings-field" style={{ flex: 1, minWidth: '140px' }}>
              <label htmlFor="settings-trend-category" className="settings-field-label">Category (optional)</label>
              <input
                id="settings-trend-category"
                list="trend-category-options"
                value={tagsAndTrendsApi.newTrendCategory}
                onChange={(e) => tagsAndTrendsApi.setNewTrendCategory(e.target.value)}
                placeholder="Category (optional)"
              />
              <datalist id="trend-category-options">
                {tagsAndTrendsApi.trendCategories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>
            </div>
            <button className="btn-primary btn-sm" onClick={tagsAndTrendsApi.addTrendFromSettings} disabled={!tagsAndTrendsApi.newTrendTerm.trim()}>Add trend</button>
          </div>
        </div>
      </div>
      )}

      {settingsTab === 'general' && (
      <div className="settings-section-card card settings-full-width-card">
        <h3 className="settings-section-title">Backup & Restore</h3>
        <p className="text-muted mono-sm" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
          Downloads a JSON file with your shop/Midjourney conventions, pipeline settings, product sizes &amp; mockup templates, tag library, and API keys — not job/listing/mockup history. Restoring adds/updates from the file without deleting anything not covered by it.
        </p>
        <div className="settings-actions-row">
          <button className="btn-primary btn-sm" onClick={settingsApi.downloadConfigBackup}>Download backup</button>
          <label className="settings-inline-action">
            Restore from file
            <input
              type="file"
              accept=".json,application/json"
              disabled={settingsApi.configImporting}
              onChange={(e) => settingsApi.importConfigBackup(e.target.files?.[0])}
            />
          </label>
        </div>
      </div>
      )}

      {settingsTab === 'general' && (
      <div className="settings-section-card card settings-card-defaults">
        <h3 className="settings-section-title">Shop Defaults & Conventions</h3>

        <div className="settings-subsection">
          <div className="settings-field-row">
            <FormField
              id="settings-default-price"
              label="Default price"
              saved={!!settingsApi.savedFlashes.default_price}
              type="number"
              step="0.01"
              min="0"
              value={settingsApi.settings.default_price || ''}
              onChange={(e) => settingsApi.setSettings((s) => ({ ...s, default_price: e.target.value }))}
              onBlur={(e) => settingsApi.saveSettings({ default_price: e.target.value })}
              placeholder="24.00"
            />
            <FormField
              id="settings-delivery-text"
              label="Delivery text"
              saved={!!settingsApi.savedFlashes.delivery_text}
              wrapperStyle={{ flex: 1, minWidth: '240px' }}
              value={settingsApi.settings.delivery_text || ''}
              onChange={(e) => settingsApi.setSettings((s) => ({ ...s, delivery_text: e.target.value }))}
              onBlur={(e) => settingsApi.saveSettings({ delivery_text: e.target.value })}
              placeholder="Digital file, no physical shipment"
            />
          </div>
        </div>

        <ShopConventions />

      </div>
      )}

      {settingsTab === 'api-keys' && (
      <div className="settings-section-card card settings-card-keys settings-full-width-card">
        <h3 className="settings-section-title">API Keys</h3>

        <div className="settings-subsection">
          <p className="text-muted mono-sm" style={{ marginTop: 0, marginBottom: '0.5rem' }}>
            Securely stored API keys for Gemini & Claude providers. Key values are masked after saving.
          </p>
          {apiKeysApi.apiKeysLoading ? (
            <Skeleton variant="table" count={3} />
          ) : apiKeysApi.apiKeys.length ? (
            <div className="data-table-wrapper">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Provider</th>
                    <th>Label</th>
                    <th>Key</th>
                    <th>Status</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {apiKeysApi.apiKeys.map((key) => (
                    <tr key={key.id}>
                      <td className="mono">{key.provider}</td>
                      <td>{key.label || <span className="text-muted">—</span>}</td>
                      <td className="mono mono-sm">{key.maskedKey}</td>
                      <td>
                        <StatusPill variant={key.enabled ? 'success' : 'pending'} ariaLabel={`API key status: ${key.enabled ? 'Enabled' : 'Disabled'}`}>
                          {key.enabled ? 'Enabled' : 'Disabled'}
                        </StatusPill>
                      </td>
                      <td>
                        <div className="flex-row" style={{ gap: '0.5rem' }}>
                          <button className="btn-secondary btn-sm" onClick={() => apiKeysApi.toggleApiKeyEnabled(key)}>
                            {key.enabled ? 'Disable' : 'Enable'}
                          </button>
                          <button className="btn-secondary btn-sm" onClick={() => apiKeysApi.deleteApiKey(key)}>Delete</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState message="No dashboard-managed keys yet — add one below to enable Gemini/Claude calls." compact />
          )}

          <div className="settings-field-row" style={{ marginTop: '1rem' }}>
            <div className="settings-field">
              <label htmlFor="settings-key-provider" className="settings-field-label">Provider</label>
              <select id="settings-key-provider" value={apiKeysApi.newKeyProvider} onChange={(e) => apiKeysApi.setNewKeyProvider(e.target.value)}>
                <option value="gemini">Gemini</option>
                <option value="claude">Claude</option>
              </select>
            </div>
            <div className="settings-field" style={{ flex: 1, minWidth: '240px' }}>
              <label htmlFor="settings-key-value" className="settings-field-label">Key value</label>
              <input
                id="settings-key-value"
                type="password"
                value={apiKeysApi.newKeyValue}
                onChange={(e) => apiKeysApi.setNewKeyValue(e.target.value)}
                placeholder="Paste API key"
              />
            </div>
            <div className="settings-field">
              <label htmlFor="settings-key-label" className="settings-field-label">Label (optional)</label>
              <input
                id="settings-key-label"
                value={apiKeysApi.newKeyLabel}
                onChange={(e) => apiKeysApi.setNewKeyLabel(e.target.value)}
                placeholder="e.g. backup key"
              />
            </div>
            <button className="btn-primary" onClick={apiKeysApi.addApiKey} disabled={!apiKeysApi.newKeyValue.trim()}>Add key</button>
          </div>
          {apiKeysApi.apiKeysMessage && <p className="text-muted mono-sm" style={{ marginTop: '0.5rem' }}>{apiKeysApi.apiKeysMessage}</p>}
        </div>
      </div>
      )}

      {settingsTab === 'general' && (
      <div className="settings-section-card card settings-card-modules settings-full-width-card">
        <h3 className="settings-section-title">Pipeline Modules</h3>

        <div className="settings-subsection" style={{ marginBottom: 0 }}>
          <p className="text-muted mono-sm" style={{ marginTop: 0, marginBottom: '0.75rem' }}>
            This is the <strong>saved default</strong> used for every future upload. For a one-time change on a single upload instead, use the Pipeline toggles on the Upload page — those apply only to that run and don&apos;t affect this default.
          </p>
          <div className="flex-row flex-wrap" style={{ gap: '1.5rem' }}>
            {settingsApi.pipelineDefault?.pipeline?.map((m) => (
              <label
                key={m.module}
                className="settings-checkbox-row"
                style={{ opacity: m.required ? 0.6 : 1, cursor: m.required ? 'not-allowed' : 'pointer' }}
              >
                <input
                  type="checkbox"
                  checked={!!m.enabled}
                  disabled={m.required}
                  onChange={() => settingsApi.togglePersistedModule(m.module, m.enabled, m.required)}
                />
                {m.module}
                {m.required ? <span className="text-muted mono-sm"> (required)</span> : null}
              </label>
            ))}
          </div>
        </div>
      </div>
      )}

      {settingsTab === 'automation' && (
      <div className="settings-section-card card settings-card-automation settings-full-width-card">
        <h3 className="settings-section-title">Automation & Diagnostics</h3>

        <div className="settings-subsection">
          <h4 className="settings-sub-heading">Auto-import from folder</h4>
          <label className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={settingsApi.settings.taste_filter_watch_enabled === 'true'}
              onChange={(e) => {
                const enabled = e.target.checked;
                settingsApi.setSettings((s) => ({ ...s, taste_filter_watch_enabled: String(enabled) }));
                settingsApi.saveWatchSetting({ taste_filter_watch_enabled: enabled });
              }}
            />
            Auto-import from folder
          </label>
          <div className="settings-field-row">
            <div style={{ flex: 1, minWidth: '260px' }}>
              <div className="flex-row" style={{ gap: '0.5rem', alignItems: 'flex-end' }}>
                <FormField
                  id="settings-watched-folder"
                  label="Watched folder path"
                  saved={!!settingsApi.savedFlashes.taste_filter_watch_folder}
                  wrapperStyle={{ flex: 1 }}
                  style={{ flex: 1 }}
                  value={settingsApi.settings.taste_filter_watch_folder || ''}
                  onChange={(e) => settingsApi.setSettings((s) => ({ ...s, taste_filter_watch_folder: e.target.value }))}
                  onBlur={(e) => settingsApi.saveWatchSetting({ taste_filter_watch_folder: e.target.value })}
                  placeholder="/home/you/midjourney-downloads"
                />
                <button type="button" className="btn-secondary btn-sm" onClick={settingsApi.useDefaultWatchFolder} title="Fill in your Downloads folder and turn watching on" style={{ height: '34px' }}>
                  Use Downloads folder
                </button>
              </div>
            </div>
            <FormField
              id="settings-watch-category"
              label="Category (optional)"
              saved={!!settingsApi.savedFlashes.taste_filter_watch_category}
              value={settingsApi.settings.taste_filter_watch_category || ''}
              onChange={(e) => settingsApi.setSettings((s) => ({ ...s, taste_filter_watch_category: e.target.value }))}
              onBlur={(e) => settingsApi.saveWatchSetting({ taste_filter_watch_category: e.target.value })}
              placeholder="e.g. square-canvas"
            />
          </div>
          {settingsApi.watchStatus && (
            <p className="text-muted mono-sm" style={{ marginTop: '0.75rem' }}>
              <span style={{ color: settingsApi.watchStatus.active ? 'var(--state-success)' : 'var(--state-pending)', fontWeight: 600 }}>{settingsApi.watchStatus.active ? 'Active' : 'Inactive'}</span> {settingsApi.watchStatus.active ? `— Watching ${settingsApi.watchStatus.folder}` : '— Not currently watching'}
              {settingsApi.watchStatus.category ? ` (category: ${settingsApi.watchStatus.category})` : ''}
              {settingsApi.watchStatus.pendingCount ? ` — ${settingsApi.watchStatus.pendingCount} pending` : ''}
              {settingsApi.watchStatus.lastError ? ` — ${settingsApi.watchStatus.lastError}` : ''}
            </p>
          )}
        </div>

        <div className="settings-subsection">
          <h4 className="settings-sub-heading">Taste filter auto-sort</h4>
          <label className="settings-checkbox-row">
            <input
              type="checkbox"
              checked={settingsApi.settings.taste_filter_auto_enabled === 'true'}
              onChange={(e) => {
                const enabled = e.target.checked;
                settingsApi.setSettings((s) => ({ ...s, taste_filter_auto_enabled: String(enabled) }));
                settingsApi.saveSettings({ taste_filter_auto_enabled: enabled });
              }}
            />
            Auto-compute taste threshold
          </label>
          <FormField
            id="settings-auto-threshold"
            label={`Auto threshold (score cutoff)${settingsApi.settings.taste_filter_auto_enabled === 'true' ? '' : ' (inactive — enable auto-compute above)'}`}
            saved={!!settingsApi.savedFlashes.taste_filter_auto_threshold}
            wrapperStyle={{ maxWidth: '200px', opacity: settingsApi.settings.taste_filter_auto_enabled === 'true' ? 1 : 0.6 }}
            type="number"
            step="0.01"
            min="0"
            max="1"
            disabled={settingsApi.settings.taste_filter_auto_enabled !== 'true'}
            value={settingsApi.settings.taste_filter_auto_threshold ?? ''}
            onChange={(e) => settingsApi.setSettings((s) => ({ ...s, taste_filter_auto_threshold: e.target.value }))}
            onBlur={(e) => settingsApi.saveSettings({ taste_filter_auto_threshold: e.target.value })}
            placeholder="0.3"
          />
        </div>

        <div className="settings-subsection" style={{ marginBottom: 0 }}>
          <div className="settings-readonly-box">
            <div className="settings-readonly-header">
              <h4 className="settings-readonly-title">LLM rate-limit status</h4>
              <div className="flex-row" style={{ gap: '0.5rem' }}>
                {settingsApi.rateLimitsUpdatedAt && (
                  <span className="text-muted mono-sm">Updated {settingsApi.rateLimitsUpdatedAt.toLocaleTimeString()}</span>
                )}
                <button className="btn-secondary btn-xs" onClick={settingsApi.refreshRateLimits} title="Refresh rate-limit status" aria-label="Refresh rate-limit status">⟳</button>
                <span className="read-only-badge">Read-only</span>
              </div>
            </div>
            {settingsApi.rateLimitsLoading ? (
              <Skeleton variant="table" count={2} />
            ) : settingsApi.rateLimits.length ? (
              <div className="data-table-wrapper">
                <table className="data-table" style={{ marginBottom: 0 }}>
                  <thead>
                    <tr>
                      <th>Key #</th>
                      <th>Model</th>
                      <th>Status</th>
                      <th>Consecutive hits</th>
                      <th>Limited until</th>
                    </tr>
                  </thead>
                  <tbody>
                    {settingsApi.rateLimits.map((r) => (
                      <tr key={`${r.keyIndex}-${r.model}`}>
                        <td className="mono">{r.keyIndex}</td>
                        <td className="mono">{r.model}</td>
                        <td>
                          <StatusPill variant={r.currentlyLimited ? 'danger' : 'success'} ariaLabel={`Rate limit status: ${r.currentlyLimited ? 'Cooling down' : 'OK'}`}>
                            {r.currentlyLimited ? 'Cooling down' : 'OK'}
                          </StatusPill>
                        </td>
                        <td>{r.consecutiveHits}</td>
                        <td className="text-muted mono mono-sm">{r.currentlyLimited ? r.limitedUntil : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState message="No key/model pair has hit a rate limit yet." compact />
            )}
          </div>
        </div>
      </div>
      )}
      </div>
    </div>
  );
}
