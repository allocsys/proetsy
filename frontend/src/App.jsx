import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/hooks/useApi';
import { ConfirmProvider } from '@/contexts/ConfirmContext.jsx';
import { TooltipProvider } from '@/components/ui/tooltip';
import Header from '@/components/layout/Header.jsx';
import Sidebar from '@/components/layout/Sidebar.jsx';
import MobileNav from '@/components/layout/MobileNav.jsx';
import SetupBanner from '@/components/layout/SetupBanner.jsx';
import UploadView from '@/views/UploadView.jsx';
import MockupTemplates from '@/views/MockupTemplates.jsx';
import HistoryView from '@/views/HistoryView.jsx';
import ReviewView from '@/views/ReviewView.jsx';
import PromptHelper from '@/views/PromptHelper.jsx';
import TasteFilter from '@/views/TasteFilter.jsx';
import SettingsView from '@/views/SettingsView.jsx';
import OnboardingWizard from '@/views/OnboardingWizard.jsx';

// Once a user has seen the first-run onboarding wizard (whether they finish
// it or skip it), never auto-trigger it again -- they can still get to the
// underlying Settings/Mockup Templates screens directly. Persisted the same
// way App.jsx already persists sidebar-collapsed / settings-advanced flags.
const ONBOARDING_SEEN_KEY = 'proetsy-onboarding-seen';

