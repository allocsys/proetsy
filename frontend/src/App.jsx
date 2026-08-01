import { useEffect, useState } from 'react';

function App() {
  const [health, setHealth] = useState(null);
  const [pipeline, setPipeline] = useState(null);

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
      <p style={{ color: '#888' }}>
        Skeleton dashboard — modules are stubbed. See ARCHITECTURE.md for the full plan.
      </p>
    </div>
  );
}

export default App;
