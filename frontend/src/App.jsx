import { useCallback, useEffect, useState } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import StatusPill from './components/StatusPill.jsx';
import Modal from './components/Modal.jsx';
import UpdaterStatus from './UpdaterStatus.jsx';
import { useJobs } from './hooks/useJobs.js';
import { useApiKeys } from './hooks/useApiKeys.js';
import { useTagsAndTrends } from './hooks/useTagsAndTrends.js';
import { useSettings } from './hooks/useSettings.js';
import UploadView from './views/UploadView.jsx';
import HistoryView from './views/HistoryView.jsx';
import ReviewView from './views/ReviewView.jsx';
import SettingsView from './views/SettingsView.jsx';
import PromptHelperView from './views/PromptHelperView.jsx';
import MockupTemplatesView from './views/MockupTemplatesView.jsx';

export function StatusBadge({ status }) {
  const statusText = status || 'pending';
  return (
    <StatusPill variant={statusText} ariaLabel={`Status: ${statusText}`}>
      {statusText}
    </StatusPill>
  );
}

export function NavIcon({ name }) {
  switch (name) {
    case 'upload':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
        </svg>
      );
    case 'templates':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="3" width="7" height="7" rx="1" />
          <rect x="14" y="14" width="7" height="7" rx="1" />
          <rect x="3" y="14" width="7" height="7" rx="1" />
        </svg>
      );
    case 'history':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9" />
          <path d="M12 7v5l3 3" />
        </svg>
      );
    case 'review':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
        </svg>
      );
    case 'prompt':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
        </svg>
      );
    case 'settings':
      return (
        <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
        </svg>
      );
    default:
      return null;
  }
}

