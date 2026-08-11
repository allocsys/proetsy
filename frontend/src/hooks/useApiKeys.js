import { useCallback, useState } from 'react';

// plan.md Step 4: API key CRUD state, isolated so SettingsView's API Keys tab
// doesn't need to reach into the rest of App.jsx's state.
export function useApiKeys(reportFetchError, requestConfirm) {
  const [apiKeys, setApiKeys] = useState([]);
  const [apiKeysLoading, setApiKeysLoading] = useState(true);
  const [newKeyProvider, setNewKeyProvider] = useState('gemini');
  const [newKeyValue, setNewKeyValue] = useState('');
  const [newKeyLabel, setNewKeyLabel] = useState('');
  const [apiKeysMessage, setApiKeysMessage] = useState('');

  const refreshApiKeys = useCallback(() => {
    fetch('/api/settings/api-keys')
      .then((r) => r.json())
      .then((data) => { setApiKeys(data); setApiKeysLoading(false); })
      .catch((err) => { setApiKeysLoading(false); reportFetchError('refreshApiKeys')(err); });
  }, [reportFetchError]);

  async function addApiKey() {
    if (!newKeyValue.trim()) return;
    setApiKeysMessage('Adding key…');
    try {
      const res = await fetch('/api/settings/api-keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: newKeyProvider,
          key_value: newKeyValue.trim(),
          label: newKeyLabel.trim() || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add key');
      setNewKeyValue('');
      setNewKeyLabel('');
      setApiKeysMessage('');
      refreshApiKeys();
    } catch (err) {
      setApiKeysMessage(err.message);
    }
  }

  async function toggleApiKeyEnabled(key) {
    await fetch(`/api/settings/api-keys/${key.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: !key.enabled }),
    });
    refreshApiKeys();
  }

  async function deleteApiKey(key) {
    requestConfirm(
      `Delete ${key.provider} key${key.label ? ` "${key.label}"` : ''} (${key.maskedKey})? This can't be undone.`,
      async () => {
        await fetch(`/api/settings/api-keys/${key.id}`, { method: 'DELETE' });
        refreshApiKeys();
      }
    );
  }

  return {
    apiKeys,
    apiKeysLoading,
    refreshApiKeys,
    newKeyProvider,
    setNewKeyProvider,
    newKeyValue,
    setNewKeyValue,
    newKeyLabel,
    setNewKeyLabel,
    apiKeysMessage,
    addApiKey,
    toggleApiKeyEnabled,
    deleteApiKey,
  };
}
