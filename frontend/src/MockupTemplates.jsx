import { useEffect, useMemo, useState } from 'react';

// plan.md -> "Frontend changes" -> new component `frontend/src/MockupTemplates.jsx`.
// Not job-scoped -- mirrors TasteFilter.jsx/PromptHelper.jsx's shape, not
// JobListingReview.jsx's. Rollout step 4 built the folder field + scan/select grid +
// bulk-assign + configured-templates grid with a plain text input only. Rollout step 5
// (this pass) adds the Electron native "Browse…" button: window.mockupTemplatesAPI only
// exists when the preload bridge has actually run (electron/preload.js), so it's
// feature-detected here rather than assumed -- dev-in-browser (no Electron) simply never
// renders the button and the plain text field keeps working exactly as it did in step 4.

function slugify(filename) {
  const base = filename.replace(/\.[^/.]+$/, '');
  return base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function TemplateThumb({ url, alt }) {
  if (!url) return <div className="mockup-template-thumb-placeholder" aria-hidden="true" />;
  return (
    <div className="crop-frame mockup-template-thumb-frame">
      <img src={url} alt={alt} className="mockup-template-thumb" />
    </div>
  );
}

function MockupTemplates() {
  const [folder, setFolder] = useState('');
  const [folderSavedMessage, setFolderSavedMessage] = useState('');
  const [scanStatus, setScanStatus] = useState('');
  const [scanFiles, setScanFiles] = useState([]);
  const [selected, setSelected] = useState({}); // path -> boolean
  const [bulkDimensions, setBulkDimensions] = useState('');
  const [bulkDpi, setBulkDpi] = useState('');
  const [bulkOrientation, setBulkOrientation] = useState('');
  const [perFileSizeKey, setPerFileSizeKey] = useState({}); // path -> string
  const [perFilePlacementLayer, setPerFilePlacementLayer] = useState({}); // path -> string
  const [assignStatus, setAssignStatus] = useState('');
  const [assigning, setAssigning] = useState(false);

  const [configured, setConfigured] = useState([]);
  const [configuredEdits, setConfiguredEdits] = useState({}); // size_key -> partial fields
  const [configuredStatus, setConfiguredStatus] = useState('');

  function refreshConfigured() {
    fetch('/api/mockup-templates')
      .then((r) => r.json())
      .then(setConfigured)
      .catch(() => {});
  }

  useEffect(() => {
    fetch('/api/settings')
      .then((r) => r.json())
      .then((s) => setFolder(s.mockup_templates_dir || ''))
      .catch(() => {});
    refreshConfigured();
  }, []);

  async function saveFolder(value) {
    await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mockup_templates_dir: value }),
    }).catch(() => {});
    setFolderSavedMessage('Saved.');
  }

  // Rollout step 5: calls the native OS folder picker via the preload bridge
  // (electron/main.js's 'select-folder' IPC handler), fills the field, and saves it the
  // same way a manual edit's onBlur would -- a cancelled dialog (selectFolder() resolves
  // null) leaves the field untouched.
  async function handleBrowse() {
    if (!window.mockupTemplatesAPI) return;
    const picked = await window.mockupTemplatesAPI.selectFolder();
    if (!picked) return;
    setFolder(picked);
    setFolderSavedMessage('');
    await saveFolder(picked);
  }

  async function handleScan() {
    if (!folder.trim()) {
      setScanStatus('Enter a folder path first.');
      return;
    }
    setScanStatus('Scanning…');
    setSelected({});
    try {
      const res = await fetch(`/api/mockup-templates/scan?folder=${encodeURIComponent(folder.trim())}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Scan failed');
      setScanFiles(data.files);
      setScanStatus(`Found ${data.files.length} file${data.files.length === 1 ? '' : 's'}.`);
      // Seed default size_key per file (slugified filename), editable below.
      const defaults = {};
      data.files.forEach((f) => {
        defaults[f.path] = slugify(f.filename);
      });
      setPerFileSizeKey(defaults);
    } catch (err) {
      setScanStatus(`Scan failed: ${err.message}`);
      setScanFiles([]);
    }
  }

  function toggleSelected(path) {
    setSelected((prev) => ({ ...prev, [path]: !prev[path] }));
  }

  const selectedFiles = useMemo(
    () => scanFiles.filter((f) => selected[f.path]),
    [scanFiles, selected]
  );

  async function handleBulkAssign() {
    if (!selectedFiles.length) return;
    setAssigning(true);
    setAssignStatus(`Assigning ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'}…`);

    let succeeded = 0;
    const errors = [];
    for (const file of selectedFiles) {
      const sizeKey = (perFileSizeKey[file.path] || '').trim();
      if (!sizeKey) {
        errors.push(`${file.filename}: size key is required`);
        continue;
      }
      try {
        const res = await fetch('/api/mockup-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            size_key: sizeKey,
            dimensions: bulkDimensions || null,
            dpi: bulkDpi ? Number(bulkDpi) : null,
            orientation: bulkOrientation || null,
            mockup_template: file.filename,
            placement_layer: file.kind === 'psd' ? perFilePlacementLayer[file.path] || null : null,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Assign failed');
        succeeded += 1;
      } catch (err) {
        errors.push(`${file.filename}: ${err.message}`);
      }
    }

    setAssignStatus(
      errors.length
        ? `Assigned ${succeeded} of ${selectedFiles.length}. Errors: ${errors.join('; ')}`
        : `Assigned ${succeeded} file${succeeded === 1 ? '' : 's'}.`
    );
    setAssigning(false);
    setSelected({});
    refreshConfigured();
    // Re-scan so "already used as X" badges reflect the new assignments.
    handleScan();
  }

  function updateConfiguredEdit(sizeKey, field, value) {
    setConfiguredEdits((prev) => ({ ...prev, [sizeKey]: { ...prev[sizeKey], [field]: value } }));
  }

  function getConfiguredValue(row, field) {
    const edit = configuredEdits[row.size_key];
    if (edit && field in edit) return edit[field];
    if (field === 'dpi') return row.dpi ?? '';
    return row[field] ?? '';
  }

  async function saveConfiguredEdit(row) {
    const dimensions = getConfiguredValue(row, 'dimensions');
    const dpi = getConfiguredValue(row, 'dpi');
    const orientation = getConfiguredValue(row, 'orientation');
    const placementLayer = getConfiguredValue(row, 'placement_layer');
    setConfiguredStatus(`Saving ${row.size_key}…`);
    try {
      const res = await fetch('/api/mockup-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          size_key: row.size_key,
          dimensions: dimensions || null,
          dpi: dpi ? Number(dpi) : null,
          orientation: orientation || null,
          mockup_template: row.mockup_template_path,
          placement_layer: placementLayer || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setConfiguredStatus(`Saved ${row.size_key}.`);
      refreshConfigured();
    } catch (err) {
      setConfiguredStatus(`Save failed: ${err.message}`);
    }
  }

  async function removeConfigured(sizeKey) {
    setConfiguredStatus(`Removing ${sizeKey}…`);
    try {
      const res = await fetch(`/api/mockup-templates/${encodeURIComponent(sizeKey)}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const data = await res.json();
        throw new Error(data.error || 'Remove failed');
      }
      setConfiguredStatus(`Removed ${sizeKey}.`);
      refreshConfigured();
    } catch (err) {
      setConfiguredStatus(`Remove failed: ${err.message}`);
    }
  }

  return (
    <div>
      <h2 style={{ marginTop: 0, marginBottom: '1.5rem' }}>Mockup Templates</h2>

      <div className="settings-section-card">
        <h3 className="settings-section-title">Templates folder</h3>
        <div className="settings-subsection" style={{ marginBottom: 0 }}>
          <div className="settings-field-row">
            <div className="settings-field" style={{ flex: 1, minWidth: '260px' }}>
              <span className="settings-field-label">Folder path</span>
              <input
                value={folder}
                onChange={(e) => { setFolder(e.target.value); setFolderSavedMessage(''); }}
                onBlur={(e) => saveFolder(e.target.value)}
                placeholder="/home/you/etsy-mockup-packs"
              />
            </div>
            {typeof window !== 'undefined' && window.mockupTemplatesAPI && (
              <button className="btn-secondary" onClick={handleBrowse}>Browse…</button>
            )}
            <button className="btn-primary" onClick={handleScan}>Scan folder</button>
            {folderSavedMessage && <span className="text-muted mono-sm">{folderSavedMessage}</span>}
          </div>
          {scanStatus && <p className="mono taste-status" style={{ marginTop: '0.75rem' }}>{scanStatus}</p>}
        </div>
      </div>

      {scanFiles.length > 0 && (
        <div className="settings-section-card">
          <h3 className="settings-section-title">Select templates to configure</h3>
          <div className="taste-grid">
            {scanFiles.map((f) => (
              <div key={f.path} className="taste-card mockup-template-card">
                <TemplateThumb url={null} alt={f.filename} />
                <label className="mockup-template-select-row">
                  <input type="checkbox" checked={!!selected[f.path]} onChange={() => toggleSelected(f.path)} />
                  <span className="mockup-template-filename">{f.filename}</span>
                </label>
                <p className="taste-card-meta">{f.width}×{f.height}px · {f.kind}</p>
                {f.alreadyAssignedTo && (
                  <p className="taste-card-meta">
                    <span className="read-only-badge">already used as {f.alreadyAssignedTo}</span>
                  </p>
                )}
                {selected[f.path] && (
                  <div className="settings-field" style={{ marginTop: '0.5rem' }}>
                    <span className="settings-field-label">Size key</span>
                    <input
                      value={perFileSizeKey[f.path] ?? ''}
                      onChange={(e) => setPerFileSizeKey((prev) => ({ ...prev, [f.path]: e.target.value }))}
                    />
                    {f.kind === 'psd' && (
                      <>
                        <span className="settings-field-label" style={{ marginTop: '0.5rem' }}>Placement layer</span>
                        <input
                          value={perFilePlacementLayer[f.path] ?? ''}
                          onChange={(e) => setPerFilePlacementLayer((prev) => ({ ...prev, [f.path]: e.target.value }))}
                          placeholder="e.g. artwork"
                        />
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>

          {selectedFiles.length > 0 && (
            <div className="settings-subsection" style={{ marginTop: '1.5rem' }}>
              <h4 className="settings-sub-heading">Assign {selectedFiles.length} selected file{selectedFiles.length === 1 ? '' : 's'}</h4>
              <div className="settings-field-row">
                <div className="settings-field">
                  <span className="settings-field-label">Dimensions</span>
                  <input value={bulkDimensions} onChange={(e) => setBulkDimensions(e.target.value)} placeholder="8x10" />
                </div>
                <div className="settings-field">
                  <span className="settings-field-label">DPI</span>
                  <input value={bulkDpi} onChange={(e) => setBulkDpi(e.target.value)} placeholder="300" />
                </div>
                <div className="settings-field">
                  <span className="settings-field-label">Orientation</span>
                  <input value={bulkOrientation} onChange={(e) => setBulkOrientation(e.target.value)} placeholder="portrait" />
                </div>
                <button className="btn-primary" onClick={handleBulkAssign} disabled={assigning}>
                  Assign {selectedFiles.length} file{selectedFiles.length === 1 ? '' : 's'}
                </button>
              </div>
              {assignStatus && <p className="mono taste-status" style={{ marginTop: '0.75rem' }}>{assignStatus}</p>}
            </div>
          )}
        </div>
      )}

      <div className="settings-section-card">
        <h3 className="settings-section-title">Configured templates</h3>
        {configuredStatus && <p className="text-muted mono-sm" style={{ marginTop: 0 }}>{configuredStatus}</p>}
        {configured.length ? (
          <div className="taste-grid">
            {configured.map((row) => (
              <div key={row.size_key} className="taste-card mockup-template-card">
                <TemplateThumb url={row.preview_url} alt={row.size_key} />
                <p className="taste-card-meta mockup-template-filename">{row.size_key}</p>
                <div className="settings-field-row">
                  <div className="settings-field">
                    <span className="settings-field-label">Dimensions</span>
                    <input
                      value={getConfiguredValue(row, 'dimensions')}
                      onChange={(e) => updateConfiguredEdit(row.size_key, 'dimensions', e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <span className="settings-field-label">DPI</span>
                    <input
                      value={getConfiguredValue(row, 'dpi')}
                      onChange={(e) => updateConfiguredEdit(row.size_key, 'dpi', e.target.value)}
                    />
                  </div>
                  <div className="settings-field">
                    <span className="settings-field-label">Orientation</span>
                    <input
                      value={getConfiguredValue(row, 'orientation')}
                      onChange={(e) => updateConfiguredEdit(row.size_key, 'orientation', e.target.value)}
                    />
                  </div>
                </div>
                {row.mockup_template_path && row.mockup_template_path.toLowerCase().endsWith('.psd') && (
                  <div className="settings-field" style={{ marginTop: '0.5rem' }}>
                    <span className="settings-field-label">Placement layer</span>
                    <input
                      value={getConfiguredValue(row, 'placement_layer')}
                      onChange={(e) => updateConfiguredEdit(row.size_key, 'placement_layer', e.target.value)}
                    />
                  </div>
                )}
                <div className="flex-row taste-card-actions">
                  <button className="flex-1" onClick={() => saveConfiguredEdit(row)}>Save</button>
                  <button className="btn-secondary flex-1" onClick={() => removeConfigured(row.size_key)}>Remove</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="empty-state" style={{ margin: 0 }}>No templates configured yet — scan a folder above and assign some.</p>
        )}
      </div>
    </div>
  );
}

export default MockupTemplates;