const NAV_ITEMS = [
  { id: 'upload', label: 'Upload', group: 'Pipeline', icon: 'upload', path: '/upload' },
  { id: 'mockup-templates', label: 'Mockup Templates', group: 'Pipeline', icon: 'templates', path: '/mockup-templates' },
  { id: 'history', label: 'Listing History', group: 'Pipeline', icon: 'history', path: '/history' },
  { id: 'review', label: 'Review a Job', group: 'Pipeline', icon: 'review', path: '/review' },
  { id: 'prompt-helper', label: 'Prompt Helper', group: 'Modules', icon: 'prompt', path: '/prompt-helper' },
  { id: 'settings', label: 'Shop Settings & Tags', group: 'Configuration', icon: 'settings', path: '/settings/tags-trends' },
];

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const currentPath = location.pathname;

  // --- Cross-cutting / navigation state (not owned by any single hook) ---
  const [health, setHealth] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const [activeJobId, setActiveJobId] = useState(null);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      const stored = localStorage.getItem('proetsy_sidebar_collapsed');
      return stored === null ? false : stored === 'true';
    } catch {
      return false;
    }
  });
  const [fetchError, setFetchError] = useState(null);
  const [reviewTab, setReviewTab] = useState('analysis');
  const [activeJobInfo, setActiveJobInfo] = useState(null);
  const [showHowItWorks, setShowHowItWorks] = useState(false);
  const [previousPath, setPreviousPath] = useState('/upload');
  const [confirmAction, setConfirmAction] = useState(null); // { message, onConfirm } | null
  const [jobIdInput, setJobIdInput] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');

  const isSettingsActive = currentPath.startsWith('/settings');

  useEffect(() => {
    if (!currentPath.startsWith('/settings') && currentPath !== '/') {
      setPreviousPath(currentPath);
    }
  }, [currentPath]);

  // Memoized so components/effects that depend on it get a stable reference
  // instead of a new closure every render.
  const reportFetchError = useCallback(
    (source) => (err) => setFetchError({ source, message: err.message }),
    []
  );

  // Shared in-app confirmation modal for destructive actions (tags, trends, API
  // keys), replacing native window.confirm() popups so the styling and UX stays
  // consistent with the rest of the dashboard.
  function requestConfirm(message, onConfirm) {
    setConfirmAction({ message, onConfirm });
  }

  async function confirmActionAccept() {
    if (!confirmAction) return;
    await confirmAction.onConfirm();
    setConfirmAction(null);
  }

  function confirmActionCancel() {
    setConfirmAction(null);
  }

  function refreshHealth() {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'unreachable' }));
  }

  const refreshSetupStatus = useCallback(() => {
    fetch('/api/setup-status')
      .then((r) => r.json())
      .then(setSetupStatus)
      .catch(reportFetchError('refreshSetupStatus'));
  }, [reportFetchError]);

  // --- Feature hooks ---
  const jobsApi = useJobs(reportFetchError);
  const apiKeysApi = useApiKeys(reportFetchError, requestConfirm);
  const tagsAndTrendsApi = useTagsAndTrends(reportFetchError, requestConfirm, refreshSetupStatus);
  const settingsApi = useSettings(reportFetchError, {
    refreshApiKeys: apiKeysApi.refreshApiKeys,
    refreshTags: tagsAndTrendsApi.refreshTags,
  });

  // Route-based side-effects. Deliberately depends on currentPath only: settingsApi/
  // apiKeysApi/jobsApi are new object literals every render (their functions aren't
  // memoized as a group), so including them here would refire this effect on every
  // render while on /settings or /review (refresh -> setState -> re-render -> new
  // object -> effect refires -> infinite loop). The functions called below still
  // close over fresh state each time the effect *does* run, so this is safe.
  useEffect(() => {
    if (currentPath.startsWith('/settings')) {
      settingsApi.refreshRateLimits();
      apiKeysApi.refreshApiKeys();
      settingsApi.refreshPipelineConfig();
    }
    if (currentPath.startsWith('/review')) {
      jobsApi.refreshJobs();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath]);

  function goTo(target) {
    if (target.startsWith('/')) {
      navigate(target);
    } else {
      navigate(`/${target}`);
    }
  }

  useEffect(() => {
    const match = currentPath.match(/^\/review\/([^/]+)/);
    const jobIdFromRoute = match ? match[1] : null;
    if (jobIdFromRoute) {
      setActiveJobId(jobIdFromRoute);
      setJobIdInput(jobIdFromRoute);
    } else {
      setActiveJobId(null);
    }
  }, [currentPath]);

  useEffect(() => {
    if (!activeJobId) {
      setActiveJobInfo(null);
      return;
    }
    fetch(`/api/jobs/${activeJobId}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((jobData) => {
        setActiveJobInfo({
          id: jobData.id,
          filePath: jobData.artwork_file_path || '',
          filename: jobData.artwork_file_path?.split('/').pop() || `Job #${jobData.id}`,
          status: jobData.overall_status,
        });
      })
      .catch(() => {
        setActiveJobInfo({
          id: activeJobId,
          filename: `Job #${activeJobId}`,
          status: 'unknown',
        });
      });
  }, [activeJobId]);

  useEffect(() => {
    refreshHealth();
    settingsApi.refreshPipelineConfig();
    fetch('/api/settings').then((r) => r.json()).then(settingsApi.setSettings).catch(reportFetchError('settings'));
    refreshSetupStatus();
    jobsApi.refreshJobs();
    tagsAndTrendsApi.refreshTrends();
    tagsAndTrendsApi.refreshTags();
    settingsApi.refreshWatchStatus();
    settingsApi.refreshRateLimits();
    apiKeysApi.refreshApiKeys();
    // These refreshers are stabilized with useCallback ([reportFetchError], which is
    // itself stabilized with []), so listing them here does not turn this into a
    // run-on-every-render effect -- it still only runs once on mount, as intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportFetchError, refreshSetupStatus]);

  async function handleFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploadStatus(`Uploading ${files.length} file${files.length > 1 ? 's' : ''}…`);

    const formData = new FormData();
    files.forEach((f) => formData.append('files', f));

    const batchId = files.length > 1 ? crypto.randomUUID() : null;

    try {
      const uploadRes = await fetch('/api/artworks/upload', { method: 'POST', body: formData });
      const { artworks, error } = await uploadRes.json();
      if (error) throw new Error(error);

      setUploadStatus(`Creating ${artworks.length} job${artworks.length > 1 ? 's' : ''}…`);
      const jobsRes = await fetch('/api/jobs/bulk', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ artwork_ids: artworks.map((a) => a.id), pipeline_overrides: settingsApi.overrides, batch_id: batchId }),
      });
      const jobsData = await jobsRes.json();
      if (jobsData.error) throw new Error(jobsData.error);
      const jobIds = jobsData.jobs.map((job) => job.id);
      jobsApi.refreshJobs();

      setUploadStatus(`Running pipeline for ${jobIds.length} job${jobIds.length > 1 ? 's' : ''} on the server…`);
      await jobsApi.runJobsBatch(jobIds);
      setUploadStatus(`Done. ${jobIds.length} job${jobIds.length > 1 ? 's' : ''} processed — see history.`);
      if (jobIds.length === 1) setActiveJobId(String(jobIds[0]));
    } catch (err) {
      setUploadStatus(`Upload failed: ${err.message}`);
    }
  }

  function onDrop(e) {
    e.preventDefault();
    setDragActive(false);
    handleFiles(e.dataTransfer.files);
  }

  function openJob(jobId) {
    setActiveJobId(String(jobId));
    setJobIdInput(String(jobId));
    navigate(`/review/${jobId}`);
  }

  function isItemActive(item) {
    if (item.id === 'upload') return currentPath === '/upload' || currentPath === '/';
    if (item.id === 'settings') return currentPath.startsWith('/settings');
    if (item.id === 'review') return currentPath.startsWith('/review');
    return currentPath === `/${item.id}`;
  }

  const navGroups = ['Pipeline', 'Modules', 'Configuration'];

  return (
    <div className="app-shell">
      <header className="app-titlebar nav">
        <div className="wordmark-container">
          <div className="logo-badge" aria-hidden="true">M</div>
          <h1 className="wordmark">ProEtsy</h1>
        </div>
        <div className="header-right">
          <div className="backend-status-row">
            <span className="text-muted mono-sm">
              Backend:{' '}
              <strong style={{ color: health?.status === 'unreachable' ? 'var(--state-danger)' : 'var(--state-success)' }}>
                {health ? health.status : 'checking...'}
              </strong>
            </span>
            <button
              className="btn-secondary btn-sm retry-btn"
              onClick={refreshHealth}
              title="Retry health check"
              aria-label="Retry health check"
            >
              <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
              Retry
            </button>
          </div>
          <UpdaterStatus />
          <button className="btn-secondary" onClick={() => navigate(isSettingsActive ? (previousPath || '/upload') : '/settings/tags-trends')}>
            <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={{ width: '14px', height: '14px' }}>
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 012.83 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
            </svg>
            {isSettingsActive ? 'Close settings' : 'Settings'}
          </button>
        </div>
      </header>

      <div className="mobile-nav-strip nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            className={`mobile-nav-item ${isItemActive(item) ? 'active' : ''}`}
            onClick={() => navigate(item.path)}
          >
            <NavIcon name={item.icon} />
            {item.label}
          </button>
        ))}
      </div>

      <div className="app-body">
        <nav className={`sidebar sidebar-shell ${sidebarCollapsed ? 'collapsed' : ''}`}>
          <div className="sidebar-toggle-row">
            <button
              className="sidebar-toggle-btn"
              onClick={() => setSidebarCollapsed((c) => {
                const next = !c;
                try {
                  localStorage.setItem('proetsy_sidebar_collapsed', String(next));
                } catch {
                  // ignore storage errors (e.g. private browsing)
                }
                return next;
              })}
              aria-label={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              title={sidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            >
              <svg className="sidebar-toggle-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                {sidebarCollapsed ? (
                  <path d="M8 5l7 7-7 7M15 5l7 7-7 7" />
                ) : (
                  <path d="M16 5l-7 7 7 7M9 5l-7 7 7 7" />
                )}
              </svg>
            </button>
          </div>
          {navGroups.map((group) => (
            <div key={group}>
              <div className="sidebar-group-title">{group}</div>
              {NAV_ITEMS.filter((item) => item.group === group).map((item) => (
                <button
                  key={item.id}
                  className={`sidebar-nav-item ${isItemActive(item) ? 'active' : ''}`}
                  onClick={() => navigate(item.path)}
                  title={item.label}
                >
                  <NavIcon name={item.icon} />
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          ))}

          <div className="sidebar-spacer" />

          <div className="sidebar-pipeline-strip">
            <div className="sidebar-pipeline-title">Pipeline status</div>
            <div className="pipeline-bar">
              {Object.keys(jobsApi.statusCounts).length ? (
                Object.entries(jobsApi.statusCounts).map(([status, count]) => (
                  <span key={status} className={`pipeline-segment ${status}`} style={{ flexGrow: count }} />
                ))
              ) : (
                <span className="pipeline-segment empty" style={{ flexGrow: 1 }} />
              )}
            </div>
            <div className="pipeline-legend">
              {Object.keys(jobsApi.statusCounts).length ? (
                Object.entries(jobsApi.statusCounts).map(([status, count]) => (
                  <span key={status} className="pipeline-legend-item">
                    <span className={`legend-dot ${status}`} aria-hidden="true" />
                    {status} · {count}
                  </span>
                ))
              ) : (
                <span className="pipeline-legend-item">No jobs yet</span>
              )}
            </div>
          </div>

          <div className="sidebar-user-footer">
            <div className="user-avatar" aria-hidden="true">PS</div>
            <div className="user-info">
              <span className="user-name">Print Studio</span>
              <span className="user-role">Admin</span>
            </div>
          </div>
        </nav>

        <main className="content-pane">
          {health && health.status === 'unreachable' && (
            <div className="backend-banner">
              <span>Backend not running — start it with <code className="mono">npm run dev</code> from the backend/ folder.</span>
              <StatusBadge status="pending" />
            </div>
          )}

          {fetchError && (
            <div className="backend-banner" role="alert">
              <span>Background update failed ({fetchError.source}): {fetchError.message}</span>
              <button className="btn-secondary btn-sm" onClick={() => setFetchError(null)}>Dismiss</button>
            </div>
          )}

          {setupStatus && !setupStatus.readyToRun && (
            <div className="setup-alert">
              <strong>Setup incomplete</strong>
              <ul>
                <li><span style={{ color: setupStatus.geminiKeyConfigured ? 'var(--state-success)' : 'var(--state-pending)', fontWeight: 600 }}>{setupStatus.geminiKeyConfigured ? 'Ready' : 'Action Required'}</span> Gemini API key configured — add one below in Settings</li>
                <li><span style={{ color: setupStatus.hasTagLibrary ? 'var(--state-success)' : 'var(--state-pending)', fontWeight: 600 }}>{setupStatus.hasTagLibrary ? 'Ready' : 'Action Required'}</span> Tag library has at least one tag — add one below in Settings</li>
                <li><span style={{ color: setupStatus.hasProductSize ? 'var(--state-success)' : 'var(--studio-ink-soft)', fontWeight: 600 }}>{setupStatus.hasProductSize ? 'Ready' : 'Optional'}</span> At least one product size / mockup template configured</li>
              </ul>
            </div>
          )}

          <Routes>
            <Route path="/" element={<Navigate to="/upload" replace />} />
            <Route path="/upload" element={
              <UploadView
                pipelineDefault={settingsApi.pipelineDefault}
                overrides={settingsApi.overrides}
                setOverrides={settingsApi.setOverrides}
                toggleModule={settingsApi.toggleModule}
                refreshJobs={jobsApi.refreshJobs}
                dragActive={dragActive}
                setDragActive={setDragActive}
                uploadStatus={uploadStatus}
                handleFiles={handleFiles}
                onDrop={onDrop}
                showHowItWorks={showHowItWorks}
                setShowHowItWorks={setShowHowItWorks}
              />
            } />
            <Route path="/mockup-templates" element={<MockupTemplatesView />} />
            <Route path="/history" element={
              <HistoryView
                jobs={jobsApi.jobs}
                groupedJobs={jobsApi.groupedJobs}
                expandedBatches={jobsApi.expandedBatches}
                setExpandedBatches={jobsApi.setExpandedBatches}
                openJob={openJob}
                goTo={goTo}
              />
            } />
            <Route path="/review/:jobId?" element={
              <ReviewView
                recentJobsSorted={jobsApi.recentJobsSorted}
                jobIdInput={jobIdInput}
                setJobIdInput={setJobIdInput}
                activeJobId={activeJobId}
                setActiveJobId={setActiveJobId}
                activeJobInfo={activeJobInfo}
                reviewTab={reviewTab}
                setReviewTab={setReviewTab}
                openJob={openJob}
                goTo={goTo}
              />
            } />
            <Route path="/prompt-helper" element={<PromptHelperView />} />
            <Route path="/settings" element={<Navigate to="/settings/tags-trends" replace />} />
            <Route path="/settings/:tab" element={
              <SettingsView
                settingsApi={settingsApi}
                apiKeysApi={apiKeysApi}
                tagsAndTrendsApi={tagsAndTrendsApi}
              />
            } />
            <Route path="*" element={<Navigate to="/upload" replace />} />
          </Routes>
        </main>
      </div>

      <Modal
        open={Boolean(confirmAction)}
        onClose={confirmActionCancel}
        role="alertdialog"
        labelledBy="confirm-dialog-message"
      >
        <p id="confirm-dialog-message" className="modal-message">
          {confirmAction?.message}
        </p>
        <div className="modal-actions">
          <button className="btn-secondary" onClick={confirmActionCancel}>
            Cancel
          </button>
          <button className="btn-primary modal-btn-danger" onClick={confirmActionAccept}>
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}

export default App;