function hasSeenOnboarding() {
  try {
    return localStorage.getItem(ONBOARDING_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

function markOnboardingSeen() {
  try {
    localStorage.setItem(ONBOARDING_SEEN_KEY, '1');
  } catch {
    // localStorage unavailable (e.g. private browsing) -- wizard may
    // reappear next launch, which is an acceptable fallback.
  }
}

// "First launch when setup-status shows nothing configured" (plan.md Phase 3)
// -- all three setup-status checks are unmet, not just the backend's
// readyToRun flag (which ignores product sizes entirely).
function isNothingConfigured(setupStatus) {
  if (!setupStatus) return false;
  return !setupStatus.geminiKeyConfigured && !setupStatus.hasTagLibrary && !setupStatus.hasProductSize;
}

function AppShell() {
  const [activeView, setActiveView] = useState('upload');
  const [previousView, setPreviousView] = useState('upload');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try {
      return localStorage.getItem('proetsy-sidebar-collapsed') === '1';
    } catch {
      return false;
    }
  });
  const [health, setHealth] = useState(null);
  const [setupStatus, setSetupStatus] = useState(null);
  const [jobs, setJobs] = useState([]);
  const [pipelineConfig, setPipelineConfig] = useState(null);
  const [selectedJobId, setSelectedJobId] = useState(null);
  const onboardingCheckedRef = useRef(false);

  // Re-fetches the jobs list so the sidebar's status counts (derived from
  // `jobs` below) stay current. Exposed to views that create/mutate jobs
  // (e.g. UploadView) since nothing else notifies AppShell when that happens.
  const refreshJobs = useCallback(() => {
    api.jobs.list().then(setJobs).catch(() => setJobs([]));
  }, []);

  // Re-fetches setup status so SetupBanner reflects changes made in Settings
  // (API key added, tags saved) or Mockup Templates (product size configured)
  // without requiring a full page reload. Exposed the same way refreshJobs is,
  // since nothing else notifies AppShell when those views mutate their data.
  const refreshSetupStatus = useCallback(() => {
    api.setupStatus().then(setSetupStatus).catch(() => {});
  }, []);

  // Keep + Pipeline (Taste Filter) needs pipeline_overrides in `{ module: enabled }`
  // shape (see backend/lib/jobs.js createJob) -- derived from the fetched pipeline
  // defaults since this flow has no per-session toggle UI of its own to source from.
  const tasteFilterOverrides = useMemo(() => {
    if (!pipelineConfig?.pipeline) return {};
    return Object.fromEntries(pipelineConfig.pipeline.map((m) => [m.module, m.enabled]));
  }, [pipelineConfig]);

  // Fetch health, setup, jobs, pipeline config on mount
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: 'error' }));
    api.setupStatus().then(setSetupStatus).catch(() => {});
    refreshJobs();
    api.pipelineConfig().then(setPipelineConfig).catch(() => {});
  }, [refreshJobs]);

  // Trigger the onboarding wizard automatically on first launch, once
  // setup-status has loaded and shows nothing configured yet (see plan.md
  // Phase 3). Runs at most once per browser (onboardingCheckedRef guards
  // against re-triggering on subsequent setupStatus refreshes within the
  // same session, e.g. after the user completes/skips a step).
  //
  // Deliberately does NOT call markOnboardingSeen() here -- that only
  // happens once the user actually finishes or explicitly skips the wizard
  // (see handleOnboardingComplete below). Marking it "seen" at trigger time
  // would mean a reload mid-wizard (e.g. right after step 1) permanently
  // loses the auto-trigger even though nothing was ever configured.
  useEffect(() => {
    if (onboardingCheckedRef.current) return;
    if (setupStatus === null) return;
    onboardingCheckedRef.current = true;
    if (!hasSeenOnboarding() && isNothingConfigured(setupStatus)) {
      setPreviousView('upload');
      setActiveView('onboarding');
    }
  }, [setupStatus]);

  // Compute status counts from jobs
  const statusCounts = useMemo(() => {
    const counts = { pending: 0, completed: 0, running: 0, failed: 0 };
    for (const job of jobs) {
      // jobs.overall_status is the real column (see backend/lib/jobs.js) -- 'success'
      // is its terminal-success value, mapped to 'completed' to match Sidebar.jsx's
      // statusColors/label keys.
      const raw = job.overall_status || 'pending';
      const key = raw === 'success' ? 'completed' : raw;
      if (key in counts) counts[key]++;
    }
    return counts;
  }, [jobs]);

  const handleViewChange = useCallback((view) => {
    if (view !== 'settings') setPreviousView(activeView);
    setActiveView(view);
  }, [activeView]);

  const handleSettingsToggle = useCallback(() => {
    if (activeView === 'settings') {
      setActiveView(previousView);
    } else {
      setPreviousView(activeView);
      setActiveView('settings');
    }
  }, [activeView, previousView]);

  const handleToggleSidebar = useCallback(() => {
    setSidebarCollapsed((c) => !c);
  }, []);

  const handleRefreshHealth = useCallback(() => {
    api.health().then(setHealth).catch(() => setHealth({ status: 'error' }));
  }, []);

  // Navigate to a view with optional state
  const handleNavigate = useCallback((view, state = {}) => {
    if (view !== 'settings') setPreviousView(activeView);
    setActiveView(view);
    // If a jobId is provided, store it for the ReviewView
    if (state.jobId) {
      setSelectedJobId(state.jobId);
    }
  }, [activeView]);

  // Open a job in the review view
  const handleOpenJob = useCallback((jobId) => {
    setSelectedJobId(jobId);
    setPreviousView(activeView);
    setActiveView('review');
  }, [activeView]);

  // Called when the onboarding wizard is finished or skipped -- mark it as
  // seen (so it won't auto-trigger again) and return to the normal Upload
  // view. Marking "seen" here rather than at trigger time means an
  // interrupted session (reload mid-wizard) will still bring the wizard
  // back on next launch.
  const handleOnboardingComplete = useCallback(() => {
    markOnboardingSeen();
    setActiveView('upload');
  }, []);

  // View routing
  const viewComponent = (() => {
    switch (activeView) {
      case 'upload': return UploadView && <UploadView onNavigate={handleNavigate} onJobsChanged={refreshJobs} />;
      case 'mockup-templates': return MockupTemplates && <MockupTemplates onSetupStatusChange={refreshSetupStatus} />;
      case 'history': return HistoryView && <HistoryView onOpenJob={handleOpenJob} />;
      case 'review': return ReviewView && <ReviewView jobId={selectedJobId} />;
      case 'prompt-helper': return PromptHelper && <PromptHelper />;
      case 'taste-filter': return TasteFilter && <TasteFilter overrides={tasteFilterOverrides} refreshJobs={refreshJobs} />;
      case 'settings': return SettingsView && <SettingsView onBack={() => setActiveView(previousView)} onSetupStatusChange={refreshSetupStatus} />;
      case 'onboarding': return OnboardingWizard && (
        <OnboardingWizard
          setupStatus={setupStatus}
          onComplete={handleOnboardingComplete}
          onSetupStatusChange={refreshSetupStatus}
        />
      );
      default: return null;
    }
  })();

  const isInSettings = activeView === 'settings';

  return (
    <div className="flex min-h-screen flex-col">
      <Header
        health={health}
        onRefreshHealth={handleRefreshHealth}
        onSettingsToggle={handleSettingsToggle}
        isInSettings={isInSettings}
      />
      <MobileNav activeView={activeView} onViewChange={handleViewChange} />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar
          activeView={activeView}
          onViewChange={handleViewChange}
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={handleToggleSidebar}
          statusCounts={statusCounts}
        />
        <main className="flex-1 overflow-auto">
          <div className="mx-auto max-w-5xl p-6">
            {/* SetupBanner is redundant with (and visually competes with) the
                onboarding wizard's own step indicator, so it's hidden while
                the wizard is active. */}
            {activeView !== 'onboarding' && <SetupBanner setupStatus={setupStatus} />}
            {viewComponent}
          </div>
        </main>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <TooltipProvider>
      <ConfirmProvider>
        <AppShell />
      </ConfirmProvider>
    </TooltipProvider>
  );
}
