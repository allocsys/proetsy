import TasteFilter from '../TasteFilter.jsx';

export default function UploadView({
  pipelineDefault,
  overrides,
  setOverrides,
  toggleModule,
  refreshJobs,
  dragActive,
  setDragActive,
  uploadStatus,
  handleFiles,
  onDrop,
  showHowItWorks,
  setShowHowItWorks,
}) {
  return (
    <section className="paper-card card upload-pipeline-card">
      <div className="upload-header-row">
        <div>
          <h2 style={{ marginTop: 0, marginBottom: '0.25rem' }}>Upload & Curation Pipeline</h2>
          <p className="upload-subtitle text-muted">Upload candidate images and curate them through the pipeline.</p>
        </div>
        <button
          className="btn-secondary btn-sm how-it-works-btn"
          onClick={() => setShowHowItWorks((prev) => !prev)}
          type="button"
        >
          <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          How it works
        </button>
      </div>

      {showHowItWorks && (
        <div className="how-it-works-info-box">
          <strong>How the pipeline works:</strong>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '12.5px' }}>
            Upload candidate images to score them with the Taste Filter curation model. High-scoring candidates can be promoted straight to full listing and mockup processing.
          </p>
        </div>
      )}

      <div className="upload-lane">
        <h3 style={{ marginTop: 0 }}>Curation</h3>
        <TasteFilter overrides={overrides} refreshJobs={refreshJobs} />
      </div>

      <details className="upload-lane-collapsible">
        <summary className="direct-upload-summary">
          <div className="direct-upload-title-group">
            <svg className="summary-folder-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
            </svg>
            <span>Direct upload (skips curation — uploads go straight into the pipeline)</span>
          </div>
          <svg className="summary-chevron-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </summary>
        <div className="upload-lane" id="section-pipeline">
          <h3>Pipeline</h3>
          <p className="text-muted" style={{ marginTop: 0 }}>
            These toggles apply <strong>only to artwork uploaded next</strong> — they don&apos;t change your saved default.
            To change what every future upload starts with, go to <strong>Settings → Pipeline Modules</strong>.
          </p>
          <div className="flex-row flex-wrap" style={{ gap: '1.5rem', marginBottom: '0.5rem', alignItems: 'center' }}>
            {pipelineDefault?.pipeline?.map((m) => {
              const isModified = !m.required && !!overrides[m.module] !== !!m.enabled;
              return (
                <label key={m.module} style={{ opacity: m.required ? 0.6 : 1, display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: m.required ? 'not-allowed' : 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={!!overrides[m.module]}
                    disabled={m.required}
                    onChange={() => toggleModule(m.module, m.required)}
                  />
                  <span>{m.module}</span>
                  {m.required ? <span className="text-muted mono-sm">(required)</span> : null}
                  {isModified ? <span className="text-muted mono-sm" title="Different from your saved default, for this upload only"> (changed for this upload)</span> : null}
                </label>
              );
            })}
          </div>
          {pipelineDefault?.pipeline?.some((m) => !m.required && !!overrides[m.module] !== !!m.enabled) && (
            <button
              type="button"
              className="btn-secondary btn-xs"
              style={{ marginBottom: '1rem' }}
              onClick={() => setOverrides(Object.fromEntries(pipelineDefault.pipeline.map((m) => [m.module, m.enabled])))}
            >
              Reset to saved default
            </button>
          )}

          <div
            className={`dropzone ${dragActive ? 'active' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
            onDragLeave={() => setDragActive(false)}
            onDrop={onDrop}
          >
            <p className="dropzone-title">Drag and drop artwork here (bulk supported)</p>
            <p>or browse files from your computer</p>
            <div style={{ marginTop: '1rem', display: 'inline-block' }}>
              <input type="file" multiple accept="image/*" onChange={(e) => handleFiles(e.target.files)} />
            </div>
            {uploadStatus && <p className="mono taste-status" style={{ marginTop: '1rem' }}>{uploadStatus}</p>}
          </div>
        </div>
      </details>
    </section>
  );
}
