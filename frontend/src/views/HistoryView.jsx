import EmptyState from '../components/EmptyState.jsx';
import { StatusBadge } from '../App.jsx';

export default function HistoryView({ jobs, groupedJobs, expandedBatches, setExpandedBatches, openJob, goTo }) {
  return (
    <section className="paper-card card">
      <h2 style={{ marginTop: 0 }}>Listing History</h2>
      {jobs.length === 0 ? (
        <EmptyState
          message="No jobs yet — drop some artwork on the Upload view to get started."
          cta={{ label: 'Go to Upload', onClick: () => goTo('upload') }}
        />
      ) : (
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
              {groupedJobs.map((entry) => {
                if (entry.type === 'single') {
                  const job = entry.job;
                  return (
                    <tr key={job.id}>
                      <td className="mono">#{job.id}</td>
                      <td style={{ wordBreak: 'break-all' }}>{job.artwork_file_path?.split('/').pop()}</td>
                      <td><StatusBadge status={job.overall_status} /></td>
                      <td className="text-muted mono mono-sm">{job.updated_at}</td>
                      <td>
                        <button className="btn-secondary btn-sm" onClick={() => openJob(job.id)}>
                          <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                          Review
                        </button>
                      </td>
                    </tr>
                  );
                }

                const { batchId, jobs: batchJobs } = entry;
                const expanded = !!expandedBatches[batchId];
                const statusCountsForBatch = batchJobs.reduce((acc, j) => {
                  acc[j.overall_status] = (acc[j.overall_status] || 0) + 1;
                  return acc;
                }, {});
                const mostRecentUpdate = batchJobs.reduce(
                  (latest, j) => (j.updated_at > latest ? j.updated_at : latest),
                  batchJobs[0].updated_at
                );
                return (
                  <>
                    <tr key={`batch-${batchId}`} style={{ background: 'rgba(255, 255, 255, 0.02)' }}>
                      <td className="mono">
                        <button
                          className="btn-secondary btn-sm"
                          onClick={() => setExpandedBatches((prev) => ({ ...prev, [batchId]: !prev[batchId] }))}
                          aria-label={expanded ? 'Collapse batch' : 'Expand batch'}
                          title={expanded ? 'Collapse batch' : 'Expand batch'}
                        >
                          {expanded ? '▾' : '▸'}
                        </button>
                      </td>
                      <td style={{ fontWeight: 600 }}>Batch — {batchJobs.length} artwork{batchJobs.length > 1 ? 's' : ''}</td>
                      <td>
                        <div className="flex-row flex-wrap" style={{ gap: '0.35rem' }}>
                          {Object.entries(statusCountsForBatch).map(([status, count]) => (
                            <span key={status} style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                              <StatusBadge status={status} /> <span className="text-muted mono mono-sm">x{count}</span>
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="text-muted mono mono-sm">{mostRecentUpdate}</td>
                      <td />
                    </tr>
                    {expanded && batchJobs.map((job) => (
                      <tr key={job.id} style={{ opacity: 0.9 }}>
                        <td className="mono" style={{ paddingLeft: '1.5rem' }}>#{job.id}</td>
                        <td style={{ wordBreak: 'break-all' }}>{job.artwork_file_path?.split('/').pop()}</td>
                        <td><StatusBadge status={job.overall_status} /></td>
                        <td className="text-muted mono mono-sm">{job.updated_at}</td>
                        <td>
                          <button className="btn-secondary btn-sm" onClick={() => openJob(job.id)}>
                            <svg className="btn-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                              <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                              <circle cx="12" cy="12" r="3" />
                            </svg>
                            Review
                          </button>
                        </td>
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
