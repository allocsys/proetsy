import { useCallback, useState } from 'react';

// Shared loading/error boilerplate that every page's fetch handlers repeat:
// setLoading(true); setError(null); try { ...await fetch...; } catch (err) {
// setError(err.message); } finally { setLoading(false); }
//
// This wraps an existing async function WITHOUT changing what it fetches, how many
// times, or in what order -- callers keep 100% of their existing fetch calls, URLs,
// and bodies; this only removes the repeated try/catch/finally shell around them.
// Several pages' tests key mocked fetch responses to call order (see
// JobListingReview.test.jsx, PromptHelper.test.jsx), so this hook must never add,
// remove, or reorder a fetch call on its own -- callers pass their existing async
// logic in unchanged, this just runs it.
//
// Not a fit for every loading pattern in the app -- e.g. an effect that needs a
// "have I ever loaded" flag that stays false forever on error (see
// MockupCategorySelector in JobMockupReview.jsx) has different semantics than
// "currently in flight," so it's left as its own local state rather than forced
// through this hook.
export function useAsyncTask() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);

  const run = useCallback(async (task) => {
    setPending(true);
    setError(null);
    try {
      return await task();
    } catch (err) {
      setError(err.message);
      return undefined;
    } finally {
      setPending(false);
    }
  }, []);

  return { pending, error, setError, run };
}
