import { useEffect, useState } from 'react';
import JobListingReview from './JobListingReview.jsx';
import JobMockupReview from './JobMockupReview.jsx';

function App() {
  const [health, setHealth] = useState(null);
  const [pipeline, setPipeline] = useState(null);
  const [jobIdInput, setJobIdInput] = useState('');
  const [activeJobId, setActiveJobId] = useState(null);

  useEffect(() => {
    fetch('/api/health')
      .then((r) => r.json())
      .then(setHealth)
      .catch(() => setHealth({ status: 'unreachable' }));

    fetch('/api/config/pipeline')
      .then((r) => r.json())
      .then(setPipeline)
      .catch(() => {});
  }, []);

  return (
    <div style={{ fontFamily: 'sans-serif', padding: '2rem' }}>
      <h1>ProEtsy</h1>
      <p>Backend status: {health ? health.status : 'checking...'}</p>
      <h2>Pipeline config</h2>
      <ul>
        {pipeline?.pipeline?.map((m) => (
          <li key={m.module}>
            {m.module} — {m.enabled ? 'enabled' : 'disabled'}
            {m.required ? ' (required)' : ''}
          </li>
        ))}
      </ul>
      <h2>Mockup review (Module 3)</h2>
      <div style={{ marginBottom: '1rem' }}>
        <input
          type="number"
          placeholder="Job ID"
          value={jobIdInput}
          onChange={(e) => setJobIdInput(e.target.value)}
        />
        <button onClick={() => setActiveJobId(jobIdInput)} disabled={!jobIdInput}>
          View mockups
        </button>
      </div>
      {activeJobId && (
        <>
          <h3>Listings</h3>
          <JobListingReview jobId={activeJobId} />
          <h3>Mockups</h3>
          <JobMockupReview jobId={activeJobId} />
        </>
      )}

      <p style={{ color: '#888' }}>
        Skeleton dashboard — modules are stubbed. See ARCHITECTURE.md for the full plan.
      </p>
    </div>
  );
}

export default App;
