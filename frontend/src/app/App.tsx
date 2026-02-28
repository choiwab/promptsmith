import { useEffect, useState } from "react";
import { ErrorState } from "../components/ErrorState";
import { CompareDashboard } from "../features/compare-dashboard/CompareDashboard";
import { EvalWorkbench } from "../features/eval-workbench/EvalWorkbench";
import { HistoryPanel } from "../features/history-panel/HistoryPanel";
import { ToastHost } from "../features/notifications/ToastHost";
import { ProjectSidebar } from "../features/project-sidebar/ProjectSidebar";
import { PromptWorkbench } from "../features/prompt-workbench/PromptWorkbench";
import { useHistory, useLastError, useProjectId, useRequestStates } from "../state/selectors";
import { useAppStore } from "../state/store";

const appName = import.meta.env.VITE_APP_NAME || "Promptsmith";

export const App = () => {
  const fetchHistory = useAppStore((state) => state.fetchHistory);
  const refreshProjects = useAppStore((state) => state.refreshProjects);
  const retryLastOperation = useAppStore((state) => state.retryLastOperation);
  const history = useHistory();
  const projectId = useProjectId();
  const requestStates = useRequestStates();
  const lastError = useLastError();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  useEffect(() => {
    void (async () => {
      await fetchHistory();
      await refreshProjects();
    })();
  }, [fetchHistory, refreshProjects]);

  const showBlockingError =
    requestStates.history === "error" &&
    history.length === 0 &&
    (lastError?.code === "API_UNAVAILABLE" || lastError?.code === "REQUEST_TIMEOUT");
  const showInlineError =
    Boolean(lastError) && !showBlockingError && lastError?.operation !== "compare" && lastError?.operation !== "eval";

  return (
    <div className="app-shell">
      <ProjectSidebar
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
      />
      <div className="app-content">
        <header className="app-header">
          <div className="app-header__identity">
            <button
              className="app-header__menu-btn"
              onClick={() => setSidebarOpen(true)}
              aria-label="Open project sidebar"
            >
              &#9776;
            </button>
            <span className="app-header__repo">repo</span>
            <div>
              <h1>{appName}</h1>
              <p>Prompt history, lineage, and CI-style visual regression checks.</p>
            </div>
          </div>
          <div className="app-header__controls">
            <span className="app-header__chip">Project: {projectId}</span>
            <span className="app-header__chip">Lineage-aware generations</span>
            <span className="app-header__chip">Compare pipeline</span>
            <span className="app-header__chip">Eval loop</span>
          </div>
        </header>

        {showBlockingError ? (
          <ErrorState
            title="Backend unavailable"
            code={lastError?.code}
            message={lastError?.message || "Cannot reach backend. Verify server is running and retry."}
            onRetry={retryLastOperation}
          />
        ) : null}

        {showInlineError ? (
          <section className="inline-error">
            <ErrorState
              title="Request failed"
              code={lastError?.code}
              message={lastError?.message || "An unexpected error occurred."}
              onRetry={lastError?.retryable ? retryLastOperation : undefined}
            />
          </section>
        ) : null}

        <main className="app-layout" aria-label="Promptsmith workspace">
          <div className="app-column">
            <EvalWorkbench />
            <PromptWorkbench />
          </div>
          <HistoryPanel />
          <CompareDashboard />
        </main>

        <ToastHost />
      </div>
    </div>
  );
};

export default App;
