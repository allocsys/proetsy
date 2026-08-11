import { useNavigate, useParams } from 'react-router-dom';
import Tabs from '../components/Tabs.jsx';
import EmptyState from '../components/EmptyState.jsx';
import JobArtworkAnalysisReview from '../JobArtworkAnalysisReview.jsx';
import JobListingReview from '../JobListingReview.jsx';
import JobMockupReview from '../JobMockupReview.jsx';
import { StatusBadge } from '../App.jsx';

const REVIEW_TABS = [
  {
    id: 'analysis',
    label: 'Image Analysis',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px' }}>
        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      </svg>
    ),
  },
  {
    id: 'listings',
    label: 'Listings',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px' }}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <polyline points="14 2 14 8 20 8" />
        <line x1="16" y1="13" x2="8" y2="13" />
        <line x1="16" y1="17" x2="8" y2="17" />
        <polyline points="10 9 9 9 8 9" />
      </svg>
    ),
  },
  {
    id: 'mockups',
    label: 'Mockups',
    icon: (
      <svg className="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ width: '14px', height: '14px' }}>
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    ),
  },
];

export default function ReviewView({
  recentJobsSorted,
  jobIdInput,
  setJobIdInput,
  activeJobId: propActiveJobId,
  setActiveJobId,
  activeJobInfo,
  reviewTab,
  setReviewTab,
  openJob,
  goTo,
}) {
  const navigate = useNavigate();
  const { jobId: routeJobId } = useParams();
  const activeJobId = routeJobId || propActiveJobId;

  return (
    <section className="paper-card" style={{ padding: 0, background: 'transparent', border: 'none', boxShadow: 'none' }}>
      <div className="paper-card card" style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginTop: 0, marginBottom: '1rem' }}>Job Workspace</h2>
        <div className="settings-field-row" style={{ alignItems: 'flex-start' }}>
          <div className="settings-field" style={{ flex: 1, minWidth: '220px' }}>
            <label htmlFor="review-job-picker" className="settings-field-label">Pick a recent job</label>
            <select
              id="review-job-picker"
              value=""
              onChange={(e) => {
                if (!e.target.value) return;
                setJobIdInput(e.target.value);
                setReviewTab('analysis');
                navigate(`/review/${e.target.value}`);
              }}
              disabled={!recentJobsSorted.length}
            >
              <option value="">{recentJobsSorted.length ? 'Select a job…' : 'No jobs yet'}</option>
              {recentJobsSorted.slice(0, 25).map((j) => (
                <option key={j.id} value={j.id}>
                  #{j.id} — {j.artwork_file_path?.split('/').pop() || 'untitled'} ({j.overall_status || 'pending'})
                </option>
              ))}
            </select>
          </div>
          <div className="settings-field">
            <span className="settings-field-label">Or enter a Job ID directly</span>
            <input
              type="text"
              inputMode="numeric"
              placeholder="Job ID"
              value={jobIdInput}
              onChange={(e) => setJobIdInput(e.target.value)}
              style={{ maxWidth: '160px' }}
            />
          </div>
          <button className="btn-primary" onClick={() => { setReviewTab('analysis'); navigate(`/review/${jobIdInput}`); }} disabled={!jobIdInput} style={{ height: '34px', marginTop: '1.25rem' }}>
            Load job
          </button>
        </div>
      </div>

      {activeJobId && activeJobInfo ? (
        <div>
          <div className="workspace-artwork-preview-card">
            {activeJobInfo.filePath && (
              <img
                src={`/artwork-files/${activeJobInfo.filePath.split('/').pop()}`}
                alt={activeJobInfo.filename}
                className="workspace-artwork-preview-img"
                onError={(e) => { e.target.style.display = 'none'; }}
              />
            )}
            <div className="workspace-artwork-preview-info">
              <span className="workspace-artwork-preview-filename">{activeJobInfo.filename}</span>
              <span className="workspace-artwork-preview-jobid">Job ID: #{activeJobInfo.id} · <span className={`text-muted`}>{activeJobInfo.status}</span></span>
            </div>
          </div>

          <Tabs
            tabs={REVIEW_TABS}
            activeId={reviewTab}
            onChange={setReviewTab}
          />

          <div className="workspace-panel-body">
            <div style={{ display: reviewTab === 'analysis' ? 'block' : 'none' }}>
              <JobArtworkAnalysisReview jobId={activeJobId} />
            </div>
            <div style={{ display: reviewTab === 'listings' ? 'block' : 'none' }}>
              <JobListingReview jobId={activeJobId} />
            </div>
            <div style={{ display: reviewTab === 'mockups' ? 'block' : 'none' }}>
              <JobMockupReview jobId={activeJobId} />
            </div>
          </div>
        </div>
      ) : recentJobsSorted.length ? (
        <div className="paper-card card">
          <p className="text-muted mono-sm" style={{ marginTop: 0 }}>Or pick a recent job:</p>
          <div style={{ overflowX: 'auto' }}>
            <table className="data-table">
              <thead>
                <tr>
                  <th>Job</th>
                  <th>Artwork</th>
                  <th>Status</th>
                  <th>Updated</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {recentJobsSorted.slice(0, 10).map((job) => (
                  <tr key={job.id}>
                    <td className="mono">#{job.id}</td>
                    <td style={{ wordBreak: 'break-all' }}>{job.artwork_file_path?.split('/').pop()}</td>
                    <td><StatusBadge status={job.overall_status} /></td>
                    <td className="text-muted mono mono-sm">{job.updated_at}</td>
                    <td>
                      <button className="btn-secondary btn-sm" onClick={() => openJob(job.id)}>Review</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="paper-card card">
          <EmptyState
            message="No jobs yet — drop some artwork on the Upload view to get started."
            cta={{ label: 'Go to Upload', onClick: () => goTo('upload') }}
          />
        </div>
      )}
    </section>
  );
}
