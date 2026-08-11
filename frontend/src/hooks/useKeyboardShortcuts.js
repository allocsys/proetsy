import { useEffect, useRef, useState } from 'react';

const LEADER_KEY = 'g';
const LEADER_TIMEOUT_MS = 1200;

/**
 * plan.md Step 6: keyboard shortcuts for power users.
 *
 * @param {function} navigate - react-router's navigate function
 * @param {Record<string,string>} shortcutMap - lowercase key -> path, applied
 *   after the "g" leader (e.g. { u: '/upload', h: '/history' })
 * @returns {{ helpOpen: boolean, setHelpOpen: function }}
 */
export function useKeyboardShortcuts(navigate, shortcutMap) {
  const [helpOpen, setHelpOpen] = useState(false);
  const leaderActiveRef = useRef(false);
  const leaderTimerRef = useRef(null);

  useEffect(() => {
    function clearLeader() {
      leaderActiveRef.current = false;
      if (leaderTimerRef.current) {
        clearTimeout(leaderTimerRef.current);
        leaderTimerRef.current = null;
      }
    }

    function isTypingTarget(target) {
      if (!target) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }

    function onKeyDown(e) {
      // Never hijack typing in a form field, or a chord the browser/OS already
      // owns (Cmd/Ctrl/Alt combos), or key-repeat while a key is held down.
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey || e.repeat) {
        clearLeader();
        return;
      }

      if (e.key === 'Escape') {
        clearLeader();
        setHelpOpen(false);
        return;
      }

      if (e.key === '?') {
        clearLeader();
        setHelpOpen((open) => !open);
        return;
      }

      if (leaderActiveRef.current) {
        clearLeader();
        const path = shortcutMap[e.key.toLowerCase()];
        if (path) {
          e.preventDefault();
          navigate(path);
        }
        return;
      }

      if (e.key.toLowerCase() === LEADER_KEY) {
        leaderActiveRef.current = true;
        leaderTimerRef.current = setTimeout(clearLeader, LEADER_TIMEOUT_MS);
      }
    }

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      clearLeader();
    };
  }, [navigate, shortcutMap]);

  return { helpOpen, setHelpOpen };
}
