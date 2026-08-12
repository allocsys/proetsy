import { useCallback, useEffect, useMemo, useState } from 'react';
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

  // Re-fetches the jobs list so the sidebar's status counts (derived from
  // `jobs` below) stay current. Exposed to views that create/mutate jobs
  // (e.g. UploadView) since nothing else notifies AppShell when that happens.
  const refreshJobs = useCallback(() => {
    api.jobs.list().then(setJobs).catch(() => setJobs([]));
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

  // View routing
  const viewComponent = (() => {
    switch (activeView) {
      case 'upload': return UploadView && <UploadView onNavigate={handleNavigate} onJobsChanged={refreshJobs} />;
      case 'mockup-templates': return MockupTemplates && <MockupTemplates />;
      case 'history': return HistoryView && <HistoryView onOpenJob={handleOpenJob} />;
      case 'review': return ReviewView && <ReviewView jobId={selectedJobId} />;
      case 'prompt-helper': return PromptHelper && <PromptHelper />;
      case 'taste-filter': return TasteFilter && <TasteFilter overrides={tasteFilterOverrides} refreshJobs={refreshJobs} />;
      case 'settings': return SettingsView && <SettingsView onBack={() => setActiveView(previousView)} />;
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
            <SetupBanner setupStatus={setupStatus} />
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
