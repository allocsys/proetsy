import { useCallback, useMemo, useState } from 'react';

// plan.md Step 4: lifts job list state + derived views out of App.jsx so
// UploadView/HistoryView/ReviewView can each take just what they need.
export function useJobs(reportFetchError) {
  const [jobs, setJobs] = useState([]);
  const [expandedBatches, setExpandedBatches] = useState({});

  const refreshJobs = useCallback(() => {
    fetch('/api/jobs')
      .then((r) => r.json())
      .then(setJobs)
      .catch(reportFetchError('refreshJobs'));
  }, [reportFetchError]);

  const groupedJobs = useMemo(() => {
    const groups = [];
    const batchIndex = new Map();
    for (const job of jobs) {
      if (!job.batch_id) {
        groups.push({ type: 'single', job });
        continue;
      }
      if (batchIndex.has(job.batch_id)) {
        groups[batchIndex.get(job.batch_id)].jobs.push(job);
      } else {
        batchIndex.set(job.batch_id, groups.length);
        groups.push({ type: 'batch', batchId: job.batch_id, jobs: [job] });
      }
    }
    return groups;
  }, [jobs]);

  const statusCounts = useMemo(
    () =>
      jobs.reduce((acc, j) => {
        const key = j.overall_status || 'pending';
        acc[key] = (acc[key] || 0) + 1;
        return acc;
      }, {}),
    [jobs]
  );

  const recentJobsSorted = useMemo(
    () => [...jobs].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
    [jobs]
  );

  const runJobsBatch = useCallback(
    async (jobIds) => {
      await fetch('/api/jobs/run-batch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_ids: jobIds }),
      }).catch(reportFetchError('runJobsBatch'));
      refreshJobs();
    },
    [reportFetchError, refreshJobs]
  );

  return {
    jobs,
    refreshJobs,
    groupedJobs,
    statusCounts,
    recentJobsSorted,
    runJobsBatch,
    expandedBatches,
    setExpandedBatches,
  };
}
